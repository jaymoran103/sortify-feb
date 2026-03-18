//Commit message: 

import DataManager from "./shared/dataManager.js";
import Importer from "./shared/importer.js";
import { menuModal, notifyModal, playlistSelectModal } from "./shared/modal.js";

class DashboardApp {

    constructor() {
        this.dataManager = new DataManager();
        this.importer    = new Importer();

        this.dataManager.init().then(() => {
            console.log("Database initialized");
            this.addEventListeners();
            this.renderLibrary();
        }).catch((err) => {
            console.error("Failed to initialize database:", err);
        });
    }

    addEventListeners() {
        document.getElementById("import-btn").addEventListener("click", this.handleImport.bind(this));
        document.getElementById("export-btn").addEventListener("click", this.handleExport.bind(this));
        document.getElementById("open-workspace-btn").addEventListener("click", this.handleOpenWorkspace.bind(this));
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

    // Show menu to choose export destination, then trigger appropriate flow; Neither is implemented yet.
    async handleExport() {
        const choice = await menuModal({
            title: "Export Playlists",
            choices: [
                { label: "To Local Files", value: "local", primary: true },
                { label: "To Spotify",     value: "spotify" }
            ]
        });

        if (choice === "local") {
            await this.notAvailable("CSV export");
        } else if (choice === "spotify") {
            await this.notAvailable("Spotify export");
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

    // Loop files, import each, tally results, report to console.
    async importFiles(files) {
        let successCount = 0;
        let failCount    = 0;
        this.importer.resetStats();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                console.log(`Importing file ${i + 1} of ${files.length}: '${file.name}'`);
                await this.importer.importPlaylistCSV(this.dataManager, file);
                successCount++;
            } catch (err) {
                console.error(`Failed to import '${file.name}':`, err);
                failCount++;
            }
        }

        console.log(`Import complete: ${successCount} succeeded, ${failCount} failed.`);
        console.log(`  Total tracks processed: ${this.importer.totalTracksProcessed}`);
        console.log(`  Unique tracks added:    ${this.importer.uniqueTracksAdded}`);
        console.log(`  Invalid tracks skipped: ${this.importer.invalidTracksSkipped}`);
    }

    // ====== LIBRARY CARD ==========================================

    // Load all playlists from IDB and render name+count rows into #library-list.
    // Uses a document fragment to avoid repeated reflows on large libraries.
    async renderLibrary() {
        const container = document.getElementById("library-list");
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



