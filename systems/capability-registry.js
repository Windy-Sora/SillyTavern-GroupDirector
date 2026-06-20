/**
 * Capability Registry — multimodal capability registration system.
 *
 * Separate from AgentRegistry. Each capability describes WHAT it can do,
 * not HOW. The Execution Engine maps intents → capabilities → executors.
 *
 * Capability = { id, displayName, description, schema, executor, constraints }
 */

const capabilities = new Map();

export const CapabilityRegistry = {
    register(cap) {
        if (!cap || !cap.id) throw new Error('Capability must have an id');
        if (!cap.executor || typeof cap.executor !== 'function') {
            throw new Error(`Capability "${cap.id}" must have an executor function`);
        }
        capabilities.set(cap.id, {
            id: cap.id,
            displayName: cap.displayName || cap.id,
            description: cap.description || '',
            // Guidance for the LLM: when to trigger this capability and how to decide params
            promptHint: cap.promptHint || '',
            // JSON Schema describing what params this capability accepts
            schema: cap.schema || {},
            // Async executor: (params) => { ... } — abstract, not ST-specific
            executor: cap.executor,
            // Constraints: { maxPerMessage, requires, cooldown }
            constraints: Object.assign({ maxPerMessage: 1, cooldown: 0 }, cap.constraints),
            enabled: cap.enabled !== false,
        });
    },

    get(id) {
        return capabilities.get(id);
    },

    list() {
        return [...capabilities.values()];
    },

    /** List only enabled capabilities — used for LLM prompt injection. */
    listEnabled() {
        return [...capabilities.values()]
            .filter(c => c.enabled)
            .map(c => ({ id: c.id, displayName: c.displayName, description: c.description, promptHint: c.promptHint, schema: c.schema }));
    },

    /** Enable/disable a capability at runtime. */
    setEnabled(id, enabled) {
        const c = capabilities.get(id);
        if (c) c.enabled = !!enabled;
    },

    /** Last-used timestamps for cooldown tracking. */
    _cooldowns: {},
};
