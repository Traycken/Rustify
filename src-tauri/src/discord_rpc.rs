use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DISCORD_CLIENT_ID: &str = "1348632612702916678";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordPresencePayload {
    pub details: String,
    pub state: String,
    pub is_playing: bool,
    pub is_radio: bool,
    pub position_secs: Option<f64>,
    pub duration_secs: Option<f64>,
}

pub enum DiscordRpcCommand {
    Update(DiscordPresencePayload),
    Clear,
    SetEnabled(bool),
}

#[derive(Clone)]
pub struct DiscordRpcHandle {
    sender: Sender<DiscordRpcCommand>,
}

impl DiscordRpcHandle {
    pub fn update(&self, payload: DiscordPresencePayload) {
        let _ = self.sender.send(DiscordRpcCommand::Update(payload));
    }

    pub fn clear(&self) {
        let _ = self.sender.send(DiscordRpcCommand::Clear);
    }

    pub fn set_enabled(&self, enabled: bool) {
        let _ = self.sender.send(DiscordRpcCommand::SetEnabled(enabled));
    }
}

pub fn spawn_discord_rpc_thread(initial_enabled: bool) -> DiscordRpcHandle {
    let (tx, rx) = channel::<DiscordRpcCommand>();

    thread::spawn(move || {
        let mut enabled = initial_enabled;
        let mut client: Option<DiscordIpcClient> = None;
        let mut last_payload: Option<DiscordPresencePayload> = None;
        let mut is_connected = false;

        while let Ok(cmd) = rx.recv() {
            match cmd {
                DiscordRpcCommand::SetEnabled(new_enabled) => {
                    enabled = new_enabled;
                    if !enabled {
                        if let Some(ref mut c) = client {
                            let _ = c.clear_activity();
                            let _ = c.close();
                        }
                        is_connected = false;
                        client = None;
                    } else if let Some(ref payload) = last_payload {
                        update_client_presence(&mut client, &mut is_connected, payload);
                    }
                }
                DiscordRpcCommand::Clear => {
                    last_payload = None;
                    if enabled {
                        if let Some(ref mut c) = client {
                            let _ = c.clear_activity();
                        }
                    }
                }
                DiscordRpcCommand::Update(payload) => {
                    last_payload = Some(payload.clone());
                    if enabled {
                        update_client_presence(&mut client, &mut is_connected, &payload);
                    }
                }
            }
        }

        if let Some(ref mut c) = client {
            let _ = c.clear_activity();
            let _ = c.close();
        }
    });

    DiscordRpcHandle { sender: tx }
}

fn update_client_presence(
    client: &mut Option<DiscordIpcClient>,
    is_connected: &mut bool,
    payload: &DiscordPresencePayload,
) {
    if client.is_none() {
        if let Ok(new_client) = DiscordIpcClient::new(DISCORD_CLIENT_ID) {
            *client = Some(new_client);
            *is_connected = false;
        }
    }

    if let Some(ref mut c) = client {
        if !*is_connected {
            if c.connect().is_ok() {
                *is_connected = true;
            } else {
                return;
            }
        }

        let mut act = activity::Activity::new();

        if !payload.details.is_empty() {
            act = act.details(&payload.details);
        }

        if !payload.state.is_empty() {
            act = act.state(&payload.state);
        }

        let large_text = if payload.is_radio {
            "Rustify — Radio en direct"
        } else {
            "Rustify — Lecteur de musique"
        };
        let small_image = if !payload.is_playing {
            "pause"
        } else if payload.is_radio {
            "radio"
        } else {
            "play"
        };
        let small_text = if !payload.is_playing {
            "En pause"
        } else if payload.is_radio {
            "En direct"
        } else {
            "En lecture"
        };

        act = act.assets(
            activity::Assets::new()
                .large_image("rustify_logo")
                .large_text(large_text)
                .small_image(small_image)
                .small_text(small_text),
        );

        if payload.is_playing {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_secs() as i64;

            if payload.is_radio {
                let start = payload.position_secs.map(|p| now - p as i64).unwrap_or(now);
                act = act.timestamps(activity::Timestamps::new().start(start));
            } else if let (Some(pos), Some(dur)) = (payload.position_secs, payload.duration_secs) {
                if dur > 0.0 {
                    let start = now - pos as i64;
                    let end = start + dur as i64;
                    act = act.timestamps(activity::Timestamps::new().start(start).end(end));
                } else {
                    let start = now - pos as i64;
                    act = act.timestamps(activity::Timestamps::new().start(start));
                }
            }
        }

        if c.set_activity(act).is_err() {
            *is_connected = false;
        }
    }
}
