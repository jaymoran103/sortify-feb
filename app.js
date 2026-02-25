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
        document.getElementById("viewAllPlaylistsButton").addEventListener("click", this.handleViewAllPlaylists.bind(this));
        document.getElementById("clearDisplayButton").addEventListener("click", this.handleClearDisplay.bind(this));
        document.getElementById("csvFileInput").addEventListener("change", this.handleImport.bind(this));
        document.getElementById("clearStorageButton").addEventListener("click", this.handleClearStorage.bind(this));
        document.getElementById("clearStorageButton").addEventListener("click", this.handleClearDisplay.bind(this));
    }


    // Handler for file selection event: update label, trigger import, display results
    async handleImport(){

        //Report action to console, update label to indicate state on page
        console.log("Importing...");
        const label = document.getElementById("file-count-label");
        label.textContent = "loading playlists...";

        //Get files from selector, returning if empty/undefined
        const files = this.getSelectedFiles();
        if (!files || files.length === 0) {
            console.warn("No files selected for import");
            return;
        }

        //Perform import 
        await this.importFiles(files);

        //Refresh display to show new playlists (using non-handler functions)
        this.clearDisplay();
        await this.showAllPlaylists();

        //reset file input and label for next import
        document.getElementById("csvFileInput").value = "";
        document.getElementById("file-count-label").textContent = "";        
    }
    
    //Get files from selector, return as Array if files exist
    getSelectedFiles() {
        const fileInput = document.getElementById("csvFileInput");
        return (fileInput.files.length > 0) ? Array.from(fileInput.files) : [];
    }

    // Carries out import flow: for each file, attempt to import to IDB, tally successes and failures, report results to console.
    async importFiles(files) {

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

        console.log(`Import completed: ${successCount} successful, ${failCount} failed.`)
    }

    // Handle button click to display all playlists (wraps showAllPlaylists)
    async handleViewAllPlaylists(){
        console.log("Button clicked: View All Playlists");
        this.showAllPlaylists();
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
            console.log("No playlists found in the database, or an error occurred during retrieval.");
        }
    }

    //Handle button click to clear display (wraps clearDisplay)
    handleClearDisplay() {
        console.log("Button clicked: Clear Display");
        this.clearDisplay();
    }

    // Clears playlist display container on page
    clearDisplay(){
        const container = document.getElementById('playlist-container');
        container.innerHTML = '';
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




}

const app = new AppIteration2();





