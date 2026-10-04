import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillPort } from '../../muyu/host/skills.js';
import { createSkillTaskRuntime } from '../../muyu/skills/task-runtime.js';
import { createSkillRuntimeModule } from '../../muyu/modules/skills/runtime.js';
import { skillEditorPackage } from '../../muyu/skills/editor.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { identity, scriptedModel, text, done, request, deferred } from './helpers/muyu-subject.mjs';

async function fixture({ body = 'Use the actual contracts.', manual = false, enabled = true, budget = 1000000 } = {}) {
    const settings = {}, port = createSkillPort({ getSettings: () => settings, saveSettings: async () => {}, loadBuiltins: async () => [] });
    await port.ready(); await port.save(port.preview({ operation: 'create', expectedRevision: 0, enabled,
        package: skillEditorPackage({ name: 'example', description: 'Configuration review', body, modelInvocable: !manual, resources: [{ path: 'references/rules.md', text: 'Never grant permissions.' }] }) }));
    let charged = 0;
    const task = createSkillTaskRuntime({ port, charge: (_, bytes) => { if (charged + bytes > budget) return false; charged += bytes; return true; } });
    return { settings, port, task, charged: () => charged };
}
const query = { id: 'user:example', revision: '1', path: 'SKILL.md' };
test('Plan approval retains fixed Skill snapshot, charges the new segment, and respects target', async () => {
    const f = await fixture(); f.task.bindRun(identity); await f.task.prepare(identity.id); await f.task.load(identity.id, query);
    assert.equal(f.task.parkRun(identity.id, { id: 'plan', kind: 'task-plan', taskId: identity.taskId }), true);
    f.task.forgetRun(identity.id);
    await f.port.save(f.port.preview({ operation: 'delete', id: query.id, revision: 1, expectedRevision: 1 }));
    assert.throws(() => f.task.bindRun({ ...identity, id: 'wrong', target: { ...identity.target, chatKey: 'B' } }), /INVALID_RUN_TRANSFER/);
    const before = f.charged(); f.task.bindRun({ ...identity, id: 'approved' }); await f.task.prepare('approved');
    assert.ok(f.charged() > before); assert.equal(f.task.usage('approved')[0].revision, '1');
    await f.task.load('approved', { ...query, path: 'references/rules.md' });
});
test('Pending plan Skill cache is bounded and released with decline or deleted artifacts', async () => {
    const f = await fixture();
    for (let i = 0; i < 9; i++) {
        const owner = { ...identity, id: `run${i}`, taskId: `task${i}` }; f.task.bindRun(owner); await f.task.load(owner.id, query);
        assert.equal(f.task.parkRun(owner.id, { id: `plan${i}`, kind: 'task-plan', taskId: owner.taskId }), i < 8); f.task.forgetRun(owner.id);
    }
    f.task.forgetTask('task0'); f.task.retainArtifacts([]);
    f.task.bindRun({ ...identity, id: 'fresh', taskId: 'task1' }); assert.equal(f.task.usage('fresh').length, 0);
});
test('Retained Skill is subject to the newly approved execution segment budget', async () => {
    const f = await fixture(); let allow = true;
    const task = createSkillTaskRuntime({ port: f.port, charge: () => allow }); task.bindRun(identity); await task.prepare(identity.id); await task.load(identity.id, query);
    task.parkRun(identity.id, { id: 'plan', kind: 'task-plan', taskId: identity.taskId }); task.forgetRun(identity.id);
    allow = false; task.bindRun({ ...identity, id: 'approved' }); await assert.rejects(task.prepare('approved'), /PROVIDER_BUDGET_EXCEEDED/);
});
test('Skill catalog exposes only enabled model-eligible metadata, never body or manual-only entries', async () => {
    for (const options of [{ manual: true }, { enabled: false }]) {
        const f = await fixture(options); assert.equal((await f.port.catalog()).entries.length, 0);
        await assert.rejects(f.port.snapshot({ id: query.id, revision: 1, invocation: 'model' }), /SKILL_DISABLED/);
    }
    const f = await fixture({ body: 'PRIVATE_BODY' }); const catalog = await f.port.catalog();
    assert.equal(catalog.entries.length, 1); assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_BODY/);
});
test('Task loads full long main documents outside bounded tool DTOs; reread is deduplicated', async () => {
    const body = 'Complete instructions. '.repeat(4000), f = await fixture({ body }); f.task.bindRun(identity);
    await f.task.prepare(identity.id); const before = f.charged();
    const result = await f.task.load(identity.id, query); assert.equal(result.complete, true); assert.equal(result.permissionGranted, false);
    assert.ok(result.bytes > 32768); assert.match(f.task.project(identity.id).at(-1).content, /Complete instructions/);
    const after = f.charged(); assert.ok(after > before);
    await f.task.load(identity.id, query); assert.equal(f.charged(), after);
    assert.equal(JSON.parse(f.task.project(identity.id).at(-1).content.split('\n')[1]).text.endsWith(body), true);
});
test('Task resources require main first, reject missing paths, and cannot escape package', async () => {
    const f = await fixture(); f.task.bindRun(identity);
    await assert.rejects(f.task.load(identity.id, { ...query, path: 'references/rules.md' }), /SKILL_MAIN_REQUIRED/);
    await f.task.load(identity.id, query);
    await assert.rejects(f.task.load(identity.id, { ...query, path: '../secrets.txt' }), /SKILL_/);
    await assert.rejects(f.task.load(identity.id, { ...query, path: 'references/missing.md' }), /SKILL_RESOURCE_NOT_FOUND/);
    await f.task.load(identity.id, { ...query, path: 'references/rules.md' });
    assert.equal(f.task.usage(identity.id)[0].paths.length, 2);
});
test('Task fixed snapshot survives edit, disable and deletion; new tasks cannot load old revision', async () => {
    const f = await fixture(); f.task.bindRun(identity); await f.task.load(identity.id, query);
    await f.port.save(f.port.preview({ operation: 'update', id: query.id, revision: 1, expectedRevision: 1, fields: { body: 'Changed document.' } }));
    await f.port.save(f.port.preview({ operation: 'delete', id: query.id, revision: 2, expectedRevision: 2 }));
    await f.task.load(identity.id, { ...query, path: 'references/rules.md' });
    assert.doesNotMatch(JSON.stringify(f.task.project(identity.id)), /Changed document/);
    await assert.rejects(f.task.load(identity.id, { ...query, revision: '2' }), /SKILL_STALE/);
    f.task.bindRun({ ...identity, id: 'new', taskId: 'other' });
    await assert.rejects(f.task.load('new', query), /SKILL_NOT_FOUND/);
});
test('Manual-only Skill requires structured GUI selection; model cannot forge invocation', async () => {
    const f = await fixture({ manual: true }); f.task.bindRun(identity, query); await f.task.prepare(identity.id);
    assert.equal(f.task.usage(identity.id)[0].invocation, 'user');
    f.task.bindRun({ ...identity, id: 'model', taskId: 'other' });
    const result = await f.task.call('model', 'load', { ...query, invocation: 'user' }, {});
    assert.equal(JSON.parse(result.text).code, 'SKILL_DISABLED');
});
test('Transfer preserves exact loaded snapshots and charged bytes, isolated new question has no guidance', async () => {
    const f = await fixture(); f.task.bindRun(identity); await f.task.prepare(identity.id); await f.task.load(identity.id, query);
    const before = f.charged(), projected = f.task.project(identity.id);
    f.task.transferRun(identity.id, { ...identity, id: 'resumed' }); await f.task.prepare('resumed');
    assert.deepEqual(f.task.project('resumed'), projected); assert.equal(f.charged(), before);
    assert.throws(() => f.task.project(identity.id), /RUN_NOT_BOUND/);
    f.task.bindRun({ ...identity, id: 'new', taskId: 'other' }); await f.task.prepare('new');
    assert.equal(f.task.usage('new').length, 0); assert.doesNotMatch(JSON.stringify(f.task.project('new')), /CURRENT TASK SKILL GUIDE/);
    assert.throws(() => f.task.transferRun('resumed', { ...identity, id: 'wrong', taskId: 'other' }), /INVALID_RUN_TRANSFER/);
});
test('Insufficient read budget loads nothing, no partial main instruction or hidden expansion', async () => {
    const f = await fixture({ body: 'Long.'.repeat(3000), budget: 1000 }); f.task.bindRun(identity); await f.task.prepare(identity.id);
    const result = await f.task.call(identity.id, 'load', query, {});
    assert.equal(JSON.parse(result.text).code, 'PROVIDER_BUDGET_EXCEEDED'); assert.equal(f.task.usage(identity.id).length, 0);
    assert.ok(f.charged() <= 1000); assert.doesNotMatch(JSON.stringify(f.task.project(identity.id)), /Long\./);
});
test('Manual selected stale revision fails before any model call instead of silently switching version', async () => {
    const f = await fixture(); f.task.bindRun(identity, { ...query, revision: '999' });
    const model = scriptedModel([[text('Should not run'), done]]);
    const module = createSkillRuntimeModule({ port: f.port });
    const result = await startMuyuRun({ identity, input: 'Do it', registry: module.registry, allowedTools: [], model,
        taskGuidePort: { prepare: signal => f.task.prepare(identity.id, signal), project: () => f.task.project(identity.id) } }).completion;
    assert.equal(result.error, 'SKILL_STALE'); assert.equal(model.requests.length, 0);
});
test('Cancellation or deleted run during asynchronous snapshot leaves no late loaded document', async () => {
    const wait = deferred(), f = await fixture();
    const task = createSkillTaskRuntime({ port: { snapshot: () => wait.promise } }); task.bindRun(identity);
    const pending = task.load(identity.id, query); task.forgetRun(identity.id);
    wait.resolve(await f.port.snapshot({ id: query.id, revision: 1, invocation: 'model' }));
    await assert.rejects(pending, /CANCELLED/); assert.throws(() => task.project(identity.id), /RUN_NOT_BOUND/);
});
test('Runtime projection survives historical trimming without persisting Skill bodies in messages', async () => {
    const f = await fixture({ body: 'PRIVATE_SKILL_GUIDE' }), module = createSkillRuntimeModule({ port: f.port });
    module.bindRun(identity);
    const model = scriptedModel([
        [request({ callId: 'load', toolId: 'muyu.skills.load', version: 1, args: query }), done],
        [text('Complete'), done],
    ]);
    const result = await startMuyuRun({ identity, input: 'Review', registry: module.registry, allowedTools: module.registry.list().map(d => d.id), handlers: module.handlers, policy: () => true, model,
        taskGuidePort: { prepare: signal => module.prepare(identity.id, signal), project: () => module.project(identity.id) } }).completion;
    assert.equal(result.state.status, 'succeeded'); assert.match(JSON.stringify(model.requests[1].taskGuides), /PRIVATE_SKILL_GUIDE/);
    assert.doesNotMatch(JSON.stringify(result.messages), /PRIVATE_SKILL_GUIDE/);
    assert.equal(model.requests[1].messages.length, 3);
});
