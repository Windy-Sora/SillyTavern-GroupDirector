import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_DEFAULTS, estimateTokens, measurePayload, validateContextConfig, projectCoverage } from '../../muyu/context/policy.js';
import { planContext, fingerprint, summaryCandidate, usableSummary } from '../../muyu/context/planner.js';
import { compactionRequest } from '../../muyu/context/compaction.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { createHistoryModule } from '../../muyu/modules/history/index.js';
import { copyJson } from '../../muyu/core/json-contract.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { validateRecord, summarizeRecord } from '../../muyu/sessions/contract.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { importedRecord, parseHistoryImport, exportHistoryRecord } from '../../muyu/sessions/exchange.js';
import { identity, registry, toolId, createClock, flush, deferred, scriptedModel, request, call, done, text } from './helpers/muyu-subject.mjs';

const history = (count = 8) => Array.from({ length: count }, (_, i) => [{ role: 'user', content: `Q${i}`, runId: String(i) }, { role: 'assistant', content: `A${i}`, runId: String(i) }]).flat();
const config = { ...CONTEXT_DEFAULTS, inputTokens: 32000, recentTurns: 2 };
function run(steps, extra = {}) {
    const model = scriptedModel(steps), clock = createClock(), events = [];
    const handle = startMuyuRun({ identity, input: 'current', model, clock, registry: registry(), allowedTools: [toolId], policy: () => true, handlers: { [toolId]: () => 1 }, contextConfig: config, onEvent: e => events.push(e), ...extra });
    return { handle, model, clock, events };
}
const candidate = () => { const messages = history(), c = summaryCandidate(messages, config); return { ...c, tail: planContext(messages.slice(c.through), null, config).messages }; };

test('Coverage counts distinguish a raw window, continuous summary tail, blocking and explicit omission', () => {
    const source = history(), old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old', createdAt: 1 };
    assert.deepEqual(planContext(source, null, config).coverage, { state: 'complete', total: 16, summarized: 0, raw: 16, omitted: 0, excluded: 0 });
    assert.deepEqual(planContext(source, old, config).coverage, { state: 'complete', total: 16, summarized: 2, raw: 14, omitted: 0, excluded: 0 });
    const blocked = planContext(history(2000), { ...old, fingerprint: fingerprint(history(2000).slice(0, 2)) }, config).coverage;
    assert.equal(blocked.state, 'blocked'); assert.equal(blocked.raw, 0); assert.ok(projectCoverage(blocked));
    assert.deepEqual(planContext(source, old, config, true).coverage, { state: 'omitted', total: 16, summarized: 0, raw: 0, omitted: 0, excluded: 16 });
    source[0].content = 'edited'; assert.equal(planContext(source, old, config).coverage.summarized, 0);
});

test('Coverage projection is closed and rejects impossible counts rather than recording private data', () => {
    const safe = { state: 'complete', total: 4, summarized: 2, raw: 2, omitted: 0, excluded: 0 };
    assert.deepEqual(projectCoverage({ ...safe, text: 'PRIVATE', fingerprint: 'PRIVATE' }), safe);
    for (const patch of [{ total: 3 }, { raw: -1 }, { state: 'PRIVATE' }, { state: 'blocked' }, { total: 5000 }, { raw: NaN }]) assert.equal(projectCoverage({ ...safe, ...patch }), null);
});

test('A claimed summary prefix includes failed-turn originals between complete turns', () => {
    const source = history(); source.splice(2, 0, { role: 'user', content: 'Cancelled question revised the constraint to 4200', runId: 'cancelled' });
    const candidate = summaryCandidate(source, config);
    assert.deepEqual(candidate.messages, source.slice(0, candidate.through).map(({ role, content }) => ({ role, content })));
    assert.match(JSON.stringify(candidate.messages), /4200/);
    const old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old', createdAt: 1 };
    const extension = summaryCandidate(source, config, old);
    assert.deepEqual(extension.messages.slice(1), source.slice(2, extension.through).map(({ role, content }) => ({ role, content })));
});

test('BUG-STRESS-1: failed or skipped extension retains every correction after the old summary', async () => {
    const source = history(10); source[4].content = 'Budget revised to 4200; disregard 3700';
    const old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'Budget 3700', createdAt: 1 };
    const plan = planContext(source, old, config), c = summaryCandidate(source, config, old);
    assert.equal(plan.omitted, 0); assert.equal(plan.needsSummary, false);
    assert.equal(plan.messages.length, 19);
    const compaction = { ...c, tail: source.slice(c.through).map(({ role, content }) => ({ role, content })) };
    for (const skip of [false, true]) {
        const s = run(skip ? [[text('answer'), done]] : [() => { throw Error('summary failed'); }, [text('answer'), done]],
            { previousMessages: plan.messages, protectedHistory: plan.protectedHistory, compaction, limits: { modelCalls: skip ? 2 : 4 } });
        assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
        assert.match(JSON.stringify(s.model.requests.at(-1)), /4200/);
        assert.deepEqual(s.model.requests.at(-1).messages.slice(0, 19), plan.messages);
    }
});

test('An uncarryable summary tail stops instead of dispatching a history-gap answer', async () => {
    const source = history(2000), old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old', createdAt: 1 };
    const plan = planContext(source, old, config); assert.equal(plan.historyBlocked, true);
    const s = run([], { previousMessages: plan.messages, protectedHistory: true, historyBlocked: true, limits: { modelCalls: 2 } });
    assert.equal((await s.handle.completion).error, 'CONTEXT_INCOMPLETE'); assert.equal(s.model.requests.length, 0);
    const model = scriptedModel([]); model.inspect = req => ({ ...measurePayload(req), estimatedTokens: 999999 });
    const full = planContext(history(), { through: 2, fingerprint: fingerprint(history().slice(0, 2)), text: 'old', createdAt: 1 }, config);
    const trim = run([], { model, previousMessages: full.messages, protectedHistory: true });
    assert.equal((await trim.handle.completion).error, 'CONTEXT_INCOMPLETE'); assert.equal(model.requests.length, 0);
});

test('Truncated automatic summary retries once with a fresh context and reserves an answer call', async () => {
    const contexts = [], requests = [], released = [];
    const model = { async *run(req, { context }) {
        contexts.push(context); requests.push(req);
        if (requests.length === 1) throw new ExecutionError('MODEL_OUTPUT_TRUNCATED');
        yield text(requests.length === 2 ? 'summary' : 'answer'); yield done;
    }, releaseContext: value => released.push(value) };
    const s = run([], { model, compaction: candidate(), maxTokens: 8192, limits: { modelCalls: 3 } });
    assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
    assert.deepEqual(requests.map(r => r.maxTokens), [4096, 8192, 8192]);
    assert.notEqual(contexts[0], contexts[1]); assert.ok(released.includes(contexts[0]));
    const process = createProcessStore(); process.create(identity.id); s.events.forEach(e => process.event(identity.id, e));
    assert.equal(process.snapshot(identity.id).summaryUsage.calls, 2);
    const capped = run([() => { throw new ExecutionError('MODEL_OUTPUT_TRUNCATED'); }, [text('answer'), done]], { compaction: candidate(), maxTokens: 256 });
    assert.equal((await capped.handle.completion).answer, 'answer'); assert.equal(capped.model.requests.length, 2);
});

test('A partial successful summary never drops an oversized remaining tail', async () => {
    const c = candidate(); c.tail = Array.from({ length: 3841 }, () => ({ role: 'user', content: 'raw' }));
    const saved = [], s = run([[text('summary'), done]], { compaction: c, onSummary: value => saved.push(value) });
    assert.equal((await s.handle.completion).error, 'CONTEXT_INCOMPLETE'); assert.equal(saved.length, 1); assert.equal(s.model.requests.length, 1);
});

test('Operation facts survive summary replacement as bounded independent application data', async () => {
    const receipt = { operationId: 'op', artifactId: 'a', revision: 1, at: 1, status: 'outcome_unknown', diff: [], saveError: true, changed: true };
    const s = run([[text('summary'), done], [text('answer'), done]], { previousMessages: planContext(history(), null, config).messages, compaction: candidate(), applicationResults: [receipt] });
    assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
    assert.doesNotMatch(JSON.stringify(s.model.requests[0]), /operationId/);
    assert.match(JSON.stringify(s.model.requests[1]), /outcome_unknown/);
    assert.equal(s.model.requests[1].messages.filter(m => m.content?.includes('operationId')).length, 1);
    const model = scriptedModel([]); model.inspect = req => ({ ...measurePayload(req), estimatedTokens: req.messages.some(m => m.content?.includes('operationId')) ? 999999 : 1 });
    const limited = run([], { model, applicationResults: [receipt] });
    assert.equal((await limited.handle.completion).error, 'CONTEXT_LIMIT'); assert.equal(model.requests.length, 0);
});

test('Context config has closed bounds and persistence failure restores the previous policy', async () => {
    for (const patch of [{ inputTokens: 1 }, { inputTokens: 1000001 }, { recentTurns: 25 }, { autoSummary: 1 }, { injected: true }]) assert.throws(() => validateContextConfig({ ...config, ...patch }));
    assert.equal(validateContextConfig(CONTEXT_DEFAULTS).inputTokens, 900000);
    assert.equal(validateContextConfig({ ...config, inputTokens: 1000000 }).inputTokens, 1000000);
    const settings = {}; let fails = false;
    const store = createContextConfigStore({ getSettings: () => settings, saveSettings: async () => { if (fails) throw Error('private'); } });
    assert.deepEqual(store.read(), CONTEXT_DEFAULTS); await store.save(config); fails = true;
    await assert.rejects(store.save(CONTEXT_DEFAULTS), /CONTEXT_CONFIG_SAVE_FAILED/); assert.deepEqual(store.read(), config);
});

test('Automatic input budget does not guess the model window but retains the request byte guard', async () => {
    const inspect = request => ({ ...measurePayload(request), estimatedTokens: 35886 });
    const autoModel = scriptedModel([[text('answer'), done]]); autoModel.inspect = inspect;
    const auto = run([], { model: autoModel, contextConfig: { ...CONTEXT_DEFAULTS, inputTokens: null } });
    assert.equal((await auto.handle.completion).answer, 'answer');
    assert.equal(autoModel.requests[0].inputTokenLimit, undefined);
    const manualModel = scriptedModel([]); manualModel.inspect = inspect;
    const manual = run([], { model: manualModel, contextConfig: { ...CONTEXT_DEFAULTS, inputTokens: 32000 } });
    assert.equal((await manual.handle.completion).error, 'CONTEXT_LIMIT');
    assert.equal(manualModel.requests.length, 0);
    const hugeModel = scriptedModel([]);
    hugeModel.inspect = request => ({ ...measurePayload(request), estimatedTokens: 100, requestBytes: 8388609 });
    const huge = run([], { model: hugeModel, contextConfig: CONTEXT_DEFAULTS });
    assert.equal((await huge.handle.completion).error, 'CONTEXT_LIMIT');
    assert.equal(hugeModel.requests.length, 0);
});

test('Process projection preserves manual input limits above the old 128k ceiling', () => {
    const process = createProcessStore(); process.create('large');
    process.event('large', { runId: 'large', seq: 1, type: 'run.context', payload: { phase: 'request', ...measurePayload({ messages: [{ role: 'user', content: 'test' }], tools: [] }), inputTokenLimit: 250000 } });
    assert.equal(process.snapshot('large').context.inputTokenLimit, 250000);
});

test('Planner preserves complete recent turns, ignores orphans and never splits oversized turns', () => {
    const source = history(), p = planContext(source, null, config);
    assert.deepEqual(p.messages.map(m => m.content), history().map(m => m.content)); assert.equal(p.omitted, 0);
    const orphan = [...source, { role: 'user', content: 'failed', runId: 'failed' }]; assert.deepEqual(planContext(orphan, null, config).messages, p.messages);
    source.at(-1).content = '中'.repeat(22000); assert.equal(planContext(source, null, config).turns, 0);
    assert.equal(planContext(history(), null, config, true).messages.length, 0);
    assert.ok(estimateTokens('中'.repeat(100)) > estimateTokens('a'.repeat(100)));
});

test('A long recent answer uses a large configured window or one whole-turn summary', () => {
    const messages = [{ role: 'user', content: 'Draft a plan', runId: 'long' }, { role: 'assistant', content: '中'.repeat(9000), runId: 'long' }];
    const large = { inputTokens: 128000, recentTurns: 12, autoSummary: false };
    assert.equal(planContext(messages, null, large).turns, 1);
    assert.equal(planContext(messages, null, large).omitted, 0);
    const normal = { ...large, inputTokens: 15000, autoSummary: true };
    assert.equal(planContext(messages, null, normal).turns, 0);
    const candidate = summaryCandidate(messages, normal);
    assert.equal(candidate?.through, 2);
    assert.equal(candidate.messages[1].content, messages[1].content);
    copyJson(compactionRequest(candidate, normal.inputTokens).messages[0]);
});

test('A summary request carries a whole long turn through bounded ordered segments', () => {
    const source = [{ role: 'user', content: '请梳理', runId: 'long' }, { role: 'assistant', content: '长段落😀'.repeat(5600), runId: 'long' }];
    const setting = { inputTokens: 128000, recentTurns: 2, autoSummary: true };
    const item = summaryCandidate(source, setting);
    assert.equal(item?.through, 2);
    const request = compactionRequest(item, setting.inputTokens);
    assert.ok(request.messages.length > 3);
    for (const message of request.messages) copyJson(message);
    const segments = request.messages.slice(1).map(message => JSON.parse(message.content));
    for (const [index, original] of source.entries()) {
        const parts = segments.filter(part => part.sourceIndex === index);
        assert.equal(parts[0].start, 0);
        assert.equal(parts.at(-1).end, original.content.length);
        assert.equal(parts.map(part => part.text).join(''), original.content);
        for (let n = 1; n < parts.length; n++) assert.equal(parts[n - 1].end, parts[n].start);
    }
    assert.deepEqual(JSON.parse(compactionRequest({ messages: [{ role: 'user', content: '' }] }, setting.inputTokens).messages[1].content),
        { sourceIndex: 0, role: 'user', start: 0, end: 0, total: 0, text: '' });
});

test('Original history tool is paged, bounded, stale-checked and guarded at each read', () => {
    const messages = [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '答案😀'.repeat(1200) }];
    let allowed = true;
    const module = createHistoryModule({ access: () => allowed ? messages : null });
    const ctx = { runId: 'run', target: { kind: 'chat', chatKey: 'A' } };
    const list = module.handlers['muyu.history.list']({ offset: 0 }, ctx);
    assert.equal(list.total, 2);
    const first = module.handlers['muyu.history.read']({ index: 1, fingerprint: list.items[1].fingerprint, start: 0 }, ctx);
    assert.equal(first.text.length, 4000);
    assert.ok(first.nextOffset > 0);
    const second = module.handlers['muyu.history.read']({ index: 1, fingerprint: list.items[1].fingerprint, start: first.nextOffset }, ctx);
    assert.equal(first.text + second.text, messages[1].content);
    assert.throws(() => module.handlers['muyu.history.read']({ index: 1, fingerprint: 'stale', start: 0 }, ctx), /HISTORY_STALE/);
    allowed = false;
    assert.throws(() => module.handlers['muyu.history.list']({ offset: 0 }, ctx), /HISTORY_UNAVAILABLE/);
});

test('Rolling summary extends a bounded contiguous prefix and invalidates when source changes', () => {
    const source = history(), c = summaryCandidate(source, config), summary = { through: c.through, fingerprint: c.fingerprint, text: 'reference', createdAt: 1 };
    assert.equal(c.through, 12); assert.ok(usableSummary(summary, source));
    assert.equal(planContext(source, summary, config).omitted, 0);
    const extended = [...source, ...history(2).map(m => ({ ...m, runId: 'new' + m.runId }))];
    const next = summaryCandidate(extended, config, summary); assert.equal(next.through, 16); assert.match(next.messages[0].content, /reference/);
    source[0].content = 'edited'; assert.equal(usableSummary(summary, source), false); assert.equal(planContext(source, summary, config).summaryUsed, false);
});

test('V2 upgrade keeps originals, summary stays out of index and is validated separately', () => {
    const source = history(), value = { version: 2, id: crypto.randomUUID(), revision: 0, scope: JSON.stringify(['chat', 'chat', 'A']), title: 'old', createdAt: 1, updatedAt: 1, messages: source, required: [], status: 'idle', archived: false, imported: false };
    const current = validateRecord(value); assert.equal(current.version, 3); assert.equal(current.contextSummary, null);
    current.contextSummary = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'summary', createdAt: 1 };
    assert.deepEqual(validateRecord(current).messages, source); assert.equal(Object.hasOwn(summarizeRecord(current), 'contextSummary'), false);
    assert.throws(() => validateRecord({ ...current, contextSummary: { ...current.contextSummary, authority: true } }), /HISTORY_INVALID/);
});

test('Automatic summary has no tools, counts against run budget, and preserves original prior messages', async () => {
    const previousMessages = planContext(history(), null, config).messages, saved = [];
    const s = run([[text('summary'), done], [text('answer'), done]], { previousMessages, compaction: candidate(), maxTokens: 256, onSummary: v => saved.push(v) });
    const result = await s.handle.completion; await s.handle.drained;
    assert.equal(result.answer, 'answer'); assert.equal(result.budget.modelCalls, 2); assert.equal(saved.length, 1);
    assert.deepEqual(s.model.requests[0].tools, []); assert.match(s.model.requests[1].messages[0].content, /summary/);
    assert.equal(s.model.requests[0].maxTokens, 256);
    assert.deepEqual(previousMessages.map(m => m.content), history().map(m => m.content));
    assert.equal(s.clock.pending, 0);
});

test('Summary failure falls back; insufficient call budget skips summary, never spends an extra call', async () => {
    const prior = planContext(history(), null, config).messages;
    const s = run([() => { throw Error('private failure'); }, [text('fallback'), done]], { previousMessages: prior, compaction: candidate() });
    assert.equal((await s.handle.completion).answer, 'fallback'); assert.deepEqual(s.model.requests[1].messages.slice(0, prior.length), prior);
    assert.ok(s.events.some(e => e.payload.phase === 'summary_failed'));
    const small = run([[text('direct'), done]], { previousMessages: prior, compaction: candidate(), limits: { modelCalls: 2 } });
    assert.equal((await small.handle.completion).budget.modelCalls, 1); assert.ok(small.model.requests[0].tools.length);
});

test('Summary cancellation and timeout never launch a fallback while upstream is still draining', async () => {
    for (const cancelled of [true, false]) {
        const gate = deferred(), saved = [], s = run([() => gate.promise], { compaction: candidate(), onSummary: v => saved.push(v) });
        await flush(); if (cancelled) s.handle.cancel(); else s.clock.advance(30000);
        await flush(); assert.equal((await s.handle.completion).error, cancelled ? 'CANCELLED' : 'TIMEOUT');
        let drained = false; s.handle.drained.then(() => { drained = true; }); await flush(); assert.equal(drained, false);
        gate.resolve([text('late'), done]); await s.handle.drained; assert.equal(s.model.requests.length, 1); assert.equal(saved.length, 0);
    }
});

test('Initial preflight removes full old turns but current oversize input is blocked before model dispatch', async () => {
    const cfg = { ...config, inputTokens: 4096 };
    const s = run([[text('answer'), done]], { contextConfig: cfg, previousMessages: [{ role: 'user', content: 'x'.repeat(7000) }, { role: 'assistant', content: 'x'.repeat(7000) }] });
    assert.equal((await s.handle.completion).answer, 'answer'); assert.equal(s.model.requests[0].messages.length, 1);
    const sent = s.events.find(e => e.type === 'run.context' && e.payload.phase === 'request');
    assert.equal(sent.payload.historicalMessages, 0); assert.equal(sent.payload.trimmedHistoricalMessages, 2);
    const process = createProcessStore(); process.create(identity.id);
    for (const event of s.events) process.event(identity.id, event);
    assert.equal(process.snapshot(identity.id).context.trimmedHistoricalMessages, 2);
    const large = run([], { contextConfig: cfg, input: '中'.repeat(5000) });
    assert.equal((await large.handle.completion).error, 'CONTEXT_LIMIT'); assert.equal(large.model.requests.length, 0);
});

test('Live tool history cannot be trimmed; adapter measurement includes private overhead on every request', async () => {
    const model = scriptedModel([[request(call()), done]]);
    model.inspect = req => ({ ...measurePayload(req), estimatedTokens: req.messages.some(m => m.role === 'tool') ? 40000 : 100 });
    const s = run([], { model }); const result = await s.handle.completion;
    assert.equal(result.error, 'CONTEXT_LIMIT'); assert.equal(model.requests.length, 1); assert.equal(result.messages.at(-1).role, 'tool');
    const process = createProcessStore(); process.create(identity.id); for (const event of s.events) process.event(identity.id, event);
    assert.equal(process.snapshot(identity.id).context.estimatedTokens, 40000); assert.equal(process.snapshot(identity.id).error, 'CONTEXT_LIMIT');
    assert.doesNotMatch(JSON.stringify(process.snapshot(identity.id)), /current|callId|reasoning_content/);
});

test('Manual summary is one tool-free call and cannot execute a requested tool', async () => {
    const saved = [], s = run([[request(call()), done]], { summaryOnly: true, compaction: candidate(), onSummary: v => saved.push(v), limits: { modelCalls: 1 } });
    assert.equal((await s.handle.completion).error, 'MODEL_PROTOCOL_ERROR'); assert.equal(saved.length, 0); assert.equal(s.model.requests.length, 1);
});

test('Summary updates stay in memory when automatic saves are off; JSON backup remains read-only', async () => {
    const store = createMemoryHistoryStore(), port = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const library = createSessionLibrary({ port }); await library.ready;
    const id = library.create(JSON.stringify(['chat', 'chat', 'A'])); library.update(id, { messages: history() }); await library.flush();
    await library.setEnabled(false); const c = candidate(), summary = { through: c.through, fingerprint: c.fingerprint, text: 'reference', createdAt: 1 };
    library.update(id, { contextSummary: summary }); await library.flush();
    assert.equal((await store.read(id)).contextSummary, null); assert.equal(library.get(id).contextSummary.text, 'reference');
    const imported = importedRecord(parseHistoryImport(exportHistoryRecord(library.get(id))));
    assert.equal(imported.imported, true); assert.notEqual(imported.id, id); assert.equal(imported.contextSummary.text, 'reference');
    await library.setEnabled(true); await library.flush(); assert.equal((await store.read(id)).contextSummary.text, 'reference');
    library.update(id, { contextSummary: null }); await library.flush(); assert.equal((await store.read(id)).contextSummary, null); await library.close();
});

test('A protocol-failed summary drains its iterator before a fallback request may start', async () => {
    const gate = deferred(); let calls = 0;
    const model = { async *run() { calls++; if (calls === 1) { try { yield request(call()); } finally { await gate.promise; } } else { yield text('fallback'); yield done; } } };
    const s = run([], { model, compaction: candidate() }); await flush(); assert.equal(calls, 1);
    gate.resolve(); assert.equal((await s.handle.completion).answer, 'fallback'); await s.handle.drained; assert.equal(calls, 2);
});
