import WorkspaceSession from "./session.js";
import { promptModal, notifyModal, playlistSelectModal, trackSelectModal, warningModal, menuModal } from "../shared/modal.js";
import { filterTrackIDs, sortTrackIDs } from "../shared/trackUtils.js";
import { dropdownMenu } from "../shared/dropdown.js";

// MODULE OVERVIEW
// workspace.js  — View layer. Renders the track table, handles user input, coordinates display state.
// session.js — Data layer. Owns playlist/track data, load/save from IndexedDB, and all in-memory mutations.
//
// Relationship:
//   - workspace.js creates a single WorkspaceSession instance and calls session.load() during init().
//   - After loading, workspace.js holds live references to session data, available for rendering without needing to sync or copy.
//   - workspace.js never mutates session data directly, all data mutations go through session methods.
//   - workspace.js calls refreshWorkspace() or narrower render helpers after session mutations to reflect changes in the DOM.

const session = new WorkspaceSession();

// Session Data: Live references to data structures owned and manipulated by session.js. Only updated via session methods, should always reflect the current state of the session.
let playlists = [];                // Sequential array of playlist objects, augmented with session-layer fields after loading.
let tracks = {};                   // Lookup object mapping trackID to track data.
let modifiedPlaylists = new Set(); // Set of 'dirty' playlist IDs to save.

// Display tate fields: Represent the current UI state for sorting and filtering.
let currentFilter = "";         // lowercased search query, modified by search input event listener. Empty string means no filter
let currentSort = "order-added"; // Sort state for table rendering. "order-added" uses stableOrder directly; other values compute a sort.
let stableOrder = [];           // Array of all trackIDs in first-seen order, used as the unchanging base for all display ordering. Set once at load, updated only when tracks are added/removed from the workspace, or playlist display order changes.
let cachedFilteredIDs = null;   // Array representing a filtered subset of stableOrder for the current filter. Reset when filter changes or track set changes.

// Column width: stored to apply consistent widths across renders, and allow user resizing.
const TRACK_INDEX_WIDTH = 75;
const TRACK_INFO_DEFAULT = 220;
const TRACK_INFO_MIN = 140;
const TRACK_INFO_MAX = 440;
const PLAYLIST_COLUMN_MIN = 50;
const PLAYLIST_COLUMN_MAX = 500;

let playlistColumnMode = "auto"; // "auto" determines width based on container and playlist count; "manual" uses playlistColumnWidth
let playlistColumnWidth = 50;  // px — applied as CSS variable on the table element, consumed by .track-table__checkbox

// Selection state: stored trackID(s) of currently selected row(s), and index of last clicked row for shift-click range selection.
let selectedTrackIDs = new Set();
let lastClickedTrackIndex = null;

// DOM refs set once during init, used across render calls
let filterCounterElement; // set by initControlCounters(), 
let selectionCounterElement; // set by initControlCounters()
let scrollObserver;  // set by initScrollObserver()

// Lazy load state
const BATCH_SIZE = 100;  // Rows appended per scroll-triggered batch.
let loadedCount  = 0;    // Tracks number of rows currently in the DOM for the active displayList.
let displayList  = [];   // Full filtered+sorted ID list for current display state. Sliced by renderNextBatch().


/** ==================
 *  INITIALIZATION
 *  ==================
 */

// Main initialization method: loads session data, sets up workspace state, and renders the table. Called once on page load.
async function init() {

    // Read session created by the dashboard before navigating here
    let savedSession;
    try {
        savedSession = JSON.parse(sessionStorage.getItem("workspaceSession"));
    } catch (e) {
        console.error("Failed to parse workspaceSession from sessionStorage:", e);
    }

    // If no session found, or session doesn't contain playlist IDs, show error message and return early to avoid trying to load an invalid session.
    if (!savedSession || !savedSession.playlistIds) {
        let message = "No workspace session found. Please select playlists from the dashboard.";
        console.warn(message);
        showSessionError(message);
        return;
    }

    console.log(`Restoring session (created ${savedSession.timestamp}).`,"Playlist IDs:", savedSession.playlistIds);

    await showProgressBar(); //Show load bar. (hidden in catch, empty playlists case, and method end).

    // Try to load session data from IndexedDB using the playlist IDs from sessionStorage.
    try {
        await session.load(savedSession.playlistIds);
    } catch (err) {
        let message = "Failed to load playlists from IndexedDB:";
        console.error(message, err);
        hideProgressBar();
        showSessionError(message+" " + err.message);
        return;
    }

    // If no playlists were loaded, show error page rather than rendering an empty workspace.
    if (session.playlists.length === 0) {
        hideProgressBar();
        showSessionError("No playlists were found for the selected IDs.");
        return;
    }

    // Point module vars at session's live data structures. Should stay in sync as session manipulates them.
    playlists = session.playlists;
    tracks = session.tracks;
    modifiedPlaylists = session.modifiedPlaylists;

    // Build stable arrival-order array from loaded playlist data. Used as the unchanging base for all display ordering.
    stableOrder = collectTrackIDsInOrder(playlists);

    // Instantiate workspace controls
    console.log("Setting up workspace for playlists:", playlists.map(p => p.name));
    initScrollObserver(); // must be before first render so observer exists when sentinel enters view
    initSortControl(); 
    initSearchControl();
    initControlCounters();

    // Once display is mostly loaded, ensure controls paint before continuing.
    await yieldForPaint();

    //Continue workspace setup: event listeners, render workspace, and  hide progress bar.
    setupEventListeners();

    // refreshWorkspace(); // Could call instead of both render methods, but don't need the full refresh here.
    renderTableHeader();
    renderTableBody();

    hideProgressBar();
}

// On session error, display the session-error section with a given message, and hide other workspace elements.
// Navigation links to dashboard are set in workspace.html, so user can backtrack without relying on javascript or anything here.
function showSessionError(message) {

    //If no error message provided, warn in console.
    if (!message){
        console.error("showSessionError called without message.");
        message = "An unexpected error occurred.";
    }

    // Set error message and show session-error section.
    document.getElementById("session-error-message").textContent = message ;
    document.getElementById("session-error").hidden = false;
    document.getElementById("workspace-container").hidden = true;
    document.getElementById("save-controls").hidden = true;
    document.getElementById("control-bar").hidden = true;
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

// Set up event listeners for checkboxes and buttons. Called once in init()
function setupEventListeners() {

    //Basic button listeners for save and back.
    document.getElementById("save-btn").addEventListener("click", handleSave);
    const backBtn = document.getElementById("back-btn");
    backBtn.onclick = null; // clear the existing onclick listener, ensuring use of this button after the page renders will use the proper handleBackButton() method, subject to checks and save warnings before returning to the dashboard.
    backBtn.addEventListener("click", handleBackButton);
    
    // Playlist management button (single entrypoint)
    document.getElementById("add-workspace-btn").addEventListener("click", handleAddToWorkspace);

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
    document.getElementById("table-body").addEventListener("click", (e) => {
        const cell = e.target.closest(".track-table__checkbox");
        if (cell && !e.target.matches("input[type='checkbox']")) {
            const checkbox = cell.querySelector("input[type='checkbox']");
            if (checkbox) {
                checkbox.click(); // Trigger the checkbox's click event, which will handle the toggle logic.
            }
        }
    });

    // Keyboard shortcuts: Escape closes dropdown; Cmd+A / Ctrl+A selects all tracks
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            dropdownMenu.close();
            clearSelection();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "a") {
            e.preventDefault(); // prevent browser "select all text"
            handleCmdA();
        }
    });

    // Responsive playlist column width: adjust on resize in auto mode.
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (playlistColumnMode === "auto") {
                applyPlaylistColumnWidth();
            }
        }, 100);
    });
}

/** ==================
 *  RENDERING
 *  ==================
 */

// Full workspace refresh: invalidates filter cache, clears rendered rows, rebuilds table, updates save status.
// Use for any structural change (track set modified, playlist added/removed, playlist duplicated).
function refreshWorkspace(){
    cachedFilteredIDs = null;
    resetLoadedRows();
    renderTableHeader();
    renderTableBody();
    updateSaveStatus();
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

            const items = buildDropdownItems("playlist", playlist.playlistID);
            if (items) dropdownMenu.open(items, dropdownX, dropdownY);
        });

        //Listener for right-click on header cell: also opens dropdown
        th.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const { clientX, clientY } = e;
            const items = buildDropdownItems("playlist", playlist.playlistID);
            if (items) dropdownMenu.open(items, clientX, clientY);
        });

        headerInner.appendChild(textContainer);
        headerInner.appendChild(menuBtn);
        th.appendChild(headerInner);
        row.appendChild(th);
    }

    //Append to header
    thead.appendChild(row);

    // Apply current column width (th cells are recreated each render, so var must be re-set)
    applyPlaylistColumnWidth();
}

// Renders body of workspace table.
// Applies filter cached, then sort, to stableOrder. 
// NOTE: Always call resetLoadedRows() before this when sort or filter changes.
function renderTableBody(){

    // Access or recompute cachedFilteredIDs by applying the given filter to stableOrder, then sort. stableOrder is only recomputed when the session's track set changes.
    const filteredIDs = cachedFilteredIDs ??= filterTrackIDs(stableOrder, currentFilter, tracks);
    const sortedIDs = sortTrackIDs(filteredIDs, currentSort, tracks, playlists, stableOrder);
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

// Clears rendered rows and resets lazy-load position.
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
        const items = buildDropdownItems("track", selectedTrackIDs);
        if (items) dropdownMenu.open(items, clientX, clientY);
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

    //Artist and album sit in separate div below, with a separator dot between.
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
    
        //Create cell and checkbox. 
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

/** ==================
 *  SORT + FILTER
 *  ==================
 */

// Helper method collects unique track IDs across playlists in first-seen order, followed by any orphaned tracks in the tracks store.
// Only called once - at load to establish stableOrder, and by handleAddPlaylist to detect novel IDs.
// This ensures that the intial order is the authorative source of original order for sorting and display. Only modified on add/remove track operations, shouldnt care about not on membership changes here since they have no bearing on the actual set of shown tracks, which shouldn't jump around when modified. 
function collectTrackIDsInOrder(playlists){
    const seen = new Set();
    const allTrackIDs = [];

    // First pass: playlist order determines initial arrival sequence.
    for (const playlist of playlists) {
        for (const tid of playlist.trackIDs) {
            if (!seen.has(tid)) {
                seen.add(tid);
                allTrackIDs.push(tid);
            }
        }
    }

    // Defensive pass: append any tracks in the store not referenced by any playlist. (shouldn't normally occur).
    for (const tid in tracks) {
        if (!seen.has(tid)) {
            console.warn(`Track ID ${tid} found in track store but not referenced by any playlist. Adding to stable order.`);
            seen.add(tid);
            allTrackIDs.push(tid);
        }
    }
    return allTrackIDs;
}



/** ==================
 *  CONTROLS
 *  ==================
 */

// Build and inject the search input into #search-controls. Called once in init()
function initSearchControl() {
    const container = document.getElementById("search-controls");

    // Search input with placeholder message
    const input = document.createElement("input");
    input.type = "search";
    input.id = "search-input";
    input.placeholder = "Search tracks...";

    // Debounce: wait 200ms to re-render after last update keystroke before re-rendering.
    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentFilter = input.value.trim().toLowerCase();
            cachedFilteredIDs = null; // query changed — cached result is now stale
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
    wrapper.className = "sort-select-wrapper";

    //Label for sort dropdown
    const label = document.createElement("label");
    label.textContent = "Sort by:";
    label.htmlFor = "sort-select";

    //Actual select element
    const select = document.createElement("select");
    select.id = "sort-select";
    select.className = "sort-select";

    // Define options for sorting, then create and append option elements to the select.
    const options = [
        { value: "order-added",    label: "Order Added" },
        { value: "title",          label: "Title" },
        { value: "artist",         label: "Artist" },
        { value: "album",          label: "Album" },
        { value: "most-playlists", label: "Most Playlists" },
    ];
    for (const opt of options) {
        const optionElement = document.createElement("option");
        optionElement.value = opt.value;
        optionElement.textContent = opt.label;
        select.appendChild(optionElement);
    }

    // On sort change: update currentSort, remove any active playlist-sort option, re-render.
    select.addEventListener("change", () => {
        currentSort = select.value;
        const dynamicOpt = select.querySelector("option[data-dynamic]");
        if (dynamicOpt && select.value !== dynamicOpt.value) dynamicOpt.remove();
        resetLoadedRows();
        renderTableBody();
    });

    wrapper.appendChild(select);
    container.appendChild(label);
    container.appendChild(wrapper);
}

// Activate playlist-order sort for the given playlistID.
// Updates currentSort and injects a dynamic option into the sort select so the control reflects the new state.
function setSortByPlaylist(playlistID) {
    const playlist = playlists.find(p => p.playlistID === playlistID);
    if (!playlist) return;

    currentSort = `playlist:${playlistID}`;

    // Add a dynamic option to the sort select to reflect the active playlist sort.
    const select = document.getElementById("sort-select");
    const existing = select.querySelector("option[data-dynamic]");

    //If a dynamic option already exists (from a previous such sort)remove it before adding this one. 
    if (existing) {
        existing.remove();
    }

    // Create and append new dynamic dropdown option representing the playlist sort.
    const opt = document.createElement("option");
    opt.value = currentSort;
    opt.textContent = `Playlist: ${playlist.name}`;
    opt.dataset.dynamic = "true";

    select.appendChild(opt);
    select.value = currentSort;

    resetLoadedRows();
    renderTableBody();
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

// Store references to filter and selection counter elements. Both are shown/hidden by their respective update functions.
function initControlCounters() {
    filterCounterElement = document.getElementById("filter-counter"); // Could go with filter setup logic, but grouping these two makes sense for now since this is just setting up a reference.
    selectionCounterElement = document.getElementById("selection-counter");
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

// Updates the selection counter. Shows "X selected" when any tracks are selected, hides otherwise.
function updateSelectionCounter() {
    const count = selectedTrackIDs.size;
    if (count === 0) {
        selectionCounterElement.textContent = "";
        selectionCounterElement.classList.remove("selection-counter--active");
    } else {
        selectionCounterElement.textContent = `${count} selected`;
        selectionCounterElement.classList.add("selection-counter--active");
    }
}

/** ===============
 *  ACTION HANDLERS
 *  ===============
 */

// Handler for checkbox click event. State manipulation now happens in session counterpart.
function handleCheckboxToggle(checkbox) {
    console.log(`Checkbox toggled: trackID=${checkbox.dataset.trackID} playlistID=${checkbox.dataset.playlistID} checked=${checkbox.checked}`);
    const trackID = checkbox.dataset.trackID;
    const playlistID = checkbox.dataset.playlistID;
    session.toggleTrack(playlistID, trackID);
    // No cache invalidation needed: membership changes don't affect stableOrder or the filter result.
    renderTableHeader(); // Updates track counts in header
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

// Handler for back button: warns about empty playlists, then about unsaved changes before navigating away.
// NOTE: Replaces behavior determined in original onclick, ensuring "Back to workspace" action is subject to save checks, only exiting immediately if a session error occurs before init is able to set up proper handlers.
async function handleBackButton() {

    // Warn if any playlist has no tracks.
    const emptyPlaylists = playlists.filter(p => p.trackIDSet.size === 0);
    if (emptyPlaylists.length > 0) {
        const names = emptyPlaylists.map(p => `"${p.name}"`).join(", ");
        const label = emptyPlaylists.length === 1 ? `${names} has no tracks.` : `${emptyPlaylists.length} playlists have no tracks: ${names}.`;
        const result = await warningModal({
            title: "Empty Playlist",
            message: `${label} Leave anyway?`,
            actions: [
                { label: "Cancel", value: null },
                { label: "Exit Without Saving", value: "discard-exit", className: "modal__btn"},//Switched from danger to default, not sure which to push. This
                { label: "Save and Exit", value: "save-exit", className: "modal__btn--primary"},
            ]
        });
        if (result === "save-exit") { await handleSave(); }
        else if (result !== "discard-exit") { return; } // null = cancelled
    }

    // Warn if unsaved changes exist (modified or pending-save playlists)
    const hasUnsaved = modifiedPlaylists.size > 0 || session.pendingPlaylists.length > 0;
    if (hasUnsaved) {
        const result = await warningModal({
            title: "Unsaved Changes",
            message: "You have unsaved changes, are you sure you want to exit?",
            actions: [
                { label: "Cancel", value: null },
                { label: "Exit Without Saving", value: "discard-exit", className: "modal__btn--danger"},
                { label: "Save and Exit", value: "save-exit", className: "modal__btn--primary"},
            ]
        });
        if (result === "save-exit") { await handleSave(); }
        else if (result !== "discard-exit") { return; } // null = cancelled
    }

    window.location.href = ".."; // Redirect to dashboard
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
        if (hadPending) refreshWorkspace();

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
 */

// Swap a playlist column left (-1) or right (+1) by swapping adjacent entries in the playlists array.
function handleMovePlaylist(playlistID, direction) {
    const idx = playlists.findIndex(p => p.playlistID === playlistID);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= playlists.length) return;
    [playlists[idx], playlists[newIdx]] = [playlists[newIdx], playlists[idx]];
    refreshWorkspace();

    //Rebuild stable order to reflect new playlist sequence. This should be the only time the order is rebuilt outside of track set changes, since the playlist order is the basis for the original stable order.
    stableOrder = collectTrackIDsInOrder(playlists); 
}


//Using modal, prompt for a new playlist column width and persist it as the module-level state.
async function handleSetColumnWidth() {
    const result = await promptModal({
        title: "Resize Columns",
        message: `Enter a new width between ${PLAYLIST_COLUMN_MIN} and ${PLAYLIST_COLUMN_MAX} pixels.`,
        placeholder: playlistColumnWidth.toString(),
        validate: (input) => {
            const n = parseInt(input, 10);
            if (isNaN(n) || n < PLAYLIST_COLUMN_MIN || n > PLAYLIST_COLUMN_MAX) {
                return `Please enter a number between ${PLAYLIST_COLUMN_MIN} and ${PLAYLIST_COLUMN_MAX}.`;
            }
            return null;
        }
    });
    if (result !== null) {
        playlistColumnMode = "manual";
        playlistColumnWidth = parseInt(result, 10);
        applyPlaylistColumnWidth();
    }
}

function handleAutoFitColumnWidth() {
    playlistColumnMode = "auto";
    applyPlaylistColumnWidth();
}

function computeAutoPlaylistWidth() {
    const tableContainer = document.getElementById("workspace-container");
    const containerWidth = tableContainer ? tableContainer.clientWidth : 0;

    // If table columns already exist in DOM, measure their actual rendered width
    // (table-layout: fixed may still include cell borders, padding, etc.).
    const indexCell = document.querySelector('#workspace-table th.track-table__index');
    const infoCell = document.querySelector('#workspace-table th.track-table__info');

    const indexWidth = indexCell ? indexCell.getBoundingClientRect().width : TRACK_INDEX_WIDTH;
    const infoWidth = infoCell ? infoCell.getBoundingClientRect().width : TRACK_INFO_DEFAULT;

    const borderAndPadding = 16; // fallback “waste” for padding/margins/borders (should be small)
    const available = Math.max(0, containerWidth - indexWidth - infoWidth - borderAndPadding);
    const playlistCount = Math.max(1, playlists.length);
    const target = Math.floor(available / playlistCount);

    return Math.max(PLAYLIST_COLUMN_MIN, Math.min(target, PLAYLIST_COLUMN_MAX));
}

// Push current playlist column width to the CSS custom property on the table element.
// If in auto mode, the width is computed from current container and playlist count.
function computeTrackInfoWidth(playlistColumnWidth) {
    const tableContainer = document.getElementById("workspace-container");
    const containerWidth = tableContainer ? tableContainer.clientWidth : 0;
    const occupied = TRACK_INDEX_WIDTH + (playlists.length * playlistColumnWidth) + 16; // table padding/borders fudge
    const remaining = Math.max(0, containerWidth - occupied);
    return Math.max(TRACK_INFO_MIN, Math.min(remaining, TRACK_INFO_MAX));
}

function applyPlaylistColumnWidth() {
    const width = playlistColumnMode === "auto" ? computeAutoPlaylistWidth() : playlistColumnWidth;
    const trackInfoWidth = computeTrackInfoWidth(width);

    const table = document.getElementById('workspace-table');
    if (!table) return;

    // Apply uniform width to all playlist columns and track info via CSS variables.
    table.style.setProperty('--playlist-col-width', width + 'px');
    table.style.setProperty('--track-info-width', trackInfoWidth + 'px');
    table.style.width = "auto"; // Let the table overflow horizontally if needed

    // Keep the table's minimum consistent with the target widths so columns don't automatically redistribute.
    const totalWidth = TRACK_INDEX_WIDTH + trackInfoWidth + (playlists.length * width);
    table.style.minWidth = `${totalWidth}px`;

    // Force existing playlist columns to uniform width.
    document.querySelectorAll('#workspace-table .track-table__checkbox').forEach(cell => {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
    });

    // Force track info header and cells to computed width.
    document.querySelectorAll('#workspace-table th.track-table__info, #workspace-table td.track-table__info').forEach(cell => {
        cell.style.width = `${trackInfoWidth}px`;
        cell.style.minWidth = `${TRACK_INFO_MIN}px`;
        cell.style.maxWidth = `${TRACK_INFO_MAX}px`;
    });
}


// Returns items array [{ label, action } | { divider: true }] for the given dropdown mode.
// Handles "track" -> "track-multi" upgrade and empty-selection guard internally.
function buildDropdownItems(mode, id) {

    // Upgrade track -> track-multi when multiple tracks selected. Abort if none selected.
    if (mode === "track") {
        if (selectedTrackIDs.size === 0) {
            console.warn("Attempted to open track dropdown with no selected tracks. Aborting.");
            return null;
        }
        if (selectedTrackIDs.size > 1) {
            mode = "track-multi";
        }
    }

    switch (mode) {
        case "playlist": {
            const playlistID = id;

            const idx     = playlists.findIndex(p => p.playlistID === playlistID);
            const atLeft  = idx === 0;
            const atRight = idx === playlists.length - 1;

            const core_items = [
                { label: "Select all Tracks",           action: () => handleBulkMembershipUpdate(playlistID, true) },
                { label: "Deselect all Tracks",         action: () => handleBulkMembershipUpdate(playlistID, false) },
                { label: "Sort by this playlist",       action: () => setSortByPlaylist(playlistID) },

                { divider: true },
                { label: "Move Left",  stub: atLeft,  action: () => handleMovePlaylist(playlistID, -1) },
                { label: "Move Right", stub: atRight, action: () => handleMovePlaylist(playlistID,  1) },
                { label: "Resize Columns",             action: () => handleSetColumnWidth() },
                { label: "Auto-fit columns",           action: () => handleAutoFitColumnWidth() },

                { divider: true },
                { label: "Rename Playlist",             action: () => handleRenamePlaylist(playlistID) },
                { label: "Duplicate Playlist",          action: () => handleDuplicatePlaylist(playlistID) },
                { label: "Remove from workspace",       action: () => handleRemovePlaylist(playlistID) },
            ]

            //Conditionally add Spotify and Copy ID options if this playlist has a spotifyURI
            const playlistObject = playlists.find(p => p.playlistID === playlistID);
            const playlistURI = playlistObject?.playlistURI;
            // const playlistURI = playlists.find(p => p.playlistID === playlistID)?.playlistURI;
            // console.table(playlistObject);
            // console.log(playlistURI);
            if (playlistURI) {
                 core_items.push(
                    { divider: true },
                    { label: "Open in Spotify",             action: () => handleOpenSpotifyURI(playlistURI)},
                    { label: "Copy Playlist ID",            action: () => handleCopyID(playlistURI,"playlist")},
                );
            }

            return [
                ...core_items
            ];
        }
        case "track":
            //NOTE: most track actions don’t expect an id — handlers reference selectedTrackIDs directly.

            const core_items = [
                { label: "Add to all Playlists",        action: () => handleAddTrackToAll()},
                { label: "Remove from all Playlists",   action: () => handleRemoveTrackFromAll()},
                { divider: true },
                { label: "Delete Track from workspace", action: () => handleDeleteTrack()},
            ]

            //FUTURE replace with URI specific field rather than trackID
            const trackID = [...selectedTrackIDs][0];
            // const trackID = id.keys().next().value;

            // Conditionally add Spotify and Copy ID options if this trackID has a Spotify URI (verified by string comparison for now)
            if (trackID.startsWith("spotify:track:")) {
                core_items.push(
                    { divider: true },
                    { label: "Open in Spotify", action: () => handleOpenSpotifyURI(trackID) },
                    { label: "Copy Track ID",    action: () => handleCopyID(trackID,"track") }
                );
            }

            return [
                ...core_items
            ];
        case "track-multi":
            //NOTE: most track actions don’t expect an id, since handlers reference selectedTrackIDs directly.
            return [
                { label: `Add ${selectedTrackIDs.size} tracks to all Playlists`,      action: () => handleAddTrackToAll()},
                { label: `Remove ${selectedTrackIDs.size} tracks from all Playlists`, action: () =>  handleRemoveTrackFromAll()},
                { divider: true },
                { label: `Delete ${selectedTrackIDs.size} tracks from workspace`,     action: () => handleDeleteTrack()},
            ];
        default:
            console.error("Invalid dropdown mode:", mode);
            return null;
    }
}

// Handler for select/deselect all - updates membership of each shown track in a playlist to match desired state.
// Operates on the full filtered set of trackIDs, not just the currently rendered page. 
function handleBulkMembershipUpdate(playlistID, desiredState) {

    // Access or recopute cachedFilteredID, using stableOrder as a base to be filtered from (implictly sorted by added order))
    cachedFilteredIDs ??= filterTrackIDs(stableOrder, currentFilter, tracks);

    const playlist = playlists.find(p => p.playlistID === playlistID);

    // Toggle track status if it doesn't match desired state
    for (const id of cachedFilteredIDs) {
        const currentState = playlist.trackIDSet.has(id);
        // (A && !B) || (!A && B) equivalent to (A!=B)
        if (currentState !== desiredState) { 
            session.toggleTrack(playlistID, id);
        }
    }
    resetLoadedRows();
    refreshWorkspace();
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
        validate: (value) => {
            if (!value) return "Name cannot be empty.";
            if (value === playlist.name) return "Name is unchanged.";
            return null;
        }
    });
    if (!newName) return;

    session.renamePlaylist(playlistID, newName);
    refreshWorkspace();
    updateSaveStatus();
}

// Handler for removing a playlist from the workspace. Warns if the playlist has unsaved changes.
async function handleRemovePlaylist(playlistID) {
    const playlist = playlists.find(p => p.playlistID === playlistID);
    const hasUnsaved = playlist && (modifiedPlaylists.has(playlistID) || session.pendingPlaylists.includes(playlist));
    if (hasUnsaved) {
        const proceed = await warningModal({
            title:   "Unsaved Changes",
            message: `"${playlist.name}" has unsaved changes. Remove it from the workspace without saving?`,
            actions: [
                { label: "Cancel",                value: null,                                           },
                { label: "Remove Without Saving", value: "discard-exit", className: "modal__btn--danger" },
                { label: "Save First",            value: "save-exit",   className: "modal__btn--primary" },
            ]
        });
        if (!proceed) return;
        if (proceed === "save-exit") await handleSave();
    }
    session.removePlaylist(playlistID);
    // If the removed playlist was the active sort source, reset to order-added.
    if (currentSort === `playlist:${playlistID}`) {
        currentSort = "order-added";
        const select = document.getElementById("sort-select");
        const dynamicOpt = select.querySelector("option[data-dynamic]");
        if (dynamicOpt) dynamicOpt.remove();
        select.value = "order-added";
    }
    refreshWorkspace();
}

//Handler for duplicating a playlist within the workspace. 
function handleDuplicatePlaylist(playlistID) {
    session.duplicatePlaylist(playlistID);
    refreshWorkspace();
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
    
    refreshWorkspace();
}



// Remove all selected tracks from every playlist that contains them. Warns when multiple tracks are selected.
async function handleRemoveTrackFromAll() {
    if (playlists.size>1 && selectedTrackIDs.size > 1) {
        const proceed = await warningModal({
            title:   "Remove from All Playlists",
            message: `Remove ${selectedTrackIDs.size} tracks from every playlist in the workspace?`,
            actions: [
                { label: `Remove ${selectedTrackIDs.size} Tracks`, value: "continue", className: "modal__btn--danger" },
                { label: "Cancel",                                 value: null                                        }
            ]
        });
        if (!proceed) return;
    }
    for (const trackID of selectedTrackIDs) {
        for (const playlist of playlists) {
            if (playlist.trackIDSet.has(trackID)) {
                session.toggleTrack(playlist.playlistID, trackID);
            }
        }
    }
    refreshWorkspace();
}


// Remove all selected tracks from all playlists and their rows from the table. Warns when multiple tracks are selected.
async function handleDeleteTrack() {
    if (selectedTrackIDs.size > 1) {
        const proceed = await warningModal({
            title:   "Delete Tracks",
            message: `Remove ${selectedTrackIDs.size} tracks from the workspace? The data will be lost unless they exist in another playlist.`,
            actions: [
                { label: `Remove ${selectedTrackIDs.size} Tracks`, value: "continue", className: "modal__btn--danger" },
                { label: "Cancel",                                 value: null                                        }
            ]
        });
        if (!proceed) return;
    }
    const deletedIDs = new Set(selectedTrackIDs); // capture before clearSelection, properly deleting from session and stableOrder
    for (const trackID of deletedIDs) {
        session.removeTrackFromWorkspace(trackID);
    }
    // Remove deleted IDs from stableOrder so they don't appear on next render.
    stableOrder = stableOrder.filter(id => !deletedIDs.has(id));
    clearSelection();
    refreshWorkspace();
}



// Handler for copying a track or playlist ID to clipboard. Validates ID format before attempting to copy, and shows console message on success or failure.
function handleCopyID(id,type) {
    const prefix = type === "track" ? "Track ID" : "Playlist ID";

    navigator.clipboard.writeText(id).then(() => {
        console.log(`${prefix} ${id} copied to clipboard.`);
    }).catch(err => {
        console.error(`Failed to copy ${prefix.toLowerCase()}:`, err);
    });
}


// Universal handler for opening Spotify URIs. 
// Supports both track and playlist URIs, validating format and providing user feedback on errors. 
// Attempts to open in Spotify app first, with a fallback to the web player if that fails
function handleOpenSpotifyURI(uri){
    
    // Base URL, appended with type-specific path and ID to build web fallback link if needed.
    let webURL = "https://open.spotify.com/"

    //Build link based on URI type, warning user if format is unexpected.
    if (uri.includes("spotify:playlist:")) {
        webURL += `playlist/${uri.split(":").pop()}`;
    } 
    else if (uri.includes("spotify:track:")) {
        webURL += `track/${uri.split(":").pop()}`;
    }
    else {
        notifyModal({
            title: "Cannot Open in Spotify",
            message: "URI does not appear to be a valid Spotify URI.",
            confirmLabel: "OK"
        });
        return;
    }

    // try to open with URI, fall back to web link in new tab afterward
    window.location.href = uri; //Open directly in window, links right to app if available
    
    //Start a fallback timer
    const start = Date.now();
    setTimeout(() => {
        const elapsed = Date.now() - start;
        // If the user has the Spotify app and it successfully opened, they likely won't return to the page within 2 seconds. If they do return quickly, we can assume the app didn't open and trigger the fallback.
        if (elapsed < 1500) {
            console.warn("Spotify URI fallback triggered after", elapsed, "ms. Opening web URL:", webURL);
            window.open(webURL, "_blank");//Open URL new tab.
        }
    }, 1400);    
}



// Handler for adding existing playlists to the workspace. Fetches full library from IDB, excludes already-loaded playlists, then shows a selector modal.
async function handleAddPlaylist() {
    // Fetch all IDB playlists and exclude ones already in the workspace
    const allPlaylists = await session.dataManager.getAllRecords("playlists");
    const loadedIds    = new Set(playlists.map(p => p.id));
    const available    = allPlaylists.filter(p => !loadedIds.has(p.id));

    if (available.length === 0) {
        await notifyModal({
            title: "No Playlists Available",
            message: "All playlists in your library are already in the workspace.",
            confirmLabel: "OK"
        });
        return;
    }

    //Use playlistSelectModal get a set of selected IDs.
    const selectedIds = await playlistSelectModal({
        title: "Add Playlist",
        confirmLabel: "Add",
        playlists: available,
        offerSelectAll: false
    });

    //If user cancelled or made no selection, exit. 
    if (!selectedIds) return;

    //Add each selected playlist to the session sequentially, which updates the workspace state and triggers a re-render. 
    for (const id of selectedIds) {
        await session.addPlaylist(id);
    }

    // Append any novel track IDs introduced by the new playlists to stableOrder.
    const stableSet = new Set(stableOrder);
    for (const tid of Object.keys(session.tracks)) {
        if (!stableSet.has(tid)) stableOrder.push(tid);
    }

    refreshWorkspace();

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

    refreshWorkspace();
}

// Add selected tracks from library to workspace.
// In the absence of an existing playlist, a new one is created to hold the imported tracks.
async function handleAddTrackToWorkspace() {
    const allTracks = await session.dataManager.getAllRecords("tracks");
    // console.log("All tracks in library:", allTracks);//DEBUG

    if (!allTracks || allTracks.length === 0) {
        await notifyModal({ title: "No Tracks Available", message: "No tracks are available in library to add to workspace." });
        return;
    }

    const candidateTracks = allTracks.filter(track => !tracks[track.trackID]);
    if (candidateTracks.length === 0) {
        await notifyModal({ title: "No New Tracks", message: "All available tracks are already present in the workspace." });
        return;
    }
    // console.log("Candidate tracks:", candidateTracks);//DEBUG

    const selectedTrackIDs = await trackSelectModal({
        title: "Add Tracks",
        confirmLabel: "Add",
        cancelLabel: "Cancel",
        tracks: candidateTracks
    });
    if (!selectedTrackIDs || selectedTrackIDs.length === 0) return;

    // Ensure the selected tracks are loaded into session cache
    const selectedMap = new Map(candidateTracks.map(t => [t.trackID, t]));
    for (const trackID of selectedTrackIDs) {
        const track = selectedMap.get(trackID);
        if (track) tracks[trackID] = track;
    }

    // Add tracks to first playlist in workspace (or create a new one if none exist)
    let destination = playlists[0];
    if (!destination) {
        destination = session.createEmptyPlaylist("Imported Tracks");
        playlists.push(destination);
    }

    for (const trackID of selectedTrackIDs) {
        if (!destination.trackIDSet.has(trackID)) {
            destination.trackIDs.push(trackID);
            destination.trackIDSet.add(trackID);
            session.modifiedPlaylists.add(destination.playlistID);
        }
        if (!stableOrder.includes(trackID)) {
            stableOrder.push(trackID);
        }
    }

    refreshWorkspace();
}

async function handleAddToWorkspace() {
    const action = await menuModal({
        title: "Add to Workspace",
        choices: [
            { label: "Add existing playlist", value: "add-playlist" },
            { label: "Create new playlist", value: "new-playlist" },
            { label: "Add tracks", value: "add-track" }
        ],
        cancelLabel: "Cancel"
    });

    if (action === "add-playlist") {
        await handleAddPlaylist();
    } else if (action === "new-playlist") {
        await handleCreateEmptyPlaylist();
    } else if (action === "add-track") {
        await handleAddTrackToWorkspace();
    }
}


/** ==================
 *  SELECTION
 *  ==================
 */

// Clears all selected rows: strips .selected from the DOM, clears the Set, resets anchor index.
function clearSelection() {
    for (const id of selectedTrackIDs) {
        const row = document.querySelector(`tr[data-track-id="${id}"]`);
        if (row) row.classList.remove("track-row--selected");
    }
    selectedTrackIDs.clear();
    lastClickedTrackIndex = null;
    updateSelectionCounter();
}

// Add a track to the selection and mark its row.
function selectTrack(trackID, rowEl) {
    selectedTrackIDs.add(trackID);
    if (rowEl) rowEl.classList.add("track-row--selected");
    updateSelectionCounter();
}

// Remove a track from the selection and unmark its row.
function deselectTrack(trackID, rowEl) {
    selectedTrackIDs.delete(trackID);
    if (rowEl) rowEl.classList.remove("track-row--selected");
    updateSelectionCounter();
}

// Check if a track is currently selected. Returns a boolean.
function isTrackSelected(trackID) { 
    return selectedTrackIDs.has(trackID);
}

// Route row click to appropriate selection behavior based on modifier keys.
function handleTrackRowClick(trackID, rowEl, index, event) {

    // Shift key: route to shift-click handler for range selection. Doesn't update anchor index, allowing multiple shift clicks from the same anchor.
    if (event.shiftKey) {
        handleShiftClick(index, trackID, rowEl);
    } 
    // Cmd/Ctrl key: toggle this track's selection state without affecting others, update anchor to this track for potential future shift-clicks.
    else if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: toggle this track individually
        if (isTrackSelected(trackID)) {
            deselectTrack(trackID, rowEl);
        } else {
            selectTrack(trackID, rowEl);
        }
        lastClickedTrackIndex = index; //Update anchor to this track
    }
    // Plain click: exclusive select — clear all others, then select this one and update anchor. 
    else {
        clearSelection();
        selectTrack(trackID, rowEl);
        lastClickedTrackIndex = index; //Update anchor to this track
    }
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

    // Determine filtered ID set from cache or stableOrder.
    const filteredIDs = cachedFilteredIDs ??= filterTrackIDs(stableOrder, currentFilter, tracks);

    // Add all filtered IDs to the selection set
    for (const id of filteredIDs) {
        selectedTrackIDs.add(id);
    }

    // Add .selected class to all rows in the current filtered set. 
    const tbody = document.getElementById("table-body");
    for (const row of tbody.querySelectorAll("tr[data-track-id]")) {
        row.classList.add("track-row--selected");
    }

    updateSelectionCounter();
    console.log("handleCmdA: selected", selectedTrackIDs.size, "tracks");//DEBUG
}

init();



