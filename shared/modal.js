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

        // TODO: Create dynamically based on modal type. Fine till option modals are implemented.
        // Buttons wired dynamically via open() config, but create elements here to avoid re-creating on each open.
        this._cancelBtn  = document.createElement("button");
        this._confirmBtn = document.createElement("button");

        this._footerEl.appendChild(this._cancelBtn);
        this._footerEl.appendChild(this._confirmBtn);

        modal.appendChild(this._titleEl);
        modal.appendChild(this._bodyEl);
        modal.appendChild(this._footerEl);
        this._overlay.appendChild(modal);
        document.body.appendChild(this._overlay);

        this._resolve    = null;
        this._keyHandler = null;

        //NOTE: Not a factor yet, adding for critical modals where user action is required (exit without saving, big data issues) Would use a method like attemptClose() as replacement, keeping close as an authoritative exit method.
        this.cancelAllowed = true; 

        // Backdrop click equates to cancel.
        this._overlay.addEventListener("click", (e) => {
            if (e.target === this._overlay) this.close(null);
        });
        // Stop click inside modal from bubbling to document (avoids triggering workspace's closeDropdown listener)
        modal.addEventListener("click", (e) => e.stopPropagation());
    }

    // Open the modal with the given config. Returns a Promise that resolves with the result or null.
    // Args: { title, body, confirmLabel, cancelLabel, showCancel, onConfirm }
    open({ title, body, confirmLabel = "OK", cancelLabel = "Cancel", showCancel = true, onConfirm }) {
        // Set title and button labels
        this._titleEl.textContent    = title;
        this._confirmBtn.textContent = confirmLabel;
        this._cancelBtn.textContent  = cancelLabel;
        this._cancelBtn.hidden       = !showCancel;

        // Clear body and populate via callback
        this._bodyEl.innerHTML = "";
        if (body) body(this._bodyEl);

        // Show
        this._overlay.classList.add("modal-overlay--visible");

        // Focus: first input if present, otherwise confirm button
        const firstInput = this._bodyEl.querySelector("input");
        if (firstInput) { firstInput.focus(); firstInput.select(); }
        else            { this._confirmBtn.focus(); }

        // Escape equates to cancel, closes modal
        this._keyHandler = (e) => { if (e.key === "Escape") this.close(null); };
        document.addEventListener("keydown", this._keyHandler);

        // Wire buttons
        this._confirmBtn.onclick = onConfirm ?? (() => this.close(true));
        this._cancelBtn.onclick  = () => this.close(null);

        return new Promise(resolve => { this._resolve = resolve; });
    }

    //FUTURE: Method to prevent critical dialogs from closing without proper input. Check cancelAllowed field, calling proper close method or re-emphasizing modal
    // attemptClose(){
    //     if (this.cancelAllowed) {
    //         this.close(null);
    //     } else {
    //         //emphasize on screen somehow, making clear action is required.
    //     }
    // }

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
