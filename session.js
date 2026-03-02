



//Session management layer for workspace. Handles loading playlists, in-memory state, and saving changes back to IDB.

// Data Flow: workspace session adds {playlistID, trackIDSet} fields to IDB playlist objects, facilitating rendering and membership checks. 
//            Strips these fields before saving back to IDB.

import DataManager from "./dataManager.js";

export class WorkspaceSession {

    //constructor initializes empty session state: playlists array, tracks lookup object, modifiedPlaylists Set. Not populated until load().
    constructor() {
        this.playlists = [];                     // array of augmented playlist objects (added playlistID string and trackIDSet for efficient lookup)
        this.tracks = {};                        // lookup: trackID → track object
        this.modifiedPlaylists = new Set();      // set of playlistID strings with unsaved changes
        this._dataManager = null;
    }

    // Load playlists and their tracks from IndexedDB.
    // playlistIds: array of IDB numeric 'id' keys to load. If null/empty, loads all playlists.
    async load(playlistIds) {
        console.log(`WorkspaceSession: load() called with playlistIds: ${playlistIds}`);

        // Initialize database connection
        this._dataManager = new DataManager();
        await this._dataManager.init();
        console.log("DataManager initialized in WorkspaceSession");

        // Fetch playlists
        let rawPlaylists;
        if (playlistIds && playlistIds.length > 0) {

            // fetch each playlist by ID. 
            //FUTURE - should probably add a bulk-get-by-IDs method to DataManager to minimize transactions
            const results = await Promise.all(
                playlistIds.map(id => this._dataManager.getRecord("playlists", id))
            );
            // Filter out nulls (playlist deleted or ID invalid.) FUTURE - log these or show a better warning in UI?
            rawPlaylists = results.filter(Boolean);
            if (rawPlaylists.length < playlistIds.length) {
                console.warn(
                    `WorkspaceSession: ${playlistIds.length - rawPlaylists.length} playlist(s) not found in IndexedDB`
                );
            }
        } else {
            // Load all playlists if no specific IDs provided
            rawPlaylists = await this._dataManager.getAllRecords("playlists");
            console.log(`Loaded all ${rawPlaylists.length} playlists from IDB to WorkspaceSession`);
        }
        //Warn if no playlists were loaded
        if (rawPlaylists.length === 0) {
            console.warn("WorkspaceSession: No playlists were loaded");
        }

        // Fetch all tracks into lookup object.
        //FUTURE: consider only fetching tracks referenced by loaded playlists in case user library is huge. 
        //        Fine for current scale and avoids N individual lookups
        const allTracks = await this._dataManager.getAllRecords("tracks");
        this.tracks = {};
        for (const track of allTracks) {
            this.tracks[track.trackID] = track;
        }
        console.log(`WorkspaceSession: ${allTracks.length} tracks loaded into lookup objct`);

        // Augment playlist objects with session-layer fields
        // playlistID: string of IDB 'id' field- used in workspace.js for dataset comparisons
        // trackIDSet: Set facilitating efficient membership checks, kept in sync with trackIDs array
        // trackIDs: cloned array so in-memory edits don't affect the raw IDB data until save
        this.playlists = rawPlaylists.map(pl => ({
            ...pl,
            playlistID: String(pl.id),           // string to match checkbox.dataset.playlistID comparisons
            trackIDs: [...(pl.trackIDs || [])],
            trackIDSet: new Set(pl.trackIDs || [])
        }));

        console.log(
            "WorkspaceSession: Session done loading.\nPlaylists:",
            this.playlists.map(p => `'${p.name}' (${p.trackIDs.length} tracks)`)
        );
    }

    // Toggle track membership in a playlist. (replaces logic in handleCheckboxToggle, which calls this)
    // playlistId: string which should match playlist.playlistID
    // trackId: string matching track.trackID
    toggleTrack(playlistId, trackId) {
        const playlist = this.playlists.find(p => p.playlistID === playlistId);
        if (!playlist) {
            console.warn(`WorkspaceSession: toggleTrack: no playlist found for ID '${playlistId}'`);
            return;
        }

        // Check current membership using trackIDSet, adding/removing from both the array and set to keep them in sync.
        if (playlist.trackIDSet.has(trackId)) {// currently a member: remove from structures
            playlist.trackIDs = playlist.trackIDs.filter(id => id !== trackId);
            playlist.trackIDSet.delete(trackId);
            console.log(`WorkspaceSession Removed '${trackId}' from '${playlist.name}'`);
        } else { // not currently a member: add to structures
            playlist.trackIDs.push(trackId);
            playlist.trackIDSet.add(trackId);
            console.log(`WorkspaceSession: Added '${trackId}' to '${playlist.name}'`);
        }

        this.modifiedPlaylists.add(playlistId);
    }

    // main save function persists all modified playlists to IndexedDB.
    // Strips session layer fields (trackIDSet, playlistID) before writing, then clears modifiedPlaylists on success.
    async save() {
        if (this.modifiedPlaylists.size === 0) {
            console.log("save() called but no changes pending");
            return;
        }

        console.log(
            `WorkspaceSession: Saving ${this.modifiedPlaylists.size} playlist(s):`,
            [...this.modifiedPlaylists]
        );

        // store promises for each playlist save so we can await them all together and clear modifiedPlaylists only if/when all succeed.
        const savePromises = [];

        for (const playlistID of this.modifiedPlaylists) {
            const playlist = this.playlists.find(p => p.playlistID === playlistID);
            if (!playlist) {
                console.warn(`No playlist found for ID '${playlistID}' while saving- skipping`);
                continue;
            }

            // Strip session layer fields from playlist object before saving back to IDB. 
            const { trackIDSet, playlistID: _sessionAlias, ...cleanPlaylist } = playlist;

            console.log(
                `WorkspaceSession: Writing '${playlist.name}' (id=${playlist.id}) — ${cleanPlaylist.trackIDs.length} tracks`
            );

            // replaceRecord(storeName, key, newData) → objectStore.put({...newData, id: key})
            // For playlists the IDB keyPath is 'id', so passing playlist.id as the key is correct.
            savePromises.push(
                this._dataManager.replaceRecord("playlists", playlist.id, cleanPlaylist)
            );
        }

        await Promise.all(savePromises);//Await all saves together so execution doesnt rely on each save completing before starting the next. 
        // Ensure modifiedPlaylists is only cleared once all saves succeed.
        this.modifiedPlaylists.clear();//TODO consolidate logic between here and workspace, so save display has a single source of truth?
        console.log("WorkspaceSession: Save complete");
    }
}

export default WorkspaceSession;
