import { copyJson, jsonKey } from '../core/json-contract.js';
import { createRunState } from '../core/run-state.js';
import { createWorkspace } from '../workspace/store.js';

/** Trusted application facade. startRun must expose completion AND physical drained promises. */
export function createApplication({ startRun, currentTarget, maxQueue = 8, maxSessions = 16, maxTasks = 128, maxRuns = 128, workspaceOptions } = {}) {
    if (typeof startRun !== 'function') throw new TypeError('Missing run factory');
    for (const n of [maxQueue, maxSessions, maxTasks, maxRuns]) if (!Number.isSafeInteger(n) || n < 1) throw new TypeError('Invalid application limit');
    const sessions = new Map(), tasks = new Map(), runs = new Map(), listeners = new Set(), queue = [];
    const workspace = createWorkspace(workspaceOptions);
    let target = currentTarget == null ? null : copyJson(currentTarget), active = null, disposed = false, counter = 0, cursor = 0, scheduled = false;
    const nextId = prefix => prefix + ':' + (++counter);
    const live = () => { if (disposed) throw new Error('APPLICATION_DISPOSED'); };
    const session = id => { const s = sessions.get(id); if (!s || s.closed) throw new Error('SESSION_CLOSED'); return s; };
    const task = id => { const t = tasks.get(id); if (!t) throw new Error('TASK_NOT_FOUND'); session(t.sessionId); return t; };
    const isCurrent = value => value.kind === 'global' || (target !== null && jsonKey(value) === jsonKey(target));
    const unfinished = r => ['queued', 'running', 'cancelling'].includes(r.status);
    function snapshot() {
        return structuredClone({ cursor, disposed, activeRunId: active?.id ?? null, draining: !!active?.completed,
            sessions: [...sessions.values()], tasks: [...tasks.values()], runs: [...runs.values()], artifacts: workspace.list() });
    }
    function emit(type, ids = {}) {
        const event = { cursor: ++cursor, type, ...ids };
        // Capture recipients at publish time: subscribe's snapshot already contains older events.
        const recipients = [...listeners];
        queueMicrotask(() => { for (const l of recipients) if (listeners.has(l)) { try { l(structuredClone(event)); } catch { /* View failure is isolated. */ } } });
    }
    function schedule() {
        if (disposed || scheduled) return;
        scheduled = true; queueMicrotask(() => { scheduled = false; pump(); });
    }
    function settle(record, status, error, answer = null) {
        record.status = status; record.error = error;
        const s = sessions.get(record.sessionId);
        if (!s.closed) {
            if (answer !== null) s.messages.push({ role: 'assistant', runId: record.id, content: answer });
            const t = tasks.get(record.taskId); t.status = status === 'succeeded' ? 'awaiting_acceptance' : 'open';
        }
        emit('run.settled', { runId: record.id });
    }
    function pump() {
        if (disposed || active) return;
        while (queue.length) {
            const record = runs.get(queue.shift());
            if (record.status !== 'queued') continue;
            if (sessions.get(record.sessionId).closed || !isCurrent(record.target)) { settle(record, 'cancelled', 'TARGET_UNAVAILABLE'); continue; }
            record.status = 'running'; tasks.get(record.taskId).status = 'running';
            const lease = { id: record.id, handle: null, completed: false, drained: false }; active = lease;
            emit('run.started', { runId: record.id });
            try {
                lease.handle = startRun({ identity: { id: record.id, sessionId: record.sessionId, taskId: record.taskId, target: copyJson(record.target) },
                    input: record.input, previousMessages: sessions.get(record.sessionId).messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
                    taskContext: copyJson({ goal: tasks.get(record.taskId).goal, constraints: tasks.get(record.taskId).constraints }),
                    onEvent: event => {
                        if (disposed || lease.completed || record.status !== 'running' || sessions.get(record.sessionId).closed) return;
                        // Notifications only; model text cannot mutate task/artifact or application status.
                        if (event.runId === record.id) emit('run.progress', { runId: record.id });
                    } });
            } catch { active = null; settle(record, 'failed', 'START_FAILED'); continue; }
            const release = () => {
                if (active === lease && lease.completed && lease.drained) { active = null; if (!disposed) { emit('queue.released'); schedule(); } }
            };
            Promise.resolve(lease.handle.completion).then(result => {
                if (lease.completed) return;
                lease.completed = true;
                if (!disposed) {
                    if (record.status === 'cancelling' || sessions.get(record.sessionId).closed) settle(record, 'cancelled', 'CANCELLED');
                    else {
                        const status = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(result?.state?.status) ? result.state.status : 'failed';
                        let answer = null;
                        if (status === 'succeeded' && typeof result.answer === 'string') { try { answer = copyJson(result.answer); } catch { /* Reject oversized result. */ } }
                        settle(record, status === 'succeeded' && answer === null ? 'failed' : status, status === 'succeeded' && answer !== null ? null : 'RUN_ENDED', answer);
                    }
                }
                release();
            }, () => { lease.completed = true; if (!disposed) settle(record, record.status === 'cancelling' ? 'cancelled' : 'failed', record.status === 'cancelling' ? 'CANCELLED' : 'RUN_FAILED'); release(); });
            // Unknown or rejected drain never unlocks the global execution slot.
            if (lease.handle.drained && typeof lease.handle.drained.then === 'function') Promise.resolve(lease.handle.drained).then(() => { lease.drained = true; release(); }, () => { if (!disposed) emit('queue.blocked'); });
            return;
        }
    }
    function cancel(runId) {
        const r = runs.get(runId); if (!r || !unfinished(r)) return;
        if (r.status === 'queued') { queue.splice(queue.indexOf(runId), 1); settle(r, 'cancelled', 'CANCELLED'); schedule(); }
        else { r.status = 'cancelling'; try { active?.handle?.cancel(); } catch { /* Hold lease until actual drain. */ } emit('run.cancelling', { runId }); }
    }
    function enqueue(t, input) {
        const s = session(t.sessionId);
        if ([...runs.values()].some(r => r.sessionId === s.id && unfinished(r)) || (active && runs.get(active.id).sessionId === s.id)) throw new Error('SESSION_BUSY');
        if (queue.length >= maxQueue) throw new Error('QUEUE_FULL');
        if (runs.size >= maxRuns) throw new Error('RUN_CAPACITY');
        if (typeof input !== 'string' || !input.trim()) throw new TypeError('Missing input'); copyJson(input);
        const id = nextId('run');
        const r = { id, sessionId: s.id, taskId: t.id, target: copyJson(s.target), input, status: 'queued', error: null };
        runs.set(id, r); queue.push(id); t.status = 'queued'; s.messages.push({ role: 'user', runId: id, content: input });
        emit('run.queued', { runId: id }); schedule(); return id;
    }
    function ownedArtifact(id) { const a = workspace.get(id); task(a.taskId); return a; }
    return Object.freeze({
        createSession(scope) {
            live(); if (sessions.size >= maxSessions) throw new Error('SESSION_CAPACITY');
            const id = nextId('session'); const valid = createRunState({ id: 'check', sessionId: id, taskId: 'check', target: scope }).target;
            sessions.set(id, { id, target: valid, closed: false, messages: [] }); emit('session.created', { sessionId: id }); return id;
        },
        submit(sessionId, goal, constraints = []) {
            live(); session(sessionId); if (tasks.size >= maxTasks) throw new Error('TASK_CAPACITY');
            const c = copyJson(constraints); if (!Array.isArray(c) || c.some(v => typeof v !== 'string')) throw new TypeError('Invalid constraints');
            const t = { id: nextId('task'), sessionId, goal, constraints: c, status: 'open' };
            const runId = enqueue(t, goal); tasks.set(t.id, t); return { taskId: t.id, runId };
        },
        continueTask(taskId, input) { live(); const t = task(taskId); if (t.status === 'completed') throw new Error('TASK_COMPLETED'); return enqueue(t, input); },
        completeTask(taskId) { live(); const t = task(taskId); if (['queued', 'running'].includes(t.status) || active && runs.get(active.id).taskId === t.id) throw new Error('TASK_BUSY'); t.status = 'completed'; emit('task.completed', { taskId }); },
        cancel(runId) { live(); cancel(runId); },
        closeSession(id) { live(); const s = session(id); s.closed = true; for (const r of runs.values()) if (r.sessionId === id) cancel(r.id); emit('session.closed', { sessionId: id }); },
        changeTarget(value) { live(); target = value === null ? null : createRunState({ id: 'check', sessionId: 'check', taskId: 'check', target: value }).target; for (const r of runs.values()) if (!isCurrent(r.target)) cancel(r.id); emit('target.changed'); },
        snapshot,
        subscribe(listener) {
            live(); if (typeof listener !== 'function') throw new TypeError('Invalid listener');
            const subscription = event => listener(event); listeners.add(subscription);
            return { snapshot: snapshot(), cursor, unsubscribe: () => listeners.delete(subscription) };
        },
        createArtifact({ taskId, sourceRunId = null, kind, content }) {
            live(); const t = task(taskId);
            if (sourceRunId !== null) { const r = runs.get(sourceRunId); if (!r || r.taskId !== taskId || r.status !== 'succeeded') throw new Error('INVALID_SOURCE_RUN'); }
            const a = workspace.create({ id: nextId('artifact'), taskId, sessionId: t.sessionId, sourceRunId, kind, content }); emit('artifact.created', { artifactId: a.id }); return a;
        },
        updateArtifact(id, revision, content) { live(); ownedArtifact(id); const a = workspace.update(id, revision, content); emit('artifact.updated', { artifactId: id }); return a; },
        validateArtifact(id, revision, validation) { live(); ownedArtifact(id); const a = workspace.validate(id, revision, validation); emit('artifact.validated', { artifactId: id }); return a; },
        getArtifact(id, revision) { live(); return workspace.get(id, revision); },
        deleteArtifact(id) { live(); ownedArtifact(id); workspace.delete(id); emit('artifact.deleted', { artifactId: id }); },
        dispose() { if (disposed) return; for (const r of runs.values()) cancel(r.id); disposed = true; listeners.clear(); workspace.clear(); queue.length = 0; },
    });
}
