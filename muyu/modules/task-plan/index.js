import { copyJson, jsonKey, validateJson } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { permissionSource, requestableSources } from '../../permissions/contract.js';

const sourceIds = requestableSources.filter(item => item.id !== 'providerExecution').map(item => item.id);
const stepKinds = ['read', 'settings', 'variables', 'blueprint', 'resource', 'code', 'other'];
const string = maxLength => ({ type: 'string', maxLength });
const stepSchema = { type: 'object', properties: {
    kind: { type: 'string', enum: stepKinds }, title: string(100), detail: string(600),
}, required: ['kind', 'title', 'detail'], additionalProperties: false };
export const taskPlanSchema = { type: 'object', properties: {
    goal: string(300), scope: { type: 'string', enum: ['global', 'current-chat', 'mixed'] },
    sources: { type: 'array', items: { type: 'string', enum: sourceIds }, maxItems: 12 },
    steps: { type: 'array', items: stepSchema, maxItems: 8 },
    risks: { type: 'array', items: string(200), maxItems: 6 },
    unknowns: { type: 'array', items: string(200), maxItems: 6 },
}, required: ['goal', 'scope', 'sources', 'steps', 'unknowns'], additionalProperties: false };

const availability = Object.freeze({ read: 'read-only', settings: 'bundle-or-separate-draft-approval-required', variables: 'bundle-or-separate-draft-approval-required',
    blueprint: 'not-available', resource: 'not-available', code: 'separate-code-approval-required', other: 'not-available' });

export function projectTaskPlan(input, target) {
    const value = validateJson(taskPlanSchema, input);
    if (!value.goal.trim() || !value.steps.length || value.steps.some(step => !step.title.trim() || !step.detail.trim()) ||
        new Set(value.sources).size !== value.sources.length ||
        (value.scope !== 'global' && target?.kind !== 'chat') ||
        (value.scope === 'global' && value.sources.some(id => permissionSource(id)?.scope === 'chat')) ||
        value.sources.some(id => !permissionSource(id) || permissionSource(id).scope === 'chat' && target?.kind !== 'chat')) throw Error('INVALID_TASK_PLAN');
    return copyJson({ ...value, risks: value.risks || [], steps: value.steps.map(step => ({ ...step, availability: availability[step.kind] })) });
}

/** A model proposal is data, never a permission or a write command. */
export function createTaskPlanModule() {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    registry.register({ id: 'muyu.task.plan', version: 1,
        description: 'Propose a bounded multi-step task plan. Name only sources needed to investigate; do not read them here. After authorized reads, ordinary settings and numeric current-chat variables can be proposed together with muyu.task.preview, then require one separate exact-bundle UI approval. The task-plan read approval grants no writes. Blueprint/resource writes and code changes are not available through this plan. Do not claim the task is complete.',
        inputSchema: taskPlanSchema, outputSchema: { type: 'object', properties: { candidateId: string(100), text: string(10000) }, required: ['candidateId', 'text'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const handlers = { 'muyu.task.plan': (args, ctx) => {
        if (disposed) throw Error('MODULE_DISPOSED');
        const run = runs.get(ctx.runId);
        if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        const plan = projectTaskPlan(args, ctx.target), candidateId = 'plan:' + crypto.randomUUID();
        run.candidate = { candidateId, plan };
        return { candidateId, text: JSON.stringify({ ...plan, notice: 'Only a proposal. No data access granted and no changes applied.' }) };
    } };
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        publishDraft(app, id, candidateId) {
            const r = runs.get(id), run = app.snapshot().runs.find(item => item.id === id);
            if (!r?.candidate || r.candidate.candidateId !== candidateId || run?.status !== 'succeeded' || run.taskId !== r.taskId || jsonKey(run.target) !== jsonKey(r.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            const content = { module: 'task-plan', version: 1, target: r.target, plan: r.candidate.plan };
            const artifact = app.createArtifact({ taskId: r.taskId, sourceRunId: id, kind: 'task-plan', content });
            runs.delete(id); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), content = artifact.content;
            if (artifact.kind !== 'task-plan' || artifact.revision !== revision || content.module !== 'task-plan' || content.version !== 1 ||
                jsonKey(projectTaskPlan({ ...content.plan, steps: content.plan.steps.map(({ availability, ...step }) => step) }, content.target)) !== jsonKey(content.plan)) throw Error('INVALID_TASK_PLAN');
            return app.validateArtifact(id, revision, { structural: 'passed', intent: 'read-scope-review', writes: 'unavailable' });
        },
        forgetRun(id) { runs.delete(id); }, dispose() { disposed = true; runs.clear(); },
    };
}
