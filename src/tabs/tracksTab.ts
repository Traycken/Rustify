/**
 * ============================================================================
 * Rustify — Vue Bibliothèque &Morceaux (src/tabs/tracksTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la vue principale des morceaux de la bibliothèque, la construction
 * des lignes de tableau avec pochettes et le rendu optimisé par chunks.
 * 
 * Sommaire des exportations :
 * - loadLibrary() : Charge l'intégralité des morceaux depuis Rust.
 * - renderTracks(tracks) : Effectue le rendu progressif des morceaux dans la table.
 * - renderTracksInContainer(...) : Rendu des morceaux pour Favoris & Extase.
 * - buildTrackRow(...) : Génère l'élément tr d'un morceau.
 * - updateMissingMetadataCount() : Compte les morceaux incomplets pour Paramètres.
 * - setTracksTabCallbacks(callbacks) : Enregistre les gestionnaires d'actions.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, allTracks, currentQueue, setAllTracks, getCoverDataUrl } from "../state";
import type { Track, ContextTarget } from "../types";
import { fmtTime, escapeHtml } from "../utils/formatting";
import { switchView, pushNavState } from "../utils/navigation";

export interface TracksTabCallbacks {
  openArtistByName: (artistName: string) => void;
  filterByAlbum: (albumName: string, artistName: string) => void;
  playFromQueue: (queue: Track[], index: number) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
  reloadFavorites: () => void;
  reloadEcstasy: () => void;
}

let tracksCallbacks: Partial<TracksTabCallbacks> = {};

export function setTracksTabCallbacks(callbacks: Partial<TracksTabCallbacks>) {
  tracksCallbacks = { ...tracksCallbacks, ...callbacks };
}

let trackRenderToken = 0;

export function buildTrackRow(t: Track, i: number, tracks: Track[]): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.id = String(t.id);
  const favBadge = t.is_ecstasy
    ? '<span class="track-badge-ecstasy" title="Extase 💖" style="margin-left:6px; color:#ff4757;"><i class="fa-solid fa-heart"></i></span>'
    : t.is_favorite
    ? '<span class="track-badge-fav" title="Favori ⭐" style="margin-left:6px; color:#f1c40f;"><i class="fa-solid fa-star"></i></span>'
    : "";
  const isInQueue = currentQueue.some((qt) => qt.id === t.id);
  const permScore = Math.round((t.permanent_score ?? 0) * 10) / 10;
  let tempScore = Math.round((t.temp_score ?? 0) * 10) / 10;
  if (isInQueue && t.temp_score === undefined) {
    tempScore = 100;
  } else if (isInQueue && t.temp_score !== undefined && t.temp_score < 100) {
    tempScore += 100;
  }
  const effScore = Math.round(((t.effective_score !== undefined ? t.effective_score : (t.permanent_score ?? 0)) + (isInQueue && t.effective_score === undefined ? 100 : 0)) * 10) / 10;
  const tempSign = tempScore >= 0 ? `+${tempScore}` : `${tempScore}`;
  const scoreDisplay = `score: ${effScore} (${permScore} ${tempSign})`;

  tr.innerHTML = `
    <td class="col-idx">${i + 1}</td>
    <td class="col-cover"><div class="table-cover-cell"><div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div></div></td>
    <td>${escapeHtml(t.title)}${favBadge}</td>
    <td><span class="table-link link-artist" data-artist="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span></td>
    <td><span class="table-link link-album" data-album="${escapeHtml(t.album)}" data-artist="${escapeHtml(t.album_artist || t.artist)}">${escapeHtml(t.album)}</span></td>
    <td class="col-score" style="text-align: right; padding-right: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim, #a0a0a0);">${scoreDisplay}</td>
    <td class="col-time">${fmtTime(t.duration_secs)}</td>
  `;

  const coverCell = tr.querySelector(".table-cover-cell");
  if (coverCell && t.cover_path) {
    getCoverDataUrl(t.cover_path).then((url) => {
      if (url) {
        coverCell.innerHTML = `<img src="${url}" class="table-cover-img" alt="" />`;
      }
    });
  }

  tr.querySelector(".link-artist")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    tracksCallbacks.openArtistByName?.(t.artist);
  });

  tr.querySelector(".link-album")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    tracksCallbacks.filterByAlbum?.(t.album, t.album_artist || t.artist);
  });

  tr.addEventListener("dblclick", (e) => {
    e.preventDefault();
    tracksCallbacks.playFromQueue?.(tracks, i);
  });
  tr.addEventListener("contextmenu", (e) => {
    tracksCallbacks.openGenericContextMenu?.(e, { type: "track", track: t, index: i, queue: tracks });
  });

  return tr;
}

export function renderTracks(tracks: Track[]) {
  const trackTbody = $("track-tbody");
  const emptyState = $("empty-state");
  if (!trackTbody || !emptyState) return;

  const token = ++trackRenderToken;
  trackTbody.innerHTML = "";
  emptyState.hidden = tracks.length > 0;

  if (tracks.length === 0) return;

  const CHUNK_SIZE = 150;
  let index = 0;

  function renderChunk() {
    if (token !== trackRenderToken) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(index + CHUNK_SIZE, tracks.length);
    for (; index < end; index++) {
      fragment.appendChild(buildTrackRow(tracks[index], index, tracks));
    }
    trackTbody.appendChild(fragment);
    if (index < tracks.length) {
      requestAnimationFrame(renderChunk);
    }
  }

  requestAnimationFrame(renderChunk);
}

export function filterBySimilarTrack(refTrack: Track) {
  switchView("tracks");

  const refGenre = refTrack.genre ? refTrack.genre.trim().toLowerCase() : "";
  const refBpm = refTrack.bpm && refTrack.bpm > 0 ? refTrack.bpm : null;
  const refArtist = refTrack.artist ? refTrack.artist.trim().toLowerCase() : "";

  const scoredTracks = allTracks
    .filter((t) => t.id !== refTrack.id)
    .map((t) => {
      let score = 0;
      const tGenre = t.genre ? t.genre.trim().toLowerCase() : "";
      const tArtist = t.artist ? t.artist.trim().toLowerCase() : "";

      if (refGenre && tGenre) {
        if (tGenre === refGenre) {
          score += 40;
        } else if (tGenre.includes(refGenre) || refGenre.includes(tGenre)) {
          score += 25;
        }
      }

      if (refArtist && tArtist && tArtist === refArtist) {
        score += 35;
      }

      if (refBpm && t.bpm && t.bpm > 0) {
        const bpmDiff = Math.abs(t.bpm - refBpm);
        if (bpmDiff <= 5) {
          score += 30;
        } else if (bpmDiff <= 15) {
          score += 15;
        }
      }

      return { track: t, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.track);

  const finalTracks = scoredTracks.length > 0 ? scoredTracks : allTracks;

  renderTracks(finalTracks);
  pushNavState({
    type: "view",
    view: "tracks",
  });

  const searchInput = $<HTMLInputElement>("search");
  if (searchInput) {
    searchInput.value = "";
  }
}

export function renderTracksInContainer(tracks: Track[], container: HTMLElement, isEcstasyView: boolean = false) {
  container.innerHTML = "";
  tracks.forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(t.id);
    const iconHtml = isEcstasyView
      ? '<i class="fa-solid fa-heart" style="color: #ff4757;"></i>'
      : '<i class="fa-solid fa-star" style="color: #f1c40f;"></i>';
    const btnTitle = isEcstasyView ? "Retirer d'Extase 💖" : "Retirer des favoris ⭐";
    const btnClass = isEcstasyView ? "fav-heart-btn is-ecstasy" : "fav-star-btn is-fav";

    tr.innerHTML = `
      <td class="col-idx">
        <button class="${btnClass}" data-id="${t.id}" title="${btnTitle}">
          ${iconHtml}
        </button>
      </td>
      <td class="col-cover"><div class="table-cover-cell"><div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div></div></td>
      <td><strong>${escapeHtml(t.title)}</strong></td>
      <td><span class="table-link link-artist" data-artist="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span></td>
      <td><span class="table-link link-album" data-album="${escapeHtml(t.album)}" data-artist="${escapeHtml(t.album_artist || t.artist)}">${escapeHtml(t.album)}</span></td>
      <td class="col-time">${fmtTime(t.duration_secs)}</td>
    `;

    const coverCell = tr.querySelector(".table-cover-cell");
    if (coverCell && t.cover_path) {
      getCoverDataUrl(t.cover_path).then((dataUrl) => {
        if (dataUrl) {
          coverCell.innerHTML = `<img class="table-cover-img" src="${dataUrl}" alt="Cover" />`;
        }
      });
    }

    const favBtn = tr.querySelector("button");
    favBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isEcstasyView) {
        await invoke("toggle_ecstasy", { trackId: t.id });
        tracksCallbacks.reloadEcstasy?.();
      } else {
        await invoke("toggle_favorite", { targetType: "track", targetId: t.id });
        tracksCallbacks.reloadFavorites?.();
      }
      loadLibrary();
    });

    tr.addEventListener("dblclick", () => {
      tracksCallbacks.playFromQueue?.(tracks, i);
    });

    tr.addEventListener("contextmenu", (e) => {
      tracksCallbacks.openGenericContextMenu?.(e, { type: "track", track: t, index: i, queue: tracks });
    });

    container.appendChild(tr);
  });
}

export async function loadLibrary(): Promise<Track[]> {
  try {
    const tracks = await invoke<Track[]>("get_tracks");
    setAllTracks(tracks);
    renderTracks(allTracks);
    updateMissingMetadataCount();
    return tracks;
  } catch (err) {
    console.error("Erreur chargement bibliothèque :", err);
    return [];
  }
}

export function updateMissingMetadataCount() {
  const missingCountEl = $("missing-count");
  const advancedMissingCountEl = $("advanced-missing-count");

  const basicMissing = allTracks.filter((t) => !t.cover_path || t.year === 0 || !t.genre).length;
  const advancedMissing = allTracks.filter((t) => {
    const hasBpm = !!t.bpm && t.bpm > 0;
    const hasIsrc = !!t.isrc;
    const hasTags = !!t.tags && t.tags.length > 0;
    const hasCredits = !!t.credits && t.credits.length > 0;
    const hasLyrics = !!t.lyrics_plain || !!t.lyrics_synced || t.is_instrumental === true;
    const isComplete = hasBpm && hasIsrc && hasTags && hasCredits && hasLyrics;
    return !isComplete && (t.enrichment_attempts ?? 0) <= 3;
  }).length;

  if (missingCountEl) missingCountEl.textContent = String(basicMissing);
  if (advancedMissingCountEl) advancedMissingCountEl.textContent = String(advancedMissing);
}
