import { copyJson, jsonKey, validateJson } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { taskBundleSchema } from '../../host/task-bundle-draft.js';
import { configChangesSchema } from '../../config/registry.js';

// Avoid duplicating the full settings schema in every model request.
const toolSchema = { type: 'object', properties: {
    settingsJson: { type: 'string', maxLength: 16000 },
    variables: taskBundleSchema.properties.variables, apply: { type: 'boolean' },
}, additionalProperties: false };

/** One model call proposes data; only the trusted UI can approve writes. */
export function createTaskBundleModule({ port }) {
    const registry = createToolRegistry(), runs = new Map(); let disposed = false;
    registry.register({ id: 'muyu.task.preview', version: 1,
        description: 'Preview one bounded operation bundle: up to six distinct numeric current-chat variable definitions and ordinary global settings changes. Put settings changes in settingsJson as a JSON object string of exact field names and values; omit unused sections. In full-access mode ONLY, set apply=true when the user explicitly asks to execute the bundle now; the host validates and saves after the run. For preview-only or read-only requests omit apply. Without full access, separate UI approval is required. memoryMaxEntries, storyBlueprintCompletionVariable, blueprint/resource writes, code and secrets require separate workflows. Do not add changes the user did not request.',
        inputSchema: toolSchema,
        outputSchema: { type: 'object', properties: { candidateId: { type: 'string', maxLength: 100 }, text: { type: 'string', maxLength: 12000 }, applyRequested: { type: 'boolean' } }, required: ['candidateId', 'text'], additionalProperties: false },
        scope: 'chat', effect: 'read', dataClasses: ['chat-variables', 'settings-whitelist'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    const handlers = { 'muyu.task.preview': (args, ctx) => {
        if (disposed) throw Error('MODULE_DISPOSED');
        const run = runs.get(ctx.runId);
        if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        if (run.candidate) port.forget(run.candidate.content);
        run.candidate = null;
        const input = validateJson(toolSchema, args);
        const settings = input.settingsJson === undefined ? {} : validateJson(configChangesSchema, JSON.parse(input.settingsJson));
        const content = port.prepare(ctx.target, { settings, variables: input.variables || [] });
        const preview = { scope: 'current-chat-and-global', order: 'variables-then-settings',
            variables: content.variables.map(row => row.preview), settings: content.settings?.preview || null,
            notice: 'Preview only. One separate UI approval executes exact steps in order; an uncertain save stops remaining steps.' };
        const text = JSON.stringify(input.apply ? { ...preview, automaticApplication: 'requested; check step receipts after run' } : preview);
        if (text.length > 12000) { port.forget(content); throw Error('BUNDLE_PREVIEW_TOO_LARGE'); }
        const candidateId = 'bundle:' + crypto.randomUUID();
        run.candidate = { candidateId, content };
        return { candidateId, text, ...(input.apply ? { applyRequested: true } : {}) };
    } };
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); runs.set(identity.id, run); },
        publishDraft(app, id, candidateId) {
            const run = runs.get(id), state = app.snapshot().runs.find(row => row.id === id);
            if (!run?.candidate || run.candidate.candidateId !== candidateId || state?.status !== 'succeeded' || state.taskId !== run.taskId || jsonKey(state.target) !== jsonKey(run.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            port.assertFresh(run.candidate.content);
            const artifact = app.createArtifact({ taskId: run.taskId, sourceRunId: id, kind: 'task-bundle', content: run.candidate.content });
            runs.delete(id); return artifact;
        },
        validateSaved(app, id, revision) {
            const artifact = app.getArtifact(id), state = app.snapshot().runs.find(row => row.id === artifact.sourceRunId);
            if (artifact.kind !== 'task-bundle' || artifact.revision !== revision || state?.status !== 'succeeded' || state.taskId !== artifact.taskId) throw Error('INVALID_TASK_BUNDLE');
            port.assertFresh(artifact.content);
            return app.validateArtifact(id, revision, { structural: 'passed', baseline: 'matched-at-validation', intent: 'review-only', writes: 'bundle-approval-required' });
        },
        forgetRun(id) { const run = runs.get(id); if (run?.candidate) port.forget(run.candidate.content); runs.delete(id); },
        dispose() { disposed = true; runs.clear(); port.clear(); },
    };
}
