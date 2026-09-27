// This setting affects two manual buttons. It does not start compression,
// extraction, or deletion merely by being changed.
export const memoryRuleDefinitions = {
    memoryKeepRecent: {
        domain: 'memory',
        schema: { type: 'integer', minimum: 1, maximum: 100 },
        dependencies: ['memoryEnabled'],
        source: 'ui/sections/memory.js',
        description: '手动压缩时保留最近的完整记忆条数；界面的“撤销最近一次提取”也用此数值删除最近 N 条记忆，并不按提取批次识别。修改此全局设置不会立即压缩或删除当前聊天记忆；仅影响之后点击这两个按钮的操作。本工具支持 1..100，原界面输入处理只有下限，运行时不强制该上限。',
    },
};
