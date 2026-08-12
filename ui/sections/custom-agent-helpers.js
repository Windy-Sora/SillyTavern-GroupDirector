export function toBoundedInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function matchesDataId(value, id) {
    return String(value) === String(id);
}

export function normalizeImportedAgent(agent, id) {
    return {
        id,
        name: String(agent.name).trim(),
        providerName: String(agent.providerName).trim(),
        prompt: typeof agent.prompt === 'string' ? agent.prompt : '',
        schema: typeof agent.schema === 'string' ? agent.schema : '',
        enabled: false,
        autoEnabled: false,
        autoInterval: toBoundedInt(agent.autoInterval, 10, 1, 200),
        order: toBoundedInt(agent.order, 0, 0, 999),
    };
}
