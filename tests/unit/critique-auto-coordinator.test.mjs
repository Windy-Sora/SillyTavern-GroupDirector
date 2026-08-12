import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueAutoCoordinator, planCritiqueAutoRun } from '../../systems/critique-auto-coordinator.js';

test('critique auto policy handles first enable, intervals, and timeline rollback', () => {
    assert.equal(planCritiqueAutoRun({ currentLength: 4, hasCounter: false, latestRangeEnd: 0, interval: 5 }).type, 'checkpoint');
    assert.equal(planCritiqueAutoRun({ currentLength: 5, hasCounter: false, latestRangeEnd: 0, interval: 5 }).type, 'execute');
    assert.equal(planCritiqueAutoRun({ currentLength: 8, counter: 5, hasCounter: true, latestRangeEnd: 0, interval: 5 }).type, 'none');
    assert.equal(planCritiqueAutoRun({ currentLength: 3, counter: 5, hasCounter: true, latestRangeEnd: 0, interval: 5 }).type, 'reset');
});

test('critique auto coordinator persists coverage only after successful execution', async () => {
    const metadata = { gd: {} };
    const chat = Array.from({ length: 5 }, () => ({}));
    let generated = 0;
    let saves = 0;
    const coordinator = createCritiqueAutoCoordinator({
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getLatestActive: () => null,
        generateCritique: async () => { generated++; },
        saveChatConditional: async () => { saves++; },
        EXT_KEY: 'gd',
    });
    const action = await coordinator.run({ interval: 5 });
    assert.equal(action.type, 'execute');
    assert.equal(generated, 1);
    assert.equal(metadata.gd._autoCritiqueLen, 5);
    assert.equal(saves, 1);
});

test('critique auto coordinator rolls its counter back when persistence fails', async () => {
    const metadata = { gd: { _autoCritiqueLen: 9 } };
    const chat = Array.from({ length: 2 }, () => ({}));
    const coordinator = createCritiqueAutoCoordinator({
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getLatestActive: () => null,
        generateCritique: async () => {},
        saveChatConditional: async () => { throw new Error('disk unavailable'); },
        EXT_KEY: 'gd',
    });
    await assert.rejects(coordinator.run({ interval: 5 }), /disk unavailable/);
    assert.equal(metadata.gd._autoCritiqueLen, 9);
});
