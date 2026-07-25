use crate::models::{AlbumSummary, ArtistSummary, Playlist, Track};
use rusqlite::{params, Connection};
use std::path::PathBuf;

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
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_history_played_at ON play_history(played_at DESC);
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
    let _ = conn.execute("UPDATE tracks SET artist = TRIM(artist), album_artist = TRIM(album_artist), album = TRIM(album)", []);
    Ok(conn)
}

pub fn upsert_track(conn: &Connection, t: &Track) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO tracks (id, path, title, artist, album, album_artist, genre, year, track_no, duration_secs, has_cover, cover_path, likes, dislikes, is_favorite, manual_select_count, play_count, skip_count, total_listen_secs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
         ON CONFLICT(path) DO UPDATE SET
            title=excluded.title, artist=excluded.artist, album=excluded.album,
            album_artist=excluded.album_artist, genre=excluded.genre, year=excluded.year,
            track_no=excluded.track_no, duration_secs=excluded.duration_secs, has_cover=excluded.has_cover,
            cover_path=excluded.cover_path",
        params![t.id, t.path, t.title, t.artist, t.album, t.album_artist, t.genre, t.year, t.track_no, t.duration_secs, t.has_cover as i32, t.cover_path, t.likes, t.dislikes, t.is_favorite as i32, t.manual_select_count, t.play_count, t.skip_count, t.total_listen_secs],
    )?;
    Ok(())
}

fn row_to_track(row: &rusqlite::Row) -> rusqlite::Result<Track> {
    let likes: i32 = row.get("likes").unwrap_or(0);
    let dislikes: i32 = row.get("dislikes").unwrap_or(0);
    let is_fav_val: i32 = row.get("is_favorite").unwrap_or(0);
    let manual_select_count: i32 = row.get("manual_select_count").unwrap_or(0);
    let play_count: i32 = row.get("play_count").unwrap_or(0);
    let skip_count: i32 = row.get("skip_count").unwrap_or(0);
    let total_listen_secs: f64 = row.get("total_listen_secs").unwrap_or(0.0);
    let total_sessions = play_count + skip_count;
    let avg_listen_secs = if total_sessions > 0 {
        total_listen_secs / (total_sessions as f64)
    } else if play_count > 0 {
        total_listen_secs / (play_count as f64)
    } else {
        0.0
    };

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
        manual_select_count,
        play_count,
        skip_count,
        total_listen_secs,
        avg_listen_secs,
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
        SELECT a.name as norm_artist, COUNT(DISTINCT a.id) as cnt, am.image_path, am.bio, am.members, am.is_group, COALESCE(am.is_favorite, 0)
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
        Ok(ArtistSummary {
            artist: artist_name,
            track_count: row.get(1)?,
            image_path: row.get(2)?,
            bio: row.get(3)?,
            members: row.get(4)?,
            is_group: is_group_int.map(|v| v != 0),
            is_favorite: is_fav,
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
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn add_to_playlist(conn: &Connection, playlist_id: &str, track_id: &str) -> anyhow::Result<()> {
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
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        params![new_name, playlist_id],
    )?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, playlist_id: &str) -> anyhow::Result<()> {
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
    let mut stmt = conn.prepare("SELECT likes, dislikes FROM tracks WHERE id = ?1 OR path = ?1")?;
    let res = stmt.query_row(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(res)
}

pub fn increment_dislike(conn: &Connection, track_id: &str) -> anyhow::Result<(i32, i32)> {
    conn.execute("UPDATE tracks SET dislikes = dislikes + 1 WHERE id = ?1 OR path = ?1", params![track_id])?;
    let mut stmt = conn.prepare("SELECT likes, dislikes FROM tracks WHERE id = ?1 OR path = ?1")?;
    let res = stmt.query_row(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(res)
}

pub fn update_likes_dislikes(conn: &Connection, track_id: &str, likes: i32, dislikes: i32) -> anyhow::Result<()> {
    conn.execute("UPDATE tracks SET likes = ?1, dislikes = ?2 WHERE id = ?3 OR path = ?3", params![likes.max(0), dislikes.max(0), track_id])?;
    Ok(())
}

pub fn toggle_favorite(conn: &Connection, target_type: &str, target_id: &str) -> anyhow::Result<bool> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM favorites WHERE target_type = ?1 AND (LOWER(target_id) = LOWER(?2) OR target_id IN (SELECT id FROM tracks WHERE path = ?2))")?;
    let count: i64 = stmt.query_row(params![target_type, target_id], |r| r.get(0)).unwrap_or(0);
    let is_fav = count > 0;

    if is_fav {
        conn.execute("DELETE FROM favorites WHERE target_type = ?1 AND (LOWER(target_id) = LOWER(?2) OR target_id IN (SELECT id FROM tracks WHERE path = ?2))", params![target_type, target_id])?;
        if target_type == "track" {
            let _ = conn.execute("UPDATE tracks SET is_favorite = 0 WHERE id = ?1 OR path = ?1", params![target_id]);
        } else if target_type == "artist" {
            let _ = conn.execute("UPDATE artist_metadata SET is_favorite = 0 WHERE LOWER(artist) = LOWER(?1)", params![target_id]);
        }
        Ok(false)
    } else {
        conn.execute("INSERT OR REPLACE INTO favorites (target_type, target_id) VALUES (?1, ?2)", params![target_type, target_id])?;
        if target_type == "track" {
            let _ = conn.execute("UPDATE tracks SET is_favorite = 1 WHERE id = ?1 OR path = ?1", params![target_id]);
        } else if target_type == "artist" {
            let _ = conn.execute("INSERT INTO artist_metadata (artist, is_favorite) VALUES (?1, 1) ON CONFLICT(artist) DO UPDATE SET is_favorite = 1", params![target_id]);
        }
        Ok(true)
    }
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
            manual_select_count: 0,
            play_count: 0,
            skip_count: 0,
            total_listen_secs: 0.0,
            avg_listen_secs: 0.0,
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

pub fn get_track_live_stats(conn: &Connection, track_id: &str) -> anyhow::Result<(i32, i32, bool)> {
    let mut stmt = conn.prepare("SELECT likes, dislikes, is_favorite FROM tracks WHERE id = ?1 OR path = ?1")?;
    let res = stmt.query_row(params![track_id], |r| {
        let likes: i32 = r.get(0).unwrap_or(0);
        let dislikes: i32 = r.get(1).unwrap_or(0);
        let is_fav_val: i32 = r.get(2).unwrap_or(0);
        let is_fav = is_fav_val != 0 || is_favorite(conn, "track", track_id);
        Ok((likes, dislikes, is_fav))
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
