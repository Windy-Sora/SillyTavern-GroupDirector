import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueRepository } from '../../systems/critique-repository.js';

function subject(entries = [], save = async () => {}) {
    const metadata = { gd: { critiques: entries } };
    return { metadata, repository: createCritiqueRepository({ getChatMetadata: () => metadata, EXT_KEY: 'gd', saveChatConditional: save }) };
}

test('critique repository owns activation, revert, reset, and prune invariants', async () => {
    const first = { rangeEnd: 2, active: true, basedOn: null };
    const { metadata, repository } = subject([first]);
    const second = { rangeEnd: 5, active: true, basedOn: 0 };
    await repository.add(second);
    assert.equal(first.active, false);
    assert.equal(repository.getLatestActive(), second);
    await repository.revert();
    assert.equal(first.active, true);
    assert.equal(second.active, false);
    second.active = true;
    first.active = false;
    await repository.prune(3);
    assert.equal(first.active, true);
    assert.equal(second.active, false);
    await repository.reset();
    assert.equal(metadata.gd.critiques.some(item => item.active), false);
});

test('critique repository rolls live state back when persistence fails', async () => {
    const first = { rangeEnd: 2, active: true, basedOn: null };
    const { repository } = subject([first], async () => { throw new Error('disk unavailable'); });
    await assert.rejects(repository.add({ rangeEnd: 3, active: true, basedOn: 0 }), /disk unavailable/);
    assert.deepEqual(repository.getCritiques(), [first]);
    assert.equal(first.active, true);
});
