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

import { loadFavorites, setFavTrackFilter } from "./favoritesTab";
import { switchView } from "../utils/navigation";

export async function loadEcstasyTracks() {
  try {
    switchView("favorites");
    setFavTrackFilter("ecstasy");
    await loadFavorites();
  } catch (err) {
    console.error("Erreur chargement morceaux extase :", err);
  }
}
