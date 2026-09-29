import { copyJson, jsonKey } from '../core/json-contract.js';

/** One trusted action type per coordinator. Model tools cannot invoke this API. */
export function createApprovedActions({ contract, getArtifact, getTarget, changed = () => {} }) {
    if (!contract || typeof contract.idPrefix !== 'string' || !contract.idPrefix ||
        ['matchesArtifact', 'validate', 'execute', 'resultStatus', 'notExecuted'].some(key => typeof contract[key] !== 'function') ||
        typeof getArtifact !== 'function' || typeof getTarget !== 'function') throw TypeError('INVALID_ACTION_CONTRACT');
    contract = Object.freeze({ ...contract });
    const records = new Map(); let active = null;
    const notify = () => { try { changed(); } catch { /* Observers do not control commits. */ } };
    function verify(record) {
        if (jsonKey(getTarget()) !== jsonKey(record.target)) throw Error('ACTION_STALE');
        contract.validate(record.artifactId, record.revision);
        const artifact = getArtifact(record.artifactId);
        if (artifact.revision !== record.revision || jsonKey(artifact.content) !== jsonKey(record.content)) throw Error('ACTION_STALE');
    }
    return Object.freeze({
        get busy() { return active !== null; },
        list: () => [...records.values()].map(copyJson),
        prepare(artifactId, revision) {
            if (active || contract.available?.() === false) throw Error('WRITE_UNAVAILABLE');
            const previous = [...records.values()].find(record => record.artifactId === artifactId && record.revision === revision);
            if (previous) { if (previous.status !== 'pending') throw Error('ACTION_CONSUMED'); verify(previous); return copyJson(previous); }
            if (records.size >= 64) throw Error('ACTION_CAPACITY');
            contract.validate(artifactId, revision);
            const artifact = getArtifact(artifactId);
            if (artifact.revision !== revision || !contract.matchesArtifact(artifact)) throw Error('INVALID_DRAFT');
            const record = { id: contract.idPrefix + crypto.randomUUID(), artifactId, revision, sessionId: artifact.sessionId,
                target: copyJson(getTarget()), content: copyJson(artifact.content), status: 'pending', result: null };
            copyJson(record); // Reject oversized approval envelopes before recording them.
            records.set(record.id, record); notify(); return copyJson(record);
        },
        approve(id) {
            const record = records.get(id);
            if (!record || record.status !== 'pending' || active) throw Error('ACTION_STALE');
            try { verify(record); } catch { record.status = 'not_executed'; notify(); throw Error('ACTION_STALE'); }
            record.status = 'applying';
            active = Promise.resolve().then(async () => {
                let dispatched = false;
                try {
                    verify(record);
                    dispatched = true;
                    record.result = await contract.execute(copyJson(record));
                    record.status = contract.resultStatus(record.result);
                } catch (error) {
                    record.status = !dispatched || contract.notExecuted(error) ? 'not_executed' : 'outcome_unknown';
                } finally { active = null; notify(); }
                return copyJson(record);
            });
            notify(); return active;
        },
        cancel(id) { const record = records.get(id); if (!record || record.status !== 'pending') throw Error('ACTION_STALE'); record.status = 'cancelled'; notify(); },
        invalidate() { for (const record of records.values()) if (record.status === 'pending') record.status = 'expired'; notify(); },
        drain: () => active || Promise.resolve(),
        clear() { if (active) throw Error('ACTION_BUSY'); records.clear(); },
    });
}
