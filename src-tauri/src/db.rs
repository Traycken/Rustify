use crate::models::{
    AlbumSummary, ArtistEnrichment, ArtistSummary, EqProfile, Playlist, Radio, RadioInput, Track,
    TrackCredit, TrackEnrichment,
};
use rusqlite::{params, Connection};
use std::path::PathBuf;

/// 10 bandes Ã  0 dB (gains "plats"), sÃ©rialisÃ©es une fois pour le profil par
/// dÃ©faut crÃ©Ã© au premier lancement.
const DEFAULT_EQ_GAINS_JSON: &str = "[0,0,0,0,0,0,0,0,0,0]";

pub fn db_path() -> PathBuf {
    let mut dir = dirs::data_local_dir().expect("dossier data local introuvable");
    dir.push("Rustify");
    std::fs::create_dir_all(&dir).ok();
    dir.push("rustify.db");
    dir
}

pub fn covers_dir() -> PathBuf {
    let mut dir = dirs::data_local_dir().expect("dossier data local introuvable");
    dir.push("Rustify");
    dir.push("covers");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn init_connection() -> anyhow::Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            album_artist TEXT NOT NULL,
            genre TEXT NOT NULL DEFAULT '',
            year INTEGER NOT NULL DEFAULT 0,
            track_no INTEGER NOT NULL DEFAULT 0,
            duration_secs REAL NOT NULL DEFAULT 0,
            has_cover INTEGER NOT NULL DEFAULT 0,
            cover_path TEXT
        );
        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL,
            track_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, track_id)
        );
        CREATE TABLE IF NOT EXISTS artist_metadata (
            artist TEXT PRIMARY KEY,
            image_path TEXT,
            genre TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorites (
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (target_type, target_id)
        );
        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id TEXT NOT NULL,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS eq_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            preamp REAL NOT NULL DEFAULT 0.0,
            gains TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0]',
            device_name TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_eq_profiles_device
            ON eq_profiles(device_name) WHERE device_name IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_history_played_at ON play_history(played_at DESC);
        CREATE TABLE IF NOT EXISTS radios (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            genre TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '',
            stream_url TEXT NOT NULL,
            image_path TEXT,
            is_video INTEGER NOT NULL DEFAULT 0,
            is_online INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN cover_path TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN likes INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN manual_select_count INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN skip_count INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN total_listen_secs REAL NOT NULL DEFAULT 0.0", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN bio TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN members TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN is_group INTEGER", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0", []);
    // Enrichissement externe (Deezer / MusicBrainz / LRCLIB / Wikidata)
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN bpm REAL", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN bpm_is_official INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN isrc TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN mbid TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN iswc TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN tags TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN credits TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN lyrics_plain TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN lyrics_synced TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN is_instrumental INTEGER", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN deezer_id TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN mbid TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN deezer_id TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN fan_count INTEGER", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN life_span_begin TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN life_span_end TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN is_ended INTEGER", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN death_cause TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN wikidata_qid TEXT", []);
    let _ = conn.execute("ALTER TABLE artist_metadata ADD COLUMN external_ids TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN permanent_score REAL NOT NULL DEFAULT 0.0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN is_ecstasy INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("UPDATE tracks SET is_ecstasy = 1 WHERE id IN (SELECT target_id FROM favorites WHERE target_type = 'ecstasy') OR path IN (SELECT target_id FROM favorites WHERE target_type = 'ecstasy')", []);
    let _ = conn.execute("UPDATE tracks SET artist = TRIM(artist), album_artist = TRIM(album_artist), album = TRIM(album)", []);

    // Table de statistiques des User-Agent par API
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ua_api_stats (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_agent  TEXT    NOT NULL,
            api         TEXT    NOT NULL,
            success_count  INTEGER NOT NULL DEFAULT 0,
            failure_count  INTEGER NOT NULL DEFAULT 0,
            block_count    INTEGER NOT NULL DEFAULT 0,
            last_used_at   TEXT,
            last_success_at TEXT,
            last_block_at   TEXT,
            UNIQUE(user_agent, api)
        );
        CREATE INDEX IF NOT EXISTS idx_ua_api ON ua_api_stats(api);
        ",
    )?;

    // ── Tables Smart Shuffle ──────────────────────────────────────────────────
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS smart_shuffle_global (
            track_id     TEXT PRIMARY KEY,
            global_score REAL NOT NULL DEFAULT 0.0,
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS smart_shuffle_session (
            id                    INTEGER PRIMARY KEY,
            session_start         TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at            TEXT NOT NULL,
            recent_track_ids      TEXT NOT NULL DEFAULT '[]',
            consecutive_skips     INTEGER NOT NULL DEFAULT 0,
            consecutive_completes INTEGER NOT NULL DEFAULT 0,
            target_genre          TEXT,
            target_artist         TEXT,
            target_bpm_min        REAL,
            target_bpm_max        REAL,
            target_playlist_id    TEXT,
            algo_feedback         TEXT NOT NULL DEFAULT '[]'
        );
        ",
    )?;
    let _ = conn.execute("ALTER TABLE smart_shuffle_session ADD COLUMN target_playlist_id TEXT", []);


    // Profil d'égaliseur par défaut ("Plat", gains à 0) créé au tout premier
    // lancement, pour qu'un profil actif existe toujours.
    let eq_profile_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM eq_profiles", [], |r| r.get(0))
        .unwrap_or(0);
    if eq_profile_count == 0 {
        conn.execute(
            "INSERT INTO eq_profiles (id, name, preamp, gains, device_name) VALUES (?1, ?2, 0.0, ?3, NULL)",
            params!["default", "Plat", DEFAULT_EQ_GAINS_JSON],
        )?;
    }
    if get_setting(&conn, "eq_active_profile_id", "").is_empty() {
        set_setting(&conn, "eq_active_profile_id", "default")?;
    }

    let _ = recalculate_all_permanent_scores(&conn);

    Ok(conn)
}

pub fn compute_permanent_score(
    likes: i32,
    dislikes: i32,
    is_fav: bool,
    is_ecstasy: bool,
    manual_selects: i32,
    play_count: i32,
    skip_count: i32,
    total_listen_secs: f64,
    duration_secs: f64,
) -> f64 {
    let mut score = 0.0_f64;
    score += (likes as f64) * 15.0;
    score -= (dislikes as f64) * 20.0;
    if is_fav {
        score += 25.0;
    }
    if is_ecstasy {
        score += 40.0;
    }
    score += (manual_selects as f64) * 5.0;
    score += (play_count as f64) * 2.0;
    score -= (skip_count as f64) * 6.0;

    let total_sessions = play_count + skip_count;
    if duration_secs > 0.0 && total_sessions > 0 {
        let avg_listen = total_listen_secs / (total_sessions as f64);
        let ratio = (avg_listen / duration_secs).min(1.0);
        score += ratio * 15.0;
    }
    score
}

pub fn update_track_permanent_score(conn: &Connection, track_id: &str) -> anyhow::Result<f64> {
    let mut stmt = conn.prepare(
        "SELECT likes, dislikes, is_favorite, is_ecstasy, manual_select_count, play_count, skip_count, total_listen_secs, duration_secs
         FROM tracks WHERE id = ?1 OR path = ?1",
    )?;

    let res: rusqlite::Result<(i32, i32, i32, i32, i32, i32, i32, f64, f64)> = stmt.query_row(params![track_id], |r| {
        Ok((
            r.get(0).unwrap_or(0),
            r.get(1).unwrap_or(0),
            r.get(2).unwrap_or(0),
            r.get(3).unwrap_or(0),
            r.get(4).unwrap_or(0),
            r.get(5).unwrap_or(0),
            r.get(6).unwrap_or(0),
            r.get(7).unwrap_or(0.0),
            r.get(8).unwrap_or(0.0),
        ))
    });

    if let Ok((likes, dislikes, is_fav_int, is_ecstasy_int, manual_selects, play_count, skip_count, total_listen_secs, duration_secs)) = res {
        let score = compute_permanent_score(
            likes,
            dislikes,
            is_fav_int != 0,
            is_ecstasy_int != 0,
            manual_selects,
            play_count,
            skip_count,
            total_listen_secs,
            duration_secs,
        );

        conn.execute(
            "UPDATE tracks SET permanent_score = ?1 WHERE id = ?2 OR path = ?2",
            params![score, track_id],
        )?;

        Ok(score)
    } else {
        Ok(0.0)
    }
}

pub fn recalculate_all_permanent_scores(conn: &Connection) -> anyhow::Result<()> {
    let mut stmt = conn.prepare("SELECT id FROM tracks")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .filter_map(Result::ok)
        .collect();

    for id in ids {
        let _ = update_track_permanent_score(conn, &id);
    }
    Ok(())
}

pub fn toggle_ecstasy(conn: &Connection, track_id: &str) -> anyhow::Result<bool> {
    let mut stmt = conn.prepare("SELECT is_ecstasy FROM tracks WHERE id = ?1 OR path = ?1")?;
    let current_val: i32 = stmt.query_row(params![track_id], |r| r.get(0)).unwrap_or(0);
    let new_val = if current_val == 0 { 1 } else { 0 };

    conn.execute("UPDATE tracks SET is_ecstasy = ?1 WHERE id = ?2 OR path = ?2", params![new_val, track_id])?;

    if new_val != 0 {
        conn.execute("INSERT OR REPLACE INTO favorites (target_type, target_id) VALUES ('ecstasy', ?1)", params![track_id])?;
    } else {
        conn.execute("DELETE FROM favorites WHERE target_type = 'ecstasy' AND (LOWER(target_id) = LOWER(?1) OR target_id IN (SELECT id FROM tracks WHERE path = ?1))", params![track_id])?;
    }

    let _ = update_track_permanent_score(conn, track_id);
    Ok(new_val != 0)
}

pub fn get_24h_play_penalties(conn: &Connection) -> anyhow::Result<std::collections::HashMap<String, f64>> {
    let mut stmt = conn.prepare(
        "SELECT track_id, (strftime('%s', 'now') - strftime('%s', played_at)) FROM play_history WHERE played_at >= datetime('now', '-72 hours')",
    )?;

    let mut penalties: std::collections::HashMap<String, f64> = std::collections::HashMap::new();

    let rows = stmt.query_map([], |row| {
        let track_id: String = row.get(0)?;
        let elapsed_secs: f64 = row.get(1)?;
        Ok((track_id, elapsed_secs))
    })?;

    for r in rows.flatten() {
        let (track_id, elapsed_secs) = r;
        let elapsed_hours = (elapsed_secs.max(0.0)) / 3600.0;
        if elapsed_hours <= 24.0 {
            // Décroissance linéaire sur 24H : une écoute instantanée coûte -150 points, décroissant vers 0 à 24h
            let pen = 150.0 * (1.0 - (elapsed_hours / 24.0));
            *penalties.entry(track_id).or_insert(0.0) += pen;
        }
    }

    Ok(penalties)
}

pub fn upsert_track(conn: &Connection, t: &Track) -> anyhow::Result<()> {
    let perm_score = compute_permanent_score(
        t.likes,
        t.dislikes,
        t.is_favorite,
        t.is_ecstasy,
        t.manual_select_count,
        t.play_count,
        t.skip_count,
        t.total_listen_secs,
        t.duration_secs,
    );
    conn.execute(
        "INSERT INTO tracks (id, path, title, artist, album, album_artist, genre, year, track_no, duration_secs, has_cover, cover_path, likes, dislikes, is_favorite, is_ecstasy, manual_select_count, play_count, skip_count, total_listen_secs, permanent_score, bpm, bpm_is_official)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
         ON CONFLICT(path) DO UPDATE SET
            title=excluded.title, artist=excluded.artist, album=excluded.album,
            album_artist=excluded.album_artist, genre=excluded.genre, year=excluded.year,
            track_no=excluded.track_no, duration_secs=excluded.duration_secs, has_cover=excluded.has_cover,
            cover_path=excluded.cover_path, permanent_score=excluded.permanent_score,
            bpm=COALESCE(excluded.bpm, tracks.bpm),
            bpm_is_official=CASE WHEN excluded.bpm IS NOT NULL THEN excluded.bpm_is_official ELSE tracks.bpm_is_official END",
        params![t.id, t.path, t.title, t.artist, t.album, t.album_artist, t.genre, t.year, t.track_no, t.duration_secs, t.has_cover as i32, t.cover_path, t.likes, t.dislikes, t.is_favorite as i32, t.is_ecstasy as i32, t.manual_select_count, t.play_count, t.skip_count, t.total_listen_secs, perm_score, t.bpm, t.bpm_is_official as i32],
    )?;
    Ok(())
}

pub fn row_to_track(row: &rusqlite::Row) -> rusqlite::Result<Track> {
    let likes: i32 = row.get("likes").unwrap_or(0);
    let dislikes: i32 = row.get("dislikes").unwrap_or(0);
    let is_fav_val: i32 = row.get("is_favorite").unwrap_or(0);
    let is_ecstasy_val: i32 = row.get("is_ecstasy").unwrap_or(0);
    let manual_select_count: i32 = row.get("manual_select_count").unwrap_or(0);
    let play_count: i32 = row.get("play_count").unwrap_or(0);
    let skip_count: i32 = row.get("skip_count").unwrap_or(0);
    let total_listen_secs: f64 = row.get("total_listen_secs").unwrap_or(0.0);
    let permanent_score: f64 = row.get("permanent_score").unwrap_or(0.0);
    let total_sessions = play_count + skip_count;
    let avg_listen_secs = if total_sessions > 0 {
        total_listen_secs / (total_sessions as f64)
    } else if play_count > 0 {
        total_listen_secs / (play_count as f64)
    } else {
        0.0
    };

    let bpm: Option<f64> = row.get("bpm").unwrap_or(None);
    let bpm_is_official: bool = row
        .get::<_, Option<i32>>("bpm_is_official")
        .unwrap_or(None)
        .map(|v| v != 0)
        .unwrap_or(false);
    let isrc: Option<String> = row.get("isrc").unwrap_or(None);
    let mbid: Option<String> = row.get("mbid").unwrap_or(None);
    let iswc: Option<String> = row.get("iswc").unwrap_or(None);
    let tags: Vec<String> = row
        .get::<_, Option<String>>("tags")
        .unwrap_or(None)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let credits: Vec<TrackCredit> = row
        .get::<_, Option<String>>("credits")
        .unwrap_or(None)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let lyrics_plain: Option<String> = row.get("lyrics_plain").unwrap_or(None);
    let lyrics_synced: Option<String> = row.get("lyrics_synced").unwrap_or(None);
    let is_instrumental: Option<bool> = row
        .get::<_, Option<i32>>("is_instrumental")
        .unwrap_or(None)
        .map(|v| v != 0);
    let deezer_id: Option<String> = row.get("deezer_id").unwrap_or(None);
    let enrichment_attempts: i32 = row.get("enrichment_attempts").unwrap_or(0);

    Ok(Track {
        id: row.get("id")?,
        path: row.get("path")?,
        title: row.get("title")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        album_artist: row.get("album_artist")?,
        genre: row.get("genre")?,
        year: row.get("year")?,
        track_no: row.get("track_no")?,
        duration_secs: row.get("duration_secs")?,
        has_cover: row.get::<_, i32>("has_cover")? != 0,
        cover_path: row.get("cover_path")?,
        likes,
        dislikes,
        is_favorite: is_fav_val != 0,
        is_ecstasy: is_ecstasy_val != 0,
        manual_select_count,
        play_count,
        skip_count,
        total_listen_secs,
        avg_listen_secs,
        permanent_score,
        temp_score: 0.0,
        effective_score: permanent_score,
        bpm,
        bpm_is_official,
        isrc,
        mbid,
        iswc,
        tags,
        credits,
        lyrics_plain,
        lyrics_synced,
        is_instrumental,
        deezer_id,
        enrichment_attempts,
    })
}


pub fn get_tracks(conn: &Connection) -> anyhow::Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tracks ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_no",
    )?;
    let rows = stmt.query_map([], row_to_track)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn get_albums(conn: &Connection) -> anyhow::Result<Vec<AlbumSummary>> {
    let mut stmt = conn.prepare(
        "SELECT album, album_artist, MAX(year) as year, COUNT(*) as cnt, MAX(cover_path) as cover_path FROM tracks
         GROUP BY album, album_artist ORDER BY album_artist COLLATE NOCASE, year",
    )?;
    let rows = stmt.query_map([], |row| {
        let album: String = row.get(0)?;
        let album_artist: String = row.get(1)?;
        let key = format!("{}::{}", album, album_artist);
        let is_fav = is_favorite(conn, "album", &key);
        Ok(AlbumSummary {
            album,
            album_artist,
            year: row.get(2)?,
            track_count: row.get(3)?,
            cover_path: row.get(4)?,
            is_favorite: is_fav,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn get_artists(conn: &Connection) -> anyhow::Result<Vec<ArtistSummary>> {
    let mut stmt = conn.prepare(
        "WITH all_artists AS (
            SELECT TRIM(artist) as name, id FROM tracks WHERE TRIM(artist) != ''
            UNION ALL
            SELECT TRIM(album_artist) as name, id FROM tracks WHERE TRIM(album_artist) != '' AND TRIM(album_artist) != TRIM(artist)
        )
        SELECT a.name as norm_artist, COUNT(DISTINCT a.id) as cnt, am.image_path, am.bio, am.members, am.is_group, COALESCE(am.is_favorite, 0),
               am.mbid, am.deezer_id, am.fan_count, am.life_span_begin, am.life_span_end, am.is_ended, am.death_cause, am.wikidata_qid, am.external_ids
        FROM all_artists a
        LEFT JOIN artist_metadata am ON LOWER(TRIM(am.artist)) = LOWER(a.name)
        GROUP BY LOWER(a.name)
        ORDER BY norm_artist COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        let artist_name: String = row.get(0)?;
        let is_group_int: Option<i32> = row.get(5)?;
        let is_fav_db: i32 = row.get(6).unwrap_or(0);
        let is_fav = is_fav_db != 0 || is_favorite(conn, "artist", &artist_name);
        let is_ended_int: Option<i32> = row.get(12).unwrap_or(None);
        let external_ids_json: Option<String> = row.get(15).unwrap_or(None);
        let external_ids = external_ids_json.and_then(|s| serde_json::from_str(&s).ok());
        Ok(ArtistSummary {
            artist: artist_name,
            track_count: row.get(1)?,
            image_path: row.get(2)?,
            bio: row.get(3)?,
            members: row.get(4)?,
            is_group: is_group_int.map(|v| v != 0),
            is_favorite: is_fav,
            mbid: row.get(7).unwrap_or(None),
            deezer_id: row.get(8).unwrap_or(None),
            fan_count: row.get(9).unwrap_or(None),
            life_span_begin: row.get(10).unwrap_or(None),
            life_span_end: row.get(11).unwrap_or(None),
            is_ended: is_ended_int.map(|v| v != 0),
            death_cause: row.get(13).unwrap_or(None),
            wikidata_qid: row.get(14).unwrap_or(None),
            external_ids,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn save_artist_metadata(
    conn: &Connection,
    artist: &str,
    genre: Option<&str>,
    bio: Option<&str>,
    members: Option<&str>,
    image_base64: Option<&str>,
) -> anyhow::Result<()> {
    let mut image_path = None;
    if let Some(b64_data) = image_base64 {
        let raw_b64 = if let Some(idx) = b64_data.find(',') {
            &b64_data[idx + 1..]
        } else {
            b64_data
        };
        use base64::Engine;
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw_b64) {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            bytes.hash(&mut hasher);
            let hash_val = hasher.finish();
            let ext = if b64_data.contains("image/png") { "png" } else { "jpg" };
            let filename = format!("artist_{:x}.{}", hash_val, ext);
            let dest_path = covers_dir().join(&filename);
            if std::fs::write(&dest_path, &bytes).is_ok() {
                image_path = Some(dest_path.to_string_lossy().to_string());
            }
        }
    }

    conn.execute(
        "INSERT INTO artist_metadata (artist, image_path, genre, bio, members)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(artist) DO UPDATE SET
            image_path = COALESCE(?2, image_path),
            genre = COALESCE(?3, genre),
            bio = COALESCE(?4, bio),
            members = COALESCE(?5, members)",
        params![artist, image_path, genre, bio, members],
    )?;
    Ok(())
}

pub fn set_artist_is_group(conn: &Connection, artist: &str, is_group: bool) -> anyhow::Result<()> {
    let val = if is_group { 1 } else { 0 };
    conn.execute(
        "INSERT INTO artist_metadata (artist, is_group)
         VALUES (?1, ?2)
         ON CONFLICT(artist) DO UPDATE SET is_group = ?2",
        params![artist, val],
    )?;
    Ok(())
}

pub fn create_playlist(conn: &Connection, id: &str, name: &str) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO playlists (id, name) VALUES (?1, ?2)",
        params![id, name],
    )?;
    Ok(())
}

pub fn get_playlists(conn: &Connection) -> anyhow::Result<Vec<Playlist>> {
    let mut playlists = Vec::new();

    // 1. Playlist système automatique : Titres Likés
    let liked_count: i32 = conn
        .query_row("SELECT COUNT(*) FROM tracks WHERE likes > 0", [], |r| r.get(0))
        .unwrap_or(0);

    playlists.push(Playlist {
        id: "system_liked_tracks".to_string(),
        name: "Titres Likés".to_string(),
        track_count: liked_count,
        is_system: Some(true),
    });

    // 2. Playlists utilisateur
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, COUNT(pt.track_id) FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         GROUP BY p.id, p.name ORDER BY p.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Playlist {
            id: row.get(0)?,
            name: row.get(1)?,
            track_count: row.get(2)?,
            is_system: Some(false),
        })
    })?;
    playlists.extend(rows.filter_map(Result::ok));
    Ok(playlists)
}

pub fn add_to_playlist(conn: &Connection, playlist_id: &str, track_id: &str) -> anyhow::Result<()> {
    if playlist_id == "system_liked_tracks" || playlist_id == "liked" {
        conn.execute(
            "UPDATE tracks SET likes = CASE WHEN likes <= 0 THEN 1 ELSE likes END WHERE id = ?1",
            params![track_id],
        )?;
        return Ok(());
    }

    let pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
        params![playlist_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
        params![playlist_id, track_id, pos],
    )?;
    Ok(())
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: &str) -> anyhow::Result<Vec<Track>> {
    if playlist_id == "system_liked_tracks" || playlist_id == "liked" {
        let mut stmt = conn.prepare(
            "SELECT * FROM tracks WHERE likes > 0 ORDER BY likes DESC, title COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], row_to_track)?;
        return Ok(rows.filter_map(Result::ok).collect());
    }

    let mut stmt = conn.prepare(
        "SELECT t.* FROM tracks t
         JOIN playlist_tracks pt ON pt.track_id = t.id
         WHERE pt.playlist_id = ?1 ORDER BY pt.position",
    )?;
    let rows = stmt.query_map(params![playlist_id], row_to_track)?;
    Ok(rows.filter_map(Result::ok).collect())
}


pub fn update_track_metadata(
    conn: &Connection,
    id: &str,
    title: &str,
    artist: &str,
    album: &str,
    genre: &str,
    year: i32,
    cover_path: Option<&str>,
    likes: Option<i32>,
    dislikes: Option<i32>,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE tracks SET
            title = ?1,
            artist = ?2,
            album = ?3,
            genre = ?4,
            year = ?5,
            has_cover = CASE WHEN ?6 IS NOT NULL THEN 1 ELSE has_cover END,
            cover_path = COALESCE(?6, cover_path),
            likes = COALESCE(?8, likes),
            dislikes = COALESCE(?9, dislikes)
         WHERE id = ?7",
        params![title, artist, album, genre, year, cover_path, id, likes, dislikes],
    )?;
    Ok(())
}

pub fn batch_update_metadata(
    conn: &mut Connection,
    updates: &[crate::models::TrackMetadataUpdate],
) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    for up in updates {
        let mut cover_path = None;
        if let Some(ref b64_data) = up.cover_base64 {
            let raw_b64 = if let Some(idx) = b64_data.find(',') {
                &b64_data[idx + 1..]
            } else {
                b64_data
            };
            use base64::Engine;
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw_b64) {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                bytes.hash(&mut hasher);
                let hash_val = hasher.finish();
                let ext = if b64_data.contains("image/png") { "png" } else { "jpg" };
                let filename = format!("{:x}.{}", hash_val, ext);
                let dest_path = covers_dir().join(&filename);
                if std::fs::write(&dest_path, &bytes).is_ok() {
                    cover_path = Some(dest_path.to_string_lossy().to_string());
                }
            }
        }

        tx.execute(
            "UPDATE tracks SET
                title = COALESCE(?1, title),
                artist = COALESCE(?2, artist),
                album = COALESCE(?3, album),
                genre = COALESCE(?4, genre),
                year = CASE WHEN ?5 IS NOT NULL AND ?5 > 0 THEN ?5 ELSE year END,
                has_cover = CASE WHEN ?6 IS NOT NULL THEN 1 ELSE has_cover END,
                cover_path = COALESCE(?6, cover_path)
             WHERE id = ?7",
            params![up.title, up.artist, up.album, up.genre, up.year, cover_path, up.track_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_album_metadata(
    conn: &mut Connection,
    old_album: &str,
    old_artist: &str,
    new_album: &str,
    new_artist: &str,
    year: i32,
    genre: &str,
    cover_base64: Option<&str>,
) -> anyhow::Result<()> {
    let mut cover_path = None;
    if let Some(b64_data) = cover_base64 {
        let raw_b64 = if let Some(idx) = b64_data.find(',') {
            &b64_data[idx + 1..]
        } else {
            b64_data
        };
        use base64::Engine;
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw_b64) {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            bytes.hash(&mut hasher);
            let hash_val = hasher.finish();
            let ext = if b64_data.contains("image/png") { "png" } else { "jpg" };
            let filename = format!("{:x}.{}", hash_val, ext);
            let dest_path = covers_dir().join(&filename);
            if std::fs::write(&dest_path, &bytes).is_ok() {
                cover_path = Some(dest_path.to_string_lossy().to_string());
            }
        }
    }

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tracks SET
            album = ?1,
            album_artist = ?2,
            year = CASE WHEN ?3 > 0 THEN ?3 ELSE year END,
            genre = CASE WHEN ?4 != '' THEN ?4 ELSE genre END,
            has_cover = CASE WHEN ?5 IS NOT NULL THEN 1 ELSE has_cover END,
            cover_path = COALESCE(?5, cover_path)
         WHERE album = ?6 AND (album_artist = ?7 OR artist = ?7)",
        params![new_album, new_artist, year, genre, cover_path, old_album, old_artist],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn rename_genre(conn: &Connection, old_genre: &str, new_genre: &str) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE tracks SET genre = REPLACE(genre, ?1, ?2) WHERE genre LIKE '%' || ?1 || '%'",
        params![old_genre, new_genre],
    )?;
    Ok(())
}

pub fn rename_playlist(conn: &Connection, playlist_id: &str, new_name: &str) -> anyhow::Result<()> {
    if playlist_id == "system_liked_tracks" || playlist_id == "liked" {
        anyhow::bail!("La playlist automatique 'Titres Likés' ne peut pas être renommée.");
    }
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        params![new_name, playlist_id],
    )?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, playlist_id: &str) -> anyhow::Result<()> {
    if playlist_id == "system_liked_tracks" || playlist_id == "liked" {
        anyhow::bail!("La playlist automatique 'Titres Likés' ne peut pas être supprimée.");
    }
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", params![playlist_id])?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])?;
    Ok(())
}


pub fn get_setting(conn: &Connection, key: &str, default_val: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .unwrap_or_else(|_| default_val.to_string())
}

pub fn set_setting(conn: &Connection, key: &str, val: &str) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, val],
    )?;
    Ok(())
}

pub fn get_all_settings(conn: &Connection) -> anyhow::Result<std::collections::HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = std::collections::HashMap::new();
    for r in rows {
        if let Ok((k, v)) = r {
            map.insert(k, v);
        }
    }
    Ok(map)
}

pub fn increment_like(conn: &Connection, track_id: &str) -> anyhow::Result<(i32, i32)> {
    conn.execute("UPDATE tracks SET likes = likes + 1 WHERE id = ?1 OR path = ?1", params![track_id])?;
    let _ = update_track_permanent_score(conn, track_id);
    let mut stmt = conn.prepare("SELECT likes, dislikes FROM tracks WHERE id = ?1 OR path = ?1")?;
    let res = stmt.query_row(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(res)
}

pub fn increment_dislike(conn: &Connection, track_id: &str) -> anyhow::Result<(i32, i32)> {
    conn.execute("UPDATE tracks SET dislikes = dislikes + 1 WHERE id = ?1 OR path = ?1", params![track_id])?;
    let _ = update_track_permanent_score(conn, track_id);
    let mut stmt = conn.prepare("SELECT likes, dislikes FROM tracks WHERE id = ?1 OR path = ?1")?;
    let res = stmt.query_row(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(res)
}

pub fn update_likes_dislikes(conn: &Connection, track_id: &str, likes: i32, dislikes: i32) -> anyhow::Result<()> {
    conn.execute("UPDATE tracks SET likes = ?1, dislikes = ?2 WHERE id = ?3 OR path = ?3", params![likes.max(0), dislikes.max(0), track_id])?;
    let _ = update_track_permanent_score(conn, track_id);
    Ok(())
}

pub fn toggle_favorite(conn: &Connection, target_type: &str, target_id: &str) -> anyhow::Result<bool> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM favorites WHERE target_type = ?1 AND (LOWER(target_id) = LOWER(?2) OR target_id IN (SELECT id FROM tracks WHERE path = ?2))")?;
    let count: i64 = stmt.query_row(params![target_type, target_id], |r| r.get(0)).unwrap_or(0);
    let is_fav = count > 0;

    let res_fav = if is_fav {
        conn.execute("DELETE FROM favorites WHERE target_type = ?1 AND (LOWER(target_id) = LOWER(?2) OR target_id IN (SELECT id FROM tracks WHERE path = ?2))", params![target_type, target_id])?;
        if target_type == "track" {
            let _ = conn.execute("UPDATE tracks SET is_favorite = 0 WHERE id = ?1 OR path = ?1", params![target_id]);
        } else if target_type == "artist" {
            let _ = conn.execute("UPDATE artist_metadata SET is_favorite = 0 WHERE LOWER(artist) = LOWER(?1)", params![target_id]);
        }
        false
    } else {
        conn.execute("INSERT OR REPLACE INTO favorites (target_type, target_id) VALUES (?1, ?2)", params![target_type, target_id])?;
        if target_type == "track" {
            let _ = conn.execute("UPDATE tracks SET is_favorite = 1 WHERE id = ?1 OR path = ?1", params![target_id]);
        } else if target_type == "artist" {
            let _ = conn.execute("INSERT INTO artist_metadata (artist, is_favorite) VALUES (?1, 1) ON CONFLICT(artist) DO UPDATE SET is_favorite = 1", params![target_id]);
        }
        true
    };

    if target_type == "track" {
        let _ = update_track_permanent_score(conn, target_id);
    }
    Ok(res_fav)
}

pub fn is_favorite(conn: &Connection, target_type: &str, target_id: &str) -> bool {
    let mut stmt = match conn.prepare("SELECT COUNT(*) FROM favorites WHERE target_type = ?1 AND (LOWER(target_id) = LOWER(?2) OR target_id IN (SELECT id FROM tracks WHERE path = ?2))") {
        Ok(s) => s,
        Err(_) => return false,
    };
    let count: i64 = stmt.query_row(params![target_type, target_id], |r| r.get(0)).unwrap_or(0);
    count > 0
}

#[allow(dead_code)]
pub fn add_play_history(conn: &Connection, track_id: &str) -> anyhow::Result<()> {
    conn.execute("INSERT INTO play_history (track_id) VALUES (?1)", params![track_id])?;
    Ok(())
}

pub fn get_play_history(conn: &Connection, limit: i64) -> anyhow::Result<Vec<crate::models::HistoryItem>> {
    let mut stmt = conn.prepare(
        "SELECT h.id, h.played_at, t.id, t.path, t.title, t.artist, t.album, t.album_artist, t.genre, t.year, t.track_no, t.duration_secs, t.has_cover, t.cover_path, t.likes, t.dislikes, t.is_favorite
         FROM play_history h
         JOIN tracks t ON t.id = h.track_id OR t.path = h.track_id
         ORDER BY h.id DESC LIMIT ?1"
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        let hist_id: i64 = row.get(0)?;
        let played_at: String = row.get(1)?;
        let track = Track {
            id: row.get(2)?,
            path: row.get(3)?,
            title: row.get(4)?,
            artist: row.get(5)?,
            album: row.get(6)?,
            album_artist: row.get(7)?,
            genre: row.get(8)?,
            year: row.get(9)?,
            track_no: row.get(10)?,
            duration_secs: row.get(11)?,
            has_cover: row.get::<_, i32>(12)? != 0,
            cover_path: row.get(13)?,
            likes: row.get(14).unwrap_or(0),
            dislikes: row.get(15).unwrap_or(0),
            is_favorite: row.get::<_, i32>(16).unwrap_or(0) != 0,
            is_ecstasy: false,
            manual_select_count: 0,

            play_count: 0,
            skip_count: 0,
            total_listen_secs: 0.0,
            avg_listen_secs: 0.0,
            permanent_score: 0.0,
            temp_score: 0.0,
            effective_score: 0.0,
            bpm: None,
            bpm_is_official: false,
            isrc: None,
            mbid: None,
            iswc: None,
            tags: Vec::new(),
            credits: Vec::new(),
            lyrics_plain: None,
            lyrics_synced: None,
            is_instrumental: None,
            deezer_id: None,
            enrichment_attempts: 0,
        };
        Ok(crate::models::HistoryItem {
            id: hist_id,
            track,
            played_at,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn clear_play_history(conn: &Connection) -> anyhow::Result<()> {
    conn.execute("DELETE FROM play_history", [])?;
    Ok(())
}

pub fn get_favorites_data(conn: &Connection) -> anyhow::Result<crate::models::FavoritesData> {
    let mut fav_tracks_stmt = conn.prepare(
        "SELECT * FROM tracks WHERE is_favorite = 1 OR id IN (SELECT target_id FROM favorites WHERE target_type = 'track') OR path IN (SELECT target_id FROM favorites WHERE target_type = 'track') ORDER BY title"
    )?;
    let fav_tracks = fav_tracks_stmt.query_map([], row_to_track)?.filter_map(Result::ok).collect();

    let all_albums = get_albums(conn)?;
    let fav_albums = all_albums.into_iter().filter(|a| a.is_favorite).collect();

    let all_artists = get_artists(conn)?;
    let fav_artists = all_artists.into_iter().filter(|a| a.is_favorite).collect();

    Ok(crate::models::FavoritesData {
        tracks: fav_tracks,
        albums: fav_albums,
        artists: fav_artists,
    })
}

pub fn get_track_live_stats(conn: &Connection, track_id: &str) -> anyhow::Result<(i32, i32, bool, bool)> {
    let mut stmt = conn.prepare("SELECT likes, dislikes, is_favorite, is_ecstasy FROM tracks WHERE id = ?1 OR path = ?1")?;
    let res = stmt.query_row(params![track_id], |r| {
        let likes: i32 = r.get(0).unwrap_or(0);
        let dislikes: i32 = r.get(1).unwrap_or(0);
        let is_fav_val: i32 = r.get(2).unwrap_or(0);
        let is_fav = is_fav_val != 0 || is_favorite(conn, "track", track_id);
        let is_ecstasy_val: i32 = r.get(3).unwrap_or(0);
        let is_ecstasy = is_ecstasy_val != 0 || is_favorite(conn, "ecstasy", track_id);
        Ok((likes, dislikes, is_fav, is_ecstasy))
    })?;
    Ok(res)
}

pub fn record_track_session(
    conn: &Connection,
    track_id: &str,
    listened_secs: f64,
    is_manual_select: bool,
    is_skip: bool,
    is_completed: bool,
) -> anyhow::Result<()> {
    if listened_secs < 10.0 {
        return Ok(());
    }

    let manual_inc = if is_manual_select { 1 } else { 0 };
    let play_inc = if is_completed { 1 } else { 0 };
    let skip_inc = if is_skip { 1 } else { 0 };

    conn.execute(
        "UPDATE tracks SET
            manual_select_count = manual_select_count + ?2,
            play_count = play_count + ?3,
            skip_count = skip_count + ?4,
            total_listen_secs = total_listen_secs + ?5
         WHERE id = ?1 OR path = ?1",
        params![track_id, manual_inc, play_inc, skip_inc, listened_secs],
    )?;

    let _ = conn.execute(
        "INSERT INTO play_history (track_id) VALUES (?1)",
        params![track_id],
    );

    let _ = update_track_permanent_score(conn, track_id);

    Ok(())
}


pub fn save_last_player_state(
    conn: &Connection,
    volume: f64,
    audio_device: Option<&str>,
    track_id: Option<&str>,
    position_secs: f64,
    queue_index: usize,
) -> anyhow::Result<()> {
    set_setting(conn, "last_volume", &volume.to_string())?;
    set_setting(conn, "last_audio_device", audio_device.unwrap_or(""))?;
    set_setting(conn, "last_track_id", track_id.unwrap_or(""))?;
    set_setting(conn, "last_position_secs", &position_secs.to_string())?;
    set_setting(conn, "last_queue_index", &queue_index.to_string())?;
    Ok(())
}

pub fn get_last_player_state(conn: &Connection) -> anyhow::Result<crate::models::LastPlayerState> {
    let vol_str = get_setting(conn, "last_volume", "0.8");
    let volume: f64 = vol_str.parse().unwrap_or(0.8);

    let dev_str = get_setting(conn, "last_audio_device", "");
    let audio_device = if dev_str.is_empty() { None } else { Some(dev_str) };

    let track_id_str = get_setting(conn, "last_track_id", "");
    let track_id = if track_id_str.is_empty() { None } else { Some(track_id_str) };

    let pos_str = get_setting(conn, "last_position_secs", "0.0");
    let position_secs: f64 = pos_str.parse().unwrap_or(0.0);

    let q_idx_str = get_setting(conn, "last_queue_index", "0");
    let queue_index: usize = q_idx_str.parse().unwrap_or(0);

    let mut track: Option<Track> = None;
    if let Some(ref tid) = track_id {
        let mut stmt = conn.prepare("SELECT * FROM tracks WHERE id = ?1 OR path = ?1")?;
        if let Ok(t) = stmt.query_row(params![tid], row_to_track) {
            track = Some(t);
        }
    }

    Ok(crate::models::LastPlayerState {
        volume,
        audio_device,
        track_id,
        position_secs,
        queue_index,
        track,
    })
}

// ============================================================================
// Ã‰galiseur graphique : profils, liaison Ã  un pÃ©riphÃ©rique de sortie
// ============================================================================

fn row_to_eq_profile(row: &rusqlite::Row) -> rusqlite::Result<EqProfile> {
    let gains_json: String = row.get("gains")?;
    let gains: Vec<f64> = serde_json::from_str(&gains_json).unwrap_or_else(|_| vec![0.0; 10]);
    Ok(EqProfile {
        id: row.get("id")?,
        name: row.get("name")?,
        preamp: row.get("preamp")?,
        gains,
        device_name: row.get("device_name")?,
    })
}

pub fn get_eq_profiles(conn: &Connection) -> anyhow::Result<Vec<EqProfile>> {
    let mut stmt = conn.prepare("SELECT * FROM eq_profiles ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], row_to_eq_profile)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn get_eq_profile(conn: &Connection, id: &str) -> anyhow::Result<EqProfile> {
    let mut stmt = conn.prepare("SELECT * FROM eq_profiles WHERE id = ?1")?;
    Ok(stmt.query_row(params![id], row_to_eq_profile)?)
}

/// Profil liÃ© au pÃ©riphÃ©rique de sortie donnÃ©, s'il en existe un.
pub fn get_eq_profile_for_device(conn: &Connection, device_name: &str) -> anyhow::Result<Option<EqProfile>> {
    let mut stmt = conn.prepare("SELECT * FROM eq_profiles WHERE device_name = ?1")?;
    let mut rows = stmt.query_map(params![device_name], row_to_eq_profile)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn create_eq_profile(conn: &Connection, id: &str, name: &str) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO eq_profiles (id, name, preamp, gains, device_name) VALUES (?1, ?2, 0.0, ?3, NULL)",
        params![id, name, DEFAULT_EQ_GAINS_JSON],
    )?;
    Ok(())
}

pub fn update_eq_profile(
    conn: &Connection,
    id: &str,
    name: &str,
    preamp: f64,
    gains: &[f64],
) -> anyhow::Result<()> {
    let gains_json = serde_json::to_string(gains)?;
    conn.execute(
        "UPDATE eq_profiles SET name = ?1, preamp = ?2, gains = ?3 WHERE id = ?4",
        params![name, preamp, gains_json, id],
    )?;
    Ok(())
}

pub fn delete_eq_profile(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM eq_profiles WHERE id = ?1", params![id])?;
    Ok(())
}

/// Lie (ou dÃ©lie, si `device_name` est `None`) un profil Ã  un pÃ©riphÃ©rique de
/// sortie. Un pÃ©riphÃ©rique ne peut Ãªtre liÃ© qu'Ã  un seul profil Ã  la fois :
/// on retire d'abord la liaison de tout autre profil qui le dÃ©tenait.
pub fn set_eq_profile_device(
    conn: &Connection,
    profile_id: &str,
    device_name: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(dev) = device_name {
        conn.execute(
            "UPDATE eq_profiles SET device_name = NULL WHERE device_name = ?1 AND id != ?2",
            params![dev, profile_id],
        )?;
    }
    conn.execute(
        "UPDATE eq_profiles SET device_name = ?1 WHERE id = ?2",
        params![device_name, profile_id],
    )?;
    Ok(())
}

// ============================================================================
// Enrichissement externe : Deezer / MusicBrainz / LRCLIB / Wikidata
// ============================================================================

/// Applique un enrichissement Ã  un morceau : seuls les champs `Some(...)`
/// Ã©crasent la valeur existante (permet de fusionner progressivement les
/// rÃ©sultats de plusieurs API sans Ã©craser ce qu'une autre a dÃ©jÃ  rempli).
/// Nombre de tentatives d'enrichissement avance deja comptabilisees pour une
/// piste (voir models::Track::enrichment_attempts pour la semantique exacte
/// : un "download failure" pur n'incremente jamais ce compteur).
pub fn get_enrichment_attempts(conn: &Connection, track_id: &str) -> anyhow::Result<i32> {
    Ok(conn
        .query_row(
            "SELECT enrichment_attempts FROM tracks WHERE id = ?1 OR path = ?1",
            params![track_id],
            |r| r.get(0),
        )
        .unwrap_or(0))
}

/// Incremente le compteur de tentatives d'une piste et renvoie sa nouvelle
/// valeur. A appeler uniquement quand une tentative d'enrichissement a
/// effectivement obtenu une reponse d'au moins une API (succes ou "rien
/// trouve"), jamais sur un pur echec reseau/telechargement -- voir
/// commands::batch_enrich_tracks.
pub fn increment_enrichment_attempts(conn: &Connection, track_id: &str) -> anyhow::Result<i32> {
    conn.execute(
        "UPDATE tracks SET enrichment_attempts = enrichment_attempts + 1 WHERE id = ?1 OR path = ?1",
        params![track_id],
    )?;
    get_enrichment_attempts(conn, track_id)
}

pub fn update_track_enrichment(conn: &Connection, e: &TrackEnrichment) -> anyhow::Result<()> {
    let tags_json = e.tags.as_ref().map(|t| serde_json::to_string(t)).transpose()?;
    let credits_json = e.credits.as_ref().map(|c| serde_json::to_string(c)).transpose()?;
    let is_instrumental_int = e.is_instrumental.map(|v| v as i32);
    let bpm_is_official_int = e.bpm.map(|_| 1i32);

    conn.execute(
        "UPDATE tracks SET
            bpm = COALESCE(?1, bpm),
            bpm_is_official = COALESCE(?12, bpm_is_official),
            isrc = COALESCE(?2, isrc),
            mbid = COALESCE(?3, mbid),
            iswc = COALESCE(?4, iswc),
            tags = COALESCE(?5, tags),
            credits = COALESCE(?6, credits),
            lyrics_plain = COALESCE(?7, lyrics_plain),
            lyrics_synced = COALESCE(?8, lyrics_synced),
            is_instrumental = COALESCE(?9, is_instrumental),
            deezer_id = COALESCE(?10, deezer_id)
         WHERE id = ?11",
        params![
            e.bpm,
            e.isrc,
            e.mbid,
            e.iswc,
            tags_json,
            credits_json,
            e.lyrics_plain,
            e.lyrics_synced,
            is_instrumental_int,
            e.deezer_id,
            e.track_id,
            bpm_is_official_int,
        ],
    )?;
    Ok(())
}

pub fn batch_update_track_enrichment(conn: &mut Connection, items: &[TrackEnrichment]) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    for e in items {
        let tags_json = e.tags.as_ref().map(|t| serde_json::to_string(t)).transpose()?;
        let credits_json = e.credits.as_ref().map(|c| serde_json::to_string(c)).transpose()?;
        let is_instrumental_int = e.is_instrumental.map(|v| v as i32);
        let bpm_is_official_int = e.bpm.map(|_| 1i32);
        tx.execute(
            "UPDATE tracks SET
                bpm = COALESCE(?1, bpm),
                bpm_is_official = COALESCE(?12, bpm_is_official),
                isrc = COALESCE(?2, isrc),
                mbid = COALESCE(?3, mbid),
                iswc = COALESCE(?4, iswc),
                tags = COALESCE(?5, tags),
                credits = COALESCE(?6, credits),
                lyrics_plain = COALESCE(?7, lyrics_plain),
                lyrics_synced = COALESCE(?8, lyrics_synced),
                is_instrumental = COALESCE(?9, is_instrumental),
                deezer_id = COALESCE(?10, deezer_id)
             WHERE id = ?11",
            params![
                e.bpm,
                e.isrc,
                e.mbid,
                e.iswc,
                tags_json,
                credits_json,
                e.lyrics_plain,
                e.lyrics_synced,
                is_instrumental_int,
                e.deezer_id,
                e.track_id,
                bpm_is_official_int,
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_track_estimated_bpm(conn: &Connection, track_id: &str, estimated_bpm: f64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE tracks SET bpm = ?1, bpm_is_official = 0 WHERE (id = ?2 OR path = ?2) AND (bpm IS NULL OR bpm_is_official = 0)",
        params![estimated_bpm, track_id],
    )?;
    Ok(())
}


/// Applique un enrichissement Ã  un artiste/groupe (crÃ©Ã© s'il n'existe pas
/// encore dans `artist_metadata`). MÃªme logique COALESCE que pour les morceaux.
pub fn update_artist_enrichment(conn: &Connection, e: &ArtistEnrichment) -> anyhow::Result<()> {
    let external_ids_json = e
        .external_ids
        .as_ref()
        .map(|m| serde_json::to_string(m))
        .transpose()?;
    let is_ended_int = e.is_ended.map(|v| v as i32);

    conn.execute(
        "INSERT INTO artist_metadata (artist, mbid, deezer_id, fan_count, life_span_begin, life_span_end, is_ended, death_cause, wikidata_qid, external_ids)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(artist) DO UPDATE SET
            mbid = COALESCE(?2, mbid),
            deezer_id = COALESCE(?3, deezer_id),
            fan_count = COALESCE(?4, fan_count),
            life_span_begin = COALESCE(?5, life_span_begin),
            life_span_end = COALESCE(?6, life_span_end),
            is_ended = COALESCE(?7, is_ended),
            death_cause = COALESCE(?8, death_cause),
            wikidata_qid = COALESCE(?9, wikidata_qid),
            external_ids = COALESCE(?10, external_ids)",
        params![
            e.artist,
            e.mbid,
            e.deezer_id,
            e.fan_count,
            e.life_span_begin,
            e.life_span_end,
            is_ended_int,
            e.death_cause,
            e.wikidata_qid,
            external_ids_json,
        ],
    )?;
    Ok(())
}

// ============================================================================
// User-Agent stats (table ua_api_stats)
// ============================================================================

/// Enregistre le résultat d'une requête pour un UA + API donnés.
/// `outcome` : "success" | "failure" | "block"  (429/403 -> "block")
pub fn record_ua_result(
    conn: &Connection,
    user_agent: &str,
    api: &str,
    outcome: &str,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO ua_api_stats (user_agent, api, last_used_at) VALUES (?1, ?2, ?3)",
        params![user_agent, api, now],
    )?;
    match outcome {
        "success" => {
            conn.execute(
                "UPDATE ua_api_stats SET success_count = success_count + 1, last_used_at = ?3, last_success_at = ?3 WHERE user_agent = ?1 AND api = ?2",
                params![user_agent, api, now],
            )?;
        }
        "block" => {
            conn.execute(
                "UPDATE ua_api_stats SET block_count = block_count + 1, last_used_at = ?3, last_block_at = ?3 WHERE user_agent = ?1 AND api = ?2",
                params![user_agent, api, now],
            )?;
        }
        _ => {
            conn.execute(
                "UPDATE ua_api_stats SET failure_count = failure_count + 1, last_used_at = ?3 WHERE user_agent = ?1 AND api = ?2",
                params![user_agent, api, now],
            )?;
        }
    }
    Ok(())
}

/// Charge les stats d'une API donnee pour le scorer UCB1.
/// Retourne Vec<(user_agent, success, failure, block, last_block_secs_ago)>
pub fn load_ua_stats_for_api(
    conn: &Connection,
    api: &str,
) -> Vec<(String, i64, i64, i64, Option<i64>)> {
    let mut stmt = match conn.prepare(
        "SELECT user_agent, success_count, failure_count, block_count, last_block_at
         FROM ua_api_stats WHERE api = ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = match stmt.query_map(params![api], |row| {
        let ua: String = row.get(0)?;
        let success: i64 = row.get(1)?;
        let failure: i64 = row.get(2)?;
        let block: i64 = row.get(3)?;
        let last_block_at: Option<String> = row.get(4)?;
        let last_block_secs_ago: Option<i64> = last_block_at.and_then(|ts| {
            chrono::DateTime::parse_from_rfc3339(&ts)
                .ok()
                .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds())
        });
        Ok((ua, success, failure, block, last_block_secs_ago))
    }) {
        Ok(mapped) => mapped,
        Err(_) => return vec![],
    };

    rows.filter_map(|r| r.ok()).collect()
}

// ════════════════════════════════════════════════════════════════════════════
// Règle Skip 70% — register_listen_event
// ════════════════════════════════════════════════════════════════════════════

/// Enregistre une écoute (complète ou skip) selon la règle des 70%.
/// - position_secs / duration_secs >= 0.70 → play_count++, total_listen_secs mis à jour
/// - Sinon → skip_count++, total_listen_secs mis à jour
pub fn register_listen_event(
    conn: &Connection,
    track_id: &str,
    position_secs: f64,
    duration_secs: f64,
) -> anyhow::Result<()> {
    let listen_ratio = if duration_secs > 0.0 {
        position_secs / duration_secs
    } else {
        0.0
    };

    if listen_ratio >= 0.70 {
        // Compter comme écoute complète
        conn.execute(
            "UPDATE tracks SET
                play_count = play_count + 1,
                total_listen_secs = total_listen_secs + ?1
             WHERE id = ?2 OR path = ?2",
            params![position_secs, track_id],
        )?;
    } else {
        // Compter comme skip
        conn.execute(
            "UPDATE tracks SET
                skip_count = skip_count + 1,
                total_listen_secs = total_listen_secs + ?1
             WHERE id = ?2 OR path = ?2",
            params![position_secs, track_id],
        )?;
    }
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// Smart Shuffle — Session
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SmartSession {
    pub id: i64,
    pub session_start: String,
    pub expires_at: String,
    pub recent_track_ids: Vec<String>,
    pub consecutive_skips: i64,
    pub consecutive_completes: i64,
    pub target_genre: Option<String>,
    pub target_artist: Option<String>,
    pub target_bpm_min: Option<f64>,
    pub target_bpm_max: Option<f64>,
    pub target_playlist_id: Option<String>,
    pub algo_feedback: Vec<AlgoFeedback>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AlgoFeedback {
    pub track_id: String,
    pub liked: bool,
}

/// Retourne la session active (non expirée) ou en crée une nouvelle de 24h.
pub fn get_or_create_smart_session(conn: &Connection) -> anyhow::Result<SmartSession> {
    // Chercher une session valide
    let now_str = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let existing: Option<SmartSession> = conn.query_row(
        "SELECT id, session_start, expires_at, recent_track_ids, consecutive_skips,
                consecutive_completes, target_genre, target_artist, target_bpm_min,
                target_bpm_max, algo_feedback, target_playlist_id
         FROM smart_shuffle_session
         WHERE expires_at > ?1
         ORDER BY id DESC LIMIT 1",
        params![now_str],
        |row| {
            let recent_ids_json: String = row.get(3).unwrap_or_else(|_| "[]".to_string());
            let feedback_json: String = row.get(10).unwrap_or_else(|_| "[]".to_string());
            Ok(SmartSession {
                id: row.get(0)?,
                session_start: row.get(1)?,
                expires_at: row.get(2)?,
                recent_track_ids: serde_json::from_str(&recent_ids_json).unwrap_or_default(),
                consecutive_skips: row.get(4).unwrap_or(0),
                consecutive_completes: row.get(5).unwrap_or(0),
                target_genre: row.get(6)?,
                target_artist: row.get(7)?,
                target_bpm_min: row.get(8)?,
                target_bpm_max: row.get(9)?,
                algo_feedback: serde_json::from_str(&feedback_json).unwrap_or_default(),
                target_playlist_id: row.get(11).ok().flatten(),
            })
        },
    ).ok();

    if let Some(session) = existing {
        return Ok(session);
    }

    // Créer une nouvelle session (TTL 24h)
    let expires_at = (chrono::Utc::now() + chrono::Duration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    conn.execute(
        "INSERT INTO smart_shuffle_session
            (session_start, expires_at, recent_track_ids, consecutive_skips,
             consecutive_completes, algo_feedback)
         VALUES (?1, ?2, '[]', 0, 0, '[]')",
        params![now_str, expires_at],
    )?;
    let id = conn.last_insert_rowid();
    Ok(SmartSession {
        id,
        session_start: now_str,
        expires_at,
        recent_track_ids: vec![],
        consecutive_skips: 0,
        consecutive_completes: 0,
        target_genre: None,
        target_artist: None,
        target_bpm_min: None,
        target_bpm_max: None,
        target_playlist_id: None,
        algo_feedback: vec![],
    })
}

/// Définit ou réinitialise la playlist cible du Smart Shuffle pour la session active.
pub fn set_smart_shuffle_playlist(
    conn: &Connection,
    playlist_id: Option<String>,
) -> anyhow::Result<SmartSession> {
    let session = get_or_create_smart_session(conn)?;
    conn.execute(
        "UPDATE smart_shuffle_session SET target_playlist_id = ?1 WHERE id = ?2",
        params![playlist_id, session.id],
    )?;
    get_or_create_smart_session(conn)
}

/// Met à jour la session après une fin de piste ou un skip.
/// event_type: "complete" | "skip"
pub fn update_smart_session(
    conn: &Connection,
    session_id: i64,
    track_id: &str,
    event_type: &str,
    track_genre: Option<&str>,
    track_artist: Option<&str>,
    track_bpm: Option<f64>,
) -> anyhow::Result<()> {
    // Charger session actuelle
    let (mut recent_ids, mut consec_skips, mut consec_completes, mut target_genre, mut target_artist, mut bpm_min, mut bpm_max): (
        Vec<String>, i64, i64, Option<String>, Option<String>, Option<f64>, Option<f64>
    ) = conn.query_row(
        "SELECT recent_track_ids, consecutive_skips, consecutive_completes,
                target_genre, target_artist, target_bpm_min, target_bpm_max
         FROM smart_shuffle_session WHERE id = ?1",
        params![session_id],
        |row| {
            let json: String = row.get(0).unwrap_or_else(|_| "[]".to_string());
            Ok((
                serde_json::from_str(&json).unwrap_or_default(),
                row.get(1).unwrap_or(0),
                row.get(2).unwrap_or(0),
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        },
    )?;

    // Mettre à jour les IDs récents (max 40 pour éviter les répétitions)
    recent_ids.push(track_id.to_string());
    if recent_ids.len() > 40 {
        recent_ids.remove(0);
    }

    let _ = add_play_history(conn, track_id);

    match event_type {
        "complete" => {
            consec_skips = 0;
            consec_completes += 1;
            // Après 2 écoutes complètes → orienter vers le style de cette piste
            if consec_completes >= 2 {
                if let Some(g) = track_genre {
                    if !g.is_empty() {
                        target_genre = Some(g.to_string());
                    }
                }
                if let Some(a) = track_artist {
                    if !a.is_empty() {
                        target_artist = Some(a.to_string());
                    }
                }
                if let Some(bpm) = track_bpm {
                    if bpm > 0.0 {
                        bpm_min = Some((bpm * 0.80).max(40.0));
                        bpm_max = Some(bpm * 1.20);
                    }
                }
            }
        }
        "skip" => {
            consec_completes = 0;
            consec_skips += 1;
            // Après 3 skips consécutifs → diversifier (effacer les cibles)
            if consec_skips >= 3 {
                target_genre = None;
                target_artist = None;
                bpm_min = None;
                bpm_max = None;
            }
        }
        _ => {}
    }

    let recent_json = serde_json::to_string(&recent_ids).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE smart_shuffle_session SET
            recent_track_ids = ?1,
            consecutive_skips = ?2,
            consecutive_completes = ?3,
            target_genre = ?4,
            target_artist = ?5,
            target_bpm_min = ?6,
            target_bpm_max = ?7
         WHERE id = ?8",
        params![recent_json, consec_skips, consec_completes, target_genre, target_artist, bpm_min, bpm_max, session_id],
    )?;
    Ok(())
}

/// Enregistre un feedback algo (like/dislike) dans la session.
pub fn add_algo_feedback(
    conn: &Connection,
    session_id: i64,
    track_id: &str,
    liked: bool,
) -> anyhow::Result<()> {
    let existing_json: String = conn.query_row(
        "SELECT algo_feedback FROM smart_shuffle_session WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "[]".to_string());

    let mut feedbacks: Vec<AlgoFeedback> =
        serde_json::from_str(&existing_json).unwrap_or_default();
    feedbacks.push(AlgoFeedback {
        track_id: track_id.to_string(),
        liked,
    });
    // Garder max 100 feedbacks
    if feedbacks.len() > 100 {
        feedbacks.remove(0);
    }

    let new_json = serde_json::to_string(&feedbacks).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE smart_shuffle_session SET algo_feedback = ?1 WHERE id = ?2",
        params![new_json, session_id],
    )?;

    // Mettre à jour le score global
    let delta = if liked { 12.0_f64 } else { -15.0_f64 };
    conn.execute(
        "INSERT INTO smart_shuffle_global (track_id, global_score, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(track_id) DO UPDATE SET
             global_score = global_score + ?2,
             updated_at = datetime('now')",
        params![track_id, delta],
    )?;
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// Smart Shuffle — Algorithme de sélection de la prochaine piste
// ════════════════════════════════════════════════════════════════════════════

/// Calcule et retourne la meilleure prochaine piste selon l'algorithme.
pub fn get_next_smart_track(
    conn: &Connection,
    session: &SmartSession,
    exclude_ids: &[String],
    queue_ids: &[String],
) -> anyhow::Result<Track> {
    use rand::Rng;

    let pool_tracks = if let Some(ref pid) = session.target_playlist_id {
        let pl_tracks = get_playlist_tracks(conn, pid)?;
        if pl_tracks.is_empty() {
            get_tracks(conn)?
        } else {
            pl_tracks
        }
    } else {
        get_tracks(conn)?
    };

    if pool_tracks.is_empty() {
        return Err(anyhow::anyhow!("Bibliothèque vide"));
    }

    let exclude_set: std::collections::HashSet<&String> = exclude_ids.iter().collect();
    let queue_set: std::collections::HashSet<&String> = queue_ids.iter().collect();

    // 1. Pénalités temporaires glissantes sur 24H enregistrées en base
    let penalties_24h = get_24h_play_penalties(conn).unwrap_or_default();

    // 2. Feedback algo de la session
    let mut algo_likes: std::collections::HashMap<&str, i32> = std::collections::HashMap::new();
    let mut algo_dislikes: std::collections::HashMap<&str, i32> = std::collections::HashMap::new();
    for fb in &session.algo_feedback {
        if fb.liked {
            *algo_likes.entry(fb.track_id.as_str()).or_insert(0) += 1;
        } else {
            *algo_dislikes.entry(fb.track_id.as_str()).or_insert(0) += 1;
        }
    }

    let consec_skips = session.consecutive_skips;
    let skip_penalty = (consec_skips as f64 * 4.0).min(25.0);

    // 3. Calcul du score effectif (Score Permanent - Pénalité Glissante 24h + Contextes)
    let candidate_scores: Vec<(&Track, f64)> = pool_tracks
        .iter()
        .map(|t| {
            let mut score = t.permanent_score;

            // Déduire la pénalité temporaire glissante de 24h
            if let Some(&pen) = penalties_24h.get(&t.id).or_else(|| penalties_24h.get(&t.path)) {
                score -= pen;
            }

            // Bonus de score temporaire +100 si la piste est dans la file d'attente utilisateur
            let is_in_queue = queue_set.contains(&t.id) || queue_set.contains(&t.path);
            if is_in_queue {
                score += 100.0;
            }

            // Pénalité stricte et dégressive pour l'historique récent de la session (si pas en file explicite)
            if !is_in_queue {
                if let Some(pos) = session.recent_track_ids.iter().rposition(|id| id == &t.id || id == &t.path) {
                    let total_recent = session.recent_track_ids.len();
                    let recency_index = total_recent - 1 - pos; // 0 = le plus récent, 1 = le 2e plus récent...
                    
                    // Exclusion quasi-absolue pour les 3 morceaux les plus récents (et le morceau en cours)
                    if recency_index < 3 && pool_tracks.len() > 3 {
                        score -= 5000.0;
                    } else {
                        // Pénalité dégressive selon la récence
                        let pen_score = (120.0 - (recency_index as f64 * 15.0)).max(20.0);
                        score -= pen_score;
                    }
                } else if exclude_set.contains(&t.id) || exclude_set.contains(&t.path) {
                    score -= 5000.0;
                }
            }

            // Contexte session (genre / artiste / BPM)
            if let Some(ref tgt_genre) = session.target_genre {
                if !tgt_genre.is_empty() && t.genre.to_lowercase().contains(&tgt_genre.to_lowercase()) {
                    score += 10.0;
                }
            }
            if let Some(ref tgt_artist) = session.target_artist {
                if !tgt_artist.is_empty()
                    && (t.artist.to_lowercase() == tgt_artist.to_lowercase()
                        || t.album_artist.to_lowercase() == tgt_artist.to_lowercase())
                {
                    score += 8.0;
                }
            }
            if let (Some(bpm_min), Some(bpm_max), Some(bpm)) =
                (session.target_bpm_min, session.target_bpm_max, t.bpm)
            {
                if bpm >= bpm_min && bpm <= bpm_max {
                    score += 6.0;
                } else {
                    let center = (bpm_min + bpm_max) / 2.0;
                    let dist = (bpm - center).abs() / center;
                    if dist < 0.4 {
                        score += 3.0 * (1.0 - dist / 0.4);
                    }
                }
            }

            // Feedback algo session
            if let Some(&n) = algo_likes.get(t.id.as_str()) {
                score += n as f64 * 12.0;
            }
            if let Some(&n) = algo_dislikes.get(t.id.as_str()) {
                score -= n as f64 * 18.0;
            }

            // Skips consécutifs
            if consec_skips >= 3 {
                if session.target_genre.is_some()
                    && t.genre.to_lowercase().contains(
                        &session.target_genre.as_deref().unwrap_or("").to_lowercase()
                    )
                {
                    score -= skip_penalty;
                }
            }

            // ── Règles spéciales Extase (Favoris+ / Transe / Bouffée d'oxygène) ──
            if t.is_ecstasy {
                if session.recent_track_ids.len() < 3 {
                    score -= 9999.0;
                } else if consec_skips >= 3 {
                    score += 90.0;
                } else {
                    score -= 40.0;
                }
            }

            (t, score)
        })
        .collect();


    // 4. Priorité absolue aux titres en file d'attente (si présente)
    if !queue_ids.is_empty() {
        for first_q_id in queue_ids {
            if let Some((target_track, eff_score)) = candidate_scores.iter().find(|(t, _)| &t.id == first_q_id || &t.path == first_q_id) {
                let mut track = (*target_track).clone();
                track.effective_score = *eff_score;
                track.temp_score = *eff_score - track.permanent_score;
                return Ok(track);
            }
        }
    }

    // 5. Échantillonnage aléatoire pondéré (Weighted Random Selection avec température adoucie)
    let max_score = candidate_scores
        .iter()
        .map(|(_, s)| *s)
        .fold(f64::NEG_INFINITY, f64::max);

    // Température plus élevée (25.0 au lieu de 5.0) pour éviter que le titre #1 n'écrase totalement tous les autres
    const TEMP: f64 = 25.0;
    let weights: Vec<f64> = candidate_scores
        .iter()
        .map(|(_, score)| {
            let diff = (score - max_score) / TEMP;
            diff.exp().max(0.00001)
        })
        .collect();

    let total_weight: f64 = weights.iter().sum();

    let mut rng = rand::thread_rng();
    let mut random_point = rng.gen_range(0.0..total_weight);

    for (idx, w) in weights.iter().enumerate() {
        if random_point <= *w {
            let (target_track, eff_score) = &candidate_scores[idx];
            let mut track = (*target_track).clone();
            track.effective_score = *eff_score;
            track.temp_score = *eff_score - track.permanent_score;
            return Ok(track);
        }
        random_point -= *w;
    }

    let (target_track, eff_score) = &candidate_scores[0];
    let mut track = (*target_track).clone();
    track.effective_score = *eff_score;
    track.temp_score = *eff_score - track.permanent_score;
    Ok(track)
}


/// Stats UA pour affichage frontend.
#[derive(serde::Serialize)]
pub struct UaStatRow {
    pub user_agent: String,
    pub api: String,
    pub success_count: i64,
    pub failure_count: i64,
    pub block_count: i64,
    pub last_used_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_block_at: Option<String>,
}

pub fn get_all_ua_stats(conn: &Connection) -> Vec<UaStatRow> {
    let mut stmt = match conn.prepare(
        "SELECT user_agent, api, success_count, failure_count, block_count,
                last_used_at, last_success_at, last_block_at
         FROM ua_api_stats
         ORDER BY api, (success_count * 1.0 / MAX(success_count + failure_count + block_count, 1)) DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = match stmt.query_map([], |row| {
        Ok(UaStatRow {
            user_agent: row.get(0)?,
            api: row.get(1)?,
            success_count: row.get(2)?,
            failure_count: row.get(3)?,
            block_count: row.get(4)?,
            last_used_at: row.get(5)?,
            last_success_at: row.get(6)?,
            last_block_at: row.get(7)?,
        })
    }) {
        Ok(mapped) => mapped,
        Err(_) => return vec![],
    };

    rows.filter_map(|r| r.ok()).collect()
}

pub fn radios_dir() -> PathBuf {
    let mut dir = dirs::data_local_dir().expect("dossier data local introuvable");
    dir.push("Rustify");
    dir.push("radios");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn get_radios(conn: &Connection) -> anyhow::Result<Vec<Radio>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, genre, country, stream_url, image_path, is_video, is_online, created_at
         FROM radios ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Radio {
            id: row.get(0)?,
            name: row.get(1)?,
            genre: row.get(2)?,
            country: row.get(3)?,
            stream_url: row.get(4)?,
            image_path: row.get(5)?,
            is_video: row.get::<_, i32>(6)? != 0,
            is_online: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8)?,
        })
    })?;
    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn save_radio(conn: &Connection, input: RadioInput) -> anyhow::Result<Radio> {
    let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    
    let mut image_path: Option<String> = None;
    if let Some(ref val) = input.image_base64 {
        if val.starts_with("http://") || val.starts_with("https://") {
            image_path = Some(val.clone());
        } else {
            let clean_b64 = if let Some(idx) = val.find(',') {
                &val[idx + 1..]
            } else {
                val
            };
            if let Ok(bytes) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, clean_b64) {
                let file_name = format!("{}.png", id);
                let target_path = radios_dir().join(&file_name);
                if std::fs::write(&target_path, bytes).is_ok() {
                    image_path = Some(target_path.to_string_lossy().to_string());
                }
            }
        }
    }

    if image_path.is_none() {
        let existing: Result<Option<String>, _> = conn.query_row(
            "SELECT image_path FROM radios WHERE id = ?1",
            params![id],
            |row| row.get(0),
        );
        if let Ok(ex_path) = existing {
            image_path = ex_path;
        }
    }

    conn.execute(
        "INSERT INTO radios (id, name, genre, country, stream_url, image_path, is_video)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            genre = excluded.genre,
            country = excluded.country,
            stream_url = excluded.stream_url,
            image_path = COALESCE(excluded.image_path, radios.image_path),
            is_video = excluded.is_video",
        params![
            id,
            input.name,
            input.genre,
            input.country,
            input.stream_url,
            image_path,
            if input.is_video { 1 } else { 0 }
        ],
    )?;

    let radio = conn.query_row(
        "SELECT id, name, genre, country, stream_url, image_path, is_video, is_online, created_at
         FROM radios WHERE id = ?1",
        params![id],
        |row| {
            Ok(Radio {
                id: row.get(0)?,
                name: row.get(1)?,
                genre: row.get(2)?,
                country: row.get(3)?,
                stream_url: row.get(4)?,
                image_path: row.get(5)?,
                is_video: row.get::<_, i32>(6)? != 0,
                is_online: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
            })
        },
    )?;

    Ok(radio)
}

pub fn delete_radio(conn: &Connection, id: &str) -> anyhow::Result<()> {
    if let Ok(img_path) = conn.query_row::<Option<String>, _, _>(
        "SELECT image_path FROM radios WHERE id = ?1",
        params![id],
        |r| r.get(0),
    ) {
        if let Some(p) = img_path {
            let _ = std::fs::remove_file(p);
        }
    }
    conn.execute("DELETE FROM radios WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_radio_status(conn: &Connection, id: &str, is_online: bool) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE radios SET is_online = ?1 WHERE id = ?2",
        params![if is_online { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn remove_from_playlist(conn: &Connection, playlist_id: &str, track_id: &str) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND (track_id = ?2 OR track_id IN (SELECT id FROM tracks WHERE path = ?2))",
        params![playlist_id, track_id],
    )?;
    Ok(())
}

pub fn delete_track(conn: &Connection, track_id: &str, delete_file: bool) -> anyhow::Result<()> {
    let mut stmt = conn.prepare("SELECT path FROM tracks WHERE id = ?1 OR path = ?1")?;
    let paths: Vec<String> = stmt
        .query_map(params![track_id], |r| r.get(0))?
        .filter_map(Result::ok)
        .collect();

    for track_path in &paths {
        if delete_file {
            let p = std::path::Path::new(track_path);
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
        conn.execute(
            "DELETE FROM playlist_tracks WHERE track_id IN (SELECT id FROM tracks WHERE path = ?1 OR id = ?1)",
            params![track_path],
        )?;
        conn.execute(
            "DELETE FROM favorites WHERE target_id = ?1 OR target_id IN (SELECT id FROM tracks WHERE path = ?1 OR id = ?1)",
            params![track_path],
        )?;
        conn.execute(
            "DELETE FROM play_history WHERE track_id IN (SELECT id FROM tracks WHERE path = ?1 OR id = ?1)",
            params![track_path],
        )?;
        conn.execute(
            "DELETE FROM tracks WHERE path = ?1 OR id = ?1",
            params![track_path],
        )?;
    }

    conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![track_id])?;
    conn.execute("DELETE FROM favorites WHERE target_id = ?1", params![track_id])?;
    conn.execute("DELETE FROM play_history WHERE track_id = ?1", params![track_id])?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;

    Ok(())
}

pub fn delete_artist(conn: &Connection, artist_name: &str, delete_files: bool) -> anyhow::Result<usize> {
    let mut stmt = conn.prepare("SELECT id, path FROM tracks WHERE LOWER(artist) = LOWER(?1) OR LOWER(album_artist) = LOWER(?1)")?;
    let tracks: Vec<(String, String)> = stmt
        .query_map(params![artist_name], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(Result::ok)
        .collect();

    let count = tracks.len();
    for (tid, path) in &tracks {
        if delete_files {
            let p = std::path::Path::new(path);
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
        conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![tid])?;
        conn.execute("DELETE FROM favorites WHERE target_id = ?1 OR target_id = ?2", params![tid, path])?;
        conn.execute("DELETE FROM play_history WHERE track_id = ?1", params![tid])?;
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![tid])?;
    }

    conn.execute("DELETE FROM artist_metadata WHERE LOWER(artist) = LOWER(?1)", params![artist_name])?;
    conn.execute("DELETE FROM favorites WHERE target_type = 'artist' AND LOWER(target_id) = LOWER(?1)", params![artist_name])?;

    Ok(count)
}

pub fn delete_album(conn: &Connection, album_name: &str, artist_name: Option<&str>, delete_files: bool) -> anyhow::Result<usize> {
    let tracks: Vec<(String, String)> = if let Some(art) = artist_name {
        let mut stmt = conn.prepare("SELECT id, path FROM tracks WHERE LOWER(album) = LOWER(?1) AND (LOWER(artist) = LOWER(?2) OR LOWER(album_artist) = LOWER(?2))")?;
        let res = stmt.query_map(params![album_name, art], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(Result::ok)
            .collect();
        res
    } else {
        let mut stmt = conn.prepare("SELECT id, path FROM tracks WHERE LOWER(album) = LOWER(?1)")?;
        let res = stmt.query_map(params![album_name], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(Result::ok)
            .collect();
        res
    };

    let count = tracks.len();
    for (tid, path) in &tracks {
        if delete_files {
            let p = std::path::Path::new(path);
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
        conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![tid])?;
        conn.execute("DELETE FROM favorites WHERE target_id = ?1 OR target_id = ?2", params![tid, path])?;
        conn.execute("DELETE FROM play_history WHERE track_id = ?1", params![tid])?;
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![tid])?;
    }

    conn.execute("DELETE FROM favorites WHERE target_type = 'album' AND LOWER(target_id) = LOWER(?1)", params![album_name])?;

    Ok(count)
}

pub fn delete_genre(conn: &Connection, genre_name: &str, delete_files: bool) -> anyhow::Result<usize> {
    let mut stmt = conn.prepare("SELECT id, path FROM tracks WHERE LOWER(genre) = LOWER(?1)")?;
    let tracks: Vec<(String, String)> = stmt
        .query_map(params![genre_name], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(Result::ok)
        .collect();

    let count = tracks.len();
    for (tid, path) in &tracks {
        if delete_files {
            let p = std::path::Path::new(path);
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
        conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![tid])?;
        conn.execute("DELETE FROM favorites WHERE target_id = ?1 OR target_id = ?2", params![tid, path])?;
        conn.execute("DELETE FROM play_history WHERE track_id = ?1", params![tid])?;
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![tid])?;
    }

    Ok(count)
}


