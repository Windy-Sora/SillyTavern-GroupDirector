/**
 * Character Memory System — per-character memory extraction and management.
 *
 * Storage: chat_metadata[EXT_KEY].charMemories = { [avatar]: [...entries] }
 *
 * Follows the same CRUD + scan + orphan detection patterns as Summary and Profile.
 */

export function createMemorySystem({
    settings,
    EXT_KEY,
    getChatMetadata,
    getChat,
    getCharacters,
    saveChatConditional,
    log,
    AgentRegistry,
    execute,
    buildContextPool,
    getCurrentGroup,
    createCaller,
    getContext,
    toastr: _toastr,
}) {
    const L = (zh, en) => (settings.lang === 'zh' ? zh : en);

    // ─── Helpers ───────────────────────────────────────────────────────

    function getStore() {
        const cm = getChatMetadata();
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].charMemories) cm[EXT_KEY].charMemories = {};
        return cm[EXT_KEY].charMemories;
    }

    async function saveStore() {
        await saveChatConditional();
    }

    function getMemories(avatar) {
        return getStore()[avatar] || [];
    }

    function setMemories(avatar, memories) {
        getStore()[avatar] = memories;
    }

    // ─── CRUD ──────────────────────────────────────────────────────────

    /**
     * Generate memories for one character by scanning recent conversation.
     */
    async function generateForCharacter(avatar) {
        const agent = AgentRegistry.get('memory');
        if (!agent) throw new Error('Memory agent not registered');

        const char = getCharacters().find(c => c.avatar === avatar);
        if (!char) throw new Error(`Character not found: ${avatar}`);

        const existing = getMemories(avatar);
        const agentConfig = settings.agentConfigs?.['memory'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(agentConfig, stGenerateRaw);
        const group = getCurrentGroup();

        const pool = buildContextPool({
            group,
            memoryCharacter: char,
            memoryExistingList: () => existing,
        });

        const callCfg = { ...agentConfig.call };
        const result = await execute(agent, {
            pool, caller,
            config: { ...settings, call: callCfg },
        });

        if (!result || !Array.isArray(result) || result.length === 0) {
            throw new Error(L('未提取到新记忆', 'No new memories extracted'));
        }

        existing.push(...result);
        // Keep max 200 entries per character
        while (existing.length > 200) existing.shift();
        setMemories(avatar, existing);
        await saveStore();

        return result;
    }

    /**
     * Generate memories for all group members at once.
     */
    async function generateForAll() {
        const group = getCurrentGroup();
        if (!group) throw new Error(L('请先加入群聊', 'Not in a group chat'));

        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) throw new Error(L('群聊无可用角色', 'No enabled members'));

        const results = {};
        for (const avatar of members) {
            try {
                results[avatar] = await generateForCharacter(avatar);
            } catch (e) {
                results[avatar] = { error: e.message };
            }
        }
        return results;
    }

    /** Update a single memory entry. */
    async function updateEntry(avatar, index, updates) {
        const memories = getMemories(avatar);
        if (index < 0 || index >= memories.length) throw new Error('Invalid index');
        Object.assign(memories[index], updates);
        await saveStore();
    }

    /** Delete a single memory entry. */
    async function deleteEntry(avatar, index) {
        const memories = getMemories(avatar);
        if (index < 0 || index >= memories.length) throw new Error('Invalid index');
        memories.splice(index, 1);
        await saveStore();
    }

    /** Delete ALL memories for a character. */
    async function deleteCharacterMemories(avatar) {
        const store = getStore();
        delete store[avatar];
        await saveStore();
    }

    /** Revert last N memories for a character. */
    async function revertLast(avatar, count = 1) {
        const memories = getMemories(avatar);
        const removed = memories.splice(-count, count);
        await saveStore();
        return removed;
    }

    /** Reset all memories for all characters. */
    async function resetAll() {
        const cm = getChatMetadata();
        if (cm[EXT_KEY]) cm[EXT_KEY].charMemories = {};
        await saveStore();
    }

    /** Compress old memories into a summary, keeping recent ones. */
    async function compressOldMemories(avatar, keepRecent = 5) {
        const memories = getMemories(avatar);
        if (memories.length <= keepRecent) return null;

        const oldOnes = memories.slice(0, -keepRecent);
        const recentOnes = memories.slice(-keepRecent);

        // Build a summary from old memories
        const summary = oldOnes.map(m => m.event).join('; ');

        // Replace old with one compressed entry
        const compressed = [{
            event: `[压缩记忆] ${summary}`,
            mood: 'neutral',
            round: -1,
            timestamp: Date.now(),
            compressed: true,
        }];

        const newMemories = [...compressed, ...recentOnes];
        setMemories(avatar, newMemories);
        await saveStore();

        return { removed: oldOnes.length, kept: recentOnes.length, compressed: 1 };
    }

    // ─── Queries ───────────────────────────────────────────────────────

    /** Count memories per character. */
    function getStats() {
        const store = getStore();
        const stats = {};
        for (const [avatar, memories] of Object.entries(store)) {
            const char = getCharacters().find(c => c.avatar === avatar);
            stats[avatar] = {
                name: char?.name || avatar,
                count: memories.length,
                latestRound: memories.length > 0 ? memories[memories.length - 1].round : 0,
            };
        }
        return stats;
    }

    /**
     * Detect orphan memories (pointing to messages that were deleted).
     * Returns avatars with potentially stale memories.
     */
    function detectOrphans() {
        const store = getStore();
        const chatLen = getChat().length;
        const orphans = [];

        for (const [avatar, memories] of Object.entries(store)) {
            const stale = memories.filter(m => m.round > chatLen);
            if (stale.length > 0) {
                const char = getCharacters().find(c => c.avatar === avatar);
                orphans.push({ avatar, name: char?.name || avatar, staleCount: stale.length });
            }
        }
        return orphans;
    }

    /** List all memories for a character. */
    function listMemories(avatar) {
        return getMemories(avatar);
    }

    /** Get total memory count across all characters. */
    function totalCount() {
        let count = 0;
        for (const memories of Object.values(getStore())) {
            count += memories.length;
        }
        return count;
    }

    return {
        generateForCharacter, generateForAll,
        updateEntry, deleteEntry, deleteCharacterMemories,
        revertLast, resetAll, compressOldMemories,
        getStats, detectOrphans, listMemories, totalCount,
        getMemories,
    };
}
