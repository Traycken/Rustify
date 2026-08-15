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

/// Résultat d'un chargement de fichier audio en arrière-plan.
type LoadResult = Result<StreamingSoundData<FromFileError>, anyhow::Error>;
/// Handle vers un thread de pré-chargement (non-bloquant).
type PendingLoadHandle = std::thread::JoinHandle<LoadResult>;

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

/// Métadonnées d'un chargement de piste en cours (thread de pré-décodage).
struct PendingLoad {
    /// La piste en cours de chargement (pour l'afficher immédiatement dans le snapshot).
    track: Track,
    is_manual: bool,
    /// Position de départ souhaitée (restauration de session, seek avant lecture).
    start_pos: f64,
    handle: PendingLoadHandle,
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
    manager: Option<AudioManager<CpalBackend>>,
    sound_handle: Option<StreamingSoundHandle<FromFileError>>,
    queue: Vec<Track>,
    queue_index: i64,
    volume: f32,
    repeat: bool,
    shuffle: bool,
    smart_shuffle_active: bool,
    device_name: Option<String>,
    pending_position: f64,

    active_session: Option<ActiveSession>,
    db: Arc<Mutex<rusqlite::Connection>>,
    // Égaliseur graphique 10 bandes : toutes les pistes sont routées vers
    // cette sous-piste Kira, sur laquelle sont appliqués les 10 filtres EQ
    // (+ le préampli, via le volume de la piste elle-même).
    eq_track: Option<TrackHandle>,
    eq_bands: Vec<EqFilterHandle>,
    eq_enabled: bool,
    eq_preamp_db: f64,
    eq_gains: Vec<f64>,

    /// Chargement de fichier audio en cours dans un thread dédié.
    /// Permet de ne pas bloquer le thread audio pendant le décodage initial.
    pending_load: Option<PendingLoad>,
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

    match build(cpal::BufferSize::Fixed(4096)) {
        Ok(manager) => Ok(manager),
        Err(e) => {
            eprintln!(
                "Rustify: tampon audio fixe (4096) refusé par le pilote ({e}), repli sur la taille par défaut"
            );
            build(cpal::BufferSize::Default)
        }
    }
}

impl Engine {
    fn new(db: Arc<Mutex<rusqlite::Connection>>) -> anyhow::Result<Self> {
        Ok(Self {
            manager: None,
            sound_handle: None,
            queue: Vec::new(),
            queue_index: -1,
            volume: 0.8,
            repeat: false,
            shuffle: false,
            smart_shuffle_active: false,
            device_name: None,
            pending_position: 0.0,

            active_session: None,
            db,
            eq_track: None,
            eq_bands: Vec::new(),
            eq_enabled: true,
            eq_preamp_db: 0.0,
            eq_gains: vec![0.0; EQ_BAND_FREQS_HZ.len()],
            pending_load: None,
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
        if let Some(eq_track) = &mut self.eq_track {
            eq_track.set_volume(Volume::Decibels(preamp_db), Tween::default());
        }
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

    /// Ouvre le périphérique uniquement au premier vrai besoin de lecture.
    fn ensure_audio_engine(&mut self) -> anyhow::Result<()> {
        if self.manager.is_some() {
            return Ok(());
        }
        let mut manager = create_audio_manager(self.device_name.as_deref())?;
        let (eq_track, eq_bands) = build_eq_track(&mut manager)?;
        self.manager = Some(manager);
        self.eq_track = Some(eq_track);
        self.eq_bands = eq_bands;
        self.apply_eq_to_handles();
        Ok(())
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

    /// Lance le chargement de la piste courante dans un thread dédié (non-bloquant).
    /// La lecture démarre réellement dans `poll_pending_load()` une fois le décodage terminé.
    fn load_current(&mut self, is_manual_select: bool) -> anyhow::Result<()> {
        self.finalize_current_session(true, false);
        let track = self.current().cloned().ok_or_else(|| anyhow::anyhow!("file d'attente vide"))?;

        // Arrêter la lecture en cours immédiatement
        if let Some(mut old) = self.sound_handle.take() {
            let _ = old.stop(Tween::default());
        }
        // Annuler un éventuel chargement précédent encore en cours
        self.pending_load = None;

        // S'assurer que le moteur audio est initialisé (sans décoder le fichier)
        self.ensure_audio_engine()?;

        let path = track.path.clone();
        let start_pos = self.pending_position;

        // Décodage du fichier dans un thread OS dédié pour ne pas bloquer
        // le thread audio (et donc le frontend) pendant plusieurs secondes.
        let handle = std::thread::Builder::new()
            .name("rustify-file-loader".to_string())
            .spawn(move || {
                StreamingSoundData::from_file(&path)
                    .map_err(|e| anyhow::anyhow!("from_file error: {e}"))
            })?;

        self.pending_load = Some(PendingLoad {
            track,
            is_manual: is_manual_select,
            start_pos,
            handle,
        });
        Ok(())
    }

    /// Vérifie si un chargement en arrière-plan est terminé, et si oui,
    /// finalise le `manager.play()` depuis le thread audio.
    /// Retourne `true` si un chargement vient d'être résolu.
    fn poll_pending_load(&mut self) -> bool {
        // Vérifier si le thread de chargement est terminé (non-bloquant)
        let finished = self
            .pending_load
            .as_ref()
            .map(|p| p.handle.is_finished())
            .unwrap_or(false);

        if !finished {
            return false;
        }

        let pending = match self.pending_load.take() {
            Some(p) => p,
            None => return false,
        };

        let sound_data = match pending.handle.join() {
            Ok(Ok(data)) => data,
            Ok(Err(e)) => {
                eprintln!("Rustify: erreur chargement fichier audio : {e}");
                return false;
            }
            Err(_) => {
                eprintln!("Rustify: thread de chargement audio a paniqué");
                return false;
            }
        };

        // Associer le flux à la piste EQ et démarrer la lecture
        let eq_track = match self.eq_track.as_ref() {
            Some(t) => t,
            None => {
                eprintln!("Rustify: piste EQ indisponible au moment du play");
                return false;
            }
        };
        let sound_data = sound_data.output_destination(eq_track);
        let manager = match self.manager.as_mut() {
            Some(m) => m,
            None => {
                eprintln!("Rustify: moteur audio indisponible au moment du play");
                return false;
            }
        };

        match manager.play(sound_data) {
            Ok(mut handle) => {
                let _ = handle.set_volume(self.volume as f64, Tween::default());
                if pending.start_pos > 0.0 {
                    let _ = handle.seek_to(pending.start_pos);
                }
                self.sound_handle = Some(handle);
                self.active_session = Some(ActiveSession {
                    track_id: pending.track.id,
                    is_manual_select: pending.is_manual,
                    accumulated_play_secs: 0.0,
                    last_pos: pending.start_pos,
                });
                true
            }
            Err(e) => {
                eprintln!("Rustify: échec démarrage lecture : {e}");
                false
            }
        }
    }
    fn set_queue(&mut self, queue: Vec<Track>, start_index: usize, is_manual_select: bool) -> anyhow::Result<()> {
        self.queue = queue;
        self.queue_index = start_index as i64;
        self.pending_position = 0.0;
        self.load_current(is_manual_select)
    }

    fn restore_queue(&mut self, queue: Vec<Track>, start_index: usize, position_secs: f64) {
        self.finalize_current_session(true, false);
        if let Some(mut handle) = self.sound_handle.take() {
            let _ = handle.stop(Tween::default());
        }
        self.queue = queue;
        self.queue_index = start_index as i64;
        self.pending_position = position_secs.max(0.0);
    }
    fn pause(&mut self) {
        if let Some(handle) = &mut self.sound_handle {
            let _ = handle.pause(Tween::default());
        }
    }

    fn resume(&mut self) {
        if self.sound_handle.is_none() && self.current().is_some() {
            let restore_position = self.pending_position;
            if self.load_current(false).is_ok() {
                let _ = self.seek(restore_position);
            }
        }
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
        self.pending_position = pos;
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
        let target_name = if device_name.trim().is_empty() || device_name == "default" { None } else { Some(device_name.to_string()) };
        if self.device_name == target_name { return Ok(()); }
        // Ne démarre pas le flux matériel lors de l'ouverture des paramètres.
        if self.manager.is_none() {
            self.device_name = target_name;
            return Ok(());
        }

        let pos = self.sound_handle.as_ref().map(|h| h.position()).unwrap_or(self.pending_position);
        let was_playing = self.is_playing();
        let had_track = self.current().is_some();
        let saved_session = self.active_session.take();
        if let Some(mut handle) = self.sound_handle.take() { let _ = handle.stop(Tween::default()); }

        let mut manager = create_audio_manager(target_name.as_deref())?;
        let (eq_track, eq_bands) = build_eq_track(&mut manager)?;
        self.manager = Some(manager);
        self.device_name = target_name;
        self.eq_track = Some(eq_track);
        self.eq_bands = eq_bands;
        self.apply_eq_to_handles();

        if had_track {
            let is_manual = saved_session.as_ref().map(|s| s.is_manual_select).unwrap_or(false);
            self.pending_position = pos;
            if self.load_current(is_manual).is_ok() {
                let _ = self.seek(pos);
                if let Some(old_sess) = saved_session {
                    if let Some(new_sess) = &mut self.active_session { new_sess.accumulated_play_secs = old_sess.accumulated_play_secs; }
                }
                if was_playing { self.resume(); } else { self.pause(); }
            }
        }
        Ok(())
    }
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
            None => (false, self.pending_position),
        };

        // Si un chargement est en cours, on expose la piste cible immédiatement
        // (is_playing = false) pour que le frontend affiche le titre sans attendre
        // la fin du décodage, et ne confonde pas cet état avec une fin de piste.
        let current_track = if self.pending_load.is_some() {
            self.pending_load.as_ref().map(|p| p.track.clone())
        } else {
            self.current().cloned()
        };

        PlayerState {
            current_track,
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
                // Timeout court (50ms) pour réagir rapidement à la fin du
                // chargement en arrière-plan sans surcharger le CPU.
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(cmd) => {
                        let _ = apply_command(&mut engine, cmd);
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        // Vérifier si le chargement du fichier audio est terminé
                        engine.poll_pending_load();
                        // Vérifier si la piste en cours vient de se terminer naturellement
                        if engine.pending_load.is_none() && engine.track_just_finished() {
                            let _ = engine.advance_on_finish();
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        engine.finalize_current_session(true, false);
                        break;
                    }
                }
                // Intégrer le chargement qui aurait terminé pendant le traitement d'une commande
                engine.poll_pending_load();
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
        PlayerCommand::RestoreTrack(queue, start_index, pos) => engine.restore_queue(queue, start_index, pos),
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

