// session.js — Data layer for the workspace. Manages in-memory playlist/track state and IDB persistence.
// workspace.js  — Consumes this session; holds live references to session.playlists, tracks, and modifiedPlaylists.
//
// Callers should only read data directly from session properties, ensuring data is current.
// Callers should only mutate data using session methods, ensuring track data, trackIDs and modifiedPlaylists are properly maintained.

// Data Flow: workspace session adds {playlistID, trackIDSet} fields to IDB playlist objects, facilitating rendering and membership checks. 
//            Session data is read from properties and mutated via sanctioned methods.
//            Fields added to playlist objects are stripped before saving back to IDB.

import DataManager from "../shared/dataManager.js";

export class WorkspaceSession {

    //constructor initializes empty session state: playlists array, tracks lookup object, modifiedPlaylists Set. Not populated until load().
    constructor() {
        this.playlists = [];                     // array of augmented playlist objects (added playlistID string and trackIDSet for efficient lookup)
        this.tracks = {};                        // lookup: trackID → track object
        this.modifiedPlaylists = new Set();      // set of playlistID strings with unsaved changes
        this.pendingPlaylists = [];              // new playlists not yet written to IDB (have temp string IDs)
        this.pendingCounter = 0;                 // counter for generating temp IDs
        this.dataManager = null;
    }

    /** ==================
     *  DATA LOADING
     *  ==================
     */

    // Load playlists and their tracks from IndexedDB.
    // playlistIds: array of IDB numeric 'id' keys to load. If null/empty, loads all playlists.
    async load(playlistIds) {
        console.log(`WorkspaceSession: load() called with playlistIds: ${playlistIds}`);

        // Initialize database connection
        this.dataManager = new DataManager();
        await this.dataManager.init();
        console.log("DataManager initialized in WorkspaceSession");

        // Fetch playlists
        let rawPlaylists;
        if (playlistIds && playlistIds.length > 0) {

            // fetch each playlist by ID. 
            const results = await Promise.all(
                playlistIds.map(id => this.dataManager.getRecord("playlists", id))
            );
            // Filter out nulls (playlist deleted or ID invalid.)
            rawPlaylists = results.filter(Boolean);
            if (rawPlaylists.length < playlistIds.length) {
                console.warn(
                    `WorkspaceSession: ${playlistIds.length - rawPlaylists.length} playlist(s) not found in IndexedDB`
                );
            }
        } else {
            // Load all playlists if no specific IDs provided
            rawPlaylists = await this.dataManager.getAllRecords("playlists");
            console.log(`Loaded all ${rawPlaylists.length} playlists from IDB to WorkspaceSession`);
        }
        //Warn if no playlists were loaded
        if (rawPlaylists.length === 0) {
            console.warn("WorkspaceSession: No playlists were loaded");
        }

        // Collect trackIDs referenced by loaded playlists, then fetch only those tracks.
        const neededTrackIDs = new Set(rawPlaylists.flatMap(pl => pl.trackIDs || []));
        const trackResults = await Promise.all(
            [...neededTrackIDs].map(tid => this.dataManager.getRecord("tracks", tid))
        );
        this.tracks = {};
        for (const track of trackResults) {
            if (track) this.tracks[track.trackID] = track;
        }
        console.log(`WorkspaceSession: ${Object.keys(this.tracks).length} tracks loaded into lookup object (${neededTrackIDs.size} referenced)`);

        // Augment playlist objects with session-layer fields (via shared helper)
        this.playlists = rawPlaylists.map(pl => this.augmentPlaylist(pl));

        console.log(
            "WorkspaceSession: Session done loading.\nPlaylists:",
            this.playlists.map(p => `'${p.name}' (${p.trackIDs.length} tracks)`)
        );
    }

    // Create augmented playlist object with session-layer fields: playlistID (as string), trackIDs (array), trackIDSet (Set). 
    // Input playlist is not mutated.
    augmentPlaylist(pl) {
        return {
            ...pl,
            playlistID: String(pl.id),
            trackIDs: [...(pl.trackIDs || [])],
            trackIDSet: new Set(pl.trackIDs || [])
        };
    }

    /** ==================
     *  PLAYLIST OPERATIONS
     *  ==================
     */

    // Fetch an existing IDB playlist by id and add it to the session.
    // No-ops if already in session. Returns the augmented playlist or null.
    async addPlaylist(id) {
        const raw = await this.dataManager.getRecord("playlists", id);
        if (!raw) {
            // alert(`addPlaylist: no playlist found for IDB id ${id}`);
            console.warn(`addPlaylist: no playlist found for IDB id ${id}`);
            return null;
        }
        if (this.playlists.some(p => p.id === raw.id)) {
            // alert(`addPlaylist: playlist id ${id} is already in this session`);
            console.warn(`addPlaylist: playlist id ${id} is already in this session`);
            return null;
        }
        const augmented = this.augmentPlaylist(raw);
        this.playlists.push(augmented);

        // Fetch tracks introduced by this playlist that aren't already in the session.
        const novelTrackIDs = (raw.trackIDs || []).filter(tid => !this.tracks[tid]);
        if (novelTrackIDs.length > 0) {
            const novelTracks = await Promise.all(
                novelTrackIDs.map(tid => this.dataManager.getRecord("tracks", tid))
            );
            for (const track of novelTracks) {
                if (track) this.tracks[track.trackID] = track;
            }
            console.log(`addPlaylist: appended ${novelTracks.filter(Boolean).length} novel tracks from '${raw.name}'`);
        }

        return augmented;
    }

    // Remove a playlist from the session. Does not delete from IDB.
    // Cleans up modifiedPlaylists and pendingPlaylists entries.
    removePlaylist(playlistID) {
        const idx = this.playlists.findIndex(p => p.playlistID === playlistID);
        if (idx === -1) {
            console.warn(`removePlaylist: no playlist found for ID '${playlistID}'`);
            return;
        }
        this.playlists.splice(idx, 1); // remove from session
        this.modifiedPlaylists.delete(playlistID); // if it was modified, remove from modified set
        //check if playlist was pending. If so, remove from pending list
        const pendingIdx = this.pendingPlaylists.findIndex(p => p.playlistID === playlistID);
        if (pendingIdx !== -1) this.pendingPlaylists.splice(pendingIdx, 1);
    }

    // Rename a playlist in-memory. Updates in IDB on next save()
    renamePlaylist(playlistID, newName) {
        const playlist = this.playlists.find(p => p.playlistID === playlistID);
        if (!playlist) {
            console.warn(`renamePlaylist: no playlist found for ID '${playlistID}'`);
            return;
        }
        // Update name, mark as modified for saving.
        playlist.name = newName;
        this.modifiedPlaylists.add(playlistID);
    }

    // Duplicate a playlist in-memory using a temp ID. Updates in IDB on next save()
    duplicatePlaylist(playlistID) {
        const source = this.playlists.find(p => p.playlistID === playlistID);
        if (!source) {
            console.warn(`duplicatePlaylist: no playlist found for ID '${playlistID}'`);
            return null;
        }
        const tempID = `pending-${++this.pendingCounter}`;
        const newPl = {
            type: "playlist",
            id: tempID,           // temp — patched to real IDB id on save
            name: source.name + " (copy)",
            trackIDs: [...source.trackIDs],
            playlistID: tempID,
            trackIDSet: new Set(source.trackIDs)
        };
        this.playlists.push(newPl);
        this.pendingPlaylists.push(newPl);
        return newPl;
    }

    // Create a new empty playlist in-memory using a temp ID. Updates in IDB on next save()
    createEmptyPlaylist(name) {
        const tempID = `pending-${++this.pendingCounter}`;
        const newPl = {
            type: "playlist",
            id: tempID,
            name,
            trackIDs: [],
            playlistID: tempID,
            trackIDSet: new Set()
        };
        this.playlists.push(newPl);
        this.pendingPlaylists.push(newPl);
        return newPl;
    }

    /** ==================
     *  TRACK OPERATIONS
     *  ==================
     */

    // Remove a track from the workspace session entirely: removes from all playlists, then removes object from tracks store in memory
    removeTrackFromWorkspace(trackID) {
        // Remove track from all playlists in the session
        for (const playlist of this.playlists) {
            if (playlist.trackIDSet.has(trackID)) {
                playlist.trackIDs = playlist.trackIDs.filter(id => id !== trackID);
                playlist.trackIDSet.delete(trackID);
                this.modifiedPlaylists.add(playlist.playlistID);
            }
        }
        
        // Remove track from in-memory tracks lookup
        if (this.tracks[trackID]) {
            delete this.tracks[trackID];
            console.log(`WorkspaceSession: Track '${trackID}' removed from tracks lookup`);
        } else {
            console.warn(`WorkspaceSession: removeTrackFromWorkspace: no track found for ID '${trackID}'`);
        }
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

    /** ==================
     *  PERSISTENCE
     *  ==================
     */

    // Persist all pending (new) and modified playlists to IndexedDB.
    // Pending playlists are written first and their live objects patched with real IDB IDs
    // before modified playlists are processed.
    async save() {
        const hasPending  = this.pendingPlaylists.length > 0;
        const hasModified = this.modifiedPlaylists.size > 0;
        if (!hasPending && !hasModified) {
            console.log("save() called but no changes pending");
            return;
        }

        // Before proceeding, ensure all pending playlists have real IDB IDs.
        await this.resolvePendingPlaylists();

        // Write modified pre-existing playlists in parallel, ensuring completion before clearing modifiedPlaylists set.
        const savePromises = [];
        for (const playlistID of this.modifiedPlaylists) {
            const playlist = this.playlists.find(p => p.playlistID === playlistID);
            if (!playlist) {
                console.warn(`No playlist found for ID '${playlistID}' while saving — skipping`);
                continue;
            }
            // Strip session layer fields before writing to IDB
            const { trackIDSet, playlistID: _sessionAlias, ...cleanPlaylist } = playlist;
            console.log(
                `WorkspaceSession: Writing '${playlist.name}' (id=${playlist.id}) — ${cleanPlaylist.trackIDs.length} tracks`
            );
            savePromises.push(
                this.dataManager.replaceRecord("playlists", playlist.id, cleanPlaylist)
            );
        }

        // Await all writes before clearing.
        await Promise.all(savePromises);
        this.modifiedPlaylists.clear();
        console.log("WorkspaceSession: Save complete");
    }

    // Write pending playlists, patch objects with real IDB IDs, and clear pending list.
    // Called by save() before writing modified playlists, ensuring new playlists have a valid IDB ID.
    async resolvePendingPlaylists() {

        // Patch live in-memory objects with real IDB IDs so workspace.js refs stay valid without a reload.
        for (const pl of this.pendingPlaylists) {

            //Get temp ID and set up raw playlist object. (reduce to standard data model fields)
            const oldTempID = pl.playlistID;
            const rawPl = { type: "playlist", name: pl.name, trackIDs: [...pl.trackIDs] };//Need to enforce playlist type here?

            // Get real ID from IDB upon writing, patch into live object. Awaiting ensures sequential ID assignment, avoiding potential race condition.
            const realId = await this.dataManager.createRecord("playlists", rawPl);
            pl.id = realId;
            pl.playlistID = String(realId);

            // Remove old reference to temp ID from modifiedPlaylists.
            this.modifiedPlaylists.delete(oldTempID);
            console.log(`WorkspaceSession: Created '${pl.name}' (id=${realId})`);
        }
        this.pendingPlaylists = [];
    }
}

export default WorkspaceSession;
