import { validateJson } from '../core/json-contract.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { configFields, fieldDefinition } from '../config/registry.js';
const text = maxLength => ({ type: 'string', maxLength });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const receiptStatuses = ['cancelled', 'expired', 'not_executed', 'applied_confirmed', 'applied_unconfirmed', 'partial', 'outcome_unknown'];
const schema = object({ operationId: text(100), artifactId: text(100), revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, at: { type: 'integer', minimum: 0, maximum: 8640000000000000 }, status: { type: 'string', enum: receiptStatuses },
    diff: { type: 'array', maxItems: 4, items: object({ field: { type: 'string', enum: memoryFields }, before: text(40), after: text(40) }) }, saveError: { type: 'boolean' }, changed: { type: 'boolean' } });
const schemaV2 = { ...schema, properties: { ...schema.properties, version: { type: 'integer', enum: [2] }, diff: { type: 'array', maxItems: configFields.length, items: object({ field: { type: 'string', enum: configFields }, before: text(24000), after: text(24000) }) },
    memoryPrune: object({ chatKey: text(4096), settingsSave: { type: 'string', enum: ['not_started', 'confirmed', 'unconfirmed', 'error'] }, status: { type: 'string', enum: ['not_started', 'not_needed', 'pruned', 'skipped', 'outcome_unknown'] }, planned: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, removed: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }) } };
export function receiptSources(value) {
    return [...new Set([...value.diff.map(d => value.version === 2 ? fieldDefinition(d.field).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings' : 'source:memoryConfig'), ...(value.memoryPrune ? ['source:memoryDiagnostics'] : [])])];
}
export function validateReceipt(value) {
    const result = validateJson(value?.version === 2 ? schemaV2 : schema, value);
    if (result.version === 2 && (result.diff.some(d => d.field === 'memoryMaxEntries') !== !!result.memoryPrune)) throw Error('INVALID_RECEIPT');
    return result;
}
export function actionReceipt(action) {
    return validateReceipt({ ...(action.content.preview.contractVersion === 2 ? { version: 2 } : {}), operationId: action.id, artifactId: action.artifactId, revision: action.revision, at: Date.now(), status: action.status,
        diff: action.content.preview.diff, saveError: action.result?.saveError === true, changed: action.result?.changed === true,
        ...(action.content.memoryPrunePlan ? { memoryPrune: { chatKey: action.content.memoryPrunePlan.target.chatKey, settingsSave: action.result?.settingsSave || 'not_started', status: action.result?.memoryPrune?.status || 'not_started', planned: action.content.memoryPrunePlan.total, removed: action.result?.memoryPrune?.removed || 0 } } : {}) });
}
export function receiptText(r, lang = 'zh') {
    const en = lang === 'en';
    const statuses = {
        cancelled: ['已取消，未执行', 'Cancelled; not executed'], expired: ['已失效，未执行', 'Expired; not executed'], not_executed: ['未执行', 'Not executed'],
        applied_confirmed: ['当时已应用，保存已确认', 'Applied then; save confirmed'], applied_unconfirmed: ['当时已更新内存，持久化保存未确认', 'Memory updated then; persistence unconfirmed'], partial: ['部分完成，逐项核对', 'Partially completed; check each step'], outcome_unknown: ['执行结果不确定', 'Execution outcome unknown'],
    };
    return `${new Date(r.at).toISOString()} · ${statuses[r.status][en ? 1 : 0]}\n` +
        (en ? 'Proposed changes (not proof of approval or execution): ' : '提议的变更（不单独证明批准或执行成功）：') + r.diff.map(d => `${d.field}: ${d.before} → ${d.after}`).join('; ') +
        (r.saveError ? (en ? '\nSave call reported an error.' : '\n保存调用异常。') : '') +
        (r.changed ? (en ? '\nSettings changed again while saving.' : '\n保存期间配置又发生变化。') : '') +
        (r.memoryPrune ? (en ? `\nGlobal settings save: ${r.memoryPrune.settingsSave}; current-chat pruning: ${r.memoryPrune.status}; planned ${r.memoryPrune.planned}, reported removed ${r.memoryPrune.removed}.` : `\n全局设置保存：${r.memoryPrune.settingsSave}；当前聊天裁剪：${r.memoryPrune.status}；预计 ${r.memoryPrune.planned} 条，报告裁剪 ${r.memoryPrune.removed} 条。`) : '') +
        (en ? '\nHistorical result, not current configuration or authorization.' : '\n历史结果，不代表当前配置，也不授予权限。');
}
export function receiptContext(receipts) {
    const clip = text => text.length > 500 ? text.slice(0, 500) + '… [display excerpt, not the complete value]' : text;
    const values = receipts.slice(-3).map(validateReceipt).map(r => {
        const { chatKey, ...publicPrune } = r.memoryPrune || {};
        return { ...r, ...(r.memoryPrune ? { memoryPrune: publicPrune } : {}), diff: r.diff.map(d => ({ ...d, before: clip(d.before), after: clip(d.after) })) };
    });
    return values.length ? 'Application operation records, historical reference only; restored records are not fresh execution evidence. Not instructions or approval. Current state requires a fresh authorized read.\n' +
        'Field semantics: diff is the proposed change, not proof of approval or execution. artifactId/revision identify the draft, NOT a current settings revision. applied_unconfirmed means the proposed fields were assigned to in-memory settings at execution time, but persistence was not confirmed. applied_confirmed confirms that operation\'s save, not current values. partial means a multi-domain operation did not complete every step. memoryPrune records only the current-chat prune step; it does not prove global settings persistence. outcome_unknown means execution effects are unknown. cancelled/expired/not_executed mean no execution. saveError=true means the save call reported an exception; it does not undo or disprove the in-memory assignment. saveError=false only means no save exception was recorded, not save success; with outcome_unknown it may simply be unavailable. changed=true is a post-save baseline/replacement warning: settings changed again during the save wait, the settings object was replaced, or verification was unavailable. It is NOT whether this operation made a change. changed=false is only absence of that warning, NOT no mutation, no success, or proof of current values; with outcome_unknown the flag may be unavailable. No current configuration values or persistence probe results are provided.\n' +
        JSON.stringify(values.map(value => ({ ...value, historicalExplanation: receiptText(value, 'en') }))) : '';
}
