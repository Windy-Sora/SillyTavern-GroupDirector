// Public interface facts shared by the UI and its read-only reference catalog.
export const SETTINGS_PAGES = Object.freeze([
    ['connection', '模型连接', 'Connection', '配置暮羽使用的模型服务。', 'Choose the service used for your requests.'],
    ['data', '资料与历史', 'Data & history', '管理可读取资料，以及本地对话保存。', 'Control shared data and local conversation storage.'],
    ['behavior', '行为偏好', 'Behavior', '定制回答方式，不改变工具权限。', 'Customize response style, without changing permissions.'],
    ['limits', '运行预算', 'Budgets', '管理输入上下文和每轮执行上限。', 'Manage input context and per-run limits.'],
    ['skills', '技能', 'Skills', '管理可复用方法，不授予额外权限。', 'Manage reusable procedures, not permissions.'],
].map(Object.freeze));
export const UI_LABELS = Object.freeze({
    testConnection: Object.freeze(['测试连接', 'Test connection']),
    fetchModels: Object.freeze(['获取模型', 'Fetch models']),
    enableConnection: Object.freeze(['启用此连接', 'Enable connection']),
    exportJSON: Object.freeze(['导出当前对话 JSON', 'Export current conversation JSON']),
    exportMarkdown: Object.freeze(['导出当前对话 Markdown', 'Export current conversation Markdown']),
    showBall: Object.freeze(['显示暮羽悬浮球', 'Show Muyu floating ball']),
});
export function navigationDocument() {
    return { id: 'muyu.interface', version: 1, title: '暮羽界面入口与按钮', source: 'muyu/ui/navigation-metadata.js', scope: 'public-interface', text: JSON.stringify({
        kind: 'gui-reference-not-tool-capabilities', settingsEntry: '暮羽聊天窗口的齿轮配置 / Muyu window settings gear',
        pages: SETTINGS_PAGES.map(([id, zh, en]) => ({ id, label: { zh, en } })), buttons: UI_LABELS,
        connection: { page: 'connection', independentFromST: true, fields: ['协议', '完整接口地址', 'API 密钥', '模型'], advanced: ['思考选项', '记住密钥', '自动启用'], activateButton: 'enableConnection', autoEnableOptional: true, endpointRequiresChatCompletionsPath: true, noAutomaticPathAppend: true, deepseekEndpointExample: 'https://api.deepseek.com/chat/completions', modelNameFromUserOrFetchedMenu: true, testSendsFixedMessage: true, testMayCost: true, fetchOnlyUpdatesDraft: true, enableRequired: true, rememberedKeyPlaintextInSettings: true },
        historyExport: { location: '对话历史侧栏 → 当前对话操作 ⋯ / History sidebar → current conversation actions ⋯', source: '当前会话库记录，可能包含恢复内容；导出不是持久化确认。' },
        ballVisibility: { location: 'Group Director 经典设置 → 工具 → 暮羽 Agent', button: 'showBall' },
        notes: { page: 'data', section: '暮羽长期记忆', distinctFromCharacterMemory: true },
        skills: { page: 'skills', importOnlyFillsUnsavedEditor: true, reviewThenSave: true, newDefaultDisabled: true },
        boundary: '静态入口，不返回用户连接当前值，不授予连接读取或修改工具；不证明页面已打开、按钮可用、连接或保存成功。没有模型工具不代表没有GUI功能。',
    }) };
}
