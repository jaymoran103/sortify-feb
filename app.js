import DataManager from "./shared/dataManager.js";
import ioManager from "./shared/ioManager.js";
import StatusIndicator from "./shared/statusIndicator.js";
import csvImportAdapter from "./shared/adapters/csvImportAdapter.js";
import csvExportAdapter from "./shared/adapters/csvExportAdapter.js";
import jsonBundleExporter from "./shared/adapters/jsonBundleExporter.js";

import { menuModal, notifyModal, warningModal, playlistSelectModal } from "./shared/modal.js";

class DashboardApp {

    constructor() {
        this.dataManager = new DataManager();

        this.dataManager.init().then(() => {
            console.log("Database initialized");
            this.addEventListeners();
            this.renderLibrary();
            this.setupIO();
        }).catch((err) => {
            console.error("Failed to initialize database:", err);
        });
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
            await this.notAvailable();
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
        // Spotify export: not implemented yet.
        else if (dest === "spotify") {
            await this.notAvailable();
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
            const input = document.getElementById("csvFileInput");
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
            const file = files[i];
            // Per-file progress update
            this.status.update(i + 1, files.length, `Importing ${file.name}...`);
            try {
                const stats = await ioManager.import('csv', this.dataManager, file);
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
    setupIO() {
        ioManager.registerImporter('csv',          csvImportAdapter);

        ioManager.registerExporter('csv',          csvExportAdapter);
        ioManager.registerExporter('jsonBundle',   jsonBundleExporter);
        
        this.status = new StatusIndicator(document.getElementById('io-footer'));

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
            confirmLabel: "Open Workspace →",
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



