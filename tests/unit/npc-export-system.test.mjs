import test from 'node:test';
import assert from 'node:assert/strict';

import { createNpcExportSystem } from '../../systems/npc-export-system.js';

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { click() {} };
    globalThis.document = { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } };
    globalThis.URL = { createObjectURL: () => 'blob:npc', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

function fixture(overrides = {}) {
    const settings = {};
    const metadata = {};
    const calls = { settings: 0, chat: 0 };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        saveSettings: () => calls.settings++,
        getCurrentGroup: () => ({ name: 'NPC Group' }),
        getChatMetadata: () => metadata,
        saveChatConditional: async () => calls.chat++,
        defaultNpcPrompt: 'default npc prompt',
        log: () => {},
        ...overrides,
    };
    return { system: createNpcExportSystem(dependencies), settings, metadata, calls };
}

test('NPC export normalizes fields and uses the current prompt', () => {
    const dom = installDownloadDom();
    try {
        const { system } = fixture();
        const data = system.exportNpcs([{ name: 'Guard', description: 'alert' }], 'note');
        assert.equal(data.type, 'npc-export');
        assert.equal(data.npcs[0].personality, '');
        assert.equal(data.template.npcPrompt, 'default npc prompt');
        assert.match(dom.anchor.download, /^npcs-NPC_Group-/);
    } finally { dom.restore(); }
});

test('NPC import validates, filters invalid entries, and classifies names case-insensitively', () => {
    const { system, metadata } = fixture();
    metadata.gd = { npcs: [{ name: 'Guard' }] };
    assert.equal(system.parseImportFile('{').ok, false);
    assert.equal(system.parseImportFile('{}').ok, false);
    const parsed = system.parseImportFile(JSON.stringify({
        version: 1,
        type: 'npc-export',
        template: { npcPrompt: 'different' },
        npcs: [{ name: 'guard' }, { name: 'Mage' }, null, { name: 42 }],
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.data.npcs.map(npc => npc._action), ['overwrite', 'new']);
    assert.equal(parsed.data._templateConsistent, false);
});

test('NPC import overwrites content while preserving import tracking', async () => {
    const { system, settings, metadata, calls } = fixture();
    metadata.gd = { npcs: [{ name: 'Guard', imported: true, importedAvatar: 'guard.png' }] };
    const data = {
        template: { npcPrompt: 'new prompt' },
        npcs: [{ name: 'guard', description: 'new' }, { name: 'Mage', personality: 'quiet' }],
    };
    const result = await system.applyImport(data, ['GUARD', 'Mage', 'Missing'], { importTemplate: true });
    assert.deepEqual(result, { applied: 2, skipped: 1, templateImported: true });
    assert.equal(metadata.gd.npcs[0].imported, true);
    assert.equal(metadata.gd.npcs[0].importedAvatar, 'guard.png');
    assert.equal(metadata.gd.npcs[1].name, 'Mage');
    assert.equal(settings.npcPrompt, 'new prompt');
    assert.equal(calls.settings, 1);
    assert.equal(calls.chat, 1);
    assert.deepEqual(await system.applyImport(data, [], {}), { applied: 0, skipped: 0, templateImported: false });
});

test('NPC preset loading returns parsed data or a stable error', async () => {
    const originalFetch = globalThis.fetch;
    try {
        const valid = { version: 1, type: 'npc-export', template: { npcPrompt: 'default npc prompt' }, npcs: [] };
        globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(valid) });
        const { system } = fixture();
        assert.equal((await system.loadPreset('starter')).ok, true);
        globalThis.fetch = async () => { throw new Error('offline'); };
        assert.match((await system.loadPreset('starter')).error, /offline/);
        assert.ok(Array.isArray(system.getPresetNames()));
    } finally { globalThis.fetch = originalFetch; }
});
