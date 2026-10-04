import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { configChangesSchema, dependencyFields, previewSettings, readSettingsFields } from '../config/registry.js';
import { variablePreviewSchema } from '../modules/variables/index.js';
import { settingsSwitchFields } from '../config/settings-switch-rules.js';

const excludedSettings = new Set(['memoryMaxEntries', 'storyBlueprintCompletionVariable', 'storyBlueprintEnabled', ...settingsSwitchFields]);
export const scriptBundleRequestSchema = { type: 'object', properties: {
    operation: { type: 'string', enum: ['create', 'update', 'delete'] }, id: { type: 'string', maxLength: 100 }, revision: { type: 'string', maxLength: 80 },
    changesJson: { type: 'string', maxLength: 32000 },
}, required: ['operation', 'changesJson'], additionalProperties: false };
export const taskBundleSchema = { type: 'object', properties: {
    settings: configChangesSchema,
    scripts: { type: 'array', items: scriptBundleRequestSchema, maxItems: 3 },
    variables: { type: 'array', items: variablePreviewSchema, maxItems: 6 },
}, additionalProperties: false };

/** A complete, bounded proposal. Tokens and baselines stay in this trusted page lifetime. */
export function createTaskBundleDraftPort({ getTarget, getSettings, variableDraftPort, scriptPort }) {
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
            const requests = args.variables || [], changes = args.settings || {}, scriptRequests = args.scripts || [];
            if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target) ||
                !requests.length && !Object.keys(changes).length && !scriptRequests.length ||
                new Set(requests.map(row => row.id)).size !== requests.length) throw Error('INVALID_TASK_BUNDLE');
            const variables = [];
            try {
                const settings = settingsPart(changes);
                if (scriptRequests.length && !scriptPort) throw Error('WRITE_UNAVAILABLE');
                const scripts = scriptRequests.map(request => scriptPort.preview({ ...request, changes: JSON.parse(request.changesJson) }));
                const ids = scripts.filter(row => row.id).map(row => row.id), names = scripts.filter(row => row.next).map(row => row.next.name);
                if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) throw Error('INVALID_TASK_BUNDLE');
                for (const request of requests) variables.push(variableDraftPort.prepare(target, request));
                const content = copyJson({ module: 'task-bundle', version: scripts.length ? 2 : 1, target, settings, variables, ...(scripts.length ? { scripts } : {}),
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
                for (const script of content.scripts || []) scriptPort.assertDraft(script);
                if (content.settings && jsonKey(settingsPart(content.settings.changes)) !== jsonKey(content.settings)) throw Error('STALE_TASK_BUNDLE');
            } catch { throw Error('STALE_TASK_BUNDLE'); }
            return copyJson(content);
        },
        forget,
        clear() { for (const content of drafts.values()) forget(content); drafts.clear(); },
    });
}
