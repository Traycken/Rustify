/**
 * ============================================================================
 * Rustify — Vue Favoris (src/tabs/favoritesTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module regroupe les éléments marqués comme favoris (titres ⭐, albums et artistes).
 * 
 * Sommaire des exportations :
 * - loadFavorites() : Charge et affiche les sous-sections de favoris.
 * - setFavoritesTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $ } from "../state";
import type { FavoritesData, AlbumSummary, ArtistSummary, Track } from "../types";

export interface FavoritesTabCallbacks {
  renderTracksInContainer: (tracks: Track[], container: HTMLElement) => void;
  renderAlbumsGrid: (albums: AlbumSummary[], container: HTMLElement) => Promise<void>;
  renderArtistsGrid: (artists: ArtistSummary[], container: HTMLElement) => Promise<void>;
}

let favoritesCallbacks: Partial<FavoritesTabCallbacks> = {};

export function setFavoritesTabCallbacks(callbacks: Partial<FavoritesTabCallbacks>) {
  favoritesCallbacks = { ...favoritesCallbacks, ...callbacks };
}

export async function loadFavorites() {
  try {
    const data = await invoke<FavoritesData>("get_favorites");

    const tracksTbody = $("fav-tracks-tbody");
    const emptyTracks = $("empty-fav-tracks");
    if (tracksTbody && emptyTracks) {
      if (data.tracks.length === 0) {
        tracksTbody.innerHTML = "";
        emptyTracks.hidden = false;
      } else {
        emptyTracks.hidden = true;
        favoritesCallbacks.renderTracksInContainer?.(data.tracks, tracksTbody);
      }
    }

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

    const gridArtists = $("grid-fav-artists");
    const emptyArtists = $("empty-fav-artists");
    if (gridArtists && emptyArtists) {
      if (data.artists.length === 0) {
        gridArtists.innerHTML = "";
        emptyArtists.hidden = false;
      } else {
        emptyArtists.hidden = true;
        if (favoritesCallbacks.renderArtistsGrid) await favoritesCallbacks.renderArtistsGrid(data.artists, gridArtists);
      }
    }
  } catch (err) {
    console.error("Erreur chargement favoris :", err);
  }
}
