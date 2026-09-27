import { copyJson, jsonKey } from '../../core/json-contract.js';
import { assertActive } from '../../core/execution.js';
import { createToolRegistry } from '../../tools/registry.js';
import { configFields, configDomains, configChangesSchema, dependencyFields, fieldDefinition, previewSettings, readSettingsFields, selectedFields } from '../../config/registry.js';
import { configurationCoverage, dynamicSettings } from '../../config/coverage.js';

const string = { type: 'string', maxLength: 24000 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: { type: 'string', enum: configFields }, maxItems: configFields.length };
// JSON text keeps the global tool schema small; the domain owner validates its contents.
const output = object({ text: string, candidateId: { type: 'string', maxLength: 100 } });

export function createSettingsModule({ getSettings, getTarget, memoryLimitPort }) {
    const registry = createToolRegistry(), handlers = {}, runs = new Map(); let disposed = false;
    function target(expected) {
        const actual = getTarget();
        if (!actual || (expected.kind === 'global' ? expected.userKey !== actual.userKey : jsonKey(expected) !== jsonKey(actual))) throw Error('TARGET_UNAVAILABLE');
    }
    function read(expected, fields) {
        target(expected); const settings = getSettings(), baseline = readSettingsFields(settings, fields);
        if (settings !== getSettings() || jsonKey(baseline) !== jsonKey(readSettingsFields(settings, fields))) throw Error('STALE_BASELINE');
        target(expected); return baseline;
    }
    function inspectMemoryLimit(changes, target, existingPlan = null) {
        if (!Object.hasOwn(changes, 'memoryMaxEntries')) {
            if (existingPlan) throw Error('INVALID_DRAFT');
            return null;
        }
        if (Object.keys(changes).length !== 1 || !memoryLimitPort) throw Error('MEMORY_LIMIT_REQUIRES_SEPARATE_DRAFT');
        if (existingPlan) { memoryLimitPort.assertFresh(existingPlan); return existingPlan; }
        return memoryLimitPort.plan(target, changes.memoryMaxEntries);
    }
    function withMemoryImpact(preview, plan) {
        if (!plan) return preview;
        return copyJson({ ...preview, impact: { scope: 'current-chat', remove: plan.total, characters: plan.counts },
            warnings: [...preview.warnings, ...(plan.total ? ['CURRENT_CHAT_MEMORIES_WILL_BE_REMOVED'] : [])],
            notice: `仅预览，未应用。全局上限将影响所有聊天之后的记忆生成/导入；当前聊天将裁剪 ${plan.total} 条最旧记忆。全局设置保存与聊天裁剪可能部分完成，须逐项查看回执。` });
    }
    function register(id, description, inputSchema, handler) {
        registry.register({ id, version: 1, description, inputSchema, outputSchema: output, scope: 'global', effect: 'read', dataClasses: ['settings-whitelist'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
        handlers[id] = (args, ctx) => { if (disposed) throw Error('MODULE_DISPOSED'); assertActive(ctx.signal); return handler(args, ctx); };
    }
    register('muyu.settings.catalog', '列出当前可编辑配置领域和字段，以及尚未接入的配置键；目录不读取配置值，不代表全部配置已接入。', object({}), () => ({ candidateId: '', text: JSON.stringify({ version: 2,
        supported: configDomains.map(domain => ({ domain, fields: configFields.filter(id => fieldDefinition(id).domain === domain) })),
        pending: configurationCoverage().filter(row => row.status !== 'supported').map(({ key, owner, status }) => ({ key, owner, status })), dynamicPending: Object.keys(dynamicSettings),
    }) }));
    register('muyu.settings.contract', '按领域查询字段类型、限制、生效时机；scope=global影响所有聊天。未指定字段保持原值，不填默认值；Prompt是文本，不能当JSON解析。', object({ domain: { type: 'string', enum: configDomains } }), ({ domain }) => ({ candidateId: '', text: JSON.stringify(configFields.filter(id => fieldDefinition(id).domain === domain).map(fieldDefinition)) }));
    register('muyu.settings.read', '按明确字段读取当前内存值，未提供的字段为缺失，不补默认值；不能证明持久化。需要相应配置读取授权。', object({ fields: strings }), ({ fields }, ctx) => ({ candidateId: '', text: JSON.stringify({ scope: 'global', persistence: 'unknown', fields: selectedFields(fields), values: read(ctx.target, fields) }) }));
    register('muyu.settings.preview', '生成已登记配置的局部changes草稿，不应用。先查领域契约；评分使用scoreWeights.mention等精确字段名。memoryMaxEntries单独预览须有当前聊天，并同时需要memoryConfig与memoryDiagnostics读取授权；configSettings授权不能代替。缺读取授权时宿主自动暂停原调用并申请精确来源，获准后原样续接；不要自行猜测来源。不隐式开启功能。变更会替代本轮此前候选，失败会清除候选。', object({ changes: configChangesSchema }), ({ changes }, ctx) => {
        const run = runs.get(ctx.runId); if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        if (run.candidate?.content.memoryPrunePlan) memoryLimitPort?.forget(run.candidate.content.memoryPrunePlan);
        run.candidate = null;
        const fields = dependencyFields(Object.keys(changes)), baseline = read(ctx.target, fields);
        const basePreview = previewSettings({ baseline, changes });
        let plan, content;
        try {
            plan = inspectMemoryLimit(changes, ctx.target);
            const preview = withMemoryImpact(basePreview, plan);
            content = copyJson({ module: 'settings-config', producedByRunId: ctx.runId, baseline, requestedChanges: changes, preview, ...(plan ? { memoryPrunePlan: plan } : {}) });
            // Reserve envelope space for artifact, validation and operation metadata.
            if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('DRAFT_TOO_LARGE');
        } catch (error) { if (plan) memoryLimitPort?.forget(plan); throw error; }
        const candidateId = 'settings:' + crypto.randomUUID();
        const result = copyJson({ candidateId, text: JSON.stringify(content.preview) });
        run.candidate = { candidateId, content }; return result;
    });
    registry.seal();
    function verifyContent(content, expectedTarget) {
        if (content.module !== 'settings-config' || content.preview.contractVersion !== 2) throw Error('INVALID_DRAFT');
        const changes = content.requestedChanges ?? content.preview.manifest.settings, fields = dependencyFields(Object.keys(changes));
        const baseline = read(expectedTarget, fields);
        if (jsonKey(baseline) !== jsonKey(content.baseline)) throw Error('STALE_BASELINE');
        const plan = inspectMemoryLimit(changes, expectedTarget, content.memoryPrunePlan);
        if (jsonKey(withMemoryImpact(previewSettings({ baseline, changes }), plan)) !== jsonKey(content.preview)) throw Error('INVALID_DRAFT');
    }
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        publishDraft(app, id, candidateId) {
            const r = runs.get(id), run = app.snapshot().runs.find(item => item.id === id);
            if (!r?.candidate || r.candidate.candidateId !== candidateId || run?.status !== 'succeeded' || run.taskId !== r.taskId || jsonKey(run.target) !== jsonKey(r.target)) throw Error('INVALID_CANDIDATE_SOURCE');
            verifyContent(r.candidate.content, r.target);
            const a = app.createArtifact({ taskId: r.taskId, sourceRunId: id, kind: 'config-draft', content: r.candidate.content }); runs.delete(id); return a;
        },
        validateSaved(app, id, revision) {
            const a = app.getArtifact(id), run = app.snapshot().runs.find(r => r.id === a.content.producedByRunId);
            if (a.kind !== 'config-draft' || a.revision !== revision || run?.status !== 'succeeded' || run.taskId !== a.taskId) throw Error('STALE_ARTIFACT');
            verifyContent(a.content, run.target);
            return app.validateArtifact(id, revision, { contractVersion: 2, structural: 'passed', semantic: a.content.preview.semantic, intent: 'requires_user_review', baseline: 'matched-at-validation' });
        },
        forgetRun(id) { const run = runs.get(id); if (run?.candidate?.content.memoryPrunePlan) memoryLimitPort?.forget(run.candidate.content.memoryPrunePlan); runs.delete(id); }, dispose() { disposed = true; runs.clear(); memoryLimitPort?.clear(); },
    };
}
