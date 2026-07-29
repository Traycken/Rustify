/**
 * ============================================================================
 * Rustify — État Global & Caches (src/state.ts)
 * ----------------------------------------------------------------------------
 * Ce fichier gère l'état global partagé de l'application (pistes chargées,
 * file d'attente, cache d'images, état du lecteur audio, égaliseur, etc.).
 * 
 * Sommaire des exportations :
 * - $ : Raccourci de sélection d'élément DOM par ID.
 * - getCoverDataUrl() : Récupération mise en cache des pochettes d'albums.
 * - Variables d'état partagées (allTracks, currentQueue, playerState, etc.)
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import type { Track, PlayerState, EqState, FrontendLogEntry, AlgoFeedbackState } from "./types";

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const FRONTEND_LOG_MAX = 200;
export const frontendLogs: FrontendLogEntry[] = [];

export const allTracks: Track[] = [];
export function setAllTracks(tracks: Track[]) {
  allTracks.length = 0;
  allTracks.push(...tracks);
}

export const currentQueue: Track[] = [];
export function setCurrentQueue(queue: Track[]) {
  currentQueue.length = 0;
  currentQueue.push(...queue);
}

export const coverCache = new Map<string, string>();

export async function getCoverDataUrl(coverPath: string | null): Promise<string | null> {
  if (!coverPath) return null;
  if (coverPath.startsWith("http://") || coverPath.startsWith("https://") || coverPath.startsWith("data:")) {
    return coverPath;
  }
  if (coverCache.has(coverPath)) return coverCache.get(coverPath)!;
  try {
    const dataUrl = await invoke<string>("read_cover", { path: coverPath });
    coverCache.set(coverPath, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error("Erreur lecture pochette", e);
    return null;
  }
}

export let isSeeking = false;
export function setIsSeeking(val: boolean) {
  isSeeking = val;
}

export let lastPlayerState: PlayerState | null = null;
export function setLastPlayerState(state: PlayerState | null) {
  lastPlayerState = state;
}

export let lastPlayerStateTimestamp = performance.now();
export function setLastPlayerStateTimestamp(ts: number) {
  lastPlayerStateTimestamp = ts;
}

export let currentAudioDevice: string | null = null;
export function setCurrentAudioDevice(device: string | null) {
  currentAudioDevice = device;
}

export let availableAudioDevices: { name: string; is_default: boolean }[] = [];
export function setAvailableAudioDevices(devices: { name: string; is_default: boolean }[]) {
  availableAudioDevices = devices;
}

export let eqState: EqState | null = null;
export function setEqState(state: EqState | null) {
  eqState = state;
}

export let eqDebounceTimer: number | null = null;
export function setEqDebounceTimer(timer: number | null) {
  eqDebounceTimer = timer;
}

export let smartShuffleActive = false;
export function setSmartShuffleActive(val: boolean) {
  smartShuffleActive = val;
}

export let nextSmartTrack: Track | null = null;
export function setNextSmartTrack(t: Track | null) {
  nextSmartTrack = t;
}

export let isComputingNextSmart = false;
export function setIsComputingNextSmart(val: boolean) {
  isComputingNextSmart = val;
}

export let lastKnownTrackId: string | null = null;
export function setLastKnownTrackId(id: string | null) {
  lastKnownTrackId = id;
}

export let lastKnownTrackForSkip: Track | null = null;
export function setLastKnownTrackForSkip(t: Track | null) {
  lastKnownTrackForSkip = t;
}

export let algoFeedbackState: AlgoFeedbackState = "idle";
export function setAlgoFeedbackState(state: AlgoFeedbackState) {
  algoFeedbackState = state;
}

export let algoButtonsTrackId: string | null = null;
export function setAlgoButtonsTrackId(id: string | null) {
  algoButtonsTrackId = id;
}

export let saveStateCounter = 0;
export function incrementSaveStateCounter(): number {
  saveStateCounter++;
  return saveStateCounter;
}
