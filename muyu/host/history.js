import { openIndexedHistoryStore } from '../sessions/indexeddb-store.js';
import { openServerHistoryStore } from '../sessions/server-store.js';
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
            const server = await openServer({ namespace, fetcher, headers: getHeaders });
            const store = server || await openStore({ namespace });
            if (server) {
                // Copy older browser records without deleting the original. A server record with
                // the same ID wins; conflict resolution remains explicit, never an overwrite.
                let browser;
                try {
                    browser = await openStore({ namespace });
                    const existing = new Set((await server.list()).map(row => row.id));
                    for (const summary of await browser.list()) if (!existing.has(summary.id)) {
                        const record = await browser.read(summary.id);
                        if (record) {
                            try { await server.create({ ...record, revision: 0 }); }
                            catch (error) {
                                if (error.message !== 'HISTORY_DELETED' &&
                                    !(error.message === 'HISTORY_CONFLICT' && await server.read(summary.id))) throw error;
                            }
                            existing.add(summary.id);
                        }
                    }
                } catch (error) {
                    if (error.message !== 'HISTORY_UNAVAILABLE') { server.close(); throw error; }
                } finally { browser?.close(); }
            }
            const check = async () => { if (await accountKey() !== identity) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); };
            try { await check(); } catch (e) { store.close(); throw e; }
            return {
                kind: store.kind || 'browser',
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
