// Floating context menu. Singleton pattern: one instance shared across the app
// open(items, x, y) builds and positions the panel; close() removes it.
// Outside-click and Escape dismissal are registered once in the constructor.

// FUTURE: Might replace sort <select> element in workspace with a similar component

class DropdownMenu {
    constructor() {
        this._panel = null;

        // Outside-click dismissal — fires before item click handlers due to bubbling order.
        document.addEventListener("click", () => this.close());

        // Escape dismissal — workspace.js keeps its own Escape handler for clearSelection().
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this.close();
        });
    }

    // Build and show a dropdown panel anchored to (x, y) page coordinates.
    // items: [{ label, action } | { divider: true }]
    open(items, x, y) {
        // Dismiss any currently open panel first.
        this.close();

        const panel = document.createElement("div");
        panel.className = "dropdown";

        // Prevent the document click listener from immediately closing this panel.
        panel.addEventListener("click", (e) => e.stopPropagation());

        const ul = document.createElement("ul");

        for (const item of items) {
            const li = document.createElement("li");
            if (item.divider) {
                li.className = "dropdown__divider";
            } else {
                li.textContent = item.label;
                li.addEventListener("click", () => {
                    item.action();
                    this.close();
                });
            }
            ul.appendChild(li);
        }

        panel.appendChild(ul);

        // Append hidden first so getBoundingClientRect() returns real dimensions, then clamp to viewport.
        panel.style.cssText = "visibility:hidden;left:0;top:0";
        document.body.appendChild(panel);
        const { width, height } = panel.getBoundingClientRect();
        x = Math.min(x, window.innerWidth  - width  - 10);
        y = Math.min(y, window.innerHeight - height - 10);
        panel.style.cssText = `left:${x}px;top:${y}px`;

        this._panel = panel;
    }

    close() {
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }
    }

    get isOpen() {
        return this._panel !== null;
    }
}

export const dropdownMenu = new DropdownMenu();
