const source = (id, title, permission, selector, provider = id, scope = 'chat', format = 'text', reader = 'legacy') => Object.freeze({ id, title, permission, selector, provider, scope, format, reader, outputContract: format === 'structured' ? id : 'text', maxTextChars: 131072, pageChars: 2000, contractVersion: 1 });
export const providerCatalog = Object.freeze([
    source('variableDiagnostics', '当前聊天变量诊断 / Variable definitions and recent attempts', 'source-only', 'item:N', null, 'chat', 'text', 'variableDiagnostics'),
    source('recentMessages', '最近50条消息 / Last 50 messages', 'chat', 'empty'),
    source('chatSummary', '最近已保存的有效总结 / Latest saved active summary', 'chat', 'empty'),
    source('character_profiles', '角色档案标准字段 / Standard profile fields', 'chat', 'character:N'),
    source('charMemory', '角色记忆 / Character memories', 'chat', 'character:N'),
    source('chatHistory', '当前聊天历史正文 / Current chat history', 'extended', 'range:START:COUNT (1-20)', 'recentMessages'),
    source('characters', '当前聊天角色卡 / Current chat character cards', 'extended', 'character:N'),
    source('directorLedger', '最新导演账本正文 / Latest director ledger', 'extended', 'empty'),
    source('directorHistory', '导演历史账本正文 / Director history', 'extended', 'range:START:COUNT (1-10)'),
    source('memoryConfig', '记忆配置原始值 / Raw memory settings', 'diagnostics', 'empty; revision empty; offset 0', null, 'global', 'structured', 'memoryConfig'),
    source('variables', '当前聊天变量（含角色值） / Chat variables', 'source-only', 'item:N', null, 'chat', 'text', 'variables'),
    source('storyBlueprint', '当前聊天剧情蓝图与保存状态 / Story blueprint', 'source-only', 'node:N', null, 'chat', 'text', 'storyBlueprint'),
    source('stChat', 'SillyTavern 当前聊天概况 / Current chat overview', 'source-only', 'empty', null, 'chat', 'text', 'st'),
    source('stCharacters', 'SillyTavern 角色名称目录 / Character name directory', 'source-only', 'empty; search:NAME', null, 'global', 'text', 'st'),
    source('stGroups', 'SillyTavern 群组名称目录 / Group name directory', 'source-only', 'empty; search:NAME', null, 'global', 'text', 'st'),
    source('stWorldBooks', '世界书目录与当前绑定线索 / World-book directory and bindings', 'source-only', 'empty; search:NAME', null, 'chat', 'text', 'stWorldBooks'),
    source('stWorldBookEntries', '世界书条目正文（整个资源库） / World-book entries (entire library)', 'source-only', 'empty; book:N; search:N:QUERY; entry:N:M', null, 'global', 'text', 'stWorldBookEntries'),
    source('stPresets', 'SillyTavern 预设名称与选中状态 / Preset names and selection', 'source-only', 'empty; mode:N; search:N:QUERY', null, 'global', 'text', 'stPresets'),
    source('stPersonas', 'SillyTavern Persona 名称与当前状态 / Persona names and current state', 'source-only', 'empty; search:NAME', null, 'chat', 'text', 'stPersonas'),
    source('stExtensions', 'SillyTavern 扩展目录与配置启用状态 / Extension directory and configured status', 'source-only', 'empty; search:NAME', null, 'global', 'text', 'stExtensions'),
]);
export const providerSource = id => providerCatalog.find(p => p.id === id);
const routingHints = Object.freeze({
    variables: '资源/金币/数值：读取当前聊天存储值；不提供兑换条件或剧情规则。',
    variableDiagnostics: '变量定义与求值尝试的诊断，不替代存储值或剧情规则。',
    storyBlueprint: '任务目标、完成条件、兑换门槛、剧情计划：先读节点目录，再核对相关节点正文。可与变量值对照；不证明实际完成。',
    chatHistory: '剧情发生了什么、角色说过什么：可检索历史正文；不覆盖蓝图或世界书规则。',
    recentMessages: '近期对话正文；不覆盖其他资料来源。',
    charMemory: '角色记忆记录；不覆盖全部剧情规则。',
    stWorldBookEntries: '世界设定与规则：查相关世界书条目；库中存在不证明实际注入。',
});
export const publicProviderCatalog = () => providerCatalog.map(({ provider, reader, outputContract, maxTextChars, pageChars, ...p }) => ({ ...p, routingHint: routingHints[p.id] || '' }));
export const sourcePermission = id => providerCatalog.find(p => p.id === id)?.permission || 'denied';
export function sourceParentSelector(id, selector) {
    if (id === 'stWorldBookEntries') {
        const match = /^(?:search|entry):(0|[1-9]\d{0,3}):/.exec(selector);
        return match ? `book:${match[1]}` : '';
    }
    if (id === 'stPresets') {
        const match = /^search:([0-7]):/.exec(selector);
        return match ? `mode:${match[1]}` : '';
    }
    return '';
}
