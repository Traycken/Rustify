// Prévient la console Windows en release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod models;
mod player;
mod scanner;
mod state;

use player::PlayerCommand;
use state::AppState;

use std::str::FromStr;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn update_shortcut_registrations(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();

    let state = app.state::<AppState>();
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return,
    };

    let enabled = db::get_setting(&conn, "global_shortcuts_enabled", "true") == "true";
    if !enabled {
        return;
    }

    let sc_play = db::get_setting(&conn, "shortcut_play_pause", "MediaPlayPause");
    let sc_next = db::get_setting(&conn, "shortcut_next", "MediaTrackNext");
    let sc_prev = db::get_setting(&conn, "shortcut_prev", "MediaTrackPrevious");
    let sc_stop = db::get_setting(&conn, "shortcut_stop", "MediaStop");

    for sc_str in [&sc_play, &sc_next, &sc_prev, &sc_stop] {
        if sc_str.trim().is_empty() {
            continue;
        }
        if let Ok(sc) = Shortcut::from_str(sc_str) {
            let _ = app.global_shortcut().register(sc);
        }
    }
}

fn handle_shortcut_trigger(app: &AppHandle, shortcut: &Shortcut) {
    let state = app.state::<AppState>();
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return,
    };

    let sc_play = db::get_setting(&conn, "shortcut_play_pause", "MediaPlayPause");
    let sc_next = db::get_setting(&conn, "shortcut_next", "MediaTrackNext");
    let sc_prev = db::get_setting(&conn, "shortcut_prev", "MediaTrackPrevious");
    let sc_stop = db::get_setting(&conn, "shortcut_stop", "MediaStop");

    let sc_str = shortcut.into_string();

    let is_match = |target: &str| -> bool {
        sc_str.eq_ignore_ascii_case(target) || (target == "MediaPlayPause" && (sc_str.contains("Play") || sc_str.contains("Space")))
    };

    if is_match(&sc_play) {
        let is_playing = state.player_status.lock().map(|s| s.is_playing).unwrap_or(false);
        if is_playing {
            let _ = state.player_tx.send(PlayerCommand::Pause);
        } else {
            let _ = state.player_tx.send(PlayerCommand::Resume);
        }
    } else if is_match(&sc_next) || sc_str.contains("Next") {
        let _ = state.player_tx.send(PlayerCommand::Next);
    } else if is_match(&sc_prev) || sc_str.contains("Prev") {
        let _ = state.player_tx.send(PlayerCommand::Prev);
    } else if is_match(&sc_stop) || sc_str.contains("Stop") {
        let _ = state.player_tx.send(PlayerCommand::Stop);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        handle_shortcut_trigger(app, shortcut);
                    }
                })
                .build(),
        )
        .manage(AppState::new().expect("échec init état applicatif"))
        .setup(|app| {
            let toggle_item = MenuItem::with_id(app, "toggle_win", "Afficher / Masquer Rustify", true, None::<&str>)?;
            let play_item = MenuItem::with_id(app, "play_pause", "Lecture / Pause", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next_track", "Morceau Suivant", true, None::<&str>)?;
            let prev_item = MenuItem::with_id(app, "prev_track", "Morceau Précédent", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter Rustify", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &play_item,
                    &next_item,
                    &prev_item,
                    &PredefinedMenuItem::separator(app)?,
                    &toggle_item,
                    &quit_item,
                ],
            )?;

            if let Some(icon) = app.default_window_icon() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&tray_menu)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "toggle_win" => {
                            if let Some(win) = app.get_webview_window("main") {
                                if win.is_visible().unwrap_or(false) {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                        "play_pause" => {
                            let state = app.state::<AppState>();
                            let is_playing = state.player_status.lock().map(|s| s.is_playing).unwrap_or(false);
                            if is_playing {
                                let _ = state.player_tx.send(PlayerCommand::Pause);
                            } else {
                                let _ = state.player_tx.send(PlayerCommand::Resume);
                            }
                        }
                        "next_track" => {
                            let state = app.state::<AppState>();
                            let _ = state.player_tx.send(PlayerCommand::Next);
                        }
                        "prev_track" => {
                            let state = app.state::<AppState>();
                            let _ = state.player_tx.send(PlayerCommand::Prev);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                if win.is_visible().unwrap_or(false) {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;
            }

            update_shortcut_registrations(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let min_to_tray = if let Ok(conn) = state.db.lock() {
                    db::get_setting(&conn, "minimize_to_tray", "true") == "true"
                } else {
                    true
                };

                if min_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_library,
            commands::get_tracks,
            commands::get_albums,
            commands::get_artists,
            commands::play_track,
            commands::pause,
            commands::resume,
            commands::stop,
            commands::seek,
            commands::set_volume,
            commands::next_track,
            commands::prev_track,
            commands::toggle_repeat,
            commands::toggle_shuffle,
            commands::get_player_state,
            commands::create_playlist,
            commands::add_to_playlist,
            commands::get_playlists,
            commands::get_playlist_tracks,
            commands::read_cover,
            commands::save_online_metadata,
            commands::batch_update_metadata,
            commands::update_album_metadata,
            commands::save_artist_metadata,
            commands::rename_genre,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::get_audio_devices,
            commands::set_audio_device,
            commands::set_artist_is_group,
            commands::get_app_settings,
            commands::save_app_setting,
            commands::set_autostart_setting,
            commands::like_track,
            commands::dislike_track,
            commands::update_track_likes_dislikes,
            commands::toggle_favorite,
            commands::get_favorites,
            commands::get_play_history,
            commands::clear_play_history,
            commands::get_track_live_stats,
            commands::save_last_player_state,
            commands::get_last_player_state,
            commands::restore_player_track,
        ])
        .run(tauri::generate_context!())
        .expect("erreur lors de l'exécution de Rustify");
}
