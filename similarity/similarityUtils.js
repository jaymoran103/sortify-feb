
// Scan each playlist in targetCollections against a reference set of trackIDs.
// referenceCollection: Set<string> or string[]
// targetCollections: array of { id, name, trackIDs: string[] }
// Returns: { [playlistId]: { id, name, totalMatch, percentRef, percentTarget } }
export function scanWithReference(referenceCollection, targetCollections) {
    // Normalise to Set for O(1) lookups regardless of input type
    const referenceSet = referenceCollection instanceof Set
        ? referenceCollection
        : new Set(referenceCollection);

    const results = {};

    for (const playlist of targetCollections) {
        const stats = scanPlaylist(referenceSet, playlist.trackIDs);
        // Attach identity fields so callers don't need to re-join on id
        stats.id         = playlist.id;
        stats.name       = playlist.name;
        stats.trackCount = playlist.trackIDs?.length ?? playlist.trackCount ?? 0; 
        results[playlist.id] = stats;
    }

    return results;
}

// Count tracks in targetSet that appear in referenceSet and return overlap stats.
function scanPlaylist(referenceSet, targetSet) {
    let matchCount = 0;
    for (const trackID of targetSet) {
        if (referenceSet.has(trackID)) matchCount++;
    }

    return {
        totalMatch:    matchCount,
        percentRef:    (matchCount / referenceSet.size) * 100,
        percentTarget: (matchCount / targetSet.length) * 100,
    };
}


