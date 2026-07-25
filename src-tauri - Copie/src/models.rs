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
    pub manual_select_count: i32,
    #[serde(default)]
    pub play_count: i32,
    #[serde(default)]
    pub skip_count: i32,
    #[serde(default)]
    pub total_listen_secs: f64,
    #[serde(default)]
    pub avg_listen_secs: f64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_count: i32,
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
