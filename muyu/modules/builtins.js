import { createToolboxModule } from './toolbox.js';
import { createSkillModule } from './skills/index.js';
import { createSkillRuntimeModule } from './skills/runtime.js';
import { createSelectionEditorModule } from './selection-editor/index.js';
import { createLedgerEditorModule } from './ledger-editor/index.js';
import { createStPresetModule } from './st-preset-editor/index.js';
import { createCharacterCardModule } from './character-card/index.js';
import { createWorldBookEditorModule } from './worldbook-editor/index.js';
import { createBlueprintNodeEditorModule } from './blueprint-node-editor/index.js';
import { createNpcEditorModule } from './npc-editor/index.js';
import { createProfileEditorModule } from './profile-editor/index.js';
import { createMemoryEditorModule } from './memory-editor/index.js';
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
import { createVariableEditorModule } from './variable-editor/index.js';
import { createVariableDraftModule } from './variables/index.js';
import { createTaskBundleModule } from './task-bundle/index.js';
import { createProfileDraftModule } from './profile-draft/index.js';
import { createBlueprintLibraryChatModule } from './blueprint-library-chat/index.js';
import { createNpcLibraryChatModule } from './npc-library-chat/index.js';
import { createProfileLibraryChatModule } from './profile-library-chat/index.js';
import { createBlueprintLibraryModule } from './blueprint-libraries/index.js';
import { createNpcLibraryModule } from './npc-libraries/index.js';
import { createProfileLibraryModule } from './profile-libraries/index.js';
import { createCustomPromptModule } from './custom-prompts/index.js';
import { createGenerationBatchModule } from './generation-batch/index.js';
import { createNpcGenerationModule } from './npc-generation/index.js';
import { createProfileGenerationModule } from './profile-generation/index.js';
import { createMemoryGenerationModule } from './memory-generation/index.js';
import { createCustomAgentModule } from './custom-agents/index.js';
import { createScriptExecutorModule } from './script-executors/index.js';
import { createProviderAssetModule } from './provider-assets/index.js';
import { createHistoryModule } from './history/index.js';
import { createWebSearchModule } from './web/index.js';
import { createAgentMemoryModule } from './agent-memory/index.js';
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
    const settings = createSettingsModule({ getSettings: host.getSettings, getTarget: host.configTarget, memoryLimitPort: host.memoryLimitPort, completionVariablePort: host.completionVariablePort, blueprintTogglePort: host.blueprintTogglePort });
    const context = createContextModule(), history = createHistoryModule({ access: host.historyAccess, budget: host.historyReadBudget }), providers = createProviderModule(host), interaction = createInteractionModule(), permission = createPermissionModule(), taskPlan = createTaskPlanModule();
    const variablePort = host.variableDraftPort || createVariableDraftPort(host.memoryPorts);
    const variableEditor = createVariableEditorModule({port:host.variableEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const variables = createVariableDraftModule({ port: variablePort });
    const bundle = createTaskBundleModule({ port: host.bundleDraftPort || createTaskBundleDraftPort({ getTarget: host.currentTarget, getSettings: host.getSettings, variableDraftPort: variablePort, scriptPort: host.scriptExecutors }) });
    const profiles = createProfileDraftModule(), web = createWebSearchModule();
    const notes = createAgentMemoryModule({ port: host.agentMemory, budget: id => providers.usage(id).limit, used: id => providers.usage(id).used, charge: (id, bytes) => providers.charge(id, bytes) });
    const providerAssets = createProviderAssetModule({ port: host.providerAssets, charge: (id, bytes) => providers.charge(id, bytes) });
    const scripts = createScriptExecutorModule({ port: host.scriptExecutors, charge: (id, bytes) => providers.charge(id, bytes) });
    const generationBatch = createGenerationBatchModule({ port: host.generationBatch, charge: (id, bytes) => providers.charge(id, bytes) });
    const npcGeneration = createNpcGenerationModule({ port: host.npcGeneration, charge: (id, bytes) => providers.charge(id, bytes) });
    const profileGeneration = createProfileGenerationModule({ port: host.profileGeneration, charge: (id, bytes) => providers.charge(id, bytes) });
    const memoryGeneration = createMemoryGenerationModule({ port: host.memoryGeneration, charge: (id, bytes) => providers.charge(id, bytes) });
    const customAgents = createCustomAgentModule({ port: host.customAgents, charge: (id, bytes) => providers.charge(id, bytes) });
    const toolbox = createToolboxModule();
    const skills = createSkillModule({ port: host.skills, charge: (id, bytes) => providers.charge(id, bytes) });
    const skillRuntime = createSkillRuntimeModule({ port: host.skills, charge: (id, bytes) => providers.charge(id, bytes) });
    const customPrompts = createCustomPromptModule({ port: host.customPrompts, charge: (id, bytes) => providers.charge(id, bytes) });
    const profileLibraries = createProfileLibraryModule({ port: host.profileLibraries, charge: (id, bytes) => providers.charge(id, bytes) });
    const profileLibraryChat = createProfileLibraryChatModule({ port: host.profileLibraryChat });
    const npcLibraries = createNpcLibraryModule({ port: host.npcLibraries, charge: (id, bytes) => providers.charge(id, bytes) });
    const blueprintLibraryChat = createBlueprintLibraryChatModule({ port: host.blueprintLibraryChat });
    const npcLibraryChat = createNpcLibraryChatModule({ port: host.npcLibraryChat });
    const blueprintLibraries = createBlueprintLibraryModule({ port: host.blueprintLibraries, charge: (id, bytes) => providers.charge(id, bytes) });
    const memoryEditor = createMemoryEditorModule({port:host.memoryEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const profileEditor = createProfileEditorModule({port:host.profileEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const npcEditor = createNpcEditorModule({port:host.npcEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const selectionEditor = createSelectionEditorModule({port:host.selectionEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const ledgerEditor = createLedgerEditorModule({port:host.ledgerEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const stPresetEditor = createStPresetModule({port:host.stPresetEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const characterCards = createCharacterCardModule({port:host.characterCards,charge:(id,bytes)=>providers.charge(id,bytes)});
    const worldBookEditor = createWorldBookEditorModule({port:host.worldBookEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const blueprintNodeEditor = createBlueprintNodeEditorModule({port:host.blueprintNodeEditor,charge:(id,bytes)=>providers.charge(id,bytes)});
    const modules = [toolbox, generationBatch, npcGeneration, profileGeneration, memoryGeneration, selectionEditor, ledgerEditor, characterCards, stPresetEditor, worldBookEditor, blueprintNodeEditor, npcEditor, profileEditor, memoryEditor, variableEditor, blueprintLibraries, npcLibraryChat, blueprintLibraryChat, npcLibraries, profileLibraryChat, profileLibraries, skills, customPrompts, customAgents, scripts, memory, draft, director, context, history, providers, interaction, permission, settings, taskPlan, variables, bundle, profiles, web, notes, providerAssets];
    const unified = new Map();
    modules.push(skillRuntime);
    const legacyPreview = (args, ctx) => {
        const run = unified.get(ctx.runId);
        if (run && !run.bound) {
            draft.bindRun({ runId: ctx.runId, taskId: run.identity.taskId, target: ctx.target, allowedFields: memoryFields, previousArtifact: run.intent.artifact });
            run.bound = true;
        }
        return draft.handlers['muyu.config.preview'](args, ctx);
    };
    const entries = [
        { id: 'toolbox', module: toolbox },
        ...(host.generationBatch ? [{ id: 'generation-batch', module: generationBatch }] : []),
        ...(host.npcGeneration ? [{ id: 'npc-generation', module: npcGeneration }] : []),
        ...(host.profileGeneration ? [{ id: 'profile-generation', module: profileGeneration }] : []),
        ...(host.memoryGeneration ? [{ id: 'memory-generation', module: memoryGeneration }] : []),
        ...(host.selectionEditor ? [{id:'selection-editor',module:selectionEditor}] : []),
        ...(host.ledgerEditor ? [{id:'ledger-editor',module:ledgerEditor}] : []),
        ...(host.stPresetEditor ? [{id:'st-preset-editor',module:stPresetEditor}] : []),
        ...(host.characterCards ? [{id:'character-card',module:characterCards}] : []),
        ...(host.worldBookEditor ? [{id:'worldbook-editor',module:worldBookEditor}] : []),
        ...(host.blueprintNodeEditor ? [{id:'blueprint-node-editor',module:blueprintNodeEditor}] : []),
        ...(host.npcEditor ? [{id:'npc-editor',module:npcEditor}] : []),
        ...(host.profileEditor ? [{id:'profile-editor',module:profileEditor}] : []),
        ...(host.memoryEditor ? [{id:'memory-editor',module:memoryEditor}] : []),
        ...(host.variableEditor ? [{id:'variable-editor',module:variableEditor}] : []),
        { id: 'memory', module: memory },
        { id: 'legacy-draft', module: { registry: draft.registry, handlers: { ...draft.handlers, 'muyu.config.preview': legacyPreview } } },
        { id: 'director', module: director }, { id: 'context', module: context }, { id: 'history', module: history },
        { id: 'providers', module: providers }, { id: 'interaction', module: interaction },
        { id: 'permission', module: permission }, { id: 'settings', module: settings }, { id: 'task-plan', module: taskPlan }, { id: 'variables', module: variables },
        { id: 'task-bundle', module: bundle },
        { id: 'profile-draft', module: profiles },
        ...(host.blueprintLibraryChat ? [{ id: 'blueprint-library-chat', module: blueprintLibraryChat }] : []),
        ...(host.npcLibraryChat ? [{ id: 'npc-library-chat', module: npcLibraryChat }] : []),
        ...(host.profileLibraryChat ? [{ id: 'profile-library-chat', module: profileLibraryChat }] : []),
        ...(host.blueprintLibraries ? [{ id: 'blueprint-libraries', module: blueprintLibraries }] : []),
        ...(host.npcLibraries ? [{ id: 'npc-libraries', module: npcLibraries }] : []),
        ...(host.profileLibraries ? [{ id: 'profile-libraries', module: profileLibraries }] : []),
        ...(host.skills ? [{ id: 'skills', module: skills }] : []),
        ...(host.skills?.catalog ? [{ id: 'skill-runtime', module: skillRuntime }] : []),
        ...(host.customPrompts ? [{ id: 'custom-prompts', module: customPrompts }] : []),
        ...(host.customAgents ? [{ id: 'custom-agents', module: customAgents }] : []),
        ...(host.scriptExecutors ? [{ id: 'script-executors', module: scripts }] : []),
        ...(host.providerAssets ? [{ id: 'provider-assets', module: providerAssets }] : []),
        { id: 'web', module: web },
        { id: 'agent-memory', module: notes },
    ];
    const labels = Object.fromEntries(Object.entries(toolLabels).filter(([id]) => (host.generationBatch || !generationBatch.registry.list().some(tool => tool.id === id)) && (host.npcGeneration || !npcGeneration.registry.list().some(tool => tool.id === id)) && (host.profileGeneration || !profileGeneration.registry.list().some(tool => tool.id === id)) && (host.memoryGeneration || !memoryGeneration.registry.list().some(tool => tool.id === id)) && (host.selectionEditor || !selectionEditor.registry.list().some(tool=>tool.id===id)) && (host.stPresetEditor || !stPresetEditor.registry.list().some(tool=>tool.id===id)) && (host.characterCards || !characterCards.registry.list().some(tool=>tool.id===id)) && (host.worldBookEditor || !worldBookEditor.registry.list().some(tool=>tool.id===id)) && (host.ledgerEditor || !ledgerEditor.registry.list().some(tool=>tool.id===id)) && (host.blueprintNodeEditor || !blueprintNodeEditor.registry.list().some(tool=>tool.id===id)) && (host.npcEditor || !npcEditor.registry.list().some(tool=>tool.id===id)) && (host.profileEditor || !profileEditor.registry.list().some(tool=>tool.id===id)) && (host.memoryEditor || !memoryEditor.registry.list().some(tool=>tool.id===id)) && (host.variableEditor || !variableEditor.registry.list().some(tool=>tool.id===id)) && (host.blueprintLibraryChat || !blueprintLibraryChat.registry.list().some(tool => tool.id === id)) && (host.blueprintLibraries || !blueprintLibraries.registry.list().some(tool => tool.id === id)) && (host.npcLibraryChat || !npcLibraryChat.registry.list().some(tool => tool.id === id)) && (host.npcLibraries || !npcLibraries.registry.list().some(tool => tool.id === id)) && (host.profileLibraryChat || !profileLibraryChat.registry.list().some(tool => tool.id === id)) && (host.profileLibraries || !profileLibraries.registry.list().some(tool => tool.id === id)) && (host.skills || !skills.registry.list().some(tool => tool.id === id)) && (host.customPrompts || !customPrompts.registry.list().some(tool => tool.id === id)) && (host.customAgents || !customAgents.registry.list().some(tool => tool.id === id)) && (host.providerAssets || !providerAssets.registry.list().some(tool => tool.id === id)) && (host.scriptExecutors || !scripts.registry.list().some(tool => tool.id === id))));
    if (!host.skills?.catalog) for (const definition of skillRuntime.registry.list()) delete labels[definition.id];
    const { registry, handlers } = createToolPlan(entries, { capabilityFor: toolCapability, labels });
    const artifacts = createArtifactOwners([
        {toolId:'muyu.selection.preview',moduleId:'selection-editor',owner:selectionEditor},
        {toolId:'muyu.ledger_editor.preview',moduleId:'ledger-editor',owner:ledgerEditor},
        {toolId:'muyu.st_preset.preview',moduleId:'st-preset-editor',owner:stPresetEditor},
        {toolId:'muyu.character_card.preview',moduleId:'character-card',owner:characterCards},
        {toolId:'muyu.worldbook_editor.preview',moduleId:'worldbook-editor',owner:worldBookEditor},
        ...['muyu.blueprint_node_editor.preview','muyu.blueprint_node_editor.structure_preview','muyu.blueprint_node_editor.initialize_preview'].map(toolId=>({toolId,moduleId:'blueprint-node-editor',owner:blueprintNodeEditor})),
        {toolId:'muyu.npc_editor.preview',moduleId:'npc-editor',owner:npcEditor},
        {toolId:'muyu.npc_editor.create_preview',moduleId:'npc-editor',owner:npcEditor},
        {toolId:'muyu.profile_editor.preview',moduleId:'profile-editor',owner:profileEditor},
        {toolId:'muyu.profile_editor.create_preview',moduleId:'profile-editor',owner:profileEditor},
        {toolId:'muyu.memory_editor.preview',moduleId:'memory-editor',owner:memoryEditor},
        {toolId:'muyu.memory_editor.create_preview',moduleId:'memory-editor',owner:memoryEditor},
        {toolId:'muyu.variable_editor.preview',moduleId:'variable-editor',owner:variableEditor},
        ...['muyu.blueprint_library_chat.capture_preview', 'muyu.blueprint_library_chat.apply_preview'].map(toolId => ({ toolId, moduleId: 'blueprint-library-chat', owner: blueprintLibraryChat })),
        ...['muyu.npc_library_chat.capture_preview', 'muyu.npc_library_chat.apply_preview'].map(toolId => ({ toolId, moduleId: 'npc-library-chat', owner: npcLibraryChat })),
        ...['muyu.library_chat.capture_preview', 'muyu.library_chat.apply_preview'].map(toolId => ({ toolId, moduleId: 'profile-library-chat', owner: profileLibraryChat })),
        { toolId: 'muyu.blueprint_libraries.preview', moduleId: 'blueprint-library', owner: blueprintLibraries },
        { toolId: 'muyu.npc_libraries.preview', moduleId: 'npc-library', owner: npcLibraries },
        { toolId: 'muyu.libraries.preview', moduleId: 'profile-library', owner: profileLibraries },
        { toolId: 'muyu.prompts.batch_preview', moduleId: 'custom-prompt', owner: customPrompts },
        { toolId: 'muyu.prompts.import_preview', moduleId: 'custom-prompt', owner: customPrompts },
        { toolId: 'muyu.skills.preview', moduleId: 'skill', owner: skills },
        { toolId: 'muyu.prompts.preview', moduleId: 'custom-prompt', owner: customPrompts },
        { toolId: 'muyu.agents.preview', moduleId: 'custom-agent', owner: customAgents },
        { toolId: 'muyu.agents.batch_preview', moduleId: 'custom-agent', owner: customAgents },
        { toolId: 'muyu.agents.import_preview', moduleId: 'custom-agent', owner: customAgents },
        { toolId: 'muyu.scripts.preview', moduleId: 'script-executor', owner: scripts },
        { toolId: 'muyu.config.preview', moduleId: 'memory-config', owner: draft },
        { toolId: 'muyu.settings.preview', moduleId: 'settings-config', owner: settings },
        { toolId: 'muyu.task.plan', moduleId: 'task-plan', owner: taskPlan },
        { toolId: 'muyu.variables.preview', moduleId: 'variable-draft', owner: variables },
        { toolId: 'muyu.task.preview', moduleId: 'task-bundle', owner: bundle },
        { toolId: 'muyu.profile.preview', moduleId: 'generated-profile', owner: profiles },
        { toolId: 'muyu.provider.preview', moduleId: 'provider-asset', owner: providerAssets },
        { toolId: 'muyu.provider.update_preview', moduleId: 'provider-asset', owner: providerAssets },
        { toolId: 'muyu.provider.remove_preview', moduleId: 'provider-asset', owner: providerAssets },
    ]);
    const shared = [...context.registry.list(), ...interaction.registry.list()].map(d => d.id);
    const tasks = {
        assistant: { module: null,
            bind(identity, intent) { unified.set(identity.id, { identity, intent, bound: false }); selectionEditor.bindRun(identity); ledgerEditor.bindRun(identity); characterCards.bindRun(identity); stPresetEditor.bindRun(identity); worldBookEditor.bindRun(identity); blueprintNodeEditor.bindRun(identity); npcEditor.bindRun(identity); profileEditor.bindRun(identity); memoryEditor.bindRun(identity); settings.bindRun(identity); taskPlan.bindRun(identity); variables.bindRun(identity); variableEditor.bindRun(identity); bundle.bindRun(identity); profiles.bindRun(identity); providerAssets.bindRun(identity); scripts.bindRun(identity); customAgents.bindRun(identity); generationBatch.bindRun(identity); npcGeneration.bindRun(identity); profileGeneration.bindRun(identity); memoryGeneration.bindRun(identity); customPrompts.bindRun(identity); skills.bindRun(identity); profileLibraries.bindRun(identity); npcLibraries.bindRun(identity); blueprintLibraries.bindRun(identity); profileLibraryChat.bindRun(identity); npcLibraryChat.bindRun(identity); blueprintLibraryChat.bindRun(identity); web.bindRun(identity, intent); notes.bindRun(identity, intent); },
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
    const bindAssistant = tasks.assistant.bind;
    tasks.assistant.bind = (identity, intent) => { bindAssistant(identity, intent); if (host.skills?.catalog) skillRuntime.bindRun(identity, intent.selectedSkill); };
    tasks.chat.tools.push(...permission.registry.list().map(d => d.id));
    return { registry, handlers, tasks, candidateTool: artifacts.produces, candidateGroup: artifacts.group, invalidateSettingsAttempt: (id, fields) => settings.invalidateAttempt(id, fields), takeInvalidatedSettingsCandidates: id => settings.takeInvalidatedCandidates(id),
        skillGuides: id => host.skills?.catalog ? { prepare: signal => skillRuntime.prepare(id, signal), project: () => skillRuntime.project(id) } : null,
        skillUsage: id => { try { return skillRuntime.usage(id); } catch { return []; } },
        parkSkillRun: (id, artifact) => host.skills?.catalog ? skillRuntime.parkRun(id, artifact) : true,
        forgetSkillTask: id => skillRuntime.forgetTask(id),
        transferRun(from, identity, intent) { const previous = unified.get(from); if (previous) { unified.delete(from); unified.set(identity.id, { ...previous, identity, intent }); } for (const module of modules) if (module !== providers) module.transferRun?.(from, identity); },
        bindBudget: (id, limit, from = null) => from ? providers.transferRun(from, id, limit) : providers.bindRun(id, limit),
        retainArtifacts: values => modules.forEach(m => m.retainArtifacts?.(values)),
        resourceUsage: id => providers.usage(id), revalidate: artifacts.revalidate, forgetTask: id => { skillRuntime.forgetTask(id); web.forgetTask(id); scripts.forgetTask(id); customAgents.forgetTask(id); generationBatch.forgetTask(id); npcGeneration.forgetTask(id); profileGeneration.forgetTask(id); memoryGeneration.forgetTask(id); }, forgetRun: id => { unified.delete(id); modules.forEach(m => m.forgetRun(id)); }, dispose: () => { unified.clear(); modules.forEach(m => m.dispose()); } };
}
