use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};


use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloaderEnvStatus {
    pub uv_installed: bool,
    pub venv_ready: bool,
    pub spotdl_installed: bool,
    pub yt_dlp_installed: bool,
    pub ffmpeg_installed: bool,
    pub env_path: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub url: String,
    pub output_dir: Option<String>,
    pub threads: Option<u32>,
    pub audio_sources: Option<Vec<String>>,
    pub cookies_from_browser: Option<String>,
    pub extra_yt_dlp_args: Option<String>,
    pub extra_spotdl_args: Option<String>,
    pub auto_scan: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloaderLogPayload {
    pub line: String,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloaderFinishedPayload {
    pub success: bool,
    pub code: Option<i32>,
    pub output_dir: String,
    pub message: String,
}

pub fn env_dir() -> PathBuf {
    let mut dir = dirs::data_local_dir().expect("Dossier data local introuvable");
    dir.push("Rustify");
    dir.push("env");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn bin_dir() -> PathBuf {
    let dir = env_dir().join("bin");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn venv_dir() -> PathBuf {
    env_dir().join("venv")
}

pub fn venv_scripts_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir().join("Scripts")
    } else {
        venv_dir().join("bin")
    }
}

pub fn uv_exe_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        bin_dir().join("uv.exe")
    } else {
        bin_dir().join("uv")
    }
}

pub fn spotdl_exe_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_scripts_dir().join("spotdl.exe")
    } else {
        venv_scripts_dir().join("spotdl")
    }
}

pub fn yt_dlp_exe_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_scripts_dir().join("yt-dlp.exe")
    } else {
        venv_scripts_dir().join("yt-dlp")
    }
}

pub fn python_exe_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_scripts_dir().join("python.exe")
    } else {
        venv_scripts_dir().join("python")
    }
}

pub fn ffmpeg_exe_path() -> PathBuf {
    let bin_ffmpeg = if cfg!(target_os = "windows") {
        bin_dir().join("ffmpeg.exe")
    } else {
        bin_dir().join("ffmpeg")
    };

    if bin_ffmpeg.exists() {
        return bin_ffmpeg;
    }

    let venv_ffmpeg = if cfg!(target_os = "windows") {
        venv_scripts_dir().join("ffmpeg.exe")
    } else {
        venv_scripts_dir().join("ffmpeg")
    };

    if venv_ffmpeg.exists() {
        return venv_ffmpeg;
    }

    let spotdl_ffmpeg = if cfg!(target_os = "windows") {
        env_dir().join("ffmpeg.exe")
    } else {
        env_dir().join("ffmpeg")
    };

    if spotdl_ffmpeg.exists() {
        return spotdl_ffmpeg;
    }

    bin_ffmpeg
}

pub fn check_env_status() -> DownloaderEnvStatus {
    let uv = uv_exe_path().exists();
    let py = python_exe_path().exists();
    let spotdl = spotdl_exe_path().exists();
    let ytdlp = yt_dlp_exe_path().exists();
    let ffmpeg = ffmpeg_exe_path().exists();

    let venv_ready = py;
    let env_p = env_dir().to_string_lossy().to_string();

    let mut details = Vec::new();
    if uv {
        details.push("UV: OK");
    } else {
        details.push("UV: Manquant");
    }

    if venv_ready {
        details.push("Python: OK");
    } else {
        details.push("Python: Manquant");
    }

    if spotdl {
        details.push("spotDL: OK");
    } else {
        details.push("spotDL: Manquant");
    }

    if ytdlp {
        details.push("yt-dlp: OK");
    } else {
        details.push("yt-dlp: Manquant");
    }

    if ffmpeg {
        details.push("FFmpeg: OK");
    } else {
        details.push("FFmpeg: Non détecté dans l'env");
    }

    DownloaderEnvStatus {
        uv_installed: uv,
        venv_ready,
        spotdl_installed: spotdl,
        yt_dlp_installed: ytdlp,
        ffmpeg_installed: ffmpeg,
        env_path: env_p,
        details: details.join(" | "),
    }
}

pub async fn setup_env<F>(log_cb: F) -> Result<DownloaderEnvStatus, String>
where
    F: Fn(String, bool) + Send + Sync + 'static,
{
    log_cb("▶ Vérification & initialisation de l'environnement embarqué (UV, Python, spotDL, yt-dlp, FFmpeg)...".to_string(), false);

    // 1. Télécharger uv.exe si manquant
    let uv_path = uv_exe_path();
    if !uv_path.exists() {
        log_cb("⬇ Téléchargement de uv (gestionnaire d'environnement Python ultra-rapide)...".to_string(), false);
        let uv_url = if cfg!(target_os = "windows") {
            "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
        } else if cfg!(target_os = "macos") {
            "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz"
        } else {
            "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz"
        };

        let response = reqwest::get(uv_url)
            .await
            .map_err(|e| format!("Erreur lors du téléchargement de uv: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Échec du téléchargement de uv HTTP {}", response.status()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Erreur de lecture des octets uv: {}", e))?;

        if cfg!(target_os = "windows") {
            let cursor = Cursor::new(bytes);
            let mut zip = zip::ZipArchive::new(cursor)
                .map_err(|e| format!("Échec de décompression du fichier zip uv: {}", e))?;

            for i in 0..zip.len() {
                let mut file = zip.by_index(i).map_err(|e| format!("Fichier zip invalide: {}", e))?;
                let file_name = file.name().to_string();
                if file_name.ends_with("uv.exe") {
                    let mut out_file = std::fs::File::create(&uv_path)
                        .map_err(|e| format!("Erreur de création de uv.exe: {}", e))?;
                    std::io::copy(&mut file, &mut out_file)
                        .map_err(|e| format!("Erreur d'écriture de uv.exe: {}", e))?;
                    break;
                }
            }
        }

        if !uv_path.exists() {
            return Err("Échec de l'installation de uv.exe dans le dossier bin".to_string());
        }
        log_cb("✔ UV installé avec succès dans l'environnement embarqué.".to_string(), false);
    } else {
        log_cb("✔ UV déjà présent.".to_string(), false);
    }

    // 2. Créer Virtualenv via UV (Python 3.12)
    let py_path = python_exe_path();
    if !py_path.exists() {
        log_cb("⚙ Création du Virtualenv Python 3.12 autonome via UV...".to_string(), false);
        let venv_p = venv_dir();
        let output = Command::new(uv_exe_path())
            .arg("venv")
            .arg(&venv_p)
            .arg("--python")
            .arg("3.12")
            .output()
            .await
            .map_err(|e| format!("Erreur lors de l'exécution de uv venv: {}", e))?;

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            log_cb(format!("Avertissement uv venv: {}", err_msg), true);
            let output_fallback = Command::new(uv_exe_path())
                .arg("venv")
                .arg(&venv_p)
                .output()
                .await
                .map_err(|e| format!("Erreur fallback uv venv: {}", e))?;
            if !output_fallback.status.success() {
                return Err(format!("Échec de création du venv Python: {}", String::from_utf8_lossy(&output_fallback.stderr)));
            }
        }
        log_cb("✔ Virtualenv Python créé avec succès.".to_string(), false);
    } else {
        log_cb("✔ Virtualenv Python déjà présent.".to_string(), false);
    }

    // 3. Installer spotDL et yt-dlp via UV PIP
    let spotdl_p = spotdl_exe_path();
    let ytdlp_p = yt_dlp_exe_path();
    if !spotdl_p.exists() || !ytdlp_p.exists() {
        log_cb("📦 Installation / mise à jour de spotDL et yt-dlp dans l'environnement...".to_string(), false);
        let output = Command::new(uv_exe_path())
            .arg("pip")
            .arg("install")
            .arg("--upgrade")
            .arg("spotdl")
            .arg("yt-dlp")
            .arg("--python")
            .arg(python_exe_path())
            .output()
            .await
            .map_err(|e| format!("Erreur lors de uv pip install: {}", e))?;

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Échec de l'installation de spotDL/yt-dlp: {}", err_msg));
        }
        log_cb("✔ spotDL et yt-dlp installés avec succès.".to_string(), false);
    } else {
        log_cb("✔ spotDL et yt-dlp sont prêts.".to_string(), false);
    }

    // 4. Installer FFmpeg si non présent
    let ffmpeg_p = ffmpeg_exe_path();
    if !ffmpeg_p.exists() {
        log_cb("🎬 Téléchargement et configuration de FFmpeg...".to_string(), false);
        let spotdl_exe = spotdl_exe_path();
        if spotdl_exe.exists() {
            let path_env = std::env::var_os("PATH").unwrap_or_default();

            let mut paths = std::env::split_paths(&path_env).collect::<Vec<_>>();
            paths.insert(0, bin_dir());
            paths.insert(0, venv_scripts_dir());
            let new_path = std::env::join_paths(paths).unwrap_or(path_env);

            let output = Command::new(&spotdl_exe)
                .arg("--download-ffmpeg")
                .env("PATH", new_path)
                .current_dir(env_dir())
                .output()
                .await;

            if let Ok(out) = output {
                if out.status.success() {
                    log_cb("✔ FFmpeg téléchargé par spotDL avec succès.".to_string(), false);
                } else {
                    log_cb(format!("Avertissement téléchargement FFmpeg: {}", String::from_utf8_lossy(&out.stderr)), true);
                }
            }
        }
    } else {
        log_cb("✔ FFmpeg déjà présent.".to_string(), false);
    }

    let status = check_env_status();
    log_cb(format!("🎉 Environnement embarqué prêt ! {}", status.details), false);
    Ok(status)
}

pub async fn run_download(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: DownloadOptions,
) -> Result<(), String> {
    let url = opts.url.trim().to_string();
    if url.is_empty() {
        return Err("L'URL fournie est vide".to_string());
    }

    let status = check_env_status();
    if !status.spotdl_installed || !status.venv_ready {
        let app_handle_clone = app.clone();
        setup_env(move |msg, is_err| {
            let _ = app_handle_clone.emit(
                "downloader-log",
                DownloaderLogPayload {
                    line: msg,
                    is_error: is_err,
                },
            );
        })
        .await?;
    }

    // Déterminer le dossier de sortie
    let output_dir = if let Some(d) = opts.output_dir.clone() {
        if !d.trim().is_empty() {
            PathBuf::from(d)
        } else {
            get_default_download_dir(&state)
        }
    } else {
        get_default_download_dir(&state)
    };

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Impossible de créer le dossier de sortie: {}", e))?;

    let output_dir_str = output_dir.to_string_lossy().to_string();

    let threads = opts.threads.unwrap_or(16);

    let audio_sources = opts
        .audio_sources
        .clone()
        .unwrap_or_else(|| vec!["youtube".to_string(), "youtube-music".to_string(), "soundcloud".to_string()]);

    let cookies_browser = opts
        .cookies_from_browser
        .clone()
        .unwrap_or_else(|| "brave".to_string());

    let extra_yt_dlp = opts.extra_yt_dlp_args.clone().unwrap_or_default();
    let extra_spotdl = opts.extra_spotdl_args.clone().unwrap_or_default();

    let url_trim = url.trim().to_string();
    let url_lower = url_trim.to_lowercase();
    let is_spotify = url_lower.contains("spotify.com") || url_lower.contains("spotify:");
    let is_yt_search = url_lower.starts_with("ytsearch:") || url_lower.starts_with("ytsearch1:") || url_lower.starts_with("scsearch:");
    let is_http_url = url_lower.starts_with("http://") || url_lower.starts_with("https://") || is_spotify || is_yt_search;

    // Clean extra_yt_dlp of any residual --cookies-from-browser to prevent conflicts
    let mut extra_cleaned = String::new();
    if !extra_yt_dlp.trim().is_empty() {
        let parts: Vec<&str> = extra_yt_dlp.split_whitespace().collect();
        let mut new_parts = Vec::new();
        let mut skip_next = false;
        for part in parts {
            if skip_next {
                skip_next = false;
                continue;
            }
            if part == "--cookies-from-browser" {
                skip_next = true;
                continue;
            }
            new_parts.push(part);
        }
        extra_cleaned = new_parts.join(" ");
    }

    let cookies_b = cookies_browser.trim();

    let (exe_bin, args, tool_name) = if is_spotify {
        // 1) Lien Spotify -> Utiliser spotDL avec métadonnées Spotify
        let mut spot_args: Vec<String> = Vec::new();
        spot_args.push(url_trim.clone());
        spot_args.push("--threads".to_string());
        spot_args.push(threads.to_string());
        spot_args.push("--audio".to_string());
        for s in audio_sources {
            spot_args.push(s);
        }

        let mut yt_dlp_combined = Vec::new();
        if !cookies_b.is_empty() && cookies_b != "none" {
            yt_dlp_combined.push(format!("--cookies-from-browser {}", cookies_b));
        }
        if !extra_cleaned.is_empty() {
            yt_dlp_combined.push(extra_cleaned);
        }
        if !yt_dlp_combined.is_empty() {
            spot_args.push("--yt-dlp-args".to_string());
            spot_args.push(yt_dlp_combined.join(" "));
        }
        if !extra_spotdl.trim().is_empty() {
            for token in extra_spotdl.split_whitespace() {
                spot_args.push(token.to_string());
            }
        }
        (spotdl_exe_path(), spot_args, "spotDL (Spotify)")
    } else if is_http_url {
        // 2) Lien direct (YouTube, SoundCloud, etc.) -> Utiliser yt-dlp directement
        let yt_bin = yt_dlp_exe_path();
        let bin = if yt_bin.exists() {
            yt_bin
        } else {
            spotdl_exe_path()
        };

        if bin == yt_dlp_exe_path() {
            let mut yt_args: Vec<String> = Vec::new();
            yt_args.push("-x".to_string());
            yt_args.push("--audio-format".to_string());
            yt_args.push("mp3".to_string());
            yt_args.push("--audio-quality".to_string());
            yt_args.push("0".to_string());
            yt_args.push("--embed-thumbnail".to_string());
            yt_args.push("--add-metadata".to_string());
            yt_args.push("-o".to_string());
            yt_args.push("%(title)s.%(ext)s".to_string());

            if !cookies_b.is_empty() && cookies_b != "none" {
                yt_args.push("--cookies-from-browser".to_string());
                yt_args.push(cookies_b.to_string());
            }

            if !extra_cleaned.is_empty() {
                for token in extra_cleaned.split_whitespace() {
                    yt_args.push(token.to_string());
                }
            }

            yt_args.push(url_trim.clone());
            (bin, yt_args, "yt-dlp (Téléchargement direct)")
        } else {
            let mut spot_args: Vec<String> = Vec::new();
            spot_args.push(url_trim.clone());
            spot_args.push("--threads".to_string());
            spot_args.push(threads.to_string());
            if !cookies_b.is_empty() && cookies_b != "none" {
                spot_args.push("--yt-dlp-args".to_string());
                spot_args.push(format!("--cookies-from-browser {}", cookies_b));
            }
            (spotdl_exe_path(), spot_args, "spotDL")
        }
    } else {
        // 3) Recherche par mot-clé / Titre + Artiste (ex: sélection depuis Deezer/iTunes)
        let spot_bin = spotdl_exe_path();
        if spot_bin.exists() {
            let mut spot_args: Vec<String> = Vec::new();
            spot_args.push(url_trim.clone());
            spot_args.push("--threads".to_string());
            spot_args.push(threads.to_string());
            spot_args.push("--audio".to_string());
            for s in audio_sources {
                spot_args.push(s);
            }

            let mut yt_dlp_combined = Vec::new();
            if !cookies_b.is_empty() && cookies_b != "none" {
                yt_dlp_combined.push(format!("--cookies-from-browser {}", cookies_b));
            }
            if !extra_cleaned.is_empty() {
                yt_dlp_combined.push(extra_cleaned);
            }
            if !yt_dlp_combined.is_empty() {
                spot_args.push("--yt-dlp-args".to_string());
                spot_args.push(yt_dlp_combined.join(" "));
            }
            if !extra_spotdl.trim().is_empty() {
                for token in extra_spotdl.split_whitespace() {
                    spot_args.push(token.to_string());
                }
            }
            (spot_bin, spot_args, "spotDL (Recherche & Métadonnées)")
        } else {
            let yt_bin = yt_dlp_exe_path();
            let mut yt_args: Vec<String> = Vec::new();
            yt_args.push("-x".to_string());
            yt_args.push("--audio-format".to_string());
            yt_args.push("mp3".to_string());
            yt_args.push("--audio-quality".to_string());
            yt_args.push("0".to_string());
            yt_args.push("--embed-thumbnail".to_string());
            yt_args.push("--add-metadata".to_string());
            yt_args.push("-o".to_string());
            yt_args.push("%(title)s.%(ext)s".to_string());

            if !cookies_b.is_empty() && cookies_b != "none" {
                yt_args.push("--cookies-from-browser".to_string());
                yt_args.push(cookies_b.to_string());
            }

            if !extra_cleaned.is_empty() {
                for token in extra_cleaned.split_whitespace() {
                    yt_args.push(token.to_string());
                }
            }

            let search_target = format!("ytsearch1:{}", url_trim);
            yt_args.push(search_target);
            (yt_bin, yt_args, "yt-dlp (Recherche YouTube)")
        }
    };

    if !exe_bin.exists() {
        return Err(format!("L'exécutable {} est introuvable dans l'environnement embarqué", tool_name));
    }

    let path_env = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = std::env::split_paths(&path_env).collect::<Vec<_>>();
    paths.insert(0, bin_dir());
    paths.insert(0, venv_scripts_dir());
    let new_path = std::env::join_paths(paths).unwrap_or(path_env);

    let cmd_name = exe_bin.file_name().unwrap_or_default().to_string_lossy();
    let cmd_str = format!("{} {}", cmd_name, args.join(" "));
    let _ = app.emit(
        "downloader-log",
        DownloaderLogPayload {
            line: format!("🚀 Lancement du téléchargement ({}) dans {}\nCommande: {}", tool_name, output_dir_str, cmd_str),
            is_error: false,
        },
    );

    let mut child = Command::new(&exe_bin)
        .args(&args)
        .current_dir(&output_dir)
        .env("PATH", new_path)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de démarrer le processus {}: {}", tool_name, e))?;

    if let Some(pid) = child.id() {
        let mut pid_lock = state.active_download_pid.lock().unwrap();
        *pid_lock = Some(pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_stdout = app.clone();
    if let Some(out) = stdout {
        tokio::spawn(async move {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_stdout.emit(
                    "downloader-log",
                    DownloaderLogPayload {
                        line,
                        is_error: false,
                    },
                );
            }
        });
    }

    let app_stderr = app.clone();
    if let Some(err) = stderr {
        tokio::spawn(async move {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_stderr.emit(
                    "downloader-log",
                    DownloaderLogPayload {
                        line,
                        is_error: true,
                    },
                );
            }
        });
    }

    let exit_status = child.wait().await;
    {
        let mut pid_lock = state.active_download_pid.lock().unwrap();
        *pid_lock = None;
    }

    match exit_status {
        Ok(st) => {
            let success = st.success();
            let code = st.code();
            let message = if success {
                "Téléchargement terminé avec succès !".to_string()
            } else {
                format!("Le téléchargement s'est terminé avec le code d'erreur {:?}", code)
            };

            let _ = app.emit(
                "downloader-log",
                DownloaderLogPayload {
                    line: format!("🏁 {}", message),
                    is_error: !success,
                },
            );

            let _ = app.emit(
                "downloader-finished",
                DownloaderFinishedPayload {
                    success,
                    code,
                    output_dir: output_dir_str.clone(),
                    message,
                },
            );

            if opts.auto_scan.unwrap_or(true) && success {
                let _ = app.emit(
                    "downloader-log",
                    DownloaderLogPayload {
                        line: "🔍 Scan automatique de la bibliothèque en cours...".to_string(),
                        is_error: false,
                    },
                );
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                if let Ok(report) = crate::scanner::scan_directory(&conn, &output_dir_str) {
                    let _ = app.emit(
                        "downloader-log",
                        DownloaderLogPayload {
                            line: format!("✅ Scan terminé : {} morceaux importés !", report.imported_tracks),

                            is_error: false,
                        },
                    );
                }
            }

            Ok(())
        }
        Err(e) => {
            let err_msg = format!("Processus spotDL interrompu ou échoué: {}", e);
            let _ = app.emit(
                "downloader-log",
                DownloaderLogPayload {
                    line: format!("❌ {}", err_msg),
                    is_error: true,
                },
            );
            let _ = app.emit(
                "downloader-finished",
                DownloaderFinishedPayload {
                    success: false,
                    code: None,
                    output_dir: output_dir_str,
                    message: err_msg.clone(),
                },
            );
            Err(err_msg)
        }
    }
}

pub fn cancel_download(state: &State<AppState>) -> Result<bool, String> {
    let mut pid_lock = state.active_download_pid.lock().unwrap();
    if let Some(pid) = *pid_lock {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill")
                .args(&["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("kill")
                .args(&["-9", &pid.to_string()])
                .output();
        }
        *pid_lock = None;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn get_default_download_dir(state: &State<AppState>) -> PathBuf {
    if let Ok(conn) = state.db.lock() {
        let custom = crate::db::get_setting(&conn, "downloader_output_path", "");
        if !custom.trim().is_empty() {
            return PathBuf::from(custom.trim());
        }
        let music_f = crate::db::get_setting(&conn, "music_folder", "");
        if !music_f.trim().is_empty() {
            return PathBuf::from(music_f.trim());
        }
    }

    dirs::audio_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join("Music"))
            .unwrap_or_else(|| PathBuf::from("./Music"))
    })
}
