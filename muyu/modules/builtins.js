import { createMemoryReader } from './memory/reader.js';
import { createMemoryModule } from './memory/index.js';
import { createConfigDraftModule } from './config-draft/index.js';
import { memoryFields } from './config-draft/contracts.js';
import { createDirectorModule } from './director/index.js';
import { createContextModule } from './context/index.js';
import { createProviderModule } from './providers/index.js';
import { createInteractionModule } from './interaction/index.js';
import { createPermissionModule } from './permission/index.js';
import { createSettingsModule } from './settings/index.js';
import { createTaskPlanModule } from './task-plan/index.js';
import { createVariableDraftModule } from './variables/index.js';
import { createTaskBundleModule } from './task-bundle/index.js';
import { createProfileDraftModule } from './profile-draft/index.js';
import { createHistoryModule } from './history/index.js';
import { createVariableDraftPort } from '../host/variable-draft.js';
import { createTaskBundleDraftPort } from '../host/task-bundle-draft.js';
import { createToolPlan } from './tool-plan.js';
import { createArtifactOwners } from './artifact-owners.js';
import { toolCapability } from '../application/capabilities.js';
import { toolLabels } from './catalog.js';

/** Composition owns module lifecycle and task hooks, not the UI controller. */
export function createBuiltins(host) {
    const memory = createMemoryModule({ reader: createMemoryReader(host.memoryPorts) });
    const draft = createConfigDraftModule({ getSettings: host.getSettings, getTarget: host.configTarget });
    const director = createDirectorModule({ ports: host.memoryPorts });
    const settings = createSettingsModule({ getSettings: host.getSettings, getTarget: host.configTarget, memoryLimitPort: host.memoryLimitPort, completionVariablePort: host.completionVariablePort });
    const context = createContextModule(), history = createHistoryModule({ access: host.historyAccess }), providers = createProviderModule(host), interaction = createInteractionModule(), permission = createPermissionModule(), taskPlan = createTaskPlanModule();
    const variablePort = host.variableDraftPort || createVariableDraftPort(host.memoryPorts);
    const variables = createVariableDraftModule({ port: variablePort });
    const bundle = createTaskBundleModule({ port: host.bundleDraftPort || createTaskBundleDraftPort({ getTarget: host.currentTarget, getSettings: host.getSettings, variableDraftPort: variablePort }) });
    const profiles = createProfileDraftModule();
    const modules = [memory, draft, director, context, history, providers, interaction, permission, settings, taskPlan, variables, bundle, profiles];
    const unified = new Map();
    const legacyPreview = (args, ctx) => {
        const run = unified.get(ctx.runId);
        if (run && !run.bound) {
            draft.bindRun({ runId: ctx.runId, taskId: run.identity.taskId, target: ctx.target, allowedFields: memoryFields, previousArtifact: run.intent.artifact });
            run.bound = true;
        }
        return draft.handlers['muyu.config.preview'](args, ctx);
    };
    const entries = [
        { id: 'memory', module: memory },
        { id: 'legacy-draft', module: { registry: draft.registry, handlers: { ...draft.handlers, 'muyu.config.preview': legacyPreview } } },
        { id: 'director', module: director }, { id: 'context', module: context }, { id: 'history', module: history },
        { id: 'providers', module: providers }, { id: 'interaction', module: interaction },
        { id: 'permission', module: permission }, { id: 'settings', module: settings }, { id: 'task-plan', module: taskPlan }, { id: 'variables', module: variables },
        { id: 'task-bundle', module: bundle },
        { id: 'profile-draft', module: profiles },
    ];
    const { registry, handlers } = createToolPlan(entries, { capabilityFor: toolCapability, labels: toolLabels });
    const artifacts = createArtifactOwners([
        { toolId: 'muyu.config.preview', moduleId: 'memory-config', owner: draft },
        { toolId: 'muyu.settings.preview', moduleId: 'settings-config', owner: settings },
        { toolId: 'muyu.task.plan', moduleId: 'task-plan', owner: taskPlan },
        { toolId: 'muyu.variables.preview', moduleId: 'variable-draft', owner: variables },
        { toolId: 'muyu.task.preview', moduleId: 'task-bundle', owner: bundle },
        { toolId: 'muyu.profile.preview', moduleId: 'generated-profile', owner: profiles },
    ]);
    const shared = [...context.registry.list(), ...interaction.registry.list()].map(d => d.id);
    const tasks = {
        assistant: { module: null,
            bind(identity, intent) { unified.set(identity.id, { identity, intent, bound: false }); settings.bindRun(identity); taskPlan.bindRun(identity); variables.bindRun(identity); bundle.bindRun(identity); profiles.bindRun(identity); },
            publish(app, id, intent) {
                let failed = false; const published = new Map();
                const publish = fn => { try { fn(); } catch { failed = true; } };
                if (intent.completedTools?.has('muyu.memory.inspect')) publish(() => memory.publishReport(app, id));
                if (intent.completedTools?.has('muyu.director.inspect')) publish(() => director.publishReport(app, id));
                for (const candidate of intent.candidates?.values() || []) publish(() => published.set(candidate.candidateId, artifacts.publish(app, id, candidate)));
                return { notice: failed ? 'RESULT_NEEDS_REVIEW' : null, published };
            },
        },
        chat: { module: providers, publish: () => null },
        memory: { module: memory, publish: (app, id) => { memory.publishReport(app, id); return null; } },
        director: { module: director, publish: (app, id) => { director.publishReport(app, id); return null; } },
        draft: { module: draft,
            validate(fields) { if (!Array.isArray(fields) || !fields.length || fields.some(f => !memoryFields.includes(f)) || new Set(fields).size !== fields.length) throw Error('FIELD_SCOPE_REQUIRED'); },
            bind(identity, intent) { draft.bindRun({ runId: identity.id, taskId: identity.taskId, target: identity.target, allowedFields: intent.fields, previousArtifact: intent.artifact }); },
            publish(app, id, intent) { const candidate = intent.candidates?.get('muyu.config.preview'); if (!candidate) return 'NO_CANDIDATE'; artifacts.publish(app, id, candidate); return null; },
        },
    };
    for (const task of Object.values(tasks)) task.tools = task.module ? [...shared, ...task.module.registry.list().map(d => d.id)] : registry.list().map(d => d.id);
    tasks.chat.tools.push(...permission.registry.list().map(d => d.id));
    return { registry, handlers, tasks, candidateTool: artifacts.produces, invalidateSettingsAttempt: (id, fields) => settings.invalidateAttempt(id, fields), takeInvalidatedSettingsCandidates: id => settings.takeInvalidatedCandidates(id),
        transferRun(from, identity, intent) { const previous = unified.get(from); if (previous) { unified.delete(from); unified.set(identity.id, { ...previous, identity, intent }); } for (const module of modules) if (module !== providers) module.transferRun?.(from, identity); },
        bindBudget: (id, limit, from = null) => from ? providers.transferRun(from, id, limit) : providers.bindRun(id, limit),
        resourceUsage: id => providers.usage(id), revalidate: artifacts.revalidate, forgetRun: id => { unified.delete(id); modules.forEach(m => m.forgetRun(id)); }, dispose: () => { unified.clear(); modules.forEach(m => m.dispose()); } };
}
