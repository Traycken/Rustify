/**
 * ============================================================================
 * Rustify — Modale d'Édition de Genre (src/modals/genreModal.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la modale de renommage d'un genre musical à travers
 * la bibliothèque.
 * 
 * Sommaire des exportations :
 * - openGenreModal(genreName) : Ouvre la modale pour le genre spécifié.
 * - closeGenreModal() : Ferme la modale.
 * - setupGenreModalEvents(onSaved) : Attache les écouteurs d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $ } from "../state";

let editingGenreName: string | null = null;

export function openGenreModal(genreName: string) {
  editingGenreName = genreName;
  const input = $<HTMLInputElement>("genre-input-name");
  if (input) input.value = genreName;
  const modal = $("genre-modal");
  if (modal) modal.hidden = false;
}

export function closeGenreModal() {
  const modal = $("genre-modal");
  if (modal) modal.hidden = true;
  editingGenreName = null;
}

let onDeleteGenreCallback: ((genreName: string) => Promise<void>) | null = null;

export function setupGenreModalEvents(onSaved?: () => Promise<void>, onDeleteGenre?: (genreName: string) => Promise<void>) {
  if (onDeleteGenre) onDeleteGenreCallback = onDeleteGenre;

  $("genre-modal-close")?.addEventListener("click", closeGenreModal);
  $("genre-modal-cancel")?.addEventListener("click", closeGenreModal);

  $("genre-modal-delete")?.addEventListener("click", async () => {
    if (editingGenreName && onDeleteGenreCallback) {
      const genreToDelete = editingGenreName;
      closeGenreModal();
      await onDeleteGenreCallback(genreToDelete);
    }
  });

  $("genre-modal-save")?.addEventListener("click", async () => {
    if (!editingGenreName) return;
    const newName = $<HTMLInputElement>("genre-input-name").value.trim();
    if (!newName || newName === editingGenreName) {
      closeGenreModal();
      return;
    }

    await invoke("rename_genre", { oldGenre: editingGenreName, newGenre: newName });
    closeGenreModal();
    if (onSaved) await onSaved();
  });
}
