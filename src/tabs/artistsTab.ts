/**
 * ============================================================================
 * Rustify — Vue Artistes & Groupes (src/tabs/artistsTab.ts)
 * ----------------------------------------------------------------------------
 * Ce module gère la vue des artistes séparés en 2 sections (Artistes Solo et
 * Groupes & Bands), la bannière de profil d'un artiste et les détails MusicBrainz/Wikidata.
 * 
 * Sommaire des exportations :
 * - isArtistGroup(a) : Détermine si un artiste est un groupe ou un artiste solo.
 * - loadArtists() : Charge et répartit les artistes dans les grilles Solo / Groupe.
 * - renderArtistsGrid(artists, container) : Génère la grille des artistes.
 * - openArtistView(summary) : Affiche les morceaux et la bannière d'un artiste.
 * - openArtistByName(artistName) : Recherche et ouvre la vue d'un artiste par son nom.
 * - fetchBandMembersAndBio(artistName) : Récupère la bio et membres du groupe.
 * - renderArtistBannerExtras(a) : Rendu des détails de la bannière (statut, dates, etc.).
 * - setArtistsTabCallbacks(callbacks) : Enregistre les abonnements d'événements.
 * ============================================================================
 */

import { invoke } from "@tauri-apps/api/core";
import { $, allTracks, getCoverDataUrl } from "../state";
import type { ArtistSummary, BandDetailsResult, BandMember, Track, ContextTarget, NavState } from "../types";
import { escapeHtml, formatMbDate, formatFanCount, calculateAgeOrDuration } from "../utils/formatting";

export interface ArtistsTabCallbacks {
  switchView: (view: string) => void;
  renderTracks: (tracks: Track[], playlistId?: string) => void;
  pushNavState: (state: NavState) => void;
  openArtistModal: (artist: ArtistSummary) => void;
  openGenericContextMenu: (e: MouseEvent, target: ContextTarget) => void;
}

let artistsCallbacks: Partial<ArtistsTabCallbacks> = {};

export function setArtistsTabCallbacks(callbacks: Partial<ArtistsTabCallbacks>) {
  artistsCallbacks = { ...artistsCallbacks, ...callbacks };
}

export function isArtistGroup(a: ArtistSummary): boolean {
  if (a.is_group !== null && a.is_group !== undefined) {
    return a.is_group;
  }

  if (a.members) {
    try {
      const parsed = JSON.parse(a.members);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  const name = a.artist.trim();
  const nameLower = name.toLowerCase();

  const connectors = [" & ", " and ", " feat ", " feat. ", " ft. ", " ft ", " vs ", " vs. ", " x ", " / ", " with ", " avec "];
  if (connectors.some((conn) => nameLower.includes(conn))) {
    return true;
  }

  const groupKeywords = [
    "band", "group", "duo", "trio", "quartet", "quintet", "sextet",
    "orchestra", "orchestre", "ensemble", "choir", "chœur", "choeur",
    "philharmonic", "philharmonie", "quartette", "boys", "boyz", "girls",
    "brothers", "frères", "sisters", "sœurs", "soeurs", "kids", "crew",
    "sound system", "soundsystem", "collective", "collectif", "club"
  ];
  if (groupKeywords.some((kw) => nameLower.includes(kw))) {
    return true;
  }

  const groupPrefixes = ["the ", "les ", "die ", "los ", "las "];
  if (groupPrefixes.some((p) => nameLower.startsWith(p))) {
    const soloExceptions = ["the weeknd", "the game", "the flexican"];
    if (!soloExceptions.includes(nameLower)) {
      return true;
    }
  }

  if (a.bio) {
    const bioLower = a.bio.toLowerCase();
    if (
      bioLower.includes("groupe de") ||
      bioLower.includes("band") ||
      bioLower.includes("formation musicale") ||
      bioLower.includes("duo de") ||
      bioLower.includes("trio de") ||
      bioLower.includes("quartet de") ||
      bioLower.includes("fondé par") ||
      bioLower.includes("composé de") ||
      bioLower.includes("membres du groupe")
    ) {
      return true;
    }
  }

  return false;
}

export async function fetchBandMembersAndBio(artistName: string): Promise<BandDetailsResult> {
  try {
    const result = await invoke<BandDetailsResult>("fetch_band_members_and_bio", { artistName });
    return result;
  } catch (e) {
    console.warn("Erreur fetch_band_members_and_bio", e);
    return { bio: null, members: [] };
  }
}

export function renderArtistBannerExtras(a: ArtistSummary) {
  const row = $("artist-banner-extra-row");
  if (!row) return;

  const isGrp = isArtistGroup(a);
  const chips: string[] = [];

  if (a.is_ended) {
    const endLabel = isGrp ? "Groupe dissous" : "Artiste décédé";
    chips.push(
      `<span class="artist-status-badge ended"><i class="fa-solid ${isGrp ? "fa-ban" : "fa-skull"}"></i> ${endLabel}</span>`
    );
  } else {
    const activeLabel = isGrp ? "Groupe actif" : "Artiste actif";
    chips.push(
      `<span class="artist-status-badge active"><i class="fa-solid fa-circle-check"></i> ${activeLabel}</span>`
    );
  }

  const detailChips: string[] = [];

  if (!isGrp) {
    if (a.life_span_begin) {
      detailChips.push(
        `<span class="artist-detail-chip chip-born"><i class="fa-solid fa-cake-candles"></i> Né(e) le ${formatMbDate(a.life_span_begin)}</span>`
      );
    }
    if (a.is_ended && a.life_span_end) {
      const ageStr = calculateAgeOrDuration(a.life_span_begin, a.life_span_end, true);
      detailChips.push(
        `<span class="artist-detail-chip chip-death"><i class="fa-solid fa-cross"></i> Décédé(e) le ${formatMbDate(a.life_span_end)} (${ageStr})</span>`
      );
    } else if (!a.is_ended && a.life_span_begin) {
      const ageStr = calculateAgeOrDuration(a.life_span_begin, null, false);
      if (ageStr) {
        detailChips.push(
          `<span class="artist-detail-chip chip-age"><i class="fa-solid fa-hourglass-half"></i> ${ageStr}</span>`
        );
      }
    }
    if (a.death_cause) {
      detailChips.push(
        `<span class="artist-detail-chip chip-cause"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(a.death_cause)}</span>`
      );
    }
  } else {
    if (a.life_span_begin) {
      detailChips.push(
        `<span class="artist-detail-chip chip-active"><i class="fa-solid fa-calendar-plus"></i> Formé le ${formatMbDate(a.life_span_begin)}</span>`
      );
    }
    if (a.is_ended && a.life_span_end) {
      const durStr = calculateAgeOrDuration(a.life_span_begin, a.life_span_end, true);
      detailChips.push(
        `<span class="artist-detail-chip chip-death"><i class="fa-solid fa-calendar-xmark"></i> Dissous le ${formatMbDate(a.life_span_end)} (${durStr})</span>`
      );
    } else if (!a.is_ended && a.life_span_begin) {
      const durStr = calculateAgeOrDuration(a.life_span_begin, null, false);
      if (durStr) {
        detailChips.push(
          `<span class="artist-detail-chip chip-duration"><i class="fa-solid fa-music"></i> ${durStr}</span>`
        );
      }
    }
  }

  if (a.fan_count) {
    detailChips.push(
      `<span class="artist-detail-chip"><i class="fa-solid fa-heart"></i> ${formatFanCount(a.fan_count)} fans (Deezer)</span>`
    );
  }

  const links: string[] = [];
  if (a.external_ids?.discogs) {
    links.push(`<a href="https://www.discogs.com/artist/${encodeURIComponent(a.external_ids.discogs)}" target="_blank" rel="noopener" class="artist-external-link" title="Discogs"><i class="fa-brands fa-discogs"></i></a>`);
  }
  if (a.external_ids?.spotify) {
    links.push(`<a href="https://open.spotify.com/artist/${encodeURIComponent(a.external_ids.spotify)}" target="_blank" rel="noopener" class="artist-external-link" title="Spotify"><i class="fa-brands fa-spotify"></i></a>`);
  }
  if (a.external_ids?.imdb) {
    links.push(`<a href="https://www.imdb.com/name/${encodeURIComponent(a.external_ids.imdb)}" target="_blank" rel="noopener" class="artist-external-link" title="IMDb"><i class="fa-brands fa-imdb"></i></a>`);
  }
  if (links.length > 0) {
    detailChips.push(`<span class="artist-external-links">${links.join("")}</span>`);
  }

  const allHtml = [
    chips.join(""),
    detailChips.length > 0 ? `<div class="artist-detail-chips">${detailChips.join("")}</div>` : "",
  ].filter(Boolean).join("");

  if (!allHtml) {
    row.hidden = true;
    row.innerHTML = "";
  } else {
    row.hidden = false;
    row.innerHTML = allHtml;
  }
}

export async function openArtistView(a: ArtistSummary) {
  const normArtistName = a.artist.trim().toLowerCase();
  const tracks = allTracks.filter((t) => {
    const trackArtist = (t.artist || "").trim().toLowerCase();
    const albumArtist = (t.album_artist || "").trim().toLowerCase();
    if (!trackArtist && !albumArtist) return false;
    return (
      trackArtist === normArtistName ||
      albumArtist === normArtistName ||
      (trackArtist && trackArtist.includes(normArtistName)) ||
      (albumArtist && albumArtist.includes(normArtistName))
    );
  });

  artistsCallbacks.switchView?.("tracks");

  const viewTitle = $("view-title");
  if (viewTitle) viewTitle.textContent = `Artiste : ${a.artist}`;

  const searchInput = $<HTMLInputElement>("search");
  artistsCallbacks.pushNavState?.({ type: "artist", view: "tracks", artistSummary: a, searchQuery: searchInput ? searchInput.value : "" });

  const artistHeader = $("artist-header");
  const artistNameEl = $("artist-banner-name");
  const artistGenreEl = $("artist-banner-genre");
  const artistCountEl = $("artist-banner-count");
  const artistAvatarImg = $<HTMLImageElement>("artist-avatar-img");
  const artistAvatarPlaceholder = $("artist-avatar-placeholder");
  const artistMembersBox = $("artist-members-box");
  const artistMembersList = $("artist-members-list");
  const artistBioText = $("artist-bio-text");

  if (artistNameEl) artistNameEl.textContent = a.artist;
  if (artistCountEl) artistCountEl.textContent = `${tracks.length} morceau(x)`;
  renderArtistBannerExtras(a);

  const sampleTrack = tracks.find((t) => t.genre);
  if (artistGenreEl) artistGenreEl.textContent = sampleTrack?.genre || "Musique";

  const photoUrl = await getCoverDataUrl(a.image_path || null);
  if (artistAvatarImg && artistAvatarPlaceholder) {
    if (photoUrl) {
      artistAvatarImg.src = photoUrl;
      artistAvatarImg.hidden = false;
      artistAvatarPlaceholder.hidden = true;
    } else {
      artistAvatarImg.hidden = true;
      artistAvatarPlaceholder.hidden = false;
    }
  }

  const renderBioAndMembers = (bio: string | null, membersList: BandMember[]) => {
    if (artistMembersList && artistMembersBox) {
      if (membersList && membersList.length > 0) {
        artistMembersList.innerHTML = membersList
          .map((m) => {
            const avatarHtml = m.photoUrl
              ? `<img src="${m.photoUrl}" class="member-avatar" alt="${escapeHtml(m.name)}" />`
              : `<div class="member-avatar-placeholder"><i class="fa-solid fa-user"></i></div>`;
            return `
              <div class="member-card" data-member="${escapeHtml(m.name)}" title="Voir la fiche de ${escapeHtml(m.name)}">
                ${avatarHtml}
                <span class="member-name">${escapeHtml(m.name)}</span>
              </div>
            `;
          })
          .join("");

        artistMembersList.querySelectorAll(".member-card").forEach((card) => {
          card.addEventListener("click", () => {
            const memberName = (card as HTMLElement).dataset.member;
            if (memberName) openArtistByName(memberName);
          });
        });

        artistMembersBox.hidden = false;
      } else {
        artistMembersBox.hidden = true;
      }
    }

    if (artistBioText) {
      if (bio) {
        artistBioText.textContent = bio;
        artistBioText.hidden = false;
        const isLong = bio.length > 200;
        if (isLong) {
          artistBioText.classList.add("clamped");
          let toggleBtn = artistBioText.nextElementSibling as HTMLButtonElement | null;
          if (!toggleBtn || !toggleBtn.classList.contains("bio-toggle")) {
            toggleBtn = document.createElement("button");
            toggleBtn.className = "bio-toggle";
            artistBioText.after(toggleBtn);
          }
          toggleBtn.textContent = "Voir plus ▾";
          toggleBtn.onclick = () => {
            const clamped = artistBioText!.classList.toggle("clamped");
            toggleBtn!.textContent = clamped ? "Voir plus ▾" : "Voir moins ▴";
          };
        } else {
          artistBioText.classList.remove("clamped");
          const old = artistBioText.nextElementSibling;
          if (old && old.classList.contains("bio-toggle")) old.remove();
        }
      } else {
        artistBioText.hidden = true;
        artistBioText.classList.remove("clamped");
        const old = artistBioText.nextElementSibling;
        if (old && old.classList.contains("bio-toggle")) old.remove();
      }
    }
  };

  let parsedMembers: BandMember[] = [];
  if (a.members) {
    try {
      const raw = JSON.parse(a.members);
      if (Array.isArray(raw)) {
        parsedMembers = raw.map((item: unknown) =>
          typeof item === "string" ? { name: item, photoUrl: null } : (item as BandMember)
        );
      }
    } catch {
      parsedMembers = [];
    }
  }

  renderBioAndMembers(a.bio, parsedMembers);

  if (artistHeader) {
    artistHeader.hidden = false;
    artistHeader.style.display = "flex";
    artistHeader.classList.toggle("is-ended-banner", !!a.is_ended);
  }

  if (!photoUrl && artistAvatarPlaceholder) {
    const icon = artistAvatarPlaceholder.querySelector("i");
    if (icon) {
      if (a.is_ended && !isArtistGroup(a)) icon.className = "fa-solid fa-skull";
      else if (a.is_ended) icon.className = "fa-solid fa-ban";
      else if (isArtistGroup(a)) icon.className = "fa-solid fa-users";
      else icon.className = "fa-solid fa-user";
    }
  }

  artistsCallbacks.renderTracks?.(tracks);

  if (!a.bio || !a.members) {
    fetchBandMembersAndBio(a.artist).then(async (res) => {
      if (res.bio || res.members.length > 0) {
        renderBioAndMembers(res.bio || a.bio, res.members.length > 0 ? res.members : parsedMembers);
        try {
          await invoke("save_artist_metadata", {
            artist: a.artist,
            genre: null,
            bio: res.bio,
            members: JSON.stringify(res.members),
            imageBase64: null,
          });
        } catch (err) {
          console.error("Erreur sauvegarde bio/members artiste", err);
        }
      }
    });
  }
}

export async function openArtistByName(artistName: string) {
  const artists = await invoke<ArtistSummary[]>("get_artists");
  const norm = artistName.trim().toLowerCase();
  const summary = artists.find((a) => a.artist.trim().toLowerCase() === norm || a.artist.trim().toLowerCase().includes(norm)) || {
    artist: artistName,
    track_count: allTracks.filter((t) => {
      const ta = (t.artist || "").trim().toLowerCase();
      const aa = (t.album_artist || "").trim().toLowerCase();
      return ta === norm || aa === norm || ta.includes(norm) || aa.includes(norm);
    }).length,
    image_path: null,
    bio: null,
    members: null,
  };
  openArtistView(summary);
}

export async function renderArtistsGrid(artists: ArtistSummary[], container: HTMLElement) {
  container.innerHTML = "";
  for (const a of artists) {
    const card = document.createElement("div");
    const isEnded = !!a.is_ended;
    const isGrp = isArtistGroup(a);
    card.className = "grid-card artist-card" + (isEnded ? " is-ended" : "");
    const isFav = !!a.is_favorite;
    const photoUrl = await getCoverDataUrl(a.image_path || null);
    const photoHtml = photoUrl
      ? `<img src="${photoUrl}" class="cover-img" alt="${escapeHtml(a.artist)}" />`
      : `<div class="cover-placeholder"><i class="fa-solid ${isGrp ? "fa-users" : "fa-user"}"></i></div>`;

    const endedTagHtml = isEnded
      ? `<div class="ended-tag"><i class="fa-solid ${isGrp ? "fa-ban" : "fa-cross"}"></i>${isGrp ? "Dissous" : "Décédé"}</div>`
      : "";

    card.innerHTML = `
      <button class="card-fav-btn ${isFav ? "is-fav" : ""}" title="Favori">
        <i class="${isFav ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i>
      </button>
      ${photoHtml}
      <div class="title">${escapeHtml(a.artist)}</div>
      <div class="subtitle">
        <span class="type-tag">${isGrp ? '<i class="fa-solid fa-users"></i> Groupe' : '<i class="fa-solid fa-user"></i> Solo'}</span>
        · ${a.track_count} morceau(x)
      </div>
      ${endedTagHtml}
    `;

    const favBtn = card.querySelector(".card-fav-btn");
    favBtn?.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const newFav = await invoke<boolean>("toggle_favorite", { targetType: "artist", targetId: a.artist });
      a.is_favorite = newFav;
      favBtn.classList.toggle("is-fav", newFav);
      const icon = favBtn.querySelector("i");
      if (icon) icon.className = newFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
    });

    card.addEventListener("click", () => {
      openArtistView(a);
    });

    card.addEventListener("contextmenu", (e) => {
      artistsCallbacks.openGenericContextMenu?.(e, { type: "artist", artist: a });
    });

    container.appendChild(card);
  }
}

export async function loadArtists() {
  const artists = await invoke<ArtistSummary[]>("get_artists");

  const gridSolo = $("grid-solo-artists");
  const gridGroup = $("grid-group-artists");
  const countSolo = $("count-solo-artists");
  const countGroup = $("count-group-artists");
  const emptySolo = $("empty-solo-artists");
  const emptyGroup = $("empty-group-artists");

  const soloArtists: ArtistSummary[] = [];
  const groupArtists: ArtistSummary[] = [];

  for (const a of artists) {
    if (isArtistGroup(a)) {
      groupArtists.push(a);
    } else {
      soloArtists.push(a);
    }
  }

  if (gridSolo) await renderArtistsGrid(soloArtists, gridSolo);
  if (gridGroup) await renderArtistsGrid(groupArtists, gridGroup);

  if (countSolo) countSolo.textContent = String(soloArtists.length);
  if (countGroup) countGroup.textContent = String(groupArtists.length);
  if (emptySolo) emptySolo.hidden = soloArtists.length > 0;
  if (emptyGroup) emptyGroup.hidden = groupArtists.length > 0;
}
