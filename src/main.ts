import "@fortawesome/fontawesome-free/css/all.min.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  genre: string;
  year: number;
  track_no: number;
  duration_secs: number;
  has_cover: boolean;
  cover_path: string | null;
  likes?: number;
  dislikes?: number;
  is_favorite?: boolean;
  manual_select_count?: number;
  play_count?: number;
  skip_count?: number;
  total_listen_secs?: number;
  avg_listen_secs?: number;
}
interface AlbumSummary {
  album: string;
  album_artist: string;
  year: number;
  track_count: number;
  cover_path: string | null;
  is_favorite?: boolean;
}
interface ArtistSummary { artist: string; track_count: number; image_path: string | null; bio: string | null; members: string | null; is_group?: boolean | null; is_favorite?: boolean; }
interface HistoryItem { id: number; track: Track; played_at: string; }
interface FavoritesData { tracks: Track[]; albums: AlbumSummary[]; artists: ArtistSummary[]; }
interface Playlist { id: string; name: string; track_count: number; }
interface PlayerState {
  current_track: Track | null;
  is_playing: boolean;
  position_secs: number;
  volume: number;
  queue: Track[];
  queue_index: number;
  repeat: boolean;
  shuffle: boolean;
  audio_device: string | null;
}
interface LastPlayerState {
  volume: number;
  audio_device: string | null;
  track_id: string | null;
  position_secs: number;
  queue_index: number;
  track: Track | null;
}

let allTracks: Track[] = [];
let currentQueue: Track[] = [];
const coverCache = new Map<string, string>();
let isSeeking = false;

async function getCoverDataUrl(coverPath: string | null): Promise<string | null> {
  if (!coverPath) return null;
  if (coverCache.has(coverPath)) return coverCache.get(coverPath)!;
  try {
    const dataUrl = await invoke<string>("read_cover", { path: coverPath });
    coverCache.set(coverPath, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error("Erreur lecture pochette", e);
    return null;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function updateSliderTrack(input: HTMLInputElement | null) {
  if (!input) return;
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const val = parseFloat(input.value) || 0;
  const pct = max > min ? Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100)) : 0;
  input.style.setProperty("--progress", `${pct}%`);
}

const trackTbody = $("track-tbody");
const emptyState = $("empty-state");
const viewTitle = $("view-title");
const searchInput = $<HTMLInputElement>("search");
const btnPlay = $("btn-play");
const btnShuffle = $("btn-shuffle");
const btnRepeat = $("btn-repeat");
const seekBar = $<HTMLInputElement>("seek");
const volumeBar = $<HTMLInputElement>("volume");
const timeCurrent = $("time-current");
const timeTotal = $("time-total");
const nowTitle = $("now-title");
const nowArtist = $("now-artist");
const vinyl = $("vinyl");

interface ContextTarget {
  type: "track" | "album" | "artist" | "genre" | "playlist";
  track?: Track;
  index?: number;
  queue?: Track[];
  album?: AlbumSummary;
  artist?: ArtistSummary;
  genreName?: string;
  genreTracks?: Track[];
  playlistId?: string;
  playlistName?: string;
}

let activeCtxTarget: ContextTarget | null = null;

const contextMenu = $("context-menu");
const ctxPlaylistSubmenu = $("ctx-playlist-submenu");

async function openGenericContextMenu(e: MouseEvent, target: ContextTarget) {
  e.preventDefault();
  activeCtxTarget = target;

  const ctxPlay = $("ctx-play");
  const ctxAddQueue = $("ctx-add-queue");
  const ctxDiv1 = $("ctx-div-1");
  const ctxPlaylistItem = $("ctx-playlist-item");
  const ctxDiv2 = $("ctx-div-2");
  const ctxFilterArtist = $("ctx-filter-artist");
  const ctxFilterAlbum = $("ctx-filter-album");
  const ctxDiv3 = $("ctx-div-3");
  const ctxEditAlbum = $("ctx-edit-album");
  const ctxEditArtist = $("ctx-edit-artist");
  const ctxFetchArtistPhoto = $("ctx-fetch-artist-photo");
  const ctxToggleArtistType = $("ctx-toggle-artist-type");
  const ctxRenameGenre = $("ctx-rename-genre");
  const ctxRenamePlaylist = $("ctx-rename-playlist");
  const ctxDeletePlaylist = $("ctx-delete-playlist");
  const ctxInfo = $("ctx-info");

  if (ctxPlay) ctxPlay.hidden = false;
  if (ctxAddQueue) ctxAddQueue.hidden = false;
  if (ctxDiv1) ctxDiv1.hidden = false;
  if (ctxPlaylistItem) ctxPlaylistItem.hidden = target.type !== "track";
  if (ctxDiv2) ctxDiv2.hidden = false;

  if (ctxEditAlbum) ctxEditAlbum.hidden = target.type !== "album";
  if (ctxEditArtist) ctxEditArtist.hidden = target.type !== "artist";
  if (ctxFetchArtistPhoto) ctxFetchArtistPhoto.hidden = target.type !== "artist";
  if (ctxToggleArtistType) {
    ctxToggleArtistType.hidden = target.type !== "artist";
    if (target.artist) {
      const isGrp = isArtistGroup(target.artist);
      ctxToggleArtistType.innerHTML = `<span class="menu-icon"><i class="fa-solid fa-arrows-rotate"></i></span> Définir comme ${isGrp ? "Artiste Solo" : "Groupe / Band"}`;
    }
  }
  if (ctxRenameGenre) ctxRenameGenre.hidden = target.type !== "genre";
  if (ctxRenamePlaylist) ctxRenamePlaylist.hidden = target.type !== "playlist";
  if (ctxDeletePlaylist) ctxDeletePlaylist.hidden = target.type !== "playlist";

  if (target.type === "track") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = false;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = false;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-circle-info"></i></span> Éditer métadonnées du morceau';
    }

    const playlists = await invoke<Playlist[]>("get_playlists");
    ctxPlaylistSubmenu.innerHTML = "";
    if (playlists.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "menu-item";
      emptyDiv.textContent = "(Aucune playlist)";
      emptyDiv.style.opacity = "0.5";
      ctxPlaylistSubmenu.appendChild(emptyDiv);
    } else {
      playlists.forEach((p) => {
        const item = document.createElement("div");
        item.className = "menu-item";
        item.textContent = p.name;
        item.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (target.track) {
            await invoke("add_to_playlist", { playlistId: p.id, trackId: target.track.id });
            loadPlaylists();
          }
          hideContextMenu();
        });
        ctxPlaylistSubmenu.appendChild(item);
      });
    }
  } else if (target.type === "album") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = false;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-circle-info"></i></span> Voir morceaux de l\'album';
    }
  } else if (target.type === "artist") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = true;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-user"></i></span> Voir la fiche artiste';
    }
  } else if (target.type === "genre") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = true;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) {
      ctxInfo.hidden = false;
      ctxInfo.innerHTML = '<span class="menu-icon"><i class="fa-solid fa-tags"></i></span> Voir les morceaux du genre';
    }
  } else if (target.type === "playlist") {
    if (ctxFilterArtist) ctxFilterArtist.hidden = true;
    if (ctxFilterAlbum) ctxFilterAlbum.hidden = true;
    if (ctxDiv3) ctxDiv3.hidden = false;
    if (ctxInfo) ctxInfo.hidden = true;
  }

  contextMenu.style.display = "block";
  contextMenu.hidden = false;

  const menuWidth = contextMenu.offsetWidth;
  const menuHeight = contextMenu.offsetHeight;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;

  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > winWidth) x = winWidth - menuWidth - 8;
  if (y + menuHeight > winHeight) y = winHeight - menuHeight - 8;

  contextMenu.style.left = `${Math.max(0, x)}px`;
  contextMenu.style.top = `${Math.max(0, y)}px`;
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.hidden = true;
    contextMenu.style.display = "none";
  }
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function renderTracks(tracks: Track[]) {
  trackTbody.innerHTML = "";
  emptyState.hidden = tracks.length > 0;
  tracks.forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(t.id);
    tr.innerHTML = `
      <td class="col-idx">${i + 1}</td>
      <td class="col-cover"><div class="table-cover-cell"><div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div></div></td>
      <td>${escapeHtml(t.title)}</td>
      <td><span class="table-link link-artist" data-artist="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span></td>
      <td><span class="table-link link-album" data-album="${escapeHtml(t.album)}" data-artist="${escapeHtml(t.album_artist || t.artist)}">${escapeHtml(t.album)}</span></td>
      <td class="col-time">${fmtTime(t.duration_secs)}</td>
    `;

    const coverCell = tr.querySelector(".table-cover-cell");
    if (coverCell && t.cover_path) {
      getCoverDataUrl(t.cover_path).then((url) => {
        if (url) {
          coverCell.innerHTML = `<img src="${url}" class="table-cover-img" alt="" />`;
        }
      });
    }

    tr.querySelector(".link-artist")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      openArtistByName(t.artist);
    });

    tr.querySelector(".link-album")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      filterByAlbum(t.album, t.album_artist || t.artist);
    });

    tr.addEventListener("dblclick", (e) => {
      e.preventDefault();
      playFromQueue(tracks, i);
    });
    tr.addEventListener("contextmenu", (e) =>
      openGenericContextMenu(e, { type: "track", track: t, index: i, queue: tracks })
    );
    trackTbody.appendChild(tr);
  });
}

async function openArtistByName(artistName: string) {
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

function filterByAlbum(albumName: string, albumArtist: string) {
  const normAlbum = albumName.trim().toLowerCase();
  const normArtist = albumArtist.trim().toLowerCase();
  const tracks = allTracks.filter(
    (t) =>
      t.album.trim().toLowerCase() === normAlbum &&
      (t.album_artist.trim().toLowerCase() === normArtist ||
       t.artist.trim().toLowerCase() === normArtist)
  );
  switchView("tracks");
  viewTitle.textContent = `Album : ${albumName}`;
  renderTracks(tracks);
  pushNavState({ type: "album", view: "tracks", albumName, albumArtist, searchQuery: searchInput.value });
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function updateMissingMetadataCount() {
  const countEl = $("missing-count");
  if (!countEl) return;
  const missing = allTracks.filter((t) => !t.cover_path || t.year === 0 || !t.genre);
  countEl.textContent = String(missing.length);
}

async function loadLibrary() {
  allTracks = await invoke<Track[]>("get_tracks");
  renderTracks(allTracks);
  updateMissingMetadataCount();
}

async function renderAlbumsGrid(albums: AlbumSummary[], container: HTMLElement) {
  container.innerHTML = "";
  for (const a of albums) {
    const card = document.createElement("div");
    card.className = "grid-card";
    const isFav = !!a.is_favorite;
    const coverUrl = await getCoverDataUrl(a.cover_path);
    const coverHtml = coverUrl
      ? `<img src="${coverUrl}" class="cover-img" alt="${escapeHtml(a.album)}" />`
      : `<div class="cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div>`;
    card.innerHTML = `
      <button class="card-fav-btn ${isFav ? "is-fav" : ""}" title="Favori">
        <i class="${isFav ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i>
      </button>
      <button class="album-edit-btn" title="Éditer l'album"><i class="fa-solid fa-pen"></i></button>
      ${coverHtml}
      <div class="title">${escapeHtml(a.album)}</div>
      <div class="subtitle">${escapeHtml(a.album_artist)} · ${a.year || "—"}</div>
    `;

    card.querySelector(".album-edit-btn")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openAlbumModal(a);
    });

    const favBtn = card.querySelector(".card-fav-btn");
    favBtn?.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const key = `${a.album}::${a.album_artist}`;
      const newFav = await invoke<boolean>("toggle_favorite", { targetType: "album", targetId: key });
      a.is_favorite = newFav;
      favBtn.classList.toggle("is-fav", newFav);
      favBtn.querySelector("i")!.className = newFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
    });

    card.addEventListener("click", () => {
      filterByAlbum(a.album, a.album_artist);
    });

    card.addEventListener("contextmenu", (e) =>
      openGenericContextMenu(e, { type: "album", album: a })
    );

    container.appendChild(card);
  }
}

async function renderArtistsGrid(artists: ArtistSummary[], container: HTMLElement) {
  container.innerHTML = "";
  for (const a of artists) {
    const card = document.createElement("div");
    card.className = "grid-card artist-card";
    const isFav = !!a.is_favorite;
    const isGrp = isArtistGroup(a);
    const photoUrl = await getCoverDataUrl(a.image_path || null);
    const photoHtml = photoUrl
      ? `<img src="${photoUrl}" class="cover-img" alt="${escapeHtml(a.artist)}" />`
      : `<div class="cover-placeholder"><i class="fa-solid ${isGrp ? "fa-users" : "fa-user"}"></i></div>`;

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
    `;

    const favBtn = card.querySelector(".card-fav-btn");
    favBtn?.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const newFav = await invoke<boolean>("toggle_favorite", { targetType: "artist", targetId: a.artist });
      a.is_favorite = newFav;
      favBtn.classList.toggle("is-fav", newFav);
      favBtn.querySelector("i")!.className = newFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
    });

    card.addEventListener("click", () => {
      openArtistView(a);
    });

    card.addEventListener("contextmenu", (e) =>
      openGenericContextMenu(e, { type: "artist", artist: a })
    );

    container.appendChild(card);
  }
}

async function loadAlbums() {
  const albums = await invoke<AlbumSummary[]>("get_albums");
  const container = $("view-albums");
  await renderAlbumsGrid(albums, container);
}

interface BandMember {
  name: string;
  photoUrl: string | null;
}

interface BandDetailsResult {
  bio: string | null;
  members: BandMember[];
}

async function fetchBandMembersAndBio(artistName: string): Promise<BandDetailsResult> {
  let bio: string | null = null;
  const rawMemberNames: string[] = [];

  try {
    const wikiUrl = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
    const wikiRes = await fetch(wikiUrl);
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      if (wikiData.extract && !wikiData.type?.includes("disambiguation")) {
        bio = wikiData.extract;
      }
    }
  } catch (e) {
    console.warn("Erreur fetch Wikipedia bio", e);
  }

  try {
    const mbSearchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:"${encodeURIComponent(artistName)}"&fmt=json`;
    const mbSearchRes = await fetch(mbSearchUrl);
    if (mbSearchRes.ok) {
      const mbData = await mbSearchRes.json();
      if (mbData.artists && mbData.artists.length > 0) {
        const mbid = mbData.artists[0].id;
        const mbArtistUrl = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=artist-rels&fmt=json`;
        const mbArtistRes = await fetch(mbArtistUrl);
        if (mbArtistRes.ok) {
          const artistObj = await mbArtistRes.json();
          if (artistObj.relations) {
            for (const rel of artistObj.relations) {
              if (rel.type === "member of band" && rel.artist?.name) {
                const memberName = rel.artist.name;
                if (!rawMemberNames.includes(memberName)) {
                  rawMemberNames.push(memberName);
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("Erreur fetch MusicBrainz band members", e);
  }

  const members: BandMember[] = [];
  for (const name of rawMemberNames.slice(0, 12)) {
    let photoUrl: string | null = null;
    try {
      const term = encodeURIComponent(name);
      const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
          photoUrl = data.results[0].artworkUrl100.replace("100x100bb", "600x600bb");
        }
      }
    } catch {
      /* ignore */
    }
    members.push({ name, photoUrl });
  }

  return { bio, members };
}

async function openArtistView(a: ArtistSummary) {
  const normArtistName = a.artist.trim().toLowerCase();
  const tracks = allTracks.filter((t) => {
    const trackArtist = (t.artist || "").trim().toLowerCase();
    const albumArtist = (t.album_artist || "").trim().toLowerCase();
    if (!trackArtist && !albumArtist) return false;
    return (
      trackArtist === normArtistName ||
      albumArtist === normArtistName ||
      (trackArtist && trackArtist.includes(normArtistName)) ||
      (albumArtist && albumArtist.includes(normArtistName)) ||
      (normArtistName && trackArtist.includes(trackArtist) && normArtistName.includes(trackArtist))
    );
  });
  switchView("tracks");
  viewTitle.textContent = `Artiste : ${a.artist}`;
  pushNavState({ type: "artist", view: "tracks", artistSummary: a, searchQuery: searchInput.value });

  const artistHeader = $("artist-header");
  const artistNameEl = $("artist-banner-name");
  const artistGenreEl = $("artist-banner-genre");
  const artistCountEl = $("artist-banner-count");
  const artistAvatarImg = $<HTMLImageElement>("artist-avatar-img");
  const artistAvatarPlaceholder = $("artist-avatar-placeholder");
  const artistMembersBox = $("artist-members-box");
  const artistMembersList = $("artist-members-list");
  const artistBioText = $("artist-bio-text");

  artistNameEl.textContent = a.artist;
  artistCountEl.textContent = `${tracks.length} morceau(x)`;

  const sampleTrack = tracks.find((t) => t.genre);
  artistGenreEl.textContent = sampleTrack?.genre || "Musique";

  const photoUrl = await getCoverDataUrl(a.image_path || null);
  if (photoUrl) {
    artistAvatarImg.src = photoUrl;
    artistAvatarImg.hidden = false;
    artistAvatarPlaceholder.hidden = true;
  } else {
    artistAvatarImg.hidden = true;
    artistAvatarPlaceholder.hidden = false;
  }

  const renderBioAndMembers = (bio: string | null, membersList: BandMember[]) => {
    if (membersList && membersList.length > 0) {
      artistMembersList.innerHTML = membersList
        .map((m) => {
          const avatarHtml = m.photoUrl
            ? `<img src="${m.photoUrl}" class="member-avatar" alt="${escapeHtml(m.name)}" />`
            : `<div class="member-avatar-placeholder"><i class="fa-solid fa-user"></i></div>`;
          return `
            <div class="member-card" data-member="${escapeHtml(m.name)}" title="Chercher les morceaux de ${escapeHtml(m.name)}">
              ${avatarHtml}
              <span class="member-name">${escapeHtml(m.name)}</span>
            </div>
          `;
        })
        .join("");

      artistMembersList.querySelectorAll(".member-card").forEach((card) => {
        card.addEventListener("click", () => {
          const memberName = (card as HTMLElement).dataset.member;
          if (memberName) {
            switchView("tracks");
            searchInput.value = memberName;
            handleSearchInput();
          }
        });
      });

      artistMembersBox.hidden = false;
    } else {
      artistMembersBox.hidden = true;
    }

    if (bio) {
      artistBioText.textContent = bio;
      artistBioText.hidden = false;
    } else {
      artistBioText.hidden = true;
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

  artistHeader.hidden = false;
  artistHeader.style.display = "flex";

  renderTracks(tracks);

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

function isArtistGroup(a: ArtistSummary): boolean {
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

async function loadArtists() {
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

function filterByGenre(genreName: string) {
  const normGenre = genreName.trim().toLowerCase();
  const tracks = allTracks.filter((t) => {
    const genres = parseGenres(t.genre);
    return genres.some((g) => g.trim().toLowerCase() === normGenre);
  });
  switchView("tracks");
  viewTitle.textContent = `Genre : ${genreName}`;
  renderTracks(tracks);
  pushNavState({
    type: "genre",
    view: "tracks",
    genreName,
    searchQuery: searchInput.value,
  });
}

function parseGenres(rawGenre?: string): string[] {
  if (!rawGenre || !rawGenre.trim()) return ["Non spécifié"];
  const parts = rawGenre.split(/[,/;|&\n]+/);
  const res: string[] = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed && !res.includes(trimmed)) {
      res.push(trimmed);
    }
  }
  return res.length > 0 ? res : ["Non spécifié"];
}

function loadGenres() {
  const genreMap = new Map<string, Track[]>();

  for (const t of allTracks) {
    const genres = parseGenres(t.genre);
    for (const g of genres) {
      if (!genreMap.has(g)) {
        genreMap.set(g, []);
      }
      genreMap.get(g)!.push(t);
    }
  }

  const container = $("view-genres");
  container.innerHTML = "";

  const sortedGenres = Array.from(genreMap.keys()).sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base" })
  );

  for (const g of sortedGenres) {
    const tracks = genreMap.get(g)!;
    const card = document.createElement("div");
    card.className = "genre-card";
    card.innerHTML = `
      <div class="genre-title">${escapeHtml(g)}</div>
      <div class="genre-count">${tracks.length} morceau(x)</div>
      <i class="fa-solid fa-tags genre-bg-icon"></i>
    `;

    card.addEventListener("click", () => {
      filterByGenre(g);
    });
    card.addEventListener("contextmenu", (e) =>
      openGenericContextMenu(e, { type: "genre", genreName: g, genreTracks: tracks })
    );

    container.appendChild(card);
  }
}

async function loadPlaylists() {
  const playlists = await invoke<Playlist[]>("get_playlists");
  const list = $("playlist-list");
  list.innerHTML = "";
  playlists.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name} (${p.track_count})`;
    li.addEventListener("click", async () => {
      const tracks = await invoke<Track[]>("get_playlist_tracks", { playlistId: p.id });
      switchView("tracks");
      viewTitle.textContent = p.name;
      renderTracks(tracks);
    });
    li.addEventListener("contextmenu", (e) =>
      openGenericContextMenu(e, { type: "playlist", playlistId: p.id, playlistName: p.name })
    );
    list.appendChild(li);
  });
}

let availableAudioDevices: string[] = [];
let currentAudioDevice: string | null = null;

async function loadAudioDevices() {
  try {
    const devices = await invoke<string[]>("get_audio_devices");
    availableAudioDevices = devices;
    renderAudioDeviceUI();
  } catch (err) {
    console.error("Erreur lors de la récupération des périphériques audio :", err);
  }
}

function renderAudioDeviceUI() {
  const selectEl = $<HTMLSelectElement>("select-audio-device");
  const popoverListEl = $("device-picker-list");

  if (selectEl) {
    selectEl.innerHTML = '<option value="default">Périphérique système par défaut</option>';
    availableAudioDevices.forEach((dev) => {
      const opt = document.createElement("option");
      opt.value = dev;
      opt.textContent = dev;
      selectEl.appendChild(opt);
    });
    selectEl.value = currentAudioDevice || "default";
  }

  if (popoverListEl) {
    popoverListEl.innerHTML = "";

    const defaultLi = document.createElement("li");
    const isDefaultActive = !currentAudioDevice;
    defaultLi.className = `device-picker-item ${isDefaultActive ? "active" : ""}`;
    defaultLi.innerHTML = `
      <span>Périphérique par défaut</span>
      ${isDefaultActive ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
    `;
    defaultLi.addEventListener("click", () => selectAudioDevice("default"));
    popoverListEl.appendChild(defaultLi);

    availableAudioDevices.forEach((dev) => {
      const li = document.createElement("li");
      const isActive = currentAudioDevice === dev;
      li.className = `device-picker-item ${isActive ? "active" : ""}`;
      li.innerHTML = `
        <span>${escapeHtml(dev)}</span>
        ${isActive ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
      `;
      li.addEventListener("click", () => selectAudioDevice(dev));
      popoverListEl.appendChild(li);
    });
  }
}

async function selectAudioDevice(deviceName: string) {
  try {
    await invoke("set_audio_device", { deviceName });
    currentAudioDevice = deviceName === "default" ? null : deviceName;
    renderAudioDeviceUI();
    const popover = $("device-picker-popover");
    if (popover) popover.hidden = true;
  } catch (err) {
    console.error("Erreur sélection du périphérique audio :", err);
  }
}

async function playFromQueue(queue: Track[], index: number, isManual: boolean = true) {
  currentQueue = queue;
  await invoke("play_track", { queue, startIndex: index, isManual });
  await refreshPlayerState();
}

async function refreshPlayerState() {
  const state = await invoke<PlayerState>("get_player_state");
  applyPlayerState(state);
}

function applyPlayerState(state: PlayerState) {
  const vinylCover = $("vinyl-cover");
  const nowLikesEl = $("now-likes");
  const nowDislikesEl = $("now-dislikes");
  const btnFavNow = $("btn-fav-now");

  if (state.current_track) {
    nowTitle.textContent = state.current_track.title;
    nowArtist.textContent = state.current_track.artist;
    seekBar.max = String(state.current_track.duration_secs || 0);
    timeTotal.textContent = fmtTime(state.current_track.duration_secs);

    if (nowLikesEl) nowLikesEl.textContent = String(state.current_track.likes || 0);
    if (nowDislikesEl) nowDislikesEl.textContent = String(state.current_track.dislikes || 0);
    if (btnFavNow) {
      const isFav = !!state.current_track.is_favorite;
      btnFavNow.classList.toggle("is-fav", isFav);
      btnFavNow.innerHTML = isFav ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
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
    nowTitle.textContent = "Aucune lecture";
    nowArtist.textContent = "—";
    if (nowLikesEl) nowLikesEl.textContent = "0";
    if (nowDislikesEl) nowDislikesEl.textContent = "0";
    if (btnFavNow) {
      btnFavNow.classList.remove("is-fav");
      btnFavNow.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
    if (vinylCover) vinylCover.style.backgroundImage = "";
  }
  if (!isSeeking) {
    seekBar.value = String(state.position_secs);
    timeCurrent.textContent = fmtTime(state.position_secs);
  }
  updateSliderTrack(seekBar);
  if (state.volume !== undefined && state.volume !== null && volumeBar) {
    volumeBar.value = String(Math.round(state.volume * 100));
    updateSliderTrack(volumeBar);
  }
  btnPlay.innerHTML = state.is_playing
    ? '<i class="fa-solid fa-pause"></i>'
    : '<i class="fa-solid fa-play"></i>';
  vinyl.classList.toggle("spinning", state.is_playing);
  btnRepeat.classList.toggle("active", state.repeat);
  if (btnShuffle) btnShuffle.classList.toggle("active", state.shuffle);

  if (state.audio_device !== undefined) {
    const dev = state.audio_device ?? null;
    if (currentAudioDevice !== dev) {
      currentAudioDevice = dev;
      renderAudioDeviceUI();
    }
  }

  const currentTrackId = state.current_track ? String(state.current_track.id) : null;
  document.querySelectorAll("#track-tbody tr").forEach((row) => {
    const isPlaying = !!currentTrackId && (row as HTMLElement).dataset.id === currentTrackId;
    row.classList.toggle("playing", isPlaying);
  });

  updateOverlayUI(state);
}

let isOverlayMode = false;
let isClickThroughLocked = false;

async function toggleOverlayMode() {
  isOverlayMode = !isOverlayMode;
  if (isOverlayMode) {
    document.body.classList.add("overlay-mode");
    document.documentElement.classList.add("overlay-mode");
    const overlayContainer = $("overlay-container");
    if (overlayContainer) overlayContainer.hidden = false;
    await invoke("enable_overlay_mode");
  } else {
    document.body.classList.remove("overlay-mode");
    document.documentElement.classList.remove("overlay-mode");
    const overlayContainer = $("overlay-container");
    if (overlayContainer) overlayContainer.hidden = true;
    if (isClickThroughLocked) {
      isClickThroughLocked = false;
      const btn = $("overlay-btn-clickthrough");
      if (btn) {
        btn.classList.remove("locked");
        btn.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
      }
      await invoke("set_overlay_click_through", { ignore: false });
    }
    await invoke("disable_overlay_mode");
  }
}

async function toggleClickThrough() {
  isClickThroughLocked = !isClickThroughLocked;
  const btn = $("overlay-btn-clickthrough");
  if (btn) {
    btn.classList.toggle("locked", isClickThroughLocked);
    btn.innerHTML = isClickThroughLocked
      ? '<i class="fa-solid fa-lock"></i>'
      : '<i class="fa-solid fa-lock-open"></i>';
    btn.title = isClickThroughLocked
      ? "Clics traversants ACTIVÉS (Verrouillé)"
      : "Clics traversants DÉSACTIVÉS (Interactif)";
  }
  await invoke("set_overlay_click_through", { ignore: isClickThroughLocked });
}

let overlayCurrentTrackDuration = 0;

function updateOverlayUI(state: PlayerState) {
  const overlayTitle = $("overlay-title");
  const overlayArtist = $("overlay-artist");
  const overlayRingFill = $("overlay-ring-fill");
  const overlayCoverImg = $<HTMLImageElement>("overlay-cover-img");
  const overlayCoverPlaceholder = $("overlay-cover-placeholder");
  const overlayBtnPlay = $("overlay-btn-play");
  const overlayBtnFav = $("overlay-btn-fav");
  const overlayBtnRepeat = $("overlay-btn-repeat");
  const overlayBtnShuffle = $("overlay-btn-shuffle");
  const overlayVinylGrooves = $("overlay-vinyl-grooves");
  const overlayVolumeSlider = $<HTMLInputElement>("overlay-volume-slider");
  const overlayBtnVolume = $("overlay-btn-volume");

  if (!overlayTitle) return;

  if (state.current_track) {
    overlayTitle.textContent = state.current_track.title;
    overlayArtist.textContent = state.current_track.artist;
    overlayCurrentTrackDuration = state.current_track.duration_secs || 0;

    const dur = state.current_track.duration_secs || 1;
    const pct = Math.min(100, Math.max(0, (state.position_secs / dur) * 100));
    if (overlayRingFill) {
      const circumference = 289;
      const offset = circumference - (circumference * pct) / 100;
      overlayRingFill.style.strokeDashoffset = String(offset);
    }

    if (overlayCoverImg && overlayCoverPlaceholder) {
      if (state.current_track.cover_path) {
        getCoverDataUrl(state.current_track.cover_path).then((url) => {
          if (url) {
            overlayCoverImg.src = url;
            overlayCoverImg.hidden = false;
            overlayCoverPlaceholder.hidden = true;
          } else {
            overlayCoverImg.hidden = true;
            overlayCoverPlaceholder.hidden = false;
          }
        });
      } else {
        overlayCoverImg.hidden = true;
        overlayCoverPlaceholder.hidden = false;
      }
    }

    if (overlayBtnFav) {
      const isFav = !!state.current_track.is_favorite;
      overlayBtnFav.innerHTML = isFav
        ? '<i class="fa-solid fa-heart" style="color: #ff6b6b;"></i>'
        : '<i class="fa-regular fa-heart"></i>';
    }
  } else {
    overlayTitle.textContent = "Aucune lecture";
    overlayArtist.textContent = "—";
    overlayCurrentTrackDuration = 0;
    if (overlayRingFill) overlayRingFill.style.strokeDashoffset = "289";
    if (overlayCoverImg) overlayCoverImg.hidden = true;
    if (overlayCoverPlaceholder) overlayCoverPlaceholder.hidden = false;
    if (overlayBtnFav) overlayBtnFav.innerHTML = '<i class="fa-regular fa-heart"></i>';
  }

  if (overlayBtnPlay) {
    overlayBtnPlay.innerHTML = state.is_playing
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
  }

  if (overlayVinylGrooves) overlayVinylGrooves.classList.toggle("spinning", state.is_playing);
  if (overlayCoverImg) overlayCoverImg.classList.toggle("spinning", state.is_playing);

  if (overlayBtnRepeat) overlayBtnRepeat.classList.toggle("active", state.repeat);
  if (overlayBtnShuffle) overlayBtnShuffle.classList.toggle("active", state.shuffle);

  if (overlayVolumeSlider) {
    overlayVolumeSlider.value = String(Math.round((state.volume || 0.8) * 100));
    updateSliderTrack(overlayVolumeSlider);
  }
  if (overlayBtnVolume) {
    const volPct = Math.round((state.volume || 0.8) * 100);
    const volIcon = volPct === 0 ? "fa-volume-xmark" : volPct < 0.5 ? "fa-volume-low" : "fa-volume-high";
    overlayBtnVolume.innerHTML = `<i class="fa-solid ${volIcon}"></i>`;
  }
}

interface NavState {
  type: "view" | "artist" | "album" | "genre" | "search";
  view: string;
  artistSummary?: ArtistSummary;
  albumName?: string;
  albumArtist?: string;
  genreName?: string;
  searchQuery?: string;
}

let navHistoryStack: NavState[] = [];
let navHistoryIndex: number = -1;
let isNavigatingHistory: boolean = false;

function pushNavState(state: NavState) {
  if (isNavigatingHistory) return;

  if (navHistoryIndex >= 0 && navHistoryIndex < navHistoryStack.length) {
    const curr = navHistoryStack[navHistoryIndex];
    if (
      curr.type === state.type &&
      curr.view === state.view &&
      curr.artistSummary?.artist === state.artistSummary?.artist &&
      curr.albumName === state.albumName &&
      curr.genreName === state.genreName &&
      curr.searchQuery === state.searchQuery
    ) {
      return;
    }
  }

  if (navHistoryIndex < navHistoryStack.length - 1) {
    navHistoryStack = navHistoryStack.slice(0, navHistoryIndex + 1);
  }

  navHistoryStack.push(state);
  navHistoryIndex = navHistoryStack.length - 1;
  updateNavHistoryButtons();
}

function updateNavHistoryButtons() {
  const btnBack = $<HTMLButtonElement>("btn-nav-back");
  const btnForward = $<HTMLButtonElement>("btn-nav-forward");
  if (btnBack) btnBack.disabled = navHistoryIndex <= 0;
  if (btnForward) btnForward.disabled = navHistoryIndex >= navHistoryStack.length - 1;
}

function restoreNavState(state: NavState) {
  isNavigatingHistory = true;

  if (state.searchQuery !== undefined) {
    searchInput.value = state.searchQuery;
  } else {
    searchInput.value = "";
  }

  if (state.type === "artist" && state.artistSummary) {
    openArtistView(state.artistSummary);
  } else if (state.type === "album" && state.albumName) {
    filterByAlbum(state.albumName, state.albumArtist || "");
  } else if (state.type === "genre" && state.genreName) {
    filterByGenre(state.genreName);
  } else {
    switchView(state.view);
    if (state.view === "albums") loadAlbums();
    if (state.view === "artists") loadArtists();
    if (state.view === "genres") loadGenres();
    if (state.view === "playlists") loadPlaylists();
    if (state.view === "recents") loadRecents();
    if (state.view === "favorites") loadFavorites();
    if (state.view === "settings") {
      updateMissingMetadataCount();
      loadAppSettings();
    }
  }

  handleSearchInput();

  isNavigatingHistory = false;
  updateNavHistoryButtons();
}

function goNavBack() {
  if (navHistoryIndex > 0) {
    navHistoryIndex--;
    restoreNavState(navHistoryStack[navHistoryIndex]);
  }
}

function goNavForward() {
  if (navHistoryIndex < navHistoryStack.length - 1) {
    navHistoryIndex++;
    restoreNavState(navHistoryStack[navHistoryIndex]);
  }
}

function switchView(view: string) {
  document.querySelectorAll(".view").forEach((v) => ((v as HTMLElement).hidden = true));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  $(`view-${view}`).hidden = false;
  document.querySelector(`[data-view="${view}"]`)?.classList.add("active");
  const titles: Record<string, string> = {
    tracks: "Bibliothèque",
    albums: "Albums",
    artists: "Artistes",
    genres: "Genres",
    playlists: "Playlists",
    settings: "Paramètres",
  };
  viewTitle.textContent = titles[view] ?? view;

  const artistHeader = $("artist-header");
  if (artistHeader && view !== "tracks") {
    artistHeader.hidden = true;
    artistHeader.style.display = "none";
  }

  pushNavState({ type: "view", view, searchQuery: searchInput.value });
}

function initCollapsibleSections() {
  document.querySelectorAll(".artists-section-header").forEach((header) => {
    header.addEventListener("click", () => {
      const section = header.closest(".artists-section");
      if (!section) return;
      const key = (header as HTMLElement).dataset.collapse;
      const isCollapsed = section.classList.toggle("collapsed");
      if (key) {
        localStorage.setItem(`rustify_collapse_${key}`, isCollapsed ? "true" : "false");
      }
    });
  });

  document.querySelectorAll(".artists-section-header").forEach((header) => {
    const key = (header as HTMLElement).dataset.collapse;
    if (key && localStorage.getItem(`rustify_collapse_${key}`) === "true") {
      const section = header.closest(".artists-section");
      section?.classList.add("collapsed");
    }
  });

  const playlistTitle = $("playlist-header-title");
  const playlistSection = $("playlist-section");
  if (playlistTitle && playlistSection) {
    playlistTitle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isCollapsed = playlistSection.classList.toggle("collapsed");
      localStorage.setItem("rustify_collapse_playlists", isCollapsed ? "true" : "false");
    });
    if (localStorage.getItem("rustify_collapse_playlists") === "true") {
      playlistSection.classList.add("collapsed");
    }
  }
}

async function loadAppSettings() {
  try {
    const settings = await invoke<Record<string, string>>("get_app_settings");

    const autostartEl = $<HTMLInputElement>("setting-autostart");
    const trayEl = $<HTMLInputElement>("setting-minimize-to-tray");
    const shortcutsEl = $<HTMLInputElement>("setting-global-shortcuts");

    const scPlay = $<HTMLInputElement>("sc-input-play");
    const scNext = $<HTMLInputElement>("sc-input-next");
    const scPrev = $<HTMLInputElement>("sc-input-prev");
    const scStop = $<HTMLInputElement>("sc-input-stop");

    if (autostartEl) autostartEl.checked = settings.autostart === "true";
    if (trayEl) trayEl.checked = settings.minimize_to_tray === "true";
    if (shortcutsEl) shortcutsEl.checked = settings.global_shortcuts_enabled === "true";

    if (scPlay) scPlay.value = settings.shortcut_play_pause || "MediaPlayPause";
    if (scNext) scNext.value = settings.shortcut_next || "MediaTrackNext";
    if (scPrev) scPrev.value = settings.shortcut_prev || "MediaTrackPrevious";
    if (scStop) scStop.value = settings.shortcut_stop || "MediaStop";

    const configList = $("shortcuts-config-list");
    if (configList && shortcutsEl) {
      configList.style.opacity = shortcutsEl.checked ? "1" : "0.45";
      configList.style.pointerEvents = shortcutsEl.checked ? "auto" : "none";
    }
  } catch (err) {
    console.error("Erreur chargement des paramètres de l'application :", err);
  }
}

function initSettingsEvents() {
  const autostartEl = $<HTMLInputElement>("setting-autostart");
  const trayEl = $<HTMLInputElement>("setting-minimize-to-tray");
  const shortcutsEl = $<HTMLInputElement>("setting-global-shortcuts");
  const btnSaveSc = $("btn-save-shortcuts");
  const btnResetSc = $("btn-reset-shortcuts");

  autostartEl?.addEventListener("change", async () => {
    const enabled = autostartEl.checked;
    await invoke("save_app_setting", { key: "autostart", value: enabled ? "true" : "false" });
  });

  trayEl?.addEventListener("change", async () => {
    const enabled = trayEl.checked;
    await invoke("save_app_setting", { key: "minimize_to_tray", value: enabled ? "true" : "false" });
  });

  shortcutsEl?.addEventListener("change", async () => {
    const enabled = shortcutsEl.checked;
    await invoke("save_app_setting", { key: "global_shortcuts_enabled", value: enabled ? "true" : "false" });
    const configList = $("shortcuts-config-list");
    if (configList) {
      configList.style.opacity = enabled ? "1" : "0.45";
      configList.style.pointerEvents = enabled ? "auto" : "none";
    }
  });

  btnSaveSc?.addEventListener("click", async () => {
    const scPlay = $<HTMLInputElement>("sc-input-play")?.value.trim() || "MediaPlayPause";
    const scNext = $<HTMLInputElement>("sc-input-next")?.value.trim() || "MediaTrackNext";
    const scPrev = $<HTMLInputElement>("sc-input-prev")?.value.trim() || "MediaTrackPrevious";
    const scStop = $<HTMLInputElement>("sc-input-stop")?.value.trim() || "MediaStop";

    await invoke("save_app_setting", { key: "shortcut_play_pause", value: scPlay });
    await invoke("save_app_setting", { key: "shortcut_next", value: scNext });
    await invoke("save_app_setting", { key: "shortcut_prev", value: scPrev });
    await invoke("save_app_setting", { key: "shortcut_stop", value: scStop });

    alert("Raccourcis clavier enregistrés avec succès !");
  });

  btnResetSc?.addEventListener("click", async () => {
    $<HTMLInputElement>("sc-input-play").value = "MediaPlayPause";
    $<HTMLInputElement>("sc-input-next").value = "MediaTrackNext";
    $<HTMLInputElement>("sc-input-prev").value = "MediaTrackPrevious";
    $<HTMLInputElement>("sc-input-stop").value = "MediaStop";

    await invoke("save_app_setting", { key: "shortcut_play_pause", value: "MediaPlayPause" });
    await invoke("save_app_setting", { key: "shortcut_next", value: "MediaTrackNext" });
    await invoke("save_app_setting", { key: "shortcut_prev", value: "MediaTrackPrevious" });
    await invoke("save_app_setting", { key: "shortcut_stop", value: "MediaStop" });

    alert("Raccourcis clavier réinitialisés aux valeurs par défaut !");
  });
}

async function loadRecents() {
  try {
    const history = await invoke<HistoryItem[]>("get_play_history", { limit: 100 });
    const tbody = $("recents-tbody");
    const emptyState = $("empty-recents");

    if (!tbody || !emptyState) return;

    if (history.length === 0) {
      tbody.innerHTML = "";
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;
    tbody.innerHTML = "";

    for (let i = 0; i < history.length; i++) {
      const item = history[i];
      const t = item.track;
      const row = document.createElement("tr");
      row.dataset.id = t.id;

      const dateObj = new Date(item.played_at);
      const dateFmt = isNaN(dateObj.getTime()) ? item.played_at : dateObj.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

      row.innerHTML = `
        <td class="col-idx mono">${i + 1}</td>
        <td class="col-cover">
          <div class="table-cover-cell">
            <div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div>
          </div>
        </td>
        <td><strong>${escapeHtml(t.title)}</strong></td>
        <td>${escapeHtml(t.artist)}</td>
        <td>${escapeHtml(t.album)}</td>
        <td class="text-dim" style="font-size: 12px;">${escapeHtml(dateFmt)}</td>
        <td class="col-time mono">${fmtTime(t.duration_secs)}</td>
      `;

      const coverCell = row.querySelector(".table-cover-cell");
      if (coverCell && t.cover_path) {
        getCoverDataUrl(t.cover_path).then((dataUrl) => {
          if (dataUrl) {
            coverCell.innerHTML = `<img class="table-cover-img" src="${dataUrl}" alt="Cover" />`;
          }
        });
      }

      row.addEventListener("dblclick", () => {
        playFromQueue([t], 0);
      });

      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openGenericContextMenu(e, { type: "track", track: t, index: 0, queue: [t] });
      });

      tbody.appendChild(row);
    }
  } catch (err) {
    console.error("Erreur chargement récents :", err);
  }
}

async function loadFavorites() {
  try {
    const data = await invoke<FavoritesData>("get_favorites");

    const tracksTbody = $("fav-tracks-tbody");
    const emptyTracks = $("empty-fav-tracks");
    if (tracksTbody && emptyTracks) {
      if (data.tracks.length === 0) {
        tracksTbody.innerHTML = "";
        emptyTracks.hidden = false;
      } else {
        emptyTracks.hidden = true;
        renderTracksInContainer(data.tracks, tracksTbody);
      }
    }

    const gridAlbums = $("grid-fav-albums");
    const emptyAlbums = $("empty-fav-albums");
    if (gridAlbums && emptyAlbums) {
      if (data.albums.length === 0) {
        gridAlbums.innerHTML = "";
        emptyAlbums.hidden = false;
      } else {
        emptyAlbums.hidden = true;
        renderAlbumsGrid(data.albums, gridAlbums);
      }
    }

    const gridArtists = $("grid-fav-artists");
    const emptyArtists = $("empty-fav-artists");
    if (gridArtists && emptyArtists) {
      if (data.artists.length === 0) {
        gridArtists.innerHTML = "";
        emptyArtists.hidden = false;
      } else {
        emptyArtists.hidden = true;
        renderArtistsGrid(data.artists, gridArtists);
      }
    }
  } catch (err) {
    console.error("Erreur chargement favoris :", err);
  }
}

function renderTracksInContainer(tracks: Track[], container: HTMLElement) {
  container.innerHTML = "";
  tracks.forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(t.id);
    tr.innerHTML = `
      <td class="col-idx">
        <button class="fav-heart-btn is-fav" data-id="${t.id}" title="Retirer des favoris">
          <i class="fa-solid fa-heart"></i>
        </button>
      </td>
      <td class="col-cover"><div class="table-cover-cell"><div class="table-cover-placeholder"><i class="fa-solid fa-compact-disc"></i></div></div></td>
      <td><strong>${escapeHtml(t.title)}</strong></td>
      <td><span class="table-link link-artist" data-artist="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span></td>
      <td><span class="table-link link-album" data-album="${escapeHtml(t.album)}" data-artist="${escapeHtml(t.album_artist || t.artist)}">${escapeHtml(t.album)}</span></td>
      <td class="col-time">${fmtTime(t.duration_secs)}</td>
    `;

    const coverCell = tr.querySelector(".table-cover-cell");
    if (coverCell && t.cover_path) {
      getCoverDataUrl(t.cover_path).then((dataUrl) => {
        if (dataUrl) {
          coverCell.innerHTML = `<img class="table-cover-img" src="${dataUrl}" alt="Cover" />`;
        }
      });
    }

    const favBtn = tr.querySelector(".fav-heart-btn");
    favBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await invoke("toggle_favorite", { targetType: "track", targetId: t.id });
      loadFavorites();
    });

    tr.addEventListener("dblclick", () => {
      playFromQueue(tracks, i);
    });

    tr.addEventListener("contextmenu", (e) =>
      openGenericContextMenu(e, { type: "track", track: t, index: i, queue: tracks })
    );

    container.appendChild(tr);
  });
}

function bindEvents() {
  initCollapsibleSections();
  initSettingsEvents();
  loadAppSettings();
  $("btn-nav-back")?.addEventListener("click", goNavBack);
  $("btn-nav-forward")?.addEventListener("click", goNavForward);

  $("btn-toggle-overlay")?.addEventListener("click", toggleOverlayMode);
  $("overlay-btn-close")?.addEventListener("click", toggleOverlayMode);
  $("overlay-btn-clickthrough")?.addEventListener("click", toggleClickThrough);

  $("overlay-btn-play")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.is_playing) {
      await invoke("pause");
    } else {
      await invoke("resume");
    }
    refreshPlayerState();
  });

  $("overlay-btn-next")?.addEventListener("click", async () => {
    await invoke("next_track");
    refreshPlayerState();
  });

  $("overlay-btn-prev")?.addEventListener("click", async () => {
    await invoke("prev_track");
    refreshPlayerState();
  });

  $("overlay-btn-fav")?.addEventListener("click", async () => {
    const state = await invoke<PlayerState>("get_player_state");
    if (state.current_track) {
      await invoke("toggle_favorite", { targetType: "track", targetId: state.current_track.id });
      refreshPlayerState();
    }
  });

  $("overlay-btn-repeat")?.addEventListener("click", async () => {
    await invoke("toggle_repeat");
    refreshPlayerState();
  });

  $("overlay-btn-shuffle")?.addEventListener("click", async () => {
    await invoke("toggle_shuffle");
    refreshPlayerState();
  });

  $("overlay-btn-volume")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("overlay-volume-popover");
    if (pop) pop.hidden = !pop.hidden;
  });

  $("overlay-volume-slider")?.addEventListener("input", async (e) => {
    const target = e.target as HTMLInputElement;
    updateSliderTrack(target);
    const val = parseFloat(target.value) / 100;
    await invoke("set_volume", { volume: val });
    refreshPlayerState();
  });

  $("overlay-vinyl-disc")?.addEventListener("wheel", async (e) => {
    e.preventDefault();
    const state = await invoke<PlayerState>("get_player_state");
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const newVol = Math.min(1.0, Math.max(0.0, (state.volume || 0.8) + delta));
    await invoke("set_volume", { volume: newVol });
    refreshPlayerState();
  }, { passive: false });

  const handleRingSeek = async (e: MouseEvent) => {
    const vinylDisc = $("overlay-vinyl-disc");
    if (!vinylDisc) return;
    const rect = vinylDisc.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Restrict interaction strictly to the stroke thickness of the ring (radius ~92px, stroke 84px..100px)
    if (dist < 84 || dist > 100) return;

    let rad = Math.atan2(dy, dx) + Math.PI / 2;
    if (rad < 0) rad += 2 * Math.PI;
    const pct = rad / (2 * Math.PI);

    const state = await invoke<PlayerState>("get_player_state");
    const dur = state.current_track?.duration_secs || overlayCurrentTrackDuration;
    if (dur > 0) {
      const seekPos = pct * dur;
      await invoke("seek", { positionSecs: seekPos });
      refreshPlayerState();
    }
  };

  $("overlay-progress-ring-box")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleRingSeek(e);
  });

  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      toggleOverlayMode();
    }
  });

  const overlayContainerEl = $("overlay-container");
  if (overlayContainerEl) {
    overlayContainerEl.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (
        e.button === 0 &&
        !target.closest("button, input, select, textarea, .overlay-hud-btn, .overlay-hud-info, .overlay-volume-popover")
      ) {
        const vinylDisc = $("overlay-vinyl-disc");
        if (vinylDisc) {
          const rect = vinylDisc.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= 84 && dist <= 100) {
            handleRingSeek(e);
            return;
          }
        }
        getCurrentWindow().startDragging();
      }
    });
  }

  window.addEventListener("mouseup", (e) => {
    if (e.button === 3) goNavBack();
    if (e.button === 4) goNavForward();
  });

  $("btn-import").addEventListener("click", async () => {
    const folder = await open({ directory: true, multiple: false, title: "Choisir un dossier de musique" });
    if (!folder) return;
    const report = await invoke("scan_library", { path: folder as string });
    console.log("Scan terminé", report);
    await loadLibrary();
    await loadAlbums();
    await loadArtists();
    enrichLibraryInBatch(allTracks);
  });

  $("btn-scan-missing").addEventListener("click", async () => {
    const missing = allTracks.filter((t) => !t.cover_path || t.year === 0 || !t.genre);
    if (missing.length === 0) {
      alert("Toutes vos pistes ont déjà des métadonnées et des pochettes !");
      return;
    }
    switchView("tracks");
    await enrichLibraryInBatch(allTracks);
    updateMissingMetadataCount();
  });

  $("btn-fetch-all-artist-photos").addEventListener("click", () => {
    enrichArtistPhotosInBatch();
  });

  $("select-audio-device")?.addEventListener("change", (e) => {
    selectAudioDevice((e.target as HTMLSelectElement).value);
  });

  $("btn-refresh-audio-devices")?.addEventListener("click", () => {
    loadAudioDevices();
  });

  $("btn-popover-refresh")?.addEventListener("click", (e) => {
    e.stopPropagation();
    loadAudioDevices();
  });

  $("btn-audio-device")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const popover = $("device-picker-popover");
    if (popover) {
      popover.hidden = !popover.hidden;
    }
  });

  window.addEventListener("click", (e) => {
    const popover = $("device-picker-popover");
    const deviceBtn = $("btn-audio-device");
    if (
      popover &&
      !popover.hidden &&
      !popover.contains(e.target as Node) &&
      !deviceBtn?.contains(e.target as Node)
    ) {
      popover.hidden = true;
    }
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = (btn as HTMLElement).dataset.view!;
      switchView(view);
      if (view === "albums") loadAlbums();
      if (view === "artists") loadArtists();
      if (view === "genres") loadGenres();
      if (view === "playlists") loadPlaylists();
      if (view === "recents") loadRecents();
      if (view === "favorites") loadFavorites();
      if (view === "settings") {
        updateMissingMetadataCount();
        loadAppSettings();
      }
    });
  });

  $("btn-new-playlist").addEventListener("click", async () => {
    const name = prompt("Nom de la playlist :");
    if (!name) return;
    await invoke("create_playlist", { name });
    await loadPlaylists();
  });

  btnPlay.addEventListener("click", async () => {
    const isPlaying = btnPlay.querySelector("i")?.classList.contains("fa-pause");
    if (isPlaying) {
      btnPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
      await invoke("pause");
    } else {
      btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
      await invoke("resume");
    }
    await refreshPlayerState();
  });

  $("btn-next").addEventListener("click", async () => {
    await invoke("next_track");
    await refreshPlayerState();
  });
  $("btn-prev").addEventListener("click", async () => {
    await invoke("prev_track");
    await refreshPlayerState();
  });
  btnRepeat.addEventListener("click", async () => {
    await invoke("toggle_repeat");
    await refreshPlayerState();
  });
  if (btnShuffle) {
    btnShuffle.addEventListener("click", async () => {
      await invoke("toggle_shuffle");
      await refreshPlayerState();
    });
  }

  const performSeek = async () => {
    const val = parseFloat(seekBar.value);
    await invoke("seek", { positionSecs: val });
    isSeeking = false;
    await refreshPlayerState();
  };

  seekBar.addEventListener("mousedown", () => { isSeeking = true; });
  seekBar.addEventListener("touchstart", () => { isSeeking = true; });
  seekBar.addEventListener("input", () => {
    isSeeking = true;
    timeCurrent.textContent = fmtTime(parseFloat(seekBar.value));
    updateSliderTrack(seekBar);
  });
  seekBar.addEventListener("change", performSeek);
  seekBar.addEventListener("mouseup", () => { if (isSeeking) performSeek(); });
  seekBar.addEventListener("touchend", () => { if (isSeeking) performSeek(); });

  volumeBar.addEventListener("input", async () => {
    updateSliderTrack(volumeBar);
    await invoke("set_volume", { volume: parseInt(volumeBar.value) / 100 });
  });

  searchInput.addEventListener("input", () => {
    handleSearchInput();
  });

  $("ctx-play").addEventListener("click", async () => {
    if (!activeCtxTarget) return;
    if (activeCtxTarget.type === "track" && activeCtxTarget.queue) {
      playFromQueue(activeCtxTarget.queue, activeCtxTarget.index || 0);
    } else if (activeCtxTarget.type === "album" && activeCtxTarget.album) {
      const tracks = allTracks.filter(
        (t) => t.album === activeCtxTarget!.album!.album && t.album_artist === activeCtxTarget!.album!.album_artist
      );
      playFromQueue(tracks, 0);
    } else if (activeCtxTarget.type === "artist" && activeCtxTarget.artist) {
      const normName = activeCtxTarget.artist.artist.trim().toLowerCase();
      const tracks = allTracks.filter(
        (t) => t.artist.trim().toLowerCase().includes(normName) || t.album_artist.trim().toLowerCase().includes(normName)
      );
      playFromQueue(tracks, 0);
    } else if (activeCtxTarget.type === "genre" && activeCtxTarget.genreTracks) {
      playFromQueue(activeCtxTarget.genreTracks, 0);
    }
    hideContextMenu();
  });

  $("ctx-add-queue").addEventListener("click", () => {
    if (!activeCtxTarget) return;
    let tracksToAdd: Track[] = [];
    if (activeCtxTarget.type === "track" && activeCtxTarget.track) {
      tracksToAdd = [activeCtxTarget.track];
    } else if (activeCtxTarget.type === "album" && activeCtxTarget.album) {
      tracksToAdd = allTracks.filter(
        (t) => t.album === activeCtxTarget!.album!.album && t.album_artist === activeCtxTarget!.album!.album_artist
      );
    } else if (activeCtxTarget.type === "artist" && activeCtxTarget.artist) {
      const normName = activeCtxTarget.artist.artist.trim().toLowerCase();
      tracksToAdd = allTracks.filter(
        (t) => t.artist.trim().toLowerCase().includes(normName) || t.album_artist.trim().toLowerCase().includes(normName)
      );
    } else if (activeCtxTarget.type === "genre" && activeCtxTarget.genreTracks) {
      tracksToAdd = activeCtxTarget.genreTracks;
    }

    if (tracksToAdd.length > 0) {
      currentQueue.push(...tracksToAdd);
      invoke<PlayerState>("get_player_state").then((state) => {
        if (!state.current_track) {
          playFromQueue(currentQueue, currentQueue.length - tracksToAdd.length);
        }
      });
    }
    hideContextMenu();
  });

  $("ctx-filter-artist").addEventListener("click", () => {
    if (!activeCtxTarget) return;
    if (activeCtxTarget.track) openArtistByName(activeCtxTarget.track.artist);
    else if (activeCtxTarget.album) openArtistByName(activeCtxTarget.album.album_artist);
    hideContextMenu();
  });

  $("ctx-filter-album").addEventListener("click", () => {
    if (activeCtxTarget?.track) {
      filterByAlbum(
        activeCtxTarget.track.album,
        activeCtxTarget.track.album_artist || activeCtxTarget.track.artist
      );
    }
    hideContextMenu();
  });

  $("ctx-toggle-fav")?.addEventListener("click", async () => {
    if (!activeCtxTarget) return;
    if (activeCtxTarget.type === "track" && activeCtxTarget.track) {
      const isFav = await invoke<boolean>("toggle_favorite", { targetType: "track", targetId: activeCtxTarget.track.id });
      activeCtxTarget.track.is_favorite = isFav;
      await loadLibrary();
    } else if (activeCtxTarget.type === "album" && activeCtxTarget.album) {
      const key = `${activeCtxTarget.album.album}::${activeCtxTarget.album.album_artist}`;
      await invoke<boolean>("toggle_favorite", { targetType: "album", targetId: key });
      await loadAlbums();
    } else if (activeCtxTarget.type === "artist" && activeCtxTarget.artist) {
      await invoke<boolean>("toggle_favorite", { targetType: "artist", targetId: activeCtxTarget.artist.artist });
      await loadArtists();
    }
    hideContextMenu();
  });

  $("ctx-like")?.addEventListener("click", async () => {
    if (activeCtxTarget?.type === "track" && activeCtxTarget.track) {
      const res = await invoke<[number, number]>("like_track", { trackId: activeCtxTarget.track.id });
      activeCtxTarget.track.likes = res[0];
      activeCtxTarget.track.dislikes = res[1];
      await loadLibrary();
    }
    hideContextMenu();
  });

  $("ctx-dislike")?.addEventListener("click", async () => {
    if (activeCtxTarget?.type === "track" && activeCtxTarget.track) {
      const res = await invoke<[number, number]>("dislike_track", { trackId: activeCtxTarget.track.id });
      activeCtxTarget.track.likes = res[0];
      activeCtxTarget.track.dislikes = res[1];
      await loadLibrary();
    }
    hideContextMenu();
  });

  $("btn-like-now")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const state = await invoke<PlayerState>("get_player_state");
    if (!state.current_track) return;
    const trackId = state.current_track.id || state.current_track.path;
    const res = await invoke<[number, number]>("like_track", { trackId });
    state.current_track.likes = res[0];
    state.current_track.dislikes = res[1];
    applyPlayerState(state);
    const t = allTracks.find((tr) => tr.id === state.current_track?.id || tr.path === state.current_track?.path);
    if (t) { t.likes = res[0]; t.dislikes = res[1]; }
    renderTracks(allTracks);
  });

  $("btn-dislike-now")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const state = await invoke<PlayerState>("get_player_state");
    if (!state.current_track) return;
    const trackId = state.current_track.id || state.current_track.path;
    const res = await invoke<[number, number]>("dislike_track", { trackId });
    state.current_track.likes = res[0];
    state.current_track.dislikes = res[1];
    applyPlayerState(state);
    const t = allTracks.find((tr) => tr.id === state.current_track?.id || tr.path === state.current_track?.path);
    if (t) { t.likes = res[0]; t.dislikes = res[1]; }
    renderTracks(allTracks);
  });

  $("btn-fav-now")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const state = await invoke<PlayerState>("get_player_state");
    if (!state.current_track) return;
    const trackId = state.current_track.id || state.current_track.path;
    const isFav = await invoke<boolean>("toggle_favorite", { targetType: "track", targetId: trackId });
    state.current_track.is_favorite = isFav;
    applyPlayerState(state);
    const t = allTracks.find((tr) => tr.id === state.current_track?.id || tr.path === state.current_track?.path);
    if (t) { t.is_favorite = isFav; }
    renderTracks(allTracks);
    const viewFavs = $("view-favorites");
    if (viewFavs && !viewFavs.hidden) {
      loadFavorites();
    }
  });

  $("btn-clear-history")?.addEventListener("click", async () => {
    if (confirm("Voulez-vous vraiment effacer tout votre historique de lecture ?")) {
      await invoke("clear_play_history");
      await loadRecents();
    }
  });

  $("ctx-edit-album")?.addEventListener("click", () => {
    if (activeCtxTarget?.album) {
      openAlbumModal(activeCtxTarget.album);
    }
    hideContextMenu();
  });

  $("ctx-edit-artist")?.addEventListener("click", () => {
    if (activeCtxTarget?.artist) {
      openArtistModal(activeCtxTarget.artist);
    }
    hideContextMenu();
  });

  $("ctx-fetch-artist-photo")?.addEventListener("click", () => {
    if (activeCtxTarget?.artist) {
      enrichArtistPhotosInBatch();
    }
    hideContextMenu();
  });

  $("ctx-toggle-artist-type")?.addEventListener("click", async () => {
    if (activeCtxTarget?.artist) {
      const currentIsGrp = isArtistGroup(activeCtxTarget.artist);
      await invoke("set_artist_is_group", {
        artist: activeCtxTarget.artist.artist,
        isGroup: !currentIsGrp,
      });
      await loadArtists();
    }
    hideContextMenu();
  });

  $("ctx-rename-genre")?.addEventListener("click", () => {
    if (activeCtxTarget?.genreName) {
      openGenreModal(activeCtxTarget.genreName);
    }
    hideContextMenu();
  });

  $("ctx-rename-playlist")?.addEventListener("click", async () => {
    if (activeCtxTarget?.type === "playlist" && activeCtxTarget.playlistId) {
      const newName = prompt("Nouveau nom de la playlist :", activeCtxTarget.playlistName || "");
      if (newName && newName.trim()) {
        await invoke("rename_playlist", { playlistId: activeCtxTarget.playlistId, newName: newName.trim() });
        loadPlaylists();
      }
    }
    hideContextMenu();
  });

  $("ctx-delete-playlist")?.addEventListener("click", async () => {
    if (activeCtxTarget?.type === "playlist" && activeCtxTarget.playlistId) {
      if (confirm(`Voulez-vous vraiment supprimer la playlist "${activeCtxTarget.playlistName}" ?`)) {
        await invoke("delete_playlist", { playlistId: activeCtxTarget.playlistId });
        loadPlaylists();
        switchView("tracks");
        renderTracks(allTracks);
      }
    }
    hideContextMenu();
  });

  $("ctx-info").addEventListener("click", () => {
    if (!activeCtxTarget) return;
    if (activeCtxTarget.type === "track" && activeCtxTarget.track) {
      openMetadataModal(activeCtxTarget.track);
    } else if (activeCtxTarget.type === "album" && activeCtxTarget.album) {
      filterByAlbum(activeCtxTarget.album.album, activeCtxTarget.album.album_artist);
    } else if (activeCtxTarget.type === "artist" && activeCtxTarget.artist) {
      openArtistView(activeCtxTarget.artist);
    } else if (activeCtxTarget.type === "genre" && activeCtxTarget.genreName) {
      filterByGenre(activeCtxTarget.genreName);
    }
    hideContextMenu();
  });

  document.addEventListener("click", hideContextMenu);
  document.addEventListener("contextmenu", (e) => {
    if (
      !(e.target as HTMLElement).closest(
        ".track-table, .grid-card, .genre-card, .artist-card, .playlist-list li"
      )
    ) {
      hideContextMenu();
    }
  });
  window.addEventListener("scroll", hideContextMenu, true);
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      goNavBack();
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      goNavForward();
    } else if (e.key === "Escape") {
      hideContextMenu();
      closeMetadataModal();
      closeAlbumModal();
      closeArtistModal();
      closeGenreModal();
    }
  });

  setupMetadataModalEvents();
  setupAlbumModalEvents();
  setupArtistModalEvents();
  setupGenreModalEvents();
}

let editingArtistSummary: ArtistSummary | null = null;
let editingArtistBase64: string | null = null;

function openArtistModal(a: ArtistSummary) {
  editingArtistSummary = a;
  editingArtistBase64 = null;
  const nameInput = $<HTMLInputElement>("artist-input-name");
  const genreInput = $<HTMLInputElement>("artist-input-genre");
  const bioInput = $<HTMLTextAreaElement>("artist-input-bio");
  const coverImg = $<HTMLImageElement>("artist-modal-cover-img");
  const coverPlaceholder = $("artist-modal-cover-placeholder");

  nameInput.value = a.artist;
  genreInput.value = "";
  bioInput.value = a.bio || "";

  if (a.image_path) {
    getCoverDataUrl(a.image_path).then((url) => {
      if (url) {
        coverImg.src = url;
        coverImg.hidden = false;
        coverPlaceholder.hidden = true;
      } else {
        coverImg.hidden = true;
        coverPlaceholder.hidden = false;
      }
    });
  } else {
    coverImg.hidden = true;
    coverPlaceholder.hidden = false;
  }

  const modal = $("artist-modal");
  modal.hidden = false;
}

function closeArtistModal() {
  const modal = $("artist-modal");
  modal.hidden = true;
  editingArtistSummary = null;
  editingArtistBase64 = null;
}

function setupArtistModalEvents() {
  $("artist-modal-close")?.addEventListener("click", closeArtistModal);
  $("artist-modal-cancel")?.addEventListener("click", closeArtistModal);

  $("btn-artist-web-photo")?.addEventListener("click", async () => {
    if (!editingArtistSummary) return;
    const term = encodeURIComponent(editingArtistSummary.artist);
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
          const hdUrl = data.results[0].artworkUrl100.replace("100x100bb", "600x600bb");
          const imgRes = await fetch(hdUrl);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            const reader = new FileReader();
            reader.onloadend = () => {
              editingArtistBase64 = reader.result as string;
              const coverImg = $<HTMLImageElement>("artist-modal-cover-img");
              const coverPlaceholder = $("artist-modal-cover-placeholder");
              coverImg.src = editingArtistBase64;
              coverImg.hidden = false;
              coverPlaceholder.hidden = true;
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    } catch (err) {
      console.error("Erreur recherche photo artiste", err);
    }
  });

  $("artist-modal-save")?.addEventListener("click", async () => {
    if (!editingArtistSummary) return;
    const name = $<HTMLInputElement>("artist-input-name").value.trim();
    const genre = $<HTMLInputElement>("artist-input-genre").value.trim();
    const bio = $<HTMLTextAreaElement>("artist-input-bio").value.trim();

    if (!name) return;

    await invoke("save_artist_metadata", {
      artist: name,
      genre: genre || null,
      bio: bio || null,
      members: editingArtistSummary.members || null,
      imageBase64: editingArtistBase64,
    });

    closeArtistModal();
    await loadArtists();
  });
}

let editingGenreName: string | null = null;

function openGenreModal(genreName: string) {
  editingGenreName = genreName;
  const input = $<HTMLInputElement>("genre-input-name");
  input.value = genreName;
  const modal = $("genre-modal");
  modal.hidden = false;
}

function closeGenreModal() {
  const modal = $("genre-modal");
  modal.hidden = true;
  editingGenreName = null;
}

function setupGenreModalEvents() {
  $("genre-modal-close")?.addEventListener("click", closeGenreModal);
  $("genre-modal-cancel")?.addEventListener("click", closeGenreModal);

  $("genre-modal-save")?.addEventListener("click", async () => {
    if (!editingGenreName) return;
    const newName = $<HTMLInputElement>("genre-input-name").value.trim();
    if (!newName || newName === editingGenreName) {
      closeGenreModal();
      return;
    }

    await invoke("rename_genre", { oldGenre: editingGenreName, newGenre: newName });
    closeGenreModal();
    await loadLibrary();
    loadGenres();
  });
}

let searchDebounceTimer: number | null = null;

function handleSearchInput() {
  const q = searchInput.value.toLowerCase().trim();

  if (!isNavigatingHistory) {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(() => {
      pushNavState({
        type: "search",
        view: "tracks",
        searchQuery: searchInput.value,
      });
    }, 600);
  }

  // 1. Filter Tracks view
  const filteredTracks = !q
    ? allTracks
    : allTracks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.genre.toLowerCase().includes(q)
      );
  renderTracks(filteredTracks);

  // 2. Filter Albums view cards
  const albumCards = document.querySelectorAll("#view-albums .grid-card");
  albumCards.forEach((card) => {
    const title = card.querySelector(".title")?.textContent?.toLowerCase() || "";
    const subtitle = card.querySelector(".subtitle")?.textContent?.toLowerCase() || "";
    const matches = !q || title.includes(q) || subtitle.includes(q);
    (card as HTMLElement).style.display = matches ? "" : "none";
  });

  // 3. Filter Artists view cards (Solo & Group sections)
  let visibleSoloCount = 0;
  let visibleGroupCount = 0;

  const soloCards = document.querySelectorAll("#grid-solo-artists .grid-card");
  soloCards.forEach((card) => {
    const title = card.querySelector(".title")?.textContent?.toLowerCase() || "";
    const matches = !q || title.includes(q);
    (card as HTMLElement).style.display = matches ? "" : "none";
    if (matches) visibleSoloCount++;
  });

  const groupCards = document.querySelectorAll("#grid-group-artists .grid-card");
  groupCards.forEach((card) => {
    const title = card.querySelector(".title")?.textContent?.toLowerCase() || "";
    const matches = !q || title.includes(q);
    (card as HTMLElement).style.display = matches ? "" : "none";
    if (matches) visibleGroupCount++;
  });

  const countSolo = $("count-solo-artists");
  const countGroup = $("count-group-artists");
  const emptySolo = $("empty-solo-artists");
  const emptyGroup = $("empty-group-artists");

  if (countSolo) countSolo.textContent = String(visibleSoloCount);
  if (countGroup) countGroup.textContent = String(visibleGroupCount);
  if (emptySolo) emptySolo.hidden = visibleSoloCount > 0;
  if (emptyGroup) emptyGroup.hidden = visibleGroupCount > 0;

  // 4. Filter Playlists view items
  const playlistItems = document.querySelectorAll("#playlist-list li");
  playlistItems.forEach((li) => {
    const text = li.textContent?.toLowerCase() || "";
    const matches = !q || text.includes(q);
    (li as HTMLElement).style.display = matches ? "" : "none";
  });

  // 5. Filter Genres view cards
  const genreCards = document.querySelectorAll("#view-genres .genre-card");
  genreCards.forEach((card) => {
    const title = card.querySelector(".genre-title")?.textContent?.toLowerCase() || "";
    const matches = !q || title.includes(q);
    (card as HTMLElement).style.display = matches ? "" : "none";
  });
}

interface OnlineMetadataResult {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  coverUrl: string | null;
  coverBase64: string | null;
  source: string;
}

let activeModalTrack: Track | null = null;
let pendingOnlineResult: OnlineMetadataResult | null = null;

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

async function openMetadataModal(track: Track) {
  activeModalTrack = track;
  pendingOnlineResult = null;

  try {
    const stats = await invoke<[number, number, boolean]>("get_track_live_stats", { trackId: track.id || track.path });
    track.likes = stats[0];
    track.dislikes = stats[1];
    track.is_favorite = stats[2];
  } catch (err) {
    console.warn("Erreur chargement des métadonnées en direct :", err);
  }

  metaTitleInput.value = track.title;
  metaArtistInput.value = track.artist;
  metaAlbumInput.value = track.album;
  metaGenreInput.value = track.genre;
  metaYearInput.value = track.year ? String(track.year) : "";
  metaFilePath.textContent = track.path;

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

  onlineResultsBox.hidden = true;

  if (track.cover_path) {
    const dataUrl = await getCoverDataUrl(track.cover_path);
    if (dataUrl) {
      metaCoverImg.src = dataUrl;
      metaCoverImg.hidden = false;
      metaCoverPlaceholder.hidden = true;
    } else {
      metaCoverImg.hidden = true;
      metaCoverPlaceholder.hidden = false;
    }
  } else {
    metaCoverImg.hidden = true;
    metaCoverPlaceholder.hidden = false;
  }

  metadataModal.style.display = "flex";
  metadataModal.hidden = false;
}

function closeMetadataModal() {
  metadataModal.hidden = true;
  metadataModal.style.display = "none";
  activeModalTrack = null;
  pendingOnlineResult = null;
}

async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    /* ignore error */
  }
  return null;
}

async function fetchOnlineMetadata(artist: string, title: string): Promise<OnlineMetadataResult | null> {
  const query = encodeURIComponent(`${artist} ${title}`);
  const itunesUrl = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;

  try {
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        let coverUrl: string | null = item.artworkUrl100 || null;
        if (coverUrl) {
          coverUrl = coverUrl.replace("100x100bb", "600x600bb");
        }

        let year = 0;
        if (item.releaseDate) {
          const y = parseInt(item.releaseDate.substring(0, 4), 10);
          if (!isNaN(y)) year = y;
        }

        let coverBase64: string | null = null;
        if (coverUrl) {
          try {
            const imgRes = await fetch(coverUrl);
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              coverBase64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            }
          } catch {
            /* ignore image fetch error */
          }
        }

        return {
          title: item.trackName || title,
          artist: item.artistName || artist,
          album: item.collectionName || "",
          genre: item.primaryGenreName || "",
          year,
          coverUrl,
          coverBase64,
          source: "iTunes Search API",
        };
      }
    }
  } catch (e) {
    console.warn("Erreur recherche iTunes API", e);
  }

  // Fallback MusicBrainz
  try {
    const mbUrl = `https://musicbrainz.org/ws/2/recording?query=artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"&fmt=json`;
    const res = await fetch(mbUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.recordings && data.recordings.length > 0) {
        const rec = data.recordings[0];
        const release = rec.releases?.[0];
        let yearMb = 0;
        if (release?.date) {
          const y = parseInt(release.date.substring(0, 4), 10);
          if (!isNaN(y)) yearMb = y;
        }

        return {
          title: rec.title || title,
          artist: rec["artist-credit"]?.[0]?.name || artist,
          album: release?.title || "",
          genre: rec.tags?.[0]?.name || "",
          year: yearMb,
          coverUrl: null,
          coverBase64: null,
          source: "MusicBrainz API",
        };
      }
    }
  } catch (e) {
    console.warn("Erreur recherche MusicBrainz API", e);
  }

  return null;
}

interface ArtistOnlineResult {
  artist: string;
  genre: string | null;
  coverBase64: string | null;
}

async function fetchArtistOnlineMetadata(artistName: string): Promise<ArtistOnlineResult | null> {
  try {
    const term = encodeURIComponent(artistName);
    const songUrl = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`;
    const songResp = await fetch(songUrl);
    let genre: string | null = null;
    let coverUrl: string | null = null;

    if (songResp.ok) {
      const songData = await songResp.json();
      if (songData.results && songData.results.length > 0) {
        const s = songData.results[0];
        genre = s.primaryGenreName || null;
        if (s.artworkUrl100) {
          coverUrl = s.artworkUrl100.replace("100x100bb", "600x600bb");
        }
      }
    }

    let coverBase64: string | null = null;
    if (coverUrl) {
      coverBase64 = await imageUrlToBase64(coverUrl);
    }

    if (genre || coverBase64) {
      return { artist: artistName, genre, coverBase64 };
    }
  } catch (e) {
    console.warn("Erreur fetchArtistOnlineMetadata", e);
  }
  return null;
}

function setupMetadataModalEvents() {
  $("modal-close").addEventListener("click", closeMetadataModal);
  $("modal-btn-cancel").addEventListener("click", closeMetadataModal);

  $("btn-fetch-online").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("btn-fetch-online");
    const origText = btn.textContent;
    btn.textContent = "⏳ Recherche en ligne...";
    btn.disabled = true;

    try {
      const result = await fetchOnlineMetadata(metaArtistInput.value, metaTitleInput.value);
      if (result) {
        pendingOnlineResult = result;
        $("online-source-name").textContent = result.source;
        $("online-title").textContent = result.title;
        $("online-artist").textContent = result.artist;
        $("online-album").textContent = result.album || "—";
        $("online-genre").textContent = result.genre || "—";
        $("online-year").textContent = result.year ? String(result.year) : "—";

        const onlineImg = $<HTMLImageElement>("online-cover-img");
        if (result.coverBase64 || result.coverUrl) {
          onlineImg.src = result.coverBase64 || result.coverUrl!;
          onlineImg.hidden = false;
        } else {
          onlineImg.hidden = true;
        }

        onlineResultsBox.hidden = false;
      } else {
        alert("Aucune métadonnée trouvée en ligne pour cet artiste / titre.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la connexion aux services de métadonnées.");
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  });

  $("btn-use-online-data").addEventListener("click", () => {
    if (!pendingOnlineResult) return;
    metaTitleInput.value = pendingOnlineResult.title;
    metaArtistInput.value = pendingOnlineResult.artist;
    if (pendingOnlineResult.album) metaAlbumInput.value = pendingOnlineResult.album;
    if (pendingOnlineResult.genre) metaGenreInput.value = pendingOnlineResult.genre;
    if (pendingOnlineResult.year) metaYearInput.value = String(pendingOnlineResult.year);

    if (pendingOnlineResult.coverBase64) {
      metaCoverImg.src = pendingOnlineResult.coverBase64;
      metaCoverImg.hidden = false;
      metaCoverPlaceholder.hidden = true;
    }
  });

  $("modal-btn-save").addEventListener("click", async () => {
    if (!activeModalTrack) return;

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
      await loadLibrary();
      await loadAlbums();
      await loadArtists();
    } catch (e) {
      console.error("Erreur enregistrement métadonnées", e);
      alert(`Erreur d'enregistrement : ${e}`);
    }
  });
}

let activeModalAlbum: AlbumSummary | null = null;
let pendingAlbumOnlineResult: OnlineMetadataResult | null = null;

const albumModal = $("album-modal");
const albumTitleInput = $<HTMLInputElement>("album-input-title");
const albumArtistInput = $<HTMLInputElement>("album-input-artist");
const albumGenreInput = $<HTMLInputElement>("album-input-genre");
const albumYearInput = $<HTMLInputElement>("album-input-year");
const albumCoverImg = $<HTMLImageElement>("album-cover-img");
const albumCoverPlaceholder = $("album-cover-placeholder");
const albumOnlineResultsBox = $("album-online-results-box");

async function openAlbumModal(album: AlbumSummary) {
  activeModalAlbum = album;
  pendingAlbumOnlineResult = null;

  albumTitleInput.value = album.album;
  albumArtistInput.value = album.album_artist;
  albumYearInput.value = album.year ? String(album.year) : "";

  const sampleTrack = allTracks.find((t) => t.album === album.album);
  albumGenreInput.value = sampleTrack?.genre || "";

  albumOnlineResultsBox.hidden = true;

  if (album.cover_path) {
    const dataUrl = await getCoverDataUrl(album.cover_path);
    if (dataUrl) {
      albumCoverImg.src = dataUrl;
      albumCoverImg.hidden = false;
      albumCoverPlaceholder.hidden = true;
    } else {
      albumCoverImg.hidden = true;
      albumCoverPlaceholder.hidden = false;
    }
  } else {
    albumCoverImg.hidden = true;
    albumCoverPlaceholder.hidden = false;
  }

  albumModal.style.display = "flex";
  albumModal.hidden = false;
}

function closeAlbumModal() {
  albumModal.hidden = true;
  albumModal.style.display = "none";
  activeModalAlbum = null;
  pendingAlbumOnlineResult = null;
}

function setupAlbumModalEvents() {
  $("album-modal-close").addEventListener("click", closeAlbumModal);
  $("album-modal-cancel").addEventListener("click", closeAlbumModal);

  $("btn-album-fetch-online").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("btn-album-fetch-online");
    const origText = btn.textContent;
    btn.textContent = "⏳ Recherche de l'album en ligne...";
    btn.disabled = true;

    try {
      const result = await fetchOnlineMetadata(albumArtistInput.value, albumTitleInput.value);
      if (result) {
        pendingAlbumOnlineResult = result;
        $("album-online-source-name").textContent = result.source;
        $("album-online-album").textContent = result.album || result.title;
        $("album-online-artist").textContent = result.artist;
        $("album-online-genre").textContent = result.genre || "—";
        $("album-online-year").textContent = result.year ? String(result.year) : "—";

        const onlineImg = $<HTMLImageElement>("album-online-cover-img");
        if (result.coverBase64 || result.coverUrl) {
          onlineImg.src = result.coverBase64 || result.coverUrl!;
          onlineImg.hidden = false;
        } else {
          onlineImg.hidden = true;
        }

        albumOnlineResultsBox.hidden = false;
      } else {
        alert("Aucune métadonnée trouvée en ligne pour cet album.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la recherche web d'album.");
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  });

  $("btn-use-album-online-data").addEventListener("click", () => {
    if (!pendingAlbumOnlineResult) return;
    if (pendingAlbumOnlineResult.album) albumTitleInput.value = pendingAlbumOnlineResult.album;
    if (pendingAlbumOnlineResult.artist) albumArtistInput.value = pendingAlbumOnlineResult.artist;
    if (pendingAlbumOnlineResult.genre) albumGenreInput.value = pendingAlbumOnlineResult.genre;
    if (pendingAlbumOnlineResult.year) albumYearInput.value = String(pendingAlbumOnlineResult.year);

    if (pendingAlbumOnlineResult.coverBase64) {
      albumCoverImg.src = pendingAlbumOnlineResult.coverBase64;
      albumCoverImg.hidden = false;
      albumCoverPlaceholder.hidden = true;
    }
  });

  $("album-modal-save").addEventListener("click", async () => {
    if (!activeModalAlbum) return;

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
      await loadLibrary();
      await loadAlbums();
      await loadArtists();
    } catch (e) {
      console.error("Erreur mise à jour album", e);
      alert(`Erreur d'enregistrement : ${e}`);
    }
  });
}

interface TrackMetadataUpdate {
  track_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  cover_base64: string | null;
}

async function enrichLibraryInBatch(tracks: Track[]) {
  const targets = tracks.filter((t) => !t.cover_path || t.year === 0 || !t.genre);
  if (targets.length === 0) return;

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");

  progressBanner.hidden = false;
  progressBanner.style.display = "flex";

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

    progressText.textContent = `Enrichissement des métadonnées en ligne (${processedCount} / ${totalAlbums} albums) : ${sample.album} par ${sample.artist}...`;
    progressBar.style.width = `${percent}%`;

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
        await loadLibrary();
        await loadAlbums();
      } catch (e) {
        console.error("Erreur batch update", e);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (updates.length > 0) {
    try {
      await invoke("batch_update_metadata", { updates });
      await loadLibrary();
      await loadAlbums();
      await loadArtists();
    } catch (e) {
      console.error("Erreur batch update final", e);
    }
  }

  progressText.textContent = "✨ Enrichissement des métadonnées terminé !";
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressBanner.hidden = true;
    progressBanner.style.display = "none";
  }, 2500);
}

async function enrichArtistPhotosInBatch() {
  const artists = await invoke<ArtistSummary[]>("get_artists");
  if (artists.length === 0) {
    alert("Aucun artiste trouvé dans la bibliothèque.");
    return;
  }

  const progressBanner = $("scan-progress");
  const progressText = $("scan-progress-text");
  const progressBar = $("scan-progress-bar");

  switchView("artists");

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

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await loadArtists();

  progressText.textContent = "✨ Mise à jour des photos d'artistes terminée !";
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressBanner.hidden = true;
    progressBanner.style.display = "none";
  }, 2500);
}

async function restoreLastPlayerState() {
  try {
    const last = await invoke<LastPlayerState>("get_last_player_state");

    if (last.volume !== undefined && last.volume !== null && volumeBar) {
      volumeBar.value = String(Math.round(last.volume * 100));
      updateSliderTrack(volumeBar);
      await invoke("set_volume", { volume: last.volume });
    }

    if (last.audio_device) {
      currentAudioDevice = last.audio_device;
      await invoke("set_audio_device", { deviceName: last.audio_device });
      renderAudioDeviceUI();
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

let saveStateCounter = 0;

async function pollState() {
  setInterval(async () => {
    try {
      const state = await invoke<PlayerState>("get_player_state");
      applyPlayerState(state);

      saveStateCounter++;
      if (state.current_track && saveStateCounter % 10 === 0) {
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

async function init() {
  bindEvents();
  await loadLibrary();
  await loadPlaylists();
  await loadAudioDevices();
  await restoreLastPlayerState();
  updateSliderTrack(seekBar);
  updateSliderTrack(volumeBar);
  pollState();
}

init();
