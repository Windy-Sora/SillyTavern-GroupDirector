import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryExportSystem } from '../../systems/memory-export-system.js';

function createSubject() {
    return createMemoryExportSystem({
        settings: {},
        EXT_KEY: 'gd',
        getChatMetadata: () => ({}),
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        getCurrentGroup: () => ({ members: ['alice.png'], disabled_members: [] }),
        saveChatConditional: async () => {},
        saveSettings: () => {},
        log: () => {},
    });
}

function payload(memory) {
    return JSON.stringify({
        version: 1,
        type: 'memory-export',
        template: {},
        memories: { 'alice.png': memory },
    });
}

test('memory import rejects malformed nested entries without throwing', () => {
    const subject = createSubject();
    const cases = [
        { value: null, error: 'Invalid memory entry for "alice.png"' },
        { value: [], error: 'Invalid memory entry for "alice.png"' },
        { value: { name: null, entries: [] }, error: 'Missing or invalid name for "alice.png"' },
        { value: { name: 'Alice', entries: null }, error: 'Missing or invalid entries for "alice.png"' },
        { value: { name: 'Alice', entries: [null] }, error: 'Invalid memory entry at index 0 for "alice.png"' },
        { value: { name: 'Alice', entries: [{ event: 'ok' }, []] }, error: 'Invalid memory entry at index 1 for "alice.png"' },
        { value: { name: 'Alice', entries: ['bad'] }, error: 'Invalid memory entry at index 0 for "alice.png"' },
    ];

    for (const { value, error } of cases) {
        let result;
        assert.doesNotThrow(() => { result = subject.parseImportFile(payload(value)); });
        assert.deepEqual(result, { ok: false, error });
    }
});

test('memory import accepts object entries and reports compressed counts', () => {
    const subject = createSubject();
    const result = subject.parseImportFile(payload({
        name: 'Alice',
        entries: [
            { event: 'Met Bob', compressed: false },
            { event: 'Visited town', compressed: true },
        ],
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.data._matches['alice.png'], {
        importedName: 'Alice',
        importedAvatar: 'alice.png',
        entryCount: 2,
        compressedCount: 1,
        match: { avatar: 'alice.png', name: 'Alice', matchType: 'exact' },
    });
});
