import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPostSpeechSystem } from '../../systems/post-speech-system.js';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const queueSource = source.slice(
    source.indexOf('async function drainPostSpeechRoundQueue()'),
    source.indexOf('// Custom extension prompt key'),
);

function fixture(jobs, executor) {
    const metadata = {};
    let saves = 0;
    const postSpeechSystem = createPostSpeechSystem({
        settings: {}, EXT_KEY: 'test', getChatMetadata: () => metadata,
        getChat: () => [], saveChatConditional: async () => { saves++; }, log: () => {},
    });
    const drain = vm.runInNewContext(`${queueSource}\ndrainPostSpeechRoundQueue`, {
        postSpeechRoundQueue: jobs,
        postSpeechSystem,
        postSpeechExecutor: executor,
        CapabilityRegistry: { listExecutableForMode: () => [] },
        log: () => {},
    });
    return { postSpeechSystem, drain, get saves() { return saves; } };
}

test('round queue claims before deferred execution and remaps selected intent indexes', async () => {
    const contexts = [
        { messageIndex: 5, messageName: 'A', intent: { type: 'busy', params: {} } },
        { messageIndex: 5, messageName: 'A', intent: { type: 'free', params: {} } },
    ];
    const plans = contexts.map((_, intentIndex) => ({ action: { intentIndex } }));
    const executed = [];
    const subject = fixture([{ contexts, deferred: plans, allowPending: false }], {
        async executeDeferred(selectedPlans) {
            executed.push(...selectedPlans.map(plan => plan.action.intentIndex));
            return { blocking: true, results: selectedPlans.map(plan => ({
                intentIndex: plan.action.intentIndex, success: true,
            })) };
        },
    });
    const held = subject.postSpeechSystem.reserveExecution([contexts[0]]);
    await subject.drain();
    assert.deepEqual(executed, [0]);
    assert.equal(subject.postSpeechSystem.wasExecuted(5, 'busy'), false);
    assert.equal(subject.postSpeechSystem.wasExecuted(5, 'free'), true);
    assert.equal(subject.postSpeechSystem.isPending(5, 'busy'), true);
    assert.equal(subject.postSpeechSystem.isPending(5, 'free'), false);
    assert.equal(subject.saves, 1);
    held.release();
});

test('round queue releases a pre-execution claim when capability execution throws', async () => {
    const context = { messageIndex: 6, messageName: 'A', intent: { type: 'image', params: {} } };
    const subject = fixture([{ contexts: [context], deferred: [{ action: { intentIndex: 0 } }] }], {
        async executeDeferred() { throw new Error('executor failed'); },
    });
    await assert.rejects(subject.drain(), /executor failed/);
    assert.equal(subject.postSpeechSystem.isPending(6, 'image'), false);
    assert.equal(subject.postSpeechSystem.wasExecuted(6, 'image'), false);
    assert.equal(subject.saves, 0);
});
