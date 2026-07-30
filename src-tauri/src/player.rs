use crate::models::{PlayerState, Track};
use cpal::traits::{DeviceTrait, HostTrait};
use kira::{
    effect::eq_filter::{EqFilterBuilder, EqFilterHandle, EqFilterKind},
    manager::{
        backend::cpal::{CpalBackend, CpalBackendSettings},
        AudioManager, AudioManagerSettings,
    },
    sound::{
        streaming::{StreamingSoundData, StreamingSoundHandle},
        FromFileError, PlaybackState,
    },
    track::{TrackBuilder, TrackHandle},
    tween::Tween,
    Volume,
};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Fréquences (Hz) des 10 bandes de l'égaliseur graphique, en octaves ISO
/// standard (identiques à celles d'un égaliseur graphique classique).
pub const EQ_BAND_FREQS_HZ: [f64; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];
/// Q fixe par bande : compromis standard pour un rendu "graphique" lisse à 10
/// bandes (bandes légèrement chevauchantes, sans creux/pics excessifs).
const EQ_BAND_Q: f64 = 1.4;

/// Structure permettant de suivre la session d'écoute active d'un morceau
struct ActiveSession {
    track_id: String,
    is_manual_select: bool,
    accumulated_play_secs: f64,
    last_pos: f64,
}

/// Commandes envoyées au thread audio.
pub enum PlayerCommand {
    Play(Vec<Track>, usize, bool), // (queue, start_index, is_manual)
    RestoreTrack(Vec<Track>, usize, f64),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    Next,
    Prev,
    ToggleRepeat,
    ToggleShuffle,
    ToggleSmartShuffle,
    SetSmartShuffleActive(bool),
    SetAudioDevice(String),

    /// Applique un état d'égaliseur (10 bandes + préampli), immédiatement et
    /// en continu (y compris après un changement de périphérique de sortie).
    ApplyEq {
        enabled: bool,
        preamp_db: f64,
        gains: Vec<f64>,
    },
    /// Réduit la file interne à la seule piste en cours de lecture (aucun
    /// impact sur le son ni la position). Utilisé par le Smart Shuffle
    /// (géré côté JS) pour garantir que la fin naturelle du morceau ne
    /// déclenche jamais un "titre suivant de la liste" (next() séquentiel)
    /// mais bascule systématiquement sur le relais algorithmique — voir
    /// Engine::advance_on_finish (has_next devient false) et
    /// main.ts::applyPlayerState.
    TrimQueueToCurrent,
}

pub type SharedStatus = Arc<Mutex<PlayerState>>;

/// Moteur interne utilisant la crate Kira.
struct Engine {
    manager: AudioManager<CpalBackend>,
    sound_handle: Option<StreamingSoundHandle<FromFileError>>,
    queue: Vec<Track>,
    queue_index: i64,
    volume: f32,
    repeat: bool,
    shuffle: bool,
    smart_shuffle_active: bool,
    device_name: Option<String>,

    active_session: Option<ActiveSession>,
    db: Arc<Mutex<rusqlite::Connection>>,
    // Égaliseur graphique 10 bandes : toutes les pistes sont routées vers
    // cette sous-piste Kira, sur laquelle sont appliqués les 10 filtres EQ
    // (+ le préampli, via le volume de la piste elle-même).
    eq_track: TrackHandle,
    eq_bands: Vec<EqFilterHandle>,
    eq_enabled: bool,
    eq_preamp_db: f64,
    eq_gains: Vec<f64>,
}

/// Crée la sous-piste d'égalisation (10 filtres EQ en cascade) sur le
/// gestionnaire audio donné. À reconstruire à chaque changement de
/// périphérique de sortie : Kira détruit toutes les sous-pistes lorsqu'un
/// nouvel `AudioManager` est créé.
fn build_eq_track(
    manager: &mut AudioManager<CpalBackend>,
) -> anyhow::Result<(TrackHandle, Vec<EqFilterHandle>)> {
    let mut builder = TrackBuilder::new();
    let mut bands = Vec::with_capacity(EQ_BAND_FREQS_HZ.len());
    for &freq_hz in EQ_BAND_FREQS_HZ.iter() {
        let handle = builder.add_effect(EqFilterBuilder::new(EqFilterKind::Bell, freq_hz, 0.0, EQ_BAND_Q));
        bands.push(handle);
    }
    let track = manager.add_sub_track(builder)?;
    Ok((track, bands))
}

fn find_output_device(host: &cpal::Host, device_name: Option<&str>) -> Option<cpal::Device> {
    match device_name {
        Some(name) if !name.trim().is_empty() && name != "default" => {
            if let Ok(devices) = host.output_devices() {
                for d in devices {
                    if let Ok(d_name) = d.name() {
                        if d_name == name {
                            return Some(d);
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Construit le moteur audio Kira/cpal.
///
/// Correctif "hachurage/craquements sous charge CPU" : le tampon audio par
/// défaut du pilote est parfois trop court, ce qui provoque des sous-charges
/// (buffer underruns) dès que le CPU est sollicité (scan, chargement de
/// bibliothèque, etc.). On force un tampon plus généreux (~46ms @44.1kHz)
/// pour absorber ces pics, avec repli automatique sur la taille par défaut
/// si le périphérique refuse cette taille fixe.
fn create_audio_manager(device_name: Option<&str>) -> anyhow::Result<AudioManager<CpalBackend>> {
    let host = cpal::default_host();

    let build = |buffer_size: cpal::BufferSize| -> anyhow::Result<AudioManager<CpalBackend>> {
        let device = find_output_device(&host, device_name);
        let backend_settings = CpalBackendSettings {
            device,
            buffer_size,
        };
        let settings = AudioManagerSettings {
            backend_settings,
            ..Default::default()
        };
        Ok(AudioManager::<CpalBackend>::new(settings)?)
    };

    match build(cpal::BufferSize::Fixed(2048)) {
        Ok(manager) => Ok(manager),
        Err(e) => {
            eprintln!(
                "Rustify: tampon audio fixe (2048) refusé par le pilote ({e}), repli sur la taille par défaut"
            );
            build(cpal::BufferSize::Default)
        }
    }
}

impl Engine {
    fn new(db: Arc<Mutex<rusqlite::Connection>>) -> anyhow::Result<Self> {
        let mut manager = create_audio_manager(None)?;
        let (eq_track, eq_bands) = build_eq_track(&mut manager)?;
        Ok(Self {
            manager,
            sound_handle: None,
            queue: Vec::new(),
            queue_index: -1,
            volume: 0.8,
            repeat: false,
            shuffle: false,
            smart_shuffle_active: false,
            device_name: None,

            active_session: None,
            db,
            eq_track,
            eq_bands,
            eq_enabled: true,
            eq_preamp_db: 0.0,
            eq_gains: vec![0.0; EQ_BAND_FREQS_HZ.len()],
        })
    }

    /// Réapplique l'état d'égaliseur actuellement mémorisé (gains + préampli
    /// + activation) aux handles courants. À appeler après toute
    /// (re)création de la piste EQ (démarrage, changement de périphérique).
    fn apply_eq_to_handles(&mut self) {
        for (i, band) in self.eq_bands.iter_mut().enumerate() {
            let gain_db = if self.eq_enabled {
                self.eq_gains.get(i).copied().unwrap_or(0.0)
            } else {
                0.0
            };
            band.set_gain(gain_db, Tween::default());
        }
        let preamp_db = if self.eq_enabled { self.eq_preamp_db } else { 0.0 };
        self.eq_track.set_volume(Volume::Decibels(preamp_db), Tween::default());
    }

    /// Met à jour l'état de l'égaliseur (appelé depuis `PlayerCommand::ApplyEq`).
    fn set_eq(&mut self, enabled: bool, preamp_db: f64, gains: Vec<f64>) {
        self.eq_enabled = enabled;
        self.eq_preamp_db = preamp_db;
        if gains.len() == self.eq_gains.len() {
            self.eq_gains = gains;
        }
        self.apply_eq_to_handles();
    }

    fn current(&self) -> Option<&Track> {
        if self.queue_index >= 0 {
            self.queue.get(self.queue_index as usize)
        } else {
            None
        }
    }

    fn finalize_current_session(&mut self, is_skip: bool, is_completed: bool) {
        if let Some(session) = self.active_session.take() {
            if session.accumulated_play_secs >= 10.0 {
                if let Ok(conn) = self.db.lock() {
                    let _ = crate::db::record_track_session(
                        &conn,
                        &session.track_id,
                        session.accumulated_play_secs,
                        session.is_manual_select,
                        is_skip,
                        is_completed,
                    );
                }
            }
        }
    }

    fn tick_time_accumulation(&mut self) {
        if let Some(handle) = &self.sound_handle {
            if handle.state() == PlaybackState::Playing {
                let pos = handle.position();
                if let Some(sess) = &mut self.active_session {
                    let delta = pos - sess.last_pos;
                    if delta > 0.0 && delta < 2.0 {
                        sess.accumulated_play_secs += delta;
                    }
                    sess.last_pos = pos;
                }
            }
        }
    }

    fn load_current(&mut self, is_manual_select: bool) -> anyhow::Result<()> {
        self.finalize_current_session(true, false);

        let track = self
            .current()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("file d'attente vide"))?;

        if let Some(mut old) = self.sound_handle.take() {
            let _ = old.stop(Tween::default());
        }

        let sound_data = StreamingSoundData::from_file(&track.path)?.output_destination(&self.eq_track);
        let mut handle = self.manager.play(sound_data)?;
        let _ = handle.set_volume(self.volume as f64, Tween::default());
        self.sound_handle = Some(handle);

        self.active_session = Some(ActiveSession {
            track_id: track.id,
            is_manual_select,
            accumulated_play_secs: 0.0,
            last_pos: 0.0,
        });

        Ok(())
    }

    fn set_queue(&mut self, queue: Vec<Track>, start_index: usize, is_manual_select: bool) -> anyhow::Result<()> {
        self.queue = queue;
        self.queue_index = start_index as i64;
        self.load_current(is_manual_select)
    }

    fn pause(&mut self) {
        if let Some(handle) = &mut self.sound_handle {
            let _ = handle.pause(Tween::default());
        }
    }

    fn resume(&mut self) {
        if let Some(handle) = &mut self.sound_handle {
            let _ = handle.resume(Tween::default());
        }
    }

    fn stop(&mut self) {
        self.finalize_current_session(true, false);
        if let Some(mut handle) = self.sound_handle.take() {
            let _ = handle.stop(Tween::default());
        }
    }

    fn is_playing(&self) -> bool {
        self.sound_handle
            .as_ref()
            .map(|h| h.state() == PlaybackState::Playing)
            .unwrap_or(false)
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        if let Some(handle) = &mut self.sound_handle {
            let _ = handle.set_volume(self.volume as f64, Tween::default());
        }
    }

    fn seek(&mut self, position_secs: f64) -> anyhow::Result<()> {
        let pos = position_secs.max(0.0);
        if let Some(handle) = &mut self.sound_handle {
            let _ = handle.seek_to(pos);
        }
        if let Some(sess) = &mut self.active_session {
            sess.last_pos = pos;
        }
        Ok(())
    }

    fn next(&mut self, is_manual: bool) -> anyhow::Result<()> {
        if self.queue.is_empty() {
            return Ok(());
        }
        if self.shuffle {
            self.queue_index = rand_index(self.queue.len()) as i64;
        } else {
            self.queue_index += 1;
            if self.queue_index as usize >= self.queue.len() {
                self.queue_index = if self.repeat { 0 } else { self.queue.len() as i64 - 1 };
            }
        }
        self.load_current(is_manual)
    }

    fn prev(&mut self, is_manual: bool) -> anyhow::Result<()> {
        if self.queue.is_empty() {
            return Ok(());
        }
        self.queue_index = (self.queue_index - 1).max(0);
        self.load_current(is_manual)
    }

    fn advance_on_finish(&mut self) -> anyhow::Result<()> {
        self.finalize_current_session(false, true);

        let has_next = self.shuffle
            || self.repeat
            || (self.queue_index + 1) < self.queue.len() as i64;
        if has_next {
            self.next(false)
        } else {
            self.stop();
            // Fin de file sans suite (pas de repeat/shuffle moteur, ex: file à
            // 1 morceau du Smart Shuffle) : on vide l'index courant pour que
            // `current()` renvoie None. Le frontend (Smart Shuffle) détecte
            // cette absence de piste courante pour enchaîner automatiquement
            // sur le morceau suivant déjà calculé (voir main.ts::applyPlayerState).
            // Sans ce reset, current_track restait renseigné (piste arrêtée)
            // et la relance automatique ne se déclenchait jamais → blocage.
            self.queue_index = -1;
            Ok(())
        }
    }

    fn set_audio_device(&mut self, device_name: &str) -> anyhow::Result<()> {
        let target_name = if device_name.trim().is_empty() || device_name == "default" {
            None
        } else {
            Some(device_name.to_string())
        };

        if self.device_name == target_name {
            return Ok(());
        }

        let pos = self
            .sound_handle
            .as_ref()
            .map(|h| h.position())
            .unwrap_or(0.0);
        let was_playing = self.is_playing();
        let had_track = self.current().is_some();
        let saved_session = self.active_session.take();

        if let Some(mut handle) = self.sound_handle.take() {
            let _ = handle.stop(Tween::default());
        }

        match create_audio_manager(target_name.as_deref()) {
            Ok(new_manager) => {
                self.manager = new_manager;
                self.device_name = target_name;

                // Kira détruit les sous-pistes existantes avec l'ancien
                // AudioManager : on recrée la piste EQ puis on réapplique
                // l'état d'égalisation courant (gains/préampli/activation).
                match build_eq_track(&mut self.manager) {
                    Ok((track, bands)) => {
                        self.eq_track = track;
                        self.eq_bands = bands;
                        self.apply_eq_to_handles();
                    }
                    Err(e) => {
                        eprintln!("Rustify: échec reconstruction de la piste EQ après changement de périphérique: {e}");
                    }
                }

                if had_track {
                    let is_manual = saved_session.as_ref().map(|s| s.is_manual_select).unwrap_or(false);
                    if let Ok(()) = self.load_current(is_manual) {
                        let _ = self.seek(pos);
                        if let Some(old_sess) = saved_session {
                            if let Some(new_sess) = &mut self.active_session {
                                new_sess.accumulated_play_secs = old_sess.accumulated_play_secs;
                            }
                        }
                        if was_playing {
                            self.resume();
                        } else {
                            self.pause();
                        }
                    }
                }
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    /// Réduit la file à la seule piste actuellement en cours de lecture,
    /// sans toucher au handle audio ni à la position. Après appel,
    /// `queue.len() == 1` et `queue_index == 0` : à la fin naturelle du
    /// morceau, `advance_on_finish` ne trouvera plus de "suite séquentielle"
    /// (has_next = false), ce qui force le passage par l'état "aucune piste
    /// courante" et laisse la main au Smart Shuffle côté frontend.
    fn trim_queue_to_current(&mut self) {
        if let Some(track) = self.current().cloned() {
            self.queue = vec![track];
            self.queue_index = 0;
        }
    }

    fn track_just_finished(&self) -> bool {
        if let Some(handle) = &self.sound_handle {
            handle.state() == PlaybackState::Stopped
        } else {
            false
        }
    }

    fn snapshot(&self) -> PlayerState {
        let (is_playing, pos) = match &self.sound_handle {
            Some(handle) => (
                handle.state() == PlaybackState::Playing,
                handle.position(),
            ),
            None => (false, 0.0),
        };

        PlayerState {
            current_track: self.current().cloned(),
            is_playing,
            position_secs: pos,
            volume: self.volume,
            queue: Vec::new(),
            queue_index: self.queue_index,
            repeat: self.repeat,
            shuffle: self.shuffle,
            smart_shuffle_active: self.smart_shuffle_active,
            audio_device: self.device_name.clone(),
        }
    }
}

pub fn get_output_devices() -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(host) = std::panic::catch_unwind(|| cpal::default_host()) {
        if let Ok(devices) = host.output_devices() {
            for dev in devices {
                if let Ok(name) = dev.name() {
                    if !names.contains(&name) {
                        names.push(name);
                    }
                }
            }
        }
    }
    names
}

fn rand_index(len: usize) -> usize {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (nanos as usize) % len
}

pub fn spawn_player_thread(db: Arc<Mutex<rusqlite::Connection>>) -> anyhow::Result<(Sender<PlayerCommand>, SharedStatus)> {
    let (tx, rx): (Sender<PlayerCommand>, Receiver<PlayerCommand>) = channel();
    let status: SharedStatus = Arc::new(Mutex::new(PlayerState {
        volume: 0.8,
        ..PlayerState::default()
    }));
    let status_for_thread = status.clone();

    std::thread::Builder::new()
        .name("rustify-audio-engine".to_string())
        .spawn(move || {
            let mut engine = match Engine::new(db) {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("Rustify: échec init moteur audio Kira: {e}");
                    return;
                }
            };
            loop {
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(cmd) => {
                        let _ = apply_command(&mut engine, cmd);
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if engine.track_just_finished() {
                            let _ = engine.advance_on_finish();
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        engine.finalize_current_session(true, false);
                        break;
                    }
                }
                engine.tick_time_accumulation();
                if let Ok(mut s) = status_for_thread.lock() {
                    *s = engine.snapshot();
                }
            }
        })?;

    Ok((tx, status))
}

fn apply_command(engine: &mut Engine, cmd: PlayerCommand) -> anyhow::Result<()> {
    match cmd {
        PlayerCommand::Play(queue, start_index, is_manual) => engine.set_queue(queue, start_index, is_manual)?,
        PlayerCommand::RestoreTrack(queue, start_index, pos) => {
            engine.set_queue(queue, start_index, false)?;
            let _ = engine.seek(pos);
            engine.pause();
        }
        PlayerCommand::Pause => engine.pause(),
        PlayerCommand::Resume => engine.resume(),
        PlayerCommand::Stop => engine.stop(),
        PlayerCommand::Seek(secs) => engine.seek(secs)?,
        PlayerCommand::SetVolume(v) => engine.set_volume(v),
        PlayerCommand::Next => engine.next(false)?,
        PlayerCommand::Prev => engine.prev(false)?,
        PlayerCommand::ToggleRepeat => engine.repeat = !engine.repeat,
        PlayerCommand::ToggleShuffle => engine.shuffle = !engine.shuffle,
        PlayerCommand::ToggleSmartShuffle => {
            engine.smart_shuffle_active = !engine.smart_shuffle_active;
            if engine.smart_shuffle_active {
                engine.trim_queue_to_current();
            }
        }
        PlayerCommand::SetSmartShuffleActive(active) => {
            engine.smart_shuffle_active = active;
            if engine.smart_shuffle_active {
                engine.trim_queue_to_current();
            }
        }
        PlayerCommand::SetAudioDevice(dev) => engine.set_audio_device(&dev)?,
        PlayerCommand::ApplyEq {
            enabled,
            preamp_db,
            gains,
        } => engine.set_eq(enabled, preamp_db, gains),
        PlayerCommand::TrimQueueToCurrent => engine.trim_queue_to_current(),
    }
    Ok(())
}

