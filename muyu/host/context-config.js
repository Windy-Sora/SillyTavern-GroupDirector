import { CONTEXT_DEFAULTS, validateContextConfig } from '../context/policy.js';
export function createContextConfigStore({ getSettings, saveSettings }) {
    return {
        read() { try { return validateContextConfig(getSettings().muyuContextConfig); } catch { return { ...CONTEXT_DEFAULTS }; } },
        async save(value) {
            const next = validateContextConfig(value), settings = getSettings(), previous = settings.muyuContextConfig;
            settings.muyuContextConfig = next;
            try { await saveSettings(); }
            catch { if (settings.muyuContextConfig === next) { if (previous === undefined) delete settings.muyuContextConfig; else settings.muyuContextConfig = previous; } throw Error('CONTEXT_CONFIG_SAVE_FAILED'); }
            return { ...next };
        },
    };
}
