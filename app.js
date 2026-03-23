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

import { menuModal, notifyModal, warningModal, playlistSelectModal, spotifyPlaylistSelectModal } from "./shared/modal.js";

class DashboardApp {

    constructor() {
        this.dataManager = new DataManager();

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
        document.getElementById("import-btn").addEventListener("click", this.handleImport.bind(this));
        document.getElementById("export-btn").addEventListener("click", this.handleExport.bind(this));
        document.getElementById("open-workspace-btn").addEventListener("click", this.handleOpenWorkspace.bind(this));
        document.getElementById("delete-playlists-btn").addEventListener("click", this.handleDeletePlaylists.bind(this));
        document.getElementById("clear-storage-btn").addEventListener("click", this.handleClearStorage.bind(this));
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

    // Load all playlists from IDB and render name+count rows into #library-list.
    // Uses a document fragment to avoid repeated reflows on large libraries.
    async renderLibrary() {
        const container = document.getElementById("library-list");
        const statsContainer = document.getElementById("library-stats");

        if (statsContainer) {
            statsContainer.hidden = true;
            statsContainer.innerHTML = "";
        }

        container.innerHTML = "";

        let playlists;
        try {
            playlists = await this.dataManager.getAllRecords("playlists");
        } catch (err) {
            console.error("Failed to load library:", err);
            return;
        }

        if (!playlists || playlists.length === 0) {
            const empty       = document.createElement("p");
            empty.className   = "library-empty";
            empty.textContent = "No playlists yet — import some to get started.";
            container.appendChild(empty);
            return;
        }

        // Compute simple library statistics. FUTURE: Cache this somewhere once I/O import sequence is more established, not worth the overhead yet. 
        const playlistCount = playlists.length;
        const totalTracks   = playlists.reduce((sum, pl) => sum + (pl.trackIDs?.length ?? 0), 0);

        let uniqueTracks = 0;
        try {
            const tracks = await this.dataManager.getAllRecords("tracks");
            uniqueTracks = tracks.length;
        } catch (err) {
            console.error("Failed to load unique track count:", err);
        }

        if (statsContainer) {
            statsContainer.hidden = false;
            statsContainer.innerHTML = `
                <div class="library-stats-item">
                    <span class="library-stats-value">${playlistCount}</span>
                    <span class="library-stats-label">playlists</span>
                </div>
                <div class="library-stats-item">
                    <span class="library-stats-value">${totalTracks}</span>
                    <span class="library-stats-label">tracks</span>
                </div>
                <div class="library-stats-item">
                    <span class="library-stats-value">${uniqueTracks}</span>
                    <span class="library-stats-label">unique</span>
                </div>
            `;
        }

        // Build all rows off-DOM, then insert in one operation
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
            playlists
        });

        if (!selectedIds || selectedIds.length === 0) return;

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

}

const app = new DashboardApp();



