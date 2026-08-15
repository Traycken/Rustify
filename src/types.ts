/**
 * ============================================================================
 * Rustify — Types & Interfaces TypeScript Centralisés (src/types.ts)
 * ----------------------------------------------------------------------------
 * Ce fichier regroupe l'ensemble des structures de données (Track, Album,
 * Artist, PlayerState, EqState, Downloader, etc.) utilisées dans l'application.
 * 
 * Sommaire des exportations :
 * - FrontendLogEntry, DebugLogEntryLike : Entrées de logs et débogage.
 * - Track, TrackMetadataUpdate : Structure d'un morceau et màj métadonnées.
 * - AlbumSummary, ArtistSummary, BandMember, BandDetailsResult : Albums & Artistes.
 * - HistoryItem, FavoritesData, Playlist, Radio, RadioInput : Vues secondaires.
 * - PlayerState, LastPlayerState, SmartSession, AlgoFeedbackState : Moteur de lecture.
 * - EqProfile, EqState, TEMPO_UNKNOWN_LABEL, TempoBucket : Égaliseur & Tempo.
 * - AppDialogMode, AppDialogOptions : Modales personnalisées alert/confirm/prompt.
 * - ContextTarget : Options du menu contextuel.
 * - NavState : Navigation & historique des vues.
 * - OnlineMetadataResult, ArtistOnlineResult : Recherche métadonnées web.
 * - DownloaderEnvStatus, DownloaderSettings, DownloadOptions,
 *   DownloaderLogPayload, DownloaderFinishedPayload : Téléchargeur Spotify/YouTube.
 * ============================================================================
 */

export interface FrontendLogEntry {
  timestamp: string;
  message: string;
  level?: string;
}

export interface DebugLogEntryLike {
  timestamp?: string;
  message?: string;
  level?: string;
  [key: string]: unknown;
}

export interface DiscordPresencePayload {
  details: string;
  state: string;
  is_playing: boolean;
  is_radio: boolean;
  position_secs?: number | null;
  duration_secs?: number | null;
}


export interface Track {
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
  is_ecstasy?: boolean;
  manual_select_count?: number;
  play_count?: number;
  skip_count?: number;
  total_listen_secs?: number;
  avg_listen_secs?: number;
  permanent_score?: number;
  temp_score?: number;
  effective_score?: number;
  bpm?: number | null;
  bpm_is_official?: boolean;
  isrc?: string | null;
  mbid?: string | null;
  iswc?: string | null;
  tags?: string[];
  credits?: { role: string; name: string }[];
  lyrics_plain?: string | null;
  lyrics_synced?: string | null;
  is_instrumental?: boolean | null;
  deezer_id?: string | null;
  enrichment_attempts?: number;
}

export interface TrackMetadataUpdate {
  track_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  cover_base64: string | null;
}

export interface AlbumSummary {
  album: string;
  album_artist: string;
  year: number;
  track_count: number;
  cover_path: string | null;
  is_favorite?: boolean;
}

export interface ArtistSummary {
  artist: string;
  track_count: number;
  image_path: string | null;
  bio: string | null;
  members: string | null;
  is_group?: boolean | null;
  is_favorite?: boolean;
  mbid?: string | null;
  deezer_id?: string | null;
  fan_count?: number | null;
  life_span_begin?: string | null;
  life_span_end?: string | null;
  is_ended?: boolean | null;
  death_cause?: string | null;
  wikidata_qid?: string | null;
  external_ids?: Record<string, string> | null;
}

export interface BandMember {
  name: string;
  photoUrl: string | null;
  joinDate?: string | null;
  leaveDate?: string | null;
  isCurrent?: boolean;
}

export interface BandDetailsResult {
  bio: string | null;
  members: BandMember[];
}

export interface HistoryItem {
  id: number;
  track: Track;
  played_at: string;
}

export interface FavoritesData {
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
}

export interface Playlist {
  id: string;
  name: string;
  track_count: number;
  is_system?: boolean;
}

export interface Radio {
  id: string;
  name: string;
  genre: string;
  country: string;
  stream_url: string;
  image_path: string | null;
  is_video: boolean;
  is_online: boolean;
  created_at: string;
}

export interface RadioInput {
  id?: string;
  name: string;
  genre: string;
  country: string;
  stream_url: string;
  image_base64?: string;
  is_video: boolean;
}

export interface ChannelLiveStreamItem {
  id: string;
  title: string;
  url: string;
  thumbnail_url?: string | null;
}

export interface RadioOnlineMetadataResult {
  name?: string | null;
  genre?: string | null;
  country?: string | null;
  cover_url?: string | null;
  is_video: boolean;
}

export interface PlayerState {
  current_track: Track | null;
  is_playing: boolean;
  position_secs: number;
  volume: number;
  queue: Track[];
  queue_index: number;
  repeat: boolean;
  shuffle: boolean;
  smart_shuffle_active?: boolean;
  audio_device: string | null;
}

export interface LastPlayerState {
  volume: number;
  audio_device: string | null;
  track_id: string | null;
  position_secs: number;
  queue_index: number;
  track: Track | null;
}

export interface SmartSession {
  id: number;
  session_start: string;
  expires_at: string;
  recent_track_ids: string[];
  consecutive_skips: number;
  consecutive_completes: number;
  target_genre: string | null;
  target_artist: string | null;
  target_bpm_min: number | null;
  target_bpm_max: number | null;
  algo_feedback: { track_id: string; liked: boolean }[];
}

export type AlgoFeedbackState = "idle" | "liked" | "disliked";

export interface EqProfile {
  id: string;
  name: string;
  preamp: number;
  gains: number[];
  device_name: string | null;
}

export interface EqState {
  enabled: boolean;
  active_profile_id: string;
  profiles: EqProfile[];
}

export interface TempoBucket {
  label: string;
  min: number;
  max: number;
  icon: string;
}

export type AppDialogMode = "alert" | "confirm" | "prompt";

export interface AppDialogOptions {
  mode: AppDialogMode;
  message: string;
  title?: string;
  defaultValue?: string;
  okLabel?: string;
  cancelLabel?: string;
}

export interface ContextTarget {
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
  currentPlaylistId?: string;
}

export interface MoodPlaylistOption {
  id: string;
  title: string;
  description: string;
  icon: string;
  targetBpmMin?: number;
  targetBpmMax?: number;
  favoredGenres: string[];
  penalizedGenres: string[];
  requireInstrumental?: boolean;
  energyTarget: "low" | "medium" | "high" | "any";
}

export interface MoodDefinition {
  id: string;
  emoji: string;
  label: string;
  description: string;
  tempoAdvice: string;
  playlists: MoodPlaylistOption[];
}

export interface NavState {
  type: "view" | "artist" | "album" | "genre" | "tempo" | "mood" | "search" | "year";
  view: string;
  artistSummary?: ArtistSummary;
  albumName?: string;
  albumArtist?: string;
  genreName?: string;
  tempoLabel?: string;
  yearLabel?: string;
  moodId?: string;
  searchQuery?: string;
}

export interface OnlineMetadataResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  genre?: string | null;
  year?: number | null;
  coverUrl?: string | null;
  coverBase64?: string | null;
  cover_base64?: string | null;
  previewUrl?: string | null;
  preview_url?: string | null;
  source: string;
}

export interface ArtistOnlineResult {
  artist: string;
  genre: string | null;
  coverBase64: string | null;
}

export interface DownloaderEnvStatus {
  uv_installed: boolean;
  venv_ready: boolean;
  spotdl_installed: boolean;
  yt_dlp_installed: boolean;
  ffmpeg_installed: boolean;
  env_path: string;
  details: string;
}

export interface DownloaderSettings {
  output_path: string;
  threads: number;
  cookies_browser: string;
  audio_sources: string[];
  extra_yt_dlp_args: string;
  extra_spotdl_args: string;
  auto_scan: boolean;
}

export interface DownloadOptions {
  url: string;
  output_dir?: string;
  threads?: number;
  audio_sources?: string[];
  cookies_from_browser?: string;
  extra_yt_dlp_args?: string;
  extra_spotdl_args?: string;
  auto_scan?: boolean;
}

export interface DownloaderLogPayload {
  line: string;
  is_error: boolean;
}

export interface DownloaderFinishedPayload {
  success: boolean;
  code: number | null;
  output_dir: string;
  message: string;
}
