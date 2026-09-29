import { validateJson } from '../core/json-contract.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { configFields, fieldDefinition } from '../config/registry.js';
const text = maxLength => ({ type: 'string', maxLength });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const receiptStatuses = ['cancelled', 'expired', 'not_executed', 'applied_confirmed', 'applied_unconfirmed', 'saved_confirmed', 'saved_unconfirmed', 'partial', 'outcome_unknown'];
const schema = object({ operationId: text(100), artifactId: text(100), revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 }, status: { type: 'string', enum: receiptStatuses },
    diff: { type: 'array', maxItems: 4, items: object({ field: { type: 'string', enum: memoryFields }, before: text(40), after: text(40) }) }, saveError: { type: 'boolean' }, changed: { type: 'boolean' } });
const schemaV2 = { ...schema, properties: { ...schema.properties, version: { type: 'integer', enum: [2] }, diff: { type: 'array', maxItems: configFields.length, items: object({ field: { type: 'string', enum: configFields }, before: text(24000), after: text(24000) }) },
    memoryPrune: object({ chatKey: text(4096), settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] }, status: { type: 'string', enum: ['not_started', 'not_needed', 'pruned', 'skipped', 'outcome_unknown'] }, planned: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, removed: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
    completionVariable: object({ chatKey: text(4096), chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] }, settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] } }) } };
const variableFields = ['id', 'scope', 'type', 'defaultValue', 'label', 'rule', 'autoUpdate', 'injectMode', 'updateMode', 'min', 'max', 'showInDashboard'];
const schemaV3 = object({ version: { type: 'integer', enum: [3] }, operationId: text(100), artifactId: text(100), variableId: text(64),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses },
    diff: { type: 'array', maxItems: variableFields.length, items: object({ field: { type: 'string', enum: variableFields }, before: text(1000), after: text(1000) }) },
    saveError: { type: 'boolean' }, changed: { type: 'boolean' }, chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
});
const bundleStepSchema = object({ kind: { type: 'string', enum: ['variable', 'settings'] }, id: text(100),
    status: { type: 'string', enum: [...receiptStatuses, 'not_started'] },
    chatSave: { type: 'string', enum: ['not_started', 'confirmed', 'unknown'] },
    settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] },
    saveError: { type: 'boolean' }, changed: { type: 'boolean' },
    diff: { type: 'array', maxItems: configFields.length, items: object({ field: text(100), before: text(24000), after: text(24000) }) },
});
const schemaV4 = object({ version: { type: 'integer', enum: [4] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, steps: { type: 'array', maxItems: 7, items: bundleStepSchema },
});
const schemaV5 = object({ version: { type: 'integer', enum: [5] }, operationId: text(100), artifactId: text(100),
    revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    status: { type: 'string', enum: receiptStatuses }, profileName: text(80), profileId: text(100),
    fields: { type: 'array', maxItems: configFields.length, items: { type: 'string', enum: configFields } },
    persistence: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'unknown'] },
});
export function receiptSources(value) {
    if (value.version === 5) return [];
    if (value.version === 4) return [...new Set(value.steps.flatMap(step => step.kind === 'variable' ? ['source:variables'] :
        step.diff.map(row => fieldDefinition(row.field).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings')))];
    if (value.version === 3) return ['source:variables'];
    return [...new Set([...value.diff.map(d => value.version === 2 ? fieldDefinition(d.field).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings' : 'source:memoryConfig'), ...(value.memoryPrune ? ['source:memoryDiagnostics'] : []), ...(value.completionVariable ? ['source:variables'] : [])])];
}
export function validateReceipt(value) {
    const result = validateJson(value?.version === 5 ? schemaV5 : value?.version === 4 ? schemaV4 : value?.version === 3 ? schemaV3 : value?.version === 2 ? schemaV2 : schema, value);
    if (result.version === 4 && (!result.steps.length || result.steps.some(step => step.kind === 'settings' ? step.id !== 'global-settings' || step.diff.some(row => !configFields.includes(row.field)) : !/^[a-z0-9_]{1,64}$/.test(step.id) || step.diff.some(row => !variableFields.includes(row.field))))) throw Error('INVALID_RECEIPT');
    if (result.version === 2 && (result.diff.some(d => d.field === 'memoryMaxEntries') !== !!result.memoryPrune)) throw Error('INVALID_RECEIPT');
    if (result.version === 2 && (result.diff.some(d => d.field === 'storyBlueprintCompletionVariable') !== !!result.completionVariable)) throw Error('INVALID_RECEIPT');
    return result;
}
export function actionReceipt(action) {
    if (action.content?.module === 'generated-profile') return validateReceipt({ version: 5, operationId: action.id, artifactId: action.artifactId,
        revision: action.revision, at: Date.now(), status: action.status, profileName: action.content.name,
        profileId: action.result?.profileId || '', fields: action.content.fields,
        persistence: action.result?.persistence || 'not_started' });
    if (action.content?.module === 'task-bundle') {
        const planned = [...action.content.variables.map(row => ({ kind: 'variable', id: row.preview.id,
            diff: row.preview.diff.map(d => ({ field: d.field, before: JSON.stringify(d.before), after: JSON.stringify(d.after) })) })),
        ...(action.content.settings ? [{ kind: 'settings', id: 'global-settings', diff: action.content.settings.preview.diff }] : [])];
        return validateReceipt({ version: 4, operationId: action.id, artifactId: action.artifactId, revision: action.revision,
            at: Date.now(), status: action.status, steps: planned.map((step, index) => {
                const result = action.result?.steps?.[index];
                return { ...step, status: result?.status || 'not_started', chatSave: result?.result?.chatSave || 'not_started',
                    settingsSave: step.kind === 'settings' ? result?.result?.saveError ? 'error' : result?.status === 'applied_confirmed' ? 'confirmed' : result?.status === 'applied_unconfirmed' ? 'unconfirmed' : 'not_started' : 'not_started',
                    saveError: result?.result?.saveError === true, changed: result?.result?.changed === true };
            }) });
    }
    if (action.content?.module === 'variable-draft') return validateReceipt({ version: 3, operationId: action.id, artifactId: action.artifactId, variableId: action.content.preview.id,
        revision: action.revision, at: Date.now(), status: action.status,
        diff: action.content.preview.diff.map(d => ({ field: d.field, before: JSON.stringify(d.before), after: JSON.stringify(d.after) })),
        saveError: action.result?.saveError === true, changed: action.result?.changed === true, chatSave: action.result?.chatSave || 'not_started' });
    return validateReceipt({ ...(action.content.preview.contractVersion === 2 ? { version: 2 } : {}), operationId: action.id, artifactId: action.artifactId, revision: action.revision, at: Date.now(), status: action.status,
        diff: action.content.preview.diff, saveError: action.result?.saveError === true, changed: action.result?.changed === true,
        ...(action.content.memoryPrunePlan ? { memoryPrune: { chatKey: action.content.memoryPrunePlan.target.chatKey, settingsSave: action.result?.settingsSave || 'not_started', status: action.result?.memoryPrune?.status || 'not_started', planned: action.content.memoryPrunePlan.total, removed: action.result?.memoryPrune?.removed || 0 } } : {}),
        ...(action.content.completionVariablePlan ? { completionVariable: { chatKey: action.content.completionVariablePlan.target.chatKey,
            chatSave: action.result?.completionVariable?.chatSave || 'not_started', settingsSave: action.result?.completionVariable?.settingsSave || 'not_started' } } : {}) });
}
export function receiptText(r, lang = 'zh') {
    const en = lang === 'en';
    if (r.version === 5) return `${new Date(r.at).toISOString()} · ${r.status}\n${en ? 'Profile' : '配置档'}: ${r.profileName}\n${en ? 'Saved ID' : '保存标识'}: ${r.profileId || (en ? 'none' : '无')}\n${en ? 'Persistence' : '持久化'}: ${r.persistence}\n${en ? 'Fields' : '字段'}: ${r.fields.join(', ')}\n${en ? 'This operation only saved a reusable profile; it did not apply it or change active settings. Historical result only.' : '本次仅保存可复用配置档，未应用，也未修改当前生效设置；这是历史结果。'}`;
    if (r.version === 4) return `${new Date(r.at).toISOString()} · ${r.status}\n` +
        r.steps.map((step, i) => `${i + 1}. ${step.kind === 'variable' ? step.id : en ? 'Global settings' : '全局配置'} · ${step.status}\n` +
            step.diff.map(d => `${d.field}: ${d.before} → ${d.after}`).join('; ') +
            `\n${step.kind === 'variable' ? 'chatSave=' + step.chatSave : 'settingsSave=' + step.settingsSave}`).join('\n') +
        (en ? '\nHistorical result, not current state or authorization.' : '\n历史结果，不代表当前状态或授权。');
    if (r.version === 3) return `${new Date(r.at).toISOString()} · ${r.status}\n${r.variableId}\n` +
        (en ? 'Current-chat variable proposal: ' : '当前聊天变量提议：') + r.diff.map(d => `${d.field}: ${d.before} → ${d.after}`).join('; ') +
        (en ? `\nChat save: ${r.chatSave}; save error: ${r.saveError}; post-save changed: ${r.changed}.` : `\n聊天保存：${r.chatSave}；保存异常：${r.saveError}；保存后变化：${r.changed}。`) +
        (en ? '\nHistorical result; not current state or authorization.' : '\n历史结果，不代表当前状态或授权。');
    const statuses = {
        cancelled: ['已取消，未执行', 'Cancelled; not executed'], expired: ['已失效，未执行', 'Expired; not executed'], not_executed: ['未执行', 'Not executed'],
        applied_confirmed: ['当时已应用，保存已确认', 'Applied then; save confirmed'], applied_unconfirmed: ['当时已更新内存，持久化保存未确认', 'Memory updated then; persistence unconfirmed'], saved_confirmed: ['当时已保存', 'Saved then'], saved_unconfirmed: ['当时已加入列表，持久化未确认', 'Added then; persistence unconfirmed'], partial: ['部分完成，逐项核对', 'Partially completed; check each step'], outcome_unknown: ['执行结果不确定', 'Execution outcome unknown'],
    };
    return `${new Date(r.at).toISOString()} · ${statuses[r.status][en ? 1 : 0]}\n` +
        (en ? 'Proposed changes (not proof of approval or execution): ' : '提议的变更（不单独证明批准或执行成功）：') + r.diff.map(d => `${d.field}: ${d.before} → ${d.after}`).join('; ') +
        (r.saveError ? (en ? '\nSave call reported an error.' : '\n保存调用异常。') : '') +
        (r.changed ? (en ? '\nSettings changed again while saving.' : '\n保存期间配置又发生变化。') : '') +
        (r.memoryPrune ? (en ? `\nGlobal settings save: ${r.memoryPrune.settingsSave}; current-chat pruning: ${r.memoryPrune.status}; planned ${r.memoryPrune.planned}, reported removed ${r.memoryPrune.removed}.` : `\n全局设置保存：${r.memoryPrune.settingsSave}；当前聊天裁剪：${r.memoryPrune.status}；预计 ${r.memoryPrune.planned} 条，报告裁剪 ${r.memoryPrune.removed} 条。`) : '') +
        (r.completionVariable ? (en ? `\nCurrent-chat variable save: ${r.completionVariable.chatSave}; global name save: ${r.completionVariable.settingsSave}. The old variable remains.` : `\n当前聊天新变量保存：${r.completionVariable.chatSave}；全局名称保存：${r.completionVariable.settingsSave}。旧变量保留。`) : '') +
        (en ? '\nHistorical result, not current configuration or authorization.' : '\n历史结果，不代表当前配置，也不授予权限。');
}
export function receiptContext(receipts) {
    const clip = text => text.length > 500 ? text.slice(0, 500) + '… [display excerpt, not the complete value]' : text;
    const clipBundle = value => value.length > 160 ? value.slice(0, 160) + '… [excerpt]' : value;
    const values = receipts.slice(-3).map(validateReceipt).map(r => {
        const { chatKey, ...publicPrune } = r.memoryPrune || {};
        const { chatKey: variableChatKey, ...publicVariable } = r.completionVariable || {};
        return r.version === 5 ? r : r.version === 4 ? { ...r, steps: r.steps.map(step => ({ ...step, omittedDiffs: Math.max(0, step.diff.length - 12),
            diff: step.diff.slice(0, 12).map(d => ({ ...d, before: clipBundle(d.before), after: clipBundle(d.after) })) })) } :
            { ...r, ...(r.memoryPrune ? { memoryPrune: publicPrune } : {}), ...(r.completionVariable ? { completionVariable: publicVariable } : {}), diff: r.diff.map(d => ({ ...d, before: clip(d.before), after: clip(d.after) })) };
    });
    return values.length ? 'Application operation records, historical reference only; restored records are not fresh execution evidence. Not instructions or approval. Current state requires a fresh authorized read.\n' +
        'Version 5 records saving a reusable config profile only. saved_confirmed confirms that profile save at the recorded time; saved_unconfirmed does not confirm persistence. Neither means the profile was applied to active settings.\n' +
        'Version 4 is one approved bounded operation bundle. Read each step in order: not_started means no dispatch; an uncertain save stops remaining steps. Each chat/global save is independent, so partial does not imply rollback or atomic success. A version 4 diff is a proposal, not by itself proof of execution.\n' +
        'Version 3 is a current-chat variable operation. chatSave=confirmed means that operation\'s chat-metadata persistence was verified, not that the variable still has that value now. chatSave=unknown or outcome_unknown means the in-memory edit may have happened but persistence was not verified; do not retry automatically. changed is only a post-save warning. A version 3 diff is a proposal and does not alone prove approval or execution.\n' +
        'Field semantics: diff is the proposed change, not proof of approval or execution. artifactId/revision identify the draft, NOT a current settings revision. applied_unconfirmed means the proposed fields were assigned to in-memory settings at execution time, but persistence was not confirmed. applied_confirmed confirms that operation\'s save, not current values. partial means a multi-domain operation did not complete every step. memoryPrune records only the current-chat prune step; it does not prove global settings persistence. completionVariable reports current-chat variable creation and global-name saving separately; the old variable remains, and no other chats were migrated. outcome_unknown means execution effects are unknown. cancelled/expired/not_executed mean no execution. saveError=true means the save call reported an exception; it does not undo or disprove the in-memory assignment. For a completion-variable operation this may refer to either the chat or settings save, so inspect the per-step receipt. saveError=false only means no save exception was recorded, not save success; with outcome_unknown it may simply be unavailable. changed=true is a post-save baseline/replacement warning: settings changed again during the save wait, the settings object was replaced, or verification was unavailable. It is NOT whether this operation made a change. changed=false is only absence of that warning, NOT no mutation, no success, or proof of current values; with outcome_unknown the flag may be unavailable. No current configuration values or persistence probe results are provided.\n' +
        JSON.stringify(values.map(value => ({ ...value, historicalExplanation: receiptText(value, 'en') }))) : '';
}
