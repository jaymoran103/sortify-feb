// Spotify import adapter. Fetches playlists + tracks from the Spotify API and stores
// them in IDB via dataManager. Delegates auth to spotifyAuthManager.

import {SLEEP_BETWEEN_PLAYLISTS_MS} from '../spotifyConfig.js';
import { createPlaylist, createTrack } from '../models.js';


// API HELPERS

const BASE_URL = 'https://api.spotify.com/v1';

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}



// Fetch wrapper: adds auth header, retries on 429 up to 3 times using Retry-After value.
// Retry-After is not always exposed over CORS, so we fall back to 30s per attempt —
// long enough to clear Spotify's typical rate-limit window.
// onRateLimit(seconds) is called before each wait so callers can surface it in the UI.
// FUTURE: Refactor to use a shared API helper module. (At least 429 handling)
async function _apiFetch(endpoint, token, onRateLimit) {
    const url     = BASE_URL + endpoint;
    const headers = { 'Authorization': 'Bearer ' + token };

    // Attempt to get response, returning unless a 429 error is encountered - in which case it waits 
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(url, { headers });
        if (response.status !== 429) break;

        // Use Retry-After header if available; fall back to 30s (Spotify's typical window)
        const retryAfter = Number(response.headers.get('Retry-After') || 0); // report result as 0 if not reeived
        const waitMs     = retryAfter > 0 ? (retryAfter + 1) * 1000 : 30000; // add 1s to buffer, or use 30s if no retryAfter provided
        if (onRateLimit) onRateLimit(Math.round(waitMs / 1000)); // report wait time to caller so it can update the UI
        await _sleep(waitMs);
    }

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`Spotify API ${response.status} on ${endpoint}${body.error?.message ? ': ' + body.error.message : ''}`);
    }

    return response.json();
}


// IMPORT ADAPTER

class SpotifyImportAdapter {

    // Fetch all playlists for the authenticated user, paginating until none remain.
    // onProgress(collected, total) called after each page.
    // onRateLimit(seconds) called before each 429 wait so the caller can update the UI.
    // Returns [{ spotifyPlaylistId, name, trackCount }]
    async fetchUserPlaylists(token, onProgress, onRateLimit) {
        const all  = [];
        let offset = 0;
        let total  = null;

        while (true) {
            const data = await _apiFetch(`/me/playlists?limit=50&offset=${offset}`, token, onRateLimit);
            if (total === null) total = data.total;

            for (const item of data.items) {
                // API may return track count under either key depending on playlist type
                const trackInfo = item?.items || item?.tracks;
                if (!item || !trackInfo) {
                    console.warn('[Spotify] Skipping malformed playlist item:', item);
                    continue;
                }
                all.push({ spotifyPlaylistId: item.id, name: item.name, trackCount: trackInfo.total });
            }

            if (onProgress) onProgress(all.length, total);
            if (!data.next) break;
            offset += 50;
        }

        return all;
    }

    // Fetch all tracks for a single playlist, paginating until none remain.
    // Skips null entries (local files, deleted tracks, podcast episodes).
    // onProgress(collected, total) is called after each page if provided.
    // FUTURE: For very large libraries, surface per-playlist progress in the selection modal
    //         itself (spinner/count while playlists load) rather than the status bar.
    // Returns array of raw Spotify track objects.
    async fetchPlaylistItems(token, spotifyPlaylistId, onProgress) {
        const all  = [];
        let offset = 0;
        let total  = null;

        while (true) {
            const data = await _apiFetch(`/playlists/${spotifyPlaylistId}/items?limit=50&offset=${offset}`, token);
            if (total === null) total = data.total;

            for (const item of data.items) {
                // item.item is null for local files, deleted tracks, podcast episodes — skip those
                if (!item.item || !item.item.uri) continue;
                all.push(item.item);
            }

            if (onProgress) onProgress(all.length, total);
            if (!data.next) break;
            offset += 50;
        }

        return all;
    }

    // Map a raw Spotify track object to the internal data model
    _normalizeTrack(spotifyTrackObj) {
        return createTrack(
            spotifyTrackObj.uri,
            spotifyTrackObj.name,
            spotifyTrackObj.album.name,
            spotifyTrackObj.artists.map(a => a.name).join(', '),
            'spotify',
            {
                popularity: spotifyTrackObj.popularity,
                explicit:   spotifyTrackObj.explicit,
                duration:   spotifyTrackObj.duration_ms,
            }
        );
    }

    // Import a set of selected Spotify playlists into IDB.
    // selectedPlaylists: [{ spotifyPlaylistId, name, trackCount }]
    // Skips 403/restricted playlists with a warning rather than failing the whole import.
    // onProgress(tracksDone, tracksTotal, name) uses track-level units — bar moves per track,
    // not per playlist. During fetch phases, done = previously stored + currently fetched.
    // trackCount from the playlist object may not exactly match fetchPlaylistItems total
    // (local files/deleted tracks are skipped), but the delta is small enough for the bar.
    // Returns { totalProcessed, uniqueAdded, skipped }
    async importSelected(dataManager, token, selectedPlaylists, onProgress) {
        let totalProcessed = 0;
        let uniqueAdded    = 0;
        let skipped        = 0;

        // Sum declared track counts for a total — used as the bar denominator throughout
        const totalTracks   = selectedPlaylists.reduce((sum, pl) => sum + pl.trackCount, 0);
        let tracksImported  = 0;

        for (let i = 0; i < selectedPlaylists.length; i++) {
            const { spotifyPlaylistId, name } = selectedPlaylists[i];

            // Fetch tracks — on 403 (restricted/Spotify-owned playlist) skip and continue
            let rawTracks;
            try {
                rawTracks = await this.fetchPlaylistItems(
                    token, spotifyPlaylistId,
                    // During fetch, show progress as previously stored + currently fetched
                    (done, _total) => onProgress && onProgress(tracksImported + done, totalTracks, name)
                );
            } catch (err) {
                console.warn(`[Spotify] Skipping "${name}" (${spotifyPlaylistId}): ${err.message}`);
                skipped++;
                continue;
            }

            // Normalize, deduplicate, and store each track
            const trackIDs = [];
            for (const raw of rawTracks) {
                totalProcessed++;
                const track    = this._normalizeTrack(raw);
                const existing = await dataManager.getRecord('tracks', track.trackID);

                if (existing) {
                    // Track already in IDB — still include it in this playlist's track list
                    trackIDs.push(track.trackID);
                    skipped++;
                } else {
                    try {
                        await dataManager.createRecord('tracks', track);
                        trackIDs.push(track.trackID);
                        uniqueAdded++;
                    } catch (err) {
                        console.error(`[Spotify] Failed to store track ${track.trackID}:`, err);
                        skipped++;
                    }
                }

                // Update bar per track stored
                tracksImported++;
                if (onProgress) onProgress(tracksImported, totalTracks, name);
            }

            // Create playlist record in IDB with spotify:playlist:{id} URI so we can identify it as Spotify-sourced later if needed.
            const uri = `spotify:playlist:${spotifyPlaylistId}`;
            await dataManager.createRecord('playlists', createPlaylist(name, trackIDs, uri, new Date().toISOString()));

            // Brief pause between playlists to stay under Spotify rate limits
            if (i < selectedPlaylists.length - 1) await _sleep(SLEEP_BETWEEN_PLAYLISTS_MS);
        }

        return { totalProcessed, uniqueAdded, skipped };
    }
}

export default new SpotifyImportAdapter();
