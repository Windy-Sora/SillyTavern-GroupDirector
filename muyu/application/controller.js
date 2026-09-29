import { jsonKey } from '../core/json-contract.js';
import { createApplication } from './service.js';
import { createConfigActions } from '../actions/config-apply.js';
import { createVariableActions } from '../actions/variable-apply.js';
import { createTaskBundleActions } from '../actions/task-bundle-apply.js';
import { createProfileActions } from '../actions/profile-save.js';
import { sourcePermission } from '../modules/providers/catalog.js';
import { checkReceiptConfig } from './config-check.js';
import { assistantToolAccess, permissionApprovalCurrent, permissionRequestAllowed, permissionRequestAlreadyGranted, toolAvailableInMode } from './capabilities.js';
import { actionReceipt, receiptStatuses, receiptSources } from '../actions/receipts.js';
import { startMuyuRun } from '../composition.js';
import { createChatCompletionsModel } from '../model/chat-completions.js';
import { createBuiltins } from '../modules/builtins.js';
import { taskCatalog } from '../modules/catalog.js';
import { createPermissions } from './permissions.js';
import { RUN_DEFAULTS, validateRunConfig } from '../core/budget.js';
import { createSessionLibrary } from '../sessions/library.js';
import { historyScope } from '../sessions/contract.js';
import { importPreview } from '../sessions/exchange.js';
import { CONTEXT_DEFAULTS, validateContextConfig } from '../context/policy.js';
import { planContext, summaryCandidate, usableSummary, fingerprint } from '../context/planner.js';
import { INSTRUCTION_DEFAULTS, validateInstructionConfig, validateInstructionDraft } from '../instructions/contract.js';
import { composeInstructions, composeReceiptInstructions } from '../instructions/compose.js';
import { CLARIFICATION_TOOL, MAX_CLARIFICATIONS, describeAnswer } from '../interactions/contract.js';
import { PERMISSION_TOOL, MAX_INTERACTIONS, permissionSources, permissionSource, sourceKey, permissionAnswer } from '../permissions/contract.js';

/** Lifetime is the extension instance, not a DOM panel. Grants belong to a connection/chat. */
export function createMuyuController({ host, createModel = createChatCompletionsModel }) {
    let app, builtins, model, connection = null, running, appUnsubscribe, disposed = false, resetting = false;
    let mode = 'assistant', error = null, pinnedTarget = null, fullAccess = false;
    let runConfig = host.runConfig?.read() || { ...RUN_DEFAULTS }, savingRunConfig = false;
    let contextConfig = host.contextConfig?.read() || { ...CONTEXT_DEFAULTS }, savingContextConfig = false, compacting = null;
    const omittedViews = new Set();
    const compactResults = new Map();
    let instructionConfig = host.instructionConfig?.read() || { ...INSTRUCTION_DEFAULTS }, instructionDraft = { ...instructionConfig }, savingInstructions = false;
    const permissions = createPermissions({ fullAccess: () => fullAccess });
    const requiredPermission = () => mode === 'chat' ? 'chat' : 'diagnostics';
    const category = definition => definition.dataClasses.includes('public-knowledge') ? 'public' : definition.dataClasses.includes('chat-content') ? 'chat' : 'diagnostics';
    const listeners = new Set(), sessions = new Map(), inputs = new Map(), intentions = new Map(), notices = new Map();
    const runtimeSessions = new Map();
    const continuations = new Map();
    const releaseContinuation = taskId => { const pending = continuations.get(taskId); if (pending) { continuations.delete(taskId); builtins?.forgetRun(pending.sourceRunId); } };
    const configChecks = new Map(), autoConfigChecks = [];
    let checking = null;
    let selectionEpoch = 0, viewedId = null, viewSequence = 0;
    let historyFilters = { range: 'current', archive: 'active', task: '', query: '' };
    const scrollPositions = new Map();
    const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* Detached views cannot control tasks. */ } } };
    const live = () => { if (disposed) throw new Error('CONTROLLER_DISPOSED'); };
    const recordedActions = new Map(), explanations = new Map(), actionOwners = new Map(), approvedPlans = new Set(), declinedPlans = new Set(), invalidPlans = new Set();
    const autoActions = [], autoPlans = [];
    const actionChanged = () => { captureReceipts(); emit(); queueMicrotask(flushAutoActions); queueMicrotask(flushAutoConfigChecks); };
    const actions = createConfigActions({ getArtifact: id => app.getArtifact(id), validate: (id, revision) => builtins.revalidate(app, id, revision), getTarget: () => host.globalTarget, writer: host.configWriter, changed: actionChanged });
    const variableActions = createVariableActions({ getArtifact: id => app.getArtifact(id), validate: (id, revision) => builtins.revalidate(app, id, revision), getTarget: () => host.currentTarget(), writer: host.variableWriter, changed: actionChanged });
    const bundleActions = createTaskBundleActions({ getArtifact: id => app.getArtifact(id), validate: (id, revision) => builtins.revalidate(app, id, revision), getTarget: () => host.currentTarget(), writer: host.bundleWriter, changed: actionChanged });
    const profileActions = createProfileActions({ getArtifact: id => app.getArtifact(id), validate: (id, revision) => builtins.revalidate(app, id, revision), getTarget: () => host.globalTarget, writer: host.profileWriter, changed: actionChanged });
    function flushAutoActions() {
        if (!fullAccess || !app || resetting || disposed || checking || app.snapshot().runs.some(r => ['queued', 'running', 'cancelling'].includes(r.status)) || actions.busy || variableActions.busy || bundleActions.busy || profileActions.busy) return;
        const plan = autoPlans.shift();
        if (plan) {
            try { api.approveTaskPlanReads(plan.id, plan.revision); }
            catch { notices.set(plan.sessionId, 'RESULT_NEEDS_REVIEW'); emit(); }
            return;
        }
        const next = autoActions.shift();
        if (!next) return;
        try {
            const artifact = app.getArtifact(next.id);
            if (artifact.revision !== next.revision || artifact.sessionId !== next.sessionId || artifact.kind !== next.kind ||
                jsonKey(next.target) !== jsonKey(['config-draft', 'profile-draft'].includes(next.kind) ? host.globalTarget : host.currentTarget())) throw Error('ACTION_STALE');
            const coordinator = next.kind === 'config-draft' ? actions : next.kind === 'variable-draft' ? variableActions : next.kind === 'profile-draft' ? profileActions : bundleActions;
            const record = coordinator.prepare(next.id, next.revision);
            actionOwners.set(record.id, next.owner);
            void coordinator.approve(record.id).then(() => queueMicrotask(flushAutoActions));
        } catch { notices.set(next.sessionId, 'RESULT_NEEDS_REVIEW'); emit(); queueMicrotask(flushAutoActions); }
    }
    const targetFor = () => mode === 'assistant' ? pinnedTarget || host.currentTarget() || host.globalTarget : taskCatalog[mode].scope === 'chat' ? host.currentTarget() : host.globalTarget;
    const receiptAllowed = (receipt, target) => mode !== 'assistant' ? permissions.allows('diagnostics', target) : receiptSources(receipt).every(source => {
        const scoped = ['source:memoryDiagnostics', 'source:variables'].includes(source) ? host.currentTarget() : target;
        return (!receipt.memoryPrune || source !== 'source:memoryDiagnostics' || scoped?.chatKey === receipt.memoryPrune.chatKey) && permissions.allows(source, scoped);
    });
    const configAllowed = (target, taskId = null) => {
        if (mode !== 'assistant') return permissions.allows('diagnostics', target, taskId);
        const receipts = receiptsFor(selectedId());
        const sources = receipts.length ? [...new Set(receipts.flatMap(receiptSources))] : ['source:memoryConfig'];
        return sources.every(source => permissions.allows(source, ['source:memoryDiagnostics', 'source:variables'].includes(source) ? host.currentTarget() : target, taskId));
    };
    const scopeKey = () => historyScope(mode, targetFor());
    function historyChoice(record, key, target, continuation = null, taskId = null, explanation = false) {
        const missing = (record?.required || []).filter(kind => !permissions.allows(kind, target, taskId));
        const autoHistoryOmitted = mode === 'assistant' && !explanation && !omittedViews.has(key) && (!continuation || continuation.autoHistoryOmitted) && missing.length > 0;
        const historyStart = autoHistoryOmitted ? record.messages.length : continuation?.autoHistoryOmitted ? 0 : continuation?.historyStart ?? (omittedViews.has(key) ? record.messages.length : 0);
        return { missing, autoHistoryOmitted, historyStart, omitHistory: historyStart > 0 || !continuation && omittedViews.has(key) };
    }
    const selectedId = () => viewedId || sessions.get(scopeKey());
    const viewKey = () => mode + ':' + jsonKey(targetFor()) + ':' + (selectedId() || '');
    const library = createSessionLibrary({ port: host.history, changed: emit });
    const views = new Map();
    function captureReceipts() {
        for (const action of [...actions.list(), ...variableActions.list(), ...bundleActions.list(), ...profileActions.list()]) {
            const owner = actionOwners.get(action.id) || [...runtimeSessions].find(([, runtimeId]) => runtimeId === action.sessionId)?.[0];
            if (owner) actionOwners.set(action.id, owner);
            if (!receiptStatuses.includes(action.status) || recordedActions.has(action.id)) continue;
            const id = owner;
            if (!id) continue;
            const entry = { id, receipt: actionReceipt(action), failed: false };
            recordedActions.set(action.id, entry);
            try { library.recordReceipt(id, entry.receipt); } catch { entry.failed = true; }
            if (action.id.startsWith('apply:') && entry.receipt.version === 2 && entry.receipt.diff.length &&
                !entry.receipt.memoryPrune && !entry.receipt.completionVariable &&
                ['applied_confirmed', 'applied_unconfirmed', 'outcome_unknown'].includes(entry.receipt.status)) {
                autoConfigChecks.push({ owner: id, receipt: entry.receipt, target: action.target });
            }
        }
    }
    function runConfigCheck(owner, receipt, target, allowed) {
        const abort = new AbortController(), job = { id: receipt.operationId, abort, promise: null };
        checking = job;
        configChecks.set(receipt.operationId, { state: 'reading', fields: [], readAt: '', persistence: 'unknown' });
        const work = checkReceiptConfig({ builtins, target, receipt, limit: runConfig.providerBytes, signal: abort.signal,
            allowed: () => !disposed && !resetting && !abort.signal.aborted && !!library.get(owner) && allowed(),
        }).then(result => { configChecks.set(receipt.operationId, result); }, () => {
            configChecks.set(receipt.operationId, { state: 'unknown', fields: [], readAt: '', persistence: 'unknown' });
        });
        job.promise = work.finally(() => { if (checking === job) checking = null; emit(); queueMicrotask(flushAutoConfigChecks); queueMicrotask(flushAutoActions); });
        emit();
        return job.promise;
    }
    function flushAutoConfigChecks() {
        if (!autoConfigChecks.length || !app || disposed || resetting || checking || actions.busy || autoActions.length) return;
        const { owner, receipt, target } = autoConfigChecks.shift();
        const record = library.get(owner);
        if (!record || record.imported || record.archived || jsonKey(target) !== jsonKey(host.globalTarget)) return queueMicrotask(flushAutoConfigChecks);
        const allowed = () => receiptSources(receipt).every(source => permissions.allows(source, target));
        if (!allowed()) {
            configChecks.set(receipt.operationId, { state: 'permission_required', fields: [], readAt: '', persistence: 'unknown' });
            emit(); queueMicrotask(flushAutoConfigChecks); return;
        }
        void runConfigCheck(owner, receipt, target, allowed);
    }
    function receiptsFor(id) {
        const receipts = new Map((library.get(id)?.receipts || []).map(r => [r.operationId, r]));
        for (const entry of recordedActions.values()) if (entry.id === id) receipts.set(entry.receipt.operationId, entry.receipt);
        return structuredClone([...receipts.values()]);
    }
    function unloadRuntime(sessionId) {
        const ownedTasks = app.snapshot().tasks.filter(t => t.sessionId === sessionId).map(t => t.id);
        app.unloadSession(sessionId);
        for (const id of ownedTasks) { releaseContinuation(id); permissions.forgetTask(null, id); }
    }
    function syncTarget(changed = true) { selectionEpoch++; if (changed) { viewedId = null; pinnedTarget = null; } if (compacting?.target.kind === 'chat' && jsonKey(compacting.target) !== jsonKey(host.currentTarget())) running?.cancel(); if (app) { app.changeTarget(host.currentTarget()); for (const [taskId, pending] of continuations) { const run = app.snapshot().runs.find(row => row.id === pending.sourceRunId); if (run?.target.kind === 'chat' && jsonKey(run.target) !== jsonKey(host.currentTarget())) { releaseContinuation(taskId); permissions.forgetTask(run.target, taskId); } } } emit(); }
    function readOnly(record) {
        if (!record) return false;
        const [task, kind] = JSON.parse(record.scope);
        if (task !== 'assistant' && mode === 'assistant') return true;
        return record.imported || record.archived || record.scope !== historyScope(task, kind === 'global' ? host.globalTarget : host.currentTarget());
    }
    async function openSession(id, strict = false) {
        live(); if (resetting) throw Error('NOT_READY');
        const scope = scopeKey(), epoch = ++selectionEpoch;
        const record = await library.load(id, strict ? scope : undefined); live();
        if (epoch !== selectionEpoch) return;
        const [task, kind] = JSON.parse(record.scope);
        if (mode === 'assistant' && task !== 'assistant') { viewedId = id; }
        else if (record.scope === historyScope(task, kind === 'global' ? host.globalTarget : host.currentTarget())) {
            mode = task; pinnedTarget = kind === 'global' ? host.globalTarget : host.currentTarget(); viewedId = null; sessions.set(record.scope, id);
        } else { viewedId = id; }
        emit();
    }
    async function manageSession(id, action, value) {
        live(); if (resetting || checking || actions.busy || variableActions.busy || bundleActions.busy || profileActions.busy || !library.meta(id)) throw Error('NOT_READY');
        if (action !== 'rename') { actions.invalidate(); variableActions.invalidate(); bundleActions.invalidate(); profileActions.invalidate(); }
        resetting = true; selectionEpoch++; emit();
        try {
            const runtimeId = runtimeSessions.get(id);
            if (action !== 'rename' && compacting?.id === id) { running?.cancel(); await Promise.all([running.completion, running.drained]); }
            if (action !== 'rename' && runtimeId && app) {
                app.invalidateInteractions(runtimeId);
                const state = app.snapshot(), activeHere = state.runs.find(r => r.id === state.activeRunId)?.sessionId === runtimeId;
                for (const task of state.tasks.filter(row => row.sessionId === runtimeId)) { if (continuations.has(task.id)) { releaseContinuation(task.id); permissions.forgetTask(null, task.id); } }
                for (const run of state.runs) if (run.sessionId === runtimeId) app.cancel(run.id);
                if (activeHere && running) await Promise.all([running.completion, running.drained]);
                live(); capture();
            }
            if (action === 'remove') {
                await library.remove(id); live();
                for (const [key, entry] of recordedActions) if (entry.id === id) { recordedActions.delete(key); explanations.delete(key); }
                compactResults.delete(id);
                if (runtimeId) { unloadRuntime(runtimeId); runtimeSessions.delete(id); notices.delete(runtimeId); }
                for (const [key, selected] of sessions) if (selected === id) sessions.delete(key);
                if (viewedId === id) viewedId = null;
                for (const key of inputs.keys()) if (key.endsWith(':' + id)) inputs.delete(key);
                for (const key of scrollPositions.keys()) if (key.endsWith(':' + id)) scrollPositions.delete(key);
                for (const key of views.keys()) if (key.endsWith(':' + id)) views.delete(key);
            } else if (action === 'rename') await library.rename(id, value);
            else await library.archive(id, value);
        } finally { resetting = false; emit(); }
    }
    function capture() {
        if (!app) return;
        const state = app.snapshot();
        for (const [id, runtimeId] of runtimeSessions) {
            const session = state.sessions.find(s => s.id === runtimeId), record = library.get(id);
            if (!session || !record) continue;
            const latest = state.runs.filter(r => r.sessionId === runtimeId).at(-1);
            // Persist the question as text, never a resumable request or authorization.
            const status = latest ? latest.status === 'yielded' ? 'interrupted' : ['queued', 'cancelling', 'running'].includes(latest.status) ? 'running' : latest.status : record.status;
            if (JSON.stringify(record.messages) !== JSON.stringify(session.messages) || record.status !== status) library.update(id, { messages: session.messages, status });
        }
    }
    function historyAccess(runId, target) {
        const intent = intentions.get(runId);
        if (!intent || intent.mode !== 'assistant' || intent.explanation || intent.historyStart !== 0 || intent.autoHistoryOmitted ||
            selectedId() !== intent.historyId || jsonKey(targetFor()) !== jsonKey(target) || !intent.sourceMessages?.length) return null;
        const current = library.get(intent.historyId);
        if (!current || readOnly(current) || current.scope !== historyScope('assistant', target) ||
            current.required.some(source => !permissions.allows(source, target, app.snapshot().runs.find(run => run.id === runId)?.taskId)) ||
            fingerprint(current.messages.slice(0, intent.sourceMessages.length)) !== fingerprint(intent.sourceMessages)) return null;
        return intent.sourceMessages;
    }
    function snapshot() {
        const id = selectedId(), state = app?.snapshot(), sessionId = runtimeSessions.get(id), record = library.get(id);
        if (!views.has(viewKey())) views.set(viewKey(), ++viewSequence);
        const session = state?.sessions.find(s => s.id === sessionId);
        const isReadOnly = readOnly(record);
        const compactState = compacting?.id === id ? compacting : compactResults.get(id);
        const latestTaskId = state?.runs.filter(r => r.sessionId === sessionId).at(-1)?.taskId;
        const interaction = state?.interactions.filter(r => r.sessionId === sessionId && r.taskId === latestTaskId).at(-1) || null;
        const pending = interaction?.status === 'pending' ? continuations.get(interaction.taskId) : null;
        const choice = historyChoice(record, viewKey(), targetFor(), pending, pending ? interaction.taskId : null);
        const plan = planContext((record?.messages || []).slice(choice.historyStart), choice.omitHistory ? null : record?.contextSummary, contextConfig);
        const taskRuns = state?.runs.filter(r => r.taskId === latestTaskId) || [];
        const taskUsage = taskRuns.reduce((sum, run) => { const b = run.process?.budget; if (b) for (const k of ['modelCalls', 'toolCalls', 'inputTokens', 'outputTokens', 'elapsedMs']) sum[k] += b[k] || 0; return sum; }, { segments: taskRuns.length, modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0 });
        return { viewToken: views.get(viewKey()), viewKey: viewKey(), scrollTop: scrollPositions.get(viewKey()) ?? null, readOnly: isReadOnly,
            interaction: isReadOnly ? null : interaction, taskUsage,
            enabled: !!model, resetting, mode, fullAccess, targetKind: targetFor()?.kind, connection: connection && { ...connection }, input: isReadOnly ? '' : inputs.get(viewKey()) || '', hasChat: !!host.currentTarget(),
            permissions: permissions.snapshot(targetFor()), sourceGrants: permissions.sourceGrants(targetFor()), canReadConfig: configAllowed(targetFor()), canCheckReceipts: Object.fromEntries(receiptsFor(selectedId()).map(r => [r.operationId, receiptAllowed(r, host.globalTarget)])), savedConnection: host.credentials?.describe() || null,
            runConfig: { ...runConfig }, savingRunConfig,
            contextConfig: { ...contextConfig }, savingContextConfig,
            instructionSettings: { saved: { ...instructionConfig }, draft: { ...instructionDraft }, saving: savingInstructions, dirty: JSON.stringify(instructionConfig) !== JSON.stringify(instructionDraft) },
            context: { turns: plan.turns, omitted: plan.omitted + choice.historyStart, summaryUsed: plan.summaryUsed, estimatedTokens: plan.estimatedTokens, omitHistory: omittedViews.has(viewKey()), permissionOmitted: choice.autoHistoryOmitted, summary: record?.contextSummary?.text || '', summaryStale: !!record?.contextSummary && !usableSummary(record.contextSummary, record.messages), compacting: !!compacting && compacting.id === id, progress: compactState?.progress || null, usage: compactState?.usage || null },
            busy: !!checking || actions.busy || variableActions.busy || bundleActions.busy || profileActions.busy || !!compacting || !!state?.activeRunId || !!state?.runs.some(r => r.status === 'queued'), draining: !!compacting?.finished || !!state?.draining,
            occupiedElsewhere: !!compacting && compacting.id !== id || !!state?.activeRunId && state.runs.find(r => r.id === state.activeRunId)?.sessionId !== sessionId,
            messages: session?.messages || record?.messages || [], runs: state?.runs.filter(r => r.sessionId === sessionId) || [],
            history: { ...library.snapshot(scopeKey(), id, { ...historyFilters, chatKey: host.currentTarget()?.chatKey }), filters: { ...historyFilters }, restoredStatus: !session ? record?.status : null,
                missingPermissions: choice.missing,
                omitted: plan.omitted },
            artifacts: isReadOnly ? [] : state?.artifacts.filter(a => a.sessionId === sessionId) || [],
            approvedPlans: isReadOnly ? [] : [...approvedPlans],
            declinedPlans: isReadOnly ? [] : [...declinedPlans],
            invalidPlans: isReadOnly ? [] : [...invalidPlans],
            configActions: isReadOnly ? [] : actions.list().filter(a => a.sessionId === sessionId), canApplyConfig: !!host.configWriter,
            variableActions: isReadOnly ? [] : variableActions.list().filter(a => a.sessionId === sessionId), canApplyVariable: !!host.variableWriter,
            bundleActions: isReadOnly ? [] : bundleActions.list().filter(a => a.sessionId === sessionId), canApplyBundle: !!host.bundleWriter,
            profileActions: isReadOnly ? [] : profileActions.list().filter(a => a.sessionId === sessionId), canSaveProfile: !!host.profileWriter,
            receipts: receiptsFor(id), receiptRecordFailed: [...recordedActions.values()].some(e => e.id === id && e.failed),
            configChecks: Object.fromEntries(receiptsFor(id).filter(r => configChecks.has(r.operationId)).map(r => [r.operationId, structuredClone(configChecks.get(r.operationId))])),
            receiptExplanations: Object.fromEntries([...explanations].map(([key, runId]) => [key, state?.runs.find(r => r.id === runId)?.status || 'interrupted'])),
            notice: notices.get(sessionId) || null, error,
        };
    }
    function assemble() {
        actions.clear();
        variableActions.clear();
        bundleActions.clear();
        profileActions.clear();
        actionOwners.clear(); approvedPlans.clear(); declinedPlans.clear(); invalidPlans.clear();
        for (const [key, entry] of recordedActions) if (!entry.failed) recordedActions.delete(key);
        explanations.clear();
        configChecks.clear(); autoConfigChecks.length = 0;
        pinnedTarget = null;
        selectionEpoch++;
        viewedId = null;
        sessions.clear(); runtimeSessions.clear(); intentions.clear(); notices.clear(); continuations.clear();
        builtins = createBuiltins({ ...host, historyAccess });
        const { registry, handlers } = builtins;
        app = createApplication({ currentTarget: host.currentTarget(), maxSessions: 8, maxTasks: 1024, maxRuns: 1024, startRun: options => {
            const intent = intentions.get(options.identity.id);
            if (!intent) throw new Error('MISSING_INTENT');
            const currentTask = app.snapshot().tasks.find(t => t.id === options.identity.taskId);
            const clarificationCount = currentTask?.clarifications || 0, interactionCount = currentTask?.interactionCount || 0;
            const task = builtins.tasks[intent.mode], allowedTools = (intent.explanation ? [] : task.tools).filter(id =>
                toolAvailableInMode(id, intent.mode) &&
                (!id.startsWith('muyu.history.') || intent.mode === 'assistant' && (intent.contextPlan.omitted > 0 || intent.contextPlan.summaryUsed)) &&
                (id !== CLARIFICATION_TOOL || clarificationCount < MAX_CLARIFICATIONS && interactionCount < MAX_INTERACTIONS) &&
                (id !== PERMISSION_TOOL || interactionCount < MAX_INTERACTIONS) &&
                (intent.mode === 'assistant' || id === 'muyu.provider.read' || permissions.allows(category(registry.get(id)), options.identity.target)));
            const trimRecoveryTools = intent.mode === 'assistant' && !intent.explanation && intent.historyStart === 0 && !intent.autoHistoryOmitted && intent.sourceMessages.length &&
                !intent.contextPlan.omitted && !intent.contextPlan.summaryUsed ? task.tools.filter(id => id.startsWith('muyu.history.')) : [];
            const policyTools = new Set([...allowedTools, ...trimRecoveryTools, ...(options.resume?.toolIds || []).filter(id => id.startsWith('muyu.history.'))]);
            if (intent.resumeFrom) {
                const previous = app.snapshot().runs.find(row => row.id === intent.resumeFrom);
                if (previous?.status !== 'yielded' || previous.taskId !== options.identity.taskId || jsonKey(previous.target) !== jsonKey(options.identity.target)) throw Error('INVALID_RUN_TRANSFER');
                builtins.transferRun(intent.resumeFrom, options.identity, intent);
            } else if (!intent.explanation) task.bind?.(options.identity, intent);
            const config = intent.runConfig;
            builtins.bindBudget(options.identity.id, config.providerBytes, intent.resumeFrom);
            const handle = startMuyuRun({ ...options, model, registry, handlers, allowedTools, trimRecoveryTools,
                trimRecoveryNote: '部分历史原文已在发送前因上下文预算裁剪。需要具体原文时用本轮提供的 muyu.history.list/read 回读；否则说明缺口，不要猜测。',
                previousMessages: intent.contextPlan.messages, contextConfig: intent.contextConfig, compaction: intent.compaction,
                instructions: intent.instructions,
                applicationResults: intent.receipts,
                onSummary: summary => saveSummary(intent.historyId, intent.sourceMessages, summary, options.identity.target, options.identity.taskId),
                limits: { modelCalls: config.modelCalls, toolCalls: config.toolCalls, timeMs: config.timeMs }, maxTokens: config.maxTokens, finalizeOnLimit: true,
                resourceUsage: () => builtins.resourceUsage(options.identity.id),
                policy: ({ definition, target, args }) => {
                    if (!policyTools.has(definition.id)) return false;
                    if (intent.mode === 'assistant') {
                        const taskId = options.identity.taskId;
                        if (definition.id.startsWith('muyu.history.') && !historyAccess(options.identity.id, target)) return false;
                        if (['muyu.settings.preview', 'muyu.variables.preview', 'muyu.task.preview'].includes(definition.id) && args.apply === true && !fullAccess) return 'full_access_required';
                        if (definition.id === 'muyu.profile.preview' && args.save === true && !fullAccess) return 'full_access_required';
                        if (definition.id === PERMISSION_TOOL) return permissionRequestAllowed(args, target, taskId, permissions, host.providerPort) ? true
                            : permissionRequestAlreadyGranted(args, target, taskId, permissions, host.providerPort) ? 'permission_request_invalid' : false;
                        const access = assistantToolAccess(definition, args, target, taskId, permissions, host.providerPort);
                        if (access.decision !== true) return access;
                        if (access.required.length) {
                            const record = library.get(intent.historyId);
                            library.update(intent.historyId, { required: [...new Set([...record.required, ...access.required])] });
                        }
                        return true;
                    }
                    if (definition.id === PERMISSION_TOOL) return args.source !== 'providerExecution' && !permissions.denied(sourceKey(args.source), target, options.identity.taskId) && !permissions.allows(sourceKey(args.source), target, options.identity.taskId);
                    if (definition.id === 'muyu.provider.read') {
                        if (sourcePermission(args.id) === 'diagnostics') return permissions.allows('diagnostics', target);
                        const source = sourceKey(args.id);
                        if (permissions.allows(source, target, options.identity.taskId)) return true;
                        return permissionSources.includes(source) && !permissions.denied(source, target, options.identity.taskId) ? 'permission_required' : false;
                    }
                    return permissions.allows(category(definition), target);
                },
                onEvent: event => {
                    options.onEvent(event);
                    if (['tool.completed', 'tool.failed'].includes(event.type) && builtins.candidateTool(event.payload.toolId)) {
                        const candidateId = event.payload.result.data?.candidateId;
                        if (event.payload.result.ok && candidateId) {
                            const key = ['muyu.profile.preview', 'muyu.settings.preview'].includes(event.payload.toolId) ? candidateId : event.payload.toolId;
                            if (event.payload.toolId === 'muyu.settings.preview') {
                                for (const replaced of event.payload.result.data?.replacedCandidateIds || []) { intent.candidates.delete(replaced); intent.autoApplyCandidates.delete(replaced); }
                                intent.recoverablePreviewFailure = false;
                            }
                            intent.candidates.set(key, { toolId: event.payload.toolId, candidateId });
                            if (fullAccess && event.payload.result.data?.applyRequested === true) intent.autoApplyCandidates.set(key, candidateId);
                            else intent.autoApplyCandidates.delete(key);
                        } else if (event.payload.toolId !== 'muyu.profile.preview') {
                            for (const [key, candidate] of intent.candidates) if (candidate.toolId === event.payload.toolId) { intent.candidates.delete(key); intent.autoApplyCandidates.delete(key); }
                        }
                    }
                    if (event.type === 'tool.completed' && event.payload.result?.ok) intent.completedTools.add(event.payload.toolId);
                    if (event.type === 'tool.failed') {
                        const safeSplit = event.payload.toolId === 'muyu.settings.preview' && event.payload.result?.effectState === 'not_started' &&
                            ['MEMORY_LIMIT_REQUIRES_SEPARATE_DRAFT', 'COMPLETION_VARIABLE_REQUIRES_SEPARATE_DRAFT'].includes(event.payload.result?.error?.code);
                        if (safeSplit) intent.recoverablePreviewFailure = true;
                        else intent.failedTool = true;
                    }
                    if (event.type === 'run.finished' && ['CONTEXT_LIMIT', 'MODEL_NETWORK_ERROR', 'MODEL_AUTH_ERROR', 'MODEL_RATE_LIMIT', 'MODEL_SERVICE_ERROR', 'MODEL_HISTORY_UNAVAILABLE', 'MODEL_OUTPUT_TRUNCATED', 'TIMEOUT', 'BUDGET_EXCEEDED'].includes(event.payload.error)) intent.failure = event.payload.error;
                },
            });
            running = handle; return handle;
        } });
        appUnsubscribe = app.subscribe(event => {
            if (event.type === 'run.settled') {
                const intent = intentions.get(event.runId), run = app.snapshot().runs.find(r => r.id === event.runId);
                try {
                    if (run?.status === 'failed' && intent?.failure) notices.set(run.sessionId, intent.failure);
                    if (run?.status === 'yielded' && intent) continuations.set(run.taskId, { mode: intent.mode, fields: [...intent.fields], artifact: intent.artifact, runConfig: { ...intent.runConfig }, historyStart: intent.historyStart, autoHistoryOmitted: intent.autoHistoryOmitted, sourceRunId: event.runId, candidates: [...intent.candidates], autoApplyCandidates: [...intent.autoApplyCandidates], completedTools: [...intent.completedTools], failedTool: intent.failedTool, recoverablePreviewFailure: intent.recoverablePreviewFailure });
                    else if (run) { releaseContinuation(run.taskId); permissions.forgetTask(run.target, run.taskId); }
                    if (run?.status === 'succeeded' && intent && !intent.explanation) {
                        const publication = builtins.tasks[intent.mode].publish(app, event.runId, intent);
                        const notice = typeof publication === 'string' ? publication : publication?.notice;
                        const published = publication?.published;
                        if (notice) notices.set(run.sessionId, notice);
                        if (fullAccess && intent.candidates.has('muyu.task.plan')) {
                            const plan = published?.get(intent.candidates.get('muyu.task.plan').candidateId);
                            if (plan) autoPlans.push({ id: plan.id, revision: plan.revision, sessionId: plan.sessionId });
                        }
                        if (fullAccess && !notice && (intent.failedTool || intent.recoverablePreviewFailure) && intent.autoApplyCandidates.size) notices.set(run.sessionId, 'AUTO_APPLY_REQUIRES_REVIEW');
                        if (fullAccess && !intent.failedTool && !intent.recoverablePreviewFailure) {
                            for (const [key, candidateId] of intent.autoApplyCandidates) {
                                if (intent.candidates.get(key)?.candidateId !== candidateId) continue;
                                const artifact = published?.get(candidateId);
                                if (artifact) autoActions.push({ id: artifact.id, revision: artifact.revision, kind: artifact.kind, sessionId: artifact.sessionId, target: ['config-draft', 'profile-draft'].includes(artifact.kind) ? host.globalTarget : run.target, owner: [...runtimeSessions].find(([, runtimeId]) => runtimeId === run.sessionId)?.[0] });
                            }
                        }
                    }
                } catch { notices.set(run.sessionId, 'RESULT_NEEDS_REVIEW'); }
                finally { if (run?.status !== 'yielded') builtins.forgetRun(event.runId); intentions.delete(event.runId); }
            }
            if (event.type === 'queue.released') { running = null; queueMicrotask(flushAutoActions); }
            if (event.type === 'run.settled' || event.type === 'run.started') capture();
            emit();
        }).unsubscribe;
    }
    async function stopAndDrain() {
        autoActions.length = 0; autoPlans.length = 0;
        if (checking) { checking.abort.abort(); await checking.promise; }
        actions.invalidate(); variableActions.invalidate(); bundleActions.invalidate(); profileActions.invalidate(); await Promise.all([actions.drain(), variableActions.drain(), bundleActions.drain(), profileActions.drain()]);
        if (!app) return;
        if (compacting) running?.cancel();
        for (const r of app.snapshot().runs) app.cancel(r.id);
        if (running) await Promise.all([running.completion, running.drained]);
    }
    function saveSummary(id, source, summary, target, taskId = null) {
        const current = library.get(id);
        if (disposed || !current || readOnly(current) || current.required.some(k => !permissions.allows(k, target, taskId)) || fingerprint(source.slice(0, summary.through)) !== fingerprint(current.messages.slice(0, summary.through))) throw Error('SUMMARY_STALE');
        library.update(id, { contextSummary: summary }); emit();
    }
    function candidateFor(record, config) {
        const candidate = summaryCandidate(record.messages, config, record.contextSummary);
        if (!candidate || usableSummary(record.contextSummary, record.messages) && candidate.through <= record.contextSummary.through) return null;
        return { ...candidate, tail: planContext(record.messages.slice(candidate.through), null, config).messages };
    }
    function clear() { actions.clear(); variableActions.clear(); bundleActions.clear(); profileActions.clear(); autoActions.length = 0; autoPlans.length = 0; autoConfigChecks.length = 0; fullAccess = false; selectionEpoch++; viewedId = null; capture(); appUnsubscribe?.(); app?.dispose(); builtins?.dispose(); app = null; model = null; running = null; connection = null; sessions.clear(); runtimeSessions.clear(); intentions.clear(); continuations.clear(); permissions.clear(); }
    const unsubscribeHost = host.subscribe(syncTarget);
    const api = {
        snapshot,
        setFullAccess(enabled) { live(); if (!model || resetting || snapshot().busy) throw Error('NOT_READY'); fullAccess = enabled === true; if (!fullAccess) { autoActions.length = 0; autoPlans.length = 0; } emit(); },
        explainReceipt(id) { return send({ explanation: id }); },
        async checkReceipt(id) {
            live(); const s = snapshot(), receipt = s.receipts.find(r => r.operationId === id);
            if (!model || resetting || s.busy || s.readOnly || !receipt || receipt.version >= 3) throw Error('NOT_READY');
            if (!receiptAllowed(receipt, host.globalTarget)) throw Error('CONSENT_REQUIRED');
            const owner = selectedId(), target = host.globalTarget;
            await runConfigCheck(owner, receipt, target, () => receiptAllowed(receipt, target) && !readOnly(library.get(owner)));
        },
        prepareConfigApply(id, revision) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || !['draft', 'assistant'].includes(mode) || !s.artifacts.some(a => a.id === id && a.revision === revision)) throw Error('ACTION_STALE');
            return actions.prepare(id, revision);
        },
        approveConfigApply(id) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || !['draft', 'assistant'].includes(mode) || !s.configActions.some(r => r.id === id)) throw Error('ACTION_STALE');
            return actions.approve(id).then(async result => {
                // The UI's awaited approval includes its own deterministic check; a
                // later explicit check remains available for observing subsequent edits.
                if (checking?.id === id) await checking.promise;
                return result;
            });
        },
        cancelConfigApply(id) { live(); if (resetting || !snapshot().configActions.some(r => r.id === id)) throw Error('ACTION_STALE'); actions.cancel(id); },
        prepareVariableApply(id, revision) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !s.artifacts.some(a => a.id === id && a.revision === revision && a.kind === 'variable-draft')) throw Error('ACTION_STALE');
            return variableActions.prepare(id, revision);
        },
        approveVariableApply(id) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !s.variableActions.some(a => a.id === id && a.status === 'pending')) throw Error('ACTION_STALE');
            return variableActions.approve(id);
        },
        cancelVariableApply(id) { live(); if (resetting || !snapshot().variableActions.some(a => a.id === id)) throw Error('ACTION_STALE'); variableActions.cancel(id); },
        prepareBundleApply(id, revision) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !s.artifacts.some(a => a.id === id && a.revision === revision && a.kind === 'task-bundle')) throw Error('ACTION_STALE');
            return bundleActions.prepare(id, revision);
        },
        approveBundleApply(id) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !s.bundleActions.some(a => a.id === id && a.status === 'pending')) throw Error('ACTION_STALE');
            return bundleActions.approve(id);
        },
        cancelBundleApply(id) { live(); if (resetting || !snapshot().bundleActions.some(a => a.id === id)) throw Error('ACTION_STALE'); bundleActions.cancel(id); },
        prepareProfileSave(id, revision) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !s.artifacts.some(a => a.id === id && a.revision === revision && a.kind === 'profile-draft')) throw Error('ACTION_STALE');
            return profileActions.prepare(id, revision);
        },
        approveProfileSave(id) {
            live(); const s = snapshot();
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !s.profileActions.some(a => a.id === id && a.status === 'pending')) throw Error('ACTION_STALE');
            return profileActions.approve(id);
        },
        cancelProfileSave(id) { live(); if (resetting || !snapshot().profileActions.some(a => a.id === id)) throw Error('ACTION_STALE'); profileActions.cancel(id); },
        approveTaskPlanReads(id, revision) {
            live(); const s = snapshot(), artifact = s.artifacts.find(a => a.id === id && a.revision === revision);
            if (!model || resetting || s.busy || s.readOnly || mode !== 'assistant' || !artifact || artifact.kind !== 'task-plan' || approvedPlans.has(id) || declinedPlans.has(id) || invalidPlans.has(id) ||
                artifact.validation?.intent !== 'read-scope-review' ||
                jsonKey(artifact.content.target) !== jsonKey(artifact.content.target.kind === 'chat' ? host.currentTarget() : host.globalTarget) ||
                !app.snapshot().tasks.some(task => task.id === artifact.taskId && task.status === 'awaiting_acceptance')) throw Error('TASK_PLAN_STALE');
            const sources = artifact.content.plan.sources.map(source => sourceKey(source));
            const result = permissions.grantTaskSources(sources, artifact.content.target, artifact.taskId,
                () => send({ planArtifactId: id }));
            approvedPlans.add(id); emit(); return result;
        },
        declineTaskPlanReads(id, revision) {
            live(); const s = snapshot(), artifact = s.artifacts.find(a => a.id === id && a.revision === revision);
            if (resetting || s.busy || s.readOnly || mode !== 'assistant' || !artifact || artifact.kind !== 'task-plan' || approvedPlans.has(id) || declinedPlans.has(id) || invalidPlans.has(id) ||
                artifact.validation?.intent !== 'read-scope-review' ||
                !app.snapshot().tasks.some(task => task.id === artifact.taskId && task.status === 'awaiting_acceptance')) throw Error('TASK_PLAN_STALE');
            declinedPlans.add(id);
            permissions.forgetTask(artifact.content.target, artifact.taskId);
            emit();
        },
        setInteractionDraft(id, value) { live(); if (!app || snapshot().readOnly || snapshot().interaction?.id !== id || resetting) throw Error('INTERACTION_STALE'); app.setInteractionDraft(id, value); },
        answerInteraction(id) { return api.send({ interactionId: id }); },
        answerPermission(id, decision) {
            live(); const s = snapshot(), r = s.interaction;
            if (!r || r.id !== id || r.kind !== 'permission' || r.status !== 'pending' || s.readOnly || resetting || s.busy) throw Error('INTERACTION_STALE');
            if (decision !== 'deny' && !permissionApprovalCurrent(r, host.providerPort)) throw Error('INTERACTION_STALE');
            return permissions.decide(r, decision, () => send({ interactionId: id, permissionDecision: decision }));
        },
        cancelInteraction(id) { live(); if (!app || snapshot().readOnly || snapshot().interaction?.id !== id || resetting) throw Error('INTERACTION_STALE'); const request = snapshot().interaction; app.cancelInteraction(id); releaseContinuation(request.taskId); permissions.forgetTask(request.target, request.taskId); emit(); },
        setInstructionDraft(value) { live(); instructionDraft = validateInstructionDraft(value); emit(); },
        discardInstructionDraft() { live(); instructionDraft = { ...instructionConfig }; emit(); },
        resetInstructionDraft() { live(); instructionDraft = { ...INSTRUCTION_DEFAULTS }; emit(); },
        async saveInstructions() {
            live(); if (savingInstructions || resetting) throw Error('NOT_READY');
            const next = validateInstructionConfig(instructionDraft); savingInstructions = true; emit();
            try { if (!host.instructionConfig) throw Error('INSTRUCTION_CONFIG_UNAVAILABLE'); await host.instructionConfig.save(next); live(); instructionConfig = next; }
            finally { savingInstructions = false; emit(); }
        },
        setOmitHistory(value) { live(); if (typeof value !== 'boolean' || resetting || snapshot().busy || readOnly(library.get(selectedId()))) throw Error('NOT_READY'); if (value) omittedViews.add(viewKey()); else omittedViews.delete(viewKey()); emit(); },
        async saveContextConfig(value) {
            live(); if (resetting || savingContextConfig) throw Error('NOT_READY');
            const next = validateContextConfig(value); savingContextConfig = true; emit();
            try { if (!host.contextConfig) throw Error('CONTEXT_CONFIG_UNAVAILABLE'); await host.contextConfig.save(next); live(); contextConfig = next; }
            finally { savingContextConfig = false; emit(); }
        },
        clearContextSummary() { live(); const id = selectedId(); if (snapshot().busy || resetting || !id || readOnly(library.get(id))) throw Error('NOT_READY'); library.update(id, { contextSummary: null }); emit(); },
        async compactHistory() {
            live(); const id = selectedId(), record = library.get(id), target = targetFor();
            if (!model || resetting || snapshot().busy || !record || readOnly(record)) throw Error('NOT_READY');
            if (record.required.some(k => !permissions.allows(k, target))) throw Error('HISTORY_PERMISSION_REQUIRED');
            const candidate = candidateFor(record, contextConfig); if (!candidate) throw Error('NOTHING_TO_SUMMARIZE');
            const state = { id, target, progress: null, usage: null };
            const handle = startMuyuRun({ identity: { id: 'compact:' + crypto.randomUUID(), sessionId: id, taskId: 'compact', target }, input: 'Summarize history', model, registry: builtins.registry, handlers: {}, allowedTools: [],
                contextConfig: { ...contextConfig }, compaction: candidate, summaryOnly: true, maxTokens: runConfig.maxTokens,
                limits: { modelCalls: 1, toolCalls: 1, timeMs: Math.min(runConfig.timeMs, 30000) },
                onSummary: summary => saveSummary(id, record.messages, summary, target),
                onEvent: event => { if (compacting !== state) return; if (event.type === 'run.context') state.progress = event.payload.phase; if (event.type === 'run.usage') state.usage = event.payload; if (event.type === 'run.finished') { state.finished = true; state.progress = event.payload.error ? 'summary_failed' : 'summarized'; } emit(); } });
            compacting = state; running = handle; emit();
            try { const result = await handle.completion; await handle.drained; if (result.error) throw Error(result.error); }
            finally { if (library.get(id)) compactResults.set(id, state); if (compacting === state) compacting = null; if (running === handle) running = null; emit(); }
        },
        ready: library.ready,
        newSession() {
            live(); if (resetting || !targetFor()) throw Error('NOT_READY');
            const id = library.create(scopeKey()); selectionEpoch++; viewedId = null; sessions.set(scopeKey(), id); historyFilters = { ...historyFilters, range: mode === 'draft' ? 'global' : 'current', archive: 'active', query: '', task: '' }; emit(); return id;
        },
        selectSession: id => openSession(id, true),
        openSession,
        renameSession: (id, title) => manageSession(id, 'rename', title),
        archiveSession: (id, value) => manageSession(id, 'archive', value),
        deleteSession: id => manageSession(id, 'remove'),
        setHistoryFilters(value) {
            live();
            const next = { ...historyFilters, ...value };
            if (Object.keys(next).some(k => !['range', 'archive', 'task', 'query'].includes(k)) || !['current', 'global', 'all'].includes(next.range) || !['active', 'archived', 'all'].includes(next.archive) || next.task !== '' && !Object.hasOwn(taskCatalog, next.task) || typeof next.query !== 'string' || next.query.length > 100) throw Error('HISTORY_INVALID');
            historyFilters = next; emit();
        },
        setScrollPosition(key, top) { if (!disposed && views.has(key) && Number.isFinite(top)) scrollPositions.set(key, Math.max(0, top)); },
        refreshHistory: () => library.refresh(),
        previewHistoryImport: importPreview,
        async importHistory(text) {
            live(); if (resetting) throw Error('NOT_READY');
            const id = library.import(text); historyFilters = { range: 'all', archive: 'active', task: '', query: '' }; await openSession(id); return id;
        },
        async setHistoryEnabled(value) {
            live(); if (resetting || snapshot().busy) throw Error('NOT_READY');
            resetting = true; emit();
            try { await library.setEnabled(value); } finally { resetting = false; emit(); }
        },
        retryHistory: () => library.retry(),
        exportHistory(format) { live(); return library.export(selectedId(), format); },
        flushHistory: () => library.flush(),
        subscribe(fn) { live(); listeners.add(fn); return { snapshot: snapshot(), unsubscribe: () => listeners.delete(fn) }; },
        setMode(value) { live(); if (!Object.hasOwn(taskCatalog, value)) throw new Error('INVALID_MODE'); selectionEpoch++; viewedId = null; pinnedTarget = null; mode = value; historyFilters.range = value === 'draft' ? 'global' : 'current'; emit(); },
        setInput(value) { live(); if (readOnly(library.get(selectedId()))) throw Error('HISTORY_READ_ONLY'); if (typeof value !== 'string' || value.length > 16000) throw new Error('INPUT_LIMIT'); inputs.set(viewKey(), value); },
        async saveRunConfig(value) {
            live(); if (savingRunConfig || resetting) throw Error('NOT_READY');
            const next = validateRunConfig(value); savingRunConfig = true; emit();
            try { await host.runConfig?.save(next); live(); runConfig = next; }
            finally { savingRunConfig = false; emit(); }
        },
        grantPermission(kind) { live(); if (!model || resetting) throw Error('NOT_READY'); permissions.grant(kind, host.currentTarget()); emit(); },
        grantHistoryPermission(kind) { live(); const s = snapshot(), record = library.get(selectedId()); if (!model || resetting || s.busy || s.readOnly || s.interaction?.status === 'pending' || !record?.required.includes(kind) || !s.history.missingPermissions.includes(kind)) throw Error('NOT_READY');
            if (kind.startsWith('source:')) { const source = permissionSource(kind.slice(7)); if (!source || source.id === 'providerExecution') throw Error('INVALID_PERMISSION'); permissions.grantSource(kind, source.scope === 'global' ? host.globalTarget : host.currentTarget()); }
            else permissions.grant(kind, host.currentTarget()); emit(); },
        async revokePermission(kind) {
            live(); if (resetting) throw Error('NOT_READY');
            permissions.revoke(kind, targetFor()); resetting = true; emit();
            try {
                await stopAndDrain(); live();
                // Conservative reset: prior answers may quote data from revoked sources.
                capture();
                appUnsubscribe?.(); app?.dispose(); builtins?.dispose(); running = null;
                if (model) assemble(); inputs.clear();
            } finally { resetting = false; emit(); }
        },
        async forgetCredential() { live(); if (resetting) throw Error('NOT_READY'); resetting = true; emit(); try { await host.credentials?.save(null); } finally { resetting = false; emit(); } },
        async configure(config) {
            live(); if (resetting) throw new Error('RESETTING');
            const resolved = { ...config, apiKey: host.credentials?.resolve(config) || config.apiKey };
            const next = createModel({ connection: resolved }); resetting = true; emit();
            try { await stopAndDrain(); live(); if (config.rememberKey || host.credentials?.describe()) await host.credentials?.save(config.rememberKey ? { ...resolved, autoConnect: config.autoConnect === true } : null); live(); const draft = inputs.get(viewKey()) || ''; clear(); model = next; connection = { endpoint: config.endpoint, model: config.model, thinking: config.thinking !== false, remembered: config.rememberKey === true, autoConnect: config.rememberKey === true && config.autoConnect === true }; assemble(); if (draft) inputs.set(viewKey(), draft); error = null; }
            finally { resetting = false; emit(); }
        },
        async disable() { live(); if (resetting) throw new Error('RESETTING'); resetting = true; emit(); try { await stopAndDrain(); await host.credentials?.setAutoConnect?.(false); clear(); inputs.clear(); } finally { resetting = false; emit(); } },
        send({ consent, fields, artifactId, interactionId } = {}) { return send({ consent, fields, artifactId, interactionId }); },
        stop() { live(); autoActions.length = 0; autoPlans.length = 0; autoConfigChecks.length = 0; checking?.abort.abort(); actions.invalidate(); variableActions.invalidate(); bundleActions.invalidate(); profileActions.invalidate(); if (compacting) running?.cancel(); if (app) { const state = app.snapshot(); for (const a of state.artifacts) if (a.kind === 'task-plan') invalidPlans.add(a.id); app.invalidateInteractions(); for (const taskId of continuations.keys()) releaseContinuation(taskId); for (const t of state.tasks) permissions.forgetTask(state.sessions.find(s => s.id === t.sessionId)?.target, t.id); for (const r of state.runs) app.cancel(r.id); } emit(); },
        revalidate(id, revision) { live(); if (!app || resetting || snapshot().busy) throw new Error('NOT_READY');
            if (!['draft', 'assistant'].includes(mode) || !snapshot().artifacts.some(a => a.id === id && a.revision === revision)) throw new Error('INVALID_ARTIFACT');
            try { const a = builtins.revalidate(app, id, revision); emit(); return a; }
            catch { app.validateArtifact(id, revision, { status: 'stale', message: '重新生成预览 / Generate a fresh preview' }); emit(); throw new Error('STALE_DRAFT'); }
        },
        async dispose() { if (disposed) return; disposed = true; unsubscribeHost(); listeners.clear(); await stopAndDrain(); clear(); inputs.clear(); await library.close(); },
    };
    function send({ consent, fields = [], artifactId = null, planArtifactId = null, interactionId = null, permissionDecision = null, explanation = null } = {}) {
            live(); if (!app || resetting || snapshot().busy || snapshot().history.loading) throw new Error('NOT_READY');
            if (readOnly(library.get(selectedId()))) throw Error('HISTORY_READ_ONLY');
            const request = snapshot().interaction;
            if (request?.status === 'pending' && interactionId !== request.id) throw Error('INTERACTION_PENDING');
            const continuation = interactionId && request?.id === interactionId && request.status === 'pending' ? continuations.get(request.taskId) : null;
            if (interactionId && (!continuation || continuation.mode !== mode)) throw Error('INTERACTION_STALE');
            if (continuation && (request.kind === 'permission') !== (permissionDecision !== null)) throw Error('INTERACTION_STALE');
            if (continuation) {
                fields = continuation.fields;
                artifactId = continuation.artifact?.kind === 'config-draft' ? continuation.artifact.id : null;
                planArtifactId = continuation.artifact?.kind === 'task-plan' ? continuation.artifact.id : null;
            }
            const target = targetFor(); if (!target) throw new Error('CHAT_REQUIRED');
            if (consent === true && mode !== 'assistant') permissions.grant(requiredPermission(), host.currentTarget());
            else if (mode === 'chat') permissions.declineChat(target);
            if (!['chat', 'assistant'].includes(mode) && !permissions.allows(requiredPermission(), host.currentTarget())) throw new Error('CONSENT_REQUIRED');
            if (explanation && (omittedViews.has(viewKey()) || !configAllowed(target) || !receiptsFor(selectedId()).some(r => r.operationId === explanation))) throw Error('HISTORY_PERMISSION_REQUIRED');
            if (!explanation) builtins.tasks[mode].validate?.(fields);
            syncTarget(false); const key = viewKey(), input = explanation ? '请解释操作回执 ' + explanation + ' 的结果、保存确认情况及注意事项。不要重新执行操作。' : continuation ? permissionDecision !== null ? permissionAnswer(request, permissionDecision) : describeAnswer(request, request.draft) : planArtifactId ? '应用已批准此任务方案列出的读取来源。请继续只读核对并更新方案；尚无任何写入权限，不要声称已应用。' : inputs.get(key) || ''; if (!input.trim()) throw new Error('EMPTY_INPUT');
            let id = selectedId();
            if (!id) { id = library.create(scopeKey()); sessions.set(scopeKey(), id); }
            const record = library.get(id); library.assertRoom(id);
            const { missing, autoHistoryOmitted, historyStart, omitHistory } = historyChoice(record, key, target, continuation, continuation ? request.taskId : null, !!explanation);
            if (!omitHistory && record.required.some(kind => !permissions.allows(kind, target, continuation ? request.taskId : null))) throw Error('HISTORY_PERMISSION_REQUIRED');
            if (omitHistory && (artifactId || planArtifactId)) throw Error('INVALID_ARTIFACT');
            let sessionId = runtimeSessions.get(id);
            if (!sessionId) {
                if (runtimeSessions.size >= 8) {
                    const [oldId, oldRuntime] = runtimeSessions.entries().next().value;
                    capture(); unloadRuntime(oldRuntime); runtimeSessions.delete(oldId); notices.delete(oldRuntime);
                }
                sessionId = app.createSession(target, record.messages); runtimeSessions.set(id, sessionId);
            }
            const artifact = artifactId || planArtifactId ? app.getArtifact(artifactId || planArtifactId) : null;
            if (artifact && (!['draft', 'assistant'].includes(mode) || artifact.sessionId !== sessionId || artifact.kind !== (planArtifactId ? 'task-plan' : 'config-draft'))) throw new Error('INVALID_ARTIFACT');
            // Task policy has one owner: the composed instruction channel, not a duplicate user constraint.
            const baseInstructions = explanation ? composeReceiptInstructions(instructionConfig) : composeInstructions(mode, instructionConfig);
            const instructions = fullAccess && mode === 'assistant' && !explanation ? { ...baseInstructions, task: baseInstructions.task + '\n本连接已由用户在界面开启全权限模式：资料读取和已注册 Provider 执行无需再申请授权，不要调用授权工具。若用户明确要求直接修改，使用相应 preview 工具并在同一次调用中设 apply=true；宿主将在本轮成功结束后校验并执行，真实结果以操作回执为准，不要提前声称已保存。若用户要求只预览、不要应用或只读，绝不设置 apply=true。不要为了省事扩张字段、目标、工具或预算；高风险 Provider 仍需确认其与用户意图相符。' } : baseInstructions;
            if (continuation?.artifact && artifact.revision !== continuation.artifact.revision) throw Error('STALE_DRAFT');
            const contextPlan = planContext(record.messages.slice(historyStart), omitHistory ? null : record.contextSummary, contextConfig, false);
            const historyNote = !omitHistory && contextPlan.omitted > 0 ? '\n部分历史原文因上下文预算未携带；摘要如有也只是参考。不要猜测缺失的步骤、数值或当前宿主状态，应明确说明缺口。' : '';
            const scopedInstructions = autoHistoryOmitted || historyNote ? { ...instructions, task: instructions.task + (autoHistoryOmitted ? '\n部分历史因缺少资料授权未发送，本轮不据此猜测历史；必要时可逐项申请：' + missing.join(', ') : '') + historyNote } : instructions;
            const result = continuation ? permissionDecision !== null ? app.answerPermission(interactionId, permissionDecision) : app.answerInteraction(interactionId, request.draft) : artifact ? { taskId: artifact.taskId, runId: app.continueTask(artifact.taskId, input) } : app.submit(sessionId, input, []);
            const receipts = !omitHistory && configAllowed(target, result.taskId) ? receiptsFor(id).filter(r => !explanation || r.operationId === explanation).slice(-3) : [];
            if (explanation) explanations.set(explanation, result.runId);
            intentions.set(result.runId, { mode, explanation, receipts, consent, fields: [...fields], artifact, resumeFrom: continuation?.sourceRunId || null, candidates: new Map(continuation?.candidates || []), autoApplyCandidates: new Map(continuation?.autoApplyCandidates || []), completedTools: new Set(continuation?.completedTools || []), failedTool: continuation?.failedTool || false, recoverablePreviewFailure: continuation?.recoverablePreviewFailure || false, autoHistoryOmitted, instructions: scopedInstructions, runConfig: { ...(continuation?.runConfig || runConfig) }, contextConfig: { ...contextConfig }, contextPlan, historyId: id, sourceMessages: record.messages, historyStart,
                compaction: !omitHistory && contextConfig.autoSummary && contextPlan.omitted > 0 ? candidateFor(record, contextConfig) : null });
            omittedViews.delete(key);
            const granted = mode === 'assistant' ? [] : ['diagnostics', 'chat', 'extended', ...permissionSources.filter(source => !['source:memoryConfig', 'source:memoryDiagnostics', 'source:directorDiagnostics'].includes(source))].filter(kind => permissions.allows(kind, target, result.taskId));
            library.update(id, { title: record.title || input.slice(0, 80), required: [...new Set([...record.required, ...granted])] });
            capture(); if (!continuation && !explanation && !planArtifactId) { inputs.set(key, ''); inputs.set(viewKey(), ''); } notices.delete(sessionId); error = null; emit(); return result;
    }
    try {
        const saved = host.credentials?.restoreAutoConnection?.();
        if (saved) {
            model = createModel({ connection: saved });
            connection = { endpoint: saved.endpoint, model: saved.model, thinking: saved.thinking !== false, remembered: true, autoConnect: true };
            assemble();
        }
    } catch { model = null; connection = null; }
    return Object.freeze(api);
}
