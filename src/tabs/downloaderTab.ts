/**
 * ============================================================================
 * Rustify — Vue Téléchargeur Spotify & YouTube (src/tabs/downloaderTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module contrôle le téléchargeur SpotDL / yt-dlp / UV embarqué, la gestion de
 * l'environnement virtuel Python, les options de téléchargement (cookies navigateur,
 * threads, sources audio) et la console de log en direct.
 * 
 * Sommaire des exportations :
 * - checkDownloaderEnvStatus() : Vérifie la présence d'UV, spotDL, yt-dlp et FFmpeg.
 * - setupDownloaderEnv() : Télécharge/initialise l'environnement virtuel Python embarqué.
 * - loadDownloaderSettings() : Charge les préférences de téléchargement enregistrées.
 * - saveDownloaderSettings() : Enregistre les options de téléchargement.
 * - startDownloadJob() : Lance la tâche de téléchargement.
 * - cancelDownloadJob() : Annule la tâche en cours.
 * - initDownloaderEvents() : Enregistre les abonnements d'événements et les écouteurs IPC.
 * - setDownloaderCallbacks(callbacks) : Enregistre les rappels de mise à jour de la bibliothèque.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { $ } from "../state";
import type {
  DownloaderEnvStatus,
  DownloaderSettings,
  DownloadOptions,
  DownloaderLogPayload,
  DownloaderFinishedPayload,
  OnlineMetadataResult,
} from "../types";
import { appAlert } from "../utils/dialog";
import { copyElementTextToClipboard } from "../utils/logger";
import { escapeHtml } from "../utils/formatting";

export interface DownloaderTabCallbacks {
  loadLibrary: () => Promise<unknown>;
}

let downloaderCallbacks: Partial<DownloaderTabCallbacks> = {};

export function setDownloaderCallbacks(callbacks: Partial<DownloaderTabCallbacks>) {
  downloaderCallbacks = { ...downloaderCallbacks, ...callbacks };
}

export function openSearchModal() {
  const modal = $("downloader-search-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.hidden = false;
  }
}

let activePreviewAudio: HTMLAudioElement | null = null;

export function stopPreviewAudio() {
  if (activePreviewAudio) {
    activePreviewAudio.pause();
    activePreviewAudio.currentTime = 0;
    activePreviewAudio = null;
  }
}

export function closeSearchModal() {
  stopPreviewAudio();
  const modal = $("downloader-search-modal");
  if (modal) {
    modal.hidden = true;
    modal.style.display = "none";
  }
}

export async function searchOnlineTracksAndShowModal(query: string) {
  stopPreviewAudio();
  const listContainer = $("downloader-search-results-list");
  if (!listContainer) return;

  listContainer.innerHTML = `
    <div style="text-align: center; padding: 30px; color: var(--text-dim);">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent); margin-bottom: 12px;"></i>
      <p style="font-size: 0.95rem;">Recherche de <strong>"${escapeHtml(query)}"</strong> sur Deezer, iTunes & YouTube...</p>
    </div>
  `;
  openSearchModal();

  try {
    const results = await invoke<OnlineMetadataResult[]>("search_online_tracks", { query });
    if (!results || results.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-dim);">
          <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem; color: #ff6b6b; margin-bottom: 12px;"></i>
          <p style="font-size: 0.95rem;">Aucun morceau trouvé pour <strong>"${escapeHtml(query)}"</strong>.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = "";
    results.forEach((item) => {
      const card = document.createElement("div");
      card.className = "downloader-search-item";

      const coverSrc = item.cover_base64 || item.coverBase64;
      const previewUrlSrc = item.preview_url || item.previewUrl;

      const coverHtml = coverSrc
        ? `<img src="${coverSrc}" class="downloader-search-cover" alt="Cover" />`
        : `<div class="downloader-search-cover-placeholder"><i class="fa-solid fa-music"></i></div>`;

      const titleStr = escapeHtml(item.title || "Titre inconnu");
      const artistStr = escapeHtml(item.artist || "Artiste inconnu");
      const albumStr = item.album ? ` • ${escapeHtml(item.album)}` : "";
      
      const downloadTargetVal = (item.source === "YouTube" && previewUrlSrc)
        ? previewUrlSrc
        : `${item.artist || ""} ${item.title || ""}`.trim();

      const previewBtnHtml = previewUrlSrc
        ? `<button class="btn-icon-secondary btn-preview-audio" title="Écouter un extrait audio"><i class="fa-solid fa-play"></i></button>`
        : "";

      card.innerHTML = `
        ${coverHtml}
        <div class="downloader-search-info">
          <div class="downloader-search-title">${titleStr}</div>
          <div class="downloader-search-meta">${artistStr}${albumStr}</div>
        </div>
        <span class="downloader-search-badge">${escapeHtml(item.source)}</span>
        ${previewBtnHtml}
        <button class="btn-primary downloader-search-select-btn" title="Télécharger cette musique">
          <i class="fa-solid fa-check"></i> Choisir
        </button>
      `;

      if (previewBtnHtml && previewUrlSrc) {
        const pBtn = card.querySelector(".btn-preview-audio");
        pBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const icon = pBtn.querySelector("i");
          if (activePreviewAudio && activePreviewAudio.dataset.rawUrl === previewUrlSrc && !activePreviewAudio.paused) {
            stopPreviewAudio();
            if (icon) icon.className = "fa-solid fa-play";
            return;
          }

          stopPreviewAudio();
          document.querySelectorAll(".btn-preview-audio i").forEach((ic) => ic.className = "fa-solid fa-play");
          if (icon) icon.className = "fa-solid fa-spinner fa-spin";

          let streamUrl = previewUrlSrc;
          if (item.source === "YouTube") {
            try {
              streamUrl = await invoke<String>("resolve_video_audio_stream", { url: previewUrlSrc }) as string;
            } catch (err) {
              console.warn("Erreur résolution flux audio YouTube:", err);
            }
          }

          const audio = new Audio(streamUrl);
          audio.dataset.rawUrl = previewUrlSrc;
          activePreviewAudio = audio;
          audio.play().then(() => {
            if (icon) icon.className = "fa-solid fa-pause";
          }).catch((err) => {
            console.warn("Erreur lecture extrait:", err);
            if (icon) icon.className = "fa-solid fa-play";
          });
          audio.onended = () => {
            if (icon) icon.className = "fa-solid fa-play";
            activePreviewAudio = null;
          };
        });
      }

      card.addEventListener("click", () => {
        stopPreviewAudio();
        const urlInput = $<HTMLInputElement>("downloader-url-input");
        if (urlInput) {
          urlInput.value = downloadTargetVal;
        }
        closeSearchModal();
        appendDownloaderLog(`🎯 Morceau sélectionné : "${titleStr} - ${artistStr}". Prêt pour le téléchargement.`, false, true);
        startDownloadJob();
      });

      listContainer.appendChild(card);
    });
  } catch (err) {
    console.error("Erreur search_online_tracks:", err);
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #ff6b6b;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 12px;"></i>
        <p style="font-size: 0.95rem;">Erreur lors de la recherche : ${escapeHtml(String(err))}</p>
      </div>
    `;
  }
}



export function appendDownloaderLog(line: string, isError = false, isSuccess = false) {
  const container = $("downloader-console-log");
  if (!container) return;

  const div = document.createElement("div");
  div.className = isError ? "log-line error" : isSuccess ? "log-line success" : "log-line info";
  div.textContent = line;
  container.appendChild(div);

  container.scrollTop = container.scrollHeight;
}

export async function checkDownloaderEnvStatus() {
  const badge = $("downloader-env-badge");
  const details = $("downloader-env-details");
  if (badge) {
    badge.className = "env-badge env-badge-checking";
    badge.textContent = "Vérification...";
  }

  try {
    const status = await invoke<DownloaderEnvStatus>("check_downloader_env");
    if (details) details.textContent = `${status.details} (${status.env_path})`;

    if (badge) {
      if (status.spotdl_installed && status.venv_ready) {
        badge.className = "env-badge env-badge-ok";
        badge.textContent = "✔ Environnement Prêt";
      } else {
        badge.className = "env-badge env-badge-missing";
        badge.textContent = "⚠ Outils Manquants";
      }
    }
    return status;
  } catch (err) {
    console.error("Erreur check_downloader_env:", err);
    if (badge) {
      badge.className = "env-badge env-badge-missing";
      badge.textContent = "Erreur de vérification";
    }
  }
}

export async function setupDownloaderEnv() {
  const setupBtn = $<HTMLButtonElement>("btn-setup-downloader-env");
  if (setupBtn) setupBtn.disabled = true;

  appendDownloaderLog("▶ Lancement de l'initialisation / mise à jour de l'environnement embarqué...", false, true);

  try {
    const status = await invoke<DownloaderEnvStatus>("setup_downloader_env");
    await checkDownloaderEnvStatus();
    appendDownloaderLog(`🎉 Initialisation terminée avec succès ! ${status.details}`, false, true);
  } catch (err) {
    appendDownloaderLog(`❌ Erreur lors de l'initialisation de l'environnement: ${err}`, true);
  } finally {
    if (setupBtn) setupBtn.disabled = false;
  }
}

const PRESET_BROWSERS = ["brave", "chrome", "chromium", "firefox", "edge", "opera", "vivaldi", "safari", "librewolf", "none"];

export function getSelectedBrowserValue(): string {
  const browserSelect = $<HTMLSelectElement>("downloader-browser-select");
  const customInput = $<HTMLInputElement>("downloader-browser-custom-input");
  if (!browserSelect) return "brave";
  if (browserSelect.value === "custom") {
    return customInput?.value.trim() || "brave";
  }
  return browserSelect.value;
}

export function updateBrowserCustomInputVisibility() {
  const browserSelect = $<HTMLSelectElement>("downloader-browser-select");
  const customInput = $<HTMLInputElement>("downloader-browser-custom-input");
  if (!browserSelect || !customInput) return;
  const isCustom = browserSelect.value === "custom";
  customInput.hidden = !isCustom;
  if (isCustom) {
    customInput.focus();
  }
}

export async function loadDownloaderSettings() {
  try {
    const settings = await invoke<DownloaderSettings>("get_downloader_settings");
    const outputDirInput = $<HTMLInputElement>("downloader-output-dir");
    const browserSelect = $<HTMLSelectElement>("downloader-browser-select");
    const customInput = $<HTMLInputElement>("downloader-browser-custom-input");
    const threadsInput = $<HTMLInputElement>("downloader-threads-input");
    const extraYtdlpInput = $<HTMLInputElement>("downloader-extra-yt-dlp");
    const extraSpotdlInput = $<HTMLInputElement>("downloader-extra-spotdl");
    const autoScanCheck = $<HTMLInputElement>("downloader-auto-scan");

    if (outputDirInput) outputDirInput.value = settings.output_path || "";
    
    const savedBrowser = settings.cookies_browser || "brave";
    if (browserSelect) {
      if (PRESET_BROWSERS.includes(savedBrowser)) {
        browserSelect.value = savedBrowser;
        if (customInput) customInput.hidden = true;
      } else {
        browserSelect.value = "custom";
        if (customInput) {
          customInput.hidden = false;
          customInput.value = savedBrowser;
        }
      }
    }

    if (threadsInput) threadsInput.value = String(settings.threads || 16);
    const rawExtraYtdlp = (settings.extra_yt_dlp_args || "").replace(/--cookies-from-browser\s+\S+/g, "").replace(/\s+/g, " ").trim();
    if (extraYtdlpInput) extraYtdlpInput.value = rawExtraYtdlp;
    if (extraSpotdlInput) extraSpotdlInput.value = settings.extra_spotdl_args || "";
    if (autoScanCheck) autoScanCheck.checked = settings.auto_scan;

    const sources = settings.audio_sources || ["youtube", "youtube-music", "soundcloud"];
    const srcYt = $<HTMLInputElement>("src-youtube");
    const srcYtMusic = $<HTMLInputElement>("src-youtube-music");
    const srcSoundcloud = $<HTMLInputElement>("src-soundcloud");

    if (srcYt) srcYt.checked = sources.includes("youtube");
    if (srcYtMusic) srcYtMusic.checked = sources.includes("youtube-music");
    if (srcSoundcloud) srcSoundcloud.checked = sources.includes("soundcloud");
  } catch (err) {
    console.error("Erreur get_downloader_settings:", err);
  }
}

export async function saveDownloaderSettings() {
  const outputDirInput = $<HTMLInputElement>("downloader-output-dir");
  const threadsInput = $<HTMLInputElement>("downloader-threads-input");
  const extraYtdlpInput = $<HTMLInputElement>("downloader-extra-yt-dlp");
  const extraSpotdlInput = $<HTMLInputElement>("downloader-extra-spotdl");
  const autoScanCheck = $<HTMLInputElement>("downloader-auto-scan");

  const sources: string[] = [];
  if ($<HTMLInputElement>("src-youtube")?.checked) sources.push("youtube");
  if ($<HTMLInputElement>("src-youtube-music")?.checked) sources.push("youtube-music");
  if ($<HTMLInputElement>("src-soundcloud")?.checked) sources.push("soundcloud");

  const cleanExtraYtdlp = (extraYtdlpInput?.value || "").replace(/--cookies-from-browser\s+\S+/g, "").replace(/\s+/g, " ").trim();

  const settings: DownloaderSettings = {
    output_path: outputDirInput?.value.trim() || "",
    threads: parseInt(threadsInput?.value || "16", 10) || 16,
    cookies_browser: getSelectedBrowserValue(),
    audio_sources: sources.length > 0 ? sources : ["youtube", "youtube-music", "soundcloud"],
    extra_yt_dlp_args: cleanExtraYtdlp,
    extra_spotdl_args: extraSpotdlInput?.value.trim() || "",
    auto_scan: autoScanCheck ? autoScanCheck.checked : true,
  };

  try {
    await invoke("save_downloader_settings", { settings });
    await appAlert("Options de téléchargement enregistrées avec succès !");
  } catch (err) {
    await appAlert(`Erreur lors de l'enregistrement des options: ${err}`);
  }
}

export async function startDownloadJob() {
  const urlInput = $<HTMLInputElement>("downloader-url-input");
  const url = urlInput?.value.trim() || "";

  if (!url) {
    await appAlert("Veuillez saisir ou coller l'URL d'une playlist/morceau Spotify ou YouTube.");
    return;
  }

  const startBtn = $<HTMLButtonElement>("btn-start-download");
  const cancelBtn = $<HTMLButtonElement>("btn-cancel-download");

  if (startBtn) startBtn.disabled = true;
  if (cancelBtn) cancelBtn.hidden = false;

  const outputDirInput = $<HTMLInputElement>("downloader-output-dir");
  const threadsInput = $<HTMLInputElement>("downloader-threads-input");
  const extraYtdlpInput = $<HTMLInputElement>("downloader-extra-yt-dlp");
  const extraSpotdlInput = $<HTMLInputElement>("downloader-extra-spotdl");
  const autoScanCheck = $<HTMLInputElement>("downloader-auto-scan");

  const sources: string[] = [];
  if ($<HTMLInputElement>("src-youtube")?.checked) sources.push("youtube");
  if ($<HTMLInputElement>("src-youtube-music")?.checked) sources.push("youtube-music");
  if ($<HTMLInputElement>("src-soundcloud")?.checked) sources.push("soundcloud");

  const cleanExtraYtdlp = (extraYtdlpInput?.value || "").replace(/--cookies-from-browser\s+\S+/g, "").replace(/\s+/g, " ").trim();

  const opts: DownloadOptions = {
    url,
    output_dir: outputDirInput?.value.trim() || undefined,
    threads: parseInt(threadsInput?.value || "16", 10) || 16,
    cookies_from_browser: getSelectedBrowserValue(),
    audio_sources: sources.length > 0 ? sources : ["youtube", "youtube-music", "soundcloud"],
    extra_yt_dlp_args: cleanExtraYtdlp || undefined,
    extra_spotdl_args: extraSpotdlInput?.value.trim() || undefined,
    auto_scan: autoScanCheck ? autoScanCheck.checked : true,
  };

  appendDownloaderLog(`▶ Démarrage du téléchargement pour: ${url}`, false, true);

  try {
    await invoke("start_download", { opts });
  } catch (err) {
    appendDownloaderLog(`❌ Erreur lors du lancement du téléchargement: ${err}`, true);
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (cancelBtn) cancelBtn.hidden = true;
  }
}

export async function cancelDownloadJob() {
  try {
    const cancelled = await invoke<boolean>("cancel_download");
    if (cancelled) {
      appendDownloaderLog("⛔ Téléchargement annulé par l'utilisateur.", true);
    } else {
      appendDownloaderLog("Aucun téléchargement en cours à annuler.", false);
    }
  } catch (err) {
    console.error("Erreur cancel_download:", err);
  }
}

export function initDownloaderEvents() {
  checkDownloaderEnvStatus();
  loadDownloaderSettings();

  const syncExtraYtdlpCookies = () => {
    const val = getSelectedBrowserValue();
    const extraInput = $<HTMLInputElement>("downloader-extra-yt-dlp");
    if (!extraInput) return;
    if (val === "none") {
      extraInput.value = extraInput.value.replace(/--cookies-from-browser\s+\S+/g, "").replace(/\s+/g, " ").trim();
    } else {
      if (extraInput.value.includes("--cookies-from-browser")) {
        extraInput.value = extraInput.value.replace(/--cookies-from-browser\s+\S+/g, `--cookies-from-browser ${val}`).trim();
      } else {
        extraInput.value = `--cookies-from-browser ${val} ${extraInput.value}`.trim();
      }
    }
  };

  $("downloader-browser-select")?.addEventListener("change", () => {
    updateBrowserCustomInputVisibility();
    syncExtraYtdlpCookies();
  });

  $("downloader-browser-custom-input")?.addEventListener("input", () => {
    syncExtraYtdlpCookies();
  });

  const triggerSearchOrDownload = () => {
    const urlInput = $<HTMLInputElement>("downloader-url-input");
    const val = urlInput?.value.trim() || "";
    if (!val) return;
    const isUrl = val.startsWith("http://") || val.startsWith("https://") || val.startsWith("www.");
    if (isUrl) {
      startDownloadJob();
    } else {
      searchOnlineTracksAndShowModal(val);
    }
  };

  $("btn-search-download")?.addEventListener("click", () => {
    const urlInput = $<HTMLInputElement>("downloader-url-input");
    const val = urlInput?.value.trim() || "";
    if (!val) {
      appAlert("Veuillez saisir un titre de musique ou un mot-clé à rechercher.");
      return;
    }
    const isUrl = val.startsWith("http://") || val.startsWith("https://") || val.startsWith("www.");
    if (isUrl) {
      startDownloadJob();
    } else {
      searchOnlineTracksAndShowModal(val);
    }
  });

  $("downloader-url-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      triggerSearchOrDownload();
    }
  });

  $("downloader-search-modal-close")?.addEventListener("click", () => closeSearchModal());
  $("downloader-search-modal-cancel")?.addEventListener("click", () => closeSearchModal());

  $("btn-start-download")?.addEventListener("click", () => startDownloadJob());

  $("btn-paste-download")?.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      const urlInput = $<HTMLInputElement>("downloader-url-input");
      if (urlInput && text) {
        urlInput.value = text.trim();
        startDownloadJob();
      }
    } catch (err) {
      console.warn("Presse-papier non accessible:", err);
    }
  });

  $("btn-cancel-download")?.addEventListener("click", () => cancelDownloadJob());
  $("btn-setup-downloader-env")?.addEventListener("click", () => setupDownloaderEnv());

  $("btn-toggle-downloader-settings")?.addEventListener("click", () => {
    const panel = $("downloader-settings-panel");
    if (panel) panel.hidden = !panel.hidden;
  });

  $("btn-save-downloader-settings")?.addEventListener("click", () => saveDownloaderSettings());

  $("btn-browse-download-dir")?.addEventListener("click", async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Sélectionner le dossier de téléchargement",
      });
      if (selected && typeof selected === "string") {
        const input = $<HTMLInputElement>("downloader-output-dir");
        if (input) input.value = selected;
      }
    } catch (err) {
      console.error("Erreur ouverture dialogue dossier :", err);
    }
  });

  $("btn-copy-downloader-logs")?.addEventListener("click", (e) => {
    copyElementTextToClipboard("downloader-console-log", e.currentTarget as HTMLElement);
  });

  $("btn-clear-downloader-logs")?.addEventListener("click", () => {
    const box = $("downloader-console-log");
    if (box) {
      box.innerHTML = '<div class="log-line info">Logs effacés. Prêt.</div>';
    }
  });

  listen<DownloaderLogPayload>("downloader-log", (event) => {
    const payload = event.payload;
    if (payload && payload.line) {
      const isSuccess = payload.line.includes("✔") || payload.line.includes("🎉") || payload.line.includes("✅");
      appendDownloaderLog(payload.line, payload.is_error, isSuccess);
    }
  });

  listen<DownloaderFinishedPayload>("downloader-finished", async (event) => {
    const payload = event.payload;
    if (payload) {
      if (payload.success) {
        appendDownloaderLog(`✅ ${payload.message}`, false, true);
        if (downloaderCallbacks.loadLibrary) await downloaderCallbacks.loadLibrary();
      } else {
        appendDownloaderLog(`❌ ${payload.message}`, true);
      }
    }
  });
}
