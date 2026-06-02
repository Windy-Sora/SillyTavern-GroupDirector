# Group Director — 设计文档

## 1. 目标

解决 SillyTavern 群聊中"所有角色一起抢话"的问题。在群聊生成前，对每个被激活的角色打分，仅放行 Top-N 的相关角色发言；其余角色被静默跳过。

## 2. 非侵入实现策略

完全通过 SillyTavern 官方 Extension API 实现，**零修改核心代码**。

核心机制：

- 在 `manifest.json` 声明 `generate_interceptor: "groupDirector_Interceptor"`。
- 该函数会在 `Generate()` 内部、**每个被激活角色生成前**被调用一次（见 `public/script.js:4475` 的 `runGenerationInterceptors`）。
- 在 interceptor 内对当前角色（`getContext().characterId`）打分，分数不达标就调用 `abort(false)` —— 当前角色被静默跳过，群聊循环继续处理下一个角色。
- 监听 `GROUP_WRAPPER_STARTED` / `GROUP_WRAPPER_FINISHED` 维护每轮状态。

## 3. 目录结构

```
third-party/group-director/
├── manifest.json     # 插件元数据 + interceptor 声明
├── index.js          # 主逻辑（评分、触发器、主动性、Director LLM、UI 绑定）
├── settings.html     # 设置面板模板
├── style.css         # UI 样式
└── DESIGN.md         # 本文件
```

## 4. 评分公式

对群组中每个未禁言的成员，每轮计算一次：

```
score(c) = mention(c) * w_mention
        + (trigger(c) ? w_trigger : 0)
        + recency(c) * w_recency
        - consecutive(c) * w_consecutive_penalty
        + talkativeness(c) * w_talkativeness
        + initiative(c)   // random [0, initiativeBase]
```

| 项 | 含义 |
|---|---|
| `mention(c)` | 最近 N 条消息中角色名出现次数 |
| `trigger(c)` | 关键词（从角色描述切词）是否在最近消息中命中 |
| `recency(c)` | 越久没发言加分越高（未发言=满分，刚发言=0） |
| `consecutive(c)` | 最近连续发言次数（线性惩罚） |
| `talkativeness(c)` | 角色卡 talkativeness 字段（0~1） |
| `initiative(c)` | 每轮独立的随机扰动，防止永远沉默 |

所有权重在 Settings UI 可调，并持久化到 `extension_settings['group-director']`。

## 5. 模式（互斥单选）

设置项 `mode` 只能取以下三个值之一：

### 5.1 `off` — 关闭

插件 interceptor 直接返回，SillyTavern 默认行为不变。

### 5.2 `formula` — 公式判断

- 每轮 `GROUP_WRAPPER_STARTED` 时清空状态。
- 第一个角色进入 interceptor 时一次性计算全员分数。
- 按分排序，取前 `topN` 个作为放行集合 `allowedAvatars`。
- `topN = 1` 即题目中的"Top-1 Speaker Filter"。
- **无 API 调用**，零额外 token 成本。

### 5.3 `llm` — 大模型判断

- 第一个角色进入 interceptor 时调用 `getContext().generateRaw({...})` 获取导演决策（绕过角色 persona 注入）。
- Prompt 模板可在 UI 配置，占位符 `{{recentMessages}}` / `{{characters}}` / `{{maxSpeakers}}`。
- 模型必须返回严格 JSON（启用剧本时含 `scripts` 字段）：
  ```json
  { "speakers": ["Alice", "Bob"], "reason": "...", "scripts": { "Alice": "...", "Bob": "..." } }
  ```
  `speakers` 数组的**顺序就是发言顺序**。
- 按 `llmMaxSpeakers` 截断。
- 两种执行策略（由 `llmRespectOrder` 控制）：
  - **严格顺序**（默认）：接管 ST 循环，通过 `force_chid` 按导演决定的顺序逐人生成。
  - **仅过滤集合**：只看是否在 picked 集合里，顺序由 SillyTavern activation 决定。
- LLM 失败 / JSON 解析失败 / 返回空 → 透明放行（不影响聊天）。

### 5.4 导演剧本 (Director Script)

可选子功能——启用后 Director 不仅决定谁发言，还为每个角色单独生成舞台剧本，注入到角色生成的 prompt 中。

- 剧本按角色名分发：`scripts: { "Alice": "stage dir", "Bob": "stage dir" }`
- 每个角色只收到自己的剧本，通过 `setExtensionPrompt(DIRECTOR_SCRIPT_KEY, ...)` 注入
- 注入前包裹用户可编辑的 **Script Wrapper**（`llmScriptWrapper`），默认含保密指令
- 剧本风格可通过 **Script Prompt**（`llmScriptPrompt`）定制
- **连贯剧本**（`llmScriptContinuity`）：将上一轮导演完整回复注入当前 prompt，通过 **连贯剧本包装模板**（`llmScriptContinuityWrapper`）包裹，`{{previousPlan}}` 为占位符
- 连贯数据存于 `lastDirectorResponse`，每轮更新

**两种模式互斥**：UI 用 radio 强制单选，运行时由 `settings.mode` 派发，绝不可能同时启用。

> ⚠️ **关于发言顺序的约束**：插件只能从 SillyTavern 已 activate 的成员里挑人/排序，无法激活原本未被 activation 选中的角色。建议在群聊设置里把 activation strategy 设为 **List**，让所有成员每轮都进入候选池，导演就能在全员中自由排序。

## 6. 关键 ST API / 事件

| API / Event | 用途 |
|---|---|
| `manifest.generate_interceptor` | 每角色生成前的拦截点（核心） |
| `eventSource.on(GROUP_WRAPPER_STARTED)` | 一轮群聊生成开始，重置状态 |
| `eventSource.on(GROUP_WRAPPER_FINISHED)` | 一轮结束，清理 |
| `getContext().characterId` | 当前正要生成的角色索引 |
| `getContext().generateRaw(...)` | Director LLM 调用（绕过 persona 注入） |
| `setExtensionPrompt(key, ...)` + `extension_prompt_types` | 剧本注入到角色 prompt |
| `extension_settings[EXT_KEY]` + `saveSettingsDebounced()` | 配置持久化 |
| `renderExtensionTemplateAsync(name, id)` | 加载 settings.html |
| `groups`, `selected_group` (live binding) | 当前群组成员列表 |
| `characters`, `chat` (live binding) | 角色数据、聊天历史 |

## 7. 配置项总览

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `formula` | `off` \| `formula` \| `llm`，互斥单选 |
| `topN` | 1 | 公式模式每轮放行人数 |
| `recentMessageCount` | 10 | 分析最近多少条消息 |
| `consecutivePenalty` | 15 | 连续发言惩罚 |
| `scoreWeights.mention` | 30 | 提名权重 |
| `scoreWeights.keyword` | 15 | 关键词权重 |
| `scoreWeights.recency` | 20 | 沉默时长权重 |
| `scoreWeights.talkativeness` | 10 | talkativeness 权重 |
| `triggerEnabled` | true | 启用触发器 |
| `triggerScore` | 40 | 触发器命中加分 |
| `initiativeEnabled` | true | 启用主动性扰动 |
| `initiativeBaseScore` | 5 | 主动性上限 |
| `llmPrompt` | (内置模板) | Director Prompt，留空用默认 |
| `llmMaxSpeakers` | 3 | LLM 模式每轮最多发言人数 |
| `llmRespectOrder` | true | 是否严格按 LLM 给的顺序发言 |
| `llmCharDescMode` | `slice` | 角色描述全量(`full`)或切片(`slice`) |
| `llmCharDescLength` | 200 | 切片模式最大字符数 |
| `llmScriptEnabled` | false | 启用导演剧本 |
| `llmScriptPrompt` | '' | 剧本风格要求提示 |
| `llmScriptWrapper` | (内置) | 剧本注入包装模板，`{{script}}` 为占位符 |
| `llmScriptContinuity` | false | 连贯剧本——每轮注入上轮导演计划 |
| `llmScriptContinuityWrapper` | (内置) | 连贯剧本包装模板，`{{previousPlan}}` 为占位符 |
| `debugLogging` | false | 控制台调试输出 |

> 兼容性：v0.3 的 `enabled` / `directorLlmEnabled` / `directorLlmPrompt` 旧字段会在加载时自动迁移到 `mode` / `llmPrompt`。

## 8. 失败回退

- LLM 调用失败 / JSON 解析失败 / 返回空 speakers → 透明放行（不 abort 任何角色，等价于"模式关闭"），不会自动跨模式回退到公式判断（保持互斥语义）。
- `selected_group` 为空或群组找不到 → 透明放行。
- `type` 为 `quiet` / `impersonate` / `continue` → 不拦截（避免影响这些特殊流程）。

## 9. 已知限制

- 关键词触发器目前用简单分词，对纯中文文本可能产生噪声词，可在后续版本接入 jieba 或允许用户自定义关键词列表。
- 同一角色卡复用名字时，按 `avatar` 字段去重以保证唯一。
- Director LLM 复用当前主模型；"独立模型配置" 仍待实现（可接入 Connection Manager 的多 profile）。

## 10. 后续路线

- [ ] 关键词触发器支持用户在角色卡 `extensions.group_director.triggers` 中自定义
- [ ] Director LLM 独立 Connection Profile
- [ ] 发言队列可视化（在群聊 UI 显示当前轮 Top-N 列表）
- [ ] 提供 slash command `/director topn 3` 等运行时调参
