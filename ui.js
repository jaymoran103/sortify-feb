export async function renderPlaylistTable(dataManager,playlist){
    // Leaving until all source data is coming from proper model
    // if (playlist.type !== "playlist"){
    //     console.error("Invalid playlist object:", playlist);//Indicate something went wrong with the given data
    // }

    // console.log(`Rendering playlist '${playlist.name}' with ${playlist.trackIDs.length} tracks`);

    //Get container, create div for playlist
    const container = document.getElementById('playlist-container');
    const playlistDiv = document.createElement('div');

    //Track row index for display
    let rowNumber = 0;

    //Set playlist name as header, create table for tracks
    playlistDiv.innerHTML = `
        <h3>${playlist.name} (${playlist.trackIDs.length} tracks)</h3>
        <table>
            <thead>
                ${renderPlaylistHeader()}
            </thead>    
            <tbody>
                ${await Promise.all(playlist.trackIDs.map(async (trackID) => {
                    return await renderPlaylistRow(dataManager,trackID,++rowNumber);
                })).then(rows => rows.join(''))}
            </tbody>
        </table>
    `;
    
    container.appendChild(playlistDiv);

}

export function renderPlaylistHeader(){
    return `
        <tr>
            <th>#</th>
            <th>Title</th>
            <th>Album</th>
            <th>Artist</th>
        </tr>
    `;
}

export async function renderPlaylistRow(dataManager,trackID,index){

    //Get track data from trackID
    const trackData = await getTrackByID(dataManager,trackID);

    //return table row or error info if not found
    if (trackData) {

        return `<tr>
                <td>${index}</td>
                <td>${trackData.title}</td>
                <td>${trackData.album}</td>
                <td>${trackData.artist}</td>

            </tr>`;
            //<td>${trackData.trackID.slice(14)}</td>

    } else{
        console.error(`No track found for ID: ${trackID}`);
        return `<tr><td colspan="4">Track ${trackID} not found</td></tr>`;
    }
}

async function getTrackByID(dataManager,trackID){
    return await dataManager.getRecord("tracks", trackID);
}

export function clearPlaylists() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = '';
}