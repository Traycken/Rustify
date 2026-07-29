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
import type { PlayerState, Radio } from "./types";

import { initConsoleInterceptors, loadBackendLogs, loadFrontendLogs, initDebugLogEvents } from "./utils/logger";
import { appPrompt, appConfirm, appAlert, showAlert } from "./utils/dialog";
import { updateSliderTrack, fmtTime } from "./utils/formatting";
import { switchView, pushNavState, setNavCallbacks, initCollapsibleSections, goNavBack, goNavForward } from "./utils/navigation";

import { openGenericContextMenu, hideContextMenu, setContextMenuCallbacks, initContextMenuGlobalEvents } from "./modals/contextMenu";
import { openMetadataModal, closeMetadataModal, setupMetadataModalEvents, fetchOnlineMetadata, runAdvancedEnrichment, enrichLibraryInBatch } from "./modals/trackModal";
import { openAlbumModal, closeAlbumModal, setupAlbumModalEvents } from "./modals/albumModal";
import { openArtistModal, closeArtistModal, setupArtistModalEvents, enrichArtistPhotosInBatch } from "./modals/artistModal";
import { openGenreModal, setupGenreModalEvents } from "./modals/genreModal";

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
} from "./player/playerEngine";

import { loadLibrary, renderTracks, renderTracksInContainer, updateMissingMetadataCount, setTracksTabCallbacks, filterBySimilarTrack } from "./tabs/tracksTab";
import { loadAlbums, renderAlbumsGrid, filterByAlbum, setAlbumsTabCallbacks } from "./tabs/albumsTab";
import { loadArtists, renderArtistsGrid, openArtistView, openArtistByName, isArtistGroup, setArtistsTabCallbacks } from "./tabs/artistsTab";
import { loadGenres, filterByGenre, parseGenres, setGenresTabCallbacks } from "./tabs/genresTab";
import { loadTempo, filterByTempo, setTempoTabCallbacks } from "./tabs/tempoTab";
import { loadPlaylists, setPlaylistsTabCallbacks } from "./tabs/playlistsTab";
import { loadRadios, playRadio, initRadioEvents, getActiveRadio, getRadioAudioEl, syncRadioAudioDevice } from "./tabs/radiosTab";
import { loadRecents, setRecentsTabCallbacks } from "./tabs/recentsTab";
import { loadFavorites, setFavoritesTabCallbacks } from "./tabs/favoritesTab";
import { loadEcstasyTracks, setEcstasyTabCallbacks } from "./tabs/ecstasyTab";
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
  loadAlbums,
  loadArtists,
  loadGenres,
  loadTempo,
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
    await invoke("toggle_favorite", { targetType: "track", targetId: track.id });
    await loadLibrary();
    await refreshPlayerState();
  },
  toggleEcstasyTrack: async (track) => {
    await invoke("toggle_ecstasy", { trackId: track.id });
    await loadLibrary();
    await refreshPlayerState();
  },
  likeTrack: async (track) => {
    await invoke("add_like", { trackId: track.id, isLike: true });
    await loadLibrary();
    await refreshPlayerState();
  },
  dislikeTrack: async (track) => {
    await invoke("add_like", { trackId: track.id, isLike: false });
    await loadLibrary();
    await refreshPlayerState();
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
  deletePlaylist: async (playlistId) => {
    if (await appConfirm("Supprimer cette playlist ?")) {
      await invoke("delete_playlist", { playlistId });
      await loadPlaylists();
    }
  },
  openTrackInfoModal: (track) => openMetadataModal(track, async () => { await loadLibrary(); }),
  filterByGenre,
  loadPlaylists,
  isArtistGroup,
});

setTracksTabCallbacks({
  openArtistByName,
  filterByAlbum,
  playFromQueue,
  openGenericContextMenu,
  reloadFavorites: async () => { await loadFavorites(); },
  reloadEcstasy: async () => { await loadEcstasyTracks(); },
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

setPlaylistsTabCallbacks({
  switchView,
  renderTracks,
  openGenericContextMenu,
});

setRecentsTabCallbacks({
  playFromQueue,
  openGenericContextMenu,
});

setFavoritesTabCallbacks({
  renderTracksInContainer,
  renderAlbumsGrid,
  renderArtistsGrid,
});

setEcstasyTabCallbacks({
  renderTracksInContainer,
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
  get activeRadio() { return getActiveRadio(); },
  get radioAudioEl() { return getRadioAudioEl(); },
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

// ── Événements de démarrage & Abonnements ────────────────────────────────────
function bindGlobalEvents() {
  initConsoleInterceptors();
  initCollapsibleSections();
  initSettingsEvents();
  initDebugLogEvents();
  initContextMenuGlobalEvents();

  setupMetadataModalEvents(async () => { await loadLibrary(); });
  setupAlbumModalEvents(fetchOnlineMetadata, async () => { await loadLibrary(); await loadAlbums(); });
  setupArtistModalEvents(loadArtists);
  setupGenreModalEvents(async () => { await loadLibrary(); loadGenres(); });
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
      if (!radioAudioEl.paused) radioAudioEl.pause();
      else await radioAudioEl.play();
      refreshPlayerState();
      return;
    }
    const state = await invoke<PlayerState>("get_player_state");
    if (state.is_playing) await invoke("pause");
    else await invoke("resume");
    refreshPlayerState();
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
      await invoke("add_like", { trackId: state.current_track.id, isLike: true });
      refreshPlayerState();
    }
  });

  $("btn-dislike-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      await invoke("add_like", { trackId: state.current_track.id, isLike: false });
      refreshPlayerState();
    }
  });

  $("btn-fav-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      await invoke("toggle_favorite", { targetType: "track", targetId: state.current_track.id });
      refreshPlayerState();
    }
  });

  $("btn-ecstasy-now")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      await invoke("toggle_ecstasy", { trackId: state.current_track.id });
      refreshPlayerState();
    }
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
