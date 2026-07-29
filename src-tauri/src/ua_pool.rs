// ============================================================================
// ua_pool.rs — Pool de User-Agent réalistes + logique de sélection
//
// Stratégie :
//  - 15 UA couvrant Chrome/Firefox/Safari/Edge sur Windows/macOS/Linux/mobile
//  - Plus l'UA officiel Rustify (recommandé par MusicBrainz)
//  - Sélection via score UCB1 : équilibre exploration/exploitation
//  - Sur réponse 429/403 : rotation automatique vers le prochain meilleur UA
//  - Gestion du "blocage temporaire" : pénalité décroissante sur 1 heure
// ============================================================================

use serde::{Deserialize, Serialize};

/// Pool de User-Agent. L'index 0 est l'UA officiel Rustify (pour MusicBrainz),
/// les suivants sont des UA de navigateurs réalistes.
pub const UA_POOL: &[&str] = &[
    // -- Rustify officiel (recommandé par MusicBrainz policy) ------------------
    "Rustify/1.0 (https://github.com/rustify; rustify-app@proton.me)",
    // -- Chrome – Windows ------------------------------------------------------
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.142 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.118 Safari/537.36",
    // -- Firefox – Windows -----------------------------------------------------
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    // -- Microsoft Edge – Windows ----------------------------------------------
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.61",
    // -- Chrome – macOS --------------------------------------------------------
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.76 Safari/537.36",
    // -- Firefox – macOS -------------------------------------------------------
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0",
    // -- Safari – macOS --------------------------------------------------------
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    // -- Chrome – Linux --------------------------------------------------------
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    // -- Firefox – Linux -------------------------------------------------------
    "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
    // -- Chrome – Android (mobile) ---------------------------------------------
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
    // -- Safari – iOS ---------------------------------------------------------
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    // -- Opera – Windows -------------------------------------------------------
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0",
];

/// Noms de domaine d'API surveillés pour les stats.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ApiDomain {
    MusicBrainz,
    Deezer,
    Itunes,
    Lrclib,
    Wikipedia,
    Wikidata,
    Other,
}

impl ApiDomain {
    pub fn as_str(&self) -> &'static str {
        match self {
            ApiDomain::MusicBrainz => "musicbrainz",
            ApiDomain::Deezer      => "deezer",
            ApiDomain::Itunes      => "itunes",
            ApiDomain::Lrclib      => "lrclib",
            ApiDomain::Wikipedia   => "wikipedia",
            ApiDomain::Wikidata    => "wikidata",
            ApiDomain::Other       => "other",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "musicbrainz" => ApiDomain::MusicBrainz,
            "deezer"      => ApiDomain::Deezer,
            "itunes"      => ApiDomain::Itunes,
            "lrclib"      => ApiDomain::Lrclib,
            "wikipedia"   => ApiDomain::Wikipedia,
            "wikidata"    => ApiDomain::Wikidata,
            _             => ApiDomain::Other,
        }
    }

    /// UA préféré recommandé pour cette API (avant de consulter les stats).
    pub fn preferred_ua_index(&self) -> usize {
        match self {
            // MusicBrainz demande explicitement un UA applicatif ? index 0
            ApiDomain::MusicBrainz => 0,
            // Les autres APIs préfèrent des navigateurs réels
            _ => 1,
        }
    }
}

/// Score UCB1 pour la sélection d'un UA.
/// Plus le score est élevé, plus le UA est prioritaire.
pub fn ucb1_score(
    success: i64,
    failure: i64,
    block: i64,
    total_global_uses: i64,
    last_block_secs_ago: Option<i64>,
) -> f64 {
    let uses = success + failure + block;
    let total = total_global_uses.max(1);

    let success_rate = if uses == 0 {
        1.0
    } else {
        success as f64 / uses as f64
    };

    let exploration = (2.0 * (total as f64).ln() / (uses as f64 + 1.0)).sqrt();

    // Pénalité décroissante si blocage récent (décroît linéairement sur 3600 s)
    let block_penalty = match last_block_secs_ago {
        Some(secs) if secs < 3600 => {
            let age_ratio = secs as f64 / 3600.0;
            0.8 * (1.0 - age_ratio)
        }
        _ => 0.0,
    };

    success_rate + exploration - block_penalty
}

/// Renvoie la liste des UA du pool triés par score décroissant pour un API donné.
/// `stats` = liste de (ua_string, successes, failures, blocks, last_block_secs_ago)
pub fn ranked_uas(
    api: &ApiDomain,
    stats: &[(String, i64, i64, i64, Option<i64>)],
    total_global_uses: i64,
) -> Vec<String> {
    let preferred_idx = api.preferred_ua_index();

    let mut scored: Vec<(String, f64)> = UA_POOL
        .iter()
        .enumerate()
        .map(|(i, ua)| {
            let (success, failure, block, last_block) = stats
                .iter()
                .find(|(u, _, _, _, _)| u.as_str() == *ua)
                .map(|(_, s, f, b, lb)| (*s, *f, *b, *lb))
                .unwrap_or((0, 0, 0, None));

            let mut score = ucb1_score(success, failure, block, total_global_uses, last_block);

            // Bonus pour l'UA recommandé par l'API
            if i == preferred_idx {
                score += 0.1;
            }

            (ua.to_string(), score)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().map(|(ua, _)| ua).collect()
}
