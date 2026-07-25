use crate::models::{AlbumSummary, ArtistSummary, PlayerState, Playlist, ScanReport, Track};
use crate::player::PlayerCommand;
use crate::state::AppState;
use crate::{db, scanner};
use tauri::{Manager, State};
use uuid::Uuid;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn send(state: &State<AppState>, cmd: PlayerCommand) -> Result<(), String> {
    state.player_tx.send(cmd).map_err(map_err)
}

#[tauri::command]
pub fn scan_library(state: State<AppState>, path: String) -> Result<ScanReport, String> {
    let conn = state.db.lock().map_err(map_err)?;
    scanner::scan_directory(&conn, &path).map_err(map_err)
}

#[tauri::command]
pub fn get_tracks(state: State<AppState>) -> Result<Vec<Track>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_tracks(&conn).map_err(map_err)
}

#[tauri::command]
pub fn get_albums(state: State<AppState>) -> Result<Vec<AlbumSummary>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_albums(&conn).map_err(map_err)
}

#[tauri::command]
pub fn get_artists(state: State<AppState>) -> Result<Vec<ArtistSummary>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_artists(&conn).map_err(map_err)
}

#[tauri::command]
pub fn play_track(
    state: State<AppState>,
    queue: Vec<Track>,
    start_index: usize,
    is_manual: Option<bool>,
) -> Result<(), String> {
    send(&state, PlayerCommand::Play(queue, start_index, is_manual.unwrap_or(true)))
}

#[tauri::command]
pub fn pause(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::Pause)
}

#[tauri::command]
pub fn resume(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::Resume)
}

#[tauri::command]
pub fn stop(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::Stop)
}

#[tauri::command]
pub fn seek(state: State<AppState>, position_secs: f64) -> Result<(), String> {
    send(&state, PlayerCommand::Seek(position_secs))
}

#[tauri::command]
pub fn set_volume(state: State<AppState>, volume: f32) -> Result<(), String> {
    send(&state, PlayerCommand::SetVolume(volume))
}

#[tauri::command]
pub fn next_track(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::Next)
}

#[tauri::command]
pub fn prev_track(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::Prev)
}

#[tauri::command]
pub fn toggle_repeat(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::ToggleRepeat)
}

#[tauri::command]
pub fn toggle_shuffle(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::ToggleShuffle)
}

#[tauri::command]
pub fn get_player_state(state: State<AppState>) -> Result<PlayerState, String> {
    let mut status = state.player_status.lock().map_err(map_err)?.clone();
    if let Some(ref mut track) = status.current_track {
        if let Ok(conn) = state.db.lock() {
            if let Ok((likes, dislikes, is_fav)) = db::get_track_live_stats(&conn, &track.id) {
                track.likes = likes;
                track.dislikes = dislikes;
                track.is_favorite = is_fav;
            }
        }
    }
    Ok(status)
}

#[tauri::command]
pub fn create_playlist(state: State<AppState>, name: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let id = Uuid::new_v4().to_string();
    db::create_playlist(&conn, &id, &name).map_err(map_err)?;
    Ok(id)
}

#[tauri::command]
pub fn add_to_playlist(state: State<AppState>, playlist_id: String, track_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::add_to_playlist(&conn, &playlist_id, &track_id).map_err(map_err)
}

#[tauri::command]
pub fn get_playlists(state: State<AppState>) -> Result<Vec<Playlist>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_playlists(&conn).map_err(map_err)
}

#[tauri::command]
pub fn get_playlist_tracks(state: State<AppState>, playlist_id: String) -> Result<Vec<Track>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_playlist_tracks(&conn, &playlist_id).map_err(map_err)
}

#[tauri::command]
pub fn read_cover(path: String) -> Result<String, String> {
    let covers_dir = db::covers_dir().canonicalize().map_err(map_err)?;
    let target_path = std::path::PathBuf::from(&path).canonicalize().map_err(map_err)?;

    if !target_path.starts_with(&covers_dir) {
        return Err("Accès non autorisé : fichier hors du dossier de cache".into());
    }

    let bytes = std::fs::read(&target_path).map_err(map_err)?;
    let ext = target_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let mime = match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn save_online_metadata(
    state: State<AppState>,
    track_id: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: i32,
    cover_base64: Option<String>,
    likes: Option<i32>,
    dislikes: Option<i32>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    let mut cover_path = None;

    if let Some(b64_data) = cover_base64 {
        let raw_b64 = if let Some(idx) = b64_data.find(',') {
            &b64_data[idx + 1..]
        } else {
            &b64_data
        };

        use base64::Engine;
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw_b64) {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            bytes.hash(&mut hasher);
            let hash_val = hasher.finish();

            let ext = if b64_data.contains("image/png") { "png" } else { "jpg" };
            let filename = format!("{:x}.{}", hash_val, ext);
            let dest_path = db::covers_dir().join(&filename);
            if std::fs::write(&dest_path, &bytes).is_ok() {
                cover_path = Some(dest_path.to_string_lossy().to_string());
            }
        }
    }

    db::update_track_metadata(
        &conn,
        &track_id,
        &title,
        &artist,
        &album,
        &genre,
        year,
        cover_path.as_deref(),
        likes,
        dislikes,
    )
    .map_err(map_err)
}

#[tauri::command]
pub fn batch_update_metadata(
    state: State<AppState>,
    updates: Vec<crate::models::TrackMetadataUpdate>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(map_err)?;
    db::batch_update_metadata(&mut conn, &updates).map_err(map_err)
}

#[tauri::command]
pub fn update_album_metadata(
    state: State<AppState>,
    old_album: String,
    old_artist: String,
    new_album: String,
    new_artist: String,
    year: i32,
    genre: String,
    cover_base64: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(map_err)?;
    db::update_album_metadata(
        &mut conn,
        &old_album,
        &old_artist,
        &new_album,
        &new_artist,
        year,
        &genre,
        cover_base64.as_deref(),
    )
    .map_err(map_err)
}

#[tauri::command]
pub fn save_artist_metadata(
    state: State<AppState>,
    artist: String,
    genre: Option<String>,
    bio: Option<String>,
    members: Option<String>,
    image_base64: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::save_artist_metadata(
        &conn,
        &artist,
        genre.as_deref(),
        bio.as_deref(),
        members.as_deref(),
        image_base64.as_deref(),
    )
    .map_err(map_err)
}

#[tauri::command]
pub fn rename_genre(state: State<AppState>, old_genre: String, new_genre: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::rename_genre(&conn, &old_genre, &new_genre).map_err(map_err)
}

#[tauri::command]
pub fn rename_playlist(state: State<AppState>, playlist_id: String, new_name: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::rename_playlist(&conn, &playlist_id, &new_name).map_err(map_err)
}

#[tauri::command]
pub fn delete_playlist(state: State<AppState>, playlist_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::delete_playlist(&conn, &playlist_id).map_err(map_err)
}

#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<String>, String> {
    Ok(crate::player::get_output_devices())
}

#[tauri::command]
pub fn set_audio_device(state: State<AppState>, device_name: String) -> Result<(), String> {
    send(&state, PlayerCommand::SetAudioDevice(device_name))
}

#[tauri::command]
pub fn set_artist_is_group(state: State<AppState>, artist: String, is_group: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::set_artist_is_group(&conn, &artist, is_group).map_err(map_err)
}

#[tauri::command]
pub fn get_app_settings(app: tauri::AppHandle, state: State<AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let mut map = db::get_all_settings(&conn).map_err(map_err)?;

    use tauri_plugin_autostart::ManagerExt;
    map.entry("autostart".into()).or_insert_with(|| {
        let is_en = app.autolaunch().is_enabled().unwrap_or(false);
        if is_en { "true".into() } else { "false".into() }
    });
    map.entry("minimize_to_tray".into()).or_insert_with(|| "true".into());
    map.entry("global_shortcuts_enabled".into()).or_insert_with(|| "true".into());
    map.entry("shortcut_play_pause".into()).or_insert_with(|| "MediaPlayPause".into());
    map.entry("shortcut_next".into()).or_insert_with(|| "MediaTrackNext".into());
    map.entry("shortcut_prev".into()).or_insert_with(|| "MediaTrackPrevious".into());
    map.entry("shortcut_stop".into()).or_insert_with(|| "MediaStop".into());

    Ok(map)
}

#[tauri::command]
pub fn save_app_setting(app: tauri::AppHandle, state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::set_setting(&conn, &key, &value).map_err(map_err)?;

    if key == "autostart" {
        use tauri_plugin_autostart::ManagerExt;
        let autostart_manager = app.autolaunch();
        if value == "true" {
            let _ = autostart_manager.enable();
        } else {
            let _ = autostart_manager.disable();
        }
    } else if key.starts_with("global_shortcut") || key.starts_with("shortcut_") {
        crate::update_shortcut_registrations(&app);
    }

    Ok(())
}

#[tauri::command]
pub fn set_autostart_setting(app: tauri::AppHandle, state: State<AppState>, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart_manager = app.autolaunch();
    if enabled {
        let _ = autostart_manager.enable();
    } else {
        let _ = autostart_manager.disable();
    }
    let conn = state.db.lock().map_err(map_err)?;
    db::set_setting(&conn, "autostart", if enabled { "true" } else { "false" }).map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn like_track(state: State<AppState>, track_id: String) -> Result<(i32, i32), String> {
    let conn = state.db.lock().map_err(map_err)?;
    let res = db::increment_like(&conn, &track_id).map_err(map_err)?;
    if let Ok(mut status) = state.player_status.lock() {
        if let Some(ref mut t) = status.current_track {
            if t.id == track_id || t.path == track_id {
                t.likes = res.0;
                t.dislikes = res.1;
            }
        }
    }
    Ok(res)
}

#[tauri::command]
pub fn dislike_track(state: State<AppState>, track_id: String) -> Result<(i32, i32), String> {
    let conn = state.db.lock().map_err(map_err)?;
    let res = db::increment_dislike(&conn, &track_id).map_err(map_err)?;
    if let Ok(mut status) = state.player_status.lock() {
        if let Some(ref mut t) = status.current_track {
            if t.id == track_id || t.path == track_id {
                t.likes = res.0;
                t.dislikes = res.1;
            }
        }
    }
    Ok(res)
}

#[tauri::command]
pub fn update_track_likes_dislikes(state: State<AppState>, track_id: String, likes: i32, dislikes: i32) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::update_likes_dislikes(&conn, &track_id, likes, dislikes).map_err(map_err)?;
    if let Ok(mut status) = state.player_status.lock() {
        if let Some(ref mut t) = status.current_track {
            if t.id == track_id || t.path == track_id {
                t.likes = likes;
                t.dislikes = dislikes;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_favorite(state: State<AppState>, target_type: String, target_id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let res = db::toggle_favorite(&conn, &target_type, &target_id).map_err(map_err)?;
    if target_type == "track" {
        if let Ok(mut status) = state.player_status.lock() {
            if let Some(ref mut t) = status.current_track {
                if t.id == target_id || t.path == target_id {
                    t.is_favorite = res;
                }
            }
        }
    }
    Ok(res)
}

#[tauri::command]
pub fn get_favorites(state: State<AppState>) -> Result<crate::models::FavoritesData, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_favorites_data(&conn).map_err(map_err)
}

#[tauri::command]
pub fn get_play_history(state: State<AppState>, limit: Option<i64>) -> Result<Vec<crate::models::HistoryItem>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_play_history(&conn, limit.unwrap_or(100)).map_err(map_err)
}

#[tauri::command]
pub fn clear_play_history(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::clear_play_history(&conn).map_err(map_err)
}

#[tauri::command]
pub fn get_track_live_stats(state: State<AppState>, track_id: String) -> Result<(i32, i32, bool), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_track_live_stats(&conn, &track_id).map_err(map_err)
}

#[tauri::command]
pub fn save_last_player_state(
    state: State<AppState>,
    volume: f64,
    audio_device: Option<String>,
    track_id: Option<String>,
    position_secs: f64,
    queue_index: Option<usize>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::save_last_player_state(
        &conn,
        volume,
        audio_device.as_deref(),
        track_id.as_deref(),
        position_secs,
        queue_index.unwrap_or(0),
    ).map_err(map_err)
}

#[tauri::command]
pub fn get_last_player_state(state: State<AppState>) -> Result<crate::models::LastPlayerState, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_last_player_state(&conn).map_err(map_err)
}

#[tauri::command]
pub fn restore_player_track(
    state: State<AppState>,
    queue: Vec<Track>,
    index: usize,
    position_secs: f64,
) -> Result<(), String> {
    send(&state, PlayerCommand::RestoreTrack(queue, index, position_secs))
}

#[tauri::command]
pub fn enable_overlay_mode(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
        let _ = win.set_decorations(false);
        let _ = win.set_shadow(false);
        let _ = win.set_resizable(false);
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 210.0, height: 210.0 }));
    }
    Ok(())
}

#[tauri::command]
pub fn disable_overlay_mode(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
        let _ = win.set_decorations(true);
        let _ = win.set_shadow(true);
        let _ = win.set_resizable(true);
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1200.0, height: 780.0 }));
    }
    Ok(())
}

#[tauri::command]
pub fn set_overlay_click_through(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_ignore_cursor_events(ignore);
    }
    Ok(())
}
