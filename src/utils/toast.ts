/**
 * ============================================================================
 * Rustify — Système de Notifications Toast Modulaire (src/utils/toast.ts)
 * ----------------------------------------------------------------------------
 * Système de notifications toast élégant, modulaire et non-bloquant.
 * Apparaît au centre en haut de la fenêtre en descendant, puis remonte
 * pour disparaître.
 *
 * Types de toast : "info" | "success" | "warning" | "error"
 * ============================================================================
 */

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number; // en millisecondes (défaut: 3000ms)
  icon?: string;     // classe FontAwesome personnalisée (optionnel)
}

let toastContainer: HTMLElement | null = null;

function ensureToastContainer(): HTMLElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Affiche une notification toast modulaire.
 * @param message Message ou options
 * @param type Type du toast ("info", "success", "warning", "error")
 * @param duration Durée d'affichage en millisecondes
 */
export function showToast(
  messageOrOptions: string | ToastOptions,
  type: ToastType = "info",
  duration = 3000
): HTMLElement {
  const container = ensureToastContainer();

  let message = "";
  let toastType: ToastType = type;
  let toastDuration = duration;
  let customIcon: string | undefined;

  if (typeof messageOrOptions === "object") {
    message = messageOrOptions.message;
    toastType = messageOrOptions.type || "info";
    toastDuration = messageOrOptions.duration ?? 3000;
    customIcon = messageOrOptions.icon;
  } else {
    message = messageOrOptions;
  }

  // Création de l'élément Toast
  const toast = document.createElement("div");
  toast.className = `toast toast-${toastType}`;

  // Icône selon le type
  let iconClass = customIcon;
  if (!iconClass) {
    switch (toastType) {
      case "success":
        iconClass = "fa-solid fa-circle-check";
        break;
      case "warning":
        iconClass = "fa-solid fa-triangle-exclamation";
        break;
      case "error":
        iconClass = "fa-solid fa-circle-xmark";
        break;
      case "info":
      default:
        iconClass = "fa-solid fa-circle-info";
        break;
    }
  }

  toast.innerHTML = `
    <i class="${iconClass} toast-icon"></i>
    <span class="toast-message">${message}</span>
    <button class="toast-close" title="Fermer">&times;</button>
  `;

  // Événement fermer manuellement
  const closeBtn = toast.querySelector(".toast-close");
  let dismissTimeout: number | undefined;

  const dismiss = () => {
    if (toast.classList.contains("toast-hiding")) return;
    toast.classList.add("toast-hiding");
    if (dismissTimeout) clearTimeout(dismissTimeout);
    
    // Attendre la fin de l'animation de remontée avant de supprimer le DOM
    toast.addEventListener(
      "animationend",
      () => {
        toast.remove();
      },
      { once: true }
    );
  };

  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  container.appendChild(toast);

  // Auto-fermeture après la durée spécifiée (si > 0)
  if (toastDuration > 0) {
    dismissTimeout = window.setTimeout(() => {
      dismiss();
    }, toastDuration);
  }

  return toast;
}

// Helpers pratiques
export function showSuccessToast(message: string, duration = 3000) {
  return showToast({ message, type: "success", duration });
}

export function showErrorToast(message: string, duration = 4000) {
  return showToast({ message, type: "error", duration });
}

export function showWarningToast(message: string, duration = 3500) {
  return showToast({ message, type: "warning", duration });
}

export function showInfoToast(message: string, duration = 3000) {
  return showToast({ message, type: "info", duration });
}
