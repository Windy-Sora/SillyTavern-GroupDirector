export function createProfileSystem(deps) {
    const { settings, EXT_KEY, chat_metadata, saveChatConditional, characters, chat, getContext, djb2Hash, hashChar, extractJsonObject, sanitizeJson, matchCharacterByName, getCurrentGroup, log, llmPickedSet, llmPickedAvatars, roundSpeakerCount, saveSettings } = deps;

// ─── Profile System: Hash & Data Layer ─────────────────────────────────
function computeProfileSchemaHash() {
    const schema = settings.profileJsonSchema || getDefaultProfileSchema();
    return djb2Hash(schema);
}

function getProfileContainer() {
    if (!chat_metadata[EXT_KEY]) chat_metadata[EXT_KEY] = {};
    const meta = chat_metadata[EXT_KEY];
    if (!meta.characterProfiles) meta.characterProfiles = {};
    if (!meta.archivedProfiles) meta.archivedProfiles = {};
    if (meta.profileVersion === undefined) meta.profileVersion = 1;
    if (meta.profileSchemaHash === undefined) meta.profileSchemaHash = '';
    return meta;
}

function migrateProfileData(container) {
    const from = container.profileVersion || 0;
    if (from < 1) {
        container.profileVersion = 1;
    }
    const currentHash = computeProfileSchemaHash();
    if (container.profileSchemaHash && container.profileSchemaHash !== currentHash) {
        console.warn('[GroupDirector] Profile schema changed since last save. Old profiles may use outdated field set.');
    }
    container.profileSchemaHash = currentHash;
}

function getProfiles() {
    return getProfileContainer().characterProfiles;
}

function getArchivedProfiles() {
    return getProfileContainer().archivedProfiles;
}

async function saveProfile(avatar, profileObj) {
    const profiles = getProfiles();
    profiles[avatar] = profileObj;
    await saveChatConditional();
}

function diffProfiles(enabledMembers) {
    if (!settings.profileEnabled) return { newChars: [], removedChars: [], existingChars: [], hashMismatches: [] };
    const profiles = getProfiles();
    const profileAvatars = Object.keys(profiles);
    const newChars = enabledMembers.filter(a => !profileAvatars.includes(a));
    const removedChars = profileAvatars.filter(a => !enabledMembers.includes(a));
    const existingChars = enabledMembers.filter(a => profileAvatars.includes(a));
    const hashMismatches = [];
    for (const avatar of existingChars) {
        const char = characters.find(c => c.avatar === avatar);
        if (!char) continue;
        const currentHash = hashChar(char.description, char.personality, char.scenario);
        if (profiles[avatar].hash && profiles[avatar].hash !== currentHash) {
            hashMismatches.push(avatar);
        }
    }
    return { newChars, removedChars, existingChars, hashMismatches };
}

// ─── Profile System: Generator ─────────────────────────────────────────
function getDefaultProfileGeneratorPrompt() {
    return `You are a Character Profile Analyzer. Analyze the following character and extract key information.

Character Name: {{charName}}
Description: {{charDescription}}
Personality: {{charPersonality}}
Scenario: {{charScenario}}

Extract the following in JSON format ONLY (no prose, no code fences):
{
  "summary": "A concise 2-3 sentence description of who this character is, their role, and their defining traits.",
  "tags": ["tag1", "tag2", "tag3"],
  "motivation": "What drives this character? What do they want? What are their core goals or fears?",
  "relationships": "How does this character relate to others? What is their social role or typical dynamic with people?"
}

Important:
- Output ONLY valid JSON, no extra text.
- summary must be under 200 characters.
- tags must be an array of 3-6 single words or short phrases.
- motivation must be under 300 characters.
- relationships must be under 200 characters.`;
}

function getDefaultProfileSchema() {
    return JSON.stringify({
        type: 'object',
        properties: {
            summary:       { type: 'string' },
            tags:          { type: 'array', items: { type: 'string' } },
            motivation:    { type: 'string' },
            relationships: { type: 'string' },
        },
        required: ['summary', 'tags', 'motivation', 'relationships'],
    }, null, 2);
}

function getDefaultProfileRenderTemplate() {
    return `- {{name}}: {{summary}}
  Tags: {{tags}}
  Motivation: {{motivation}}
  Relationships: {{relationships}}`;
}

function normalizeProfileFields(parsed) {
    if (!parsed || typeof parsed !== 'object') return { summary: '', tags: [], motivation: '', relationships: '' };
    return {
        summary: parsed.summary || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        motivation: parsed.motivation || '',
        relationships: parsed.relationships || '',
        ...parsed,
    };
}

async function generateSingleProfile(avatar) {
    if (!settings.profileEnabled) return null;
    const char = characters.find(c => c.avatar === avatar);
    if (!char) throw new Error(`Character not found for avatar: ${avatar}`);

    const generatorPrompt = settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt();
    const schemaText = settings.profileJsonSchema || getDefaultProfileSchema();

    let filled = generatorPrompt
        .replace('{{charName}}', char.name)
        .replace('{{charDescription}}', char.description || '')
        .replace('{{charPersonality}}', char.personality || '')
        .replace('{{charScenario}}', char.scenario || '');

    let jsonSchema = null;
    try { jsonSchema = JSON.parse(schemaText); } catch (e) { /* use null */ }

    const ctx = getContext();
    const response = await ctx.generateRaw({
        prompt: filled,
        jsonSchema: jsonSchema,
    });

    let parsed;
    try {
        parsed = JSON.parse(response);
    } catch (e) {
        const extracted = extractJsonObject(response);
        if (extracted) {
            const sanitized = sanitizeJson(extracted);
            try { parsed = JSON.parse(sanitized); } catch (e2) { /* fall through */ }
        }
    }

    if (!parsed) throw new Error('Failed to parse profile JSON response');
    return normalizeProfileFields(parsed);
}

async function generateProfilesBatch(avatars) {
    if (!settings.profileEnabled) return;
    if (!avatars.length) return;

    const limit = settings.profileConcurrency || 0;
    const buildTask = (avatar) => async () => {
        const char = characters.find(c => c.avatar === avatar);
        if (!char) return;

        const currentHash = hashChar(char.description, char.personality, char.scenario);
        const pendingProfile = {
            avatar: avatar,
            name: char.name,
            hash: currentHash,
            profile: { summary: '', tags: [], motivation: '', relationships: '' },
            state: 'pending',
            manualEdited: false,
            updatedAt: Date.now(),
        };
        await saveProfile(avatar, pendingProfile);

        try {
            const result = await generateSingleProfile(avatar);
            if (result) {
                pendingProfile.profile = result;
                pendingProfile.state = 'ready';
                pendingProfile.hash = currentHash;
            } else {
                pendingProfile.state = 'failed';
            }
        } catch (e) {
            console.error(`[GroupDirector] Profile generation failed for ${char.name}:`, e.message);
            pendingProfile.state = 'failed';
        }
        pendingProfile.updatedAt = Date.now();
        await saveProfile(avatar, pendingProfile);
    };

    const taskFns = avatars.map(buildTask).filter(Boolean);

    if (limit <= 0 || limit >= taskFns.length) {
        // Unlimited concurrent
        await Promise.all(taskFns.map(fn => fn()));
    } else {
        // Batched concurrent: run N at a time
        for (let i = 0; i < taskFns.length; i += limit) {
            const batch = taskFns.slice(i, i + limit);
            await Promise.all(batch.map(fn => fn()));
        }
    }

    refreshProfileManagementUI();
}

// ─── Profile System: Renderer ──────────────────────────────────────────
function renderSingleProfile(prof) {
    if (!prof || !prof.profile) return '';
    const template = settings.profileRenderTemplate || getDefaultProfileRenderTemplate();
    return template
        .replace(/\{\{name\}\}/g,          prof.name || '')
        .replace(/\{\{summary\}\}/g,       prof.profile.summary || '')
        .replace(/\{\{tags\}\}/g,          (prof.profile.tags || []).join(', '))
        .replace(/\{\{motivation\}\}/g,    prof.profile.motivation || '')
        .replace(/\{\{relationships\}\}/g, prof.profile.relationships || '');
}

function getProfilePriority(prof, pickedSet, recentSpeakerSet, currentSpeakingAvatar) {
    if (prof.avatar === currentSpeakingAvatar) return 0;
    if (pickedSet && pickedSet.has(prof.avatar)) return 1;
    if (recentSpeakerSet && recentSpeakerSet.has(prof.avatar)) return 2;
    return 3;
}

function applyTokenBudget(readyProfiles, budget) {
    if (!readyProfiles.length) return [];
    const pickedSet = llmPickedSet || new Set();

    // Build recent speaker set from the last 5 messages
    const recentSpeakerSet = new Set();
    for (let i = chat.length - 1; i >= Math.max(0, chat.length - 5); i--) {
        const msg = chat[i];
        if (msg && !msg.is_user && !msg.is_system && msg.avatar) {
            recentSpeakerSet.add(msg.avatar);
        }
    }

    const currentSpeakingAvatar = llmPickedAvatars?.[roundSpeakerCount] || null;

    const sorted = [...readyProfiles].sort((a, b) => {
        const aP = getProfilePriority(a, pickedSet, recentSpeakerSet, currentSpeakingAvatar);
        const bP = getProfilePriority(b, pickedSet, recentSpeakerSet, currentSpeakingAvatar);
        if (aP !== bP) return aP - bP;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    let usedTokens = 0;
    const result = [];
    for (const p of sorted) {
        const rendered = renderSingleProfile(p);
        const estTokens = Math.max(1, Math.ceil(rendered.length / 4));
        if (usedTokens + estTokens <= budget || result.length === 0) {
            result.push({ ...p, rendered });
            usedTokens += estTokens;
        } else {
            const short = `${p.name}: ${(p.profile.summary || '').slice(0, 100)}`;
            result.push({ ...p, rendered: short, compressed: true });
            usedTokens += Math.max(1, Math.ceil(short.length / 4));
        }
    }
    return result;
}

function buildCharacterProfilesText() {
    if (!settings.profileEnabled) return '';

    getProfileContainer(); // ensure migration ran
    const profiles = getProfiles();
    const all = Object.values(profiles);
    const readyProfiles = all.filter(p => p.state === 'ready');
    const pendingProfiles = all.filter(p => p.state === 'pending');
    const failedProfiles = all.filter(p => p.state === 'failed');

    // Always log profile state summary so the user knows what's happening
    console.log(`[GroupDirector] Profiles: ${all.length} total, ${readyProfiles.length} ready, ${pendingProfiles.length} pending, ${failedProfiles.length} failed`);

    if (readyProfiles.length === 0) {
        if (all.length === 0) {
            console.warn('[GroupDirector] No profiles exist. Click "Regenerate All" in the Profile Management panel to generate them.');
        } else if (failedProfiles.length === all.length) {
            console.warn(`[GroupDirector] All ${all.length} profile(s) failed. Check the browser console for errors, then click "Regenerate All" to retry.`);
        } else if (pendingProfiles.length > 0) {
            console.warn(`[GroupDirector] ${pendingProfiles.length} profile(s) still pending. Profiles will appear once generation completes.`);
        }
        return '';
    }

    const budgeted = applyTokenBudget(readyProfiles, settings.profileTokenBudget);
    return budgeted.map(p => p.rendered).join('\n');
}

function validateTemplatePlaceholders(template, knownKeys) {
    const found = template.match(/\{\{[a-zA-Z_]+\}\}/g) || [];
    const unknowns = [...new Set(found)].filter(p => !knownKeys.has(p));
    return unknowns;
}

function validateAndWarnProfilePlaceholders(type) {
    const template = type === 'generator'
        ? ($c('profile-generator-prompt').val() || getDefaultProfileGeneratorPrompt())
        : ($c('profile-render-template').val() || getDefaultProfileRenderTemplate());

    const knownKeys = type === 'generator'
        ? new Set(['{{charName}}', '{{charDescription}}', '{{charPersonality}}', '{{charScenario}}'])
        : new Set(['{{name}}', '{{summary}}', '{{tags}}', '{{motivation}}', '{{relationships}}']);

    const unknowns = validateTemplatePlaceholders(template, knownKeys);
    const $warn = $('#gd-profile-template-warning');
    if (unknowns.length > 0) {
        const lang = settings.lang || 'zh';
        $warn.text(lang === 'zh'
            ? `警告：未知占位符 ${unknowns.join(', ')}，将渲染为空。`
            : `Warning: unknown placeholders ${unknowns.join(', ')}. They will render as empty.`).show();
    } else {
        $warn.hide();
    }
}

async function syncProfiles(enabledMembers) {
    if (!settings.profileEnabled) return;

    getProfileContainer(); // ensure migration
    const { newChars, removedChars, hashMismatches } = diffProfiles(enabledMembers);

    // Archive removed characters
    for (const avatar of removedChars) {
        const profile = getProfiles()[avatar];
        if (profile) {
            getArchivedProfiles()[avatar] = profile;
            delete getProfiles()[avatar];
        }
    }

    if (hashMismatches.length > 0) {
        const names = hashMismatches.map(a => characters.find(c => c.avatar === a)?.name || a).join(', ');
        log(`Profile hash mismatch for: ${names} — use Regenerate button to update`);
    }

    if (removedChars.length || hashMismatches.length) {
        await saveChatConditional();
    }

    // Auto-generate profiles for new characters (non-blocking fire-and-forget)
    if (newChars.length > 0) {
        log(`Auto-generating profiles for ${newChars.length} new character(s): ${newChars.map(a => characters.find(c => c.avatar === a)?.name || a).join(', ')}`);
        generateProfilesBatch(newChars).catch(e => {
            console.error('[GroupDirector] Background profile generation failed:', e);
        });
    }
}

function log(...args) {
    if (settings.debugLogging) {
        console.log('[GroupDirector]', ...args);
    }
}

// ─── Trigger Engine ───────────────────────────────────────────────────
function checkTriggers(characterName, characterAvatar, recentMessages) {
    if (!settings.triggerEnabled) return false;

    const char = characters.find(c => c.avatar === characterAvatar);
    if (!char) return false;

    // Extract keywords from character description + personality + scenario
    const desc = (char.description || '') + ' ' + (char.personality || '') + ' ' + (char.scenario || '');
    const keywords = desc
        .split(/[\s,.;!?，。；！？、]+/)
        .filter(w => w.length >= 2 && w.length <= 10)
        .map(w => w.toLowerCase());

    // Deduplicate
    const uniqueKeywords = [...new Set(keywords)];

    const text = recentMessages.map(m => m.mes || '').join(' ').toLowerCase();

    for (const kw of uniqueKeywords) {
        if (text.includes(kw)) {
            log(`Trigger matched: "${kw}" for ${characterName}`);
            return true;
        }
    }
    return false;
}

// ─── Initiative Engine ────────────────────────────────────────────────
function rollInitiative(avatar) {
    if (!settings.initiativeEnabled) return 0;
    // Initiative: random base + slight variation
    const base = settings.initiativeBaseScore;
    const roll = Math.random() * base;
    roundInitiative[avatar] = roll;
    return roll;
}

// ─── Scoring System ───────────────────────────────────────────────────
function scoreCharacter(chId, recentMessages) {
    const char = characters[chId];
    if (!char) return -Infinity;

    const name = char.name;
    const avatar = char.avatar;
    const weights = settings.scoreWeights;

    let score = 0;

    // 1. Mention score: character name appears in recent messages
    const recentText = recentMessages.map(m => m.mes || '').join(' ');
    const mentionRegex = new RegExp(name, 'gi');
    const mentionCount = (recentText.match(mentionRegex) || []).length;
    score += mentionCount * weights.mention;

    // 2. Keyword trigger score
    if (roundTriggeredAvatars.has(avatar)) {
        score += settings.triggerScore;
    }

    // 3. Recency score: bonus for not having spoken recently
    const lastSpokenIndex = findLastSpokenIndex(avatar, recentMessages);
    if (lastSpokenIndex === -1) {
        // Hasn't spoken in recent messages at all — big bonus
        score += weights.recency;
    } else {
        // The more recent they spoke, the less bonus
        const ratio = lastSpokenIndex / Math.max(recentMessages.length, 1);
        score += weights.recency * ratio;
    }

    // 4. Consecutive speaking penalty
    const consecutiveCount = countConsecutiveMessages(avatar);
    score -= consecutiveCount * settings.consecutivePenalty;

    // 5. Talkativeness
    const talkativeness = isNaN(char.talkativeness) ? 0.5 : Number(char.talkativeness);
    score += talkativeness * weights.talkativeness;

    // 6. Initiative roll
    score += roundInitiative[avatar] || 0;

    log(`Score for ${name}: ${score.toFixed(1)} (mention=${mentionCount}, trigger=${roundTriggeredAvatars.has(avatar)}, recencyIdx=${lastSpokenIndex}, consec=${consecutiveCount}, talk=${talkativeness.toFixed(2)})`);
    return score;
}

function findLastSpokenIndex(avatar, recentMessages) {
    // Iterate from newest to oldest. Returns 0 for most recent speaker,
    // N-1 for earliest speaker in the window, -1 if never spoke.
    for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        if (!msg.is_user && !msg.is_system) {
            const msgAvatar = msg.avatar || '';
            const msgName = msg.name || '';
            const char = characters.find(c => c.avatar === avatar);
            if (msgAvatar === avatar || (char && msgName === char.name)) {
                return recentMessages.length - 1 - i;
            }
        }
    }
    return -1;
}

function countConsecutiveMessages(avatar) {
    // Count how many of the most recent messages are from this avatar
    let count = 0;
    const char = characters.find(c => c.avatar === avatar);
    if (!char) return 0;

    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (msg.is_user || msg.is_system) break;
        const msgAvatar = msg.avatar || '';
        const msgName = msg.name || '';
        if (msgAvatar === avatar || msgName === char.name) {
            count++;
        } else {
            break;
        }
    }
    return count;
}

// ─── Round Initialization ─────────────────────────────────────────────
function getCurrentGroup() {
    if (!selected_group) return null;
    return groups.find(g => g.id === selected_group) || null;
}

function initFormulaRound() {
    roundScores = {};
    roundTriggeredAvatars.clear();
    roundInitiative = {};

    const group = getCurrentGroup();
    if (!group) return;

    const recentMessages = getRecentMessages();

    // Pre-compute triggers and initiative for all members
    for (const memberAvatar of group.members) {
        if (group.disabled_members?.includes(memberAvatar)) continue;

        const chId = characters.findIndex(c => c.avatar === memberAvatar);
        if (chId === -1) continue;

        const char = characters[chId];

        // Check triggers
        if (checkTriggers(char.name, memberAvatar, recentMessages)) {
            roundTriggeredAvatars.add(memberAvatar);
        }

        // Roll initiative
        rollInitiative(memberAvatar);

        // Score character
        roundScores[memberAvatar] = scoreCharacter(chId, recentMessages);
    }

    log('Round scores:', Object.entries(roundScores)
        .sort((a, b) => b[1] - a[1])
        .map(([a, s]) => `${characters.find(c => c.avatar === a)?.name || a}: ${s.toFixed(1)}`)
        .join(', '));
}

function getRecentMessages() {
    const count = Math.min(settings.recentMessageCount, chat.length);
    return chat.slice(-count);
}

// ─── Main Interceptor ─────────────────────────────────────────────────
// Runs once per activated character before its Generate() call.
globalThis.groupDirector_Interceptor = async function (chatArray, contextSize, abort, type) {
    if (settings.mode === MODE_OFF) return;
    if (type === 'quiet' || type === 'impersonate' || type === 'continue') return;

    const group = getCurrentGroup();
    if (!group) return;

    const ctx = getContext();
    const activeCharId = ctx.characterId;
    if (activeCharId === undefined || activeCharId === null) return;

    const char = characters[activeCharId];
    if (!char) return;

    const avatar = char.avatar;

    // First speaker of the round: initialize state (run rules or call LLM)
    if (!roundInitialized) {
        roundInitialized = true;
        if (settings.mode === MODE_LLM) {
            await initRoundWithLLM();
            // If LLM failed and returned nothing, fall back transparently — allow all
            if (!llmPickedAvatars || llmPickedAvatars.length === 0) {
                log('LLM produced no decision; falling back to transparent (allow all)');
            }
        } else {
            initFormulaRound();
        }
    }

    // ─── Mode: LLM ──────────────────────────────────────────────────
    if (settings.mode === MODE_LLM) {
        // Manual ordered generation in progress — validate identity, inject script, let through
        if (takeoverGenCount > 0) {
            // Auto-swipe/regenerate during takeover: same character re-rolling,
            // don't consume the takeover count. Detected via roundGenerateType
            // which is now captured before the nested START guard.
            const isReroll = roundGenerateType === 'swipe' || roundGenerateType === 'regenerate';
            if (!isReroll) {
                takeoverGenCount--;
                roundSpeakerCount++;
            }
            // Verify the character ST is about to generate matches the expected speaker
            const expectedAvatar = llmPickedAvatars?.[roundSpeakerCount - 1];
            if (expectedAvatar && avatar !== expectedAvatar) {
                console.error(`[GroupDirector] TAKEOVER MISMATCH: ST wants ${char.name} (${avatar}) but director expects speaker #${roundSpeakerCount} (${characters.find(c => c.avatar === expectedAvatar)?.name || expectedAvatar}). Aborting!`);
                abort(false);
                return;
            }
            // Safety-net script injection: ensure the correct per-character script is set
            const takeoverScript = getScriptForChar(char.name);
            if (takeoverScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, takeoverScript, extension_prompt_types.IN_PROMPT, 0, true);
            }
            console.warn(`[GroupDirector] MANUAL-GEN ALLOWED ${char.name} (takeoverGenCount→${takeoverGenCount}, speaker #${roundSpeakerCount}${isReroll ? ', reroll' : ''})`);
            return;
        }
        // ST's activation loop is being suppressed — abort all
        if (takeoverPending) {
            console.warn(`[GroupDirector] TAKEOVER-BLOCK ${char.name} (ST order suppressed, director will drive order)`);
            abort(false);
            return;
        }
        if (!llmPickedSet) {
            return;
        }
        if (!llmPickedSet.has(avatar)) {
            log(`BLOCKED ${char.name} (not in LLM picks)`);
            abort(false);
            return;
        }
        // Best-effort order tracking (non-takeover mode)
        if (settings.llmRespectOrder) {
            while (llmCursor < llmPickedAvatars.length && llmSpokenSet.has(llmPickedAvatars[llmCursor])) {
                llmCursor++;
            }
            const expected = llmPickedAvatars[llmCursor];
            if (expected && expected !== avatar) {
                log(`OUT-OF-ORDER: ${char.name} speaking before ${characters.find(c => c.avatar === expected)?.name || expected}. Still allowed.`);
                llmCursor = llmPickedAvatars.findIndex(a => !llmSpokenSet.has(a));
                if (llmCursor === -1) llmCursor = llmPickedAvatars.length;
            } else if (expected === avatar) {
                llmCursor++;
            }
        }
        // Validate: this character must be in the picked set
        if (!llmPickedSet.has(avatar)) {
            console.warn(`[GroupDirector] VALIDATION FAILED: ${char.name} (${avatar}) not in llmPickedSet! Aborting.`);
            abort(false);
            return;
        }
        llmSpokenSet.add(avatar);
        roundSpeakerCount++;
        // Inject per-character director script
        const charScript = getScriptForChar(char.name);
        if (charScript) {
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
        }
        log(`ALLOWED ${char.name} (LLM pick #${roundSpeakerCount})`);
        return;
    }

    // ─── Mode: Formula (Top-N) ──────────────────────────────────────
    const sortedAvatars = Object.entries(roundScores)
        .sort((a, b) => b[1] - a[1])
        .map(([a]) => a);
    const topN = Math.min(settings.topN, sortedAvatars.length);
    const allowedAvatars = new Set(sortedAvatars.slice(0, topN));
    const score = roundScores[avatar] ?? -Infinity;

    if (allowedAvatars.has(avatar)) {
        roundSpeakerCount++;
        log(`ALLOWED ${char.name} (score=${score.toFixed(1)}, speaker #${roundSpeakerCount})`);
    } else {
        log(`BLOCKED ${char.name} (score=${score.toFixed(1)})`);
        abort(false);
    }
};

// ─── Event Listeners ─────────────────────────────────────────────────
let roundGenerateType = 'normal'; // captured from GROUP_WRAPPER_STARTED

eventSource.on(event_types.GROUP_WRAPPER_STARTED, (data) => {
    // Always capture the generation type, even for nested wrappers.
    // Auto-swipes during takeover need to be visible to the interceptor.
    roundGenerateType = data?.type || 'normal';

    // If manual ordered generation is in progress (force_chid sub-calls),
    // don't reset state — the sub-wrapper is just a vehicle for single-char gen.
    if (takeoverGenCount > 0) {
        console.warn('[GroupDirector] Nested GROUP_WRAPPER_STARTED during manual gen — preserving state');
        return;
    }

    // Previous takeover failed mid-round: reuse the existing director decision
    // instead of making a new one. Chat already has partial messages from the
    // failed attempt; a new decision would conflict with existing dialog boxes.
    if (takeoverFailed) {
        takeoverFailed = false;
        takeoverPending = settings.mode === MODE_LLM && settings.llmRespectOrder;
        takeoverGenCount = 0;
        llmSpokenSet = new Set();
        llmCursor = 0;
        roundSpeakerCount = 0;
        roundGenerateType = data?.type || 'normal';
        console.warn('[GroupDirector] Retry after takeover failure — reusing existing director plan');
        return;
    }

    isGroupChat = true;

    // Regenerate / swipe: reuse the existing director decision — only reset
    // per-speaker tracking. Don't re-trigger takeover; let ST decide which
    // messages to regenerate. Reconstruct state from chat_metadata so it
    // survives browser restarts (in-memory state is gone on reload).
    if (roundGenerateType === 'regenerate' || roundGenerateType === 'swipe') {
        if (!llmPickedSet) {
            const history = getDirectorHistory();
            const lastPlan = history[history.length - 1];
            if (lastPlan && Array.isArray(lastPlan.speakers) && lastPlan.speakers.length > 0) {
                const group = getCurrentGroup();
                const members = group?.members?.filter(a => !group.disabled_members?.includes(a)) || [];
                const avatars = [];
                for (const name of lastPlan.speakers) {
                    const c = matchCharacterByName(name, members);
                    if (c) avatars.push(c.avatar);
                }
                if (avatars.length > 0) {
                    llmPickedAvatars = avatars;
                    llmPickedSet = new Set(avatars);
                    directorScripts = {};
                    if (lastPlan.scripts && typeof lastPlan.scripts === 'object') {
                        for (const [name, script] of Object.entries(lastPlan.scripts)) {
                            const c = matchCharacterByName(name, members);
                            if (c) directorScripts[c.name] = script;
                        }
                    }
                    roundInitialized = true;
                    log('Regenerate/swipe — reconstructed director plan from chat_metadata');
                }
            }
        }
        if (!llmPickedSet) {
            // No history to reconstruct from — let it fall through to normal init
            // so the interceptor doesn't operate on null state.
            log('Regenerate/swipe — no persisted plan found, falling through to normal round init');
        } else {
            llmSpokenSet = new Set();
            llmCursor = 0;
            roundSpeakerCount = 0;
            takeoverPending = false;
            takeoverGenCount = 0;
            log('Regenerate/swipe — reusing director plan, no takeover');
            return;
        }
    }

    roundScores = {};
    roundSpeakerCount = 0;
    roundTriggeredAvatars.clear();
    roundInitiative = {};
    llmPickedAvatars = null;
    llmPickedSet = null;
    llmSpokenSet = new Set();
    llmCursor = 0;
    roundInitialized = false;
    takeoverPending = false;
    takeoverGenCount = 0;
    takeoverFailed = false;
    directorScripts = {};
    wiState.text = '';
    wiState.entries = [];
    log(`Group generation started (mode=${settings.mode}, type=${roundGenerateType})`);
});

eventSource.on(event_types.GROUP_WRAPPER_FINISHED, async () => {
    isGroupChat = false;
    log('Group generation finished');

    if (takeoverPending && llmPickedAvatars && llmPickedAvatars.length > 0) {
        await runManualOrderedGeneration();
    }
    takeoverPending = false;
});

// When messages are deleted, the chat timeline has rolled back.
// All in-memory runtime state based on the old timeline is now invalid.
// Clear it BEFORE pruning history so no stale pointers linger.
eventSource.on(event_types.MESSAGE_DELETED, (newChatLength) => {
    roundScores = {};
    roundSpeakerCount = 0;
    roundTriggeredAvatars.clear();
    roundInitiative = {};
    llmPickedAvatars = null;
    llmPickedSet = null;
    llmSpokenSet = new Set();
    llmCursor = 0;
    roundInitialized = false;
    takeoverPending = false;
    takeoverGenCount = 0;
    takeoverFailed = false;
    directorScripts = {};
    wiState.text = '';
    wiState.entries = [];
    pruneDirectorHistory(newChatLength);
});

// ─── Manual Ordered Generation (takeover) ─────────────────────────────
async function runManualOrderedGeneration() {
    takeoverPending = false;
    const orderedList = [...llmPickedAvatars];
    takeoverGenCount = orderedList.length;
    const ctx = getContext();
    const savedChId = ctx.characterId;
    const savedChName = characters[savedChId]?.name || '';

    console.warn('[GroupDirector] TAKEOVER START — orderedList:', orderedList.map(a => characters.find(c => c.avatar === a)?.name));
    console.warn('[GroupDirector] takeoverGenCount:', takeoverGenCount);

    try {
        for (let i = 0; i < orderedList.length; i++) {
            const avatar = orderedList[i];
            const chId = characters.findIndex(c => c.avatar === avatar);
            if (chId === -1) {
                takeoverGenCount--;
                console.warn('[GroupDirector] SKIP unknown avatar, takeoverGenCount→', takeoverGenCount);
                continue;
            }
            setCharacterId(chId);
            setCharacterName(characters[chId].name);
            // Validate: the context must now point to the character we intend to generate
            const verifyChId = getContext().characterId;
            const verifyAvatar = characters[verifyChId]?.avatar;
            if (verifyAvatar !== avatar) {
                console.error(`[GroupDirector] VALIDATION FAILED: takeover set chId=${chId} for avatar=${avatar}, but context has chId=${verifyChId} avatar=${verifyAvatar} — aborting this speaker`);
                takeoverGenCount--;
                continue;
            }
            console.warn(`[GroupDirector] GEN #${i + 1}: ${characters[chId].name} (chId=${chId}, takeoverGenCount=${takeoverGenCount})`);

            // Inject per-character director script
            const charScript = getScriptForChar(characters[chId].name);
            if (charScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
            }
            try {
                // Re-set character identity right before generation, in case
                // something between setCharacterId and here mutated this_chid
                setCharacterId(chId);
                setCharacterName(characters[chId].name);
                await ctx.generate('normal', { force_chid: chId });
                // Post-generation identity check only. Empty/think-only replies
                // are NOT treated as errors — ST's auto-swipe already handled them
                // internally. By the time we get here, the message is finalized.
                if (chat.length > 0) {
                    const lastMsg = chat[chat.length - 1];
                    if (lastMsg && !lastMsg.is_user && !lastMsg.is_system && lastMsg.name !== characters[chId].name) {
                        console.error(`[GroupDirector] POST-GEN MISMATCH: expected "${characters[chId].name}" but generated message has name "${lastMsg.name}" — character identity was swapped!`);
                    }
                }
                console.warn(`[GroupDirector] GEN #${i + 1} DONE: ${characters[chId].name}`);
            } catch (e) {
                console.error('[GroupDirector] GEN FAILED:', e.message, e.stack);
                takeoverGenCount = 0;
                takeoverFailed = true;
                // Preserve llmPickedAvatars, llmPickedSet, directorScripts, roundInitialized
                // so a retry reuses the same director decision instead of making a new one.
                return;
            } finally {
                if (charScript) {
                    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', extension_prompt_types.IN_PROMPT, 0, true);
                }
            }
        }

        console.warn('[GroupDirector] TAKEOVER COMPLETE — all speakers generated');
    } finally {
        console.warn('[GroupDirector] TAKEOVER FINALLY — resetting flags');
        takeoverGenCount = 0;
        // Restore the original character context so ST doesn't stay stuck
        // on the last generated character after takeover
        if (savedChId !== undefined && savedChId !== null) {
            setCharacterId(savedChId);
            setCharacterName(savedChName);
        }
    }
}

// ─── LLM Mode (Director) ──────────────────────────────────────────────
async function buildDirectorWorldInfo(enabledMembers) {
    if (!settings.llmWorldInfoEnabled) {
        return { text: '', entries: [] };
    }

    try {
        // Replicate Generate's chatForWI exactly (script.js:4535)
        const coreChat = chat.filter(x => !x.is_system);
        const chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse();
        const maxCtx = Number(getContext().maxContext) || 100000;

        // Build global scan data from all enabled members + persona (script.js:4537-4545)
        const personaText = power_user.persona_description || '';
        const allDesc = enabledMembers
            .map(a => characters.find(c => c.avatar === a))
            .filter(Boolean)
            .map(c => [c.description, c.personality, c.scenario].filter(Boolean).join(' '))
            .join(' ');
        const firstMember = characters.find(c => enabledMembers.includes(c.avatar));

        // Call checkWorldInfo directly — getWorldInfoPrompt wraps it but
        // discards allActivatedEntries (returns new Set()) in its result.
        const activated = await checkWorldInfo(chatForWI, maxCtx, false, {
            trigger: 'normal',
            personaDescription: personaText,
            characterDescription: allDesc,
            characterPersonality: firstMember?.personality || '',
            characterDepthPrompt: '',
            scenario: firstMember?.scenario || '',
            creatorNotes: '',
        });

        const entries = Array.from(activated?.allActivatedEntries || []);
        const text = entries.length > 0
            ? entries.map(e => {
                const label = e.comment || e.uid || 'entry';
                const content = e.content || '';
                return `[${label}]\n${content}`;
            }).join('\n')
            : ((activated?.worldInfoBefore || '') + (activated?.worldInfoAfter || ''));

        log(`World Info: ${entries.length} entries activated`, entries.map(e => e.comment || e.uid));

        return { text, entries };
    } catch (e) {
        console.warn('[GroupDirector] World Info fetch failed:', e.message);
        return { text: '', entries: [] };
    }
}

async function initRoundWithLLM() {
    const group = getCurrentGroup();
    if (!group) return;

    try {
        const llmDepth = Math.min(settings.llmContextDepth, chat.length);
        const recentMessages = chat.slice(-llmDepth);
        const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));

        const runtimeContext = {
            recentMessages,
            enabledMembers,
            maxSpeakers: settings.llmMaxSpeakers,
        };

        const promptTemplate = settings.llmPrompt || getDefaultLlmPrompt();
        const filled = await renderPrompt(promptTemplate, runtimeContext);

        const ctx = getContext();
        const response = await ctx.generateRaw({
            prompt: filled,
        });

        // Clear quiet prompt extension to prevent Director text leaking
        // into subsequent character generation prompts.
        setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

        log('LLM raw response:', response);

        const parsed = parseLlmResponse(response, log);
        if (!parsed || !Array.isArray(parsed.speakers) || parsed.speakers.length === 0) {
            log('LLM returned no valid speakers');
            return;
        }

        // Save full parsed JSON to history (independent of continuity injection)
        if (settings.llmHistoryEnabled) {
            await addToDirectorHistory(parsed);
        }

        // Map names → avatars in declared order; dedupe
        const orderedAvatars = [];
        const seen = new Set();
        for (const name of parsed.speakers) {
            const c = matchCharacterByName(name, enabledMembers);
            if (c && !seen.has(c.avatar)) {
                seen.add(c.avatar);
                orderedAvatars.push(c.avatar);
            } else if (!c) {
                log(`LLM returned unrecognized name: "${name}" — skipped`);
            }
        }

        // Cap at maxSpeakers
        const capped = orderedAvatars.slice(0, settings.llmMaxSpeakers);

        if (capped.length === 0) {
            log('LLM names did not match any group member. Speakers returned:', parsed.speakers);
            return;
        }

        llmPickedAvatars = capped;
        llmPickedSet = new Set(capped);
        llmCursor = 0;

        // Validate: every picked avatar must be a current enabled group member
        for (const av of capped) {
            if (!enabledMembers.includes(av)) {
                console.warn(`[GroupDirector] VALIDATION FAILED: picked avatar ${av} not in enabled members! Removing.`);
                llmPickedSet.delete(av);
            }
        }
        llmPickedAvatars = capped.filter(av => llmPickedSet.has(av));
        if (llmPickedAvatars.length === 0) {
            console.warn('[GroupDirector] All picked speakers failed validation — aborting director round');
            llmPickedAvatars = null;
            llmPickedSet = null;
            return;
        }

        // Store director script if present
        // Store per-character scripts from LLM response
        directorScripts = {};
        if (settings.llmScriptEnabled && parsed.scripts && typeof parsed.scripts === 'object') {
            for (const [name, script] of Object.entries(parsed.scripts)) {
                if (script && typeof script === 'string') {
                    // Match to actual character name
                    const c = matchCharacterByName(name, enabledMembers);
                    if (c) directorScripts[c.name] = script;
                }
            }
        }
        // Fallback: single script field → assign to all picked characters
        if (Object.keys(directorScripts).length === 0 && settings.llmScriptEnabled && parsed.script) {
            for (const a of capped) {
                const c = characters.find(c => c.avatar === a);
                if (c) directorScripts[c.name] = parsed.script;
            }
        }

        // If strict order requested, takeover the round: suppress ST's loop
        // then manually drive generation in LLM's declared order.
        if (settings.llmRespectOrder) {
            takeoverPending = true;
            console.warn('[GroupDirector] TAKEOVER SET — suppressing ST order, picked:', capped.map(a => characters.find(c => c.avatar === a)?.name));
        }

        log('LLM picked order:', capped.map(a =>
            characters.find(c => c.avatar === a)?.name).join(' → '),
            parsed.reason ? `(${parsed.reason})` : '');
    } catch (e) {
        console.error('[GroupDirector] LLM call failed:', e);
    }
}

// parseLlmResponse, extractJsonObject, sanitizeJson — now in utils/json-utils.js

/**
 * Match a name from LLM output to a group member character.
 * Tries exact match first, then case-insensitive, then substring (longest wins).
 * Returns the character object or null.
 */
function matchCharacterByName(name, enabledMembers) {
    if (!name || typeof name !== 'string') return null;

    const trimmed = name.trim();
    if (!trimmed) return null;

    // 1. Exact match (case-sensitive)
    for (const avatar of enabledMembers) {
        const c = characters.find(c => c.avatar === avatar);
        if (c && c.name === trimmed) return c;
    }

    // 2. Case-insensitive exact match
    const lower = trimmed.toLowerCase();
    for (const avatar of enabledMembers) {
        const c = characters.find(c => c.avatar === avatar);
        if (c && c.name.toLowerCase() === lower) return c;
    }

    // 3. Substring match — character name contains the LLM name or vice versa
    let best = null;
    let bestLen = 0;
    for (const avatar of enabledMembers) {
        const c = characters.find(c => c.avatar === avatar);
        if (!c) continue;
        const cLower = c.name.toLowerCase();
        if (cLower.includes(lower) || lower.includes(cLower)) {
            if (c.name.length > bestLen) {
                best = c;
                bestLen = c.name.length;
            }
        }
    }

    return best;
}

function getDefaultLlmPrompt() {
    // Context at TOP — instruction/format at BOTTOM for maximum adherence in long contexts
    let base = `{{worldInfo}}{{previousPlans}}{{previousPlan}}Recent messages:
{{recentMessages}}

Available characters:
{{characters}}

Character profiles (detailed analysis):
{{character_profiles}}

---
You are a Group Chat Director. Decide which characters should respond next, and in what order.

Rules:
- Pick at most {{maxSpeakers}} character(s).
- Order them by who should speak FIRST, SECOND, etc.
- Only pick characters who have a meaningful reason to respond now.
- It is OK to pick just one character if only one fits.`;

    if (settings.llmScriptEnabled) {
        base += `
- Also write a SHORT stage direction for EACH picked character. The script tells the character HOW to act, not WHAT to say.
- Write scripts in imperative stage-direction style (e.g. "你紧张地搓着手，不敢直视对方"). Do NOT write long prose or dialogue.
- The character will see ONLY their own script, NOT the full plan. They are instructed to follow it without revealing its existence.`;

        if (settings.llmScriptPrompt) {
            base += `\n- Script theme / requirements: ${settings.llmScriptPrompt}`;
        }
    }

    base += `

Reply with ONLY a JSON object, no prose, no code fences:
{
  "speakers": ["NameOfFirstSpeaker", "NameOfSecondSpeaker"],
  "reason": "short justification"`;

    if (settings.llmScriptEnabled) {
        base += `,
  "scripts": {
    "NameOfFirstSpeaker": "short imperative stage direction",
    "NameOfSecondSpeaker": "short imperative stage direction"
  }`;
    }

    base += `
}`;
    return base;
}


// ─── Settings UI ──────────────────────────────────────────────────────
async function loadSettingsUI() {
    const html = await renderExtensionTemplateAsync(
    'third-party/SillyTavern-GroupDirector',
    'settings'
);
    $('#extensions_settings').append(html);

    const $c = (sel) => $(`#gd-${sel}`);

    // Language selector
    $c('lang').val(settings.lang);
    applyI18n(settings.lang);
    $c('lang').on('change', function () {
        settings.lang = $(this).val();
        applyI18n(settings.lang);
        saveSettings();
    });

    // Bind mode radios
    $(`input[name="gd-mode"][value="${settings.mode}"]`).prop('checked', true);
    applyModeVisibility(settings.mode);
    $('input[name="gd-mode"]').on('change', function () {
        const newMode = $(this).val();
        settings.mode = newMode;
        applyModeVisibility(newMode);
        saveSettings();
    });

    // Formula values
    $c('topn').val(settings.topN);
    $c('recent-count').val(settings.recentMessageCount);
    $c('consecutive-penalty').val(settings.consecutivePenalty);
    $c('trigger-enabled').prop('checked', settings.triggerEnabled);
    $c('trigger-score').val(settings.triggerScore);
    $c('initiative-enabled').prop('checked', settings.initiativeEnabled);
    $c('initiative-base').val(settings.initiativeBaseScore);
    $c('mention-weight').val(settings.scoreWeights.mention);
    $c('keyword-weight').val(settings.scoreWeights.keyword);
    $c('recency-weight').val(settings.scoreWeights.recency);
    $c('talkativeness-weight').val(settings.scoreWeights.talkativeness);
    $c('debug').prop('checked', settings.debugLogging);

    // LLM values
    $c('llm-prompt').val(settings.llmPrompt || getDefaultLlmPrompt());
    $c('llm-max-speakers').val(settings.llmMaxSpeakers);
    $c('llm-context-depth').val(settings.llmContextDepth);
    $c('llm-respect-order').prop('checked', settings.llmRespectOrder);
    $(`input[name="gd-llm-char-desc-mode"][value="${settings.llmCharDescMode}"]`).prop('checked', true);
    $c('llm-char-desc-length').val(settings.llmCharDescLength);
    $c('llm-script-enabled').prop('checked', settings.llmScriptEnabled);
    $c('llm-script-prompt').val(settings.llmScriptPrompt);
    $c('llm-script-wrapper').val(settings.llmScriptWrapper);
    $c('llm-history-enabled').prop('checked', settings.llmHistoryEnabled);
    // Show persisted script prompt from chat metadata (if any)
    const persistedScript = chat_metadata?.[EXT_KEY]?.historyMeta?.scriptPrompt;
    const $metaDisplay = $('#gd-history-meta-display');
    if (persistedScript) {
        $('#gd-history-meta-script').text(persistedScript);
        $metaDisplay.show();
    } else {
        $metaDisplay.hide();
    }
    $c('llm-script-continuity').prop('checked', settings.llmScriptContinuity);
    $c('llm-script-continuity-wrapper').val(settings.llmScriptContinuityWrapper);
    $(`input[name="gd-llm-script-continuity-mode"][value="${settings.llmScriptContinuityMode}"]`).prop('checked', true);
    $c('llm-script-continuity-count').val(settings.llmScriptContinuityCount);
    $c('llm-script-continuity-history-wrapper').val(settings.llmScriptContinuityHistoryWrapper);
    $c('llm-world-info-enabled').prop('checked', settings.llmWorldInfoEnabled);
    $c('llm-world-info-wrapper').val(settings.llmWorldInfoWrapper);
    toggleContinuityMode(settings.llmScriptContinuityMode);
    toggleCharDescLength(settings.llmCharDescMode);

    // Formula bindings
    $c('topn').on('input', function () { settings.topN = parseInt($(this).val()) || 1; saveSettings(); });
    $c('recent-count').on('input', function () { settings.recentMessageCount = parseInt($(this).val()) || 10; saveSettings(); });
    $c('consecutive-penalty').on('input', function () { settings.consecutivePenalty = parseInt($(this).val()) || 15; saveSettings(); });
    $c('trigger-enabled').on('input', function () { settings.triggerEnabled = !!$(this).prop('checked'); saveSettings(); });
    $c('trigger-score').on('input', function () { settings.triggerScore = parseInt($(this).val()) || 40; saveSettings(); });
    $c('initiative-enabled').on('input', function () { settings.initiativeEnabled = !!$(this).prop('checked'); saveSettings(); });
    $c('initiative-base').on('input', function () { settings.initiativeBaseScore = parseInt($(this).val()) || 5; saveSettings(); });
    $c('mention-weight').on('input', function () { settings.scoreWeights.mention = parseInt($(this).val()) || 30; saveSettings(); });
    $c('keyword-weight').on('input', function () { settings.scoreWeights.keyword = parseInt($(this).val()) || 15; saveSettings(); });
    $c('recency-weight').on('input', function () { settings.scoreWeights.recency = parseInt($(this).val()) || 20; saveSettings(); });
    $c('talkativeness-weight').on('input', function () { settings.scoreWeights.talkativeness = parseInt($(this).val()) || 10; saveSettings(); });
    $c('debug').on('input', function () { settings.debugLogging = !!$(this).prop('checked'); saveSettings(); });

    // LLM bindings
    $c('llm-prompt').on('input', function () { settings.llmPrompt = $(this).val(); saveSettings(); });
    $c('llm-max-speakers').on('input', function () { settings.llmMaxSpeakers = parseInt($(this).val()) || 3; saveSettings(); });
    $c('llm-context-depth').on('input', function () { settings.llmContextDepth = parseInt($(this).val()) || 10; saveSettings(); });
    $c('llm-respect-order').on('input', function () { settings.llmRespectOrder = !!$(this).prop('checked'); saveSettings(); });
    $('input[name="gd-llm-char-desc-mode"]').on('change', function () {
        settings.llmCharDescMode = $(this).val();
        toggleCharDescLength(settings.llmCharDescMode);
        saveSettings();
    });
    $c('llm-char-desc-length').on('input', function () { settings.llmCharDescLength = parseInt($(this).val()) || 200; saveSettings(); });
    $c('llm-script-enabled').on('input', function () { settings.llmScriptEnabled = !!$(this).prop('checked'); saveSettings(); });
    $c('llm-script-prompt').on('input', function () {
        settings.llmScriptPrompt = $(this).val();
        const val = $(this).val();
        if (val) {
            $('#gd-history-meta-script').text(val);
            $('#gd-history-meta-display').show();
        }
        saveSettings();
    });
    $c('llm-script-wrapper').on('input', function () { settings.llmScriptWrapper = $(this).val(); saveSettings(); });
    $c('llm-history-enabled').on('input', function () { settings.llmHistoryEnabled = !!$(this).prop('checked'); saveSettings(); });
    $c('llm-history-clear').on('click', function () {
        if (chat_metadata[EXT_KEY]) {
            chat_metadata[EXT_KEY].directorHistory = [];
            if (chat_metadata[EXT_KEY].historyMeta) {
                chat_metadata[EXT_KEY].historyMeta.scriptPrompt = '';
            }
        }
        $('#gd-history-meta-display').hide();
        saveChatConditional();
        toastr.info('导演账本已清空');
    });
    $c('llm-script-continuity').on('input', function () { settings.llmScriptContinuity = !!$(this).prop('checked'); saveSettings(); });
    $c('llm-script-continuity-wrapper').on('input', function () { settings.llmScriptContinuityWrapper = $(this).val(); saveSettings(); });
    $('input[name="gd-llm-script-continuity-mode"]').on('change', function () {
        settings.llmScriptContinuityMode = $(this).val();
        toggleContinuityMode(settings.llmScriptContinuityMode);
        saveSettings();
    });
    $c('llm-script-continuity-count').on('input', function () { settings.llmScriptContinuityCount = parseInt($(this).val()) || 0; saveSettings(); });
    $c('llm-script-continuity-history-wrapper').on('input', function () { settings.llmScriptContinuityHistoryWrapper = $(this).val(); saveSettings(); });
    $c('llm-world-info-enabled').on('input', function () { settings.llmWorldInfoEnabled = !!$(this).prop('checked'); saveSettings(); });
    $c('llm-world-info-wrapper').on('input', function () { settings.llmWorldInfoWrapper = $(this).val(); saveSettings(); });

    // Reset prompt button
    $c('llm-prompt-reset').on('click', function () {
        const defaultP = getDefaultLlmPrompt();
        $c('llm-prompt').val(defaultP);
        settings.llmPrompt = defaultP;
        saveSettings();
    });

    // ── Profile System UI Bindings ──
    $c('profile-enabled').prop('checked', settings.profileEnabled);
    $c('profile-token-budget').val(settings.profileTokenBudget);
    $c('profile-concurrency').val(settings.profileConcurrency);
    // Show default templates in the UI when the setting is empty,
    // but keep the setting as '' (meaning "use built-in default" at runtime).
    $c('profile-generator-prompt').val(settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt());
    $c('profile-json-schema').val(settings.profileJsonSchema || getDefaultProfileSchema());
    $c('profile-render-template').val(settings.profileRenderTemplate || getDefaultProfileRenderTemplate());
    $('#gd-profile-section').toggle(settings.profileEnabled);

    $c('profile-enabled').on('input', function () {
        settings.profileEnabled = !!$(this).prop('checked');
        $('#gd-profile-section').toggle(settings.profileEnabled);
        if (settings.profileEnabled) {
            refreshProfileManagementUI();
            checkProfileStartupStatus();
        }
        saveSettings();
    });

    // Manual scan button: re-reads chat_metadata and shows the loader panel
    $c('profile-scan-save').on('click', function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat');
            return;
        }
        buildProfileLoaderPanel();
        toastr.info(settings.lang === 'zh' ? '已扫描存档' : 'Save scanned');
    });

    $c('profile-detect-changes').on('click', function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat');
            return;
        }
        detectCharacterChanges();
    });
    $c('profile-token-budget').on('input', function () { settings.profileTokenBudget = parseInt($(this).val()) || 2000; saveSettings(); });
    $c('profile-concurrency').on('input', function () { settings.profileConcurrency = parseInt($(this).val()) || 0; saveSettings(); });
    $c('profile-generator-prompt').on('input', function () { settings.profileGeneratorPrompt = $(this).val(); saveSettings(); });
    $c('profile-json-schema').on('input', function () { settings.profileJsonSchema = $(this).val(); saveSettings(); });
    $c('profile-render-template').on('input', function () {
        settings.profileRenderTemplate = $(this).val();
        validateAndWarnProfilePlaceholders('render');
        saveSettings();
    });

    $c('profile-generator-reset').on('click', function () {
        const def = getDefaultProfileGeneratorPrompt();
        $c('profile-generator-prompt').val(def);
        settings.profileGeneratorPrompt = '';
        saveSettings();
    });
    $c('profile-schema-reset').on('click', function () {
        const def = getDefaultProfileSchema();
        $c('profile-json-schema').val(def);
        settings.profileJsonSchema = '';
        saveSettings();
    });
    $c('profile-render-reset').on('click', function () {
        const def = getDefaultProfileRenderTemplate();
        $c('profile-render-template').val(def);
        settings.profileRenderTemplate = '';
        saveSettings();
    });

    $c('profile-regenerate-all').on('click', async function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat');
            return;
        }
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) {
            toastr.warning(settings.lang === 'zh' ? '当前群聊没有可用角色' : 'No enabled members in current group');
            return;
        }
        const btn = $('#gd-profile-regenerate-all');
        btn.prop('disabled', true);
        const lang = settings.lang || 'zh';
        toastr.info(lang === 'zh' ? `正在为 ${members.length} 个角色生成档案...` : `Generating profiles for ${members.length} characters...`);
        try {
            await generateProfilesBatch(members);
            const profiles = getProfiles();
            const ready = Object.values(profiles).filter(p => p.state === 'ready').length;
            const failed = Object.values(profiles).filter(p => p.state === 'failed').length;
            if (failed > 0) {
                toastr.warning(lang === 'zh'
                    ? `${ready} 个就绪, ${failed} 个失败 — 查看控制台了解详情`
                    : `${ready} ready, ${failed} failed — check console for details`);
            } else {
                toastr.success(lang === 'zh'
                    ? `${ready} 个角色档案已更新`
                    : `${ready} character profiles updated`);
            }
        } catch (e) {
            toastr.error(lang === 'zh' ? '生成失败，请查看控制台' : 'Generation failed, check console');
            console.error('[GroupDirector] Batch profile generation failed:', e);
        } finally {
            btn.prop('disabled', false);
        }
    });

    // Initial render and status check
    refreshProfileManagementUI();
    checkProfileStartupStatus();
}

function applyModeVisibility(mode) {
    $('#gd-formula-section').toggle(mode === MODE_FORMULA);
    $('#gd-llm-section').toggle(mode === MODE_LLM);
    $('#gd-off-hint').toggle(mode === MODE_OFF);
}

function toggleCharDescLength(mode) {
    $('#gd-llm-char-desc-length').prop('disabled', mode !== 'slice');
}

function toggleContinuityMode(mode) {
    $('#gd-llm-script-continuity-count').prop('disabled', mode !== 'history');
    $('#gd-llm-script-continuity-history-wrapper').prop('disabled', mode !== 'history');
    $('#gd-llm-script-continuity-wrapper').prop('disabled', mode !== 'last');
}

// ─── Profile System: Management UI ─────────────────────────────────────
function buildProfileLoaderPanel() {
    if (!settings.profileEnabled) return;
    const group = getCurrentGroup();
    if (!group) return;
    const members = group.members.filter(a => !group.disabled_members?.includes(a));
    if (!members.length) return;

    const profiles = getProfiles();
    const { newChars, hashMismatches } = diffProfiles(members);
    const lang = settings.lang || 'zh';
    const isZh = lang === 'zh';

    const existingList = Object.entries(profiles).map(([avatar, prof]) => {
        const char = characters.find(c => c.avatar === avatar);
        const name = char ? char.name : (prof.name || avatar);
        const isMismatch = hashMismatches.includes(avatar);
        const stateLabel = { ready: isZh ? '就绪' : 'Ready', pending: isZh ? '生成中' : 'Pending', failed: isZh ? '失败' : 'Failed' }[prof.state] || prof.state;
        const stateColor = { ready: '#4caf50', pending: '#ff9800', failed: '#f44336' }[prof.state] || '#999';
        return { avatar, name, prof, isMismatch, stateLabel, stateColor };
    });

    const newList = newChars.map(avatar => {
        const char = characters.find(c => c.avatar === avatar);
        return { avatar, name: char?.name || avatar };
    });

    if (existingList.length === 0 && newList.length === 0) return;

    let html = `<div id="gd-profile-loader" style="border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:10px;margin-bottom:10px;">`;
    html += `<strong>${isZh ? '加载存档档案' : 'Load Profiles from Save'}</strong>`;
    html += `<small style="display:block;margin:4px 0;color:var(--grey70a);">${isZh ? '选择哪些档案保留、哪些重新生成、哪些新角色加入。' : 'Choose which profiles to keep, regenerate, or add for new characters.'}</small>`;

    if (existingList.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;font-size:0.9em;">${isZh ? '存档中的档案' : 'Profiles in Save'} (${existingList.length}):</div>`;
        for (const item of existingList) {
            html += `<div class="gd-loader-row" data-avatar="${item.avatar}" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--SmartThemeBorderColor);font-size:0.85em;">
                <input type="checkbox" class="gd-loader-check" checked style="flex-shrink:0;">
                <span style="flex:1;min-width:0;"><b>${item.name}</b></span>
                <span style="color:${item.stateColor};flex-shrink:0;">${item.stateLabel}</span>
                ${item.isMismatch ? `<span style="color:#ff9800;flex-shrink:0;" title="${isZh ? '角色卡已修改' : 'Character card changed'}">&#9888;</span>` : ''}
                <select class="gd-loader-action text_pole" style="width:auto;flex-shrink:0;font-size:0.85em;">
                    <option value="keep" selected>${isZh ? '保留' : 'Keep'}</option>
                    <option value="regen">${isZh ? '重新生成' : 'Regenerate'}</option>
                </select>
            </div>`;
        }
    }

    if (newList.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;font-size:0.9em;">${isZh ? '新角色' : 'New Characters'} (${newList.length}):</div>`;
        for (const item of newList) {
            html += `<div class="gd-loader-row gd-loader-new" data-avatar="${item.avatar}" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--SmartThemeBorderColor);font-size:0.85em;">
                <input type="checkbox" class="gd-loader-check" checked style="flex-shrink:0;">
                <span style="flex:1;min-width:0;">${item.name}</span>
                <span style="color:#999;flex-shrink:0;">${isZh ? '无档案' : 'No profile'}</span>
            </div>`;
        }
    }

    html += `<div style="margin-top:8px;display:flex;gap:6px;">
        <button class="gd-loader-btn-apply" style="flex:1;">${isZh ? '应用选择（保留勾选的，重新生成标记的）' : 'Apply (keep checked, regenerate marked)'}</button>
        <button class="gd-loader-btn-all" style="flex:1;">${isZh ? '全部重新生成' : 'Regenerate All'}</button>
    </div></div>`;

    const $existing = $('#gd-profile-loader');
    if ($existing.length) $existing.replaceWith(html);
    else $('#gd-profile-management-list').before(html);

    // Bind buttons
    $('.gd-loader-btn-apply').off('click').on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true);
        const toRegen = [];
        $('.gd-loader-row').each(function () {
            const $row = $(this);
            const avatar = $row.data('avatar');
            const checked = $row.find('.gd-loader-check').prop('checked');
            if (!checked) return;
            const isNew = $row.hasClass('gd-loader-new');
            const action = $row.find('.gd-loader-action').val();
            if (isNew || action === 'regen') {
                toRegen.push(avatar);
            }
        });
        if (toRegen.length > 0) {
            toastr.info(isZh ? `正在生成 ${toRegen.length} 个档案...` : `Generating ${toRegen.length} profile(s)...`);
            await generateProfilesBatch(toRegen);
        }
        $('#gd-profile-loader').remove();
        refreshProfileManagementUI();
        toastr.success(isZh ? '档案已更新' : 'Profiles updated');
        btn.prop('disabled', false);
    });

    $('.gd-loader-btn-all').off('click').on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true);
        toastr.info(isZh ? `正在为 ${members.length} 个角色生成档案...` : `Generating profiles for ${members.length} characters...`);
        await generateProfilesBatch(members);
        $('#gd-profile-loader').remove();
        refreshProfileManagementUI();
        toastr.success(isZh ? '全部档案已更新' : 'All profiles updated');
        btn.prop('disabled', false);
    });
}

function checkProfileStartupStatus() {
    buildProfileLoaderPanel();
}

function detectCharacterChanges() {
    const group = getCurrentGroup();
    if (!group) return;
    const members = group.members.filter(a => !group.disabled_members?.includes(a));
    const profiles = getProfiles();
    const { newChars, removedChars } = diffProfiles(members);
    const lang = settings.lang || 'zh';
    const isZh = lang === 'zh';

    if (newChars.length === 0 && removedChars.length === 0) {
        toastr.info(isZh ? '未检测到角色变动' : 'No character changes detected');
        return;
    }

    let html = `<div id="gd-profile-changes" style="border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:10px;margin-bottom:10px;">`;
    html += `<strong>${isZh ? '角色变动检测' : 'Character Change Detection'}</strong>`;
    html += `<small style="display:block;margin:4px 0;color:var(--grey70a);">${isZh ? '选择如何处理以下变动。' : 'Choose how to handle the following changes.'}</small>`;

    if (newChars.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;color:#4caf50;">${isZh ? '新增角色' : 'Added'} (${newChars.length}):</div>`;
        for (const avatar of newChars) {
            const char = characters.find(c => c.avatar === avatar);
            const name = char?.name || avatar;
            html += `<div class="gd-change-row" data-avatar="${avatar}" data-action="add" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85em;">
                <input type="checkbox" class="gd-change-check" checked>
                <span style="flex:1;">${name}</span>
                <span style="color:#999;font-size:0.8em;">${isZh ? '无档案' : 'No profile'}</span>
            </div>`;
        }
    }

    if (removedChars.length > 0) {
        html += `<div style="margin-top:6px;font-weight:bold;color:#f44336;">${isZh ? '已移除角色' : 'Removed'} (${removedChars.length}):</div>`;
        for (const avatar of removedChars) {
            const prof = profiles[avatar];
            const name = prof?.name || avatar;
            html += `<div class="gd-change-row" data-avatar="${avatar}" data-action="remove" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85em;">
                <input type="checkbox" class="gd-change-check" checked>
                <span style="flex:1;">${name}</span>
                <span style="color:#999;font-size:0.8em;">${isZh ? '档案仍在' : 'Profile exists'}</span>
            </div>`;
        }
    }

    html += `<div style="margin-top:8px;display:flex;gap:6px;">
        <button class="gd-changes-btn-apply" style="flex:1;">${isZh ? '应用选择' : 'Apply Selected'}</button>
        <button class="gd-changes-btn-cancel" style="flex:1;">${isZh ? '取消' : 'Cancel'}</button>
    </div></div>`;

    const $existing = $('#gd-profile-changes');
    if ($existing.length) $existing.replaceWith(html);
    else $('#gd-profile-management-list').before(html);

    $('.gd-changes-btn-cancel').off('click').on('click', () => $('#gd-profile-changes').remove());

    $('.gd-changes-btn-apply').off('click').on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true);
        const toGenerate = [];
        const toArchive = [];

        $('.gd-change-row').each(function () {
            const $row = $(this);
            if (!$row.find('.gd-change-check').prop('checked')) return;
            const action = $row.data('action');
            const avatar = $row.data('avatar');
            if (action === 'add') toGenerate.push(avatar);
            else if (action === 'remove') toArchive.push(avatar);
        });

        // Archive removed characters
        for (const avatar of toArchive) {
            const prof = profiles[avatar];
            if (prof) {
                getArchivedProfiles()[avatar] = prof;
                delete profiles[avatar];
            }
        }
        if (toArchive.length > 0) {
            await saveChatConditional();
            toastr.info(isZh ? `已归档 ${toArchive.length} 个档案` : `Archived ${toArchive.length} profile(s)`);
        }

        // Generate new profiles
        if (toGenerate.length > 0) {
            toastr.info(isZh ? `正在生成 ${toGenerate.length} 个新角色档案...` : `Generating ${toGenerate.length} new profile(s)...`);
            await generateProfilesBatch(toGenerate);
        }

        $('#gd-profile-changes').remove();
        refreshProfileManagementUI();
        toastr.success(isZh ? '变动已处理' : 'Changes processed');
        btn.prop('disabled', false);
    });
}

function refreshProfileManagementUI() {
    const $container = $('#gd-profile-management-list');
    if (!$container.length) return;
    $container.empty();

    const profiles = getProfiles();
    const lang = settings.lang || 'zh';
    const isZh = lang === 'zh';

    if (Object.keys(profiles).length === 0) {
        $container.html(`<small><i>${isZh ? '暂无角色档案。点击上方「全部重新生成」按钮为当前群聊角色生成档案。' : 'No character profiles yet. Click "Regenerate All" above to generate profiles for current group members.'}</i></small>`);
        return;
    }

    for (const avatar of Object.keys(profiles)) {
        const prof = profiles[avatar];
        if (!prof) continue;
        const char = characters.find(c => c.avatar === avatar);
        const name = char ? char.name : (prof.name || 'Unknown');
        const hashMatch = char ? (hashChar(char.description, char.personality, char.scenario) === prof.hash) : true;
        const stateLabels = isZh ? { ready: '就绪', pending: '生成中', failed: '失败' } : { ready: 'Ready', pending: 'Generating', failed: 'Failed' };
        const stateLabel = stateLabels[prof.state] || prof.state;
        const stateClass = { ready: 'profile-state-ready', pending: 'profile-state-pending', failed: 'profile-state-failed' }[prof.state] || '';
        const safeId = String(avatar).replace(/[^a-zA-Z0-9]/g, '_');

        const card = $(`
            <div class="gd-profile-card" data-avatar="${avatar}">
                <div class="gd-profile-card-header">
                    <div class="gd-profile-card-info">
                        <strong>${name}</strong>
                        <div class="gd-profile-card-meta">
                            <span class="gd-profile-state ${stateClass}">${stateLabel}</span>
                            ${!hashMatch ? `<span class="gd-profile-hash-warn" title="${isZh ? '角色定义已变更，档案可能过时' : 'Character definition changed, profile may be outdated'}">&#9888;</span>` : ''}
                            ${prof.manualEdited ? `<span class="gd-profile-edited-tag">${isZh ? '(已编辑)' : '(Edited)'}</span>` : ''}
                        </div>
                    </div>
                    <div class="gd-profile-card-actions">
                        <button class="gd-profile-btn-edit" data-avatar="${avatar}">${isZh ? '编辑' : 'Edit'}</button>
                        <button class="gd-profile-btn-regen" data-avatar="${avatar}">${isZh ? '重生成' : 'Regen'}</button>
                        <button class="gd-profile-btn-delete" data-avatar="${avatar}">${isZh ? '删除' : 'Delete'}</button>
                    </div>
                </div>
                <div class="gd-profile-card-edit" id="gd-profile-edit-${safeId}" style="display:none;">
                    <label>Summary <textarea class="gd-profile-edit-field" data-field="summary" rows="2">${prof.profile.summary || ''}</textarea></label>
                    <label>Tags <input class="gd-profile-edit-field" data-field="tags" value="${(prof.profile.tags || []).join(', ')}"></label>
                    <label>Motivation <textarea class="gd-profile-edit-field" data-field="motivation" rows="2">${prof.profile.motivation || ''}</textarea></label>
                    <label>Relationships <textarea class="gd-profile-edit-field" data-field="relationships" rows="2">${prof.profile.relationships || ''}</textarea></label>
                    <button class="gd-profile-btn-save" data-avatar="${avatar}">${isZh ? '保存' : 'Save'}</button>
                    <button class="gd-profile-btn-cancel" data-avatar="${avatar}">${isZh ? '取消' : 'Cancel'}</button>
                </div>
            </div>
        `);
        $container.append(card);
    }

    bindProfileCardActions();
}

function bindProfileCardActions() {
    $('.gd-profile-btn-edit').off('click').on('click', function () {
        const avatar = $(this).data('avatar');
        const safeId = String(avatar).replace(/[^a-zA-Z0-9]/g, '_');
        $(`#gd-profile-edit-${safeId}`).toggle();
    });

    $('.gd-profile-btn-cancel').off('click').on('click', function () {
        const avatar = $(this).data('avatar');
        const safeId = String(avatar).replace(/[^a-zA-Z0-9]/g, '_');
        $(`#gd-profile-edit-${safeId}`).hide();
    });

    $('.gd-profile-btn-save').off('click').on('click', async function () {
        const avatar = $(this).data('avatar');
        const safeId = String(avatar).replace(/[^a-zA-Z0-9]/g, '_');
        const $edit = $(`#gd-profile-edit-${safeId}`);
        const profiles = getProfiles();
        const prof = profiles[avatar];
        if (!prof) return;

        prof.profile.summary = $edit.find('[data-field="summary"]').val();
        prof.profile.tags = ($edit.find('[data-field="tags"]').val() || '').split(',').map(s => s.trim()).filter(Boolean);
        prof.profile.motivation = $edit.find('[data-field="motivation"]').val();
        prof.profile.relationships = $edit.find('[data-field="relationships"]').val();
        prof.manualEdited = true;
        prof.updatedAt = Date.now();
        prof.state = 'ready';

        await saveProfile(avatar, prof);
        $edit.hide();
        toastr.info(settings.lang === 'zh' ? '档案已保存' : 'Profile saved');
    });

    $('.gd-profile-btn-regen').off('click').on('click', async function () {
        const avatar = $(this).data('avatar');
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            await generateProfilesBatch([avatar]);
        } finally {
            btn.prop('disabled', false);
        }
    });

    $('.gd-profile-btn-delete').off('click').on('click', async function () {
        const avatar = $(this).data('avatar');
        const profiles = getProfiles();
        const prof = profiles[avatar];
        if (prof) {
            getArchivedProfiles()[avatar] = prof;
            delete profiles[avatar];

    return {
        computeProfileSchemaHash, getProfileContainer, migrateProfileData, getProfiles, getArchivedProfiles, saveProfile, diffProfiles,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        generateSingleProfile, generateProfilesBatch,
        buildCharacterProfilesText,
        validateAndWarnProfilePlaceholders,
        syncProfiles,
        buildProfileLoaderPanel, checkProfileStartupStatus, detectCharacterChanges, refreshProfileManagementUI, bindProfileCardActions,
    };
}
