import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPlanModule, projectTaskPlan } from '../../muyu/modules/task-plan/index.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';
import { createWorkspace } from '../../muyu/workspace/store.js';

const target = { kind: 'chat', userKey: 'page:1', chatKey: 'group:A' };
const input = { goal: 'Create a coin system for this chat', scope: 'mixed', sources: ['configSettings', 'variables'],
    steps: [
        { kind: 'read', title: 'Inspect', detail: 'Read current chat variables and relevant settings' },
        { kind: 'settings', title: 'Prepare switches', detail: 'Preview only; requires separate apply approval' },
        { kind: 'variables', title: 'Create balance', detail: 'Needs a future variable write port' },
    ], risks: ['An existing variable could be overwritten; no write is authorized'], unknowns: ['Existing balance variable may conflict'] };

test('Task plan is bounded, read-only and labels unavailable write paths', () => {
    const plan = projectTaskPlan(input, target);
    assert.deepEqual(plan.steps.map(step => step.availability), ['read-only', 'bundle-or-separate-draft-approval-required', 'bundle-or-separate-draft-approval-required']);
    assert.equal(plan.risks.length, 1);
    assert.throws(() => projectTaskPlan({ ...input, sources: ['variables', 'variables'] }, target), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, sources: ['providerExecution'] }, target));
    assert.throws(() => projectTaskPlan(input, { kind: 'global', userKey: 'page:1' }), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, scope: 'global' }, target), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, steps: [] }, target), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, steps: [{ kind: 'write-anywhere', title: 'x', detail: 'x' }] }, target));
});

test('Broad infinite-flow proposals remain bounded and cannot include undeclared execution', () => {
    const plan = projectTaskPlan({ goal: '设计当前聊天的无限流规则', scope: 'mixed', sources: ['variables', 'storyBlueprint', 'configSettings'],
        steps: Array.from({ length: 8 }, (_, index) => ({ kind: index % 2 ? 'variables' : 'read', title: `步骤 ${index}`, detail: '仅核对或预览已列出的范围' })),
        risks: ['多模块保存不能视为原子操作'], unknowns: ['现有变量是否冲突'] }, target);
    assert.equal(plan.steps.length, 8);
    assert.equal(plan.steps.filter(step => step.availability === 'bundle-or-separate-draft-approval-required').length, 4);
    assert.throws(() => projectTaskPlan({ ...plan, steps: [...plan.steps.map(({ availability, ...step }) => step), { kind: 'code', title: 'extra', detail: 'execute' }] }, target));
    assert.throws(() => projectTaskPlan({ ...input, sources: ['variables', 'providerExecution'] }, target));
});

test('Plan candidate publishes only after a succeeded same-target run and carries no authority', () => {
    const module = createTaskPlanModule();
    const workspace = createWorkspace();
    const artifacts = [];
    const app = { snapshot: () => ({ runs: [{ id: 'r', taskId: 't', target, status: 'succeeded' }] }),
        createArtifact: value => { const artifact = workspace.create({ id: 'a', sessionId: 's', ...value }); artifacts.push(artifact); return artifact; },
        getArtifact: id => workspace.get(id), validateArtifact: (id, revision, validation) => workspace.validate(id, revision, validation) };
    module.bindRun({ id: 'r', taskId: 't', target });
    const { candidateId } = module.handlers['muyu.task.plan'](input, { runId: 'r', target });
    assert.equal(artifacts.length, 0);
    assert.throws(() => module.publishDraft(app, 'r', 'wrong'), /INVALID_CANDIDATE_SOURCE/);
    const artifact = module.publishDraft(app, 'r', candidateId);
    assert.equal(artifact.kind, 'task-plan');
    assert.equal(artifact.content.plan.steps[2].availability, 'bundle-or-separate-draft-approval-required');
    assert.equal(module.validateSaved(app, artifact.id, artifact.revision).validation.intent, 'read-scope-review');
    module.dispose();
});

test('One task decision grants only listed read sources, rolls back failed continuation and expires', () => {
    const permissions = createSourcePermissions();
    let resumed = 0;
    assert.throws(() => permissions.grantTaskSources(['source:configSettings', 'source:variables'], target, 't', () => { throw Error('not queued'); }), /not queued/);
    assert.equal(permissions.allows('source:configSettings', target, 't'), false);
    permissions.grantTaskSources(['source:configSettings', 'source:variables'], target, 't', () => { resumed++; });
    assert.equal(resumed, 1);
    assert.equal(permissions.allows('source:variables', target, 't'), true);
    assert.equal(permissions.allows('source:chatHistory', target, 't'), false);
    assert.equal(permissions.allows('source:variables', { ...target, chatKey: 'group:B' }, 't'), false);
    assert.equal(permissions.allows('source:variables', target, 'another-task'), false);
    assert.throws(() => permissions.grantTaskSources(['source:providerExecution'], target, 't', () => {}), /INVALID_TASK_SCOPE/);
    permissions.forgetTask(target, 't');
    assert.equal(permissions.allows('source:variables', target, 't'), false);
});
