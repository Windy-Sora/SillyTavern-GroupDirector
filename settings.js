export const EXT_KEY = 'group-director';
export const MODE_OFF = 'off';
export const MODE_FORMULA = 'formula';
export const MODE_LLM = 'llm';

export const DEFAULT_SETTINGS = {
    mode: MODE_FORMULA,
    topN: 1,
    scoreWeights: {
        mention: 30,
        keyword: 15,
        recency: 20,
        talkativeness: 10,
    },
    recentMessageCount: 10,
    llmContextDepth: 10,
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
    // Director script
    llmScriptEnabled: false,
    llmScriptPrompt: '',
    llmScriptWrapper: '{{charMemoryCurrent}}{{characterLore}}[Director\'s stage direction for this character:\n{{script}}\n\nFollow this guidance. NEVER mention the director, the script, or that you are following stage directions. Act naturally as your character.]\n',
    llmHistoryEnabled: true,
    llmScriptContinuity: false,
    llmScriptContinuityMode: 'last',
    llmScriptContinuityCount: 0,
    llmScriptContinuityWrapper: '[Previous round\'s director plan — reference this for continuity, but update for the current situation:\n{{previousPlan}}\n]',
    llmScriptContinuityHistoryWrapper: '[Director plans from previous rounds:\n{{previousPlans}}\n]',
    // World Info
    llmWorldInfoEnabled: false,
    llmWorldInfoWrapper: '[Current world context / lorebook entries:\n{{worldInfo}}\n]',
    templateMaxPasses: 5,
    templateRecursive: true,
    templateDebugPlaceholders: false,
    // Force Speak
    forceSpeakMode: 'native',
    forceSpeakPrompt: '',
    // Script injection position: 0=IN_PROMPT (top), 1=IN_CHAT (near dialog)
    llmScriptPosition: 0,
    // Chat Summary
    knowledgeText: '',
    summaryEnabled: false,
    summaryReusePrevious: true,
    summaryPrompt: '',
    // World Book
    worldBookSelection: {},
    worldBookMaxEntries: 20,
    identityPrompt: '', // '' = use DEFAULT_IDENTITY_PROMPT
    debugLogging: false,
    lang: 'zh',
    // Character Profile System
    profileEnabled: false,
    profileTokenBudget: 2000,
    profileConcurrency: 0,
    profileGeneratorPrompt: '',
    profileJsonSchema: '',
    profileRenderTemplate: '',
    profileSchemaVersion: 1,
    // NPC Generation System
    npcEnabled: false,
    npcMaxCount: 10,
    npcBatchSize: 3,
    npcGenerateFirstMes: false,
    npcPrompt: '',
    // Character Memory System
    memoryEnabled: false,
    memoryTokenBudget: 2000,
    memoryPrompt: '',
    memoryJsonSchema: '',
    memoryRenderTemplate: '',
    memoryKeepRecent: 5,
    memoryMaxEntries: 200,
    memoryCompressPrompt: '',
    traceMaxEntries: 50,
    // PostSpeech — multimodal policy after each character message
    postSpeechMessageEnabled: false,
    postSpeechMessagePrompt: '',
    postSpeechRoundEnabled: false,
    postSpeechRoundPrompt: '',
    postSpeechBlocking: true,
    postSpeechDecisionLimit: 20,
    // Agent Runtime — per-agent API config (stored in extension_settings, not chat_metadata)
    agentConfigs: {}, // { [agentId]: { useCustom: false, protocol: 'openai', endpoint: '', apiKey: '', model: '', call: { retries: 2, timeout: 30000 }, strictMode: false } }
    customPrompts: [], // [{ id, name, content, enabled }]
    customPromptsEnabled: true,
};
