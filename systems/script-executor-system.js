let turnShared = {};
let decisionSnapshot = null; // snapshot after decision hook completes, read-only for message/round

export function createScriptExecutorSystem({ settings, saveSettings, renderPrompt, AgentTrace, log }) {
    function getList() {
        return settings.scriptExecutors || [];
    }

    function save() {
        saveSettings();
    }

    function generateId() {
        return 'se_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function add(partial) {
        const entry = {
            id: generateId(),
            name: partial.name || 'Untitled',
            triggerOn: partial.triggerOn || 'both',
            priority: typeof partial.priority === 'number' ? partial.priority : 0,
            code: partial.code || '',
            enabled: partial.enabled !== false,
            params: Array.isArray(partial.params) ? partial.params : [],
            renderParams: !!partial.renderParams,
            returnMode: partial.returnMode === 'shared' ? 'shared' : 'ignore',
        };
        const list = getList();
        list.push(entry);
        save();
        return entry;
    }

    function update(id, updates) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return;
        const allowed = ['name', 'triggerOn', 'priority', 'code', 'enabled', 'params', 'renderParams', 'returnMode'];
        for (const k of allowed) {
            if (updates.hasOwnProperty(k)) list[idx][k] = updates[k];
        }
        save();
    }

    function remove(id) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return;
        list.splice(idx, 1);
        save();
    }

    function toggle(id) {
        const list = getList();
        const entry = list.find(e => e.id === id);
        if (!entry) return;
        entry.enabled = !entry.enabled;
        save();
    }

    function resetTurnShared() {
        turnShared = {};
        decisionSnapshot = null;
    }

    function getTurnShared() { return turnShared; }
    function getDecisionSnapshot() { return decisionSnapshot; }

    async function buildParams(entry) {
        const params = {};
        for (const p of (entry.params || [])) {
            params[p.key] = p.default;
        }
        if (entry.renderParams) {
            for (const p of (entry.params || [])) {
                if (p.type === 'string' || typeof p.default === 'string') {
                    try {
                        params[p.key] = await renderPrompt(
                            String(p.default ?? ''),
                            {},
                            { recursive: false, maxPasses: 1 }
                        );
                    } catch (_) { /* keep original default */ }
                }
            }
        }
        return params;
    }

    function pushTrace(traceEntry) {
        if (AgentTrace && typeof AgentTrace.push === 'function') {
            try { AgentTrace.push(traceEntry); } catch (_) { /* best-effort */ }
        }
    }

    // ── Decision phase: blocking, await all, 10s timeout ──
    async function executeAllDecision(rawEvent) {
        const event = rawEvent ? { ...rawEvent } : {};

        const list = getList().filter(e =>
            e.enabled && (e.triggerOn === 'decision' || e.triggerOn === 'all')
        );
        if (!list.length) return null;

        const sorted = [...list].sort((a, b) => a.priority - b.priority);

        const traceEntry = {
            agentId: 'script-executor',
            startTime: new Date().toISOString(),
            stages: [],
        };

        for (const entry of sorted) {
            const stage = { id: entry.id, name: entry.name, trigger: 'decision', priority: entry.priority, startTime: Date.now() };
            try {
                const params = await buildParams(entry);

                const ctx = {
                    params,
                    shared: { ...turnShared },
                    decision: event.decision || null,      // LIVE reference — scripts mutate directly
                    chat: event.chat || null,
                    characters: event.characters || null,
                    group: event.group || null,
                    settings: event.settings || null,
                    getContext: event.getContext || null,
                    // decision phase has no message / character
                };

                const fn = new Function('ctx', entry.code);
                const result = await Promise.race([
                    Promise.resolve(fn(ctx)),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Script "${entry.name}" timed out after 10s`)), 10000)
                    ),
                ]);

                if (entry.returnMode === 'shared' && result !== undefined && result !== null && typeof result === 'object') {
                    Object.assign(turnShared, result);
                }

                stage.ok = true;
            } catch (e) {
                stage.ok = false;
                stage.error = e.message || String(e);
                log?.(`[GD] Script executor (decision) "${entry.name}": ${stage.error}`);
                // Keep original decision, continue to next executor
            }
            stage.elapsed = Date.now() - stage.startTime;
            traceEntry.stages.push(stage);
        }

        // Snapshot decision state for message/round phases
        decisionSnapshot = {
            decision: event.decision ? JSON.parse(JSON.stringify(event.decision)) : null,
            shared: JSON.parse(JSON.stringify(turnShared)),
        };

        pushTrace(traceEntry);
        return decisionSnapshot;
    }

    // ── Message / Round phase: fire-and-forget, 5s timeout ──
    async function executeAll(mode, rawEvent) {
        const event = rawEvent ? { ...rawEvent } : {};

        const list = getList().filter(e =>
            e.enabled && (e.triggerOn === mode || e.triggerOn === 'both' || e.triggerOn === 'all')
        );

        if (!list.length) return;

        const sorted = [...list].sort((a, b) => a.priority - b.priority);

        const traceEntry = {
            agentId: 'script-executor',
            startTime: new Date().toISOString(),
            stages: [],
        };

        for (const entry of sorted) {
            const stage = { id: entry.id, name: entry.name, trigger: mode, priority: entry.priority, startTime: Date.now() };
            try {
                const params = await buildParams(entry);

                const ctx = {
                    params,
                    shared: { ...turnShared },
                    decisionSnapshot: decisionSnapshot,    // read-only snapshot from decision phase
                    message: event.message || null,
                    character: event.character || null,
                    chat: event.chat || null,
                    characters: event.characters || null,
                    group: event.group || null,
                    settings: event.settings || null,
                    getContext: event.getContext || null,
                };

                const fn = new Function('ctx', entry.code);
                const result = await Promise.race([
                    Promise.resolve(fn(ctx)),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Script "${entry.name}" timed out after 5s`)), 5000)
                    ),
                ]);

                if (entry.returnMode === 'shared' && result !== undefined && result !== null && typeof result === 'object') {
                    Object.assign(turnShared, result);
                }

                stage.ok = true;
            } catch (e) {
                stage.ok = false;
                stage.error = e.message || String(e);
                log?.(`[GD] Script executor "${entry.name}": ${stage.error}`);
            }
            stage.elapsed = Date.now() - stage.startTime;
            traceEntry.stages.push(stage);
        }

        pushTrace(traceEntry);
    }

    return {
        getList, add, update, remove, toggle,
        executeAll, executeAllDecision,
        resetTurnShared, getTurnShared, getDecisionSnapshot,
    };
}
