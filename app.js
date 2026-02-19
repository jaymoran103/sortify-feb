import {DataManager} from "./dataManager.js";

function addEventListeners() {
    console.log("Adding event listeners to buttons");
    document.getElementById("createPlaylistButton").addEventListener("click", handleCreatePlaylist);
    document.getElementById("getPlaylistButton").addEventListener("click", handleGetPlaylist);
    document.getElementById("getAllPlaylistsButton").addEventListener("click", handleGetAllPlaylists);
    document.getElementById("deleteAllPlaylistsButton").addEventListener("click", handleDeleteAllPlaylists);
    document.getElementById("updatePlaylistButton").addEventListener("click", handleUpdatePlaylist);
}

function handleCreatePlaylist() {
    console.log("Button clicked: Create Playlist");
    dataManager.createPlaylist();
}

function handleGetPlaylist() {
    console.log("Button clicked: Get Playlist");
    dataManager.getPlaylist();
}

function handleGetAllPlaylists() {
    console.log("Button clicked: Get All Playlists");
    dataManager.getAllPlaylists();
}

function handleDeleteAllPlaylists() {
    console.log("Button clicked: Delete All Playlists");
    dataManager.deleteAllPlaylists();
}

function handleUpdatePlaylist(){
    console.log("Button clicked: Update Playlist");
    dataManager.updatePlaylist(27);
}

const dataManager = new DataManager();
dataManager.init();
addEventListeners();


