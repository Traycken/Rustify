/**
 * ============================================================================
 * Rustify — Modale d'Édition d'Artiste (src/modals/artistModal.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la modale d'édition des informations d'un artiste (nom, bio,
 * photo HD en ligne) ainsi que la recherche et mise à jour en lot des photos d'artistes.
 * 
 * Sommaire des exportations :
 * - openArtistModal(artist) : Ouvre la modale pour l'artiste spécifié.
 * - closeArtistModal() : Ferme la modale.
 * - fetchArtistOnlineMetadata(artistName) : Recherche métadonnées & photo HD d'artiste en ligne.
 * - enrichArtistPhotosInBatch(onProgress, onDone) : Mise à jour en lot des photos d'artistes.
 * - setupArtistModalEvents(onSaved) : Attache les événements de la modale.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, getCoverDataUrl } from "../state";
import type { ArtistSummary, ArtistOnlineResult } from "../types";
import { appAlert } from "../utils/dialog";

let editingArtistSummary: ArtistSummary | null = null;
let editingArtistBase64: string | null = null;

export function openArtistModal(a: ArtistSummary) {
  editingArtistSummary = a;
  editingArtistBase64 = null;
  const nameInput = $<HTMLInputElement>("artist-input-name");
  const genreInput = $<HTMLInputElement>("artist-input-genre");
  const bioInput = $<HTMLTextAreaElement>("artist-input-bio");
  const coverImg = $<HTMLImageElement>("artist-modal-cover-img");
  const coverPlaceholder = $("artist-modal-cover-placeholder");

  if (nameInput) nameInput.value = a.artist;
  if (genreInput) genreInput.value = "";
  if (bioInput) bioInput.value = a.bio || "";

  if (a.image_path) {
    getCoverDataUrl(a.image_path).then((url) => {
      if (url) {
        if (coverImg) { coverImg.src = url; coverImg.hidden = false; }
        if (coverPlaceholder) coverPlaceholder.hidden = true;
      } else {
        if (coverImg) coverImg.hidden = true;
        if (coverPlaceholder) coverPlaceholder.hidden = false;
      }
    });
  } else {
    if (coverImg) coverImg.hidden = true;
    if (coverPlaceholder) coverPlaceholder.hidden = false;
  }

  const modal = $("artist-modal");
  if (modal) modal.hidden = false;
}

export function closeArtistModal() {
  const modal = $("artist-modal");
  if (modal) modal.hidden = true;
  editingArtistSummary = null;
  editingArtistBase64 = null;
}

export async function fetchArtistOnlineMetadata(artistName: string): Promise<ArtistOnlineResult | null> {
  try {
    const result = await invoke<{ genre: string | null; cover_base64: string | null }>("fetch_artist_online_metadata", { artistName });
    if (!result.genre && !result.cover_base64) return null;
    return { artist: artistName, genre: result.genre, coverBase64: result.cover_base64 };
  } catch (e) {
    console.warn("Erreur fetch_artist_online_metadata", e);
    return null;
  }
}

export async function enrichArtistPhotosInBatch(onDone?: () => Promise<void>) {
  const artists = await invoke<ArtistSummary[]>("get_artists");
  if (artists.length === 0) {
    await appAlert("Aucun artiste trouvé dans la bibliothèque.");
    return;
  }

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");

  if (progressBanner && progressText && progressBar) {
    progressBanner.hidden = false;
    progressBanner.style.display = "flex";

    const total = artists.length;
    let count = 0;

    for (const a of artists) {
      count++;
      const percent = Math.round((count / total) * 100);
      progressText.textContent = `Recherche de la photo d'artiste (${count} / ${total}) : ${a.artist}...`;
      progressBar.style.width = `${percent}%`;

      const res = await fetchArtistOnlineMetadata(a.artist);
      if (res && (res.coverBase64 || res.genre)) {
        try {
          await invoke("save_artist_metadata", {
            artist: a.artist,
            genre: res.genre,
            bio: null,
            members: null,
            imageBase64: res.coverBase64,
          });
        } catch (err) {
          console.error("Erreur sauvegarde photo artiste", err);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    progressText.textContent = "✨ Mise à jour des photos d'artistes terminée !";
    progressBar.style.width = "100%";
    setTimeout(() => {
      progressBanner.hidden = true;
      progressBanner.style.display = "none";
    }, 2500);
  }

  if (onDone) await onDone();
}

export function setupArtistModalEvents(onSaved?: () => Promise<void>) {
  $("artist-modal-close")?.addEventListener("click", closeArtistModal);
  $("artist-modal-cancel")?.addEventListener("click", closeArtistModal);

  $("btn-artist-web-photo")?.addEventListener("click", async () => {
    if (!editingArtistSummary) return;
    try {
      const base64 = await invoke<string | null>("fetch_artist_web_photo", {
        artistName: editingArtistSummary.artist,
      });
      if (base64) {
        editingArtistBase64 = base64;
        const coverImg = $<HTMLImageElement>("artist-modal-cover-img");
        const coverPlaceholder = $("artist-modal-cover-placeholder");
        if (coverImg) { coverImg.src = base64; coverImg.hidden = false; }
        if (coverPlaceholder) coverPlaceholder.hidden = true;
      }
    } catch (err) {
      console.error("Erreur recherche photo artiste", err);
    }
  });

  $("artist-modal-save")?.addEventListener("click", async () => {
    if (!editingArtistSummary) return;
    const name = $<HTMLInputElement>("artist-input-name")?.value.trim();
    const genre = $<HTMLInputElement>("artist-input-genre")?.value.trim();
    const bio = $<HTMLTextAreaElement>("artist-input-bio")?.value.trim();

    if (!name) return;

    await invoke("save_artist_metadata", {
      artist: name,
      genre: genre || null,
      bio: bio || null,
      members: editingArtistSummary.members || null,
      imageBase64: editingArtistBase64,
    });

    closeArtistModal();
    if (onSaved) await onSaved();
  });
}
