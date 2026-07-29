/**
 * ============================================================================
 * Rustify — Vue Extase 💖 (src/tabs/ecstasyTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'onglet Extase 💖 (musiques pépites prioritaires).
 * 
 * Sommaire des exportations :
 * - loadEcstasyTracks() : Filtre et affiche les morceaux marqués en Extase.
 * - setEcstasyTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { $, allTracks } from "../state";
import type { Track } from "../types";

export interface EcstasyTabCallbacks {
  renderTracksInContainer: (tracks: Track[], container: HTMLElement, isEcstasyView: boolean) => void;
}

let ecstasyCallbacks: Partial<EcstasyTabCallbacks> = {};

export function setEcstasyTabCallbacks(callbacks: Partial<EcstasyTabCallbacks>) {
  ecstasyCallbacks = { ...ecstasyCallbacks, ...callbacks };
}

export async function loadEcstasyTracks() {
  try {
    const ecstasyTracks = allTracks.filter((t) => t.is_ecstasy);
    const tbody = $("ecstasy-tracks-tbody");
    const emptyState = $("empty-ecstasy-tracks");
    if (tbody && emptyState) {
      if (ecstasyTracks.length === 0) {
        tbody.innerHTML = "";
        emptyState.hidden = false;
      } else {
        emptyState.hidden = true;
        ecstasyCallbacks.renderTracksInContainer?.(ecstasyTracks, tbody, true);
      }
    }
  } catch (err) {
    console.error("Erreur chargement morceaux extase :", err);
  }
}
