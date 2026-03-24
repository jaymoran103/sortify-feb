// Pure track-list utilities. No DOM, no state. Safe to import from any surface.
// filterTrackIDs: query must already be lowercased by the caller.
// sortTrackIDs: pass stableOrder for deterministic tiebreaking in most-playlists mode.

// Returns filtered array of trackIDs where query matches title, artist, or album.
// trackMap: { [trackID]: trackObject }  — same shape as workspace's `tracks` global.
export function filterTrackIDs(trackIDs, query, trackMap) {
    // If no query (empty or whitespace-only), return original array unfiltered.
    if (!query) {
        return trackIDs;
    }

    // Return a new array of IDs where query is included in the title, artist, or album fields.
    return trackIDs.filter(id => {
        const track = trackMap[id];
        if (!track) return false;
        return (
            (track.title  || "").toLowerCase().includes(query) ||
            (track.artist || "").toLowerCase().includes(query) ||
            (track.album  || "").toLowerCase().includes(query)
        );
    });
}

// Returns sorted array of trackIDs for the given criteria.
// trackMap: { [trackID]: trackObject }
// playlists: session playlist array — needed for "most-playlists" and "playlist:X" modes.
// stableOrder: original insertion-order array — used for deterministic tiebreaking in "most-playlists".
//   Pass [] for callers that don't have a stableOrder; tiebreak falls back to runtime insertion order.
export function sortTrackIDs(trackIDs, criteria, trackMap, playlists, stableOrder = []) {

    // "order-added": return as-is, preserving stableOrder sequence.
    if (criteria === "order-added") {
        return trackIDs;
    }

    // "most-playlists": sort by how many loaded playlists contain each track, descending. Tiebreak by stableOrder position.
    if (criteria === "most-playlists") {

        // Count number of playlists containing each trackID.
        const countMap = new Map();
        for (const playlist of playlists) {
            for (const tid of playlist.trackIDs) {
                countMap.set(tid, (countMap.get(tid) || 0) + 1);
            }
        }

        // Build a map of trackID to original position in stableOrder for tiebreaking.
        const originalPosition = new Map();
        stableOrder.forEach((trackID, index) => {
            originalPosition.set(trackID, index);
        });

        // Sort: most playlists first, then by original position as tiebreaker.
        const sortedTracks = [...trackIDs].sort((a, b) => {
            const countA = countMap.get(a) || 0;
            const countB = countMap.get(b) || 0;

            if (countA !== countB) {
                return countB - countA;
            }
            // Tiebreak by original position in stableOrder
            else {
                const posA = originalPosition.get(a);
                const posB = originalPosition.get(b);
                return posA - posB;
            }
        });

        return sortedTracks;
    }

    // "playlist:PlaylistID": tracks in the named playlist appear first in playlist order;
    // remaining workspace tracks follow in their current filtered order.
    if (criteria.startsWith("playlist:")) {

        // Extract playlistID from criteria and find corresponding playlist.
        const playlistID = criteria.slice(9);
        const playlist = playlists.find(p => p.playlistID === playlistID);

        // Playlist no longer in session — defer to given ID order.
        if (!playlist) {
            return trackIDs;
        }

        // Tracks in the playlist, in playlist order, come first. Then the rest follow in their current order.
        const inPlaylist = new Set(playlist.trackIDs);
        const trackIDsSet = new Set(trackIDs);
        const playlistFirst = playlist.trackIDs.filter(id => trackIDsSet.has(id));
        const rest = trackIDs.filter(id => !inPlaylist.has(id));
        return [...playlistFirst, ...rest];
    }

    // Field-based sort (title, artist, album, etc.)
    return [...trackIDs].sort((a, b) => {
        const valA = trackMap[a] ? (trackMap[a][criteria] || "") : "";
        const valB = trackMap[b] ? (trackMap[b][criteria] || "") : "";
        return valA.localeCompare(valB);
    });
}
