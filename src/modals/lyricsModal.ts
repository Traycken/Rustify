/**
 * ============================================================================
 * Rustify — Popover & Paroles Lyrics (src/modals/lyricsModal.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'affichage du Popover de Paroles (centré au-dessus de la transport-deck),
 * la synchronisation temporelle des paroles LRCLIB, la persistance permanente des décalages (offsets),
 * et l'avance de base hardcodée de 1000ms.
 * 
 * Sommaire des exportations :
 * - updateLyricsButtonsState(track) : Garde les boutons toujours actifs.
 * - toggleLyricsPopover(track) : Affiche/Masque le Popover de paroles.
 * - openLyricsPopover(track) : Ouvre et remplit le Popover.
 * - closeLyricsPopover() : Ferme le Popover.
 * - updateLyricsSyncHighlight(positionSecs, currentTrack) : Mise à jour auto & défilé des paroles.
 * - setupLyricsModalEvents() : Initialise les écouteurs d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, getCoverDataUrl, lastPlayerState } from "../state";
import type { Track, PlayerState } from "../types";
import { escapeHtml } from "../utils/formatting";
import { runAdvancedEnrichment } from "./trackModal";

interface SyncedLine {
  timeSecs: number;
  text: string;
}

const STORAGE_KEY_OFFSETS = "rustify_lyrics_offsets_v1";
const BASE_ADVANCE_MS = 1000; // Avance hardcodée de base de 1000ms (+1.0s)

let activeLyricsTrack: Track | null = null;
let parsedSyncedLines: SyncedLine[] = [];
let eventsInitialized = false;
let lastPositionSecs = 0;
const trackSyncOffsetsMs = new Map<string, number>();

// Chargement initial des offsets enregistrés dans localStorage
function loadOffsetsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OFFSETS);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const [id, offset] of Object.entries(parsed)) {
        if (typeof offset === "number") {
          trackSyncOffsetsMs.set(id, offset);
        }
      }
    }
  } catch (err) {
    console.error("Erreur de chargement des offsets lyrics:", err);
  }
}

// Persistance permanente dans localStorage
function saveOffsetsToStorage() {
  try {
    const obj: Record<string, number> = {};
    trackSyncOffsetsMs.forEach((val, key) => {
      if (val !== 0) obj[key] = val;
    });
    localStorage.setItem(STORAGE_KEY_OFFSETS, JSON.stringify(obj));
  } catch (err) {
    console.error("Erreur de sauvegarde des offsets lyrics:", err);
  }
}

loadOffsetsFromStorage();

export function parseLrc(lrcText: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/;
  for (const rawLine of lrcText.split("\n")) {
    const match = rawLine.match(regex);
    if (match) {
      const minutes = parseFloat(match[1]);
      const seconds = parseFloat(match[2]);
      const text = match[3].trim();
      if (text) {
        lines.push({ timeSecs: minutes * 60 + seconds, text });
      }
    }
  }
  return lines.sort((a, b) => a.timeSecs - b.timeSecs);
}

export function getTrackOffsetMs(trackId: string): number {
  return trackSyncOffsetsMs.get(trackId) || 0;
}

export function setTrackOffsetMs(trackId: string, offsetMs: number) {
  trackSyncOffsetsMs.set(trackId, offsetMs);
  saveOffsetsToStorage();
}

export function updateSyncOffsetBadge() {
  const badge = $("lyrics-sync-offset-badge");
  if (!badge) return;
  const userOffset = activeLyricsTrack ? getTrackOffsetMs(activeLyricsTrack.id) : 0;
  if (userOffset > 0) {
    badge.textContent = `+${userOffset} ms`;
  } else if (userOffset < 0) {
    badge.textContent = `${userOffset} ms`;
  } else {
    badge.textContent = "0 ms";
  }
}

// Toujours garder les boutons actifs (ne plus les griser)
export function updateLyricsButtonsState(_track: Track | null) {
  const btnLyricsNow = $<HTMLButtonElement>("btn-lyrics-now");
  const btnShowLyrics = $<HTMLButtonElement>("btn-show-lyrics");
  const overlayBtnLyrics = $<HTMLButtonElement>("overlay-btn-lyrics");

  const targetBtns = [btnLyricsNow, btnShowLyrics, overlayBtnLyrics];
  targetBtns.forEach((btn) => {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove("disabled-lyrics-btn");
    btn.title = "Afficher les Paroles (Lyrics)";
  });
}

export async function toggleLyricsPopover(track?: Track | null) {
  const popover = $("lyrics-popover");
  if (!popover) return;

  if (!popover.hidden) {
    closeLyricsPopover();
  } else {
    await openLyricsPopover(track);
  }
}

export async function openLyricsPopover(track?: Track | null) {
  let t = track || (lastPlayerState ? lastPlayerState.current_track : null);
  if (!t && !track) {
    try {
      const state = await invoke<PlayerState>("get_player_state");
      t = state.current_track;
    } catch {
      t = null;
    }
  }

  const popover = $("lyrics-popover");
  if (!popover) return;

  activeLyricsTrack = t;
  parsedSyncedLines = [];

  const titleEl = $("lyrics-popover-title");
  const artistEl = $("lyrics-popover-artist");
  const coverImg = $<HTMLImageElement>("lyrics-popover-cover");
  const bodyEl = $("lyrics-popover-body");
  const syncControls = $("lyrics-sync-controls");

  if (!t) {
    if (titleEl) titleEl.textContent = "Aucune lecture";
    if (artistEl) artistEl.textContent = "—";
    if (coverImg) coverImg.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    if (bodyEl) {
      bodyEl.innerHTML = `<div class="empty-state" style="padding: 14px 0;"><i class="fa-solid fa-music" style="font-size: 1.4rem; margin-bottom: 6px; opacity: 0.5;"></i><br>Aucune lecture en cours</div>`;
    }
    if (syncControls) syncControls.hidden = true;
    popover.hidden = false;
    return;
  }

  if (titleEl) titleEl.textContent = t.title;
  if (artistEl) artistEl.textContent = `${t.artist} — ${t.album}`;

  if (coverImg) {
    if (t.has_cover && t.cover_path) {
      getCoverDataUrl(t.cover_path).then((url) => {
        if (url && coverImg) coverImg.src = url;
      });
    } else {
      coverImg.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    }
  }

  if (bodyEl) {
    bodyEl.scrollTop = 0;
    if (t.is_instrumental) {
      bodyEl.innerHTML = `<div style="padding: 12px 0; color: var(--accent, #1db954);"><i class="fa-solid fa-guitar" style="font-size: 1.4rem; margin-bottom: 6px;"></i><br><strong>Morceau Instrumental</strong><br><span style="font-size: 11.5px; color: var(--text-dim);">Sans paroles chantées.</span></div>`;
      if (syncControls) syncControls.hidden = true;
    } else if (t.lyrics_synced) {
      parsedSyncedLines = parseLrc(t.lyrics_synced);
      if (parsedSyncedLines.length > 0) {
        if (syncControls) syncControls.hidden = false;
        updateSyncOffsetBadge();
        bodyEl.innerHTML = parsedSyncedLines
          .map((l, idx) => `<div class="lyrics-line-synced" id="synced-line-${idx}" data-time="${l.timeSecs}">${escapeHtml(l.text)}</div>`)
          .join("");
      } else {
        if (syncControls) syncControls.hidden = true;
        bodyEl.innerHTML = escapeHtml(t.lyrics_plain || t.lyrics_synced);
      }
    } else if (t.lyrics_plain) {
      if (syncControls) syncControls.hidden = true;
      bodyEl.innerHTML = escapeHtml(t.lyrics_plain);
    } else {
      if (syncControls) syncControls.hidden = true;
      bodyEl.innerHTML = `
        <div class="empty-state" style="padding: 12px 0; text-align: center;">
          <i class="fa-solid fa-align-center" style="font-size: 1.3rem; margin-bottom: 6px; opacity: 0.5;"></i>
          <p style="margin-bottom: 8px; font-size: 13.5px; font-weight: 500; color: var(--text-dim, #a0a0a0);">Aucune parole liée à ce titre.</p>
          <button id="btn-fetch-lyrics-popover" class="btn-primary" style="font-size: 12px; padding: 4px 10px; border-radius: 6px;">
            <i class="fa-solid fa-cloud-arrow-down"></i> Rechercher les paroles
          </button>
        </div>
      `;

      $("btn-fetch-lyrics-popover")?.addEventListener("click", async () => {
        const btn = $("btn-fetch-lyrics-popover");
        if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Recherche...`;
        await runAdvancedEnrichment([t]);
        await openLyricsPopover(t);
      });
    }
  }

  popover.hidden = false;
}

export function closeLyricsPopover() {
  const popover = $("lyrics-popover");
  if (popover) popover.hidden = true;
}

export function updateLyricsSyncHighlight(positionSecs: number, currentTrack?: Track | null) {
  lastPositionSecs = positionSecs;
  const popover = $("lyrics-popover");
  if (!popover) return;

  // Mise à jour automatique si la musique a changé alors que le popover est ouvert
  if (currentTrack && activeLyricsTrack && currentTrack.id !== activeLyricsTrack.id) {
    if (!popover.hidden) {
      openLyricsPopover(currentTrack);
      return;
    }
  }

  if (popover.hidden || parsedSyncedLines.length === 0) return;

  const userOffsetMs = activeLyricsTrack ? getTrackOffsetMs(activeLyricsTrack.id) : 0;
  // Calcul avec l'avance hardcodée de 1000ms (+1.0s) + l'offset utilisateur
  const totalOffsetMs = BASE_ADVANCE_MS + userOffsetMs;
  const effectivePositionSecs = positionSecs + totalOffsetMs / 1000;

  let activeIdx = -1;
  for (let i = 0; i < parsedSyncedLines.length; i++) {
    if (effectivePositionSecs >= parsedSyncedLines[i].timeSecs) {
      activeIdx = i;
    } else {
      break;
    }
  }

  const bodyEl = $("lyrics-popover-body");
  if (!bodyEl) return;

  parsedSyncedLines.forEach((_, idx) => {
    const lineEl = $(`synced-line-${idx}`);
    if (!lineEl) return;
    if (idx === activeIdx) {
      if (!lineEl.classList.contains("active")) {
        lineEl.classList.add("active");
        lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else {
      lineEl.classList.remove("active");
    }
  });
}

export function setupLyricsModalEvents() {
  if (eventsInitialized) return;
  eventsInitialized = true;

  $("lyrics-popover-close")?.addEventListener("click", closeLyricsPopover);

  $("lyrics-popover-enrich")?.addEventListener("click", async () => {
    if (!activeLyricsTrack) return;
    const btn = $("lyrics-popover-enrich");
    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    await runAdvancedEnrichment([activeLyricsTrack]);
    if (btn) btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i>`;
    await openLyricsPopover(activeLyricsTrack);
  });

  // Boutons de réglage du décalage (offset de synchronisation par pas de 100 ms)
  $("btn-lyrics-sync-minus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!activeLyricsTrack) return;
    const currentOffset = getTrackOffsetMs(activeLyricsTrack.id);
    const newOffset = currentOffset - 100;
    setTrackOffsetMs(activeLyricsTrack.id, newOffset);
    updateSyncOffsetBadge();
    updateLyricsSyncHighlight(lastPositionSecs, activeLyricsTrack);
  });

  $("btn-lyrics-sync-plus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!activeLyricsTrack) return;
    const currentOffset = getTrackOffsetMs(activeLyricsTrack.id);
    const newOffset = currentOffset + 100;
    setTrackOffsetMs(activeLyricsTrack.id, newOffset);
    updateSyncOffsetBadge();
    updateLyricsSyncHighlight(lastPositionSecs, activeLyricsTrack);
  });

  $("lyrics-sync-offset-badge")?.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (!activeLyricsTrack) return;
    setTrackOffsetMs(activeLyricsTrack.id, 0);
    updateSyncOffsetBadge();
    updateLyricsSyncHighlight(lastPositionSecs, activeLyricsTrack);
  });
}
