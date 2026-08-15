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

let albumsRenderToken = 0;

export function renderAlbumsGrid(albums: AlbumSummary[], container: HTMLElement) {
  const token = ++albumsRenderToken;
  container.innerHTML = "";
  let index = 0;

  const renderChunk = () => {
    if (token !== albumsRenderToken) return;
    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(index + 30, albums.length);
    for (; index < endIndex; index++) {
      const a = albums[index];
      const card = document.createElement("div");
      card.className = "grid-card";
      const isFav = !!a.is_favorite;
      card.innerHTML = `
        <button class="card-fav-btn ${isFav ? "is-fav" : ""}" title="Favori">
          <i class="${isFav ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i>
        </button>
        <button class="album-edit-btn" title="Éditer l'album"><i class="fa-solid fa-pen"></i></button>
        <div class="cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div>
        <div class="title">${escapeHtml(a.album)}</div>
        <div class="subtitle">${escapeHtml(a.album_artist)} · ${a.year || "—"}</div>
      `;

      if (a.cover_path) {
        getCoverDataUrl(a.cover_path).then((coverUrl) => {
          if (token !== albumsRenderToken || !coverUrl || !card.isConnected) return;
          card.querySelector(".cover-placeholder")?.replaceWith(Object.assign(document.createElement("img"), {
            src: coverUrl, className: "cover-img", alt: a.album,
          }));
        });
      }

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
      card.addEventListener("click", () => filterByAlbum(a.album, a.album_artist));
      card.addEventListener("contextmenu", (e) => {
        albumsCallbacks.openGenericContextMenu?.(e, { type: "album", album: a });
      });
      fragment.appendChild(card);
    }
    container.appendChild(fragment);
    if (index < albums.length) requestAnimationFrame(renderChunk);
  };
  requestAnimationFrame(renderChunk);
}
export async function loadAlbums() {
  const container = $("view-albums");
  if (!container) return;
  const albums = await invoke<AlbumSummary[]>("get_albums");
  renderAlbumsGrid(albums, container);
}
