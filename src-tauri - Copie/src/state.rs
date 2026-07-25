use crate::db;
use crate::player::{self, PlayerCommand, SharedStatus};
use rusqlite::Connection;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub player_tx: Sender<PlayerCommand>,
    pub player_status: SharedStatus,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let conn = db::init_connection()?;
        let db_arc = Arc::new(Mutex::new(conn));
        let (player_tx, player_status) = player::spawn_player_thread(db_arc.clone())?;
        Ok(Self {
            db: db_arc,
            player_tx,
            player_status,
        })
    }
}
