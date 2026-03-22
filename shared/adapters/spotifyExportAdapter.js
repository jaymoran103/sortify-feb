// Spotify export adapter. Pushes local IDB playlists to the user's Spotify account
// as new private playlists. Delegates auth to spotifyAuthManager.

import spotifyAuthManager from '../spotifyAuthManager.js';
import { SLEEP_BETWEEN_PLAYLISTS_MS } from '../spotifyConfig.js';


// API HELPERS

const BASE_URL = 'https://api.spotify.com/v1';

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// GET wrapper: adds auth header, retries on 429 up to 3 times using Retry-After value.
// Retry-After is not always exposed over CORS, so we fall back to 30s per attempt.
// FUTURE: Refactor to use a shared API helper module.
async function _apiFetch(endpoint, token) {
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

// POST wrapper: sends JSON body with auth header, throws on non-2xx
async function _apiPost(endpoint, token, body) {
    const response = await fetch(BASE_URL + endpoint, {
        method:  'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Spotify API ${response.status} on ${endpoint}${err.error?.message ? ': ' + err.error.message : ''}`);
    }

    return response.json();
}


// EXPORT ADAPTER

class SpotifyExportAdapter {

    // Create a new private Spotify playlist for the current user.
    // Uses /me/playlists — the current (non-deprecated) create endpoint.
    // Returns { id, url }
    async _createPlaylist(token, name) {
        const data = await _apiPost('/me/playlists', token, {
            name,
            public:      false,
            description: 'Exported from Sortify',
        });
        return { id: data.id, url: data.external_urls.spotify };
    }

    // Add tracks to an existing Spotify playlist in chunks of 100 (API limit per request).
    // Uses /playlists/{id}/items — the current (non-deprecated) write endpoint.
    async _addTracks(token, playlistId, uris, onProgress) {
        const total = uris.length;

        for (let i = 0; i < total; i += 100) {
            const chunk = uris.slice(i, i + 100);
            await _apiPost(`/playlists/${playlistId}/items`, token, { uris: chunk });
            if (onProgress) onProgress(Math.min(i + 100, total), total);
        }
    }

    // Export an array of local IDB playlists to the user's Spotify account.
    // playlists: [{ id, name, trackIDs }]
    // Skips playlists where no tracks have a valid Spotify URI (e.g. CSV-imported only).
    // Returns [{ name, url }] — url is null for skipped playlists.
    async exportPlaylists(playlists, dataManager, onProgress) {
        const token   = await spotifyAuthManager.getAccessToken();
        const results = [];

        for (let i = 0; i < playlists.length; i++) {
            const pl = playlists[i];

            // Fetch all track objects from IDB for this playlist
            const tracks = await Promise.all(
                pl.trackIDs.map(id => dataManager.getRecord('tracks', id))
            );

            // Only Spotify-sourced tracks have a valid spotify:track: URI
            const uris = tracks
                .filter(t => t?.trackID?.startsWith('spotify:track:'))
                .map(t => t.trackID);

            if (uris.length === 0) {
                console.warn(`[Spotify] Skipping export of "${pl.name}" — no valid Spotify track URIs.`);
                results.push({ name: pl.name, url: null });
                continue;
            }

            const created = await this._createPlaylist(token, pl.name);
            await this._addTracks(
                token, created.id, uris,
                (done, total) => onProgress && onProgress(done, total, `Adding tracks to "${pl.name}"...`)
            );

            results.push({ name: pl.name, url: created.url });
            if (onProgress) onProgress(i + 1, playlists.length, pl.name);

            // Brief pause between playlists to stay under Spotify rate limits
            if (i < playlists.length - 1) await _sleep(SLEEP_BETWEEN_PLAYLISTS_MS);
        }

        return results;
    }
}

export default new SpotifyExportAdapter();
