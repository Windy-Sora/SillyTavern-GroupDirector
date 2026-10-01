import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { fingerprint } from '../../muyu/context/planner.js';
import { HISTORY_LIMITS, historyBytes, historyScope } from '../../muyu/sessions/contract.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createProfileWriter } from '../../muyu/host/profile-write.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { scriptedModel, text, done, deferred, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args = {}, callId = 'c1') => ({ type: 'tool_call_complete', call: { toolId, callId, version: toolId.startsWith('muyu.provider.') ? 2 : 1, args } });

const ask = () => tool('muyu.interaction.ask', { question: 'Which part?', options: ['Frequency', 'Content'] });
test('Globe is opt-in even in full access; enabled searches reach the model and reconnect turns it off', async () => {
    let calls = 0, checks = 0;
    const capture = { limits: { maxSearches: 3, maxResults: 5, resultBytes: 12000 }, search: async args => { calls++; return { status: 'ok', provider: 'brave', query: args.query, fetchedAt: '2026-09-30T00:00:00Z', truncated: false, results: [{ title: 'Docs', url: 'https://docs.example.test/', snippet: 'Untrusted public evidence' }] }; } };
    const webSearch = { describe: () => ({ ...capture.limits, hasKey: true, provider: 'brave' }), check: async () => { checks++; }, capture: () => capture, cancel() {} };
    const f = fixture([[text('offline'), done], [tool('muyu.web.search', { query: 'SillyTavern docs' }), done], [text('[Docs](https://docs.example.test/)'), done]], { webSearch });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('offline'); f.controller.send(); await settle();
    assert.ok(!f.model.requests[0].tools.some(row => row.id === 'muyu.web.search')); assert.equal(calls, 0);
    f.controller.setInput('keep this draft'); await f.controller.setWebSearchEnabled(true);
    assert.equal(f.controller.snapshot().input, 'keep this draft'); assert.equal(checks, 1);
    f.controller.send(); await settle();
    assert.ok(f.model.requests[1].tools.some(row => row.id === 'muyu.web.search')); assert.equal(calls, 1);
    assert.match(JSON.stringify(f.model.requests[2]), /Untrusted public evidence/);
    assert.equal(f.controller.snapshot().interaction, null);
    await f.enable(); assert.equal(f.controller.snapshot().webSearch.enabled, false); await f.controller.dispose();
});

test('Turning the globe off after the model request prevents its queued search from making any network call', async () => {
    let calls = 0, cancels = 0;
    const wait = deferred(), webSearch = { describe: () => ({ hasKey: true }), check: async () => {}, cancel() { cancels++; }, capture: () => ({ limits: { maxSearches: 3, maxResults: 5, resultBytes: 12000 }, search: async () => { calls++; throw Error('must not run'); } }) };
    const f = fixture([() => wait.promise, [text('offline now'), done]], { webSearch });
    await f.enable(); f.controller.setMode('assistant'); await f.controller.setWebSearchEnabled(true);
    f.controller.setInput('search'); f.controller.send(); await flush();
    await f.controller.setWebSearchEnabled(false);
    wait.resolve([tool('muyu.web.search', { query: 'query' }), done]); await settle();
    assert.equal(calls, 0); assert.ok(cancels > 0); assert.equal(f.controller.snapshot().webSearch.enabled, false);
    await f.controller.dispose();
});

const taskPlan = () => tool('muyu.task.plan', { goal: '建立当前聊天金币系统', scope: 'mixed',
    sources: ['configSettings', 'variables'], steps: [
        { kind: 'read', title: '核对现状', detail: '只读现有变量与配置' },
        { kind: 'variables', title: '创建金币余额', detail: '当前尚无变量写入工具' },
        { kind: 'settings', title: '预览激活设置', detail: '另需配置草稿与单次批准' },
    ], unknowns: ['是否已有同名变量'] });
test('Approving a task plan preserves the search budget of its successful earlier segment', async () => {
    let calls = 0;
    const capture = { limits: { maxSearches: 1, maxResults: 5, resultBytes: 12000 }, search: async args => { calls++; return { status: 'empty', provider: 'brave', query: args.query, fetchedAt: '', truncated: false, results: [] }; } };
    const webSearch = { describe: () => ({ ...capture.limits, hasKey: true }), check: async () => {}, capture: () => capture, cancel() {} };
    const f = fixture([[tool('muyu.web.search', { query: 'first' }, 'search1'), done], [taskPlan(), done], [text('plan'), done],
        [tool('muyu.web.search', { query: 'second' }, 'search2'), done], [text('finished'), done]], { webSearch });
    await f.enable(); f.controller.setMode('assistant'); await f.controller.setWebSearchEnabled(true);
    f.controller.setInput('Plan a system'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(row => row.kind === 'task-plan');
    assert.equal(calls, 1); f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const runs = f.controller.snapshot().runs;
    assert.equal(runs[0].taskId, runs[1].taskId); assert.equal(calls, 1);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /budget_exceeded/);
    await f.controller.dispose();
});
test('Task plan reviews two read sources once, resumes same task and never grants write authority', async () => {
    const f = fixture([[taskPlan(), done], [text('只读方案'), done],
        [tool('muyu.settings.read', { fields: ['mode'] }), done], [text('仍未修改'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('给本聊天建立金币系统并激活');
    f.controller.send(); await settle();
    const before = f.controller.snapshot(), plan = before.artifacts.find(a => a.kind === 'task-plan');
    assert.ok(plan); assert.deepEqual(plan.content.plan.sources, ['configSettings', 'variables']);
    assert.equal(before.configActions.length, 0); assert.equal(f.reads(), 0);
    assert.equal(JSON.parse(f.controller.exportHistory()).required.includes('source:variables'), false);
    f.controller.setInput('保留的未发送草稿');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    assert.equal(f.controller.snapshot().input, '保留的未发送草稿');
    assert.ok(f.reads() > 0);
    assert.equal(f.controller.snapshot().approvedPlans.includes(plan.id), true);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.throws(() => f.controller.approveTaskPlanReads(plan.id, plan.revision), /TASK_PLAN_STALE/);
    assert.equal(JSON.parse(f.controller.exportHistory()).required.includes('source:configSettings'), true);
    f.switchChat('B');
    assert.equal(f.controller.snapshot().artifacts.length, 0);
    await f.controller.dispose();
});
test('Declining a task plan does not resume it or authorize its read sources', async () => {
    const f = fixture([[taskPlan(), done], [text('只读方案'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('建立金币系统');
    f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    assert.ok(plan);
    const calls = f.model.requests.length;
    f.controller.declineTaskPlanReads(plan.id, plan.revision);
    assert.equal(f.model.requests.length, calls);
    assert.equal(f.reads(), 0);
    assert.equal(f.controller.snapshot().declinedPlans.includes(plan.id), true);
    assert.throws(() => f.controller.approveTaskPlanReads(plan.id, plan.revision), /TASK_PLAN_STALE/);
    await f.controller.dispose();
});
test('Stopped plan cannot regrant reads; approved plan produces an unapplied variable draft', async () => {
    const draftArgs = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0, min: 0,
        rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const stopped = fixture([[taskPlan(), done], [text('方案'), done]]);
    await stopped.enable(); stopped.controller.setMode('assistant'); stopped.controller.setInput('金币系统'); stopped.controller.send(); await settle();
    const oldPlan = stopped.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    stopped.controller.stop();
    assert.ok(stopped.controller.snapshot().invalidPlans.includes(oldPlan.id));
    assert.throws(() => stopped.controller.approveTaskPlanReads(oldPlan.id, oldPlan.revision), /TASK_PLAN_STALE/);
    await stopped.controller.dispose();

    const f = fixture([[taskPlan(), done], [text('方案'), done], [tool('muyu.variables.preview', draftArgs), done], [text('草稿未应用'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'variable-draft');
    assert.ok(draft); assert.equal(draft.content.definition.id, 'party_gold');
    assert.equal(f.ctx.chatMetadata.gd, undefined);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.equal(f.controller.revalidate(draft.id, draft.revision).validation.writes, 'separate-approval-required');
    f.ctx.chatMetadata.gd = { variables: { defs: [{ id: 'party_gold', scope: 'global', type: 'number', defaultValue: 0 }], values: { global: {}, character: {} }, log: [] } };
    assert.throws(() => f.controller.revalidate(draft.id, draft.revision), /STALE_DRAFT/);
    await f.controller.dispose();
});
test('One explicit variable approval saves once and records a chat-scoped historical receipt', async () => {
    let saves = 0;
    const draftArgs = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0, min: 0,
        rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const f = fixture([[taskPlan(), done], [text('方案'), done], [tool('muyu.variables.preview', draftArgs), done], [text('草稿'), done]],
        { variableSaveConfirmed: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'variable-draft');
    assert.ok(draft); assert.equal(f.ctx.chatMetadata.gd, undefined);
    const action = f.controller.prepareVariableApply(draft.id, draft.revision);
    assert.equal(saves, 0); assert.equal(f.ctx.chatMetadata.gd, undefined);
    await f.controller.approveVariableApply(action.id);
    assert.equal(saves, 1); assert.equal(f.ctx.chatMetadata.gd.variables.values.global.party_gold, 0);
    const receipt = f.controller.snapshot().receipts.find(r => r.operationId === action.id);
    assert.equal(receipt.version, 3); assert.equal(receipt.variableId, 'party_gold'); assert.equal(receipt.status, 'applied_confirmed'); assert.equal(receipt.chatSave, 'confirmed');
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('source:variables'));
    assert.throws(() => f.controller.approveVariableApply(action.id), /ACTION_STALE/);
    await assert.rejects(f.controller.checkReceipt(action.id), /NOT_READY/);
    await f.controller.dispose();
});
test('One task-bundle approval executes exact variable and global setting steps without further approvals', async () => {
    let chatSaves = 0, settingsSaves = 0;
    const plan = { ...taskPlan().call.args, sources: ['memoryConfig', 'variables'] };
    const bundle = { variables: [{ action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0,
        rule: '仅在明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' }], settingsJson: '{"memoryEnabled":false}' };
    const f = fixture([[tool('muyu.task.plan', plan), done], [text('方案'), done],
        [tool('muyu.task.preview', bundle), done], [text('整单草稿'), done]],
    { variableSaveConfirmed: async () => { chatSaves++; }, bundleSaveSettings: async () => { settingsSaves++; return { confirmed: true }; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('建立金币系统'); f.controller.send(); await settle();
    const planArtifact = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(planArtifact.id, planArtifact.revision); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'task-bundle');
    assert.ok(draft); assert.equal(chatSaves, 0); assert.equal(settingsSaves, 0);
    const action = f.controller.prepareBundleApply(draft.id, draft.revision);
    await f.controller.approveBundleApply(action.id);
    assert.equal(chatSaves, 1); assert.equal(settingsSaves, 1); assert.equal(f.settings.memoryEnabled, false);
    const receipt = f.controller.snapshot().receipts.find(row => row.operationId === action.id);
    assert.equal(receipt.version, 4); assert.equal(receipt.status, 'applied_confirmed');
    assert.deepEqual(receipt.steps.map(row => row.status), ['applied_confirmed', 'applied_confirmed']);
    assert.throws(() => f.controller.approveBundleApply(action.id), /ACTION_STALE/);
    await f.controller.dispose();
});
test('Plan read scope survives a clarification handoff within the same task only', async () => {
    const draftArgs = { action: 'create', id: 'party_gold', label: '队伍金币', initialValue: 0,
        rule: '有明确收支时更新', autoUpdate: true, injectMode: 'always', updateMode: 'delta' };
    const f = fixture([[taskPlan(), done], [text('方案'), done], [ask(), done], [tool('muyu.variables.preview', draftArgs), done], [text('仅预览'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const plan = f.controller.snapshot().artifacts.find(a => a.kind === 'task-plan');
    f.controller.approveTaskPlanReads(plan.id, plan.revision); await settle();
    const question = f.controller.snapshot().interaction;
    assert.equal(question.kind, 'clarification');
    f.controller.setInteractionDraft(question.id, '队伍共享金币');
    f.controller.answerInteraction(question.id); await settle();
    assert.ok(f.controller.snapshot().artifacts.some(a => a.kind === 'variable-draft'));
    assert.equal(f.controller.snapshot().taskUsage.segments, 3);
    assert.equal(f.ctx.chatMetadata.gd, undefined);
    await f.controller.dispose();
});
test('Plan budget exhaustion cannot publish an incomplete candidate or run an unbudgeted preview', async () => {
    const f = fixture([[taskPlan(), done], [tool('muyu.variables.preview', { action: 'create', id: 'party_gold' }), done]], {
        runConfig: { read: () => ({ ...RUN_DEFAULTS, modelCalls: 2, toolCalls: 1 }) },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('金币系统'); f.controller.send(); await settle();
    const state = f.controller.snapshot();
    assert.equal(state.artifacts.length, 0);
    assert.equal(state.runs[0].status, 'failed');
    assert.equal(state.runs[0].process.budget.reason, 'tool_calls');
    assert.equal(f.ctx.chatMetadata.gd, undefined);
    await f.controller.dispose();
});
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
test('Cancelling repeated permission handoffs releases module run capacity', async () => {
    const attempts = 130;
    const steps = Array.from({ length: attempts }, () => [tool('muyu.settings.read', { fields: ['topN'] }), done]);
    const f = fixture(steps); await f.enable(); f.controller.setMode('assistant');
    for (let i = 0; i < attempts; i++) {
        if (i % 8 === 0) f.controller.newSession();
        f.controller.setInput(`Inspect setting ${i}`); f.controller.send(); await settle();
        const state = f.controller.snapshot();
        assert.equal(state.interaction?.status, 'pending', `permission request ${i + 1}: ${state.notice}`);
        assert.equal(state.interaction.kind, 'permission');
        f.controller.cancelInteraction(state.interaction.id);
    }
    assert.equal(f.model.requests.length, attempts);
    assert.equal(f.controller.snapshot().notice, null);
    await f.controller.dispose();
});
test('Permission grants do not consume the three-clarification allowance', async () => {
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
    assert.ok(!f.model.requests.at(-1).tools.some(t => t.id === 'muyu.interaction.ask'));
    assert.ok(f.model.requests.at(-1).tools.some(t => t.id === 'muyu.permission.request'));
    await f.controller.dispose();
});

test('One clarification and six distinct automatic source grants resume the original batch', async () => {
    const ids = ['recentMessages', 'chatSummary', 'character_profiles', 'charMemory', 'chatHistory'];
    const f = fixture([[ask(), done], [...ids.map(id => readSource(id)), tool('muyu.director.inspect'), done], [text('checked'), done]],
        { providerPort: { read: () => ({ text: 'Synthetic evidence', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read chat and inspect director'); f.controller.send(); await settle();
    let r = f.controller.snapshot().interaction;
    f.controller.setInteractionDraft(r.id, 'Read then inspect'); f.controller.answerInteraction(r.id); await settle();
    for (const id of [...ids, 'directorDiagnostics']) {
        r = f.controller.snapshot().interaction;
        assert.equal(r?.status, 'pending', id); assert.equal(r.source, id);
        f.controller.answerPermission(r.id, 'task'); await settle();
    }
    const s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.messages.at(-1).content, 'checked');
    assert.equal(f.model.requests.length, 3); // Grants resume tools, not separate model confirmations.
    await f.controller.dispose();
});

test('One task source grant covers repeated reads of that source without a second handoff', async () => {
    let reads = 0;
    const second = readSource('recentMessages'); second.call.callId = 'read-again';
    const f = fixture([[readSource('recentMessages'), second, done], [text('read twice'), done]],
        { providerPort: { read: () => { reads++; return { text: 'Synthetic', limited: false }; } } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read and reread'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction; assert.equal(reads, 0);
    f.controller.answerPermission(r.id, 'task'); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.controller.snapshot().interaction.status, 'granted');
    assert.equal(reads, 2); assert.equal(f.model.requests.length, 2);
    const results = f.model.requests[1].messages.filter(m => m.role === 'tool');
    assert.equal(results[0].result.hostObservation.sources[0].status, 'granted_now');
    assert.equal(results[1].result.hostObservation.sources[0].status, 'reused');
    assert.equal(results[0].result.hostObservation.sources[0].grantScope, 'task');
    assert.doesNotMatch(f.controller.exportHistory(), /hostObservation|read_authorization/);
    await f.controller.dispose();
});
test('Committed permission continuation survives a synchronous history capture failure without revoking its grant', async () => {
    for (const decision of ['task', 'chat']) {
        let reads = 0;
        const f = fixture([[readSource('recentMessages'), done], [text('read completed'), done]],
            { providerPort: { read: () => { reads++; return { text: 'Synthetic evidence', limited: false }; } } });
        await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Analyze chat'); f.controller.send(); await settle();
        const r = f.controller.snapshot().interaction, clone = globalThis.structuredClone;
        let queued = false, injected = false;
        globalThis.structuredClone = value => {
            if (value?.sessions && value.runs?.at(-1)?.status === 'queued') queued = true;
            if (queued && !injected && value?.version >= 5 && Array.isArray(value.messages)) {
                injected = true; throw Error('HISTORY_INVALID');
            }
            return clone(value);
        };
        try { assert.doesNotThrow(() => f.controller.answerPermission(r.id, decision)); }
        finally { globalThis.structuredClone = clone; }
        assert.equal(injected, true);
        await settle();
        const s = f.controller.snapshot();
        assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.interaction.status, 'granted');
        assert.equal(s.messages.at(-1).content, 'read completed'); assert.equal(reads, 1);
        assert.equal(s.runs.length, 2); assert.equal(f.model.requests.length, 2);
        await f.controller.dispose();
    }
});

test('Failure before continuation runtime preparation cancels the queued run before grant rollback', async () => {
    let reads = 0;
    const f = fixture([[readSource('recentMessages'), done]],
        { providerPort: { read: () => { reads++; return { text: 'Synthetic evidence', limited: false }; } } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Analyze chat'); f.controller.send(); await settle();
    const r = f.controller.snapshot().interaction, clone = globalThis.structuredClone, uuid = crypto.randomUUID;
    let creatingRun = false, injected = false;
    crypto.randomUUID = () => { creatingRun = true; return uuid.call(crypto); };
    globalThis.structuredClone = value => {
        if (creatingRun && !injected && value?.version >= 5 && Array.isArray(value.messages)) {
            injected = true; throw Error('HISTORY_INVALID');
        }
        return clone(value);
    };
    try { assert.throws(() => f.controller.answerPermission(r.id, 'task'), /HISTORY_INVALID/); }
    finally { globalThis.structuredClone = clone; crypto.randomUUID = uuid; }
    assert.equal(injected, true); await settle();
    const s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).status, 'cancelled'); assert.notEqual(s.interaction.status, 'pending');
    assert.equal(reads, 0); assert.equal(f.model.requests.length, 1);
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

test('Assistant history can continue in another ST chat with a visible switch and fresh target', async () => {
    const f = fixture([[text('first'), done], [text('second'), done]]); await f.enable(); f.controller.setMode('assistant');
    const id = f.controller.newSession(); f.controller.setInput('A question'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().history.filters.range, 'all');
    f.switchChat('B');
    assert.ok(f.controller.snapshot().history.sessions.some(row => row.id === id));
    assert.equal(f.controller.snapshot().history.sessionId, id);
    assert.equal(f.controller.snapshot().messages.length, 2);
    assert.equal(f.controller.snapshot().readOnly, false);
    assert.equal(f.controller.snapshot().switchedChat, true);
    f.controller.setInput('B question'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().switchedChat, false);
    assert.equal(f.controller.snapshot().messages.length, 4);
    assert.equal(f.controller.snapshot().runs.at(-1).target.chatKey, f.host.currentTarget().chatKey);
    assert.match(f.model.requests[1].instructions.task, /SillyTavern 聊天/);
    const switched = JSON.parse(f.controller.exportHistory());
    assert.equal(switched.scope, JSON.stringify(['assistant', 'chat', f.host.currentTarget().chatKey]));
    assert.equal(switched.version, 7); assert.equal(switched.scopeChanges.length, 1);
    f.controller.newSession();
    assert.equal(f.controller.snapshot().history.filters.range, 'all');
    await f.controller.dispose();
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
    let host;
    const variableDraftPort = createVariableDraftPort({ getTarget: () => host?.currentTarget(), getMetadata: () => ctx.chatMetadata, extensionKey: 'gd' });
    const variableWriter = extraHost.variableSaveConfirmed && createVariableWriter({ draftPort: variableDraftPort,
        getTarget: () => host?.currentTarget(), getMetadata: () => ctx.chatMetadata, extensionKey: 'gd', saveChatConfirmed: extraHost.variableSaveConfirmed });
    const getSettings = () => { reads++; return settings; };
    const bundleDraftPort = createTaskBundleDraftPort({ getTarget: () => host?.currentTarget(), getSettings, variableDraftPort });
    const configWriter = extraHost.bundleSaveSettings ? createConfigWriter({ getSettings, saveSettings: extraHost.bundleSaveSettings, isBusy: () => false }) : extraHost.configWriter;
    const bundleWriter = variableWriter && configWriter && createTaskBundleWriter({ draftPort: bundleDraftPort, getTarget: () => host?.currentTarget(), variableWriter, configWriter });
    // Existing permission tests explicitly exercise the optional approval mode.
    host = createHostBridge({ getContext: () => ctx, getSettings, extensionKey: 'gd', pageId: 'test', contextConfig: { read: () => ({ ...CONTEXT_DEFAULTS, historyAuthorization: 'ask' }), save: async () => {} }, ...extraHost, configWriter, variableDraftPort, variableWriter, bundleDraftPort, bundleWriter });
    const model = scriptedModel(steps), configs = [];
    const controller = createMuyuController({ host, createModel: config => { configs.push(config); return model; } });
    controller.setMode('memory');
    return { host, ctx, events, settings, model, configs, controller, reads: () => reads,
        enable: () => controller.configure({ endpoint: 'https://example.test/chat/completions', apiKey: 'PRIVATE_KEY', model: 'test', thinking: true }),
        switchChat: id => { ctx.chatId = id; events.emit('chat'); } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await flush(); };

test('Three failed automatic operations pause repeated summaries; manual success resets only that conversation', async () => {
    let saved = { ...CONTEXT_DEFAULTS, inputTokens: 32000, autoSummary: false };
    let hardLimit = false;
    const fail = () => { throw Error('synthetic summary failure'); };
    const f = fixture([[text('seed evidence '.repeat(1000)), done], fail, [text('fallback1'), done], fail, [text('fallback2'), done], fail, [text('fallback3'), done], [text('no further summary'), done], [text('manual summary'), done], [text('merged summary'), done], [text('answer'), done]], {
        contextConfig: { read: () => saved, save: async value => { saved = value; } },
    });
    f.model.inspect = req => ({ estimatedTokens: req.tools.length ? hardLimit ? 40000 : 27000 : 100, requestBytes: 100, messageBytes: 100, toolDefinitionBytes: 0, toolResultBytes: 0, reasoningBytes: 0 });
    await f.enable(); f.controller.setMode('assistant'); await seedTurns(f, 1);
    await f.controller.saveContextConfig({ ...saved, autoSummary: true });
    for (let i = 1; i <= 3; i++) {
        f.controller.setInput('Continue ' + i); f.controller.send(); await settle();
        assert.deepEqual(f.controller.snapshot().autoCompaction, { failures: i, blocked: i === 3 });
    }
    const before = f.model.requests.length;
    f.controller.setInput('Continue without another doomed summary'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, before + 1); assert.equal(f.controller.snapshot().autoCompaction.blocked, true);
    await f.controller.compactHistory(); assert.equal(f.controller.snapshot().autoCompaction.failures, 0);
    // A committed partial summary is progress even if the full answer envelope
    // still cannot fit. Do not falsely trip the breaker on that operation.
    hardLimit = true;
    f.controller.setInput('Continue after manual recovery'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().context.summary, 'merged summary'); assert.equal(f.controller.snapshot().autoCompaction.failures, 0);
    assert.equal(f.controller.snapshot().runs.at(-1).process.error, 'CONTEXT_INCOMPLETE');
    await f.controller.dispose();
});

for (const historyAuthorization of ['auto', 'ask']) test(`BUG-CTX-1: ${historyAuthorization} history transport permits summary after task read grants expire`, async () => {
    let reads = 0;
    const f = fixture([[readSource('variables'), done], [text('SAVED_EVIDENCE'), done], [text('summary reference'), done],
        [readSource('variables'), done], [text('read denied'), done]], {
        contextConfig: { read: () => ({ ...CONTEXT_DEFAULTS, historyAuthorization }) },
        providerPort: { read: () => { reads++; return { text: 'Synthetic variables', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    if (historyAuthorization === 'ask') f.controller.allowHistory();
    await f.controller.compactHistory();
    assert.equal(f.controller.snapshot().context.summary, 'summary reference'); assert.equal(reads, 1);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.setInput('Read variables again'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().interaction.source, 'variables'); assert.equal(reads, 1);
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle(); await f.controller.dispose();
});

test('BUG-CTX-1: automatic compaction saves quoted evidence without reviving task read grants', async () => {
    let reads = 0;
    let savedContext = { ...CONTEXT_DEFAULTS, inputTokens: 40000, autoSummary: false };
    const answer = () => [...Array.from({ length: 4 }, () => text('OLD_EVIDENCE'.repeat(375))), done];
    const f = fixture([[readSource('variables'), done], answer(), answer(), answer(), answer(), [text('summary reference'), done], [text('final answer'), done]], {
        contextConfig: { read: () => savedContext, save: async value => { savedContext = value; } },
        providerPort: { read: () => { reads++; return { text: 'Synthetic variables', limited: false }; } },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    for (let i = 0; i < 3; i++) { f.controller.setInput('Continue ' + i); f.controller.send(); await settle(); }
    await f.controller.saveContextConfig({ ...savedContext, autoSummary: true });
    f.controller.setInput('Summarize and continue'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().context.summary, 'summary reference');
    assert.deepEqual(f.model.requests[5].tools, []); assert.equal(reads, 1);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []); await f.controller.dispose();
});

test('BUG-CTX-1: changing history transport policy invalidates an in-flight summary even if restored', async () => {
    const gate = deferred(); let saved = { ...CONTEXT_DEFAULTS };
    const f = fixture([[text('answer'), done], () => gate.promise], {
        contextConfig: { read: () => saved, save: async value => { saved = structuredClone(value); } },
    });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('question'); f.controller.send(); await settle();
    const pending = f.controller.compactHistory(), rejected = assert.rejects(pending);
    await settle();
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'ask' });
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'auto' });
    gate.resolve([text('obsolete summary'), done]); await rejected;
    assert.equal(f.controller.snapshot().context.summary, ''); await f.controller.dispose();
});

test('Automatic history carries quoted evidence without new host grants; approval and omission remain explicit', async () => {
    let reads = 0, saved = { ...CONTEXT_DEFAULTS };
    const f = fixture([[readSource('variables'), done], [text('SAVED_VARIABLE_EVIDENCE'), done],
        [readSource('variables'), done], [text('denied fresh read'), done], [text('reconnected'), done], [text('without old history'), done]],
        { contextConfig: { read: () => saved, save: async value => { saved = structuredClone(value); } },
            providerPort: { read: () => { reads++; return { text: 'Synthetic variables', limited: false }; } } });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, []);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.setInput('Read again'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    assert.equal(f.controller.snapshot().interaction.source, 'variables'); assert.equal(reads, 1);
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle();
    const id = f.controller.snapshot().history.sessionId;
    await f.enable(); await f.controller.openSession(id);
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, []);
    f.controller.setInput('Continue'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'ask' });
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, ['source:variables']);
    f.controller.setInput('Keep this draft'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.controller.snapshot().input, 'Keep this draft');
    await f.controller.saveContextConfig({ ...saved, historyAuthorization: 'auto' });
    f.controller.setOmitHistory(true); f.controller.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    assert.equal(reads, 1); await f.controller.dispose();
});

test('History approval preserves follow-up context without granting new host reads, and resets on reconnect', async () => {
    const f = fixture([[readSource('variables'), done], [text('SAVED_VARIABLE_EVIDENCE'), done],
        [readSource('variables'), done], [text('fresh read'), done]],
        { providerPort: { read: () => ({ text: 'Synthetic variables', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Read variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    f.controller.setInput('Read them again');
    const calls = f.model.requests.length;
    assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    assert.equal(f.model.requests.length, calls); assert.equal(f.controller.snapshot().input, 'Read them again');
    assert.equal(f.controller.snapshot().context.permissionOmitted, false);
    f.controller.allowHistory();
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, []);
    assert.deepEqual(f.controller.snapshot().sourceGrants, []);
    f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /SAVED_VARIABLE_EVIDENCE/);
    assert.equal(f.controller.snapshot().interaction.source, 'variables');
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    const id = f.controller.snapshot().history.sessionId;
    await f.enable(); await f.controller.openSession(id);
    assert.deepEqual(f.controller.snapshot().history.missingPermissions, ['source:variables']);
    await f.controller.dispose();
});

test('Budget failure releases sending; raising output/data budgets does not grant protected history', async () => {
    const f = fixture([[readSource('variables'), done], () => { throw new ExecutionError('CONTEXT_LIMIT'); }, [text('recovered'), done]],
        { providerPort: { read: () => ({ text: 'variables', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Inspect variables'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'task'); await settle();
    assert.equal(f.controller.snapshot().notice, 'CONTEXT_LIMIT'); assert.equal(f.controller.snapshot().busy, false);
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, maxTokens: 32768, providerBytes: 50000 });
    f.controller.setInput('Continue'); assert.throws(() => f.controller.send(), /HISTORY_PERMISSION_REQUIRED/);
    f.controller.allowHistory(); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.equal(f.model.requests.at(-1).maxTokens, 32768);
    await f.controller.dispose();
});

test('Failed question restores only its text and does not replay a model or tool', async () => {
    const f = fixture([() => { throw Error('Synthetic network failure'); }]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Original question'); f.controller.send(); await settle();
    const before = f.controller.snapshot();
    assert.equal(before.runs.at(-1).status, 'failed'); assert.equal(before.recovery.possibleEffects, false);
    assert.equal(before.input, ''); assert.equal(f.model.requests.length, 1);
    f.controller.setInput('A newer unsent draft');
    assert.throws(() => f.controller.restoreFailedInput(before.recovery.runId), /DRAFT_EXISTS/);
    f.controller.setInput(''); f.controller.restoreFailedInput(before.recovery.runId);
    assert.equal(f.controller.snapshot().input, 'Original question'); assert.equal(f.model.requests.length, 1);
    f.switchChat('B'); assert.equal(f.controller.snapshot().recovery, null);
    await f.controller.dispose();
});

test('Repeated independent failures remain recoverable after persistence and reload', async () => {
    const store = createMemoryHistoryStore(), history = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const fail = () => { throw new ExecutionError('MODEL_NETWORK_ERROR'); };
    const f = fixture([fail, fail], { history }); await f.controller.ready; await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Original question'); f.controller.send(); await settle();
    f.controller.restoreFailedInput(f.controller.snapshot().recovery.runId); f.controller.send(); await settle();
    const state = f.controller.snapshot(), id = state.history.sessionId;
    assert.notEqual(state.runs[0].taskId, state.runs[1].taskId);
    assert.equal(state.recovery.runId, state.runs[1].id);
    await f.controller.flushHistory(); await f.controller.dispose();
    const restored = fixture([], { history }); await restored.controller.ready; await restored.enable(); restored.controller.setMode('assistant');
    await restored.controller.openSession(id);
    restored.controller.restoreFailedInput(restored.controller.snapshot().recovery.runId);
    assert.equal(restored.controller.snapshot().input, 'Original question'); assert.equal(restored.model.requests.length, 0);
    await restored.controller.dispose();
});

test('Failed permission and clarification continuations never offer their replies as original questions', async () => {
    for (const permission of [true, false]) {
        const store = createMemoryHistoryStore(), history = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
        const start = permission ? readSource() : ask();
        const f = fixture([[start, done], () => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }], { history, providerPort: { read: () => ({ text: 'Protected source', limited: false }) } });
        await f.controller.ready; await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Original goal'); f.controller.send(); await settle();
        const interaction = f.controller.snapshot().interaction;
        if (permission) f.controller.answerPermission(interaction.id, 'task');
        else { f.controller.setInteractionDraft(interaction.id, 'Frequency'); f.controller.answerInteraction(interaction.id); }
        await settle();
        const state = f.controller.snapshot(), id = state.history.sessionId;
        assert.equal(state.runs.at(-1).status, 'failed'); assert.equal(state.recovery, null);
        await f.controller.flushHistory(); await f.controller.dispose();
        const restored = fixture([], { history }); await restored.controller.ready; await restored.enable(); restored.controller.setMode('assistant'); await restored.controller.openSession(id);
        assert.equal(restored.controller.snapshot().recovery, null); await restored.controller.dispose();
    }
});

test('Original-history reads stay in the active session and cannot undo an omitted-history choice', async () => {
    const readAttempt = tool('muyu.history.read', { index: 1, fingerprint: 'placeholder', start: 0 });
    const omittedAttempt = tool('muyu.history.read', { index: 1, fingerprint: 'placeholder', start: 0 }, 'omitted');
    const f = fixture([[text('PRIVATE_HISTORY_MARKER'), done], [text('second answer'), done], [tool('muyu.history.list', { offset: 0 }), done],
        [text('listed'), done], [readAttempt, done], [text('read'), done], [omittedAttempt, done], [text('denied'), done]],
    // Leave room for stable instructions; this test concerns history authorization, not the exact instruction size.
    { contextConfig: { read: () => ({ inputTokens: 40000, recentTurns: 1, autoSummary: false }) } });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('First question'); f.controller.send(); await settle();
    const original = JSON.parse(f.controller.exportHistory()).messages[1];
    readAttempt.call.args.fingerprint = fingerprint(original);
    omittedAttempt.call.args.fingerprint = fingerprint(original);
    f.controller.setInput('Second question'); f.controller.send(); await settle();
    f.controller.setInput('List the original messages'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests[3]), /fingerprint/);
    f.controller.setInput('Read the original answer'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_HISTORY_MARKER/);
    f.controller.setOmitHistory(true);
    f.controller.setInput('Try reading omitted history'); f.controller.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PERMISSION_DENIED/);
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_HISTORY_MARKER/);
    await f.controller.dispose();
});

test('A summarized detail is found and read from original history; omission blocks the same search', async () => {
    const body = '预算最新更正为 4200，截止日期是 11月23日。' + '旧讨论正文。'.repeat(300);
    const read = tool('muyu.history.read', { index: 1, fingerprint: 'placeholder', start: 0 }, 'original');
    const search = () => tool('muyu.history.search', { query: '4200', offset: 0, start: 0 });
    const f = fixture([[text(body), done], [text('讨论过预算与日期，细节请查原文。'), done],
        [search(), done], [read, done], [text('旧约定：4200，11月23日；不是当前酒馆配置。'), done],
        [search(), done], [text('未读取被排除的历史。'), done]]);
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('记住这份约定'); f.controller.send(); await settle();
    read.call.args.fingerprint = fingerprint(JSON.parse(f.controller.exportHistory()).messages[1]);
    await f.controller.compactHistory();
    assert.doesNotMatch(f.controller.snapshot().context.summary, /4200|11月23日/);
    f.controller.setInput('之前约定的预算和日期是什么？'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    const searchResult = f.model.requests[3].messages.filter(row => row.role === 'tool').at(-1);
    assert.match(JSON.stringify(searchResult), /4200/); assert.match(JSON.stringify(searchResult), /fingerprint/);
    const readResult = f.model.requests[4].messages.filter(row => row.role === 'tool').at(-1);
    assert.match(JSON.stringify(readResult), /11月23日/);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    f.controller.setOmitHistory(true); f.controller.setInput('本次不要携带历史'); f.controller.send(); await settle();
    const blocked = JSON.stringify(f.model.requests.at(-1));
    assert.match(blocked, /PERMISSION_DENIED/); assert.doesNotMatch(blocked, /11月23日|旧讨论正文/);
    await f.controller.dispose();
});

test('Generated config profile needs one UI approval, records a save-only receipt and leaves active settings alone', async () => {
    const profileSettings = { mode: 'off', topN: 1, configProfiles: [] }; let saves = 0;
    const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => { saves++; return { confirmed: true }; }, getDrawerKeys: () => ({}) });
    const args = { name: 'Two speakers', description: 'For group pacing', settingsJson: '{"mode":"formula","topN":2}' };
    const f = fixture([[tool('muyu.profile.preview', args), done], [text('Profile preview ready'), done]], { profileWriter });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Create a reusable profile; preview first'); f.controller.send(); await settle();
    const draft = f.controller.snapshot().artifacts.find(a => a.kind === 'profile-draft');
    assert.ok(draft); assert.equal(saves, 0); assert.equal(profileSettings.configProfiles.length, 0);
    assert.equal(f.controller.revalidate(draft.id, draft.revision).validation.writes, 'profile-save-only');
    const action = f.controller.prepareProfileSave(draft.id, draft.revision);
    assert.equal(saves, 0);
    await f.controller.approveProfileSave(action.id);
    assert.equal(saves, 1); assert.equal(profileSettings.mode, 'off'); assert.equal(profileSettings.topN, 1);
    assert.deepEqual(profileSettings.configProfiles[0].settings, { mode: 'formula', topN: 2 });
    const receipt = f.controller.snapshot().receipts.find(r => r.operationId === action.id);
    assert.equal(receipt.version, 5); assert.equal(receipt.status, 'saved_confirmed'); assert.equal(receipt.persistence, 'confirmed');
    assert.throws(() => f.controller.approveProfileSave(action.id), /ACTION_STALE/);
    await f.controller.dispose();
});

test('Full access saves an explicitly requested profile, but never auto-saves a preview-only profile', async () => {
    const profileSettings = { configProfiles: [] }; let saves = 0;
    const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => { saves++; return { confirmed: true }; }, getDrawerKeys: () => ({}) });
    const f = fixture([[tool('muyu.profile.preview', { name: 'Preview', settingsJson: '{"topN":2}' }), done], [text('Preview only'), done],
        [tool('muyu.profile.preview', { name: 'Saved', settingsJson: '{"topN":3}', save: true }), done], [text('Save requested'), done]], { profileWriter });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('Preview a reusable profile only'); f.controller.send(); await settle();
    assert.equal(saves, 0); assert.equal(f.controller.snapshot().profileActions.length, 0);
    f.controller.setInput('Create and save another profile'); f.controller.send(); await settle();
    assert.equal(saves, 1); assert.deepEqual(profileSettings.configProfiles.map(p => p.name), ['Saved']);
    await f.controller.dispose();
});

test('Two profile previews in one run publish independently and save only requested candidates', async () => {
    for (const saveA of [false, true]) {
        const profileSettings = { configProfiles: [] };
        const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => ({ confirmed: true }), getDrawerKeys: () => ({}) });
        const f = fixture([[tool('muyu.profile.preview', { name: 'A', settingsJson: '{"topN":2}', save: saveA }, 'profile-a'),
            tool('muyu.profile.preview', { name: 'B', settingsJson: '{"topN":3}', save: true }, 'profile-b'), done], [text('Both profiles ready'), done]], { profileWriter });
        await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
        f.controller.setInput('Prepare two separate profiles'); f.controller.send(); await settle();
        const state = f.controller.snapshot(), drafts = state.artifacts.filter(a => a.kind === 'profile-draft');
        assert.deepEqual(drafts.map(a => [a.content.name, a.content.settings.topN]), [['A', 2], ['B', 3]]);
        assert.deepEqual(profileSettings.configProfiles.map(p => [p.name, p.settings.topN]), saveA ? [['A', 2], ['B', 3]] : [['B', 3]]);
        assert.equal(state.notice, null);
        await f.controller.dispose();
    }
});

test('Profile previews on either side of a permission handoff both remain publishable', async () => {
    const f = fixture([[tool('muyu.profile.preview', { name: 'A', settingsJson: '{"topN":2}' }, 'profile-a'),
        tool('muyu.settings.read', { fields: ['topN'] }, 'read-top-n'), done],
    [tool('muyu.profile.preview', { name: 'B', settingsJson: '{"topN":3}' }, 'profile-b'), done], [text('Ready'), done]]);
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Prepare two profiles and inspect topN'); f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction;
    assert.equal(request?.kind, 'permission');
    f.controller.answerPermission(request.id, 'task'); await settle();
    const state = f.controller.snapshot();
    assert.deepEqual(state.artifacts.filter(a => a.kind === 'profile-draft').map(a => [a.content.name, a.content.settings.topN]), [['A', 2], ['B', 3]]);
    assert.equal(state.notice, null);
    await f.controller.dispose();
});

test('A profile tool cannot request direct saving outside full-access mode', async () => {
    const profileSettings = { configProfiles: [] }; let saves = 0;
    const profileWriter = createProfileWriter({ getSettings: () => profileSettings, saveSettings: async () => { saves++; return { confirmed: true }; }, getDrawerKeys: () => ({}) });
    const f = fixture([[tool('muyu.profile.preview', { name: 'Denied', settingsJson: '{"topN":2}', save: true }), done], [text('No direct save'), done]], { profileWriter });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('Save directly'); f.controller.send(); await settle();
    assert.equal(saves, 0); assert.equal(profileSettings.configProfiles.length, 0);
    assert.equal(f.controller.snapshot().artifacts.some(a => a.kind === 'profile-draft'), false);
    await f.controller.dispose();
});

test('Full access directly grants reads and applies only an explicitly requested preview without approval calls', async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { autoMemoryInterval: 15 }, apply: true }), done], [text('等待操作回执'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('把自动记忆间隔改成 15'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.settings.autoMemoryInterval, 15, JSON.stringify({ artifacts: f.controller.snapshot().artifacts, actions: f.controller.snapshot().configActions, notice: f.controller.snapshot().notice, process: f.controller.snapshot().runs.at(-1)?.process }));
    assert.equal(saves, 1);
    assert.equal(f.controller.snapshot().configActions.length, 1);
    assert.equal(f.controller.snapshot().configActions[0].status, 'applied_unconfirmed');
    await f.controller.dispose();
});

test('Full access respects preview-only intent and reconnect turns the mode off', async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('只预览'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('只预览，不要应用'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().artifacts.some(a => a.kind === 'config-draft'), true);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    assert.equal(f.settings.autoMemoryInterval, 10); assert.equal(saves, 0);
    await f.enable(); assert.equal(f.controller.snapshot().fullAccess, false);
    await f.controller.dispose();
});

test('Without full access a model cannot request direct application', async () => {
    let saves = 0;
    const f = fixture([[tool('muyu.settings.preview', { changes: { autoMemoryInterval: 15 }, apply: true }), done], [text('未应用'), done]],
        { bundleSaveSettings: async () => { saves++; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('修改间隔'); f.controller.send(); await settle();
    assert.equal(f.settings.autoMemoryInterval, 10); assert.equal(saves, 0);
    assert.equal(f.controller.snapshot().configActions.length, 0);
    await f.controller.dispose();
});

test('Full access continues a task plan and executes one bounded bundle without permission handoffs', async () => {
    let chatSaves = 0, settingsSaves = 0;
    const bundle = { variables: [{ action: 'create', id: 'party_gold', label: 'Party gold', initialValue: 0,
        rule: 'Update on explicit transaction', autoUpdate: true, injectMode: 'always', updateMode: 'delta' }],
    settingsJson: '{"memoryEnabled":false}', apply: true };
    const f = fixture([[taskPlan(), done], [text('继续'), done], [tool('muyu.task.preview', bundle), done], [text('等待操作回执'), done]],
        { variableSaveConfirmed: async () => { chatSaves++; }, bundleSaveSettings: async () => { settingsSaves++; return { confirmed: true }; } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true);
    f.controller.setInput('建立金币系统并启用'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.controller.snapshot().approvedPlans.length, 1);
    assert.equal(f.controller.snapshot().bundleActions[0]?.status, 'applied_confirmed');
    assert.equal(chatSaves, 1); assert.equal(settingsSaves, 1);
    assert.equal(f.settings.memoryEnabled, false);
    await f.controller.dispose();
});

test('Instruction edits are draft-only, pinned at send time and not duplicated into task/user/history data', async () => {
    const gate = deferred(), saved = [];
    const f = fixture([() => gate.promise, [text('next'), done]], { instructionConfig: { read: () => ({ enabled: false, text: '' }), save: async value => saved.push(value) } });
    await f.enable(); f.controller.setInstructionDraft({ enabled: true, text: 'FIRST_STYLE' }); await f.controller.saveInstructions();
    f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    f.controller.setInstructionDraft({ enabled: true, text: 'NEXT_STYLE' }); await f.controller.saveInstructions();
    assert.equal(f.model.requests[0].instructions.preference, 'FIRST_STYLE');
    assert.equal(f.model.requests[0].messages.filter(m => m.content === 'question').length, 1);
    assert.equal(f.model.requests[0].messages.some(m => m.content?.startsWith('Task context supplied')), false);
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

test('Near-full summarized archive rejects a large question before queue/model calls and preserves the draft', async () => {
    const store = createMemoryHistoryStore();
    const f = fixture([[text('must not run'), done]], { history: { enabled: () => true, open: async () => store, setEnabled: async () => {} } });
    await f.controller.ready;
    const record = { version: 7, id: crypto.randomUUID(), revision: 0, scope: historyScope('assistant', f.host.currentTarget()), title: 'large fixture', createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'succeeded', archived: false, imported: false, receipts: [], scopeChanges: [], contextSummary: null };
    for (let i = 0; i < 32; i++) record.messages.push({ role: i % 2 ? 'assistant' : 'user', runId: String(i), content: 'x'.repeat(1024 * 1024 - 10000) });
    record.contextSummary = { through: 32, fingerprint: fingerprint(record.messages), text: 'Synthetic summary.', createdAt: 1 };
    record.messages[31].content += 'x'.repeat(HISTORY_LIMITS.recordBytes - 210000 - historyBytes(record));
    record.contextSummary.fingerprint = fingerprint(record.messages);
    await store.create(record); await f.controller.refreshHistory(); await f.enable(); f.controller.setMode('assistant'); await f.controller.openSession(record.id);
    const input = 'question ' + 'b'.repeat(150000); f.controller.setInput(input);
    assert.throws(() => f.controller.send(), /HISTORY_CAPACITY/); await settle();
    assert.equal(f.model.requests.length, 0); assert.equal(f.controller.snapshot().runs.length, 0);
    assert.equal(f.controller.snapshot().input, input);
    assert.equal(JSON.parse(f.controller.exportHistory()).messages.length, 32);
    await f.controller.dispose();
});

test('Unexpected capacity failure during final capture is visible, exportable and does not break disposal', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('question'); f.controller.send(); await settle();
    const clone = globalThis.structuredClone; let injected = false;
    globalThis.structuredClone = value => {
        if (!injected && value?.version >= 5 && value.status === 'succeeded' && value.messages?.at(-1)?.content === 'RECOVERY_ANSWER') {
            injected = true; throw Error('HISTORY_CAPACITY');
        }
        return clone(value);
    };
    try { wait.resolve([text('RECOVERY_ANSWER'), done]); await settle(); }
    finally { globalThis.structuredClone = clone; }
    assert.equal(injected, true); const s = f.controller.snapshot();
    assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.notice, 'HISTORY_SYNC_FAILED');
    assert.equal(s.history.error, 'HISTORY_CAPACITY'); assert.equal(s.history.recovery, true);
    assert.equal(JSON.parse(f.controller.exportHistory()).messages.at(-1).content, 'RECOVERY_ANSWER');
    await f.controller.dispose();
});

test('Manual compaction rejects a switched chat before any paid call and succeeds again in the original chat', async () => {
    const f = fixture([[text('a'.repeat(2000)), done], [text('Valid short summary.'), done]]);
    await f.enable(); f.controller.setMode('assistant'); f.controller.setInput('story'); f.controller.send(); await settle();
    f.switchChat('B'); assert.equal(f.controller.snapshot().switchedChat, true);
    assert.equal(f.controller.snapshot().readOnly, false);
    await assert.rejects(f.controller.compactHistory(), /HISTORY_SCOPE/);
    assert.equal(f.model.requests.length, 1); assert.equal(f.controller.snapshot().context.summary, '');
    f.switchChat('A'); await f.controller.compactHistory();
    assert.equal(f.model.requests.length, 2); assert.equal(f.controller.snapshot().context.summary, 'Valid short summary.');
    await f.controller.dispose();
});

test('Controller avoids unnecessary recompaction and retains all intermediate corrections', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), [text('old budget 3700'), done],
        [text('revision acknowledged'), done], [text('filler answer'), done], [text('4200'), done]],
        { contextConfig: { read: () => ({ inputTokens: 64000, recentTurns: 1, autoSummary: false }), save: async () => {} } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true); await seedTurns(f);
    await f.controller.compactHistory();
    await f.controller.saveContextConfig({ inputTokens: 64000, recentTurns: 1, autoSummary: true });
    for (const input of ['Revision: 4200 replaces 3700', 'Discuss another topic', 'What is the budget?']) {
        f.controller.setInput(input); f.controller.send(); await settle();
    }
    const snapshot = f.controller.snapshot(), last = snapshot.runs.at(-1);
    assert.equal(last.status, 'succeeded'); assert.equal(last.process.coverage.status, 'skipped');
    assert.equal(last.process.coverage.omitted, 0); assert.equal(last.process.coverage.summarized, 6);
    assert.match(JSON.stringify(f.model.requests.at(-1)), /Revision: 4200 replaces 3700/);
    assert.equal(snapshot.context.coverage.state, 'complete'); assert.equal(snapshot.messages.length, 14);
    await f.controller.dispose();
});

test('Blocked controller history is recoverable only by explicit omission or a fitting context', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), [text('old summary'), done],
        [...Array.from({ length: 8 }, () => text('中'.repeat(4000))), done], [text('fresh answer'), done]],
        // Fits the initial requests, but not the deliberately oversized generated history below.
        { contextConfig: { read: () => ({ inputTokens: 40000, recentTurns: 2, autoSummary: false }) } });
    await f.enable(); f.controller.setMode('assistant'); f.controller.setFullAccess(true); await seedTurns(f);
    await f.controller.compactHistory(); f.controller.setInput('Long answer'); f.controller.send(); await settle();
    const before = f.model.requests.length, rawCount = f.controller.snapshot().messages.length;
    assert.equal(f.controller.snapshot().context.coverage.state, 'blocked');
    f.controller.setInput('Continue'); f.controller.send(); await settle();
    const blocked = f.controller.snapshot(); assert.equal(blocked.runs.at(-1).process.coverage.status, 'blocked');
    assert.equal(blocked.notice, 'CONTEXT_INCOMPLETE'); assert.equal(f.model.requests.length, before);
    f.controller.setOmitHistory(true); assert.equal(f.controller.snapshot().context.coverage.state, 'omitted');
    f.controller.setInput('Start fresh'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, before + 1); assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /old summary|中{100}/);
    assert.ok(f.controller.snapshot().messages.length >= rawCount); await f.controller.dispose();
});

test('Changing context policy during a pending read never compacts the live continuation', async () => {
    const f = fixture([...Array.from({ length: 4 }, () => [text('answer'), done]), [text('reference'), done],
        [readSource('variables'), done], [text('continued answer'), done]],
        { contextConfig: { read: () => ({ inputTokens: 64000, recentTurns: 2, autoSummary: false }), save: async () => {} }, providerPort: { read: () => ({ text: 'Authorized variables', limited: false }) } });
    await f.enable(); f.controller.setMode('assistant'); await seedTurns(f);
    await f.controller.compactHistory(); f.controller.setInput('Read variables'); f.controller.send(); await settle();
    const pending = f.controller.snapshot().interaction; assert.equal(pending.status, 'pending'); assert.equal(pending.kind, 'permission');
    await f.controller.saveContextConfig({ inputTokens: 64000, recentTurns: 1, autoSummary: true });
    f.controller.answerPermission(pending.id, 'task'); await settle();
    assert.equal(f.model.requests.length, 7); assert.ok(f.model.requests.at(-1).tools.length > 0);
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    assert.match(JSON.stringify(f.model.requests.at(-1)), /Authorized variables/); await f.controller.dispose();
});
test('Manual context summary preserves transcript, survives stored reload and does not replay grants', async () => {
    const store = createMemoryHistoryStore(), historyPort = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const f = fixture([...Array.from({ length: 4 }, () => [text('old answer'.repeat(20)), done]), [text('summary reference'), done]], { history: historyPort });
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
    const f = fixture([...Array.from({ length: 4 }, () => [...Array.from({ length: 4 }, () => text('PRIVATE_OLD'.repeat(375))), done]), [text('summary'), done], [text('answer'), done], [text('no history'), done]], {
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

test('A long answer is carried into the next request when the configured input budget fits', async () => {
    const longAnswer = '中'.repeat(9000);
    const f = fixture([[text(longAnswer), done], [text('Continue step three'), done]], {
        contextConfig: { read: () => ({ inputTokens: 128000, recentTurns: 12, autoSummary: false }) },
    });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Draft a plan'); f.controller.send(); await settle();
    f.controller.setInput('Continue step three'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.model.requests[1].messages.some(m => m.content === longAnswer), true);
    assert.equal(f.controller.snapshot().runs.at(-1).process.context.historicalMessages, 2);
    await f.controller.dispose();
});

test('An uncarried recent long answer can be summarized once before the follow-up', async () => {
    const longAnswer = '中'.repeat(23000);
    const f = fixture([[...Array.from({ length: 8 }, (_, i) => text(longAnswer.slice(i * 3000, (i + 1) * 3000))).filter(e => e.text), done], [text('Step three: verify the balance'), done], [text('Continue'), done]], {
        contextConfig: { read: () => ({ inputTokens: 38000, recentTurns: 12, autoSummary: true }) },
    });
    await f.enable(); f.controller.setMode('assistant');
    f.controller.setInput('Draft a plan'); f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().context.turns, 0);
    f.controller.setInput('Continue step three'); f.controller.send(); await settle();
    assert.equal(f.model.requests.length, 3);
    assert.deepEqual(f.model.requests[1].tools, []);
    assert.match(f.model.requests[1].messages.slice(1).map(message => JSON.parse(message.content).text).join(''), /中{100}/);
    assert.equal(f.controller.snapshot().context.summary, 'Step three: verify the balance');
    assert.match(JSON.stringify(f.model.requests[2].messages), /Step three: verify the balance/);
    assert.equal(f.controller.snapshot().runs.at(-1).process.budget.modelCalls, 2);
    await f.controller.dispose();
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

test('Opted-in connection auto-enables after restart without restoring grants, and disable persists opt-out', async () => {
    const settings = {}; let saves = 0;
    const credentials = createCredentialStore({ getSettings: () => settings, saveSettings: () => saves++ });
    const f = fixture(undefined, { credentials });
    f.controller.setInput('unsent question');
    await f.controller.configure({ endpoint: 'https://saved.test/chat/completions', apiKey: 'SYNTHETIC_KEY', model: 'm', rememberKey: true, autoConnect: true });
    assert.equal(f.controller.snapshot().input, 'unsent question');
    f.controller.grantPermission('diagnostics'); await f.controller.dispose();
    const g = fixture(undefined, { credentials });
    assert.equal(g.controller.snapshot().enabled, true);
    assert.equal(g.controller.snapshot().permissions.diagnostics, false);
    assert.doesNotMatch(JSON.stringify(g.controller.snapshot()), /SYNTHETIC_KEY/);
    assert.equal(g.configs[0].connection.apiKey, 'SYNTHETIC_KEY');
    await g.controller.disable(); assert.equal(credentials.describe().autoConnect, false);
    await g.controller.dispose();
    const h = fixture(undefined, { credentials }); assert.equal(h.controller.snapshot().enabled, false);
    assert.ok(saves >= 2); await h.controller.dispose();
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
