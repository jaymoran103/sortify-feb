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


// open a playlist selector modal: scrollable list of playlists with checkboxes and search.
// playlists: array of { id, name, trackIDs } — pre-filtered by caller (e.g. excluding already-loaded ones).//TODO Make this clear to the user somewhere? Or just dont filter, really depends on use case/library size. Readding could prompt a modal offering to duplicate that one. KIS: keep as is.
// Returns an array of selected IDB ids, or null if cancelled/dismissed.
// FUTURE: Reuse for dashboard workspace launcher and any export playlist picker.
export function playlistSelectModal({ title = "Select Playlists", confirmLabel = "Add", cancelLabel = "Cancel", playlists = [] } = {}) {
    let selectedIds = new Set();
    let noteEl;

    //Helper method triggered when playlist checkbox toggled: updates selectedIds set, row highlight, and toggles confirm button state depending on input validity.
    //FUTURE: Extract state update/validation to base modal for a more responsive "OK/Continue" button? Dont wanna invalidate existing validation methods for now, theyre more than fine
    function updateState() {
        const count = selectedIds.size;
        noteEl.textContent          = count > 0 ? `${count} selected` : "";
        _modal._confirmBtn.disabled = count === 0;
    }

    // Helper method a single playlist row with checkbox, name, and track count
    //NOTE: Leaving here for now for simplicity, want to extract as non-anonymous function later. 
    //FUTURE: Extract as non-modal specific element for components like dashboard library widget?
    function buildPlaylistRow(pl, list) {
        const label       = document.createElement("label");
        label.className   = "modal__list-row";

        const checkbox    = document.createElement("input");
        checkbox.type     = "checkbox";

        // Wire checkbox change to update selectedIds set and row highlight, then update confirm button state.
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selectedIds.add(pl.id);
                label.classList.add("modal__list-row--checked");
            } else {
                selectedIds.delete(pl.id);
                label.classList.remove("modal__list-row--checked");
            }
            updateState();
        });

        const nameSpan        = document.createElement("span");
        nameSpan.className    = "modal__list-row-name";
        nameSpan.textContent  = pl.name;

        const countSpan       = document.createElement("span");
        countSpan.className   = "modal__list-row-count";
        const trackCount      = pl.trackIDs?.length ?? 0;
        countSpan.textContent = `${trackCount} track${trackCount !== 1 ? "s" : ""}`;

        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        label.appendChild(countSpan);
        list.appendChild(label);

        return { label, name: pl.name.toLowerCase() };
    }

    // Open modal with body callback that builds search input, playlist rows, and search filter logic.
    return _modal.open({
        title,
        confirmLabel,
        cancelLabel,
        showCancel: true,
        body(container) {
            // Add list modifier class to the modal element
            _modal._overlay.firstElementChild.classList.add("modal--list");

            // Search input
            const searchInput         = document.createElement("input");
            searchInput.type          = "text";
            searchInput.className     = "modal__search-input";
            searchInput.placeholder   = "Search playlists\u2026";

            // Scrollable list
            const list      = document.createElement("div");
            list.className  = "modal__list";

            const emptyMsg        = document.createElement("p");
            emptyMsg.className    = "modal__list-empty";
            emptyMsg.textContent  = "No playlists match your search.";
            emptyMsg.hidden       = true;

            // One row per playlist
            const rows = playlists.map(pl => buildPlaylistRow(pl, list));

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

// Variant of playlistSelectModal for Spotify playlists.
// Same method signature and return type, but expects playlist objects with { spotifyPlaylistId, name, trackCount } and uses spotifyPlaylistId for the selected IDs.
// FUTURE: extract shared logic to a base selection modal or helper methods, fine for now
// playlists: [{ spotifyPlaylistId, name, trackCount }]  — trackCount is a raw number, not derived from trackIDs
// Returns an array of selected spotifyPlaylistId strings, or null if cancelled/dismissed.
export function spotifyPlaylistSelectModal({ title = "Select Playlists", confirmLabel = "Import", cancelLabel = "Cancel", playlists = [] } = {}) {
    let selectedIds = new Set();
    let noteEl;

    // Update selected set, row highlight, and confirm button state on checkbox toggle
    function updateState() {
        const count = selectedIds.size;
        noteEl.textContent          = count > 0 ? `${count} selected` : "";
        _modal._confirmBtn.disabled = count === 0;
    }

    // Build a single playlist row with checkbox, name, and track count
    function buildPlaylistRow(pl, list) {
        const label     = document.createElement("label");
        label.className = "modal__list-row";

        const checkbox = document.createElement("input");
        checkbox.type  = "checkbox";

        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selectedIds.add(pl.spotifyPlaylistId);
                label.classList.add("modal__list-row--checked");
            } else {
                selectedIds.delete(pl.spotifyPlaylistId);
                label.classList.remove("modal__list-row--checked");
            }
            updateState();
        });

        const nameSpan       = document.createElement("span");
        nameSpan.className   = "modal__list-row-name";
        nameSpan.textContent = pl.name;

        const countSpan       = document.createElement("span");
        countSpan.className   = "modal__list-row-count";
        countSpan.textContent = `${pl.trackCount} track${pl.trackCount !== 1 ? "s" : ""}`;

        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        label.appendChild(countSpan);
        list.appendChild(label);

        return { label, name: pl.name.toLowerCase() };
    }

    return _modal.open({
        title,
        confirmLabel,
        cancelLabel,
        showCancel: true,
        body(container) {
            _modal._overlay.firstElementChild.classList.add("modal--list");

            const searchInput       = document.createElement("input");
            searchInput.type        = "text";
            searchInput.className   = "modal__search-input";
            searchInput.placeholder = "Search playlists\u2026";

            const list     = document.createElement("div");
            list.className = "modal__list";

            const emptyMsg       = document.createElement("p");
            emptyMsg.className   = "modal__list-empty";
            emptyMsg.textContent = "No playlists match your search.";
            emptyMsg.hidden      = true;

            const rows = playlists.map(pl => buildPlaylistRow(pl, list));
            list.appendChild(emptyMsg);

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

            const old = _modal._footerEl.querySelector(".modal__footer-note");
            if (old) old.remove();
            noteEl           = document.createElement("span");
            noteEl.className = "modal__footer-note";
            _modal._footerEl.prepend(noteEl);

            _modal._confirmBtn.disabled = true;
        },
        onConfirm() {
            if (selectedIds.size === 0) return;
            _modal.close([...selectedIds]);
        }
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

