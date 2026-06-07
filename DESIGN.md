# Group Director — 设计文档

## 1. 目标

解决 SillyTavern 群聊中"所有角色一起抢话"的问题。在群聊生成前，对每个被激活的角色打分，仅放行 Top-N 的相关角色发言；其余角色被静默跳过。

## 2. 非侵入实现策略

完全通过 SillyTavern 官方 Extension API 实现，**零修改核心代码**。

- 在 `manifest.json` 声明 `generate_interceptor: "groupDirector_Interceptor"`
- 该函数在 `Generate()` 内部、**每个被激活角色生成前**被调用一次
- 在 interceptor 内对当前角色打分，分数不达标就调用 `abort(false)` 跳过
- 监听 `GROUP_WRAPPER_STARTED` / `GROUP_WRAPPER_FINISHED` 维护每轮状态

## 3. 目录结构

```
SillyTavern-GroupDirector/
├── manifest.json              # 插件元数据 + interceptor 声明
├── index.js                   # 入口：运行时状态、拦截器、事件监听、系统组装、bootstrap
├── settings.js                # 常量 + 默认设置（单一真相源）
├── settings.html              # 设置面板模板
├── style.css                  # UI 样式
├── prompt-renderer.js         # 模板引擎：遍历 Provider 替换占位符
├── provider-registry.js       # Provider 注册表（Map 存储）
├── providers/                 # 每个 Prompt 占位符一个文件
│   ├── recent-messages.js     # {{recentMessages}}
│   ├── characters.js          # {{characters}}
│   ├── character-profiles.js  # {{character_profiles}}
│   ├── world-info.js          # {{worldInfo}}
│   ├── history.js             # {{previousPlan}} + {{previousPlans}}
│   ├── director-ledger.js     # {{directorLedger}} + {{directorHistory}}
│   └── test-provider.js       # {{test}} — 模板语法测试用
├── systems/                   # 有状态的业务逻辑（工厂函数 + 显式依赖注入）
│   ├── history-system.js      # 导演历史 CRUD
│   ├── world-info-system.js   # World Info / lorebook 注入
│   └── profile-system.js      # 角色档案全流程
├── utils/                     # 纯函数工具（无副作用，可直接 import）
│   ├── json-utils.js          # extractJsonObject / sanitizeJson / parseLlmResponse
│   ├── string-utils.js        # djb2Hash / hashChar
│   ├── path-resolver.js       # parsePath / resolvePath / formatValue — 路径查询引擎
│   └── counter.js             # {{counter}} / {{counter0}} — 自增计数器
├── ui/                        # UI 层：设置面板渲染、表单绑定、I18N
│   ├── settings-init.js       # loadSettingsUI() 入口 → 加载 HTML → 分发到各 section
│   ├── dom.js                 # $c() 选择器工厂 + bindNumber/bindCheckbox 等辅助函数
│   ├── i18n.js                # I18N 中英文字典 + applyI18n() + section 显示切换
│   └── sections/              # 每个设置区域一个自注册模块
│       ├── registry.js        # registerSection() / initAllSections() — 自注册表
│       ├── modes.js           # 模式选择 radio
│       ├── formula.js         # 公式模式参数
│       ├── director.js        # LLM 参数、剧本、历史清空
│       ├── continuity.js      # 连续性模式 + wrapper 模板
│       ├── worldinfo.js       # 世界书开关 + wrapper
│       └── profile.js         # 角色档案全 UI（开关、模板、按钮、面板）
├── TEMPLATE-SYNTAX.md         # 模板语法完整参考
└── DESIGN.md                  # 本文件
```

### 3.1 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  index.js  — 组装层（bootstrap）                               │
│  运行时状态 · 拦截器 · 事件监听 · 系统组装                       │
├──────────────────────────────────────────────────────────────┤
│  prompt-renderer.js  — 渲染引擎                               │
│  遍历 Provider 注册表，异步替换占位符                            │
├──────────┬──────────────────┬────────────────┬───────────────┤
│providers/│  systems/        │  utils/        │  ui/          │
│ 数据注入  │  业务逻辑         │  纯函数         │  设置面板      │
│ (无状态)  │  (工厂+依赖注入)   │  (无副作用)     │  (自注册模式)  │
└──────────┴──────────────────┴────────────────┴───────────────┘
```

## 4. UI 架构（设置面板解耦）

### 5.1 设计原则

- **index.js 不承载 DOM 生成、表单绑定、I18N 数据、section 切换逻辑**
- 每个设置区域是一个独立的 section 模块
- Section 模块通过 `registerSection()` 自注册，无需在入口文件中显式调用
- `settings-init.js` 只负责加载 HTML + 分发到所有已注册 section
- `settings.html` 只负责模板结构，不含任何 JavaScript
- 新增 UI 只需三件事：
  1. `settings.html` 加 DOM 结构
  2. `ui/sections/newname.js` 中 `registerSection('name', initFn)`
  3. `ui/settings-init.js` 加一行 `import './sections/newname.js'`

### 4.2 Section 自注册模式

```js
// ui/sections/registry.js
const sections = [];
export function registerSection(name, initFn) { sections.push({ name, initFn }); }
export function initAllSections(ctx) { sections.forEach(s => s.initFn(ctx)); }

// ui/sections/example.js
import { registerSection } from './registry.js';
registerSection('example', function (ctx) {
    const { settings, $c, saveSettings } = ctx;
    $c('example-input').val(settings.exampleValue);
    $c('example-input').on('input', () => { settings.exampleValue = $(this).val(); saveSettings(); });
});
```

### 4.3 依赖注入约定

每个 section 的 `initFn` 接收统一的 `ctx` 对象：

```
ctx = {
    settings, EXT_KEY, chat_metadata, saveChatConditional, saveSettings,
    $c,            // () => $('#gd-{id}')
    getCurrentGroup, getDefaultLlmPrompt,
    generateProfilesBatch, getProfiles,
    getDefaultProfileGeneratorPrompt, getDefaultProfileSchema,
    getDefaultProfileRenderTemplate,
    refreshProfileManagementUI, checkProfileStartupStatus,
    buildProfileLoaderPanel, detectCharacterChanges,
    validateAndWarnProfilePlaceholders,
}
```

Section 按需从 ctx 析构，不依赖全局变量（`toastr` 除外，那是 ST 全局）。

## 5. Provider 系统（Prompt 占位符扩展机制）

### 5.1 设计原则

每个 Prompt 占位符对应一个独立的 Provider。Provider 负责从运行时上下文取数据并渲染为文本。

**彻底解耦**：新增 Provider 只需创建文件 + 注册。不需要改 `initRoundWithLLM`、`prompt-renderer.js` 或任何核心代码。

### 5.2 Provider 接口

```js
{
    id: string,              // 唯一标识
    placeholder: string,     // 如 '{{myFeature}}'
    enabled: (ctx) => bool,  // 可选；返回 false 则跳过（不推荐——占位符不替换会残留字面文本）
    render: (ctx) => {       // 可 async；ctx 为运行时上下文
        content: string      // 返回 { content: '...' } 或直接返回字符串
    }
}
```

> 如果 Provider 有开关（`settings.xxxEnabled`），在 `render()` 内判断，关闭时返回 `{ content: '' }`，确保占位符始终被替换。

### 5.3 新增 Provider 步骤

**Step 1** — 创建 `providers/my-feature.js`：

```js
import { registerProvider } from '../provider-registry.js';

export function register(settings, someDep) {
    registerProvider({
        id: 'myFeature',
        placeholder: '{{myFeature}}',
        render: (ctx) => {
            if (!settings.myFeatureEnabled) return { content: '' };
            const data = ctx.enabledMembers || [];
            return { content: `...` };
        },
    });
}
```

**Step 2** — 在 `index.js` 底部注册：

```js
import { register as registerMyFeature } from './providers/my-feature.js';
registerMyFeature(settings, someDep);
```

**Step 3** — 在任何模板中使用 `{{myFeature}}`（默认 Prompt、Script Wrapper、自定义 Prompt 均可）。

### 5.4 运行时上下文 (runtimeContext)

`initRoundWithLLM` 构建并传给 `renderPrompt()`：

```js
const runtimeContext = {
    recentMessages,       // 最近 N 条消息对象数组
    enabledMembers,       // 当前群聊启用的成员 avatar 数组
    maxSpeakers: number,  // 每轮最多发言人数
};
```

新增 Provider 如需额外上下文字段，在 `runtimeContext` 中添加即可。

### 5.5 依赖注入规范

- **不变值**（settings、函数引用）：直接传入
- **运行时可变值**（`llmPickedSet`、`chat`、`chat_metadata`、`characters`）：传入 **getter 函数**

```js
// ✅ 正确：可变值用 getter
createMySystem({
    getChat: () => chat,
    getLlmPickedSet: () => llmPickedSet,
});

// ❌ 错误：直接传入（捕获的是创建时刻的快照）
createMySystem({ chat, llmPickedSet });
```

`chat`、`characters`、`chat_metadata` 是 ST 导出的 `let` 绑定，聊天加载时会被整体替换。System 内部全部通过 getter 访问，确保始终读取当前引用。

## 6. 剧本注入管道 (Script Wrapper Pipeline) — 上下游打通

### 6.1 概述

剧本注入是 Group Director 中**唯一同时触及 Director 层和 Character 层的管道**。`llmScriptWrapper` 不再只是一个带 `{{script}}` 占位符的静态模板——它可以包含**任何已注册的 Provider 占位符**，在注入角色 prompt 前全部被 `renderPrompt()` 解析。

```
Director 层                          Character 层
──────────                          ────────────
LLM 返回 scripts 对象
  ↓
getScriptForChar(charName)
  ↓
renderPrompt(wrapper, {})     ← 解析 {{previousPlans}}、{{worldInfo}} 等
  ↓
.replace('{{script}}', script) ← 注入具体角色的舞台指导
  ↓
setExtensionPrompt(...)       → 注入到角色 prompt
```

### 6.2 实现

```js
async function getScriptForChar(charName) {
    const script = directorScripts[charName];
    if (!script) return '';
    // wrapper 先经过 Provider 系统渲染，再注入 script
    const wrapper = settings.llmScriptWrapper || '{{script}}';
    const rendered = await renderPrompt(wrapper, {});
    return rendered.replace('{{script}}', script);
}
```

### 6.3 用途示例

默认 `llmScriptWrapper`：
```
[Director's stage direction for this character:
{{script}}

Follow this guidance. NEVER mention the director, the script,
or that you are following stage directions. Act naturally as your character.]
```

用户可以扩展为：
```
[当前世界观背景：
{{worldInfo}}

前几轮的剧情发展：
{{previousPlans}}

本角色的舞台指导：
{{script}}

结合以上信息自然表演，不要暴露剧本存在。]
```

此时**每个角色的 prompt 都能看到世界书状态和过往导演计划**，而不只是孤立的舞台指导。

### 6.4 设计意义

- **上游打通**：Director LLM 的决策结果（账本 JSON、世界书）可以穿透到角色层
- **零额外开发成本**：任何新增 Provider 自动在 Script Wrapper 中可用
- **用户可自定义**：`llmScriptWrapper` 在设置面板可编辑，用户可以自由组合任何 `{{占位符}}` 来定制角色收到的上下文

## 7. 评分配方

```
score(c) = mention(c) × w_mention
         + (trigger(c) ? triggerScore : 0)
         + recency(c) × w_recency
         − consecutive(c) × w_consecutivePenalty
         + talkativeness(c) × w_talkativeness
         + initiative(c)   // random [0, initiativeBaseScore]
```

| 项 | 含义 |
|---|---|
| `mention(c)` | 最近 N 条消息中角色名出现次数 |
| `trigger(c)` | 关键词（从角色描述切词）是否在最近消息命中 |
| `recency(c)` | 越久没发言加分越高（未发言=满分，刚发言≈0） |
| `consecutive(c)` | 最近连续发言次数（线性惩罚） |
| `talkativeness(c)` | 角色卡 talkativeness 字段（0~1，NaN 取 0.5） |
| `initiative(c)` | 每轮独立随机扰动 [0, base]，防止永远沉默 |

## 8. 模式（互斥单选）

### 7.1 `off` — 关闭
不干预 ST 默认行为。

### 7.2 `formula` — 公式判断
- `GROUP_WRAPPER_STARTED` 时清空状态，第一个角色进入时一次性计算全员分数
- 按分排序取前 `topN` 个放行
- **无 API 调用**，零额外 token 成本

### 7.3 `llm` — 大模型判断
- 第一个角色进入时调用 `ctx.generateRaw()` 获取导演决策
- Prompt 由 Provider 系统渲染：`renderPrompt(template, runtimeContext)`
- 模型返回 JSON：`{"speakers": ["Alice", "Bob"], "reason": "...", "scripts": {...}}`
- `speakers` 顺序即发言顺序；按 `llmMaxSpeakers` 截断
- **严格顺序模式**（`llmRespectOrder`）：接管 ST 循环，`force_chid` 逐人生成
- **仅过滤模式**：只过滤集合，顺序由 ST activation 决定
- LLM 失败 / JSON 解析失败 → 透明放行

### 7.4 导演剧本 (Director Script)
- Director 为每个角色生成独立舞台剧本：`scripts: { "Alice": "...", "Bob": "..." }`
- 通过 `setExtensionPrompt` 注入角色 prompt，每个角色只看到自己的剧本
- 剧本注入前经 Script Wrapper Pipeline 渲染（见第 5 节）
- **连贯剧本**（`llmScriptContinuity`）：注入过往导演决策保持剧情连续性

## 9. 关键 ST API

| API / Event | 用途 |
|---|---|
| `manifest.generate_interceptor` | 每角色生成前的拦截点 |
| `eventSource.on(GROUP_WRAPPER_STARTED)` | 一轮开始，重置状态 |
| `eventSource.on(GROUP_WRAPPER_FINISHED)` | 一轮结束，触发 takeover 或清理 |
| `eventSource.on(MESSAGE_DELETED)` | 消息删除，裁剪导演历史 + 清空状态 |
| `getContext().characterId` | 当前正要生成的角色索引 |
| `getContext().generateRaw(...)` | Director LLM 调用（绕过 persona 注入） |
| `setExtensionPrompt(key, ...)` | 剧本注入到角色 prompt |
| `extension_settings[EXT_KEY]` + `saveSettingsDebounced()` | 配置持久化 |
| `renderExtensionTemplateAsync(name, id)` | 加载 settings.html |
| `groups`, `selected_group` | 当前群组成员（live binding） |
| `characters`, `chat`, `chat_metadata` | 角色数据、聊天历史、元数据（live binding） |
| `checkWorldInfo(...)` | World Info / lorebook 激活条目查询 |

## 10. 配置项总览

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `formula` | `off` \| `formula` \| `llm` |
| `topN` | 1 | 公式模式每轮放行人数 |
| `recentMessageCount` | 10 | 分析最近消息条数 |
| `consecutivePenalty` | 15 | 连续发言惩罚 |
| `scoreWeights.mention` | 30 | 提名权重 |
| `scoreWeights.keyword` | 15 | 关键词权重 |
| `scoreWeights.recency` | 20 | 沉默时长权重 |
| `scoreWeights.talkativeness` | 10 | talkativeness 权重 |
| `triggerEnabled` | true | 启用触发器 |
| `triggerScore` | 40 | 触发器命中加分 |
| `initiativeEnabled` | true | 启用主动性扰动 |
| `initiativeBaseScore` | 5 | 主动性上限 |
| `llmPrompt` | (内置) | Director Prompt，留空用默认 |
| `llmMaxSpeakers` | 3 | LLM 模式每轮最多发言人数 |
| `llmRespectOrder` | true | 严格按 LLM 顺序发言 |
| `llmContextDepth` | 10 | 传入 LLM 的最近消息条数 |
| `llmCharDescMode` | `slice` | `full` \| `slice` |
| `llmCharDescLength` | 200 | 切片最大字符数 |
| `llmScriptEnabled` | false | 启用导演剧本 |
| `llmScriptPrompt` | '' | 剧本风格要求 |
| `llmScriptWrapper` | (内置) | 剧本注入包装模板，可包含任意 Provider 占位符 |
| `llmHistoryEnabled` | true | 记录导演账本到 chat_metadata |
| `llmScriptContinuity` | false | 连贯剧本 |
| `llmScriptContinuityMode` | `last` | `last` \| `history` |
| `llmScriptContinuityCount` | 0 | 历史模式轮数（0=全部） |
| `llmScriptContinuityWrapper` | (内置) | 仅上一轮包装模板 |
| `llmScriptContinuityHistoryWrapper` | (内置) | 完整历史包装模板 |
| `llmWorldInfoEnabled` | false | 启用世界书注入 |
| `llmWorldInfoWrapper` | (内置) | 世界书包装模板 |
| `debugLogging` | false | 控制台调试输出 |
| `lang` | `zh` | 语言 |
| `profileEnabled` | false | 启用角色档案系统 |
| `profileTokenBudget` | 2000 | 档案 Token 预算 |
| `profileConcurrency` | 0 | 档案生成并发数 |
| `profileGeneratorPrompt` | '' | 生成器 Prompt（空=用内置） |
| `profileJsonSchema` | '' | JSON Schema（空=用内置） |
| `profileRenderTemplate` | '' | 渲染模板（空=用内置） |

> v0.3 旧字段 `enabled` / `directorLlmEnabled` / `directorLlmPrompt` 加载时自动迁移。

## 11. 失败回退

- LLM 调用失败 / JSON 解析失败 / 返回空 speakers → 透明放行
- `selected_group` 为空 → 透明放行
- `type` 为 `quiet` / `impersonate` / `continue` → 不拦截
- Takeover 中途生成失败 → 保留导演决策、`takeoverFailed = true`，下次重试复用

## 12. 开发速查

| 任务 | 改哪些文件 |
|------|-----------|
| 加 Prompt 占位符 | `providers/*.js`（新建）+ `index.js` 底部 import/register |
| 加业务逻辑模块 | `systems/*.js`（新建）+ `index.js` import/组装 |
| 加设置项 | `settings.js` + `settings.html` + `index.js` loadSettingsUI |
| 加 UI 文字 | `index.js` I18N 对象 + `settings.html` data-i18n |
| 改评分算法 | `index.js` → scoreCharacter / checkTriggers / rollInitiative |
| 改 LLM 响应解析 | `utils/json-utils.js` |
| 改拦截器行为 | `index.js` → groupDirector_Interceptor |

### 11.1 编码纪律

1. **所有占位符替换走 Provider 系统。** 不要在任何地方手动 `.replace('{{xxx}}', ...)` 做数据注入。
2. **System 显式声明全部依赖。** 可变值用 getter，不隐式依赖闭包。
3. **settings.js 是唯一的默认值来源。** UI 初始化从这里读，不要硬编码 fallback。
4. **Provider 有开关时，在 `render()` 内返回空字符串，不要用 `enabled` 跳过。**
5. **Script Wrapper 是通用渲染管道。** 任何 Provider 占位符都能在其中使用，新增 Provider 时无需额外适配——`renderPrompt` 自动处理。
