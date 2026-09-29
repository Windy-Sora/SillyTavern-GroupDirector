import { copyJson, jsonKey } from '../../core/json-contract.js';
import { assertActive } from '../../core/execution.js';
import { createToolRegistry } from '../../tools/registry.js';
import { configFields, configDomains, configChangesSchema, dependencyFields, fieldDefinition, previewSettings, readSettingsFields, selectedFields } from '../../config/registry.js';
import { configurationCoverage, dynamicSettings } from '../../config/coverage.js';

const string = { type: 'string', maxLength: 24000 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: { type: 'string', enum: configFields }, maxItems: configFields.length };
// JSON text keeps the global tool schema small; the domain owner validates its contents.
const output = { type: 'object', properties: { text: string, candidateId: { type: 'string', maxLength: 100 }, applyRequested: { type: 'boolean' } }, required: ['text', 'candidateId'], additionalProperties: false };

export function createSettingsModule({ getSettings, getTarget, memoryLimitPort, completionVariablePort }) {
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
    function inspectCompletionVariable(changes, target, baseline, existingPlan = null) {
        if (!Object.hasOwn(changes, 'storyBlueprintCompletionVariable')) {
            if (existingPlan) throw Error('INVALID_DRAFT');
            return null;
        }
        if (Object.keys(changes).length !== 1 || !completionVariablePort) throw Error('COMPLETION_VARIABLE_REQUIRES_SEPARATE_DRAFT');
        if (existingPlan) { completionVariablePort.assertFresh(existingPlan); return existingPlan; }
        return completionVariablePort.plan(target, baseline.storyBlueprintCompletionVariable, changes.storyBlueprintCompletionVariable);
    }
    function withCompletionImpact(preview, plan) {
        if (!plan) return preview;
        return copyJson({ ...preview, impact: { scope: 'current-chat', newVariableId: plan.newId, initialValue: false, oldVariable: 'retained' },
            notice: '仅预览，未应用。先在当前聊天创建并确认保存值为 false 的新变量，再保存影响所有聊天的全局名称；旧变量保留。其他聊天只会在下次使用时检查，遇到同名冲突将停止推进。' });
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
    register('muyu.settings.catalog', '列出当前可编辑配置领域和字段，以及尚未接入或暂缓的配置键；deferred 表示暮羽暂不支持修改，不能靠额外授权解锁。目录不读取配置值。', object({}), () => ({ candidateId: '', text: JSON.stringify({ version: 2,
        supported: configDomains.map(domain => ({ domain, fields: configFields.filter(id => fieldDefinition(id).domain === domain) })),
        pending: configurationCoverage().filter(row => row.status !== 'supported' && row.status !== 'internal').map(({ key, owner, status }) => ({ key, owner, status })), dynamicPending: Object.keys(dynamicSettings),
    }) }));
    register('muyu.settings.contract', '按领域查询字段类型、限制、生效时机；scope=global影响所有聊天。未指定字段保持原值，不填默认值；Prompt是文本，不能当JSON解析。', object({ domain: { type: 'string', enum: configDomains } }), ({ domain }) => ({ candidateId: '', text: JSON.stringify(configFields.filter(id => fieldDefinition(id).domain === domain).map(fieldDefinition)) }));
    register('muyu.settings.read', '按明确字段读取当前内存值，未提供的字段为缺失，不补默认值；不能证明持久化。需要相应配置读取授权。', object({ fields: strings }), ({ fields }, ctx) => ({ candidateId: '', text: JSON.stringify({ scope: 'global', persistence: 'unknown', fields: selectedFields(fields), values: read(ctx.target, fields) }) }));
    register('muyu.settings.preview', '生成已登记配置的局部changes草稿。仅在全权限模式且用户明确要求直接修改时设置apply=true：宿主在本轮成功结束后重新校验并写入，不需额外授权调用。用户要求只预览或不修改时省略apply。普通模式只允许预览。不隐式开启功能。memoryMaxEntries需单独处理。', { type: 'object', properties: { changes: configChangesSchema, apply: { type: 'boolean' } }, required: ['changes'], additionalProperties: false }, ({ changes, apply }, ctx) => {
        const run = runs.get(ctx.runId); if (!run || jsonKey(run.target) !== jsonKey(ctx.target)) throw Error('RUN_NOT_BOUND');
        if (run.candidate?.content.memoryPrunePlan) memoryLimitPort?.forget(run.candidate.content.memoryPrunePlan);
        if (run.candidate?.content.completionVariablePlan) completionVariablePort?.forget(run.candidate.content.completionVariablePlan);
        run.candidate = null;
        const fields = dependencyFields(Object.keys(changes)), baseline = read(ctx.target, fields);
        const basePreview = previewSettings({ baseline, changes });
        let plan, completionPlan, content;
        try {
            plan = inspectMemoryLimit(changes, ctx.target);
            completionPlan = inspectCompletionVariable(changes, ctx.target, baseline);
            const preview = withCompletionImpact(withMemoryImpact(basePreview, plan), completionPlan);
            content = copyJson({ module: 'settings-config', producedByRunId: ctx.runId, baseline, requestedChanges: changes, preview, ...(plan ? { memoryPrunePlan: plan } : {}), ...(completionPlan ? { completionVariablePlan: completionPlan } : {}) });
            // Reserve envelope space for artifact, validation and operation metadata.
            if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('DRAFT_TOO_LARGE');
        } catch (error) { if (plan) memoryLimitPort?.forget(plan); if (completionPlan) completionVariablePort?.forget(completionPlan); throw error; }
        const candidateId = 'settings:' + crypto.randomUUID();
        const result = copyJson({ candidateId, text: JSON.stringify(apply ? { ...content.preview, automaticApplication: 'requested; executes only after successful run and fresh host validation; check receipt' } : content.preview) });
        run.candidate = { candidateId, content }; return { ...result, ...(apply ? { applyRequested: true } : {}) };
    });
    registry.seal();
    function verifyContent(content, expectedTarget) {
        if (content.module !== 'settings-config' || content.preview.contractVersion !== 2) throw Error('INVALID_DRAFT');
        const changes = content.requestedChanges ?? content.preview.manifest.settings, fields = dependencyFields(Object.keys(changes));
        const baseline = read(expectedTarget, fields);
        if (jsonKey(baseline) !== jsonKey(content.baseline)) throw Error('STALE_BASELINE');
        const plan = inspectMemoryLimit(changes, expectedTarget, content.memoryPrunePlan);
        const completionPlan = inspectCompletionVariable(changes, expectedTarget, baseline, content.completionVariablePlan);
        if (jsonKey(withCompletionImpact(withMemoryImpact(previewSettings({ baseline, changes }), plan), completionPlan)) !== jsonKey(content.preview)) throw Error('INVALID_DRAFT');
    }
    return { registry, handlers,
        bindRun(identity) { if (disposed || runs.size >= 128 || runs.has(identity.id)) throw Error('RUN_CAPACITY'); runs.set(identity.id, { target: copyJson(identity.target), taskId: identity.taskId, candidate: null }); },
        transferRun(from, identity) { const run = runs.get(from); if (!run) return; if (runs.has(identity.id) || run.taskId !== identity.taskId || jsonKey(run.target) !== jsonKey(identity.target)) throw Error('INVALID_RUN_TRANSFER'); runs.delete(from); if (run.candidate) run.candidate.content.producedByRunId = identity.id; runs.set(identity.id, run); },
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
        forgetRun(id) { const run = runs.get(id); if (run?.candidate?.content.memoryPrunePlan) memoryLimitPort?.forget(run.candidate.content.memoryPrunePlan); if (run?.candidate?.content.completionVariablePlan) completionVariablePort?.forget(run.candidate.content.completionVariablePlan); runs.delete(id); }, dispose() { disposed = true; runs.clear(); memoryLimitPort?.clear(); completionVariablePort?.clear(); },
    };
}
