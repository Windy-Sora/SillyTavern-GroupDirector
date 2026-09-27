// Rules consumed by formula selection and Director generation. These are stored
// settings leaves, not character keywords or a command to trigger a new round.
const integer = minimum => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const count = { type: 'integer', minimum: 1, maximum: 200 };

export const formulaRuleDefinitions = {
    recentMessageCount: { domain: 'scoring', schema: count, dependencies: ['mode'], idle: true, source: 'ui/sections/formula.js', description: '公式评分查看的最近消息条数；本工具支持1..200，原界面与运行时没有200的强制上限。只影响后续公式选人，不改变聊天历史。' },
    consecutivePenalty: { domain: 'scoring', schema: integer(0), dependencies: ['mode'], idle: true, source: 'ui/sections/formula.js', description: '同一角色连续发言时每条消息扣除的分数；0关闭这项扣分。只影响后续公式选人。' },
    triggerEnabled: { domain: 'scoring', schema: { type: 'boolean' }, dependencies: ['mode'], idle: true, source: 'ui/sections/formula.js', description: '控制公式选人的关键词触发。关键词来自角色描述、性格和场景，并非此配置里的独立列表；不编辑角色资料。' },
    triggerScore: { domain: 'scoring', schema: integer(0), dependencies: ['mode', 'triggerEnabled'], idle: true, source: 'ui/sections/formula.js', description: '公式选人中角色关键词命中时的加分；触发开关关闭时，数值保留但不会加分。' },
    initiativeEnabled: { domain: 'scoring', schema: { type: 'boolean' }, dependencies: ['mode'], idle: true, source: 'ui/sections/formula.js', description: '控制公式选人的主动性随机加分；不设置某个角色本轮实际获得的分数。' },
    initiativeBaseScore: { domain: 'scoring', schema: integer(0), dependencies: ['mode', 'initiativeEnabled'], idle: true, source: 'ui/sections/formula.js', description: '公式选人的主动性随机加分上界，运行时为 random()*baseScore；开关关闭时数值保留但不生效。' },
};

export const directorRuleDefinitions = {
    llmContextDepth: { domain: 'director', schema: count, idle: true, source: 'ui/sections/director.js', description: '最近消息条数；本工具支持1..200。导演、记忆、NPC、强制发言等流程共享此值，会影响后续调用的上下文开销。' },
    llmRespectOrder: { domain: 'director', schema: { type: 'boolean' }, dependencies: ['mode'], idle: true, source: 'ui/sections/director.js', description: 'LLM模式下按导演返回顺序逐人生成，接管SillyTavern激活循环；只影响后续轮次。' },
    llmCharDescMode: { domain: 'director', schema: { type: 'string', enum: ['full', 'slice'] }, idle: true, source: 'ui/sections/director.js', description: '角色描述注入方式：full为完整描述，slice按llmCharDescLength截断。启用角色档案时，角色描述可能被档案文本替代。' },
    llmCharDescLength: { domain: 'director', schema: { type: 'integer', minimum: 1, maximum: 4000 }, dependencies: ['llmCharDescMode'], idle: true, source: 'ui/sections/director.js', description: 'slice模式下每个角色描述的截断长度，单位为JavaScript字符串字符；本工具支持1..4000。full模式下此值保留但不用于截断。' },
};
