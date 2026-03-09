//Basic data models for playlists and tracks. More metadata to come


//FUTURE define augmented session-layer playlist fields here? 


//Create playlist based on provided fields.
export function createPlaylist(name, trackIDs){
    return {
        type: "playlist",
        name: name || "Playlist "+ Date.now(),
        trackIDs: trackIDs || []
    }
}

//Create track based on provided fields.
export function createTrack(trackID, title, album, artist){
    return {
        type: "track",
        trackID: trackID || "track"+ Date.now(),
        title: title || "Untitled Track "+ Date.now(),
        album: album || "Unknown Album "+ Date.now(),
        artist: artist || "Unknown Artist "+ Date.now()
    }
}