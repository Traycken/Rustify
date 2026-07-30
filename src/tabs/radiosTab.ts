/**
 * ============================================================================
 * Rustify — Vue Radios & Streaming (src/tabs/radiosTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère les stations de radio en direct (audio / vidéo), la vérification
 * asynchrone du statut de disponibilité (LIVE / OFF) et les flux réseau.
 * 
 * Sommaire des exportations :
 * - loadRadios() : Charge et affiche la grille des stations radios.
 * - playRadio(radio) : Démarre la lecture du flux streaming audio/vidéo.
 * - openRadioModal(radio) : Ouvre la modale d'ajout ou d'édition d'une radio.
 * - initRadioEvents() : Attache les événements de la modale radio.
 * - getActiveRadio() : Retourne la radio en cours de lecture.
 * - getRadioAudioEl() : Retourne l'élément HTML5 Audio des radios.
 * - syncRadioAudioDevice(deviceName) : Affecte la sortie audio à l'élément radio HTML5.
 * ============================================================================
 */

import Hls from "hls.js";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { $, getCoverDataUrl } from "../state";
import type { Radio, RadioInput, PlayerState, ChannelLiveStreamItem, RadioOnlineMetadataResult } from "../types";
import { escapeHtml } from "../utils/formatting";
import { appAlert, appConfirm, showAlert } from "../utils/dialog";
import { refreshPlayerState } from "../player/playerEngine";

let currentRadioCoverBase64: string | null = null;
let activeRadio: Radio | null = null;
let radioAudioEl: HTMLAudioElement | null = null;
let hlsInstance: Hls | null = null;

export function getActiveRadio(): Radio | null {
  return activeRadio;
}

export function getRadioAudioEl(): HTMLAudioElement | null {
  return radioAudioEl;
}

export function setRadioVolume(volume: number) {
  if (radioAudioEl) {
    radioAudioEl.volume = Math.max(0, Math.min(1, volume));
  }
}

export async function syncRadioAudioDevice(deviceName: string | null) {
  if (!radioAudioEl || typeof (radioAudioEl as any).setSinkId !== "function") return;
  try {
    if (!deviceName || deviceName === "default") {
      await (radioAudioEl as any).setSinkId("");
      return;
    }

    let devices = await navigator.mediaDevices.enumerateDevices();
    let audioOutputs = devices.filter((d) => d.kind === "audiooutput");

    if (audioOutputs.length > 0 && !audioOutputs[0].label) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        audioOutputs = devices.filter((d) => d.kind === "audiooutput");
      } catch {}
    }

    const normTarget = deviceName.trim().toLowerCase();
    const match = audioOutputs.find((d) => {
      const label = d.label.trim().toLowerCase();
      return label === normTarget || label.includes(normTarget) || normTarget.includes(label);
    });

    if (match && match.deviceId) {
      await (radioAudioEl as any).setSinkId(match.deviceId);
    }
  } catch (err) {
    console.warn("Impossible d'affecter le périphérique audio sur l'élément radio HTML5:", err);
  }
}

export function stopRadio() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (radioAudioEl) {
    radioAudioEl.pause();
    radioAudioEl.src = "";
  }
  activeRadio = null;
  refreshPlayerState();
  emit("radio-stream-changed", { radio: null, isPlaying: false }).catch(() => {});
}

export function togglePlayRadio() {
  if (!radioAudioEl || !activeRadio) return;
  if (radioAudioEl.paused) {
    radioAudioEl.play().catch(() => {});
    emit("radio-stream-changed", { radio: activeRadio, isPlaying: true }).catch(() => {});
  } else {
    radioAudioEl.pause();
    emit("radio-stream-changed", { radio: activeRadio, isPlaying: false }).catch(() => {});
  }
  refreshPlayerState();
  loadRadios();
}

export async function playRadio(radio: Radio) {
  try {
    // Si la même radio ET le même flux streaming est en cours de lecture, on bascule Pause / Play
    if (activeRadio && activeRadio.id === radio.id && activeRadio.stream_url === radio.stream_url && radioAudioEl && radioAudioEl.src) {
      togglePlayRadio();
      return;
    }

    activeRadio = radio;
    let playUrl = radio.stream_url;

    const isTwitch = radio.stream_url.toLowerCase().includes("twitch") || playUrl.toLowerCase().includes("twitch");
    if (isTwitch) {
      showAlert(`📢 Connexion au live Twitch (${radio.name})... Note : si une publicité est diffusée par Twitch, le son s'activera automatiquement après l'annonce.`);
    } else {
      showAlert(`⏳ Connexion à la radio ${radio.name}...`);
    }

    if (radio.is_video || playUrl.includes("youtube.com") || playUrl.includes("youtu.be") || playUrl.includes("twitch.tv") || playUrl.includes("twitch") || playUrl.startsWith("@")) {
      const resolved = await invoke<string>("resolve_video_audio_stream", { url: radio.stream_url });
      if (resolved) playUrl = resolved;
    }

    // Arrêter la musique locale backend
    await invoke("stop").catch(() => {});

    if (!radioAudioEl) {
      const vid = document.createElement("video");
      vid.style.display = "none";
      document.body.appendChild(vid);
      radioAudioEl = vid as unknown as HTMLAudioElement;

      radioAudioEl.addEventListener("play", () => {
        emit("radio-stream-changed", { radio: activeRadio, isPlaying: true }).catch(() => {});
        refreshPlayerState();
        loadRadios();
      });
      radioAudioEl.addEventListener("pause", () => {
        emit("radio-stream-changed", { radio: activeRadio, isPlaying: false }).catch(() => {});
        refreshPlayerState();
        loadRadios();
      });
      radioAudioEl.addEventListener("ended", () => {
        emit("radio-stream-changed", { radio: null, isPlaying: false }).catch(() => {});
        refreshPlayerState();
        loadRadios();
      });
    }

    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }

    radioAudioEl.pause();

    // Application stricte du volume actuellement configuré sur la barre UI
    const volumeBar = $<HTMLInputElement>("volume");
    if (volumeBar) {
      const currentVol = parseFloat(volumeBar.value) / 100;
      if (!isNaN(currentVol)) {
        radioAudioEl.volume = Math.max(0, Math.min(1, currentVol));
      }
    }

    refreshPlayerState();
    loadRadios();

    try {
      const state = await invoke<PlayerState>("get_player_state");
      if (state && typeof state.volume === "number") {
        radioAudioEl.volume = state.volume;
      }
      if (state && state.audio_device) {
        await syncRadioAudioDevice(state.audio_device);
      }
    } catch {}

    const isHls = playUrl.includes(".m3u8") || playUrl.includes("playlist");
    const isYouTube = playUrl.includes("googlevideo.com") || playUrl.includes("youtube.com") || playUrl.includes("youtu.be");

    if (isHls && !isYouTube && Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      let adDetected = false;
      hlsInstance.on(Hls.Events.FRAG_LOADING, (_event, data) => {
        const fragUrl = (data.frag?.url || "").toLowerCase();
        if (fragUrl.includes("ad") || fragUrl.includes("preroll") || fragUrl.includes("stitch") || fragUrl.includes("amazon") || fragUrl.includes("commercial")) {
          if (!adDetected) {
            adDetected = true;
            showAlert("📢 Publicité Twitch en cours... Le son arrivera automatiquement dès la fin de l'annonce !");
          }
        }
      });

      hlsInstance.loadSource(playUrl);
      hlsInstance.attachMedia(radioAudioEl);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (volumeBar && radioAudioEl) {
          const currentVol = parseFloat(volumeBar.value) / 100;
          if (!isNaN(currentVol)) {
            radioAudioEl.volume = Math.max(0, Math.min(1, currentVol));
          }
        }
        radioAudioEl?.play().catch(console.error);
      });
      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance?.recoverMediaError();
              break;
            default:
              hlsInstance?.destroy();
              break;
          }
        }
      });
    } else {
      radioAudioEl.src = playUrl;
      await radioAudioEl.play();
    }

    await emit("radio-stream-changed", { radio, isPlaying: true }).catch(() => {});

    refreshPlayerState();
    loadRadios();

    if (isTwitch) {
      showAlert(`📻 Direct Twitch en cours : ${radio.name} (le son s'active à la fin de la pub)`);
    } else {
      showAlert(`📻 Radio en direct : ${radio.name}`);
    }
  } catch (err) {
    console.error("Erreur lors de la lecture de la radio :", err);
    await appAlert(`Impossible de lire le flux radio : ${err}`);
  }
}

export async function loadRadios() {
  try {
    const radios = await invoke<Radio[]>("get_radios");
    const grid = $("grid-radios");
    const emptyState = $("empty-radios");
    if (!grid || !emptyState) return;

    if (radios.length === 0) {
      grid.innerHTML = "";
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;
    grid.innerHTML = "";

    for (const r of radios) {
      const card = document.createElement("div");
      card.className = "radio-card";
      card.dataset.id = r.id;

      const isLive = r.is_online;
      const badgeClass = isLive ? "badge-live" : "badge-off";
      const badgeText = isLive ? "LIVE" : "OFF";

      const coverHtml = r.image_path
        ? `<img src="${await getCoverDataUrl(r.image_path)}" class="radio-cover-img" alt="${escapeHtml(r.name)}" />`
        : `<div class="radio-cover-placeholder"><i class="fa-solid fa-radio"></i></div>`;

      const isActive = activeRadio && activeRadio.id === r.id;
      const isRadioPlaying = isActive && radioAudioEl && !radioAudioEl.paused;
      const playIcon = isRadioPlaying ? "fa-pause" : "fa-play";
      const playText = isRadioPlaying ? "Pause" : "Écouter";

      const lowerUrl = r.stream_url.toLowerCase();
      const isYouTubeChannel = lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be") || r.stream_url.startsWith("@");
      const multiLiveBtnHtml = isYouTubeChannel
        ? `<button class="btn-secondary btn-small btn-switch-live" title="Choisir parmi les direct(s) de la chaîne"><i class="fa-solid fa-layer-group"></i> Directs</button>`
        : "";

      card.innerHTML = `
        <div class="radio-badge ${badgeClass}" id="radio-badge-${r.id}">
          <span class="badge-dot"></span> <span class="badge-text">${badgeText}</span>
        </div>
        <button class="radio-edit-btn btn-edit-radio" title="Éditer les métadonnées"><i class="fa-solid fa-pen"></i></button>
        <div class="radio-cover-wrapper">
          ${coverHtml}
        </div>
        <div class="radio-title" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <div class="radio-meta">${escapeHtml(r.genre || "Radio")} ${r.country ? "· " + escapeHtml(r.country) : ""} ${r.is_video ? "· 🎥 Vidéo" : ""}</div>
        <div class="radio-actions">
          <button class="btn-primary btn-small btn-play-radio" title="Écouter la station"><i class="fa-solid ${playIcon}"></i> ${playText}</button>
          ${multiLiveBtnHtml}
        </div>
      `;

      card.querySelector(".btn-play-radio")?.addEventListener("click", (e) => {
        e.stopPropagation();
        playRadio(r);
      });
      if (isYouTubeChannel) {
        card.querySelector(".btn-switch-live")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openRadioLivesModal(r);
        });
      }
      card.querySelector(".btn-edit-radio")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openRadioModal(r);
      });

      grid.appendChild(card);

      invoke<boolean>("check_radio_online", { id: r.id, streamUrl: r.stream_url })
        .then((online) => {
          const badgeEl = $(`radio-badge-${r.id}`);
          if (badgeEl) {
            badgeEl.className = `radio-badge ${online ? "badge-live" : "badge-off"}`;
            badgeEl.innerHTML = `<span class="badge-dot"></span> <span class="badge-text">${online ? "LIVE" : "OFF"}</span>`;
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error("Erreur lors du chargement des radios :", err);
  }
}

export function openRadioModal(radio?: Radio) {
  const modal = $("radio-modal");
  const title = $("radio-modal-title");
  const idInput = $<HTMLInputElement>("radio-input-id");
  const nameInput = $<HTMLInputElement>("radio-input-name");
  const urlInput = $<HTMLInputElement>("radio-input-url");
  const genreInput = $<HTMLInputElement>("radio-input-genre");
  const countryInput = $<HTMLInputElement>("radio-input-country");
  const isVideoInput = $<HTMLInputElement>("radio-input-is-video");
  const coverUrlInput = $<HTMLInputElement>("radio-input-cover-url");
  const previewImg = $<HTMLImageElement>("radio-input-cover-preview");
  const placeholder = $("radio-input-cover-placeholder");

  const deleteBtn = $<HTMLButtonElement>("radio-modal-delete");
  currentRadioCoverBase64 = null;

  if (radio) {
    if (title) title.textContent = "Éditer la Radio";
    if (deleteBtn) deleteBtn.hidden = false;
    if (idInput) idInput.value = radio.id;
    if (nameInput) nameInput.value = radio.name;
    if (urlInput) urlInput.value = radio.stream_url;
    if (genreInput) genreInput.value = radio.genre || "";
    if (countryInput) countryInput.value = radio.country || "";
    if (isVideoInput) isVideoInput.checked = radio.is_video;
    if (coverUrlInput) coverUrlInput.value = radio.image_path && (radio.image_path.startsWith("http://") || radio.image_path.startsWith("https://")) ? radio.image_path : "";

    if (radio.image_path) {
      if (radio.image_path.startsWith("http://") || radio.image_path.startsWith("https://")) {
        if (previewImg) { previewImg.src = radio.image_path; previewImg.hidden = false; }
        if (placeholder) placeholder.hidden = true;
      } else {
        getCoverDataUrl(radio.image_path).then((url) => {
          if (url) {
            if (previewImg) { previewImg.src = url; previewImg.hidden = false; }
            if (placeholder) placeholder.hidden = true;
          } else {
            if (previewImg) previewImg.hidden = true;
            if (placeholder) placeholder.hidden = false;
          }
        });
      }
    } else {
      if (previewImg) previewImg.hidden = true;
      if (placeholder) placeholder.hidden = false;
    }
  } else {
    if (title) title.textContent = "Ajouter une Radio";
    if (deleteBtn) deleteBtn.hidden = true;
    if (idInput) idInput.value = "";
    if (nameInput) nameInput.value = "";
    if (urlInput) urlInput.value = "";
    if (genreInput) genreInput.value = "";
    if (countryInput) countryInput.value = "";
    if (isVideoInput) isVideoInput.checked = false;
    if (coverUrlInput) coverUrlInput.value = "";
    if (previewImg) previewImg.hidden = true;
    if (placeholder) placeholder.hidden = false;
  }

  if (modal) {
    modal.hidden = false;
    modal.style.display = "flex";
  }
}

export function initRadioEvents() {
  listen("radio-toggle-play", () => {
    togglePlayRadio();
  }).catch(() => {});

  $("btn-add-radio")?.addEventListener("click", () => openRadioModal());
  $("radio-modal-close")?.addEventListener("click", () => {
    const modal = $("radio-modal");
    if (modal) { modal.hidden = true; modal.style.display = "none"; }
  });
  $("radio-modal-cancel")?.addEventListener("click", () => {
    const modal = $("radio-modal");
    if (modal) { modal.hidden = true; modal.style.display = "none"; }
  });

  const fileInput = $<HTMLInputElement>("radio-input-cover-file");
  const coverUrlInput = $<HTMLInputElement>("radio-input-cover-url");
  const previewImg = $<HTMLImageElement>("radio-input-cover-preview");
  const placeholder = $("radio-input-cover-placeholder");

  $("btn-select-radio-cover")?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      currentRadioCoverBase64 = evt.target?.result as string;
      if (coverUrlInput) coverUrlInput.value = "";
      if (previewImg && currentRadioCoverBase64) {
        previewImg.src = currentRadioCoverBase64;
        previewImg.hidden = false;
        if (placeholder) placeholder.hidden = true;
      }
    };
    reader.readAsDataURL(file);
  });

  const streamUrlInput = $<HTMLInputElement>("radio-input-url");
  const isVideoInput = $<HTMLInputElement>("radio-input-is-video");

  streamUrlInput?.addEventListener("input", () => {
    const val = streamUrlInput.value.trim().toLowerCase();
    if (val.includes("youtube.com") || val.includes("youtu.be") || val.includes("twitch.tv") || val.includes("twitch") || val.startsWith("@")) {
      if (isVideoInput) isVideoInput.checked = true;
    }
  });

  coverUrlInput?.addEventListener("input", () => {
    const url = coverUrlInput.value.trim();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      currentRadioCoverBase64 = url;
      if (previewImg) {
        previewImg.src = url;
        previewImg.hidden = false;
        if (placeholder) placeholder.hidden = true;
      }
    }
  });

  $("btn-fetch-radio-metadata")?.addEventListener("click", async () => {
    const streamUrlInput = $<HTMLInputElement>("radio-input-url");
    const url = streamUrlInput?.value.trim();
    if (!url) {
      await appAlert("Veuillez saisir au moins une URL ou un profil (@nom) pour détecter les métadonnées.");
      return;
    }

    showAlert("⏳ Détection automatique des métadonnées en cours...");

    try {
      const res = await invoke<RadioOnlineMetadataResult>("fetch_radio_online_metadata", { url });
      let updatedCount = 0;

      const nameInput = $<HTMLInputElement>("radio-input-name");
      const genreInput = $<HTMLInputElement>("radio-input-genre");
      const countryInput = $<HTMLInputElement>("radio-input-country");
      const isVideoInput = $<HTMLInputElement>("radio-input-is-video");
      const coverUrlInput = $<HTMLInputElement>("radio-input-cover-url");
      const previewImg = $<HTMLImageElement>("radio-input-cover-preview");
      const placeholder = $("radio-input-cover-placeholder");

      if (res.name && nameInput) {
        nameInput.value = res.name;
        updatedCount++;
      }
      if (res.genre && genreInput && !genreInput.value) {
        genreInput.value = res.genre;
        updatedCount++;
      }
      if (res.country && countryInput && !countryInput.value) {
        countryInput.value = res.country;
        updatedCount++;
      }
      if (res.is_video && isVideoInput) {
        isVideoInput.checked = true;
      }
      if (res.cover_url && coverUrlInput) {
        coverUrlInput.value = res.cover_url;
        currentRadioCoverBase64 = res.cover_url;
        if (previewImg) {
          previewImg.src = res.cover_url;
          previewImg.hidden = false;
          if (placeholder) placeholder.hidden = true;
        }
        updatedCount++;
      }

      if (updatedCount > 0) {
        showAlert("✨ Métadonnées automatiquement détectées et préremplies !");
      } else {
        await appAlert("Aucune métadonnée complémentaire n'a pu être extraite de ce lien.");
      }
    } catch (err) {
      console.error("Erreur détection métadonnées radio :", err);
      await appAlert(`Erreur de détection : ${err}`);
    }
  });

  $("radio-modal-save")?.addEventListener("click", async () => {
    const name = $<HTMLInputElement>("radio-input-name")?.value.trim();
    let stream_url = $<HTMLInputElement>("radio-input-url")?.value.trim();
    if (!name || !stream_url) {
      await appAlert("Le nom de la station et l'URL du flux streaming sont obligatoires.");
      return;
    }

    if (stream_url.startsWith("@")) {
      stream_url = `https://www.youtube.com/${stream_url}`;
    } else if (stream_url.toLowerCase().startsWith("twitch.tv/")) {
      stream_url = `https://www.${stream_url}`;
    }

    const lowerStream = stream_url.toLowerCase();
    const id = $<HTMLInputElement>("radio-input-id")?.value.trim() || undefined;
    const genre = $<HTMLInputElement>("radio-input-genre")?.value.trim();
    const country = $<HTMLInputElement>("radio-input-country")?.value.trim();
    let is_video = $<HTMLInputElement>("radio-input-is-video")?.checked || false;
    if (lowerStream.includes("youtube.com") || lowerStream.includes("youtu.be") || lowerStream.includes("twitch.tv") || lowerStream.includes("twitch")) {
      is_video = true;
    }

    const coverUrl = coverUrlInput?.value.trim();

    const image_base64 = coverUrl && (coverUrl.startsWith("http://") || coverUrl.startsWith("https://"))
      ? coverUrl
      : (currentRadioCoverBase64 || undefined);

    const input: RadioInput = {
      id,
      name,
      stream_url,
      genre: genre || "",
      country: country || "",
      is_video,
      image_base64,
    };

    try {
      await invoke("save_radio", { input });
      const modal = $("radio-modal");
      if (modal) { modal.hidden = true; modal.style.display = "none"; }
      loadRadios();
    } catch (err) {
      console.error("Erreur lors de l'enregistrement de la radio :", err);
      await appAlert(`Erreur lors de l'enregistrement : ${err}`);
    }
  });

  $("radio-modal-delete")?.addEventListener("click", async () => {
    const id = $<HTMLInputElement>("radio-input-id")?.value;
    const name = $<HTMLInputElement>("radio-input-name")?.value;
    if (!id) return;
    if (await appConfirm(`Supprimer la station radio « ${name || "sélectionnée"} » ?`)) {
      try {
        await invoke("delete_radio", { id });
        const modal = $("radio-modal");
        if (modal) { modal.hidden = true; modal.style.display = "none"; }
        loadRadios();
      } catch (err) {
        console.error("Erreur lors de la suppression de la radio :", err);
        await appAlert(`Impossible de supprimer la radio : ${err}`);
      }
    }
  });

  $("radio-lives-modal-close")?.addEventListener("click", () => {
    const modal = $("radio-lives-modal");
    if (modal) { modal.hidden = true; modal.style.display = "none"; }
  });
  $("radio-lives-modal-cancel")?.addEventListener("click", () => {
    const modal = $("radio-lives-modal");
    if (modal) { modal.hidden = true; modal.style.display = "none"; }
  });
}

export async function openRadioLivesModal(radio: Radio) {
  const modal = $("radio-lives-modal");
  const title = $("radio-lives-modal-title");
  const list = $("radio-lives-list");
  if (!modal || !list) return;

  if (title) title.innerHTML = `<i class="fa-solid fa-tower-cell" style="color: var(--accent, #1db954);"></i> Directs de ${escapeHtml(radio.name)}`;
  list.innerHTML = `<div class="settings-desc" style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Recherche des direct(s) en cours sur la chaîne...</div>`;

  modal.hidden = false;
  modal.style.display = "flex";

  try {
    const streams = await invoke<ChannelLiveStreamItem[]>("get_channel_live_streams", { url: radio.stream_url });
    if (streams.length === 0) {
      list.innerHTML = `<div class="settings-desc" style="text-align: center; padding: 20px;">Aucun flux en direct actif trouvé sur cette chaîne (ou la chaîne n'est pas en direct).</div>`;
      return;
    }

    list.innerHTML = "";
    for (const item of streams) {
      const el = document.createElement("div");
      el.className = "radio-live-item";
      el.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 0.2s ease;";
      
      const thumbHtml = item.thumbnail_url
        ? `<img src="${item.thumbnail_url}" style="width: 80px; height: 45px; border-radius: 6px; object-fit: cover;" alt="thumb" />`
        : `<div style="width: 80px; height: 45px; border-radius: 6px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-video"></i></div>`;

      el.innerHTML = `
        ${thumbHtml}
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.9rem; font-weight: 500; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div style="font-size: 0.75rem; color: var(--accent, #1db954); margin-top: 2px;"><i class="fa-solid fa-circle" style="font-size: 8px;"></i> EN DIRECT</div>
        </div>
        <button class="btn-primary btn-small" style="white-space: nowrap;"><i class="fa-solid fa-play"></i> Écouter</button>
      `;

      el.addEventListener("click", () => {
        modal.hidden = true;
        modal.style.display = "none";

        const targetRadio: Radio = {
          ...radio,
          stream_url: item.url,
          name: `${radio.name} (${item.title})`,
          image_path: radio.image_path,
        };

        playRadio(targetRadio);
      });

      list.appendChild(el);
    }
  } catch (err) {
    console.error("Erreur lors de la récupération des directs :", err);
    list.innerHTML = `<div class="settings-desc" style="text-align: center; padding: 20px; color: #ff6b6b;">Impossible de récupérer les direct(s) : ${escapeHtml(String(err))}</div>`;
  }
}
