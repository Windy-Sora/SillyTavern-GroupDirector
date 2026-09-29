const ID = 'muyu-assistant';
/** Opt-in extension setting; existing agentConfigs export paths strip apiKey. Not encryption. */
export function createCredentialStore({ getSettings, saveSettings }) {
    const stored = () => getSettings().agentConfigs?.[ID];
    return Object.freeze({
        describe() {
            const c = stored();
            return c?.apiKey ? { endpoint: c.endpoint, model: c.model, thinking: c.thinking !== false, remembered: true, autoConnect: c.autoConnect === true } : null;
        },
        restoreAutoConnection() {
            const c = stored();
            return c?.apiKey && c.autoConnect === true ? { endpoint: c.endpoint, model: c.model, thinking: c.thinking !== false, apiKey: c.apiKey, profile: 'deepseek', supportsTools: true } : null;
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
            const next = config ? { endpoint: config.endpoint, model: config.model, thinking: config.thinking !== false, apiKey: config.apiKey, autoConnect: config.autoConnect === true } : undefined;
            if (next) settings.agentConfigs[ID] = next; else delete settings.agentConfigs[ID];
            try { await saveSettings(); }
            catch {
                if (settings.agentConfigs[ID] === next) { if (previous) settings.agentConfigs[ID] = previous; else delete settings.agentConfigs[ID]; }
                throw Error('CREDENTIAL_SAVE_FAILED');
            }
        },
        async setAutoConnect(value) {
            const c = stored();
            if (!c?.apiKey || c.autoConnect !== true && value !== true) return;
            await this.save({ ...c, autoConnect: value === true });
        },
    });
}
