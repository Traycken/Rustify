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

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { $, getCoverDataUrl } from "../state";
import type { Radio, RadioInput, PlayerState } from "../types";
import { escapeHtml } from "../utils/formatting";
import { appAlert, appConfirm, showAlert } from "../utils/dialog";

let currentRadioCoverBase64: string | null = null;
let activeRadio: Radio | null = null;
let radioAudioEl: HTMLAudioElement | null = null;

export function getActiveRadio(): Radio | null {
  return activeRadio;
}

export function getRadioAudioEl(): HTMLAudioElement | null {
  return radioAudioEl;
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

export async function playRadio(radio: Radio) {
  try {
    activeRadio = radio;
    let playUrl = radio.stream_url;

    showAlert(`⏳ Connexion à la radio ${radio.name}...`);

    if (radio.is_video || playUrl.includes("youtube.com") || playUrl.includes("youtu.be")) {
      const resolved = await invoke<string>("resolve_video_audio_stream", { url: radio.stream_url });
      if (resolved) playUrl = resolved;
    }

    await invoke("stop").catch(() => {});

    if (!radioAudioEl) {
      radioAudioEl = new Audio();
      radioAudioEl.crossOrigin = "anonymous";
    }

    radioAudioEl.pause();
    radioAudioEl.src = playUrl;

    try {
      const state = await invoke<PlayerState>("get_player_state");
      if (state && typeof state.volume === "number") {
        radioAudioEl.volume = state.volume;
      }
      if (state && state.audio_device) {
        await syncRadioAudioDevice(state.audio_device);
      }
    } catch {}

    await radioAudioEl.play();
    await emit("radio-stream-changed", { radio, isPlaying: true }).catch(() => {});

    const nowTitle = $("now-title");
    const nowArtist = $("now-artist");
    const btnPlay = $("btn-play");

    if (nowTitle) nowTitle.textContent = radio.name;
    if (nowArtist) nowArtist.textContent = `Radio en Direct${radio.country ? " (" + radio.country + ")" : ""}`;
    if (btnPlay) btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';

    showAlert(`📻 Radio en direct : ${radio.name}`);
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

      card.innerHTML = `
        <div class="radio-badge ${badgeClass}" id="radio-badge-${r.id}">
          <span class="badge-dot"></span> <span class="badge-text">${badgeText}</span>
        </div>
        <div class="radio-cover-wrapper">
          ${coverHtml}
        </div>
        <div class="radio-title" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <div class="radio-meta">${escapeHtml(r.genre || "Radio")} ${r.country ? "· " + escapeHtml(r.country) : ""} ${r.is_video ? "· 🎥 Vidéo" : ""}</div>
        <div class="radio-actions">
          <button class="btn-primary btn-small btn-play-radio" title="Écouter la station"><i class="fa-solid fa-play"></i> Écouter</button>
          <button class="btn-secondary btn-small btn-edit-radio" title="Éditer les métadonnées"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-secondary btn-small btn-delete-radio btn-danger" title="Supprimer la radio"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

      card.querySelector(".btn-play-radio")?.addEventListener("click", (e) => {
        e.stopPropagation();
        playRadio(r);
      });
      card.querySelector(".btn-edit-radio")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openRadioModal(r);
      });
      card.querySelector(".btn-delete-radio")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (await appConfirm(`Supprimer la station radio « ${r.name} » ?`)) {
          await invoke("delete_radio", { id: r.id });
          loadRadios();
        }
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

  currentRadioCoverBase64 = null;

  if (radio) {
    if (title) title.textContent = "Éditer la Radio";
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

  $("radio-modal-save")?.addEventListener("click", async () => {
    const name = $<HTMLInputElement>("radio-input-name")?.value.trim();
    const stream_url = $<HTMLInputElement>("radio-input-url")?.value.trim();
    if (!name || !stream_url) {
      await appAlert("Le nom de la station et l'URL du flux streaming sont obligatoires.");
      return;
    }

    const id = $<HTMLInputElement>("radio-input-id")?.value.trim() || undefined;
    const genre = $<HTMLInputElement>("radio-input-genre")?.value.trim();
    const country = $<HTMLInputElement>("radio-input-country")?.value.trim();
    const is_video = $<HTMLInputElement>("radio-input-is-video")?.checked || false;
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
}
