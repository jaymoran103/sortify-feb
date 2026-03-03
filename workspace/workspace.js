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

    renderWorkspaceTable();
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
            <a href="../" style="color: green;">
                Back to Dashboard
            </a>
        </div>
    `;
}



function renderWorkspaceTable(){
    renderTableHeader();
    renderTableBody();
}

//Render header for new table structure. Columns for index, track info, and one for each playlist.
function renderTableHeader(){

    const thead = document.getElementById("table-header");
    thead.innerHTML = "";
    const row = document.createElement("tr");

    //Column for track indices
    const indexTh = document.createElement("th");
    indexTh.className = "index-cell";
    indexTh.textContent = "#";
    row.appendChild(indexTh);

    //Column for track info (currently combined). might add toggleable columns later for more metadata
    const titleTh = document.createElement("th");
    titleTh.className = "track-info-cell";
    titleTh.textContent = "Track";
    row.appendChild(titleTh);

    // One column per playlist
    for (const playlist of playlists) {
        const th = document.createElement("th");
        th.className = "checkbox-cell";
        th.textContent = playlist.name;
        th.dataset.playlistID = playlist.playlistID; // store playlist ID for reference
        row.appendChild(th);
    }

    //Append to header
    thead.appendChild(row);
}

//Render new table body. 
function renderTableBody(){
    //Wipe existing table body in case of re-render
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";

    const allTrackIDs = collectTrackIDsInOrder(playlists);


    //Iterate through trackIDs in order, creating rows with track info and checkboxes for playlist membership.
    for (let i = 0; i < allTrackIDs.length; i++) {
        const trackID = allTrackIDs[i];
        const row = document.createElement("tr");

        //Index cell
        const indexCell = document.createElement("td");
        indexCell.className = "index-cell";
        indexCell.textContent = i + 1; // Start at 1 not 0.
        row.appendChild(indexCell);

        //Info cell
        const infoCell = createTrackInfoCell(trackID);
        infoCell.className = "track-info-cell";
        row.appendChild(infoCell);

        //Create checkbox cells for each playlist, and append to row.
        const membershipCells = createCheckboxCells(trackID);
        membershipCells.forEach(cell => row.appendChild(cell));

        //Append completed row to table body
        tbody.appendChild(row);
    }
}

//Helper method creates track info cell with title, artist, and album. FUTURE: Consider adding album art, but probably never worth it with API rate limits.
// If info somehow isn't available, fields fall back to placeholders. This should be hard to encounter since importer currently rejects tracks missing basic metadata.
function createTrackInfoCell(trackID){
    const track = tracks[trackID];
    const cell = document.createElement("td");

    //Track title sits on top in its own div.
    const trackNameDiv = document.createElement("div");
    trackNameDiv.className = "track-name";
    trackNameDiv.textContent = track ? track.title : trackID;
    cell.appendChild(trackNameDiv);

    //Other metadata (artist and album) sits in separate div below, with a separateor dot between. FUTURE: think about making these links to spotify IDs or something, opening in window or elsewhere. Since data currently comes through a third party, this would be a roundabout process to acquire for now.
    const trackMetaDiv = document.createElement("div");
    trackMetaDiv.className = "track-meta";

    const artistSpan = document.createElement("span");
    artistSpan.className = "artist";
    artistSpan.textContent = track ? track.artist : "Unknown Artist";
    trackMetaDiv.appendChild(artistSpan);

    const sepSpan = document.createElement("span");
    sepSpan.className = "sep";
    sepSpan.textContent = " • ";
    trackMetaDiv.appendChild(sepSpan);

    const albumSpan = document.createElement("span");
    albumSpan.className = "album";
    albumSpan.textContent = track ? track.album : "Unknown Album";
    trackMetaDiv.appendChild(albumSpan);

    cell.appendChild(trackMetaDiv);
    return cell;
}

//Helper method creates a checkbox cell for each displayed playlist, indicating and toggling the membership of the given trackID.
function createCheckboxCells(trackID){
    return playlists.map(playlist => {
    
        //Create cell and checkbox. FUTURE: Make checkbox bigger or whole cell clickable for easier toggling.
        const checkCell = document.createElement("td");
        checkCell.className = "checkbox-cell";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";

        //Store trackID and playlistID in dataset, so handler can reference them when toggled.
        checkbox.dataset.trackID = trackID;
        checkbox.dataset.playlistID = playlist.playlistID;

        //Determine checked status by checking trackID against playlist's trackIDSet.
        checkbox.checked = playlist.trackIDSet.has(trackID);
        checkCell.appendChild(checkbox);
        return checkCell;
    });
}

// Helper method collects and returns an array of all unique track IDs across playlists in first-seen order, used for rendering rows.
// NOTE: Duplicates are reduced to the first occurence, not a concern as displaying multiple would look messy and open the door to some wack uses.
function collectTrackIDsInOrder(playlists){
    const seen = new Set();
    const allTrackIDs = [];
    //Iterate through playlists in order, pushing not yet seen trackIDs to the array.
    for (const playlist of playlists) {
        for (const tid of playlist.trackIDs) {
            //If not seen yet, add to seen and push to allTrackIDs. Specific playlist membership is determined later by checkboxes.
            if (!seen.has(tid)) {
                seen.add(tid);
                allTrackIDs.push(tid);
            }
        }
    }
    return allTrackIDs;
}

function setupEventListeners() {

    document.getElementById("save-btn").addEventListener("click", handleSave);
    document.getElementById("back-btn").addEventListener("click", () => {
        window.location.href = "..";//Redirect to dashboard/home page
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
