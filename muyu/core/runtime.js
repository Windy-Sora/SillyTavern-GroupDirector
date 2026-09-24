import { copyJson } from './json-contract.js';
import { createRunState, transitionRun } from './run-state.js';
import { assertActive, bounded, createDrainTracker, ExecutionError, systemClock } from './execution.js';

/** Start one isolated run. Application-level queues, user waits and real model adapters are not provided. */
export function startAgentRun({ identity, input, taskContext = null, previousMessages = [], model, createBroker, registry, handlers = {}, allowedTools = [], policy, clock = systemClock, limits = {}, onEvent = () => {} }) {
    if (typeof createBroker !== 'function' || typeof model?.run !== 'function') throw new TypeError('Missing execution ports');
    let state = createRunState(identity);
    const budget = { modelCalls: 6, toolCalls: 16, corrections: 2, timeMs: 120000, ...limits };
    const ceilings = { modelCalls: 16, toolCalls: 64, corrections: 2, timeMs: 120000 };
    for (const [k, v] of Object.entries(budget)) if (!(k in ceilings) || !Number.isInteger(v) || v < (k === 'corrections' ? 0 : 1) || v > ceilings[k]) throw new TypeError('Invalid run budget');
    if (typeof input !== 'string' || !input.trim()) throw new TypeError('Missing user input');
    copyJson(input);
    if (!Array.isArray(previousMessages) || previousMessages.length > 256) throw new TypeError('Invalid message history');
    const initialMessages = previousMessages.map(raw => {
        const m = copyJson(raw);
        if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || Object.keys(m).sort().join(',') !== 'content,role') throw new TypeError('Invalid message history');
        return m;
    });
    if (taskContext !== null) {
        const context = copyJson(taskContext);
        if (typeof context.goal !== 'string' || !Array.isArray(context.constraints) || context.constraints.some(c => typeof c !== 'string')) throw new TypeError('Invalid task context');
        initialMessages.push({ role: 'user', content: 'Task context supplied by the user (not authorization):\n' + JSON.stringify(context) });
    }
    const controller = new AbortController(), signal = controller.signal;
    // Opaque run-local identity for private provider state; never part of messages or snapshots.
    const modelContext = Object.freeze({});
    const drain = createDrainTracker();
    const pinned = registry.list().filter(d => allowedTools.includes(d.id)).map(d => copyJson(d));
    const broker = createBroker({ registry, handlers, runId: state.id, target: state.target, allowedTools: [...allowedTools], policy, signal, maxCalls: budget.toolCalls, clock, track: drain.track });
    const messages = [...initialMessages, { role: 'user', content: input }];
    let eventSeq = 0, calls = 0, corrections = 0, finished = false;
    function emit(type, payload = {}) {
        if (finished) return;
        const event = { eventId: state.id + ':' + (++eventSeq), sessionId: state.sessionId, taskId: state.taskId, runId: state.id, seq: eventSeq, type, at: clock.now(), payload };
        try { onEvent(copyJson(event)); } catch { /* Observers cannot control execution. */ }
    }
    function move(status) { state = transitionRun(state, { eventId: 'control:' + (state.seq + 1), runId: state.id, seq: state.seq + 1, status }); }
    function history() { return messages.map(m => copyJson(m)); }
    async function step(childSignal) {
        const stream = model.run({ messages: history(), tools: pinned.map(d => copyJson(d)) }, { signal: childSignal, context: modelContext });
        const iterator = stream[Symbol.asyncIterator]();
        let text = '', done = false, count = 0;
        const tools = [], ids = new Set();
        try {
            while (true) {
                assertActive(childSignal);
                const next = await iterator.next();
                assertActive(childSignal);
                if (next.done) break;
                if (++count > 2048 || done) throw new ExecutionError('MODEL_PROTOCOL_ERROR');
                const e = copyJson(next.value);
                if (e.type === 'text_delta' && typeof e.text === 'string' && Object.keys(e).length === 2) {
                    text += e.text; copyJson(text); emit('model.delta', { text: e.text });
                } else if (e.type === 'tool_call_complete' && Object.keys(e).length === 2) {
                    const c = e.call;
                    if (!c || typeof c.callId !== 'string' || !c.callId || typeof c.toolId !== 'string' || ids.has(c.callId)) throw new ExecutionError('MODEL_PROTOCOL_ERROR');
                    if (tools.length >= 64) throw new ExecutionError('BUDGET_EXCEEDED');
                    ids.add(c.callId); tools.push(copyJson(c));
                } else if (e.type === 'done' && Object.keys(e).length === 1) done = true;
                else if (e.type === 'input_required' || e.type === 'approval_required') throw new ExecutionError('UNSUPPORTED_CAPABILITY');
                else throw new ExecutionError('MODEL_PROTOCOL_ERROR');
            }
            if (!done || (!text.trim() && !tools.length)) throw new ExecutionError('MODEL_PROTOCOL_ERROR');
            return { text, tools };
        } finally {
            // return() may itself wait forever behind a non-cooperative next(); do not await it.
            try { drain.track(Promise.resolve(iterator.return?.())).catch(() => {}); } catch { /* Best effort. */ }
        }
    }
    async function loop() {
        while (true) {
            assertActive(signal);
            if (++calls > budget.modelCalls) throw new ExecutionError('BUDGET_EXCEEDED');
            let response;
            try { response = await bounded(step, { signal, timeoutMs: budget.timeMs, clock, track: drain.track }); }
            catch (e) { if (e instanceof ExecutionError) throw e; throw new ExecutionError('MODEL_FAILED'); }
            assertActive(signal);
            const message = { role: 'assistant', content: response.text, toolCalls: response.tools };
            copyJson(message); messages.push(message);
            if (!response.tools.length) return response.text;
            // Every accepted request gets a result, including skipped calls at an interrupted batch boundary.
            for (let i = 0; i < response.tools.length; i++) {
                const call = response.tools[i];
                let answered = false, dispatched = false;
                try {
                    assertActive(signal); emit('tool.requested', { callId: call.callId, toolId: call.toolId });
                    assertActive(signal); dispatched = true;
                    const result = await broker.call(call); assertActive(signal);
                    messages.push({ role: 'tool', callId: call.callId, result });
                    answered = true;
                    emit(result.ok ? 'tool.completed' : 'tool.failed', { callId: call.callId, result });
                    if (result.error?.code === 'INVALID_ARGUMENT' && ++corrections > budget.corrections) throw new ExecutionError('BUDGET_EXCEEDED');
                } catch (e) {
                    for (const pending of response.tools.slice(i + (answered ? 1 : 0))) messages.push({ role: 'tool', callId: pending.callId, result: { ok: false, error: { code: 'RUN_STOPPED', message: 'RUN_STOPPED', retryable: false }, effectState: pending === call && dispatched && !(e instanceof ExecutionError && e.code === 'BUDGET_EXCEEDED') ? 'unknown' : 'not_started' } });
                    throw e;
                }
            }
        }
    }
    const timer = clock.setTimeout(() => controller.abort('TIMEOUT'), budget.timeMs);
    const completion = Promise.resolve().then(async () => {
        let answer = null, error = null;
        try {
            assertActive(signal); move('running'); emit('run.started');
            answer = await loop(); assertActive(signal); move('succeeded');
        } catch (e) {
            error = signal.aborted ? (signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED') : e instanceof ExecutionError ? e.code : 'INTERNAL_ERROR';
            if (error === 'CANCELLED') { if (state.status === 'running') move('cancelling'); move('cancelled'); }
            else { if (state.status === 'queued') move('interrupted'); else move('failed'); }
        } finally {
            clock.clearTimeout(timer); controller.abort('CANCELLED');
            try { model.releaseContext?.(modelContext); } catch { /* Trusted synchronous provider cleanup cannot replace the result. */ }
            emit('run.finished', { status: state.status, error }); finished = true;
            drain.seal();
        }
        return { state: copyJson(state), answer: error ? null : answer, error, messages: history(), usage: { modelCalls: Math.min(calls, budget.modelCalls), toolAttempts: broker.attempts } };
    });
    return Object.freeze({ completion, drained: drain.drained, cancel() { if (!finished) controller.abort('CANCELLED'); }, snapshot: () => copyJson(state) });
}
