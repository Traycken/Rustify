/**
 * ============================================================================
 * Rustify — Modale d'Édition d'Album (src/modals/albumModal.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la modale d'édition des métadonnées de l'album (titre, artiste,
 * genre, année, pochette web).
 * 
 * Sommaire des exportations :
 * - openAlbumModal(album) : Ouvre la modale pour l'album spécifié.
 * - closeAlbumModal() : Ferme la modale.
 * - setupAlbumModalEvents(fetchOnlineMetadata, onSaved) : Événements de la modale.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, getCoverDataUrl, allTracks } from "../state";
import type { AlbumSummary, OnlineMetadataResult } from "../types";
import { appAlert } from "../utils/dialog";

let activeModalAlbum: AlbumSummary | null = null;
let pendingAlbumOnlineResult: OnlineMetadataResult | null = null;

export async function openAlbumModal(album: AlbumSummary) {
  activeModalAlbum = album;
  pendingAlbumOnlineResult = null;

  const albumTitleInput = $<HTMLInputElement>("album-input-title");
  const albumArtistInput = $<HTMLInputElement>("album-input-artist");
  const albumYearInput = $<HTMLInputElement>("album-input-year");
  const albumGenreInput = $<HTMLInputElement>("album-input-genre");
  const albumCoverImg = $<HTMLImageElement>("album-cover-img");
  const albumCoverPlaceholder = $("album-cover-placeholder");
  const albumOnlineResultsBox = $("album-online-results-box");
  const albumModal = $("album-modal");

  if (albumTitleInput) albumTitleInput.value = album.album;
  if (albumArtistInput) albumArtistInput.value = album.album_artist;
  if (albumYearInput) albumYearInput.value = album.year ? String(album.year) : "";

  const sampleTrack = allTracks.find((t) => t.album === album.album);
  if (albumGenreInput) albumGenreInput.value = sampleTrack?.genre || "";

  if (albumOnlineResultsBox) albumOnlineResultsBox.hidden = true;

  if (album.cover_path) {
    const dataUrl = await getCoverDataUrl(album.cover_path);
    if (dataUrl) {
      if (albumCoverImg) { albumCoverImg.src = dataUrl; albumCoverImg.hidden = false; }
      if (albumCoverPlaceholder) albumCoverPlaceholder.hidden = true;
    } else {
      if (albumCoverImg) albumCoverImg.hidden = true;
      if (albumCoverPlaceholder) albumCoverPlaceholder.hidden = false;
    }
  } else {
    if (albumCoverImg) albumCoverImg.hidden = true;
    if (albumCoverPlaceholder) albumCoverPlaceholder.hidden = false;
  }

  if (albumModal) {
    albumModal.style.display = "flex";
    albumModal.hidden = false;
  }
}

export function closeAlbumModal() {
  const albumModal = $("album-modal");
  if (albumModal) {
    albumModal.hidden = true;
    albumModal.style.display = "none";
  }
  activeModalAlbum = null;
  pendingAlbumOnlineResult = null;
}

export function setupAlbumModalEvents(
  fetchOnlineMetadataFn: (artist: string, title: string) => Promise<OnlineMetadataResult | null>,
  onSaved?: () => Promise<void>
) {
  const albumTitleInput = $<HTMLInputElement>("album-input-title");
  const albumArtistInput = $<HTMLInputElement>("album-input-artist");
  const albumYearInput = $<HTMLInputElement>("album-input-year");
  const albumGenreInput = $<HTMLInputElement>("album-input-genre");
  const albumCoverImg = $<HTMLImageElement>("album-cover-img");
  const albumCoverPlaceholder = $("album-cover-placeholder");
  const albumOnlineResultsBox = $("album-online-results-box");

  $("album-modal-close")?.addEventListener("click", closeAlbumModal);
  $("album-modal-cancel")?.addEventListener("click", closeAlbumModal);

  $("btn-album-fetch-online")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("btn-album-fetch-online");
    if (!btn || !albumArtistInput || !albumTitleInput) return;
    const origText = btn.textContent;
    btn.textContent = "⏳ Recherche de l'album en ligne...";
    btn.disabled = true;

    try {
      const result = await fetchOnlineMetadataFn(albumArtistInput.value, albumTitleInput.value);
      if (result) {
        pendingAlbumOnlineResult = result;
        const srcEl = $("album-online-source-name");
        const albEl = $("album-online-album");
        const artEl = $("album-online-artist");
        const genEl = $("album-online-genre");
        const yrEl = $("album-online-year");
        if (srcEl) srcEl.textContent = result.source;
        if (albEl) albEl.textContent = result.album || result.title;
        if (artEl) artEl.textContent = result.artist;
        if (genEl) genEl.textContent = result.genre || "—";
        if (yrEl) yrEl.textContent = result.year ? String(result.year) : "—";

        const onlineImg = $<HTMLImageElement>("album-online-cover-img");
        if (onlineImg) {
          if (result.coverBase64 || result.coverUrl) {
            onlineImg.src = result.coverBase64 || result.coverUrl!;
            onlineImg.hidden = false;
          } else {
            onlineImg.hidden = true;
          }
        }

        if (albumOnlineResultsBox) albumOnlineResultsBox.hidden = false;
      } else {
        await appAlert("Aucune métadonnée trouvée en ligne pour cet album.");
      }
    } catch (err) {
      console.error(err);
      await appAlert("Erreur lors de la recherche web d'album.");
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  });

  $("btn-use-album-online-data")?.addEventListener("click", () => {
    if (!pendingAlbumOnlineResult) return;
    if (pendingAlbumOnlineResult.album && albumTitleInput) albumTitleInput.value = pendingAlbumOnlineResult.album;
    if (pendingAlbumOnlineResult.artist && albumArtistInput) albumArtistInput.value = pendingAlbumOnlineResult.artist;
    if (pendingAlbumOnlineResult.genre && albumGenreInput) albumGenreInput.value = pendingAlbumOnlineResult.genre;
    if (pendingAlbumOnlineResult.year && albumYearInput) albumYearInput.value = String(pendingAlbumOnlineResult.year);

    if (pendingAlbumOnlineResult.coverBase64 && albumCoverImg && albumCoverPlaceholder) {
      albumCoverImg.src = pendingAlbumOnlineResult.coverBase64;
      albumCoverImg.hidden = false;
      albumCoverPlaceholder.hidden = true;
    }
  });

  $("album-modal-save")?.addEventListener("click", async () => {
    if (!activeModalAlbum || !albumTitleInput || !albumArtistInput || !albumGenreInput || !albumYearInput) return;

    const newAlbum = albumTitleInput.value.trim() || activeModalAlbum.album;
    const newArtist = albumArtistInput.value.trim() || activeModalAlbum.album_artist;
    const genre = albumGenreInput.value.trim();
    const year = parseInt(albumYearInput.value, 10) || 0;
    const coverBase64 = pendingAlbumOnlineResult?.coverBase64 || null;

    try {
      await invoke("update_album_metadata", {
        oldAlbum: activeModalAlbum.album,
        oldArtist: activeModalAlbum.album_artist,
        newAlbum,
        newArtist,
        year,
        genre,
        coverBase64,
      });

      closeAlbumModal();
      if (onSaved) await onSaved();
    } catch (e) {
      console.error("Erreur mise à jour album", e);
      await appAlert(`Erreur d'enregistrement : ${e}`);
    }
  });
}
