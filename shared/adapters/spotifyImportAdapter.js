// Spotify import adapter. Fetches playlists + tracks from the Spotify API and stores
// them in IDB via dataManager. Delegates auth to spotifyAuthManager.

import spotifyAuthManager from '../spotifyAuthManager.js';
import { createPlaylist, createTrack } from '../models.js';


// API HELPERS

const BASE_URL = 'https://api.spotify.com/v1';

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch wrapper: adds auth header, handles one 429 retry using Retry-After value
async function _apiFetch(endpoint, token) {
    const url     = BASE_URL + endpoint;
    const headers = { 'Authorization': 'Bearer ' + token };
    let response  = await fetch(url, { headers });

    // Rate limited: wait the requested delay then retry once
    if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') || 1);
        await _sleep((retryAfter + 1) * 1000);
        response = await fetch(url, { headers });
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
    // Returns [{ spotifyPlaylistId, name, trackCount }]
    async fetchUserPlaylists(token) {
        const all  = [];
        let offset = 0;

        while (true) {
            const data = await _apiFetch(`/me/playlists?limit=50&offset=${offset}`, token);
            console.log(`Fetching playlists from user library: collected ${all.length} of ${data.total}`);

            for (const item of data.items) {
                // API may return track count under either key depending on playlist type
                const trackInfo = item?.items || item?.tracks;
                if (!item || !trackInfo) {
                    console.warn('[Spotify] Skipping malformed playlist item:', item);
                    continue;
                }
                all.push({ spotifyPlaylistId: item.id, name: item.name, trackCount: trackInfo.total });
            }

            if (!data.next) break;
            offset += 50;
        }

        return all;
    }

    // Fetch all tracks for a single playlist, paginating until none remain.
    // Skips null entries (local files, deleted tracks, podcast episodes).
    // Calls onProgress(collected, total) after each page (if provided.) //TODO for large imports, have fetchUserPlaylists do this instead.
    // Returns array of raw Spotify track objects.
    async fetchPlaylistItems(token, spotifyPlaylistId, onProgress) {
        const all  = [];
        let offset = 0;
        let total  = null;

        while (true) {
            const data = await _apiFetch(`/playlists/${spotifyPlaylistId}/items?limit=50&offset=${offset}`, token);
            console.log(`Fetching tracks for playlist ${spotifyPlaylistId}: collected ${all.length} of ${data.total}`);
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
    // selectedPlaylists: [{ spotifyPlaylistId, name }]
    // Skips 403/restricted playlists with a warning rather than failing the whole import.
    // Returns { totalProcessed, uniqueAdded, skipped }
    async importSelected(dataManager, token, selectedPlaylists, onProgress) {
        let totalProcessed = 0;
        let uniqueAdded    = 0;
        let skipped        = 0;

        for (let i = 0; i < selectedPlaylists.length; i++) {
            console.log(`Importing playlist ${i + 1} of ${selectedPlaylists.length}...`);
            const { spotifyPlaylistId, name } = selectedPlaylists[i];

            // Fetch tracks — on 403 (restricted/Spotify-owned playlist) skip and continue
            let rawTracks;
            try {
                rawTracks = await this.fetchPlaylistItems(
                    token, spotifyPlaylistId,
                    (done, total) => onProgress && onProgress(done, total, `Fetching "${name}"...`)
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
                    continue;
                }

                try {
                    await dataManager.createRecord('tracks', track);
                    trackIDs.push(track.trackID);
                    uniqueAdded++;
                } catch (err) {
                    console.error(`[Spotify] Failed to store track ${track.trackID}:`, err);
                    skipped++;
                }
            }

            // Create the playlist record in IDB with all collected track IDs
            await dataManager.createRecord('playlists', createPlaylist(name, trackIDs));
            if (onProgress) onProgress(i + 1, selectedPlaylists.length, name);

            // Brief pause between playlists to stay under Spotify rate limits
            if (i < selectedPlaylists.length - 1) await _sleep(150);
            // if (i < selectedPlaylists.length - 1) await _sleep(1000);
        }

        return { totalProcessed, uniqueAdded, skipped };
    }
}

export default new SpotifyImportAdapter();
