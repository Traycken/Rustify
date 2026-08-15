# 🤖 Guide d'Architecture & Sommaire IA pour Rustify

Bienvenue dans le guide d'ingénierie et d'architecture de **Rustify** conçu pour la maintenance, l'extension et le refactoring assisté par Intelligence Artificielle.

---

## 🎯 Directives & Règles d'Or pour les IA

1. **Taille maximale des fichiers** : Conserver chaque fichier **sous la barre des 2 000 lignes** (l'objectif idéal est de maintenir chaque module en dessous de 500 lines).
2. **Pas de logique monolithique** : Ne jamais réinjecter du code volumineux dans `src/main.ts`. `src/main.ts` doit rester un point d'entrée ultra-léger d'orchestration.
3. **Gestion de l'État Global** : L'état global réactif réside dans `src/state.ts`. Pour éviter les problèmes d'initialisation cyclique des modules, importer les getters, setters et références réactives depuis `src/state.ts`.
4. **Typage strict** : Toutes les interfaces de données (TypeScript) sont centrales dans `src/types.ts`.
5. **Modales & Onglets découplés** : Chaque onglet de la sidebar a son propre contrôleur dédié dans `src/tabs/`, et chaque fenêtre modale est isolée dans `src/modals/`.

---

## 📁 Arborescence des Fichiers Frontend

```
Rustify/
├── index.html                  # Structure HTML réorganisée par section
├── AI_INDEX.md                 # Ce sommaire d'instruction IA
└── src/
    ├── main.ts                 # Point d'entrée principal (< 200 lignes)
    ├── types.ts                # Sommaire de toutes les interfaces TypeScript
    ├── state.ts                # État global réactif & sélecteur $()
    ├── services/
    │   └── tauriApi.ts         # Wrappers IPC type-safe pour Tauri invoke & listen
    ├── utils/
    │   ├── dialog.ts           # Modales appAlert, appConfirm, appPrompt
    │   ├── toast.ts            # Toast de notification modulaire (centre-haut, slideIn/Out)
    │   ├── formatting.ts       # Formatage de temps, HTML escaping, dates, sliders
    │   ├── logger.ts           # Intercepteur d'erreurs, logs frontend/backend, presse-papier
    │   └── navigation.ts       # Pile d'historique (Recul/Avance), switchView & accordéons
    ├── player/
    │   ├── playerEngine.ts     # Moteur audio, Smart Shuffle, suivi des écoutes & boucle de 100ms
    │   └── overlay.ts          # Mini-lecteur vinyle flottant (Fenêtre Overlay autonome)
    ├── modals/
    │   ├── contextMenu.ts      # Menu contextuel dynamique sur clic droit
    │   ├── trackModal.ts       # Fiche morceau & enrichissement avancé (Deezer, MusicBrainz...)
    │   ├── albumModal.ts       # Édition d'album & recherche Web de pochettes
    │   ├── artistModal.ts      # Fiche artiste, recherche photo HD & membres du groupe
    │   ├── genreModal.ts       # Modale de renommage de genre
    │   └── lyricsModal.ts      # Affichage des paroles & paroles synchronisées (LRCLIB)
    └── tabs/
        ├── tracksTab.ts        # Table des morceaux & rendu chunked par paquets
        ├── albumsTab.ts        # Grille d'albums & filtrage par album
        ├── artistsTab.ts       # Grille Artistes Solo vs Groupes & bannières
        ├── genresTab.ts        # Grille des genres & découpage multi-genres
        ├── tempoTab.ts         # Cartes Tempo BPM & analyseur audio batch
        ├── yearsTab.ts         # Cartes Années & Décennies
        ├── playlistsTab.ts     # Playlists personnalisées & système
        ├── radiosTab.ts        # Radios en direct audio/vidéo & statut LIVE/OFF
        ├── recentsTab.ts       # Historique des 100 dernières écoutes
        ├── favoritesTab.ts     # Onglet Favoris ⭐ (morceaux, albums, artistes)
        ├── ecstasyTab.ts       # Onglet Extase 💖 (musiques pépites)
        ├── downloaderTab.ts    # Téléchargeur SpotDL, yt-dlp & UV Python embarqué
        └── settingsTab.ts      # Égaliseur 10 bandes, périphériques audio & raccourcis
```

---

## 📋 Repertoire des Fonctions par Fichier

### 1. `src/types.ts`
- Contient toutes les interfaces : `Track`, `AlbumSummary`, `ArtistSummary`, `Playlist`, `Radio`, `RadioInput`, `EqState`, `EqProfile`, `PlayerState`, `DownloaderSettings`, `DownloaderEnvStatus`, `AdvancedMetadata`, etc.

### 2. `src/state.ts`
- `$(id)` : Sélecteur helper type-safe.
- `allTracks`, `setAllTracks(tracks)` : Registre des morceaux de la bibliothèque.
- `currentQueue`, `setCurrentQueue(queue)` : File de lecture courante.
- `coverCache`, `getCoverDataUrl(path)` : Cache Mémoire / Base64 des couvertures d'albums.
- `playerState`, `setPlayerState(state)` : État du moteur Rust.
- `eqState`, `setEqState(state)` : État de l'égaliseur.

### 3. `src/utils/`
- **`formatting.ts`** : `fmtTime`, `escapeHtml`, `formatMbDate`, `formatFanCount`, `calculateAgeOrDuration`, `formatKeyName`, `updateSliderTrack`.
- **`logger.ts`** : `initConsoleInterceptors`, `pushFrontendLog`, `loadFrontendLogs`, `loadBackendLogs`, `copyElementTextToClipboard`.
- **`dialog.ts`** : `openAppDialog`, `appAlert`, `appConfirm`, `appPrompt`, `showAlert`.
- **`navigation.ts`** : `pushNavState`, `restoreNavState`, `goNavBack`, `goNavForward`, `switchView`, `initCollapsibleSections`.

### 4. `src/modals/`
- **`contextMenu.ts`** : `openGenericContextMenu`, `hideContextMenu`, `positionContextMenu`, `initContextMenuGlobalEvents`.
- **`trackModal.ts`** : `openMetadataModal`, `closeMetadataModal`, `fetchOnlineMetadata`, `runAdvancedEnrichment`, `enrichLibraryInBatch`.
- **`albumModal.ts`** : `openAlbumModal`, `closeAlbumModal`, `fetchOnlineAlbumMetadata`.
- **`artistModal.ts`** : `openArtistModal`, `closeArtistModal`, `searchArtistPhotoOnline`, `enrichArtistPhotosInBatch`.
- **`genreModal.ts`** : `openGenreModal`, `setupGenreModalEvents`.
- **`lyricsModal.ts`** : `openLyricsModal`, `closeLyricsModal`, `setupLyricsModalEvents`.

### 5. `src/player/`
- **`playerEngine.ts`** : `playFromQueue`, `refreshPlayerState`, `applyPlayerState`, `restoreLastPlayerState`, `toggleSmartShuffle`, `pollState`, `registerListenEventBeforeSkip`.
- **`overlay.ts`** : `openOverlayWindow`, `closeOverlayWindow`, `toggleClickThrough`, `updateOverlayUI`, `initOverlayEvents`.

### 6. `src/tabs/`
- **`tracksTab.ts`** : `loadLibrary`, `renderTracks`, `renderTracksInContainer`, `buildTrackRow`, `updateMissingMetadataCount`.
- **`albumsTab.ts`** : `loadAlbums`, `renderAlbumsGrid`, `filterByAlbum`.
- **`artistsTab.ts`** : `loadArtists`, `renderArtistsGrid`, `openArtistView`, `openArtistByName`, `isArtistGroup`, `fetchBandMembersAndBio`, `renderArtistBannerExtras`.
- **`genresTab.ts`** : `loadGenres`, `filterByGenre`, `parseGenres`.
- **`tempoTab.ts`** : `loadTempo`, `filterByTempo`, `getTempoBucket`, `runBpmBatchAnalysis`.
- **`yearsTab.ts`** : `loadYears`, `filterByYear`, `getDecadeLabel`.
- **`playlistsTab.ts`** : `loadPlaylists()`. Gère l'affichage séparé des Playlists Systèmes (Auto-remplies) et des Playlists Créées (Personnalisées).
- **`radiosTab.ts`** : `loadRadios`, `playRadio`, `openRadioModal`, `openRadioLivesModal`, `initRadioEvents`, `syncRadioAudioDevice`. Gère les radios audio, la détection auto des métadonnées, le sélecteur multi-lives en direct et flux streaming vidéo (YouTube @profil/live & Twitch).
- **`recentsTab.ts`** : `loadRecents`.
- **`favoritesTab.ts`** : `loadFavorites()`. Regroupe et sépare proprement les Titres (Favoris ⭐, Aimés 👍, Non aimés 👎 via sous-onglets), les Albums Favoris 💿, les Artistes Solo Favoris 👤, les Groupes Favoris 👥, et les Playlists Créées 📜.
- **`ecstasyTab.ts`** : `loadEcstasyTracks`.
- **`downloaderTab.ts`** : `checkDownloaderEnvStatus`, `setupDownloaderEnv`, `loadDownloaderSettings`, `saveDownloaderSettings`, `startDownloadJob`, `cancelDownloadJob`, `initDownloaderEvents`.
- **`settingsTab.ts`** : `loadAppSettings`, `loadAudioDevices`, `renderAudioDeviceUI`, `selectAudioDevice`, `loadEqState`, `saveEqProfileFromUi`, `matchShortcut`, `initSettingsEvents`.

---

## 🛠️ Instructions pour les futures modifications

- Pour ajouter une nouvelle vue : créer un nouveau fichier dans `src/tabs/monOngletTab.ts`, exporter la fonction `loadMonOnglet()`, ajouter le bouton dans la sidebar de `index.html` et la vue `<div id="view-mononglet" class="view" hidden></div>`, puis relier la vue dans `src/main.ts`.
- Pour ajouter une commande Rust backend : ajouter le wrapper IPC dans `src/services/tauriApi.ts` ou l'invoquer via `invoke("nom_commande", { ... })`.
