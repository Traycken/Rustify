# Rustify — Lecteur de musique local (Tauri 2 / Rust)

## Backlog

**Phase 1 — MVP (implémenté)**
- [x] Import récursif d'un dossier (scan disque, extensions mp3/flac/wav/ogg/m4a/aac/opus)
- [x] Extraction métadonnées (titre, artiste, album, album-artiste, genre, année, piste, durée) via `lofty`
- [x] Persistance SQLite locale (`rusqlite`, bundled, WAL) — table `tracks`
- [x] Vues Bibliothèque / Albums / Artistes (agrégation SQL)
- [x] Playlists (création, ajout de piste, lecture)
- [x] Moteur audio `rodio` : play/pause/resume/stop/seek/volume/next/prev
- [x] File de lecture (queue), navigation prev/next
- [x] Répétition / lecture aléatoire (état frontend + flags backend prêts)
- [x] Recherche texte (titre/artiste/album) côté frontend
- [x] UI : sidebar navigation, table pistes, grilles albums/artistes, barre lecteur (vinyle animé)

**Phase 2 — Non implémenté (backlog restant, par priorité)**
1. Pochettes réelles (extraction `lofty` pictures → cache disque → `convertFileSrc`/asset protocol, affichage dans `.vinyl-cover` et grilles)
2. Auto-enchaînement fiable en fin de piste (event `sink` empty → callback backend → `emit` vers frontend, plutôt que polling 1s actuel)
3. Suppression de pistes disparues du disque (sync bidirectionnelle scan ↔ DB, actuellement append/update seul — **pas de suppression automatique**, cf. no-drop : nécessite validation utilisateur explicite avant DELETE)
4. Gestion multi-dossiers surveillés + rescan incrémental (mtime)
5. Drag & drop réordonnancement playlist / queue
6. Raccourcis clavier globaux (media keys OS)
7. Égaliseur / normalisation volume (ReplayGain)
8. Icônes d'application réelles (voir Build ci-dessous)
9. Tests automatisés (voir section Tests)

## Architecture

```
rustify/
├── src/                    Frontend (Vite + TypeScript, vanilla — pas de framework)
│   ├── main.ts              Logique UI, appels invoke() vers le backend
│   └── style.css            Identité visuelle (palette sombre, accent ambre, signature "vinyle")
├── index.html
├── src-tauri/
│   ├── src/
│   │   ├── main.rs           Entrée, enregistrement des commandes Tauri
│   │   ├── state.rs           AppState (Mutex<Connection>, Mutex<Player>)
│   │   ├── db.rs              Schéma SQLite + CRUD (tracks, playlists, playlist_tracks)
│   │   ├── scanner.rs          Walk disque + extraction tags (lofty)
│   │   ├── player.rs           Moteur audio (rodio) : queue, transport, seek, volume
│   │   ├── commands.rs         Surface IPC exposée au frontend
│   │   └── models.rs           Structs Serialize/Deserialize partagées
│   ├── capabilities/default.json   Permissions Tauri 2 (core + dialog)
│   ├── tauri.conf.json
│   └── Cargo.toml
```

**Flux de données** : Frontend → `invoke()` → `commands.rs` → verrouille `AppState` → délègue à `db.rs` (SQLite) ou `player.rs` (rodio) → retour `Result<T, String>` sérialisé.

**Choix structurants**
- SQLite plutôt que JSON plat : requêtes d'agrégation (albums/artistes) natives, scalabilité bibliothèque volumineuse.
- `rodio` + `Sink::try_seek` : lecture décodée en flux, seek natif sans reconstruction de pipeline (rodio ≥ 0.19).
- Polling 1s de l'état lecteur (Phase 1) au lieu d'événements push : simplicité initiale, marqué en dette Phase 2 (item 2).
- Pas de framework frontend (React/Vue) : surface UI volontairement réduite, DOM direct suffisant, zéro dépendance de build superflue.

## Build — Windows 10 Pro (i7-6700K / GTX 1070)

Aucune dépendance CUDA/PyTorch requise ici (hors périmètre : application audio, pas ML).

Prérequis :
```powershell
# Rust
winget install Rustlang.Rustup
# Node LTS
winget install OpenJS.NodeJS.LTS
# Toolchain MSVC (WebView2 + linker) — via Visual Studio Build Tools, workload "Desktop development with C++"
```

Installation et lancement dev :
```powershell
cd rustify
npm install
npm run tauri dev
```

Icônes : déjà fournies dans `src-tauri/icons/` (32x32, 128x128, 128x128@2x, icon.ico, icon.png master 512×512). Pas d'étape supplémentaire requise pour une cible Windows (`icon.icns` — macOS uniquement — absent, non nécessaire ici). Pour régénérer depuis un autre visuel :
```powershell
npm run tauri icon chemin\vers\logo.png
```

Build release :
```powershell
npm run tauri build
```

## Correctif — `cpal::Stream` non-Send (build Windows)

**Cause** : `rodio::OutputStream` embarque en interne un `cpal::platform::Stream` marqué `!Send` sur toutes les plateformes (implémentation MSVC/WASAPI incluse). `Player` était stocké dans `Mutex<Player>` géré directement par Tauri (`state.manage(...)`), qui exige `T: Send + Sync`. Conséquence : échec de compilation (`E0277`) sur toute commande touchant `AppState`.

**Correction** : le moteur audio (`Engine`, ex-`Player`) est désormais possédé exclusivement par un thread dédié, créé une seule fois dans `player::spawn_player_thread()`. Communication :
- `Sender<PlayerCommand>` (Send, sans type audio) — les commandes `commands.rs` envoient des messages plutôt que d'appeler directement le moteur.
- `Arc<Mutex<PlayerState>>` — snapshot recalculé à chaque itération (~250 ms ou sur commande), lu par `get_player_state` sans jamais toucher au flux audio.

**Effets de bord contrôlés** :
- Fin de piste : détectée côté thread audio (`track_just_finished`), avance automatique corrigée pour ne plus reboucler sur la même piste en fin de file sans répétition active.
- `repeat`/`shuffle` : déplacés côté backend (source unique de vérité) ; le frontend n'a plus d'état local divergent — `btn-repeat`/`btn-shuffle` appellent désormais `toggle_repeat`/`toggle_shuffle` et se resynchronisent via `get_player_state`.
- Latence de commande : borne haute ~250 ms (intervalle du `recv_timeout`) avant qu'une commande en attente ne soit traitée si aucune n'arrive entre-temps — négligeable pour des actions UI (play/pause/seek), acceptable en l'état.

**Sous-correctif n°2** : `std::thread::spawn` exige que la *closure* soit `Send` — construire `Engine` avant l'appel puis le capturer par `move` échoue pour la même raison que le cas initial (l'`Engine` non-Send transite dans la closure). Correction : `Engine::new()` est appelé **à l'intérieur** de la closure exécutée par le thread, jamais avant. Rien de non-Send ne traverse plus de frontière de thread, à aucun moment.

## Correctif — `EBUSY` watcher Vite (Windows, `tauri dev`)

**Cause** : le watcher de fichiers de Vite (chokidar) surveillait tout le répertoire du projet, y compris `src-tauri/target/`. Sous Windows, cargo verrouille ses `.dll`/`.rlib` pendant la compilation — Vite tentait de les observer en parallèle → `EBUSY`, crash du process `beforeDevCommand`.

**Correction** : `vite.config.ts` exclut désormais `**/src-tauri/**` du watcher (`server.watch.ignored`). Vite n'a de toute façon jamais besoin de surveiller le code Rust — seul `cargo`/Tauri en a la charge.

**Effet de bord** : aucun. Le frontend (`src/`, `index.html`) reste surveillé normalement.

## Tests (non implémentés — recommandation TDD)

Structure cible à ajouter :
- `src-tauri/src/db.rs` : tests unitaires sur `Connection::open_in_memory()` (upsert, agrégation albums/artistes, playlists CRUD)
- `src-tauri/src/scanner.rs` : tests sur fixtures audio courtes committées dans `tests/fixtures/`
- `src-tauri/src/player.rs` : tests limités (dépendance périphérique audio réel) — isoler la logique de queue/index de la couche `rodio` (déjà séparée) pour tests purs sans device

## Analyse d'impact — points de vigilance (no-drop)

- `scanner::scan_directory` fait uniquement **upsert** (`ON CONFLICT ... DO UPDATE`) : aucune piste n'est supprimée automatiquement si le fichier disparaît du disque. Toute suppression doit être un flux explicite Phase 2 (item 3), jamais silencieux.
- `db::add_to_playlist` utilise `INSERT OR IGNORE` : pas d'écrasement de position existante.
