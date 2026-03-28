# Sortify

Sortify is a browser-based playlist manager for Spotify. Import playlists from Spotify or local files, manage and reorganize tracks across multiple playlists in a unified workspace, and export back to Spotify or as local files whenever you like.

This implementation is entirely in vanilla JavaScript with no backend — all data persists in the browser via IndexedDB. A Vue 3 / TypeScript rewrite is in progress, with cleaner component architecture, stronger type safety, and more advanced analysis tools.

---

## Features

- **Spotify import/export** — OAuth 2.0 (PKCE) authentication; imports all user playlists with full pagination; exports back as new private Spotify playlists.
- **CSV and JSON I/O** — multi-file import from CSV or JSON, export as CSV with minimal fields, full fields, or JSON bundle.
- **Multi-playlist workspace** — view tracks across several playlists simultaneously in a single sortable, filterable table.
- **Sort and filter** — sort by title, artist, album, number of playlists, or original order; live search filters the visible table.
- **Track management** — Playlist membership is toggablable with a checkbox matrix (including multi track selection and actions). Easy playlist creation, duplication, and mass modification. 
- **Lazy rendering** — large libraries load incrementally using an IntersectionObserver sentinel rather than rendering all rows at once

---

## Architecture

```
index.html / app.js         — Dashboard: import/export, library overview, workspace launcher
workspace/                  — Workspace: multi-playlist table, sort/filter/select, track operations
shared/                     — Shared data layer and UI components used by both surfaces
  adapters/                 — I/O adapters (CSV, JSON, Spotify import/export)
  dataManager.js            — Generic IndexedDB CRUD wrapper
  ioManager.js              — Adapter registry; routes import/export calls by key
  models.js                 — Canonical track and playlist constructors
  trackUtils.js             — Pure sort/filter helpers (no DOM, safe to import anywhere)
  modal.js                  — All modal UI (no native alert/confirm/prompt used)
  spotifyAuthManager.js     — PKCE OAuth flow and token lifecycle
```

### Key design decisions

**No backend.** Authentication uses the PKCE (Proof Key for Code Exchange) extension to OAuth 2.0, which allows a public client app to safely obtain Spotify access tokens without a client secret or server. The client ID is intentionally public sand safe.

**Adapter pattern for I/O.** `ioManager` acts as a central adapter registry. All import and export operations register a key at startup, so callers don't need to know which adapter handles a given format. Adding a new format only requires writing the adapter and registering it — nothing else changes.

**Session handoff.** The dashboard writes selected playlist IDs to `sessionStorage` before navigating to the workspace. The workspace reads them on load and hydrates from IndexedDB. This keeps the two surfaces fully decoupled while sharing data through a known, inspectable channel.

**Lazy rendering with IntersectionObserver.** The workspace table renders 100 rows at a time. A sentinel element at the bottom of the list triggers the next batch when scrolled into view. This keeps initial render fast even for libraries with thousands of tracks and many selected playlists.

**Flat data model.** Tracks are stored once as unique records (keyed by Spotify URI or a generated ID); playlists store ordered arrays of track IDs. Lookups on render are cheap, and deduplication across playlists is straightforward.

---

## Data model

```
Track   { trackID, title, artist, album, source, ...optionalFields }
Playlist { id, name, trackIDs[], playlistURI?, timeAdded?, lastModified?}
Workspace (sessionStorage) {playlistIds, timestamp}
```

All data lives in **IndexedDB** (`SortifyDB`, version 4), two object stores: `tracks` (keyed by `trackID`) and `playlists` (auto-increment integer key).

---

## Spotify API Use

Endpoints in use: `GET /me/playlists`, `GET /playlists/{id}/items`, `POST /me/playlists`, `POST /playlists/{id}/items`. All non-deprecated (As of March 2026)

Rate limiting is handled with a 3-attempt retry loop that reads the `Retry-After` response header when available and falls back to a 30-second wait. A configurable sleep between sequential playlist operations prevents sustained bursts on large libraries.

Displayed spotify tracks and playlists (sourced via the API or indirectly through local files) can be opened directly in the spotify app or web player, via the "Open in Spotify / Copy Spotify ID" dropdown actions for the respective track or playlist.
---

## Status

Feature-complete for the current vanilla JS scope. A Vue 3 / TypeScript rewrite is in active development. This repository is preserved as a proof-of-concept and reference for the original architecture.

Upcoming features include improved overlap analysis across a library, duplicate detection in playlists or playlist groups, and a compact web player. 

