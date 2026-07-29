use crate::models::{
    AlbumSummary, ArtistSummary, PlayerState, Playlist, Radio, RadioInput, ScanReport, Track,
};
use crate::player::PlayerCommand;
use crate::state::AppState;
use crate::{db, scanner};
use tauri::{Manager, State};
use uuid::Uuid;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    let msg = e.to_string();
    crate::debug_log::push_log("backend", msg.clone());
    msg
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
pub fn toggle_smart_shuffle(state: State<AppState>) -> Result<bool, String> {
    let mut status = state.player_status.lock().map_err(map_err)?;
    status.smart_shuffle_active = !status.smart_shuffle_active;
    let new_val = status.smart_shuffle_active;
    let _ = send(&state, PlayerCommand::ToggleSmartShuffle);
    Ok(new_val)
}


/// Réduit la file interne du lecteur à la seule piste en cours (voir
/// player::PlayerCommand::TrimQueueToCurrent). Utilisé par le Smart Shuffle
/// pour garantir que l'algorithme reprend toujours la main en fin de piste.
#[tauri::command]
pub fn trim_queue_to_current(state: State<AppState>) -> Result<(), String> {
    send(&state, PlayerCommand::TrimQueueToCurrent)
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
    let target_path = std::path::PathBuf::from(&path);
    if !target_path.exists() {
        return Err("Fichier image introuvable".into());
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
        "svg" => "image/svg+xml",
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
    send(&state, PlayerCommand::SetAudioDevice(device_name.clone()))?;

    // Si un profil d'Ã©galiseur est liÃ© Ã  ce pÃ©riphÃ©rique, on l'active
    // automatiquement (sinon on laisse le profil actif tel quel).
    let bound_profile_id = {
        let conn = state.db.lock().map_err(map_err)?;
        db::get_eq_profile_for_device(&conn, &device_name)
            .map_err(map_err)?
            .map(|p| p.id)
    };
    if let Some(profile_id) = bound_profile_id {
        let conn = state.db.lock().map_err(map_err)?;
        db::set_setting(&conn, "eq_active_profile_id", &profile_id).map_err(map_err)?;
    }
    apply_active_eq(&state)
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
    {
        let conn = state.db.lock().map_err(map_err)?;
        db::set_setting(&conn, &key, &value).map_err(map_err)?;
    }

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
pub fn toggle_ecstasy(state: State<AppState>, track_id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let res = db::toggle_ecstasy(&conn, &track_id).map_err(map_err)?;
    if let Ok(mut status) = state.player_status.lock() {
        if let Some(ref mut t) = status.current_track {
            if t.id == track_id || t.path == track_id {
                t.is_ecstasy = res;
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

/// Affiche le mini-lecteur Overlay (fenÃªtre indÃ©pendante, prÃ©-crÃ©Ã©e masquÃ©e
/// au dÃ©marrage â€” voir main.rs::setup) sans jamais masquer ni redimensionner
/// la fenÃªtre principale.
#[tauri::command]
pub fn open_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.show();
        let _ = win.set_focus();
        Ok(())
    } else {
        Err("FenÃªtre Overlay introuvable".into())
    }
}

#[tauri::command]
pub fn close_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn set_overlay_click_through(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

// ============================================================================
// Ã‰galiseur graphique â€” profils + liaison Ã  un pÃ©riphÃ©rique de sortie
// ============================================================================

/// Envoie au thread audio l'Ã©tat d'Ã©galiseur actuellement persistÃ©
/// (activation + profil actif). UtilisÃ© aprÃ¨s toute modification qui doit
/// se rÃ©percuter immÃ©diatement sur la lecture en cours.
fn apply_active_eq(state: &State<AppState>) -> Result<(), String> {
    let (enabled, profile) = {
        let conn = state.db.lock().map_err(map_err)?;
        let enabled = db::get_setting(&conn, "eq_enabled", "true") == "true";
        let active_id = db::get_setting(&conn, "eq_active_profile_id", "default");
        let profile = db::get_eq_profile(&conn, &active_id).map_err(map_err)?;
        (enabled, profile)
    };
    send(
        state,
        PlayerCommand::ApplyEq {
            enabled,
            preamp_db: profile.preamp,
            gains: profile.gains,
        },
    )
}

#[tauri::command]
pub fn get_eq_state(state: State<AppState>) -> Result<crate::models::EqState, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let enabled = db::get_setting(&conn, "eq_enabled", "true") == "true";
    let active_profile_id = db::get_setting(&conn, "eq_active_profile_id", "default");
    let profiles = db::get_eq_profiles(&conn).map_err(map_err)?;
    Ok(crate::models::EqState {
        enabled,
        active_profile_id,
        profiles,
    })
}

#[tauri::command]
pub fn set_eq_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(map_err)?;
        db::set_setting(&conn, "eq_enabled", if enabled { "true" } else { "false" }).map_err(map_err)?;
    }
    apply_active_eq(&state)
}

#[tauri::command]
pub fn create_eq_profile(state: State<AppState>, name: String) -> Result<crate::models::EqProfile, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let id = Uuid::new_v4().to_string();
    let trimmed = name.trim();
    let final_name = if trimmed.is_empty() { "Nouveau profil" } else { trimmed };
    db::create_eq_profile(&conn, &id, final_name).map_err(map_err)?;
    db::get_eq_profile(&conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn update_eq_profile(
    state: State<AppState>,
    id: String,
    name: String,
    preamp: f64,
    gains: Vec<f64>,
) -> Result<(), String> {
    let is_active = {
        let conn = state.db.lock().map_err(map_err)?;
        db::update_eq_profile(&conn, &id, &name, preamp, &gains).map_err(map_err)?;
        db::get_setting(&conn, "eq_active_profile_id", "default") == id
    };
    if is_active {
        apply_active_eq(&state)?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_eq_profile(state: State<AppState>, id: String) -> Result<(), String> {
    if id == "default" {
        return Err("Le profil Â« Plat Â» par dÃ©faut ne peut pas Ãªtre supprimÃ©".into());
    }
    let was_active = {
        let conn = state.db.lock().map_err(map_err)?;
        let was_active = db::get_setting(&conn, "eq_active_profile_id", "default") == id;
        db::delete_eq_profile(&conn, &id).map_err(map_err)?;
        if was_active {
            db::set_setting(&conn, "eq_active_profile_id", "default").map_err(map_err)?;
        }
        was_active
    };
    if was_active {
        apply_active_eq(&state)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_eq_profile_device(
    state: State<AppState>,
    profile_id: String,
    device_name: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::set_eq_profile_device(&conn, &profile_id, device_name.as_deref()).map_err(map_err)
}

#[tauri::command]
pub fn set_active_eq_profile(state: State<AppState>, profile_id: String) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(map_err)?;
        db::set_setting(&conn, "eq_active_profile_id", &profile_id).map_err(map_err)?;
    }
    apply_active_eq(&state)
}

// ============================================================================
// Enrichissement externe : Deezer / MusicBrainz / LRCLIB / Wikidata
// ============================================================================

#[tauri::command]
pub fn update_track_enrichment(state: State<AppState>, enrichment: crate::models::TrackEnrichment) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::update_track_enrichment(&conn, &enrichment).map_err(map_err)
}

#[tauri::command]
pub fn batch_update_track_enrichment(
    state: State<AppState>,
    items: Vec<crate::models::TrackEnrichment>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(map_err)?;
    db::batch_update_track_enrichment(&mut conn, &items).map_err(map_err)
}

#[tauri::command]
pub fn update_artist_enrichment(
    state: State<AppState>,
    enrichment: crate::models::ArtistEnrichment,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::update_artist_enrichment(&conn, &enrichment).map_err(map_err)
}

// ============================================================================
// Commandes HTTP externes â€” toutes les requÃªtes API sont effectuÃ©es ici en
// Rust (User-Agent MusicBrainz, rate-limit, batch) plutÃ´t que depuis JS.
// ============================================================================

/// TÃ©lÃ©charge une image depuis une URL et la renvoie en base64 (data:image/â€¦).
#[tauri::command]
pub async fn fetch_image_as_base64(url: String) -> Result<Option<String>, String> {
    Ok(crate::api::fetch_image_as_base64_internal(&url).await)
}

/// Recherche les mÃ©tadonnÃ©es d'un morceau en ligne (Deezer, repli MusicBrainz puis iTunes).
#[tauri::command]
pub async fn fetch_online_track_metadata(
    artist: String,
    title: String,
) -> Result<Option<crate::api::OnlineTrackMetadata>, String> {
    Ok(crate::api::fetch_online_track_metadata(&artist, &title).await)
}

/// Recherche la photo (Deezer en priorité) et le genre (repli iTunes) d'un artiste.
#[tauri::command]
pub async fn fetch_artist_online_metadata(
    artist_name: String,
) -> Result<crate::api::ArtistOnlineResult, String> {
    Ok(crate::api::fetch_artist_online_metadata(&artist_name).await)
}

/// RÃ©cupÃ¨re la photo web d'un artiste (Deezer en priorité, repli iTunes â†’ base64).
#[tauri::command]
pub async fn fetch_artist_web_photo(
    artist_name: String,
) -> Result<Option<String>, String> {
    Ok(crate::api::fetch_artist_photo(&artist_name).await)
}

/// RÃ©cupÃ¨re la bio Wikipedia + membres (via MusicBrainz) d'un groupe/artiste.
#[tauri::command]
pub async fn fetch_band_members_and_bio(
    artist_name: String,
) -> Result<crate::api::BandDetailsResult, String> {
    let bio = crate::api::fetch_wikipedia_bio(&artist_name).await;
    let mb = crate::api::fetch_mb_artist(&artist_name).await;

    // Pour chaque membre : essayer de rÃ©cupÃ©rer une photo (Deezer en priorité, repli iTunes)
    let mut members: Vec<crate::api::BandMember> = vec![];
    for mut m in mb.members.into_iter().take(12) {
        m.photo_url = crate::api::fetch_artist_photo(&m.name).await;
        members.push(m);
    }

    Ok(crate::api::BandDetailsResult { bio, members })
}

/// Enrichissement complet d'un morceau : Deezer + MusicBrainz + LRCLIB.
/// Sauvegarde le rÃ©sultat en base et renvoie l'enrichissement appliquÃ©.
#[tauri::command]
pub async fn enrich_track_advanced(
    state: State<'_, AppState>,
    input: crate::api::TrackEnrichmentInput,
) -> Result<crate::api::TrackEnrichmentResult, String> {
    let result = crate::api::enrich_track(&input).await;

    // Convertir et persister en base
    {
        let conn = state.db.lock().map_err(map_err)?;
        let enrichment = crate::models::TrackEnrichment {
            track_id: result.track_id.clone(),
            bpm: result.bpm,
            isrc: result.isrc.clone(),
            mbid: result.mbid.clone(),
            iswc: result.iswc.clone(),
            tags: result.tags.clone(),
            credits: result.credits.as_ref().map(|credits| {
                credits
                    .iter()
                    .map(|c| crate::models::TrackCredit {
                        role: c.role.clone(),
                        name: c.name.clone(),
                    })
                    .collect()
            }),
            lyrics_plain: result.lyrics_plain.clone(),
            lyrics_synced: result.lyrics_synced.clone(),
            is_instrumental: result.is_instrumental,
            deezer_id: result.deezer_id.clone(),
        };
        db::update_track_enrichment(&conn, &enrichment).map_err(map_err)?;
    }

    Ok(result)
}

/// Payload de progression envoyÃ© comme Ã©vÃ©nement Tauri au frontend.
#[derive(Clone, serde::Serialize)]
struct EnrichmentProgress {
    done: usize,
    total: usize,
    current_title: String,
}

/// Enrichissement batch de morceaux : Deezer + MB + LRCLIB pour chaque piste.
/// Ã‰met des Ã©vÃ©nements `enrichment_progress` pour la barre de progression JS.
/// Retourne la liste des enrichissements effectuÃ©s.
/// Enregistre les stats UA (succÃ¨s/blocage) en base aprÃ¨s chaque requÃªte.
#[tauri::command]
pub async fn batch_enrich_tracks(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tracks: Vec<crate::api::TrackEnrichmentInput>,
) -> Result<Vec<crate::api::TrackEnrichmentResult>, String> {
    use crate::ua_pool::{ranked_uas, ApiDomain};
    use tauri::Emitter;
    let total = tracks.len();
    let mut results: Vec<crate::api::TrackEnrichmentResult> = Vec::with_capacity(total);

    for (i, input) in tracks.iter().enumerate() {
        let _ = app.emit(
            "enrichment_progress",
            EnrichmentProgress { done: i, total, current_title: input.title.clone() },
        );

        // Garde-fou : une piste déjà tentée plus de 3 fois (tentatives
        // ayant réellement obtenu une réponse serveur, voir plus bas) est
        // ignorée, même si le frontend a par erreur renvoyé une liste non
        // filtrée. Ne consomme aucun appel API pour cette piste.
        let attempts_before: i32 = {
            let conn = state.db.lock().map_err(map_err)?;
            db::get_enrichment_attempts(&conn, &input.track_id).unwrap_or(0)
        };
        if attempts_before > 3 {
            continue;
        }

        // â”€â”€ 1. SÃ©lectionner les meilleurs UA par API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let (uas_deezer, uas_mb, uas_lrc) = {
            let conn = state.db.lock().map_err(map_err)?;
            let total_deezer: i64 = {
                let stats = db::load_ua_stats_for_api(&conn, ApiDomain::Deezer.as_str());
                stats.iter().map(|(_, s, f, b, _)| s + f + b).sum()
            };
            let total_mb: i64 = {
                let stats = db::load_ua_stats_for_api(&conn, ApiDomain::MusicBrainz.as_str());
                stats.iter().map(|(_, s, f, b, _)| s + f + b).sum()
            };
            let total_lrc: i64 = {
                let stats = db::load_ua_stats_for_api(&conn, ApiDomain::Lrclib.as_str());
                stats.iter().map(|(_, s, f, b, _)| s + f + b).sum()
            };

            let uas_d = ranked_uas(
                &ApiDomain::Deezer,
                &db::load_ua_stats_for_api(&conn, ApiDomain::Deezer.as_str()),
                total_deezer,
            );
            let uas_m = ranked_uas(
                &ApiDomain::MusicBrainz,
                &db::load_ua_stats_for_api(&conn, ApiDomain::MusicBrainz.as_str()),
                total_mb,
            );
            let uas_l = ranked_uas(
                &ApiDomain::Lrclib,
                &db::load_ua_stats_for_api(&conn, ApiDomain::Lrclib.as_str()),
                total_lrc,
            );
            (uas_d, uas_m, uas_l)
        };

        // â”€â”€ 2. Appels API avec rotation UA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let deezer = crate::api::fetch_deezer_track_ua(&input.artist, &input.title, &uas_deezer).await;
        let isrc = deezer.result.isrc.as_deref().or(input.isrc.as_deref());
        let mb = crate::api::fetch_mb_track_ua(&input.artist, &input.title, isrc, &uas_mb).await;
        let (lrc, lrc_ua, lrc_outcome) = crate::api::fetch_lrc_lyrics_ua(
            &input.artist,
            &input.title,
            &input.album,
            input.duration_secs,
            &uas_lrc,
        ).await;

        // â”€â”€ 3. Enregistrer les stats UA en base â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
            let conn = state.db.lock().map_err(map_err)?;
            let _ = db::record_ua_result(&conn, &deezer.effective_ua, ApiDomain::Deezer.as_str(), &deezer.outcome);
            let _ = db::record_ua_result(&conn, &mb.effective_ua, ApiDomain::MusicBrainz.as_str(), &mb.outcome);
            let _ = db::record_ua_result(&conn, &lrc_ua, ApiDomain::Lrclib.as_str(), &lrc_outcome);
        }

        // â”€â”€ 4. Construire le rÃ©sultat et persister â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let result = crate::api::TrackEnrichmentResult {
            track_id: input.track_id.clone(),
            bpm: deezer.result.bpm,
            isrc: deezer.result.isrc.clone(),
            mbid: mb.result.mbid.clone(),
            iswc: mb.result.iswc.clone(),
            tags: if mb.result.tags.is_empty() { None } else { Some(mb.result.tags.clone()) },
            credits: if mb.result.credits.is_empty() { None } else {
                Some(mb.result.credits.iter().map(|c| crate::api::TrackCredit {
                    role: c.role.clone(),
                    name: c.name.clone(),
                }).collect())
            },
            lyrics_plain: lrc.as_ref().and_then(|l| l.plain_lyrics.clone()),
            lyrics_synced: lrc.as_ref().and_then(|l| l.synced_lyrics.clone()),
            is_instrumental: lrc.as_ref().map(|l| l.is_instrumental),
            deezer_id: deezer.result.deezer_track_id.clone(),
            cover_base64: deezer.result.cover_base64.clone(),
        };

        {
            let conn = state.db.lock().map_err(map_err)?;
            let enrichment = crate::models::TrackEnrichment {
                track_id: result.track_id.clone(),
                bpm: result.bpm,
                isrc: result.isrc.clone(),
                mbid: result.mbid.clone(),
                iswc: result.iswc.clone(),
                tags: result.tags.clone(),
                credits: result.credits.as_ref().map(|credits| {
                    credits.iter().map(|c| crate::models::TrackCredit { role: c.role.clone(), name: c.name.clone() }).collect()
                }),
                lyrics_plain: result.lyrics_plain.clone(),
                lyrics_synced: result.lyrics_synced.clone(),
                is_instrumental: result.is_instrumental,
                deezer_id: result.deezer_id.clone(),
            };
            let _ = db::update_track_enrichment(&conn, &enrichment);
        }

        // Comptabilise la tentative seulement si au moins une des 3 API a
        // effectivement répondu (succès HTTP exploitable), qu'elle ait ou
        // non trouvé des données pour ce morceau. Un pur échec de
        // téléchargement (réseau, toutes les UA épuisées) sur les 3 API à
        // la fois NE compte PAS comme un essai, conformément à la demande.
        let attempt_reached_a_server =
            deezer.outcome == "success" || mb.outcome == "success" || lrc_outcome == "success";
        if attempt_reached_a_server {
            let conn = state.db.lock().map_err(map_err)?;
            let _ = db::increment_enrichment_attempts(&conn, &input.track_id);
        }

        results.push(result);
    }

    let _ = app.emit("enrichment_progress", EnrichmentProgress { done: total, total, current_title: String::new() });
    Ok(results)
}

/// Enrichissement complet d'un artiste : MusicBrainz + Wikidata + Deezer + Wikipedia.
/// Sauvegarde le rÃ©sultat en base.
#[tauri::command]
pub async fn enrich_artist_advanced(
    state: State<'_, AppState>,
    artist_name: String,
) -> Result<(), String> {
    let full = crate::api::enrich_artist(&artist_name).await;

    let enrichment = crate::models::ArtistEnrichment {
        artist: artist_name.clone(),
        mbid: full.mbid,
        deezer_id: full.deezer_id,
        fan_count: full.fan_count,
        life_span_begin: full.life_span_begin,
        life_span_end: full.life_span_end,
        is_ended: full.is_ended,
        death_cause: full.death_cause,
        wikidata_qid: full.wikidata_qid,
        external_ids: full.external_ids,
    };

    {
        let conn = state.db.lock().map_err(map_err)?;
        db::update_artist_enrichment(&conn, &enrichment).map_err(map_err)?;
    }

    // Fusionner les membres (dates + photos) dans le champ "members"
    if !full.members.is_empty() {
        let mut members_with_photos: Vec<crate::api::BandMember> = vec![];
        for mut m in full.members.into_iter().take(12) {
            m.photo_url = crate::api::fetch_artist_photo(&m.name).await;
            members_with_photos.push(m);
        }

        let members_json = serde_json::to_string(&members_with_photos).map_err(map_err)?;
        let conn = state.db.lock().map_err(map_err)?;
        db::save_artist_metadata(&conn, &artist_name, None, full.bio.as_deref(), Some(&members_json), None)
            .map_err(map_err)?;
    } else if full.bio.is_some() {
        let conn = state.db.lock().map_err(map_err)?;
        db::save_artist_metadata(&conn, &artist_name, None, full.bio.as_deref(), None, None)
            .map_err(map_err)?;
    }

    Ok(())
}

/// Enrichissement batch d'artistes (UA-aware).
/// Enregistre les stats UA pour MB, Deezer, Wikidata, Wikipedia.
#[tauri::command]
pub async fn batch_enrich_artists(
    state: State<'_, AppState>,
    artist_names: Vec<String>,
) -> Result<(), String> {
    use crate::ua_pool::{ranked_uas, ApiDomain};

    for artist_name in &artist_names {
        // â”€â”€ 1. SÃ©lectionner les meilleurs UA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let (uas_mb, uas_deezer, uas_wiki) = {
            let conn = state.db.lock().map_err(map_err)?;
            let stats_mb    = db::load_ua_stats_for_api(&conn, ApiDomain::MusicBrainz.as_str());
            let stats_deezer= db::load_ua_stats_for_api(&conn, ApiDomain::Deezer.as_str());
            let stats_wiki  = db::load_ua_stats_for_api(&conn, ApiDomain::Wikipedia.as_str());
            let total_mb: i64    = stats_mb.iter().map(|(_, s, f, b, _)| s + f + b).sum();
            let total_deezer: i64= stats_deezer.iter().map(|(_, s, f, b, _)| s + f + b).sum();
            let total_wiki: i64  = stats_wiki.iter().map(|(_, s, f, b, _)| s + f + b).sum();
            (
                ranked_uas(&ApiDomain::MusicBrainz, &stats_mb, total_mb),
                ranked_uas(&ApiDomain::Deezer, &stats_deezer, total_deezer),
                ranked_uas(&ApiDomain::Wikipedia, &stats_wiki, total_wiki),
            )
        };

        // â”€â”€ 2. Appels API avec rotation UA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let mb  = crate::api::fetch_mb_artist_ua(artist_name, &uas_mb).await;
        let (deezer_id, fan_count, deezer_ua, deezer_outcome) =
            crate::api::fetch_deezer_artist_ua(artist_name, &uas_deezer).await;

        // Wikipedia (simple GET avec rotation)
        let wiki_url = format!(
            "https://fr.wikipedia.org/api/rest_v1/page/summary/{}",
            urlencoding::encode(artist_name)
        );
        let wiki_res = crate::api::get_json_rotating(&wiki_url, &uas_wiki, None).await;
        let bio: Option<String> = if wiki_res.outcome == "success" {
            wiki_res.data["extract"].as_str().map(|s| s.to_string())
        } else {
            None
        };

        // Wikidata (si QID disponible)
        let death_cause: Option<String> = None;
        let mut life_span_end = mb.result.life_span_end.clone();
        let mut is_ended = mb.result.is_ended;
        let mut external_ids: Option<std::collections::HashMap<String, String>> = None;

        if let Some(qid) = &mb.result.wikidata_qid {
            let uas_wd = {
                let conn = state.db.lock().map_err(map_err)?;
                let stats = db::load_ua_stats_for_api(&conn, ApiDomain::Wikidata.as_str());
                let total: i64 = stats.iter().map(|(_, s, f, b, _)| s + f + b).sum();
                ranked_uas(&ApiDomain::Wikidata, &stats, total)
            };
            let wd_url = format!(
                "https://www.wikidata.org/w/api.php?action=wbgetentities&ids={}&format=json&props=claims&origin=*",
                urlencoding::encode(qid)
            );
            let wd_res = crate::api::get_json_rotating(&wd_url, &uas_wd, None).await;
            {
                let conn = state.db.lock().map_err(map_err)?;
                let _ = db::record_ua_result(&conn, &wd_res.effective_ua, ApiDomain::Wikidata.as_str(), &wd_res.outcome);
            }
            if wd_res.outcome == "success" {
                let claims = &wd_res.data["entities"][qid.as_str()]["claims"];
                let parse_date = |prop: &str| -> Option<String> {
                    let time = claims[prop][0]["mainsnak"]["datavalue"]["value"]["time"].as_str()?;
                    let stripped = time.trim_start_matches('+');
                    Some(stripped.split('T').next().unwrap_or(stripped).to_string())
                };
                if life_span_end.is_none() {
                    if let Some(dd) = parse_date("P570").or_else(|| parse_date("P576")) {
                        life_span_end = Some(dd);
                        is_ended = Some(true);
                    }
                }
                let get_str = |prop: &str| -> Option<String> {
                    claims[prop][0]["mainsnak"]["datavalue"]["value"]
                        .as_str().map(|s| s.to_string())
                };
                let mut ids = std::collections::HashMap::new();
                if let Some(v) = get_str("P1953") { ids.insert("discogs".to_string(), v); }
                if let Some(v) = get_str("P1902") { ids.insert("spotify".to_string(), v); }
                if let Some(v) = get_str("P345")  { ids.insert("imdb".to_string(), v); }
                if !ids.is_empty() { external_ids = Some(ids); }
            }
        }

        // â”€â”€ 3. Enregistrer les stats UA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
            let conn = state.db.lock().map_err(map_err)?;
            let _ = db::record_ua_result(&conn, &mb.effective_ua, ApiDomain::MusicBrainz.as_str(), &mb.outcome);
            let _ = db::record_ua_result(&conn, &deezer_ua, ApiDomain::Deezer.as_str(), &deezer_outcome);
            let _ = db::record_ua_result(&conn, &wiki_res.effective_ua, ApiDomain::Wikipedia.as_str(), &wiki_res.outcome);
        }

        // â”€â”€ 4. Persister l'enrichissement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let enrichment = crate::models::ArtistEnrichment {
            artist: artist_name.clone(),
            mbid: mb.result.mbid.clone(),
            deezer_id,
            fan_count,
            life_span_begin: mb.result.life_span_begin.clone(),
            life_span_end,
            is_ended,
            death_cause,
            wikidata_qid: mb.result.wikidata_qid.clone(),
            external_ids,
        };

        if let Ok(conn) = state.db.lock() {
            let _ = db::update_artist_enrichment(&conn, &enrichment);
        }

        // Membres + photos (Deezer en priorité, repli iTunes)
        if !mb.result.members.is_empty() {
            let mut members_with_photos: Vec<crate::api::BandMember> = vec![];
            for mut m in mb.result.members.into_iter().take(12) {
                m.photo_url = crate::api::fetch_artist_photo(&m.name).await;
                members_with_photos.push(m);
            }
            if let Ok(members_json) = serde_json::to_string(&members_with_photos) {
                if let Ok(conn) = state.db.lock() {
                    let _ = db::save_artist_metadata(&conn, artist_name, None, bio.as_deref(), Some(&members_json), None);
                }
            }
        } else if bio.is_some() {
            if let Ok(conn) = state.db.lock() {
                let _ = db::save_artist_metadata(&conn, artist_name, None, bio.as_deref(), None, None);
            }
        }
    }
    Ok(())
}


// ============================================================================
// Commande : statistiques User-Agent
// ============================================================================

/// Retourne toutes les statistiques UA (pour chaque API) au frontend.
/// Le frontend peut afficher un tableau de bord des UA les plus efficaces.
#[tauri::command]
pub fn get_ua_stats(
    state: State<AppState>,
) -> Result<Vec<db::UaStatRow>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    Ok(db::get_all_ua_stats(&conn))
}

// ============================================================================
// Commandes : Journal & Debug (erreurs backend)
// ============================================================================

/// Retourne le journal in-memory des erreurs backend (voir crate::debug_log).
/// Alimenté automatiquement par `map_err` (toute commande dont le Result est
/// converti en erreur String) ainsi que par certains points d'échec réseau
/// explicitement instrumentés (ex: api::get_json_rotating).
#[tauri::command]
pub fn get_debug_logs() -> Vec<crate::debug_log::LogEntry> {
    crate::debug_log::get_logs()
}

#[tauri::command]
pub fn clear_debug_logs() {
    crate::debug_log::clear_logs();
}

// ============================================================================
// Commande : Règle Skip 70%
// ============================================================================

/// Enregistre un événement d'écoute avant un skip manuel.
/// Le backend décide si c'est un play_count ou skip_count selon la règle 70%.
#[tauri::command]
pub fn register_listen_event(
    state: State<AppState>,
    track_id: String,
    position_secs: f64,
    duration_secs: f64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::register_listen_event(&conn, &track_id, position_secs, duration_secs).map_err(map_err)
}

// ============================================================================
// Commandes : Smart Shuffle
// ============================================================================

/// Retourne la session active ou en crée une nouvelle (TTL 24h).
#[tauri::command]
pub fn get_or_create_smart_session(
    state: State<AppState>,
) -> Result<db::SmartSession, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_or_create_smart_session(&conn).map_err(map_err)
}

/// Calcule et retourne la meilleure prochaine piste selon l'algorithme.
#[tauri::command]
pub fn get_next_smart_track(
    state: State<AppState>,
    exclude_ids: Vec<String>,
    queue_ids: Option<Vec<String>>,
) -> Result<crate::models::Track, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let session = db::get_or_create_smart_session(&conn).map_err(map_err)?;
    let q_ids = queue_ids.unwrap_or_default();
    db::get_next_smart_track(&conn, &session, &exclude_ids, &q_ids).map_err(map_err)
}

/// Met à jour la session après une fin de piste ("complete") ou un skip ("skip").
#[tauri::command]
pub fn update_smart_session(
    state: State<AppState>,
    track_id: String,
    event_type: String,
    track_genre: Option<String>,
    track_artist: Option<String>,
    track_bpm: Option<f64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    let session = db::get_or_create_smart_session(&conn).map_err(map_err)?;
    db::update_smart_session(
        &conn,
        session.id,
        &track_id,
        &event_type,
        track_genre.as_deref(),
        track_artist.as_deref(),
        track_bpm,
    )
    .map_err(map_err)
}

/// Enregistre un feedback algo (like/dislike) et retourne la prochaine piste recalculée.
#[tauri::command]
pub fn submit_algo_feedback(
    state: State<AppState>,
    track_id: String,
    liked: bool,
    queue_ids: Option<Vec<String>>,
) -> Result<crate::models::Track, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let session = db::get_or_create_smart_session(&conn).map_err(map_err)?;
    db::add_algo_feedback(&conn, session.id, &track_id, liked).map_err(map_err)?;
    // Recalculer la session (avec le nouveau feedback) et retourner la prochaine piste
    let updated_session = db::get_or_create_smart_session(&conn).map_err(map_err)?;
    // Exclure la piste courante du résultat
    let q_ids = queue_ids.unwrap_or_default();
    db::get_next_smart_track(&conn, &updated_session, &[track_id], &q_ids).map_err(map_err)
}

// ==========================================
// ---- Commandes du Téléchargeur spotDL ----
// ==========================================

use crate::downloader::{self, DownloadOptions, DownloaderEnvStatus};
use tauri::Emitter;

#[tauri::command]
pub fn check_downloader_env() -> DownloaderEnvStatus {
    downloader::check_env_status()
}

#[tauri::command]
pub async fn setup_downloader_env(app: tauri::AppHandle) -> Result<DownloaderEnvStatus, String> {
    let app_handle = app.clone();
    downloader::setup_env(move |msg, is_err| {
        let _ = app_handle.emit(
            "downloader-log",
            downloader::DownloaderLogPayload {
                line: msg,
                is_error: is_err,
            },
        );
    })
    .await
}

#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    opts: DownloadOptions,
) -> Result<(), String> {
    downloader::run_download(app, state, opts).await
}

#[tauri::command]
pub fn cancel_download(state: State<AppState>) -> Result<bool, String> {
    downloader::cancel_download(&state)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DownloaderSettings {
    pub output_path: String,
    pub threads: u32,
    pub cookies_browser: String,
    pub audio_sources: Vec<String>,
    pub extra_yt_dlp_args: String,
    pub extra_spotdl_args: String,
    pub auto_scan: bool,
}

#[tauri::command]
pub fn get_downloader_settings(state: State<AppState>) -> Result<DownloaderSettings, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let output_path = db::get_setting(&conn, "downloader_output_path", "");
    let threads_str = db::get_setting(&conn, "downloader_threads", "16");
    let threads = threads_str.parse::<u32>().unwrap_or(16);
    let cookies_browser = db::get_setting(&conn, "downloader_cookies_browser", "brave");
    let sources_str = db::get_setting(&conn, "downloader_audio_sources", "youtube,youtube-music,soundcloud");
    let audio_sources = sources_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let extra_yt_dlp_args = db::get_setting(&conn, "downloader_extra_yt_dlp_args", "");
    let extra_spotdl_args = db::get_setting(&conn, "downloader_extra_spotdl_args", "");
    let auto_scan = db::get_setting(&conn, "downloader_auto_scan", "true") == "true";

    Ok(DownloaderSettings {
        output_path,
        threads,
        cookies_browser,
        audio_sources,
        extra_yt_dlp_args,
        extra_spotdl_args,
        auto_scan,
    })
}

#[tauri::command]
pub fn save_downloader_settings(
    state: State<AppState>,
    settings: DownloaderSettings,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::set_setting(&conn, "downloader_output_path", &settings.output_path).map_err(map_err)?;
    db::set_setting(&conn, "downloader_threads", &settings.threads.to_string()).map_err(map_err)?;
    db::set_setting(&conn, "downloader_cookies_browser", &settings.cookies_browser).map_err(map_err)?;
    db::set_setting(&conn, "downloader_audio_sources", &settings.audio_sources.join(",")).map_err(map_err)?;
    db::set_setting(&conn, "downloader_extra_yt_dlp_args", &settings.extra_yt_dlp_args).map_err(map_err)?;
    db::set_setting(&conn, "downloader_extra_spotdl_args", &settings.extra_spotdl_args).map_err(map_err)?;
    db::set_setting(&conn, "downloader_auto_scan", if settings.auto_scan { "true" } else { "false" }).map_err(map_err)?;

    Ok(())
}

#[tauri::command]
pub async fn analyze_track_bpm(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<crate::models::Track, String> {
    let track_path = {
        let conn = state.db.lock().map_err(map_err)?;
        let mut stmt = conn.prepare("SELECT path FROM tracks WHERE id = ?1 OR path = ?1").map_err(map_err)?;
        stmt.query_row(rusqlite::params![track_id], |r| r.get::<_, String>(0)).map_err(map_err)?
    };

    let bpm = tokio::task::spawn_blocking(move || crate::bpm_analyzer::detect_bpm(&track_path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("Audio analysis failed: {}", e))?;

    let conn = state.db.lock().map_err(map_err)?;
    db::update_track_estimated_bpm(&conn, &track_id, bpm).map_err(map_err)?;

    let mut stmt = conn.prepare("SELECT * FROM tracks WHERE id = ?1 OR path = ?1").map_err(map_err)?;
    let track = stmt.query_row(rusqlite::params![track_id], db::row_to_track).map_err(map_err)?;
    Ok(track)
}

#[tauri::command]
pub async fn analyze_all_missing_bpm(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let tracks_to_analyze: Vec<(String, String)> = {
        let conn = state.db.lock().map_err(map_err)?;
        let mut stmt = conn.prepare(
            "SELECT id, path FROM tracks WHERE bpm IS NULL OR bpm <= 0"

        ).map_err(map_err)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(map_err)?;
        rows.filter_map(Result::ok).collect()
    };

    let mut analyzed_count = 0;
    for (id, path) in tracks_to_analyze {
        let path_clone = path.clone();
        let bpm_res = tokio::task::spawn_blocking(move || crate::bpm_analyzer::detect_bpm(&path_clone)).await;
        if let Ok(Ok(bpm)) = bpm_res {
            if let Ok(conn) = state.db.lock() {
                if db::update_track_estimated_bpm(&conn, &id, bpm).is_ok() {
                    analyzed_count += 1;
                }
            }
        }
    }

    Ok(analyzed_count)
}

#[tauri::command]
pub fn get_radios(state: State<AppState>) -> Result<Vec<Radio>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::get_radios(&conn).map_err(map_err)
}

#[tauri::command]
pub fn save_radio(state: State<AppState>, input: RadioInput) -> Result<Radio, String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::save_radio(&conn, input).map_err(map_err)
}

#[tauri::command]
pub fn delete_radio(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    db::delete_radio(&conn, &id).map_err(map_err)
}

#[tauri::command]
pub async fn check_radio_online(state: State<'_, AppState>, id: String, stream_url: String) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(map_err)?;

    let is_online = match client.head(&stream_url).send().await {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 405 => true,
        _ => match client.get(&stream_url).header("Range", "bytes=0-100").send().await {
            Ok(resp) => resp.status().is_success() || resp.status().as_u16() == 206,
            Err(_) => false,
        },
    };

    if let Ok(conn) = state.db.lock() {
        let _ = db::update_radio_status(&conn, &id, is_online);
    }

    Ok(is_online)
}

#[tauri::command]
pub async fn resolve_video_audio_stream(url: String) -> Result<String, String> {
    let yt_dlp_bin = crate::downloader::yt_dlp_exe_path();
    if !yt_dlp_bin.exists() {
        return Ok(url);
    }

    let output = tokio::process::Command::new(yt_dlp_bin)
        .arg("-g")
        .arg("-f")
        .arg("bestaudio/best")
        .arg(&url)
        .output()
        .await
        .map_err(|e| format!("Échec d'exécution yt-dlp: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = stdout.lines().next() {
            let clean = line.trim();
            if !clean.is_empty() {
                return Ok(clean.to_string());
            }
        }
    }

    Ok(url)
}



