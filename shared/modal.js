// Lightweight modal controller. One modal open at a time.
// DOM shell is built once on import and persists in the body; visibility toggled via modal-overlay--visible.

//FUTURE: strategy / factory for validation functions. Choose mode and pass in parameters as needed? Lambda functions are fine for now.
class ModalController {

    // Build modal shell and add to body. Modal content is populated dynamically via open() config.
    constructor() {

        // Build overlay and modal shell
        this._overlay = document.createElement("div");
        this._overlay.className = "modal-overlay";

        const modal = document.createElement("div");
        modal.className = "modal";

        this._titleEl    = document.createElement("h2");
        this._titleEl.className = "modal__title";

        this._bodyEl     = document.createElement("div");
        this._bodyEl.className = "modal__body";

        this._footerEl   = document.createElement("div");
        this._footerEl.className = "modal__footer";

        // Persistent buttons for standard confirm/cancel path. Actions path builds buttons dynamically per open().
        this._cancelBtn  = document.createElement("button");
        this._cancelBtn.className  = "modal__btn--cancel";
        this._confirmBtn = document.createElement("button");
        this._confirmBtn.className = "modal__btn--confirm";

        modal.appendChild(this._titleEl);
        modal.appendChild(this._bodyEl);
        modal.appendChild(this._footerEl);
        this._overlay.appendChild(modal);
        document.body.appendChild(this._overlay);

        this._resolve    = null;
        this._keyHandler = null;


        // Backdrop click equates to cancel.
        this._overlay.addEventListener("click", (e) => {
            if (e.target === this._overlay) this.close(null);
        });
        // Stop click inside modal from bubbling to document (avoids triggering workspace's closeDropdown listener)
        modal.addEventListener("click", (e) => e.stopPropagation());
    }

    // Open the modal with the given config. Returns a Promise that resolves with the result or null.
    // Args: { title, body, confirmLabel, cancelLabel, showCancel, onConfirm, actions }
    // When "actions" is provided, footer builds one button per action instead of persistent cancel/confirm.
    // Each action: { label, value, className? } — modal closes with that action's value when clicked.
    open({ title, body, confirmLabel = "OK", cancelLabel = "Cancel", showCancel = true, onConfirm, actions }) {
        // Reset modifier classes from previous open
        this._overlay.firstElementChild.className = "modal";

        this._titleEl.textContent = title;

        // Footer: dynamic action buttons, or restore persistent cancel/confirm
        this._footerEl.innerHTML = "";
        if (actions) {
            // Build one button per action; close with that action's value on click
            for (const action of actions) {
                const btn = document.createElement("button");
                btn.textContent = action.label;
                btn.className   = action.className ? `modal__btn ${action.className}` : "modal__btn";
                btn.addEventListener("click", () => this.close(action.value ?? null));
                this._footerEl.appendChild(btn);
            }
        } else {
            // Standard confirm/cancel path
            this._confirmBtn.disabled    = false;
            this._confirmBtn.textContent = confirmLabel;
            this._confirmBtn.onclick     = onConfirm ?? (() => this.close(true));
            this._cancelBtn.textContent  = cancelLabel;
            this._cancelBtn.hidden       = !showCancel;
            this._cancelBtn.onclick      = () => this.close(null);
            this._footerEl.appendChild(this._cancelBtn);
            this._footerEl.appendChild(this._confirmBtn);
        }

        // Clear body and populate via callback
        this._bodyEl.innerHTML = "";
        if (body) body(this._bodyEl);

        // Show
        this._overlay.classList.add("modal-overlay--visible");

        // Add focus to the first input if present, otherwise the last action button, which should always be the least problematic/risky option.
        const firstInput = this._bodyEl.querySelector("input");
        if (firstInput)   { firstInput.focus(); firstInput.select(); }
        else if (actions) { this._footerEl.lastElementChild?.focus(); }
        else              { this._confirmBtn.focus(); }

        // Escape equates to cancel, closes modal
        this._keyHandler = (e) => { if (e.key === "Escape") this.close(null); };
        document.addEventListener("keydown", this._keyHandler);

        return new Promise(resolve => { this._resolve = resolve; });
    }

    close(result) {
        this._overlay.classList.remove("modal-overlay--visible");
        if (this._keyHandler) {
            document.removeEventListener("keydown", this._keyHandler);
            this._keyHandler = null;
        }
        if (this._resolve) {
            this._resolve(result);
            this._resolve = null;
        }
    }
}

const _modal = new ModalController();


// Open a text-input modal. Returns the trimmed input string, or null if cancelled/dismissed/empty.
// args: title, confirmLabel, cancelLabel, defaultValue, placeholder, validate(value) => errorMessage or null
export function promptModal({ title, confirmLabel = "OK", cancelLabel = "Cancel", defaultValue = "", placeholder = "", validate, message=null} = {}) {
    // console.warn("Given message: ", message);
    let inputEl, errorEl;

    // Try to confirm: validate input if validator provided, showing inline error if invalid. 
    // If valid, close modal with input value (or null if empty).
    function tryConfirm() {
        const value = inputEl.value.trim();
        if (validate) {
            const error = validate(value);
    
            if (error) {
                // Show inline error and keep modal open
                errorEl.textContent = error;
                errorEl.hidden      = false;
                inputEl.focus();
                return;
            }
        }
        // Empty input treated as cancel
        _modal.close(value || null);
    }

    // Open modal with body callback that builds input and error elements, and wires Enter key to confirm.
    return _modal.open({
        title,
        confirmLabel,
        cancelLabel,
        showCancel: true,

        
        body(container) {
            // Add text above input if a message is given
            if (message) {
                const msg = document.createElement("p");
                msg.className = "modal__message"; // style already exists
                msg.textContent = message;
                container.appendChild(msg);
            }
            //Input elements
            inputEl             = document.createElement("input");
            inputEl.type        = "text";
            inputEl.className   = "modal__input";
            inputEl.value       = defaultValue;
            inputEl.placeholder = placeholder;

            //Error element for validation feedback, hidden by default. 
            errorEl           = document.createElement("p");
            errorEl.className = "modal__error";
            errorEl.hidden    = true;

            container.appendChild(inputEl);
            container.appendChild(errorEl);

            // Enter key triggers confirm
            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") tryConfirm();
            });
        },
        onConfirm: tryConfirm
    });
}


// Open a notification modal with a message and a single dismiss button.
// Returns a Promise that resolves when the user dismisses.
// Options: title, message, confirmLabel
export function notifyModal({ title, message, confirmLabel = "OK" } = {}) {
    return _modal.open({
        title,
        confirmLabel,
        showCancel: false,
        body(container) {
            const p       = document.createElement("p");
            p.className   = "modal__message";
            p.textContent = message;
            container.appendChild(p);
        }
    });
}


// Open a warning modal with a custom set of action buttons.
// actions: array of { label, value, className? } rendered as buttons in order, least destructive last (ensuring focus on safest option).
// Returns the value of the clicked action, or null if dismissed via ESC/backdrop.
// Caller matches on the returned value to decide what to do.
// TODO add custom styling to convey stakes of warning modals
export function warningModal({ title, message, actions = [] } = {}) {
    return _modal.open({
        title,
        actions,
        body(container) {
            const p       = document.createElement("p");
            p.className   = "modal__message";
            p.textContent = message;
            container.appendChild(p);
        }
    });
}


// Internal list-picker modal used by all selector variants.
// Extend by adding a new exported wrapper that supplies getID and getCount for the item shape.
// getCount may return null — the count column is omitted from the row in that case.
// sortOptions: optional array of { value, label } for a sort <select> shown alongside search.
//   When omitted the search input fills the full row width.
// sortSelected: when true, checked rows float to the top of the list. Rows re-order on each change.
// FUTURE: add selectAll button param here if needed, not in wrapper functions.
function _openSelectModal({ title,
                            confirmLabel = "Add",
                            cancelLabel = "Cancel",
                            items = [],
                            getID,
                            getCount,
                            searchPlaceholder = "Search playlists\u2026",
                            sortOptions = null,
                            sortSelected = false,
                            offerSelectAll = true }) {
    let selectedIds = new Set();
    let noteEl;

    // Update "N selected" counter and confirm button state on checkbox toggle.
    function updateState() {
        const count             = selectedIds.size;
        noteEl.textContent      = count > 0 ? `${count} selected` : "";
        _modal._confirmBtn.disabled = count === 0;
    }

    // Build a single list row with checkbox, name, and optional track count.
    function buildRow(item, list) {
        const label     = document.createElement("label");
        label.className = "modal__list-row";

        const checkbox = document.createElement("input");
        checkbox.type  = "checkbox";

        // Wire checkbox to selectedIds set, row highlight, and confirm state.
        checkbox.addEventListener("change", () => {
            const id = getID(item);
            if (checkbox.checked) {
                selectedIds.add(id);
                label.classList.add("modal__list-row--checked");
            } else {
                selectedIds.delete(id);
                label.classList.remove("modal__list-row--checked");
            }
            updateState();
            // Do not reorder on every checkbox toggle; maintain the current display ordering.
        });

        const nameSpan       = document.createElement("span");
        nameSpan.className   = "modal__list-row-name";
        
        //Hack to give track items a searchable name including arist
        nameSpan.textContent = item.name ??= item.title+" - "+item.artist;

        //Debug ensure every item has a name/title property to show in the list. FUTURE: Enforce typing/fields when refactoring
        if (!nameSpan.textContent){
            console.error(`Item is missing a name/title property: ${item} - In selection modal: ${title}` );
        }

        label.appendChild(checkbox);
        label.appendChild(nameSpan);

        // Count column is optional — omit if getCount returns null.
        const count = getCount(item);
        if (count !== null) {
            const countSpan       = document.createElement("span");
            countSpan.className   = "modal__list-row-count";
            countSpan.textContent = `${count} track${count !== 1 ? "s" : ""}`;
            label.appendChild(countSpan);
        }

        list.appendChild(label);
        return { label, item };
    }

    // Reorder the displayed rows so selected (checked) rows appear first among visible rows.
    function reorderSelectedFirst(list) {
        if (!sortSelected) return;

        const visibleRows = rows.filter(r => !r.label.hidden);
        const hiddenRows  = rows.filter(r => r.label.hidden);

        const checked   = visibleRows.filter(r => r.label.querySelector("input").checked);
        const unchecked = visibleRows.filter(r => !r.label.querySelector("input").checked);

        for (const r of [...checked, ...unchecked, ...hiddenRows]) {
            list.appendChild(r.label);
        }

        // Keep emptyMsg at the end after re-ordering
        list.appendChild(emptyMsg);
    }

    // Sort the source items array by the given criteria and re-render the list.
    // Rows are rebuilt in the new order; existing DOM nodes are replaced.
    // FUTURE: make sort options dynamic
    function applySortAndRender(criteria, list) {
        const sorted = [...items].sort((a, b) => {
            switch (criteria) {
                case "name":
                    return (a.name || "").localeCompare(b.name || "");
                case "last-modified":
                    // Nulls sort last
                    if (!a.lastModified && !b.lastModified) return 0;
                    if (!a.lastModified) return 1;
                    if (!b.lastModified) return -1;
                    return new Date(b.lastModified) - new Date(a.lastModified);
                case "track-count":
                    return (getCount(b) ?? 0) - (getCount(a) ?? 0);
                case "artist":
                    return (a.artist || "").localeCompare(b.artist || "");
                case "album":
                    return (a.album || "").localeCompare(b.album || "");
                default:
                    return 0;
            }
        });

        // Clear existing rows and rebuild in sorted order.
        rows.length = 0;
        while (list.firstChild) list.removeChild(list.firstChild);
        for (const item of sorted) {
            rows.push(buildRow(item, list));
        }
        list.appendChild(emptyMsg);

        // Re-apply current search query visibility after re-ordering.
        const query = currentQuery();
        for (const { label, item } of rows) {
            label.hidden = !!query && !(item.name || "").toLowerCase().includes(query);
        }

        // Restore checked state from selectedIds.
        for (const { label, item } of rows) {
            const id = getID(item);
            const checkbox = label.querySelector("input");
            const isChecked = selectedIds.has(id);
            checkbox.checked = isChecked;
            label.classList.toggle("modal__list-row--checked", isChecked);
        }

        // When requested, keep selected rows at the top of displayed rows.
        reorderSelectedFirst(list);
    }

    // rows is declared here so reorderRows and applySortAndRender can reference it.
    const rows = [];
    // currentQuery is a closure so search and sort can share the current filter state.
    let _currentQuery = "";
    const currentQuery = () => _currentQuery;
    let emptyMsg; // declared here so reorderRows can reference it

    return _modal.open({
        title,
        confirmLabel,
        cancelLabel,
        showCancel: true,
        body(container) {
            // Add list modifier class to the modal element
            _modal._overlay.firstElementChild.classList.add("modal--list");

            // Controls row: search input + optional sort select share one horizontal line.
            const controlsRow     = document.createElement("div");
            controlsRow.className = "modal__controls-row";

            // Search input
            const searchInput       = document.createElement("input");
            searchInput.type        = "text";
            searchInput.className   = "modal__search-input";
            searchInput.placeholder = searchPlaceholder;

            controlsRow.appendChild(searchInput);

            // Optional sort select — only rendered when sortOptions are provided.
            if (sortOptions && sortOptions.length > 0) {
                const sortWrapper     = document.createElement("div");
                sortWrapper.className = "sort-select-wrapper";

                const sortSelect     = document.createElement("select");
                sortSelect.className = "sort-select";

                for (const opt of sortOptions) {
                    const o       = document.createElement("option");
                    o.value       = opt.value;
                    o.textContent = opt.label;
                    sortSelect.appendChild(o);
                }

                sortSelect.addEventListener("change", () => {
                    applySortAndRender(sortSelect.value, list);
                });

                sortWrapper.appendChild(sortSelect);
                controlsRow.appendChild(sortWrapper);
            }

            // Scrollable list
            const list     = document.createElement("div");
            list.className = "modal__list";

            emptyMsg           = document.createElement("p");
            emptyMsg.className = "modal__list-empty";
            emptyMsg.textContent = "No results match your search.";
            emptyMsg.hidden    = true;

            // One row per item — populate rows array in place (shared with sort/reorder helpers).
            for (const item of items) {
                rows.push(buildRow(item, list));
            }
            list.appendChild(emptyMsg);

            // On initial render, selected-first ordering is applied when requested.
            reorderSelectedFirst(list);

            // Filter rows on search input
            searchInput.addEventListener("input", () => {
                _currentQuery = searchInput.value.trim().toLowerCase();
                let visibleCount = 0;
                for (const { label, item } of rows) {
                    const match = !_currentQuery || (item.name || "").toLowerCase().includes(_currentQuery);
                    label.hidden = !match;
                    if (match) visibleCount++;
                }
                emptyMsg.hidden = visibleCount > 0;
                reorderSelectedFirst(list);
            });

            container.appendChild(controlsRow);
            container.appendChild(list);

            // Inject "N selected" counter into footer, left of buttons
            const old = _modal._footerEl.querySelector(".modal__footer-note");
            if (old) old.remove();

            // optional "Select All" button to check all boxes and update state accordingly. Only shown when offerSelectAll is true.
            if (offerSelectAll) {
                const selectAllBtn = document.createElement("button");
                selectAllBtn.type = "button";
                selectAllBtn.className = "modal__btn--cancel";
                selectAllBtn.textContent = "Select All";
                selectAllBtn.addEventListener("click", () => {
                    for (const row of rows) {
                        if (row.label.hidden) continue; // skip hidden rows
                        const id = getID(row.item);
                        selectedIds.add(id);
                        const checkbox = row.label.querySelector("input");
                        checkbox.checked = true;
                        row.label.classList.add("modal__list-row--checked");
                    }
                    updateState();
                    reorderSelectedFirst(list);
                });
                _modal._footerEl.prepend(selectAllBtn);
            }

            noteEl           = document.createElement("span");
            noteEl.className = "modal__footer-note";
            _modal._footerEl.prepend(noteEl);

            // Start with confirm disabled (nothing selected yet)
            _modal._confirmBtn.disabled = true;
        },
        onConfirm() {
            if (selectedIds.size === 0) return;
            _modal.close([...selectedIds]);
        }
    });
}


// Sort options offered in the playlist selector. Separate constant so callers can extend if needed.
//FUTURE: extract all such methods to a dedicated config/util file when refactoring, rather than defining as needed in component files
const PLAYLIST_SORT_OPTIONS = [
    { value: "name",          label: "Name" },
    // { value: "name-desc",     label: "Name" },
    { value: "last-modified", label: "Last Modified" },
    { value: "track-count",   label: "Track Count" },
];

// Playlist selector modal — local IDB playlists.
// playlists: array of { id, name, trackIDs, lastModified? }
// Returns an array of selected IDB ids, or null if cancelled/dismissed.
// TODO: decide whether to pre-filter already-loaded playlists at the call site or show all with a note.
export function playlistSelectModal({ title = "Select Playlists", confirmLabel = "Add", cancelLabel = "Cancel", playlists = [] } = {}) {
    return _openSelectModal({
        title, 
        confirmLabel, 
        cancelLabel, 
        items:       playlists, //playlist array routes to modal body as 'items'
        getID:       pl => pl.id,
        getCount:    pl => pl.trackIDs?.length ?? 0,
        sortOptions: PLAYLIST_SORT_OPTIONS,
        sortSelected: true,
    });
}

// Playlist selector modal — Spotify playlists.
// playlists: array of { spotifyPlaylistId, name, trackCount }
// Returns an array of selected spotifyPlaylistId strings, or null if cancelled/dismissed.
export function spotifyPlaylistSelectModal({ title = "Select Playlists", confirmLabel = "Import", cancelLabel = "Cancel", playlists = [] } = {}) {
    return _openSelectModal({
        title, 
        confirmLabel, 
        cancelLabel, 
        items:    playlists, // playlist array routes to modal body as 'items'
        getID:    pl => pl.spotifyPlaylistId,
        getCount: pl => pl.trackCount,
    });
}

// Sort options for the track selector. Title/artist/album match workspace sort keys.
const TRACK_SORT_OPTIONS = [
    { value: "name",      label: "Title" },
    { value: "artist",    label: "Artist" },
    // { value: "album",     label: "Album" },// Dont want unless we're displaying that metadata in the row.
];

// FUTURE: Track selector modal — local IDB tracks.
// tracks: array of { trackID, title, artist, album }
// Returns an array of selected trackIDs, or null if cancelled/dismissed.
export function trackSelectModal({ title = "Select Tracks", confirmLabel = "Add", cancelLabel = "Cancel", tracks = [] } = {}) {
    // console.warn("trackSelectModal not yet implemented.");
    // return Promise.resolve(null);
    return _openSelectModal({
        title, 
        confirmLabel, 
        cancelLabel,
        items:              tracks,                    
        getID:              t => t.trackID,
        getCount:           () => null,             // no count column for tracks
        searchPlaceholder: "Search tracks\u2026",
        sortOptions:        TRACK_SORT_OPTIONS,
        sortSelected:       true,
    });
}


// Open a menu-choice modal: a list of clickable action rows, each closing the modal with its value.
// Currently uses buttons as rows, with wrapper inside for potential additional content.
// choices: [{ label value, primary? }]
// Returns the value of the clicked choice, or null if cancelled/dismissed.
export function menuModal({ title, choices = [], cancelLabel = "Cancel", hint } = {}) {
    return _modal.open({
        title,
        showCancel: false,
        actions: [],
        body(container) {

            // Optional hint text above the choices
            if (hint) {
                const hintEl       = document.createElement("p");
                hintEl.className   = "modal__message";
                hintEl.textContent = hint;
                hintEl.style.marginBottom = "4px";
                container.appendChild(hintEl);
            }

            // One button row per choice — clicking immediately closes with that choice's value
            for (const choice of choices) {
                const btn = document.createElement("button");
                btn.className = "modal__menu-btn";

                //no emphasis for now
                if (choice.primary) {
                    btn.classList.add("modal__menu-btn--primary");
                }

                //Wrapper for additional content for future buttons- likely icons or secondary text
                const textWrap = document.createElement("span");
                textWrap.className = "modal__menu-btn-text";

                const labelSpan       = document.createElement("span");
                labelSpan.className   = "modal__menu-btn-label";
                labelSpan.textContent = choice.label;
                textWrap.appendChild(labelSpan);

                btn.appendChild(textWrap);
                btn.addEventListener("click", () => _modal.close(choice.value ?? null));
                container.appendChild(btn);
            }

            // Cancel button at bottom of body (styled as footer-level action but inside body flow)
            const cancelBtn       = document.createElement("button");
            cancelBtn.className   = "modal__btn--cancel";
            cancelBtn.textContent = cancelLabel;
            cancelBtn.style.marginTop = "4px";
            cancelBtn.addEventListener("click", () => _modal.close(null));
            container.appendChild(cancelBtn);
        }
    });
}

