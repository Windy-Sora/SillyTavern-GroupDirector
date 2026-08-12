import { normalizeCustomAgent } from './custom-agent-validation.js';

export function extractCustomAgentJson(text) {
    if (typeof text !== 'string') return null;
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = firstBrace; index < text.length; index++) {
        const char = text[index];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                let raw = text.slice(firstBrace, index + 1);
                raw = raw.replace(/,(\s*[}\]])/g, '$1');
                raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
                try { return JSON.parse(raw); } catch (_) { return null; }
            }
        }
    }
    return null;
}

function staleExecutionError() {
    const error = new Error('CustomAgent: execution became stale');
    error.name = 'StaleExecutionError';
    return error;
}

export function createCustomAgentExecution({
    getList,
    getStore,
    getChatMetadata,
    getChat,
    getRevision,
    renderPrompt,
    generate,
    saveChatConditional,
    EXT_KEY,
    log,
}) {
    const states = new Map();
    const inFlight = new Map();
    let queueTail = Promise.resolve();
    let epoch = 0;

    const isStale = (startEpoch, metadata, chat) => (
        startEpoch !== epoch || getChatMetadata() !== metadata || getChat() !== chat
    );

    async function run(instance, options, context) {
        states.set(instance.id, 'running');
        const { metadata, chat, startEpoch, revision, managed } = context;
        const rangeEnd = chat.length;
        if (isStale(startEpoch, metadata, chat)) throw staleExecutionError();
        if (managed && getRevision(instance.id) !== revision) throw staleExecutionError();
        const rawPrompt = instance.prompt + (instance.schema
            ? '\n\nOutput format must strictly follow this JSON schema:\n' + instance.schema
            : '');
        let prompt = rawPrompt;
        try { prompt = await renderPrompt(rawPrompt); }
        catch (_) { log?.(`[CustomAgent] "${instance.name}" prompt render failed, using raw`); }
        if (isStale(startEpoch, metadata, chat)) throw staleExecutionError();

        const response = await generate(prompt);
        if (!response) return null;
        if (isStale(startEpoch, metadata, chat)) throw staleExecutionError();
        if (managed) {
            const live = getList().find(agent => agent.id === instance.id);
            if (!live || getRevision(instance.id) !== revision) throw staleExecutionError();
        }

        const result = {
            rangeEnd,
            content: response,
            data: (instance.schema ? extractCustomAgentJson(response) : null) ?? response,
            timestamp: Date.now(),
        };
        const store = getStore(metadata);
        const hadPrevious = Object.prototype.hasOwnProperty.call(store, instance.id);
        const previous = store[instance.id];
        const root = metadata[EXT_KEY];
        const hasCounter = typeof options.counterKey === 'string';
        const committedCounterKey = options.counterKey;
        const committedCounterValue = options.counterValue;
        const hadCounter = hasCounter && Object.prototype.hasOwnProperty.call(root, options.counterKey);
        const previousCounter = hasCounter ? root[options.counterKey] : undefined;
        store[instance.id] = result;
        if (hasCounter) root[options.counterKey] = options.counterValue;
        try {
            await saveChatConditional();
        } catch (error) {
            if (hadPrevious) store[instance.id] = previous;
            else delete store[instance.id];
            if (hasCounter) {
                if (hadCounter) root[options.counterKey] = previousCounter;
                else delete root[options.counterKey];
            }
            throw error;
        }
        // A manual request can be joined by an auto trigger while the first
        // persistence call is already in progress. Preserve deduplication, then
        // checkpoint in a follow-up transaction instead of losing the trigger.
        if (typeof options.counterKey === 'string' && (
            !hasCounter
            || options.counterKey !== committedCounterKey
            || options.counterValue !== committedCounterValue
        )) {
            const lateHadCounter = Object.prototype.hasOwnProperty.call(root, options.counterKey);
            const latePrevious = root[options.counterKey];
            root[options.counterKey] = options.counterValue;
            try { await saveChatConditional(); }
            catch (error) {
                if (lateHadCounter) root[options.counterKey] = latePrevious;
                else delete root[options.counterKey];
                throw error;
            }
        }
        log?.(`[CustomAgent] "${instance.name}" executed, rangeEnd=${rangeEnd}`);
        return result;
    }

    function execute(instance, options = {}) {
        if (!instance?.id || !instance.prompt) return Promise.resolve(null);
        const context = {
            metadata: getChatMetadata(),
            chat: getChat(),
            startEpoch: epoch,
            revision: getRevision(instance.id),
            managed: getList().some(agent => agent.id === instance.id),
        };
        if (inFlight.has(instance.id)) {
            const current = inFlight.get(instance.id);
            const sameContext = current.context.startEpoch === context.startEpoch
                && current.context.metadata === context.metadata
                && current.context.chat === context.chat
                && current.context.revision === context.revision;
            if (sameContext && typeof options.counterKey === 'string') {
                current.options.counterKey = options.counterKey;
                current.options.counterValue = options.counterValue;
            }
            if (sameContext) return current.task;
        }
        const snapshot = normalizeCustomAgent(instance, { path: 'agent', id: instance.id });
        states.set(snapshot.id, 'queued');
        const mergedOptions = { ...options };
        const task = queueTail.catch(() => {}).then(() => run(snapshot, mergedOptions, context));
        queueTail = task.catch(() => {});
        inFlight.set(snapshot.id, { task, options: mergedOptions, context });
        task.finally(() => {
            if (inFlight.get(snapshot.id)?.task === task) {
                inFlight.delete(snapshot.id);
                states.delete(snapshot.id);
            }
        }).catch(() => {});
        return task;
    }

    function executeAuto(instance, currentLength) {
        return execute(instance, {
            counterKey: `_autoCAG_${instance.id}`,
            counterValue: currentLength,
        });
    }

    async function executeAll(instances) {
        const sorted = [...instances]
            .filter(instance => instance.enabled && instance.id && instance.prompt)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        const results = [];
        for (const instance of sorted) {
            try {
                results.push({ id: instance.id, name: instance.name, success: true, data: await execute(instance) });
            } catch (error) {
                log?.(`[CustomAgent] "${instance.name}" failed: ${error.message}`);
                results.push({ id: instance.id, name: instance.name, success: false, error: error.message });
            }
        }
        return results;
    }

    return {
        execute,
        executeAuto,
        executeAll,
        extractJson: extractCustomAgentJson,
        getExecutionState: id => states.get(id) || 'idle',
        invalidateExecutions: () => { epoch++; },
    };
}
