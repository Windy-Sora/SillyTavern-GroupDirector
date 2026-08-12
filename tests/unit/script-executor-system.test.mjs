import assert from 'node:assert/strict';
import test from 'node:test';
import { createScriptExecutorSystem } from '../../systems/script-executor-system.js';

function createSubject(initial = []) {
    const settings = { scriptExecutors: structuredClone(initial) };
    let saves = 0;
    const traces = [];
    const logs = [];
    const subject = createScriptExecutorSystem({
        settings,
        saveSettings: () => { saves++; },
        renderPrompt: async value => value,
        AgentTrace: { push: trace => traces.push(trace) },
        log: message => logs.push(String(message)),
    });
    return { subject, settings, traces, logs, getSaves: () => saves };
}

function payload(executors) {
    return { version: 1, type: 'script-executor-export', executors, migrations: [] };
}

test('script executor CRUD validates candidates before changing or saving settings', () => {
    const { subject, settings, getSaves } = createSubject();
    const added = subject.add({ name: 'valid' });
    assert.equal(getSaves(), 1);

    assert.throws(() => subject.update(added.id, { priority: 1000 }), /priority/);
    assert.equal(settings.scriptExecutors[0].priority, 0);
    assert.equal(getSaves(), 1);

    assert.throws(() => subject.add(null), /must be an object/);
    assert.equal(settings.scriptExecutors.length, 1);
    assert.equal(getSaves(), 1);
});

test('batch import validates every executor before making any change', async () => {
    const original = [{ id: 'old', name: 'Old', triggerOn: 'both', priority: 0, code: '', enabled: true, params: [], renderParams: false, returnMode: 'ignore' }];
    const { subject, settings, getSaves } = createSubject(original);

    await assert.rejects(subject.importExecutors(payload([{ name: 'Good' }, null])), /executors\[1\]/);
    assert.deepEqual(settings.scriptExecutors, original);
    assert.equal(getSaves(), 0);
});

test('batch import resolves conflicts on a candidate list and commits once', async () => {
    const original = [{ id: 'stable', name: 'Same', triggerOn: 'both', priority: 0, code: 'old', enabled: true, params: [], renderParams: false, returnMode: 'ignore' }];
    const { subject, settings, getSaves } = createSubject(original);
    const seen = [];

    const result = await subject.importExecutors(payload([
        { name: 'Same', code: 'new' },
        { name: 'Added', triggerOn: 'round' },
    ]), {
        resolveConflict: async conflict => {
            seen.push(conflict);
            return 'overwrite';
        },
    });

    assert.deepEqual(result, { imported: 2, skipped: 0, cancelled: false });
    assert.equal(seen.length, 1);
    assert.equal(settings.scriptExecutors[0].id, 'stable');
    assert.equal(settings.scriptExecutors[0].code, 'new');
    assert.equal(settings.scriptExecutors[1].name, 'Added');
    assert.notEqual(settings.scriptExecutors[1].id, undefined);
    assert.equal(getSaves(), 1);
});

test('cancelling a later conflict leaves the complete live list untouched', async () => {
    const original = [{ id: 'old', name: 'Conflict', triggerOn: 'both', priority: 0, code: '', enabled: true, params: [], renderParams: false, returnMode: 'ignore' }];
    const { subject, settings, getSaves } = createSubject(original);

    const result = await subject.importExecutors(payload([
        { name: 'Would Be Added' },
        { name: 'Conflict' },
    ]), { resolveConflict: async () => 'cancel' });

    assert.deepEqual(result, { imported: 0, skipped: 0, cancelled: true });
    assert.deepEqual(settings.scriptExecutors, original);
    assert.equal(getSaves(), 0);
});

test('batch import rolls settings back when persistence fails', async () => {
    const original = [{ id: 'old', name: 'Old', triggerOn: 'both', priority: 0, code: '', enabled: true, params: [], renderParams: false, returnMode: 'ignore' }];
    const settings = { scriptExecutors: structuredClone(original) };
    const subject = createScriptExecutorSystem({
        settings,
        saveSettings: async () => { throw new Error('disk unavailable'); },
        renderPrompt: async value => value,
        AgentTrace: null,
        log: () => {},
    });

    await assert.rejects(subject.importExecutors(payload([{ name: 'New' }])), /disk unavailable/);
    assert.deepEqual(settings.scriptExecutors, original);
});

test('CRUD operations roll live settings back when persistence fails', () => {
    const original = [{ id: 'old', name: 'Old', triggerOn: 'both', priority: 0, code: '', enabled: true, params: [], renderParams: false, returnMode: 'ignore' }];
    const operations = [
        subject => subject.add({ name: 'New' }),
        subject => subject.update('old', { name: 'Changed' }),
        subject => subject.remove('old'),
        subject => subject.toggle('old'),
    ];

    for (const operate of operations) {
        const settings = { scriptExecutors: structuredClone(original) };
        const subject = createScriptExecutorSystem({
            settings,
            saveSettings: () => { throw new Error('disk unavailable'); },
            renderPrompt: async value => value,
            AgentTrace: null,
            log: () => {},
        });

        assert.throws(() => operate(subject), /disk unavailable/);
        assert.deepEqual(settings.scriptExecutors, original);
    }
});

test('execution is ordered, trigger-filtered, and continues after a script error', async () => {
    const entries = [
        { id: 'late', name: 'late', triggerOn: 'message', priority: 5, code: 'return { order: [...(ctx.shared.order || []), "late"] };', enabled: true, params: [], renderParams: false, returnMode: 'shared' },
        { id: 'bad', name: 'bad', triggerOn: 'message', priority: 0, code: 'throw new Error("boom")', enabled: true, params: [], renderParams: false, returnMode: 'ignore' },
        { id: 'early', name: 'early', triggerOn: 'both', priority: 1, code: 'return { order: ["early"] };', enabled: true, params: [], renderParams: false, returnMode: 'shared' },
        { id: 'round', name: 'round only', triggerOn: 'round', priority: -1, code: 'return { wrong: true };', enabled: true, params: [], renderParams: false, returnMode: 'shared' },
    ];
    const { subject, traces, logs } = createSubject(entries);

    await subject.executeAll('message', {});

    assert.deepEqual(subject.getTurnShared().order, ['early', 'late']);
    assert.equal(subject.getTurnShared().wrong, undefined);
    assert.deepEqual(traces[0].stages.map(stage => stage.id), ['bad', 'early', 'late']);
    assert.ok(logs.some(message => message.includes('boom')));
});

test('turn state is isolated between script executor system instances', async () => {
    const entry = { id: 'one', name: 'one', triggerOn: 'message', priority: 0, code: 'return { value: 1 };', enabled: true, params: [], renderParams: false, returnMode: 'shared' };
    const first = createSubject([entry]).subject;
    const second = createSubject([]).subject;

    await first.executeAll('message', {});
    assert.equal(first.getTurnShared().value, 1);
    assert.deepEqual(second.getTurnShared(), {});
    assert.equal(second.getTurnId(), 0);
});

test('a stale decision execution cannot restore the previous turn snapshot', async () => {
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const entry = {
        id: 'delayed', name: 'delayed', triggerOn: 'decision', priority: 0,
        code: 'return ctx.settings.wait;', enabled: true, params: [],
        renderParams: false, returnMode: 'ignore',
    };
    const { subject } = createSubject([entry]);
    const pending = subject.executeAllDecision({
        decision: { speakers: ['Old'] },
        settings: { wait },
    });
    await Promise.resolve();

    subject.resetTurnShared();
    release();
    assert.equal(await pending, null);
    assert.equal(subject.getDecisionSnapshot(), null);
});
