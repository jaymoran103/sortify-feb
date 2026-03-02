import WorkspaceSession from "./session.js";

const session = new WorkspaceSession();
// Session state: primarily managed by WorkspaceSession. module-level vars set to live references inside session after load().
// Render functions read these directly, so pointing them at session's arrays keeps everything in sync without a second copy of the data.
let playlists = [];        // array of playlist objects: session.playlists after init
let tracks = {};           // lookup object: session.tracks after init
let modifiedPlaylists = new Set(); // same Set object of playlist IDs: session.modifiedPlaylists after init

async function init() {

    // Read session created by the dashboard before navigating here
    let savedSession;
    try {
        savedSession = JSON.parse(sessionStorage.getItem("workspaceSession"));
    } catch (e) {
        console.error("Failed to parse workspaceSession from sessionStorage:", e);
    }

    if (!savedSession || !savedSession.playlistIds) {
        let message = "No workspace session found. Please select playlists from the dashboard.";
        console.warn(message);
        showSessionError(message);
        return;
    }

    console.log(`Restoring session (created ${savedSession.timestamp}).`,
        "Playlist IDs:", savedSession.playlistIds);

    try {
        await session.load(savedSession.playlistIds);
    } catch (err) {
        let message = "Failed to load playlists from IndexedDB:";
        console.error(message, err);
        showSessionError(message+" " + err.message);
        return;
    }

    if (session.playlists.length === 0) {
        showSessionError("No playlists were found for the selected IDs.");
        return;
    }

    // Point module vars at session's live data structures. Since they're references to the same objects/arrays, mutations like toggling tracks should be immediately reflected across the board without needing to reassign or sync.
    playlists = session.playlists;
    tracks = session.tracks;
    modifiedPlaylists = session.modifiedPlaylists; // same Set object- always in sync

    console.log("Setting up workspace for playlists:", playlists.map(p => p.name));

    renderWorkspace();
    setupEventListeners();
}

// Display an error message with a link back to the dashboard, used when session loading fails or no valid playlists are found.
function showSessionError(message) {
    const container = document.getElementById("workspace-container");
    container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #ccc;">
            <p style="font-size: 1.1em; color: red;">
                error: ${message}
            </p>
            <a href="index.html" style="color: green;">
                Back to Dashboard
            </a>
        </div>
    `;
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

    //Wipe existing table body
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";

    // Collect unique track IDs across all playlists (preserving first-seen order.)//FUTURE: consider cases with duplicates within a playlist, should be fine to reduce to one.
    const seen = new Set();
    const allTrackIDs = [];//FUTURE determine order of playlists checked by user input or order added
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

        // Create and append track info cells //FUTURE consider making a single cell or joining cells as container. 
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
// Handler for checkbox click event. State manipulation now happns in session counterpart.
function handleCheckboxToggle(checkbox) {
    console.log(`Checkbox toggled: trackID=${checkbox.dataset.trackID} playlistID=${checkbox.dataset.playlistID} checked=${checkbox.checked}`);
    const trackID = checkbox.dataset.trackID;
    const playlistID = checkbox.dataset.playlistID;
    session.toggleTrack(playlistID, trackID);
    updateSaveStatus();
}

// Update the save status message based on whether there are unsaved changes based on status of changes
function updateSaveStatus() {
    const saveStatus = document.getElementById("save-status");

    if (modifiedPlaylists.size > 0) {
        const saveBtn = document.getElementById("save-btn");
        saveBtn.disabled = false;
        saveStatus.textContent = `${modifiedPlaylists.size} playlist(s) modified`;
    } else {
        const saveBtn = document.getElementById("save-btn");
        saveBtn.disabled = true;
        saveStatus.textContent = "";
    }
}
//Handler for save button: persists modified playlists to IndexedDB via session.save(), adds timestamp for confirmation
async function handleSave() {
    const saveBtn = document.getElementById("save-btn");
    const saveStatus = document.getElementById("save-status");

    saveBtn.disabled = true;
    saveStatus.textContent = "Saving...";
    console.log("handleSave: Saving... (", modifiedPlaylists.size, "playlists)");

    try {
        await session.save();

        // Task 4: show timestamp so users can confirm persistence
        const savedTime = new Date().toLocaleTimeString();
        saveStatus.textContent = `Saved at ${savedTime}`;
        console.log(`[workspace] Save successful at ${savedTime}`);

        setTimeout(() => {
            // Clear status only if no new changes have been made since save completed
            if (modifiedPlaylists.size === 0) {
                saveStatus.textContent = `Last saved: ${savedTime}`;
            }
        }, 2000);

    } catch (err) {
        console.error("[workspace] Save failed:", err);
        saveStatus.textContent = "Save failed — see console";
        saveBtn.disabled = false; // re-enable button now so user can retry//TODO let modifiedPlaylist count determine this for consistency?
    }

    //Timestamp should negate need to time out the status message
    // setTimeout(() => {
    //     saveStatus.textContent = "";
    // }, 2000);
}

init();
