/**
 * ============================================================================
 * Rustify — Wrappers Tauri IPC & Événements (src/services/tauriApi.ts)
 * ----------------------------------------------------------------------------
 * Centralise l'ensemble des appels Tauri IPC (`invoke`, `emit`, `listen`)
 * vers le backend Rust avec typage strict.
 * 
 * Sommaire des exportations :
 * - invokeApi<T>(cmd, args) : Wrapper sécurisé autour de Tauri invoke.
 * - listenEvent<T>(event, handler) : Wrapper sécurisé d'écouteurs d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function invokeApi<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return await invoke<T>(cmd, args);
}

export async function listenEvent<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return await listen<T>(event, (e) => handler(e.payload));
}
