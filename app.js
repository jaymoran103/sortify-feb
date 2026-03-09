import DataManager from "./shared/dataManager.js";
import Importer from "./shared/importer.js";
import { renderPlaylistTable } from "./shared/ui.js";

class AppIteration2{

    constructor(){
        this.dataManager = new DataManager();
        this.importer = new Importer();

        this.dataManager.init().then(() => {
            console.log("Database initialized successfully");
            this.addEventListeners();
        }).catch((error) => {
            console.error("Failed to initialize database:", error);
        });
    }

    addEventListeners() {
        document.getElementById("viewAllPlaylistsButton").addEventListener("click", this.handleViewAllPlaylists.bind(this));
        document.getElementById("clearDisplayButton").addEventListener("click", this.handleClearDisplay.bind(this));
        document.getElementById("clearStorageButton").addEventListener("click", this.handleClearStorage.bind(this));

        document.getElementById("importButton").addEventListener("click", this.handleImport.bind(this));
        document.getElementById("open-workspace-all-btn").addEventListener("click", this.handleOpenWorkspaceAll.bind(this));
        document.getElementById("open-workspace-select-btn").addEventListener("click", this.handleOpenWorkspaceSelect.bind(this));
    }

    // Handle button click to open workspace with ALL playlists 
    async handleOpenWorkspaceAll() {
        console.log("Button clicked: Open Workspace (all playlists)");
        let allPlaylists;
        try {
            allPlaylists = await this.dataManager.getAllRecords("playlists");
        } catch (err) {
            console.error("Failed to fetch playlists for workspace:", err);
            return;
        }

        if (!allPlaylists || allPlaylists.length === 0) {
            this.showWarning("No playlists in IndexedDB — import some first");
            return;
        }

        const ids = allPlaylists.map(p => p.id);
        this.openWorkspaceWithPlaylists(ids);
    }

    // Handle button click to open workspace with selected playlists - shows selection UI first
    async handleOpenWorkspaceSelect() {
        console.log("Button clicked: Open Workspace (select playlists)");
        let allPlaylists;
        try {
            allPlaylists = await this.dataManager.getAllRecords("playlists");
        } catch (err) {
            console.error("Failed to fetch playlists for selection UI:", err);
            return;
        }

        if (!allPlaylists || allPlaylists.length === 0) {
            this.showWarning("No playlists in IndexedDB — import some first");
            return;
        }

        this.showPlaylistSelectionUI(allPlaylists);
    }

    // Render a simple selection panel  - display each playlist with its name, track count, and a checkbox for selection.
    showPlaylistSelectionUI(playlists) {
        const panel = document.getElementById("playlist-select-panel");
        const list = document.getElementById("playlist-select-list");

        // Render each playlist as a checkbox item with name and track count. 
        // Checkbox values are playlist ids 
        list.innerHTML = playlists.map(pl => `
            <label style="display:block; padding: 4px 0; cursor:pointer;">
                <input type="checkbox" class="playlist-select-checkbox" value="${pl.id}" unchecked />
                ${pl.name} &mdash; ${(pl.trackIDs || []).length} tracks
            </label>
        `).join("");

        panel.style.display = "block";
        console.log(`Opened selection panel with ${playlists.length} playlists`);

        // One-time confirm handler
        document.getElementById("confirm-select-btn").addEventListener("click", () => {
            const checked = [...list.querySelectorAll(".playlist-select-checkbox:checked")];
            const selectedIds = checked.map(cb => Number(cb.value)); // IDB ids are numeric
            this.cleanupSelectorUI();

            if (selectedIds.length === 0) {
                this.showWarning("No playlists selected. Please check at least one playlist to open the workspace.");
                return;
            }

            console.log("Selected playlist IDs:", selectedIds);
            this.openWorkspaceWithPlaylists(selectedIds);
        });

        document.getElementById("cancel-select-btn").addEventListener("click", () => {
            console.log("Playlist selection cancelled");
            this.cleanupSelectorUI();
        });
    }

    // Helper method: hides selector panel and strips event listeners by replacing buttons with clones.
    // FUTURE - works fine, but better just to create the panel once and show/hide as needed? This probably isnt a permanent feature so im not going too deep rn.
    cleanupSelectorUI(){
        const panel = document.getElementById("playlist-select-panel");
        panel.style.display = "none";

        const confirmBtn = document.getElementById("confirm-select-btn");
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));

        const cancelBtn = document.getElementById("cancel-select-btn");
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    }

    // Save playlist IDs to sessionStorage and navigate to workspace.
    // FUTURE add session format to models.js: { playlistIds: number[], timestamp: string }
    openWorkspaceWithPlaylists(playlistIds) {
        const workspaceSession = {
            playlistIds,
            timestamp: new Date().toISOString()
        };
        sessionStorage.setItem("workspaceSession", JSON.stringify(workspaceSession));
        console.log("Saved workspaceSession to sessionStorage:", workspaceSession);
        window.location.href = "workspace/workspace.html";
    }

    // Handle button click to display all playlists (wraps showAllPlaylists)
    handleViewAllPlaylists(){
        console.log("Button clicked: View All Playlists");
        this.showAllPlaylists();
    }

    //Handle button click to clear display (wraps clearDisplay)
    handleClearDisplay() {
        console.log("Button clicked: Clear Display");
        this.clearDisplay();
    }

    // Handle button click to clear all records in both stores.
    async handleClearStorage() {
        console.log("Button clicked: Clear Storage");
        for (const storeName of ["tracks", "playlists"]){
            try {
                await this.dataManager.clearRecords(storeName);
                console.log(`All records in ${storeName} deleted successfully`);
            }
            catch (error) {
                console.error(`Error deleting all records in ${storeName}:`, error);
            }        
        }

        //clear display to reflect cleared storage
        this.clearDisplay();
    }

    // Handler for file selection event: update label, trigger import, display results
    async handleImport(){

        //Report action to console
        console.log("Import button clicked");

        //Get files from selector, returning if empty/undefined
        const files = await this.doFileSelection();
        if (!files || files.length === 0) {
            this.showWarning("No files selected for import", "warn");
            return;
        }

        //update label to indicate state on page, show progress bar
        const label = document.getElementById("file-count-label");
        label.textContent = "loading playlists...";

        await showProgressBar(); // Show loading indicator, hidden at method end.

        //Perform import 
        await this.importFiles(files);

        //Refresh display to show new playlists (using non-handler functions)
        this.clearDisplay();
        await this.showAllPlaylists();

        //reset file input, label, and progress bar for next import
        document.getElementById("csvFileInput").value = "";
        document.getElementById("file-count-label").textContent = "";
        hideProgressBar();          
    }

    //Prompt user to select files, resolving with selection(s) once dialog closes.
    doFileSelection(){
        return new Promise((resolve) => {
            const fileInput = document.getElementById("csvFileInput");
            fileInput.addEventListener("change", () => resolve(Array.from(fileInput.files)), { once: true });
            fileInput.addEventListener("cancel",  () => resolve([]),                          { once: true });
            fileInput.click();
        });
    }

    // Carries out import flow: for each file, attempt to import to IDB, tally successes and failures, report results to console.
    async importFiles(files) {

        //For each file, try to import, tracking successes and failures
        let successCount = 0;
        let failCount = 0;
        this.importer.resetStats();
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                console.log(`Importing file ${i+1} of ${files.length}: '${file.name}'`);
                await this.importer.importPlaylistCSV(this.dataManager, file);
                successCount++;
            } catch (error) {
                console.error(`Failed to import '${file.name}':`, error);
                failCount++;
            }
        }

        console.log(`Import completed: ${successCount} successful, ${failCount} failed.`)
        console.log(`  Total tracks processed: ${this.importer.totalTracksProcessed}`);
        console.log(`  Unique tracks added: ${this.importer.uniqueTracksAdded}`);
        console.log(`  Invalid tracks skipped: ${this.importer.invalidTracksSkipped}`);
    }

    //Gets all playlists from database, rendering a table for each.
    async showAllPlaylists(){

        //Try to retrieve all playlists from database
        let records;
        try {
            records = await this.dataManager.getAllRecords("playlists");
        }
        catch (error) {
            console.error("Error retrieving all playlists:", error);
        }

        //If records exist, try to render each as table
        if (records && records.length > 0) {
            try{
                for (const record of records){
                    await renderPlaylistTable(this.dataManager, record);
                }
            }
            catch (error){
                console.error("Error rendering playlist tables:", error);
            }
        } else {
            this.showWarning("No playlists found in the database - import some first");
        }
    }

    // Clears playlist display container on page
    clearDisplay(){
        const container = document.getElementById('playlist-container');
        container.innerHTML = '';
    }




    //Helper method shows a warning message in console and as an alert on page. 
    //For ease of testing without always checking console.
    showWarning(message,logMode="warn",source=null){
        //Show alert: for errors, just refer to console.
        if (logMode === "error") {
            alert("Error: see console for details"  );
        } else {
            alert(message);
        }

        //if given a source, preface console message with it.
        if (source) {
            message = `[${source}] ${message}`;
        }

        //log message to console with appropriate level. default to log here, but default method arg is "warn"
        if (logMode === "error") {
            console.error(message);
        } else if (logMode === "warn") {
            console.warn(message);
        } else {
            console.log(message);
        }
    }





}

async function showProgressBar() {
    document.getElementById("progress-bar").classList.add("loading");
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // yield so browser paints bar before load
}
function hideProgressBar() {
    document.getElementById("progress-bar").classList.remove("loading");
}


const app = new AppIteration2();





