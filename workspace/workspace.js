import WorkspaceSession from "./session.js";

const session = new WorkspaceSession();
// Session state: primarily managed by WorkspaceSession. module-level vars set to live references inside session after load().
// Render functions read these directly, so pointing them at session's arrays keeps everything in sync without a second copy of the data.

// Main data structures for workspace. Set to reference session's live data after loading
let playlists = [];                // Sequential array of playlist objects, augmented with session-layer fields after loading.
let tracks = {};                   // Lookup object mapping trackID to track data.
let modifiedPlaylists = new Set(); // Set of 'dirty' playlist IDs to save.

// Display Variables
let currentSort = "default"; // Sort state for table rendering
let currentFilter = "";      // lowercased search query, modified by search input event listener. Empty string means no filter


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

    // Point module vars at session's live data structures. Should stay in sync as session manipulates them.
    playlists = session.playlists;
    tracks = session.tracks;
    modifiedPlaylists = session.modifiedPlaylists;

    // Render workspace, initialize controls. //FUTURE: When workspace is mostly complete, ensure order of ops makes sense.
    console.log("Setting up workspace for playlists:", playlists.map(p => p.name));
    renderWorkspaceTable();
    initSortControl();
    initSearchControl();
    setupEventListeners();
}

// Display an error message with a link back to the dashboard, used when session loading fails or no valid playlists are found.
function showSessionError(message) {
    const container = document.getElementById("workspace-container");
    //FUTURE extract this to html file and just inject message?
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
    titleTh.textContent = "TRACK";
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

//Render new table body. Called during init (-> renderWorkspaceTable) and on sort changes. 
// Clears existing body, then rebuilds rows based on current playlist data and sort order.
function renderTableBody(){
    //Wipe existing table body in case of re-render
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";


    // Section determines first-seen order, then applies sort, then filters.
    // TODO: Why not filter before sorting? seems like it would be more efficient to reduce number of items to sort. 

    // NOTE: Adhering to first-seen order means search results are deterministic for each option, rather than implictly reflecting prior sorts.
    // TODO: Store order somewhere so we don't have to recollect every time sort changes? Not a big deal at current scale.
    // FUTURE: enable stable sort chaining by feeding sort method the current sort order instead of re-collecting. "First-seen" could be a distinct sort option that would trump any prior sorts. Holding off for UX simplicity for now.
    const trackIDsInOrder = collectTrackIDsInOrder(playlists);
    const sorted      = sortTrackIDs(trackIDsInOrder, currentSort);
    const shownTrackIDs = filterTrackIDs(sorted, currentFilter);

    // If no tracks to show, display message indicating this.
    // FUTURE: could be more specific about "no tracks in this playlist" vs "no tracks match search query"
    // FUTURE: Extract styling for this display somewhere?
    if (shownTrackIDs.length === 0) {
        const emptyRow = document.createElement("tr");
        const emptyCell = document.createElement("td");
        emptyCell.colSpan = 2 + playlists.length; // index + track info + one per playlist
        emptyCell.style.textAlign = "center";
        emptyCell.style.color = "var(--color-text-muted)";
        emptyCell.style.padding = "24px";
        emptyCell.textContent = currentFilter
            ? `No tracks match "${currentFilter}"`
            : "No tracks to display";
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
    }

    //If shown tracks exist, iterate through trackIDs in order, creating rows with track info and checkboxes for playlist membership.
    for (let i = 0; i < shownTrackIDs.length; i++) {
        const trackID = shownTrackIDs[i];
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

// Main Sort Method: returns sorted array of trackIDs based on given criteria. 
// FUTURE: Missing fields currently sort to top, consider putting them at bottom for inessential metadata like BPM or genre info
// FUTURE: Make sort output more intuitive by stripping non A-Z characters and ignoring case. Similarly strip " the" from names?
function sortTrackIDs(trackIDs, criteria) {
    //Return as-is for default
    if (criteria === "default") return trackIDs;//Is default even the name we want? 'First-seen' is a bit technical but 'default' is vague

    //Return an array copy, using localeCompare to sort based on the specified field.
    const field = criteria;// Enforce that criteria matches one of [Title, Artist, Album]?
    return [...trackIDs].sort((a, b) => {
        const trackA = tracks[a];
        const trackB = tracks[b];
        const valA = trackA ? (trackA[field] || "") : "";
        const valB = trackB ? (trackB[field] || "") : "";
        return valA.localeCompare(valB);
    });
}
// Main Filter Method: Returns filtered array of trackIDs based on search query. 
// Checks if query (case insensitive) is included in title, artist, or album fields.
// Pure filter transform — returns a new filtered array, never mutates input.
// Query is lowercased on assignment (initSearchControl), not on each call.
function filterTrackIDs(trackIDs, query) {
    // If no query (empty or whitespace-only), return original array unfiltered.
    if (!query) return trackIDs;

    //Otherwise, return a new array of IDs where query is included in the title, artist, or album fields of the corresponding track.
    return trackIDs.filter(id => {
        const track = tracks[id];
        if (!track) return false;
        return (
            (track.title  || "").toLowerCase().includes(query) ||
            (track.artist || "").toLowerCase().includes(query) ||
            (track.album  || "").toLowerCase().includes(query)
        );
    });
}

// Build and inject the search input into #search-controls. Called once in init()
// FUTURE: Extract methods like this to a separate UI component?
function initSearchControl() {
    const container = document.getElementById("search-controls");

    // Search input with placeholder message
    const input = document.createElement("input");
    input.type = "search";
    input.id = "search-input";
    input.placeholder = "Search tracks...";

    // Debounce: wait 200ms to re-render after last update keystroke before re-rendering.
    // FUTURE: Consider performance impact for big libraries. Not a concern at current scale.
    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentFilter = input.value.trim().toLowerCase();
            // FUTURE: once pagination is added, probably need to reset to page 1 here, since filter could change total pages and current page might end up out of range. 
            renderTableBody(); //All we need for now
        }, 200);
    });

    container.appendChild(input);
}

// Build and inject the sort dropdown into #sort-controls. Called once in init()
// FUTURE: Extract methods like this to a separate UI component?
function initSortControl() {
    const container = document.getElementById("sort-controls");
    
    //Wrapper for label and sort dropdown, facilitates dropdown styling
    const wrapper = document.createElement("div");
    wrapper.className = "sort-select-wrapper";

    //Label for sort dropdown
    const label = document.createElement("label");
    label.textContent = "Sort by:";
    label.htmlFor = "sort-select";

    //Actual select element
    const select = document.createElement("select");
    select.id = "sort-select";

    // Define options for sorting, then create and append option elements to the select.
    //FUTURE: add fields dynamically based on available metadata in later versions?
    const options = [
        // { value: "default", label: "Default order" },
        { value: "default", label: "Default" },
        { value: "title",   label: "Title" },
        { value: "artist",  label: "Artist" },
        { value: "album",   label: "Album" },
    ];
    for (const opt of options) {
        const optionElement = document.createElement("option");
        optionElement.value = opt.value;
        optionElement.textContent = opt.label;
        select.appendChild(optionElement);
    }

    //On selector change, update currentSort and re-render table body.
    select.addEventListener("change", () => {
        currentSort = select.value;
        renderTableBody();
    });

    wrapper.appendChild(select);
    container.appendChild(label);
    container.appendChild(wrapper);
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

// Set up event listeners for checkboxes and buttons. Called once in init()
function setupEventListeners() {

    //Basic button listeners for save and back.
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
    
    //Make all checkbox cells clickable by toggling the checkbox when the cell is clicked, (unless the click is directly on the checkbox)
    //FUTURE consider using custom component or styling to make the entire cell function as a checkbox, rather than this workaround.
    document.getElementById("table-body").addEventListener("click", (e) => {
        const cell = e.target.closest(".checkbox-cell");
        if (cell && !e.target.matches("input[type='checkbox']")) {
            const checkbox = cell.querySelector("input[type='checkbox']");
            if (checkbox) {
                checkbox.click(); // Trigger the checkbox's click event, which will handle the toggle logic.
            }
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
