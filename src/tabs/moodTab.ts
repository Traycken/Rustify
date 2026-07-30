/**
 * ============================================================================
 * Rustify — Onglet Humeur & Recommandation Orientée (src/tabs/moodTab.ts)
 * ----------------------------------------------------------------------------
 * Permet à l'utilisateur de sélectionner son humeur (émoji + explication),
 * de consulter les conseils de tempo associés, de choisir une orientation de
 * playlist et de générer la file de lecture au fil des écoutes.
 * ============================================================================
 */

import { $, allTracks, activeMoodId, setActiveMoodId, activeMoodPlaylistId, setActiveMoodPlaylistId, activeMoodPlaylistOption, setActiveMoodPlaylistOption, getCoverDataUrl } from "../state";
import type { MoodDefinition, MoodPlaylistOption, Track, NavState } from "../types";
import { escapeHtml } from "../utils/formatting";

export interface MoodTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
  playFromQueue: (queue: Track[], index: number, isManual?: boolean) => void;
  pushNavState: (state: NavState) => void;
  openGenericContextMenu: (e: MouseEvent, target: any) => void;
}

let moodCallbacks: Partial<MoodTabCallbacks> = {};

export function setMoodTabCallbacks(callbacks: Partial<MoodTabCallbacks>) {
  moodCallbacks = { ...moodCallbacks, ...callbacks };
}

export const MOOD_DEFINITIONS: MoodDefinition[] = [
  {
    id: "enerve",
    emoji: "😡",
    label: "Énervé / Colère",
    description: "Tension accumulée, frustration ou besoin d'évacuation émotionnelle.",
    tempoAdvice: "💡 Conseil Tempo : Pour apaiser la colère, privilégiez un tempo doux (BPM < 95). Pour vous défouler cathartiquement, optez pour du tempo très rapide (130+ BPM).",
    playlists: [
      {
        id: "enerve_apaisante",
        title: "🌿 Apaisante & Bulle Zen",
        description: "Morceaux calmes à tempo doux (BPM < 95) pour faire retomber la pression et apaiser l'esprit.",
        icon: "fa-solid fa-leaf",
        targetBpmMax: 95,
        favoredGenres: ["ambient", "classical", "lo-fi", "piano", "acoustic", "soft", "chill", "soundtrack"],
        penalizedGenres: ["rock", "metal", "punk", "hardstyle", "phonk", "techno", "dubstep"],
        energyTarget: "low",
      },
      {
        id: "enerve_defoulement",
        title: "⚡ Défoulement Cathartique",
        description: "Morceaux intenses et rythmés (125+ BPM) pour évacuer toute l'énergie et la frustration.",
        icon: "fa-solid fa-bolt",
        targetBpmMin: 125,
        favoredGenres: ["rock", "metal", "punk", "phonk", "hard rock", "electro", "dubstep"],
        penalizedGenres: ["ambient", "sleep", "lullaby", "classical piano"],
        energyTarget: "high",
      },
      {
        id: "enerve_transition",
        title: "🌊 Transition Douce",
        description: "Tempos modérés (90 - 115 BPM) pour faire redescendre la tension progressivement.",
        icon: "fa-solid fa-water",
        targetBpmMin: 90,
        targetBpmMax: 115,
        favoredGenres: ["pop", "indie", "lo-fi", "jazz", "soul"],
        penalizedGenres: ["metal", "hardstyle"],
        energyTarget: "medium",
      },
    ],
  },
  {
    id: "triste",
    emoji: "😢",
    label: "Triste / Mélancolique",
    description: "Baisse de moral, besoin de réconfort ou de nostalgie.",
    tempoAdvice: "💡 Conseil Tempo : Un tempo lent à modéré (60 – 100 BPM) accompagne la mélancolie tout en préparant un regain d'espoir.",
    playlists: [
      {
        id: "triste_reconfort",
        title: "🫂 Réconfort & Câlin Auditif",
        description: "Ballades douces et acoustiques pour envelopper votre mélancolie avec bienveillance.",
        icon: "fa-solid fa-heart-crack",
        targetBpmMax: 100,
        favoredGenres: ["acoustic", "piano", "ballad", "indie", "soft", "chill", "soul"],
        penalizedGenres: ["hardstyle", "metal", "techno", "party"],
        energyTarget: "low",
      },
      {
        id: "triste_soleil",
        title: "🌅 Regain d'Espoir & Lumière",
        description: "Musiques lumineuses et rythmées (100 - 125 BPM) pour faire réapparaître le soleil.",
        icon: "fa-solid fa-sun",
        targetBpmMin: 100,
        targetBpmMax: 125,
        favoredGenres: ["pop", "indie pop", "feel good", "sunshine", "folk"],
        penalizedGenres: ["ambient", "funeral", "goth"],
        energyTarget: "medium",
      },
    ],
  },
  {
    id: "joyeux",
    emoji: "😊",
    label: "Joyeux / Enjoué",
    description: "Bonne humeur, envie de célébrer et énergie positive.",
    tempoAdvice: "💡 Conseil Tempo : Un tempo dynamique et rapide (115 – 140 BPM) amplifie la dopamine et la sensation de fête.",
    playlists: [
      {
        id: "joyeux_fiesta",
        title: "🎉 Fiesta & Euphorie",
        description: "Titres entraînants et pétillants (115+ BPM) pour célébrer le moment présent.",
        icon: "fa-solid fa-champagne-glasses",
        targetBpmMin: 115,
        favoredGenres: ["pop", "dance", "funk", "disco", "electro", "latin"],
        penalizedGenres: ["ambient", "slow", "funeral", "depressing"],
        energyTarget: "high",
      },
      {
        id: "joyeux_feelgood",
        title: "☀️ Feel Good & Vitalité",
        description: "Atmosphère chaleureuse (100 - 130 BPM) idéale pour garder le sourire toute la journée.",
        icon: "fa-solid fa-face-smile-beam",
        targetBpmMin: 100,
        targetBpmMax: 130,
        favoredGenres: ["indie pop", "soul", "funk", "reggae", "pop rock"],
        penalizedGenres: ["metal", "goth", "slow"],
        energyTarget: "medium",
      },
    ],
  },
  {
    id: "stresse",
    emoji: "😰",
    label: "Stressé / Anxieux",
    description: "Pression mentale, surmenage ou sensation d'oppression.",
    tempoAdvice: "💡 Conseil Tempo : Un tempo très lent et régulier (50 – 80 BPM) favorise la régulation de la fréquence cardiaque au repos.",
    playlists: [
      {
        id: "stresse_antistress",
        title: "🍃 Anti-Stress & Respiration",
        description: "Musiques minimalistes et lentes (BPM < 85) concues pour vous immerger dans un cocon décompressant.",
        icon: "fa-solid fa-spa",
        targetBpmMax: 85,
        favoredGenres: ["ambient", "piano", "chillout", "classical", "meditation", "nature"],
        penalizedGenres: ["rock", "metal", "fast", "dance", "techno"],
        energyTarget: "low",
      },
      {
        id: "stresse_lofi",
        title: "☕ Pause Café Lo-Fi",
        description: "Rythmes doux Lo-Fi & Jazz Chill (75 - 100 BPM) pour se vider la tête.",
        icon: "fa-solid fa-mug-hot",
        targetBpmMin: 75,
        targetBpmMax: 100,
        favoredGenres: ["lo-fi", "jazz", "chill", "instrumental", "hip hop chill"],
        penalizedGenres: ["hard rock", "techno", "dubstep"],
        energyTarget: "medium",
      },
    ],
  },
  {
    id: "fatigue",
    emoji: "🥱",
    label: "Fatigué / Épuisé",
    description: "Manque d'énergie, fatigue physique ou mentale.",
    tempoAdvice: "💡 Conseil Tempo : Pour un réveil doux, optez pour du 80 – 105 BPM. Pour un boost immédiat, choisissez du 120+ BPM.",
    playlists: [
      {
        id: "fatigue_booster",
        title: "⚡ Booster d'Énergie",
        description: "Titres énergisants (115+ BPM) pour relancer la machine et contrer la léthargie.",
        icon: "fa-solid fa-battery-charging",
        targetBpmMin: 115,
        favoredGenres: ["dance", "pop", "rock", "synthwave", "electro"],
        penalizedGenres: ["ambient", "lullaby", "sleep"],
        energyTarget: "high",
      },
      {
        id: "fatigue_repos",
        title: "🛋️ Repos & Douceur",
        description: "Melodies douces (BPM < 90) pour vous laisser bercer sans effort.",
        icon: "fa-solid fa-couch",
        targetBpmMax: 90,
        favoredGenres: ["acoustic", "ambient", "soft piano", "instrumental", "chill"],
        penalizedGenres: ["metal", "hardstyle", "electro"],
        energyTarget: "low",
      },
    ],
  },
  {
    id: "energetique",
    emoji: "⚡",
    label: "Énergique / Motivé",
    description: "Plein de peps, envie d'action, de sport ou de dépassement.",
    tempoAdvice: "💡 Conseil Tempo : Un tempo soutenu et très rapide (130 – 160+ BPM) est l'allié parfait pour les entraînements et la cadence.",
    playlists: [
      {
        id: "energetique_workout",
        title: "🏃 Workout & Pulse Extrême",
        description: "Haute intensité (130+ BPM) pour exploser vos records et pousser à fond.",
        icon: "fa-solid fa-person-running",
        targetBpmMin: 130,
        favoredGenres: ["electro", "rock", "metal", "phonk", "synthwave", "dance", "workout"],
        penalizedGenres: ["ambient", "slow", "lullaby"],
        energyTarget: "high",
      },
      {
        id: "energetique_sprint",
        title: "🚀 Sprint & Motivation",
        description: "Musiques ultra motivantes (120+ BPM) pour garder le rythme.",
        icon: "fa-solid fa-rocket",
        targetBpmMin: 120,
        favoredGenres: ["pop", "rock", "electro", "hip hop"],
        penalizedGenres: ["slow", "acoustic ballad"],
        energyTarget: "high",
      },
    ],
  },
  {
    id: "calme",
    emoji: "🧘",
    label: "Calme / Sérénité",
    description: "Esprit apaisé, besoin de repos ou de méditation.",
    tempoAdvice: "💡 Conseil Tempo : Les tempos très lents (< 80 BPM) créent une résonance apaisante idéale pour la relaxation profonde.",
    playlists: [
      {
        id: "calme_meditation",
        title: "🧘‍♂️ Méditation & Sérénité",
        description: "Paysages sonores zen et contemplatifs (BPM < 80) pour ralentir le temps.",
        icon: "fa-solid fa-om",
        targetBpmMax: 80,
        favoredGenres: ["ambient", "new age", "classical", "acoustic", "meditation"],
        penalizedGenres: ["rock", "metal", "dance", "punk"],
        energyTarget: "low",
      },
      {
        id: "calme_reverie",
        title: "📖 Lecture & Rêverie",
        description: "Morceaux instrumentaux et acoustiques doux pour accompagner vos moments calmes.",
        icon: "fa-solid fa-book-open-reader",
        targetBpmMax: 95,
        favoredGenres: ["piano", "instrumental", "lo-fi", "acoustic"],
        penalizedGenres: ["hard", "fast", "metal"],
        energyTarget: "low",
      },
    ],
  },
  {
    id: "concentre",
    emoji: "🎯",
    label: "Concentré / Travail",
    description: "Besoin de focus, de travail intellectuel et de productivité.",
    tempoAdvice: "💡 Conseil Tempo : Un tempo régulier et modéré (80 – 110 BPM), de préférence instrumental, favorise l'état de 'flow'.",
    playlists: [
      {
        id: "concentre_deepfocus",
        title: "🧠 Deep Focus & Lo-Fi",
        description: "Musique répétitive et rythmée sans paroles intrusives pour une concentration maximale.",
        icon: "fa-solid fa-brain",
        targetBpmMin: 80,
        targetBpmMax: 110,
        favoredGenres: ["lo-fi", "synthwave", "ambient", "instrumental", "electronic chill"],
        penalizedGenres: ["metal", "screaming", "vocal pop", "rap"],
        requireInstrumental: true,
        energyTarget: "medium",
      },
      {
        id: "concentre_piano",
        title: "🎹 Neoclassical & Study Piano",
        description: "Compositions piano et cordes élégantes pour stimuler la réflexion créative.",
        icon: "fa-solid fa-music",
        targetBpmMax: 110,
        favoredGenres: ["piano", "classical", "instrumental", "soundtrack"],
        penalizedGenres: ["heavy metal", "rap", "techno"],
        requireInstrumental: true,
        energyTarget: "medium",
      },
    ],
  },
];

export function scoreTrackForMoodPlaylist(track: Track, option: MoodPlaylistOption): number {
  let score = track.effective_score ?? 100;
  const genreLower = (track.genre || "").toLowerCase();
  const titleLower = (track.title || "").toLowerCase();
  const artistLower = (track.artist || "").toLowerCase();
  const tagsLower = (track.tags || []).map((t) => t.toLowerCase()).join(" ");
  const textBlob = `${genreLower} ${tagsLower} ${titleLower} ${artistLower}`;

  // 1. Pénalisation stricte sur genres incompatibles
  for (const pen of option.penalizedGenres) {
    if (textBlob.includes(pen.toLowerCase())) {
      score -= 300;
    }
  }

  // 2. Bonus sur genres/tags recherchés
  for (const fav of option.favoredGenres) {
    if (textBlob.includes(fav.toLowerCase())) {
      score += 150;
    }
  }

  // 3. Ajustement selon le BPM
  if (track.bpm && track.bpm > 0) {
    if (option.targetBpmMin !== undefined && track.bpm < option.targetBpmMin) {
      const diff = option.targetBpmMin - track.bpm;
      score -= Math.min(250, diff * 6);
    } else if (option.targetBpmMax !== undefined && track.bpm > option.targetBpmMax) {
      const diff = track.bpm - option.targetBpmMax;
      score -= Math.min(250, diff * 6);
    } else {
      score += 120; // Bonus plage BPM idéale
    }
  }

  // 4. Exigence Instrumentale (si spécifié)
  if (option.requireInstrumental) {
    if (track.is_instrumental === true) score += 100;
    if (track.is_instrumental === false) score -= 120;
  }

  // 5. Cible d'énergie
  if (option.energyTarget === "low") {
    if (track.bpm && track.bpm > 120) score -= 150;
  } else if (option.energyTarget === "high") {
    if (track.bpm && track.bpm < 95) score -= 150;
  }

  return score;
}

export function generateMoodPlaylistTracks(option: MoodPlaylistOption): Track[] {
  const scored = allTracks.map((t) => ({
    track: t,
    score: scoreTrackForMoodPlaylist(t, option),
  }));

  // Filtrer les pistes avec un score minimal pertinent
  const filtered = scored.filter((x) => x.score > -100);

  // Trier par score décroissant
  filtered.sort((a, b) => b.score - a.score);

  return filtered.map((x) => x.track);
}

export function selectMood(moodId: string) {
  setActiveMoodId(moodId);
  const mood = MOOD_DEFINITIONS.find((m) => m.id === moodId);
  if (!mood) return;

  // Sélectionner par défaut la première option de playlist de cette humeur
  if (mood.playlists.length > 0) {
    selectMoodPlaylist(mood.playlists[0].id);
  } else {
    setActiveMoodPlaylistId(null);
    setActiveMoodPlaylistOption(null);
    renderMoodUI();
  }
}

export function selectMoodPlaylist(playlistId: string) {
  const currentMood = MOOD_DEFINITIONS.find((m) => m.id === activeMoodId);
  if (!currentMood) return;

  const option = currentMood.playlists.find((p) => p.id === playlistId);
  if (!option) return;

  setActiveMoodPlaylistId(playlistId);
  setActiveMoodPlaylistOption(option);

  renderMoodUI();
}

export function getOrientedMoodTrack(excludeIds: string[] = []): Track | null {
  if (!activeMoodPlaylistOption) return null;

  const candidates = generateMoodPlaylistTracks(activeMoodPlaylistOption);
  const available = candidates.filter((t) => !excludeIds.includes(t.id));

  if (available.length === 0) {
    return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }

  // Prendre une piste parmi le top 35% des candidates pour garder une part d'aléatoire
  const topCount = Math.max(1, Math.floor(available.length * 0.35));
  const pool = available.slice(0, topCount);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function loadMood() {
  if (!activeMoodId) {
    setActiveMoodId("enerve");
    if (MOOD_DEFINITIONS[0].playlists.length > 0) {
      setActiveMoodPlaylistId(MOOD_DEFINITIONS[0].playlists[0].id);
      setActiveMoodPlaylistOption(MOOD_DEFINITIONS[0].playlists[0]);
    }
  }

  renderMoodUI();
}

export function renderMoodUI() {
  const moodGrid = $("grid-mood-selector");
  const adviceBanner = $("mood-tempo-advice");
  const playlistsGrid = $("grid-mood-playlists");
  const tracksTableBody = $("mood-tracks-tbody");
  const emptyState = $("empty-mood-tracks");
  const playlistTitleEl = $("mood-active-playlist-title");
  const btnStartPlayback = $("btn-start-mood-playback");

  if (!moodGrid || !adviceBanner || !playlistsGrid || !tracksTableBody) return;

  // 1. Rendu des cartes de sélection d'humeurs
  moodGrid.innerHTML = "";
  for (const m of MOOD_DEFINITIONS) {
    const card = document.createElement("div");
    card.className = `mood-card ${m.id === activeMoodId ? "active" : ""}`;
    card.innerHTML = `
      <div class="mood-emoji">${m.emoji}</div>
      <div class="mood-label">${escapeHtml(m.label)}</div>
      <div class="mood-desc">${escapeHtml(m.description)}</div>
    `;
    card.addEventListener("click", () => selectMood(m.id));
    moodGrid.appendChild(card);
  }

  const currentMood = MOOD_DEFINITIONS.find((m) => m.id === activeMoodId) || MOOD_DEFINITIONS[0];

  // 2. Rendu des conseils de tempo
  adviceBanner.innerHTML = `
    <div class="advice-icon"><i class="fa-solid fa-lightbulb"></i></div>
    <div class="advice-text">${escapeHtml(currentMood.tempoAdvice)}</div>
  `;

  // 3. Rendu des propositions de playlists
  playlistsGrid.innerHTML = "";
  for (const p of currentMood.playlists) {
    const pCard = document.createElement("div");
    const isSelected = p.id === activeMoodPlaylistId;
    pCard.className = `mood-playlist-card ${isSelected ? "selected" : ""}`;
    pCard.innerHTML = `
      <div class="playlist-card-header">
        <i class="${p.icon} playlist-card-icon"></i>
        <h3>${escapeHtml(p.title)}</h3>
      </div>
      <p class="playlist-card-desc">${escapeHtml(p.description)}</p>
      <div class="playlist-card-meta">
        ${p.targetBpmMax ? `<span class="meta-badge"><i class="fa-solid fa-gauge"></i> Max ${p.targetBpmMax} BPM</span>` : ""}
        ${p.targetBpmMin ? `<span class="meta-badge"><i class="fa-solid fa-gauge-high"></i> Min ${p.targetBpmMin} BPM</span>` : ""}
        ${p.requireInstrumental ? `<span class="meta-badge"><i class="fa-solid fa-file-audio"></i> Instrumental</span>` : ""}
      </div>
    `;
    pCard.addEventListener("click", () => selectMoodPlaylist(p.id));
    playlistsGrid.appendChild(pCard);
  }

  // 4. Rendu de la file/liste de pistes générées pour la playlist active
  const activeOption = activeMoodPlaylistOption || currentMood.playlists[0];
  if (playlistTitleEl && activeOption) {
    playlistTitleEl.textContent = `${activeOption.title} (${currentMood.emoji} ${currentMood.label})`;
  }

  if (activeOption) {
    const tracks = generateMoodPlaylistTracks(activeOption);
    tracksTableBody.innerHTML = "";

    if (emptyState) {
      emptyState.hidden = tracks.length > 0;
    }

    tracks.forEach((t, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.id = t.id;
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-cover"><div class="table-cover-cell"><div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div></div></td>
        <td><strong>${escapeHtml(t.title)}</strong></td>
        <td>${escapeHtml(t.artist)}</td>
        <td>${escapeHtml(t.album)}</td>
        <td style="text-align: center;">${t.bpm ? `<span class="bpm-pill">${Math.round(t.bpm)} BPM</span>` : '<span class="bpm-unknown">—</span>'}</td>
        <td class="col-time">${t.duration_secs ? `${Math.floor(t.duration_secs / 60)}:${String(Math.floor(t.duration_secs % 60)).padStart(2, "0")}` : "0:00"}</td>
      `;

      const coverCell = tr.querySelector(".table-cover-cell");
      if (coverCell && t.cover_path) {
        getCoverDataUrl(t.cover_path).then((dataUrl) => {
          if (dataUrl && coverCell) {
            coverCell.innerHTML = `<img src="${dataUrl}" class="table-cover-img" alt="" />`;
          }
        });
      }

      tr.addEventListener("dblclick", () => {
        moodCallbacks.playFromQueue?.(tracks, idx, true);
      });

      tr.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        moodCallbacks.openGenericContextMenu?.(e, { type: "track", track: t, queue: tracks, index: idx });
      });

      tracksTableBody.appendChild(tr);
    });

    if (btnStartPlayback) {
      btnStartPlayback.onclick = () => {
        if (tracks.length > 0) {
          moodCallbacks.playFromQueue?.(tracks, 0, true);
        }
      };
    }
  }
}
