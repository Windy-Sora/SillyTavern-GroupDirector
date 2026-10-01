import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { createRunConfigStore } from '../../muyu/host/run-config.js';

const oldRun = { modelCalls: 6, toolCalls: 16, timeMs: 120000, maxTokens: 8192, providerBytes: 24000 };
const oldContext = { inputTokens: 32000, recentTurns: 12, autoSummary: false };
const stores = (settings, saveSettings = async () => {}) => ({
    context: createContextConfigStore({ getSettings: () => settings, saveSettings }),
    run: createRunConfigStore({ getSettings: () => settings, saveSettings }),
});
test('Fresh settings and missing-settings fallbacks share the 1M-model budget profile', () => {
    assert.deepEqual(DEFAULT_SETTINGS.muyuContextConfig, CONTEXT_DEFAULTS);
    assert.deepEqual(DEFAULT_SETTINGS.muyuRunConfig, RUN_DEFAULTS);
    const s = stores({});
    assert.deepEqual(s.context.read(), CONTEXT_DEFAULTS); assert.deepEqual(s.run.read(), RUN_DEFAULTS);
});
test('Known legacy defaults upgrade without writing during reads; custom combinations and auto mode stay unchanged', () => {
    for (const inputTokens of [32000, 500000]) for (const providerBytes of [24000, 1000000]) {
        const settings = { muyuContextConfig: { ...oldContext, inputTokens }, muyuRunConfig: { ...oldRun, providerBytes } }, before = structuredClone(settings);
        const s = stores(settings);
        assert.deepEqual(s.context.read(), CONTEXT_DEFAULTS); assert.deepEqual(s.run.read(), RUN_DEFAULTS);
        assert.deepEqual(settings, before);
    }
    const settings = { muyuContextConfig: { ...oldContext, inputTokens: null }, muyuRunConfig: { ...oldRun, maxTokens: 32768, providerBytes: 50000 } };
    const s = stores(settings);
    assert.deepEqual(s.context.read(), { ...settings.muyuContextConfig, historyAuthorization: 'auto', summaryTokens: 8192 }); assert.deepEqual(s.run.read(), settings.muyuRunConfig);
});
test('Explicitly saving even an old-default-sized budget pins it across reloads', async () => {
    const settings = {}, s = stores(settings);
    await s.context.save(oldContext); await s.run.save(oldRun);
    const reopened = stores(settings);
    assert.deepEqual(reopened.context.read(), { ...oldContext, historyAuthorization: 'auto', summaryTokens: 8192 }); assert.deepEqual(reopened.run.read(), oldRun);
});
test('Failed saves roll back values and migration markers without overwriting a concurrent replacement', async () => {
    const settings = {}; let concurrent = false;
    const replacement = { ...oldContext, inputTokens: 100000 };
    const s = stores(settings, async () => { if (concurrent) settings.muyuContextConfig = replacement; throw Error('private'); });
    await assert.rejects(s.context.save(oldContext), /CONTEXT_CONFIG_SAVE_FAILED/);
    assert.equal(Object.hasOwn(settings, 'muyuContextConfig'), false); assert.equal(Object.hasOwn(settings, 'muyuContextBudgetVersion'), false);
    await assert.rejects(s.run.save(oldRun), /RUN_CONFIG_SAVE_FAILED/);
    assert.equal(Object.hasOwn(settings, 'muyuRunConfig'), false); assert.equal(Object.hasOwn(settings, 'muyuRunBudgetVersion'), false);
    concurrent = true; await assert.rejects(s.context.save(oldContext)); assert.equal(settings.muyuContextConfig, replacement);
    assert.deepEqual(s.context.read(), { ...replacement, historyAuthorization: 'auto', summaryTokens: 8192 });
});
