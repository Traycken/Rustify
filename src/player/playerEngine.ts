/**
 * ============================================================================
 * Rustify — Moteur de Lecture Audio & Smart Shuffle (src/player/playerEngine.ts)
 * ----------------------------------------------------------------------------
 * Ce module orchestre le moteur de lecture (play, pause, seek, queue, volume),
 * l'algorithme Smart Shuffle (statistiques, feedback, prédiction de la piste suivante),
 * et la mise à jour fluide de la barre de lecture (100ms).
 * 
 * Sommaire des exportations :
 * - playFromQueue(queue, index, isManual) : Lance la lecture d'une file d'attente.
 * - refreshPlayerState() : Interroge le backend Rust pour récupérer l'état du lecteur.
 * - applyPlayerState(state) : Applique l'état du lecteur au DOM principal & overlay.
 * - restoreLastPlayerState() : Restaure la dernière session au démarrage.
 * - registerListenEventBeforeSkip() : Enregistre le taux d'écoute avant un skip.
 * - setSmartShuffleState(active), toggleSmartShuffle() : Contrôle du Smart Shuffle.
 * - calculateNextSmartTrack(), playFromSmartTrack(track) : Calcul et enchaînement IA.
 * - updateSmartNextIndicator(), bindAlgoFeedbackButtons() : UI du Smart Shuffle.
 * - updateSmoothProgress(), pollState() : Boucle de rafraîchissement continu.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import {
  $,
  isSeeking,
  lastPlayerState,
  setLastPlayerState,
  lastPlayerStateTimestamp,
  setLastPlayerStateTimestamp,
  currentAudioDevice,
  setCurrentAudioDevice,
  smartShuffleActive,
  setSmartShuffleActive,
  nextSmartTrack,
  setNextSmartTrack,
  isComputingNextSmart,
  setIsComputingNextSmart,
  lastKnownTrackId,
  setLastKnownTrackId,
  lastKnownTrackForSkip,
  setLastKnownTrackForSkip,
  algoFeedbackState,
  setAlgoFeedbackState,
  algoButtonsTrackId,
  setAlgoButtonsTrackId,
  incrementSaveStateCounter,
  getCoverDataUrl,
  currentQueue,
  setCurrentQueue,
  activeMoodPlaylistOption,
  activeSmartShufflePlaylistId,
  activeSmartShufflePlaylistName,
  setActiveSmartShufflePlaylistId,
  setActiveSmartShufflePlaylistName,
} from "../state";
import type { PlayerState, Track, LastPlayerState, SmartSession, AlgoFeedbackState, Radio } from "../types";
import { fmtTime, updateSliderTrack } from "../utils/formatting";
import { updateOverlayUI } from "./overlay";
import { getOrientedMoodTrack } from "../tabs/moodTab";
import { updateLyricsButtonsState, updateLyricsSyncHighlight } from "../modals/lyricsModal";
import { showToast } from "../utils/toast";

export interface PlayerEngineCallbacks {
  renderAudioDeviceUI: () => void;
  onStateApplied: () => void;
  getActiveRadio: () => Radio | null;
  getRadioAudioEl: () => HTMLAudioElement | null;
  stopRadio: () => void;
  activeRadioPlaying: boolean;
}

let playerCallbacks: Partial<PlayerEngineCallbacks> = {};

export function setPlayerEngineCallbacks(callbacks: Partial<PlayerEngineCallbacks>) {
  playerCallbacks = { ...playerCallbacks, ...callbacks };
}

export async function playFromQueue(queue: Track[], index: number, isManual: boolean = true) {
  try {
    playerCallbacks.stopRadio?.();
    const upcoming = queue.slice(index + 1);
    setCurrentQueue(upcoming);
    await invoke("play_track", { queue, startIndex: index, isManual });
    await refreshPlayerState();
  } catch (err) {
    console.error("Erreur lecture piste :", err);
  }
}

export async function refreshPlayerState() {
  try {
    const state = await invoke<PlayerState>("get_player_state");
    applyPlayerState(state);
  } catch (err) {
    console.error("Erreur actualisation lecteur :", err);
  }
}

export function updateAlgoButtonsUI() {
  const likeBtn = $<HTMLButtonElement>("btn-algo-like");
  const dislikeBtn = $<HTMLButtonElement>("btn-algo-dislike");
  if (!likeBtn || !dislikeBtn) return;

  if (algoFeedbackState === "liked") {
    likeBtn.disabled = true;
    dislikeBtn.disabled = true;
    dislikeBtn.classList.remove("skip-mode");
    dislikeBtn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
    dislikeBtn.title = "❌ Mauvaise proposition — l'IA s'adapte";
  } else if (algoFeedbackState === "disliked") {
    likeBtn.disabled = true;
    dislikeBtn.disabled = false;
    dislikeBtn.classList.add("skip-mode");
    dislikeBtn.innerHTML = '<i class="fa-solid fa-forward-step"></i>';
    dislikeBtn.title = "Passer ce morceau (Skip)";
  } else {
    likeBtn.disabled = false;
    dislikeBtn.disabled = false;
    dislikeBtn.classList.remove("skip-mode");
    dislikeBtn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
    dislikeBtn.title = "❌ Mauvaise proposition — l'IA s'adapte";
  }
}

export async function setSmartShuffleState(active: boolean) {
  setSmartShuffleActive(active);
  await invoke("set_smart_shuffle_active", { active }).catch(() => {});

  const btnShuffle = $("btn-shuffle");
  if (btnShuffle) btnShuffle.classList.toggle("active", active);
  const overlayBtnShuffle = $("overlay-btn-shuffle");
  if (overlayBtnShuffle) overlayBtnShuffle.classList.toggle("active", active);

  const algoLike = $<HTMLButtonElement>("btn-algo-like");
  const algoDislike = $<HTMLButtonElement>("btn-algo-dislike");
  const indicator = $("smart-next-indicator");
  if (algoLike) algoLike.hidden = !active;
  if (algoDislike) algoDislike.hidden = !active;
  if (indicator) indicator.hidden = !active;

  if (active) {
    await invoke("get_or_create_smart_session").catch(() => {});
    calculateNextSmartTrack();
  } else {
    await invoke("set_smart_shuffle_playlist", { playlistId: null }).catch(() => {});
    setActiveSmartShufflePlaylistId(null);
    setActiveSmartShufflePlaylistName(null);
    setNextSmartTrack(null);
    updateSmartNextIndicator();
  }
}

export async function toggleSmartShuffle() {
  try {
    const nextState = !smartShuffleActive;
    await setSmartShuffleState(nextState);
    await refreshPlayerState();
  } catch (err) {
    console.error("Erreur bascule Smart Shuffle :", err);
  }
}

export function updateSmartNextIndicator() {
  const indicator = $("smart-next-indicator");
  const label = $("smart-next-label");
  if (!indicator || !label) return;
  if (nextSmartTrack && smartShuffleActive) {
    const plBadge = activeSmartShufflePlaylistName ? `[${activeSmartShufflePlaylistName}] ` : "";
    label.textContent = `${plBadge}${nextSmartTrack.title} — ${nextSmartTrack.artist}`;
    indicator.hidden = false;
  } else {
    indicator.hidden = true;
  }
}

export async function startSmartShuffleForPlaylist(playlistId: string, playlistName?: string) {
  try {
    const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId });
    if (!tracks || tracks.length === 0) {
      showToast("Cette playlist est vide.", "warning");
      return;
    }

    await invoke("set_smart_shuffle_playlist", { playlistId });
    setActiveSmartShufflePlaylistId(playlistId);
    setActiveSmartShufflePlaylistName(playlistName || "Playlist");

    await setSmartShuffleState(true);

    setCurrentQueue([...tracks]);

    const session = await invoke<SmartSession>("get_or_create_smart_session");
    const excludeIds = session.recent_track_ids ?? [];
    const firstTrack = await invoke<Track>("get_next_smart_track", { excludeIds, queueIds: [] }).catch(() => tracks[0]);

    if (firstTrack) {
      await playFromSmartTrack(firstTrack);
    } else {
      await playFromQueue(tracks, 0);
    }

    showToast(`Smart Shuffle activé pour : ${playlistName || 'la playlist'} ✨`, "success");
  } catch (err) {
    console.error("Erreur lors du démarrage du Smart Shuffle sur la playlist :", err);
    showToast("Impossible de démarrer le Smart Shuffle sur la playlist.", "error");
  }
}

export async function calculateNextSmartTrack() {
  if (isComputingNextSmart || !smartShuffleActive) return;
  setIsComputingNextSmart(true);
  try {
    if (currentQueue.length > 0) {
      setNextSmartTrack(currentQueue[0]);
      updateSmartNextIndicator();
      return;
    }
    const session = await invoke<SmartSession>("get_or_create_smart_session");
    const excludeIds = session.recent_track_ids ?? [];

    if (activeMoodPlaylistOption) {
      const moodTrack = getOrientedMoodTrack(excludeIds);
      if (moodTrack) {
        setNextSmartTrack(moodTrack);
        updateSmartNextIndicator();
        return;
      }
    }

    const queueIds = currentQueue.map((t) => t.id);
    const track = await invoke<Track>("get_next_smart_track", { excludeIds, queueIds });
    setNextSmartTrack(track);
    updateSmartNextIndicator();
  } catch {
    /* silencieux */
  } finally {
    setIsComputingNextSmart(false);
  }
}

export async function playFromSmartTrack(track: Track) {
  try {
    if (currentQueue.length > 0 && (currentQueue[0].id === track.id || currentQueue[0].path === track.path)) {
      currentQueue.shift();
    } else {
      const idx = currentQueue.findIndex((t) => t.id === track.id || t.path === track.path);
      if (idx !== -1) {
        currentQueue.splice(idx, 1);
      }
    }
    await invoke("play_track", { queue: [track], startIndex: 0, isManual: false });
    setLastKnownTrackId(track.id);
    setLastKnownTrackForSkip(track);
    await refreshPlayerState();
  } catch {
    /* silencieux */
  }
}

export async function registerListenEventBeforeSkip() {
  if (!lastPlayerState?.current_track) return;
  const track = lastPlayerState.current_track;
  const elapsed = (performance.now() - lastPlayerStateTimestamp) / 1000;
  const positionSecs = Math.min(
    track.duration_secs || 0,
    (lastPlayerState.position_secs || 0) + elapsed
  );
  try {
    await invoke("register_listen_event", {
      trackId: track.id,
      positionSecs,
      durationSecs: track.duration_secs || 0,
    });
  } catch {
    /* silencieux */
  }
}

export function bindAlgoFeedbackButtons() {
  updateAlgoButtonsUI();

  $("btn-algo-like")?.addEventListener("click", async () => {
    if (algoFeedbackState !== "idle") return;
    if (!lastPlayerState?.current_track) return;
    const btn = $("btn-algo-like");

    setAlgoFeedbackState("liked");
    updateAlgoButtonsUI();

    try {
      const queueIds = currentQueue.map((t) => t.id);
      const nextTrack = await invoke<Track>("submit_algo_feedback", {
        trackId: lastPlayerState.current_track.id,
        liked: true,
        queueIds,
      });
      setNextSmartTrack(nextTrack);
      updateSmartNextIndicator();
      btn?.classList.add("feedback-flash");
      setTimeout(() => btn?.classList.remove("feedback-flash"), 650);
    } catch { /* silencieux */ }
  });

  $("btn-algo-dislike")?.addEventListener("click", async () => {
    if (!lastPlayerState?.current_track) return;
    const btn = $("btn-algo-dislike");

    if (algoFeedbackState === "idle") {
      setAlgoFeedbackState("disliked");
      updateAlgoButtonsUI();

      try {
        const queueIds = currentQueue.map((t) => t.id);
        const nextTrack = await invoke<Track>("submit_algo_feedback", {
          trackId: lastPlayerState.current_track.id,
          liked: false,
          queueIds,
        });
        setNextSmartTrack(nextTrack);
        updateSmartNextIndicator();
        btn?.classList.add("feedback-flash");
        setTimeout(() => btn?.classList.remove("feedback-flash"), 650);
      } catch { /* silencieux */ }
      return;
    }

    if (algoFeedbackState === "disliked") {
      if (btn) (btn as HTMLButtonElement).disabled = true;
      await registerListenEventBeforeSkip();
      const oldTrack = lastKnownTrackForSkip;
      if (oldTrack) {
        await invoke("update_smart_session", {
          trackId: oldTrack.id,
          eventType: "skip",
          trackGenre: oldTrack.genre || null,
          trackArtist: oldTrack.artist || null,
          trackBpm: oldTrack.bpm ?? null,
        }).catch(() => {});
      }
      if (nextSmartTrack) {
        const toPlay = nextSmartTrack;
        setNextSmartTrack(null);
        await playFromSmartTrack(toPlay);
        calculateNextSmartTrack();
      } else {
        await invoke("next_track");
        await refreshPlayerState();
      }
    }
  });
}

export function applyPlayerState(state: PlayerState) {
  setLastPlayerState(state);
  setLastPlayerStateTimestamp(performance.now());

  if (state.smart_shuffle_active !== undefined && state.smart_shuffle_active !== smartShuffleActive) {
    setSmartShuffleState(state.smart_shuffle_active);
  }

  const nowTitle = $("now-title");
  const nowArtist = $("now-artist");
  const seekBar = $<HTMLInputElement>("seek");
  const volumeBar = $<HTMLInputElement>("volume");
  const timeCurrent = $("time-current");
  const timeTotal = $("time-total");
  const btnPlay = $("btn-play");
  const btnShuffle = $("btn-shuffle");
  const btnRepeat = $("btn-repeat");
  const vinyl = $("vinyl");
  const vinylCover = $("vinyl-cover");
  const nowLikesEl = $("now-likes");
  const nowDislikesEl = $("now-dislikes");
  const btnFavNow = $("btn-fav-now");
  const btnEcstasyNow = $("btn-ecstasy-now");

  const activeRadio = playerCallbacks.getActiveRadio?.() ?? null;
  const radioAudioEl = playerCallbacks.getRadioAudioEl?.() ?? null;
  const isRadioActive = !!(activeRadio && radioAudioEl && radioAudioEl.src);

  if (isRadioActive && activeRadio) {
    if (nowTitle) nowTitle.textContent = activeRadio.name;
    if (nowArtist) nowArtist.textContent = `Radio en Direct${activeRadio.country ? " (" + activeRadio.country + ")" : ""}`;
    if (seekBar) seekBar.max = "0";
    if (timeTotal) timeTotal.textContent = "LIVE";
    if (timeCurrent) timeCurrent.textContent = "LIVE";

    if (nowLikesEl) nowLikesEl.textContent = "0";
    if (nowDislikesEl) nowDislikesEl.textContent = "0";

    if (activeRadio.image_path) {
      if (activeRadio.image_path.startsWith("http://") || activeRadio.image_path.startsWith("https://")) {
        if (vinylCover) vinylCover.style.backgroundImage = `url("${activeRadio.image_path}")`;
      } else {
        getCoverDataUrl(activeRadio.image_path).then((dataUrl) => {
          if (dataUrl && vinylCover) {
            vinylCover.style.backgroundImage = `url("${dataUrl}")`;
          } else if (vinylCover) {
            vinylCover.style.backgroundImage = "";
          }
        });
      }
    } else if (vinylCover) {
      vinylCover.style.backgroundImage = "";
    }
  } else if (state.current_track) {
    if (nowTitle) nowTitle.textContent = state.current_track.title;
    if (nowArtist) nowArtist.textContent = state.current_track.artist;
    if (seekBar) seekBar.max = String(state.current_track.duration_secs || 0);
    if (timeTotal) timeTotal.textContent = fmtTime(state.current_track.duration_secs);

    if (nowLikesEl) nowLikesEl.textContent = String(state.current_track.likes || 0);
    if (nowDislikesEl) nowDislikesEl.textContent = String(state.current_track.dislikes || 0);
    if (btnFavNow) {
      const isFav = !!state.current_track.is_favorite;
      btnFavNow.classList.toggle("is-fav", isFav);
      btnFavNow.innerHTML = isFav ? '<i class="fa-solid fa-star" style="color: #f1c40f;"></i>' : '<i class="fa-regular fa-star"></i>';
    }
    if (btnEcstasyNow) {
      const isExt = !!state.current_track.is_ecstasy;
      btnEcstasyNow.classList.toggle("is-ecstasy", isExt);
      btnEcstasyNow.innerHTML = isExt ? '<i class="fa-solid fa-heart" style="color: #ff4757;"></i>' : '<i class="fa-regular fa-heart"></i>';
    }

    if (state.current_track.cover_path) {
      getCoverDataUrl(state.current_track.cover_path).then((dataUrl) => {
        if (dataUrl && vinylCover) {
          vinylCover.style.backgroundImage = `url("${dataUrl}")`;
        } else if (vinylCover) {
          vinylCover.style.backgroundImage = "";
        }
      });
    } else if (vinylCover) {
      vinylCover.style.backgroundImage = "";
    }
  } else {
    if (nowTitle) nowTitle.textContent = "Aucune lecture";
    if (nowArtist) nowArtist.textContent = "—";
    if (nowLikesEl) nowLikesEl.textContent = "0";
    if (nowDislikesEl) nowDislikesEl.textContent = "0";
    if (btnFavNow) {
      btnFavNow.classList.remove("is-fav");
      btnFavNow.innerHTML = '<i class="fa-regular fa-star"></i>';
    }
    if (btnEcstasyNow) {
      btnEcstasyNow.classList.remove("is-ecstasy");
      btnEcstasyNow.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
    if (vinylCover) vinylCover.style.backgroundImage = "";
  }

  updateLyricsButtonsState(state.current_track || null);
  updateLyricsSyncHighlight(state.position_secs || 0, state.current_track || null);

  if (!isSeeking && seekBar && timeCurrent) {
    seekBar.value = String(state.position_secs);
    timeCurrent.textContent = fmtTime(state.position_secs);
  }
  if (seekBar) updateSliderTrack(seekBar);
  if (state.volume !== undefined && state.volume !== null && volumeBar) {
    volumeBar.value = String(Math.round(state.volume * 100));
    updateSliderTrack(volumeBar);
  }
  const isRadioPlaying = !!(radioAudioEl && !radioAudioEl.paused && radioAudioEl.src);
  const isPlaying = state.is_playing || isRadioPlaying;

  updateOverlayUI(state, activeRadio, radioAudioEl, isRadioPlaying);

  if (btnPlay) {
    btnPlay.innerHTML = isPlaying
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
  }
  if (vinyl) vinyl.classList.toggle("spinning", isPlaying);
  if (btnRepeat) btnRepeat.classList.toggle("active", state.repeat);
  if (btnShuffle) btnShuffle.classList.toggle("active", smartShuffleActive);
  const overlayBtnShuffle = $("overlay-btn-shuffle");
  if (overlayBtnShuffle) overlayBtnShuffle.classList.toggle("active", smartShuffleActive);

  const newTrackId = state.current_track?.id ?? null;
  if (newTrackId) {
    if (currentQueue.length > 0 && (currentQueue[0].id === newTrackId || currentQueue[0].path === state.current_track?.path)) {
      currentQueue.shift();
    } else {
      const qIdx = currentQueue.findIndex((t) => t.id === newTrackId || t.path === state.current_track?.path);
      if (qIdx !== -1) {
        currentQueue.splice(qIdx, 1);
      }
    }
  }

  if (smartShuffleActive && lastKnownTrackId && newTrackId && lastKnownTrackId !== newTrackId) {
    const oldTrack = lastKnownTrackForSkip;
    if (oldTrack) {
      invoke("update_smart_session", {
        trackId: oldTrack.id,
        eventType: "complete",
        trackGenre: oldTrack.genre || null,
        trackArtist: oldTrack.artist || null,
        trackBpm: oldTrack.bpm ?? null,
      }).catch(() => {});
    }
    calculateNextSmartTrack();
  }
  if (newTrackId) {
    setLastKnownTrackId(newTrackId);
    setLastKnownTrackForSkip(state.current_track ?? null);
  }

  playerCallbacks.onStateApplied?.();

  if (smartShuffleActive && !state.current_track && !state.is_playing && nextSmartTrack) {
    const toPlay = nextSmartTrack;
    const finishedTrack = lastKnownTrackForSkip;
    setNextSmartTrack(null);
    if (finishedTrack) {
      invoke("update_smart_session", {
        trackId: finishedTrack.id,
        eventType: "complete",
        trackGenre: finishedTrack.genre || null,
        trackArtist: finishedTrack.artist || null,
        trackBpm: finishedTrack.bpm ?? null,
      }).catch(() => {});
    }
    playFromSmartTrack(toPlay).then(() => calculateNextSmartTrack());
  }

  if (state.audio_device !== undefined) {
    const dev = state.audio_device ?? null;
    if (currentAudioDevice !== dev) {
      setCurrentAudioDevice(dev);
      playerCallbacks.renderAudioDeviceUI?.();
    }
  }

  const currentTrackId = state.current_track ? String(state.current_track.id) : null;
  if (currentTrackId !== algoButtonsTrackId) {
    setAlgoButtonsTrackId(currentTrackId);
    setAlgoFeedbackState("idle");
    updateAlgoButtonsUI();
  }
  document.querySelectorAll("#track-tbody tr").forEach((row) => {
    const isRowPlaying = !!currentTrackId && (row as HTMLElement).dataset.id === currentTrackId;
    row.classList.toggle("playing", isRowPlaying);
  });
}

export async function restoreLastPlayerState() {
  const volumeBar = $<HTMLInputElement>("volume");
  try {
    const last = await invoke<LastPlayerState>("get_last_player_state");

    if (last.volume !== undefined && last.volume !== null && volumeBar) {
      volumeBar.value = String(Math.round(last.volume * 100));
      updateSliderTrack(volumeBar);
      await invoke("set_volume", { volume: last.volume });
    }

    if (last.audio_device) {
      setCurrentAudioDevice(last.audio_device);
      await invoke("set_audio_device", { deviceName: last.audio_device });
      playerCallbacks.renderAudioDeviceUI?.();
    }

    if (last.track) {
      const queue = [last.track];
      await invoke("restore_player_track", {
        queue,
        index: 0,
        positionSecs: last.position_secs || 0,
      });
      await refreshPlayerState();
    }
  } catch (err) {
    console.warn("Erreur restauration du dernier état du lecteur :", err);
  }
}

export function updateSmoothProgress() {
  const seekBar = $<HTMLInputElement>("seek");
  const timeCurrent = $("time-current");
  if (!lastPlayerState || !lastPlayerState.is_playing || !lastPlayerState.current_track || isSeeking) return;

  const elapsed = (performance.now() - lastPlayerStateTimestamp) / 1000;
  const dur = lastPlayerState.current_track.duration_secs || 0;
  if (dur <= 0) return;

  const currentPos = Math.min(dur, lastPlayerState.position_secs + elapsed);

  if (seekBar) {
    seekBar.value = String(currentPos);
    updateSliderTrack(seekBar);
  }
  if (timeCurrent) {
    timeCurrent.textContent = fmtTime(currentPos);
  }

  const overlayTimeRemaining = $("overlay-time-remaining");
  if (overlayTimeRemaining) {
    const remSecs = Math.max(0, dur - currentPos);
    overlayTimeRemaining.textContent = `-${fmtTime(remSecs)}`;
  }

  const overlayRingFill = $("overlay-ring-fill");
  if (overlayRingFill) {
    const pct = Math.min(100, Math.max(0, (currentPos / dur) * 100));
    const maxArc = 257;
    const offset = maxArc - (maxArc * pct) / 100;
    overlayRingFill.style.strokeDashoffset = String(offset);
  }
}

export function pollState() {
  setInterval(updateSmoothProgress, 100);
  setInterval(async () => {
    try {
      const state = await invoke<PlayerState>("get_player_state");
      applyPlayerState(state);

      const count = incrementSaveStateCounter();
      if (state.current_track && count % 10 === 0) {
        await invoke("save_last_player_state", {
          volume: state.volume,
          audioDevice: state.audio_device || null,
          trackId: state.current_track.id || state.current_track.path,
          positionSecs: state.position_secs,
          queueIndex: state.queue_index || 0,
        });
      }
    } catch {
      /* silencieux */
    }
  }, 1000);
}
