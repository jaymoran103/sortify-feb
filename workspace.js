import SampleTracks from "./sampleDataGenerator.js";

//Session state: in-memory representation of playlists and tracks, and a set tracking playlists with unsaved changes
let playlists = [];        // array of playlist objects (each has trackIDSet added)
let tracks = {};           // lookup object: trackID → track data
let modifiedPlaylists = new Set(); // IDs of playlists with unsaved changes

function init() {
    const sampleData = new SampleTracks();
    const fakeData = sampleData.getWorkspaceData();

    // Convert tracks array → lookup object keyed by trackID
    tracks = {};
    for (const track of fakeData.tracks) {
        tracks[track.trackID] = track;
    }

    // Build playlists, adding playlistID and a trackIDSet
    playlists = fakeData.playlists.map((pl, id) => ({
        ...pl, // spread original playlist data
        playlistID: `${id}`, // format for test
        trackIDs: [...pl.trackIDs], // clone ensures safe modification without affecting original data
        trackIDSet: new Set(pl.trackIDs) // create set for quicker membership checks
    }));

    console.log("Setting up workspace for playlists:", playlists.map(p => p.name));

    renderWorkspace();
    setupEventListeners();
}

function renderWorkspace() {
    renderTableHeader();
    renderTableBody();
}

function renderTableHeader() {
    const thead = document.getElementById("table-header");
    thead.innerHTML = "";

    const row = document.createElement("tr");

    //Create and append header cells for track title, artist, album
    const titleTh = document.createElement("th");
    titleTh.textContent = "Title";
    row.appendChild(titleTh);

    const artistTh = document.createElement("th");
    artistTh.textContent = "Artist";
    row.appendChild(artistTh);

    const albumTh = document.createElement("th");
    albumTh.textContent = "Album";
    row.appendChild(albumTh);


    // One column per playlist
    for (const playlist of playlists) {
        const th = document.createElement("th");
        th.textContent = playlist.name;
        th.dataset.playlistID = playlist.playlistID; // store playlist ID for reference
        row.appendChild(th);
    }

    thead.appendChild(row);
}

function renderTableBody() {
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";

    // Collect unique track IDs across all playlists (preserving first-seen order)
    const seen = new Set();
    const allTrackIDs = [];
    for (const playlist of playlists) {
        for (const tid of playlist.trackIDs) {
            if (!seen.has(tid)) {
                seen.add(tid);
                allTrackIDs.push(tid);
            }
        }
    }

    console.log(`Attempting to render table with ${allTrackIDs.length} unique track IDs across ${playlists.length} playlists`);

    // For each track ID, create a row with track info and checkboxes for playlist membership
    for (const trackID of allTrackIDs) {
        const track = tracks[trackID];
        const row = document.createElement("tr");

        // Create and append track info cells //TODO consider making a single cell or joining cells as container. 
                                              // OR have a basic cell (just title+artist) and optional extra columns for album, duration, other metadata. Availabikity of album cover determines a lot, but rate limiiting might veto that for now.
        const titleCell = document.createElement("td");
        titleCell.className = "track-title-cell";
        titleCell.textContent = track ? track.title : trackID;
        row.appendChild(titleCell);

        const artistCell = document.createElement("td");
        artistCell.className = "track-artist-cell";
        artistCell.textContent = track ? track.artist : "Unknown Artist";
        row.appendChild(artistCell);
        
        const albumCell = document.createElement("td");
        albumCell.className = "track-album-cell";
        albumCell.textContent = track ? track.album : "Unknown Album";
        row.appendChild(albumCell);

        // For each playlist, add a checkbox representing memberbship
        for (const playlist of playlists) {
            const checkCell = document.createElement("td");
            checkCell.className = "checkbox-cell";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.trackID = trackID;
            checkbox.dataset.playlistID = playlist.playlistID;
            checkbox.checked = playlist.trackIDSet.has(trackID);

            checkCell.appendChild(checkbox);
            row.appendChild(checkCell);
        }

        tbody.appendChild(row);
    }
}

function setupEventListeners() {

    document.getElementById("save-btn").addEventListener("click", handleSave);
    document.getElementById("back-btn").addEventListener("click", () => {
        window.location.href = "index.html";
        // window.location.href = ".";//Looks like this finds index.html by default, leaving url simpler. not a consideration yet
    });
    // For any checkbox change in the table body, handle toggle with reference to the event target
    document.getElementById("table-body").addEventListener("change", (e) => {
        if (e.target.type === "checkbox") {
            handleCheckboxToggle(e.target);
        }
    });

}
//Handler for checkbox click event: toggles track membership in playlist, then update modifiedPlaylists and save status
function handleCheckboxToggle(checkbox) {
    console.log(`Checkbox toggled: ${JSON.stringify(checkbox.dataset)} - checked: ${checkbox.checked}`);
    const trackID = checkbox.dataset.trackID;
    const playlistID = checkbox.dataset.playlistID;
    const playlist = playlists.find(p => p.playlistID === playlistID);

    if (!playlist) {
        console.warn("playlist not found in handleCheckboxToggle: ", playlistID);
        return;
    }

    // Update playlist trackIDs and trackIDSet based on checkbox state   
    if (checkbox.checked) {
        if (!playlist.trackIDSet.has(trackID)) {
            playlist.trackIDs.push(trackID);
            playlist.trackIDSet.add(trackID);
        }
        console.log(`Added '${trackID}' to '${playlist.name}'`);
    } else {
        playlist.trackIDs = playlist.trackIDs.filter(id => id !== trackID);
        playlist.trackIDSet.delete(trackID);
        console.log(`Removed '${trackID}' from '${playlist.name}'`);
    }

    modifiedPlaylists.add(playlistID);
    updateSaveStatus();
}

// Update the save status message based on whether there are unsaved changes based on status of changes
function updateSaveStatus() {
    const saveStatus = document.getElementById("save-status");

    if (modifiedPlaylists.size > 0) {
        saveStatus.textContent = `${modifiedPlaylists.size} playlist(s) modified`;
    } else {
        saveStatus.textContent = "";
    }
}
//currently just logs modifications to console, //TODO use dataManager to persist changes
function handleSave() {
    console.log("Saving modified playlists:", [...modifiedPlaylists]);

    const saveBtn = document.getElementById("save-btn");
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;

    // Log the trackIDs for each modified playlist\
    for (const playlistID of modifiedPlaylists) {
        let playlist = playlists.find(p => p.playlistID === playlistID);
        if (playlist) {
            console.log(`'${playlist.name}' updated trackIDs:`, [...playlist.trackIDs]);
        } else {
            console.warn(`Playlist with ID '${playlistID}' not found during save.`);
        }
    }

    modifiedPlaylists.clear();

    //TODO disable button by default, enabling whenever modifiedPlaylists isn't empty
    const saveStatus = document.getElementById("save-status");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
    saveStatus.textContent = "Changes Saved!";

    setTimeout(() => {
        saveStatus.textContent = "";
    }, 2000);
}

init();
