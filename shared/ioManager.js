
// Central IO manager with adapter registry and logic for dispatching.
// App will register each adapter at startup, and consumers will call ioManager.import(format, ...args) or ioManager.export(format, ...args).
class IOManager {

    constructor() {
        this.importers = {};
        this.exporters = {};
    }

    registerImporter(name, adapter) {
        this.importers[name] = adapter;
    }

    registerExporter(name, adapter) {
        this.exporters[name] = adapter;
    }

    // Dispatch to specified import adapter. Throws if format isn't registered.
    // Not responsible for catching errors from the adapter, they'll propagate to the caller.
    async import(format, ...args) {
        const adapter = this.importers[format];
        if (!adapter) throw new Error(`No importer registered for format: '${format}'`);
        return adapter.import(...args);
    }

    // Dispatch to specified export adapter. Throws if format isn't registered.
    // Not responsible for catching errors from the adapter, they'll propagate to the caller.
    async export(format, ...args) {
        const adapter = this.exporters[format];
        if (!adapter) throw new Error(`No exporter registered for format: '${format}'`);
        return adapter.export(...args);
    }

    // Trigger a browser file download from string content.
    // This will be the one place in the codebase that performs programmatic file download.
    triggerDownload(filename, content, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

export default new IOManager();
