/**
 * ============================================================================
 * Rustify — Vue File d'attente (src/tabs/queueTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'affichage du morceau actuellement joué et des morceaux
 * en file d'attente dans la vue dédiée (#view-queue).
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, currentQueue, setCurrentQueue, lastPlayerState } from "../state";
import type { Track, ContextTarget } from "../types";
import { buildTrackRow } from "./tracksTab";

export interface QueueTabCallbacks {
  playFromQueue: (queue: Track[], index: number) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
}

let queueCallbacks: Partial<QueueTabCallbacks> = {};

export function setQueueTabCallbacks(callbacks: Partial<QueueTabCallbacks>) {
  queueCallbacks = { ...queueCallbacks, ...callbacks };
}

export async function loadQueue() {
  const currentTbody = $("queue-current-tbody");
  const emptyCurrent = $("empty-queue-current");
  const upcomingTbody = $("queue-upcoming-tbody");
  const emptyUpcoming = $("empty-queue-upcoming");
  const queueCountEl = $("queue-count");
  const btnClearQueue = $<HTMLButtonElement>("btn-clear-queue");

  if (!currentTbody || !upcomingTbody) return;

  currentTbody.innerHTML = "";
  upcomingTbody.innerHTML = "";

  // 1. Morceau en cours de lecture
  let currentTrack = lastPlayerState?.current_track ?? null;
  if (!currentTrack) {
    try {
      const state = await invoke<{ current_track: Track | null }>("get_player_state");
      currentTrack = state.current_track;
    } catch {}
  }

  if (currentTrack) {
    if (emptyCurrent) emptyCurrent.hidden = true;
    const tr = buildTrackRow(currentTrack, 0, [currentTrack]);
    currentTbody.appendChild(tr);
  } else {
    if (emptyCurrent) emptyCurrent.hidden = false;
  }

  // 2. Titres en file d'attente
  if (queueCountEl) queueCountEl.textContent = String(currentQueue.length);
  if (btnClearQueue) btnClearQueue.hidden = currentQueue.length === 0;

  if (currentQueue.length === 0) {
    if (emptyUpcoming) emptyUpcoming.hidden = false;
  } else {
    if (emptyUpcoming) emptyUpcoming.hidden = true;
    currentQueue.forEach((t, i) => {
      const tr = buildTrackRow(t, i, currentQueue);
      upcomingTbody.appendChild(tr);
    });
  }

  // Bind bouton de vidage de la file d'attente
  if (btnClearQueue && !btnClearQueue.dataset.bound) {
    btnClearQueue.dataset.bound = "true";
    btnClearQueue.addEventListener("click", () => {
      setCurrentQueue([]);
      loadQueue();
    });
  }
}
