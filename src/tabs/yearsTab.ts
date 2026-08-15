/**
 * ============================================================================
 * Rustify — Vue Année & Décennies (src/tabs/yearsTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module répartit les morceaux par année de sortie et par décennies
 * (ex: 2024, 2023, Années 2020, Années 2010, Année inconnue), et permet d'exécuter
 * une recherche automatique en ligne pour compléter les années manquantes.
 * 
 * Sommaire des exportations :
 * - YEAR_UNKNOWN_LABEL : Libellé pour les morceaux sans année.
 * - filterByYear(yearLabel) : Filtre la vue bibliothèque par année ou décennie.
 * - runYearBatchEnrichment() : Recherche en ligne des années manquantes en lot.
 * - loadYears() : Construit et affiche la grille des cartes d'années et décennies.
 * - setYearsTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, allTracks } from "../state";
import type { Track, NavState, TrackMetadataUpdate } from "../types";
import { escapeHtml } from "../utils/formatting";
import { appAlert, appConfirm } from "../utils/dialog";
import { fetchOnlineMetadata } from "../modals/trackModal";

export interface YearsTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
  pushNavState: (state: NavState) => void;
  loadLibrary: () => Promise<unknown>;
}

let yearsCallbacks: Partial<YearsTabCallbacks> = {};

export function setYearsTabCallbacks(callbacks: Partial<YearsTabCallbacks>) {
  yearsCallbacks = { ...yearsCallbacks, ...callbacks };
}

export const YEAR_UNKNOWN_LABEL = "Année inconnue";

export function getDecadeLabel(year: number): string {
  if (year >= 2020) return "Années 2020";
  if (year >= 2010) return "Années 2010";
  if (year >= 2000) return "Années 2000";
  if (year >= 1990) return "Années 1990";
  if (year >= 1980) return "Années 1980";
  if (year >= 1970) return "Années 1970";
  return "Années 1960 et avant";
}

export function filterByYear(yearLabel: string) {
  let tracks: Track[] = [];

  if (yearLabel === YEAR_UNKNOWN_LABEL) {
    tracks = allTracks.filter((t) => !t.year || t.year <= 0);
  } else if (yearLabel.startsWith("Années ")) {
    const decadeMatch = yearLabel.match(/\d+/);
    if (yearLabel.includes("avant") && decadeMatch) {
      const maxYear = parseInt(decadeMatch[0], 10) + 9;
      tracks = allTracks.filter((t) => t.year && t.year > 0 && t.year <= maxYear);
    } else if (decadeMatch) {
      const startYear = parseInt(decadeMatch[0], 10);
      const endYear = startYear + 9;
      tracks = allTracks.filter((t) => t.year && t.year >= startYear && t.year <= endYear);
    } else {
      tracks = allTracks.filter((t) => !t.year || t.year <= 0);
    }
  } else {
    const yearNum = parseInt(yearLabel, 10);
    if (!isNaN(yearNum)) {
      tracks = allTracks.filter((t) => t.year === yearNum);
    }
  }

  yearsCallbacks.switchView?.("tracks");

  const artistHeader = $("artist-header");
  if (artistHeader) {
    artistHeader.hidden = true;
    artistHeader.style.display = "none";
  }

  const viewTitle = $("view-title");
  if (viewTitle) viewTitle.textContent = `Année : ${yearLabel}`;

  yearsCallbacks.renderTracks?.(tracks);

  const searchInput = $<HTMLInputElement>("search");
  yearsCallbacks.pushNavState?.({
    type: "year",
    view: "tracks",
    yearLabel,
    searchQuery: searchInput ? searchInput.value : "",
  });
}

export async function runYearBatchEnrichment() {
  const targets = allTracks.filter((t) => !t.year || t.year <= 0);
  if (targets.length === 0) {
    await appAlert("Tous vos morceaux ont déjà une année de renseignée !");
    return;
  }

  const confirmed = await appConfirm(
    `Rechercher en ligne les années manquantes pour ${targets.length} morceau(x) ?`
  );
  if (!confirmed) return;

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");
  const progressIcon = $("scan-progress-icon");

  if (!progressBanner || !progressText || !progressBar) return;

  if (progressIcon) {
    progressIcon.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i>';
  }

  progressBanner.hidden = false;
  progressBanner.style.display = "flex";

  const total = targets.length;
  let count = 0;
  let successCount = 0;
  const updates: TrackMetadataUpdate[] = [];

  for (const t of targets) {
    count++;
    const percent = Math.round((count / total) * 100);
    progressText.textContent = `Recherche d'année en ligne (${count} / ${total}) : ${t.title} par ${t.artist}...`;
    progressBar.style.width = `${percent}%`;

    try {
      const queryTerm = t.album && t.album !== "Album inconnu" ? t.album : t.title;
      const meta = await fetchOnlineMetadata(t.artist, queryTerm);
      if (meta && meta.year && meta.year > 0) {
        t.year = meta.year;
        updates.push({
          track_id: t.id,
          title: null,
          artist: null,
          album: null,
          genre: null,
          year: meta.year,
          cover_base64: null,
        });
        successCount++;
      }
    } catch (err) {
      console.warn(`Erreur recherche d'année pour ${t.title}:`, err);
    }

    if (updates.length >= 10) {
      const chunk = updates.splice(0, updates.length);
      try {
        await invoke("batch_update_metadata", { updates: chunk });
      } catch (err) {
        console.error("Erreur batch update metadata:", err);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  if (updates.length > 0) {
    try {
      await invoke("batch_update_metadata", { updates });
    } catch (err) {
      console.error("Erreur batch update metadata final:", err);
    }
  }

  if (yearsCallbacks.loadLibrary) await yearsCallbacks.loadLibrary();
  loadYears();

  progressText.textContent = `✨ Recherche d'années terminée ! (${successCount} morceau(x) mis à jour)`;
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressBanner.hidden = true;
    progressBanner.style.display = "none";
    if (progressIcon) {
      progressIcon.innerHTML = '<i class="fa-solid fa-globe"></i>';
    }
  }, 2500);
}

let yearsRenderToken = 0;

export function loadYears() {
  const btnFetch = $<HTMLButtonElement>("btn-fetch-missing-years");
  if (btnFetch && !btnFetch.dataset.bound) {
    btnFetch.dataset.bound = "true";
    btnFetch.addEventListener("click", () => runYearBatchEnrichment());
  }

  const container = $("grid-years") || $("view-years");
  if (!container) return;

  const token = ++yearsRenderToken;
  const yearMap = new Map<number, Track[]>();
  const decadeMap = new Map<string, Track[]>();
  const unknownTracks: Track[] = [];

  let trackIndex = 0;
  container.innerHTML = "";

  const collectChunk = () => {
    if (token !== yearsRenderToken) return;
    const endIndex = Math.min(trackIndex + 200, allTracks.length);

    for (; trackIndex < endIndex; trackIndex++) {
      const track = allTracks[trackIndex];
      if (!track.year || track.year <= 0) {
        unknownTracks.push(track);
      } else {
        const y = track.year;
        if (!yearMap.has(y)) yearMap.set(y, []);
        yearMap.get(y)!.push(track);

        const decade = getDecadeLabel(y);
        if (!decadeMap.has(decade)) decadeMap.set(decade, []);
        decadeMap.get(decade)!.push(track);
      }
    }

    if (trackIndex < allTracks.length) {
      requestAnimationFrame(collectChunk);
      return;
    }

    // Prepare cards list:
    // 1. Decades in chronological descending order
    const decadeOrder = [
      "Années 2020",
      "Années 2010",
      "Années 2000",
      "Années 1990",
      "Années 1980",
      "Années 1970",
      "Années 1960 et avant",
    ];

    const cards: { label: string; count: number; icon: string; isDecade?: boolean }[] = [];

    // Add decades that have tracks
    for (const dLabel of decadeOrder) {
      const tracks = decadeMap.get(dLabel);
      if (tracks && tracks.length > 0) {
        cards.push({
          label: dLabel,
          count: tracks.length,
          icon: "fa-solid fa-clock-rotate-left",
          isDecade: true,
        });
      }
    }

    // Add exact years sorted descending
    const sortedYears = Array.from(yearMap.keys()).sort((a, b) => b - a);
    for (const y of sortedYears) {
      const tracks = yearMap.get(y)!;
      cards.push({
        label: `${y}`,
        count: tracks.length,
        icon: "fa-solid fa-calendar-days",
      });
    }

    // Add unknown year card if there are tracks without year
    if (unknownTracks.length > 0) {
      cards.push({
        label: YEAR_UNKNOWN_LABEL,
        count: unknownTracks.length,
        icon: "fa-solid fa-calendar-xmark",
      });
    }

    let cardIndex = 0;
    const renderChunk = () => {
      if (token !== yearsRenderToken) return;
      const fragment = document.createDocumentFragment();
      const endCardIndex = Math.min(cardIndex + 25, cards.length);

      for (; cardIndex < endCardIndex; cardIndex++) {
        const cardData = cards[cardIndex];
        const card = document.createElement("div");
        card.className = "genre-card";
        if (cardData.isDecade) {
          card.style.borderColor = "var(--accent-dim)";
          card.style.background = "var(--accent-soft)";
        }
        card.innerHTML = `<div class="genre-title">${escapeHtml(cardData.label)}</div><div class="genre-count">${cardData.count} morceau(x)</div><i class="${cardData.icon} genre-bg-icon"></i>`;
        card.addEventListener("click", () => filterByYear(cardData.label));
        fragment.appendChild(card);
      }

      container.appendChild(fragment);
      if (cardIndex < cards.length) requestAnimationFrame(renderChunk);
    };

    requestAnimationFrame(renderChunk);
  };

  requestAnimationFrame(collectChunk);
}
