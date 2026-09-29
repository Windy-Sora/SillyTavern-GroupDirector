import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { configChangesSchema, dependencyFields, previewSettings, readSettingsFields } from '../config/registry.js';
import { variablePreviewSchema } from '../modules/variables/index.js';

const excludedSettings = new Set(['memoryMaxEntries', 'storyBlueprintCompletionVariable']);
export const taskBundleSchema = { type: 'object', properties: {
    settings: configChangesSchema,
    variables: { type: 'array', items: variablePreviewSchema, maxItems: 6 },
}, additionalProperties: false };

/** A complete, bounded proposal. Tokens and baselines stay in this trusted page lifetime. */
export function createTaskBundleDraftPort({ getTarget, getSettings, variableDraftPort }) {
    const drafts = new Map();
    function settingsPart(changes) {
        if (!Object.keys(changes).length) return null;
        if (Object.keys(changes).some(key => excludedSettings.has(key))) throw Error('BUNDLE_SETTING_REQUIRES_SEPARATE_DRAFT');
        const fields = dependencyFields(Object.keys(changes)), settings = getSettings();
        const baseline = readSettingsFields(settings, fields);
        if (settings !== getSettings() || jsonKey(baseline) !== jsonKey(readSettingsFields(settings, fields))) throw Error('STALE_BASELINE');
        return copyJson({ baseline, changes, preview: previewSettings({ baseline, changes }) });
    }
    function forget(content) {
        for (const variable of content?.variables || []) variableDraftPort.forget(variable);
        if (content?.token) drafts.delete(content.token);
    }
    return Object.freeze({
        prepare(target, input) {
            const args = validateJson(taskBundleSchema, input);
            const requests = args.variables || [], changes = args.settings || {};
            if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target) ||
                !requests.length && !Object.keys(changes).length ||
                new Set(requests.map(row => row.id)).size !== requests.length) throw Error('INVALID_TASK_BUNDLE');
            const variables = [];
            try {
                const settings = settingsPart(changes);
                for (const request of requests) variables.push(variableDraftPort.prepare(target, request));
                const content = copyJson({ module: 'task-bundle', version: 1, target, settings, variables,
                    token: 'bundle:' + crypto.randomUUID() });
                if (new TextEncoder().encode(JSON.stringify(content)).length > 18000) throw Error('BUNDLE_TOO_LARGE');
                if (drafts.size >= 64) forget(drafts.values().next().value);
                drafts.set(content.token, content);
                return copyJson(content);
            } catch (error) { for (const variable of variables) variableDraftPort.forget(variable); throw error; }
        },
        assertFresh(content) {
            const saved = drafts.get(content?.token);
            if (!saved || jsonKey(saved) !== jsonKey(content) || jsonKey(getTarget()) !== jsonKey(content.target)) throw Error('STALE_TASK_BUNDLE');
            try {
                for (const variable of content.variables) variableDraftPort.assertFresh(variable);
                if (content.settings && jsonKey(settingsPart(content.settings.changes)) !== jsonKey(content.settings)) throw Error('STALE_TASK_BUNDLE');
            } catch { throw Error('STALE_TASK_BUNDLE'); }
            return copyJson(content);
        },
        forget,
        clear() { for (const content of drafts.values()) forget(content); drafts.clear(); },
    });
}
