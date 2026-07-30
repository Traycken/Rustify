use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: i32,
    pub track_no: i32,
    pub duration_secs: f64,
    pub has_cover: bool,
    pub cover_path: Option<String>,
    #[serde(default)]
    pub likes: i32,
    #[serde(default)]
    pub dislikes: i32,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(default)]
    pub is_ecstasy: bool,
    #[serde(default)]
    pub manual_select_count: i32,

    #[serde(default)]
    pub play_count: i32,
    #[serde(default)]
    pub skip_count: i32,
    #[serde(default)]
    pub total_listen_secs: f64,
    #[serde(default)]
    pub avg_listen_secs: f64,
    #[serde(default)]
    pub permanent_score: f64,
    #[serde(default)]
    pub temp_score: f64,
    #[serde(default)]
    pub effective_score: f64,

    // ---- Enrichissement externe (Deezer / MusicBrainz / LRCLIB) ----
    #[serde(default)]
    pub bpm: Option<f64>,
    #[serde(default)]
    pub bpm_is_official: bool,
    #[serde(default)]
    pub isrc: Option<String>,
    #[serde(default)]
    pub mbid: Option<String>,
    #[serde(default)]
    pub iswc: Option<String>,
    /// Sous-genres/tags MusicBrainz.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Crédits complets (compositeur, parolier, producteur...).
    #[serde(default)]
    pub credits: Vec<TrackCredit>,
    #[serde(default)]
    pub lyrics_plain: Option<String>,
    /// Paroles synchronisées au format .lrc (LRCLIB).
    #[serde(default)]
    pub lyrics_synced: Option<String>,
    #[serde(default)]
    pub is_instrumental: Option<bool>,
    #[serde(default)]
    pub deezer_id: Option<String>,
    /// Nombre de tentatives d'enrichissement avancé (Deezer/MusicBrainz/LRCLIB)
    /// ayant effectivement abouti à une réponse serveur (succès ou "rien
    /// trouvé"), en excluant les échecs de téléchargement purs (réseau/UA
    /// tous épuisés). Au-delà de 3, la piste est ignorée dans les prochains
    /// enrichissements en lot — voir db::increment_enrichment_attempts et
    /// main.ts::isEligibleForAdvancedEnrichment.
    #[serde(default)]
    pub enrichment_attempts: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackCredit {
    pub role: String,
    pub name: String,
}

/// Enrichissement d'un morceau à appliquer (tous les champs sont optionnels :
/// seuls ceux fournis écrasent la valeur existante en base, voir
/// `db::update_track_enrichment`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackEnrichment {
    pub track_id: String,
    pub bpm: Option<f64>,
    pub isrc: Option<String>,
    pub mbid: Option<String>,
    pub iswc: Option<String>,
    pub tags: Option<Vec<String>>,
    pub credits: Option<Vec<TrackCredit>>,
    pub lyrics_plain: Option<String>,
    pub lyrics_synced: Option<String>,
    pub is_instrumental: Option<bool>,
    pub deezer_id: Option<String>,
}

/// Enrichissement d'un artiste/groupe (statut d'activité, identifiants
/// externes...) — voir `db::update_artist_enrichment`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistEnrichment {
    pub artist: String,
    pub mbid: Option<String>,
    pub deezer_id: Option<String>,
    pub fan_count: Option<i64>,
    /// Date de formation (groupe) ou de naissance (solo), format MusicBrainz (YYYY[-MM[-DD]]).
    pub life_span_begin: Option<String>,
    /// Date de dissolution (groupe) ou de décès (solo).
    pub life_span_end: Option<String>,
    /// true si le groupe est dissous / l'artiste décédé.
    pub is_ended: Option<bool>,
    /// Cause du décès (Wikidata P509), le cas échéant.
    pub death_cause: Option<String>,
    pub wikidata_qid: Option<String>,
    /// Identifiants de profils externes (discogs, spotify, imdb...).
    pub external_ids: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumSummary {
    pub album: String,
    pub album_artist: String,
    pub year: i32,
    pub track_count: i32,
    pub cover_path: Option<String>,
    #[serde(default)]
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistSummary {
    pub artist: String,
    pub track_count: i32,
    pub image_path: Option<String>,
    pub bio: Option<String>,
    pub members: Option<String>,
    pub is_group: Option<bool>,
    #[serde(default)]
    pub is_favorite: bool,
    // ---- Enrichissement externe (Deezer / MusicBrainz / Wikidata) ----
    #[serde(default)]
    pub mbid: Option<String>,
    #[serde(default)]
    pub deezer_id: Option<String>,
    #[serde(default)]
    pub fan_count: Option<i64>,
    #[serde(default)]
    pub life_span_begin: Option<String>,
    #[serde(default)]
    pub life_span_end: Option<String>,
    #[serde(default)]
    pub is_ended: Option<bool>,
    #[serde(default)]
    pub death_cause: Option<String>,
    #[serde(default)]
    pub wikidata_qid: Option<String>,
    #[serde(default)]
    pub external_ids: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_count: i32,
    #[serde(default)]
    pub is_system: Option<bool>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: i64,
    pub track: Track,
    pub played_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoritesData {
    pub tracks: Vec<Track>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlayerState {
    pub current_track: Option<Track>,
    pub is_playing: bool,
    pub position_secs: f64,
    pub volume: f32,
    pub queue: Vec<Track>,
    pub queue_index: i64,
    pub repeat: bool,
    pub shuffle: bool,
    #[serde(default)]
    pub smart_shuffle_active: bool,
    pub audio_device: Option<String>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub scanned_files: i32,
    pub imported_tracks: i32,
    pub skipped: i32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackMetadataUpdate {
    pub track_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub cover_base64: Option<String>,
    pub likes: Option<i32>,
    pub dislikes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastPlayerState {
    pub volume: f64,
    pub audio_device: Option<String>,
    pub track_id: Option<String>,
    pub position_secs: f64,
    pub queue_index: usize,
    pub track: Option<Track>,
}

/// Profil d'égaliseur graphique 10 bandes, éventuellement lié à un
/// périphérique de sortie audio (auto-appliqué quand ce périphérique est
/// sélectionné).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqProfile {
    pub id: String,
    pub name: String,
    /// Préampli général en dB (compense les boosts de bandes pour éviter l'écrêtage).
    pub preamp: f64,
    /// Gains en dB pour chacune des 10 bandes (voir player::EQ_BAND_FREQS_HZ).
    pub gains: Vec<f64>,
    /// Nom exact du périphérique de sortie auquel ce profil est lié (None = non lié).
    pub device_name: Option<String>,
}

/// État complet de l'égaliseur renvoyé au frontend : activation globale,
/// profil actif, et liste de tous les profils disponibles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqState {
    pub enabled: bool,
    pub active_profile_id: String,
    pub profiles: Vec<EqProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Radio {
    pub id: String,
    pub name: String,
    pub genre: String,
    pub country: String,
    pub stream_url: String,
    pub image_path: Option<String>,
    pub is_video: bool,
    pub is_online: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioInput {
    pub id: Option<String>,
    pub name: String,
    pub genre: String,
    pub country: String,
    pub stream_url: String,
    pub image_base64: Option<String>,
    pub is_video: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelLiveStreamItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RadioOnlineMetadataResult {
    pub name: Option<String>,
    pub genre: Option<String>,
    pub country: Option<String>,
    pub cover_url: Option<String>,
    pub is_video: bool,
}

