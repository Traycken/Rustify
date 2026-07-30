/**
 * ============================================================================
 * Rustify — Mini Lecteur Overlay Vinyle (src/player/overlay.ts)
 * ----------------------------------------------------------------------------
 * Ce module contrôle la fenêtre Overlay vinyle flottante (ouverture,
 * fermeture, mode clic traversant transparent/interactif et mise à jour UI).
 * 
 * Sommaire des exportations :
 * - openOverlayWindow() : Ouvre la fenêtre overlay dédiée via Rust Tauri.
 * - closeOverlayWindow() : Ferme la fenêtre overlay.
 * - toggleClickThrough() : Active/désactive les clics traversants.
 * - updateOverlayUI(state, activeRadio) : Met à jour la pochette, le titre et l'anneau.
 * - initOverlayEvents(callbacks) : Attache les événements des boutons HUD de l'overlay.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { $, getCoverDataUrl, smartShuffleActive } from "../state";
import { emit, listen } from "@tauri-apps/api/event";
import type { PlayerState, Radio } from "../types";
import { setRadioVolume } from "../tabs/radiosTab";

let currentOverlayRadio: Radio | null = null;
let currentOverlayRadioPlaying = false;

listen<{ radio: Radio | null; isPlaying: boolean }>("radio-stream-changed", (event) => {
  if (event.payload.radio !== undefined) {
    currentOverlayRadio = event.payload.radio;
  }
  currentOverlayRadioPlaying = !!event.payload.isPlaying;
  invoke<PlayerState>("get_player_state").then((state) => {
    updateOverlayUI(state, currentOverlayRadio, null, currentOverlayRadioPlaying);
  }).catch(() => {});
}).catch(() => {});
import { fmtTime, updateSliderTrack } from "../utils/formatting";

let isClickThroughLocked = false;

export async function openOverlayWindow() {
  try {
    await invoke("open_overlay_window");
  } catch (e) {
    console.error("Erreur ouverture de la fenêtre Overlay", e);
  }
}

export async function closeOverlayWindow() {
  try {
    if (isClickThroughLocked) {
      isClickThroughLocked = false;
      await invoke("set_overlay_click_through", { ignore: false });
    }
    await invoke("close_overlay_window");
  } catch (e) {
    console.error("Erreur fermeture de la fenêtre Overlay", e);
  }
}

export async function toggleClickThrough() {
  isClickThroughLocked = !isClickThroughLocked;
  await invoke("set_overlay_click_through", { ignore: isClickThroughLocked });
}

export function updateOverlayUI(state: PlayerState, activeRadio?: Radio | null, radioAudioEl?: HTMLAudioElement | null, activeRadioPlaying?: boolean) {
  const overlayTitle = $("overlay-title");
  const overlayArtist = $("overlay-artist");
  const overlayRingFill = $("overlay-ring-fill");
  const overlayTimeRemaining = $("overlay-time-remaining");
  const overlayCoverImg = $<HTMLImageElement>("overlay-cover-img");
  const overlayCoverPlaceholder = $("overlay-cover-placeholder");
  const overlayBtnPlay = $("overlay-btn-play");
  const overlayBtnFav = $("overlay-btn-fav");
  const overlayBtnEcstasy = $("overlay-btn-ecstasy");
  const overlayBtnRepeat = $("overlay-btn-repeat");
  const overlayBtnShuffle = $("overlay-btn-shuffle");
  const overlayVinylGrooves = $("overlay-vinyl-grooves");
  const overlayVolumeSlider = $<HTMLInputElement>("overlay-volume-slider");
  const overlayBtnVolume = $("overlay-btn-volume");

  if (!overlayTitle) return;

  const targetRadio = activeRadio || currentOverlayRadio;
  const isRadioActive = !!(targetRadio && (targetRadio.stream_url || (radioAudioEl && radioAudioEl.src)));
  const isRadioPlaying = isRadioActive && (radioAudioEl ? !radioAudioEl.paused : (activeRadioPlaying || currentOverlayRadioPlaying));
  const isPlaying = state.is_playing || isRadioPlaying;

  if (isRadioActive && targetRadio) {
    overlayTitle.textContent = targetRadio.name;
    overlayArtist.textContent = `Radio en Direct${targetRadio.country ? " (" + targetRadio.country + ")" : ""}`;
    if (overlayRingFill) overlayRingFill.style.strokeDashoffset = "257";
    if (overlayTimeRemaining) overlayTimeRemaining.textContent = "LIVE";

    if (overlayCoverImg && overlayCoverPlaceholder) {
      if (targetRadio.image_path) {
        if (targetRadio.image_path.startsWith("http://") || targetRadio.image_path.startsWith("https://")) {
          overlayCoverImg.src = targetRadio.image_path;
          overlayCoverImg.hidden = false;
          overlayCoverPlaceholder.hidden = true;
        } else {
          getCoverDataUrl(targetRadio.image_path).then((url) => {
            if (url) {
              overlayCoverImg.src = url;
              overlayCoverImg.hidden = false;
              overlayCoverPlaceholder.hidden = true;
            } else {
              overlayCoverImg.hidden = true;
              overlayCoverPlaceholder.hidden = false;
            }
          });
        }
      } else {
        overlayCoverImg.hidden = true;
        overlayCoverPlaceholder.hidden = false;
      }
    }
    if (overlayBtnFav) overlayBtnFav.innerHTML = '<i class="fa-regular fa-star"></i>';
    if (overlayBtnEcstasy) overlayBtnEcstasy.innerHTML = '<i class="fa-regular fa-heart"></i>';
  } else if (state.current_track) {
    overlayTitle.textContent = state.current_track.title;
    overlayArtist.textContent = state.current_track.artist;

    const dur = state.current_track.duration_secs || 1;
    const pct = Math.min(100, Math.max(0, (state.position_secs / dur) * 100));
    if (overlayRingFill) {
      const maxArc = 257;
      const offset = maxArc - (maxArc * pct) / 100;
      overlayRingFill.style.strokeDashoffset = String(offset);
    }

    if (overlayTimeRemaining) {
      const remSecs = Math.max(0, (state.current_track.duration_secs || 0) - state.position_secs);
      overlayTimeRemaining.textContent = `-${fmtTime(remSecs)}`;
    }

    if (overlayCoverImg && overlayCoverPlaceholder) {
      if (state.current_track.cover_path) {
        getCoverDataUrl(state.current_track.cover_path).then((url) => {
          if (url) {
            overlayCoverImg.src = url;
            overlayCoverImg.hidden = false;
            overlayCoverPlaceholder.hidden = true;
          } else {
            overlayCoverImg.hidden = true;
            overlayCoverPlaceholder.hidden = false;
          }
        });
      } else {
        overlayCoverImg.hidden = true;
        overlayCoverPlaceholder.hidden = false;
      }
    }

    if (overlayBtnFav) {
      const isFav = !!state.current_track.is_favorite;
      overlayBtnFav.innerHTML = isFav
        ? '<i class="fa-solid fa-star" style="color: #f1c40f;"></i>'
        : '<i class="fa-regular fa-star"></i>';
    }

    if (overlayBtnEcstasy) {
      const isExt = !!state.current_track.is_ecstasy;
      overlayBtnEcstasy.innerHTML = isExt
        ? '<i class="fa-solid fa-heart" style="color: #ff4757;"></i>'
        : '<i class="fa-regular fa-heart"></i>';
    }
  } else {
    overlayTitle.textContent = "Aucune lecture";
    overlayArtist.textContent = "—";
    if (overlayRingFill) overlayRingFill.style.strokeDashoffset = "257";
    if (overlayTimeRemaining) overlayTimeRemaining.textContent = "-0:00";
    if (overlayCoverImg) overlayCoverImg.hidden = true;
    if (overlayCoverPlaceholder) overlayCoverPlaceholder.hidden = false;
    if (overlayBtnFav) overlayBtnFav.innerHTML = '<i class="fa-regular fa-star"></i>';
    if (overlayBtnEcstasy) overlayBtnEcstasy.innerHTML = '<i class="fa-regular fa-heart"></i>';
  }

  if (overlayBtnPlay) {
    overlayBtnPlay.innerHTML = isPlaying
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
  }

  if (overlayVinylGrooves) overlayVinylGrooves.classList.toggle("spinning", isPlaying);
  if (overlayCoverImg) overlayCoverImg.classList.toggle("spinning", isPlaying);

  if (overlayBtnRepeat) overlayBtnRepeat.classList.toggle("active", state.repeat);
  if (overlayBtnShuffle) overlayBtnShuffle.classList.toggle("active", smartShuffleActive);

  if (overlayVolumeSlider) {
    overlayVolumeSlider.value = String(Math.round((state.volume || 0.8) * 100));
    updateSliderTrack(overlayVolumeSlider);
  }
  if (overlayBtnVolume) {
    const volPct = Math.round((state.volume || 0.8) * 100);
    const volIcon = volPct === 0 ? "fa-volume-xmark" : volPct < 0.5 ? "fa-volume-low" : "fa-volume-high";
    overlayBtnVolume.innerHTML = `<i class="fa-solid ${volIcon}"></i>`;
  }
}

export function initOverlayEvents(callbacks: {
  togglePlay: () => void;
  prevTrack: () => void;
  nextTrack: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleFavCurrent: () => void;
  toggleEcstasyCurrent: () => void;
  setVolume: (val: number) => void;
}) {
  $("overlay-btn-close")?.addEventListener("click", closeOverlayWindow);

  $("overlay-btn-play")?.addEventListener("click", () => {
    emit("radio-toggle-play").catch(() => {});
    callbacks.togglePlay();
  });
  $("overlay-btn-prev")?.addEventListener("click", callbacks.prevTrack);
  $("overlay-btn-next")?.addEventListener("click", callbacks.nextTrack);
  $("overlay-btn-shuffle")?.addEventListener("click", callbacks.toggleShuffle);
  $("overlay-btn-repeat")?.addEventListener("click", callbacks.toggleRepeat);
  $("overlay-btn-fav")?.addEventListener("click", callbacks.toggleFavCurrent);
  $("overlay-btn-ecstasy")?.addEventListener("click", callbacks.toggleEcstasyCurrent);

  // Déplacement de la fenêtre Overlay par glissement du vinyle
  const disc = $("overlay-vinyl-disc");
  if (disc) {
    disc.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        const target = e.target as HTMLElement;
        if (
          !target.closest(".overlay-hud-btn") &&
          !target.closest("#overlay-volume-popover") &&
          !target.classList.contains("ring-hit")
        ) {
          getCurrentWindow().startDragging();
        }
      }
    });
  }

  // Popover du volume
  const volBtn = $("overlay-btn-volume");
  const volPop = $("overlay-volume-popover");
  if (volBtn && volPop) {
    volBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      volPop.hidden = !volPop.hidden;
    });

    // Fermeture automatique si on clique ailleurs
    document.addEventListener("click", (e) => {
      if (!volPop.hidden) {
        const target = e.target as Node;
        if (!volPop.contains(target) && !volBtn.contains(target)) {
          volPop.hidden = true;
        }
      }
    });

    // Fermeture automatique si la souris sort de la fenêtre ou du disque
    const closePop = () => {
      if (volPop) volPop.hidden = true;
    };
    window.addEventListener("mouseleave", closePop);
    document.addEventListener("mouseleave", closePop);
    disc?.addEventListener("mouseleave", closePop);
  }

  const volSlider = $<HTMLInputElement>("overlay-volume-slider");
  if (volSlider) {
    volSlider.addEventListener("click", (e) => e.stopPropagation());
    volSlider.addEventListener("input", (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value) / 100;
      callbacks.setVolume(val);
      setRadioVolume(val);
      updateSliderTrack(volSlider);
    });
  }

  const ringBox = $("overlay-progress-ring-box");
  if (ringBox) {
    ringBox.addEventListener("click", async (e) => {
      const rect = ringBox.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;

      let angle = Math.atan2(dy, dx) + Math.PI / 2;
      if (angle < 0) angle += 2 * Math.PI;

      const pct = Math.min(1, Math.max(0, angle / (2 * Math.PI)));
      try {
        const state = await invoke<PlayerState>("get_player_state");
        if (state && state.current_track && state.current_track.duration_secs) {
          const targetSecs = state.current_track.duration_secs * pct;
          await invoke("seek", { positionSecs: targetSecs });
        }
      } catch (err) {
        console.error("Erreur navigation temporelle overlay :", err);
      }
    });
  }
}
