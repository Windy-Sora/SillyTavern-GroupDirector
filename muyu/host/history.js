import { openIndexedHistoryStore } from '../sessions/indexeddb-store.js';
import { openServerHistoryStore } from '../sessions/server-store.js';
import { openSettingsHistoryStore } from '../sessions/settings-store.js';
/** Only the host composition layer supplies account identity, never the model or an import. */
export function createHistoryPort({ getAccount, getSettings, saveSettings, openStore = openIndexedHistoryStore, openServer = openServerHistoryStore, fetcher = null, getHeaders = () => ({}) }) {
    async function accountKey() {
        let account;
        try { account = await getAccount?.(); } catch { throw Error('HISTORY_IDENTITY_UNAVAILABLE'); }
        // Single-user mode is an explicit host fact, not a fallback on lookup failure.
        if (account?.enabled === false) return JSON.stringify(['single-user']);
        if (account?.enabled !== true || typeof account.handle !== 'string' || !account.handle || account.handle.length > 256 || !Number.isSafeInteger(account.created) || account.created < 0) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
        return JSON.stringify(['account', account.handle, account.created]);
    }
    return {
        enabled: () => getSettings().muyuHistoryEnabled === true,
        accountStorage: () => getSettings().muyuHistoryAccountStorage === true,
        async setAccountStorage(enabled) {
            if (typeof enabled !== 'boolean') throw Error('HISTORY_INVALID');
            const settings = getSettings(), previous = settings.muyuHistoryAccountStorage;
            settings.muyuHistoryAccountStorage = enabled;
            try { await saveSettings(); }
            catch { if (settings.muyuHistoryAccountStorage === enabled) settings.muyuHistoryAccountStorage = previous; throw Error('HISTORY_SETTINGS_FAILED'); }
        },
        async setEnabled(enabled) {
            const settings = getSettings(), previous = settings.muyuHistoryEnabled;
            settings.muyuHistoryEnabled = enabled;
            try { await saveSettings(); }
            catch { if (settings.muyuHistoryEnabled === enabled) settings.muyuHistoryEnabled = previous; throw Error('HISTORY_SETTINGS_FAILED'); }
        },
        async open() {
            const identity = await accountKey();
            if (!globalThis.crypto?.subtle) throw Error('HISTORY_UNAVAILABLE');
            // Stable across first-enable races. Hashing reduces raw identifiers at rest;
            // this is NOT encryption or a boundary against hostile same-origin scripts.
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gd-muyu-history-v1:' + identity));
            const hex = [...new Uint8Array(digest)].slice(0, 16).map(n => n.toString(16).padStart(2, '0')).join('');
            const namespace = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            const useSettings = getSettings().muyuHistoryAccountStorage === true;
            const server = useSettings ? null : await openServer({ namespace, fetcher, headers: getHeaders });
            const store = useSettings ? openSettingsHistoryStore({ namespace, getSettings, saveSettings: async () => {
                if (await accountKey() !== identity) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
                await saveSettings();
                if (await accountKey() !== identity) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
            } }) : server || await openStore({ namespace });
            let migration = null;
            async function migrate() {
                if (!server) return;
                // Copy older browser records without deleting the original. A server record with
                // the same ID wins; conflict resolution remains explicit, never an overwrite.
                let browser;
                try {
                    let pending = 0;
                    browser = await openStore({ namespace });
                    const existing = new Set((await server.list()).map(row => row.id));
                    for (const summary of await browser.list()) if (!existing.has(summary.id)) {
                        const record = await browser.read(summary.id);
                        if (record) {
                            try { await server.create({ ...record, revision: 0 }); }
                            catch (error) {
                                if (error.message === 'HISTORY_CAPACITY') { pending++; continue; }
                                if (error.message !== 'HISTORY_DELETED' &&
                                    !(error.message === 'HISTORY_CONFLICT' && await server.read(summary.id))) throw error;
                            }
                            existing.add(summary.id);
                        }
                    }
                    migration = pending ? { pending, reason: 'HISTORY_CAPACITY' } : null;
                } catch (error) {
                    if (error.message !== 'HISTORY_UNAVAILABLE') { server.close(); throw error; }
                } finally { browser?.close(); }
            }
            await migrate();
            const check = async () => { if (await accountKey() !== identity) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); };
            try { await check(); } catch (e) { store.close(); throw e; }
            return {
                kind: store.kind || 'browser',
                get migration() { return migration && { ...migration }; },
                ...(store.assertCapacity ? { assertCapacity: (...args) => store.assertCapacity(...args) } : {}),
                async retryMigration() { await check(); await migrate(); await check(); },
                async list() { await check(); const value = await store.list(); await check(); return value; },
                async read(id) { await check(); const value = await store.read(id); await check(); return value; },
                async write(record, revision) { await check(); return store.write(record, revision); },
                async create(record) { await check(); return store.create(record); },
                async update(record, revision) { await check(); return store.update(record, revision); },
                async remove(id, revision) { await check(); return store.remove(id, revision); },
                close: () => store.close(),
            };
        },
    };
}
