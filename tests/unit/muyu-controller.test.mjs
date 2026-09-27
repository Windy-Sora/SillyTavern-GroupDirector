import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { scriptedModel, text, done, deferred, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args = {}) => ({ type: 'tool_call_complete', call: { toolId, callId: 'c1', version: toolId.startsWith('muyu.provider.') ? 2 : 1, args } });

const ask = () => tool('muyu.interaction.ask', { question: 'Which part?', options: ['Frequency', 'Content'] });
test('Ordinary chat queries config only with diagnostics permission; history cannot bypass revocation', async () => {
    let f, reads = 0;
    const port = createProviderPort({ getSettings: () => { reads++; return f.settings; }, getContext: () => f.ctx, extensionKey: 'gd' });
    const read = () => tool('muyu.provider.read', { id: 'memoryConfig', selector: '', revision: '', offset: 0 });
    f = fixture([[read(), done], [text('no diagnostics'), done], [read(), done], [text('current config'), done]], { providerPort: port });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('current interval');
    f.controller.send({ consent: true }); await settle(); assert.equal(reads, 0);
    assert.match(JSON.stringify(f.model.requests[1]), /PERMISSION_DENIED/);
    f.controller.grantPermission('diagnostics'); f.controller.setInput('read again'); f.controller.send(); await settle();
    assert.ok(reads > 0); assert.match(JSON.stringify(f.model.requests.at(-1)), /current-memory/);
    const id = JSON.parse(f.controller.exportHistory()).id;
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('diagnostics'));
    await f.controller.revokePermission('diagnostics'); await f.controller.openSession(id);
    f.controller.setInput('again'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    await f.controller.dispose();
});

test('Receipt check uses Provider without model or writing, survives view changes and sees later edits', async () => {
    let f, writer, writes = 0;
    const port = createProviderPort({ getSettings: () => f.settings, getContext: () => f.ctx, extensionKey: 'gd' });
    f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done]], { providerPort: port, configWriter: { apply: value => { writes++; return writer.apply(value); } } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => {} });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const owner = JSON.parse(f.controller.exportHistory()).id, a = f.controller.snapshot().artifacts[0];
    const r = f.controller.prepareConfigApply(a.id, a.revision); await f.controller.approveConfigApply(r.id);
    f.ctx.chatId = ''; f.controller.setInput('preserved');
    await f.controller.checkReceipt(r.id);
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'matched');
    assert.equal(f.controller.snapshot().input, 'preserved');
    assert.equal(f.controller.snapshot().artifacts.length, 1);
    f.settings.autoMemoryInterval = 25;
    const pending = f.controller.checkReceipt(r.id); f.controller.newSession(); f.controller.setInput('other'); await pending;
    assert.deepEqual(f.controller.snapshot().configChecks, {}); assert.equal(f.controller.snapshot().input, 'other');
    await f.controller.openSession(owner);
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'different');
    assert.equal(f.controller.snapshot().configChecks[r.id].fields[0].actual, '25');
    f.settings.autoMemoryInterval = 'invalid'; await f.controller.checkReceipt(r.id);
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'unknown');
    assert.equal(f.model.requests.length, 2); assert.equal(writes, 1);
    const cancelled = f.controller.checkReceipt(r.id); f.controller.stop(); await cancelled;
    assert.equal(f.controller.snapshot().configChecks[r.id].state, 'unknown');
    await f.controller.revokePermission('diagnostics'); await f.controller.openSession(owner);
    await assert.rejects(f.controller.checkReceipt(r.id), /CONSENT_REQUIRED/);
    await f.controller.dispose();
});
test('Receipt explanation is explicit, tool-free, retryable without writes and preserves the composer', async () => {
    let writer, saves = 0;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done],
        () => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }, [text('Persistence unconfirmed'), done], [text('fresh'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; throw Error('save failed'); } });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const a = f.controller.snapshot().artifacts[0], r = f.controller.prepareConfigApply(a.id, a.revision);
    await f.controller.approveConfigApply(r.id);
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.controller.snapshot().receipts.length, 1);
    assert.equal(f.controller.snapshot().receipts[0].saveError, true);
    f.controller.snapshot().receipts[0].status = 'cancelled';
    assert.equal(f.controller.snapshot().receipts[0].status, 'applied_unconfirmed');
    f.controller.setInput('UNSAVED COMPOSER'); f.controller.explainReceipt(r.id); await settle();
    assert.equal(f.controller.snapshot().receiptExplanations[r.id], 'failed');
    f.controller.explainReceipt(r.id); await settle();
    assert.equal(f.controller.snapshot().receiptExplanations[r.id], 'succeeded');
    assert.equal(f.controller.snapshot().input, 'UNSAVED COMPOSER');
    assert.equal(saves, 1); assert.equal(f.controller.snapshot().artifacts.length, 1);
    assert.deepEqual(f.model.requests.at(-1).tools, []);
    assert.match(f.model.requests.at(-1).instructions.task, /本轮只解释/);
    assert.doesNotMatch(f.model.requests.at(-1).instructions.task, /character:N|range:START/);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /applied_unconfirmed/);
    assert.equal(JSON.parse(f.controller.exportHistory()).receipts.length, 1);
    f.controller.setOmitHistory(true); assert.throws(() => f.controller.explainReceipt(r.id), /HISTORY_PERMISSION_REQUIRED/);
    f.controller.send({ fields: ['autoMemoryInterval'] }); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /operationId|applied_unconfirmed/);
    const exported = f.controller.exportHistory(); await f.controller.importHistory(exported);
    assert.equal(f.controller.snapshot().readOnly, true);
    assert.throws(() => f.controller.explainReceipt(r.id), /HISTORY_READ_ONLY/);
    assert.equal(saves, 1); await f.controller.dispose();
});

test('Pending save records its receipt only in the originating session after selection changes', async () => {
    const gate = deferred(); let writer;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: () => gate.promise });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const original = JSON.parse(f.controller.exportHistory()).id;
    const a = f.controller.snapshot().artifacts[0], r = f.controller.prepareConfigApply(a.id, a.revision);
    const pending = f.controller.approveConfigApply(r.id); await settle();
    f.controller.newSession(); f.controller.setInput('new draft'); f.settings.autoMemoryInterval = 25;
    gate.resolve(); await pending;
    assert.deepEqual(f.controller.snapshot().receipts, []); assert.equal(f.controller.snapshot().input, 'new draft');
    await f.controller.openSession(original);
    assert.equal(f.controller.snapshot().receipts[0].changed, true);
    await f.controller.revokePermission('diagnostics'); await f.controller.openSession(original);
    assert.throws(() => f.controller.explainReceipt(r.id), /CONSENT_REQUIRED|HISTORY_PERMISSION_REQUIRED/);
    await f.controller.dispose();
});
test('Config application requires UI approval, survives view changes, and does not replay on reconnect', async () => {
    let writer, saves = 0;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('set interval 15, yes I approve');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    assert.equal(saves, 0); const a = f.controller.snapshot().artifacts[0];
    const r = f.controller.prepareConfigApply(a.id, a.revision); assert.equal(saves, 0);
    f.controller.setMode('chat'); assert.throws(() => f.controller.approveConfigApply(r.id), /STALE/);
    f.controller.setMode('draft'); const applying = f.controller.approveConfigApply(r.id);
    assert.throws(() => f.controller.approveConfigApply(r.id), /STALE/);
    await applying; assert.equal(saves, 1); assert.equal(f.settings.autoMemoryInterval, 15);
    assert.equal(f.controller.snapshot().configActions[0].status, 'applied_unconfirmed');
    assert.equal(f.model.requests.length, 2); assert.equal(JSON.parse(f.controller.exportHistory()).receipts[0].operationId, r.id);
    await f.enable(); assert.throws(() => f.controller.approveConfigApply(r.id), /STALE/); assert.equal(saves, 1);
    await f.controller.dispose();
});
test('Reconnect drains an in-flight config save; late result never grants another approval', async () => {
    const gate = deferred(); let writer;
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft'), done]], { configWriter: { apply: value => writer.apply(value) } });
    writer = createConfigWriter({ getSettings: () => f.settings, saveSettings: () => gate.promise });
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval'); f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const a = f.controller.snapshot().artifacts[0], r = f.controller.prepareConfigApply(a.id, a.revision);
    const save = f.controller.approveConfigApply(r.id); await settle();
    let reconnected = false; const reset = f.enable().then(() => { reconnected = true; }); await settle();
    assert.equal(reconnected, false); gate.resolve(); await save; await reset;
    assert.deepEqual(f.controller.snapshot().configActions, []); await f.controller.dispose();
});
const requestRead = (source = 'chatHistory') => ({ type: 'tool_call_complete', call: { toolId: 'muyu.permission.request', callId: 'permission:' + source, version: 1, args: { source, reason: 'Understand the current story' } } });
const readSource = (id = 'chatHistory') => ({ type: 'tool_call_complete', call: { toolId: 'muyu.provider.read', callId: 'read:' + id, version: 2, args: { id, selector: '', revision: '', offset: 0 } } });

test('On-demand task grant reads only the selected source, expires, and guards history and summaries', async () => {
    const reads = [];
    const f = fixture([[readSource(), done], [requestRead(), done], [readSource(), done], [readSource('characters'), done], [text('protected answer'), done], [text('public followup'), done]], {
        providerPort: { available() { throw Error('Catalog must not inspect host'); }, read(id) { reads.push(id); return { text: 'PROTECTED_SOURCE', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('analyze'); f.controller.send(); await settle();
    assert.deepEqual(reads, []); assert.match(JSON.stringify(f.model.requests[1]), /PERMISSION_REQUIRED/);
    const r = f.controller.snapshot().interaction; assert.equal(r.kind, 'permission');
    assert.throws(() => f.controller.send({ interactionId: r.id }), /STALE/);
    f.controller.answerPermission(r.id, 'task'); assert.throws(() => f.controller.answerPermission(r.id, 'task'), /STALE/); await settle();
    assert.deepEqual(reads, ['chatHistory']);
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'protected answer');
    const exported = JSON.parse(f.controller.exportHistory()); assert.ok(exported.required.includes('source:chatHistory'));
    assert.doesNotMatch(f.controller.exportHistory(), /Permission request resolved by the application/);
    f.controller.setInput('another task'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    await assert.rejects(f.controller.compactHistory(), /HISTORY_PERMISSION_REQUIRED/);
    f.controller.setOmitHistory(true); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_SOURCE|protected answer/);
    await f.controller.dispose();
});
test('Denied permission continues without reading or repeated prompts', async () => {
    let reads = 0;
    const f = fixture([[requestRead(), done], [requestRead(), done], [readSource(), done], [text('No access; conditional answer'), done]], { providerPort: { read() { reads++; } } });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle();
    assert.equal(reads, 0); assert.equal(f.controller.snapshot().interaction.status, 'denied');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'No access; conditional answer');
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PERMISSION_DENIED/); await f.controller.dispose();
});
test('Mixed authorization batch never executes a source reader or opens a permission card', async () => {
    let reads = 0;
    const f = fixture([[requestRead(), readSource(), done], [text('retry later'), done]], { providerPort: { read() { reads++; } } });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    assert.equal(reads, 0); assert.equal(f.controller.snapshot().interaction, null);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /INVALID_ARGUMENT/); await f.controller.dispose();
});
test('Omitting protected history remains effective through permission and clarification handoffs', async () => {
    const f = fixture([[requestRead(), done], [text('OLD_PRIVATE_ANSWER'), done], [requestRead('characters'), done], [ask(), done], [text('new answer'), done]]);
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('first'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    f.controller.setOmitHistory(true); f.controller.setInput('new task'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    const q = f.controller.snapshot().interaction; f.controller.setInteractionDraft(q.id, 'new details'); f.controller.answerInteraction(q.id); await settle();
    for (const r of f.model.requests.slice(2)) assert.doesNotMatch(JSON.stringify(r), /OLD_PRIVATE_ANSWER/);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /new details/); await f.controller.dispose();
});
test('Chat grant is reused only in its chat; revoke and reconnect remove it', async () => {
    let reads = 0;
    const f = fixture([[requestRead(), done], [text('allowed'), done], [readSource(), done], [text('read'), done]], { providerPort: { read() { reads++; return { text: 'body', limited: false }; } } });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'chat'); await settle();
    assert.deepEqual(f.controller.snapshot().sourceGrants, ['source:chatHistory']);
    f.controller.setInput('read again'); f.controller.send(); await settle(); assert.equal(reads, 1);
    f.switchChat('B'); assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.switchChat('A'); await f.controller.revokePermission('source:chatHistory'); assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    await f.enable(); assert.deepEqual(f.controller.snapshot().sourceGrants, []); await f.controller.dispose();
});
test('Stale authorization cannot target another chat or survive cancellation', async () => {
    const f = fixture([[requestRead(), done], [requestRead(), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('help'); f.controller.send(); await settle(); const id = f.controller.snapshot().interaction.id;
    f.switchChat('B'); assert.throws(() => f.controller.answerPermission(id, 'chat'), /STALE/);
    f.switchChat('A'); assert.throws(() => f.controller.answerPermission(id, 'chat'), /STALE/);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.setInput('again'); f.controller.send(); await settle(); const next = f.controller.snapshot().interaction.id;
    f.controller.stop(); assert.throws(() => f.controller.answerPermission(next, 'task'), /STALE/);
    await f.controller.dispose();
});
test('Permission and clarification share a six-handoff ceiling', async () => {
    const sources = ['chatHistory', 'characters', 'directorLedger'];
    const steps = sources.flatMap(id => [[requestRead(id), done], [ask(), done]]); steps.push([text('finished'), done]);
    const f = fixture(steps); await f.enable(); f.controller.setMode('chat'); f.controller.setInput('help'); f.controller.send(); await settle();
    for (let i = 0; i < 6; i++) {
        const r = f.controller.snapshot().interaction;
        if (r.kind === 'permission') f.controller.answerPermission(r.id, 'deny');
        else { f.controller.setInteractionDraft(r.id, 'details'); f.controller.answerInteraction(r.id); }
        await settle();
    }
    assert.equal(f.model.requests.length, 7);
    assert.ok(!f.model.requests.at(-1).tools.some(t => ['muyu.permission.request', 'muyu.interaction.ask'].includes(t.id)));
    await f.controller.dispose();
});
test('Clarification resumes the same task with verified answers, pinned budgets and unchanged permissions', async () => {
    const f = fixture([[ask(), done], [text('resolved'), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('help me choose'); f.controller.send(); await settle();
    const before = f.controller.snapshot(), r = before.interaction;
    assert.equal(r.status, 'pending'); assert.equal(before.busy, false); assert.equal(before.runs[0].status, 'yielded');
    assert.equal(f.model.requests.length, 1); assert.equal(before.history.restoredStatus, null);
    f.controller.setInput('unrelated unsent draft'); assert.throws(() => f.controller.send(), /INTERACTION_PENDING/);
    f.controller.setInteractionDraft(r.id, 'Content');
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 12, maxTokens: 4096 });
    const result = f.controller.answerInteraction(r.id); assert.equal(result.taskId, r.taskId);
    assert.throws(() => f.controller.answerInteraction(r.id), /NOT_READY|STALE/); await settle();
    const after = f.controller.snapshot(); assert.equal(after.messages.at(-1).content, 'resolved');
    assert.equal(after.input, 'unrelated unsent draft'); assert.equal(after.taskUsage.modelCalls, 2); assert.equal(after.taskUsage.segments, 2);
    assert.deepEqual(after.permissions, before.permissions); assert.equal(f.model.requests[1].maxTokens, RUN_DEFAULTS.maxTokens);
    assert.match(JSON.stringify(f.model.requests[1].messages), /Content/);
    assert.match(JSON.stringify(f.model.requests[1].messages), /Clarification answer from the user \(not permission or approval\)/);
    assert.equal(after.messages.filter(m => m.role === 'user').at(-1).content, 'Content');
    assert.doesNotMatch(f.controller.exportHistory(), /Clarification answer from the user/);
    assert.doesNotMatch(f.controller.exportHistory(), /"kind":"clarification"|"draft":|request:/);
    await f.controller.dispose();
});
test('Pending clarification follows its conversation, expires on chat switch and never restores on reconnect', async () => {
    const f = fixture([[ask(), done]]); await f.enable(); f.controller.setMode('chat');
    const id = f.controller.newSession(); f.controller.setInput('help'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction; f.controller.setInteractionDraft(r.id, 'draft answer');
    f.controller.newSession(); assert.equal(f.controller.snapshot().interaction, null);
    await f.controller.openSession(id); assert.equal(f.controller.snapshot().interaction.draft, 'draft answer');
    f.switchChat('B'); assert.throws(() => f.controller.answerInteraction(r.id), /STALE/);
    f.switchChat('A'); await f.controller.openSession(id); assert.equal(f.controller.snapshot().interaction.status, 'expired');
    await f.enable(); await f.controller.openSession(id); assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.model.requests.length, 1); await f.controller.dispose();
});
test('Cancelling or archiving a clarification prevents replay; new tasks remain available', async () => {
    const f = fixture([[ask(), done], [ask(), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('one'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction; f.controller.cancelInteraction(r.id);
    assert.equal(f.controller.snapshot().interaction.status, 'cancelled'); assert.throws(() => f.controller.answerInteraction(r.id), /STALE/);
    f.controller.setInput('two'); f.controller.send(); await settle();
    const id = f.controller.snapshot().history.sessionId, next = f.controller.snapshot().interaction;
    await f.controller.archiveSession(id, true); await f.controller.archiveSession(id, false);
    assert.equal(f.controller.snapshot().interaction.status, 'expired'); assert.throws(() => f.controller.answerInteraction(next.id), /STALE/);
    await f.controller.dispose();
});
test('Three clarification limit removes the tool on the fourth execution segment', async () => {
    const f = fixture([[ask(), done], [ask(), done], [ask(), done], [text('conditional answer'), done]]); await f.enable(); f.controller.setMode('chat');
    f.controller.setInput('help'); f.controller.send(); await settle();
    for (let i = 0; i < 3; i++) { const r = f.controller.snapshot().interaction; f.controller.setInteractionDraft(r.id, 'answer ' + i); f.controller.answerInteraction(r.id); await settle(); }
    assert.equal(f.model.requests.length, 4); assert.ok(!f.model.requests[3].tools.some(t => t.id === 'muyu.interaction.ask'));
    assert.equal(f.controller.snapshot().taskUsage.modelCalls, 4); assert.equal(f.controller.snapshot().messages.at(-1).content, 'conditional answer');
    await f.controller.dispose();
});

test('All-task browsing restores task mode; foreign history is read-only and cannot rebind tools', async () => {
    const f = fixture(); await f.enable(); const id = f.controller.newSession(); f.controller.setInput('memory'); f.controller.send({ consent: true }); await settle();
    f.controller.setMode('chat'); assert.ok(f.controller.snapshot().history.sessions.some(s => s.id === id));
    await f.controller.openSession(id); assert.equal(f.controller.snapshot().mode, 'memory');
    f.switchChat('B'); f.controller.setHistoryFilters({ range: 'all' }); await f.controller.openSession(id);
    assert.equal(f.controller.snapshot().readOnly, true); assert.equal(f.host.currentTarget().chatKey.includes('B'), true);
    assert.throws(() => f.controller.setInput('leak'), /HISTORY_READ_ONLY/); assert.throws(() => f.controller.send({ consent: true }), /HISTORY_READ_ONLY/);
    const fresh = f.controller.newSession(); assert.notEqual(fresh, id); assert.equal(f.controller.snapshot().readOnly, false);
    assert.equal(f.model.requests.length, 1); await f.controller.dispose();
});

test('Delete waits for physical cleanup and never accepts late results or loses another draft', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    const id = f.controller.newSession(); f.controller.setInput('pending'); f.controller.send({ consent: true }); await flush();
    const deleting = f.controller.deleteSession(id); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    assert.throws(() => f.controller.newSession(), /NOT_READY/);
    wait.resolve([text('late deleted answer'), done]); await deleting; await settle();
    assert.equal(f.controller.snapshot().messages.length, 0); assert.equal(f.controller.snapshot().history.total, 0);
    await assert.rejects(f.controller.openSession(id), /HISTORY_SCOPE/); await f.controller.dispose();
});

test('Deleting an idle conversation does not cancel another conversation running', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable(); const idle = f.controller.newSession();
    const active = f.controller.newSession(); f.controller.setInput('active'); f.controller.send({ consent: true }); await flush();
    await f.controller.deleteSession(idle); assert.equal(f.controller.snapshot().busy, true);
    wait.resolve([text('finished'), done]); await settle(); assert.equal(f.controller.snapshot().history.sessionId, active);
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'finished'); await f.controller.dispose();
});

test('Rename survives task completion; archiving blocks sends until explicitly restored', async () => {
    const wait = deferred(), f = fixture([() => wait.promise, [text('continued'), done]]); await f.enable();
    const id = f.controller.newSession(); f.controller.setInput('original'); f.controller.send({ consent: true }); await flush();
    await f.controller.renameSession(id, 'My title'); wait.resolve([text('answer'), done]); await settle();
    assert.equal(f.controller.snapshot().history.selected.title, 'My title'); assert.equal(f.controller.snapshot().messages.length, 2);
    await f.controller.archiveSession(id, true); assert.equal(f.controller.snapshot().readOnly, true);
    assert.throws(() => f.controller.send(), /HISTORY_READ_ONLY/); f.controller.setHistoryFilters({ archive: 'archived' }); assert.equal(f.controller.snapshot().history.sessions.length, 1);
    await f.controller.archiveSession(id, false); f.controller.setInput('continue'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().messages.length, 4); await f.controller.dispose();
});

test('Imported backups cannot grant authority or enter model history, even with matching scope', async () => {
    const f = fixture(); await f.enable(); f.controller.newSession(); f.controller.setInput('original'); f.controller.send({ consent: true }); await settle();
    const exported = f.controller.exportHistory(); const previous = f.controller.snapshot().history.sessionId;
    const imported = await f.controller.importHistory(exported); assert.notEqual(imported, previous);
    assert.equal(f.controller.snapshot().readOnly, true); assert.equal(f.controller.snapshot().history.selected.imported, true);
    assert.throws(() => f.controller.send({ consent: true }), /HISTORY_READ_ONLY/);
    assert.equal(f.model.requests.length, 1); assert.match(f.controller.exportHistory('markdown'), /# Muyu conversation/); await f.controller.dispose();
});

test('Scroll positions belong to conversation views and deletion clears their state', async () => {
    const f = fixture(); await f.enable(); const a = f.controller.newSession(), aKey = f.controller.snapshot().viewKey;
    f.controller.setInput('draft A'); f.controller.setScrollPosition(aKey, 250);
    const b = f.controller.newSession(); f.controller.setInput('draft B'); f.controller.setScrollPosition(f.controller.snapshot().viewKey, 40);
    await f.controller.openSession(a); assert.equal(f.controller.snapshot().scrollTop, 250); assert.equal(f.controller.snapshot().input, 'draft A');
    await f.controller.openSession(b); assert.equal(f.controller.snapshot().scrollTop, 40);
    await f.controller.deleteSession(a); await f.controller.dispose();
});

test('Independent conversations preserve drafts and history across reconnect without replaying old grants', async () => {
    const f = fixture([[text('first answer'), done], [text('second answer'), done]]); await f.enable();
    const first = f.controller.newSession(); f.controller.setInput('first'); f.controller.send({ consent: true }); await settle();
    f.controller.setInput('unsent first'); const second = f.controller.newSession(); f.controller.setInput('unsent second');
    await f.controller.selectSession(first); assert.equal(f.controller.snapshot().input, 'unsent first');
    assert.equal(f.controller.snapshot().messages.at(-1).content, 'first answer');
    await f.controller.selectSession(second); assert.equal(f.controller.snapshot().input, 'unsent second');
    await f.enable(); await f.controller.selectSession(first); f.controller.setInput('continue');
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, ['diagnostics']);
    assert.throws(() => f.controller.send(), /CONSENT_REQUIRED|HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.model.requests.length, 1); f.controller.send({ consent: true }); await settle();
    assert.equal(f.model.requests.length, 2); assert.equal(f.controller.snapshot().messages.length, 4); await f.controller.dispose();
});

test('Persisted history reload is inert, scoped, and requires fresh grants before sending', async () => {
    const store = createMemoryHistoryStore(), history = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const f = fixture(undefined, { history }); await f.controller.ready; await f.enable();
    const id = f.controller.newSession(); f.controller.setInput('diagnose'); f.controller.send({ consent: true }); await settle(); await f.controller.flushHistory(); await f.controller.dispose();
    const g = fixture(undefined, { history }); await g.controller.ready;
    assert.equal(g.controller.snapshot().enabled, false); assert.equal(g.model.requests.length, 0);
    await g.controller.selectSession(id); assert.equal(g.controller.snapshot().messages.length, 2); assert.equal(g.controller.snapshot().runs.length, 0);
    g.switchChat('B'); await assert.rejects(g.controller.selectSession(id), /HISTORY_SCOPE/); assert.equal(g.controller.snapshot().messages.length, 0);
    g.switchChat('A'); await g.enable(); await g.controller.selectSession(id);
    assert.deepEqual(g.controller.snapshot().history.missingPermissions, ['diagnostics']);
    assert.doesNotMatch(g.controller.exportHistory(), /PRIVATE_KEY|apiKey|endpoint|tool_call|reasoning/); await g.controller.dispose();
});

test('Revocation preserves read-only history but cannot leak it through an existing runtime', async () => {
    const f = fixture(); await f.enable(); f.controller.setMode('chat'); f.controller.grantPermission('extended');
    const id = f.controller.newSession(); f.controller.setInput('question'); f.controller.send(); await settle();
    await f.controller.revokePermission('extended'); await f.controller.selectSession(id);
    f.controller.setInput('continue without data'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.model.requests.length, 1); assert.equal(f.controller.snapshot().messages.length, 2); await f.controller.dispose();
});

test('Switching Muyu conversations does not cancel or misattribute a pending answer', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    const first = f.controller.newSession(); f.controller.setInput('first'); f.controller.send({ consent: true }); await flush();
    const second = f.controller.newSession(); f.controller.setInput('second draft');
    wait.resolve([text('first answer'), done]); await settle();
    assert.equal(f.controller.snapshot().input, 'second draft'); assert.equal(f.controller.snapshot().messages.length, 0);
    await f.controller.selectSession(first); assert.equal(f.controller.snapshot().messages.at(-1).content, 'first answer');
    await f.controller.selectSession(second); assert.equal(f.controller.snapshot().input, 'second draft'); await f.controller.dispose();
});

test('Idle runtime eviction frees capacity without deleting recorded conversations', async () => {
    const f = fixture(Array.from({ length: 10 }, () => [text('answer'), done])); await f.enable(); let first;
    for (let n = 0; n < 9; n++) { const id = f.controller.newSession(); first ||= id; f.controller.setInput(`question ${n}`); f.controller.send({ consent: true }); await settle(); }
    await f.controller.selectSession(first); assert.equal(f.controller.snapshot().messages.length, 2);
    f.controller.setInput('continue'); f.controller.send({ consent: true }); await settle(); assert.equal(f.controller.snapshot().messages.length, 4); await f.controller.dispose();
});
function fixture(steps = [[text('answer'), done]], extraHost = {}) {
    const events = new EventEmitter(), settings = { memoryEnabled: true, autoMemoryEnabled: true, autoMemoryInterval: 10, autoMemorySpeakers: false };
    const ctx = { groupId: 'g', chatId: 'A', groups: [{ id: 'g', members: ['private-avatar'] }], chat: [{ mes: 'PRIVATE_BODY' }], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    let reads = 0;
    const host = createHostBridge({ getContext: () => ctx, getSettings: () => { reads++; return settings; }, extensionKey: 'gd', pageId: 'test', ...extraHost });
    const model = scriptedModel(steps), configs = [];
    const controller = createMuyuController({ host, createModel: config => { configs.push(config); return model; } });
    controller.setMode('memory');
    return { host, ctx, events, settings, model, configs, controller, reads: () => reads,
        enable: () => controller.configure({ endpoint: 'https://example.test/chat/completions', apiKey: 'PRIVATE_KEY', model: 'test', thinking: true }),
        switchChat: id => { ctx.chatId = id; events.emit('chat'); } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await flush(); };

test('Instruction edits are draft-only, pinned at send time and not duplicated into task/user/history data', async () => {
    const gate = deferred(), saved = [];
    const f = fixture([() => gate.promise, [text('next'), done]], { instructionConfig: { read: () => ({ enabled: false, text: '' }), save: async value => saved.push(value) } });
    await f.enable(); f.controller.setInstructionDraft({ enabled: true, text: 'FIRST_STYLE' }); await f.controller.saveInstructions();
    f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    f.controller.setInstructionDraft({ enabled: true, text: 'NEXT_STYLE' }); await f.controller.saveInstructions();
    assert.equal(f.model.requests[0].instructions.preference, 'FIRST_STYLE'); assert.deepEqual(JSON.parse(f.model.requests[0].messages.at(-2).content.split('\n').slice(1).join('\n')).constraints, []);
    gate.resolve([text('answer'), done]); await settle(); f.controller.setInput('follow up'); f.controller.send(); await settle();
    assert.equal(f.model.requests[1].instructions.preference, 'NEXT_STYLE');
    assert.doesNotMatch(f.controller.exportHistory(), /FIRST_STYLE|NEXT_STYLE/); assert.doesNotMatch(JSON.stringify(f.controller.snapshot().runs), /FIRST_STYLE|NEXT_STYLE/);
    assert.equal(saved.length, 2); await f.controller.dispose();
});

test('Instruction drafts survive chat/reconnect, failed saves and newer edits during an awaited save', async () => {
    let fail = true; const gate = deferred();
    const f = fixture([], { instructionConfig: { read: () => ({ enabled: false, text: 'saved' }), save: async () => { if (fail) throw Error('INSTRUCTION_CONFIG_SAVE_FAILED'); await gate.promise; } } });
    f.controller.setInstructionDraft({ enabled: true, text: 'draft' });
    await assert.rejects(f.controller.saveInstructions(), /INSTRUCTION_CONFIG_SAVE_FAILED/); assert.equal(f.controller.snapshot().instructionSettings.saved.text, 'saved');
    f.switchChat('B'); await f.enable(); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'draft');
    fail = false; const saving = f.controller.saveInstructions(); f.controller.setInstructionDraft({ enabled: true, text: 'newer draft' }); gate.resolve(); await saving;
    assert.equal(f.controller.snapshot().instructionSettings.saved.text, 'draft'); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'newer draft');
    f.controller.discardInstructionDraft(); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'draft');
    f.controller.resetInstructionDraft(); assert.equal(f.controller.snapshot().instructionSettings.saved.text, 'draft'); assert.equal(f.controller.snapshot().instructionSettings.draft.enabled, false);
    await f.controller.dispose();
});

async function seedTurns(f, count = 4) {
    for (let i = 0; i < count; i++) { f.controller.setInput('question ' + i); f.controller.send({ consent: true }); await settle(); }
}
test('Manual context summary preserves transcript, survives stored reload and does not replay grants', async () => {
    const store = createMemoryHistoryStore(), historyPort = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const f = fixture([...Array.from({ length: 4 }, () => [text('old answer'), done]), [text('summary reference'), done]], { history: historyPort });
    await f.controller.ready; await f.enable(); await seedTurns(f);
    const before = f.controller.snapshot().messages, id = f.controller.snapshot().history.sessionId;
    await f.controller.compactHistory(); await f.controller.flushHistory();
    assert.deepEqual(f.controller.snapshot().messages, before); assert.equal(f.controller.snapshot().context.summary, 'summary reference');
    assert.equal(f.controller.snapshot().context.usage.modelCalls, 1); assert.deepEqual(f.model.requests.at(-1).tools, []);
    await f.enable(); await f.controller.selectSession(id);
    await assert.rejects(f.controller.compactHistory(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.controller.snapshot().context.summary, 'summary reference'); assert.equal(f.model.requests.length, 5);
    await f.controller.dispose();
    const second = fixture([], { history: historyPort }); await second.controller.ready; await second.controller.selectSession(id);
    assert.equal(second.controller.snapshot().context.summary, 'summary reference'); assert.equal(second.model.requests.length, 0); await second.controller.dispose();
});

test('Chat change cancels manual compaction and late summary cannot overwrite either chat', async () => {
    const gate = deferred(), f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), () => gate.promise]);
    await f.enable(); await seedTurns(f); const id = f.controller.snapshot().history.sessionId;
    const pending = f.controller.compactHistory(); const rejected = assert.rejects(pending, /CANCELLED/); await settle();
    f.switchChat('B'); f.controller.setInput('B draft'); await settle();
    assert.equal(f.controller.snapshot().busy, true); gate.resolve([text('late summary'), done]); await rejected;
    assert.equal(f.controller.snapshot().input, 'B draft'); assert.equal(f.controller.snapshot().context.summary, '');
    f.switchChat('A'); await f.controller.selectSession(id); assert.equal(f.controller.snapshot().context.summary, ''); await f.controller.dispose();
});

test('Deleting a manual-summary target waits for drain; no late result resurrects it', async () => {
    const gate = deferred(), f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), () => gate.promise]);
    await f.enable(); await seedTurns(f); const id = f.controller.snapshot().history.sessionId;
    const pending = f.controller.compactHistory(), rejected = assert.rejects(pending, /CANCELLED/); await settle();
    const deleted = f.controller.deleteSession(id); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    gate.resolve([text('late summary'), done]); await Promise.all([deleted, rejected]);
    assert.equal(f.controller.snapshot().history.sessions.some(s => s.id === id), false); await f.controller.dispose();
});

test('Automatic summary is opt-in and uses send-time context policy; omission is one-send only', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('PRIVATE_OLD'), done]), [text('summary'), done], [text('answer'), done], [text('no history'), done]], {
        contextConfig: { read: () => ({ inputTokens: 32000, recentTurns: 2, autoSummary: false }), save: async () => {} },
    });
    await f.enable(); await seedTurns(f); assert.equal(f.model.requests.length, 4);
    await f.controller.saveContextConfig({ inputTokens: 32000, recentTurns: 2, autoSummary: true });
    f.controller.setInput('continue'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 6); assert.deepEqual(f.model.requests[4].tools, []); assert.equal(f.controller.snapshot().context.summary, 'summary');
    assert.equal(f.controller.snapshot().runs.at(-1).process.budget.modelCalls, 2);
    f.controller.setOmitHistory(true); f.controller.setInput('fresh'); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests[6]), /PRIVATE_OLD|Historical conversation summary/);
    assert.equal(f.controller.snapshot().context.omitHistory, false); assert.equal(f.controller.snapshot().messages.length, 12);
    f.controller.clearContextSummary(); assert.equal(f.controller.snapshot().context.summary, ''); await f.controller.dispose();
});

test('Revoking permissions cancels a summary before it can be cached', async () => {
    const gate = deferred(), f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), () => gate.promise]);
    await f.enable(); await seedTurns(f); const id = f.controller.snapshot().history.sessionId;
    const pending = f.controller.compactHistory(), rejected = assert.rejects(pending, /CANCELLED/); await settle();
    const revoke = f.controller.revokePermission('diagnostics'); await settle(); gate.resolve([text('forbidden late'), done]); await Promise.all([revoke, rejected]);
    await f.controller.selectSession(id); assert.equal(f.controller.snapshot().context.summary, '');
    await assert.rejects(f.controller.compactHistory(), /HISTORY_PERMISSION_REQUIRED/); await f.controller.dispose();
});

test('Remembered grants permit repeated sends; revoke resets prior model conversation and connection clears grants', async () => {
    const f = fixture([[text('PRIVATE_ANSWER'), done], [text('second'), done], [text('fresh'), done]]);
    await f.enable(); f.controller.setInput('first'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().permissions.diagnostics, true);
    f.controller.setInput('second'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_ANSWER/);
    await f.controller.revokePermission('diagnostics'); assert.equal(f.controller.snapshot().messages.length, 0);
    f.controller.setInput('new'); assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/);
    f.controller.send({ consent: true }); await settle(); assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_ANSWER/);
    await f.enable(); assert.equal(f.controller.snapshot().permissions.diagnostics, false); await f.controller.dispose();
});

test('Budget settings are captured at send time and saving during a run affects only the next run', async () => {
    const gate = deferred(); let saved;
    const f = fixture([async () => { await gate.promise; return [tool('muyu.memory.inspect'), done]; }, [text('bounded'), done], [text('next'), done]], {
        runConfig: { read: () => ({ ...RUN_DEFAULTS, modelCalls: 2, maxTokens: 1024 }), save: async value => { saved = value; } },
    });
    await f.enable(); f.controller.setInput('first'); f.controller.send({ consent: true }); await settle();
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 10, maxTokens: 2048 });
    assert.equal(saved.modelCalls, 10); gate.resolve(); await settle();
    let s = f.controller.snapshot(); assert.equal(s.runs[0].process.budget.modelLimit, 2); assert.equal(s.runs[0].process.budget.maxTokens, 1024);
    assert.equal(f.model.requests[1].finalize, true);
    f.controller.setInput('next'); f.controller.send(); await settle(); s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).process.budget.modelLimit, 10); assert.equal(f.model.requests.at(-1).maxTokens, 2048);
    await assert.rejects(f.controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 500 }), /INVALID_RUN_CONFIG/);
    await f.controller.dispose();
});

test('Chat assistant exposes public catalog without data grant; grants follow only their chat', async () => {
    const f = fixture([[text('public'), done], [text('authorized'), done]]);
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('hello'); f.controller.send(); await settle();
    assert.equal(f.model.requests[0].tools.some(t => t.id === 'muyu.provider.read'), true);
    assert.equal(f.model.requests[0].tools.some(t => t.id === 'muyu.permission.request'), true);
    f.controller.grantPermission('chat'); f.controller.setInput('read'); f.controller.send(); await settle();
    assert.equal(f.model.requests.at(-1).tools.some(t => t.id === 'muyu.provider.read'), true);
    f.switchChat('B'); assert.equal(f.controller.snapshot().permissions.chat, false);
    f.switchChat('A'); assert.equal(f.controller.snapshot().permissions.chat, true); await f.controller.dispose();
});

test('Authorized Provider body reaches model only through the tool, not process projection', async () => {
    let reads = 0;
    const f = fixture([[tool('muyu.provider.read', { id: 'recentMessages', selector: '', revision: '', offset: 0 }), done], [text('answer'), done]], {
        providerPort: { available: () => true, read() { reads++; return { text: 'BODY_EVIDENCE', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('chat'); f.controller.setInput('read'); f.controller.send({ consent: true }); await settle();
    assert.equal(reads, 1); assert.match(JSON.stringify(f.model.requests.at(-1)), /BODY_EVIDENCE/);
    assert.doesNotMatch(JSON.stringify(f.controller.snapshot().runs[0].process), /BODY_EVIDENCE/); await f.controller.dispose();
});

test('Basic consent cannot read extended sources; explicit extended grant permits only its scope', async () => {
    for (const grant of [false, true]) {
        let reads = 0;
        const f = fixture([[tool('muyu.provider.read', { id: 'directorLedger', selector: '', revision: '', offset: 0 }), done], [text('answer'), done]], { providerPort: { available: () => true, read() { reads++; return { text: 'LEDGER_BODY', limited: true }; } } });
        await f.enable(); f.controller.setMode('chat'); if (grant) f.controller.grantPermission('extended');
        f.controller.setInput('ledger'); f.controller.send({ consent: true }); await settle();
        assert.equal(reads, grant ? 1 : 0); if (!grant) assert.doesNotMatch(JSON.stringify(f.model.requests), /LEDGER_BODY/);
        f.switchChat('B'); assert.equal(f.controller.snapshot().permissions.extended, false);
        f.switchChat('A'); assert.equal(f.controller.snapshot().permissions.extended, grant);
        if (grant) { await f.controller.revokePermission('extended'); assert.equal(f.controller.snapshot().messages.length, 0); }
        await f.controller.dispose();
    }
});

test('Revoke while model is pending cancels the run and waits for drain before accepting a fresh context', async () => {
    const gate = deferred();
    const f = fixture([async () => { await gate.promise; return [text('LATE_PRIVATE'), done]; }]);
    await f.enable(); f.controller.setInput('read'); f.controller.send({ consent: true }); await settle();
    const revoking = f.controller.revokePermission('diagnostics'); await settle();
    assert.equal(f.controller.snapshot().resetting, true); assert.equal(f.controller.snapshot().permissions.diagnostics, false);
    assert.throws(() => f.controller.send(), /NOT_READY/); gate.resolve(); await revoking;
    assert.equal(f.controller.snapshot().messages.length, 0); assert.equal(f.controller.snapshot().runs.length, 0); await f.controller.dispose();
});

test('Saved credentials restore only on explicit configure, stay out of snapshots and do not restore grants', async () => {
    const settings = {}; let saves = 0;
    const credentials = createCredentialStore({ getSettings: () => settings, saveSettings: () => saves++ });
    const f = fixture(undefined, { credentials }); await f.enable(); assert.equal(saves, 0);
    await f.controller.configure({ endpoint: 'https://saved.test/chat/completions', apiKey: 'SYNTHETIC_KEY', model: 'm', rememberKey: true });
    assert.equal(saves, 1); f.controller.grantPermission('diagnostics'); await f.controller.dispose();
    const g = fixture(undefined, { credentials }); assert.equal(g.controller.snapshot().enabled, false);
    assert.equal(g.controller.snapshot().permissions.diagnostics, false); assert.doesNotMatch(JSON.stringify(g.controller.snapshot()), /SYNTHETIC_KEY/);
    await g.controller.configure({ endpoint: 'https://saved.test/chat/completions', apiKey: '', model: 'm', rememberKey: true });
    assert.equal(g.configs.at(-1).connection.apiKey, 'SYNTHETIC_KEY');
    await g.controller.forgetCredential(); assert.equal(g.controller.snapshot().savedConnection, null); await g.controller.dispose();
});

test('Director mode publishes a safe report under chat ownership and cannot use memory-state tools', async () => {
    const f = fixture([[tool('muyu.director.inspect'), done], [text('current state only'), done]]);
    await f.enable(); f.controller.setMode('director'); f.controller.setInput('check director');
    assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/); assert.equal(f.reads(), 0);
    f.controller.send({ consent: true }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts[0].content.module, 'director');
    assert.doesNotMatch(JSON.stringify(f.model.requests), /private-avatar|PRIVATE_BODY|PRIVATE_KEY/);
    f.switchChat('B'); assert.equal(f.controller.snapshot().artifacts.length, 0); await f.controller.dispose();
    const denied = fixture([[tool('muyu.memory.inspect'), done], [text('denied'), done]]);
    await denied.enable(); denied.controller.setMode('director'); denied.controller.setInput('read memory'); denied.controller.send({ consent: true }); await settle();
    assert.equal(denied.reads(), 0); assert.equal(denied.controller.snapshot().artifacts.length, 0); await denied.controller.dispose();
});

test('Safe network failures remain distinguishable from authentication errors', async () => {
    const f = fixture([() => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }]);
    await f.enable(); f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().notice, 'MODEL_NETWORK_ERROR');
    assert.equal(f.controller.snapshot().runs[0].status, 'failed'); await f.controller.dispose();
});

test('Memory authorization cannot invoke draft tools or create config artifacts', async () => {
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryEnabled: false } }), done], [text('denied'), done]]);
    await f.enable(); f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.reads(), 0); assert.equal(f.controller.snapshot().artifacts.length, 0);
    assert.equal(f.settings.autoMemoryEnabled, true); await f.controller.dispose();
});

test('Continue a selected draft creates a new revision, preserving the unchanged fields', async () => {
    const f = fixture([
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('v1'), done],
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 20 } }), done], [text('v2'), done],
    ]);
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval 15');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const first = f.controller.snapshot().artifacts[0]; f.controller.setInput('change to 20');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'], artifactId: first.id }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.artifacts.length, 1); assert.equal(s.artifacts[0].revision, 2);
    assert.equal(s.artifacts[0].taskId, first.taskId); assert.equal(s.artifacts[0].content.preview.manifest.settings.autoMemoryInterval, 20);
    assert.equal(f.settings.autoMemoryInterval, 10); await f.controller.dispose();
});

test('Host identity includes owner; bridge subscribes once and does not read message bodies', () => {
    const f = fixture(), a = f.host.currentTarget();
    f.ctx.groupId = 'other'; assert.notDeepEqual(f.host.currentTarget(), a);
    f.ctx.groupId = null; f.ctx.characterId = 0; f.ctx.characters = [{ avatar: 'avatar' }];
    assert.notDeepEqual(f.host.currentTarget(), a);
    f.ctx.chatId = ''; assert.equal(f.host.currentTarget(), null);
    assert.equal(f.reads(), 0); assert.equal(f.events.listenerCount('chat'), 1);
    return f.controller.dispose().then(() => assert.equal(f.events.listenerCount('chat'), 0));
});

test('Disabled/default controller and missing consent cannot invoke model or read settings', async () => {
    const f = fixture(); f.controller.setInput('hello');
    assert.equal(f.controller.snapshot().enabled, false);
    assert.throws(() => f.controller.send({ consent: true }), /NOT_READY/);
    await f.enable(); assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/);
    assert.equal(f.reads(), 0); assert.equal(f.model.requests.length, 0);
    assert.ok(!JSON.stringify(f.controller.snapshot()).includes('PRIVATE_KEY'));
    const snapshot = f.controller.snapshot(); snapshot.connection.model = 'tamper';
    assert.equal(f.controller.snapshot().connection.model, 'test'); await f.controller.dispose();
});

test('View subscriptions and chat drafts survive unmount; empty chat switches reset view identity', async () => {
    const f = fixture(); const a = f.controller.snapshot().viewToken;
    f.controller.setInput('A draft'); let updates = 0;
    const sub = f.controller.subscribe(() => updates++); sub.unsubscribe();
    f.switchChat('B'); assert.notEqual(f.controller.snapshot().viewToken, a); assert.equal(updates, 0);
    f.controller.setInput('B draft'); f.switchChat('A'); assert.equal(f.controller.snapshot().input, 'A draft');
    f.controller.setMode('draft'); f.controller.setInput('global draft'); f.switchChat('B');
    assert.equal(f.controller.snapshot().input, 'global draft');
    f.controller.setMode('memory'); assert.equal(f.controller.snapshot().input, 'B draft'); await f.controller.dispose();
});

test('Memory run publishes trusted report, never private bodies or identities', async () => {
    const f = fixture([[tool('muyu.memory.inspect'), done], [text('evidence answer'), done]]);
    await f.enable(); f.controller.setInput('diagnose'); f.controller.send({ consent: true }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts[0].kind, 'report');
    assert.doesNotMatch(JSON.stringify(f.model.requests), /PRIVATE_BODY|private-avatar|PRIVATE_KEY/);
    assert.equal(s.messages.at(-1).content, 'evidence answer'); await f.controller.dispose();
});

test('Global draft requires explicit fields; publishes validated diff without writing settings', async () => {
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]]);
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval 15');
    assert.throws(() => f.controller.send({ consent: true }), /FIELD_SCOPE_REQUIRED/);
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts.length, 1);
    assert.equal(s.artifacts[0].content.preview.manifest.settings.autoMemoryInterval, 15);
    assert.equal(f.settings.autoMemoryInterval, 10);
    f.settings.autoMemoryInterval = 20;
    assert.throws(() => f.controller.revalidate(s.artifacts[0].id, 1), /STALE_DRAFT/);
    assert.equal(f.controller.snapshot().artifacts[0].validation.status, 'stale'); await f.controller.dispose();
});

test('Chat switch cancels old run, late answer cannot overwrite new input, drain blocks reuse', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    f.controller.setInput('A'); f.controller.send({ consent: true }); await flush();
    f.switchChat('B'); f.controller.setInput('B unsaved'); await settle();
    assert.equal(f.controller.snapshot().busy, true); assert.equal(f.controller.snapshot().draining, true);
    assert.throws(() => f.controller.send({ consent: true }), /NOT_READY/);
    wait.resolve([text('late A'), done]); await settle();
    assert.equal(f.controller.snapshot().input, 'B unsaved'); assert.equal(f.controller.snapshot().messages.length, 0);
    f.switchChat('A'); assert.equal(f.controller.snapshot().runs[0].status, 'cancelled'); await f.controller.dispose();
});

test('Global run survives chat switch; disabling waits for physical drain and clears credentials/state', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    f.controller.setMode('draft'); f.controller.setInput('draft'); f.controller.send({ consent: true, fields: ['autoMemoryEnabled'] }); await flush();
    f.switchChat('B'); await flush(); assert.equal(f.controller.snapshot().runs[0].status, 'running');
    const disabled = f.controller.disable(); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    wait.resolve([text('late'), done]); await disabled;
    assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.controller.snapshot().connection, null);
    assert.equal(f.controller.snapshot().artifacts.length, 0); assert.equal(f.controller.snapshot().messages.length, 0); await f.controller.dispose();
});
