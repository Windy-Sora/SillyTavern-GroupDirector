import test from 'node:test';
import assert from 'node:assert/strict';
import { syncConfigPromptEditors } from '../../muyu/ui/config-prompt-editors.js';

function editor(defaultPrompt, value = '') {
    const element = {}, state = { value };
    return { 0: element, state,
        data: key => ['gdDefaultPrompt', 'gdDefaultSchema'].includes(key) ? defaultPrompt : undefined,
        val(next) { state.value = next; },
    };
}

test('Config Prompt sync preserves focused draft and refreshes only changed idle editors', () => {
    const summary = editor('Default summary', 'draft in progress');
    const critique = editor('Default critique', 'old text');
    const calls = [];
    const getControl = id => { calls.push(id); return id === 'summary-prompt' ? summary : critique; };
    syncConfigPromptEditors({ fields: ['summaryPrompt', 'critiquePrompt'], settings: { summaryPrompt: 'new summary', critiquePrompt: 'new critique' }, getControl, activeElement: summary[0] });
    assert.equal(summary.state.value, 'draft in progress');
    assert.equal(critique.state.value, 'new critique');
    assert.deepEqual(calls, ['summary-prompt', 'critique-prompt']);
    calls.length = 0;
    syncConfigPromptEditors({ fields: ['critiquePrompt'], settings: { critiquePrompt: '' }, getControl, activeElement: null });
    assert.equal(critique.state.value, 'Default critique');
    assert.deepEqual(calls, ['critique-prompt']);
});

test('Critique output example sync keeps a focused draft and restores the built-in display on reset', () => {
    const schema = editor('{"directorCritique":{},"characterCritiques":{}}', 'draft');
    const getControl = id => id === 'critique-schema' ? schema : undefined;
    syncConfigPromptEditors({ fields: ['critiqueSchema'], settings: { critiqueSchema: '{"directorCritique":{"pacing":"ok"},"characterCritiques":{}}' }, getControl, activeElement: schema[0] });
    assert.equal(schema.state.value, 'draft');
    syncConfigPromptEditors({ fields: ['critiqueSchema'], settings: { critiqueSchema: '' }, getControl, activeElement: null });
    assert.equal(schema.state.value, '{"directorCritique":{},"characterCritiques":{}}');
});

test('Profile generator Prompt sync preserves the focused classic draft and shows default on reset', () => {
    const profile = editor('Built-in {{charName}}', 'unsaved draft');
    const getControl = id => id === 'profile-generator-prompt' ? profile : undefined;
    syncConfigPromptEditors({ fields: ['profileGeneratorPrompt'], settings: { profileGeneratorPrompt: 'New {{charName}}' }, getControl, activeElement: profile[0] });
    assert.equal(profile.state.value, 'unsaved draft');
    syncConfigPromptEditors({ fields: ['profileGeneratorPrompt'], settings: { profileGeneratorPrompt: 'New {{charName}}' }, getControl, activeElement: null });
    assert.equal(profile.state.value, 'New {{charName}}');
    syncConfigPromptEditors({ fields: ['profileGeneratorPrompt'], settings: { profileGeneratorPrompt: '' }, getControl, activeElement: null });
    assert.equal(profile.state.value, 'Built-in {{charName}}');
});
