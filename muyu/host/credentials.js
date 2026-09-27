const ID = 'muyu-assistant';
/** Opt-in extension setting; existing agentConfigs export paths strip apiKey. Not encryption. */
export function createCredentialStore({ getSettings, saveSettings }) {
    const stored = () => getSettings().agentConfigs?.[ID];
    return Object.freeze({
        describe() {
            const c = stored();
            return c?.apiKey ? { endpoint: c.endpoint, model: c.model, thinking: c.thinking !== false, remembered: true } : null;
        },
        resolve(config) {
            const saved = stored();
            if (config.apiKey) return config.apiKey;
            if (saved?.apiKey && saved.endpoint === config.endpoint) return saved.apiKey;
            return '';
        },
        async save(config) {
            const settings = getSettings(), previous = settings.agentConfigs?.[ID];
            settings.agentConfigs ||= {};
            const next = config ? { endpoint: config.endpoint, model: config.model, thinking: config.thinking !== false, apiKey: config.apiKey } : undefined;
            if (next) settings.agentConfigs[ID] = next; else delete settings.agentConfigs[ID];
            try { await saveSettings(); }
            catch {
                if (settings.agentConfigs[ID] === next) { if (previous) settings.agentConfigs[ID] = previous; else delete settings.agentConfigs[ID]; }
                throw Error('CREDENTIAL_SAVE_FAILED');
            }
        },
    });
}
