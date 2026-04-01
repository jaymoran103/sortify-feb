import DataManager from "./shared/dataManager.js";
import ioManager from "./shared/ioManager.js";
import StatusIndicator from "./shared/statusIndicator.js";
import csvImportAdapter from "./shared/adapters/csvImportAdapter.js";
import csvExportAdapter from "./shared/adapters/csvExportAdapter.js";
import jsonImportAdapter from "./shared/adapters/jsonImportAdapter.js";
import jsonExportAdapter from "./shared/adapters/jsonExportAdapter.js";


import spotifyAuthManager from "./shared/spotifyAuthManager.js";
import spotifyImportAdapter from "./shared/adapters/spotifyImportAdapter.js";
import spotifyExportAdapter from "./shared/adapters/spotifyExportAdapter.js";

import { menuModal, notifyModal, warningModal, playlistSelectModal, spotifyPlaylistSelectModal, overlapResultsModal } from "./shared/modal.js";
import { matchesTrackSearch, matchesPlaylistSearch, sortTrackIDs } from "./shared/trackUtils.js";
import { dropdownMenu } from "./shared/dropdown.js";

import {scanWithReference} from "./similarity/similarityUtils.js";


class DashboardApp {

    constructor() {
        this.dataManager = new DataManager();
        this.libraryView = "playlists"; // "playlists" | "tracks"
        this.librarySearchQuery = "";
        this.librarySortCriteria = "name";

        this.dataManager.init().then(async () => {
            console.log("Database initialized");
            this.addEventListeners();
            this.renderLibrary();
            this.setupIO();

            // Check if load was prompted by a Spotify OAuth redirect. If so, handle the callback and complete the pending action.
            await this.handleAuthCallbackIfNeeded();
        }).catch((err) => {
            console.error("Failed to initialize database:", err);
        });
    }

    // If returning from OAuth redirect: handle Spotify auth callback, then run the pending action that triggered the auth flow (import or export).
    async handleAuthCallbackIfNeeded() {
        const hasCode = new URLSearchParams(window.location.search).has('code');
        if (hasCode) {
            try {
                console.log("Processing Spotify auth callback...");
                await spotifyAuthManager.handleAuthCallback();
                console.log('Spotify auth successful, access token stored.');
            } catch (err) {
                console.error('Spotify auth callback failed:', err);
                await notifyModal({ title: 'Spotify Auth Failed', message: err.message });
                sessionStorage.removeItem('spotify_pending_action');// Cleanup pending action in case of auth failure, avoiding unexpected behavior on page reload
            }

            // After handling the callback, check if there was a pending action (import or export) that triggered the auth flow, running it if so.
            const pendingAction = sessionStorage.getItem('spotify_pending_action');
            if (pendingAction === 'import') {
                await this.runSpotifyImport();
            } else if (pendingAction === 'export') {
                await this.runSpotifyExport();
            }
        }
    }

    addEventListeners() {

        // I/O CARD
        document.getElementById("import-btn").addEventListener("click", this.handleImport.bind(this));
        document.getElementById("export-btn").addEventListener("click", this.handleExport.bind(this));


        // LIBRARY CARD
        this.setupLibraryControls();

        document.getElementById("library-view-select").addEventListener("change", (e) => {
            this.libraryView = e.target.value;
            // reset to the default sort for the chosen view and keep search query ongoing so users can step between views.
            this.librarySortCriteria = this.libraryView === "tracks" ? "title" : "name";
            this.renderLibrary();
        });

        const searchInput = document.getElementById("library-search-input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.librarySearchQuery = e.target.value.trim();
                this.renderLibrary();
            });
        }

        const sortSelect = document.getElementById("library-sort-select");
        if (sortSelect) {
            sortSelect.addEventListener("change", (e) => {
                this.librarySortCriteria = e.target.value;
                this.renderLibrary();
            });
        }

        // WORKSPACE CARD
        document.getElementById("open-workspace-btn").addEventListener("click", this.handleOpenWorkspace.bind(this));

        // SIMILARITY CARD
        document.getElementById("simlarity-refscan-btn").addEventListener("click", this.handleReferenceScan.bind(this));
        // document.getElementById("similarity-module-btn").addEventListener("click", this.handleOpenSimilarityModule.bind(this));
    }

    // ====== I/O CARD ==========================================

    // Show menu to choose import source, then trigger appropriate flow;
    async handleImport() {
        const choice = await menuModal({
            title: "Import Playlists",
            choices: [
                { label: "From Local Files", value: "local", primary: true },
                { label: "From Spotify",     value: "spotify" }
            ]
        });

        if (choice === "local") {
            await this.runLocalImport();
        } else if (choice === "spotify") {
            // Set pending action before auth flow in case a redirect is needed
            await this.runSpotifyImport();
        }

        // null = cancelled, do nothing
    }

    // Show menu to choose export destination, then trigger appropriate flow;
    async handleExport() {
        const dest = await menuModal({
            title: "Export Playlists",
            choices: [
                { label: "To Local Files", value: "local", primary: true },
                { label: "To Spotify",     value: "spotify" }
            ]
        });

        // Local download: show format options, then export as CSV using chosen profile, then trigger download via ioManager
        //FUTURE: Consider selecting playlists first, and estimating file sizes alongside options. Good to inform of tradeoff between minimal and native
        if (dest === "local") {
            const format = await menuModal({
                title: "Export Format",
                choices: [
                    { label: "CSV  (All Data)",        value: "native",   primary: true },
                    { label: "CSV  (Minimal Data)",    value: "minimal"   },
                    { label: "JSON (All in one file)",     value: "json"      },
                ]
            });
            if (!format) return;
            if (format === "json") {
                await this.runJsonExport();
            } else {
                await this.runCsvExport(format);
            }
        }
        // Spotify export: select playlists, push to Spotify, show result URLs.
        else if (dest === "spotify") {
            await this.runSpotifyExport();
        }
    }

    // Trigger file picker, then run import; refresh library on success.
    async runLocalImport() {
        const files = await this.doFileSelection();
        if (!files || files.length === 0) return;

        await this.importFiles(files);
        // Re-render library to reflect newly imported playlists
        this.renderLibrary();
    }

    // Prompt user to select CSV files; resolves with selection once dialog closes.
    doFileSelection() {
        return new Promise((resolve) => {
            const input = document.getElementById("importFileInput");
            input.addEventListener("change", () => resolve(Array.from(input.files)), { once: true });
            input.addEventListener("cancel",  () => resolve([]),                        { once: true });
            input.click();
        });
    }

    // Loop through files, import each via ioManager, report per-file progress via status indicator.
    async importFiles(files) {
        this.status.show('Importing...');
        let successCount = 0;
        let failCount    = 0;

        for (let i = 0; i < files.length; i++) {

            // determine file type from extension; skip if not .csv or .json
            const file = files[i];
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext !== 'csv' && ext !== 'json') {
                console.warn(`Skipping unsupported file type: ${file.name}`);
                continue;
            }


            // Per-file progress update
            this.status.update(i + 1, files.length, `Importing ${file.name}...`);
            try {
                const stats = await ioManager.import(ext, this.dataManager, file);//FUTURE: review use of ext as adapter reference. Fine while the keys are file types and theres just one of each, but feels like something could go awry.
                console.log(`Imported '${file.name}': ${stats.uniqueAdded} new tracks, ${stats.skipped} skipped`);
                successCount++;
            } catch (err) {
                console.error(`Failed to import '${file.name}':`, err);
                failCount++;
            }
        }

        if (failCount > 0) {
            this.status.error(`${failCount} file(s) failed. See console for details.`);
        } else {
            this.status.complete(`Imported ${successCount} playlist(s) successfully.`);
        }
    }

    // Register import and export adapters with ioManager, instantiate status indicator for I/O feedback
    // FUTURE review key use 
    setupIO() {
        ioManager.registerImporter('csv',          csvImportAdapter);
        ioManager.registerImporter('json',         jsonImportAdapter);
        ioManager.registerImporter('spotifyImport', spotifyImportAdapter);

        ioManager.registerExporter('csv',          csvExportAdapter);
        ioManager.registerExporter('jsonBundle',   jsonExportAdapter);//leaving as bundle for now
        ioManager.registerExporter('spotifyExport', spotifyExportAdapter);

        this.status = new StatusIndicator(document.getElementById('io-footer'));
    }
    // Fetch user's Spotify playlists, show selection modal, import tracks for chosen playlists.
    async runSpotifyImport() {
        let shouldClearPending = false;
        sessionStorage.setItem('spotify_pending_action', 'import');

        try {

            // Ensure session has a valid token, redirecting if not.
            const token = await spotifyAuthManager.getAccessToken();
            if (!token) return;

            // If reached, ensure the pending action will be cleared once this try block finishes.
            shouldClearPending = true;
            
            // Fetch playlists, showing progress in the status indicator. Then show playlist selection modal.
            this.status.show('Loading your Spotify playlists...');
            const playlists = await spotifyImportAdapter.fetchUserPlaylists(
                token,
                (collected, total) => this.status.update(collected, total, 'Loading your Spotify playlists...'),
                (seconds)          => this.status.show(`Hit Spotify rate limit — retrying in ${seconds}s...`)
            );
            this.status.hide();

            if (!playlists || playlists.length === 0) {
                await notifyModal({ title: 'No Playlists Found', message: 'No playlists found in your Spotify account.' });
                return;
            }
            // Show Spotify playlist selector — returns array of spotifyPlaylistId strings
            const selectedIds = await spotifyPlaylistSelectModal({
                title:        'Select Playlists to Import',
                confirmLabel: 'Import',
                playlists,
            });
            if (!selectedIds || selectedIds.length === 0) return;

            // Map selected IDs back to full objects so importSelected has names for playlist records
            const selectedPlaylists = playlists.filter(pl => selectedIds.includes(pl.spotifyPlaylistId));

            this.status.show('Importing from Spotify...');
            const stats = await spotifyImportAdapter.importSelected(
                this.dataManager, token, selectedPlaylists,
                (done, total, name) => this.status.update(done, total, `Importing ${name}...`)
            );

            this.status.complete(`Done. ${stats.uniqueAdded} new track(s) added.`);
            this.renderLibrary();

        } catch (err) {
            this.status.hide();
            console.error('Spotify import failed:', err);
            await notifyModal({ title: 'Spotify Import Failed', message: err.message });
        } finally {
            if (shouldClearPending) sessionStorage.removeItem('spotify_pending_action');
        }
    }

    // Present playlist selector, push each selected playlist to Spotify as a new private playlist.
    async runSpotifyExport() {
        let shouldClearPending = false;
        sessionStorage.setItem('spotify_pending_action', 'export');

        try {
            const token = await spotifyAuthManager.getAccessToken();
            if (!token) return;

            shouldClearPending = true;

            const allPlaylists = await this.dataManager.getAllRecords('playlists');
            if (!allPlaylists || allPlaylists.length === 0) {
                await notifyModal({ title: 'No Playlists', message: 'No playlists to export.' });
                return;
            }

            const selectedIds = await playlistSelectModal({
                title:        'Export to Spotify',
                confirmLabel: 'Export',
                playlists:    allPlaylists,
            });
            if (!selectedIds || selectedIds.length === 0) return;

            const selected = allPlaylists.filter(pl => selectedIds.includes(pl.id));


            //Attempt to export set of playlists, 
            this.status.show('Exporting to Spotify...');
            const results = await spotifyExportAdapter.exportPlaylists(
                selected, this.dataManager,
                (done, total, name) => this.status.update(done, total, `Exporting: ${name}...`)
            );

            this.status.complete('Export complete.');

            // Show a line per playlist: URL if created, skipped message if no Spotify URIs
            const lines = results.map(r =>
                r.url ? `${r.name}: ${r.url}` : `${r.name}: skipped (no Spotify URIs)`
            );
            await notifyModal({ title: 'Exported to Spotify', message: lines.join('\n') });

        } catch (err) {
            this.status.hide();
            console.error('Spotify export failed:', err);
            await notifyModal({ title: 'Spotify Export Failed', message: err.message });
        } finally {

            // Clear pending action flag so it doesn't trigger unexpectedly on a future page load after the auth flow completes and the user returns to the app. This is important to avoid confusion if the user reloads or revisits the page later — without this, the app would check for a pending action on every load, see the leftover 'export' or 'import' value from this session, and immediately try to run that flow again (potentially triggering an unwanted Spotify auth flow or other side effects) even though the user isn't actively trying to do that anymore. By clearing it here, we ensure that the pending action only exists in sessionStorage during the actual auth flow when it's needed, and won't cause unexpected behavior on future visits or reloads.
            if (shouldClearPending) {
                sessionStorage.removeItem('spotify_pending_action');
            }
        }
    }

    // Present playlist selector, export each selected playlist as CSV, trigger download per file.
    async runCsvExport(profileName) {
        const allPlaylists = await this.dataManager.getAllRecords('playlists');
        if (!allPlaylists || allPlaylists.length === 0) {
            await notifyModal({ title: 'No Playlists', message: 'No playlists to export.' });
            return;
        }

        const selectedIds = await playlistSelectModal({
            title:        'Select Playlists to Export',
            confirmLabel: 'Export',
            playlists:    allPlaylists
        });
        if (!selectedIds || selectedIds.length === 0) return;

        // playlistSelectModal returns IDB IDs — map back to full objects
        const selected = allPlaylists.filter(pl => selectedIds.includes(pl.id));

        this.status.show('Exporting...');
        for (let i = 0; i < selected.length; i++) {
            const playlist = selected[i];
            this.status.update(i + 1, selected.length, `Exporting ${playlist.name}...`);
            const tracks = await Promise.all(
                playlist.trackIDs.map(id => this.dataManager.getRecord('tracks', id))
            );
            const { filename, content } = await ioManager.export('csv', playlist, tracks, profileName);
            ioManager.triggerDownload(filename, content, 'text/csv');
        }
        this.status.complete(`Exported ${selected.length} playlist(s).`);
    }

    // Present playlist selector, bundle all selected playlists into one JSON file, trigger download.
    async runJsonExport() {
        const allPlaylists = await this.dataManager.getAllRecords('playlists');
        if (!allPlaylists || allPlaylists.length === 0) {
            await notifyModal({ title: 'No Playlists', message: 'No playlists to export.' });
            return;
        }

        const selectedIds = await playlistSelectModal({
            title:        'Select Playlists to Export',
            confirmLabel: 'Export Bundle',
            playlists:    allPlaylists
        });
        if (!selectedIds || selectedIds.length === 0) return;

        const selected = allPlaylists.filter(pl => selectedIds.includes(pl.id));

        this.status.show('Building export bundle...');
        const { filename, content } = await ioManager.export('jsonBundle', selected, this.dataManager);
        ioManager.triggerDownload(filename, content, 'application/json');
        this.status.complete('Bundle exported.');
    }

    // ====== LIBRARY CARD ==========================================

    // Load data from IDB and render the active library view into #library-list.
    // View is determined by this.libraryView: "playlists" | "tracks".
    async renderLibrary() {
        const container = document.getElementById("library-list");
        const statsContainer = document.getElementById("library-stats");

        if (statsContainer) {
            statsContainer.hidden = true;
            statsContainer.innerHTML = "";
        }
        container.innerHTML = "";

        // Load both stores — needed for stats regardless of view, and tracks view needs track records.
        let playlists, tracks;
        try {
            playlists = await this.dataManager.getAllRecords("playlists");
            tracks    = await this.dataManager.getAllRecords("tracks");
        } catch (err) {
            console.error("Failed to load library:", err);
            return;
        }

        // Render stats bar (common to both views) // FUTURE extract html
        if (statsContainer && playlists.length > 0) {
            const totalTracks  = playlists.reduce((sum, pl) => sum + (pl.trackIDs?.length ?? 0), 0);
            const uniqueTracks = tracks.length;
            statsContainer.hidden = false;
            statsContainer.innerHTML = `
                <div class="library-stats-item">
                    <span class="library-stats-value">${playlists.length}</span>
                    <span class="library-stats-label">playlists</span>
                </div>
                                
                <div class="library-stats-sep"> | </div>

                <div class="library-stats-item">
                    <span class="library-stats-value">${totalTracks}</span>
                    <span class="library-stats-label">tracks</span>
                </div>
                                
                <div class="library-stats-sep"> | </div>

                <div class="library-stats-item">
                    <span class="library-stats-value">${uniqueTracks}</span>
                    <span class="library-stats-label">unique</span>
                </div>
            `;
        }

        // Update controls (sort options / placeholder) each render so the options reflect selected view.
        this.renderLibraryControls();

        if (this.libraryView === "tracks") {
            const filteredTracks = this.filterAndSortTracks(tracks);
            this._renderLibraryTracks(filteredTracks, container);
        } else {
            const filteredPlaylists = this.filterAndSortPlaylists(playlists);
            this._renderLibraryPlaylists(filteredPlaylists, container);
        }
    }

    // Render playlist rows into the library list container.
    _renderLibraryPlaylists(playlists, container) {
        if (!playlists || playlists.length === 0) {
            const empty       = document.createElement("p");
            empty.className   = "library-empty";
            empty.textContent = "No playlists yet — import some to get started.";
            container.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const pl of playlists) {
            const row     = document.createElement("div");
            row.className = "library-row";

            const nameSpan       = document.createElement("span");
            nameSpan.className   = "library-row-name";
            nameSpan.textContent = pl.name;

            const countSpan       = document.createElement("span");
            countSpan.className   = "library-row-count";
            const n               = pl.trackIDs?.length ?? 0;
            countSpan.textContent = `${n} track${n !== 1 ? "s" : ""}`;

            row.appendChild(nameSpan);
            row.appendChild(countSpan);
            fragment.appendChild(row);
        }

        container.appendChild(fragment);
        console.log(`Library rendered: ${playlists.length} playlists`);
    }

    // Render track rows (title + artist) into the library list container.
    _renderLibraryTracks(tracks, container) {
        if (!tracks || tracks.length === 0) {
            const empty       = document.createElement("p");
            empty.className   = "library-empty";
            empty.textContent = "No tracks yet — import some playlists to get started.";
            container.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const track of tracks) {
            const row     = document.createElement("div");
            row.className = "library-row";

            const nameSpan       = document.createElement("span");
            nameSpan.className   = "library-row-name";
            nameSpan.textContent = track.title ?? track.trackID;

            const metaSpan       = document.createElement("span");
            metaSpan.className   = "library-row-count"; // reuse count style for right-aligned meta
            metaSpan.textContent = track.artist ?? "";

            row.appendChild(nameSpan);
            row.appendChild(metaSpan);
            fragment.appendChild(row);
        }

        container.appendChild(fragment);
        console.log(`Library rendered: ${tracks.length} tracks`);
    }

    // Setup library action dropdown in the card control bar.
    setupLibraryControls() {
        const btn = document.getElementById("library-actions-btn");
        if (!btn) return;

        btn.addEventListener("click", (event) => {
            event.stopPropagation();

            if (dropdownMenu.isOpen) {
                dropdownMenu.close();
                return;
            }

            const rect = btn.getBoundingClientRect();
            const x = rect.left;
            const y = rect.bottom + 8;

            dropdownMenu.open(this.getLibraryControlMenuItems(), x, y);
        });
    }

        //TODO move definitions elsewhere
        // Helper method returns library sort options depending on current library view.
        getLibrarySortOptions() {

        // track view
        if (this.libraryView === "tracks") {
            return [
                { value: "title", label: "Title" },
                { value: "artist", label: "Artist" },
                { value: "album", label: "Album" },
            ];
        }

        // playlist view
        return [
            { value: "last-modified", label: "Recent" },
            { value: "name", label: "Name" },
            { value: "track-count", label: "Size" },
        ];
    }

    renderLibraryControls() {
        const searchInput = document.getElementById("library-search-input");
        const sortSelect  = document.getElementById("library-sort-select");

        if (searchInput) {
            searchInput.placeholder = this.libraryView === "tracks" ? "Search tracks…" : "Search playlists…";
            searchInput.value = this.librarySearchQuery;
        }

        if (!sortSelect) return;

        const options = this.getLibrarySortOptions();
        sortSelect.innerHTML = "";

        for (const option of options) {
            const opt = document.createElement("option");
            opt.value = option.value;
            opt.textContent = option.label;
            sortSelect.appendChild(opt);
        }

        if (!options.some((opt) => opt.value === this.librarySortCriteria)) {
            this.librarySortCriteria = options[0].value;
        }

        sortSelect.value = this.librarySortCriteria;
    }

    getLibraryControlMenuItems() {
        return [
            { label: "Delete Playlists", action: async () => { await this.handleDeletePlaylists(); }},
            { label: "Clear Storage", action: async () => { await this.handleClearStorage(); }},
        ];
    }

    filterAndSortPlaylists(playlists) {
        const query = this.librarySearchQuery.toLowerCase();

        let results = playlists.filter((pl) => matchesPlaylistSearch(pl, query));

        switch (this.librarySortCriteria) {
            case "track-count":
                results = [...results].sort((a, b) => (b.trackIDs?.length || 0) - (a.trackIDs?.length || 0));
                break;
            case "last-modified":
                results = [...results].sort((a, b) => {
                    const aDate = a.lastModified ? new Date(a.lastModified).getTime() : 0;
                    const bDate = b.lastModified ? new Date(b.lastModified).getTime() : 0;
                    return bDate - aDate;
                });
                break;
            case "name":
            default:
                results = [...results].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        }

        return results;
    }

    filterAndSortTracks(tracks) {
        const query = this.librarySearchQuery.toLowerCase();

        let results = tracks.filter((track) => matchesTrackSearch(track, query));

        switch (this.librarySortCriteria) {
            case "artist":
                results = [...results].sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
                break;
            case "album":
                results = [...results].sort((a, b) => (a.album || "").localeCompare(b.album || ""));
                break;
            case "title":
            default:
                results = [...results].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        }

        return results;
    }


    // Show playlist selector, then delete each selected playlist from IDB and refresh library.
    async handleDeletePlaylists() {
        let playlists;
        try {
            playlists = await this.dataManager.getAllRecords("playlists");
        } catch (err) {
            console.error("Failed to load playlists for deletion:", err);
            return;
        }

        if (!playlists || playlists.length === 0) {
            await notifyModal({ title: "No Playlists", message: "No playlists to delete." });
            return;
        }

        const selectedIds = await playlistSelectModal({
            title:        "Delete Playlists",
            confirmLabel: "Delete Selected",
            playlists
        });

        if (!selectedIds || selectedIds.length === 0) return;

        // Delete each selected playlist record from IDB
        for (const id of selectedIds) {
            try {
                await this.dataManager.deleteRecord("playlists", id);
                console.log(`Deleted playlist ${id}`);
            } catch (err) {
                console.error(`Failed to delete playlist ${id}:`, err);
            }
        }

        console.log(`Deleted ${selectedIds.length} playlist(s)`);
        this.renderLibrary();
    }

    // Confirm with user, then clear all records from both IDB stores and refresh library.
    async handleClearStorage() {
        const confirmed = await warningModal({
            title:   "Clear All Storage",
            message: "This will permanently delete all playlists and tracks. This cannot be undone.",
            actions: [
                { label: "Cancel",    value: false, className: "modal__btn--cancel" },
                { label: "Clear All", value: true,  className: "modal__btn--danger" }
            ]
        });

        if (!confirmed) return;

        for (const storeName of ["tracks", "playlists"]) {
            try {
                await this.dataManager.clearRecords(storeName);
                console.log(`Cleared ${storeName}`);
            } catch (err) {
                console.error(`Failed to clear ${storeName}:`, err);
            }
        }

        this.renderLibrary();
    }

    // ====== WORKSPACE CARD ==========================================

    // Load playlists, show selection modal, then open workspace with chosen playlist IDs in sessionStorage.
    async handleOpenWorkspace() {
        let playlists;
        try {
            playlists = await this.dataManager.getAllRecords("playlists");
        } catch (err) {
            console.error("Failed to load playlists for workspace selector:", err);
            return;
        }

        if (!playlists || playlists.length === 0) {
            await notifyModal({ title: "No Playlists", message: "Import some playlists first before opening the workspace." });
            return;
        }

        // playlistSelectModal returns an array of selected IDB ids, or null if cancelled
        const selectedIds = await playlistSelectModal({
            title:        "Select Playlists",
            confirmLabel: "Open Workspace",
            playlists,
            offerSelectAll: false
        });

        if (!selectedIds || selectedIds.length === 0) return;

        //Warn if user selects more than 10 playlists,
        if (selectedIds.length > 10) {
            const proceed = await warningModal({
                title: `Large Selection - ${selectedIds.length} Playlists`,
                message: `The workspace is designed for up to 10 playlists, loading more may cause display or performance issues. Do you want to proceed?`,
                // message: `You have selected ${selectedIds.length} playlists. The workspace is designed for up to 10 playlists. Loading more may cause display or performance issues. Do you want to proceed?`,
                actions: [
                    { label: "Cancel", value: false, className: "modal__btn--cancel" },
                    { label: "Proceed", value: true, className: "modal__btn--primary" }
                ]
            });

            if (!proceed) return;
        }

        this.openWorkspaceWithPlaylists(selectedIds);
    }

    // Write session to sessionStorage and navigate to workspace.
    openWorkspaceWithPlaylists(playlistIds) {
        const session = { playlistIds, timestamp: new Date().toISOString() };
        sessionStorage.setItem("workspaceSession", JSON.stringify(session));
        console.log("Opening workspace with playlists:", playlistIds);
        window.location.href = "workspace/workspace.html";
    }


    // Placeholder for features not yet implemented, shows a simple "coming soon" modal.
    async notAvailable(featureName = "This feature") {
        await notifyModal({ title: "Coming Soon", message: `${featureName} is not yet available.` });
    }




    // ====== SIMILARITY CARD ==========================================


    // Select reference playlists, run overlap scan, show results modal.
    // If user clicks "Open in Workspace" on results, opens workspace with the shown playlists.
    async handleReferenceScan() {
        // Load playlists
        let playlists;
        try {
            playlists = await this.dataManager.getAllRecords("playlists");
        } catch (err) {
            console.error("Failed to load playlists for overlap scan:", err);
            return;
        }

        if (!playlists || playlists.length === 0) {
            await notifyModal({ title: "No Playlists", message: "Import some playlists first." });
            return;
        }

        // Let user pick which playlist(s) to use as the reference
        const referenceIds = await playlistSelectModal({
            title:        "Select Reference Playlists",
            confirmLabel: "Scan",
            playlists,
            offerSelectAll: false
        });
        if (!referenceIds || referenceIds.length === 0) return;

        // Build reference track set from all selected playlists
        const referenceSet = buildReferenceSet(referenceIds, playlists);

        // Run scan against all playlists, filter to those with at least one match
        const rawResults  = scanWithReference(referenceSet, playlists);
        const results     = Object.values(rawResults)
            .filter(r => r.totalMatch > 0)
            .sort((a, b) => b.totalMatch - a.totalMatch || b.percentRef - a.percentRef);

        // Label for the modal title — comma-joined names of selected reference playlists
        const referenceLabel = referenceIds
            .map(id => playlists.find(p => p.id === id)?.name ?? "?")
            .join(", ");

        // Show results; returns array of IDs to open if user clicks "Open in Workspace", else null
        const openIds = await overlapResultsModal({ results, referenceLabel });
        if (openIds && openIds.length > 0) {
            this.openWorkspaceWithPlaylists(openIds);
        }
    }

    // Build a unified Set<trackID> from the given playlist IDs and the full playlists array.
    buildReferenceSet(playlistIds, playlists) {
        const set = new Set();

        // For each playlist ID, find the playlist object, then add each of its trackIDs to the set. 
        // This results in a single set of unique trackIDs across all selected reference playlists.
        for (const id of playlistIds) {
            const pl = playlists.find(p => p.id === id);
            if (!pl || !Array.isArray(pl.trackIDs)) continue;
            for (const trackID of pl.trackIDs) set.add(trackID);
        }
        return set;
    }
}

const app = new DashboardApp();



