import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomAgentSystem } from '../../systems/custom-agent-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

function createHarness(overrides = {}) {
    const settings = { customAgents: [], agentConfigs: {} };
    let metadata = {};
    let chat = [];
    let response = 'result';
    let generateCalls = 0;
    let settingsSaves = 0;
    let chatSaves = 0;
    const providers = new Map();
    const system = createCustomAgentSystem({
        settings,
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveSettings: () => { settingsSaves++; },
        saveChatConditional: async () => { chatSaves++; },
        renderPrompt: async value => value,
        generateRaw: async () => '',
        createCaller: () => ({
            generate: async prompt => {
                generateCalls++;
                return typeof response === 'function' ? response(prompt) : response;
            },
        }),
        registerProvider: provider => providers.set(provider.id, provider),
        unregisterProvider: id => providers.delete(id),
        getProviders: () => [...providers.values()],
        ...overrides,
    });
    return {
        system,
        settings,
        providers,
        get metadata() { return metadata; },
        set metadata(value) { metadata = value; },
        get chat() { return chat; },
        set chat(value) { chat = value; },
        set response(value) { response = value; },
        counts: () => ({ generateCalls, settingsSaves, chatSaves }),
    };
}

const valid = (providerName = 'audit') => ({
    name: 'Audit', providerName, prompt: 'inspect', enabled: true,
});

test('custom agent CRUD owns validation, persistence, and provider lifecycle', () => {
    const h = createHarness();
    const added = h.system.add(valid());
    assert.ok(added.id);
    assert.equal(h.providers.get('audit')._gdOwner, 'group-director/custom-agent');
    assert.equal(h.counts().settingsSaves, 1);

    h.system.update(added.id, { providerName: 'review' });
    assert.equal(h.providers.has('audit'), false);
    assert.equal(h.providers.has('review'), true);
    assert.throws(() => h.system.add(valid('review')), /duplicate providerName/);
    assert.equal(h.settings.customAgents.length, 1);

    h.system.toggle(added.id);
    assert.equal(h.providers.size, 0);
    assert.equal(h.settings.customAgents[0].enabled, false);
    h.system.remove(added.id);
    assert.deepEqual(h.settings.customAgents, []);
});

test('custom agent changes reject provider collisions and roll back failed persistence', () => {
    const builtIn = { id: 'reserved' };
    const h = createHarness();
    h.providers.set(builtIn.id, builtIn);
    assert.throws(() => h.system.add(valid('reserved')), /already registered/);
    assert.deepEqual(h.settings.customAgents, []);

    const providers = new Map();
    const settings = { customAgents: [], agentConfigs: {} };
    const system = createCustomAgentSystem({
        settings,
        getChatMetadata: () => ({}),
        getChat: () => [],
        EXT_KEY: 'gd',
        saveSettings: () => { throw new Error('disk unavailable'); },
        saveChatConditional: async () => {},
        renderPrompt: async value => value,
        generateRaw: async () => '',
        createCaller: () => ({ generate: async () => 'result' }),
        registerProvider: provider => providers.set(provider.id, provider),
        unregisterProvider: id => providers.delete(id),
        getProviders: () => [...providers.values()],
    });
    assert.throws(() => system.add(valid()), /disk unavailable/);
    assert.deepEqual(settings.customAgents, []);
    assert.equal(providers.size, 0);
});

test('disabled provider collisions survive refresh but are rejected when enabled', () => {
    const providers = new Map([['reserved', { id: 'reserved', placeholder: '{{reserved}}' }]]);
    const settings = {
        customAgents: [{
            id: 'ca_legacy', name: 'Legacy', providerName: 'reserved', prompt: '',
            schema: '', enabled: false, autoEnabled: false, autoInterval: 10, order: 0,
        }],
        agentConfigs: {},
    };
    const system = createCustomAgentSystem({
        settings,
        getChatMetadata: () => ({}),
        getChat: () => [],
        EXT_KEY: 'gd',
        saveSettings: () => {},
        saveChatConditional: async () => {},
        renderPrompt: async value => value,
        generateRaw: async () => '',
        createCaller: () => ({ generate: async () => 'result' }),
        registerProvider: provider => providers.set(provider.id, provider),
        unregisterProvider: id => providers.delete(id),
        getProviders: () => [...providers.values()],
    });

    assert.doesNotThrow(() => system.refreshProviders());
    assert.throws(() => system.toggle('ca_legacy'), /already registered/);
    assert.equal(settings.customAgents[0].enabled, false);
    assert.equal(providers.get('reserved')._gdOwner, undefined);
});

test('custom agent import validates atomically and forces imported agents disabled', async () => {
    const h = createHarness();
    const original = h.system.add(valid());
    const beforeSaves = h.counts().settingsSaves;
    const data = {
        version: 1,
        type: 'custom-agent-export',
        agents: [{ name: 'Replacement', providerName: 'audit', prompt: 'new', enabled: true }],
    };
    const result = await h.system.importAgents(data, { resolveConflict: async () => 'overwrite' });
    assert.deepEqual(result, { imported: 1, skipped: 0, cancelled: false });
    assert.equal(h.settings.customAgents[0].id, original.id);
    assert.equal(h.settings.customAgents[0].enabled, false);
    assert.equal(h.counts().settingsSaves, beforeSaves + 1);

    await assert.rejects(
        h.system.importAgents({ ...data, agents: [null] }),
        /must be an object/,
    );
    assert.equal(h.settings.customAgents.length, 1);
});

test('custom agent execution deduplicates requests and stores the request-start range', async () => {
    const h = createHarness();
    h.chat = [{}, {}];
    const gate = deferred();
    h.response = () => gate.promise;
    const agent = h.system.add(valid());
    const first = h.system.execute(agent);
    const second = h.system.execute(agent);
    assert.equal(first, second);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(h.system.getExecutionState(agent.id), 'running');
    h.chat.push({});
    gate.resolve('done');
    const result = await first;
    assert.equal(result.rangeEnd, 2);
    assert.equal(h.counts().generateCalls, 1);
    assert.equal(h.counts().chatSaves, 1);
});

test('custom agent execution rejects stale chat and stale configuration results', async () => {
    const h = createHarness();
    const agent = h.system.add(valid());
    let gate = deferred();
    h.response = () => gate.promise;
    const staleChat = h.system.execute(agent);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.metadata = {};
    h.chat = [];
    gate.resolve('old chat');
    await assert.rejects(staleChat, { name: 'StaleExecutionError' });

    gate = deferred();
    const live = h.settings.customAgents[0];
    const staleConfig = h.system.execute(live);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.system.update(live.id, { prompt: 'changed' });
    gate.resolve('old config');
    await assert.rejects(staleConfig, { name: 'StaleExecutionError' });
    assert.equal(h.counts().chatSaves, 0);
});

test('captured agent references resolve live configuration and reject deleted agents', async () => {
    const h = createHarness();
    const captured = h.system.add(valid());
    h.response = prompt => prompt;

    h.system.update(captured.id, { prompt: 'current prompt' });
    const result = await h.system.executeAuto(captured, 4);
    assert.equal(result.content, 'current prompt');
    assert.equal(h.metadata.gd[`_autoCAG_${captured.id}`], 4);

    const removed = h.settings.customAgents[0];
    h.system.remove(removed.id);
    const savesBefore = h.counts().chatSaves;
    await assert.rejects(h.system.executeAuto(removed, 5), { name: 'StaleExecutionError' });
    assert.equal(h.counts().chatSaves, savesBefore);
    assert.equal(h.metadata.gd[`_autoCAG_${removed.id}`], 4);
});

test('queued work captures its original chat and config context at enqueue time', async () => {
    const h = createHarness();
    const firstAgent = h.system.add(valid('first'));
    const queuedAgent = h.system.add({ ...valid('queued'), name: 'Queued' });
    const gate = deferred();
    let calls = 0;
    h.response = () => (++calls === 1 ? gate.promise : 'queued result');
    const first = h.system.execute(firstAgent);
    const queued = h.system.execute(queuedAgent);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.metadata = {};
    h.chat = [];
    h.system.invalidateExecutions();
    gate.resolve('first result');
    await assert.rejects(first, { name: 'StaleExecutionError' });
    await assert.rejects(queued, { name: 'StaleExecutionError' });
    assert.equal(calls, 1);
    assert.equal(h.counts().chatSaves, 0);
});

test('a current request does not deduplicate onto stale same-id work', async () => {
    const h = createHarness();
    const agent = h.system.add(valid());
    const gate = deferred();
    let calls = 0;
    h.response = () => (++calls === 1 ? gate.promise : 'fresh result');
    const stale = h.system.execute(agent);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.metadata = {};
    h.chat = [];
    h.system.invalidateExecutions();
    const fresh = h.system.execute(agent);
    assert.notEqual(fresh, stale);
    gate.resolve('stale result');
    await assert.rejects(stale, { name: 'StaleExecutionError' });
    assert.equal((await fresh).content, 'fresh result');
    assert.equal(calls, 2);
});

test('provider refresh invalidates execution after an external profile replacement', async () => {
    const h = createHarness();
    const agent = h.system.add(valid());
    const gate = deferred();
    h.response = () => gate.promise;
    const request = h.system.execute(agent);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.settings.customAgents = [{ ...agent, prompt: 'profile replacement' }];
    h.system.refreshProviders();
    gate.resolve('stale profile output');
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(h.counts().chatSaves, 0);
});

test('automatic execution saves result and counter in one transaction', async () => {
    const h = createHarness();
    const agent = h.system.add(valid());
    await h.system.executeAuto(agent, 12);
    assert.equal(h.system.getData(agent.id).rangeEnd, 0);
    assert.equal(h.metadata.gd[`_autoCAG_${agent.id}`], 12);
    assert.equal(h.counts().chatSaves, 1);
    await h.system.updateResult(agent.id, '{"ok":true}');
    assert.deepEqual(h.system.getData(agent.id).data, { ok: true });
});

test('an automatic trigger joins a manual in-flight request and still commits its counter', async () => {
    const h = createHarness();
    const agent = h.system.add(valid());
    const gate = deferred();
    h.response = () => gate.promise;
    const manual = h.system.execute(agent);
    await new Promise(resolve => setTimeout(resolve, 0));
    const automatic = h.system.executeAuto(agent, 7);
    assert.equal(manual, automatic);
    gate.resolve('shared result');
    await automatic;
    assert.equal(h.metadata.gd[`_autoCAG_${agent.id}`], 7);
    assert.equal(h.counts().generateCalls, 1);
    assert.equal(h.counts().chatSaves, 1);
});

test('a late auto join checkpoints after an in-progress manual save', async () => {
    const saveStarted = deferred();
    const releaseSave = deferred();
    let saves = 0;
    const h = createHarness({
        saveChatConditional: async () => {
            saves++;
            if (saves === 1) {
                saveStarted.resolve();
                await releaseSave.promise;
            }
        },
    });
    const agent = h.system.add(valid());
    const manual = h.system.execute(agent);
    await saveStarted.promise;
    const automatic = h.system.executeAuto(agent, 9);
    assert.equal(manual, automatic);
    releaseSave.resolve();
    await automatic;
    assert.equal(h.metadata.gd[`_autoCAG_${agent.id}`], 9);
    assert.equal(saves, 2);
});

test('a saved result edit invalidates an older in-flight execution', async () => {
    const h = createHarness();
    const agent = h.system.add(valid());
    await h.system.execute(agent);
    await new Promise(resolve => setTimeout(resolve, 0));

    const gate = deferred();
    h.response = () => gate.promise;
    const request = h.system.execute(agent);
    await new Promise(resolve => setTimeout(resolve, 0));
    await h.system.updateResult(agent.id, 'manual edit');
    gate.resolve('stale execution');

    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(h.system.getData(agent.id).content, 'manual edit');
});
