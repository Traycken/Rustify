/**
 * ============================================================================
 * Rustify — Vue Playlists (src/tabs/playlistsTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'affichage des listes de lecture personnalisées (sidebar + vue grille),
 * la création, le renommage et la suppression de playlists.
 * 
 * Sommaire des exportations :
 * - loadPlaylists() : Charge et affiche les playlists dans la sidebar et la grille.
 * - setPlaylistsTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $ } from "../state";
import type { Playlist, Track, ContextTarget } from "../types";
import { escapeHtml } from "../utils/formatting";

export interface PlaylistsTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
  startSmartShuffleForPlaylist: (playlistId: string, playlistName?: string) => void;
  deletePlaylist: (playlistId: string, playlistName?: string) => void;
}

let playlistsCallbacks: Partial<PlaylistsTabCallbacks> = {};

export function setPlaylistsTabCallbacks(callbacks: Partial<PlaylistsTabCallbacks>) {
  playlistsCallbacks = { ...playlistsCallbacks, ...callbacks };
}

export async function loadPlaylists() {
  const playlists = await invoke<Playlist[]>("get_playlists");
  const list = $("playlist-list");
  if (list) {
    list.innerHTML = "";
    playlists.forEach((p) => {
      const li = document.createElement("li");
      const isSys = p.is_system || p.id === "system_liked_tracks";
      const iconHtml = isSys ? '<i class="fa-solid fa-heart" style="color: #ff6b6b; margin-right: 6px;"></i>' : '';
      li.innerHTML = `${iconHtml}${escapeHtml(p.name)} <span class="text-dim" style="font-size: 12px; margin-left: 4px;">(${p.track_count})</span>`;
      li.addEventListener("click", async () => {
        const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId: p.id });
        playlistsCallbacks.switchView?.("tracks");

        const viewTitle = $("view-title");
        if (viewTitle) viewTitle.textContent = p.name;

        playlistsCallbacks.renderTracks?.(tracks, p.id);
      });
      li.addEventListener("contextmenu", (e) => {
        playlistsCallbacks.openGenericContextMenu?.(e, { type: "playlist", playlistId: p.id, playlistName: p.name });
      });
      list.appendChild(li);
    });
  }

  const systemPlaylists = playlists.filter((p) => p.is_system || p.id === "system_liked_tracks");
  const createdPlaylists = playlists.filter((p) => !p.is_system && p.id !== "system_liked_tracks");

  const gridSystem = $("grid-system-playlists");
  const emptySystem = $("empty-system-playlists");
  if (gridSystem && emptySystem) {
    gridSystem.innerHTML = "";
    emptySystem.hidden = systemPlaylists.length > 0;
    systemPlaylists.forEach((p) => {
      gridSystem.appendChild(createPlaylistCard(p, true));
    });
  }

  const gridCreated = $("grid-playlists");
  const emptyCreated = $("empty-playlists");
  if (gridCreated && emptyCreated) {
    gridCreated.innerHTML = "";
    emptyCreated.hidden = createdPlaylists.length > 0;
    createdPlaylists.forEach((p) => {
      gridCreated.appendChild(createPlaylistCard(p, false));
    });
  }
}

function createPlaylistCard(p: Playlist, isSys: boolean): HTMLElement {
  const card = document.createElement("div");
  card.className = "genre-card playlist-card" + (isSys ? " system-playlist-card" : "");
  if (isSys) {
    card.style.borderLeft = "4px solid #ff6b6b";
  }
  card.innerHTML = `
    <div class="genre-title">
      ${isSys ? '<i class="fa-solid fa-heart" style="color: #ff6b6b; margin-right: 6px;"></i>' : '<i class="fa-solid fa-list-ul" style="color: var(--accent, #1db954); margin-right: 6px;"></i>'}${escapeHtml(p.name)}
    </div>
    <div class="genre-count">${p.track_count} morceau(x)${isSys ? ' · Auto-remplie' : ''}</div>
    <div class="playlist-card-actions">
      <button class="btn-card-smart-shuffle" title="Lancer le Smart Shuffle sur cette playlist">
        <i class="fa-solid fa-wand-magic-sparkles"></i> Smart Shuffle
      </button>
      ${!isSys ? `
        <button class="btn-card-delete-playlist" title="Supprimer cette playlist">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      ` : ''}
    </div>
    <i class="${isSys ? 'fa-solid fa-heart' : 'fa-solid fa-list-ul'} genre-bg-icon" ${isSys ? 'style="color: rgba(255, 107, 107, 0.18);"' : ''}></i>
  `;

  const btnSmart = card.querySelector(".btn-card-smart-shuffle");
  btnSmart?.addEventListener("click", (e) => {
    e.stopPropagation();
    playlistsCallbacks.startSmartShuffleForPlaylist?.(p.id, p.name);
  });

  const btnDelete = card.querySelector(".btn-card-delete-playlist");
  btnDelete?.addEventListener("click", (e) => {
    e.stopPropagation();
    playlistsCallbacks.deletePlaylist?.(p.id, p.name);
  });

  card.addEventListener("click", async () => {
    const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId: p.id });
    playlistsCallbacks.switchView?.("tracks");

    const viewTitle = $("view-title");
    if (viewTitle) viewTitle.textContent = p.name;

    playlistsCallbacks.renderTracks?.(tracks, p.id);
  });
  card.addEventListener("contextmenu", (e) => {
    playlistsCallbacks.openGenericContextMenu?.(e, { type: "playlist", playlistId: p.id, playlistName: p.name });
  });
  return card;
}
