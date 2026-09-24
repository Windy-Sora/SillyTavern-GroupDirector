import { jsonKey } from '../core/json-contract.js';
import { createApplication } from './service.js';
import { startMuyuRun } from '../composition.js';
import { createChatCompletionsModel } from '../model/chat-completions.js';
import { createToolRegistry } from '../tools/registry.js';
import { createMemoryReader } from '../modules/memory/reader.js';
import { createMemoryModule } from '../modules/memory/index.js';
import { createConfigDraftModule } from '../modules/config-draft/index.js';
import { memoryFields } from '../modules/config-draft/contracts.js';

/** Lifetime is the extension instance, not a DOM panel. All permissions are explicit per submission. */
export function createMuyuController({ host, createModel = createChatCompletionsModel }) {
    let app, memory, drafts, model, connection = null, running, appUnsubscribe, disposed = false, resetting = false;
    let mode = 'memory', error = null;
    const listeners = new Set(), sessions = new Map(), inputs = new Map(), intentions = new Map(), notices = new Map();
    const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* Detached views cannot control tasks. */ } } };
    const live = () => { if (disposed) throw new Error('CONTROLLER_DISPOSED'); };
    const targetFor = () => mode === 'memory' ? host.currentTarget() : host.globalTarget;
    const viewKey = () => mode + ':' + jsonKey(targetFor());
    const views = new Map();
    function syncTarget() { if (app) app.changeTarget(host.currentTarget()); emit(); }
    function snapshot() {
        const state = app?.snapshot(), sessionId = sessions.get(viewKey());
        if (!views.has(viewKey())) views.set(viewKey(), views.size + 1);
        const session = state?.sessions.find(s => s.id === sessionId);
        return { viewToken: views.get(viewKey()), enabled: !!model, resetting, mode, connection: connection && { ...connection }, input: inputs.get(viewKey()) || '', hasChat: !!host.currentTarget(),
            busy: !!state?.activeRunId || !!state?.runs.some(r => r.status === 'queued'), draining: !!state?.draining,
            messages: session?.messages || [], runs: state?.runs.filter(r => r.sessionId === sessionId) || [],
            artifacts: state?.artifacts.filter(a => a.sessionId === sessionId) || [],
            notice: notices.get(sessionId) || null, error,
        };
    }
    function assemble() {
        sessions.clear(); intentions.clear(); notices.clear();
        memory = createMemoryModule({ reader: createMemoryReader(host.memoryPorts) });
        drafts = createConfigDraftModule({ getSettings: host.getSettings, getTarget: host.configTarget });
        const registry = createToolRegistry();
        for (const module of [memory, drafts]) for (const definition of module.registry.list()) registry.register(definition);
        registry.seal(); const handlers = { ...memory.handlers, ...drafts.handlers };
        app = createApplication({ currentTarget: host.currentTarget(), startRun: options => {
            const intent = intentions.get(options.identity.id);
            if (!intent) throw new Error('MISSING_INTENT');
            const allowedTools = intent.mode === 'draft' ? ['muyu.config.contract', 'muyu.config.preview'] : ['muyu.knowledge.list', 'muyu.knowledge.read', 'muyu.memory.inspect'];
            if (intent.mode === 'draft') drafts.bindRun({ runId: options.identity.id, taskId: options.identity.taskId, target: options.identity.target, allowedFields: intent.fields, previousArtifact: intent.artifact });
            const handle = startMuyuRun({ ...options, model, registry, handlers, allowedTools,
                policy: ({ definition }) => intent.consent && allowedTools.includes(definition.id),
                onEvent: event => {
                    options.onEvent(event);
                    if (event.type === 'tool.completed' && event.payload.result.data?.candidateId) intent.candidateId = event.payload.result.data.candidateId;
                    if (event.type === 'run.finished' && ['MODEL_NETWORK_ERROR', 'MODEL_AUTH_ERROR', 'MODEL_RATE_LIMIT', 'MODEL_SERVICE_ERROR', 'MODEL_HISTORY_UNAVAILABLE', 'TIMEOUT', 'BUDGET_EXCEEDED'].includes(event.payload.error)) intent.failure = event.payload.error;
                },
            });
            running = handle; return handle;
        } });
        appUnsubscribe = app.subscribe(event => {
            if (event.type === 'run.settled') {
                const intent = intentions.get(event.runId), run = app.snapshot().runs.find(r => r.id === event.runId);
                try {
                    if (run?.status === 'failed' && intent?.failure) notices.set(run.sessionId, intent.failure);
                    if (run?.status === 'succeeded' && intent) {
                        if (intent.mode === 'memory') memory.publishReport(app, event.runId);
                        else if (intent.candidateId) {
                            const a = drafts.publishDraft(app, event.runId, intent.candidateId);
                            drafts.validateSaved(app, a.id, a.revision);
                        } else notices.set(run.sessionId, 'NO_CANDIDATE');
                    }
                } catch { notices.set(run.sessionId, 'RESULT_NEEDS_REVIEW'); }
                finally { memory.forgetRun(event.runId); drafts.forgetRun(event.runId); intentions.delete(event.runId); }
            }
            if (event.type === 'queue.released') running = null;
            emit();
        }).unsubscribe;
    }
    async function stopAndDrain() {
        if (!app) return;
        for (const r of app.snapshot().runs) app.cancel(r.id);
        if (running) await Promise.all([running.completion, running.drained]);
    }
    function clear() { appUnsubscribe?.(); app?.dispose(); memory?.dispose(); drafts?.dispose(); app = null; model = null; running = null; connection = null; sessions.clear(); intentions.clear(); notices.clear(); }
    const unsubscribeHost = host.subscribe(syncTarget);
    return Object.freeze({
        snapshot,
        subscribe(fn) { live(); listeners.add(fn); return { snapshot: snapshot(), unsubscribe: () => listeners.delete(fn) }; },
        setMode(value) { live(); if (!['memory', 'draft'].includes(value)) throw new Error('INVALID_MODE'); mode = value; emit(); },
        setInput(value) { live(); if (typeof value !== 'string' || value.length > 16000) throw new Error('INPUT_LIMIT'); inputs.set(viewKey(), value); },
        async configure(config) {
            live(); if (resetting) throw new Error('RESETTING');
            const next = createModel({ connection: config }); resetting = true; emit();
            try { await stopAndDrain(); live(); clear(); model = next; connection = { endpoint: config.endpoint, model: config.model, thinking: config.thinking !== false }; assemble(); error = null; }
            finally { resetting = false; emit(); }
        },
        async disable() { live(); if (resetting) throw new Error('RESETTING'); resetting = true; emit(); try { await stopAndDrain(); clear(); inputs.clear(); } finally { resetting = false; emit(); } },
        send({ consent, fields = [], artifactId = null } = {}) {
            live(); if (!app || resetting || snapshot().busy) throw new Error('NOT_READY');
            if (consent !== true) throw new Error('CONSENT_REQUIRED');
            if (mode === 'draft' && (!fields.length || fields.some(f => !memoryFields.includes(f)) || new Set(fields).size !== fields.length)) throw new Error('FIELD_SCOPE_REQUIRED');
            const target = targetFor(); if (!target) throw new Error('CHAT_REQUIRED');
            syncTarget(); const key = viewKey(), input = inputs.get(key) || ''; if (!input.trim()) throw new Error('EMPTY_INPUT');
            let sessionId = sessions.get(key); if (!sessionId) { sessionId = app.createSession(target); sessions.set(key, sessionId); }
            const artifact = artifactId ? app.getArtifact(artifactId) : null;
            if (artifact && (mode !== 'draft' || artifact.sessionId !== sessionId || artifact.kind !== 'config-draft')) throw new Error('INVALID_ARTIFACT');
            const instructions = mode === 'draft' ? '请先查询字段合同再提交changes预览，只生成草稿，未应用；未指定字段保持原值。' : '请先查询记忆资料并读取状态，区分当前条件与未知历史原因，不猜测，不执行写操作。';
            const result = artifact ? { taskId: artifact.taskId, runId: app.continueTask(artifact.taskId, input) } : app.submit(sessionId, input, [instructions]);
            intentions.set(result.runId, { mode, consent, fields: [...fields], artifact, candidateId: null }); inputs.set(key, ''); notices.delete(sessionId); error = null; emit(); return result;
        },
        stop() { live(); if (app) for (const r of app.snapshot().runs) app.cancel(r.id); emit(); },
        revalidate(id, revision) { live(); if (!app || resetting || snapshot().busy) throw new Error('NOT_READY');
            if (mode !== 'draft' || !snapshot().artifacts.some(a => a.id === id && a.revision === revision)) throw new Error('INVALID_ARTIFACT');
            try { const a = drafts.validateSaved(app, id, revision); emit(); return a; }
            catch { app.validateArtifact(id, revision, { status: 'stale', message: '重新生成预览 / Generate a fresh preview' }); emit(); throw new Error('STALE_DRAFT'); }
        },
        async dispose() { if (disposed) return; disposed = true; unsubscribeHost(); listeners.clear(); await stopAndDrain(); clear(); inputs.clear(); },
    });
}
