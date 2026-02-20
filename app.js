import DataManager from "./dataManager.js";
import {SampleTracks} from "./sampleDataGenerator.js";

function addEventListeners() {
    console.log("Adding event listeners to buttons");
    document.getElementById("createPlaylistButton").addEventListener("click", handleCreatePlaylist);
    document.getElementById("getPlaylistButton").addEventListener("click", handleGetPlaylist);
    document.getElementById("getAllPlaylistsButton").addEventListener("click", handleGetAllPlaylists);
    document.getElementById("updatePlaylistButton").addEventListener("click", handleUpdatePlaylist);
    document.getElementById("deletePlaylistButton").addEventListener("click", handleDeletePlaylist);
    document.getElementById("deleteAllPlaylistsButton").addEventListener("click", handleDeleteAllPlaylists);

}

async function handleCreatePlaylist() {
    console.log("Button clicked: Create Playlist");
    let playlistData = sampleTracks.createRandomPlaylist();
    
    try {
        let recordID = await dataManager.createRecord("playlists", playlistData);
        console.log(`Playlist with ID '${recordID}' created successfully: ${playlistData.name}`);
        // console.table(playlistData);
    }
    catch (error) {
        console.error("Error creating playlist:", error);
    }
}

async function handleGetPlaylist() {
    console.log("Button clicked: Get Playlist");
    let testID = getDesiredID();
    try {
        let record = await dataManager.getRecord("playlists", testID);
        if (!record) {
            console.log(`No playlist found with ID ${testID}`);
            return;
        } else {
            console.log(`Playlist with ID '${testID}' and name '${record.name}' retrieved successfully:`);
            console.table(record.tracks);
        }
    }
    catch (error) {
        console.error(`Error retreiving playlist with ID ${testID}:`, error);
    }
}

async function handleGetAllPlaylists() {
    console.log("Button clicked: Get All Playlists");
    try {
        let records = await dataManager.getAllRecords("playlists");
        if (records.length === 0) {
            console.log("No playlists found in the database.");
            return;
        }
        else{
            console.log(`All playlists (${records.length}) retrieved successfully:`);
            console.table(records);
        }
    }
    catch (error) {
        console.error("Error retrieving all playlists:", error);
    }
}

async function handleDeleteAllPlaylists() {
    console.log("Button clicked: Delete All Playlists");
    try {
        await dataManager.clearRecords("playlists");
        console.log("All playlists deleted successfully");
    }
    catch (error) {
        console.error("Error deleting all playlists:", error);
    }
}

async function handleUpdatePlaylist(){
    console.log("Button clicked: Update Playlist");
    let testID = getDesiredID();
    try {
        let record = await dataManager.getRecord("playlists", testID);
        if (!record) {
            console.log(`Cant update - no playlist found with ID ${testID}`);
            return;
        }
        console.log(record);
        let oldName = record.name;
        let newName = oldName + "-Updated";
        record.name = newName;
        await dataManager.replaceRecord("playlists", record.id, record);
        console.log(`Playlist with ID ${testID} updated successfully: ${oldName} -> ${newName}`);
    }
    catch (error) {
        console.error(`Error updating playlist with ID ${testID}:`, error);
    }
}

async function handleDeletePlaylist(){
    console.log("Button clicked: Delete Playlist");
    let testID = getDesiredID();
    try {
        await dataManager.deleteRecord("playlists", testID);
        console.log(`Playlist with ID ${testID} deleted successfully`);
    }
    catch (error) {
        console.error(`Error deleting playlist with ID ${testID}:`, error);
    }
}
//Ask user for an ID, then return the record with that ID.
function getDesiredID(){
    let id = prompt("Enter a playlist ID:");
    return parseInt(id);
}

const dataManager = new DataManager();
const sampleTracks = new SampleTracks();
dataManager.init();
addEventListeners();


