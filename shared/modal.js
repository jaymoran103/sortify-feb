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
export function promptModal({ title, confirmLabel = "OK", cancelLabel = "Cancel", defaultValue = "", placeholder = "", validate } = {}) {
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
// getCount may return null; the count column is omitted from the row in that case.
// FUTURE: add sortSelected boolean param here to float selected items to top of returned array.
// FUTURE: add selectAll button param here if needed, not in wrapper functions.
function _openSelectModal({ title, 
                            confirmLabel = "Add", 
                            cancelLabel = "Cancel",
                            playlists = [], 
                            getID, 
                            getCount,
                            searchPlaceholder = "Search playlists\u2026" }) {
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
        });

        const nameSpan       = document.createElement("span");
        nameSpan.className   = "modal__list-row-name";
        nameSpan.textContent = item.name;

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
        return { label, name: item.name.toLowerCase() };
    }

    return _modal.open({
        title,
        confirmLabel,
        cancelLabel,
        showCancel: true,
        body(container) {
            // Add list modifier class to the modal element
            _modal._overlay.firstElementChild.classList.add("modal--list");

            // Search input
            const searchInput       = document.createElement("input");
            searchInput.type        = "text";
            searchInput.className   = "modal__search-input";
            searchInput.placeholder = searchPlaceholder;

            // Scrollable list
            const list     = document.createElement("div");
            list.className = "modal__list";

            const emptyMsg       = document.createElement("p");
            emptyMsg.className   = "modal__list-empty";
            emptyMsg.textContent = "No results match your search.";
            emptyMsg.hidden      = true;

            // One row per item
            const rows = playlists.map(item => buildRow(item, list));
            list.appendChild(emptyMsg);

            // Filter rows on search input
            searchInput.addEventListener("input", () => {
                const query = searchInput.value.trim().toLowerCase();
                let visibleCount = 0;
                for (const { label, name } of rows) {
                    const match = !query || name.includes(query);
                    label.hidden = !match;
                    if (match) visibleCount++;
                }
                emptyMsg.hidden = visibleCount > 0;
            });

            container.appendChild(searchInput);
            container.appendChild(list);

            // Inject "N selected" counter into footer, left of buttons
            const old = _modal._footerEl.querySelector(".modal__footer-note");
            if (old) old.remove();
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


// Playlist selector modal — local IDB playlists.
// playlists: array of { id, name, trackIDs }
// Returns an array of selected IDB ids, or null if cancelled/dismissed.
// TODO: decide whether to pre-filter already-loaded playlists at the call site or show all with a note.
export function playlistSelectModal({ title = "Select Playlists", confirmLabel = "Add", cancelLabel = "Cancel", playlists = [] } = {}) {
    return _openSelectModal({
        title, confirmLabel, cancelLabel, playlists,
        getID:    pl => pl.id,
        getCount: pl => pl.trackIDs?.length ?? 0,
    });
}

// Playlist selector modal — Spotify playlists.
// playlists: array of { spotifyPlaylistId, name, trackCount }
// Returns an array of selected spotifyPlaylistId strings, or null if cancelled/dismissed.
export function spotifyPlaylistSelectModal({ title = "Select Playlists", confirmLabel = "Import", cancelLabel = "Cancel", playlists = [] } = {}) {
    return _openSelectModal({
        title, confirmLabel, cancelLabel, playlists,
        getID:    pl => pl.spotifyPlaylistId,
        getCount: pl => pl.trackCount,
    });
}

// FUTURE: Track selector modal — local IDB tracks.
// tracks: array of { trackID, title, artist, album }
// Returns an array of selected trackIDs, or null if cancelled/dismissed.
// FUTURE: pass sortSelected: true once that param is added to _openSelectModal, to float chosen tracks to top.
export function trackSelectModal({ title = "Select Tracks", confirmLabel = "Add", cancelLabel = "Cancel", tracks = [] } = {}) {
    console.warn("trackSelectModal not yet implemented.");
    return Promise.resolve(null);
    // return _openSelectModal({
    //     title, confirmLabel, cancelLabel,
    //     playlists: tracks,                          // _openSelectModal uses 'playlists' param name internally
    //     getID:              t => t.trackID,
    //     getCount:           () => null,             // no count column for tracks
    //     searchPlaceholder: "Search tracks\u2026",
    // });
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

