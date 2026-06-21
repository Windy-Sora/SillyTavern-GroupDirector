# Group Director — 设计文档

## 1. 概述

Group Director 是一个 **群聊上下文管线**：收集数据 → Agent 决策 → 注入角色 prompt。

默认搭载 4 个 Agent：Director（导演）、ForceSpeak（强制发言）、Profile（角色档案）、Summary（上下文总结）。每个 Agent 拥有独立的 API 配置，支持 ST 原生、OpenAI 或 Anthropic 协议。

框架不绑定任何特定用例——可替换 prompt 模板实现地牢主宰、辩论裁判、战斗系统、社会模拟等场景。

### 1.1 三层架构

```
┌── Agent Registry ─────────────────────────────────────────────────┐
│   register(agent) / get(id) / list()                              │
│   Agent = { id, pipelineOrder, pipeline, contextAccess }          │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ Agent 层 ──────────────────────────────────────────────────┐  │
│  │  agent.run({ pool, caller, config })                        │  │
│  │  声明 pipeline: context → prompt → call → parse → validate │  │
│  │  声明 contextAccess: 权限边界                                │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  Runtime 层                                                 │  │
│  │  execute() — 按 pipelineOrder 执行，state-driven            │  │
│  │  createScopedPool() — Proxy 强制 contextAccess             │  │
│  │  managedCall() — retry + timeout + onRetry callback         │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  Protocol 层                                                │  │
│  │  createCaller(config) — ST Native / OpenAI / Anthropic      │  │
│  │  config.agentConfigs[id] → extension_settings (Key 在此)     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
├── Provider 层 ─────────────────────────────────────────────────────┤
│   {{placeholder}} → 数据注入 (无状态)                               │
├── Systems 层 ──────────────────────────────────────────────────────┤
│   有状态业务逻辑 (工厂 + 依赖注入)                                    │
├── UI 层 ───────────────────────────────────────────────────────────┤
│   自注册模式 (registerSection)                                      │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 关键设计决策

| 决策 | 理由 |
|------|------|
| Agent = 声明式 pipeline | Runtime 执行，Agent 不碰控制流，可追踪、可调试 |
| contextAccess Per Agent | Proxy enforce，越权 warn/throw，防止数据污染 |
| callModel 统一治理 | retry + timeout + fallback，不在各处散落 |
| Protocol 层独立 | Agent 不感知 OpenAI/Anthropic 差异，加协议只改一个文件 |
| Key 存 extension_settings | 不随聊天导出，重启不丢 |
| 可变值用 getter | `chat`/`characters`/`chat_metadata` 是 ST 的 `export let` |
| 零修改 ST 核心 | 纯 Extension API：`generate_interceptor` + `abort(false)` |

---

## 2. Agent Runtime（核心）

### 2.1 Agent 定义

```js
const directorAgent = {
  id: 'director',
  displayName: 'Director',
  contextAccess: ['chat', 'recentMessages', 'characters', 'profiles', ...],
  pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
  pipeline: {
    async context(input, ctx, pool, config) { /* → state.ctx */ },
    async prompt(input, ctx, pool, config)  { /* → state.prompt */ },
    // call: null → Runtime 统一治理 (managedCall)
    async parse(input, ctx, pool, config)   { /* → state.parsed */ },
    async validate(input, ctx, pool, config){ /* → state.parsed */ },
  },
};
```

- `contextAccess`：声明该 Agent 需要访问哪些 pool key。未声明的 key 被 Proxy 拦截。
- `pipelineOrder`：阶段执行顺序。不在其中的阶段不执行，天然可选。
- `pipeline.call = null`：由 Runtime 统一治理（retry + timeout）。Agent 也可自定义 `call` 实现。

### 2.2 执行引擎 (execute)

```
execute(agent, { pool, caller, config })
  │
  ├─ createScopedPool(pool, contextAccess, agent, config)
  │    → Proxy enforce: strictMode=true → throw; false → warn+undefined
  │    → 记录 usedAccess Set
  │
  ├─ for (stage of pipelineOrder)
  │    ├─ 'call' + null → managedCall(caller, prompt, callConfig)
  │    ├─ 其他阶段 → fn(input, state.ctx, scoped, config)
  │    └─ state[stage] = result
  │
  └─ console.log(accessReport) // 声明 vs 实际使用差异
```

**State 对象**：`{ ctx, prompt, raw, parsed }` — 每个阶段读写明确的 key，不混用。

### 2.3 Context Pool

```js
buildContextPool({ group, enabledMembers, ... }) → {
  chat:           () => chat,
  recentMessages: (n) => chat.slice(-n),
  characters:     () => characters,
  profilesText:   () => buildCharacterProfilesText(),
  worldInfoText:  () => wiState.text,
  ledger:         () => getDirectorHistory(),
  group:          () => group,
  settings:       () => settings,
  // ... per-agent overrides
}
```

Agent 通过 `contextAccess` 声明需要哪些字段，Pool 通过 Proxy 强制约束。未来 Token Optimizer 可直接用 `contextAccess` 做选择性构建。

### 2.4 Execution Trace（可观测性层）

Agent 执行过程完全可追溯。通过 `config.enableTrace = true` 开启，零开销关闭。

#### 设计原则

| 原则 | 实现 |
|------|------|
| append-only | 每条 entry 写入后 `Object.freeze()` 冻结，不可修改 |
| 不参与控制流 | trace 变量不在 `if/return/throw` 中，只 push |
| 浅拷贝 | 外部数据 snapshot 时只拷贝元信息（长度、key 列表），不绑引用 |
| 默认关闭 | `config.enableTrace` 不传 = 零开销 |

#### 数据结构

```js
trace.snapshot() → {
  agentId: 'director',
  startTime: '2026-06-20T...',
  stages: [
    { stage: '_start', pipeline: ['context','prompt','call','parse','validate'],
      contextAccess: ['chat','recentMessages',...], time: ..., elapsed: 0 },
    { stage: 'context', duration: 1.2, outputSummary: { type:'object', keys:[...] } },
    { stage: 'prompt',  duration: 45.3, outputSummary: { type:'text', length: 3200 } },
    { stage: 'call',    duration: 2100, retries: 1, promptLength: 3200 },
    { stage: 'parse',   duration: 0.3, outputSummary: { type:'object', keys:['speakers','reason'] } },
    { stage: 'validate', duration: 0.1, outputSummary: { type:'object', keys:['speakers'] } },
    { stage: '_done', result: { type:'object', keys:[...] }, contextUsed: ['chat','recentMessages',...] }
  ],
  contextUsed: ['chat', 'recentMessages', 'characters', 'profilesText', 'worldInfoText', 'ledger', 'group']
}
```

#### 使用方式

```js
// 开启 — Agent 调用方加 enableTrace
const result = await execute(agent, {
    pool, caller,
    config: { ...settings, enableTrace: true, call: callCfg },
});

// 查看
const traces = AgentTrace.recent();  // 最近 20 条，环形缓冲
const last = traces[traces.length - 1];
console.log(last.stages.map(s => `${s.stage} ${s.duration}ms`));

// 清空
AgentTrace.clear();
```

#### 用法场景

| 场景 | 查什么 |
|------|--------|
| debug director decision | `stages[].outputSummary` 看每个阶段产出了什么 |
| track prompt drift | 对比两次 `prompt` 阶段的 `outputSummary.length` |
| audit takeover | 检查 `call` 阶段的 `retries` |
| optimize token usage | 查 `call` 阶段的 `promptLength` |
| detect contextAccess leak | 查 `_done` 的 `contextUsed` 对比声明的 `contextAccess` |

#### renderPrompt 级追踪

```js
// renderPrompt 支持 onCache 回调 — trace 可挂接查看 Provider 输出
await renderPrompt(template, ctx, {
    onCache: (snap) => {
        // snap = { recentMessages: { content: 1200, hasData: false }, ... }
        // 只含元信息，不含实际文本（避免内存膨胀）
    }
});
```

### 2.5 协议层 (createCaller)

```js
createCaller(config, stGenerateRaw) → { generate(prompt), test() }

config.useCustom = false → ST 原生 generateRaw
config.useCustom = true  → openaiCompatible / anthropicCompatible

// OpenAI:  POST {base}/v1/chat/completions
// Anthropic: POST {base}/v1/messages (anthropic-version: 2023-06-01)
```

### 2.6 Agent 注册

```js
AgentRegistry.register(createDirectorAgent({ renderPrompt, ... }));
AgentRegistry.register(createForceSpeakAgent({ renderPrompt, ... }));
AgentRegistry.register(createProfileAgent({ renderPrompt, ... }));
AgentRegistry.register(createSummaryAgent({ log }));
```

### 2.7 配置存储

```js
settings.agentConfigs = {
  'director':    { useCustom: false, protocol: 'openai', endpoint: '', apiKey: '',
                   model: '', call: { retries: 2, timeout: 30000 }, strictMode: false },
  'force-speak': { ... },
  'profile':     { ... },
  'summary':     { ... },
};
```

存于 `extension_settings[EXT_KEY].agentConfigs` → `data/default-user/extensions/group-director.json`。不与聊天数据混合，不随导出泄露。

---

## 3. Provider 系统

### 3.1 接口

```js
registerProvider({
    id: 'myFeature',
    placeholder: '{{myFeature}}',
    render: async (ctx) => ({
        content: '摘要文本',        // {{myFeature}} → 此文本
        data: { key: 'val' },      // {{?myFeature:key}} → "val"
    }),
});
```

### 3.2 已注册 Provider

| Provider | 占位符 | 说明 |
|----------|--------|------|
| `recentMessages` | `{{recentMessages}}` | 最近 N 条消息 |
| `newRecentMessages` | `{{newRecentMessages}}` | 智能上下文窗口 |
| `characters` | `{{characters}}` | 角色列表 |
| `character_profiles` | `{{character_profiles}}` | 角色档案 |
| `maxSpeakers` | `{{maxSpeakers}}` | 最大发言人数 |
| `worldInfo` | `{{worldInfo}}` | ST 世界书条目 |
| `previousPlan` | `{{previousPlan}}` | 上一轮导演计划 |
| `previousPlans` | `{{previousPlans}}` | 历史导演计划数组 |
| `directorLedger` | `{{directorLedger}}` | 最新导演计划 JSON |
| `directorHistory` | `{{directorHistory}}` | 全部导演历史 JSON |
| `worldBooks` | `{{worldBooks}}` | 激活世界书清单 |
| `worldBookImportance` | `{{worldBookImportance}}` | 条目重要性排名 |
| `characterLore` | `{{characterLore}}` | 角色世界书触发词 |
| `chatSummary` | `{{chatSummary}}` | 上下文总结 |
| `npcList` | `{{npcList}}` | NPC 列表 + 路径查询 |
| `charMemory` | `{{charMemory}}` | 全部角色记忆 |
| `charMemoryCurrent` | `{{charMemoryCurrent}}` | 当前发言角色记忆 |
| `importedSummary` | `{{importedSummary}}` | 导入的摘要（独立存储） |
| `identity` | `{{identity}}` | 身份锚定提示词（用户编程） |
| `systemTime` | `{{systemTime}}` | 系统日期时间 |
| `randomDice` | `{{randomDice}}` | 0.00-1.00 随机数 |
| `dice` | `{{dice}}` | 骰子 + 幸运值 |
| `moonPhase` | `{{moonPhase}}` | 月相 |
| `timeOfDay` | `{{timeOfDay}}` | 时段 + 季节 |
| `knowledge` | `{{knowledge}}` | 知识库原文 |
| `test` | `{{test}}` | 模板语法测试 |

### 3.3 编码规则

- Provider 有开关时在 `render()` 内返回空字符串，不用 `enabled` 跳过
- 可变值用 getter 传入
- `settings.js` 是唯一默认值来源

---

## 4. 模板渲染引擎（prompt-renderer.js）

### 4.1 五阶段管线

```
Phase 0   — {[{...}]} 直通槽位 → 哨兵替换
Phase 1   — 执行所有 Provider，缓存到 cache[id] = { content, data }
Phase 1.5 — 块循环 {{#provider:path}}...{{/provider}}
Phase 2   — 简单占位符 {{name}} → cache[id].content
Phase 3   — 路径查询 {{?name:path|fallback}}
Post      — 递归稳化 → 恢复直通槽位
```

### 4.2 路径查询语法

```
{{?directorLedger:scripts.$character}}
{{?history:plans[reason=开场].scripts}}
{{?directorLedger:events[-1].title}}
{{?worldBooks:allEntries[comment=地理与空间].content}}
```

### 4.3 运行时变量

| 变量 | 场景 | 含义 |
|------|------|------|
| `$character` | Script Wrapper | 当前角色名 |
| `$speakerIndex` | Script Wrapper | 发言顺序 (1-based) |
| `$speakerIndex0` | Script Wrapper | 发言顺序 (0-based) |
| `$speakerCount` | Script Wrapper | 本轮总发言人数 |
| `$it` | 块循环内部 | 当前迭代元素 |

---

## 5. 世界书管线

```
用户勾选世界书
  ↓
worldBookScanner.scanAll()
  ↓
{{worldBookImportance}} → Director Prompt: 条目名 + 关键词 + 重要性
  ↓
Director 返回 loreAssignments: { "Alice": ["条目1", "条目2"] }
  ↓
{{characterLore}} → Script Wrapper: [World lore: 条目1, 条目2]
  ↓
ST checkWorldInfo 检测到关键词 → 激活条目 → 注入正文
```

---

## 6. 模式

### 6.1 `off` — 关闭
不干预 ST 默认行为。force-speak 不受影响。

### 6.2 `formula` — 公式判断
本地评分，零 API 调用：

```
score(c) = mention(c)×w_mention + trigger(c)×triggerScore
         + recency(c)×w_recency − consecutive(c)×w_consecutivePenalty
         + talkativeness(c)×w_talkativeness + initiative(c)
```

CJK 角色名使用 `indexOf` 子串匹配，ASCII 名使用 `\b` 单词边界正则。

### 6.3 `llm` — 大模型判断
通过 Director Agent 调用 LLM：
1. Agent context 阶段收集上下文
2. Agent prompt 阶段渲染模板
3. Runtime managedCall 发送请求（支持自定义 API 或 ST 原生）
4. Agent parse 阶段解析 JSON
5. Agent validate 阶段校验 speakers

失败回退：3 次重试 → 复用历史计划 → 阻塞轮次。

---

## 7. 拦截器状态机

```
GROUP_WRAPPER_STARTED
  ├─ takeoverGenCount > 0 → return (nested sub-call)
  ├─ takeoverFailed → 复用旧计划
  ├─ swipe/regenerate → 重建/透传/复用
  └─ 正常新轮次 → 清空状态

Interceptor
  ├─ force-speak 检测（最先执行，不受模式关闭影响）
  ├─ 首个角色 → Formula/Agent 初始化
  ├─ takeover → 验证身份 + 注入剧本
  └─ 过滤 → 不在 pickedSet → abort

GROUP_WRAPPER_FINISHED
  ├─ takeoverPending → runManualOrderedGeneration()
  └─ 清理

GENERATION_STOPPED → generationStopped = true
MESSAGE_DELETED → 裁剪账本 + 裁剪总结 + 清空状态
CHAT_CHANGED → 裁剪账本 + 裁剪总结（分支/切换）
```

---

## 8. 如何添加新 Agent

1. 创建 `agents/xxx.js` → 声明 `{ id, displayName, contextAccess, pipelineOrder, pipeline }`
2. 在 `index.js` 中 `AgentRegistry.register(createXxxAgent({...}))`
3. UI 自动从 `AgentRegistry.list()` 生成配置块

如果 Agent 需要自定义 call 或特殊生命周期，继承 pipeline 模式即可——`pipelineOrder` 声明顺序，`pipeline[stage]` 提供实现。

---

## 9. 目录结构

```
SillyTavern-GroupDirector/
├── manifest.json
├── index.js                   # 入口：组装层、运行时状态、拦截器、事件监听
├── settings.js                # 常量 + 默认设置（单一真相源）
├── settings.html              # 设置面板
├── style.css
├── prompt-renderer.js         # 五阶段模板渲染引擎（含 locals + passthrough）
├── provider-registry.js       # Provider 注册表
│
├── assets/                    # 可插拔资源
│   ├── profiles/              # 导出预设文件（JSON）
│   │   ├── manifest.js        # profilePresets[] + npcPresets[]
│   │   ├── fantasy-rpg.json   # Profile 预设
│   │   └── npc-fantasy-tavern.json # NPC 预设
│   ├── providers/             # 21 个内置 Provider
│   │   ├── manifest.js        # 模块名清单
│   │   ├── recent-messages.js # {{recentMessages}}
│   │   ├── characters.js      # {{characters}}
│   │   ├── imported-summary.js # {{importedSummary}}
│   │   ├── identity.js         # {{identity}}
│   │   └── ...
│   └── capabilities/          # 3 个内置 Capability（统一 register(deps)）
│       ├── manifest.js        # 模块名清单
│       ├── emotion.js
│       ├── tts.js
│       └── image.js
│
├── agents/                    # Agent 层 — 每个 Agent 一个文件
│   ├── director.js            # Director Agent (context→prompt→call→parse→validate)
│   ├── force-speak.js         # ForceSpeak Agent (context→prompt→call→parse)
│   ├── profile.js             # Profile Agent (context→prompt→call→parse→validate)
│   └── summary.js             # Summary Agent (context→prompt→call)
│
├── systems/                   # 有状态业务逻辑
│   ├── agent-runtime.js       # execute + managedCall + createScopedPool + AgentRegistry + Execution Trace
│   ├── history-system.js      # 导演账本 CRUD + send_date 锚定裁剪
│   ├── world-info-system.js   # ST checkWorldInfo() 封装
│   ├── asset-loader.js        # 动态导入 + 注册 assets/ 模块
│   ├── user-provider-loader.js # 用户 Provider/Capability 导入（Blob URL + 持久化）
│   ├── profile-system.js      # 角色档案全流程
│   ├── profile-export-system.js # 角色档案导出/导入
│   ├── npc-system.js          # NPC 生成 + 导入角色卡
│   ├── npc-export-system.js   # NPC 导出/导入
│   ├── memory-system.js       # 角色记忆全流程
│   ├── memory-export-system.js # 记忆导出/导入
│   ├── world-book-scanner.js  # 世界书扫描 + 重要性计算
│   ├── chat-summary-system.js # 上下文总结
│   ├── summary-export-system.js # 摘要导出/导入 + {{importedSummary}}
│   └── export-import-system.js # 群聊导出/导入（角色卡+世界书 zip）
│
├── utils/                     # 纯函数工具
│   ├── custom-api.js          # createCaller (ST/OpenAI/Anthropic)
│   ├── path-resolver.js       # parsePath / resolvePath / formatValue
│   ├── counter.js             # {{counter}} / {{counter0}}
│   ├── json-utils.js          # extractJsonObject / sanitizeJson
│   └── string-utils.js        # djb2Hash / hashChar
│
└── ui/                        # UI 层（自注册模式）
    ├── settings-init.js       # loadSettingsUI() 入口
    ├── i18n.js                # 中英文字典
    ├── dom.js                 # $c() + bind helpers
    └── sections/              # 每个设置区域一个自注册模块
        ├── registry.js        # registerSection() / initAllSections()
        ├── modes.js           # 模式选择
        ├── formula.js         # 公式模式参数
        ├── director.js        # LLM 参数、剧本
        ├── continuity.js      # 连贯性模式
        ├── worldinfo.js       # 世界书开关
        ├── worldBooks.js      # 世界书选择
        ├── ledger.js          # 账本浏览器
        ├── forceSpeak.js      # 强制发言
        ├── chatSummary.js     # 上下文总结
        ├── summaryExport.js   # 摘要导出/导入
        ├── templateTester.js  # 模板测试器
        ├── profile.js         # 角色档案
        ├── profileExport.js   # 角色档案导出/导入
        ├── npc.js             # NPC 生成
        ├── npcExport.js       # NPC 导出/导入
        ├── memory.js          # 角色记忆
        ├── memoryExport.js    # 记忆导出/导入
        ├── identity.js         # 身份锚定
        ├── exportImport.js    # 群聊导出/导入
        └── agents.js          # Agent API 独立配置（动态生成）
```

---

## 10. 配置项总览

| 字段 | 默认 | 说明 |
|------|------|------|
| `mode` | `formula` | `off` \| `formula` \| `llm` |
| `topN` | 1 | 公式模式放行人数 |
| `recentMessageCount` | 10 | 分析最近消息条数 |
| `consecutivePenalty` | 15 | 连续发言惩罚 |
| `scoreWeights.*` | (见 settings.js) | 评分权重 |
| `triggerEnabled` / `triggerScore` | true / 40 | 触发器引擎 |
| `initiativeEnabled` / `initiativeBaseScore` | true / 5 | 主动性扰动 |
| `llmPrompt` | (内置) | Director Prompt 模板 |
| `llmMaxSpeakers` | 3 | 每轮最多发言人数 |
| `llmRespectOrder` | true | 严格顺序发言 |
| `llmContextDepth` | 10 | 传入 LLM 最近消息条数 |
| `llmCharDescMode` / `llmCharDescLength` | slice / 200 | 角色描述控制 |
| `llmScriptEnabled` | false | 启用导演剧本 |
| `llmScriptPrompt` | '' | 剧本风格要求 |
| `llmScriptWrapper` | (内置) | 剧本注入包装模板 |
| `llmHistoryEnabled` | true | 记录导演账本 |
| `llmScriptContinuity` | false | 连贯剧本 |
| `llmWorldInfoEnabled` | false | 世界书注入 |
| `templateMaxPasses` | 5 | 递归渲染最大轮数 |
| `templateRecursive` | true | 启用递归渲染 |
| `templateDebugPlaceholders` | false | 保留未注册占位符 |
| `identityPrompt` | '' | 身份锚定提示词（用户编程，通过 {{identity}} 注入） |
| `forceSpeakMode` | `native` | `native` \| `block` \| `llm` |
| `postSpeechMessageEnabled` | false | 每次发言后触发 PostSpeech |
| `postSpeechRoundEnabled` | false | 回合结束后触发 PostSpeech |
| `postSpeechBlocking` | true | PostSpeech 阻塞模式 |
| `agentConfigs` | `{}` | 每个 Agent 的独立 API 配置 |
| `agentConfigs[id].useCustom` | false | 使用独立 API |
| `agentConfigs[id].protocol` | `openai` | `openai` \| `anthropic` |
| `agentConfigs[id].endpoint` | '' | API 端点 URL |
| `agentConfigs[id].apiKey` | '' | API 密钥 |
| `agentConfigs[id].model` | '' | 模型名 |
| `agentConfigs[id].strictMode` | false | 严格 contextAccess 校验 |
| `agentConfigs[id].call.retries` | 2 | 重试次数 |
| `agentConfigs[id].call.timeout` | 30000 | 超时 (ms) |

---

## 11. PostSpeech 多模态策略（实验性）

### 11.1 架构

```
角色发言 → CHARACTER_MESSAGE_RENDERED → PostSpeech Agent (per-message)
回合结束 → GROUP_WRAPPER_FINISHED      → PostSpeech Agent (per-round)
                                              ↓
                                    LLM 输出 policy JSON
                                              ↓
                                    Executor: resolve → schedule → execute
                                              ↓
                                    Capability.executor() → TTS / Image / ...
```

### 11.2 PostSpeech Agent

Pipeline: `context → prompt → call`（无 parse/validate，policy 格式由 Prompt 锁定）

- `context` 阶段：收集发言内容 + 角色信息 + 已注册能力清单
- `prompt` 阶段：渲染 PostSpeech Prompt（支持所有 Provider 占位符），注入能力参数 schema
- `call` 阶段：LLM 返回结构化 JSON policy

**Policy 格式（锁定，用户不可编辑）**：

```json
{
  "intents": [{ "type": "tts", "params": { "emotion": "angry", "speed": 1.3 } }],
  "timing": { "mode": "immediate" }
}
```

**两种模式**：
| 模式 | 触发时机 | 用途 |
|------|---------|------|
| per-message | `CHARACTER_MESSAGE_RENDERED`，每条角色发言后 | TTS、情绪检测等即时反馈 |
| per-round | `GROUP_WRAPPER_FINISHED`，所有角色发言后 | 场景图像、回合总结等批量处理 |

**通知机制**：两种模式在 LLM 处理期间均显示持续提示，完成后弹出成功 toast。

**⚠️ 性能警告**：启用 PostSpeech 后每次角色发言增加 1 次 LLM 调用（per-message）+ 每轮 1 次（per-round），等待时间显著增加。

### 11.3 Capability 系统

**CapabilityRegistry** — 独立于 AgentRegistry：

```
注册: CapabilityRegistry.register({ id, displayName, description, promptHint, schema, executor, constraints })
查询: CapabilityRegistry.get(id) / list() / listEnabled()
开关: CapabilityRegistry.setEnabled(id, true/false)
```

**如何加一个新能力**：

```js
// 1. 创建 capabilities/xxx.js
import { CapabilityRegistry } from '../systems/capability-registry.js';
export function register({ log }) {
    CapabilityRegistry.register({
        id: 'tts',
        displayName: 'TTS Voice',
        description: 'Adjust voice emotion/tone',
        promptHint: 'Activate when emotional tone is clear',
        schema: {
            intents: ['tts', 'voice', 'speech'],
            params: {
                emotion: { type: 'string', values: ['neutral','happy','sad','angry'], default: 'neutral' },
                speed:   { type: 'number', min: 0.5, max: 2.0, default: 1.0 },
            },
        },
        constraints: { maxPerMessage: 1, cooldown: 1000 },
        executor: async (params) => { /* call external service */ },
    });
}

// 2. 在 index.js 中 import + 调用 register({ log })
```

**能力注册规范**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 唯一标识，LLM policy 中的 `type` 字段匹配此值 |
| `executor` | ✅ | `async (params) => {}`，能力执行函数 |
| `schema.intents` | 否 | LLM 可以通过哪些别名触发此能力 |
| `schema.params` | 否 | 参数 schema（type/values/min/max/required/default），Executor 自动校验 |
| `promptHint` | 否 | LLM 决策指引：何时触发此能力 |
| `constraints.maxPerMessage` | 否 | 每条消息最多触发次数（默认 1） |
| `constraints.cooldown` | 否 | 冷却时间（ms） |

### 11.4 Executor

**三阶段**：`resolve → schedule → execute`

```js
const executor = createExecutor({ blocking: true, log, onExecuted });
await executor.run(policy, CapabilityRegistry.list());
```

- `resolve`：intents → 匹配能力（schema 参数校验、type 强制、range clamp）
- `schedule`：按 `timing.mode`（immediate / deferred / round_end）排执行计划
- `execute`：blocking（顺序 await）或 fire-and-forget（异步后台）

### 11.5 决策持久化

`chat_metadata[EXT_KEY].postSpeechDecisions` — 随聊天导出/导入，`MESSAGE_DELETED` 和 `CHAT_CHANGED` 时自动裁剪。

去重 key：`(messageIndex, capabilityId)` — swipe/regenerate 时自动跳过。

---

## 12. 角色记忆系统（Character Memory）

### 12.1 架构

每个角色维护一个动态记忆列表，手动触发提取。融合 Profile（结构管理）和 Summary（对话扫描）：

```
角色发言记录 → 手动点击"扫描/提取"
                    ↓
              Memory Agent (per-character)
              ┌─ context:  已有记忆 + 角色信息 + 对话上下文
              ├─ prompt:   用户自定义模板（支持 Provider 渲染）
              ├─ call:     LLM 提取新记忆
              ├─ parse:    JSON → 结构化条目
              └─ validate: 去重（event 文本匹配）
                    ↓
              chat_metadata.charMemories[avatar] += [{ event, mood, round, timestamp }]
```

### 12.2 和 Profile / Summary 的关系

| | Profile | Summary | Memory |
|------|---------|---------|--------|
| 粒度 | 角色 | 全局 | 角色 |
| 触发 | 手动 | 手动 | 手动 |
| Schema | 自定义 JSON | 无 | 自定义 JSON |
| 渲染 | `{{character_profiles}}` | `{{chatSummary}}` | `{{charMemory}}` + `{{charMemoryCurrent}}` |
| 去重 | 无 | 无 | event 文本匹配 |
| 压缩 | 无 | 覆盖/追加 | 旧记忆合并摘要 + 保留最近 N 条 |

### 12.3 Provider

| Provider | 内容 | 用途 |
|----------|------|------|
| `{{charMemory}}` | 所有角色记忆 | Director Prompt 全局视角 |
| `{{charMemoryCurrent}}` | 当前发言角色记忆 | Script Wrapper 角色视角 |

**多级匹配**：avatar 精确 → name 精确 → 子串模糊 → 自动迁移旧记忆到新 avatar key。角色卡替换/重命名时无缝过渡。

### 12.4 默认 Schema

```json
{
  "event": "主人夸了咖啡，脸红了",
  "mood": "happy"
}
```

用户可自定义 JSON Schema + Render Template + Prompt，和 Profile 完全对称。

### 12.5 GUI 功能

- 按钮：刷新、扫描已有对话、提取全部角色、检测失联、重置全部
- 每个角色一张展开卡片：记忆计数 + 展开列表 + 编辑/删除单条
- 角色级操作：提取、压缩、回退
- **压缩**（v2）：调 LLM 将旧记忆合成为一段自然语言摘要（可自定义压缩 Prompt），失败时 fallback 到分号拼接。压缩条目标记 `compressed: true` + `originalCount: N`
- **单角色记忆上限**：`memoryMaxEntries`，超出自动裁剪最旧条目（默认 200）
- 失联检测：MESSAGE_DELETED 后标记漂移记忆

### 12.6 记忆模板配置

| 字段 | 默认 | 说明 |
|------|------|------|
| `memoryEnabled` | false | 启用角色记忆 |
| `memoryTokenBudget` | 2000 | Token 预算 |
| `memoryPrompt` | 内置 | 记忆提取 Prompt |
| `memoryJsonSchema` | 内置 | JSON Schema |
| `memoryRenderTemplate` | 内置 | 渲染模板 |
| `memoryKeepRecent` | 5 | 压缩时保留最近 N 条 |
| `memoryMaxEntries` | 200 | 单角色记忆上限 |
| `memoryCompressPrompt` | 内置 | 压缩 Prompt（LLM 摘要） |

---

## 13. 身份锚定 (Identity Anchor)

### 13.1 设计动机

系统已经维护了角色档案（Profile）、角色记忆（Memory）、导入摘要等身份碎片。但这些碎片之间没有统一的"解释框架"——当 Profile 说"沉默寡言"而 Memory 记录"滔滔不绝讲了 3 轮"时，LLM 没有明确的冲突解决规则。

Identity Anchor 不增加新的结构化 kernel 层，而是提供一个 **用户可编程的语义锚定入口**：用户在 textarea 中书写指令，告诉 LLM 如何看待这些数据碎片及其优先级关系。

### 13.2 架构

```
用户书写 {{identity}} 模板
    ├── 定义数据源优先级（Profile > Memory > Script）
    ├── 引用: {{character_profiles}} {{charMemory}} {{importedSummary}}
    ├── 走完整 renderPrompt 管道（递归渲染所有占位符）
    └── 渲染结果 → 一段带语义包裹的锚定文本

用户手动放入 Director Prompt 或其他模板:
    {{identity}}    ← 完全 opt-in，不自动注入
```

### 13.3 Provider

`{{identity}}` — 渲染 `identityPrompt` 设置项内容。与其他 Provider 完全一致：注册到全局注册表，支持递归渲染。

```js
registerProvider({
    id: 'identity',
    placeholder: '{{identity}}',
    render: async () => {
        const raw = settings.identityPrompt;
        if (!raw) return { content: '', data: null };
        return { content: await renderPrompt(raw, ...), data: null };
    },
});
```

### 13.4 典型用法

```
# Director Prompt 中:
{{identity}}

你的任务是作为导演决定谁发言。

# identityPrompt 设置项中:
以下内容定义了角色的核心人格锚点。请在全部判断中遵守：
- 角色档案是长期稳定的身份内核，具有最高优先级
- 角色记忆是角色经历的情境线索，不是性格定义
- 当记忆描述与档案冲突时，以档案为准
- 导入摘要提供跨世界的背景参考

{{character_profiles}}
{{charMemory}}
```

### 13.5 设计原则

| 原则 | 实现 |
|------|------|
| 完全 opt-in | 不放入模板则零影响，不会自动注入任何 prompt |
| 用户拥有解释权 | 用户写优先级规则，系统不预设"profile>memory"等逻辑 |
| 复用现有基础设施 | 标准 Provider + renderPrompt，零新增代码模式 |
| 不新增 kernel 层 | 不引入结构化的 identity schema，用自然语言描述锚定规则 |

### 13.6 配置项

| 字段 | 默认 | 说明 |
|------|------|------|
| `identityPrompt` | `''` | 用户自定义身份锚定提示词，空则不注入 |

文件：`assets/providers/identity.js`、`ui/sections/identity.js`

---

## 14. 导出/导入系统

Group Director 为四种数据类型提供完整的导出/导入能力，均输出标准 JSON 文件，含模板配置。

### 13.1 通用设计模式

```
┌── Export ──────────────────────────────────────────────────────────┐
│  选择数据 → 打包 JSON（数据 + 模板配置）→ 浏览器下载 .json            │
├── Import ──────────────────────────────────────────────────────────┤
│  选择文件 → 校验格式 → 模板一致性检查（hash 比对，警告可关闭）          │
│          → 展示匹配/冲突状态 → 用户勾选 → 写入存储                    │
└────────────────────────────────────────────────────────────────────┘
```

**共同规则**：
- 导出文件格式 `{ version, type, exportedAt, source, template, data[] }`
- 模板一致性检查使用 `djb2Hash` 比对，不一致时警告但不阻止
- 导入时可勾选"同时导入模板配置"
- UI 提供刷新按钮、全选、反选、取消

### 13.2 角色档案导出/导入

**存储位置**：`chat_metadata[EXT_KEY].characterProfiles`（不动原逻辑）

**粒度**：逐角色勾选（state='ready' 可勾选）

**导出格式**：
```json
{
  "version": 1, "type": "profile-export",
  "template": { "generatorPrompt", "jsonSchema", "renderTemplate" },
  "profiles": [{ "avatar", "name", "hash", "profile": {...} }]
}
```

**导入匹配**：avatar 精确匹配 → 新建/覆盖

**UI 特点**：模板不一致警告可单独 `×` 关闭。

文件：`systems/profile-export-system.js`、`ui/sections/profileExport.js`

### 13.3 NPC 导出/导入

**存储位置**：`chat_metadata[EXT_KEY].npcs`（不动原逻辑）

**粒度**：逐条 NPC 勾选

**导出格式**：
```json
{
  "version": 1, "type": "npc-export",
  "template": { "npcPrompt" },
  "npcs": [{ "name", "description", "personality", "scenario", "first_mes" }]
}
```

**导入匹配**：按 name 去重 → 同名覆盖（保留 imported/importedAvatar 追踪）

文件：`systems/npc-export-system.js`、`ui/sections/npcExport.js`

### 13.4 摘要导出/导入

与 Profile/NPC 完全不同——摘要不与 live 系统混合，独立存储。

**导出**：仅导出当前激活的 live summary（一键，无需勾选）

**导入存储**：`chat_metadata[EXT_KEY].importedSummaries[]` — **独立于** `chat_metadata[EXT_KEY].summaries`（live 系统）

**数据模型**：
```js
{ id, name, content, enabled, sourcePrompt, createdAt }
```

**新 Provider**：`{{importedSummary}}` — 渲染所有 `enabled` 的导入摘要，与 `{{chatSummary}}` 完全独立、互不干扰。

**导入模式**：每条导入由用户 prompt 命名，通过勾选面板控制启用/禁用。支持预览渲染结果。

**模板**：1 项（summaryPrompt），导入时可选一并覆盖。

文件：`systems/summary-export-system.js`、`assets/providers/imported-summary.js`、`ui/sections/summaryExport.js`

### 13.5 记忆导出/导入

最复杂的导出系统——嵌套的 per-character array 存储。

**粒度**：逐角色勾选（显示记忆条数），导出该角色全部记忆条目

**存储**：`chat_metadata[EXT_KEY].charMemories = { [avatar]: [...entries] }`

**导出格式**：
```json
{
  "version": 1, "type": "memory-export",
  "template": { "memoryPrompt", "memoryJsonSchema", "memoryRenderTemplate", "memoryCompressPrompt" },
  "memories": {
    "alice.png": {
      "name": "Alice",
      "entries": [{ "event", "mood", "round", "timestamp", "compressed", ...自定义字段全保留 }]
    }
  }
}
```

**Avatar 匹配（三级）**：

```
avatar 精确匹配 → name 精确匹配 → 子串模糊匹配 → 手动下拉选择 / 跳过
```

**导入模式（per-character）**：

| 模式 | 行为 |
|------|------|
| 追加（去重） | 按 event 文本小写匹配去重，不导入重复条目 |
| 替换全部 | 清空该角色现有记忆，写入导入条目 |

**数据清洗**：
- `round` → 统一设为 `-1`（避免跨聊天 orphan 误判）
- `timestamp` → 保留原值
- 所有自定义字段 → **完整保留**（不只 event/mood）
- 超出 `memoryMaxEntries` → 自动裁剪最旧条目
- 可选跳过 `compressed: true` 的条目

**模板**：4 项（prompt/schema/render/compress），导入时可选一并覆盖。

**导入匹配 UI 示例**：
```
☑ 导入  Alice → alice.png (8条, 2条压缩)  匹配: 精确匹配
             模式: [追加（去重）▾]  ☐ 跳过压缩记忆
☐ 导入  Bob  → bob.png (0条)             匹配: 未匹配 [选择角色▾]
```

文件：`systems/memory-export-system.js`、`ui/sections/memoryExport.js`

### 13.6 预设文件

`assets/profiles/` 存放预设 JSON：

```
assets/profiles/
  ├── manifest.js              # profilePresets[] + npcPresets[]
  ├── fantasy-rpg.json         # Profile 预设：3个奇幻角色
  └── npc-fantasy-tavern.json  # NPC 预设：3个酒馆NPC
```

- 预设随插件发布，UI 通过下拉框一键加载
- 加载后进入标准导入流程（展示匹配状态、勾选、应用）

### 13.7 导出系统对比

| | Profile | NPC | Summary | Memory |
|------|------|------|------|------|
| 粒度 | 逐角色勾选 | 逐条勾选 | 一键导出 active | 逐角色勾选 |
| 存储 | 原 key 写回 | 原 key 写回 | **独立 key** | 原 key 写回 |
| 导入模式 | 覆盖/新建 | 覆盖/新建 | 追加到独立列表 | 替换/追加(去重) |
| 匹配方式 | avatar 精确 | name 去重 | 无（独立条目） | **3级模糊匹配** |
| 模板项数 | 3 | 1 | 1 | **4** |
| 跳过选项 | 无 | 无 | 无 | 跳过压缩记忆 |
| 特殊处理 | hash 校验 | import 追踪 | 勾选启用/禁用 | round→-1 + 超限裁剪 |
| 新 Provider | 无 | 无 | **{{importedSummary}}** | 无 |

---

## 15. 资产管理 & 用户导入

### 15.1 AssetLoader

统一加载 `assets/` 下的扩展模块：

```js
// 加载 providers
AssetLoader.providers({ basePath: '../assets/providers', modules }, deps);
// 加载 capabilities
AssetLoader.capabilities({ basePath: '../assets/capabilities', modules }, deps);
```

每个 assets 子目录有 `manifest.js` → 列出模块名 → AssetLoader 动态 `import()` + `register(deps)`。

### 15.2 用户导入系统（User Provider/Capability Import）

**流程**：选 `.js` → FileReader 读源码 → 存 `extension_settings` → Blob URL → `import(url)` → `register(deps)`。

**持久化**：源码保存在 `extension_settings[EXT_KEY]`（userProviders / userCapabilities），`localStorage` 持久化，重启自动恢复。

**依赖注入**：由于 Blob URL 无法解析相对 `import` 路径，核心 API 通过两种方式注入：

```js
// 方式 1：register(deps) 参数
export function register({ registerProvider, CapabilityRegistry, log }) { ... }

// 方式 2：全局 window.GroupDirector
export function register() {
    const { CapabilityRegistry } = window.GroupDirector;
}
```

`window.GroupDirector = { CapabilityRegistry, registerProvider, log }` — 启动时挂载。

**规范**：
- 新 Provider/Capability 必须导出 `register(deps)`
- 不得使用相对 `import` 引用插件内部模块
- 导入后立即生效，刷新后自动恢复

### 15.3 资产管理抽屉

GUI 抽屉 7 `资产管理` — 统一管理用户导入的扩展：

```
资产管理
├ 导入 Provider   [导入 .js] [列表/删除/测试]
└ 导入 Capability [导入 .js] [列表/删除/测试]
```

- **测试按钮**：Provider → 渲染 `{{placeholder}}` 显示输出；Capability → 显示注册 schema
- **删除**：从 `extension_settings` 移除，重启后生效

---

## 16. Template Rendering Features

### 16.1 Locals（Per-call 占位符）

```js
await renderPrompt(template, ctx, {
    locals: { existingCharacters: charText, batchSize: '3' },
});
```

Agent 私有数据注入，不污染全局 Provider 注册表。

### 16.2 Passthrough（ST 原生占位符保护）

```js
await renderPrompt(template, ctx, {
    passthrough: ['User','user','char','original','description',...],
});
```

ST Handlebars 占位符（`{{User}}`、`{{char}}` 等）在 renderPrompt 中不被清除，留待 ST 自己的管线处理。

---

## 17. 失败回退 (v2)

- Agent 调用失败 → managedCall 重试 `retries` 次 → 复用历史 → 阻塞轮次
- 用户主动暂停 → `generationStopped` 标记 → 静默切断
- `selected_group` 为空 → 透明放行
- `type` 为 `quiet` / `impersonate` / `continue` → 不拦截
- Takeover 中途失败 → `takeoverFailed = true`，下次重试复用

---

## 18. 开发速查

| 任务 | 改哪些文件 |
|------|-----------|
| 加新 Agent | `agents/xxx.js`（新建）+ `index.js` register + UI 自动生成 |
| 改 Agent 行为 | `agents/xxx.js` → pipeline 对应阶段方法 |
| 加新协议 | `utils/custom-api.js` → 加 `makeXxxCaller()` |
| 加 Prompt 占位符 | `assets/providers/xxx.js`（新建）+ manifest.js 加一行 + `index.js` import/register |
| 加业务逻辑模块 | `systems/*.js`（新建）+ `index.js` import/组装 |
| 加设置项 | `settings.js` + `settings.html` + `ui/sections/*.js` |
| 加 UI 抽屉 | `settings.html`（inline-drawer）+ `ui/sections/newname.js` + `ui/settings-init.js` import |
| 加 UI 文字 | `ui/i18n.js`（zh+en）+ `settings.html` data-i18n |
| 改渲染引擎 | `prompt-renderer.js` |
| 改 LLM 响应解析 | `utils/json-utils.js` |
| 加新 Capability | `assets/capabilities/xxx.js`（新建，`export function register(deps)`）+ manifest 加一行 |
| 加新 Provider（新规范） | `assets/providers/xxx.js`（新建，`export function register(deps)`）+ manifest 加一行 |
| 用户导入扩展 | GUI 资产管理 → 选 `.js` 文件 → 自动注册 + 持久化 |
| 加导出系统 | `systems/xxx-export-system.js`（新建）+ `ui/sections/xxxExport.js`（新建）+ `index.js` 组装 + deps |
| 加预设文件 | `assets/profiles/xxx.json`（新建）+ `manifest.js` 加一行 |
| 改拦截器行为 | `index.js` → `groupDirector_Interceptor` |

---

## 19. 开发规范

### Agent 规范

```
1. 必须声明 contextAccess  — 只访问声明的 pool key。Proxy 强制约束。
2. 必须声明 pipelineOrder — 不在其中的阶段不执行，天然可选。
3. pipeline.call = null    — 由 Runtime managedCall 统一治理（retry+timeout+onRetry）。
4. Agent 不碰网络         — 只接收 caller.generate()，协议细节完全隔离。
5. 新增 Agent 只需三步    — agents/xxx.js → index.js register → 自动 UI。
6. UI 配置块自动生成      — 从 AgentRegistry.list() 读取，无需手写 HTML。
```

### 用户导入扩展规范

```
1. 导出 register(deps) 函数 — deps = { registerProvider, CapabilityRegistry, log }
2. 不 import 插件内部路径 — Blob URL 无法解析相对路径
3. 可用 window.GroupDirector 全局替代 import
4. Provider: deps.registerProvider({ id, render, ... })
5. Capability: deps.CapabilityRegistry.register({ id, executor, ... })
6. 导入后立即生效，重启自动恢复（extension_settings 持久化）
```

### Provider vs Locals

| | Provider | Locals |
|------|----------|--------|
| 生命周期 | 全局注册，一次注册处处可用 | 单次 `renderPrompt` 调用 |
| 注册方式 | `registerProvider({ id, render })` | `renderPrompt(tpl, ctx, { locals })` |
| 语法 | `{{name}}` | `{{name}}`（同一语法） |
| 适用场景 | 全局数据源（chat, characters, worldInfo...） | Agent 上下文数据（每次调用动态变化） |
| 使用位置 | 任意 `renderPrompt` | 仅 Agent 的 `prompt()` 阶段 |

**规则**：`locals` 只在 Agent 的 `prompt()` 阶段传入，不在其他地方传。locals 注入在 Provider 之后（Phase 1 → 注入 → Phase 2），不覆盖同名的注册 Provider。

### Context Pool 规范

```
1. buildContextPool 的 getter 名 = contextAccess 声明 key。
2. Agent 特有数据通过 overrides 传入 → pool 必须注册对应 getter。
3. 忘了注册 pool getter → Agent 拿到 undefined → 静默失败（最常见的隐形 bug）。
4. contextAccess 不声明 → Proxy 拦截 → strictMode 报错 / warn 模式警告。
5. 可变值（chat、characters、chat_metadata）用 getter 闭包传递，不直接引用。
```

### renderPrompt 调用规范

```
1. 数据替换必须在 renderPrompt 之前或通过 locals，严禁事后 `{{...}}` 字符串替换。
2. 递归渲染会二次扫描替换后的文本——若替换内容包含 {{...}} 会被清除。
3. 包含用户数据的文本（角色描述含 {{User}}）→ 用 locals 注入 + recursive: false。
4. 传给 renderPrompt 的 ctx 参数影响 Provider 行为（如 {{characters}} 读 ctx.enabledMembers）。
```

### Provider ctx 依赖表

| Provider | 依赖的 ctx 字段 | 未提供时的行为 |
|----------|----------------|---------------|
| `{{recentMessages}}` | `ctx.recentMessages` (array) | 返回空字符串 |
| `{{characters}}` | `ctx.enabledMembers` (avatar array) | 返回空字符串 |
| `{{newRecentMessages}}` | 无（读全局 chat） | 正常 |
| `{{worldInfo}}` | 无（读 wiState） | 正常 |
| `{{worldBookImportance}}` | 无（读 worldBookScanner） | 正常 |

---

## 20. 踩坑记录

### 架构层面

| 坑 | 原因 | 教训 |
|----|------|------|
| `{{...}}` 两套系统冲突 | renderPrompt Phase 2 把 Agent locals 当未注册 Provider 清除 | 添加 `locals` 机制，占位符语法统一、来源区分 |
| `state.ctx` 不存在 | execute() 用 stage 名做 state key（`state.context`），input 链找语义 key（`state.ctx`） | 添加 SEMANTIC 映射，每阶段执行后设置别名 |
| prompt 阶段收到 undefined | input 回退链缺 `state.ctx`：`parsed??raw??prompt??undefined` | 回退链补 `?? state.ctx` |
| contextAccess 漏声明 → 崩溃 | `pool.chat()` 调了但没声明，Proxy 返回 undefined→`undefined()`→TypeError | 加 `access trace`（每次 execute 后打印 used vs declared） |

### 数据流层面

| 坑 | 原因 | 教训 |
|----|------|------|
| NPC pool getter 漏注册 | `buildContextPool` 没加 NPC key，Agent 永远拿空数据 | 新增 Agent 时检查 pool getter 是否匹配 contextAccess |
| `{{User}}` 被 renderPrompt 吞掉 | 递归渲染二次扫描已替换的本地文本 | locals 注入 + `recursive: false` |
| `{{characters}}` Provider 空输出 | renderPrompt 传入空 `{}`，Provider 读 `ctx.enabledMembers` 为空 | 文档化了 Provider ctx 依赖表 |
| ForceSpeak parse 未入 pipeline | `parseResponse` 方法在 pipeline 外，execute 不调用 | pipeline 的方法必须在 `pipeline: {}` 内声明 |
| Director history 存 avatars 混 names | 两条保存路径格式不一致 | 统一使用 names 存储 |

### 渲染层面

| 坑 | 原因 | 教训 |
|----|------|------|
| CJK `\b` 永远匹配不到中文名 | JS 正则 `\b` 对 CJK 字符是 `\W→\W`，无单词边界 | `indexOf` 循环子串匹配 |
| 递归渲染二次清除已替换文本 | 字符描述含 `{{User}}`，递归 pass 重新扫描并清除 | 先 Provider 后 locals，关闭不必要的递归 |
| 数据占位符先替换后被清 | 手动 `.replace()` 在 renderPrompt 之前→递归 pass 又处理一遍 | 统一走 locals，不再手动 post-replace |
