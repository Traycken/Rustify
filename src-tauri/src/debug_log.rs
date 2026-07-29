// ============================================================================
// debug_log.rs — Journal in-memory des erreurs backend
//
// Buffer global (indépendant de AppState, accessible depuis n'importe quel
// point du backend sans passer par State<AppState>) qui conserve les
// dernières erreurs survenues côté Rust. Alimenté principalement via
// commands::map_err (couvre la quasi-totalité des commandes Tauri qui
// convertissent un Result en erreur String), ainsi que par quelques points
// d'échec réseau explicitement instrumentés (voir api::get_json_rotating).
//
// Consulté par le frontend via les commandes get_debug_logs / clear_debug_logs
// (voir commands.rs), affiché dans Paramètres > Journal & Debug.
// ============================================================================

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

/// Nombre maximum d'entrées conservées (FIFO : la plus ancienne est
/// supprimée au-delà de cette limite pour éviter une croissance mémoire
/// illimitée sur une session longue).
const MAX_LOG_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Horodatage RFC 3339 (UTC).
    pub timestamp: String,
    /// Origine de l'erreur (ex: "backend", "backend-api").
    pub source: String,
    pub message: String,
}

static LOGS: OnceLock<Mutex<VecDeque<LogEntry>>> = OnceLock::new();

fn store() -> &'static Mutex<VecDeque<LogEntry>> {
    LOGS.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)))
}

/// Enregistre une erreur backend dans le journal.
pub fn push_log(source: &str, message: impl Into<String>) {
    let entry = LogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: source.to_string(),
        message: message.into(),
    };
    if let Ok(mut guard) = store().lock() {
        if guard.len() >= MAX_LOG_ENTRIES {
            guard.pop_front();
        }
        guard.push_back(entry);
    }
}

/// Renvoie une copie de toutes les entrées actuellement conservées (ordre
/// chronologique croissant ; le frontend affiche les plus récentes en tête).
pub fn get_logs() -> Vec<LogEntry> {
    store()
        .lock()
        .map(|g| g.iter().cloned().collect())
        .unwrap_or_default()
}

/// Vide entièrement le journal.
pub fn clear_logs() {
    if let Ok(mut g) = store().lock() {
        g.clear();
    }
}
