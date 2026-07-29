/**
 * ============================================================================
 * Rustify — Journal & Debug (src/utils/logger.ts)
 * ----------------------------------------------------------------------------
 * Ce module intercepte les logs console (warn, error) du frontend et gère
 * la consultation et l'affichage des logs frontend et backend dans Paramètres > Journal & Debug.
 * 
 * Sommaire des exportations :
 * - initConsoleInterceptors() : Intercepte console.error, console.warn et erreurs globales.
 * - pushFrontendLog(message) : Ajoute une entrée dans l'historique frontend.
 * - loadFrontendLogs() : Affiche les logs frontend dans la vue Paramètres.
 * - loadBackendLogs() : Charge et affiche les logs backend depuis Rust via Tauri.
 * - renderDebugLogList(...) : Génère les lignes de logs formatées dans le DOM.
 * - copyElementTextToClipboard(...) : Copie le texte d'un journal dans le presse-papier.
 * - initDebugLogEvents() : Attache les écouteurs d'événements pour le panneau de debug.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, frontendLogs, FRONTEND_LOG_MAX } from "../state";
import type { FrontendLogEntry, DebugLogEntryLike } from "../types";

export function pushFrontendLog(message: string) {
  frontendLogs.push({ timestamp: new Date().toISOString(), message });
  if (frontendLogs.length > FRONTEND_LOG_MAX) frontendLogs.shift();
}

export function stringifyLogArg(a: unknown): string {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

export function initConsoleInterceptors() {
  const _origConsoleError = console.error.bind(console);
  const _origConsoleWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    pushFrontendLog(args.map(stringifyLogArg).join(" "));
    _origConsoleError(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushFrontendLog(args.map(stringifyLogArg).join(" "));
    _origConsoleWarn(...args);
  };

  window.addEventListener("error", (e) => {
    pushFrontendLog(`Erreur non interceptée : ${e.message} (${e.filename}:${e.lineno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    pushFrontendLog(`Promesse rejetée non gérée : ${stringifyLogArg(e.reason)}`);
  });
}

export function renderDebugLogList(containerId: string, emptyId: string, entries: (DebugLogEntryLike | FrontendLogEntry)[]) {
  const container = $(containerId);
  const empty = $(emptyId);
  if (!container || !empty) return;
  container.innerHTML = "";

  if (!entries || entries.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  entries.forEach((e) => {
    const div = document.createElement("div");
    div.className = "debug-log-line";
    if (e.level === "warn") div.classList.add("warn");
    else if (e.level === "error") div.classList.add("error");

    const tsSpan = document.createElement("span");
    tsSpan.className = "debug-log-time";
    tsSpan.textContent = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";

    const msgSpan = document.createElement("span");
    msgSpan.className = "debug-log-msg";
    msgSpan.textContent = e.message || String(e);

    div.appendChild(tsSpan);
    div.appendChild(msgSpan);
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

export async function loadBackendLogs() {
  try {
    const logs = await invoke<DebugLogEntryLike[]>("get_debug_logs");
    renderDebugLogList("backend-log-list", "empty-backend-log", logs);
  } catch (e) {
    console.error("Erreur chargement logs backend :", e);
  }
}

export function loadFrontendLogs() {
  renderDebugLogList("frontend-log-list", "empty-frontend-log", frontendLogs);
}

export async function copyElementTextToClipboard(elementId: string, btnElement: HTMLElement | null): Promise<void> {
  const el = $(elementId);
  if (!el) return;
  const text = el.innerText || el.textContent || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (btnElement) {
      const origHtml = btnElement.innerHTML;
      btnElement.innerHTML = '<i class="fa-solid fa-check"></i> Copié !';
      setTimeout(() => {
        btnElement.innerHTML = origHtml;
      }, 2000);
    }
  } catch (err) {
    console.error("Erreur copie presse-papier", err);
  }
}

export function initDebugLogEvents() {
  $("btn-refresh-backend-log")?.addEventListener("click", loadBackendLogs);
  $("btn-clear-backend-log")?.addEventListener("click", async () => {
    try {
      await invoke("clear_debug_logs");
      await loadBackendLogs();
    } catch (e) {
      console.error("Erreur effacement logs backend :", e);
    }
  });
  $("btn-copy-backend-log")?.addEventListener("click", (ev) => {
    copyElementTextToClipboard("backend-log-list", ev.currentTarget as HTMLElement);
  });

  $("btn-clear-frontend-log")?.addEventListener("click", () => {
    frontendLogs.length = 0;
    loadFrontendLogs();
  });
  $("btn-copy-frontend-log")?.addEventListener("click", (ev) => {
    copyElementTextToClipboard("frontend-log-list", ev.currentTarget as HTMLElement);
  });
}
