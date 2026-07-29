/**
 * ============================================================================
 * Rustify — Vue Genres (src/tabs/genresTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la vue des genres musicaux, le découpage des sous-genres multiples
 * et le filtrage des morceaux par genre.
 * 
 * Sommaire des exportations :
 * - parseGenres(rawGenre) : Découpe une chaîne de genres séparés par des virgules/slashes.
 * - filterByGenre(genreName) : Filtre la bibliothèque par genre.
 * - loadGenres() : Construit et affiche la grille des genres.
 * - setGenresTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { $, allTracks } from "../state";
import type { Track, ContextTarget, NavState } from "../types";
import { escapeHtml } from "../utils/formatting";

export interface GenresTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[]) => void;
  pushNavState: (state: NavState) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
}

let genresCallbacks: Partial<GenresTabCallbacks> = {};

export function setGenresTabCallbacks(callbacks: Partial<GenresTabCallbacks>) {
  genresCallbacks = { ...genresCallbacks, ...callbacks };
}

export function parseGenres(rawGenre?: string, tags?: string[]): string[] {
  const res: string[] = [];

  if (rawGenre && rawGenre.trim()) {
    const parts = rawGenre.split(/[,/;|&\n]+/);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed && !res.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
        res.push(trimmed);
      }
    }
  }

  if (tags && Array.isArray(tags)) {
    for (const tag of tags) {
      if (!tag || !tag.trim()) continue;
      const parts = tag.split(/[,/;|&\n]+/);
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed && !res.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
          res.push(trimmed);
        }
      }
    }
  }

  return res.length > 0 ? res : ["Non spécifié"];
}

export function filterByGenre(genreName: string) {
  const normGenre = genreName.trim().toLowerCase();
  const tracks = allTracks.filter((t) => {
    const genres = parseGenres(t.genre, t.tags);
    return genres.some((g) => g.trim().toLowerCase() === normGenre);
  });

  genresCallbacks.switchView?.("tracks");

  const genreArtistHeader = $("artist-header");
  if (genreArtistHeader) {
    genreArtistHeader.hidden = true;
    genreArtistHeader.style.display = "none";
  }

  const viewTitle = $("view-title");
  if (viewTitle) viewTitle.textContent = `Genre : ${genreName}`;

  genresCallbacks.renderTracks?.(tracks);

  const searchInput = $<HTMLInputElement>("search");
  genresCallbacks.pushNavState?.({
    type: "genre",
    view: "tracks",
    genreName,
    searchQuery: searchInput ? searchInput.value : "",
  });
}

export function loadGenres() {
  const genreMap = new Map<string, Track[]>();

  for (const t of allTracks) {
    const genres = parseGenres(t.genre, t.tags);
    for (const g of genres) {
      if (!genreMap.has(g)) {
        genreMap.set(g, []);
      }
      genreMap.get(g)!.push(t);
    }
  }

  const container = $("view-genres");
  if (!container) return;
  container.innerHTML = "";

  const sortedGenres = Array.from(genreMap.keys()).sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base" })
  );

  for (const g of sortedGenres) {
    const tracks = genreMap.get(g)!;
    const card = document.createElement("div");
    card.className = "genre-card";
    card.innerHTML = `
      <div class="genre-title">${escapeHtml(g)}</div>
      <div class="genre-count">${tracks.length} morceau(x)</div>
      <i class="fa-solid fa-tags genre-bg-icon"></i>
    `;

    card.addEventListener("click", () => {
      filterByGenre(g);
    });
    card.addEventListener("contextmenu", (e) => {
      genresCallbacks.openGenericContextMenu?.(e, { type: "genre", genreName: g, genreTracks: tracks });
    });

    container.appendChild(card);
  }
}
