import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { configFields, dependencyFields, fieldDefinition, previewSettings, readSettingsFields } from '../../muyu/config/registry.js';
import { assertConfigurationCoverage, configurationCoverage, dynamicSettings } from '../../muyu/config/coverage.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createConfigActions } from '../../muyu/actions/config-apply.js';
import { actionReceipt, validateReceipt, receiptContext } from '../../muyu/actions/receipts.js';
import { validateRecord } from '../../muyu/sessions/contract.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { importedRecord } from '../../muyu/sessions/exchange.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { assistantToolAccess, requiredSources } from '../../muyu/application/capabilities.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { scoreFormulaCharacter } from '../../systems/speaker-selection.js';
import { matchesTrigger, rollInitiative } from '../../systems/trigger-initiative.js';

const target = { kind: 'global', userKey: 'test' };
const baselineFor = (settings, patch) => readSettingsFields(settings, dependencyFields(Object.keys(patch)));
function fixture(patch, save = async () => undefined) {
    const settings = structuredClone(DEFAULT_SETTINGS), baseline = baselineFor(settings, patch);
    const preview = previewSettings({ baseline, changes: patch });
    let busy = false, saves = 0;
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => busy, saveSettings: () => { saves++; return save(); } });
    const artifact = { id: 'a', revision: 1, kind: 'config-draft', sessionId: 's', content: { module: 'settings-config', baseline, preview } };
    const actions = createConfigActions({ getArtifact: () => structuredClone(artifact), getTarget: () => target, writer,
        validate: () => { if (JSON.stringify(baselineFor(settings, patch)) !== JSON.stringify(baseline)) throw Error('STALE_BASELINE'); } });
    return { settings, baseline, writer, actions, saves: () => saves, busy: () => { busy = true; } };
}
test('Configuration coverage explicitly owns every default key and separates pending resources', () => {
    assert.equal(assertConfigurationCoverage(), Object.keys(DEFAULT_SETTINGS).length);
    const rows = configurationCoverage(); assert.equal(rows.find(r => r.key === 'agentConfigs').status, 'special-editor-pending');
    assert.equal(rows.find(r => r.key === 'agentConfigs').secret, true);
    assert.equal(rows.find(r => r.key === 'scoreWeights').fields.length, 4);
    assert.ok(dynamicSettings.userProviders); assert.ok(dynamicSettings.uiState);
    DEFAULT_SETTINGS.newUnregisteredSetting = false;
    try { assert.throws(assertConfigurationCoverage, /DRIFT/); } finally { delete DEFAULT_SETTINGS.newUnregisteredSetting; }
});
test('Registered projection never traverses credentials or arbitrary paths', () => {
    const settings = { mode: 'formula', get agentConfigs() { throw Error('SECRET'); } };
    assert.deepEqual(readSettingsFields(settings, ['mode']), { mode: 'formula' });
    for (const fields of [['agentConfigs'], ['scoreWeights.constructor'], [], ['mode', 'mode']]) assert.throws(() => readSettingsFields(settings, fields));
});
test('Domain validation rejects coercion, invalid ranges, undeclared fields and oversized prompt', () => {
    for (const changes of [{ mode: 'invalid' }, { topN: '3' }, { llmMaxSpeakers: 21 }, { 'scoreWeights.talkativeness': 0 }, { providerTimeoutMs: -1 }, { apiKey: 'secret' }, { llmPrompt: 'x'.repeat(4001) }, { worldBookSourceMode: 'all' }, { worldBookMaxEntries: 0 }, { worldBookMaxEntries: 201 }]) assert.throws(() => previewSettings({ baseline: {}, changes }));
    assert.equal(previewSettings({ baseline: {}, changes: { llmPrompt: '{{provider}}\nnot JSON' } }).manifest.settings.llmPrompt, '{{provider}}\nnot JSON');
});
test('World-book mode and result limit preview preserve manual selection and require one explicit apply', async () => {
    const patch = { worldBookSourceMode: 'manual', worldBookMaxEntries: 12 };
    const f = fixture(patch); f.settings.worldBookSelection = { BookA: true };
    const baseline = baselineFor(f.settings, patch);
    assert.deepEqual(Object.keys(baseline).sort(), Object.keys(patch).sort());
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    const preview = previewSettings({ baseline, changes: patch });
    assert.ok(preview.warnings.includes('WORLD_BOOK_MANUAL_SELECTION_REQUIRED'));
    assert.deepEqual(preview.manifest.settings, patch);
    assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.saves(), 1);
    assert.deepEqual(f.settings.worldBookSelection, { BookA: true });
    assert.equal(f.settings.worldBookSourceMode, 'manual');
    assert.equal(f.settings.worldBookMaxEntries, 12);
});
test('Leaf writes preserve sibling concurrent updates and never initialize unrelated defaults', async () => {
    const f = fixture({ 'scoreWeights.mention': 50 }); const a = f.actions.prepare('a', 1);
    f.settings.scoreWeights.keyword = 99; f.settings.agentConfigs = { secret: 'keep' };
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.deepEqual(f.settings.scoreWeights, { mention: 50, keyword: 99, recency: 20, talkativeness: 10 });
    assert.deepEqual(f.settings.agentConfigs, { secret: 'keep' });
});
test('Changed leaf or semantic dependency invalidates preview, unrelated memory flag does not', async () => {
    const f = fixture({ autoMemoryInterval: 15 }); const a = f.actions.prepare('a', 1);
    f.settings.autoMemorySpeakers = true;
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    const g = fixture({ autoMemoryInterval: 15 }); const b = g.actions.prepare('a', 1); g.settings.memoryEnabled = true;
    assert.throws(() => g.actions.approve(b.id), /STALE/); assert.equal(g.saves(), 0);
});
test('Runtime busy after preview refuses all changes before assignment', async () => {
    const f = fixture({ mode: 'llm', providerTimeoutMs: 800 }); const a = f.actions.prepare('a', 1); f.busy();
    assert.equal((await f.actions.approve(a.id)).status, 'not_executed'); assert.equal(f.settings.mode, 'formula'); assert.equal(f.settings.providerTimeoutMs, 10000); assert.equal(f.saves(), 0);
});
test('Property write preflight prevents half-applied patch on read-only leaf', async () => {
    const f = fixture({ topN: 2, 'scoreWeights.mention': 50 });
    Object.defineProperty(f.settings.scoreWeights, 'mention', { value: 30, enumerable: true, writable: false });
    await assert.rejects(f.writer.apply({ baseline: f.baseline, changes: { topN: 2, 'scoreWeights.mention': 50 }, contractVersion: 2 }), /WRITE_UNAVAILABLE/);
    assert.equal(f.settings.topN, 1); assert.equal(f.saves(), 0);
});
test('Long prompt survives preview, one-time approval and versioned receipt without truncation', async () => {
    const prompt = 'Evidence and scope.\n'.repeat(100), f = fixture({ llmPrompt: prompt }); const a = f.actions.prepare('a', 1);
    const done = f.actions.approve(a.id); assert.throws(() => f.actions.approve(a.id)); const result = await done;
    assert.equal(f.settings.llmPrompt, prompt); assert.equal(f.saves(), 1);
    const receipt = validateReceipt(actionReceipt(result)); assert.equal(receipt.version, 2); assert.equal(JSON.parse(receipt.diff[0].after), prompt);
});
test('Rejected async save preserves imported value and later edits with an honest warning', async () => {
    let reject; const f = fixture({ 'scoreWeights.mention': 50 }, () => new Promise((_, r) => { reject = r; }));
    const a = f.actions.prepare('a', 1), done = f.actions.approve(a.id); await Promise.resolve();
    f.settings.scoreWeights.mention = 77; f.settings.scoreWeights.keyword = 99; reject(Error('private'));
    const r = await done; assert.equal(r.result.saveError, true); assert.equal(r.result.changed, true); assert.equal(f.settings.scoreWeights.mention, 77); assert.equal(f.settings.scoreWeights.keyword, 99);
});
test('Every supported field declares read dependencies; unknown read tools fail closed', () => {
    const permissions = createPermissions();
    for (const field of configFields) assert.ok(requiredSources('muyu.settings.read', { fields: [field] }).length);
    assert.equal(assistantToolAccess({ id: 'unknown', effect: 'read' }, {}, target, 'task', permissions).decision, 'policy_forbidden');
    permissions.grant('diagnostics', target);
    assert.equal(assistantToolAccess({ id: 'muyu.settings.read', effect: 'read' }, { fields: ['llmPrompt'] }, target, 'task', permissions).decision, 'permission_required');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { autoMemoryInterval: 15, mode: 'llm' } }), ['source:memoryConfig', 'source:configSettings']);
});
test('Settings catalog is public without host reads; unauthorized reads never enter host', async () => {
    let reads = 0; const module = createSettingsModule({ getSettings: () => { reads++; return DEFAULT_SETTINGS; }, getTarget: () => target });
    const permissions = createPermissions(), broker = createToolBroker({ registry: module.registry, handlers: module.handlers, target, runId: 'r', signal: new AbortController().signal, maxCalls: 4, allowedTools: module.registry.list().map(d => d.id),
        policy: ({ definition, args }) => assistantToolAccess(definition, args, target, 't', permissions).decision });
    assert.equal((await broker.call({ toolId: 'muyu.settings.catalog', version: 1, callId: '1', args: {} })).ok, true); assert.equal(reads, 0);
    assert.equal((await broker.call({ toolId: 'muyu.settings.read', version: 1, callId: '2', args: { fields: ['mode'] } })).ok, false); assert.equal(reads, 0);
    for (const [callId, domain, field] of [['3', 'summary', 'summaryPrompt'], ['4', 'critique', 'critiquePrompt']]) {
        const contract = await broker.call({ toolId: 'muyu.settings.contract', version: 1, callId, args: { domain } });
        assert.equal(contract.ok, true);
        assert.ok(JSON.parse(contract.data.text).some(row => row.id === field));
    }
    assert.equal(reads, 0);
    module.dispose();
});

test('General receipt history carries exact dependencies and import restores no approval', async () => {
    const f = fixture({ llmPrompt: 'Long prompt. '.repeat(200) }), a = f.actions.prepare('a', 1);
    const receipt = actionReceipt(await f.actions.approve(a.id));
    const library = createSessionLibrary(); await library.ready; const id = library.create(JSON.stringify(['assistant', 'global', null]));
    library.recordReceipt(id, receipt); const record = library.get(id);
    assert.deepEqual(record.required, ['source:configSettings']);
    assert.throws(() => validateRecord({ ...record, required: ['source:memoryConfig'] }));
    const imported = importedRecord(record); assert.equal(imported.imported, true); assert.equal(imported.receipts[0].diff[0].after, receipt.diff[0].after); assert.equal(imported.configActions, undefined);
    const context = receiptContext([receipt]); assert.match(context, /display excerpt/); assert.ok(context.length < 6000);
    await library.close();
});

test('Multiple large action records remain individually bounded, not one oversized DTO', async () => {
    const actions = createConfigActions({ getTarget: () => target, writer: {}, validate: () => {},
        getArtifact: id => ({ id, sessionId: 's', revision: 1, kind: 'config-draft', content: { baseline: {}, preview: previewSettings({ baseline: {}, changes: { llmPrompt: 'x'.repeat(4000) } }) } }) });
    for (let i = 0; i < 6; i++) actions.prepare('a' + i, 1);
    assert.equal(actions.list().length, 6);
    const copy = actions.list(); copy[0].status = 'applied_confirmed'; assert.equal(actions.list()[0].status, 'pending');
});

test('Provider timeout update calls the host save path with the new setting', async () => {
    const settings = { providerTimeoutMs: 10000 }; let appliedTimeout;
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => { appliedTimeout = settings.providerTimeoutMs; } });
    await writer.apply({ baseline: { providerTimeoutMs: 10000 }, changes: { providerTimeoutMs: 0 }, contractVersion: 2 });
    assert.equal(appliedTimeout, 0);
});

test('Speaker rules declare their real consumers, bounded inputs and dependent conditions', () => {
    const fields = ['recentMessageCount', 'consecutivePenalty', 'triggerEnabled', 'triggerScore', 'initiativeEnabled', 'initiativeBaseScore', 'llmContextDepth', 'llmRespectOrder', 'llmCharDescMode', 'llmCharDescLength'];
    assert.equal(configFields.length, 46);
    assert.equal(configurationCoverage().find(row => row.key === 'recentMessageCount').status, 'supported');
    assert.equal(configurationCoverage().find(row => row.key === 'llmContextDepth').status, 'supported');
    for (const id of fields) {
        const contract = fieldDefinition(id);
        assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.ok(contract.description.length > 20);
        assert.ok(contract.source.startsWith('ui/sections/'));
    }
    assert.deepEqual(dependencyFields(['triggerScore']), ['mode', 'triggerEnabled', 'triggerScore']);
    assert.deepEqual(dependencyFields(['initiativeBaseScore']), ['initiativeBaseScore', 'initiativeEnabled', 'mode']);
    assert.deepEqual(dependencyFields(['llmCharDescLength']), ['llmCharDescLength', 'llmCharDescMode']);
    for (const changes of [{ recentMessageCount: 0 }, { consecutivePenalty: -1 }, { triggerEnabled: 'yes' }, { triggerScore: -1 }, { initiativeEnabled: 1 }, { initiativeBaseScore: -1 }, { llmContextDepth: 201 }, { llmRespectOrder: 'false' }, { llmCharDescMode: 'none' }, { llmCharDescLength: 4001 }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Speaker-rule preview reports dormant settings and refuses changed semantic preconditions', async () => {
    const dormant = structuredClone(DEFAULT_SETTINGS); dormant.mode = 'llm'; dormant.triggerEnabled = false; dormant.initiativeEnabled = false; dormant.llmCharDescMode = 'full';
    const patch = { triggerScore: 70, initiativeBaseScore: 12, llmCharDescLength: 300 };
    const baseline = baselineFor(dormant, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['FORMULA_MODE_INACTIVE', 'TRIGGER_DISABLED', 'INITIATIVE_DISABLED', 'CHAR_DESC_NOT_SLICED']);
    const writer = createConfigWriter({ getSettings: () => dormant, saveSettings: async () => undefined, isBusy: () => false });
    dormant.triggerEnabled = true;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(dormant.triggerScore, 40);
});

test('Approved formula changes feed the next scoring and trigger calculation', async () => {
    const f = fixture({ triggerScore: 70, consecutivePenalty: 5, initiativeBaseScore: 12, recentMessageCount: 3 });
    const a = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    const character = { name: 'Alice', avatar: 'alice', description: 'forest guardian', talkativeness: 0.5 };
    const chat = [{ name: 'Alice', avatar: 'alice', mes: 'Hello' }], recentMessages = [{ is_user: true, mes: 'forest' }];
    assert.equal(matchesTrigger(character, recentMessages, { enabled: f.settings.triggerEnabled }), true);
    assert.equal(rollInitiative({ enabled: f.settings.initiativeEnabled, baseScore: f.settings.initiativeBaseScore, random: () => 0.5 }), 6);
    const score = scoreFormulaCharacter({ character, recentMessages, chat, scoreWeights: f.settings.scoreWeights, triggerScore: f.settings.triggerScore, consecutivePenalty: f.settings.consecutivePenalty, triggered: true, initiative: 6 });
    assert.equal(score.score, 96);
    assert.equal(f.settings.recentMessageCount, 3);
    assert.equal(f.saves(), 1);
});

test('Director shared depth and order changes require idle writer and preserve siblings', async () => {
    const f = fixture({ llmContextDepth: 24, llmRespectOrder: false, llmCharDescMode: 'full', llmCharDescLength: 120 });
    const a = f.actions.prepare('a', 1); f.settings.llmPrompt = 'concurrent UI draft';
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.llmContextDepth, 24); assert.equal(f.settings.llmRespectOrder, false);
    assert.equal(f.settings.llmCharDescMode, 'full'); assert.equal(f.settings.llmCharDescLength, 120);
    assert.equal(f.settings.llmPrompt, 'concurrent UI draft');
    const blocked = fixture({ llmRespectOrder: false }); const b = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(b.id)).status, 'not_executed'); assert.equal(blocked.settings.llmRespectOrder, true);
});

test('Memory keep-recent contract names both manual consumers without implying an automatic action', () => {
    const contract = fieldDefinition('memoryKeepRecent');
    assert.equal(contract.domain, 'memory');
    assert.equal(contract.scope, 'global');
    assert.equal(contract.applies, 'next-use');
    assert.equal(contract.source, 'ui/sections/memory.js');
    assert.match(contract.description, /压缩/);
    assert.match(contract.description, /撤销/);
    assert.match(contract.description, /不会立即/);
    assert.deepEqual(dependencyFields(['memoryKeepRecent']), ['memoryEnabled', 'memoryKeepRecent']);
    assert.equal(configurationCoverage().find(row => row.key === 'memoryKeepRecent').status, 'supported');
    assert.equal(configurationCoverage().find(row => row.key === 'memoryTokenBudget').status, 'pending');
    assert.equal(configurationCoverage().find(row => row.key === 'memoryMaxEntries').status, 'supported');
    for (const changes of [{ memoryKeepRecent: 0 }, { memoryKeepRecent: 101 }, { memoryKeepRecent: '5' }, { memoryKeepRecent: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Memory keep-recent preview and approved write preserve unrelated memory settings', async () => {
    const f = fixture({ memoryKeepRecent: 8 });
    const preview = previewSettings({ baseline: f.baseline, changes: { memoryKeepRecent: 8 } });
    assert.deepEqual(preview.warnings, ['MEMORY_NOT_ENABLED']);
    assert.deepEqual(preview.diff, [{ field: 'memoryKeepRecent', before: '5', after: '8' }]);
    const action = f.actions.prepare('a', 1);
    f.settings.autoMemoryInterval = 37;
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.memoryKeepRecent, 8);
    assert.equal(f.settings.autoMemoryInterval, 37);
    assert.equal(f.saves(), 1);
    const stale = fixture({ memoryKeepRecent: 8 });
    const staleAction = stale.actions.prepare('a', 1);
    stale.settings.memoryEnabled = true;
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
    assert.equal(stale.saves(), 0);
});

test('Summary settings declare global scope, activation dependencies and supported interval', () => {
    const ids = ['summaryEnabled', 'autoSummaryEnabled', 'autoSummaryInterval', 'summaryReusePrevious'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'summary'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/chatSummary.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['autoSummaryInterval']), ['autoSummaryEnabled', 'autoSummaryInterval', 'summaryEnabled']);
    assert.deepEqual(dependencyFields(['summaryReusePrevious']), ['summaryEnabled', 'summaryReusePrevious']);
    for (const changes of [{ summaryEnabled: 'true' }, { autoSummaryEnabled: 1 }, { autoSummaryInterval: 0 }, { autoSummaryInterval: 201 }, { summaryReusePrevious: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Summary preview warns about inactive switches and rejects changed activation conditions', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const patch = { autoSummaryInterval: 15, summaryReusePrevious: false };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['SUMMARY_DISABLED', 'AUTO_SUMMARY_DISABLED']);
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    settings.summaryEnabled = true;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.autoSummaryInterval, 10);
    const dormant = fixture({ autoSummaryInterval: 15 });
    const action = dormant.actions.prepare('a', 1);
    assert.equal((await dormant.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(dormant.settings.autoSummaryInterval, 15); assert.equal(dormant.saves(), 1);
    assert.equal(dormant.settings.summaryEnabled, false); assert.equal(dormant.settings.autoSummaryEnabled, false);
});
test('Summary and critique Prompt contracts preserve raw text and default-reset semantics', async () => {
    for (const [field, domain, enable, source] of [
        ['summaryPrompt', 'summary', 'summaryEnabled', 'ui/sections/chatSummary.js'],
        ['critiquePrompt', 'critique', 'critiqueEnabled', 'ui/sections/critique.js'],
    ]) {
        const contract = fieldDefinition(field);
        assert.equal(contract.domain, domain); assert.equal(contract.source, source);
        assert.equal(contract.idle, true); assert.match(contract.description, /空字符串/);
        assert.match(contract.description, /重新生成/);
        assert.deepEqual(dependencyFields([field]), [enable, field].sort());
        assert.equal(configurationCoverage().find(row => row.key === field).status, 'supported');
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: 'raw {{text}}\n{}' } }), ['source:configSettings']);
        assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: 'x'.repeat(4001) } }));
        assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: null } }));
        const f = fixture({ [field]: 'raw {{text}}\n{}' });
        assert.deepEqual(previewSettings({ baseline: f.baseline, changes: { [field]: 'raw {{text}}\n{}' } }).warnings, [domain === 'summary' ? 'SUMMARY_DISABLED' : 'CRITIQUE_DISABLED']);
        const action = f.actions.prepare('a', 1);
        assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
        assert.equal(f.settings[field], 'raw {{text}}\n{}'); assert.equal(f.saves(), 1);
        const reset = previewSettings({ baseline: { [field]: 'custom', [enable]: true }, changes: { [field]: '' } });
        assert.deepEqual(reset.manifest.settings, { [field]: '' });
        assert.deepEqual(reset.warnings, []);
        const stale = fixture({ [field]: 'next' });
        const staleAction = stale.actions.prepare('a', 1); stale.settings[enable] = true;
        assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
        assert.equal(stale.saves(), 0);
        const busy = fixture({ [field]: 'next' }); const busyAction = busy.actions.prepare('a', 1); busy.busy();
        assert.equal((await busy.actions.approve(busyAction.id)).status, 'not_executed');
        assert.equal(busy.saves(), 0);
    }
});

test('Critique settings declare global scope, activation dependencies and bounded interval', () => {
    const ids = ['critiqueEnabled', 'autoCritiqueEnabled', 'autoCritiqueInterval', 'critiqueReusePrevious'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'critique'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/critique.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['autoCritiqueInterval']), ['autoCritiqueEnabled', 'autoCritiqueInterval', 'critiqueEnabled']);
    assert.deepEqual(dependencyFields(['critiqueReusePrevious']), ['critiqueEnabled', 'critiqueReusePrevious']);
    for (const changes of [{ critiqueEnabled: 'true' }, { autoCritiqueEnabled: 1 }, { autoCritiqueInterval: 0 }, { autoCritiqueInterval: 201 }, { critiqueReusePrevious: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Critique preview warns about inactive switches, checks dependencies and writes only requested leaves', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const patch = { autoCritiqueInterval: 15, critiqueReusePrevious: false };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['CRITIQUE_DISABLED', 'AUTO_CRITIQUE_DISABLED']);
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    settings.critiqueEnabled = true;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.autoCritiqueInterval, 10);
    const dormant = fixture({ autoCritiqueInterval: 15 });
    const action = dormant.actions.prepare('a', 1);
    assert.equal((await dormant.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(dormant.settings.autoCritiqueInterval, 15); assert.equal(dormant.saves(), 1);
    assert.equal(dormant.settings.critiqueEnabled, false); assert.equal(dormant.settings.autoCritiqueEnabled, false);
    const blocked = fixture({ critiqueReusePrevious: false }); const pending = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(blocked.settings.critiqueReusePrevious, true); assert.equal(blocked.saves(), 0);
});

test('Critique output example is a bounded JSON template, not executable or a formal schema', async () => {
    const example = JSON.stringify({ directorCritique: { pacing: 'good', spotlight: 'shared', suggestions: ['slow down'] }, characterCritiques: { Alice: { consistency: 'good', interaction: 'active', suggestions: [] } } });
    const contract = fieldDefinition('critiqueSchema');
    assert.equal(contract.domain, 'critique'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.match(contract.description, /并非标准 JSON Schema/);
    assert.equal(configurationCoverage().find(row => row.key === 'critiqueSchema').status, 'supported');
    assert.deepEqual(dependencyFields(['critiqueSchema']), ['critiqueEnabled', 'critiqueSchema']);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { critiqueSchema: example } }), ['source:configSettings']);
    for (const invalid of ['not JSON', '[]', '{}', '{"directorCritique":[],"characterCritiques":{}}', '{"directorCritique":{},"characterCritiques":{"Alice":null}}', '{"directorCritique":{},"characterCritiques":{},"__proto__":{}}', 'x'.repeat(4001)]) {
        assert.throws(() => previewSettings({ baseline: {}, changes: { critiqueSchema: invalid } }));
    }
    const preview = previewSettings({ baseline: { critiqueSchema: '', critiqueEnabled: true }, changes: { critiqueSchema: example } });
    assert.deepEqual(preview.warnings, []);
    assert.deepEqual(preview.manifest.settings, { critiqueSchema: example });
    assert.deepEqual(previewSettings({ baseline: { critiqueSchema: '', critiqueEnabled: true }, changes: { critiqueSchema: '{"directorCritique":{},"characterCritiques":{}}' } }).warnings, ['CRITIQUE_OUTPUT_EXAMPLE_NONSTANDARD_FIELDS']);
    const f = fixture({ critiqueSchema: example });
    const action = f.actions.prepare('a', 1);
    assert.equal(f.saves(), 0); assert.equal(f.settings.critiqueSchema, '');
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.critiqueSchema, example); assert.equal(f.saves(), 1);
    const reset = previewSettings({ baseline: { critiqueSchema: example, critiqueEnabled: true }, changes: { critiqueSchema: '' } });
    assert.deepEqual(reset.manifest.settings, { critiqueSchema: '' }); assert.deepEqual(reset.warnings, []);
    const stale = fixture({ critiqueSchema: example }); const pending = stale.actions.prepare('a', 1);
    stale.settings.critiqueEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ critiqueSchema: example }); const blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});

test('Profile settings describe global effects, bounded tool inputs and activation dependencies', () => {
    const ids = ['profileEnabled', 'profileTokenBudget', 'profileConcurrency'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'profiles'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/profile.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['profileConcurrency']), ['profileConcurrency', 'profileEnabled']);
    assert.deepEqual(dependencyFields(['profileTokenBudget']), ['profileEnabled', 'profileTokenBudget']);
    for (const changes of [{ profileEnabled: 1 }, { profileTokenBudget: 0 }, { profileTokenBudget: 20001 }, { profileConcurrency: -1 }, { profileConcurrency: 21 }, { profileConcurrency: '2' }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Profile previews warn about dormant or unlimited settings and preserve unrequested fields', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS), patch = { profileTokenBudget: 3000, profileConcurrency: 0 };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['PROFILES_DISABLED', 'PROFILE_UNBOUNDED_CONCURRENCY']);
    settings.profileEnabled = true;
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.profileTokenBudget, 2000);
    const f = fixture({ profileTokenBudget: 3000 }); const a = f.actions.prepare('a', 1);
    f.settings.profileGeneratorPrompt = 'unsaved draft';
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.profileTokenBudget, 3000); assert.equal(f.settings.profileEnabled, false);
    assert.equal(f.settings.profileGeneratorPrompt, 'unsaved draft'); assert.equal(f.saves(), 1);
    const blocked = fixture({ profileEnabled: true }); const b = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(b.id)).status, 'not_executed');
    assert.equal(blocked.settings.profileEnabled, false); assert.equal(blocked.saves(), 0);
});

test('Profile generator Prompt uses a bounded, separately approved leaf without constraining Provider placeholders', async () => {
    const field = 'profileGeneratorPrompt', prompt = 'Profile {{charName}} from {{charDescription}} and {{customProvider}}';
    const contract = fieldDefinition(field);
    assert.equal(contract.domain, 'profiles'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.equal(contract.source, 'ui/sections/profile.js');
    assert.match(contract.description, /renderPrompt/); assert.match(contract.description, /空字符串/);
    assert.deepEqual(dependencyFields([field]), ['profileEnabled', field]);
    assert.equal(configurationCoverage().find(row => row.key === field).status, 'supported');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: prompt } }), ['source:configSettings']);
    for (const invalid of [null, 4, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: invalid } }));
    const f = fixture({ [field]: prompt });
    const preview = previewSettings({ baseline: f.baseline, changes: { [field]: prompt } });
    assert.deepEqual(preview.warnings, ['PROFILES_DISABLED']);
    assert.deepEqual(preview.manifest.settings, { [field]: prompt });
    assert.equal(f.settings[field], ''); assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    f.settings.profileJsonSchema = '{"type":"object"}';
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings[field], prompt); assert.equal(f.settings.profileJsonSchema, '{"type":"object"}');
    assert.equal(f.saves(), 1);
    const reset = previewSettings({ baseline: { [field]: prompt, profileEnabled: true }, changes: { [field]: '' } });
    assert.deepEqual(reset.manifest.settings, { [field]: '' }); assert.deepEqual(reset.warnings, []);
    const stale = fixture({ [field]: prompt }); const pending = stale.actions.prepare('a', 1); stale.settings.profileEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ [field]: prompt }); const blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});

test('NPC settings declare global scope, closed ranges and dependent capacity semantics', () => {
    const ids = ['npcEnabled', 'npcMaxCount', 'npcBatchSize', 'npcGenerateFirstMes'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'npc'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/npc.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['npcMaxCount']), ['npcBatchSize', 'npcEnabled', 'npcMaxCount']);
    assert.deepEqual(dependencyFields(['npcBatchSize']), ['npcBatchSize', 'npcEnabled', 'npcMaxCount']);
    for (const changes of [{ npcEnabled: 1 }, { npcMaxCount: 0 }, { npcMaxCount: 201 }, { npcBatchSize: 0 }, { npcBatchSize: 201 }, { npcGenerateFirstMes: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('NPC preview warns about disabled use and clamped batch, with stale dependency protection', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS), patch = { npcMaxCount: 2, npcGenerateFirstMes: true };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['NPC_DISABLED', 'NPC_BATCH_CLAMPED']);
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    settings.npcBatchSize = 1;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.npcMaxCount, 10);
    const f = fixture({ npcBatchSize: 2 }); const a = f.actions.prepare('a', 1);
    f.settings.npcPrompt = 'unsaved draft';
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.npcBatchSize, 2); assert.equal(f.settings.npcEnabled, false);
    assert.equal(f.settings.npcPrompt, 'unsaved draft'); assert.equal(f.saves(), 1);
    const blocked = fixture({ npcEnabled: true }); const b = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(b.id)).status, 'not_executed');
    assert.equal(blocked.settings.npcEnabled, false); assert.equal(blocked.saves(), 0);
});
