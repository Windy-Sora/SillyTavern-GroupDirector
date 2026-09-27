const source = (id, title, permission, selector, provider = id, scope = 'chat', format = 'text', reader = 'legacy') => Object.freeze({ id, title, permission, selector, provider, scope, format, reader, outputContract: format === 'structured' ? id : 'text', maxTextChars: 131072, pageChars: 2000, contractVersion: 1 });
export const providerCatalog = Object.freeze([
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
]);
export const providerSource = id => providerCatalog.find(p => p.id === id);
export const publicProviderCatalog = () => providerCatalog.map(({ provider, reader, outputContract, maxTextChars, pageChars, ...p }) => ({ ...p }));
export const sourcePermission = id => providerCatalog.find(p => p.id === id)?.permission || 'denied';
