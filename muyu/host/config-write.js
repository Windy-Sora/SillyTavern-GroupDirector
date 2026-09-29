import { jsonKey } from '../core/json-contract.js';
import { memoryFields } from '../modules/config-draft/contracts.js';
import { readConfigBaseline, previewMemoryConfig } from '../modules/config-draft/preview.js';
import { dependencyFields, readSettingsFields, previewSettings, assertWritable, assignSettingsFields } from '../config/registry.js';

/** Trusted, narrow host port. No model tool or whole-settings restore. */
export function createConfigWriter({ getSettings, saveSettings, isBusy, memoryLimitPort, completionVariablePort, changed: notify = () => {} }) {
    return Object.freeze({
        async apply({ baseline, changes, contractVersion = 1, memoryPrunePlan = null, completionVariablePlan = null }) {
            if (typeof saveSettings !== 'function') throw Error('WRITE_UNAVAILABLE');
            if (![1, 2].includes(contractVersion)) throw Error('WRITE_UNAVAILABLE');
            const settings = getSettings();
            const fields = contractVersion === 2 ? dependencyFields(Object.keys(changes)) : memoryFields;
            const read = () => contractVersion === 2 ? readSettingsFields(settings, fields) : readConfigBaseline(settings);
            if (jsonKey(read()) !== jsonKey(baseline)) throw Error('STALE_BASELINE');
            const preview = contractVersion === 2 ? previewSettings({ baseline, changes }) : previewMemoryConfig({ baseline, changes, allowedFields: memoryFields });
            const patch = preview.manifest.settings;
            if (!Object.keys(patch).length) throw Error('EMPTY_CHANGES');
            const changingLimit = Object.hasOwn(patch, 'memoryMaxEntries');
            const changingCompletion = Object.hasOwn(patch, 'storyBlueprintCompletionVariable');
            if (changingLimit ? contractVersion !== 2 || Object.keys(patch).length !== 1 || !memoryPrunePlan || memoryPrunePlan.max !== patch.memoryMaxEntries || !memoryLimitPort : !!memoryPrunePlan) throw Error('WRITE_UNAVAILABLE');
            if (changingCompletion ? contractVersion !== 2 || Object.keys(patch).length !== 1 || !completionVariablePlan || completionVariablePlan.oldId !== baseline.storyBlueprintCompletionVariable || completionVariablePlan.newId !== patch.storyBlueprintCompletionVariable || !completionVariablePort : !!completionVariablePlan) throw Error('WRITE_UNAVAILABLE');
            if (contractVersion === 2) assertWritable(settings, Object.keys(patch), isBusy);
            if (changingLimit) memoryLimitPort.assertFresh(memoryPrunePlan);
            if (changingCompletion) {
                completionVariablePort.assertFresh(completionVariablePlan);
                try { await completionVariablePort.create(completionVariablePlan); }
                catch { return { status: 'outcome_unknown', saveError: true, changed: false,
                    completionVariable: { chatSave: 'unknown', settingsSave: 'not_started' } }; }
                if (getSettings() !== settings || jsonKey(read()) !== jsonKey(baseline) || isBusy?.()) {
                    return { status: 'partial', saveError: false, changed: true,
                        completionVariable: { chatSave: 'confirmed', settingsSave: 'not_started' } };
                }
            }
            // No await between baseline check and the bounded synchronous write.
            if (contractVersion === 2) assignSettingsFields(settings, patch);
            else for (const field of Object.keys(patch)) settings[field] = patch[field];
            if (changingCompletion) settings.storyBlueprintCompletionVariableGuard = patch.storyBlueprintCompletionVariable;
            try { notify(Object.keys(patch)); } catch { /* A UI observer cannot change the write outcome. */ }
            let receipt, saveError = false;
            try { receipt = await saveSettings(); } catch { saveError = true; }
            let changed = true;
            try { changed = getSettings() !== settings || jsonKey(read()) !== jsonKey({ ...baseline, ...patch }); } catch { /* Unknown current state. */ }
            let memoryPrune = null;
            if (changingLimit) {
                if (saveError || changed || isBusy?.()) memoryPrune = { status: 'skipped', removed: 0 };
                else {
                    try { memoryPrune = await memoryLimitPort.prune(memoryPrunePlan); }
                    catch { memoryPrune = { status: 'skipped', removed: 0 }; }
                }
                memoryLimitPort.forget(memoryPrunePlan);
            }
            // Undefined or an uncorrelated global event is not a persistence receipt.
            const settingsSave = saveError ? 'error' : receipt?.confirmed === true ? 'confirmed' : 'unconfirmed';
            return { status: (memoryPrune && !['pruned', 'not_needed'].includes(memoryPrune.status)) || (changingCompletion && (saveError || changed)) ? 'partial' : receipt?.confirmed === true && !saveError ? 'applied_confirmed' : 'applied_unconfirmed', saveError, changed,
                ...(memoryPrune ? { memoryPrune, settingsSave } : {}),
                ...(changingCompletion ? { completionVariable: { chatSave: 'confirmed', settingsSave } } : {}) };
        },
    });
}
