import assert from 'node:assert/strict';
import test from 'node:test';
import { createNpcSystem } from '../../systems/npc-system.js';

function createSubject(getCharacters) {
    const metadata = {};
    return createNpcSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => {},
        getCharacters,
        log: () => {},
    });
}

test('NPC duplicate checks resolve the live character array at use time', () => {
    let characters = [{ avatar: 'alice.png', name: 'Alice' }];
    const subject = createSubject(() => characters);

    assert.equal(subject.nameExists('alice'), true);
    assert.equal(subject.nameExists('Bob'), false);

    characters = [{ avatar: 'bob.png', name: 'Bob' }];
    assert.equal(subject.nameExists('Alice'), false);
    assert.equal(subject.nameExists('bob'), true);
});

test('NPC duplicate checks include stored NPC names case-insensitively', () => {
    const subject = createSubject(() => []);
    subject.getNpcs().push({ name: 'Gatekeeper' });

    assert.equal(subject.nameExists('gatekeeper'), true);
    assert.equal(subject.nameExists('Merchant'), false);
});
