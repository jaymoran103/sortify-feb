// JSON Bundle Import Adapter: re-imports bundles produced by jsonExporterAdapter
// Returns { totalProcessed, uniqueAdded, skipped } matching the csv adapter's stats shape.

// Bundle format expected: { exportedAt, playlists[], tracks{} }
// tracks is keyed by trackID. Playlists are stored with fresh IDB IDs (old IDs stripped).

import { createPlaylist } from "../models.js";

class JsonImportAdapter {

    // Main import method: takes a File object, reads and parses it as JSON, validates structure, and imports tracks and playlists into IDB via dataManager.
    async import(dataManager, file) {
        const text = await this._readFileAsText(file);

        let bundle;
        try {
            bundle = JSON.parse(text);
        } catch (err) {
            throw new Error(`Failed to parse JSON bundle '${file.name}': ${err.message}`);
        }

        if (!bundle.tracks || !bundle.playlists) {
            throw new Error(`'${file.name}' does not appear to be a valid Sortify bundle (missing tracks or playlists).`);
        }

        // Import tracks — skip duplicates, store new ones as-is (all fields already normalized)
        let uniqueAdded = 0;
        let skipped     = 0;
        const trackObjects = Object.values(bundle.tracks);

        for (const track of trackObjects) {
            if (!track.trackID) { skipped++; continue; }

            const existing = await dataManager.getRecord('tracks', track.trackID);
            if (existing) { skipped++; continue; }

            try {
                await dataManager.createRecord('tracks', track);
                uniqueAdded++;
            } catch (err) {
                console.error(`Error storing track '${track.trackID}':`, err);
                skipped++;
            }
        }

        // Import playlists — strip IDB id so autoIncrement generates a fresh key
        for (const pl of bundle.playlists) {
            const { id, ...rest } = pl; // discard stale IDB id
            const newPlaylist = createPlaylist(rest.name, rest.trackIDs);
            try {
                await dataManager.createRecord('playlists', newPlaylist);
            } catch (err) {
                console.error(`Error storing playlist '${pl.name}':`, err);
            }
        }

        return {
            totalProcessed: trackObjects.length,
            uniqueAdded,
            skipped,
        };
    }

    // Helper method to read a File object as text, returning a Promise.
    _readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = (event) => resolve(event.target.result);
            reader.onerror = (event) => reject(event.target.error);
            reader.readAsText(file);
        });
    }
}

export default new JsonImportAdapter();
