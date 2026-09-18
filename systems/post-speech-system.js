/**
 * PostSpeech Decision Store — persists multimodal policy decisions
 * per chat in chat_metadata, with dedup and prune support.
 *
 * Follows the same pattern as history-system.js (ledger) and
 * npc-system.js (NPCs).
 *
 * Record format:
 *   { messageIndex, messageName, capabilityId, params, policy, timestamp }
 *
 * Dedup key: `${messageIndex}:${capabilityId}`
 */

export function createPostSpeechSystem({
    settings,
    EXT_KEY,
    getChatMetadata,
    getChat,
    saveChatConditional,
    log,
}) {
    const DEDUP_PREFIX = 'ps:';
    const pending = new Set();
    const recordTail = new WeakMap();
    let pendingEpoch = 0;

    // ─── Helpers ───────────────────────────────────────────────────────

    function getStoreFor(cm) {
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].postSpeechDecisions) cm[EXT_KEY].postSpeechDecisions = [];
        return cm[EXT_KEY].postSpeechDecisions;
    }

    function getStore() {
        return getStoreFor(getChatMetadata());
    }

    function resetPending() {
        pendingEpoch++;
        pending.clear();
    }

    // Restore only entries removed by this operation, leaving later additions intact.
    function restoreRemoved(cm, before, removed) {
        const current = getStoreFor(cm);
        const removedSet = new Set(removed);
        const currentSet = new Set(current);
        const oldEntries = before.filter(entry => currentSet.has(entry) || removedSet.has(entry));
        const additions = current.filter(entry => !before.includes(entry));
        cm[EXT_KEY].postSpeechDecisions = [...oldEntries, ...additions].slice(-500);
    }

    async function saveStore(metadata) {
        await saveChatConditional(metadata);
    }

    function makeKey(messageIndex, capabilityId) {
        return `${DEDUP_PREFIX}${messageIndex}:${capabilityId}`;
    }

    // ─── CRUD ──────────────────────────────────────────────────────────

    /** Check if a decision was already made for this (message, capability). */
    function wasExecuted(messageIndex, capabilityId) {
        return getStore().some(
            r => r.messageIndex === messageIndex && r.capabilityId === capabilityId
        );
    }

    /** Check whether this decision is currently executing but not yet settled. */
    function isPending(messageIndex, capabilityId) {
        return pending.has(makeKey(messageIndex, capabilityId));
    }

    /** Record a decision after execution. */
    async function record(messageIndex, messageName, capabilityId, params, policy) {
        const cm = getChatMetadata();
        const previous = recordTail.get(cm);
        const operation = previous ? previous.catch(() => {}).then(async () => {
            if (getChatMetadata() !== cm) throw new Error('PostSpeech chat changed before recording');
            await recordForChat(cm, messageIndex, messageName, capabilityId, params, policy);
        }) : recordForChat(cm, messageIndex, messageName, capabilityId, params, policy);
        recordTail.set(cm, operation);
        try {
            await operation;
        } finally {
            if (recordTail.get(cm) === operation) recordTail.delete(cm);
        }
    }

    async function recordForChat(cm, messageIndex, messageName, capabilityId, params, policy) {
        const store = getStoreFor(cm);
        const entry = {
            messageIndex,
            messageName,
            capabilityId,
            params,
            policySummary: policy ? { intents: policy.intents?.length ?? 0, timing: policy.timing?.mode ?? 'immediate' } : null,
            timestamp: Date.now(),
        };
        store.push(entry);
        // Keep storage bounded — max 500 records
        const evicted = [];
        while (store.length > 500) evicted.push(store.shift());
        try {
            await saveStore(cm);
        } catch (error) {
            if (error.persistenceUnknown) throw error;
            const current = getStoreFor(cm);
            const index = current.indexOf(entry);
            if (index !== -1) {
                current.splice(index, 1);
                if (current === store) {
                    current.unshift(...evicted.filter(item => !current.includes(item)));
                    while (current.length > 500) current.shift();
                }
            }
            throw error;
        }
    }

    /**
     * Persist only intents whose resolved actions actually completed successfully.
     * Non-blocking executions remain transiently pending until their completion
     * receipt settles; unresolved or failed intents stay retryable.
     */
    async function trackExecution(execution, contexts = []) {
        const tracked = contexts.map((context, intentIndex) => ({
            ...context,
            intentIndex,
            key: makeKey(context.messageIndex, context.intent?.type),
        }));
        const epoch = pendingEpoch;

        for (const context of tracked) pending.add(context.key);

        const settle = async (results = []) => {
            try {
                if (epoch !== pendingEpoch) return;

                for (const context of tracked) {
                    if (epoch !== pendingEpoch) return;
                    const intentResults = results.filter(
                        result => result.intentIndex === context.intentIndex
                    );

                    if (!intentResults.length) {
                        log(`PostSpeech: intent "${context.intent?.type}" was not resolved; left retryable`);
                        continue;
                    }

                    if (!intentResults.every(result => result.success === true)) {
                        const errors = intentResults
                            .filter(result => result.success !== true)
                            .map(result => result.error || 'execution failed')
                            .join('; ');
                        log(`PostSpeech: intent "${context.intent?.type}" failed; left retryable (${errors})`);
                        continue;
                    }

                    const capabilityId = context.intent.type;
                    if (!wasExecuted(context.messageIndex, capabilityId)) {
                        await record(
                            context.messageIndex,
                            context.messageName,
                            capabilityId,
                            context.intent.params,
                            context.policy
                        );
                    }
                }
            } finally {
                if (epoch === pendingEpoch) {
                    for (const context of tracked) pending.delete(context.key);
                }
            }
        };

        if (execution?.blocking !== false) {
            await settle(execution?.results || []);
            return { pending: false };
        }

        const completion = execution?.completion;
        if (!completion || typeof completion.then !== 'function') {
            await settle([]);
            return { pending: false };
        }

        completion
            .then(settle)
            .catch(error => {
                if (epoch === pendingEpoch) {
                    for (const context of tracked) pending.delete(context.key);
                }
                log(`PostSpeech: completion tracking failed (${error.message})`);
            });
        return { pending: true };
    }

    /** List all decisions (oldest first) for visualization — matches execution order. */
    function list(limit = 50) {
        const store = getStore();
        return store.slice(-limit);
    }

    /** Prune decisions after a given message index (on MESSAGE_DELETED). */
    async function pruneAfter(messageIndex) {
        resetPending();
        const cm = getChatMetadata();
        const store = getStoreFor(cm);
        const before = store.length;
        const filtered = store.filter(r => r.messageIndex <= messageIndex);
        if (filtered.length < before) {
            const removed = store.filter(r => r.messageIndex > messageIndex);
            cm[EXT_KEY].postSpeechDecisions = filtered;
            try {
                await saveStore(cm);
            } catch (error) {
                if (error.persistenceUnknown) throw error;
                restoreRemoved(cm, store, removed);
                throw error;
            }
            log(`PostSpeech: pruned ${before - filtered.length} decisions after message ${messageIndex}`);
        }
    }

    /** Explicitly clear this chat's decisions. Chat changes only reset pending work. */
    async function clearAll() {
        resetPending();
        const cm = getChatMetadata();
        if (cm[EXT_KEY]) {
            const before = getStoreFor(cm).slice();
            cm[EXT_KEY].postSpeechDecisions = [];
            try {
                await saveStore(cm);
            } catch (error) {
                if (error.persistenceUnknown) throw error;
                restoreRemoved(cm, before, before);
                throw error;
            }
        }
    }

    /** Total count of decisions in storage. */
    function count() {
        return getStore().length;
    }

    return { wasExecuted, isPending, record, trackExecution, list, pruneAfter, clearAll, resetPending, count };
}
