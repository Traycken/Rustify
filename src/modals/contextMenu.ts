/**
 * ============================================================================
 * Rustify — Menu Contextuel (src/modals/contextMenu.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère le menu contextuel apparu lors d'un clic droit sur un morceau,
 * un album, un artiste, un genre ou une playlist.
 * 
 * Sommaire des exportations :
 * - openGenericContextMenu(e, target) : Ouvre le menu contextuel à la position du curseur.
 * - hideContextMenu() : Masque le menu contextuel.
 * - getActiveCtxTarget() : Retourne l'élément cible actif du menu.
 * - setContextMenuCallbacks(callbacks) : Enregistre les gestionnaires d'actions du menu contextuel.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $ } from "../state";
import type { ContextTarget, Playlist, Track, AlbumSummary, ArtistSummary } from "../types";

export interface ContextMenuCallbacks {
  playTrackTarget: (target: ContextTarget) => void;
  addToQueueTarget: (target: ContextTarget) => void;
  filterByArtist: (artistName: string) => void;
  filterByAlbum: (albumName: string, artistName: string) => void;
  filterBySimilar: (track: Track) => void;
  toggleFavTrack: (track: Track) => void;
  toggleEcstasyTrack: (track: Track) => void;
  likeTrack: (track: Track) => void;
  dislikeTrack: (track: Track) => void;
  openAlbumModal: (album: AlbumSummary) => void;
  openArtistModal: (artist: ArtistSummary) => void;
  fetchArtistPhoto: (artistName: string) => void;
  toggleArtistType: (artist: ArtistSummary) => void;
  openGenreModal: (genreName: string) => void;
  filterByGenre: (genreName: string) => void;
  renamePlaylist: (playlistId: string, oldName: string) => void;
  deletePlaylist: (playlistId: string) => void;
  openTrackInfoModal: (track: Track) => void;
  loadPlaylists: () => void;
  isArtistGroup: (artist: ArtistSummary) => boolean;
}

let activeCtxTarget: ContextTarget | null = null;
let ctxCallbacks: Partial<ContextMenuCallbacks> = {};

export function getActiveCtxTarget(): ContextTarget | null {
  return activeCtxTarget;
}

export function setContextMenuCallbacks(callbacks: Partial<ContextMenuCallbacks>) {
  ctxCallbacks = { ...ctxCallbacks, ...callbacks };
}

export function hideContextMenu() {
  const contextMenu = $("context-menu");
  if (contextMenu) {
    contextMenu.hidden = true;
    contextMenu.style.display = "none";
  }
}

export async function openGenericContextMenu(e: MouseEvent, target: ContextTarget) {
  e.preventDefault();
  activeCtxTarget = target;

  const contextMenu = $("context-menu");
  const ctxPlaylistSubmenu = $("ctx-playlist-submenu");
  if (!contextMenu || !ctxPlaylistSubmenu) return;

  const ctxPlay = $("ctx-play");
  const ctxAddQueue = $("ctx-add-queue");
  const ctxDiv1 = $("ctx-div-1");
  const ctxPlaylistItem = $("ctx-playlist-item");
  const ctxDiv2 = $("ctx-div-2");
  const ctxFilterArtist = $("ctx-filter-artist");
  const ctxFilterAlbum = $("ctx-filter-album");
  const ctxFilterSimilar = $("ctx-filter-similar");
  const ctxDiv3 = $("ctx-div-3");
  const ctxEditAlbum = $("ctx-edit-album");
  const ctxEditArtist = $("ctx-edit-artist");
  const ctxFetchArtistPhoto = $("ctx-fetch-artist-photo");
  const ctxToggleArtistType = $("ctx-toggle-artist-type");
  const ctxRenameGenre = $("ctx-rename-genre");
  const ctxRenamePlaylist = $("ctx-rename-playlist");
  const ctxDeletePlaylist = $("ctx-delete-playlist");
  const ctxInfo = $("ctx-info");

  if (ctxPlay) ctxPlay.hidden = false;
  if (ctxAddQueue) ctxAddQueue.hidden = false;
  if (ctxDiv1) ctxDiv1.hidden = false;
  if (ctxPlaylistItem) ctxPlaylistItem.hidden = target.type !== "track";
  if (ctxDiv2) ctxDiv2.hidden = false;

  if (ctxEditAlbum) ctxEditAlbum.hidden = target.type !== "album";
  if (ctxEditArtist) ctxEditArtist.hidden = target.type !== "artist";
  if (ctxFetchArtistPhoto) ctxFetchArtistPhoto.hidden = target.type !== "artist";
  if (ctxToggleArtistType) {
    ctxToggleArtistType.hidden = target.type !== "artist";
    if (target.artist && ctxCallbacks.isArtistGroup) {
      const isGrp = ctxCallbacks.isArtistGroup(target.artist);
      ctxToggleArtistType.innerHTML = `<span class="menu-icon"><i class="fa-solid fa-arrows-rotate"></i></span> Définir comme ${isGrp ? "Artiste Solo" : "Groupe / Band"}`;
    }
  }
  const isSystemPlaylist = target.type === "playlist" && (target.playlistId === "system_liked_tracks" || target.playlistId === "liked");
  if (ctxRenamePlaylist) ctxRenamePlaylist.hidden = target.type !== "playlist" || isSystemPlaylist;
  if (ctxDeletePlaylist) ctxDeletePlaylist.hidden = target.type !== "playlist" || isSystemPlaylist;

  const ctxToggleEcstasy = $("ctx-toggle-ecstasy");
  if (ctxToggleEcstasy) {
    ctxToggleEcstasy.hidden = target.type !== "track";
    if (target.track) {
      const isExt = !!target.track.is_ecstasy;
      ctxToggleEcstasy.innerHTML = `<span class="menu-icon"><i class="fa-${isExt ? 'solid' : 'regular'} fa-heart" style="color: #ff4757;"></i></span> ${isExt ? "Retirer d'Extase 💖" : "Marquer comme Extase 💖"}`;
    }
  }

  if (target.type === "track") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = false;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = false;
    if (ctxFilterSimilar) ctxFilterSimilar.hidden = false;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-circle-info"></i></span> Éditer métadonnées du morceau';
    }

    const playlists = await invoke<Playlist[]>("get_playlists");
    ctxPlaylistSubmenu.innerHTML = "";
    if (playlists.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "menu-item";
      emptyDiv.textContent = "(Aucune playlist)";
      emptyDiv.style.opacity = "0.5";
      ctxPlaylistSubmenu.appendChild(emptyDiv);
    } else {
      playlists.forEach((p) => {
        const item = document.createElement("div");
        item.className = "menu-item";
        item.textContent = p.name;
        item.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (target.track) {
            await invoke("add_to_playlist", { playlistId: p.id, trackId: target.track.id });
            ctxCallbacks.loadPlaylists?.();
          }
          hideContextMenu();
        });
        ctxPlaylistSubmenu.appendChild(item);
      });
    }
  } else if (target.type === "album") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = false;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxFilterSimilar) ctxFilterSimilar.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-circle-info"></i></span> Voir morceaux de l\'album';
    }
  } else if (target.type === "artist") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = true;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxFilterSimilar) ctxFilterSimilar.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-user"></i></span> Voir la fiche artiste';
    }
  } else if (target.type === "genre") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = true;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxFilterSimilar) ctxFilterSimilar.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-tags"></i></span> Voir les morceaux du genre';
    }
  } else if (target.type === "playlist") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = true;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxFilterSimilar) ctxFilterSimilar.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) ctxInfo.hidden = true;
  }

  contextMenu.style.display = "block";
  contextMenu.hidden = false;

  const menuWidth = contextMenu.offsetWidth;
  const menuHeight = contextMenu.offsetHeight;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;

  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > winWidth) x = winWidth - menuWidth - 8;
  if (y + menuHeight > winHeight) y = winHeight - menuHeight - 8;

  contextMenu.style.left = `${Math.max(0, x)}px`;
  contextMenu.style.top = `${Math.max(0, y)}px`;
}

export function initContextMenuGlobalEvents() {
  document.addEventListener("click", hideContextMenu);
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".context-menu") && !target.closest("tr") && !target.closest(".card")) {
      hideContextMenu();
    }
  });

  $("ctx-play")?.addEventListener("click", () => {
    if (activeCtxTarget && ctxCallbacks.playTrackTarget) {
      ctxCallbacks.playTrackTarget(activeCtxTarget);
    }
    hideContextMenu();
  });

  $("ctx-add-queue")?.addEventListener("click", () => {
    if (activeCtxTarget && ctxCallbacks.addToQueueTarget) {
      ctxCallbacks.addToQueueTarget(activeCtxTarget);
    }
    hideContextMenu();
  });

  $("ctx-filter-artist")?.addEventListener("click", () => {
    if (activeCtxTarget) {
      const name = activeCtxTarget.track?.artist || activeCtxTarget.album?.album_artist;
      if (name && ctxCallbacks.filterByArtist) ctxCallbacks.filterByArtist(name);
    }
    hideContextMenu();
  });

  $("ctx-filter-album")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.filterByAlbum) {
      ctxCallbacks.filterByAlbum(activeCtxTarget.track.album, activeCtxTarget.track.album_artist || activeCtxTarget.track.artist);
    }
    hideContextMenu();
  });

  $("ctx-filter-similar")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.filterBySimilar) {
      ctxCallbacks.filterBySimilar(activeCtxTarget.track);
    }
    hideContextMenu();
  });

  $("ctx-toggle-fav")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.toggleFavTrack) {
      ctxCallbacks.toggleFavTrack(activeCtxTarget.track);
    }
    hideContextMenu();
  });

  $("ctx-toggle-ecstasy")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.toggleEcstasyTrack) {
      ctxCallbacks.toggleEcstasyTrack(activeCtxTarget.track);
    }
    hideContextMenu();
  });

  $("ctx-like")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.likeTrack) {
      ctxCallbacks.likeTrack(activeCtxTarget.track);
    }
    hideContextMenu();
  });

  $("ctx-dislike")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.dislikeTrack) {
      ctxCallbacks.dislikeTrack(activeCtxTarget.track);
    }
    hideContextMenu();
  });

  $("ctx-edit-album")?.addEventListener("click", () => {
    if (activeCtxTarget?.album && ctxCallbacks.openAlbumModal) {
      ctxCallbacks.openAlbumModal(activeCtxTarget.album);
    }
    hideContextMenu();
  });

  $("ctx-edit-artist")?.addEventListener("click", () => {
    if (activeCtxTarget?.artist && ctxCallbacks.openArtistModal) {
      ctxCallbacks.openArtistModal(activeCtxTarget.artist);
    }
    hideContextMenu();
  });

  $("ctx-fetch-artist-photo")?.addEventListener("click", () => {
    if (activeCtxTarget?.artist && ctxCallbacks.fetchArtistPhoto) {
      ctxCallbacks.fetchArtistPhoto(activeCtxTarget.artist.artist);
    }
    hideContextMenu();
  });

  $("ctx-toggle-artist-type")?.addEventListener("click", () => {
    if (activeCtxTarget?.artist && ctxCallbacks.toggleArtistType) {
      ctxCallbacks.toggleArtistType(activeCtxTarget.artist);
    }
    hideContextMenu();
  });

  $("ctx-rename-genre")?.addEventListener("click", () => {
    if (activeCtxTarget?.genreName && ctxCallbacks.openGenreModal) {
      ctxCallbacks.openGenreModal(activeCtxTarget.genreName);
    }
    hideContextMenu();
  });

  $("ctx-rename-playlist")?.addEventListener("click", () => {
    if (activeCtxTarget?.playlistId && activeCtxTarget.playlistName && ctxCallbacks.renamePlaylist) {
      ctxCallbacks.renamePlaylist(activeCtxTarget.playlistId, activeCtxTarget.playlistName);
    }
    hideContextMenu();
  });

  $("ctx-delete-playlist")?.addEventListener("click", () => {
    if (activeCtxTarget?.playlistId && ctxCallbacks.deletePlaylist) {
      ctxCallbacks.deletePlaylist(activeCtxTarget.playlistId);
    }
    hideContextMenu();
  });

  $("ctx-info")?.addEventListener("click", () => {
    if (activeCtxTarget?.track && ctxCallbacks.openTrackInfoModal) {
      ctxCallbacks.openTrackInfoModal(activeCtxTarget.track);
    } else if (activeCtxTarget?.album && ctxCallbacks.filterByAlbum) {
      ctxCallbacks.filterByAlbum(activeCtxTarget.album.album, activeCtxTarget.album.album_artist);
    } else if (activeCtxTarget?.artist && ctxCallbacks.filterByArtist) {
      ctxCallbacks.filterByArtist(activeCtxTarget.artist.artist);
    } else if (activeCtxTarget?.genreName && ctxCallbacks.filterByGenre) {
      ctxCallbacks.filterByGenre(activeCtxTarget.genreName);
    }
    hideContextMenu();
  });
}
