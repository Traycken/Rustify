/**
 * ============================================================================
 * Rustify — Gestion de la Navigation & Historique (src/utils/navigation.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la pile d'historique de navigation Précédent/Suivant, le
 * changement de vue principal (onglets) et le comportement des sections repliables.
 * 
 * Sommaire des exportations :
 * - pushNavState(state) : Enregistre une étape dans la pile d'historique.
 * - updateNavHistoryButtons() : Active/désactive les boutons de navigation Précédent/Suivant.
 * - restoreNavState(state) : Restaure un état de navigation historique.
 * - goNavBack() : Navigue vers la vue précédente (Alt + Fleche Gauche).
 * - goNavForward() : Navigue vers la vue suivante (Alt + Fleche Droite).
 * - switchView(view) : Bascule la vue active de l'application.
 * - initCollapsibleSections() : Initialise les accordéons / sections repliables.
 * - setNavCallbacks(callbacks) : Enregistre les gestionnaires de chargement de vue.
 * ============================================================================
 */

import { $ } from "../state";
import type { NavState, ArtistSummary } from "../types";

export interface NavCallbacks {
  openArtistView: (artist: ArtistSummary) => void;
  filterByAlbum: (album: string, artist: string) => void;
  filterByGenre: (genre: string) => void;
  filterByTempo: (tempo: string) => void;
  loadAlbums: () => void;
  loadArtists: () => void;
  loadGenres: () => void;
  loadTempo: () => void;
  loadPlaylists: () => void;
  loadRecents: () => void;
  loadFavorites: () => void;
  loadEcstasyTracks: () => void;
  loadQueue: () => void;
  loadSettings: () => void;
  handleSearchInput: () => void;
}

let navCallbacks: Partial<NavCallbacks> = {};

export function setNavCallbacks(callbacks: Partial<NavCallbacks>) {
  navCallbacks = { ...navCallbacks, ...callbacks };
}

let navHistoryStack: NavState[] = [];
let navHistoryIndex: number = -1;
let isNavigatingHistory: boolean = false;

export function pushNavState(state: NavState) {
  if (isNavigatingHistory) return;

  if (navHistoryIndex >= 0 && navHistoryIndex < navHistoryStack.length) {
    const curr = navHistoryStack[navHistoryIndex];
    if (
      curr.type === state.type &&
      curr.view === state.view &&
      curr.artistSummary?.artist === state.artistSummary?.artist &&
      curr.albumName === state.albumName &&
      curr.genreName === state.genreName &&
      curr.tempoLabel === state.tempoLabel &&
      curr.searchQuery === state.searchQuery
    ) {
      return;
    }
  }

  if (navHistoryIndex < navHistoryStack.length - 1) {
    navHistoryStack = navHistoryStack.slice(0, navHistoryIndex + 1);
  }

  navHistoryStack.push(state);
  navHistoryIndex = navHistoryStack.length - 1;
  updateNavHistoryButtons();
}

export function updateNavHistoryButtons() {
  const btnBack = $<HTMLButtonElement>("btn-nav-back");
  const btnForward = $<HTMLButtonElement>("btn-nav-forward");
  if (btnBack) btnBack.disabled = navHistoryIndex <= 0;
  if (btnForward) btnForward.disabled = navHistoryIndex >= navHistoryStack.length - 1;
}

export function restoreNavState(state: NavState) {
  isNavigatingHistory = true;

  const searchInput = $<HTMLInputElement>("search");
  if (searchInput) {
    if (state.searchQuery !== undefined) {
      searchInput.value = state.searchQuery;
    } else {
      searchInput.value = "";
    }
  }

  if (state.type === "artist" && state.artistSummary) {
    navCallbacks.openArtistView?.(state.artistSummary);
  } else if (state.type === "album" && state.albumName) {
    navCallbacks.filterByAlbum?.(state.albumName, state.albumArtist || "");
  } else if (state.type === "genre" && state.genreName) {
    navCallbacks.filterByGenre?.(state.genreName);
  } else if (state.type === "tempo" && state.tempoLabel) {
    navCallbacks.filterByTempo?.(state.tempoLabel);
  } else {
    switchView(state.view);
    if (state.view === "albums") navCallbacks.loadAlbums?.();
    if (state.view === "artists") navCallbacks.loadArtists?.();
    if (state.view === "genres") navCallbacks.loadGenres?.();
    if (state.view === "tempo") navCallbacks.loadTempo?.();
    if (state.view === "playlists") navCallbacks.loadPlaylists?.();
    if (state.view === "recents") navCallbacks.loadRecents?.();
    if (state.view === "favorites") navCallbacks.loadFavorites?.();
    if (state.view === "ecstasy") navCallbacks.loadEcstasyTracks?.();
    if (state.view === "queue") navCallbacks.loadQueue?.();
    if (state.view === "settings") navCallbacks.loadSettings?.();
  }

  navCallbacks.handleSearchInput?.();

  isNavigatingHistory = false;
  updateNavHistoryButtons();
}

export function goNavBack() {
  if (navHistoryIndex > 0) {
    navHistoryIndex--;
    restoreNavState(navHistoryStack[navHistoryIndex]);
  }
}

export function goNavForward() {
  if (navHistoryIndex < navHistoryStack.length - 1) {
    navHistoryIndex++;
    restoreNavState(navHistoryStack[navHistoryIndex]);
  }
}

export function switchView(view: string) {
  document.querySelectorAll(".view").forEach((v) => ((v as HTMLElement).hidden = true));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  
  const targetView = $(`view-${view}`);
  if (targetView) targetView.hidden = false;
  
  document.querySelector(`[data-view="${view}"]`)?.classList.add("active");
  const titles: Record<string, string> = {
    tracks: "Bibliothèque",
    albums: "Albums",
    artists: "Artistes",
    genres: "Genres",
    tempo: "Tempo",
    playlists: "Playlists",
    queue: "File d'attente",
    recents: "Récents",
    favorites: "Favoris ⭐",
    ecstasy: "Extase 💖",
    downloader: "Téléchargeur",
    radios: "Radios",
    settings: "Paramètres",
  };

  const viewTitle = $("view-title");
  if (viewTitle) viewTitle.textContent = titles[view] ?? view;

  const artistHeader = $("artist-header");
  if (artistHeader && view !== "tracks") {
    artistHeader.hidden = true;
    artistHeader.style.display = "none";
  }

  const searchInput = $<HTMLInputElement>("search");
  pushNavState({ type: "view", view, searchQuery: searchInput ? searchInput.value : "" });
}

export function initCollapsibleSections() {
  document.querySelectorAll(".artists-section-header").forEach((header) => {
    header.addEventListener("click", () => {
      const section = header.closest(".artists-section");
      if (!section) return;
      const key = (header as HTMLElement).dataset.collapse;
      const isCollapsed = section.classList.toggle("collapsed");
      if (key) {
        localStorage.setItem(`rustify_collapse_${key}`, isCollapsed ? "true" : "false");
      }
    });
  });

  document.querySelectorAll(".artists-section-header").forEach((header) => {
    const key = (header as HTMLElement).dataset.collapse;
    if (key && localStorage.getItem(`rustify_collapse_${key}`) === "true") {
      const section = header.closest(".artists-section");
      if (section) section.classList.add("collapsed");
    }
  });
}
