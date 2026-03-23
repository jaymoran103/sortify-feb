// StatusIndicator: reusable progress/status component for long-running I/O operations.
// Adapters don't need to know about this class, updates are triggered by their onProgress() calls.
// FUTURE: Reuse for workspace loading?

const DELAY_TIMEOUT = 3000; // ms to wait before auto-hiding after completion

export default class StatusIndicator {

    constructor(containerEl) {
        this.container = containerEl;
        this._ensureStructure();
        this._statusEl = this.container.querySelector('.io-status');
        this._bar      = this.container.querySelector('.io-status-bar');
        this._label    = this.container.querySelector('.io-status-label');
        this._counter  = this.container.querySelector('.io-status-counter');
    }

    // Inject DOM structure into container if not already present. 
    _ensureStructure() {
        if (!this.container.querySelector('.io-status')) {
            this.container.innerHTML = `
                <div class="io-status">
                    <div class="io-status-bar-track">
                        <div class="io-status-bar"></div>
                    </div>
                    <div class="io-status-row">
                        <span class="io-status-label"></span>
                        <span class="io-status-counter"></span>
                    </div>
                </div>`;
        }
    }

    // Make container visible, reset to initial state, and flash to draw attention
    show(message = '') {
        this.container.removeAttribute('hidden');
        this._statusEl.classList.remove('io-status--error');
        // Restart flash animation by forcing a reflow between class removals/additions
        this.container.classList.remove('io-status--flash');
        void this.container.offsetWidth;
        this.container.classList.add('io-status--flash');
        this._bar.style.width     = '0%';
        this._label.textContent   = message;
        this._counter.textContent = '';
    }

    // Update bar width and counter text; optionally update label
    update(current, total, message = '') {
        if (total === 0) return;
        const pct = ((current / total) * 100).toFixed(1);
        this._bar.style.width     = pct + '%';
        this._counter.textContent = current + ' / ' + total;
        if (message) this._label.textContent = message;
    }

    // Set bar to 100% and auto-hide after DELAY_TIMEOUT (ms)
    complete(message = 'Done') {
        this._statusEl.classList.remove('io-status--error');
        this._bar.style.width     = '100%';
        this._label.textContent   = message;
        this._counter.textContent = '';
        setTimeout(() => this.hide(), DELAY_TIMEOUT);
    }

    // Set error state.
    // Does NOT auto-hide; persists until next show() or hide()
    error(message = 'Error') {
        this._statusEl.classList.add('io-status--error');
        this._label.textContent   = message;
        this._counter.textContent = '';
    }

    // Hide container and clear internal state
    hide() {
        this.container.setAttribute('hidden', '');
        this._statusEl.classList.remove('io-status--error');
        this.container.classList.remove('io-status--flash');
        this._bar.style.width     = '0%';
        this._label.textContent   = '';
        this._counter.textContent = '';
    }
}
