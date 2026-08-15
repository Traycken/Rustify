/**
 * ============================================================================
 * Rustify — Vue Tempo & BPM (src/tabs/tempoTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module répartit les morceaux par tranches de tempo (Lent, Modéré,
 * Dynamique, Rapide, Très rapide, BPM inconnu) et permet d'exécuter une analyse
 * audio en lot sur l'ensemble de la bibliothèque.
 * 
 * Sommaire des exportations :
 * - getTempoBucket(bpm) : Retourne la tranche TempoBucket correspondant à un BPM.
 * - getTempoBucketLabel(bpm) : Libellé de la tranche BPM.
 * - filterByTempo(bucketLabel) : Filtre la vue bibliothèque par tranche BPM.
 * - runBpmBatchAnalysis(onDone) : Analyse audio batch des BPM manquants.
 * - loadTempo() : Génère les cartes des tranches Tempo.
 * - setTempoTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, allTracks } from "../state";
import type { TempoBucket, Track, NavState } from "../types";
import { escapeHtml } from "../utils/formatting";
import { appAlert, appConfirm } from "../utils/dialog";

export interface TempoTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
  pushNavState: (state: NavState) => void;
  loadLibrary: () => Promise<unknown>;
}

let tempoCallbacks: Partial<TempoTabCallbacks> = {};

export function setTempoTabCallbacks(callbacks: Partial<TempoTabCallbacks>) {
  tempoCallbacks = { ...tempoCallbacks, ...callbacks };
}

export const TEMPO_UNKNOWN_LABEL = "BPM inconnu";

export const TEMPO_BUCKETS: TempoBucket[] = [
  { label: "Lent (< 90 BPM)", min: 0, max: 89.999, icon: "fa-solid fa-turtle" },
  { label: "Modéré (90 – 109 BPM)", min: 90, max: 109.999, icon: "fa-solid fa-shoe-prints" },
  { label: "Dynamique (110 – 129 BPM)", min: 110, max: 129.999, icon: "fa-solid fa-gauge" },
  { label: "Rapide (130 – 149 BPM)", min: 130, max: 149.999, icon: "fa-solid fa-gauge-high" },
  { label: "Très rapide (150+ BPM)", min: 150, max: Infinity, icon: "fa-solid fa-bolt" },
];

export function getTempoBucket(bpm?: number | null): TempoBucket | null {
  if (!bpm || bpm <= 0) return null;
  return TEMPO_BUCKETS.find((b) => bpm >= b.min && bpm <= b.max) || null;
}

export function getTempoBucketLabel(bpm?: number | null): string {
  return getTempoBucket(bpm)?.label ?? TEMPO_UNKNOWN_LABEL;
}

export function filterByTempo(bucketLabel: string) {
  const tracks = allTracks.filter((t) => getTempoBucketLabel(t.bpm) === bucketLabel);
  tempoCallbacks.switchView?.("tracks");

  const tempoArtistHeader = $("artist-header");
  if (tempoArtistHeader) {
    tempoArtistHeader.hidden = true;
    tempoArtistHeader.style.display = "none";
  }

  const viewTitle = $("view-title");
  if (viewTitle) viewTitle.textContent = `Tempo : ${bucketLabel}`;

  tempoCallbacks.renderTracks?.(tracks);

  const searchInput = $<HTMLInputElement>("search");
  tempoCallbacks.pushNavState?.({
    type: "tempo",
    view: "tracks",
    tempoLabel: bucketLabel,
    searchQuery: searchInput ? searchInput.value : "",
  });
}

export async function runBpmBatchAnalysis() {
  const targets = allTracks.filter((t) => !t.bpm || t.bpm <= 0);
  if (targets.length === 0) {
    await appAlert("Tous vos morceaux ont déjà un BPM !");
    return;
  }

  const confirmed = await appConfirm(
    `Lancer l'analyse audio des BPM sur ${targets.length} morceau(x) sans BPM ?`
  );
  if (!confirmed) return;

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");
  const progressIcon = $("scan-progress-icon");

  if (!progressBanner || !progressText || !progressBar) return;

  if (progressIcon) {
    progressIcon.innerHTML = '<i class="fa-solid fa-wave-square"></i>';
  }

  progressBanner.hidden = false;
  progressBanner.style.display = "flex";

  const total = targets.length;
  let count = 0;
  let successCount = 0;

  for (const t of targets) {
    count++;
    const percent = Math.round((count / total) * 100);
    progressText.textContent = `Analyse audio du BPM (${count} / ${total}) : ${t.title} par ${t.artist}...`;
    progressBar.style.width = `${percent}%`;

    try {
      const updatedTrack = await invoke<Track>("analyze_track_bpm", { trackId: t.id });
      if (updatedTrack && updatedTrack.bpm) {
        t.bpm = updatedTrack.bpm;
        t.bpm_is_official = updatedTrack.bpm_is_official;
        successCount++;
      }
    } catch (err) {
      console.warn(`Erreur analyse BPM pour ${t.title}:`, err);
    }
  }

  if (tempoCallbacks.loadLibrary) await tempoCallbacks.loadLibrary();
  loadTempo();

  progressText.textContent = `✨ Analyse des BPM terminée ! (${successCount} morceau(x) analysé(s))`;
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressBanner.hidden = true;
    progressBanner.style.display = "none";
    if (progressIcon) {
      progressIcon.innerHTML = '<i class="fa-solid fa-globe"></i>';
    }
  }, 2500);
}

let tempoRenderToken = 0;

export function loadTempo() {
  const btnAnalyze = $<HTMLButtonElement>("btn-analyze-all-bpm");
  if (btnAnalyze && !btnAnalyze.dataset.bound) {
    btnAnalyze.dataset.bound = "true";
    btnAnalyze.addEventListener("click", () => runBpmBatchAnalysis());
  }

  const grid = $("grid-tempo") || $("view-tempo");
  if (!grid) return;
  const token = ++tempoRenderToken;
  const buckets = new Map<string, Track[]>();
  for (const bucket of TEMPO_BUCKETS) buckets.set(bucket.label, []);
  buckets.set(TEMPO_UNKNOWN_LABEL, []);
  grid.innerHTML = "";
  let trackIndex = 0;

  const collectChunk = () => {
    if (token !== tempoRenderToken) return;
    const endIndex = Math.min(trackIndex + 200, allTracks.length);
    for (; trackIndex < endIndex; trackIndex++) {
      const track = allTracks[trackIndex];
      buckets.get(getTempoBucketLabel(track.bpm))!.push(track);
    }
    if (trackIndex < allTracks.length) {
      requestAnimationFrame(collectChunk);
      return;
    }

    const cards = [
      ...TEMPO_BUCKETS.map((bucket) => ({ label: bucket.label, icon: bucket.icon })),
      { label: TEMPO_UNKNOWN_LABEL, icon: "fa-solid fa-question" },
    ].filter(({ label }) => (buckets.get(label)?.length || 0) > 0);
    let cardIndex = 0;
    const renderChunk = () => {
      if (token !== tempoRenderToken) return;
      const fragment = document.createDocumentFragment();
      const endCardIndex = Math.min(cardIndex + 20, cards.length);
      for (; cardIndex < endCardIndex; cardIndex++) {
        const cardData = cards[cardIndex];
        const tracks = buckets.get(cardData.label)!;
        const card = document.createElement("div");
        card.className = "genre-card";
        card.innerHTML = `<div class="genre-title">${escapeHtml(cardData.label)}</div><div class="genre-count">${tracks.length} morceau(x)</div><i class="${cardData.icon} genre-bg-icon"></i>`;
        card.addEventListener("click", () => filterByTempo(cardData.label));
        fragment.appendChild(card);
      }
      grid.appendChild(fragment);
      if (cardIndex < cards.length) requestAnimationFrame(renderChunk);
    };
    requestAnimationFrame(renderChunk);
  };
  requestAnimationFrame(collectChunk);
}