import test from 'node:test';
import assert from 'node:assert/strict';

import { createStoryBlueprintLibrarySystem } from '../../systems/story-blueprint-library-system.js';

function fixture(overrides = {}) {
    const settings = {};
    const extension_settings = {};
    const calls = { saved: 0, chatSaved: 0, imports: [] };
    const blueprint = { title: 'Quest', nodes: [{ title: 'Act 1', children: [{ title: 'Scene 1' }] }] };
    const storyBlueprintSystem = {
        buildExportFile: includeProgress => ({
            version: 1,
            type: 'group-director-story-blueprint',
            storyBlueprint: { blueprint, doneSignals: includeProgress ? ['done'] : [] },
        }),
        getSteps: () => [{}, {}],
        applyImportText: (text, options) => { calls.imports.push([JSON.parse(text), options]); return { ok: true, applied: true }; },
        validateBlueprintInput: data => ({ ok: true, blueprint: data.blueprint || data.storyBlueprint?.blueprint }),
    };
    const dependencies = {
        settings,
        extension_settings,
        EXT_KEY: 'gd',
        saveSettings: () => calls.saved++,
        saveChatConditional: async () => calls.chatSaved++,
        getCurrentGroup: () => ({ name: 'Campaign' }),
        storyBlueprintSystem,
        log: () => {},
        ...overrides,
    };
    return { system: createStoryBlueprintLibrarySystem(dependencies), settings, extension_settings, calls };
}

test('Story Blueprint library saves nested blueprints and applies progress options', async () => {
    const { system, settings, extension_settings, calls } = fixture();
    assert.throws(() => system.saveCurrentAsLibrary(' '), /name is required/i);
    const entry = system.saveCurrentAsLibrary('Quest Pack', 'main arc', { includeProgress: false });
    assert.equal(entry.nodeCount, 2);
    assert.equal(entry.stepCount, 2);
    assert.equal(entry.includeProgress, false);
    assert.equal(extension_settings.gd, settings);

    const result = await system.applyLibrary(entry.id, { includeProgress: false });
    assert.equal(result.applied, true);
    assert.deepEqual(calls.imports[0][1], { includeProgress: false });
    assert.equal(calls.chatSaved, 1);
    await assert.rejects(system.applyLibrary('missing'), /not found/i);
    assert.equal(system.deleteLibrary(entry.id), true);
    assert.equal(system.deleteLibrary(entry.id), false);
});

test('Story Blueprint library imports wrapped and raw blueprints', async () => {
    const { system } = fixture();
    const wrapped = {
        type: 'group-director-story-blueprint',
        source: { groupName: 'Old Campaign' },
        libraryMeta: { name: 'Wrapped', description: 'archive' },
        storyBlueprint: { blueprint: { title: 'Wrapped Quest', nodes: [] }, doneSignals: [] },
    };
    const first = await system.importFileToLibrary({ name: 'wrapped.json', text: async () => JSON.stringify(wrapped) });
    assert.equal(first.name, 'Wrapped');
    assert.equal(first.includeProgress, true);

    const raw = { blueprint: { title: 'Raw Quest', nodes: [{ children: [] }] } };
    const second = await system.importFileToLibrary({ name: 'raw.json', text: async () => JSON.stringify(raw) });
    assert.equal(second.name, 'Raw Quest');
    assert.equal(second.exportData.type, 'group-director-story-blueprint');
    assert.equal(second.nodeCount, 1);
});

test('Story Blueprint library surfaces invalid data and import failures', async () => {
    const noBlueprint = fixture({
        storyBlueprintSystem: {
            buildExportFile: () => ({ type: 'group-director-story-blueprint', storyBlueprint: {} }),
            getSteps: () => [],
            validateBlueprintInput: () => ({ ok: false, error: 'invalid blueprint' }),
            applyImportText: () => ({ ok: false, error: 'apply failed' }),
        },
    }).system;
    assert.throws(() => noBlueprint.saveCurrentAsLibrary('Empty'), /No Story Blueprint/i);
    await assert.rejects(noBlueprint.importFileToLibrary({ name: 'broken.json', text: async () => '{' }), /Invalid JSON/i);
    await assert.rejects(noBlueprint.importFileToLibrary({ name: 'bad.json', text: async () => '{}' }), /invalid blueprint/);
});
