import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_DEFAULTS, estimateTokens, measurePayload, validateContextConfig } from '../../muyu/context/policy.js';
import { planContext, fingerprint, summaryCandidate, usableSummary } from '../../muyu/context/planner.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { validateRecord, summarizeRecord } from '../../muyu/sessions/contract.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { importedRecord, parseHistoryImport, exportHistoryRecord } from '../../muyu/sessions/exchange.js';
import { identity, registry, toolId, createClock, flush, deferred, scriptedModel, request, call, done, text } from './helpers/muyu-subject.mjs';

const history = (count = 8) => Array.from({ length: count }, (_, i) => [{ role: 'user', content: `Q${i}`, runId: String(i) }, { role: 'assistant', content: `A${i}`, runId: String(i) }]).flat();
const config = { ...CONTEXT_DEFAULTS, recentTurns: 2 };
function run(steps, extra = {}) {
    const model = scriptedModel(steps), clock = createClock(), events = [];
    const handle = startMuyuRun({ identity, input: 'current', model, clock, registry: registry(), allowedTools: [toolId], policy: () => true, handlers: { [toolId]: () => 1 }, contextConfig: config, onEvent: e => events.push(e), ...extra });
    return { handle, model, clock, events };
}
const candidate = () => { const messages = history(), c = summaryCandidate(messages, config); return { ...c, tail: planContext(messages.slice(c.through), null, config).messages }; };

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
    for (const patch of [{ inputTokens: 1 }, { recentTurns: 25 }, { autoSummary: 1 }, { injected: true }]) assert.throws(() => validateContextConfig({ ...config, ...patch }));
    const settings = {}; let fails = false;
    const store = createContextConfigStore({ getSettings: () => settings, saveSettings: async () => { if (fails) throw Error('private'); } });
    assert.deepEqual(store.read(), CONTEXT_DEFAULTS); await store.save(config); fails = true;
    await assert.rejects(store.save(CONTEXT_DEFAULTS), /CONTEXT_CONFIG_SAVE_FAILED/); assert.deepEqual(store.read(), config);
});

test('Planner preserves complete recent turns, ignores orphans and never splits oversized turns', () => {
    const source = history(), p = planContext(source, null, config);
    assert.deepEqual(p.messages.map(m => m.content), ['Q6', 'A6', 'Q7', 'A7']); assert.equal(p.omitted, 12);
    const orphan = [...source, { role: 'user', content: 'failed', runId: 'failed' }]; assert.deepEqual(planContext(orphan, null, config).messages, p.messages);
    source.at(-1).content = '中'.repeat(15000); assert.equal(planContext(source, null, config).turns, 0);
    assert.equal(planContext(history(), null, config, true).messages.length, 0);
    assert.ok(estimateTokens('中'.repeat(100)) > estimateTokens('a'.repeat(100)));
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
    assert.deepEqual(previousMessages.map(m => m.content), ['Q6', 'A6', 'Q7', 'A7']);
    assert.equal(s.clock.pending, 0);
});

test('Summary failure falls back; insufficient call budget skips summary, never spends an extra call', async () => {
    const prior = planContext(history(), null, config).messages;
    const s = run([() => { throw Error('private failure'); }, [text('fallback'), done]], { previousMessages: prior, compaction: candidate() });
    assert.equal((await s.handle.completion).answer, 'fallback'); assert.deepEqual(s.model.requests[1].messages.slice(0, 4), prior);
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
