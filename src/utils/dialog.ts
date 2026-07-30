/**
 * ============================================================================
 * Rustify — Boîtes de Dialogue Personnalisées (src/utils/dialog.ts)
 * ----------------------------------------------------------------------------
 * Implémentation 100% interne (DOM + Promise) des fenêtres de dialogue
 * d'alerte, de confirmation et de saisie. Remplace window.alert / confirm / prompt
 * non supportés de manière fiable dans Tauri WebView.
 * 
 * Sommaire des exportations :
 * - openAppDialog(opts) : Ouvre la modale générique de dialogue et retourne une Promise.
 * - appAlert(message, title) : Boîte d'alerte d'information simple.
 * - appConfirm(message, title) : Boîte de confirmation Oui/Non (boolean).
 * - appPrompt(message, defaultValue, title) : Boîte de saisie texte.
 * - showAlert(msg) : Alias rapide pour appAlert.
 * ============================================================================
 */

import { $ } from "../state";
import type { AppDialogOptions } from "../types";
import { showToast, showInfoToast, showSuccessToast, showErrorToast, showWarningToast } from "./toast";

export { showToast, showInfoToast, showSuccessToast, showErrorToast, showWarningToast };

export function openAppDialog(opts: AppDialogOptions): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    const modal = $("app-dialog-modal");
    const titleEl = $("app-dialog-title");
    const messageEl = $("app-dialog-message");
    const inputGroup = $("app-dialog-input-group");
    const inputEl = $<HTMLInputElement>("app-dialog-input");
    const okBtn = $<HTMLButtonElement>("app-dialog-ok");
    const cancelBtn = $<HTMLButtonElement>("app-dialog-cancel");
    const closeBtn = $("app-dialog-close");

    const defaultTitle =
      opts.mode === "alert" ? "Information" : opts.mode === "prompt" ? "Saisie" : "Confirmation";
    titleEl.textContent = opts.title || defaultTitle;
    messageEl.textContent = opts.message;
    okBtn.textContent = opts.okLabel || "OK";
    cancelBtn.textContent = opts.cancelLabel || "Annuler";

    const isPrompt = opts.mode === "prompt";
    inputGroup.hidden = !isPrompt;
    inputEl.value = isPrompt ? opts.defaultValue ?? "" : "";
    cancelBtn.hidden = opts.mode === "alert";

    modal.hidden = false;
    modal.style.display = "flex";
    if (isPrompt) {
      setTimeout(() => inputEl.focus(), 0);
    } else {
      setTimeout(() => okBtn.focus(), 0);
    }

    const cleanup = () => {
      modal.hidden = true;
      modal.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      closeBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKeydown);
    };

    const onOk = () => {
      cleanup();
      if (opts.mode === "confirm") resolve(true);
      else if (opts.mode === "prompt") resolve(inputEl.value);
      else resolve(null);
    };
    const onCancel = () => {
      cleanup();
      if (opts.mode === "confirm") resolve(false);
      else resolve(null);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);
    inputEl.addEventListener("keydown", onKeydown);
  });
}

export function appAlert(message: string, title?: string): Promise<void> {
  return openAppDialog({ mode: "alert", message, title }).then(() => undefined);
}

export function appConfirm(message: string, title?: string): Promise<boolean> {
  return openAppDialog({ mode: "confirm", message, title }) as Promise<boolean>;
}

export function appPrompt(message: string, defaultValue = "", title?: string): Promise<string | null> {
  return openAppDialog({ mode: "prompt", message, defaultValue, title }) as Promise<string | null>;
}

export function showAlert(msg: string) {
  showInfoToast(msg);
}

export interface DeleteConfirmOptions {
  title?: string;
  message: string;
}

export function appDeleteConfirm(opts: DeleteConfirmOptions): Promise<{ confirmed: boolean; deleteFile: boolean }> {
  return new Promise((resolve) => {
    const modal = $("delete-confirm-modal");
    const titleEl = $("delete-modal-title");
    const messageEl = $("delete-modal-message");
    const checkbox = $<HTMLInputElement>("delete-modal-file-checkbox");
    const warning = $("delete-modal-warning");
    const confirmBtn = $<HTMLButtonElement>("delete-modal-confirm");
    const cancelBtn = $<HTMLButtonElement>("delete-modal-cancel");
    const closeBtn = $("delete-modal-close");

    if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn || !closeBtn) {
      resolve({ confirmed: false, deleteFile: false });
      return;
    }

    titleEl.innerHTML = `<i class="fa-solid fa-trash"></i> ${opts.title || "Suppression"}`;
    messageEl.textContent = opts.message;
    if (checkbox) checkbox.checked = false;
    if (warning) warning.style.display = "none";

    modal.hidden = false;
    modal.style.display = "flex";

    const onCheckboxChange = () => {
      if (warning && checkbox) {
        warning.style.display = checkbox.checked ? "block" : "none";
      }
    };

    if (checkbox) {
      checkbox.addEventListener("change", onCheckboxChange);
    }

    const cleanup = () => {
      modal.hidden = true;
      modal.style.display = "none";
      if (checkbox) checkbox.removeEventListener("change", onCheckboxChange);
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      closeBtn.removeEventListener("click", onCancel);
      window.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      const deleteFile = checkbox ? checkbox.checked : false;
      cleanup();
      resolve({ confirmed: true, deleteFile });
    };

    const onCancel = () => {
      cleanup();
      resolve({ confirmed: false, deleteFile: false });
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);
    window.addEventListener("keydown", onKeydown);
  });
}

