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
  renderTracks: (tracks: Track[]) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
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

        playlistsCallbacks.renderTracks?.(tracks);
      });
      li.addEventListener("contextmenu", (e) => {
        playlistsCallbacks.openGenericContextMenu?.(e, { type: "playlist", playlistId: p.id, playlistName: p.name });
      });
      list.appendChild(li);
    });
  }

  const grid = $("grid-playlists");
  const emptyState = $("empty-playlists");
  if (grid && emptyState) {
    grid.innerHTML = "";
    emptyState.hidden = playlists.length > 0;
    playlists.forEach((p) => {
      const isSys = p.is_system || p.id === "system_liked_tracks";
      const card = document.createElement("div");
      card.className = "genre-card" + (isSys ? " system-playlist-card" : "");
      if (isSys) {
        card.style.borderLeft = "4px solid #ff6b6b";
      }
      card.innerHTML = `
        <div class="genre-title">
          ${isSys ? '<i class="fa-solid fa-heart" style="color: #ff6b6b; margin-right: 6px;"></i>' : ''}${escapeHtml(p.name)}
        </div>
        <div class="genre-count">${p.track_count} morceau(x)${isSys ? ' · Auto-remplie' : ''}</div>
        <i class="${isSys ? 'fa-solid fa-heart' : 'fa-solid fa-list-ul'} genre-bg-icon" ${isSys ? 'style="color: rgba(255, 107, 107, 0.18);"' : ''}></i>
      `;
      card.addEventListener("click", async () => {
        const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId: p.id });
        playlistsCallbacks.switchView?.("tracks");

        const viewTitle = $("view-title");
        if (viewTitle) viewTitle.textContent = p.name;

        playlistsCallbacks.renderTracks?.(tracks);
      });
      card.addEventListener("contextmenu", (e) => {
        playlistsCallbacks.openGenericContextMenu?.(e, { type: "playlist", playlistId: p.id, playlistName: p.name });
      });
      grid.appendChild(card);
    });
  }
}
