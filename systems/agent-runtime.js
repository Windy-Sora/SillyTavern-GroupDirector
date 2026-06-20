/**
 * Agent Runtime — execution engine for the Agent system.
 *
 * Provides:
 *   createScopedPool(pool, access, strictMode) → Proxy-enforced context pool
 *   managedCall(caller, prompt, callConfig) → retry + timeout
 *   execute(agent, { pool, caller, config }) → state-driven pipeline execution
 *   AgentRegistry → register / get / list
 */

// ─── Agent Registry ──────────────────────────────────────────────────

const registry = new Map();

export const AgentRegistry = {
    register(agent) {
        if (!agent || !agent.id) throw new Error('Agent must have an id');
        registry.set(agent.id, agent);
    },

    get(id) {
        return registry.get(id);
    },

    list() {
        return [...registry.values()].map(({ id, displayName, contextAccess, pipelineOrder }) => ({
            id, displayName, contextAccess, pipelineOrder,
        }));
    },
};

// ─── Scoped Context Pool ─────────────────────────────────────────────

/**
 * Create a Proxy-enforced context pool.
 *
 * @param {object} pool           Raw context pool
 * @param {string[]} access       Declared contextAccess (which keys the agent needs)
 * @param {object} agent          Agent descriptor ({ id }) for error messages
 * @param {object} config         { strictMode }
 * @returns {{ proxy: Proxy, trace: Set, report(): string }}
 */
export function createScopedPool(pool, access, agent = {}, config = {}) {
    const strictMode = config?.strictMode === true;
    const agentId = agent.id || 'unknown';
    const usedAccess = new Set();

    const proxy = new Proxy(pool, {
        get(_target, key) {
            usedAccess.add(key);
            if (!access.includes(key)) {
                const msg = `[AgentAccessViolation] ${agentId} tried to access "${key}" — not in contextAccess. ` +
                    `Declared: [${access.join(', ')}]`;
                if (strictMode) throw new Error(msg);
                console.warn(msg);
                return undefined;
            }
            const val = _target[key];
            return typeof val === 'function' ? val.bind(_target) : val;
        },
    });

    return {
        proxy,
        used: usedAccess,
        report(verbose = false) {
            const unused = access.filter(k => !usedAccess.has(k));
            const undeclared = [...usedAccess].filter(k => !access.includes(k));
            let msg = `[Agent] ${agentId} context access: ${usedAccess.size} keys used`;
            if (undeclared.length) {
                msg += ` | UNDECLARED: [${undeclared.join(', ')}]`;
            }
            if (verbose && unused.length) {
                msg += ` | unused: [${unused.join(', ')}]`;
            }
            return msg;
        },
    };
}

// ─── Managed Call (retry + timeout) ──────────────────────────────────

export async function managedCall(caller, prompt, callConfig = {}) {
    const retries = callConfig.retries ?? 2;
    const timeoutMs = callConfig.timeout ?? 30000;
    const onRetry = callConfig.onRetry; // ({ attempt, maxRetries, error }) => void
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await withTimeout(caller.generate(prompt), timeoutMs);
            return result;
        } catch (e) {
            lastError = e;
            if (e.name === 'AbortError') throw e;
            if (attempt < retries) {
                console.warn(`[Agent] call attempt ${attempt + 1}/${retries + 1} failed: ${e.message}. Retrying...`);
                if (onRetry) {
                    try { onRetry({ attempt: attempt + 1, maxRetries: retries, error: e.message }); } catch (_) {}
                }
                await sleep(2000);
            }
        }
    }
    throw lastError;
}

async function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Execute Agent ───────────────────────────────────────────────────

/**
 * Execute an agent's declared pipeline.
 *
 * State object: { ctx, prompt, raw, parsed }
 *   context phase → state.ctx
 *   prompt  phase → state.prompt
 *   call    phase → state.raw
 *   parse   phase → state.parsed
 *   validate phase → state.parsed (validated)
 *
 * Returns: parsed ?? raw ?? prompt (last meaningful stage output)
 */
export async function execute(agent, { pool, caller, config = {} }) {
    const { proxy: scoped, report } = createScopedPool(pool, agent.contextAccess, agent, config);
    const state = {}; // { ctx, prompt, raw, parsed }

    for (const stage of agent.pipelineOrder) {
        const fn = agent.pipeline[stage];

        if (stage === 'call' && (fn === null || fn === undefined)) {
            state.raw = await managedCall(caller, state.prompt, config.call);
        } else if (stage === 'call') {
            state.raw = await fn(caller, state.prompt, state);
        } else if (fn) {
            const input = state.parsed ?? state.raw ?? state.prompt ?? state.ctx;
            state[stage] = await fn(input, state.ctx, scoped, config);
        }
    }

    // Always log access report after execution
    console.log(report(true));

    return state.parsed ?? state.raw ?? state.prompt;
}
