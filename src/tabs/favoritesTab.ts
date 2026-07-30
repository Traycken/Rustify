/**
 * ============================================================================
 * Rustify — Vue Favoris (src/tabs/favoritesTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module regroupe et sépare proprement les éléments marqués comme favoris / aimés / non aimés :
 * - Titres (Favoris ⭐, Likes 👍, Dislikes 👎)
 * - Albums Favoris 💿
 * - Artistes Solo Favoris 👤
 * - Groupes Favoris 👥
 * - Playlists Créées 📜
 * 
 * Sommaire des exportations :
 * - loadFavorites() : Charge et affiche les sous-sections de favoris.
 * - setFavoritesTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, allTracks } from "../state";
import type { FavoritesData, AlbumSummary, ArtistSummary, Track, Playlist } from "../types";
import { isArtistGroup } from "./artistsTab";
import { escapeHtml } from "../utils/formatting";

export interface FavoritesTabCallbacks {
  renderTracksInContainer: (tracks: Track[], container: HTMLElement) => void;
  renderAlbumsGrid: (albums: AlbumSummary[], container: HTMLElement) => Promise<void>;
  renderArtistsGrid: (artists: ArtistSummary[], container: HTMLElement) => Promise<void>;
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
}

let favoritesCallbacks: Partial<FavoritesTabCallbacks> = {};
let currentTrackFilter: "stars" | "likes" | "dislikes" = "stars";
let favTracksData: Track[] = [];
let eventsInitialized = false;

export function setFavoritesTabCallbacks(callbacks: Partial<FavoritesTabCallbacks>) {
  favoritesCallbacks = { ...favoritesCallbacks, ...callbacks };
}

export async function loadFavorites() {
  try {
    setupFavTrackFilterEvents();
    const data = await invoke<FavoritesData>("get_favorites");
    favTracksData = data.tracks;

    renderTrackSection();

    // 1. Albums Favoris
    const gridAlbums = $("grid-fav-albums");
    const emptyAlbums = $("empty-fav-albums");
    if (gridAlbums && emptyAlbums) {
      if (data.albums.length === 0) {
        gridAlbums.innerHTML = "";
        emptyAlbums.hidden = false;
      } else {
        emptyAlbums.hidden = true;
        if (favoritesCallbacks.renderAlbumsGrid) await favoritesCallbacks.renderAlbumsGrid(data.albums, gridAlbums);
      }
    }

    // 2. Artistes Solo vs Groupes Favoris
    const favSoloArtists = data.artists.filter((a) => !isArtistGroup(a));
    const favGroupArtists = data.artists.filter((a) => isArtistGroup(a));

    const gridSolo = $("grid-fav-solo-artists");
    const emptySolo = $("empty-fav-solo-artists");
    if (gridSolo && emptySolo) {
      if (favSoloArtists.length === 0) {
        gridSolo.innerHTML = "";
        emptySolo.hidden = false;
      } else {
        emptySolo.hidden = true;
        if (favoritesCallbacks.renderArtistsGrid) await favoritesCallbacks.renderArtistsGrid(favSoloArtists, gridSolo);
      }
    }

    const gridGroup = $("grid-fav-group-artists");
    const emptyGroup = $("empty-fav-group-artists");
    if (gridGroup && emptyGroup) {
      if (favGroupArtists.length === 0) {
        gridGroup.innerHTML = "";
        emptyGroup.hidden = false;
      } else {
        emptyGroup.hidden = true;
        if (favoritesCallbacks.renderArtistsGrid) await favoritesCallbacks.renderArtistsGrid(favGroupArtists, gridGroup);
      }
    }

    // 3. Playlists Créées (Personnalisées)
    const playlists = await invoke<Playlist[]>("get_playlists");
    const createdPlaylists = playlists.filter((p) => !p.is_system && p.id !== "system_liked_tracks");

    const gridPlaylists = $("grid-fav-playlists");
    const emptyPlaylists = $("empty-fav-playlists");
    if (gridPlaylists && emptyPlaylists) {
      gridPlaylists.innerHTML = "";
      if (createdPlaylists.length === 0) {
        emptyPlaylists.hidden = false;
      } else {
        emptyPlaylists.hidden = true;
        createdPlaylists.forEach((p) => {
          const card = document.createElement("div");
          card.className = "genre-card";
          card.innerHTML = `
            <div class="genre-title">
              <i class="fa-solid fa-list-ul" style="color: #e67e22; margin-right: 6px;"></i>${escapeHtml(p.name)}
            </div>
            <div class="genre-count">${p.track_count} morceau(x)</div>
            <i class="fa-solid fa-list-ul genre-bg-icon"></i>
          `;
          card.addEventListener("click", async () => {
            const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId: p.id });
            favoritesCallbacks.switchView?.("tracks");

            const viewTitle = $("view-title");
            if (viewTitle) viewTitle.textContent = p.name;

            favoritesCallbacks.renderTracks?.(tracks, p.id);
          });
          gridPlaylists.appendChild(card);
        });
      }
    }
  } catch (err) {
    console.error("Erreur chargement favoris :", err);
  }
}

function renderTrackSection() {
  const tracksTbody = $("fav-tracks-tbody");
  const emptyTracks = $("empty-fav-tracks");
  if (!tracksTbody || !emptyTracks) return;

  let tracksToRender: Track[] = [];
  if (currentTrackFilter === "stars") {
    tracksToRender = favTracksData;
    emptyTracks.textContent = "Aucun titre favori ⭐ pour le moment.";
  } else if (currentTrackFilter === "likes") {
    tracksToRender = allTracks.filter((t) => (t.likes || 0) > 0);
    emptyTracks.textContent = "Aucun titre aimé 👍 pour le moment.";
  } else if (currentTrackFilter === "dislikes") {
    tracksToRender = allTracks.filter((t) => (t.dislikes || 0) > 0);
    emptyTracks.textContent = "Aucun titre non aimé 👎 pour le moment.";
  }

  if (tracksToRender.length === 0) {
    tracksTbody.innerHTML = "";
    emptyTracks.hidden = false;
  } else {
    emptyTracks.hidden = true;
    favoritesCallbacks.renderTracksInContainer?.(tracksToRender, tracksTbody);
  }
}

function setupFavTrackFilterEvents() {
  if (eventsInitialized) return;
  eventsInitialized = true;

  const btnStars = $("btn-fav-filter-stars");
  const btnLikes = $("btn-fav-filter-likes");
  const btnDislikes = $("btn-fav-filter-dislikes");

  const updateButtons = (activeFilter: "stars" | "likes" | "dislikes") => {
    currentTrackFilter = activeFilter;
    if (btnStars) btnStars.className = activeFilter === "stars" ? "btn-primary active-subtab" : "btn-secondary";
    if (btnLikes) btnLikes.className = activeFilter === "likes" ? "btn-primary active-subtab" : "btn-secondary";
    if (btnDislikes) btnDislikes.className = activeFilter === "dislikes" ? "btn-primary active-subtab" : "btn-secondary";
    renderTrackSection();
  };

  btnStars?.addEventListener("click", () => updateButtons("stars"));
  btnLikes?.addEventListener("click", () => updateButtons("likes"));
  btnDislikes?.addEventListener("click", () => updateButtons("dislikes"));
}

