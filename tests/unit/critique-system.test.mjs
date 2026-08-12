import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueSystem } from '../../systems/critique-system.js';

function deferred() {
    let resolve;
    const promise = new Promise(ok => { resolve = ok; });
    return { promise, resolve };
}

function harness() {
    const settings = { critiqueEnabled: true, critiqueReusePrevious: true, lang: 'en', agentConfigs: {} };
    let metadata = {};
    let chat = [];
    let response = '{"directorCritique":{"pacing":"good"},"characterCritiques":{"Alice":{"consistency":"good"}}}';
    let saves = 0;
    const system = createCritiqueSystem({
        settings,
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => { saves++; },
        generateRaw: async () => '',
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 'prompt' },
        setExtensionPrompt: () => {},
        log: () => {},
        createCaller: () => ({ generate: prompt => typeof response === 'function' ? response(prompt) : response }),
    });
    return {
        system, settings,
        get metadata() { return metadata; }, set metadata(value) { metadata = value; },
        get chat() { return chat; }, set chat(value) { chat = value; },
        set response(value) { response = value; },
        saves: () => saves,
    };
}

test('critique system generates validated history and reuses previous coverage', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'hello' }, { name: 'Alice', mes: 'hi' }];
    const first = await h.system.generateCritique();
    assert.equal(first.rangeEnd, 2);
    assert.equal(h.system.getActiveDirectorCritiqueText(), '[pacing] good');
    h.chat.push({ name: 'Bob', mes: 'welcome' });
    h.response = prompt => {
        assert.match(prompt, /\[Previous critique\]/);
        assert.match(prompt, /Bob: welcome/);
        return 'plain critique';
    };
    const second = await h.system.generateCritique();
    assert.equal(second.basedOn, 0);
    assert.equal(second.data.directorCritique.pacing, 'plain critique');
    await h.system.revertLastCritique();
    assert.equal(h.system.getLatestActive(), first);
});

test('critique system rejects stale generation results after a chat switch', async () => {
    const h = harness();
    const pending = deferred();
    h.chat = [{ name: 'User', mes: 'old chat' }];
    h.response = () => pending.promise;
    const generation = h.system.generateCritique();
    await Promise.resolve();
    h.metadata = {};
    h.chat = [{ name: 'User', mes: 'new chat' }];
    pending.resolve('{"directorCritique":{},"characterCritiques":{}}');
    await assert.rejects(generation, error => error.name === 'StaleExecutionError');
    assert.equal(h.system.getCritiques().length, 0);
    assert.equal(h.saves(), 0);
});

test('regeneration updates the active predecessor after a revert', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'one' }];
    const first = await h.system.generateCritique();
    h.chat.push({ name: 'Alice', mes: 'two' });
    await h.system.generateCritique();
    await h.system.revertLastCritique();
    assert.equal(h.system.getLatestActive(), first);
    h.response = '{"directorCritique":{"pacing":"regenerated active"},"characterCritiques":{}}';
    const regenerated = await h.system.regenerateLastCritique();
    assert.equal(regenerated, first);
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'regenerated active');
});

test('critique result editing is validated and persisted through the system boundary', async () => {
    const h = harness();
    h.chat = [{ name: 'User', mes: 'hello' }];
    await h.system.generateCritique();
    await h.system.updateActiveContent('{"directorCritique":{"pacing":"edited"},"characterCritiques":{}}');
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'edited');
    await assert.rejects(h.system.updateActiveContent('{"directorCritique":[],"characterCritiques":{}}'), /Invalid critique content/);
    assert.equal(h.system.getLatestActive().data.directorCritique.pacing, 'edited');
});
