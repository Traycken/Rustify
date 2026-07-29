/**
 * ============================================================================
 * Rustify — Vue Morceaux Récents (src/tabs/recentsTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'historique chronologique des écoutes récentes dans la bibliothèque.
 * 
 * Sommaire des exportations :
 * - loadRecents() : Charge et affiche la table des écoutes récentes.
 * - setRecentsTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, getCoverDataUrl } from "../state";
import type { HistoryItem, Track, ContextTarget } from "../types";
import { fmtTime, escapeHtml } from "../utils/formatting";

export interface RecentsTabCallbacks {
  playFromQueue: (queue: Track[], index: number) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
}

let recentsCallbacks: Partial<RecentsTabCallbacks> = {};

export function setRecentsTabCallbacks(callbacks: Partial<RecentsTabCallbacks>) {
  recentsCallbacks = { ...recentsCallbacks, ...callbacks };
}

export async function loadRecents() {
  try {
    const history = await invoke<HistoryItem[]>("get_play_history", { limit: 100 });
    const tbody = $("recents-tbody");
    const emptyState = $("empty-recents");

    if (!tbody || !emptyState) return;

    if (history.length === 0) {
      tbody.innerHTML = "";
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;
    tbody.innerHTML = "";

    for (let i = 0; i < history.length; i++) {
      const item = history[i];
      const t = item.track;
      const row = document.createElement("tr");
      row.dataset.id = t.id;

      const dateObj = new Date(item.played_at);
      const dateFmt = isNaN(dateObj.getTime()) ? item.played_at : dateObj.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

      row.innerHTML = `
        <td class="col-idx mono">${i + 1}</td>
        <td class="col-cover">
          <div class="table-cover-cell">
            <div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div>
          </div>
        </td>
        <td><strong>${escapeHtml(t.title)}</strong></td>
        <td>${escapeHtml(t.artist)}</td>
        <td>${escapeHtml(t.album)}</td>
        <td class="text-dim" style="font-size: 12px;">${escapeHtml(dateFmt)}</td>
        <td class="col-time mono">${fmtTime(t.duration_secs)}</td>
      `;

      const coverCell = row.querySelector(".table-cover-cell");
      if (coverCell && t.cover_path) {
        getCoverDataUrl(t.cover_path).then((dataUrl) => {
          if (dataUrl) {
            coverCell.innerHTML = `<img class="table-cover-img" src="${dataUrl}" alt="Cover" />`;
          }
        });
      }

      row.addEventListener("dblclick", () => {
        recentsCallbacks.playFromQueue?.([t], 0);
      });

      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        recentsCallbacks.openGenericContextMenu?.(e, { type: "track", track: t, index: 0, queue: [t] });
      });

      tbody.appendChild(row);
    }
  } catch (err) {
    console.error("Erreur chargement récents :", err);
  }
}
