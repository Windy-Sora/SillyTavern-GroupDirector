/**
 * Execution Engine — resolves Post LLM policy intents into capability
 * executions, then schedules and dispatches them.
 *
 * Flow: policy → resolve → schedule → dispatch
 *
 * Does NOT know ST internals. Capability executors handle ST integration.
 */

import { CapabilityRegistry } from './capability-registry.js';

/**
 * @typedef {Object} Policy
 * @property {Array<{ type: string, params?: Object }>} intents
 * @property {string} [timing] — 'immediate' | 'deferred'
 * @property {number} [delay] — ms delay for deferred mode
 */

/**
 * Resolve intents to concrete capability executions.
 * An intent like { type: "emotion", params: { mood: "angry" } }
 * maps to any capability that can satisfy "emotion" type.
 *
 * @param {Policy} policy - LLM output
 * @returns {Array<{ capabilityId, params, executor }>}
 */
function resolve(policy) {
    if (!policy || !Array.isArray(policy.intents)) return [];

    const allCapabilities = CapabilityRegistry.list().filter(c => c.enabled);
    const actions = [];

    for (const intent of policy.intents) {
        const intentType = (intent.type || intent.intent || '').toLowerCase().trim();
        if (!intentType) continue;

        // Find capabilities that can satisfy this intent type.
        // Matching: capability.id includes intentType, OR capability
        // explicitly declares support for this intent in its schema.
        const matches = allCapabilities.filter(c =>
            c.id.toLowerCase() === intentType ||
            c.id.toLowerCase().includes(intentType) ||
            (c.schema?.intents && c.schema.intents.includes(intentType))
        );

        for (const cap of matches) {
            // Cooldown check
            const now = Date.now();
            const lastUsed = CapabilityRegistry._cooldowns[cap.id] || 0;
            if (cap.constraints.cooldown > 0 && (now - lastUsed) < cap.constraints.cooldown) {
                continue;
            }
            actions.push({
                capabilityId: cap.id,
                params: intent.params || {},
                executor: cap.executor,
            });
        }
    }

    return actions;
}

/**
 * Schedule actions based on timing policy.
 *
 * @param {Array} actions - Resolved actions from resolve()
 * @param {Object} timing - { mode: 'immediate'|'deferred', delay: number }
 * @returns {Array<{ action, delay: number }>}
 */
function schedule(actions, timing = {}) {
    const mode = timing.mode || 'immediate';
    const baseDelay = timing.delay || 0;

    if (mode === 'immediate') {
        return actions.map(a => ({ action: a, delay: 0 }));
    }

    // Deferred: stagger each action
    return actions.map((action, i) => ({
        action,
        delay: baseDelay + (i * 200),
    }));
}

/**
 * Dispatch scheduled actions.
 *
 * @param {Array} scheduled - Output of schedule()
 * @param {boolean} blocking - If true, await each action sequentially.
 *   If false, fire-and-forget (async in background).
 * @returns {Promise<Array<{ capabilityId, success: boolean, error?: string }>>}
 */
async function dispatch(scheduled, blocking = false) {
    const results = [];

    const executeOne = async ({ action, delay }) => {
        if (delay > 0) {
            await new Promise(r => setTimeout(r, delay));
        }
        try {
            CapabilityRegistry._cooldowns[action.capabilityId] = Date.now();
            await action.executor(action.params);
            return { capabilityId: action.capabilityId, success: true };
        } catch (e) {
            console.warn(`[ExecutionEngine] ${action.capabilityId} failed:`, e.message);
            return { capabilityId: action.capabilityId, success: false, error: e.message };
        }
    };

    if (blocking) {
        for (const s of scheduled) {
            results.push(await executeOne(s));
        }
    } else {
        // Fire-and-forget: don't await, collect results via Promise.allSettled
        const promises = scheduled.map(s => executeOne(s));
        Promise.allSettled(promises).catch(() => {});
        // Return immediately with pending status
        for (const s of scheduled) {
            results.push({ capabilityId: s.action.capabilityId, success: true, pending: true });
        }
    }

    return results;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Run the full pipeline: resolve → schedule → dispatch.
 *
 * @param {Policy} policy - LLM output
 * @param {Object} options - { blocking: boolean, timing: { mode, delay } }
 */
export async function runExecutionEngine(policy, options = {}) {
    const blocking = options.blocking !== false; // default blocking
    const timing = options.timing || policy.timing || { mode: 'immediate', delay: 0 };

    const actions = resolve(policy);
    if (!actions.length) {
        return { resolved: 0, scheduled: 0, results: [] };
    }

    const scheduled = schedule(actions, timing);
    const results = await dispatch(scheduled, blocking);

    return {
        resolved: actions.length,
        scheduled: scheduled.length,
        blocking,
        results,
    };
}
