import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { memoryFieldSchemas } from '../modules/config-draft/contracts.js';
import { directorRuleDefinitions, formulaRuleDefinitions } from './speaker-rules.js';
import { summaryRuleDefinitions } from './summary-rules.js';
import { critiqueRuleDefinitions } from './critique-rules.js';
import { inspectCritiqueTemplate } from './critique-template.js';
import { profileRuleDefinitions } from './profile-rules.js';
import { npcRuleDefinitions } from './npc-rules.js';
import { worldBookRuleDefinitions } from './world-book-rules.js';
import { memoryRuleDefinitions } from './memory-rules.js';

// Registered leaf paths only. This is not an arbitrary settings-path writer.
const integer = minimum => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const definitions = {
    ...Object.fromEntries(Object.entries(memoryFieldSchemas).map(([id, schema]) => [id, { domain: 'memory', schema, dependencies: ['memoryEnabled', 'autoMemoryEnabled'] }])),
    ...memoryRuleDefinitions,
    memoryMaxEntries: { domain: 'memory', schema: { type: 'integer', minimum: 10, maximum: 2000 }, idle: true, source: 'ui/sections/memory.js', description: '每角色保留条数上限。仅可单独预览和批准；调低会在当前聊天裁剪各角色最旧的超额记忆，且影响所有聊天后续记忆生成与导入。全局设置保存与当前聊天裁剪是两个保存域，可能部分完成；本工具范围 10..2000，原界面输入处理仅强制下限。' },
    mode: { domain: 'director', schema: { type: 'string', enum: ['off', 'formula', 'llm'] }, idle: true },
    topN: { domain: 'director', schema: { type: 'integer', minimum: 1, maximum: 20 }, idle: true },
    llmMaxSpeakers: { domain: 'director', schema: { type: 'integer', minimum: 1, maximum: 20 }, idle: true },
    ...directorRuleDefinitions,
    ...Object.fromEntries(['mention', 'keyword', 'recency', 'talkativeness'].map(key => [`scoreWeights.${key}`, { domain: 'scoring', schema: integer(key === 'talkativeness' ? 1 : 0), idle: true }])),
    ...formulaRuleDefinitions,
    ...summaryRuleDefinitions,
    ...critiqueRuleDefinitions,
    ...profileRuleDefinitions,
    ...npcRuleDefinitions,
    ...worldBookRuleDefinitions,
    llmPrompt: { domain: 'prompt', schema: { type: 'string', maxLength: 4000 }, idle: true },
    providerTimeoutMs: { domain: 'provider', schema: integer(0) },
};
export const configFields = Object.freeze(Object.keys(definitions));
export const configDomains = Object.freeze(['memory', 'director', 'scoring', 'prompt', 'provider', 'summary', 'critique', 'profiles', 'npc', 'worldBook']);
export const configChangesSchema = { type: 'object', properties: Object.fromEntries(configFields.map(id => [id, definitions[id].schema])), additionalProperties: false };
export function fieldDefinition(id) {
    if (!Object.hasOwn(definitions, id)) throw Error('UNKNOWN_CONFIG_FIELD');
    const notes = {
        memory: '记忆开关/自动提取参数。interval单位为新增消息条数，1..200是本工具支持范围，不是运行时强制上限。缺失保持未知，不自动补开开关。',
        director: 'off关闭、formula公式、llm导演模型。topN用于公式模式，llmMaxSpeakers用于LLM模式。人数1..20与快捷操作一致；生成中不可修改。',
        scoring: '评分权重，按单个叶字段修改，保留其他权重；生成中不可修改。',
        prompt: '导演提示词原文，不是JSON Schema。空串沿用插件缺省提示词。最多4000字符；超出草稿DTO字节预算则拒绝，不截断保存。生成中不可修改。',
        provider: '毫秒；0表示不超时。保存入口同步默认渲染超时，只影响后续调用，不中断正在执行的Provider。',
    };
    return copyJson({ id, scope: 'global', applies: 'next-use', description: notes[definitions[id].domain], source: definitions[id].domain === 'scoring' ? 'ui/sections/formula.js' : definitions[id].domain === 'memory' ? 'ui/sections/memory.js' : 'ui/sections/director.js', ...definitions[id] });
}
export function selectedFields(fields) {
    if (!Array.isArray(fields) || !fields.length || fields.length > configFields.length || new Set(fields).size !== fields.length) throw Error('INVALID_CONFIG_FIELDS');
    fields.forEach(fieldDefinition); return fields;
}
export function dependencyFields(fields) {
    return [...new Set(selectedFields(fields).flatMap(id => [id, ...(definitions[id].dependencies || [])]))].sort();
}
function leaf(settings, field) {
    let value = settings;
    for (const key of field.split('.')) {
        if (value === undefined) return undefined;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('UNSUPPORTED_BASELINE');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) return undefined;
        if (!Object.hasOwn(descriptor, 'value')) throw Error('UNSUPPORTED_BASELINE');
        value = descriptor.value;
    }
    return value;
}
export function readSettingsFields(settings, fields) {
    const result = {};
    for (const field of selectedFields(fields)) {
        const value = leaf(settings, field);
        if (value !== undefined) result[field] = copyJson(value);
    }
    return copyJson(result);
}
export function projectBaseline(baseline, fields) {
    return copyJson(Object.fromEntries(selectedFields(fields).filter(id => Object.hasOwn(baseline, id)).map(id => [id, baseline[id]])));
}
export function previewSettings({ baseline, changes, allowEmpty = false }) {
    const patch = validateJson(configChangesSchema, changes), keys = Object.keys(patch);
    if (!keys.length) throw Error('EMPTY_CHANGES');
    const critiqueTemplate = keys.includes('critiqueSchema') ? inspectCritiqueTemplate(patch.critiqueSchema) : null;
    const observed = projectBaseline(baseline, dependencyFields(keys));
    const diff = keys.filter(id => !Object.hasOwn(observed, id) || jsonKey(observed[id]) !== jsonKey(patch[id])).map(field => ({ field, before: Object.hasOwn(observed, field) ? JSON.stringify(observed[field]) : '(missing)', after: JSON.stringify(patch[field]) }));
    if (!diff.length && !allowEmpty) throw Error('NO_EFFECTIVE_CHANGE');
    const effective = { ...observed, ...patch }, warnings = [];
    if (keys.some(id => definitions[id].domain === 'memory' && id !== 'memoryMaxEntries')) {
        if (effective.memoryEnabled !== true) warnings.push('MEMORY_NOT_ENABLED');
        if (keys.some(id => id !== 'memoryKeepRecent') && effective.autoMemoryEnabled !== true) warnings.push('AUTO_NOT_ENABLED');
    }
    if (keys.some(id => Object.hasOwn(formulaRuleDefinitions, id)) && effective.mode !== 'formula') warnings.push('FORMULA_MODE_INACTIVE');
    if (keys.some(id => Object.hasOwn(directorRuleDefinitions, id) && id === 'llmRespectOrder') && effective.mode !== 'llm') warnings.push('LLM_ORDER_MODE_INACTIVE');
    if (keys.includes('triggerScore') && effective.triggerEnabled !== true) warnings.push('TRIGGER_DISABLED');
    if (keys.includes('initiativeBaseScore') && effective.initiativeEnabled !== true) warnings.push('INITIATIVE_DISABLED');
    if (keys.includes('llmCharDescLength') && effective.llmCharDescMode !== 'slice') warnings.push('CHAR_DESC_NOT_SLICED');
    if (keys.some(id => id !== 'summaryEnabled' && Object.hasOwn(summaryRuleDefinitions, id)) && effective.summaryEnabled !== true) warnings.push('SUMMARY_DISABLED');
    if (keys.includes('autoSummaryInterval') && effective.autoSummaryEnabled !== true) warnings.push('AUTO_SUMMARY_DISABLED');
    if (keys.some(id => id !== 'critiqueEnabled' && Object.hasOwn(critiqueRuleDefinitions, id)) && effective.critiqueEnabled !== true) warnings.push('CRITIQUE_DISABLED');
    if (keys.includes('autoCritiqueInterval') && effective.autoCritiqueEnabled !== true) warnings.push('AUTO_CRITIQUE_DISABLED');
    if (critiqueTemplate?.nonstandard) warnings.push('CRITIQUE_OUTPUT_EXAMPLE_NONSTANDARD_FIELDS');
    if (keys.some(id => id !== 'profileEnabled' && Object.hasOwn(profileRuleDefinitions, id)) && effective.profileEnabled !== true) warnings.push('PROFILES_DISABLED');
    if (keys.includes('profileConcurrency') && effective.profileConcurrency === 0) warnings.push('PROFILE_UNBOUNDED_CONCURRENCY');
    if (keys.some(id => id !== 'npcEnabled' && Object.hasOwn(npcRuleDefinitions, id)) && effective.npcEnabled !== true) warnings.push('NPC_DISABLED');
    if (keys.some(id => id === 'npcMaxCount' || id === 'npcBatchSize') && effective.npcBatchSize > effective.npcMaxCount) warnings.push('NPC_BATCH_CLAMPED');
    if (keys.includes('worldBookSourceMode') && effective.worldBookSourceMode === 'manual') warnings.push('WORLD_BOOK_MANUAL_SELECTION_REQUIRED');
    return copyJson({ contractVersion: 2, scope: 'global', structural: 'passed', range: 'passed', semantic: warnings.length ? 'warnings' : 'passed', intent: 'requires_user_review', warnings, diff,
        manifest: { type: 'settings-patch', version: 2, settings: Object.fromEntries(diff.map(d => [d.field, patch[d.field]])) }, notice: '仅预览，未应用。影响所有聊天；仅修改列出的字段。Prompt 最多4000字符，整份草稿仍受DTO字节预算限制。' });
}
export function assertWritable(settings, fields, isBusy) {
    selectedFields(fields);
    if (fields.some(id => definitions[id].idle) && (typeof isBusy !== 'function' || isBusy())) throw Error('WRITE_UNAVAILABLE');
    for (const field of fields) {
        const parts = field.split('.'); let owner = settings;
        for (const part of parts.slice(0, -1)) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, part);
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.value || typeof descriptor.value !== 'object' || Array.isArray(descriptor.value)) throw Error('WRITE_UNAVAILABLE');
            owner = descriptor.value;
        }
        const d = Object.getOwnPropertyDescriptor(owner, parts.at(-1));
        if (d ? !Object.hasOwn(d, 'value') || !d.writable : !Object.isExtensible(owner)) throw Error('WRITE_UNAVAILABLE');
    }
}
export function assignSettingsFields(settings, changes) {
    for (const [field, value] of Object.entries(changes)) {
        const parts = field.split('.'); let owner = settings;
        for (const part of parts.slice(0, -1)) owner = owner[part];
        owner[parts.at(-1)] = value;
    }
}
