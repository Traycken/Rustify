// ============================================================================
// api.rs â€” Toutes les requÃªtes HTTP externes de Rustify
//
// RÃ¨gles :
//  - User-Agent rÃ©aliste obligatoire pour MusicBrainz.
//  - Rate-limit MusicBrainz : â‰¥ 1,1 s entre chaque appel.
//  - Rotation automatique de User-Agent sur rÃ©ponse 429/403/503.
//  - Toutes les fonctions renvoient des structs Serialize â†’ invoke().
// ============================================================================

use crate::ua_pool;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// User-Agent officiel Rustify (requis par MusicBrainz policy)
// ---------------------------------------------------------------------------
pub const MB_USER_AGENT: &str =
    "Rustify/1.0 (https://github.com/rustify; rustify-app@proton.me)";

// ---------------------------------------------------------------------------
// Rate-limiter MusicBrainz (â‰¥ 1,1 s entre chaque requÃªte)
// ---------------------------------------------------------------------------
static MB_LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

async fn mb_wait() {
    let wait_needed = {
        let last = MB_LAST_REQUEST.lock().unwrap();
        match *last {
            None => Duration::ZERO,
            Some(t) => {
                let elapsed = t.elapsed();
                if elapsed < Duration::from_millis(1100) {
                    Duration::from_millis(1100) - elapsed
                } else {
                    Duration::ZERO
                }
            }
        }
    };
    if wait_needed > Duration::ZERO {
        tokio::time::sleep(wait_needed).await;
    }
    *MB_LAST_REQUEST.lock().unwrap() = Some(Instant::now());
}

// ---------------------------------------------------------------------------
// Rate-limiter + circuit-breaker iTunes Search API
// ----------------------------------------------------------------------------
// Documentation Apple : ~20 requêtes/minute (non authentifié), mais retours
// d'expérience développeurs constants depuis des années montrent une
// application erratique et bien plus stricte en pratique (blocages 403
// persistants même à 4-6 req/min, durée du blocage non documentée et
// pouvant durer de plusieurs minutes à plusieurs jours). Le blocage est par
// IP, pas par User-Agent : faire tourner des UA (comme pour Deezer/
// MusicBrainz) n'apporte donc RIEN ici, et ne fait qu'ajouter des requêtes
// inutiles pendant un blocage — ce qui, d'après les mêmes retours, tend à
// prolonger le blocage plutôt qu'à le contourner.
//
// Stratégie retenue : (1) un espacement minimal entre requêtes, commun à
// TOUTES les fonctionnalités qui interrogent iTunes (recherche unique,
// lot de photos d'artistes, lot de métadonnées manquantes, morceau/album en
// ligne) puisqu'elles partagent la même IP sortante ; (2) un
// circuit-breaker qui coupe complètement les appels iTunes pendant un
// temps de repos après plusieurs blocages consécutifs, plutôt que de
// continuer à marteler l'API (et donc potentiellement prolonger le
// blocage) pendant tout un traitement en lot.
static ITUNES_LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);
static ITUNES_BLOCKED_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
static ITUNES_CONSECUTIVE_BLOCKS: Mutex<u32> = Mutex::new(0);

/// ~15 requêtes/minute : sous la limite documentée (20/min) avec marge,
/// conformément aux retours indiquant une application plus stricte que la
/// doc en pratique.
const ITUNES_MIN_INTERVAL: Duration = Duration::from_millis(4000);
/// Après ce nombre de blocages consécutifs, on cesse tout appel iTunes
/// pendant ITUNES_BLOCK_COOLDOWN plutôt que d'insister.
const ITUNES_BLOCK_THRESHOLD: u32 = 3;
const ITUNES_BLOCK_COOLDOWN: Duration = Duration::from_secs(180);

async fn itunes_wait() {
    let wait_needed = {
        let last = ITUNES_LAST_REQUEST.lock().unwrap();
        match *last {
            None => Duration::ZERO,
            Some(t) => {
                let elapsed = t.elapsed();
                if elapsed < ITUNES_MIN_INTERVAL {
                    ITUNES_MIN_INTERVAL - elapsed
                } else {
                    Duration::ZERO
                }
            }
        }
    };
    if wait_needed > Duration::ZERO {
        tokio::time::sleep(wait_needed).await;
    }
    *ITUNES_LAST_REQUEST.lock().unwrap() = Some(Instant::now());
}

/// Renvoie le temps restant si le circuit-breaker iTunes est actuellement
/// ouvert (pause en cours suite à des blocages répétés).
fn itunes_cooldown_remaining() -> Option<Duration> {
    let guard = ITUNES_BLOCKED_UNTIL.lock().unwrap();
    match *guard {
        Some(until) if Instant::now() < until => Some(until - Instant::now()),
        _ => None,
    }
}

/// Enregistre l'issue d'un appel iTunes pour le circuit-breaker : une
/// réponse 403/429 incrémente le compteur de blocages consécutifs et, au
/// seuil, ouvre une pause complète ; toute réponse exploitable (2xx)
/// réinitialise le compteur.
fn itunes_register_outcome(was_blocked: bool) {
    if was_blocked {
        let mut consec = ITUNES_CONSECUTIVE_BLOCKS.lock().unwrap();
        *consec += 1;
        if *consec >= ITUNES_BLOCK_THRESHOLD {
            *ITUNES_BLOCKED_UNTIL.lock().unwrap() = Some(Instant::now() + ITUNES_BLOCK_COOLDOWN);
            crate::debug_log::push_log(
                "backend-api",
                format!(
                    "iTunes : {} blocages consecutifs (403/429) -- pause de {}s avant nouvel essai",
                    *consec,
                    ITUNES_BLOCK_COOLDOWN.as_secs()
                ),
            );
        }
    } else {
        *ITUNES_CONSECUTIVE_BLOCKS.lock().unwrap() = 0;
    }
}

// ---------------------------------------------------------------------------
// Client HTTP avec UA configurable
// ---------------------------------------------------------------------------
pub fn http_client_ua(user_agent: &str) -> Client {
    Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

/// Alias pour l'UA Rustify (compatibilitÃ©)
fn http_client() -> Client {
    http_client_ua(MB_USER_AGENT)
}

/// RÃ©sultat d'une requÃªte avec rotation d'UA.
pub struct UaRequestResult {
    pub data: serde_json::Value,
    /// UA qui a finalement fonctionnÃ©
    pub effective_ua: String,
    /// "success" | "block" | "failure"
    pub outcome: String,
}

/// Effectue un GET JSON avec rotation automatique de UA sur 429/403/503.
///
/// `ranked_uas` : liste ordonnÃ©e des UA Ã  essayer (du meilleur au moins bon).
/// `wait_fn`    : optionnel, appelÃ© avant chaque tentative (ex: mb_wait).
///
/// Retourne (data, effective_ua, outcome).
pub async fn get_json_rotating(
    url: &str,
    ranked_uas: &[String],
    wait_fn: Option<&(dyn Fn() + Sync)>,
) -> UaRequestResult {
    let _ = wait_fn; // rÃ©servÃ© pour usage futur sans async closure
    let uas = if ranked_uas.is_empty() {
        ua_pool::UA_POOL
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else {
        ranked_uas.to_vec()
    };

    for ua in &uas {
        let client = http_client_ua(ua);
        match client.get(url).send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                match status {
                    200..=299 => {
                        if let Ok(data) = resp.json::<serde_json::Value>().await {
                            return UaRequestResult {
                                data,
                                effective_ua: ua.clone(),
                                outcome: "success".to_string(),
                            };
                        }
                    }
                    429 | 403 | 503 => {
                        // Blocage â†’ marquer et essayer le suivant
                        // On note juste le blocage dans le retour final
                        // (l'enregistrement en DB est fait dans commands.rs)
                        eprintln!("[UA rotate] {} -> HTTP {} sur {}", ua, status, url);
                        // Petite pause avant de rÃ©essayer avec le prochain UA
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        continue;
                    }
                    _ => {
                        // Erreur non-blocking â†’ Ã©chec immÃ©diat
                        return UaRequestResult {
                            data: serde_json::Value::Null,
                            effective_ua: ua.clone(),
                            outcome: "failure".to_string(),
                        };
                    }
                }
            }
            Err(_) => continue,
        }
    }

    // Tous les UA ont Ã©chouÃ©
    crate::debug_log::push_log(
        "backend-api",
        format!("Echec reseau (toutes les UA epuisees) sur : {}", url),
    );
    UaRequestResult {
        data: serde_json::Value::Null,
        effective_ua: uas.first().cloned().unwrap_or_default(),
        outcome: "failure".to_string(),
    }
}

/// Wrapper MusicBrainz : attend le rate-limit PUIS fait la requÃªte avec rotation.
pub async fn mb_get_json_rotating(url: &str, ranked_uas: &[String]) -> UaRequestResult {
    mb_wait().await;
    get_json_rotating(url, ranked_uas, None).await
}


// ============================================================================
// Structs de rÃ©sultat (Serialize â†’ envoyÃ©es au frontend via invoke)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeezerTrackResult {
    pub bpm: Option<f64>,
    pub isrc: Option<String>,
    pub cover_url: Option<String>,
    pub cover_base64: Option<String>,
    pub deezer_track_id: Option<String>,
    pub deezer_artist_id: Option<String>,
    pub artist_fan_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackCredit {
    pub role: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MbTrackResult {
    pub mbid: Option<String>,
    pub iswc: Option<String>,
    pub tags: Vec<String>,
    pub credits: Vec<TrackCredit>,
    pub wikidata_qid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BandMember {
    pub name: String,
    pub photo_url: Option<String>,
    pub join_date: Option<String>,
    pub leave_date: Option<String>,
    pub is_current: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MbArtistResult {
    pub mbid: Option<String>,
    pub life_span_begin: Option<String>,
    pub life_span_end: Option<String>,
    pub is_ended: Option<bool>,
    pub tags: Vec<String>,
    pub wikidata_qid: Option<String>,
    pub members: Vec<BandMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WikidataDetails {
    pub death_date: Option<String>,
    pub death_cause: Option<String>,
    pub dissolution_date: Option<String>,
    pub external_ids: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LrcLyricsResult {
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
    pub is_instrumental: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OnlineTrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub cover_base64: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BandDetailsResult {
    pub bio: Option<String>,
    pub members: Vec<BandMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArtistOnlineResult {
    pub genre: Option<String>,
    pub cover_base64: Option<String>,
}

/// RÃ©sultat complet d'un enrichissement de morceau (Deezer + MB + LRC).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackEnrichmentResult {
    pub track_id: String,
    pub bpm: Option<f64>,
    pub isrc: Option<String>,
    pub mbid: Option<String>,
    pub iswc: Option<String>,
    pub tags: Option<Vec<String>>,
    pub credits: Option<Vec<TrackCredit>>,
    pub lyrics_plain: Option<String>,
    pub lyrics_synced: Option<String>,
    pub is_instrumental: Option<bool>,
    pub deezer_id: Option<String>,
    /// couverture tÃ©lÃ©chargÃ©e (base64) pour mise Ã  jour Ã©ventuelle
    pub cover_base64: Option<String>,
}

/// Input minimal pour un batch d'enrichissement de morceaux.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackEnrichmentInput {
    pub track_id: String,
    pub artist: String,
    pub title: String,
    pub album: String,
    pub duration_secs: f64,
    pub isrc: Option<String>,
}

// ============================================================================
// Helpers internes
// ============================================================================

/// TÃ©lÃ©charge une image depuis une URL et la renvoie en base64 (data:image/â€¦).
pub async fn fetch_image_as_base64_internal(url: &str) -> Option<String> {
    let client = http_client();
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let mime = if content_type.contains("png") {
        "image/png"
    } else if content_type.contains("webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    let bytes = resp.bytes().await.ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime, b64))
}

fn extract_wikidata_qid(url: &str) -> Option<String> {
    if !url.contains("wikidata.org") {
        return None;
    }
    let re = regex_qid(url)?;
    Some(re)
}

fn regex_qid(url: &str) -> Option<String> {
    // Extrait Q\d+ depuis une URL Wikidata
    let start = url.find('Q')?;
    let rest = &url[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != 'Q')
        .unwrap_or(rest.len());
    let candidate = &rest[..end];
    if candidate.len() > 1 && candidate.starts_with('Q') {
        Some(candidate.to_string())
    } else {
        None
    }
}

// ============================================================================
// Deezer
// ============================================================================

/// RÃ©cupÃ¨re BPM, ISRC, cover, deezer_id, fan_count pour un morceau.
/// Effectue jusqu'Ã  3 requÃªtes (search + track detail + artist).
pub async fn fetch_deezer_track(artist: &str, title: &str) -> DeezerTrackResult {
    let client = http_client();
    let mut result = DeezerTrackResult::default();

    let q = format!("artist:\"{}\" track:\"{}\"", artist, title);
    let search_url = format!(
        "https://api.deezer.com/search?q={}&limit=1",
        urlencoding::encode(&q)
    );

    let search_resp: serde_json::Value = match client.get(&search_url).send().await {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(_) => return result,
        },
        _ => return result,
    };

    let item = match search_resp["data"].as_array().and_then(|a| a.first()) {
        Some(v) => v.clone(),
        None => return result,
    };

    let track_id = item["id"].as_u64().map(|id| id.to_string());
    result.deezer_track_id = track_id.clone();
    result.deezer_artist_id = item["artist"]["id"].as_u64().map(|id| id.to_string());
    result.cover_url = item["album"]["cover_xl"]
        .as_str()
        .or_else(|| item["album"]["cover_big"].as_str())
        .map(|s| s.to_string());

    // DÃ©tail du morceau (BPM + ISRC)
    if let Some(tid) = &track_id {
        let detail_url = format!("https://api.deezer.com/track/{}", tid);
        if let Ok(resp) = client.get(&detail_url).send().await {
            if resp.status().is_success() {
                if let Ok(detail) = resp.json::<serde_json::Value>().await {
                    let bpm = detail["bpm"].as_f64().filter(|&v| v > 0.0);
                    result.bpm = bpm;
                    result.isrc = detail["isrc"].as_str().map(|s| s.to_string());
                    result.cover_url = detail["album"]["cover_xl"]
                        .as_str()
                        .or_else(|| detail["album"]["cover_big"].as_str())
                        .map(|s| s.to_string())
                        .or(result.cover_url);
                }
            }
        }
    }

    // Fan count de l'artiste
    if let Some(aid) = &result.deezer_artist_id {
        let artist_url = format!("https://api.deezer.com/artist/{}", aid);
        if let Ok(resp) = client.get(&artist_url).send().await {
            if resp.status().is_success() {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    result.artist_fan_count = data["nb_fan"].as_i64();
                }
            }
        }
    }

    // TÃ©lÃ©charger la couverture en base64
    if let Some(url) = &result.cover_url.clone() {
        result.cover_base64 = fetch_image_as_base64_internal(url).await;
    }

    result
}

/// Recherche l'artiste sur Deezer pour rÃ©cupÃ©rer son ID et fan count.
pub async fn fetch_deezer_artist(artist_name: &str) -> (Option<String>, Option<i64>) {
    let client = http_client();
    let url = format!(
        "https://api.deezer.com/search/artist?q={}&limit=1",
        urlencoding::encode(artist_name)
    );
    if let Ok(resp) = client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(item) = data["data"].as_array().and_then(|a| a.first()) {
                    let id = item["id"].as_u64().map(|v| v.to_string());
                    let fans = item["nb_fan"].as_i64();
                    return (id, fans);
                }
            }
        }
    }
    (None, None)
}

/// Photo réelle de l'artiste depuis Deezer (`picture_xl` de l'objet
/// artiste renvoyé par la recherche). À privilégier sur iTunes qui n'expose
/// aucune vraie photo d'artiste et n'utilise que la pochette d'un morceau
/// représentatif comme proxy. Endpoint public, sans clé API, et sans le
/// rate-limiting agressif par IP observé sur iTunes (voir itunes_wait /
/// itunes_register_outcome plus haut).
pub async fn fetch_deezer_artist_photo(artist_name: &str) -> Option<String> {
    let client = http_client();
    let url = format!(
        "https://api.deezer.com/search/artist?q={}&limit=1",
        urlencoding::encode(artist_name)
    );
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: serde_json::Value = resp.json().await.ok()?;
    let item = data["data"].as_array().and_then(|a| a.first())?;
    // id=0 correspond à "artiste inconnu" côté Deezer (aucune correspondance
    // réelle) : on ignore plutôt que de récupérer une image sans rapport.
    if item["id"].as_u64().unwrap_or(0) == 0 {
        return None;
    }
    let picture_url = item["picture_xl"]
        .as_str()
        .or_else(|| item["picture_big"].as_str())?;
    fetch_image_as_base64_internal(picture_url).await
}

// ============================================================================
// MusicBrainz
// ============================================================================

/// RÃ©cupÃ¨re MBID, ISWC, tags, crÃ©dits et lien Wikidata pour un morceau.
pub async fn fetch_mb_track(
    artist: &str,
    title: &str,
    isrc: Option<&str>,
) -> MbTrackResult {
    let client = http_client();
    let inc = "artist-credits+tags+work-rels+url-rels+artist-rels";
    let mut recording: Option<serde_json::Value> = None;

    // 1. Recherche par ISRC (plus prÃ©cise)
    if let Some(isrc_val) = isrc {
        mb_wait().await;
        let url = format!(
            "https://musicbrainz.org/ws/2/isrc/{}?inc={}&fmt=json",
            urlencoding::encode(isrc_val),
            inc
        );
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    recording = data["recordings"]
                        .as_array()
                        .and_then(|a| a.first())
                        .cloned();
                }
            }
        }
    }

    // 2. Repli : recherche texte
    if recording.is_none() {
        let q = format!("recording:\"{}\" AND artist:\"{}\"", title, artist);
        mb_wait().await;
        let search_url = format!(
            "https://musicbrainz.org/ws/2/recording/?query={}&limit=1&fmt=json",
            urlencoding::encode(&q)
        );
        if let Ok(resp) = client.get(&search_url).send().await {
            if resp.status().is_success() {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    if let Some(candidate_id) = data["recordings"]
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|r| r["id"].as_str())
                    {
                        mb_wait().await;
                        let detail_url = format!(
                            "https://musicbrainz.org/ws/2/recording/{}?inc={}&fmt=json",
                            candidate_id, inc
                        );
                        if let Ok(r2) = client.get(&detail_url).send().await {
                            if r2.status().is_success() {
                                recording = r2.json().await.ok();
                            }
                        }
                    }
                }
            }
        }
    }

    let rec = match recording {
        Some(r) => r,
        None => return MbTrackResult::default(),
    };

    let mbid = rec["id"].as_str().map(|s| s.to_string());
    let tags: Vec<String> = rec["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut credits: Vec<TrackCredit> = vec![];
    let mut iswc: Option<String> = None;
    let mut wikidata_qid: Option<String> = None;

    let relations = rec["relations"].as_array().cloned().unwrap_or_default();
    for rel in &relations {
        if let (Some(role), Some(name)) = (rel["type"].as_str(), rel["artist"]["name"].as_str()) {
            credits.push(TrackCredit {
                role: role.to_string(),
                name: name.to_string(),
            });
        }
        if let Some(url) = rel["url"]["resource"].as_str() {
            if let Some(qid) = extract_wikidata_qid(url) {
                wikidata_qid = Some(qid);
            }
        }
        // RÃ©soudre l'Å“uvre (ISWC + crÃ©dits supplÃ©mentaires)
        if let Some(work_id) = rel["work"]["id"].as_str() {
            mb_wait().await;
            let work_url = format!(
                "https://musicbrainz.org/ws/2/work/{}?inc=artist-rels&fmt=json",
                work_id
            );
            if let Ok(resp) = client.get(&work_url).send().await {
                if resp.status().is_success() {
                    if let Ok(work) = resp.json::<serde_json::Value>().await {
                        if let Some(iswcs) = work["iswcs"].as_array() {
                            if let Some(first) = iswcs.first().and_then(|v| v.as_str()) {
                                iswc = Some(first.to_string());
                            }
                        }
                        if let Some(work_rels) = work["relations"].as_array() {
                            for wr in work_rels {
                                if let (Some(role), Some(name)) =
                                    (wr["type"].as_str(), wr["artist"]["name"].as_str())
                                {
                                    credits.push(TrackCredit {
                                        role: role.to_string(),
                                        name: name.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    MbTrackResult {
        mbid,
        iswc,
        tags,
        credits,
        wikidata_qid,
    }
}

/// RÃ©cupÃ¨re MBID, life-span, tags, membres et lien Wikidata pour un artiste.
pub async fn fetch_mb_artist(artist_name: &str) -> MbArtistResult {
    let client = http_client();

    // Recherche
    let q = format!("artist:\"{}\"", artist_name);
    mb_wait().await;
    let search_url = format!(
        "https://musicbrainz.org/ws/2/artist/?query={}&limit=1&fmt=json",
        urlencoding::encode(&q)
    );
    let candidate_id = {
        let resp = match client.get(&search_url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => return MbArtistResult::default(),
        };
        let data: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(_) => return MbArtistResult::default(),
        };
        match data["artists"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|a| a["id"].as_str())
        {
            Some(id) => id.to_string(),
            None => return MbArtistResult::default(),
        }
    };

    // DÃ©tail
    mb_wait().await;
    let detail_url = format!(
        "https://musicbrainz.org/ws/2/artist/{}?inc=artist-rels+url-rels+tags&fmt=json",
        candidate_id
    );
    let artist_data: serde_json::Value = match client.get(&detail_url).send().await {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(_) => return MbArtistResult::default(),
        },
        _ => return MbArtistResult::default(),
    };

    let life_span = &artist_data["life-span"];
    let life_span_begin = life_span["begin"].as_str().map(|s| s.to_string());
    let life_span_end = life_span["end"].as_str().map(|s| s.to_string());
    let is_ended = life_span["ended"].as_bool();

    let tags: Vec<String> = artist_data["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut wikidata_qid: Option<String> = None;
    let mut members: Vec<BandMember> = vec![];

    let relations = artist_data["relations"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for rel in &relations {
        if let Some(url) = rel["url"]["resource"].as_str() {
            if let Some(qid) = extract_wikidata_qid(url) {
                wikidata_qid = Some(qid);
            }
        }
        if rel["type"].as_str() == Some("member of band") {
            if let Some(name) = rel["artist"]["name"].as_str() {
                members.push(BandMember {
                    name: name.to_string(),
                    photo_url: None,
                    join_date: rel["begin"].as_str().map(|s| s.to_string()),
                    leave_date: rel["end"].as_str().map(|s| s.to_string()),
                    is_current: rel["ended"]
                        .as_bool()
                        .map(|ended| !ended)
                        .or(Some(true)),
                });
            }
        }
    }

    MbArtistResult {
        mbid: Some(candidate_id),
        life_span_begin,
        life_span_end,
        is_ended,
        tags,
        wikidata_qid,
        members,
    }
}

// ============================================================================
// Wikidata
// ============================================================================

pub async fn fetch_wikidata_details(qid: &str) -> WikidataDetails {
    let client = http_client();
    let mut result = WikidataDetails::default();

    let url = format!(
        "https://www.wikidata.org/w/api.php?action=wbgetentities&ids={}&format=json&props=claims&origin=*",
        urlencoding::encode(qid)
    );
    let data: serde_json::Value = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(_) => return result,
        },
        _ => return result,
    };

    let claims = &data["entities"][qid]["claims"];

    let parse_date = |prop: &str| -> Option<String> {
        let time = claims[prop][0]["mainsnak"]["datavalue"]["value"]["time"].as_str()?;
        // Format Wikidata: +YYYY-MM-DDTHH:MM:SSZ â†’ YYYY-MM-DD
        let stripped = time.trim_start_matches('+');
        Some(stripped.split('T').next().unwrap_or(stripped).to_string())
    };

    result.death_date = parse_date("P570");
    result.dissolution_date = parse_date("P576");

    // P509 = cause du dÃ©cÃ¨s (QID de la cause)
    if let Some(cause_qid) = claims["P509"][0]["mainsnak"]["datavalue"]["value"]["id"].as_str() {
        let cause_url = format!(
            "https://www.wikidata.org/w/api.php?action=wbgetentities&ids={}&format=json&props=labels&languages=fr|en&origin=*",
            urlencoding::encode(cause_qid)
        );
        if let Ok(resp) = client.get(&cause_url).send().await {
            if resp.status().is_success() {
                if let Ok(cause_data) = resp.json::<serde_json::Value>().await {
                    let labels = &cause_data["entities"][cause_qid]["labels"];
                    result.death_cause = labels["fr"]["value"]
                        .as_str()
                        .or_else(|| labels["en"]["value"].as_str())
                        .map(|s| s.to_string());
                }
            }
        }
    }

    // Identifiants externes
    let get_str = |prop: &str| -> Option<String> {
        claims[prop][0]["mainsnak"]["datavalue"]["value"]
            .as_str()
            .map(|s| s.to_string())
    };
    if let Some(v) = get_str("P1953") {
        result.external_ids.insert("discogs".to_string(), v);
    }
    if let Some(v) = get_str("P1902") {
        result.external_ids.insert("spotify".to_string(), v);
    }
    if let Some(v) = get_str("P345") {
        result.external_ids.insert("imdb".to_string(), v);
    }

    result
}

// ============================================================================
// LRCLIB (paroles brutes + synchronisÃ©es)
// ============================================================================

pub async fn fetch_lrc_lyrics(
    artist: &str,
    title: &str,
    album: &str,
    duration_secs: f64,
) -> Option<LrcLyricsResult> {
    let client = http_client();

    let mut params = vec![
        ("artist_name", artist.to_string()),
        ("track_name", title.to_string()),
    ];
    if !album.is_empty() && album != "Album inconnu" {
        params.push(("album_name", album.to_string()));
    }
    if duration_secs > 0.0 {
        params.push(("duration", (duration_secs.round() as i64).to_string()));
    }

    let qs: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let url = format!("https://lrclib.net/api/get?{}", qs);
    if let Ok(resp) = client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let plain = data["plainLyrics"].as_str().map(|s| s.to_string());
                let synced = data["syncedLyrics"].as_str().map(|s| s.to_string());
                let instrumental = data["instrumental"].as_bool().unwrap_or(false);
                if plain.is_some() || synced.is_some() || instrumental {
                    return Some(LrcLyricsResult {
                        plain_lyrics: plain,
                        synced_lyrics: synced,
                        is_instrumental: instrumental,
                    });
                }
            }
        }
    }

    // Repli : /api/search
    let search_qs = format!(
        "artist_name={}&track_name={}",
        urlencoding::encode(artist),
        urlencoding::encode(title)
    );
    let search_url = format!("https://lrclib.net/api/search?{}", search_qs);
    if let Ok(resp) = client.get(&search_url).send().await {
        if resp.status().is_success() {
            if let Ok(results) = resp.json::<serde_json::Value>().await {
                if let Some(best) = results.as_array().and_then(|a| a.first()) {
                    return Some(LrcLyricsResult {
                        plain_lyrics: best["plainLyrics"].as_str().map(|s| s.to_string()),
                        synced_lyrics: best["syncedLyrics"].as_str().map(|s| s.to_string()),
                        is_instrumental: best["instrumental"].as_bool().unwrap_or(false),
                    });
                }
            }
        }
    }

    None
}

// ============================================================================
// iTunes Search API (mÃ©tadonnÃ©es morceau + photo artiste)
// ============================================================================

/// Recherche iTunes générique (`entity=song`) avec rotation de User-Agent et
/// retry automatique sur 429/403/503 (voir `get_json_rotating`). Utilisé par
/// toutes les fonctions iTunes ci-dessous : sans cela, un lot de requêtes
/// rapprochées (ex: "Récupérer les photos d'artistes" sur toute la
/// bibliothèque) envoyées avec un unique User-Agent fixe se fait bloquer par
/// le rate-limiting iTunes bien plus vite qu'une recherche isolée — d'où des
/// échecs silencieux en masse alors qu'un essai individuel réussit.
async fn itunes_search_song(term: &str) -> Option<serde_json::Value> {
    if let Some(remaining) = itunes_cooldown_remaining() {
        crate::debug_log::push_log(
            "backend-api",
            format!(
                "iTunes en pause ({}s restantes suite a des blocages repetes) -- requete ignoree pour : {}",
                remaining.as_secs(),
                term
            ),
        );
        return None;
    }

    itunes_wait().await;

    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=1",
        urlencoding::encode(term)
    );
    // Un seul User-Agent de navigateur fixe : le blocage iTunes est par IP,
    // pas par UA (voir commentaire au-dessus de itunes_wait), donc la
    // rotation n'apporte rien ici. L'UA #0 est réservé Rustify/MusicBrainz,
    // on prend le premier UA "navigateur" du pool.
    let client = http_client_ua(ua_pool::UA_POOL[1]);
    match client.get(&url).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            match status {
                200..=299 => match resp.json::<serde_json::Value>().await {
                    Ok(data) => {
                        itunes_register_outcome(false);
                        Some(data)
                    }
                    Err(_) => {
                        itunes_register_outcome(false);
                        None
                    }
                },
                403 | 429 => {
                    itunes_register_outcome(true);
                    crate::debug_log::push_log(
                        "backend-api",
                        format!("iTunes : reponse {} (rate-limit IP probable) sur {}", status, url),
                    );
                    None
                }
                _ => {
                    itunes_register_outcome(false);
                    None
                }
            }
        }
        Err(e) => {
            crate::debug_log::push_log(
                "backend-api",
                format!("iTunes : echec reseau sur {} ({})", url, e),
            );
            None
        }
    }
}

/// Métadonnées basiques d'un morceau via Deezer (titre, artiste, album,
/// pochette, genre, année) : source privilégiée pour fetch_online_track_metadata,
/// sans le rate-limiting agressif observé sur iTunes. Un second appel sur
/// l'album (genre + année, non fournis par l'objet piste de la recherche)
/// n'est fait que si le premier a trouvé un résultat.
async fn fetch_deezer_track_metadata(artist: &str, title: &str) -> Option<OnlineTrackMetadata> {
    let client = http_client();
    let q = format!("artist:\"{}\" track:\"{}\"", artist, title);
    let search_url = format!(
        "https://api.deezer.com/search?q={}&limit=1",
        urlencoding::encode(&q)
    );
    let resp = client.get(&search_url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: serde_json::Value = resp.json().await.ok()?;
    let item = data["data"].as_array().and_then(|a| a.first())?;

    let cover_url = item["album"]["cover_xl"]
        .as_str()
        .or_else(|| item["album"]["cover_big"].as_str())
        .map(|s| s.to_string());
    let cover_base64 = match &cover_url {
        Some(u) => fetch_image_as_base64_internal(u).await,
        None => None,
    };

    let mut genre: Option<String> = None;
    let mut year: Option<i32> = None;
    if let Some(album_id) = item["album"]["id"].as_u64() {
        let album_url = format!("https://api.deezer.com/album/{}", album_id);
        if let Ok(album_resp) = client.get(&album_url).send().await {
            if album_resp.status().is_success() {
                if let Ok(album_data) = album_resp.json::<serde_json::Value>().await {
                    genre = album_data["genres"]["data"]
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|g| g["name"].as_str())
                        .map(|s| s.to_string());
                    year = album_data["release_date"]
                        .as_str()
                        .and_then(|d| d.get(..4))
                        .and_then(|y| y.parse::<i32>().ok());
                }
            }
        }
    }

    Some(OnlineTrackMetadata {
        title: item["title"].as_str().map(|s| s.to_string()),
        artist: item["artist"]["name"].as_str().map(|s| s.to_string()),
        album: item["album"]["title"].as_str().map(|s| s.to_string()),
        genre,
        year,
        cover_base64,
        source: "Deezer".to_string(),
    })
}

/// Métadonnées basiques d'un morceau : Deezer en priorité, MusicBrainz en
/// repli, iTunes en tout dernier recours seulement (pacé + circuit-breaker,
/// voir itunes_search_song) — Deezer et MusicBrainz couvrent la grande
/// majorité des cas sans jamais solliciter iTunes.
pub async fn fetch_online_track_metadata(artist: &str, title: &str) -> Option<OnlineTrackMetadata> {
    // 1) Deezer
    if let Some(meta) = fetch_deezer_track_metadata(artist, title).await {
        return Some(meta);
    }

    // 2) MusicBrainz (sans User-Agent spÃ©cial ici car c'est juste un search)
    let client = http_client();
    mb_wait().await;
    let mb_url = format!(
        "https://musicbrainz.org/ws/2/recording?query=artist:\"{}\" AND recording:\"{}\"&fmt=json",
        urlencoding::encode(artist),
        urlencoding::encode(title)
    );
    if let Ok(resp) = client.get(&mb_url).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(rec) = data["recordings"].as_array().and_then(|a| a.first()) {
                    let release = rec["releases"].as_array().and_then(|a| a.first());
                    let year = release
                        .and_then(|r| r["date"].as_str())
                        .and_then(|d| d.get(..4))
                        .and_then(|y| y.parse::<i32>().ok());
                    return Some(OnlineTrackMetadata {
                        title: rec["title"].as_str().map(|s| s.to_string()),
                        artist: rec["artist-credit"]
                            .as_array()
                            .and_then(|a| a.first())
                            .and_then(|c| c["name"].as_str())
                            .map(|s| s.to_string()),
                        album: release
                            .and_then(|r| r["title"].as_str())
                            .map(|s| s.to_string()),
                        genre: rec["tags"]
                            .as_array()
                            .and_then(|a| a.first())
                            .and_then(|t| t["name"].as_str())
                            .map(|s| s.to_string()),
                        year,
                        cover_base64: None,
                        source: "MusicBrainz API".to_string(),
                    });
                }
            }
        }
    }

    // 3) iTunes — dernier recours uniquement.
    let query = format!("{} {}", artist, title);
    if let Some(data) = itunes_search_song(&query).await {
        if let Some(item) = data["results"].as_array().and_then(|a| a.first()) {
            let cover_url = item["artworkUrl100"]
                .as_str()
                .map(|u| u.replace("100x100bb", "600x600bb"));
            let cover_base64 = match &cover_url {
                Some(u) => fetch_image_as_base64_internal(u).await,
                None => None,
            };
            let year = item["releaseDate"]
                .as_str()
                .and_then(|d| d.get(..4))
                .and_then(|y| y.parse::<i32>().ok());
            return Some(OnlineTrackMetadata {
                title: item["trackName"].as_str().map(|s| s.to_string()),
                artist: item["artistName"].as_str().map(|s| s.to_string()),
                album: item["collectionName"].as_str().map(|s| s.to_string()),
                genre: item["primaryGenreName"].as_str().map(|s| s.to_string()),
                year,
                cover_base64,
                source: "iTunes Search API".to_string(),
            });
        }
    }

    None
}

/// Photo d'un artiste : Deezer en priorité (vraie photo `picture_xl`, pas de
/// rate-limit agressif), repli iTunes (pochette de morceau comme proxy,
/// soumis au pacing + circuit-breaker) si Deezer n'a rien trouvé.
pub async fn fetch_artist_photo(artist_name: &str) -> Option<String> {
    if let Some(photo) = fetch_deezer_artist_photo(artist_name).await {
        return Some(photo);
    }

    let data = itunes_search_song(artist_name).await?;
    let artwork_url = data["results"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|item| item["artworkUrl100"].as_str())
        .map(|u| u.replace("100x100bb", "600x600bb"))?;
    fetch_image_as_base64_internal(&artwork_url).await
}

/// Genre + photo artiste. Deezer en priorité pour la photo ; iTunes
/// seulement si Deezer n'a rien trouvé (repli photo + genre au passage,
/// Deezer n'exposant pas de genre au niveau artiste). Cela évite de
/// solliciter iTunes -- et son circuit-breaker -- quand Deezer a suffi.
pub async fn fetch_artist_online_metadata(artist_name: &str) -> ArtistOnlineResult {
    let mut result = ArtistOnlineResult::default();

    // Deezer en priorité pour la photo (voir fetch_deezer_artist_photo).
    result.cover_base64 = fetch_deezer_artist_photo(artist_name).await;

    // iTunes seulement si Deezer n'a rien trouvé : repli photo + genre au
    // passage (soumis au pacing + circuit-breaker, voir itunes_search_song).
    if result.cover_base64.is_none() {
        if let Some(data) = itunes_search_song(artist_name).await {
            if let Some(item) = data["results"].as_array().and_then(|a| a.first()) {
                result.genre = item["primaryGenreName"].as_str().map(|s| s.to_string());
                if let Some(cover_url) =
                    item["artworkUrl100"].as_str().map(|u| u.replace("100x100bb", "600x600bb"))
                {
                    result.cover_base64 = fetch_image_as_base64_internal(&cover_url).await;
                }
            }
        }
    }

    result
}

// ============================================================================
// Wikipedia (bio d'artiste)
// ============================================================================

pub async fn fetch_wikipedia_bio(artist_name: &str) -> Option<String> {
    let client = http_client();
    let url = format!(
        "https://fr.wikipedia.org/api/rest_v1/page/summary/{}",
        urlencoding::encode(artist_name)
    );
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: serde_json::Value = resp.json().await.ok()?;
    // Ignorer les pages de dÃ©sambiguÃ¯sation
    if data["type"]
        .as_str()
        .map(|t| t.contains("disambiguation"))
        .unwrap_or(false)
    {
        return None;
    }
    data["extract"].as_str().map(|s| s.to_string())
}

// ============================================================================
// Orchestration : enrichissement complet d'un morceau
// ============================================================================

pub async fn enrich_track(input: &TrackEnrichmentInput) -> TrackEnrichmentResult {
    let deezer = fetch_deezer_track(&input.artist, &input.title).await;
    let isrc = deezer.isrc.as_deref().or(input.isrc.as_deref());
    let mb = fetch_mb_track(&input.artist, &input.title, isrc).await;
    let lrc = fetch_lrc_lyrics(
        &input.artist,
        &input.title,
        &input.album,
        input.duration_secs,
    )
    .await;

    TrackEnrichmentResult {
        track_id: input.track_id.clone(),
        bpm: deezer.bpm,
        isrc: deezer.isrc,
        mbid: mb.mbid,
        iswc: mb.iswc,
        tags: if mb.tags.is_empty() { None } else { Some(mb.tags) },
        credits: if mb.credits.is_empty() {
            None
        } else {
            Some(mb.credits)
        },
        lyrics_plain: lrc.as_ref().and_then(|l| l.plain_lyrics.clone()),
        lyrics_synced: lrc.as_ref().and_then(|l| l.synced_lyrics.clone()),
        is_instrumental: lrc.as_ref().map(|l| l.is_instrumental),
        deezer_id: deezer.deezer_track_id,
        cover_base64: deezer.cover_base64,
    }
}

// ============================================================================
// Orchestration : enrichissement complet d'un artiste
// ============================================================================

pub struct ArtistEnrichmentFull {
    pub mbid: Option<String>,
    pub deezer_id: Option<String>,
    pub fan_count: Option<i64>,
    pub life_span_begin: Option<String>,
    pub life_span_end: Option<String>,
    pub is_ended: Option<bool>,
    pub death_cause: Option<String>,
    pub wikidata_qid: Option<String>,
    pub external_ids: Option<HashMap<String, String>>,
    pub members: Vec<BandMember>,
    pub bio: Option<String>,
}

pub async fn enrich_artist(artist_name: &str) -> ArtistEnrichmentFull {
    let mb = fetch_mb_artist(artist_name).await;

    let mut life_span_end = mb.life_span_end.clone();
    let mut is_ended = mb.is_ended;
    let mut death_cause: Option<String> = None;
    let mut external_ids: Option<HashMap<String, String>> = None;

    if let Some(qid) = &mb.wikidata_qid {
        let wd = fetch_wikidata_details(qid).await;
        death_cause = wd.death_cause;
        if !wd.external_ids.is_empty() {
            external_ids = Some(wd.external_ids);
        }
        // Wikidata complÃ¨te si MB n'a pas de date de fin
        if life_span_end.is_none() {
            if let Some(dd) = wd.death_date.or(wd.dissolution_date) {
                life_span_end = Some(dd);
                is_ended = Some(true);
            }
        }
    }

    let (deezer_id, fan_count) = fetch_deezer_artist(artist_name).await;
    let bio = fetch_wikipedia_bio(artist_name).await;

    ArtistEnrichmentFull {
        mbid: mb.mbid,
        deezer_id,
        fan_count,
        life_span_begin: mb.life_span_begin,
        life_span_end,
        is_ended,
        death_cause,
        wikidata_qid: mb.wikidata_qid,
        external_ids,
        members: mb.members,
        bio,
    }
}

// ============================================================================
// Variantes UA-aware des fonctions d'enrichissement
// Ces fonctions acceptent une liste ordonnee de UA et retournent aussi
// (effective_ua, outcome) pour que commands.rs puisse enregistrer les stats.
// ============================================================================

/// Resultat Deezer avec UA effectif et outcome (pour stats)
pub struct DeezerTrackWithUa {
    pub result: DeezerTrackResult,
    pub effective_ua: String,
    pub outcome: String,
}

/// Variante UA-aware de fetch_deezer_track.
pub async fn fetch_deezer_track_ua(
    artist: &str,
    title: &str,
    ranked_uas: &[String],
) -> DeezerTrackWithUa {
    let mut result = DeezerTrackResult::default();
    let q = format!("artist:\"{}\" track:\"{}\"", artist, title);
    let search_url = format!(
        "https://api.deezer.com/search?q={}&limit=1",
        urlencoding::encode(&q)
    );

    let res = get_json_rotating(&search_url, ranked_uas, None).await;
    if res.outcome != "success" {
        return DeezerTrackWithUa { result, effective_ua: res.effective_ua, outcome: res.outcome };
    }

    let effective_ua = res.effective_ua.clone();
    let item = match res.data["data"].as_array().and_then(|a| a.first()) {
        Some(v) => v.clone(),
        None => return DeezerTrackWithUa { result, effective_ua, outcome: "failure".to_string() },
    };

    let track_id = item["id"].as_u64().map(|id| id.to_string());
    result.deezer_track_id = track_id.clone();
    result.deezer_artist_id = item["artist"]["id"].as_u64().map(|id| id.to_string());
    result.cover_url = item["album"]["cover_xl"]
        .as_str()
        .or_else(|| item["album"]["cover_big"].as_str())
        .map(|s| s.to_string());

    // Detail du morceau (BPM + ISRC) — reutilise le meme UA
    if let Some(tid) = &track_id {
        let detail_url = format!("https://api.deezer.com/track/{}", tid);
        let det = get_json_rotating(&detail_url, &[effective_ua.clone()], None).await;
        if det.outcome == "success" {
            result.bpm = det.data["bpm"].as_f64().filter(|&v| v > 0.0);
            result.isrc = det.data["isrc"].as_str().map(|s| s.to_string());
            result.cover_url = det.data["album"]["cover_xl"]
                .as_str()
                .or_else(|| det.data["album"]["cover_big"].as_str())
                .map(|s| s.to_string())
                .or(result.cover_url);
        }
    }

    // Fan count
    if let Some(aid) = &result.deezer_artist_id {
        let artist_url = format!("https://api.deezer.com/artist/{}", aid);
        let ar = get_json_rotating(&artist_url, &[effective_ua.clone()], None).await;
        if ar.outcome == "success" {
            result.artist_fan_count = ar.data["nb_fan"].as_i64();
        }
    }

    // Couverture base64
    if let Some(url) = &result.cover_url.clone() {
        result.cover_base64 = fetch_image_as_base64_internal(url).await;
    }

    DeezerTrackWithUa { result, effective_ua, outcome: "success".to_string() }
}

/// Resultat MusicBrainz (morceau) avec UA effectif et outcome.
pub struct MbTrackWithUa {
    pub result: MbTrackResult,
    pub effective_ua: String,
    pub outcome: String,
}

/// Variante UA-aware de fetch_mb_track.
pub async fn fetch_mb_track_ua(
    artist: &str,
    title: &str,
    isrc: Option<&str>,
    ranked_uas: &[String],
) -> MbTrackWithUa {
    let inc = "artist-credits+tags+work-rels+url-rels+artist-rels";
    let mut recording: Option<serde_json::Value> = None;
    let mut last_effective_ua = ranked_uas.first().cloned().unwrap_or_default();

    if let Some(isrc_val) = isrc {
        let url = format!(
            "https://musicbrainz.org/ws/2/isrc/{}?inc={}&fmt=json",
            urlencoding::encode(isrc_val),
            inc
        );
        let res = mb_get_json_rotating(&url, ranked_uas).await;
        last_effective_ua = res.effective_ua.clone();
        if res.outcome == "success" {
            recording = res.data["recordings"].as_array().and_then(|a| a.first()).cloned();
        }
    }

    if recording.is_none() {
        let q = format!("recording:\"{}\" AND artist:\"{}\"", title, artist);
        let search_url = format!(
            "https://musicbrainz.org/ws/2/recording/?query={}&limit=1&fmt=json",
            urlencoding::encode(&q)
        );
        let res = mb_get_json_rotating(&search_url, ranked_uas).await;
        last_effective_ua = res.effective_ua.clone();
        if res.outcome == "success" {
            if let Some(cid) = res.data["recordings"].as_array().and_then(|a| a.first()).and_then(|r| r["id"].as_str()) {
                let detail_url = format!(
                    "https://musicbrainz.org/ws/2/recording/{}?inc={}&fmt=json",
                    cid, inc
                );
                let r2 = mb_get_json_rotating(&detail_url, &[last_effective_ua.clone()]).await;
                last_effective_ua = r2.effective_ua.clone();
                if r2.outcome == "success" {
                    recording = Some(r2.data);
                }
            }
        }
    }

    let rec = match recording {
        Some(r) => r,
        None => return MbTrackWithUa {
            result: MbTrackResult::default(),
            effective_ua: last_effective_ua,
            outcome: "failure".to_string(),
        },
    };

    let mbid = rec["id"].as_str().map(|s| s.to_string());
    let tags: Vec<String> = rec["tags"].as_array().map(|arr| {
        arr.iter().filter_map(|t| t["name"].as_str().map(|s| s.to_string())).collect()
    }).unwrap_or_default();

    let mut credits: Vec<TrackCredit> = vec![];
    let mut iswc: Option<String> = None;
    let mut wikidata_qid: Option<String> = None;

    let relations = rec["relations"].as_array().cloned().unwrap_or_default();
    for rel in &relations {
        if let (Some(role), Some(name)) = (rel["type"].as_str(), rel["artist"]["name"].as_str()) {
            credits.push(TrackCredit { role: role.to_string(), name: name.to_string() });
        }
        if let Some(url) = rel["url"]["resource"].as_str() {
            if let Some(qid) = extract_wikidata_qid(url) {
                wikidata_qid = Some(qid);
            }
        }
        if let Some(work_id) = rel["work"]["id"].as_str() {
            let work_url = format!("https://musicbrainz.org/ws/2/work/{}?inc=artist-rels&fmt=json", work_id);
            let wr = mb_get_json_rotating(&work_url, &[last_effective_ua.clone()]).await;
            if wr.outcome == "success" {
                if let Some(iswcs) = wr.data["iswcs"].as_array() {
                    if let Some(first) = iswcs.first().and_then(|v| v.as_str()) {
                        iswc = Some(first.to_string());
                    }
                }
                if let Some(work_rels) = wr.data["relations"].as_array() {
                    for wrel in work_rels {
                        if let (Some(role), Some(name)) = (wrel["type"].as_str(), wrel["artist"]["name"].as_str()) {
                            credits.push(TrackCredit { role: role.to_string(), name: name.to_string() });
                        }
                    }
                }
            }
        }
    }

    MbTrackWithUa {
        result: MbTrackResult { mbid, iswc, tags, credits, wikidata_qid },
        effective_ua: last_effective_ua,
        outcome: "success".to_string(),
    }
}

/// Resultat MusicBrainz (artiste) avec UA effectif et outcome.
pub struct MbArtistWithUa {
    pub result: MbArtistResult,
    pub effective_ua: String,
    pub outcome: String,
}

/// Variante UA-aware de fetch_mb_artist.
pub async fn fetch_mb_artist_ua(artist_name: &str, ranked_uas: &[String]) -> MbArtistWithUa {
    let q = format!("artist:\"{}\"", artist_name);
    let search_url = format!(
        "https://musicbrainz.org/ws/2/artist/?query={}&limit=1&fmt=json",
        urlencoding::encode(&q)
    );
    let res = mb_get_json_rotating(&search_url, ranked_uas).await;
    let effective_ua = res.effective_ua.clone();

    if res.outcome != "success" {
        return MbArtistWithUa { result: MbArtistResult::default(), effective_ua, outcome: res.outcome };
    }

    let candidate_id = match res.data["artists"].as_array().and_then(|a| a.first()).and_then(|a| a["id"].as_str()) {
        Some(id) => id.to_string(),
        None => return MbArtistWithUa { result: MbArtistResult::default(), effective_ua, outcome: "failure".to_string() },
    };

    let detail_url = format!(
        "https://musicbrainz.org/ws/2/artist/{}?inc=artist-rels+url-rels+tags&fmt=json",
        candidate_id
    );
    let det = mb_get_json_rotating(&detail_url, &[effective_ua.clone()]).await;
    if det.outcome != "success" {
        return MbArtistWithUa { result: MbArtistResult::default(), effective_ua, outcome: det.outcome };
    }

    let artist_data = det.data;
    let life_span = &artist_data["life-span"];
    let tags: Vec<String> = artist_data["tags"].as_array().map(|arr| {
        arr.iter().filter_map(|t| t["name"].as_str().map(|s| s.to_string())).collect()
    }).unwrap_or_default();

    let mut wikidata_qid: Option<String> = None;
    let mut members: Vec<BandMember> = vec![];
    let relations = artist_data["relations"].as_array().cloned().unwrap_or_default();
    for rel in &relations {
        if let Some(url) = rel["url"]["resource"].as_str() {
            if let Some(qid) = extract_wikidata_qid(url) {
                wikidata_qid = Some(qid);
            }
        }
        if rel["type"].as_str() == Some("member of band") {
            if let Some(name) = rel["artist"]["name"].as_str() {
                members.push(BandMember {
                    name: name.to_string(),
                    photo_url: None,
                    join_date: rel["begin"].as_str().map(|s| s.to_string()),
                    leave_date: rel["end"].as_str().map(|s| s.to_string()),
                    is_current: rel["ended"].as_bool().map(|ended| !ended).or(Some(true)),
                });
            }
        }
    }

    MbArtistWithUa {
        result: MbArtistResult {
            mbid: Some(candidate_id),
            life_span_begin: life_span["begin"].as_str().map(|s| s.to_string()),
            life_span_end: life_span["end"].as_str().map(|s| s.to_string()),
            is_ended: life_span["ended"].as_bool(),
            tags,
            wikidata_qid,
            members,
        },
        effective_ua,
        outcome: "success".to_string(),
    }
}

/// Variante UA-aware de fetch_lrc_lyrics.
/// Retourne (result, effective_ua, outcome).
pub async fn fetch_lrc_lyrics_ua(
    artist: &str,
    title: &str,
    album: &str,
    duration_secs: f64,
    ranked_uas: &[String],
) -> (Option<LrcLyricsResult>, String, String) {
    let mut params = vec![
        ("artist_name", artist.to_string()),
        ("track_name", title.to_string()),
    ];
    if !album.is_empty() && album != "Album inconnu" {
        params.push(("album_name", album.to_string()));
    }
    if duration_secs > 0.0 {
        params.push(("duration", (duration_secs.round() as i64).to_string()));
    }
    let qs: String = params.iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>().join("&");

    let url = format!("https://lrclib.net/api/get?{}", qs);
    let res = get_json_rotating(&url, ranked_uas, None).await;
    let effective_ua = res.effective_ua.clone();

    if res.outcome == "success" {
        let plain = res.data["plainLyrics"].as_str().map(|s| s.to_string());
        let synced = res.data["syncedLyrics"].as_str().map(|s| s.to_string());
        let instrumental = res.data["instrumental"].as_bool().unwrap_or(false);
        if plain.is_some() || synced.is_some() || instrumental {
            return (Some(LrcLyricsResult { plain_lyrics: plain, synced_lyrics: synced, is_instrumental: instrumental }), effective_ua, "success".to_string());
        }
    }

    // Repli search
    let search_url = format!(
        "https://lrclib.net/api/search?artist_name={}&track_name={}",
        urlencoding::encode(artist), urlencoding::encode(title)
    );
    let res2 = get_json_rotating(&search_url, &[effective_ua.clone()], None).await;
    let effective_ua2 = res2.effective_ua.clone();
    if res2.outcome == "success" {
        if let Some(best) = res2.data.as_array().and_then(|a| a.first()) {
            return (Some(LrcLyricsResult {
                plain_lyrics: best["plainLyrics"].as_str().map(|s| s.to_string()),
                synced_lyrics: best["syncedLyrics"].as_str().map(|s| s.to_string()),
                is_instrumental: best["instrumental"].as_bool().unwrap_or(false),
            }), effective_ua2, "success".to_string());
        }
    }

    (None, effective_ua, "failure".to_string())
}

/// Variante UA-aware de fetch_deezer_artist.
pub async fn fetch_deezer_artist_ua(
    artist_name: &str,
    ranked_uas: &[String],
) -> (Option<String>, Option<i64>, String, String) {
    let url = format!(
        "https://api.deezer.com/search/artist?q={}&limit=1",
        urlencoding::encode(artist_name)
    );
    let res = get_json_rotating(&url, ranked_uas, None).await;
    let effective_ua = res.effective_ua.clone();
    if res.outcome == "success" {
        if let Some(item) = res.data["data"].as_array().and_then(|a| a.first()) {
            let id = item["id"].as_u64().map(|v| v.to_string());
            let fans = item["nb_fan"].as_i64();
            return (id, fans, effective_ua, "success".to_string());
        }
    }
    (None, None, effective_ua, res.outcome)
}
