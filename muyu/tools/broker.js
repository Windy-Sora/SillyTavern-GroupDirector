import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { assertActive, bounded, ExecutionError, safeFailure, systemClock } from '../core/execution.js';

/** A run-local, serial, read-only executor. Policy is trusted synchronous code and denies by default. */
export function createToolBroker({ registry, handlers, runId, target, allowedTools = [], policy = () => false, signal, maxCalls = 16, clock = systemClock, track }) {
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 64) throw new TypeError('Invalid tool budget');
    const origin = copyJson(target), allowed = new Set(allowedTools);
    const definitions = new Map(registry.list().map(d => [d.id, copyJson(d)]));
    const functions = new Map(Object.entries(handlers));
    const records = new Map();
    let attempts = 0, pending = false, tail = Promise.resolve();
    async function execute(raw) {
        assertActive(signal);
        if (++attempts > maxCalls) throw new ExecutionError('BUDGET_EXCEEDED');
        let call;
        try {
            call = copyJson(raw);
            if (!call || Object.keys(call).sort().join(',') !== 'args,callId,toolId,version' || typeof call.callId !== 'string' || !call.callId || call.callId.length > 128 || typeof call.toolId !== 'string' || !Number.isInteger(call.version)) throw new Error();
        } catch { return safeFailure('INVALID_ARGUMENT'); }
        const key = jsonKey(call), previous = records.get(call.callId);
        if (previous) return previous.key === key ? copyJson(previous.result) : safeFailure('CALL_ID_CONFLICT');
        const remember = result => { records.set(call.callId, { key, result: copyJson(result) }); return copyJson(result); };
        const d = definitions.get(call.toolId);
        if (!d || !allowed.has(call.toolId)) return remember(safeFailure('PERMISSION_DENIED'));
        if (d.version !== call.version || d.effect !== 'read') return remember(safeFailure('UNSUPPORTED_CAPABILITY'));
        if (d.scope === 'chat' && origin.kind !== 'chat') return remember(safeFailure('TARGET_UNAVAILABLE'));
        let args;
        try { args = validateJson(d.inputSchema, call.args); } catch { return remember(safeFailure('INVALID_ARGUMENT')); }
        let granted = false;
        try {
            const decision = policy({ definition: copyJson(d), args: copyJson(args), target: copyJson(origin), runId });
            if (decision && typeof decision.then === 'function') Promise.resolve(decision).catch(() => {});
            else granted = decision === true;
        } catch { /* Fail closed. */ }
        assertActive(signal);
        if (!granted) return remember(safeFailure('PERMISSION_DENIED'));
        const handler = functions.get(d.id);
        if (typeof handler !== 'function') return remember(safeFailure('UNSUPPORTED_CAPABILITY'));
        if (pending) return remember(safeFailure('UPSTREAM_PENDING'));
        try {
            const data = await bounded(async childSignal => {
                pending = true;
                try { return await handler(args, { runId, callId: call.callId, target: copyJson(origin), signal: childSignal }); }
                finally { pending = false; }
            }, { signal, timeoutMs: d.timeoutMs, clock, track });
            assertActive(signal);
            let output;
            try { output = validateJson(d.outputSchema, data); } catch { return remember(safeFailure('OUTPUT_INVALID', 'unknown')); }
            return remember({ ok: true, data: output });
        } catch (error) {
            assertActive(signal);
            // Even trusted handler exceptions never donate text or error codes to the model.
            return remember(safeFailure(error instanceof ExecutionError && error.code === 'TIMEOUT' ? 'TIMEOUT' : 'TOOL_FAILED', 'unknown'));
        }
    }
    return Object.freeze({
        call(raw) {
            // Capture immediately; callers cannot mutate an enqueued request.
            let input;
            try { input = copyJson(raw); } catch { input = null; }
            const result = tail.then(() => execute(input));
            tail = result.catch(() => {});
            return result;
        },
        get attempts() { return attempts; },
    });
}
