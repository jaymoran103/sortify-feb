// CSV Import Adapter: header-aware counterpart to importer.js. Will supercede it

// Supports any CSV whose headers can be mapped via FIELD_ALIASES.
// Unrecognized columns are skipped safely with a warning

import { createPlaylist, createTrack } from "../models.js";

// Maps External header name (lowercased) to internal field name.
const FIELD_ALIASES = {

    // Core fields
    'trackid':            'trackID',        //App
    'track uri':          'trackID',        //Sample
    'uri':                'trackID',        //Spotify

    'title':              'title',          //App
    'track name':         'title',          //Sample
    'name':               'title',          //Spotify

    'album':              'album',          //App, Spotify
    'album name':         'album',          //Sample

    'artist':             'artist',         //App
    'artist name(s)':     'artist',         //Sample
    'artists':            'artist',         //Spotify

    // Optional fields
    'release date':       'releaseDate',    //Sample

    'duration (ms)':      'duration',       //Sample
    'duration_ms':        'duration',       //Spotify

    'popularity':         'popularity',     //Sample, Spotify
    'explicit':           'explicit',       //Sample, Spotify
    //'added by':           'addedBy',        //Sample //NOTE: Currently skipping, not fundamental to track data
    'added at':           'addedAt',        //Sample
    'genres':             'genre',          //Sample
    'record label':       'recordLabel',    //Sample
    'danceability':       'danceability',   //Sample,Spotify
    'energy':             'energy',         //Sample,Spotify
    'key':                'key',            //Sample,Spotify
    'loudness':           'loudness',       //Sample,Spotify
    'mode':               'mode',           //Sample,Spotify
    'speechiness':        'speechiness',    //Sample,Spotify
    'acousticness':       'acousticness',   //Sample,Spotify
    'instrumentalness':   'instrumentalness',//Sample,Spotify
    'liveness':           'liveness',       //Sample,Spotify
    'valence':            'valence',        //Sample,Spotify
    'tempo':              'tempo',          //Sample,Spotify

    'time signature':     'timeSignature',  //Sample
    'time_signature':     'timeSignature',  //Spotify

    //Spotify Only
    // "available_markets":"available_markets",
    // "disc_number":"disc_number",
    // "external_ids":"external_ids",
    // "external_urls":"external_urls",
    // "href":"href",
    // "is_playable":"is_playable",
    // "linked_from":"linked_from",
    // "id":"id",//Should match URI minus "spotify:track:". Unsure of best approach. Since context is assumed for a spotifyAdapter this could save us some stripping.
    // "restrictions":"restrictions",
    // "preview_url":"preview_url",
    // "track_number":"track_number",
    // "type":"type",
    // "is_local":"is_local",
    // "analysis_url":"analysis_url",
};

// Used to route recognized fields to core vs. optional extraction
const CORE_FIELDS = new Set(['trackID', 'title', 'album', 'artist']);
const unrecognizedFields = new Set(); //Set for logging unrecognized fields once per import session

class CsvImportAdapter {

    // Main entry point for CSV import. Reads file, parses lines, extracts fields, stores tracks and playlist, and reports progress and results.
    async import(dataManager, file, onProgress) {
        const playlistName = file.name.replace('.csv', '');

        // Read file and split into non-empty lines
        const csvData = await this._readFileAsText(file);
        const lines = csvData.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) {
            console.warn("CSV file is empty or only contains headers");
            return { totalProcessed: 0, uniqueAdded: 0, skipped: 0 };
        }

        // Build column index from header row
        const headerRow = parseCSVLine(lines[0]);
        const fieldIndex = this._buildFieldIndex(headerRow);

        // Process each data row, tracking progress and results.
        const trackIDs = [];
        let uniqueAdded = 0;
        let skipped = 0;

        for (let i = 1; i < lines.length; i++) {

            // Report progress if callback provided
            if (onProgress) {
                onProgress(i, lines.length - 1);
            }

            // Parse line into columns, extract core and optional fields, and attempt to store track
            const columns = parseCSVLine(lines[i]);
            const { core, optional } = this._extractRow(columns, fieldIndex);

            const result = await this._storeIfNeeded(dataManager, core, optional);
            if (result === 'added') {
                trackIDs.push(core.trackID);
                uniqueAdded++;
            } else if (result === 'duplicate') {
                trackIDs.push(core.trackID); // still include in playlist
            } else {// Catch all, but should just be 'invalid'
            // } else if (result === 'invalid') {
                skipped++; // invalid
            }
        }

        // Once all tracks are processed, create playlist with collected track IDs
        await this._storePlaylist(dataManager, playlistName, trackIDs);

        return { totalProcessed: lines.length - 1, uniqueAdded, skipped };
    }

    // Helper function to read a File object as text, returning a Promise that resolves with the file contents.
    _readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = (event) => resolve(event.target.result);
            reader.onerror = (event) => reject(event.target.error);
            reader.readAsText(file);
        });
    }

    // Maps each recognized header to its column index.
    // Unrecognized headers are logged with a warning and stored in unrecognizedFields, then ignored.
    _buildFieldIndex(headerRow) {
        const fieldIndex = {};
        for (let i = 0; i < headerRow.length; i++) {
            const raw = headerRow[i].toLowerCase();
            const internalName = FIELD_ALIASES[raw];
            if (internalName) {
                // First occurrence wins if multiple headers map to the same field
                if (!(internalName in fieldIndex)) {
                    fieldIndex[internalName] = i;
                }
            } else {
                console.warn(`CSV import: unrecognized column '${headerRow[i]}' — skipping`);// Log per encounter/playlist, unrecognizedFields is more session oriented for a final report. 
                if (!unrecognizedFields.has(raw)) {
                    // console.warn(`CSV import: first occurrence of unrecognized column '${headerRow[i]}'`);
                    unrecognizedFields.add(raw);
                }
            }
        }
        return fieldIndex;
    }

    // Extracts core and optional fields from a parsed row using fieldIndex.
    _extractRow(columns, fieldIndex) {
        const core     = {};
        const optional = {};

        for (const [fieldName, colIndex] of Object.entries(fieldIndex)) {
            const raw = columns[colIndex];
            if (raw === undefined) continue;

            if (CORE_FIELDS.has(fieldName)) {
                // artist: normalize semicolon-separated multi-artist format
                if (fieldName === 'artist') {
                    core[fieldName] = raw.replace(/;/g, ', ');
                } else {
                    core[fieldName] = raw;
                }
            } else {
                const str = raw.trim();
                if (str) optional[fieldName] = str;
            }
        }

        return { core, optional };
    }

    // Based on trackID format, determine source (currently just checking if it starts with 'spotify:' and defaulting to 'csv').
    // FUTURE: does this logic belong here in the long run? obviously not directly from the API, probably building this out if other providers are supported.
    _determineSource(trackID) {
        return trackID.startsWith('spotify:') ? 'spotify' : 'csv';
    }

    // Rejects rows with missing/empty/invalid core fields or unsupported local URIs
    _isValidCoreHeader(core) {
        if (!core.trackID || !core.title || !core.album || !core.artist) return false; // TODO consider generating an ID if just trackID is missing, implies a local file that may still be worth importing/tracking
        for (const val of Object.values(core)) {
            if (!val || val === 'undefined') return false;
        }
        if (core.trackID.includes(':local:')) {
            console.warn(`Track ID '${core.trackID}' is a local file — not yet supported. Skipping.`);
            return false;
        }
        return true;
    }

    // Stores track if not already in IDB. Returns 'added', 'duplicate', or 'invalid'.
    async _storeIfNeeded(dataManager, core, optional) {
        if (!this._isValidCoreHeader(core)) return 'invalid';

        const existing = await dataManager.getRecord('tracks', core.trackID);
        if (existing) {
            return 'duplicate'; // Track already exists — skip adding but still include in playlist
        }

        const source   = this._determineSource(core.trackID);
        const newTrack = createTrack(core.trackID, core.title, core.album, core.artist, source, optional);

        try {
            await dataManager.createRecord('tracks', newTrack);
            return 'added'; // Successfully added new track
        } catch (error) {
            console.error(`Error storing track '${core.trackID}':`, error);
            return 'invalid'; // Storage error - treat as invalid to skip and report
        }
    }

    // Creates a playlist with the given name and track IDs, storing it in IDB.
    async _storePlaylist(dataManager, name, trackIDs) {
        const newPlaylist = createPlaylist(name, trackIDs);
        try {
            await dataManager.createRecord('playlists', newPlaylist);
        } catch (error) {
            console.error(`Error storing playlist '${name}':`, error);
        }
    }

    
    // DEBUG functions for reporting on unrecognized fields across all imports in a session. 
    _getUnrecognizedFields() {
        return Array.from(unrecognizedFields);
    }

    _reportUnrecognizedFields() {
        if (unrecognizedFields.size > 0) {
            console.warn(`CSV import completed with unrecognized columns: ${this._getUnrecognizedFields().join(', ')}`);
        }
    }
}

// Helper function parses a csv line, handling quoted fields and commas within quotes
//TODO consider case where a line contains uneven quotes?
function parseCSVLine(line) {
    const fields = [];
    let current  = '';
    let inQuotes = false;

    // Iterate through each character in the line, building fields based on commas and quotes
    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {           // Toggle inQuotes flag when encountering a quote character
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) { // Comma outside of quotes indicates end of field
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim()); // push remaining data as last field

    return fields;
}

export default new CsvImportAdapter();
