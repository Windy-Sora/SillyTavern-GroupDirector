import { eventSource, event_types } from '../../../events.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { saveSettingsDebounced, chat_metadata, saveChatConditional, characters, chat, setCharacterId, setCharacterName, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { inject_ids } from '../../../constants.js';
import { groups, selected_group } from '../../../group-chats.js';
import { checkWorldInfo, world_info_include_names } from '../../../world-info.js';
import { power_user } from '../../../power-user.js';

// ─── Settings Defaults ───────────────────────────────────────────────
const EXT_KEY = 'group-director';
const MODE_OFF = 'off';
const MODE_FORMULA = 'formula';
const MODE_LLM = 'llm';

const DEFAULT_SETTINGS = {
    mode: MODE_FORMULA,     // 'off' | 'formula' | 'llm' — 互斥单选
    topN: 1,
    scoreWeights: {
        mention: 30,
        keyword: 15,
        recency: 20,
        talkativeness: 10,
    },
    recentMessageCount: 10,
    consecutivePenalty: 15,
    triggerEnabled: true,
    triggerScore: 40,
    initiativeEnabled: true,
    initiativeBaseScore: 5,
    // LLM mode
    llmPrompt: '',
    llmMaxSpeakers: 3,
    llmRespectOrder: true,
    llmCharDescMode: 'slice',
    llmCharDescLength: 200,
    // Director script — inject stage direction into character prompts
    llmScriptEnabled: false,
    llmScriptPrompt: '',
    llmScriptWrapper: '[Director\'s stage direction for this character:\n{{script}}\n\nFollow this guidance. NEVER mention the director, the script, or that you are following stage directions. Act naturally as your character.]\n',
    llmHistoryEnabled: true,           // always record director decisions to chat_metadata (independent of continuity injection)
    llmScriptContinuity: false,
    llmScriptContinuityMode: 'last',   // 'last' = only previous round; 'history' = full recorded history
    llmScriptContinuityCount: 0,       // history mode: 0 = all rounds, N = last N rounds
    llmScriptContinuityWrapper: '[Previous round\'s director plan — reference this for continuity, but update for the current situation:\n{{previousPlan}}\n]',
    llmScriptContinuityHistoryWrapper: '[Director plans from previous rounds:\n{{previousPlans}}\n]',
    // World Info injection into Director prompt
    llmWorldInfoEnabled: false,
    llmWorldInfoWrapper: '[Current world context / lorebook entries:\n{{worldInfo}}\n]',
    debugLogging: false,
};

// Migrate legacy settings (v0.3 → v0.4)
let loaded = extension_settings[EXT_KEY] || {};
if (loaded.enabled === false) loaded.mode = MODE_OFF;
else if (loaded.directorLlmEnabled === true) loaded.mode = MODE_LLM;
else if (loaded.mode === 'top_n' || (loaded.mode === undefined && loaded.enabled !== false)) loaded.mode = MODE_FORMULA;
delete loaded.enabled;
delete loaded.directorLlmEnabled;
delete loaded.directorLlmModel;
if (loaded.directorLlmPrompt && !loaded.llmPrompt) loaded.llmPrompt = loaded.directorLlmPrompt;
delete loaded.directorLlmPrompt;

let settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
settings.scoreWeights = Object.assign({}, DEFAULT_SETTINGS.scoreWeights, loaded.scoreWeights || {});
extension_settings[EXT_KEY] = settings;

// ─── Runtime State ────────────────────────────────────────────────────
let roundScores = {};               // { avatar: score }
let roundSpeakerCount = 0;
let roundTriggeredAvatars = new Set();
let roundInitiative = {};
let llmPickedAvatars = null;        // ordered Array<avatar> from LLM, null if not used
let llmPickedSet = null;            // Set<avatar> for O(1) membership
let llmSpokenSet = new Set();
let llmCursor = 0;
let roundInitialized = false;
let isGroupChat = false;
let takeoverPending = false;
let takeoverGenCount = 0;
let directorScripts = {};           // { characterName: scriptText } from LLM
let roundWorldInfo = '';            // cached WI text for this round
let roundWorldInfoEntries = [];     // cached WI entry objects for debugging

// Custom extension prompt key for director script (not QUIET_PROMPT to avoid leakage)
const DIRECTOR_SCRIPT_KEY = 'group_director_script';

function getScriptForChar(charName) {
    const script = directorScripts[charName];
    if (!script) return '';
    return (settings.llmScriptWrapper || '{{script}}').replace('{{script}}', script);
}

// ─── Director History (persisted in chat_metadata, survives reload & export) ──
function getDirectorHistory() {
    return chat_metadata?.[EXT_KEY]?.directorHistory || [];
}

function addToDirectorHistory(entry) {
    if (!chat_metadata[EXT_KEY]) chat_metadata[EXT_KEY] = {};
    if (!chat_metadata[EXT_KEY].historyMeta) chat_metadata[EXT_KEY].historyMeta = {};
    if (!chat_metadata[EXT_KEY].directorHistory) chat_metadata[EXT_KEY].directorHistory = [];
    chat_metadata[EXT_KEY].directorHistory.push(entry);
    // Persist current script prompt once (only if changed), so exported chats carry the directing style
    if (chat_metadata[EXT_KEY].historyMeta.scriptPrompt !== settings.llmScriptPrompt) {
        chat_metadata[EXT_KEY].historyMeta.scriptPrompt = settings.llmScriptPrompt;
    }
    saveChatConditional();
}

function saveSettings() {
    extension_settings[EXT_KEY] = settings;
    saveSettingsDebounced();
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
        // Manual ordered generation in progress — let through without filtering
        if (takeoverGenCount > 0) {
            takeoverGenCount--;
            roundSpeakerCount++;
            console.warn(`[GroupDirector] MANUAL-GEN ALLOWED ${char.name} (takeoverGenCount→${takeoverGenCount}, speaker #${roundSpeakerCount})`);
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
    // If manual ordered generation is in progress (force_chid sub-calls),
    // don't reset state — the sub-wrapper is just a vehicle for single-char gen.
    if (takeoverGenCount > 0) {
        console.warn('[GroupDirector] Nested GROUP_WRAPPER_STARTED during manual gen — preserving state');
        return;
    }

    roundGenerateType = data?.type || 'normal';
    isGroupChat = true;

    // Regenerate / swipe: reuse the existing director decision, only reset
    // per-speaker tracking so the same characters can be generated again.
    // No new LLM call, no new history entry, no pollution.
    if (roundGenerateType === 'regenerate' || roundGenerateType === 'swipe') {
        llmSpokenSet = new Set();
        llmCursor = 0;
        roundSpeakerCount = 0;
        // Re-trigger takeover so strict order is enforced again
        takeoverPending = settings.mode === MODE_LLM && settings.llmRespectOrder;
        takeoverGenCount = 0;
        log(`Regenerate/swipe — reusing existing director plan (keep llmPickedAvatars, directorScripts, roundWorldInfo)`);
        return;
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
    directorScripts = {};
    roundWorldInfo = '';
    roundWorldInfoEntries = [];
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

// ─── Manual Ordered Generation (takeover) ─────────────────────────────
async function runManualOrderedGeneration() {
    takeoverPending = false;
    const orderedList = [...llmPickedAvatars];
    takeoverGenCount = orderedList.length;
    const ctx = getContext();

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
            console.warn(`[GroupDirector] GEN #${i + 1}: ${characters[chId].name} (chId=${chId}, takeoverGenCount=${takeoverGenCount})`);

            // Inject per-character director script
            const charScript = getScriptForChar(characters[chId].name);
            if (charScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
            }
            try {
                await ctx.generate('normal', { force_chid: chId });
                console.warn(`[GroupDirector] GEN #${i + 1} DONE: ${characters[chId].name}`);
            } catch (e) {
                console.error('[GroupDirector] GEN FAILED:', e.message, e.stack);
                takeoverGenCount = 0;
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
        const recentMessages = getRecentMessages();
        const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
        const memberList = enabledMembers
            .map(a => {
                const c = characters.find(c => c.avatar === a);
                if (!c) return null;
                const desc = c.description || '';
                const showDesc = settings.llmCharDescMode === 'full'
                    ? desc
                    : desc.slice(0, settings.llmCharDescLength);
                const truncated = showDesc.length < desc.length ? `${showDesc}…` : showDesc;
                return `- ${c.name}: ${truncated}`;
            })
            .filter(Boolean)
            .join('\n');

        const recentText = recentMessages
            .map(m => `${m.name || (m.is_user ? 'User' : 'Char')}: ${m.mes || ''}`)
            .join('\n');

        // One-shot WI scan per round, cached for the director stage
        let contextPrefix = '';
        if (!roundWorldInfo && settings.llmWorldInfoEnabled) {
            const wi = await buildDirectorWorldInfo(enabledMembers);
            roundWorldInfo = wi.text;
            roundWorldInfoEntries = wi.entries;
        }
        if (roundWorldInfo) {
            const wiWrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
            contextPrefix += wiWrapper.replace('{{worldInfo}}', roundWorldInfo) + '\n\n';
        }

        // Inject previous director plans for script continuity
        const history = getDirectorHistory();
        if (settings.llmHistoryEnabled && settings.llmScriptContinuity && history.length > 0) {
            if (settings.llmScriptContinuityMode === 'history') {
                // Full history mode: provide N recent rounds as JSON array
                const count = settings.llmScriptContinuityCount > 0
                    ? Math.min(settings.llmScriptContinuityCount, history.length)
                    : history.length;
                const recentPlans = history.slice(-count);
                const plansJson = JSON.stringify(recentPlans, null, 2);
                const wrapper = settings.llmScriptContinuityHistoryWrapper || '{{previousPlans}}';
                contextPrefix += wrapper.replace('{{previousPlans}}', plansJson) + '\n\n';
            } else {
                // Last-round mode (default): provide only the most recent plan
                const lastPlan = history[history.length - 1];
                const lastJson = JSON.stringify(lastPlan, null, 2);
                const wrapper = settings.llmScriptContinuityWrapper || '{{previousPlan}}';
                contextPrefix += wrapper.replace('{{previousPlan}}', lastJson) + '\n\n';
            }
        }

        const promptTemplate = settings.llmPrompt || getDefaultLlmPrompt();
        let filled = promptTemplate
            .replace('{{recentMessages}}', recentText)
            .replace('{{characters}}', memberList)
            .replace('{{maxSpeakers}}', String(settings.llmMaxSpeakers));

        // Prepend context (WI, continuity) so instruction/format stays at bottom
        if (contextPrefix) {
            filled = contextPrefix + filled;
        }

        const ctx = getContext();
        const response = await ctx.generateRaw({
            prompt: filled,
        });

        // Clear quiet prompt extension to prevent Director text leaking
        // into subsequent character generation prompts.
        setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

        log('LLM raw response:', response);

        const parsed = parseLlmResponse(response);
        if (!parsed || !Array.isArray(parsed.speakers) || parsed.speakers.length === 0) {
            log('LLM returned no valid speakers');
            return;
        }

        // Save full parsed JSON to history (independent of continuity injection)
        if (settings.llmHistoryEnabled) {
            addToDirectorHistory(parsed);
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

function parseLlmResponse(text) {
    if (!text) return null;

    // Strategy 1: extract the outermost JSON object with balanced braces
    const extracted = extractJsonObject(text);
    if (!extracted) {
        log('parseLlmResponse: no JSON object found in response');
        return null;
    }

    // Normalize: trailing commas, single→double quotes, unquoted keys
    const sanitized = sanitizeJson(extracted);

    try {
        return JSON.parse(sanitized);
    } catch (e1) {
        log('parseLlmResponse: JSON.parse failed after sanitize:', e1.message);

        // Strategy 2: try extracting the speakers array directly
        const arrMatch = sanitized.match(/\[([\s\S]*?)\]/);
        if (arrMatch) {
            const items = arrMatch[1]
                .split(/["'],\s*["']/)
                .map(s => s.replace(/^["'\s]+|["'\s]+$/g, '').trim())
                .filter(Boolean);
            if (items.length > 0) {
                log('parseLlmResponse: extracted speakers array directly:', items);
                return { speakers: items, reason: '' };
            }
        }

        return null;
    }
}

/**
 * Extract a balanced JSON object from text that may contain code fences, markdown, or extra prose.
 */
function extractJsonObject(text) {
    // Remove code fences (non-globally, fence by fence)
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < cleaned.length; i++) {
        const ch = cleaned[i];

        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return cleaned.slice(firstBrace, i + 1);
            }
        }
    }
    return null;
}

/**
 * Fix common JSON formatting errors from LLM output.
 */
function sanitizeJson(raw) {
    let s = raw;

    // Remove trailing commas before closing brackets/braces
    s = s.replace(/,(\s*[}\]])/g, '$1');

    // Convert single-quoted keys/values to double-quoted (carefully)
    // Match single-quoted strings that are keys or values
    // First, replace single-quoted keys: 'key':
    s = s.replace(/'([^']+)'(\s*:)/g, '"$1"$2');
    // Then, replace single-quoted values: : 'value'
    s = s.replace(/(:\s*)'([^']+)'/g, '$1"$2"');

    // Remove BOM / zero-width characters
    s = s.replace(/[​-‍﻿]/g, '');

    // Remove control characters (except \n, \r, \t) that break JSON
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');

    return s.trim();
}

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
    let base = `Recent messages:
{{recentMessages}}

Available characters:
{{characters}}

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

// ─── Slash Commands ───────────────────────────────────────────────────
// TODO: Register slash commands for manual director control

// ─── Init ─────────────────────────────────────────────────────────────
jQuery(async () => {
    await loadSettingsUI();
    console.log(`Group Director extension loaded (mode=${settings.mode})`);
});
