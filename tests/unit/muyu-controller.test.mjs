import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { scriptedModel, text, done, deferred, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args = {}) => ({ type: 'tool_call_complete', call: { toolId, callId: 'c1', version: 1, args } });
function fixture(steps = [[text('answer'), done]]) {
    const events = new EventEmitter(), settings = { memoryEnabled: true, autoMemoryEnabled: true, autoMemoryInterval: 10, autoMemorySpeakers: false };
    const ctx = { groupId: 'g', chatId: 'A', groups: [{ id: 'g', members: ['private-avatar'] }], chat: [{ mes: 'PRIVATE_BODY' }], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    let reads = 0;
    const host = createHostBridge({ getContext: () => ctx, getSettings: () => { reads++; return settings; }, extensionKey: 'gd', pageId: 'test' });
    const model = scriptedModel(steps), configs = [];
    const controller = createMuyuController({ host, createModel: config => { configs.push(config); return model; } });
    return { host, ctx, events, settings, model, configs, controller, reads: () => reads,
        enable: () => controller.configure({ endpoint: 'https://example.test/chat/completions', apiKey: 'PRIVATE_KEY', model: 'test', thinking: true }),
        switchChat: id => { ctx.chatId = id; events.emit('chat'); } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await flush(); };

test('Safe network failures remain distinguishable from authentication errors', async () => {
    const f = fixture([() => { throw new ExecutionError('MODEL_NETWORK_ERROR'); }]);
    await f.enable(); f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.controller.snapshot().notice, 'MODEL_NETWORK_ERROR');
    assert.equal(f.controller.snapshot().runs[0].status, 'failed'); await f.controller.dispose();
});

test('Memory authorization cannot invoke draft tools or create config artifacts', async () => {
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryEnabled: false } }), done], [text('denied'), done]]);
    await f.enable(); f.controller.setInput('question'); f.controller.send({ consent: true }); await settle();
    assert.equal(f.reads(), 0); assert.equal(f.controller.snapshot().artifacts.length, 0);
    assert.equal(f.settings.autoMemoryEnabled, true); await f.controller.dispose();
});

test('Continue a selected draft creates a new revision, preserving the unchanged fields', async () => {
    const f = fixture([
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('v1'), done],
        [tool('muyu.config.preview', { changes: { autoMemoryInterval: 20 } }), done], [text('v2'), done],
    ]);
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval 15');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const first = f.controller.snapshot().artifacts[0]; f.controller.setInput('change to 20');
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'], artifactId: first.id }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.artifacts.length, 1); assert.equal(s.artifacts[0].revision, 2);
    assert.equal(s.artifacts[0].taskId, first.taskId); assert.equal(s.artifacts[0].content.preview.manifest.settings.autoMemoryInterval, 20);
    assert.equal(f.settings.autoMemoryInterval, 10); await f.controller.dispose();
});

test('Host identity includes owner; bridge subscribes once and does not read message bodies', () => {
    const f = fixture(), a = f.host.currentTarget();
    f.ctx.groupId = 'other'; assert.notDeepEqual(f.host.currentTarget(), a);
    f.ctx.groupId = null; f.ctx.characterId = 0; f.ctx.characters = [{ avatar: 'avatar' }];
    assert.notDeepEqual(f.host.currentTarget(), a);
    f.ctx.chatId = ''; assert.equal(f.host.currentTarget(), null);
    assert.equal(f.reads(), 0); assert.equal(f.events.listenerCount('chat'), 1);
    return f.controller.dispose().then(() => assert.equal(f.events.listenerCount('chat'), 0));
});

test('Disabled/default controller and missing consent cannot invoke model or read settings', async () => {
    const f = fixture(); f.controller.setInput('hello');
    assert.equal(f.controller.snapshot().enabled, false);
    assert.throws(() => f.controller.send({ consent: true }), /NOT_READY/);
    await f.enable(); assert.throws(() => f.controller.send(), /CONSENT_REQUIRED/);
    assert.equal(f.reads(), 0); assert.equal(f.model.requests.length, 0);
    assert.ok(!JSON.stringify(f.controller.snapshot()).includes('PRIVATE_KEY'));
    const snapshot = f.controller.snapshot(); snapshot.connection.model = 'tamper';
    assert.equal(f.controller.snapshot().connection.model, 'test'); await f.controller.dispose();
});

test('View subscriptions and chat drafts survive unmount; empty chat switches reset view identity', async () => {
    const f = fixture(); const a = f.controller.snapshot().viewToken;
    f.controller.setInput('A draft'); let updates = 0;
    const sub = f.controller.subscribe(() => updates++); sub.unsubscribe();
    f.switchChat('B'); assert.notEqual(f.controller.snapshot().viewToken, a); assert.equal(updates, 0);
    f.controller.setInput('B draft'); f.switchChat('A'); assert.equal(f.controller.snapshot().input, 'A draft');
    f.controller.setMode('draft'); f.controller.setInput('global draft'); f.switchChat('B');
    assert.equal(f.controller.snapshot().input, 'global draft');
    f.controller.setMode('memory'); assert.equal(f.controller.snapshot().input, 'B draft'); await f.controller.dispose();
});

test('Memory run publishes trusted report, never private bodies or identities', async () => {
    const f = fixture([[tool('muyu.memory.inspect'), done], [text('evidence answer'), done]]);
    await f.enable(); f.controller.setInput('diagnose'); f.controller.send({ consent: true }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts[0].kind, 'report');
    assert.doesNotMatch(JSON.stringify(f.model.requests), /PRIVATE_BODY|private-avatar|PRIVATE_KEY/);
    assert.equal(s.messages.at(-1).content, 'evidence answer'); await f.controller.dispose();
});

test('Global draft requires explicit fields; publishes validated diff without writing settings', async () => {
    const f = fixture([[tool('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done], [text('draft only'), done]]);
    await f.enable(); f.controller.setMode('draft'); f.controller.setInput('interval 15');
    assert.throws(() => f.controller.send({ consent: true }), /FIELD_SCOPE_REQUIRED/);
    f.controller.send({ consent: true, fields: ['autoMemoryInterval'] }); await settle();
    const s = f.controller.snapshot(); assert.equal(s.runs[0].status, 'succeeded'); assert.equal(s.artifacts.length, 1);
    assert.equal(s.artifacts[0].content.preview.manifest.settings.autoMemoryInterval, 15);
    assert.equal(f.settings.autoMemoryInterval, 10);
    f.settings.autoMemoryInterval = 20;
    assert.throws(() => f.controller.revalidate(s.artifacts[0].id, 1), /STALE_DRAFT/);
    assert.equal(f.controller.snapshot().artifacts[0].validation.status, 'stale'); await f.controller.dispose();
});

test('Chat switch cancels old run, late answer cannot overwrite new input, drain blocks reuse', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    f.controller.setInput('A'); f.controller.send({ consent: true }); await flush();
    f.switchChat('B'); f.controller.setInput('B unsaved'); await settle();
    assert.equal(f.controller.snapshot().busy, true); assert.equal(f.controller.snapshot().draining, true);
    assert.throws(() => f.controller.send({ consent: true }), /NOT_READY/);
    wait.resolve([text('late A'), done]); await settle();
    assert.equal(f.controller.snapshot().input, 'B unsaved'); assert.equal(f.controller.snapshot().messages.length, 0);
    f.switchChat('A'); assert.equal(f.controller.snapshot().runs[0].status, 'cancelled'); await f.controller.dispose();
});

test('Global run survives chat switch; disabling waits for physical drain and clears credentials/state', async () => {
    const wait = deferred(), f = fixture([() => wait.promise]); await f.enable();
    f.controller.setMode('draft'); f.controller.setInput('draft'); f.controller.send({ consent: true, fields: ['autoMemoryEnabled'] }); await flush();
    f.switchChat('B'); await flush(); assert.equal(f.controller.snapshot().runs[0].status, 'running');
    const disabled = f.controller.disable(); await settle(); assert.equal(f.controller.snapshot().resetting, true);
    wait.resolve([text('late'), done]); await disabled;
    assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.controller.snapshot().connection, null);
    assert.equal(f.controller.snapshot().artifacts.length, 0); assert.equal(f.controller.snapshot().messages.length, 0); await f.controller.dispose();
});
