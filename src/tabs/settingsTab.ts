/**
 * ============================================================================
 * Rustify — Vue Paramètres, Audio, Égaliseur & Raccourcis (src/tabs/settingsTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère les options de démarrage/system tray, les périphériques audio
 * de sortie, l'égaliseur paramétrique 10 bandes avec profils, et la configuration
 * des raccourcis clavier globaux.
 * 
 * Sommaire des exportations :
 * - loadAppSettings() : Charge les préférences (autostart, tray, raccourcis).
 * - loadAudioDevices() : Récupère la liste des périphériques audio système.
 * - renderAudioDeviceUI() : Affiche les cartes et sélecteurs de périphériques.
 * - selectAudioDevice(deviceName) : Change le périphérique de sortie audio actif.
 * - loadEqState() : Charge l'état de l'égaliseur et des profils sonores.
 * - saveEqProfileFromUi() : Enregistre le profil d'égaliseur actif.
 * - matchShortcut(e, shortcutStr) : Vérifie la correspondance d'un raccourci clavier.
 * - initSettingsEvents() : Attache les événements du panneau Paramètres.
 * - setSettingsTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import {
  $,
  availableAudioDevices,
  setAvailableAudioDevices,
  currentAudioDevice,
  setCurrentAudioDevice,
  eqState,
  setEqState,
  eqDebounceTimer,
  setEqDebounceTimer,
} from "../state";
import type { EqState, EqProfile } from "../types";
import { formatKeyName, escapeHtml } from "../utils/formatting";
import { appAlert, appPrompt, appConfirm, showAlert } from "../utils/dialog";
import { syncRadioAudioDevice } from "./radiosTab";

export interface SettingsTabCallbacks {
  loadBackendLogs: () => Promise<void>;
  loadFrontendLogs: () => void;
  updateMissingMetadataCount: () => void;
  runAdvancedEnrichment: () => Promise<void>;
  enrichArtistPhotosInBatch: () => Promise<void>;
  enrichLibraryInBatch: () => Promise<void>;
}

let settingsCallbacks: Partial<SettingsTabCallbacks> = {};

export function setSettingsTabCallbacks(callbacks: Partial<SettingsTabCallbacks>) {
  settingsCallbacks = { ...settingsCallbacks, ...callbacks };
}

export let currentShortcutPlay = "MediaPlayPause";
export let currentShortcutNext = "MediaTrackNext";
export let currentShortcutPrev = "MediaTrackPrevious";
export let currentShortcutStop = "MediaStop";
export let currentShortcutOverlay = "Alt + O";

export const EQ_BAND_FREQS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function eqFreqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}kHz` : `${hz}Hz`;
}

export function currentEqProfile(): EqProfile | null {
  if (!eqState) return null;
  return eqState.profiles.find((p) => p.id === eqState!.active_profile_id) || null;
}

export async function loadAudioDevices() {
  try {
    const devices = await invoke<string[]>("get_audio_devices");
    setAvailableAudioDevices(devices.map((d) => ({ name: d, is_default: false })));
    renderAudioDeviceUI();
  } catch (err) {
    console.error("Erreur lors de la récupération des périphériques audio :", err);
  }
}

export function renderAudioDeviceUI() {
  const selectEl = $<HTMLSelectElement>("select-audio-device");
  const popoverListEl = $("device-picker-list");

  if (selectEl) {
    selectEl.innerHTML = '<option value="default">Périphérique système par défaut</option>';
    availableAudioDevices.forEach((dev) => {
      const opt = document.createElement("option");
      opt.value = dev.name;
      opt.textContent = dev.name;
      selectEl.appendChild(opt);
    });
    selectEl.value = currentAudioDevice || "default";
  }

  if (popoverListEl) {
    popoverListEl.innerHTML = "";

    const defaultLi = document.createElement("li");
    const isDefaultActive = !currentAudioDevice;
    defaultLi.className = `device-picker-item ${isDefaultActive ? "active" : ""}`;
    defaultLi.innerHTML = `
      <span>Périphérique par défaut</span>
      ${isDefaultActive ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
    `;
    defaultLi.addEventListener("click", () => selectAudioDevice("default"));
    popoverListEl.appendChild(defaultLi);

    availableAudioDevices.forEach((dev) => {
      const li = document.createElement("li");
      const isActive = currentAudioDevice === dev.name;
      li.className = `device-picker-item ${isActive ? "active" : ""}`;
      li.innerHTML = `
        <span>${escapeHtml(dev.name)}</span>
        ${isActive ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
      `;
      li.addEventListener("click", () => selectAudioDevice(dev.name));
      popoverListEl.appendChild(li);
    });
  }

  populateEqDeviceBindSelect(currentEqProfile());
}

export async function selectAudioDevice(deviceName: string) {
  try {
    await invoke("set_audio_device", { deviceName });
    setCurrentAudioDevice(deviceName === "default" ? null : deviceName);
    renderAudioDeviceUI();
    await loadEqState();
    await syncRadioAudioDevice(currentAudioDevice);
    const popover = $("device-picker-popover");
    if (popover) popover.hidden = true;
  } catch (err) {
    console.error("Erreur sélection du périphérique audio :", err);
  }
}

export function populateEqDeviceBindSelect(profile: EqProfile | null) {
  const select = $<HTMLSelectElement>("eq-device-bind-select");
  if (!select) return;
  select.innerHTML = '<option value="">Aucun (non lié)</option>';

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "default";
  defaultOpt.textContent = "Périphérique système par défaut";
  select.appendChild(defaultOpt);

  availableAudioDevices.forEach((dev) => {
    const opt = document.createElement("option");
    opt.value = dev.name;
    opt.textContent = dev.name;
    select.appendChild(opt);
  });

  select.value = profile?.device_name || "";
}

export function renderEqBands(profile: EqProfile) {
  const row = $("eq-bands-row");
  if (!row) return;
  row.innerHTML = "";

  const makeBand = (label: string, value: number, index: number, isPreamp: boolean): HTMLElement => {
    const band = document.createElement("div");
    band.className = isPreamp ? "eq-band eq-preamp-band" : "eq-band";

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.className = "eq-band-value-input";
    valueInput.id = isPreamp ? "eq-preamp-value" : `eq-band-value-${index}`;
    valueInput.min = "-12";
    valueInput.max = "12";
    valueInput.step = "0.01";
    valueInput.value = value.toFixed(2);
    valueInput.title = "Saisissez une valeur précise, ex : 1.5";

    const wrap = document.createElement("div");
    wrap.className = "eq-band-slider-wrap";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "eq-band-slider";
    slider.id = isPreamp ? "eq-preamp-slider" : `eq-band-slider-${index}`;
    slider.min = "-12";
    slider.max = "12";
    slider.step = "0.1";
    slider.value = String(value);
    slider.dataset.bandIndex = isPreamp ? "preamp" : String(index);

    const clamp = (v: number) => Math.min(12, Math.max(-12, v));

    const updateFromSlider = () => {
      const v = parseFloat(slider.value);
      const pct = ((v + 12) / 24) * 100;
      slider.style.setProperty("--eq-progress", `${pct}%`);
      valueInput.value = v.toFixed(2);
    };
    updateFromSlider();

    slider.addEventListener("input", () => {
      updateFromSlider();
      scheduleEqSave();
    });

    valueInput.addEventListener("change", () => {
      const v = clamp(isNaN(parseFloat(valueInput.value)) ? 0 : parseFloat(valueInput.value));
      valueInput.value = v.toFixed(2);
      slider.value = String(v);
      slider.style.setProperty("--eq-progress", `${((v + 12) / 24) * 100}%`);
      scheduleEqSave();
    });

    wrap.appendChild(slider);

    const freqLabel = document.createElement("span");
    freqLabel.className = "eq-band-freq-label";
    freqLabel.textContent = label;

    band.appendChild(valueInput);
    band.appendChild(wrap);
    band.appendChild(freqLabel);
    return band;
  };

  row.appendChild(makeBand("Préampli", profile.preamp, -1, true));
  EQ_BAND_FREQS_HZ.forEach((hz, i) => {
    row.appendChild(makeBand(eqFreqLabel(hz), profile.gains[i] ?? 0, i, false));
  });
}

export function syncEqUiToProfile(profile: EqProfile) {
  renderEqBands(profile);
  populateEqDeviceBindSelect(profile);
  const select = $<HTMLSelectElement>("eq-profile-select");
  if (select) select.value = profile.id;
  const toggle = $<HTMLInputElement>("eq-enabled-toggle");
  if (toggle && eqState) toggle.checked = eqState.enabled;
}

export async function loadEqState() {
  try {
    const state = await invoke<EqState>("get_eq_state");
    setEqState(state);
    const select = $<HTMLSelectElement>("eq-profile-select");
    if (select && eqState) {
      select.innerHTML = "";
      eqState.profiles.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.device_name ? `${p.name} (liée : ${p.device_name === "default" ? "défaut" : p.device_name})` : p.name;
        select.appendChild(opt);
      });
    }
    const active = currentEqProfile();
    if (active) syncEqUiToProfile(active);
  } catch (err) {
    console.error("Erreur chargement de l'état de l'égaliseur :", err);
  }
}

export function scheduleEqSave() {
  if (eqDebounceTimer) clearTimeout(eqDebounceTimer);
  setEqDebounceTimer(window.setTimeout(saveEqProfileFromUi, 180));
}

export async function saveEqProfileFromUi() {
  const profile = currentEqProfile();
  if (!profile) return;

  const preampSlider = $<HTMLInputElement>("eq-preamp-slider");
  const preamp = preampSlider ? parseFloat(preampSlider.value) : 0;
  const gains = EQ_BAND_FREQS_HZ.map((_, i) => {
    const slider = $<HTMLInputElement>(`eq-band-slider-${i}`);
    return slider ? parseFloat(slider.value) : 0;
  });

  try {
    await invoke("update_eq_profile", { id: profile.id, name: profile.name, preamp, gains });
    profile.preamp = preamp;
    profile.gains = gains;
  } catch (err) {
    console.error("Erreur enregistrement du profil d'égaliseur :", err);
  }
}

export function initEqEvents() {
  $("eq-enabled-toggle")?.addEventListener("change", async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    try {
      await invoke("set_eq_enabled", { enabled });
      if (eqState) eqState.enabled = enabled;
    } catch (err) {
      console.error("Erreur activation/désactivation de l'égaliseur :", err);
    }
  });

  $("eq-profile-select")?.addEventListener("change", async (e) => {
    const profileId = (e.target as HTMLSelectElement).value;
    try {
      await invoke("set_active_eq_profile", { profileId });
      await loadEqState();
    } catch (err) {
      console.error("Erreur sélection du profil d'égaliseur :", err);
    }
  });

  $("btn-eq-new-profile")?.addEventListener("click", async () => {
    const name = await appPrompt("Nom du nouveau profil d'égaliseur :", "Nouveau profil");
    if (!name || !name.trim()) return;
    try {
      const created = await invoke<EqProfile>("create_eq_profile", { name: name.trim() });
      await invoke("set_active_eq_profile", { profileId: created.id });
      await loadEqState();
    } catch (err) {
      console.error("Erreur création du profil d'égaliseur :", err);
    }
  });

  $("btn-eq-rename-profile")?.addEventListener("click", async () => {
    const profile = currentEqProfile();
    if (!profile) return;
    const newName = await appPrompt("Renommer le profil :", profile.name);
    if (!newName || !newName.trim() || newName.trim() === profile.name) return;
    try {
      await invoke("update_eq_profile", {
        id: profile.id,
        name: newName.trim(),
        preamp: profile.preamp,
        gains: profile.gains,
      });
      await loadEqState();
    } catch (err) {
      console.error("Erreur renommage du profil d'égaliseur :", err);
    }
  });

  $("btn-eq-delete-profile")?.addEventListener("click", async () => {
    const profile = currentEqProfile();
    if (!profile) return;
    if (profile.id === "default") {
      await appAlert("Le profil « Plat » par défaut ne peut pas être supprimé.");
      return;
    }
    if (!(await appConfirm(`Supprimer le profil « ${profile.name} » ?`))) return;
    try {
      await invoke("delete_eq_profile", { id: profile.id });
      await loadEqState();
    } catch (err) {
      console.error("Erreur suppression du profil d'égaliseur :", err);
    }
  });

  $("eq-device-bind-select")?.addEventListener("change", async (e) => {
    const profile = currentEqProfile();
    if (!profile) return;
    const value = (e.target as HTMLSelectElement).value;
    try {
      await invoke("set_eq_profile_device", { profileId: profile.id, deviceName: value || null });
      await loadEqState();
    } catch (err) {
      console.error("Erreur liaison du profil au périphérique :", err);
    }
  });

  $("btn-eq-reset")?.addEventListener("click", async () => {
    const profile = currentEqProfile();
    if (!profile) return;
    profile.preamp = 0;
    profile.gains = EQ_BAND_FREQS_HZ.map(() => 0);
    renderEqBands(profile);
    await saveEqProfileFromUi();
  });
}

export function matchShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  if (!shortcutStr || !shortcutStr.trim()) return false;

  const parts = shortcutStr.split("+").map((p) => p.trim().toLowerCase());

  const hasCtrl = parts.includes("ctrl") || parts.includes("control");
  const hasAlt = parts.includes("alt");
  const hasShift = parts.includes("shift");
  const hasWin = parts.includes("win") || parts.includes("meta");

  if (e.ctrlKey !== hasCtrl) return false;
  if (e.altKey !== hasAlt) return false;
  if (e.shiftKey !== hasShift) return false;
  if (e.metaKey !== hasWin) return false;

  const mainKeyPart = parts.find(
    (p) => !["ctrl", "control", "alt", "shift", "win", "meta"].includes(p)
  );

  if (!mainKeyPart) return false;

  const keyLower = (e.key || "").toLowerCase();
  const codeLower = (e.code || "").toLowerCase();

  if (mainKeyPart === "mediaplaypause" || mainKeyPart === "play") return keyLower === "mediaplaypause" || codeLower === "mediaplaypause" || mainKeyPart === "play";
  if (mainKeyPart === "mediatracknext" || mainKeyPart === "next") return keyLower === "mediatracknext" || codeLower === "mediatracknext" || mainKeyPart === "next";
  if (mainKeyPart === "mediatrackprevious" || mainKeyPart === "prev") return keyLower === "mediatrackprevious" || codeLower === "mediatrackprevious" || mainKeyPart === "prev";
  if (mainKeyPart === "mediastop" || mainKeyPart === "stop") return keyLower === "mediastop" || codeLower === "mediastop" || mainKeyPart === "stop";

  if (mainKeyPart === "space") return keyLower === " " || codeLower === "space";
  if (mainKeyPart === "up") return keyLower === "arrowup";
  if (mainKeyPart === "down") return keyLower === "arrowdown";
  if (mainKeyPart === "left") return keyLower === "arrowleft";
  if (mainKeyPart === "right") return keyLower === "arrowright";

  return keyLower === mainKeyPart || codeLower === `key${mainKeyPart}` || codeLower === mainKeyPart;
}

export async function loadAppSettings() {
  try {
    const settings = await invoke<Record<string, string>>("get_app_settings");

    const autostartEl = $<HTMLInputElement>("setting-autostart");
    const trayEl = $<HTMLInputElement>("setting-minimize-to-tray");
    const shortcutsEl = $<HTMLInputElement>("setting-global-shortcuts");
    const discordRpcEl = $<HTMLInputElement>("setting-discord-rpc");

    const scPlay = $<HTMLInputElement>("sc-input-play");
    const scNext = $<HTMLInputElement>("sc-input-next");
    const scPrev = $<HTMLInputElement>("sc-input-prev");
    const scStop = $<HTMLInputElement>("sc-input-stop");
    const scOverlay = $<HTMLInputElement>("sc-input-overlay");

    if (autostartEl) autostartEl.checked = settings.autostart === "true";
    if (trayEl) trayEl.checked = settings.minimize_to_tray === "true";
    if (shortcutsEl) shortcutsEl.checked = settings.global_shortcuts_enabled === "true";
    if (discordRpcEl) discordRpcEl.checked = settings.discord_rpc_enabled === "true";


    currentShortcutPlay = settings.shortcut_play_pause || "MediaPlayPause";
    currentShortcutNext = settings.shortcut_next || "MediaTrackNext";
    currentShortcutPrev = settings.shortcut_prev || "MediaTrackPrevious";
    currentShortcutStop = settings.shortcut_stop || "MediaStop";
    currentShortcutOverlay = settings.shortcut_overlay || "Alt + O";

    if (scPlay) scPlay.value = currentShortcutPlay;
    if (scNext) scNext.value = currentShortcutNext;
    if (scPrev) scPrev.value = currentShortcutPrev;
    if (scStop) scStop.value = currentShortcutStop;
    if (scOverlay) scOverlay.value = currentShortcutOverlay;

    const configList = $("shortcuts-config-list");
    if (configList && shortcutsEl) {
      configList.style.opacity = shortcutsEl.checked ? "1" : "0.45";
      configList.style.pointerEvents = shortcutsEl.checked ? "auto" : "none";
    }
  } catch (err) {
    console.error("Erreur chargement des paramètres de l'application :", err);
  }
}

export function initShortcutRecorders() {
  document.querySelectorAll<HTMLInputElement>(".shortcut-input").forEach((input) => {
    let previousValue = input.value;

    input.addEventListener("focus", () => {
      previousValue = input.value;
      input.dataset.placeholder = input.placeholder;
      input.placeholder = "Appuyez sur vos touches...";
      input.classList.add("recording");
    });

    input.addEventListener("blur", () => {
      input.classList.remove("recording");
      if (input.dataset.placeholder) {
        input.placeholder = input.dataset.placeholder;
      }
      if (!input.value.trim()) {
        input.value = previousValue;
      }
    });

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        input.value = previousValue;
        input.blur();
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        input.value = "";
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Win");

      const keyName = formatKeyName(e.key, e.code);
      if (keyName) {
        parts.push(keyName);
      }

      if (parts.length > 0) {
        input.value = parts.join(" + ");
      }
    });
  });
}

export function initSettingsEvents() {
  initShortcutRecorders();
  initEqEvents();

  const autostartEl = $<HTMLInputElement>("setting-autostart");
  const trayEl = $<HTMLInputElement>("setting-minimize-to-tray");
  const shortcutsEl = $<HTMLInputElement>("setting-global-shortcuts");
  const discordRpcEl = $<HTMLInputElement>("setting-discord-rpc");
  const btnSaveSc = $("btn-save-shortcuts");
  const btnResetSc = $("btn-reset-shortcuts");

  autostartEl?.addEventListener("change", async () => {
    const enabled = autostartEl.checked;
    await invoke("save_app_setting", { key: "autostart", value: enabled ? "true" : "false" });
  });

  trayEl?.addEventListener("change", async () => {
    const enabled = trayEl.checked;
    await invoke("save_app_setting", { key: "minimize_to_tray", value: enabled ? "true" : "false" });
  });

  discordRpcEl?.addEventListener("change", async () => {
    const enabled = discordRpcEl.checked;
    await invoke("save_app_setting", { key: "discord_rpc_enabled", value: enabled ? "true" : "false" });
  });

  shortcutsEl?.addEventListener("change", async () => {

    const enabled = shortcutsEl.checked;
    await invoke("save_app_setting", { key: "global_shortcuts_enabled", value: enabled ? "true" : "false" });
    const configList = $("shortcuts-config-list");
    if (configList) {
      configList.style.opacity = enabled ? "1" : "0.45";
      configList.style.pointerEvents = enabled ? "auto" : "none";
    }
  });

  btnSaveSc?.addEventListener("click", async () => {
    const scPlay = $<HTMLInputElement>("sc-input-play")?.value.trim() || "MediaPlayPause";
    const scNext = $<HTMLInputElement>("sc-input-next")?.value.trim() || "MediaTrackNext";
    const scPrev = $<HTMLInputElement>("sc-input-prev")?.value.trim() || "MediaTrackPrevious";
    const scStop = $<HTMLInputElement>("sc-input-stop")?.value.trim() || "MediaStop";
    const scOverlay = $<HTMLInputElement>("sc-input-overlay")?.value.trim() || "Alt + O";

    currentShortcutPlay = scPlay;
    currentShortcutNext = scNext;
    currentShortcutPrev = scPrev;
    currentShortcutStop = scStop;
    currentShortcutOverlay = scOverlay;

    await invoke("save_app_setting", { key: "shortcut_play_pause", value: scPlay });
    await invoke("save_app_setting", { key: "shortcut_next", value: scNext });
    await invoke("save_app_setting", { key: "shortcut_prev", value: scPrev });
    await invoke("save_app_setting", { key: "shortcut_stop", value: scStop });
    await invoke("save_app_setting", { key: "shortcut_overlay", value: scOverlay });

    showAlert("Raccourcis clavier enregistrés avec succès !");
  });

  btnResetSc?.addEventListener("click", async () => {
    const scPlay = $<HTMLInputElement>("sc-input-play");
    const scNext = $<HTMLInputElement>("sc-input-next");
    const scPrev = $<HTMLInputElement>("sc-input-prev");
    const scStop = $<HTMLInputElement>("sc-input-stop");
    const scOverlay = $<HTMLInputElement>("sc-input-overlay");

    if (scPlay) scPlay.value = "MediaPlayPause";
    if (scNext) scNext.value = "MediaTrackNext";
    if (scPrev) scPrev.value = "MediaTrackPrevious";
    if (scStop) scStop.value = "MediaStop";
    if (scOverlay) scOverlay.value = "Alt + O";

    currentShortcutPlay = "MediaPlayPause";
    currentShortcutNext = "MediaTrackNext";
    currentShortcutPrev = "MediaTrackPrevious";
    currentShortcutStop = "MediaStop";
    currentShortcutOverlay = "Alt + O";

    await invoke("save_app_setting", { key: "shortcut_play_pause", value: "MediaPlayPause" });
    await invoke("save_app_setting", { key: "shortcut_next", value: "MediaTrackNext" });
    await invoke("save_app_setting", { key: "shortcut_prev", value: "MediaTrackPrevious" });
    await invoke("save_app_setting", { key: "shortcut_stop", value: "MediaStop" });
    await invoke("save_app_setting", { key: "shortcut_overlay", value: "Alt + O" });

    showAlert("Raccourcis clavier réinitialisés aux valeurs par défaut !");
  });

  $("btn-scan-missing")?.addEventListener("click", async () => {
    if (settingsCallbacks.enrichLibraryInBatch) await settingsCallbacks.enrichLibraryInBatch();
  });

  $("btn-advanced-enrich")?.addEventListener("click", async () => {
    if (settingsCallbacks.runAdvancedEnrichment) await settingsCallbacks.runAdvancedEnrichment();
  });

  $("btn-fetch-all-artist-photos")?.addEventListener("click", async () => {
    if (settingsCallbacks.enrichArtistPhotosInBatch) await settingsCallbacks.enrichArtistPhotosInBatch();
  });

  $("select-audio-device")?.addEventListener("change", (e) => {
    selectAudioDevice((e.target as HTMLSelectElement).value);
  });

  $("btn-audio-device")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const popover = $("device-picker-popover");
    if (popover) {
      popover.hidden = !popover.hidden;
    }
  });

  document.addEventListener("click", (e) => {
    const popover = $("device-picker-popover");
    const wrapper = $("btn-audio-device")?.closest(".device-picker-wrapper");
    if (popover && !popover.hidden && wrapper && !wrapper.contains(e.target as Node)) {
      popover.hidden = true;
    }
  });

  $("btn-refresh-audio-devices")?.addEventListener("click", () => {
    loadAudioDevices();
  });

  $("btn-popover-refresh")?.addEventListener("click", (e) => {
    e.stopPropagation();
    loadAudioDevices();
  });
}
