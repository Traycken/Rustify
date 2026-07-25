use crate::db;
use crate::models::{ScanReport, Track};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use rusqlite::Connection;
use std::path::Path;
use uuid::Uuid;
use walkdir::WalkDir;

const EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"];

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn scan_directory(conn: &Connection, root: &str) -> anyhow::Result<ScanReport> {
    let mut report = ScanReport {
        scanned_files: 0,
        imported_tracks: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_audio(e.path()))
    {
        report.scanned_files += 1;
        let path = entry.path();
        match read_track(path) {
            Ok(track) => {
                if db::upsert_track(conn, &track).is_ok() {
                    report.imported_tracks += 1;
                } else {
                    report.skipped += 1;
                }
            }
            Err(e) => {
                report.skipped += 1;
                report.errors.push(format!("{}: {}", path.display(), e));
            }
        }
    }

    Ok(report)
}

fn read_track(path: &Path) -> anyhow::Result<Track> {
    let tagged = Probe::open(path)?.read()?;
    let properties = tagged.properties();
    let duration_secs = properties.duration().as_secs_f64();

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    let file_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Piste inconnue")
        .to_string();

    let parse_year = |t: &lofty::tag::Tag| -> i32 {
        if let Some(y) = t.year() {
            if y > 0 {
                return y as i32;
            }
        }
        let keys = [
            lofty::tag::ItemKey::Year,
            lofty::tag::ItemKey::RecordingDate,
            lofty::tag::ItemKey::OriginalReleaseDate,
        ];
        for key in &keys {
            if let Some(s) = t.get_string(key) {
                let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
                if digits.len() >= 4 {
                    if let Ok(parsed) = digits[..4].parse::<i32>() {
                        if (1800..=2100).contains(&parsed) {
                            return parsed;
                        }
                    }
                }
            }
        }
        0
    };

    let (title, artist, album, album_artist, genre, year, track_no) = match tag {
        Some(t) => (
            t.title().map(|s| s.to_string()).unwrap_or(file_stem),
            t.artist().map(|s| s.to_string()).unwrap_or_else(|| "Artiste inconnu".into()),
            t.album().map(|s| s.to_string()).unwrap_or_else(|| "Album inconnu".into()),
            t.get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string())
                .unwrap_or_else(|| t.artist().map(|s| s.to_string()).unwrap_or_else(|| "Artiste inconnu".into())),
            t.genre().map(|s| s.to_string()).unwrap_or_default(),
            parse_year(t),
            t.track().unwrap_or(0) as i32,
        ),
        None => (
            file_stem,
            "Artiste inconnu".into(),
            "Album inconnu".into(),
            "Artiste inconnu".into(),
            String::new(),
            0,
            0,
        ),
    };

    let mut has_cover = false;
    let mut cover_path = None;

    if let Some(t) = tag {
        if let Some(pic) = t.pictures().first() {
            has_cover = true;
            let ext = match pic.mime_type() {
                Some(lofty::picture::MimeType::Png) => "png",
                Some(lofty::picture::MimeType::Jpeg) => "jpg",
                _ => {
                    let data = pic.data();
                    if data.len() >= 4 && &data[0..4] == b"\x89PNG" {
                        "png"
                    } else {
                        "jpg"
                    }
                }
            };

            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            pic.data().hash(&mut hasher);
            let hash_val = hasher.finish();
            let filename = format!("{:x}.{}", hash_val, ext);
            let dest_path = db::covers_dir().join(&filename);
            if !dest_path.exists() {
                let _ = std::fs::write(&dest_path, pic.data());
            }
            cover_path = Some(dest_path.to_string_lossy().to_string());
        }
    }

    Ok(Track {
        id: Uuid::new_v4().to_string(),
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        album_artist,
        genre,
        year,
        track_no,
        duration_secs,
        has_cover,
        cover_path,
        likes: 0,
        dislikes: 0,
        is_favorite: false,
        manual_select_count: 0,
        play_count: 0,
        skip_count: 0,
        total_listen_secs: 0.0,
        avg_listen_secs: 0.0,
    })
}
