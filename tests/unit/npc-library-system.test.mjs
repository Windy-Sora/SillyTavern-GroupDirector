import test from 'node:test';
import assert from 'node:assert/strict';

import { createNpcLibrarySystem } from '../../systems/npc-library-system.js';

function fixture(overrides = {}) {
    const settings = {};
    const extension_settings = {};
    const calls = { saved: 0, applied: [] };
    const dependencies = {
        settings,
        extension_settings,
        EXT_KEY: 'gd',
        saveSettings: () => calls.saved++,
        getCurrentGroup: () => ({ name: 'Town' }),
        npcSystem: { getNpcs: () => [{ name: 'Guard', description: 'alert' }, { name: 'Mage', personality: 'quiet' }] },
        parseNpcImportFile: text => {
            const data = JSON.parse(text);
            return { ok: true, data: { ...data, npcs: data.npcs.map((npc, index) => ({ ...npc, _action: index ? 'overwrite' : 'new' })) } };
        },
        applyNpcImport: async (...args) => { calls.applied.push(args); return { applied: args[1].length }; },
        getDefaultNpcPrompt: () => 'npc prompt',
        log: () => {},
        ...overrides,
    };
    return { system: createNpcLibrarySystem(dependencies), settings, extension_settings, calls };
}

test('NPC library saves, previews, applies, and deletes entries', async () => {
    const { system, extension_settings, settings, calls } = fixture();
    assert.throws(() => system.saveCurrentAsLibrary(''), /name is required/i);
    const entry = system.saveCurrentAsLibrary('Town NPCs', 'locals');
    assert.equal(entry.npcCount, 2);
    assert.equal(entry.exportData.template.npcPrompt, 'npc prompt');
    assert.equal(entry.exportData.npcs[0].scenario, '');
    assert.equal(extension_settings.gd, settings);
    assert.deepEqual(system.previewLibrary(entry.id), { total: 2, newCount: 1, overwriteCount: 1 });

    const result = await system.applyLibrary(entry.id, { importTemplate: true });
    assert.equal(result.applied, 2);
    assert.deepEqual(calls.applied[0][1], ['Guard', 'Mage']);
    assert.deepEqual(calls.applied[0][2], { importTemplate: true });
    await assert.rejects(system.applyLibrary('missing'), /not found/i);
    assert.equal(system.deleteLibrary(entry.id), true);
    assert.equal(system.deleteLibrary(entry.id), false);
});

test('NPC library imports files and surfaces parser failures', async () => {
    const { system } = fixture();
    const data = { type: 'npc-export', source: { groupName: 'Source' }, libraryMeta: { name: 'Pack' }, npcs: [{ name: 'One' }] };
    const entry = await system.importFileToLibrary({ name: 'source.json', text: async () => JSON.stringify(data) });
    assert.equal(entry.name, 'Pack');
    assert.equal(entry.npcCount, 1);

    const failed = fixture({ parseNpcImportFile: () => ({ ok: false, error: 'invalid NPCs' }) }).system;
    assert.deepEqual(failed.previewLibrary('missing'), { total: 0, newCount: 0, overwriteCount: 0 });
    await assert.rejects(failed.importFileToLibrary({ name: 'bad.json', text: async () => '{}' }), /invalid NPCs/);
});

test('NPC library rejects empty current state', () => {
    const { system } = fixture({ npcSystem: { getNpcs: () => [] } });
    assert.throws(() => system.saveCurrentAsLibrary('Empty'), /No NPCs/i);
});
