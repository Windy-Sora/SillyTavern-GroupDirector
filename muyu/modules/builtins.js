import { createMemoryReader } from './memory/reader.js';
import { createMemoryModule } from './memory/index.js';
import { createConfigDraftModule } from './config-draft/index.js';
import { memoryFields } from './config-draft/contracts.js';
import { createDirectorModule } from './director/index.js';
import { createContextModule } from './context/index.js';
import { createToolRegistry } from '../tools/registry.js';
import { createProviderModule } from './providers/index.js';
import { createInteractionModule } from './interaction/index.js';
import { createPermissionModule } from './permission/index.js';
import { createSettingsModule } from './settings/index.js';

/** Composition owns module lifecycle and task hooks, not the UI controller. */
export function createBuiltins(host) {
    const memory = createMemoryModule({ reader: createMemoryReader(host.memoryPorts) });
    const draft = createConfigDraftModule({ getSettings: host.getSettings, getTarget: host.configTarget });
    const director = createDirectorModule({ ports: host.memoryPorts });
    const settings = createSettingsModule({ getSettings: host.getSettings, getTarget: host.configTarget, memoryLimitPort: host.memoryLimitPort });
    const context = createContextModule(), providers = createProviderModule(host), interaction = createInteractionModule(), permission = createPermissionModule(), modules = [memory, draft, director, context, providers, interaction, permission, settings];
    const registry = createToolRegistry(), handlers = {};
    const unified = new Map();
    for (const module of modules) {
        for (const definition of module.registry.list()) registry.register(definition);
        Object.assign(handlers, module.handlers);
    }
    registry.seal();
    const preview = handlers['muyu.config.preview'];
    handlers['muyu.config.preview'] = (args, ctx) => {
        const run = unified.get(ctx.runId);
        if (run && !run.bound) {
            draft.bindRun({ runId: ctx.runId, taskId: run.identity.taskId, target: ctx.target, allowedFields: memoryFields, previousArtifact: run.intent.artifact });
            run.bound = true;
        }
        return preview(args, ctx);
    };
    const shared = [...context.registry.list(), ...interaction.registry.list()].map(d => d.id);
    const tasks = {
        assistant: { module: null,
            bind(identity, intent) { unified.set(identity.id, { identity, intent, bound: false }); settings.bindRun(identity); },
            publish(app, id, intent) {
                let failed = false;
                const publish = fn => { try { fn(); } catch { failed = true; } };
                if (intent.completedTools?.has('muyu.memory.inspect')) publish(() => memory.publishReport(app, id));
                if (intent.completedTools?.has('muyu.director.inspect')) publish(() => director.publishReport(app, id));
                if (intent.candidateId) publish(() => { const owner = intent.candidateId.startsWith('settings:') ? settings : draft; const a = owner.publishDraft(app, id, intent.candidateId); owner.validateSaved(app, a.id, a.revision); });
                return failed ? 'RESULT_NEEDS_REVIEW' : null;
            },
        },
        chat: { module: providers, publish: () => null },
        memory: { module: memory, publish: (app, id) => { memory.publishReport(app, id); return null; } },
        director: { module: director, publish: (app, id) => { director.publishReport(app, id); return null; } },
        draft: { module: draft,
            validate(fields) { if (!Array.isArray(fields) || !fields.length || fields.some(f => !memoryFields.includes(f)) || new Set(fields).size !== fields.length) throw Error('FIELD_SCOPE_REQUIRED'); },
            bind(identity, intent) { draft.bindRun({ runId: identity.id, taskId: identity.taskId, target: identity.target, allowedFields: intent.fields, previousArtifact: intent.artifact }); },
            publish(app, id, intent) { if (!intent.candidateId) return 'NO_CANDIDATE'; const a = draft.publishDraft(app, id, intent.candidateId); draft.validateSaved(app, a.id, a.revision); return null; },
        },
    };
    for (const task of Object.values(tasks)) task.tools = task.module ? [...shared, ...task.module.registry.list().map(d => d.id)] : registry.list().map(d => d.id);
    tasks.chat.tools.push(...permission.registry.list().map(d => d.id));
    return { registry, handlers, tasks, bindBudget: (id, limit) => providers.bindRun(id, limit), resourceUsage: id => providers.usage(id), revalidate: (app, id, revision) => (app.getArtifact(id).content.module === 'settings-config' ? settings : draft).validateSaved(app, id, revision), forgetRun: id => { unified.delete(id); modules.forEach(m => m.forgetRun(id)); }, dispose: () => { unified.clear(); modules.forEach(m => m.dispose()); } };
}
