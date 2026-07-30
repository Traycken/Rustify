/**
 * ============================================================================
 * Rustify — Modale Métadonnées & Enrichissement Web Morceaux (src/modals/trackModal.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère l'affichage et l'édition des métadonnées individuelles d'un morceau,
 * la recherche web en ligne (pochette, titre, artiste, genre, année) et
 * les processus d'enrichissement avancé (Deezer, MusicBrainz, LRCLIB, Wikidata).
 * 
 * Sommaire des exportations :
 * - openMetadataModal(track) : Ouvre la modale d'édition pour le morceau.
 * - closeMetadataModal() : Ferme la modale de métadonnées.
 * - fetchOnlineMetadata(artist, title) : Recherche métadonnées web d'un titre.
 * - imageUrlToBase64(url) : Convertit une URL d'image distante en Base64.
 * - hasCompleteAdvancedMetadata(t), isEligibleForAdvancedEnrichment(t) : Critères d'enrichissement.
 * - getAdvancedEnrichmentTargets(tracks) : Filtre la liste des morceaux éligibles.
 * - runAdvancedEnrichment(tracks, onDone) : Exécute l'enrichissement avancé en lot.
 * - enrichLibraryInBatch(tracks, onDone) : Enrichit automatiquement la bibliothèque.
 * - setupMetadataModalEvents(onSaved) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, getCoverDataUrl } from "../state";
import type { Track, OnlineMetadataResult, TrackMetadataUpdate } from "../types";
import { appAlert } from "../utils/dialog";
import { escapeHtml } from "../utils/formatting";

let activeModalTrack: Track | null = null;
let pendingOnlineResult: OnlineMetadataResult | null = null;
const enrichedArtistsThisRun = new Set<string>();

export function renderAdvancedMetadataBox(track: Track) {
  const box = $("meta-advanced-box");
  if (!box) return;

  const parts: string[] = [];
  const chips: string[] = [];

  if (track.bpm) {
    const isOff = track.bpm_is_official !== false;
    const bpmLabel = isOff ? `${Math.round(track.bpm)} BPM` : `~${Math.round(track.bpm)} BPM (estimé)`;
    const titleAttr = isOff ? "BPM officiel" : "BPM non officiel estimé par l'analyseur audio local";
    const chipClass = isOff ? "advanced-chip bpm-official" : "advanced-chip bpm-unofficial";
    chips.push(`<span class="${chipClass}" title="${titleAttr}"><i class="fa-solid fa-drum"></i> ${bpmLabel}</span>`);
  } else {
    chips.push(`<button id="btn-analyze-track-bpm" class="advanced-chip" style="cursor: pointer; background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-dim);"><i class="fa-solid fa-wave-square"></i> Analyser le BPM</button>`);
  }
  if (track.isrc) chips.push(`<span class="advanced-chip"><i class="fa-solid fa-barcode"></i> ISRC : ${escapeHtml(track.isrc)}</span>`);
  if (track.iswc) chips.push(`<span class="advanced-chip"><i class="fa-solid fa-file-signature"></i> ISWC : ${escapeHtml(track.iswc)}</span>`);
  if (track.is_instrumental) chips.push(`<span class="advanced-chip"><i class="fa-solid fa-music"></i> Instrumental</span>`);
  if (track.mbid) chips.push(`<span class="advanced-chip" title="MusicBrainz ID"><i class="fa-solid fa-fingerprint"></i> MBID</span>`);
  if (chips.length > 0) parts.push(`<div class="advanced-chips-row">${chips.join("")}</div>`);

  if (track.tags && track.tags.length > 0) {
    const tagPills = track.tags.slice(0, 12).map((t) => `<span class="advanced-tag-pill">${escapeHtml(t)}</span>`).join("");
    parts.push(`<div class="advanced-tags-row">${tagPills}</div>`);
  }

  if (track.credits && track.credits.length > 0) {
    const items = track.credits
      .slice(0, 20)
      .map((c) => `<span class="advanced-credit-item"><span class="role">${escapeHtml(c.role)}</span> : ${escapeHtml(c.name)}</span>`)
      .join("");
    parts.push(`<div class="advanced-credits-box"><label><i class="fa-solid fa-user-pen"></i> Crédits</label><div class="advanced-credits-list">${items}</div></div>`);
  }

  if (track.lyrics_plain) {
    const synced = track.lyrics_synced ? ' <span class="advanced-lyrics-source">(synchronisées disponibles)</span>' : "";
    parts.push(
      `<div class="advanced-lyrics-box"><label><i class="fa-solid fa-quote-left"></i> Paroles${synced}</label><div class="advanced-lyrics-text">${escapeHtml(track.lyrics_plain)}</div></div>`
    );
  }

  if (parts.length === 0) {
    box.hidden = true;
    box.innerHTML = "";
  } else {
    box.hidden = false;
    box.innerHTML = parts.join("");
  }
}

export async function openMetadataModal(track: Track, onLibraryReload?: () => Promise<void>) {
  activeModalTrack = track;
  pendingOnlineResult = null;

  const metadataModal = $("metadata-modal");
  const metaTitleInput = $<HTMLInputElement>("meta-input-title");
  const metaArtistInput = $<HTMLInputElement>("meta-input-artist");
  const metaAlbumInput = $<HTMLInputElement>("meta-input-album");
  const metaGenreInput = $<HTMLInputElement>("meta-input-genre");
  const metaYearInput = $<HTMLInputElement>("meta-input-year");
  const metaFilePath = $("meta-file-path");
  const metaCoverImg = $<HTMLImageElement>("meta-cover-img");
  const metaCoverPlaceholder = $("meta-cover-placeholder");
  const onlineResultsBox = $("online-results-box");

  try {
    const stats = await invoke<[number, number, boolean, boolean]>("get_track_live_stats", { trackId: track.id || track.path });
    track.likes = stats[0];
    track.dislikes = stats[1];
    track.is_favorite = stats[2];
    track.is_ecstasy = stats[3];
  } catch (err) {
    console.warn("Erreur chargement des métadonnées en direct :", err);
  }

  if (metaTitleInput) metaTitleInput.value = track.title;
  if (metaArtistInput) metaArtistInput.value = track.artist;
  if (metaAlbumInput) metaAlbumInput.value = track.album;
  if (metaGenreInput) metaGenreInput.value = track.genre;
  if (metaYearInput) metaYearInput.value = track.year ? String(track.year) : "";
  if (metaFilePath) metaFilePath.textContent = track.path;

  const metaLikesInput = $<HTMLInputElement>("meta-input-likes");
  const metaDislikesInput = $<HTMLInputElement>("meta-input-dislikes");
  if (metaLikesInput) metaLikesInput.value = String(track.likes || 0);
  if (metaDislikesInput) metaDislikesInput.value = String(track.dislikes || 0);

  const statManual = $("meta-stat-manual");
  const statPlays = $("meta-stat-plays");
  const statSkips = $("meta-stat-skips");
  const statAvgTime = $("meta-stat-avg-time");
  if (statManual) statManual.textContent = String(track.manual_select_count || 0);
  if (statPlays) statPlays.textContent = String(track.play_count || 0);
  if (statSkips) statSkips.textContent = String(track.skip_count || 0);
  if (statAvgTime) {
    const avg = track.avg_listen_secs || 0;
    const mins = Math.floor(avg / 60);
    const secs = Math.floor(avg % 60);
    statAvgTime.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  if (onlineResultsBox) onlineResultsBox.hidden = true;
  renderAdvancedMetadataBox(track);

  $("btn-analyze-track-bpm")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = $<HTMLButtonElement>("btn-analyze-track-bpm");
    if (btn) {
      btn.textContent = "⏳ Analyse audio en cours...";
      btn.disabled = true;
    }
    try {
      const updatedTrack = await invoke<Track>("analyze_track_bpm", { trackId: track.id });
      activeModalTrack = updatedTrack;
      renderAdvancedMetadataBox(updatedTrack);
      if (onLibraryReload) await onLibraryReload();
    } catch (err) {
      console.error("Erreur d'analyse BPM :", err);
      await appAlert(`Échec de l'analyse BPM : ${err}`);
    }
  });

  if (track.cover_path) {
    const dataUrl = await getCoverDataUrl(track.cover_path);
    if (dataUrl) {
      if (metaCoverImg) { metaCoverImg.src = dataUrl; metaCoverImg.hidden = false; }
      if (metaCoverPlaceholder) metaCoverPlaceholder.hidden = true;
    } else {
      if (metaCoverImg) metaCoverImg.hidden = true;
      if (metaCoverPlaceholder) metaCoverPlaceholder.hidden = false;
    }
  } else {
    if (metaCoverImg) metaCoverImg.hidden = true;
    if (metaCoverPlaceholder) metaCoverPlaceholder.hidden = false;
  }

  if (metadataModal) {
    metadataModal.style.display = "flex";
    metadataModal.hidden = false;
  }
}

export function closeMetadataModal() {
  const metadataModal = $("metadata-modal");
  if (metadataModal) {
    metadataModal.hidden = true;
    metadataModal.style.display = "none";
  }
  activeModalTrack = null;
  pendingOnlineResult = null;
}

export async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    return await invoke<string | null>("fetch_image_as_base64", { url });
  } catch {
    return null;
  }
}

export async function fetchOnlineMetadata(artist: string, title: string): Promise<OnlineMetadataResult | null> {
  try {
    const result = await invoke<{
      title: string | null;
      artist: string | null;
      album: string | null;
      genre: string | null;
      year: number | null;
      cover_base64: string | null;
      source: string;
    } | null>("fetch_online_track_metadata", { artist, title });
    if (!result) return null;
    return {
      title: result.title || title,
      artist: result.artist || artist,
      album: result.album || "",
      genre: result.genre || "",
      year: result.year || 0,
      coverUrl: null,
      coverBase64: result.cover_base64,
      cover_base64: result.cover_base64,
      source: result.source,
    };
  } catch (e) {
    console.warn("Erreur fetch_online_track_metadata", e);
    return null;
  }
}

const MAX_ENRICHMENT_ATTEMPTS = 3;

export function hasCompleteAdvancedMetadata(t: Track): boolean {
  const hasBpm = !!t.bpm && t.bpm > 0;
  const hasIsrc = !!t.isrc;
  const hasTags = !!t.tags && t.tags.length > 0;
  const hasCredits = !!t.credits && t.credits.length > 0;
  const hasLyrics = !!t.lyrics_plain || !!t.lyrics_synced || t.is_instrumental === true;
  return hasBpm && hasIsrc && hasTags && hasCredits && hasLyrics;
}

export function isEligibleForAdvancedEnrichment(t: Track): boolean {
  if (hasCompleteAdvancedMetadata(t)) return false;
  return (t.enrichment_attempts ?? 0) <= MAX_ENRICHMENT_ATTEMPTS;
}

export function getAdvancedEnrichmentTargets(tracks: Track[]): Track[] {
  return tracks.filter(isEligibleForAdvancedEnrichment);
}

export async function enrichArtistAdvanced(artistName: string): Promise<void> {
  const key = artistName.trim().toLowerCase();
  if (!key || enrichedArtistsThisRun.has(key)) return;
  enrichedArtistsThisRun.add(key);
  try {
    await invoke("enrich_artist_advanced", { artistName });
  } catch (e) {
    console.warn(`Erreur enrichissement artiste "${artistName}"`, e);
  }
}

export async function enrichTrackAdvanced(track: Track): Promise<void> {
  try {
    await invoke("enrich_track_advanced", {
      input: {
        track_id: track.id,
        artist: track.artist,
        title: track.title,
        album: track.album,
        duration_secs: track.duration_secs,
        isrc: track.isrc ?? null,
      },
    });
    await enrichArtistAdvanced(track.artist);
  } catch (e) {
    console.warn(`Erreur enrichissement morceau "${track.title}"`, e);
  }
}

export async function runAdvancedEnrichment(tracks: Track[], onDone?: () => Promise<void>) {
  if (tracks.length === 0) return;
  enrichedArtistsThisRun.clear();

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");
  if (progressBanner && progressText && progressBar) {
    progressBanner.hidden = false;
    progressBanner.style.display = "flex";
  }

  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ done: number; total: number; current_title: string }>(
    "enrichment_progress",
    (event) => {
      const { done, total, current_title } = event.payload;
      if (total === 0 || !progressText || !progressBar) return;
      const percent = Math.round((done / total) * 100);
      if (current_title) {
        progressText.textContent = `Enrichissement avancé (Deezer, MusicBrainz, paroles...) — ${done} / ${total} : ${current_title}`;
      } else {
        progressText.textContent = "✨ Enrichissement avancé terminé !";
        progressBar.style.width = "100%";
      }
      progressBar.style.width = `${percent}%`;
    }
  );

  try {
    await invoke("batch_enrich_tracks", {
      tracks: tracks.map((t) => ({
        track_id: t.id,
        artist: t.artist,
        title: t.title,
        album: t.album,
        duration_secs: t.duration_secs,
        isrc: t.isrc ?? null,
      })),
    });

    const uniqueArtists = [...new Set(tracks.map((t) => t.artist))];
    await invoke("batch_enrich_artists", { artistNames: uniqueArtists });
  } finally {
    unlisten();
  }

  if (onDone) await onDone();

  if (progressBanner && progressText && progressBar) {
    progressText.textContent = "✨ Enrichissement avancé terminé !";
    progressBar.style.width = "100%";
    setTimeout(() => {
      progressBanner.hidden = true;
      progressBanner.style.display = "none";
    }, 2500);
  }
}

export async function enrichLibraryInBatch(tracks: Track[], onDone?: () => Promise<void>) {
  const targets = tracks.filter((t) => !t.cover_path || t.year === 0 || !t.genre);
  if (targets.length === 0) return;

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");

  if (progressBanner && progressText && progressBar) {
    progressBanner.hidden = false;
    progressBanner.style.display = "flex";
  }

  const albumMap = new Map<string, Track[]>();
  for (const t of targets) {
    const key = `${t.artist.toLowerCase()}:::${t.album.toLowerCase()}`;
    if (!albumMap.has(key)) albumMap.set(key, []);
    albumMap.get(key)!.push(t);
  }

  const entries = Array.from(albumMap.entries());
  const totalAlbums = entries.length;
  let processedCount = 0;
  const updates: TrackMetadataUpdate[] = [];

  for (const [, albumTracks] of entries) {
    processedCount++;
    const percent = Math.round((processedCount / totalAlbums) * 100);
    const sample = albumTracks[0];

    if (progressText && progressBar) {
      progressText.textContent = `Enrichissement des métadonnées en ligne (${processedCount} / ${totalAlbums} albums) : ${sample.album} par ${sample.artist}...`;
      progressBar.style.width = `${percent}%`;
    }

    const meta = await fetchOnlineMetadata(sample.artist, sample.album && sample.album !== "Album inconnu" ? sample.album : sample.title);
    if (meta) {
      for (const tr of albumTracks) {
        updates.push({
          track_id: tr.id,
          title: null,
          artist: meta.artist || null,
          album: meta.album || null,
          genre: meta.genre || null,
          year: meta.year || null,
          cover_base64: meta.coverBase64 || null,
        });
      }
    }

    if (updates.length >= 10) {
      const chunk = updates.splice(0, updates.length);
      try {
        await invoke("batch_update_metadata", { updates: chunk });
        if (onDone) await onDone();
      } catch (e) {
        console.error("Erreur batch update", e);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (updates.length > 0) {
    try {
      await invoke("batch_update_metadata", { updates });
      if (onDone) await onDone();
    } catch (e) {
      console.error("Erreur batch update final", e);
    }
  }

  if (progressBanner && progressText && progressBar) {
    progressText.textContent = "✨ Enrichissement des métadonnées terminé !";
    progressBar.style.width = "100%";
    setTimeout(() => {
      progressBanner.hidden = true;
      progressBanner.style.display = "none";
    }, 2500);
  }
}

let onDeleteTrackCallback: ((track: Track) => Promise<void>) | null = null;

export function setupMetadataModalEvents(onSaved?: () => Promise<void>, onDeleteTrack?: (track: Track) => Promise<void>) {
  if (onDeleteTrack) onDeleteTrackCallback = onDeleteTrack;

  const metaTitleInput = $<HTMLInputElement>("meta-input-title");
  const metaArtistInput = $<HTMLInputElement>("meta-input-artist");
  const metaAlbumInput = $<HTMLInputElement>("meta-input-album");
  const metaGenreInput = $<HTMLInputElement>("meta-input-genre");
  const metaYearInput = $<HTMLInputElement>("meta-input-year");
  const metaCoverImg = $<HTMLImageElement>("meta-cover-img");
  const metaCoverPlaceholder = $("meta-cover-placeholder");
  const onlineResultsBox = $("online-results-box");

  $("modal-close")?.addEventListener("click", closeMetadataModal);
  $("modal-btn-cancel")?.addEventListener("click", closeMetadataModal);

  $("modal-btn-delete")?.addEventListener("click", async () => {
    if (activeModalTrack && onDeleteTrackCallback) {
      const trackToDelete = activeModalTrack;
      closeMetadataModal();
      await onDeleteTrackCallback(trackToDelete);
    }
  });

  $("btn-fetch-online")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("btn-fetch-online");
    if (!btn || !metaArtistInput || !metaTitleInput) return;
    const origText = btn.textContent;
    btn.textContent = "⏳ Recherche en ligne...";
    btn.disabled = true;

    try {
      const result = await fetchOnlineMetadata(metaArtistInput.value, metaTitleInput.value);
      if (result) {
        pendingOnlineResult = result;
        const srcEl = $("online-source-name");
        const titEl = $("online-title");
        const artEl = $("online-artist");
        const albEl = $("online-album");
        const genEl = $("online-genre");
        const yrEl = $("online-year");
        if (srcEl) srcEl.textContent = result.source;
        if (titEl) titEl.textContent = result.title;
        if (artEl) artEl.textContent = result.artist;
        if (albEl) albEl.textContent = result.album || "—";
        if (genEl) genEl.textContent = result.genre || "—";
        if (yrEl) yrEl.textContent = result.year ? String(result.year) : "—";

        const onlineImg = $<HTMLImageElement>("online-cover-img");
        if (onlineImg) {
          if (result.coverBase64 || result.coverUrl) {
            onlineImg.src = result.coverBase64 || result.coverUrl!;
            onlineImg.hidden = false;
          } else {
            onlineImg.hidden = true;
          }
        }

        if (onlineResultsBox) onlineResultsBox.hidden = false;
      } else {
        await appAlert("Aucune métadonnée trouvée en ligne pour cet artiste / titre.");
      }
    } catch (err) {
      console.error(err);
      await appAlert("Erreur lors de la connexion aux services de métadonnées.");
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  });

  $("btn-use-online-data")?.addEventListener("click", () => {
    if (!pendingOnlineResult) return;
    if (metaTitleInput) metaTitleInput.value = pendingOnlineResult.title || "";
    if (metaArtistInput) metaArtistInput.value = pendingOnlineResult.artist || "";
    if (pendingOnlineResult.album && metaAlbumInput) metaAlbumInput.value = pendingOnlineResult.album;
    if (pendingOnlineResult.genre && metaGenreInput) metaGenreInput.value = pendingOnlineResult.genre;
    if (pendingOnlineResult.year && metaYearInput) metaYearInput.value = String(pendingOnlineResult.year);

    if (pendingOnlineResult.coverBase64 && metaCoverImg && metaCoverPlaceholder) {
      metaCoverImg.src = pendingOnlineResult.coverBase64;
      metaCoverImg.hidden = false;
      metaCoverPlaceholder.hidden = true;
    }
  });

  $("modal-btn-save")?.addEventListener("click", async () => {
    if (!activeModalTrack || !metaTitleInput || !metaArtistInput || !metaAlbumInput || !metaGenreInput || !metaYearInput) return;

    const title = metaTitleInput.value.trim() || activeModalTrack.title;
    const artist = metaArtistInput.value.trim() || activeModalTrack.artist;
    const album = metaAlbumInput.value.trim() || activeModalTrack.album;
    const genre = metaGenreInput.value.trim();
    const year = parseInt(metaYearInput.value, 10) || 0;
    const coverBase64 = pendingOnlineResult?.coverBase64 || null;

    const likesInput = $<HTMLInputElement>("meta-input-likes");
    const dislikesInput = $<HTMLInputElement>("meta-input-dislikes");
    const likes = likesInput ? parseInt(likesInput.value, 10) || 0 : 0;
    const dislikes = dislikesInput ? parseInt(dislikesInput.value, 10) || 0 : 0;

    try {
      await invoke("save_online_metadata", {
        trackId: activeModalTrack.id,
        title,
        artist,
        album,
        genre,
        year,
        coverBase64,
        likes,
        dislikes,
      });

      closeMetadataModal();
      if (onSaved) await onSaved();
    } catch (e) {
      console.error("Erreur enregistrement métadonnées", e);
      await appAlert(`Erreur d'enregistrement : ${e}`);
    }
  });
}
