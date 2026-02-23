import DataManager from "./dataManager.js";
import {SampleTracks} from "./sampleDataGenerator.js";
import { renderPlaylistTable } from "./ui.js";

const app = new AppIteration1();



class AppIteration1{

    constructor(){
        console.log("AppIteration1 constructor called");
        this.dataManager = new DataManager();
        this.sampleTracks = new SampleTracks();

        this.dataManager.init();
        this.addEventListeners();
    }


    addEventListeners() {
        console.log("Adding event listeners to buttons");
        document.getElementById("createPlaylistButton").addEventListener("click", this.handleCreatePlaylist.bind(this));
        document.getElementById("getPlaylistButton").addEventListener("click", this.handleGetPlaylist.bind(this));
        document.getElementById("getAllPlaylistsButton").addEventListener("click", this.handleGetAllPlaylists.bind(this));
        document.getElementById("updatePlaylistButton").addEventListener("click", this.handleUpdatePlaylist.bind(this));
        document.getElementById("deletePlaylistButton").addEventListener("click", this.handleDeletePlaylist.bind(this));
        document.getElementById("deleteAllPlaylistsButton").addEventListener("click", this.handleDeleteAllPlaylists.bind(this));
        document.getElementById("clearDisplayButton").addEventListener("click", this.handleClearDisplay.bind(this));
        
    }

    async handleCreatePlaylist() {
        console.log("Button clicked: Create Playlist");
        let playlistData = this.sampleTracks.createRandomPlaylist();
        
        try {
            let recordID = await this.dataManager.createRecord("playlists", playlistData);
            console.log(`Playlist with ID '${recordID}' created successfully: ${playlistData.name}`);
            // console.table(playlistData);
        }
        catch (error) {
            console.error("Error creating playlist:", error);
        }
    }



    async handleGetPlaylist() {
        console.log("Button clicked: Get Playlist");
        let testID = getDesiredID();
        try {
            let record = await this.dataManager.getRecord("playlists", testID);
            if (!record) {
                console.log(`No playlist found with ID ${testID}`);
                return;
            } else {
                console.log(`Playlist with ID '${testID}' and name '${record.name}' retrieved successfully:`);
                console.table(record.tracks || record.trackIDs);
                renderPlaylistTable(record);
            }
        }
        catch (error) {
            console.error(`Error retreiving playlist with ID ${testID}:`, error);
        }
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
                    renderPlaylistTable(record);
                }
            }
        }
        catch (error) {
            console.error("Error retrieving all playlists:", error);
        }
    }

    async handleDeleteAllPlaylists() {
        console.log("Button clicked: Delete All Playlists");
        try {
            await this.dataManager.clearRecords("playlists");
            console.log("All playlists deleted successfully");
        }
        catch (error) {
            console.error("Error deleting all playlists:", error);
        }
    }

    async handleUpdatePlaylist(){
        console.log("Button clicked: Update Playlist");
        let testID = this.getDesiredID();
        try {
            let record = await this.dataManager.getRecord("playlists", testID);
            if (!record) {
                console.log(`Cant update - no playlist found with ID ${testID}`);
                return;
            }
            console.log(record);
            let oldName = record.name;
            let newName = oldName + "-Updated";
            record.name = newName;
            await this.dataManager.replaceRecord("playlists", record.id, record);
            console.log(`Playlist with ID ${testID} updated successfully: ${oldName} -> ${newName}`);
        }
        catch (error) {
            console.error(`Error updating playlist with ID ${testID}:`, error);
        }
    }

    async handleDeletePlaylist(){
        console.log("Button clicked: Delete Playlist");
        let testID = getDesiredID();
        try {
            await this.dataManager.deleteRecord("playlists", testID);
            console.log(`Playlist with ID ${testID} deleted successfully`);
        }
        catch (error) {
            console.error(`Error deleting playlist with ID ${testID}:`, error);
        }
    }

    async handleClearDisplay(){
        console.log("Button clicked: Clear Display");
        const container = document.getElementById('playlist-container');
        container.innerHTML = '';
        console.log("Display cleared successfully");
    }

    //Ask user for an ID, then return the record with that ID.
    async getDesiredID(){
        let id = prompt("Enter a playlist ID:");
        return parseInt(id);
    }
}






