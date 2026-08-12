import {
    assertExecutionSnapshot,
    captureExecutionSnapshot,
    snapshotValue,
} from './execution-snapshot.js';

/**
 * NPC System — generate, store, edit, and import NPCs as character cards.
 *
 * Storage: chat_metadata[EXT_KEY].npcs = [{ name, description, personality,
 *   scenario, first_mes, imported, importedAvatar, createdAt }, ...]
 */
export function createNpcSystem({
    settings,
    EXT_KEY,
    getChatMetadata,
    getChat,
    saveChatConditional,
    characters,
    getCharacters = () => characters,
    log,
    AgentRegistry,
    execute,
    buildContextPool,
    getCurrentGroup,
    createCaller,
    getContext,
    toastr,
}) {
    const L = (zh, en) => (settings.lang === 'zh' ? zh : en);

    // ─── Helpers ───────────────────────────────────────────────────────

    function getNpcs(metadata = getChatMetadata()) {
        const cm = metadata;
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].npcs) cm[EXT_KEY].npcs = [];
        return cm[EXT_KEY].npcs;
    }

    async function saveNpcs() {
        await saveChatConditional();
    }

    async function replaceNpcs(npcs, metadata = getChatMetadata()) {
        const root = metadata[EXT_KEY] || (metadata[EXT_KEY] = {});
        const previous = root.npcs;
        root.npcs = npcs;
        const appliedState = snapshotValue(npcs);
        try { await saveNpcs(); }
        catch (error) {
            if (snapshotValue(root.npcs) === appliedState) root.npcs = previous;
            throw error;
        }
    }

    /** Check if a name conflicts with existing NPCs or characters. */
    function nameExists(name) {
        const lower = name.toLowerCase();
        if (getNpcs().some(n => n.name.toLowerCase() === lower)) return true;
        if ((getCharacters() || []).some(c => c.name.toLowerCase() === lower)) return true;
        return false;
    }

    // ─── CRUD ──────────────────────────────────────────────────────────

    async function generateNpcs() {
        const agent = AgentRegistry.get('npc');
        if (!agent) throw new Error('NPC agent not registered');

        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: metadata => getNpcs(metadata),
        });
        const existingNpcs = structuredClone(getNpcs(executionSnapshot.metadata));
        const maxCount = settings.npcMaxCount ?? 10;
        const remaining = maxCount - existingNpcs.length;
        if (remaining <= 0) {
            throw new Error(L(`NPC 数量已达上限 (${maxCount})`, `NPC count limit reached (${maxCount})`));
        }

        const batchSize = Math.min(settings.npcBatchSize ?? 3, remaining);
        const group = getCurrentGroup();

        const agentConfig = settings.agentConfigs?.['npc'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(
            agentConfig,
            stGenerateRaw,
            () => getContext().stopGeneration()
        );

        const pool = buildContextPool({
            group,
            npcExistingList: () => existingNpcs,
            npcBatchSize: () => batchSize,
            npcGenerateFirstMes: () => settings.npcGenerateFirstMes ?? false,
        });

        const callCfg = {
            ...agentConfig.call,
            onRetry: ({ attempt, maxRetries }) => {
                toastr?.()?.warning?.(L(`NPC 生成重试中 (${attempt}/${maxRetries})...`, `NPC retry (${attempt}/${maxRetries})...`));
            },
        };

        const result = await execute(agent, {
            pool,
            caller,
            config: { ...settings, call: callCfg, enableTrace: settings.debugLogging },
        });

        if (!result || !Array.isArray(result) || result.length === 0) {
            throw new Error(L('NPC 生成失败：LLM 未返回有效结果', 'NPC generation failed: no valid result'));
        }

        assertExecutionSnapshot(executionSnapshot, {
            getChatMetadata,
            getChat,
            getResource: metadata => getNpcs(metadata),
            message: 'NPC generation became stale',
        });

        // Add to storage
        const npcs = [...getNpcs(executionSnapshot.metadata)];
        for (const npc of result) {
            if (npcs.length >= maxCount) break;
            const lower = npc.name.toLowerCase();
            if (npcs.some(existing => existing.name.toLowerCase() === lower)
                || (getCharacters() || []).some(char => char.name.toLowerCase() === lower)) {
                log(`NPC dedup skipped: "${npc.name}" (already exists)`);
                continue;
            }
            npcs.push(npc);
        }
        await replaceNpcs(npcs, executionSnapshot.metadata);

        return result;
    }

    async function updateNpc(index, updates) {
        const npcs = getNpcs();
        if (index < 0 || index >= npcs.length) return;
        const next = structuredClone(npcs);
        Object.assign(next[index], updates);
        await replaceNpcs(next);
    }

    async function deleteNpc(index) {
        const npcs = getNpcs();
        if (index < 0 || index >= npcs.length) return;
        const next = [...npcs];
        next.splice(index, 1);
        await replaceNpcs(next);
    }

    /**
     * Import an NPC as a character card via ST's API.
     * Uses the /api/characters/create endpoint which takes character JSON data
     * and creates a PNG card from DEFAULT_AVATAR_PATH.
     */
    async function importNpcAsCharacter(index) {
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getResource: metadata => getNpcs(metadata),
        });
        const npcs = getNpcs(executionSnapshot.metadata);
        const npc = npcs[index];
        if (!npc) throw new Error('NPC not found');

        // Build character data in V2 format
        const charData = {
            name: npc.name,
            description: npc.description || '',
            personality: npc.personality || '',
            scenario: npc.scenario || '',
            first_mes: npc.first_mes || '',
            create_date: new Date().toISOString(),
        };

        try {
            const csrfToken = (await getCsrfToken()) ?? '';
            assertExecutionSnapshot(executionSnapshot, {
                getChatMetadata,
                getResource: metadata => getNpcs(metadata),
                message: 'NPC import became stale',
            });
            const resp = await fetch('/api/characters/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                body: JSON.stringify({
                    ch_name: charData.name,
                    description: charData.description,
                    personality: charData.personality,
                    scenario: charData.scenario,
                    first_mes: charData.first_mes,
                }),
            });

            if (!resp.ok) {
                if (resp.status === 403) { _csrfToken = null; _csrfTokenTime = 0; }
                const err = await resp.text().catch(() => '');
                throw new Error(`Character create failed: ${resp.status} ${err.substring(0, 200)}`);
            }

            const avatarName = await resp.text();
            // avatarName is something like "张铁柱.png"
            if (getChatMetadata() === executionSnapshot.metadata) {
                const current = getNpcs(executionSnapshot.metadata);
                let currentIndex = npc.createdAt == null ? -1 : current.findIndex(candidate => (
                    candidate.createdAt === npc.createdAt && candidate.name === npc.name
                ));
                if (currentIndex < 0 && npc.createdAt != null) {
                    const createdAtMatches = current
                        .map((candidate, candidateIndex) => candidate.createdAt === npc.createdAt ? candidateIndex : -1)
                        .filter(candidateIndex => candidateIndex >= 0);
                    if (createdAtMatches.length === 1) currentIndex = createdAtMatches[0];
                }
                if (currentIndex < 0) {
                    currentIndex = current.findIndex(candidate => candidate.name === npc.name);
                }
                if (currentIndex >= 0) {
                    const next = structuredClone(current);
                    next[currentIndex] = { ...next[currentIndex], imported: true, importedAvatar: avatarName };
                    try {
                        await replaceNpcs(next, executionSnapshot.metadata);
                    } catch (saveError) {
                        executionSnapshot.metadata[EXT_KEY].npcs = next;
                        log('NPC import tracking save failed after character creation:', saveError.message);
                    }
                }
            }

            return avatarName;
        } catch (e) {
            log('NPC import error:', e.message);
            throw e;
        }
    }

    // Cache CSRF token with TTL
    let _csrfToken = null;
    let _csrfTokenTime = 0;
    const CSRF_TTL = 30 * 60 * 1000; // 30 minutes
    async function getCsrfToken() {
        if (_csrfToken && (Date.now() - _csrfTokenTime) < CSRF_TTL) return _csrfToken;
        const resp = await fetch('/csrf-token');
        const data = await resp.json();
        _csrfToken = data.token;
        _csrfTokenTime = Date.now();
        return _csrfToken;
    }

    return { getNpcs, generateNpcs, updateNpc, deleteNpc, importNpcAsCharacter, nameExists };
}
