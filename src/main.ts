/**
 * ============================================================================
 * Rustify — Point d'Entrée Principal (src/main.ts)
 * ----------------------------------------------------------------------------
 * Fichier d'orchestration minimaliste (< 200 lignes).
 * Il initialise les abonnements, connecte les contrôleurs d'onglets,
 * enregistre les raccourcis clavier et lance le démarrage de l'application.
 * 
 * Architecture des modules :
 * - src/types.ts : Interfaces & Types TypeScript.
 * - src/state.ts : État réactif global & caches.
 * - src/utils/ : Loggers, Dialogues, Formatage, Navigation.
 * - src/services/ : Interface Tauri IPC avec Rust backend.
 * - src/modals/ : Modales de métadonnées, artistes, albums, genres & context menu.
 * - src/player/ : Moteur audio, Smart Shuffle & Overlay Vinyle.
 * - src/tabs/ : Contrôleurs de vues (Morceaux, Albums, Artistes, Genres, Tempo,
 *                Playlists, Radios, Récents, Favoris, Extase, Téléchargeur, Paramètres).
 * ============================================================================
 */

import "@fortawesome/fontawesome-free/css/all.min.css";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { $, allTracks, currentQueue, isSeeking, setIsSeeking, smartShuffleActive, nextSmartTrack, setNextSmartTrack } from "./state";
import type { PlayerState, Radio, Track, ArtistSummary, AlbumSummary } from "./types";

import { initConsoleInterceptors, loadBackendLogs, loadFrontendLogs, initDebugLogEvents } from "./utils/logger";
import { appPrompt, appConfirm, appAlert, showAlert, appDeleteConfirm } from "./utils/dialog";
import { showToast } from "./utils/toast";
import { updateSliderTrack, fmtTime } from "./utils/formatting";
import { switchView, pushNavState, setNavCallbacks, initCollapsibleSections, goNavBack, goNavForward } from "./utils/navigation";

import { openGenericContextMenu, hideContextMenu, setContextMenuCallbacks, initContextMenuGlobalEvents } from "./modals/contextMenu";
import { openMetadataModal, closeMetadataModal, setupMetadataModalEvents, fetchOnlineMetadata, runAdvancedEnrichment, enrichLibraryInBatch } from "./modals/trackModal";
import { openAlbumModal, closeAlbumModal, setupAlbumModalEvents } from "./modals/albumModal";
import { openArtistModal, closeArtistModal, setupArtistModalEvents, enrichArtistPhotosInBatch } from "./modals/artistModal";
import { openGenreModal, setupGenreModalEvents } from "./modals/genreModal";
import { openLyricsPopover, toggleLyricsPopover, setupLyricsModalEvents } from "./modals/lyricsModal";

import { openOverlayWindow, closeOverlayWindow, toggleClickThrough, initOverlayEvents } from "./player/overlay";
import {
  playFromQueue,
  refreshPlayerState,
  applyPlayerState,
  restoreLastPlayerState,
  setSmartShuffleState,
  toggleSmartShuffle,
  pollState,
  setPlayerEngineCallbacks,
  registerListenEventBeforeSkip,
  playFromSmartTrack,
  calculateNextSmartTrack,
  bindAlgoFeedbackButtons,
  startSmartShuffleForPlaylist,
} from "./player/playerEngine";

import { loadLibrary, renderTracks, renderTracksInContainer, updateMissingMetadataCount, updateRenderedTrack, setTracksTabCallbacks, filterBySimilarTrack } from "./tabs/tracksTab";
import { loadAlbums, renderAlbumsGrid, filterByAlbum, setAlbumsTabCallbacks } from "./tabs/albumsTab";
import { loadArtists, renderArtistsGrid, openArtistView, openArtistByName, isArtistGroup, setArtistsTabCallbacks } from "./tabs/artistsTab";
import { loadGenres, filterByGenre, parseGenres, setGenresTabCallbacks } from "./tabs/genresTab";
import { loadTempo, filterByTempo, setTempoTabCallbacks } from "./tabs/tempoTab";
import { loadYears, filterByYear, setYearsTabCallbacks } from "./tabs/yearsTab";
import { loadMood, setMoodTabCallbacks } from "./tabs/moodTab";
import { loadPlaylists, setPlaylistsTabCallbacks } from "./tabs/playlistsTab";
import { loadRadios, playRadio, stopRadio, initRadioEvents, getActiveRadio, getRadioAudioEl, syncRadioAudioDevice, setRadioVolume } from "./tabs/radiosTab";
import { loadRecents, setRecentsTabCallbacks } from "./tabs/recentsTab";
import { loadFavorites, setFavoritesTabCallbacks } from "./tabs/favoritesTab";
import { loadEcstasyTracks } from "./tabs/ecstasyTab";
import { loadQueue, setQueueTabCallbacks } from "./tabs/queueTab";
import { initDownloaderEvents, setDownloaderCallbacks } from "./tabs/downloaderTab";
import { loadAppSettings, loadAudioDevices, renderAudioDeviceUI, loadEqState, matchShortcut, currentShortcutPlay, currentShortcutNext, currentShortcutPrev, currentShortcutStop, currentShortcutOverlay, initSettingsEvents, setSettingsTabCallbacks } from "./tabs/settingsTab";

const isOverlayWindowInstance = getCurrentWindow().label === "overlay";

// ── Connexion des rappels inter-modules ─────────────────────────────────────
setNavCallbacks({
  openArtistView,
  filterByAlbum,
  filterByGenre,
  filterByTempo,
  filterByYear,
  loadAlbums,
  loadArtists,
  loadGenres,
  loadTempo,
  loadYears,
  loadMood,
  loadPlaylists,
  loadRecents,
  loadFavorites,
  loadEcstasyTracks,
  loadQueue,
  loadSettings: () => {
    updateMissingMetadataCount();
    loadAppSettings();
    loadEqState();
    loadBackendLogs();
    loadFrontendLogs();
  },
  handleSearchInput,
});

function applyTrackUpdate(updatedTrack: Track) {
  const track = allTracks.find((item) => item.id === updatedTrack.id || item.path === updatedTrack.path);
  if (track) Object.assign(track, updatedTrack);
  const queuedTrack = currentQueue.find((item) => item.id === updatedTrack.id || item.path === updatedTrack.path);
  if (queuedTrack) Object.assign(queuedTrack, updatedTrack);
  updateRenderedTrack(updatedTrack);
  updateMissingMetadataCount();
}

export function refreshActiveView() {
  const activeNav = document.querySelector(".nav-item.active") as HTMLElement | null;
  const currentView = activeNav?.dataset.view || "tracks";
  if (currentView === "ecstasy") {
    loadEcstasyTracks();
  } else if (currentView === "favorites") {
    loadFavorites();
  } else if (currentView === "tracks") {
    renderTracks(allTracks);
  } else if (currentView === "years") {
    loadYears();
  }
}

setContextMenuCallbacks({
  playTrackTarget: (target) => {
    if (target.track) playFromQueue([target.track], 0);
    else if (target.queue && target.index !== undefined) playFromQueue(target.queue, target.index);
  },
  addToQueueTarget: async (target) => {
    if (target.track) {
      currentQueue.push(target.track);
      loadQueue();
    }
  },
  filterByArtist: (name) => openArtistByName(name),
  filterByAlbum,
  filterBySimilar: filterBySimilarTrack,
  toggleFavTrack: async (track) => {
    const isFav = await invoke<boolean>("toggle_favorite", { targetType: "track", targetId: track.id });
    track.is_favorite = isFav;
    const t = allTracks.find((x) => x.id === track.id || x.path === track.path);
    if (t) t.is_favorite = isFav;
    await refreshPlayerState();
    refreshActiveView();
  },
  toggleEcstasyTrack: async (track) => {
    const isExt = await invoke<boolean>("toggle_ecstasy", { trackId: track.id });
    track.is_ecstasy = isExt;
    const t = allTracks.find((x) => x.id === track.id || x.path === track.path);
    if (t) t.is_ecstasy = isExt;
    await refreshPlayerState();
    refreshActiveView();
  },
  likeTrack: async (track) => {
    const res = await invoke<[number, number]>("like_track", { trackId: track.id });
    track.likes = res[0];
    track.dislikes = res[1];
    const t = allTracks.find((x) => x.id === track.id || x.path === track.path);
    if (t) {
      t.likes = res[0];
      t.dislikes = res[1];
    }
    await refreshPlayerState();
    refreshActiveView();
  },
  dislikeTrack: async (track) => {
    const res = await invoke<[number, number]>("dislike_track", { trackId: track.id });
    track.likes = res[0];
    track.dislikes = res[1];
    const t = allTracks.find((x) => x.id === track.id || x.path === track.path);
    if (t) {
      t.likes = res[0];
      t.dislikes = res[1];
    }
    await refreshPlayerState();
    refreshActiveView();
  },
  openAlbumModal,
  openArtistModal,
  fetchArtistPhoto: (artistName) => {
    enrichArtistPhotosInBatch();
  },
  toggleArtistType: async (artist) => {
    const isGrp = isArtistGroup(artist);
    await invoke("toggle_artist_type", { artist: artist.artist, isGroup: !isGrp });
    await loadArtists();
  },
  openGenreModal,
  renamePlaylist: async (playlistId, oldName) => {
    const name = await appPrompt("Renommer la playlist :", oldName);
    if (name && name.trim()) {
      await invoke("rename_playlist", { playlistId, newName: name.trim() });
      await loadPlaylists();
    }
  },
  deletePlaylist: (playlistId) => handleDeletePlaylist(playlistId),
  deleteTrack: (track) => handleDeleteTrack(track),
  removeFromPlaylist: (playlistId, track) => handleRemoveFromPlaylist(playlistId, track),
  deleteArtist: (artist) => handleDeleteArtist(artist),
  deleteAlbum: (album) => handleDeleteAlbum(album),
  deleteGenre: (genreName, count) => handleDeleteGenre(genreName, count),
  openTrackInfoModal: (track) => openMetadataModal(track, applyTrackUpdate),
  openLyricsModal: (track) => openLyricsPopover(track),
  filterByGenre,
  loadPlaylists,
  isArtistGroup,
  startSmartShuffleForPlaylist,
});

setTracksTabCallbacks({
  openArtistByName,
  filterByAlbum,
  playFromQueue,
  openGenericContextMenu,
  startSmartShuffleForPlaylist,
  deletePlaylist: handleDeletePlaylist,
  reloadFavorites: async () => {
    await loadFavorites();
    await refreshPlayerState();
  },
  reloadEcstasy: async () => {
    await loadEcstasyTracks();
    await refreshPlayerState();
  },
});

setAlbumsTabCallbacks({
  switchView,
  renderTracks,
  pushNavState,
  openAlbumModal,
  openGenericContextMenu,
});

setArtistsTabCallbacks({
  switchView,
  renderTracks,
  pushNavState,
  openArtistModal,
  openGenericContextMenu,
});

setGenresTabCallbacks({
  switchView,
  renderTracks,
  pushNavState,
  openGenericContextMenu,
});

setTempoTabCallbacks({
  switchView,
  renderTracks,
  pushNavState,
  loadLibrary: async () => { await loadLibrary(); },
});

setYearsTabCallbacks({
  switchView,
  renderTracks,
  pushNavState,
  loadLibrary: async () => { await loadLibrary(); },
});

setMoodTabCallbacks({
  switchView,
  renderTracks,
  playFromQueue,
  pushNavState,
  openGenericContextMenu,
});

setPlaylistsTabCallbacks({
  switchView,
  renderTracks,
  openGenericContextMenu,
  startSmartShuffleForPlaylist,
  deletePlaylist: handleDeletePlaylist,
});

setRecentsTabCallbacks({
  playFromQueue,
  openGenericContextMenu,
});

setFavoritesTabCallbacks({
  renderTracksInContainer,
  renderAlbumsGrid,
  renderArtistsGrid,
  switchView,
  renderTracks,
});

setDownloaderCallbacks({
  loadLibrary: async () => { await loadLibrary(); },
});

setSettingsTabCallbacks({
  loadBackendLogs,
  loadFrontendLogs,
  updateMissingMetadataCount,
  runAdvancedEnrichment: async () => { await runAdvancedEnrichment(allTracks, async () => { await loadLibrary(); }); },
  enrichArtistPhotosInBatch: async () => { await enrichArtistPhotosInBatch(loadArtists); },
  enrichLibraryInBatch: async () => { await enrichLibraryInBatch(allTracks, async () => { await loadLibrary(); }); },
});

setPlayerEngineCallbacks({
  renderAudioDeviceUI,
  onStateApplied: () => {
    const queueView = $("view-queue");
    if (queueView && !queueView.hidden) {
      loadQueue();
    }
  },
  getActiveRadio,
  getRadioAudioEl,
  stopRadio,
  activeRadioPlaying: false,
});

// ── Filtrage de recherche dynamique ─────────────────────────────────────────
function handleSearchInput() {
  const searchInput = $<HTMLInputElement>("search");
  if (!searchInput) return;
  const q = searchInput.value.trim().toLowerCase();

  const activeViewEl = document.querySelector(".view:not([hidden])") as HTMLElement | null;
  const currentViewId = activeViewEl ? activeViewEl.id.replace("view-", "") : "tracks";

  if (currentViewId === "tracks") {
    const filtered = allTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q)
    );
    renderTracks(filtered);
  } else if (currentViewId === "albums") {
    document.querySelectorAll("#view-albums .grid-card").forEach((card) => {
      const title = card.querySelector(".title")?.textContent?.toLowerCase() || "";
      const subtitle = card.querySelector(".subtitle")?.textContent?.toLowerCase() || "";
      (card as HTMLElement).style.display = title.includes(q) || subtitle.includes(q) ? "" : "none";
    });
  } else if (currentViewId === "artists") {
    document.querySelectorAll("#view-artists .grid-card").forEach((card) => {
      const title = card.querySelector(".title")?.textContent?.toLowerCase() || "";
      (card as HTMLElement).style.display = title.includes(q) ? "" : "none";
    });
  }
}

// ── Logique de suppression d'éléments ─────────────────────────────────────────
async function reloadAllData() {
  await loadLibrary();
  await loadArtists();
  await loadAlbums();
  await loadGenres();
  await loadPlaylists();
  await loadRecents();
  await loadFavorites();
  await loadEcstasyTracks();
  await refreshPlayerState();
  refreshActiveView();
}

async function handleDeleteTrack(track: Track) {
  const { confirmed, deleteFile } = await appDeleteConfirm({
    title: "Supprimer le morceau",
    message: `Voulez-vous vraiment supprimer le morceau "${track.title}" par "${track.artist}" ?\nIl sera retiré de votre bibliothèque.`,
  });
  if (!confirmed) return;

  try {
    await invoke("delete_track", { trackId: track.id, deleteFile });

    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track?.id === track.id || state.current_track?.path === track.path) {
      await invoke("stop");
    }

    await reloadAllData();
    showAlert(`Le morceau "${track.title}" a été supprimé.`);
  } catch (err) {
    console.error("Erreur suppression morceau", err);
    await appAlert(`Échec de la suppression : ${err}`);
  }
}

async function handleRemoveFromPlaylist(playlistId: string, track: Track) {
  if (await appConfirm(`Retirer "${track.title}" de cette playlist ?`)) {
    try {
      await invoke("remove_from_playlist", { playlistId, trackId: track.id });
      const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId });
      renderTracks(tracks, playlistId);
      await loadPlaylists();
    } catch (err) {
      console.error("Erreur retrait playlist", err);
      await appAlert(`Erreur : ${err}`);
    }
  }
}

async function handleDeleteArtist(artist: ArtistSummary) {
  const count = artist.track_count || 0;
  const { confirmed, deleteFile } = await appDeleteConfirm({
    title: "Supprimer l'artiste / groupe",
    message: `Voulez-vous vraiment supprimer l'artiste / groupe "${artist.artist}" (${count} morceau(x)) ?\nTous les morceaux associés seront retirés de votre bibliothèque.`,
  });
  if (!confirmed) return;

  try {
    const deletedCount = await invoke<number>("delete_artist", { artistName: artist.artist, deleteFiles: deleteFile });

    const state = await invoke<PlayerState>("get_player_state");
    if (
      state.current_track &&
      (state.current_track.artist.toLowerCase() === artist.artist.toLowerCase() ||
        state.current_track.album_artist.toLowerCase() === artist.artist.toLowerCase())
    ) {
      await invoke("stop");
    }

    await reloadAllData();
    showAlert(`L'artiste "${artist.artist}" et ${deletedCount} morceau(x) ont été supprimés.`);
  } catch (err) {
    console.error("Erreur suppression artiste", err);
    await appAlert(`Échec de la suppression de l'artiste : ${err}`);
  }
}

async function handleDeleteAlbum(album: AlbumSummary) {
  const count = album.track_count || 0;
  const { confirmed, deleteFile } = await appDeleteConfirm({
    title: "Supprimer l'album",
    message: `Voulez-vous vraiment supprimer l'album "${album.album}" par "${album.album_artist}" (${count} morceau(x)) ?`,
  });
  if (!confirmed) return;

  try {
    const deletedCount = await invoke<number>("delete_album", {
      albumName: album.album,
      artistName: album.album_artist || null,
      deleteFiles: deleteFile,
    });

    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track && state.current_track.album.toLowerCase() === album.album.toLowerCase()) {
      await invoke("stop");
    }

    await reloadAllData();
    showAlert(`L'album "${album.album}" et ${deletedCount} morceau(x) ont été supprimés.`);
  } catch (err) {
    console.error("Erreur suppression album", err);
    await appAlert(`Échec de la suppression de l'album : ${err}`);
  }
}

async function handleDeleteGenre(genreName: string, tracksCount: number) {
  const countText = tracksCount > 0 ? ` (${tracksCount} morceau(x))` : "";
  const { confirmed, deleteFile } = await appDeleteConfirm({
    title: "Supprimer le genre",
    message: `Voulez-vous vraiment supprimer le genre "${genreName}"${countText} ?\nTous les morceaux associés à ce genre seront retirés de votre bibliothèque.`,
  });
  if (!confirmed) return;

  try {
    const deletedCount = await invoke<number>("delete_genre", { genreName, deleteFiles: deleteFile });

    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track && state.current_track.genre.toLowerCase() === genreName.toLowerCase()) {
      await invoke("stop");
    }

    await reloadAllData();
    showAlert(`Le genre "${genreName}" et ${deletedCount} morceau(x) ont été supprimés.`);
  } catch (err) {
    console.error("Erreur suppression genre", err);
    await appAlert(`Échec de la suppression du genre : ${err}`);
  }
}

async function handleDeletePlaylist(playlistId: string, playlistName?: string) {
  if (playlistId === "system_liked_tracks" || playlistId === "liked") {
    showToast("Les playlists système ne peuvent pas être supprimées.", "warning");
    return;
  }
  const nameToDisplay = playlistName || "cette playlist";
  if (await appConfirm(`Voulez-vous vraiment supprimer la playlist "${nameToDisplay}" ?`)) {
    try {
      await invoke("delete_playlist", { playlistId });
      showToast(`Playlist "${nameToDisplay}" supprimée.`, "success");
      await loadPlaylists();
      switchView("playlists");
    } catch (err) {
      console.error("Erreur suppression playlist :", err);
      showToast("Impossible de supprimer la playlist.", "error");
    }
  }
}

// ── Événements de démarrage & Abonnements ────────────────────────────────────
function bindGlobalEvents() {
  initConsoleInterceptors();
  initCollapsibleSections();
  initSettingsEvents();
  initDebugLogEvents();
  initContextMenuGlobalEvents();
  bindAlgoFeedbackButtons();

  setupMetadataModalEvents(applyTrackUpdate, handleDeleteTrack);
  setupAlbumModalEvents(fetchOnlineMetadata, async () => { await loadLibrary(); await loadAlbums(); }, handleDeleteAlbum);
  setupArtistModalEvents(loadArtists, handleDeleteArtist);
  setupGenreModalEvents(async () => { await loadLibrary(); loadGenres(); }, (genreName) => handleDeleteGenre(genreName, 0));
  initRadioEvents();
  initDownloaderEvents();

  $("btn-nav-back")?.addEventListener("click", goNavBack);
  $("btn-nav-forward")?.addEventListener("click", goNavForward);
  $("search")?.addEventListener("input", handleSearchInput);

  $("btn-import")?.addEventListener("click", async () => {
    const selected = await open({ directory: true, multiple: false, title: "Sélectionner un dossier de musique" });
    if (selected && typeof selected === "string") {
      showAlert("Analyse et importation du dossier en cours...");
      await invoke("scan_folder", { path: selected });
      await loadLibrary();
      showAlert("Importation terminée !");
    }
  });

  $("btn-new-playlist")?.addEventListener("click", async () => {
    const name = await appPrompt("Nom de la nouvelle playlist :");
    if (name && name.trim()) {
      await invoke("create_playlist", { name: name.trim() });
      await loadPlaylists();
    }
  });

  $("btn-new-playlist-page")?.addEventListener("click", async () => {
    const name = await appPrompt("Nom de la nouvelle playlist :");
    if (name && name.trim()) {
      await invoke("create_playlist", { name: name.trim() });
      await loadPlaylists();
    }
  });

  // Actions de transport principal
  $("btn-play")?.addEventListener("click", async () => {
    const activeRadio = getActiveRadio();
    const radioAudioEl = getRadioAudioEl();
    if (activeRadio && radioAudioEl && radioAudioEl.src) {
      if (radioAudioEl.paused) {
        radioAudioEl.play().catch(() => {});
      } else {
        radioAudioEl.pause();
      }
      await refreshPlayerState();
      return;
    }

    try {
      const state = await invoke<PlayerState>("get_player_state");
      if (state.is_playing) {
        await invoke("pause");
      } else {
        await invoke("resume");
      }
      await refreshPlayerState();
    } catch (err) {
      console.error("Erreur toggle play/pause", err);
    }
  });

  $("btn-next")?.addEventListener("click", async () => {
    await registerListenEventBeforeSkip();
    if (smartShuffleActive && nextSmartTrack) {
      const toPlay = nextSmartTrack;
      setNextSmartTrack(null);
      await playFromSmartTrack(toPlay);
      calculateNextSmartTrack();
    } else {
      await invoke("next_track");
      refreshPlayerState();
    }
  });

  $("btn-prev")?.addEventListener("click", async () => {
    await registerListenEventBeforeSkip();
    await invoke("prev_track");
    refreshPlayerState();
  });

  $("btn-shuffle")?.addEventListener("click", () => toggleSmartShuffle());
  $("btn-repeat")?.addEventListener("click", async () => {
    await invoke("toggle_repeat");
    refreshPlayerState();
  });

  // Action pills (Likes, Favori, Extase)
  $("btn-like-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      const res = await invoke<[number, number]>("like_track", { trackId: state.current_track.id });
      const t = allTracks.find((x) => x.id === state.current_track?.id || x.path === state.current_track?.path);
      if (t) {
        t.likes = res[0];
        t.dislikes = res[1];
      }
      await refreshPlayerState();
      refreshActiveView();
    }
  });

  $("btn-dislike-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      const res = await invoke<[number, number]>("dislike_track", { trackId: state.current_track.id });
      const t = allTracks.find((x) => x.id === state.current_track?.id || x.path === state.current_track?.path);
      if (t) {
        t.likes = res[0];
        t.dislikes = res[1];
      }
      await refreshPlayerState();
      refreshActiveView();
    }
  });

  $("btn-fav-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      const isFav = await invoke<boolean>("toggle_favorite", { targetType: "track", targetId: state.current_track.id });
      const t = allTracks.find((x) => x.id === state.current_track?.id || x.path === state.current_track?.path);
      if (t) t.is_favorite = isFav;
      await refreshPlayerState();
      refreshActiveView();
    }
  });

  $("btn-ecstasy-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      const isExt = await invoke<boolean>("toggle_ecstasy", { trackId: state.current_track.id });
      const t = allTracks.find((x) => x.id === state.current_track?.id || x.path === state.current_track?.path);
      if (t) t.is_ecstasy = isExt;
      await refreshPlayerState();
      refreshActiveView();
    }
  });

  setupLyricsModalEvents();

  $("btn-lyrics-now")?.addEventListener("click", () => {
    toggleLyricsPopover();
  });

  $("btn-show-lyrics")?.addEventListener("click", () => {
    toggleLyricsPopover();
  });

  // Barre de recherche et saut temporel
  const seekBar = $<HTMLInputElement>("seek");
  if (seekBar) {
    seekBar.addEventListener("mousedown", () => setIsSeeking(true));
    seekBar.addEventListener("input", () => {
      updateSliderTrack(seekBar);
      const timeCurrent = $("time-current");
      if (timeCurrent) {
        timeCurrent.textContent = fmtTime(parseFloat(seekBar.value));
      }
    });
    seekBar.addEventListener("change", async (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      try {
        await invoke("seek", { positionSecs: val });
      } catch (err) {
        console.error("Erreur lors de la navigation temporelle :", err);
      }
      setIsSeeking(false);
    });
  }

  const volumeBar = $<HTMLInputElement>("volume");
  if (volumeBar) {
    volumeBar.addEventListener("input", async (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value) / 100;
      await invoke("set_volume", { volume: val });
      setRadioVolume(val);
      updateSliderTrack(volumeBar);
    });
  }

  $("btn-toggle-overlay")?.addEventListener("click", openOverlayWindow);

  // Navigation dans la sidebar
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = (btn as HTMLElement).dataset.view;
      if (view) {
        switchView(view);
        if (view === "tracks") loadLibrary();
        if (view === "albums") loadAlbums();
        if (view === "artists") loadArtists();
        if (view === "genres") loadGenres();
        if (view === "tempo") loadTempo();
        if (view === "years") loadYears();
        if (view === "mood") loadMood();
        if (view === "playlists") loadPlaylists();
        if (view === "radios") loadRadios();
        if (view === "recents") loadRecents();
        if (view === "favorites") loadFavorites();
        if (view === "ecstasy") loadEcstasyTracks();
        if (view === "queue") loadQueue();
        if (view === "settings") {
          updateMissingMetadataCount();
          loadAppSettings();
          loadEqState();
          loadBackendLogs();
          loadFrontendLogs();
        }
      }
    });
  });

  // Raccourcis clavier globaux (Window)
  window.addEventListener("keydown", async (e) => {
    const target = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    if (matchShortcut(e, currentShortcutPlay)) {
      e.preventDefault();
      $("btn-play")?.click();
    } else if (matchShortcut(e, currentShortcutNext)) {
      e.preventDefault();
      $("btn-next")?.click();
    } else if (matchShortcut(e, currentShortcutPrev)) {
      e.preventDefault();
      $("btn-prev")?.click();
    } else if (matchShortcut(e, currentShortcutOverlay)) {
      e.preventDefault();
      openOverlayWindow();
    }
  });

  initOverlayEvents({
    togglePlay: async () => { $("btn-play")?.click(); },
    prevTrack: async () => { $("btn-prev")?.click(); },
    nextTrack: async () => { $("btn-next")?.click(); },
    toggleShuffle: () => toggleSmartShuffle(),
    toggleRepeat: async () => { await invoke("toggle_repeat"); refreshPlayerState(); },
    toggleFavCurrent: async () => { $("btn-fav-now")?.click(); },
    toggleEcstasyCurrent: async () => { $("btn-ecstasy-now")?.click(); },
    setVolume: async (val) => { await invoke("set_volume", { volume: val }); },
  });
}

// ── Initialisation globale de l'application ─────────────────────────────────
async function init() {
  bindGlobalEvents();

  if (!isOverlayWindowInstance) {
    await loadLibrary();
    await loadPlaylists();
    await loadAudioDevices();
    await loadEqState();
    await restoreLastPlayerState();
    pollState();
  } else {
    const appEl = $("app");
    const playerBarEl = document.querySelector(".player-bar") as HTMLElement | null;
    const overlayContainerEl = $("overlay-container");

    if (appEl) {
      appEl.hidden = true;
      appEl.style.display = "none";
    }
    if (playerBarEl) {
      playerBarEl.hidden = true;
      playerBarEl.style.display = "none";
    }
    if (overlayContainerEl) {
      overlayContainerEl.hidden = false;
      overlayContainerEl.style.display = "flex";
    }
    document.body.classList.add("overlay-window");
    document.body.style.background = "transparent";
    pollState();
  }
}

document.addEventListener("DOMContentLoaded", init);
