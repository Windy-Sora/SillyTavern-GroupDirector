/**
 * User Provider Loader — imports, persists, and auto-loads user-added providers.
 *
 * Flow:
 *   1. User selects a .js file via GUI
 *   2. Source stored in extension_settings[EXT_KEY].userProviders
 *   3. Source → Blob URL → dynamic import() → register(deps)
 *   4. On startup, all stored providers are restored and registered
 *
 * Zero server-side dependencies. Fully self-contained.
 */

export function createUserProviderLoader({ extension_settings, EXT_KEY, saveSettings, log }) {
    const STORE_KEY = 'userProviders';

    function getStore() {
        if (!extension_settings[EXT_KEY]) extension_settings[EXT_KEY] = {};
        if (!extension_settings[EXT_KEY][STORE_KEY]) extension_settings[EXT_KEY][STORE_KEY] = [];
        return extension_settings[EXT_KEY][STORE_KEY];
    }

    async function saveStore() {
        // Using ST's debounced save
        if (typeof saveSettings === 'function') {
            saveSettings();
        }
    }

    /**
     * Import a user-selected .js file.
     * Reads the source, persists it, and dynamically registers the provider.
     *
     * @param {File} file - File object from <input type="file">
     * @returns {Promise<{ ok: boolean, name: string, error?: string }>}
     */
    async function importProvider(file) {
        if (!file || !file.name.endsWith('.js')) {
            return { ok: false, name: file?.name || 'unknown', error: 'Only .js files are supported' };
        }

        const name = file.name.replace(/\.js$/, '');

        // Check for duplicates
        const store = getStore();
        if (store.some(p => p.name === name)) {
            return { ok: false, name, error: `Provider "${name}" already exists. Delete it first to re-import.` };
        }

        try {
            const source = await readFileAsText(file);
            const blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));

            // Try importing — validates the module can be loaded
            const mod = await import(blobUrl);

            if (typeof mod.register !== 'function') {
                URL.revokeObjectURL(blobUrl);
                return { ok: false, name, error: 'Module must export function register(deps)' };
            }

            // Register it
            mod.register({ log });

            // Persist
            store.push({ name, source, importedAt: Date.now() });
            await saveStore();

            log(`User provider "${name}" imported and registered`);
            return { ok: true, name };
        } catch (e) {
            log(`User provider "${name}" import failed:`, e.message);
            return { ok: false, name, error: e.message };
        }
    }

    /**
     * Delete a user-imported provider.
     */
    async function deleteProvider(name) {
        const store = getStore();
        const idx = store.findIndex(p => p.name === name);
        if (idx === -1) return false;
        store.splice(idx, 1);
        await saveStore();
        log(`User provider "${name}" deleted (reload to fully unregister)`);
        return true;
    }

    /**
     * List all imported providers.
     */
    function listProviders() {
        return getStore().map(p => ({ name: p.name, importedAt: p.importedAt }));
    }

    /**
     * Restore all persisted providers on startup.
     * Called once during plugin init.
     */
    async function restoreAll(deps = {}) {
        const store = getStore();
        const loaded = [];
        const failed = [];

        for (const p of store) {
            try {
                const blobUrl = URL.createObjectURL(new Blob([p.source], { type: 'application/javascript' }));
                const mod = await import(blobUrl);
                if (typeof mod.register === 'function') {
                    mod.register(deps);
                    loaded.push(p.name);
                } else {
                    failed.push({ name: p.name, error: 'no register() export' });
                }
                URL.revokeObjectURL(blobUrl);
            } catch (e) {
                failed.push({ name: p.name, error: e.message });
            }
        }

        if (loaded.length || failed.length) {
            log(`User providers: ${loaded.length} restored` +
                (failed.length ? `, ${failed.length} failed` : ''));
        }
        return { loaded, failed };
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    return { importProvider, deleteProvider, listProviders, restoreAll };
}
