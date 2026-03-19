// JSON Bundle Exporter: serializes a set of playlists and all their tracks to JSON
// Returns { filename, content } — ioManager handles actual download.

// Bundle format: { exportedAt, playlists[], tracks{} }
// tracks is keyed by trackID for O(1) lookup on re-import.

class jsonExportAdapter {

    // Main export method: takes an array of playlists and a dataManager for track lookup.
    async export(playlists, dataManager) {
        // Collect all unique trackIDs across all playlists
        const allIDs = new Set(playlists.flatMap(p => p.trackIDs));

        // Fetch all track records from IDB in parallel
        const trackArray = await Promise.all(
            [...allIDs].map(id => dataManager.getRecord('tracks', id))
        );

        // Build tracks map keyed by trackID; filter nulls for any IDs not found in IDB
        const tracks = trackArray
            .filter(t => t != null)
            .reduce((map, t) => { map[t.trackID] = t; return map; }, {});

        // Build bundle object with playlists, tracks, and identifying info
        const bundle = {
            exportedAt: new Date().toISOString(),
            playlists:  playlists,
            tracks:     tracks,
        };

        const filename = 'sortify-export-' + this._formatDateForFilename() + '.json';
        const content  = JSON.stringify(bundle, null, 2);

        return { filename, content };
    }

    _formatDateForFilename() {
        return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    }
}

export default new jsonExportAdapter();
