/**
 * ============================================================================
 * Rustify — Vue Albums (src/tabs/albumsTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'affichage des albums en grille, le filtrage des morceaux
 * par album et l'édition/favoris des albums.
 * 
 * Sommaire des exportations :
 * - loadAlbums() : Charge et affiche la grille des albums.
 * - renderAlbumsGrid(albums, container) : Génère les cartes d'albums en grille.
 * - filterByAlbum(albumName, albumArtist) : Affiche la liste des titres d'un album.
 * - setAlbumsTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, allTracks, getCoverDataUrl } from "../state";
import type { AlbumSummary, Track, ContextTarget, NavState } from "../types";
import { escapeHtml } from "../utils/formatting";

export interface AlbumsTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
  pushNavState: (state: NavState) => void;
  openAlbumModal: (album: AlbumSummary) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
}

let albumsCallbacks: Partial<AlbumsTabCallbacks> = {};

export function setAlbumsTabCallbacks(callbacks: Partial<AlbumsTabCallbacks>) {
  albumsCallbacks = { ...albumsCallbacks, ...callbacks };
}

export function filterByAlbum(albumName: string, albumArtist: string) {
  const normAlbum = albumName.trim().toLowerCase();
  const normArtist = albumArtist.trim().toLowerCase();
  const tracks = allTracks.filter(
    (t) =>
      t.album.trim().toLowerCase() === normAlbum &&
      (t.album_artist.trim().toLowerCase() === normArtist ||
       t.artist.trim().toLowerCase() === normArtist)
  );

  albumsCallbacks.switchView?.("tracks");

  const artistHeader = $("artist-header");
  if (artistHeader) {
    artistHeader.hidden = true;
    artistHeader.style.display = "none";
  }

  const viewTitle = $("view-title");
  if (viewTitle) viewTitle.textContent = `Album : ${albumName}`;

  albumsCallbacks.renderTracks?.(tracks);

  const searchInput = $<HTMLInputElement>("search");
  albumsCallbacks.pushNavState?.({
    type: "album",
    view: "tracks",
    albumName,
    albumArtist,
    searchQuery: searchInput ? searchInput.value : "",
  });
}

export async function renderAlbumsGrid(albums: AlbumSummary[], container: HTMLElement) {
  container.innerHTML = "";
  for (const a of albums) {
    const card = document.createElement("div");
    card.className = "grid-card";
    const isFav = !!a.is_favorite;
    const coverUrl = await getCoverDataUrl(a.cover_path);
    const coverHtml = coverUrl
      ? `<img src="${coverUrl}" class="cover-img" alt="${escapeHtml(a.album)}" />`
      : `<div class="cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div>`;
    card.innerHTML = `
      <button class="card-fav-btn ${isFav ? "is-fav" : ""}" title="Favori">
        <i class="${isFav ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i>
      </button>
      <button class="album-edit-btn" title="Éditer l'album"><i class="fa-solid fa-pen"></i></button>
      ${coverHtml}
      <div class="title">${escapeHtml(a.album)}</div>
      <div class="subtitle">${escapeHtml(a.album_artist)} · ${a.year || "—"}</div>
    `;

    card.querySelector(".album-edit-btn")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      albumsCallbacks.openAlbumModal?.(a);
    });

    const favBtn = card.querySelector(".card-fav-btn");
    favBtn?.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const key = `${a.album}::${a.album_artist}`;
      const newFav = await invoke<boolean>("toggle_favorite", { targetType: "album", targetId: key });
      a.is_favorite = newFav;
      favBtn.classList.toggle("is-fav", newFav);
      const icon = favBtn.querySelector("i");
      if (icon) icon.className = newFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
    });

    card.addEventListener("click", () => {
      filterByAlbum(a.album, a.album_artist);
    });

    card.addEventListener("contextmenu", (e) => {
      albumsCallbacks.openGenericContextMenu?.(e, { type: "album", album: a });
    });

    container.appendChild(card);
  }
}

export async function loadAlbums() {
  const container = $("view-albums");
  if (!container) return;
  const albums = await invoke<AlbumSummary[]>("get_albums");
  await renderAlbumsGrid(albums, container);
}
