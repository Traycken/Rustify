use crate::db;
use crate::player::{self, PlayerCommand, SharedStatus};
use rusqlite::Connection;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub player_tx: Sender<PlayerCommand>,
    pub player_status: SharedStatus,
    pub active_download_pid: Arc<Mutex<Option<u32>>>,
}


impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let conn = db::init_connection()?;
        let db_arc = Arc::new(Mutex::new(conn));
        let (player_tx, player_status) = player::spawn_player_thread(db_arc.clone())?;

        // Applique l'égaliseur persistant (profil actif + activation) dès le
        // démarrage, avant toute lecture — source de vérité unique côté Rust,
        // peu importe l'ordre d'initialisation du frontend.
        if let Ok(conn) = db_arc.lock() {
            let enabled = db::get_setting(&conn, "eq_enabled", "true") == "true";
            let active_id = db::get_setting(&conn, "eq_active_profile_id", "default");
            if let Ok(profile) = db::get_eq_profile(&conn, &active_id) {
                let _ = player_tx.send(PlayerCommand::ApplyEq {
                    enabled,
                    preamp_db: profile.preamp,
                    gains: profile.gains,
                });
            }
        }

        Ok(Self {
            db: db_arc,
            player_tx,
            player_status,
            active_download_pid: Arc::new(Mutex::new(None)),
        })
    }
}

