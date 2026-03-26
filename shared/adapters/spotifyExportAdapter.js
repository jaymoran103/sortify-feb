// Spotify export adapter. Pushes local IDB playlists to the user's Spotify account
// as new private playlists. Delegates auth and API calls to spotifyAuthManager.

import spotifyAuthManager from '../spotifyAuthManager.js';
import { SLEEP_BETWEEN_PLAYLISTS_MS } from '../spotifyConfig.js';

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// EXPORT ADAPTER

class SpotifyExportAdapter {

    // Create a new private Spotify playlist for the current user.
    // Uses /me/playlists — the current (non-deprecated) create endpoint.
    // Returns { id, url }
    async _createPlaylist(token, name) {
        const data = await spotifyAuthManager.apiPost('/me/playlists', token, {
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
            await spotifyAuthManager.apiPost(`/playlists/${playlistId}/items`, token, { uris: chunk });

            // sleep to avoid hitting rate limits for large playlists
            await _sleep(SLEEP_BETWEEN_PLAYLISTS_MS);

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
                (done, total) => onProgress && onProgress(done, total,`${pl.name} - (${done}/${total})`)
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
