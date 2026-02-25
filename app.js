import DataManager from "./dataManager.js";
import Importer from "./importer.js";
import { renderPlaylistTable } from "./ui.js";

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
        document.getElementById("getAllPlaylistsButton").addEventListener("click", this.handleGetAllPlaylists.bind(this));
        document.getElementById("clearDisplayButton").addEventListener("click", this.handleClearDisplay.bind(this));
        document.getElementById("csvFileInput").addEventListener("change", this.handleFileSelection.bind(this));
        document.getElementById("clearStorageButton").addEventListener("click", this.handleClearStorage.bind(this));
        document.getElementById("clearStorageButton").addEventListener("click", this.handleClearDisplay.bind(this));
    }

    // Updates the file count label whenever a selection changes.
    // For now, triggers import right away, displays new results.
    async handleFileSelection() {

        const label = document.getElementById("file-count-label");
        label.textContent = "loading playlists...";

        //trigger import and refresh display
        this.handleClearDisplay();

        await this.handleImport();
        await this.handleGetAllPlaylists();
        
        //reset file input and label for next import
        document.getElementById("csvFileInput").value = "";
        document.getElementById("file-count-label").textContent = "";
    }
    
    //Get files from selector, return as Array if files exist
    getSelectedFiles() {
        const fileInput = document.getElementById("csvFileInput");
        return (fileInput.files.length > 0) ? Array.from(fileInput.files) : [];
    }

    async handleImport() {

        //Get files from selector, returning if empty
        const files = this.getSelectedFiles();
        if (files.length === 0) {
            console.warn("No files selected for import");
            return;
        }

        //For each file, try to import, tracking successes and failures
        let successCount = 0;
        let failCount = 0;
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

        //reset components, log results

        console.log(`Import completed: ${successCount} successful, ${failCount} failed.`)
    }

    async handleGetAllPlaylists() {
        console.log("Button clicked: Get All Playlists");
        try {
            let records = await this.dataManager.getAllRecords("playlists");
            if (records.length === 0) {
                console.log("No playlists found in the database.");
                return;
            }
            else{
                console.log(`All playlists (${records.length}) retrieved successfully:`);
                console.table(records);
                for (const record of records){
                    await renderPlaylistTable(this.dataManager, record);
                }
            }
        }
        catch (error) {
            console.error("Error retrieving all playlists:", error);
        }
    }

    handleClearDisplay() {
        console.log("Button clicked: Clear Display");
        const container = document.getElementById('playlist-container');
        container.innerHTML = '';
    }

    async handleClearStorage() {
    console.log("Button clicked: Clear Storage");
    try {
        await this.dataManager.clearRecords("playlists");
        await this.dataManager.clearRecords("tracks");
        console.log("All playlists and tracks deleted successfully");
    }
    catch (error) {
        console.error("Error deleting all playlists and tracks:", error);
    }
}


}

const app = new AppIteration2();





