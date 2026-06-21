/**
 * User Asset Loader — imports, persists, and auto-loads user-added modules.
 *
 * Supports both 'provider' and 'capability' asset types.
 *
 * Flow:
 *   1. User selects a .js file via GUI
 *   2. Source stored in extension_settings[EXT_KEY].userProviders / userCapabilities
 *   3. Source → Blob URL → dynamic import() → register(deps)
 *   4. On startup, all stored assets are restored and registered
 *
 * Zero server-side dependencies. Fully self-contained.
 */

export function createUserProviderLoader({ extension_settings, EXT_KEY, saveSettings, log, getRegisteredProviderIds }) {
    const STORE_KEYS = { provider: 'userProviders', capability: 'userCapabilities' };

    function getStore(type) {
        const key = STORE_KEYS[type];
        if (!extension_settings[EXT_KEY]) extension_settings[EXT_KEY] = {};
        if (!extension_settings[EXT_KEY][key]) extension_settings[EXT_KEY][key] = [];
        return extension_settings[EXT_KEY][key];
    }

    async function saveStore() {
        if (typeof saveSettings === 'function') saveSettings();
    }

    /**
     * Import a user-selected .js file as a provider or capability.
     *
     * @param {File} file - File object from <input type="file">
     * @param {'provider'|'capability'} type - Asset type
     * @param {object} deps - Dependencies passed to register(deps)
     * @returns {Promise<{ ok: boolean, name: string, error?: string }>}
     */
    async function importAsset(file, type, deps = {}) {
        if (!file || !file.name.endsWith('.js')) {
            return { ok: false, name: file?.name || 'unknown', error: 'Only .js files are supported' };
        }

        const name = file.name.replace(/\.js$/, '');
        const store = getStore(type);
        if (store.some(p => p.name === name)) {
            return { ok: false, name, error: `"${name}" already exists. Delete it first to re-import.` };
        }

        try {
            const source = await readFileAsText(file);
            const blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
            const mod = await import(blobUrl);

            if (typeof mod.register !== 'function') {
                URL.revokeObjectURL(blobUrl);
                return { ok: false, name, error: 'Module must export function register(deps)' };
            }

            // Snapshot → register → diff to find added IDs
            const before = type === 'provider' && getRegisteredProviderIds
                ? new Set(getRegisteredProviderIds())
                : null;
            mod.register(deps);
            const after = before ? getRegisteredProviderIds() : null;
            const addedIds = before && after
                ? after.filter(id => !before.has(id))
                : [];

            // Persist
            store.push({ name, source, importedAt: Date.now(), ids: addedIds });
            await saveStore();

            log(`User ${type} "${name}" imported and registered`);
            return { ok: true, name };
        } catch (e) {
            log(`User ${type} "${name}" import failed:`, e.message);
            return { ok: false, name, error: e.message };
        }
    }

    /**
     * Delete a user-imported asset.
     */
    async function deleteAsset(name, type) {
        const store = getStore(type);
        const idx = store.findIndex(p => p.name === name);
        if (idx === -1) return false;
        store.splice(idx, 1);
        await saveStore();
        log(`User ${type} "${name}" deleted (reload to fully unregister)`);
        return true;
    }

    /**
     * List all imported assets of a given type.
     */
    function listAssets(type) {
        return getStore(type).map(p => ({ name: p.name, importedAt: p.importedAt, ids: p.ids || [] }));
    }

    /**
     * Restore all persisted assets of a given type on startup.
     */
    async function restoreAll(type, deps = {}) {
        const store = getStore(type);
        const loaded = [], failed = [];

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
            log(`User ${type}s: ${loaded.length} restored` +
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

    return { importAsset, deleteAsset, listAssets, restoreAll };
}
