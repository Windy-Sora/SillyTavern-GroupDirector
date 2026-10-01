import { copyJson, jsonKey } from './json-contract.js';
import { createRunState, transitionRun } from './run-state.js';
import { assertActive, bounded, createDrainTracker, ExecutionError, systemClock } from './execution.js';
import { projectBudget, RUN_RANGES, RUN_DEFAULTS } from './budget.js';
import { copyModelMessage, copyModelText } from './model-message.js';
import { MAX_REQUEST_BYTES, MAX_CONTEXT_MESSAGES } from './context-limits.js';

/** Start one isolated run. Application-level queues, user waits and real model adapters are not provided. */
export function startAgentRun({ identity, input, taskContext = null, previousMessages = [], historyCoverage = null, protectedHistory = false, historyBlocked = false, applicationContext = '', resume = null, model, createBroker, registry, handlers = {}, allowedTools = [], trimRecoveryTools = [], trimRecoveryNote = '', policy, clock = systemClock, limits = {}, maxTokens = 8192, finalizeOnLimit = false, toolObservation = null, interactionPort = null, interactionAdmission = () => null, instructionPort = null, instructions = null, contextPort = null, contextConfig = null, compaction = null, prepareCompaction = null, autoCompactionBlocked = false, summaryOnly = false, onSummary = () => {}, resourceUsage = () => ({ used: 0, limit: 0, exhausted: false }), onEvent = () => {} }) {
    if (typeof createBroker !== 'function' || typeof model?.run !== 'function') throw new TypeError('Missing execution ports');
    let state = createRunState(identity);
    const budget = { modelCalls: RUN_DEFAULTS.modelCalls, toolCalls: RUN_DEFAULTS.toolCalls, corrections: 2, timeMs: RUN_DEFAULTS.timeMs, ...limits };
    const ceilings = { modelCalls: 16, toolCalls: 64, corrections: 2, timeMs: 120000 };
    for (const [k, v] of Object.entries(budget)) if (!(k in ceilings) || !Number.isInteger(v) || v < (k === 'corrections' ? 0 : 1) || v > ceilings[k]) throw new TypeError('Invalid run budget');
    if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 32768) throw new TypeError('Invalid output budget');
    if (typeof finalizeOnLimit !== 'boolean') throw new TypeError('Invalid finalization option');
    if (instructions !== null) {
        if (typeof instructionPort?.validate !== 'function') throw new TypeError('Missing instruction port');
        instructions = instructionPort.validate(instructions);
    }
    const { measurePayload, validateContextConfig, projectCoverage, summaryMessage, compactionRequest, collectSummary, summaryReduces, compactionPressure } = contextPort || {};
    if (prepareCompaction !== null && typeof prepareCompaction !== 'function' || (prepareCompaction !== null || autoCompactionBlocked) && typeof compactionPressure !== 'function' || typeof autoCompactionBlocked !== 'boolean') throw new TypeError('Invalid compaction policy');
    if (historyCoverage !== null) {
        historyCoverage = projectCoverage?.(historyCoverage);
        if (!historyCoverage) throw new TypeError('Invalid history coverage');
    }
    if (contextConfig) {
        if ([measurePayload, validateContextConfig, summaryMessage, compactionRequest, collectSummary, summaryReduces].some(fn => typeof fn !== 'function')) throw new TypeError('Missing context ports');
        contextConfig = validateContextConfig(contextConfig);
    }
    if (typeof input !== 'string' || !input.trim()) throw new TypeError('Missing user input');
    copyModelText(input);
    if (resume && (jsonKey(resume.target) !== jsonKey(identity.target) || !Array.isArray(resume.messages) || !Array.isArray(resume.pendingCalls) || !resume.pendingCalls.length || resume.pendingCalls.length > 64 ||
        !Array.isArray(resume.toolIds) || resume.toolIds.length > 64 || new Set(resume.toolIds).size !== resume.toolIds.length || resume.toolIds.some(id => typeof id !== 'string' || !registry.get(id)) ||
        !resume.modelContext || typeof resume.dispose !== 'function')) throw new TypeError('Invalid tool continuation');
    if (resume?.instructions) instructions = instructionPort.validate(resume.instructions);
    if (!Array.isArray(previousMessages) || previousMessages.length > MAX_CONTEXT_MESSAGES) throw new TypeError('Invalid message history');
    const initialMessages = previousMessages.map(raw => {
        const m = copyModelMessage(raw);
        if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || Object.keys(m).sort().join(',') !== 'content,role') throw new TypeError('Invalid message history');
        return m;
    });
    if (taskContext !== null) {
        const context = { goal: copyModelText(taskContext.goal), constraints: copyJson(taskContext.constraints) };
        if (typeof context.goal !== 'string' || !Array.isArray(context.constraints) || context.constraints.some(c => typeof c !== 'string')) throw new TypeError('Invalid task context');
        // Do not duplicate a potentially large first-turn goal already present as input.
        if (context.goal !== input || context.constraints.length) initialMessages.push({ role: 'user', content: 'Task context supplied by the user (not authorization):\n' + JSON.stringify(context) });
    }
    if (typeof applicationContext !== 'string' || applicationContext.length > 12000) throw new TypeError('Invalid application context');
    // Separate transport data, never an orphan tool result or a persisted user turn.
    if (applicationContext) initialMessages.push({ role: 'user', content: applicationContext });
    const controller = new AbortController(), signal = controller.signal;
    // Opaque run-local identity for private provider state; never part of messages or snapshots.
    const modelContext = resume?.modelContext || Object.freeze({});
    const drain = createDrainTracker();
    const pinned = registry.list().filter(d => (resume ? resume.toolIds : allowedTools).includes(d.id)).map(d => copyJson(d));
    const recovery = resume ? [] : registry.list().filter(d => trimRecoveryTools.includes(d.id) && !allowedTools.includes(d.id)).map(d => copyJson(d));
    const activeTools = new Set(pinned.map(d => d.id));
    const broker = createBroker({ registry, handlers, runId: state.id, target: state.target, allowedTools: [...activeTools, ...recovery.map(d => d.id)], policy: call => activeTools.has(call.definition.id) && (typeof policy === 'function' ? policy(call) : false), signal, maxCalls: budget.toolCalls, clock, track: drain.track,
        onEvent: ({ type, attemptId, toolId }) => emit(type, { attemptId, toolId }) });
    const messages = resume ? resume.messages.map(copyModelMessage) : [...initialMessages, { role: 'user', content: input }];
    if (messages.length > MAX_CONTEXT_MESSAGES) throw new TypeError('Tool continuation too large');
    let eventSeq = 0, calls = 0, toolAttempts = 0, corrections = 0, finished = false;
    let reason = null, finalizing = false, inputTokens = 0, outputTokens = 0, usageReports = 0, interaction = null, resumeState = null;
    const startedAt = clock.now();
    const resources = () => {
        try { const r = resourceUsage(); if ([r.used, r.limit].every(n => Number.isSafeInteger(n) && n >= 0 && n <= RUN_RANGES.providerBytes[1])) return r; } catch { /* Observability cannot change execution. */ }
        return { used: 0, limit: 0, exhausted: false };
    };
    const budgetSnapshot = () => { const r = resources(); return projectBudget({ modelCalls: Math.min(calls, budget.modelCalls), modelLimit: budget.modelCalls, toolCalls: Math.min(broker.attempts, budget.toolCalls), toolLimit: budget.toolCalls, corrections, correctionLimit: budget.corrections, elapsedMs: Math.min(86400000, Math.max(0, Math.round(clock.now() - startedAt))), timeLimitMs: budget.timeMs, providerBytes: r.used, providerLimit: r.limit, maxTokens, inputTokens, outputTokens, usageReports, reason, finalizing }); };
    const usageEvent = () => emit('run.usage', budgetSnapshot());
    const exhausted = kind => { reason = kind; throw new ExecutionError('BUDGET_EXCEEDED'); };
    function emit(type, payload = {}) {
        if (finished) return;
        const event = { eventId: state.id + ':' + (++eventSeq), sessionId: state.sessionId, taskId: state.taskId, runId: state.id, seq: eventSeq, type, at: clock.now(), payload };
        try { onEvent(copyJson(event)); } catch { /* Observers cannot control execution. */ }
    }
    function move(status) { state = transitionRun(state, { eventId: 'control:' + (state.seq + 1), runId: state.id, seq: state.seq + 1, status }); }
    function history() { return messages.map(copyModelMessage); }
    function coverageEvent(status) {
        if (historyCoverage && !resume) emit('run.context', { phase: 'history_coverage', status, coverage: historyCoverage });
    }
    const requestFor = () => ({ messages: history(), tools: pinned.map(d => copyJson(d)), maxTokens, finalize: finalizing, ...(instructions ? { instructions } : {}), ...(contextConfig?.inputTokens != null ? { inputTokenLimit: contextConfig.inputTokens } : {}) });
    function checkContext(request, context, trim = false) {
        if (!contextConfig) return request;
        const plannedHistoricalMessages = historyPrefix;
        let value = model.inspect ? model.inspect(request, context) : measurePayload(request);
        if (trim && historyPrefix > 0 && recovery.length && ((contextConfig.inputTokens !== null && value.estimatedTokens > contextConfig.inputTokens) || value.requestBytes > MAX_REQUEST_BYTES)) {
            pinned.push(...recovery); recovery.forEach(d => activeTools.add(d.id)); request.tools = pinned.map(d => copyJson(d));
            if (instructions && trimRecoveryNote) {
                const field = instructions.task.length + trimRecoveryNote.length + 1 <= 4000 ? 'task' : 'base';
                instructions = instructionPort.validate({ ...instructions, [field]: instructions[field] + '\n' + trimRecoveryNote });
                request.instructions = instructions;
            }
            value = model.inspect ? model.inspect(request, context) : measurePayload(request);
        }
        while (contextConfig && trim && ((contextConfig.inputTokens !== null && value.estimatedTokens > contextConfig.inputTokens) || value.requestBytes > MAX_REQUEST_BYTES) && historyPrefix > 0) {
            if (protectedHistory) { coverageEvent('blocked'); throw new ExecutionError('CONTEXT_INCOMPLETE'); }
            // Only pre-run historical messages are removable; never touch live tool/reasoning indices.
            const count = messages[0]?.role === 'user' && messages[1]?.role === 'assistant' && historyPrefix >= 2 ? 2 : 1;
            messages.splice(0, count); historyPrefix -= count; request.messages = history();
            value = model.inspect ? model.inspect(request, context) : measurePayload(request);
        }
        if (contextConfig) {
            emit('run.context', { ...value, phase: 'request', historicalMessages: historyPrefix, trimmedHistoricalMessages: plannedHistoricalMessages - historyPrefix, inputTokenLimit: contextConfig.inputTokens });
            if ((contextConfig.inputTokens !== null && value.estimatedTokens > contextConfig.inputTokens) || value.requestBytes > MAX_REQUEST_BYTES) throw new ExecutionError('CONTEXT_LIMIT');
        }
        return request;
    }
    let historyPrefix = resume ? 0 : previousMessages.length, firstRequest = !resume;
    function reportUsage(value) {
        if (value && [value.inputTokens, value.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) { inputTokens += value.inputTokens; outputTokens += value.outputTokens; usageReports++; usageEvent(); }
    }
    async function compact() {
        // A continuation owns a live tool/reasoning trajectory, not a new history plan.
        if (resume) { historyCoverage = null; return null; }
        if (!compaction || !contextConfig || (!summaryOnly && (budget.modelCalls < 3 || budget.timeMs <= 10000))) {
            if (historyBlocked) { coverageEvent('blocked'); throw new ExecutionError('CONTEXT_INCOMPLETE'); }
            coverageEvent('skipped');
            return null;
        }
        const deadline = clock.now() + (summaryOnly ? Math.min(30000, budget.timeMs) : Math.min(30000, Math.floor(budget.timeMs / 3)));
        for (let attempt = 0; attempt < 2; attempt++) {
            const context = Object.freeze({});
            const summaryCap = Math.min(contextConfig.summaryTokens, maxTokens);
            const request = compactionRequest(compaction, contextConfig.inputTokens, summaryOnly || attempt ? summaryCap : Math.min(8192, summaryCap));
            try {
                checkContext(request, context); calls++; usageEvent(); emit('run.context', { phase: 'summarizing' });
                const text = await bounded(childSignal => collectSummary(model, request, { signal: childSignal, context, onUsage: value => {
                    reportUsage(value);
                    if (value && [value.inputTokens, value.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) emit('run.context', { phase: 'summary_usage', inputTokens: value.inputTokens, outputTokens: value.outputTokens });
                } }), { signal, timeoutMs: Math.max(1, deadline - clock.now()), clock, track: drain.track });
                assertActive(signal);
                if (!summaryReduces(compaction, text)) throw new ExecutionError('SUMMARY_NOT_SMALLER');
                const summary = { through: compaction.through, fingerprint: compaction.fingerprint, text, createdAt: Date.now() };
                onSummary(summary);
                if (summaryOnly) { emit('run.context', { phase: 'summarized' }); return text; }
                // Tail supplied by the trusted planner; original transcript is never mutated.
                const next = [summaryMessage(text), ...compaction.tail];
                if (!summaryOnly && (next.length > MAX_CONTEXT_MESSAGES - 256 || next.some(m => {
                    try { copyModelMessage(m); return false; } catch { return true; }
                }))) throw new ExecutionError('CONTEXT_INCOMPLETE');
                messages.splice(0, historyPrefix, ...next); historyPrefix = next.length;
                protectedHistory = true; historyBlocked = false;
                historyCoverage = projectCoverage?.(compaction.coverage) || null;
                coverageEvent('summarized');
                emit('run.context', { phase: 'summarized' }); return text;
            } catch (e) {
                assertActive(signal);
                emit('run.context', { phase: 'summary_failed', error: ['MODEL_OUTPUT_TRUNCATED', 'MODEL_PROTOCOL_ERROR', 'TIMEOUT', 'CONTEXT_INCOMPLETE', 'CONTEXT_LIMIT', 'SUMMARY_TOO_LARGE', 'SUMMARY_NOT_SMALLER'].includes(e?.code) ? e.code : 'MODEL_FAILED' });
                // A timed-out iterator may still be draining. Never overlap another model call.
                if (summaryOnly || e?.code === 'TIMEOUT') throw e;
                if (e?.code === 'CONTEXT_INCOMPLETE') { coverageEvent('blocked'); throw e; }
                if (!attempt && e?.code === 'MODEL_OUTPUT_TRUNCATED' && summaryCap > request.maxTokens && calls < budget.modelCalls - 1 && deadline - clock.now() > 1000) continue;
                if (historyBlocked) { coverageEvent('blocked'); throw new ExecutionError('CONTEXT_INCOMPLETE'); }
                coverageEvent('fallback');
                return null;
            } finally { try { model.releaseContext?.(context); } catch { /* cleanup only */ } }
        }
    }
    async function step(childSignal) {
        let reported = false;
        const request = checkContext(requestFor(), modelContext, firstRequest); firstRequest = false;
        const stream = model.run(request, { signal: childSignal, context: modelContext, onUsage: value => {
            if (reported || finished || childSignal.aborted) return; reported = true;
            reportUsage(value);
        } });
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
                    text += e.text; copyModelText(text); emit('model.delta', { text: e.text });
                } else if (e.type === 'tool_call_complete' && Object.keys(e).length === 2) {
                    const c = e.call;
                    if (!c || typeof c.callId !== 'string' || !c.callId || typeof c.toolId !== 'string' || ids.has(c.callId)) throw new ExecutionError('MODEL_PROTOCOL_ERROR');
                    if (tools.length >= 64) exhausted('tool_batch');
                    ids.add(c.callId); tools.push(copyJson(c));
                } else if (e.type === 'done' && Object.keys(e).length === 1) done = true;
                else if (e.type === 'input_required' || e.type === 'approval_required') throw new ExecutionError('UNSUPPORTED_CAPABILITY');
                else throw new ExecutionError('MODEL_PROTOCOL_ERROR');
            }
            if (!done || (!text.trim() && !tools.length)) throw new ExecutionError('MODEL_PROTOCOL_ERROR');
            if (finalizing && tools.length) throw new ExecutionError('BUDGET_EXCEEDED');
            return { text, tools };
        } finally {
            // return() may itself wait forever behind a non-cooperative next(); do not await it.
            try { drain.track(Promise.resolve(iterator.return?.())).catch(() => {}); } catch { /* Best effort. */ }
        }
    }
    const admissionFailure = request => {
        const code = interactionAdmission(request);
        if (code === null || code === undefined) return null;
        return { ok: false, error: { code: ['PERMISSION_LIMIT', 'CLARIFICATION_LIMIT'].includes(code) ? code : 'PERMISSION_DENIED', message: 'No further user handoff is available; use already authorized evidence without reading this source.', retryable: false }, effectState: 'not_started' };
    };
    async function executeCalls(toolCalls) {
        for (let i = 0; i < toolCalls.length; i++) {
            if (finalizeOnLimit && (broker.attempts >= budget.toolCalls || resources().exhausted)) {
                reason = resources().exhausted ? 'provider_bytes' : 'tool_calls';
                for (const pending of toolCalls.slice(i)) messages.push({ role: 'tool', callId: pending.callId, result: { ok: false, error: { code: 'BUDGET_EXCEEDED', message: reason, retryable: false }, effectState: 'not_started' } });
                usageEvent(); break;
            }
            const call = toolCalls[i], attemptId = ++toolAttempts;
            let answered = false, dispatched = false;
            try {
                assertActive(signal); emit('tool.requested', { callId: call.callId, toolId: call.toolId, attemptId });
                assertActive(signal); dispatched = true;
                let result = await broker.call(call); assertActive(signal);
                const definition = pinned.find(d => d.id === call.toolId);
                if (result.error?.code === 'PERMISSION_REQUIRED' && definition?.effect === 'read' &&
                    result.error.missingSources?.length && result.error.missingSources.every(source => !source.startsWith('source:providerExecution:'))) {
                    const source = result.error.missingSources[0];
                    const requested = { kind: 'permission', source: source.slice(7), reason: `Read ${source.slice(7)} to complete ${call.toolId}; the tool has not run.` };
                    const failure = admissionFailure(requested);
                    if (failure) result = failure;
                    else {
                        interaction = requested;
                        resumeState = { target: copyJson(state.target), messages: history(), pendingCalls: toolCalls.slice(i).map(copyJson), toolIds: pinned.map(d => d.id), instructions: instructions ? copyJson(instructions) : null, modelContext,
                            dispose: () => { try { model.releaseContext?.(modelContext); } catch { /* Cleanup only. */ } } };
                        return interactionPort.describe(interaction);
                    }
                }
                const requested = interactionPort?.read(call, result);
                if (requested) result = admissionFailure(requested) || result;
                if (toolObservation) {
                    try {
                        const observation = toolObservation.observe(call, result);
                        if (observation !== null) result = { ...result, hostObservation: copyJson(toolObservation.validate(observation)) };
                    } catch { /* Optional observation cannot affect permissions or execution. */ }
                }
                messages.push({ role: 'tool', callId: call.callId, result }); answered = true;
                const changeFields = result.error?.code === 'INVALID_ARGUMENT' && call.args?.changes && typeof call.args.changes === 'object' && !Array.isArray(call.args.changes)
                    ? Object.keys(call.args.changes).filter(field => field.length <= 200).slice(0, 256) : [];
                emit(result.ok ? 'tool.completed' : 'tool.failed', { callId: call.callId, toolId: call.toolId, attemptId, result, changeFields });
                usageEvent();
                if (requested && result.ok) { interaction = copyJson(requested); return interactionPort.describe(interaction); }
                if (result.error?.code === 'INVALID_ARGUMENT' && ++corrections > budget.corrections) exhausted('corrections');
            } catch (e) {
                if (e instanceof ExecutionError && e.code === 'BUDGET_EXCEEDED' && !reason) reason = 'tool_calls';
                for (const pending of toolCalls.slice(i + (answered ? 1 : 0))) messages.push({ role: 'tool', callId: pending.callId, result: { ok: false, error: { code: 'RUN_STOPPED', message: 'RUN_STOPPED', retryable: false }, effectState: pending === call && dispatched && !(e instanceof ExecutionError && e.code === 'BUDGET_EXCEEDED') ? 'unknown' : 'not_started' } });
                throw e;
            }
        }
        return null;
    }
    async function loop() {
        if (resume) { const answer = await executeCalls(resume.pendingCalls); if (answer !== null) return answer; }
        while (true) {
            assertActive(signal);
            if (calls >= budget.modelCalls) exhausted('model_calls');
            if (finalizeOnLimit && (calls === budget.modelCalls - 1 || broker.attempts >= budget.toolCalls || resources().exhausted)) {
                reason ||= resources().exhausted ? 'provider_bytes' : broker.attempts >= budget.toolCalls ? 'tool_calls' : 'model_calls';
                finalizing = true;
                messages.push({ role: 'user', content: 'Execution budget is closing (' + reason + '). Do not request more tools. Answer using only evidence already received; explicitly describe missing information and incomplete work. Do not claim a complete investigation or successful actions without evidence.' });
            }
            calls++; usageEvent();
            let response;
            emit('model.started', { attemptId: calls });
            try { response = await bounded(step, { signal, timeoutMs: budget.timeMs, clock, track: drain.track }); }
            catch (e) {
                emit('model.failed', { attemptId: calls, error: signal.aborted ? (signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED') : e instanceof ExecutionError ? e.code : 'MODEL_FAILED' });
                if (e instanceof ExecutionError) throw e; throw new ExecutionError('MODEL_FAILED');
            }
            assertActive(signal);
            emit('model.completed', { attemptId: calls });
            const message = { role: 'assistant', content: response.text, toolCalls: response.tools };
            copyModelMessage(message); messages.push(message);
            if (!response.tools.length) return response.text;
            if (response.tools.length > 1 && response.tools.some(call => interactionPort?.isControl(call))) {
                for (const call of response.tools) messages.push({ role: 'tool', callId: call.callId, result: { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Clarification must be the only tool call in this response; no tools were executed.', retryable: false }, effectState: 'not_started' } });
                if (++corrections > budget.corrections) exhausted('corrections');
                continue;
            }
            // Every accepted request gets a result, except a host-paused read resumed after authorization.
            const answer = await executeCalls(response.tools);
            if (answer !== null) return answer;
        }
    }
    const timer = clock.setTimeout(() => controller.abort('TIMEOUT'), budget.timeMs);
    const completion = Promise.resolve().then(async () => {
        let answer = null, error = null;
        try {
            assertActive(signal); move('running'); emit('run.started');
            coverageEvent('planned');
            // Only pre-run history is eligible. Never rewrite a resumed tool or
            // reasoning trajectory, and never compact based solely on its length.
            if (!resume && !summaryOnly && contextConfig?.autoSummary && (prepareCompaction || autoCompactionBlocked)) {
                const request = requestFor();
                const measured = model.inspect ? model.inspect(request, modelContext) : measurePayload(request);
                if (compactionPressure(measured, contextConfig)) {
                    // A failed/no-op attempt must not silently trim this history
                    // to force a hard-limit request through.
                    protectedHistory = true;
                    if (autoCompactionBlocked) {
                        emit('run.context', { phase: 'auto_compaction_blocked' });
                        if (measured.requestBytes > MAX_REQUEST_BYTES || contextConfig.inputTokens !== null && measured.estimatedTokens > contextConfig.inputTokens) throw new ExecutionError('AUTO_COMPACTION_BLOCKED');
                    } else if (!compaction) compaction = prepareCompaction?.() || null;
                }
            }
            const summary = await compact();
            answer = summaryOnly ? summary : await loop(); assertActive(signal); move(interaction ? 'yielded' : 'succeeded');
        } catch (e) {
            error = signal.aborted ? (signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED') : e instanceof ExecutionError ? e.code : 'INTERNAL_ERROR';
            if (error === 'TIMEOUT') reason = 'run_time';
            if (error === 'MODEL_OUTPUT_TRUNCATED') reason = 'model_output';
            if (error === 'CANCELLED') { if (state.status === 'running') move('cancelling'); move('cancelled'); }
            else { if (state.status === 'queued') move('interrupted'); else move('failed'); }
        } finally {
            clock.clearTimeout(timer); controller.abort('CANCELLED');
            if (!resumeState) { try { model.releaseContext?.(modelContext); } catch { /* Trusted synchronous provider cleanup cannot replace the result. */ } }
            usageEvent(); emit('run.finished', { status: state.status, error, budget: budgetSnapshot() }); finished = true;
            drain.seal();
        }
        return { state: copyJson(state), answer: error ? null : answer, error, interaction: error ? null : interaction, resume: error ? null : resumeState, messages: history(), usage: { modelCalls: Math.min(calls, budget.modelCalls), toolAttempts: broker.attempts }, budget: budgetSnapshot() };
    });
    return Object.freeze({ completion, drained: drain.drained, cancel() { if (!finished) controller.abort('CANCELLED'); }, snapshot: () => copyJson(state) });
}
