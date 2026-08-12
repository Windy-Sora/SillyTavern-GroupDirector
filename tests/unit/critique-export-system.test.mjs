import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueExportSystem } from '../../systems/critique-export-system.js';

function harness(saveChatConditional = async () => {}) {
    const metadata = {};
    const system = createCritiqueExportSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional,
        log: () => {},
        getCurrentGroup: () => null,
        critiqueSystem: { getLatestActive: () => null },
    });
    return { system, metadata };
}

const validExport = () => ({
    version: 1,
    type: 'critique-export',
    source: { groupName: 'Test' },
    template: {},
    critique: {
        content: '{"directorCritique":{},"characterCritiques":{}}',
        data: { directorCritique: { pacing: 'good' }, characterCritiques: {} },
    },
});

test('critique import rejects malformed nested data before mutation', async () => {
    const { system, metadata } = harness();
    const malformed = validExport();
    malformed.critique.data.characterCritiques.Alice = null;
    assert.equal(system.parseImportFile(JSON.stringify(malformed)).ok, false);
    await assert.rejects(system.addImportedCritique(malformed), /Alice must be an object/);
    assert.deepEqual(metadata, {});
});

test('critique import CRUD is transactional when persistence fails', async () => {
    let fail = false;
    const { system } = harness(async () => { if (fail) throw new Error('disk unavailable'); });
    const entry = await system.addImportedCritique(validExport(), 'Stable');
    fail = true;
    await assert.rejects(system.updateImportedCritique(entry.id, { name: 'Changed' }), /disk unavailable/);
    assert.equal(entry.name, 'Stable');
    await assert.rejects(system.deleteImportedCritique(entry.id), /disk unavailable/);
    assert.equal(system.getImportedCritiques()[0], entry);
});

test('critique provider ignores malformed legacy list entries', () => {
    const { system, metadata } = harness();
    metadata.gd = { importedCritiques: [null, { id: 'ok', name: 'Valid', content: 'x', enabled: true, data: { directorCritique: {}, characterCritiques: {} } }] };
    const rendered = system.renderEnabledCritiques();
    assert.equal(rendered.data.count, 1);
    assert.deepEqual(rendered.data.names, ['Valid']);
});

test('critique provider normalizes a malformed non-array legacy store', () => {
    const { system, metadata } = harness();
    metadata.gd = { importedCritiques: {} };
    assert.deepEqual(system.renderEnabledCritiques(), { content: '', data: { all: [], count: 0 } });
    assert.deepEqual(metadata.gd.importedCritiques, []);
});
