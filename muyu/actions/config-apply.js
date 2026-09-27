import { copyJson, jsonKey } from '../core/json-contract.js';

/** UI-owned, connection-local operations; approvals are never model messages. */
export function createConfigActions({ getArtifact, validate, getTarget, writer, changed = () => {} }) {
    const records = new Map(); let active = null;
    const notify = () => { try { changed(); } catch { /* Observers do not control commits. */ } };
    function verify(r) {
        if (jsonKey(getTarget()) !== jsonKey(r.target)) throw Error('ACTION_STALE');
        validate(r.artifactId, r.revision);
        const a = getArtifact(r.artifactId);
        if (a.revision !== r.revision || jsonKey(a.content) !== jsonKey(r.content)) throw Error('ACTION_STALE');
    }
    return Object.freeze({
        get busy() { return active !== null; },
        list: () => [...records.values()].map(copyJson),
        prepare(artifactId, revision) {
            if (!writer || active) throw Error('WRITE_UNAVAILABLE');
            const previous = [...records.values()].find(r => r.artifactId === artifactId && r.revision === revision);
            if (previous) { if (previous.status !== 'pending') throw Error('ACTION_CONSUMED'); verify(previous); return copyJson(previous); }
            if (records.size >= 64) throw Error('ACTION_CAPACITY');
            validate(artifactId, revision);
            const a = getArtifact(artifactId);
            if (a.kind !== 'config-draft' || a.revision !== revision || !a.content.preview.diff.length) throw Error('INVALID_DRAFT');
            const r = { id: 'apply:' + crypto.randomUUID(), artifactId, revision, sessionId: a.sessionId, target: copyJson(getTarget()), content: copyJson(a.content), status: 'pending', result: null };
            copyJson(r); // Reject an oversized envelope before recording a pending approval.
            records.set(r.id, r); notify(); return copyJson(r);
        },
        approve(id) {
            const r = records.get(id);
            if (!r || r.status !== 'pending' || active) throw Error('ACTION_STALE');
            try { verify(r); } catch { r.status = 'not_executed'; notify(); throw Error('ACTION_STALE'); }
            r.status = 'applying';
            // Lock and consume before notifying UI or invoking asynchronous persistence.
            active = Promise.resolve().then(async () => {
                let dispatched = false;
                try {
                    verify(r);
                    dispatched = true;
                    r.result = await writer.apply({ baseline: copyJson(r.content.baseline), changes: copyJson(r.content.requestedChanges ?? r.content.preview.manifest.settings), contractVersion: r.content.preview.contractVersion, memoryPrunePlan: r.content.memoryPrunePlan ? copyJson(r.content.memoryPrunePlan) : null });
                    r.status = ['applied_confirmed', 'applied_unconfirmed', 'partial'].includes(r.result?.status) ? r.result.status : 'applied_unconfirmed';
                } catch (error) {
                    r.status = !dispatched || ['STALE_BASELINE', 'STALE_MEMORY_PREVIEW', 'TARGET_UNAVAILABLE', 'ACTION_STALE', 'WRITE_UNAVAILABLE', 'EMPTY_CHANGES'].includes(error.message) ? 'not_executed' : 'outcome_unknown';
                } finally { active = null; notify(); }
                return copyJson(r);
            });
            notify(); return active;
        },
        cancel(id) { const r = records.get(id); if (!r || r.status !== 'pending') throw Error('ACTION_STALE'); r.status = 'cancelled'; notify(); },
        invalidate() { for (const r of records.values()) if (r.status === 'pending') r.status = 'expired'; notify(); },
        drain: () => active || Promise.resolve(),
        clear() { if (active) throw Error('ACTION_BUSY'); records.clear(); },
    });
}
