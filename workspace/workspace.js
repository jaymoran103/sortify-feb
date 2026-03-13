import WorkspaceSession from "./session.js";
import { promptModal, notifyModal } from "../shared/modal.js";

const session = new WorkspaceSession();
// Session state: primarily managed by WorkspaceSession. module-level vars set to live references inside session after load().
// Render functions read these directly, so pointing them at session's arrays keeps everything in sync without a second copy of the data.

// Main data structures for workspace. Set to reference session's live data after loading
let playlists = [];                // Sequential array of playlist objects, augmented with session-layer fields after loading.
let tracks = {};                   // Lookup object mapping trackID to track data.
let modifiedPlaylists = new Set(); // Set of 'dirty' playlist IDs to save.

// Display Variables: Filter + Sort
let currentFilter = "";         // lowercased search query, modified by search input event listener. Empty string means no filter
let currentSort = "default";    // Sort state for table rendering
let cachedTrackIDsOrder = null; // Array of trackIDs in first-seen order. Recomputed lazily when playlist membership changes.
let cachedFilteredIDs = null;   // Array of trackIDs reflecting given order and applied filter.

// Lazy load state.
const BATCH_SIZE = 100;  // Rows appended per scroll-triggered batch.
let loadedCount  = 0;    // Tracks number of rows currently in the DOM for the active displayList.
let displayList  = [];   // Full filtered+sorted ID list for current display state. Sliced by renderNextBatch().

// Dropdown state
let activeDropdown = null; // currently open dropdown panel, or null if none open.

// DOM refs set once during init, used across render calls
let filterCounterElement; // set by initFilterCounter(), 
let scrollObserver;       // set by initScrollObserver()

//Selection state: stored trackID(s) of currently selected row(s), and index of last clicked row for shift-click range selection.
let selectedTrackIDs = new Set();
let lastClickedTrackIndex = null;

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

    await showProgressBar(); //Show load bar. (hidden in catch, empty playlists case, and method end).

    try {
        await session.load(savedSession.playlistIds);
    } catch (err) {
        let message = "Failed to load playlists from IndexedDB:";
        console.error(message, err);
        hideProgressBar();
        showSessionError(message+" " + err.message);
        return;
    }

    if (session.playlists.length === 0) {
        hideProgressBar();
        showSessionError("No playlists were found for the selected IDs.");
        return;
    }

    // Point module vars at session's live data structures. Should stay in sync as session manipulates them.
    playlists = session.playlists;
    tracks = session.tracks;
    modifiedPlaylists = session.modifiedPlaylists;

    // Instantiate workspace controls
    console.log("Setting up workspace for playlists:", playlists.map(p => p.name));
    initScrollObserver(); // must be before first render so observer exists when sentinel enters view
    initSortControl();
    initSearchControl(); //FUTURE: Standardize these two names? I see search as the user control, filter as the operation.
    initFilterCounter();

    // Once display is mostly loaded, ensure controls paint before continuing.
    await yieldForPaint();//FUTURE: Consider showing some empty table element for visual consistency, populating once data is ready.

    //Continue workspace setup: event listeners, render workspace, and  hide progress bar.
    setupEventListeners();
    renderWorkspaceTable();
    hideProgressBar();
}

// On session error, display the session-error section with a given message, and hide other workspace elements.
function showSessionError(message) {

    //If no error message provided, warn in console.
    if (!message){
        console.error("showSessionError called without message.");
        message = "An unexpected error occurred.";
        alert("An unexpected error occurred, make sure error state comes with a message");//FUTURE: Just for development, dont want these to go unseen. //NOTE: Dont replace with modal, can't rely on any JS.
    }

    // Set error message and show session-error section.
    document.getElementById("session-error-message").textContent = message ;
    document.getElementById("session-error").hidden = false;
    document.getElementById("workspace-container").hidden = true;

    //Hide controls since they won't function without a valid session, and to avoid confusion in the error state. FUTURE: Consider hiding individual controls instead of the whole bar, or showing a different set of controls relevant to the error state (e.g. retry button if load failed).
    document.getElementById("save-controls").hidden = true;
    document.getElementById("control-bar").hidden = true;
    //FUTURE: Review final page layout, ensuring nothing dependent on valid session/data remains.
}

// Show and hide the progress bar during async loading operations.
async function showProgressBar() {
    document.getElementById("progress-bar").classList.add("progress-bar--loading");
    await yieldForPaint(); // Ensure the progress bar is visible before continuing with loading.
}

function hideProgressBar() {
    document.getElementById("progress-bar").classList.remove("progress-bar--loading");
}

// Returns promise that resolves on next paint, allowing UI updates to render before continuing with time-consuming operations.
async function yieldForPaint(){
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function renderWorkspaceTable() {
    renderTableHeader();
    renderTableBody();
}

//Render header for table structure. Columns for index, track info, and one for each playlist.
function renderTableHeader(){

    const thead = document.getElementById("table-header");
    thead.innerHTML = "";
    const row = document.createElement("tr");

    //Column for track indices
    const indexTh = document.createElement("th");
    indexTh.className = "track-table__index";
    indexTh.textContent = "#";
    row.appendChild(indexTh);

    //Column for track info (currently combined). might add toggleable columns later for more metadata
    const titleTh = document.createElement("th");
    titleTh.className = "track-table__info";
    titleTh.textContent = "TRACK";
    row.appendChild(titleTh);

    // One column per playlist, with name, track count, and dropdown button
    for (const playlist of playlists) {

        // Create header cell with dataset playlistID for reference in dropdown handlers
        const th = document.createElement("th");
        th.className = "track-table__checkbox";
        th.dataset.playlistID = playlist.playlistID;

        // Header structure: stack name + track count on the left, with triangle button to the right
        const headerInner = document.createElement("div");
        headerInner.className = "playlist-col__header";

        const textContainer = document.createElement("div");
        textContainer.className = "playlist-col__text";

        const nameSpan = document.createElement("span");
        nameSpan.className = "playlist-col__name";
        nameSpan.textContent = playlist.name;

        const countSpan = document.createElement("span");
        countSpan.className = "playlist-col__count";
        const trackCount = playlist.trackIDs.length;
        countSpan.textContent = `${trackCount} track${trackCount !== 1 ? "s" : ""}`;

        textContainer.appendChild(nameSpan);
        textContainer.appendChild(countSpan);

        const menuBtn = document.createElement("button");
        menuBtn.className = "dropdown__trigger";
        // menuBtn.textContent = "▾"; // text content replaced by CSS ::after to match sort dropdown styling

        //Listener for menu button: opens dropdown
        menuBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // prevent document click handler from immediately closing this dropdown

            // Use menuBtn coordinates to determine coordinates for dropdown.
            const rect = menuBtn.getBoundingClientRect();
            let dropdownX = rect.left;
            let dropdownY = rect.bottom;

            openDropdown("playlist", playlist.playlistID, dropdownX, dropdownY);
        });

        //Listener for right-click on header cell: also opens dropdown
        th.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const { clientX, clientY } = e;
            openDropdown("playlist", playlist.playlistID, clientX, clientY);
        });

        headerInner.appendChild(textContainer);
        headerInner.appendChild(menuBtn);
        th.appendChild(headerInner);
        row.appendChild(th);
    }

    //Append to header
    thead.appendChild(row);
}

// Renders body of workspace table. 
// Applies filter, then sort, to cachedTrackIDsOrder (recomputed when membership changes invalidate cache)
// NOTE: Always call resetLoadedRows() before this when sort or filter changes. 
function renderTableBody(){

    // Recompute displaylist, applying filter and sort. 
    // Caches first-seen order and filtered order, relying on callers to reset them when a playlist modification would invalidate the current order.
    const trackIDsInOrder = cachedTrackIDsOrder ??= collectTrackIDsInOrder(playlists); //get trackIDs, cache if not present
    const filteredIDs = cachedFilteredIDs ??= filterTrackIDs(trackIDsInOrder, currentFilter);
    const sortedIDs = sortTrackIDs(filteredIDs, currentSort);
    displayList = sortedIDs;

    // If no tracks to show, display message indicating this.
    if (displayList.length === 0) {
        renderEmptyTableBody(filteredIDs.length);
        return;
    }

    // Otherwise, update filter counter and render first batch of results. Scroll sentinel and observer trigger future batches.
    updateFilterCounter(displayList.length);
    renderNextBatch();
}

// Renders a single row with a message indicating that there are no tracks to display.
function renderEmptyTableBody(filteredCount){
    const tbody = document.getElementById("table-body");
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    
    emptyCell.colSpan = 2 + playlists.length; // index + track info + one per playlist
    emptyCell.className = "track-table__empty";

    //Message indicates whether empty state is due to filtering, or simply no tracks in the selected playlists.
    emptyCell.textContent = (filteredCount === 0)
        ? "No tracks in selected playlists"
        : `No tracks match "${currentFilter}"`;

    //Appent elements, update filter counter with 0 matches
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    updateFilterCounter(0);
}

// Clears rendered rows and resets lazy-load position. Call before renderTableBody() on sort/filter change.
function resetLoadedRows() {
    loadedCount = 0;
    displayList = [];
    document.getElementById("table-body").innerHTML = "";
}

// Appends the next BATCH_SIZE rows to the table body. Safe to call when all rows are already loaded.
function renderNextBatch() {
    // If all tracks are already loaded, do nothing.
    if (loadedCount >= displayList.length) return;

    // Otherwise, create rows for the next batch of tracks and append to the table body.
    const tbody = document.getElementById("table-body");
    const lastRow = Math.min(loadedCount + BATCH_SIZE, displayList.length);
    const fragment = document.createDocumentFragment(); // batch DOM writes into one append

    // For each row, create a track row and append to fragment.
    for (let i = loadedCount; i < lastRow; i++) {
        const trackID = displayList[i];
        const row = createTrackRow(trackID, i+1);
        fragment.appendChild(row);
    }

    tbody.appendChild(fragment); // single reflow for the whole batch
    loadedCount = lastRow;
}

// Helper method creates a display row for a given trackID.


function createTrackRow(trackID, displayIndex){
    const row = document.createElement("tr");

    // Store trackID on row for selection lookup and re-application.
    row.dataset.trackId = trackID;

    // Re-apply selected class if this row was previously selected, ensuring selection renders again
    if (isTrackSelected(trackID)) {
        row.classList.add("track-row--selected");
    }

    // Select row on click, but not when the user is toggling a checkbox cell.
    row.addEventListener("click", (e) => {
        if (e.target.closest(".track-table__checkbox")) return;
        handleTrackRowClick(trackID, row, row.sectionRowIndex, e);
    });

    // Open track dropdown on right-click.
    row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        //Determine coordinates 
        const { clientX, clientY } = e;

        // If the right-clicked row isn't already selected, select it and deselect any others.
        if (!isTrackSelected(trackID)) {
            clearSelection();
            selectTrack(trackID, row);
        }

        // Open dropdown anchored to click coordinates
        openDropdown("track",selectedTrackIDs,clientX,clientY);
    });

    //Index cell. Expects 1-based displayIndex, rather than actual position in displayList.
    const indexCell = document.createElement("td");
    indexCell.className = "track-table__index";
    indexCell.textContent = displayIndex;
    row.appendChild(indexCell);

    //Info cell
    const infoCell = createTrackInfoCell(trackID);
    infoCell.className = "track-table__info";
    row.appendChild(infoCell);

    //Create checkbox cells for each playlist, and append to row.
    const membershipCells = createCheckboxCells(trackID);
    membershipCells.forEach(cell => row.appendChild(cell));
    
    return row;
}

//Helper method creates track info cell with title, artist, and album.
// If info somehow isn't available, fields fall back to placeholders. This should be hard to encounter since importer currently rejects tracks missing basic metadata.
function createTrackInfoCell(trackID){
    const track = tracks[trackID];
    const cell = document.createElement("td");

    //Track title sits on top in its own div.
    const trackNameDiv = document.createElement("div");
    trackNameDiv.className = "track__name";
    trackNameDiv.textContent = track ? track.title : trackID;
    cell.appendChild(trackNameDiv);

    //Other metadata (artist and album) sits in separate div below, with a separator dot between. FUTURE: think about making these links to spotify IDs or something, opening in window or elsewhere. Since data currently comes through a third party, this would be a roundabout process to acquire for now.
    const trackMetaDiv = document.createElement("div");
    trackMetaDiv.className = "track__meta";

    const artistSpan = document.createElement("span");
    artistSpan.className = "track__artist";
    artistSpan.textContent = track ? track.artist : "Unknown Artist";
    trackMetaDiv.appendChild(artistSpan);

    const sepSpan = document.createElement("span");
    sepSpan.className = "track__sep";
    sepSpan.textContent = " • ";
    trackMetaDiv.appendChild(sepSpan);

    const albumSpan = document.createElement("span");
    albumSpan.className = "track__album";
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
        checkCell.className = "track-table__checkbox";
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
// NOTE: Missing fields currently sort to top, consider putting them at bottom for inessential metadata like BPM or genre info
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
            cachedFilteredIDs = null; // filter changed. is this needed
            resetLoadedRows();
            renderTableBody();
        }, 200);
    });

    container.appendChild(input);
}

// Build and inject the sort dropdown into #sort-controls. Called once in init()
function initSortControl() {
    const container = document.getElementById("sort-controls");
    
    //Wrapper for label and sort dropdown, facilitates dropdown styling
    const wrapper = document.createElement("div");
    wrapper.className = "control-bar__sort-wrapper";

    //Label for sort dropdown
    const label = document.createElement("label");
    label.textContent = "Sort by:";
    label.htmlFor = "sort-select";

    //Actual select element
    const select = document.createElement("select");
    select.id = "sort-select";

    // Define options for sorting, then create and append option elements to the select.
    const options = [
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

    //On selector change, reset rows and re-render from the top.
    select.addEventListener("change", () => {
        currentSort = select.value;
        resetLoadedRows();
        renderTableBody();
    });

    wrapper.appendChild(select);
    container.appendChild(label);
    container.appendChild(wrapper);
}

// Creates IntersectionObserver on #scroll-sentinel to trigger renderNextBatch() as user scrolls.
function initScrollObserver() {
    const container = document.getElementById("workspace-container"); // root must be #workspace-container, which has the scrollbar, for the observer to work correctly.
    const sentinel  = document.getElementById("scroll-sentinel");
    scrollObserver = new IntersectionObserver(
        (entries) => {if (entries[0].isIntersecting) {renderNextBatch();}}, //Callback: render next batch when sentinel enters view
        {root: container, threshold: 0}                                     //Options: observe intersection w/ container, trigger as soon as any part becomes visible in container.
    );
    scrollObserver.observe(sentinel);
}

// Stores reference to filter counter element. Counter is shown by updateFilterCounter() only when a filter is active.
function initFilterCounter() {
    filterCounterElement = document.getElementById("filter-counter");
}

// Shows number of matches only when filter is active with results. Called in renderTableBody() to ensure accurate count.
function updateFilterCounter(matchCount) {
    if (!filterCounterElement) {
        console.error("Filter counter element not found.");
    };
    // If no active filter, or no matches, hide counter. 
    // Since renderEmptyTableBody() shows a message for zero matches, no responsibility to indicate this here.
    if (!currentFilter || matchCount === 0) {
        filterCounterElement.textContent = "";
        filterCounterElement.classList.remove("filter-counter--active");
        return;
    }
    // Otherwise, show match count with correct pluralization, and add active class for styling
    filterCounterElement.textContent = `${matchCount} match${matchCount !== 1 ? "es" : ""}`;
    filterCounterElement.classList.add("filter-counter--active");
}

// Helper method collects and returns an array of all unique track IDs across playlists in first-seen order, used for rendering rows.
// NOTE: Duplicates are reduced to the first occurence, not a concern as displaying multiple would look messy and open the door to some wack uses.
function collectTrackIDsInOrder(playlists){
    const seen = new Set();
    const allTrackIDs = [];

    //Hack to disable playlist-determined order for the default sort, which makes the UI jumpy when playlist membership changes. Should probably only change when sort/filter is selected. FUTURE: revise caching/ordering flow to access some master list of tracks, updated only when the tracks set itself changes?
    const PLAYLISTS_DETERMINE_ORDER = false; 
    if (PLAYLISTS_DETERMINE_ORDER){
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
    }

    // Iterate through all tracks, adding any not included in playlists. Skipping the block above ensures a more consistent 'default' sort, since objects have a consistent iteration order for keys.
    // for (const tid of Object.keys(tracks)) {
    for (const tid in tracks) {
        if (!seen.has(tid)) {
            seen.add(tid);
            allTrackIDs.push(tid);
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

    // Playlist management buttons
    // FUTURE - Separate section with more controls: reorder, duplicate, create, delete,import/export. Plus shortcut button here for most common, create empty
    document.getElementById("add-playlist-btn").addEventListener("click", handleAddPlaylist);
    document.getElementById("new-playlist-btn").addEventListener("click", handleCreateEmptyPlaylist);

    // For any checkbox change in the table body, handle toggle with reference to the event target
    document.getElementById("table-body").addEventListener("change", (e) => {
        if (e.target.type === "checkbox") {
            handleCheckboxToggle(e.target);
        }
    });

    // Prevent shift+click from triggering browser text selection (must intercept mousedown, not click)
    document.getElementById("table-body").addEventListener("mousedown", (e) => {
        if (e.shiftKey) e.preventDefault();
    });
    
    //Make all checkbox cells clickable by toggling the checkbox when the cell is clicked, (unless the click is directly on the checkbox)
    //FUTURE consider using custom component or styling to make the entire cell function as a checkbox, rather than this workaround.
    document.getElementById("table-body").addEventListener("click", (e) => {
        const cell = e.target.closest(".track-table__checkbox");
        if (cell && !e.target.matches("input[type='checkbox']")) {
            const checkbox = cell.querySelector("input[type='checkbox']");
            if (checkbox) {
                checkbox.click(); // Trigger the checkbox's click event, which will handle the toggle logic.
            }
        }
    });

    // Close dropdown on outside click. 
    document.addEventListener("click", () => closeDropdown());

    // Keyboard shortcuts: Escape closes dropdown; Cmd+A / Ctrl+A selects all tracks
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDropdown();
            clearSelection();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "a") {
            e.preventDefault(); // prevent browser "select all text"
            handleCmdA();
        }
    });
}

// Handler for checkbox click event. State manipulation now happns in session counterpart.
function handleCheckboxToggle(checkbox) {
    console.log(`Checkbox toggled: trackID=${checkbox.dataset.trackID} playlistID=${checkbox.dataset.playlistID} checked=${checkbox.checked}`);
    const trackID = checkbox.dataset.trackID;
    const playlistID = checkbox.dataset.playlistID;
    session.toggleTrack(playlistID, trackID);
    wipeCaches(); // membership changed, re-collect order and filteredIDs on next render. //FUTURE - does a targeted update to cachedTrackIDsOrder and cachedFilteredIDs make sense here, or is it fine to just reset and re-collect on next render?
    updateSaveStatus();
}

// Update the save status message based on whether there are unsaved changes based on status of changes
function updateSaveStatus() {
    const saveStatus = document.getElementById("save-status");
    const saveBtn = document.getElementById("save-btn");
    const totalChanges = modifiedPlaylists.size + session.pendingPlaylists.length;

    if (totalChanges > 0) {
        saveBtn.disabled = false;
        saveStatus.textContent = `${totalChanges} playlist(s) modified`;
    } else {
        saveBtn.disabled = true;
        saveStatus.textContent = "";
    }
}
//Handler for save button: persists modified playlists to IndexedDB via session.save(), adds timestamp for confirmation
async function handleSave() {
    const saveBtn = document.getElementById("save-btn");
    const saveStatus = document.getElementById("save-status");
    const hadPending = session.pendingPlaylists.length > 0;

    saveBtn.disabled = true;
    saveStatus.textContent = "Saving...";
    console.log("handleSave: Saving... (", modifiedPlaylists.size, "modified,", session.pendingPlaylists.length, "pending)");

    try {
        await session.save();

        // Pending playlists now have real IDB IDs — rebuild DOM so dataset attributes reflect them
        if (hadPending) renderWorkspaceTable();

        const savedTime = new Date().toLocaleTimeString();
        saveStatus.textContent = `Saved at ${savedTime}`;
        console.log(`[workspace] Save successful at ${savedTime}`);

        setTimeout(() => {
            if (modifiedPlaylists.size === 0) {
                saveStatus.textContent = `Last saved: ${savedTime}`;
            }
        }, 2000);

    } catch (err) {
        console.error("[workspace] Save failed:", err);
        saveStatus.textContent = "Save failed — see console";
        saveBtn.disabled = false;
    }
}

/** ===============
 *  DROPDOWN LOGIC
 *  ===============
 * FUTURE: Extract to separate module
 */

// Close any open dropdown by removing from DOM. Skips if no dropdown is open 
function closeDropdown() {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
}

// Build and open a dropdown for the given playlistID, anchored to a given button element.
// NOTE: Be careful with use of id in future refactors, can mean multiple things based on mode/usage
function openDropdown(mode=null,id,x,y) {

    // Close existing dropdown if open, then build new dropdown panel for the given playlistID.
    closeDropdown();

    //If opening a track dropdown and multiple tracks are selected, set mode to track-multi to trigger different dropdown options. 

    // If opening a track dropdown, ensure at least one track is selected.
    // If multiple are selected, set mode accordingly.
    // contextmenu listener for track rows ensures a selection if a dropdown opens for an unselected track.
    if (mode=="track"){
        if (selectedTrackIDs.size==0){
            console.warn("Attempted to open track dropdown with no selected tracks. Aborting.");
            return;
        }
        else if (selectedTrackIDs.size > 1){
            mode = "track-multi";
        }
    }

    let panel = buildDropdownPanel(id, mode);

    //Exit if invalid mode given
    if (!panel) {
        console.error("Invalid dropdown mode or issue building dropdown:", mode);
        return;
    }

    //NOTE: Previously determined dropdown coordinates from given anchorElement, now receives specific coodinates from caller

    // Append hidden first so getBoundingClientRect() returns real dimensions, then clamp to viewport.
    panel.style.cssText = "visibility:hidden;left:0;top:0";
    document.body.appendChild(panel);
    const { width, height } = panel.getBoundingClientRect();
    x = Math.min(x, window.innerWidth  - width  - 10);
    y = Math.min(y, window.innerHeight - height - 10);
    panel.style.cssText = `left:${x}px;top:${y}px`;

    activeDropdown = panel;
}


// Build and return a dropdown panel for the given playlistID
// NOTE: be careful handling ids, especially after multi-track case is implemented.
// FUTURE: Probably refactoring mode approach once UI logic is more fleshed out and separated.
function buildDropdownPanel(id,mode) {

    //Create div element for dropdown panel, which will be positioned and populated with items based on the given playlistID and mode.
    const panel = document.createElement("div");
    panel.className = "dropdown";

    //Determine dropdown items based on mode and ID. Rest of the logic should be consistent
    let items = null;
    switch (mode){
        case "playlist":
            const playlistID = id;
            items = [
                { label: "Select all Tracks",            action: () => handleBulkMembershipUpdate(playlistID, true) },
                { label: "Deselect all Tracks",          action: () => handleBulkMembershipUpdate(playlistID, false) },
                { divider: true },
                { label: "Rename Playlist",                action: () => handleRenamePlaylist(playlistID) },
                { label: "Duplicate Playlist",             action: () => handleDuplicatePlaylist(playlistID) },
                { divider: true },
                { label: "Remove from workspace", action: () => handleRemovePlaylist(playlistID) },//Use same wording as 
            ];
            break;
        case "track":
            //NOTE: most track actions currently don't expect an id, since handlers reference selectedTrackIDs directly. 
            items = [
                { label: "Add to all Playlists",            action: () => handleAddTrackToAll()}, 
                { label: "Remove from all Playlists",       action: () => handleRemoveTrackFromAll()}, 
                { divider: true },
                { label: "Delete Track from workspace", action: () => handleDeleteTrack()}, 
                { divider: true },
                //These two rely on "track" mode only opening when one track is selected (Caller openDropdown updates it to track-multi if multiple tracks are selected)
                //Fine as long as all tracks are from the same source, not especially important or useful going forward
                { label: "Open in Spotify",       action: () => handleOpenInSpotify([...selectedTrackIDs][0])}, 
                { label: "Copy Track ID",         action: () => handleCopyTrackID([...selectedTrackIDs][0])},
            ];
            break;
        case "track-multi":
            //NOTE: most track actions currently don't expect an id, since handlers reference selectedTrackIDs directly. 
            items = [
                { label: `Add ${selectedTrackIDs.size} tracks to all Playlists`,            action: () => handleAddTrackToAll()}, 
                { label: `Remove ${selectedTrackIDs.size} tracks from all Playlists`,       action: () =>  handleRemoveTrackFromAll()}, 
                { divider: true },
                { label: `Delete ${selectedTrackIDs.size} tracks from workspace`, action: () => handleDeleteTrack()},
            ];
            break;
        default:
            console.error("Invalid dropdown mode:", mode);
            return null;
    }

    // Prevent outside click listener from immediately closing this panel
    panel.addEventListener("click", (e) => e.stopPropagation());

    const ul = document.createElement("ul");

    // For each item, create an li element. If it's a divider, add the divider class. Otherwise, set text and click handler to trigger the corresponding action and close the dropdown.
    for (const item of items) {
        const li = document.createElement("li");
        if (item.divider) {
            li.className = "dropdown__divider";
        } else {
            li.textContent = item.label;
            li.addEventListener("click", () => {
                closeDropdown();
                item.action();
            });
        }
        ul.appendChild(li);
    }

    panel.appendChild(ul);
    return panel;
}

/** ===============
 *  ACTION HANDLERS
 *  ===============
 * FUTURE: Extract to separate module?
 */

// Handler for select/deselect all - updates membership of each shown track in a playlist to match desired state.
// Operates on the full filtered set of trackIDs, not just the currently rendered page. 
// FUTURE: consider additional option to select all, filtered or not
function handleBulkMembershipUpdate(playlistID, desiredState) {

    // Access or recompute cached track ID order and filtered IDs, which determine which tracks are shown and should be toggled.
    cachedTrackIDsOrder ??= collectTrackIDsInOrder(playlists);
    cachedFilteredIDs ??= filterTrackIDs(cachedTrackIDsOrder, currentFilter);

    const playlist = playlists.find(p => p.playlistID === playlistID);

    // Toggle track status if it doesn't match desired state
    for (const id of cachedFilteredIDs) {
        const currentState = playlist.trackIDSet.has(id);
        // (A && !B) || (!A && B) equivalent to (A!=B)
        if (currentState !== desiredState) { 
            session.toggleTrack(playlistID, id);
        }
    }
    //FUTURE: Move reset and save update to renderWorkspaceTable?
    resetLoadedRows();
    renderWorkspaceTable();
    updateSaveStatus();
}

// Handler for renaming a playlist. Opens a modal to get new name, validates inline, then updates session and re-renders.
async function handleRenamePlaylist(playlistID) {
    const playlist = playlists.find(p => p.playlistID === playlistID);
    if (!playlist) return;

    const newName = await promptModal({
        title: "Rename Playlist",
        confirmLabel: "Rename",
        defaultValue: playlist.name,
        //TODO extract to separate method? Simpler here until parameters are more consistent. Strategy pattern with validation functions for each case?        // validate:[notEmpty,noSpecialChars,unique,nameChanged(defaultValue)]
        validate: (value) => {
            if (!value) return "Name cannot be empty.";
            if (value === playlist.name) return "Name is unchanged.";
            return null;
        }
    });
    if (!newName) return;

    session.renamePlaylist(playlistID, newName);
    renderWorkspaceTable();
    updateSaveStatus();
}

// Handler for removing a playlist from the workspace.
function handleRemovePlaylist(playlistID) {
    session.removePlaylist(playlistID);
    resetLoadedRows();
    renderWorkspaceTable();
    updateSaveStatus();
}

//Handler for duplicating a playlist within the workspace. 
function handleDuplicatePlaylist(playlistID) {
    session.duplicatePlaylist(playlistID);  
    resetLoadedRows();
    renderWorkspaceTable();
    updateSaveStatus();
}

// Add all selected track(s) to every playlist that doesn't already contain it/them.
function handleAddTrackToAll() {

    for (const trackID of selectedTrackIDs) {
        for (const playlist of playlists) {
            if (!playlist.trackIDSet.has(trackID)) {
                session.toggleTrack(playlist.playlistID, trackID);
            }
        }
    }
    
    wipeCaches();//TODO need this here?
    resetLoadedRows();
    renderTableBody();
    updateSaveStatus();
}



// Remove all selected tracks from every playlist that contains them.
function handleRemoveTrackFromAll() {
    for (const trackID of selectedTrackIDs) {
        for (const playlist of playlists) {
            if (playlist.trackIDSet.has(trackID)) {
                session.toggleTrack(playlist.playlistID, trackID);
            }
        }
    }
    wipeCaches();
    resetLoadedRows();
    renderTableBody();
    updateSaveStatus();
}


// Remove all selected tracks from all playlists and their rows from the table.
function handleDeleteTrack() {
    for (const trackID of selectedTrackIDs) {
        session.removeTrackFromWorkspace(trackID);
    }
    wipeCaches();
    resetLoadedRows();
    renderWorkspaceTable();
    updateSaveStatus();
}


// Handler for opening a track in Spotify. Validates track ID format before attempting to open.
function handleOpenInSpotify(trackID) {
    console.log(trackID);
    if (trackID.startsWith("spotify:track:")) {
        // NOTE: Very dependent on my client settings, not a permanent feature or solution
        window.location.href = trackID; //Open directly in window, links right to app 
        // window.open(`https://open.spotify.com/track/${trackID.split(":").pop()}`, "_blank");
        // window.open(trackID);
        return;
    }
    notifyModal({
        title: "Cannot Open in Spotify",
        message: "Track ID does not appear to be a Spotify track URI.",
        confirmLabel: "OK"
    });
}

function handleCopyTrackID(trackID) {
    navigator.clipboard.writeText(trackID).then(() => {
        console.log(`Track ID ${trackID} copied to clipboard.`);
    }).catch(err => {
        console.error("Failed to copy track ID:", err);
    });
}


// Route row click to appropriate selection behavior based on modifier keys.
function handleTrackRowClick(trackID, rowEl, index, event) {
    if (event.shiftKey) {
        handleShiftClick(index, trackID, rowEl);
    } else if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: toggle this track individually
        if (isTrackSelected(trackID)) {
            deselectTrack(trackID, rowEl);
        } else {
            selectTrack(trackID, rowEl);
        }
        lastClickedTrackIndex = index;
    } else {
        // Plain click: exclusive select — clear all others first
        for (const id of selectedTrackIDs) {
            const row = document.querySelector(`tr[data-track-id="${id}"]`);
            if (row) row.classList.remove("track-row--selected");
        }
        clearSelection();
        selectTrack(trackID, rowEl);
        lastClickedTrackIndex = index;
    }
}

// Handler for adding an existing playlist to the workspace by ID. Opens a modal for input with inline validation, then loads and re-renders.
// FUTURE: Replace with a playlist selector modal showing a scrollable list of available playlists with checkboxes. Use same logic as dashboard playlist selector. Validate by comparing to existing playlists in workspace?
async function handleAddPlaylist() {
    const input = await promptModal({
        title: "Add Playlist",
        confirmLabel: "Add",
        placeholder: "Playlist ID (number)",
        validate: (value) => {
            const id = Number(value);
            return (Number.isInteger(id) && id > 0) ? null : "Enter a valid numeric playlist ID.";
        }
    });
    if (!input) return;

    const selectedPlaylist = await session.addPlaylist(Number(input));//Enforce numeric type here. Non permanent approach
    if (!selectedPlaylist) {
        await notifyModal({
            title: "Not Found",
            message: "Playlist not found or already in workspace.",
            confirmLabel: "OK"
        });
        return;
    }

    resetLoadedRows();
    renderWorkspaceTable();
    updateSaveStatus();
}

// Handler for creating a new empty playlist. Opens a modal to get the name, validates inline, then creates and re-renders.
async function handleCreateEmptyPlaylist() {
    const name = await promptModal({
        title: "New Playlist",
        confirmLabel: "Create",
        placeholder: "Playlist name",
        validate: (value) => value ? null : "Name cannot be empty."
    });
    if (!name) return;

    session.createEmptyPlaylist(name);
    resetLoadedRows();
    renderWorkspaceTable();
    updateSaveStatus();
}

// Wipes order and filter caches, causing them to be recomputed on next access. Currently only used in handleCheckboxToggle, keeping for now for clarity
function wipeCaches() {
    cachedTrackIDsOrder = null;
    cachedFilteredIDs = null;
}




// Clears all selected rows: strips .selected from the DOM, clears the Set, resets anchor index.
function clearSelection() {
    for (const id of selectedTrackIDs) {
        const row = document.querySelector(`tr[data-track-id="${id}"]`);
        if (row) row.classList.remove("track-row--selected");
    }
    selectedTrackIDs.clear();
    lastClickedTrackIndex = null;
}

// Add a track to the selection and mark its row.
function selectTrack(trackID, rowEl) {
    selectedTrackIDs.add(trackID);
    if (rowEl) rowEl.classList.add("track-row--selected");
}

// Remove a track from the selection and unmark its row.
function deselectTrack(trackID, rowEl) {
    selectedTrackIDs.delete(trackID);
    if (rowEl) rowEl.classList.remove("track-row--selected");
}

// Check if a track is currently selected. Returns a boolean.
function isTrackSelected(trackID) { 
    return selectedTrackIDs.has(trackID);
}


// Select/deselect a contiguous range from lastClickedTrackIndex to currentIndex.
// Range follows anchor row's state: selects if anchor is selected, deselects if not.
function handleShiftClick(currentIndex, currentTrackID, rowEl) {
    if (lastClickedTrackIndex === null) {
        // No anchor yet — fall back to plain single select
        clearSelection();
        selectTrack(currentTrackID, rowEl);
        lastClickedTrackIndex = currentIndex;
        return;
    }
    const tbody = document.getElementById("table-body");
    const anchorRow = tbody.rows[lastClickedTrackIndex];
    const anchorSelected = anchorRow ? isTrackSelected(anchorRow.dataset.trackId) : false;
    const lo = Math.min(lastClickedTrackIndex, currentIndex);
    const hi = Math.max(lastClickedTrackIndex, currentIndex);
    for (let i = lo; i <= hi; i++) {
        const row = tbody.rows[i];
        if (!row || !row.dataset.trackId) continue;
        if (anchorSelected) {
            selectTrack(row.dataset.trackId, row);
        } else {
            deselectTrack(row.dataset.trackId, row);
        }
    }
    // Shift+click doesn't move the anchor — lastClickedTrackIndex stays put
}


// Select all tracks in the current filtered+sorted set, across all pages.
function handleCmdA() {

    //Determine filtered id set by accessing caches or recomputing.
    const filteredIDs = cachedFilteredIDs ??= filterTrackIDs(       
        cachedTrackIDsOrder ??= collectTrackIDsInOrder(playlists),
        currentFilter
    );

    // Add all filtered IDs to the selection set
    for (const id of filteredIDs) {
        selectedTrackIDs.add(id);
    }

    // Add .selected class to all rows in the current filtered set. 
    const tbody = document.getElementById("table-body");
    for (const row of tbody.querySelectorAll("tr[data-track-id]")) {
        row.classList.add("track-row--selected");
    }
}


init();



