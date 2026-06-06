import { eventSource, event_types } from '../../../events.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { saveSettingsDebounced, chat_metadata, saveChatConditional, characters, chat, setCharacterId, setCharacterName, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { inject_ids } from '../../../constants.js';
import { groups, selected_group } from '../../../group-chats.js';
import { checkWorldInfo, world_info_include_names } from '../../../world-info.js';
import { power_user } from '../../../power-user.js';
import { EXT_KEY, MODE_OFF, MODE_FORMULA, MODE_LLM, DEFAULT_SETTINGS } from './settings.js';
import { registerProvider, getProviders, getAvailablePlaceholders } from './provider-registry.js';
import { renderPrompt } from './prompt-renderer.js';
import { parseLlmResponse, extractJsonObject, sanitizeJson } from './utils/json-utils.js';
import { djb2Hash, hashChar } from './utils/string-utils.js';
import { register as registerRecentMessages } from './providers/recent-messages.js';
import { register as registerCharacters } from './providers/characters.js';
import { register as registerCharacterProfiles } from './providers/character-profiles.js';
import { register as registerWorldInfoProvider } from './providers/world-info.js';
import { register as registerHistoryProviders } from './providers/history.js';
import { register as registerDirectorLedger } from './providers/director-ledger.js';
import { register as registerTestProvider } from './providers/test-provider.js';
import { createHistorySystem } from './systems/history-system.js';
import { createWorldInfoSystem } from './systems/world-info-system.js';
import { createProfileSystem } from './systems/profile-system.js';

// ─── I18n ─────────────────────────────────────────────────────────────
const I18N = {
    zh: {
        langLabel: '语言 / Language',
        intro: '解决群聊中所有角色抢话的问题。两种判断模式互斥，一次只能启用一种。',
        modeTitle: '判断模式（单选）',
        modeOff: '<b>关闭</b> — 不干预 SillyTavern 默认行为',
        modeFormula: '<b>公式判断</b> — 使用关键词、提名、近期发言、主动性等本地评分（无 API 调用）',
        modeLlm: '<b>大模型判断</b> — 调用当前主模型，结合上下文决定谁发言、按什么顺序（消耗 token）',
        debug: '调试日志（浏览器控制台）',
        offHint: '当前模式：关闭。所有角色将按 SillyTavern 默认逻辑发言（即抢话行为不被抑制）。',

        topnTitle: 'Top-N 设置',
        topn: '每轮允许发言人数 (Top-N)',
        recentCount: '分析最近消息条数',
        consecutivePenalty: '连续发言惩罚分（每条）',

        weightsTitle: '评分权重',
        mentionWeight: '名字被提及权重',
        keywordWeight: '关键词匹配权重',
        recencyWeight: '近期未发言加权',
        talkativenessWeight: 'Talkativeness 权重',

        triggerTitle: '触发器引擎',
        triggerEnabled: '启用关键词触发器（基于角色描述切词）',
        triggerScore: '触发器命中加分',

        initiativeTitle: '主动性 (Initiative)',
        initiativeEnabled: '启用主动性系统（每轮随机扰动）',
        initiativeBase: '主动性基础值（每轮随机 0~该值）',

        llmParamsTitle: 'Director LLM 参数',
        llmMaxSpeakers: '每轮最多发言人数',
        llmContextDepth: '传入上下文层数（最近 N 条消息）',
        llmContextDepthHint: '控制发送给 Director 的最近消息数量。减少可节省 token，但可能影响判断准确性。',
        llmRespectOrder: '严格按 LLM 顺序发言（接管 ST 激活循环，手动按导演决定的顺序逐人生成）',

        charDescTitle: '角色描述控制',
        charDescHint: '控制传入 Director LLM 的角色描述长度（<code>{{characters}}</code> 占位符）。过长可能超出上下文，过短可能不够判断。',
        charDescFull: '全量传入（角色简介不作截断）',
        charDescSlice: '切片截断（保留前 N 个字符）',
        charDescLength: '切片长度（字符数）',

        scriptTitle: '导演剧本 (Director Script)',
        scriptHint: '让导演不仅决定谁发言，还生成一段场景剧本，注入到角色生成 prompt 中指导内容创作。',
        scriptEnabled: '启用导演剧本（Director 为每个发言角色输出独立剧本，注入角色 prompt 指导表演，角色不会暴露剧本存在）',
        scriptPrompt: '剧本要求提示（Script Prompt）',
        scriptPromptHint: '告诉导演你希望什么样的剧本风格。例如："剧情要温馨治愈，突出姐妹情深"、"保持紧张悬疑的氛围"、"加入搞笑吐槽元素"等。留空则只要求基本场景描述。',

        historyEnabled: '<b>记录导演账本</b> — 每次 LLM 决策后将完整 JSON 保存到聊天元数据，跟随对话导出/导入/分支',
        historyClear: '清空当前导演账本',
        historyMeta: '当前账本风格：',

        continuity: '<b>使用导演历史</b> — 将记录的导演账本注入当前 prompt，保持剧情连续性',

        continuityTitle: '连贯剧本模式',
        continuityHint: '选择只注入上一轮计划，还是注入完整历史记录。',
        continuityLast: '<b>仅上一轮</b> — 只注入最近一次的导演 JSON（当前默认行为）',
        continuityHistory: '<b>完整历史</b> — 永久记录每轮导演输出，注入指定数量的 JSON 数组（保留所有自定义字段）',
        continuityCount: '历史轮数（0 = 全部）',
        continuityCountHint: '指定注入最近 N 轮导演计划的 JSON 数量。设为 0 则注入全部记录。',
        continuityWrapper: '连贯剧本包装模板（仅上一轮模式）',
        continuityWrapperHint: '<code>{{previousPlan}}</code> 占位符会被替换为上一轮导演的完整 JSON 回复。',
        continuityHistoryWrapper: '连贯剧本包装模板（完整历史模式）',
        continuityHistoryWrapperHint: '<code>{{previousPlans}}</code> 占位符会被替换为过往导演计划的 JSON 数组。',

        worldInfoTitle: '世界书注入 (World Info)',
        worldInfoHint: '将当前激活的世界书/ lorebook 条目注入 Director prompt，让导演了解世界背景设定。',
        worldInfoEnabled: '启用世界书注入（将激活的 lorebook 内容传递给 Director）',
        worldInfoWrapper: '世界书包装模板',
        worldInfoWrapperHint: '<code>{{worldInfo}}</code> 占位符会被替换为当前激活的世界书条目文本。',

        scriptWrapper: '剧本注入包装模板（Script Wrapper）',
        scriptWrapperHint: '控制剧本如何包裹后注入角色 prompt。<code>{{script}}</code> 占位符会被替换为实际剧本内容。',

        promptTitle: 'Director Prompt 模板',
        promptHint: '可用占位符：<code>{{recentMessages}}</code>、<code>{{characters}}</code>、<code>{{maxSpeakers}}</code><br>模型必须返回 JSON：<code>{"speakers": ["Name1", "Name2"], "reason": "..."}</code>。启用剧本后还需包含 <code>"script": "..."</code>。<code>speakers</code> 数组<b>顺序就是发言顺序</b>。',
        promptReset: '恢复默认 Prompt',
        promptNote: '注意：每轮群聊生成会额外调用一次主模型来做导演决策。LLM 调用失败时插件会透明放行（不影响聊天）。',

        profileTitle: '角色档案系统 (Character Profile System)',
        profileHint: '提前分析每个角色的特质、动机、关系，作为结构化数据注入 Director Prompt。独立于导演判断逻辑。',
        profileEnabled: '启用角色档案（让 Director 了解每个角色的深层信息）',
        profileTokenBudget: '档案 Token 预算（超过时压缩非活跃角色）',
        profileConcurrency: '并发数（0=全部同时, 1=逐个, N=每批N个）',
        profileGeneratorPromptTitle: '生成器 Prompt 模板',
        profileGeneratorPromptHint: '告诉 LLM 如何分析角色。占位符：<code>{{charName}}</code> <code>{{charDescription}}</code> <code>{{charPersonality}}</code> <code>{{charScenario}}</code>',
        profileGeneratorReset: '恢复默认生成器 Prompt',
        profileJsonSchemaTitle: 'JSON Schema（可选，用于结构化生成）',
        profileJsonSchemaHint: '定义 AI 返回的 JSON 格式。留空使用内置默认 Schema。',
        profileSchemaReset: '恢复默认 Schema',
        profileRenderTemplateTitle: '渲染模板（Render Template）',
        profileRenderTemplateHint: '控制 <code>{{character_profiles}}</code> 占位符的输出格式。每角色占位符：<code>{{name}}</code> <code>{{summary}}</code> <code>{{tags}}</code> <code>{{motivation}}</code> <code>{{relationships}}</code>',
        profileRenderReset: '恢复默认渲染模板',
        profileManagementTitle: '档案管理',
        profileScanSave: '扫描当前存档中的角色档案',
        profileDetectChanges: '检测角色变动（加入/删除）',
        profileRegenerateAll: '全部重新生成',
    },
    en: {
        langLabel: '语言 / Language',
        intro: 'Prevents all characters from rushing to speak in group chats. The two modes are mutually exclusive.',
        modeTitle: 'Mode (single choice)',
        modeOff: '<b>Off</b> — Do not intervene; SillyTavern default behavior',
        modeFormula: '<b>Formula</b> — Local scoring via keywords, mentions, recency, talkativeness (no API call)',
        modeLlm: '<b>LLM Director</b> — Ask the main model to decide who speaks and in what order (consumes tokens)',
        debug: 'Debug logging (browser console)',
        offHint: 'Current mode: Off. All characters follow SillyTavern default logic (rushing behavior is not suppressed).',

        topnTitle: 'Top-N Settings',
        topn: 'Speakers per round (Top-N)',
        recentCount: 'Recent messages to analyze',
        consecutivePenalty: 'Consecutive speech penalty (per message)',

        weightsTitle: 'Scoring Weights',
        mentionWeight: 'Name mention weight',
        keywordWeight: 'Keyword match weight',
        recencyWeight: 'Not-spoken-recently bonus',
        talkativenessWeight: 'Talkativeness weight',

        triggerTitle: 'Trigger Engine',
        triggerEnabled: 'Enable keyword triggers (tokenized from character description)',
        triggerScore: 'Trigger hit bonus',

        initiativeTitle: 'Initiative',
        initiativeEnabled: 'Enable initiative system (random perturbation per round)',
        initiativeBase: 'Initiative base value (random 0~base per round)',

        llmParamsTitle: 'Director LLM Parameters',
        llmMaxSpeakers: 'Max speakers per round',
        llmContextDepth: 'Context depth (recent N messages)',
        llmContextDepthHint: 'Number of recent messages sent to the Director. Reduce to save tokens; may affect decision quality.',
        llmRespectOrder: 'Strict LLM order (take over ST activation loop, generate in director-determined order)',

        charDescTitle: 'Character Description Control',
        charDescHint: 'Controls how much character description is sent to the Director LLM (<code>{{characters}}</code> placeholder). Too long may exceed context; too short may be insufficient.',
        charDescFull: 'Full (no truncation)',
        charDescSlice: 'Slice (keep first N characters)',
        charDescLength: 'Slice length (characters)',

        scriptTitle: 'Director Script',
        scriptHint: 'Let the director generate per-character stage directions injected into character prompts.',

        scriptEnabled: 'Enable Director Script (Director outputs per-character stage directions, injected into character prompts; characters do not reveal script existence)',
        scriptPrompt: 'Script Prompt',
        scriptPromptHint: 'Tell the director what kind of script style you want. For example: "Keep a warm and healing tone", "Maintain a suspenseful atmosphere", "Add comedic elements". Leave empty for basic scene descriptions only.',

        historyEnabled: '<b>Record Director Ledger</b> — Save full JSON to chat metadata after each LLM decision (follows chat export/import/branch)',
        historyClear: 'Clear Current Ledger',
        historyMeta: 'Current ledger style: ',

        continuity: '<b>Use Director History</b> — Inject recorded ledger into current prompt for continuity',

        continuityTitle: 'Continuity Mode',
        continuityHint: 'Choose whether to inject only the last round or full recorded history.',
        continuityLast: '<b>Last Round Only</b> — Inject only the most recent director JSON (default)',
        continuityHistory: '<b>Full History</b> — Persist every round, inject N rounds as a JSON array (custom fields preserved)',
        continuityCount: 'History rounds (0 = all)',
        continuityCountHint: 'Number of recent director plans to inject as JSON. Set to 0 to include all records.',
        continuityWrapper: 'Continuity Wrapper (last-round mode)',
        continuityWrapperHint: '<code>{{previousPlan}}</code> is replaced with the previous round\'s full JSON response.',
        continuityHistoryWrapper: 'Continuity Wrapper (history mode)',
        continuityHistoryWrapperHint: '<code>{{previousPlans}}</code> is replaced with a JSON array of past director plans.',

        worldInfoTitle: 'World Info Injection',
        worldInfoHint: 'Inject currently activated lorebook entries into the Director prompt so the director understands world context.',
        worldInfoEnabled: 'Enable World Info injection (pass activated lorebook content to Director)',
        worldInfoWrapper: 'World Info Wrapper',
        worldInfoWrapperHint: '<code>{{worldInfo}}</code> is replaced with the currently activated lorebook entry text.',

        scriptWrapper: 'Script Injection Wrapper',
        scriptWrapperHint: 'Controls how the script is wrapped before injection into character prompt. <code>{{script}}</code> is replaced with the actual script content.',

        promptTitle: 'Director Prompt Template',
        promptHint: 'Placeholders: <code>{{recentMessages}}</code>, <code>{{characters}}</code>, <code>{{maxSpeakers}}</code><br>Model must return JSON: <code>{"speakers": ["Name1", "Name2"], "reason": "..."}</code>. With script enabled, also include <code>"script": "..."</code>. <code>speakers</code> array <b>order is speaking order</b>.',
        promptReset: 'Restore Default Prompt',
        promptNote: 'Note: Each round of group chat generation makes one extra main-model call for the director decision. LLM call failures are transparent (chat continues unaffected).',

        profileTitle: 'Character Profile System',
        profileHint: 'Pre-analyze each character\'s traits, motivations, and relationships as structured data for the Director Prompt. Independent of director decision logic.',
        profileEnabled: 'Enable Character Profiles (let Director understand each character\'s deep traits)',
        profileTokenBudget: 'Profile Token Budget (compress inactive characters when exceeded)',
        profileConcurrency: 'Concurrency (0=all, 1=sequential, N=batch of N)',
        profileGeneratorPromptTitle: 'Generator Prompt Template',
        profileGeneratorPromptHint: 'Tell the LLM how to analyze characters. Placeholders: <code>{{charName}}</code> <code>{{charDescription}}</code> <code>{{charPersonality}}</code> <code>{{charScenario}}</code>',
        profileGeneratorReset: 'Restore Default Generator Prompt',
        profileJsonSchemaTitle: 'JSON Schema (optional, for structured generation)',
        profileJsonSchemaHint: 'Define the JSON format for AI responses. Leave empty to use the built-in default schema.',
        profileSchemaReset: 'Restore Default Schema',
        profileRenderTemplateTitle: 'Render Template',
        profileRenderTemplateHint: 'Controls the output format of <code>{{character_profiles}}</code>. Per-character placeholders: <code>{{name}}</code> <code>{{summary}}</code> <code>{{tags}}</code> <code>{{motivation}}</code> <code>{{relationships}}</code>',
        profileRenderReset: 'Restore Default Render Template',
        profileManagementTitle: 'Profile Management',
        profileScanSave: 'Scan current save for character profiles',
        profileDetectChanges: 'Detect character changes (added/removed)',
        profileRegenerateAll: 'Regenerate All',
    },
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
let takeoverFailed = false;          // set when manual generation fails mid-round
let takeoverCompleted = new Set();    // avatars already generated (for resume after failure)
let takeoverSwipeCount = 0;          // auto-swipe counter per character (cap at 5)
let directorScripts = {};           // { characterName: scriptText } from LLM
const wiState = { text: '', entries: [] };  // WI cache for WorldInfoProvider

// Custom extension prompt key for director script (not QUIET_PROMPT to avoid leakage)
const DIRECTOR_SCRIPT_KEY = 'group_director_script';

async function getScriptForChar(charName, extraContext) {
    const script = directorScripts[charName];
    if (!script) return '';
    const wrapper = settings.llmScriptWrapper || '{{script}}';
    const placeholder = '\x00SCRIPT\x00';
    const guarded = wrapper.replace('{{script}}', placeholder);
    const ctx = { character: charName, ...extraContext };
    const rendered = await renderPrompt(guarded, ctx);
    return rendered.replace(placeholder, script);
}

function saveSettings() {
    extension_settings[EXT_KEY] = settings;
    saveSettingsDebounced();
}

// ─── Systems ──────────────────────────────────────────────────────────
// chat_metadata, chat, and characters are export let in ST — they get
// replaced on chat load. Pass as getters so modules always read current values.
const getChatMetadata = () => chat_metadata;
const getChat = () => chat;
const getCharacters = () => characters;

const { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory } =
    createHistorySystem({ getChatMetadata, getChat, EXT_KEY, saveChatConditional, settings, log });

const { buildDirectorWorldInfo } =
    createWorldInfoSystem({ settings, getChat, getCharacters, checkWorldInfo, world_info_include_names, getContext, power_user, log });

const profileSystem = createProfileSystem({
    settings, EXT_KEY, getChatMetadata, getChat, getCharacters, saveChatConditional,
    getContext, djb2Hash, hashChar, extractJsonObject, sanitizeJson,
    matchCharacterByName, getCurrentGroup, log,
    getLlmPickedSet: () => llmPickedSet,
    getLlmPickedAvatars: () => llmPickedAvatars,
    getRoundSpeakerCount: () => roundSpeakerCount,
    saveSettings,
});
const { buildCharacterProfilesText, generateProfilesBatch, validateAndWarnProfilePlaceholders,
    buildProfileLoaderPanel, checkProfileStartupStatus, detectCharacterChanges,
    refreshProfileManagementUI, bindProfileCardActions,
    getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
    computeProfileSchemaHash, getProfileContainer, getProfiles, getArchivedProfiles,
    saveProfile, diffProfiles, normalizeProfileFields,
    generateSingleProfile, syncProfiles, migrateProfileData } = profileSystem;

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
            if (isReroll) {
                takeoverSwipeCount++;
                if (takeoverSwipeCount > 5) {
                    console.warn(`[GroupDirector] takeoverSwipeCount exceeded (${takeoverSwipeCount}) — aborting ${char.name} to prevent swipe loop`);
                    abort(false);
                    return;
                }
            } else {
                takeoverGenCount--;
                roundSpeakerCount++;
                takeoverSwipeCount = 0; // new character, reset swipe counter
            }
            // Verify this character is actually in the director's plan
            if (llmPickedAvatars && !llmPickedAvatars.includes(avatar)) {
                console.error(`[GroupDirector] TAKEOVER MISMATCH: ${char.name} (${avatar}) not in director plan — aborting!`);
                abort(false);
                return;
            }
            // Safety-net script injection: ensure the correct per-character script is set
            const takeoverScript = await getScriptForChar(char.name, {
                speakerIndex: roundSpeakerCount,
                speakerIndex0: roundSpeakerCount - 1,
                speakerCount: llmPickedAvatars?.length || 0,
            });
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
        // Swipe/regenerate: ST controls which message is re-rolled. Don't
        // filter by director picks — the swiped character may differ from
        // the original plan (e.g., user swipes a message from a prior round).
        const isSwipeOrRegen = roundGenerateType === 'swipe' || roundGenerateType === 'regenerate';
        if (!isSwipeOrRegen && !llmPickedSet.has(avatar)) {
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
        const charScript = await getScriptForChar(char.name, {
            speakerIndex: roundSpeakerCount,
            speakerIndex0: roundSpeakerCount - 1,
            speakerCount: llmPickedAvatars?.length || 0,
        });
        if (charScript) {
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
        } else {
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', extension_prompt_types.IN_PROMPT, 0, true);
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
            // No history to reconstruct — transparent pass-through: let ST handle
            // the regenerate/swipe without director filtering. Must NOT fall through
            // to normal init, which would trigger a new LLM call.
            roundInitialized = true;
            log('Regenerate/swipe — no persisted plan, transparent pass-through');
            return;
        }
        // Reuse existing plan (reconstructed or in-memory)
        {
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
    takeoverCompleted = new Set();
    takeoverSwipeCount = 0;
    directorScripts = {};
    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', extension_prompt_types.IN_PROMPT, 0, true);
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
    takeoverCompleted = new Set();
    takeoverSwipeCount = 0;
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
            // Resume after failure: skip characters already generated
            if (takeoverCompleted.has(avatar)) {
                takeoverGenCount--;
                console.warn(`[GroupDirector] SKIP already completed: ${characters.find(c => c.avatar === avatar)?.name}, takeoverGenCount→${takeoverGenCount}`);
                continue;
            }
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

            // Inject per-character director script with order context
            const charScript = await getScriptForChar(characters[chId].name, {
                speakerIndex: i + 1,
                speakerIndex0: i,
                speakerCount: orderedList.length,
            });
            if (charScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
            }
            try {
                // Re-set character identity right before generation, in case
                // something between setCharacterId and here mutated this_chid
                setCharacterId(chId);
                setCharacterName(characters[chId].name);
                await ctx.generate('normal', { force_chid: chId });
                // Post-generation: log full message snapshot for identity diagnostics
                if (chat.length > 0) {
                    const lastMsg = chat[chat.length - 1];
                    const expectedName = characters[chId]?.name || '?';
                    if (lastMsg && !lastMsg.is_user && !lastMsg.is_system) {
                        console.log(`[GroupDirector] POST-GEN #${i + 1}: expected="${expectedName}" actual="${lastMsg.name}" mes=${(lastMsg.mes || '').substring(0, 80)} reasoning=${lastMsg.extra?.reasoning ? (lastMsg.extra.reasoning.substring(0, 80) + '...') : 'none'} swipes=${lastMsg.swipes?.length || 0}`);
                        if (lastMsg.name !== expectedName) {
                            console.error(`[GroupDirector] POST-GEN MISMATCH: expected "${expectedName}" but got "${lastMsg.name}" — identity swapped!`);
                        }
                    }
                }
                console.warn(`[GroupDirector] GEN #${i + 1} DONE: ${characters[chId].name}`);
                takeoverCompleted.add(avatar);
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
        let filled = await renderPrompt(promptTemplate, runtimeContext);

        // Auto-inject WI if the template lacks the placeholder (custom prompts)
        if (settings.llmWorldInfoEnabled && !promptTemplate.includes('{{worldInfo}}') && wiState.text) {
            const wiWrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
            filled = wiWrapper.replace('{{worldInfo}}', wiState.text) + '\n\n' + filled;
        }

        // Auto-inject director history continuity if the template lacks the placeholder
        if (settings.llmHistoryEnabled && settings.llmScriptContinuity) {
            const hasPrevPlan = promptTemplate.includes('{{previousPlan}}');
            const hasPrevPlans = promptTemplate.includes('{{previousPlans}}');
            if (!hasPrevPlan && !hasPrevPlans) {
                const history = getDirectorHistory();
                if (history.length > 0) {
                    if (settings.llmScriptContinuityMode === 'history') {
                        const count = settings.llmScriptContinuityCount > 0
                            ? Math.min(settings.llmScriptContinuityCount, history.length)
                            : history.length;
                        const plansJson = JSON.stringify(history.slice(-count), null, 2);
                        const wrapper = settings.llmScriptContinuityHistoryWrapper || '{{previousPlans}}';
                        filled = wrapper.replace('{{previousPlans}}', plansJson) + '\n\n' + filled;
                    } else {
                        const lastJson = JSON.stringify(history[history.length - 1], null, 2);
                        const wrapper = settings.llmScriptContinuityWrapper || '{{previousPlan}}';
                        filled = wrapper.replace('{{previousPlan}}', lastJson) + '\n\n' + filled;
                    }
                }
            }
        }

        // Auto-inject character profiles if the template lacks the placeholder
        if (settings.profileEnabled && !promptTemplate.includes('{{character_profiles}}')) {
            const profilesText = buildCharacterProfilesText();
            if (profilesText) {
                filled = profilesText + '\n\n' + filled;
            }
        }

        const ctx = getContext();
        let response;
        let attempts = 0;
        const maxRetries = 3;
        while (attempts < maxRetries) {
            attempts++;
            try {
                response = await ctx.generateRaw({ prompt: filled });
                break; // success
            } catch (err) {
                const isAbort = err?.name === 'AbortError' || String(err?.message || '').includes('abort');
                if (isAbort) throw err; // user abort — don't retry, fall through to history reuse
                console.warn(`[GroupDirector] Director LLM attempt ${attempts}/${maxRetries} failed:`, err.message);
                if (attempts < maxRetries) {
                    toastr.warning(`Director 决策失败 (${attempts}/${maxRetries})，正在重试...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
        if (!response) {
            throw new Error('Director LLM failed after ' + maxRetries + ' attempts');
        }

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
        const isAbort = e?.name === 'AbortError' || String(e?.message || '').includes('abort');
        console.error(`[GroupDirector] Director LLM ${isAbort ? 'aborted' : 'failed'} after retries:`, e.message || e);
        // Fallback: reuse the last known director plan from history
        const history = getDirectorHistory();
        const lastPlan = history[history.length - 1];
        if (lastPlan && Array.isArray(lastPlan.speakers) && lastPlan.speakers.length > 0) {
            toastr.warning(isAbort
                ? '导演决策中断，正在复用上一轮决策...'
                : `导演决策失败（已重试${maxRetries}次），正在复用上一轮决策...`);
            console.warn(`[GroupDirector] Director ${isAbort ? 'aborted' : 'failed'} — reusing last plan from history`);
            const avatars = [];
            for (const name of lastPlan.speakers) {
                const c = matchCharacterByName(name, enabledMembers);
                if (c) avatars.push(c.avatar);
            }
            if (avatars.length > 0) {
                llmPickedAvatars = avatars.slice(0, settings.llmMaxSpeakers);
                llmPickedSet = new Set(llmPickedAvatars);
                if (lastPlan.scripts && typeof lastPlan.scripts === 'object') {
                    directorScripts = {};
                    for (const [name, script] of Object.entries(lastPlan.scripts)) {
                        const c = matchCharacterByName(name, enabledMembers);
                        if (c) directorScripts[c.name] = script;
                    }
                }
                if (settings.llmRespectOrder) {
                    takeoverPending = true;
                }
                return;
            }
        }
        // No history — block the round instead of transparent pass-through
        toastr.error(isAbort
            ? '导演决策中断，且无历史记录可复用。请重新发送消息。'
            : `导演决策失败（已重试${maxRetries}次），且无历史记录。请检查网络后重试。`);
        console.warn(`[GroupDirector] Director ${isAbort ? 'aborted' : 'failed'} and no history — round blocked`);
        // llmPickedSet stays null → interceptor passes through → but we want to block?
        // Actually, null = transparent pass-through in the interceptor.
        // Set to empty to block all characters (safer than letting chaos through).
        llmPickedSet = new Set();
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
        toastr.info(lang === 'zh' ? `正在后台为 ${members.length} 个角色生成档案...` : `Generating profiles for ${members.length} characters in background...`);
        // Fire-and-forget: don't block the UI thread
        generateProfilesBatch(members).then(() => {
            const profiles = getProfiles();
            const ready = Object.values(profiles).filter(p => p.state === 'ready').length;
            const failed = Object.values(profiles).filter(p => p.state === 'failed').length;
            btn.prop('disabled', false);
            refreshProfileManagementUI();
            if (failed > 0) {
                toastr.warning(lang === 'zh'
                    ? `${ready} 个就绪, ${failed} 个失败 — 查看控制台了解详情`
                    : `${ready} ready, ${failed} failed — check console for details`);
            } else {
                toastr.success(lang === 'zh'
                    ? `${ready} 个角色档案已更新`
                    : `${ready} character profiles updated`);
            }
        }).catch(e => {
            btn.prop('disabled', false);
            toastr.error(lang === 'zh' ? '生成失败，请查看控制台' : 'Generation failed, check console');
            console.error('[GroupDirector] Batch profile generation failed:', e);
        });
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

// ─── I18n ─────────────────────────────────────────────────────────────
function applyI18n(lang) {
    const t = I18N[lang] || I18N['zh'];
    $('[data-i18n]').each(function () {
        const key = $(this).attr('data-i18n');
        if (t[key] !== undefined) {
            $(this).html(t[key]);
        }
    });
    $('[data-i18n-placeholder]').each(function () {
        const key = $(this).attr('data-i18n-placeholder');
        if (t[key] !== undefined) {
            $(this).attr('placeholder', t[key]);
        }
    });
    // Update the persisted script display
    const persistedScript = chat_metadata?.[EXT_KEY]?.historyMeta?.scriptPrompt;
    if (persistedScript) {
        $('#gd-history-meta-script').text(persistedScript);
    }
}

// ─── Slash Commands ───────────────────────────────────────────────────
// TODO: Register slash commands for manual director control

// ─── Register Built-in Providers ──────────────────────────────────────
registerRecentMessages();
registerCharacters(settings, characters, buildCharacterProfilesText);
registerCharacterProfiles(buildCharacterProfilesText);

// MaxSpeakersProvider — kept inline (single-line, no deps needed)
registerProvider({
    id: 'maxSpeakers',
    placeholder: '{{maxSpeakers}}',
    render: (ctx) => ({ content: String(ctx.maxSpeakers || 1) }),
});

registerWorldInfoProvider(settings, wiState, buildDirectorWorldInfo);
registerHistoryProviders(settings, getDirectorHistory);
registerDirectorLedger(settings, getDirectorHistory);
registerTestProvider();

// ─── Init ─────────────────────────────────────────────────────────────
jQuery(async () => {
    await loadSettingsUI();
    console.log(`Group Director extension loaded (mode=${settings.mode})`);
});
