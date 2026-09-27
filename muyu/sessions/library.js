import { HISTORY_LIMITS, historyBytes, validateRecord, summarizeRecord, validateSummary } from './contract.js';
import { importedRecord, exportHistoryRecord, parseHistoryImport } from './exchange.js';
import { validateReceipt, receiptSources } from '../actions/receipts.js';

/** Working copies outlive connections. Disk failures never roll back a generated answer. */
export function createSessionLibrary({ port, changed = () => {}, now = Date.now } = {}) {
    const records = new Map(), summaries = new Map(), revisions = new Map(), dirty = new Set(), failures = new Map(), managing = new Set();
    let store = null, loading = false, enabled = false, pending = 0, error = null, tail = Promise.resolve(), closed = false;
    const notify = () => { if (!closed) { try { changed(); } catch { /* Views do not own storage. */ } } };
    function enqueue(work) {
        pending++;
        const result = tail.then(work);
        tail = result.catch(() => {}).finally(() => { pending--; notify(); });
        notify(); return result;
    }
    async function persist(record, revision) {
        return revision ? store.update(record, revision) : store.create(record);
    }
    function remember(record) { records.set(record.id, record); summaries.set(record.id, summarizeRecord(record)); }
    function schedule(id) {
        if (!enabled || !store || failures.has(id)) return;
        void enqueue(async () => {
            if (!dirty.has(id) || !records.has(id) || failures.has(id)) return;
            const record = structuredClone(records.get(id));
            try {
                const saved = await persist(record, revisions.get(id) || 0);
                revisions.set(id, saved.revision);
                if (JSON.stringify(records.get(id)) === JSON.stringify(record)) dirty.delete(id);
                records.get(id).revision = saved.revision;
                summaries.set(id, summarizeRecord(records.get(id)));
            } catch (e) { failures.set(id, e.message); }
        });
    }
    async function connect() {
        const opened = store || await port.open();
        try {
            const list = (await opened.list()).map(validateSummary);
            if (list.length + [...records.keys()].filter(id => !list.some(r => r.id === id)).length > HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
            for (const [id] of summaries) if (!records.has(id) && !list.some(r => r.id === id)) { summaries.delete(id); revisions.delete(id); }
            for (const summary of list) if (!records.has(summary.id)) { summaries.set(summary.id, summary); revisions.set(summary.id, summary.revision); }
            store = opened;
        } catch (e) { if (opened !== store) opened.close(); throw e; }
    }
    const ready = (async () => {
        if (!port?.enabled()) return;
        loading = true;
        try { await connect(); enabled = true; }
        catch (e) { error = e.message; }
        finally { loading = false; notify(); }
    })();
    async function load(id, scope) {
        await ready;
        const summary = summaries.get(id);
        if (loading || closed || managing.has(id) || !summary || scope !== undefined && summary.scope !== scope) throw Error('HISTORY_SCOPE');
        if (!records.has(id)) {
            if (!store) throw Error('HISTORY_UNAVAILABLE');
            const record = validateRecord(await store.read(id));
            if (record.scope !== summary.scope || record.id !== id) throw Error('HISTORY_SCOPE');
            if (closed || !summaries.has(id) || managing.has(id)) throw Error('NOT_READY');
            if (!records.has(id)) {
                revisions.set(id, record.revision);
                if (record.status === 'running') record.status = 'interrupted';
                remember(record);
            }
        }
        return structuredClone(records.get(id));
    }
    function add(record) {
        if (loading || closed) throw Error('NOT_READY');
        if (summaries.size >= HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
        remember(record); dirty.add(record.id); schedule(record.id); return record.id;
    }
    async function manage(id, patch) {
        await ready;
        if (loading || closed || managing.has(id)) throw Error('NOT_READY');
        if (!records.has(id)) await load(id);
        if (managing.has(id)) throw Error('NOT_READY');
        managing.add(id); notify();
        try {
            return await enqueue(async () => {
                if (closed || !records.has(id)) throw Error('NOT_READY');
                const revision = revisions.get(id) || 0;
                if (patch === null) {
                    if (revision) {
                        if (!store) store = await port.open();
                        try { await store.remove(id, revision); } catch (e) { if (e.message !== 'HISTORY_DELETED') throw e; }
                    }
                    records.delete(id); summaries.delete(id); revisions.delete(id); dirty.delete(id); failures.delete(id);
                    return;
                }
                const fields = { ...patch, updatedAt: now() };
                let saved = null;
                if (enabled || revision) {
                    if (!store) store = await port.open();
                    // Explicit metadata edits with auto-save off must not silently persist draft replies.
                    const base = enabled ? records.get(id) : await store.read(id);
                    if (!base) throw Error('HISTORY_DELETED');
                    saved = await persist(validateRecord({ ...base, ...fields }), revision);
                    revisions.set(id, saved.revision);
                }
                const next = validateRecord({ ...records.get(id), ...fields, updatedAt: Math.max(fields.updatedAt, records.get(id).updatedAt), revision: saved?.revision ?? records.get(id).revision });
                remember(next); failures.delete(id);
                if (saved && JSON.stringify(next) === JSON.stringify(saved)) dirty.delete(id); else dirty.add(id);
            });
        } catch (e) { failures.set(id, e.message); throw e; }
        finally { managing.delete(id); notify(); }
    }
    return {
        ready, load,
        meta: id => summaries.has(id) ? structuredClone(summaries.get(id)) : null,
        snapshot(scope, id, filters) {
            const current = JSON.parse(scope);
            const items = [...summaries.values()].filter(r => {
                if (!filters) return r.scope === scope;
                const [, kind, chatKey] = JSON.parse(r.scope);
                return (filters.range === 'all' || filters.range === 'global' && kind === 'global' || filters.range === 'current' && kind === 'chat' && chatKey === filters.chatKey)
                    && (filters.archive === 'all' || r.archived === (filters.archive === 'archived'))
                    && (!filters.task || JSON.parse(r.scope)[0] === filters.task)
                    && r.title.toLocaleLowerCase().includes((filters.query || '').trim().toLocaleLowerCase());
            }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
            return { available: !!port, enabled, loading, pending, error: failures.get(id) || error,
                dirty: dirty.has(id), sessionId: id || '', persisted: (revisions.get(id) || 0) > 0, managing: managing.has(id),
                total: summaries.size, scopeMode: current[0], selected: id ? this.meta(id) : null,
                sessions: items.map(r => ({ id: r.id, title: r.title, scope: r.scope, updatedAt: r.updatedAt, archived: r.archived, imported: r.imported,
                    status: r.status === 'running' && !records.has(r.id) ? 'interrupted' : r.status })) };
        },
        get: id => records.has(id) ? structuredClone(records.get(id)) : null,
        create(scope) { return add(validateRecord({ version: 2, ...(JSON.parse(scope)[0] === 'assistant' ? { version: 5, receipts: [], contextSummary: null } : {}), id: crypto.randomUUID(), revision: 0, scope, title: '', createdAt: now(), updatedAt: now(), messages: [], required: [], status: 'idle', archived: false, imported: false })); },
        import(text) { return add(importedRecord(parseHistoryImport(text), now())); },
        recordReceipt(id, value) {
            const previous = records.get(id); if (!previous || closed || previous.imported || previous.archived) throw Error('NOT_READY');
            const receipt = validateReceipt(value), receipts = previous.receipts || [];
            if (receipts.some(r => r.operationId === receipt.operationId)) return;
            const next = validateRecord({ ...previous, version: Math.max(4, previous.version), receipts: [...receipts, receipt], required: [...new Set([...previous.required, ...(previous.version === 5 || receipt.version === 2 ? receiptSources(receipt) : ['diagnostics'])])], updatedAt: now() });
            remember(next); dirty.add(id); schedule(id);
        },
        update(id, patch) {
            const previous = records.get(id); if (!previous || closed) throw Error('NOT_READY');
            // Only runtime-owned fields may be updated by capture/send. Metadata uses manage().
            if (Object.keys(patch).some(k => !['messages', 'status', 'title', 'required', 'contextSummary'].includes(k))) throw Error('HISTORY_INVALID');
            const next = validateRecord({ ...previous, ...patch, updatedAt: now() });
            remember(next); dirty.add(id); schedule(id);
        },
        rename(id, title) {
            if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) return Promise.reject(Error('HISTORY_TITLE'));
            return manage(id, { title: title.trim() });
        },
        archive(id, value) { if (typeof value !== 'boolean') return Promise.reject(Error('HISTORY_INVALID')); return manage(id, { archived: value }); },
        remove: id => manage(id, null),
        assertRoom(id) {
            const record = records.get(id); if (!record) throw Error('HISTORY_SCOPE');
            if (record.archived || record.imported) throw Error('HISTORY_READ_ONLY');
            if (record.messages.length > HISTORY_LIMITS.messages - 2 || historyBytes(record) + 200000 > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
        },
        async refresh() {
            await ready; if (loading || closed || !port) throw Error('NOT_READY');
            loading = true; error = null; notify();
            try { await tail; await connect(); } catch (e) { error = e.message; throw e; }
            finally { loading = false; notify(); }
        },
        async setEnabled(value) {
            await ready; if (loading || closed || !port || typeof value !== 'boolean') throw Error('NOT_READY');
            loading = true; error = null; notify();
            try {
                await tail;
                if (value && !store) await connect();
                await port.setEnabled(value); enabled = value;
                if (enabled) { failures.clear(); for (const id of dirty) schedule(id); }
                // Keep opened read access: disabling automatic saves does not hide/delete old records.
            } catch (e) { error = e.message; throw e; }
            finally { loading = false; notify(); }
        },
        async retry() {
            await ready;
            if (!enabled || !store || loading) throw Error('NOT_READY');
            failures.clear(); error = null; for (const id of dirty) schedule(id); await tail;
        },
        export(id, format) { const r = records.get(id); if (!r) throw Error('HISTORY_SCOPE'); return exportHistoryRecord(r, format); },
        async flush() { await ready; await tail; },
        async close() { await ready; await tail; closed = true; store?.close(); },
    };
}
