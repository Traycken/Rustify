/**
 * ============================================================================
 * Rustify — Utilitaires de Formatage (src/utils/formatting.ts)
 * ----------------------------------------------------------------------------
 * Ce module rassemble les fonctions de formatage (durée, dates, nombres,
 * échappement HTML, raccourcis clavier).
 * 
 * Sommaire des exportations :
 * - fmtTime(s) : Formate un nombre de secondes en M:SS.
 * - escapeHtml(s) : Échappe les caractères spéciaux HTML.
 * - formatMbDate(raw) : Formate une date MusicBrainz.
 * - formatFanCount(n) : Formate un nombre de fans.
 * - calculateAgeOrDuration(...) : Calcule un âge ou une durée d'activité.
 * - formatKeyName(key, code) : Formate un nom de touche de raccourci.
 * - updateSliderTrack(input) : Met à jour le style visuel de progression d'un range input.
 * ============================================================================
 */

export function fmtTime(s: number): string {
  if (isNaN(s) || s < 0) return "0:00";
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatMbDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const parts = raw.split("-");
  if (parts.length === 1 && parts[0]) return parts[0];
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }
  return raw;
}

export function formatFanCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function calculateAgeOrDuration(
  begin: string | null | undefined,
  end: string | null | undefined,
  isEnded: boolean | null | undefined
): string {
  if (!begin) return "";
  const startYear = parseInt(begin.split("-")[0], 10);
  if (isNaN(startYear)) return "";

  if (isEnded && end) {
    const endYear = parseInt(end.split("-")[0], 10);
    if (!isNaN(endYear) && endYear >= startYear) {
      const duration = endYear - startYear;
      return `${duration} an${duration > 1 ? "s" : ""} d'activité (${startYear} - ${endYear})`;
    }
  } else if (!isEnded) {
    const currentYear = new Date().getFullYear();
    const ageOrYears = currentYear - startYear;
    return `${ageOrYears} ans (depuis ${startYear})`;
  }
  return "";
}

export function formatKeyName(key: string, code: string): string {
  if (key === " ") return "Espace";
  if (code.startsWith("Key")) return code.replace("Key", "");
  if (code.startsWith("Digit")) return code.replace("Digit", "");
  if (code.startsWith("Numpad")) return "PavéNum " + code.replace("Numpad", "");
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function updateSliderTrack(input: HTMLInputElement | null) {
  if (!input) return;
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const val = parseFloat(input.value) || 0;
  const pct = max > min ? Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100)) : 0;
  input.style.setProperty("--progress", `${pct}%`);
}
