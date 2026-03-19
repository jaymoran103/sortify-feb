// CSV Export Adapter: serializes a single playlist's tracks to a CSV string.
// Returns { filename, content } — ioManager handles actual download.


// Named export profiles: each object maps internal field names to export header labels
const EXPORT_PROFILES = {

    // Round-trip format: headers match internal field names, core fields only
    native: {
        trackID: 'trackID',
        title:   'title',
        album:   'album',
        artist:  'artist',
    },

    // Human-readable headers, core fields only — suitable for sharing
    minimal: {
        trackID: 'Spotify URI',
        title:   'Title',
        album:   'Album',
        artist:  'Artist',
    },
};


class CsvExportAdapter {

    // main export method: takes a playlist, its tracks, and an optional profile name. 
    // Returns { filename, content }, ready for download by ioManager.
    export(playlist, tracks, profileName = 'native') {
        const fieldMap = EXPORT_PROFILES[profileName];
        if (!fieldMap) throw new Error(`No CSV export profile found: '${profileName}'`);

        const header = this._buildHeader(fieldMap);
        const rows   = tracks.map(track => this._serializeRow(track, fieldMap));

        const content  = [header, ...rows].join('\n');
        const filename = playlist.name + '.csv';

        return { filename, content };
    }

    //helper method builds CSV header row matching given fieldMap
    _buildHeader(fieldMap) {
        return Object.values(fieldMap).join(',');
    }

    // Serializes one track to a CSV row, preserving column order given by fieldMap.
    // Quotes any value containing commas, quotes, or newlines.
    _serializeRow(track, fieldMap) {
        const values = Object.keys(fieldMap).map(field => {

            // missing or nullish fields become empty strings
            let value = String(track[field] ?? '');

            // Quote values containing commas, quotes, or newlines.
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
        });
        return values.join(',');
    }
}

export default new CsvExportAdapter();
