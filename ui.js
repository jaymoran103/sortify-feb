import { SampleTracks } from "./sampleDataGenerator.js";

export function renderPlaylistTable(playlist){
    // Leaving until all source data is coming from proper model
    // if (playlist.type !== "playlist"){
    //     console.error("Invalid playlist object:", playlist);//Indicate something went wrong with the given data
    // }

    console.log(`Rendering playlist '${playlist.name}' with ${playlist.trackIDs.length} tracks`);

    //Get container, create div for playlist
    const container = document.getElementById('playlist-container');
    const playlistDiv = document.createElement('div');

    //Set playlist name as header, create table for tracks
    playlistDiv.innerHTML = `
        <h3>${playlist.name} - id:${playlist.id}</h3>
        <table>
            <thead>
                ${renderPlaylistHeader(playlist)}
            </thead>    
            <tbody>
                ${playlist.trackIDs.map(trackID => {
                    return renderPlaylistRow(trackID);
                }).join('')}
            </tbody>
        </table>
    `;
    
    container.appendChild(playlistDiv);

}

export function renderPlaylistHeader(playlist){
    return `
        <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Album</th>
            <th>Artist</th>
        </tr>
    `;
}

export function renderPlaylistRow(trackID){
    const trackData = getTrackByID(trackID);
    console.log(`Rendering track '${trackData.title}' by '${trackData.artist}' from album '${trackData.album}'`);
    return `<tr>
                <td>${trackData.trackID}</td>
                <td>${trackData.title}</td>
                <td>${trackData.artist}</td>
                <td>${trackData.album}</td>
            </tr>`;
}

//TODO replace with proper retrieval once DB
function getTrackByID(trackID){
    const sampleTracks = new SampleTracks();
    return sampleTracks.getDataFromID(trackID);
}

export function clearPlaylists() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = '';
}