import { RUN_DEFAULTS, validateRunConfig } from '../core/budget.js';
export function createRunConfigStore({ getSettings, saveSettings }) {
    return {
        read() { try { return validateRunConfig(getSettings().muyuRunConfig); } catch { return { ...RUN_DEFAULTS }; } },
        async save(value) {
            const next = validateRunConfig(value), settings = getSettings(), previous = settings.muyuRunConfig;
            settings.muyuRunConfig = next;
            try { await saveSettings(); }
            catch { if (settings.muyuRunConfig === next) { if (previous === undefined) delete settings.muyuRunConfig; else settings.muyuRunConfig = previous; } throw Error('RUN_CONFIG_SAVE_FAILED'); }
            return { ...next };
        },
    };
}
