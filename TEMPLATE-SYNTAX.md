# 模板占位符语法参考

## 1. 概述

Group Director 的模板系统支持两种占位符语法：

| 语法 | 用途 | 示例 |
|------|------|------|
| `{{name}}` | 渲染 Provider 的完整文本内容 | `{{recentMessages}}` |
| `{{?name:path\|fallback}}` | 从 Provider 的 JSON 数据中按路径提取单个值 | `{{?directorLedger:memory.location}}` |

两种语法可以在**任何模板**中使用——Director Prompt、Script Wrapper、自定义 Prompt 均可。

---

## 2. 简单占位符 `{{name}}`

```
{{recentMessages}}
{{characters}}
{{previousPlan}}
{{directorLedger}}
{{worldInfo}}
{{character_profiles}}
{{maxSpeakers}}
{{previousPlans}}
```

将 `name` 对应的 Provider 渲染结果直接插入模板。语义与旧版本完全一致，不受新语法影响。

---

## 3. 路径查询占位符 `{{?name:path|fallback}}`

### 3.1 基本格式

```
{{?provider:path.to.value}}
{{?provider:path.to.value|默认值}}
```

- `?` — 路径查询标记，与简单占位符区分
- `provider` — Provider 标识符（`directorLedger`、`previousPlan` 等）
- `path.to.value` — JSON 路径表达式
- `|默认值` — 可选。路径不存在或值为空时使用

### 3.2 路径语法

#### 点号访问

```
{{?directorLedger:memory.location}}
{{?directorLedger:scripts.Alice}}
{{?directorLedger:reason}}
```

等价于 JavaScript 的 `data.memory.location`。

#### 数组下标

```
{{?directorLedger:events[0].title}}
{{?previousPlans:plans[2].reason}}
```

等价于 `data.events[0].title`。下标从 0 开始。

#### 引号键名

用于 key 中包含 `.`、`-`、空格等特殊字符时：

```
{{?directorLedger:["key.with.dots"]}}
{{?directorLedger:['weird-key']}}
```

支持双引号和单引号，内部可含转义 `\"` 或 `\'`。

#### 组合使用

```
{{?directorLedger:chapters[0].["scene.title"].text}}
```

---

### 3.3 默认值

路径不存在、值为 `null` / `undefined`、或 Provider 无 `data` 时，返回默认值：

```
{{?directorLedger:memory.location|未知地点}}
{{?directorLedger:scripts.Bob|（无剧本）}}
{{?directorLedger:missing.deeply.nested|什么都没有}}
```

省略默认值（`{{?provider:path}}` 或 `{{?provider:path|}}`）时，缺失返回空字符串。

---

### 3.4 运行时变量 `$`

路径中可以使用 `$变量名` 引用模板上下文中的运行时变量：

```
{{?directorLedger:scripts.$character|}}
```

当前支持的变量：

| 变量 | 可用场景 | 含义 | 示例值（3 人选中，当前第 2 位 Bob） |
|------|---------|------|------|
| `$character` | Script Wrapper | 当前正在生成的角色名 | `"Bob"` |
| `$speakerIndex` | Script Wrapper | 发言顺序位置（1-based，展示用） | `2` |
| `$speakerIndex0` | Script Wrapper | 发言顺序位置（0-based，数组下标用） | `1` |
| `$speakerCount` | Script Wrapper | 本轮导演选中的总发言人数 | `3` |

**生命周期：** 变量仅在 `getScriptForChar()` 调用期间存在，用完即销毁。不跨轮次、不持久化、不泄漏。新轮次开始时 `GROUP_WRAPPER_STARTED` 会清空所有运行时状态。

如果变量值包含 `.`、`[`、`]`、空格等路径特殊字符，自动用 `["..."]` 包裹，确保路径解析正确。示例：角色名为 `Mr. Smith` 时，`scripts.$character` 自动展开为 `scripts.["Mr. Smith"]`。

**示例用法：**

在 Director Prompt 中不需要这些变量（Director 不知道具体角色）。在 Script Wrapper（`llmScriptWrapper`）中使用：

```
[你是 {{?directorLedger:speakers[$speakerIndex0]}}，
第 $speakerIndex / $speakerCount 位发言者。

你的专属剧本：
{{?directorLedger:scripts.$character|按照你的角色设定自由发挥}}

Follow this guidance. NEVER mention the director or script.]
```

Bob 实际收到时会被渲染为：

```
[你是 Bob，
第 2 / 3 位发言者。

你的专属剧本：
保持沉默，观察 Alice 的反应

Follow this guidance. NEVER mention the director or script.]
```

---

## 4. 取值规则

路径解析结果按以下规则转换为文本：

| 类型 | 输出 |
|------|------|
| `string` | 原文输出 |
| `number` | `String(value)`，如 `42` → `"42"` |
| `boolean` | `String(value)`，如 `true` → `"true"` |
| `object` / `array` | `JSON.stringify(value, null, 2)` 格式化输出 |
| `null` / `undefined` | 返回默认值；无默认值则返回空字符串 |

---

## 5. Provider 数据契约

### 5.1 旧格式（向后兼容）

```js
return { content: '一段文本' };
// 或
return '一段文本';
```

`{{name}}` 正常渲染。`{{?name:path}}` 因为无 `data` 字段，始终返回默认值或空字符串。

### 5.2 新格式（支持路径查询）

```js
return {
    content: '给 {{name}} 用的文本',
    data: {
        memory: { location: '樱花林' },
        scripts: { Alice: '试探 Bob', Bob: '保持沉默' },
        events: [{ title: '初遇' }, { title: '告别' }]
    }
};
```

- `{{name}}` → 渲染 `content`
- `{{?name:memory.location}}` → `"樱花林"`
- `{{?name:scripts.Alice}}` → `"试探 Bob"`
- `{{?name:events[0].title}}` → `"初遇"`

### 5.3 现有 Provider 的 data 支持

| Provider | `content` | `data` |
|----------|-----------|--------|
| `directorLedger` | 最新导演计划 JSON 字符串 | 最新导演计划原始对象 |
| `previousPlan` | 上一轮计划（wrapper 包裹） | 上一轮计划原始对象 |
| `previousPlans` | 历史计划数组（wrapper 包裹） | 历史计划原始数组 |
| `recentMessages` | 格式化消息文本 | 无 |
| `characters` | 角色列表文本 | 无 |
| `worldInfo` | 世界书条目文本 | 无 |
| `character_profiles` | 角色档案文本 | 无 |
| `maxSpeakers` | 数字字符串 | 无 |

---

## 6. 完整示例

### 6.1 Director Prompt

```
{{worldInfo}}
{{previousPlans}}
{{previousPlan}}

最近对话：
{{recentMessages}}

可选角色：
{{characters}}

角色档案：
{{character_profiles}}

---
你是群聊导演。根据以上信息，决定接下来由哪些角色发言。
最多选择 {{maxSpeakers}} 个角色。
按发言顺序排列。

上一轮导演理由：{{?directorLedger:reason|无}}

请返回 JSON：
{"speakers": ["角色1", "角色2"], "reason": "选择理由"}
```

### 6.2 Script Wrapper（角色层注入）

默认配置 `llmScriptWrapper`，使用 `$character`、`$speakerIndex`、`$speakerCount` 动态变量：

```
[Director stage direction — Speaker $speakerIndex / $speakerCount:
{{?directorLedger:scripts.$character|}}

Current location: {{?directorLedger:memory.location|未知}}

Previous events:
{{?directorLedger:events[0].title|无}}
{{?directorLedger:events[1].title|无}}

Follow this guidance. NEVER mention the director, the script,
or that you are following stage directions. Act naturally as your character.]
```

假设导演选中 Alice (1/3)、Bob (2/3)、Charlie (3/3)，Alice 实际收到时：

```
[Director stage direction — Speaker 1 / 3:
试探 Bob

Current location: 樱花林

Previous events:
初遇
告别

Follow this guidance. NEVER mention the director, the script,
or that you are following stage directions. Act naturally as your character.]
```

Bob 收到时 `$speakerIndex` 会变成 `2`，`$character` 变成 `Bob`，剧本自动切换为 Bob 的内容。三个角色收到三个不同的渲染结果，但模板是同一份。

---

## 7. 渲染机制

每次 `renderPrompt()` 调用分三阶段：

```
Phase 1 — 执行所有 Provider，缓存结果
    ↓
    cache = {
        directorLedger: { content: "...", data: {...} },
        recentMessages: { content: "...", data: null },
        ...
    }

Phase 2 — 替换简单占位符 {{name}}
    ↓
    {{directorLedger}} → cache["directorLedger"].content
    {{recentMessages}} → cache["recentMessages"].content

Phase 3 — 替换路径查询 {{?name:path|fallback}}
    ↓
    {{?directorLedger:memory.location}} → resolvePath(data, "memory.location")
    {{?directorLedger:scripts.$character|}} → 展开变量 → resolvePath → 取值
```

**关键保证**：每个 Provider 的 `render()` 在一次 `renderPrompt()` 调用中只执行一次。无论模板中引用该 Provider 多少次（简单占位符 + 多个路径查询），都从缓存读取。

---

## 8. 新增 Provider 指南

### 8.1 仅提供文本

```js
registerProvider({
    id: 'myProvider',
    placeholder: '{{myProvider}}',
    render: (ctx) => ({ content: '文本内容' }),
});
```

### 8.2 提供结构化数据

```js
registerProvider({
    id: 'myProvider',
    placeholder: '{{myProvider}}',
    render: (ctx) => ({
        content: '给 {{myProvider}} 用的摘要文本',
        data: { key1: 'value1', nested: { key2: 'value2' } },
    }),
});
```

用户即可使用 `{{?myProvider:key1}}`、`{{?myProvider:nested.key2}}` 提取具体字段。

---

## 9. 限制

- **不支持递归模板展开**：`data` 中的字符串值不会被二次当模板解析。如 `{ "text": "{{something}}" }`，路径查询返回的仍是字面 `{{something}}`。
- **不支持通配符或数组遍历**：`{{?provider:events[*].title}}` 不合法。取数组元素必须指定下标。
- **不支持表达式**：路径只能是纯字段访问，不含运算、函数调用、条件判断。
- **回退值不含 `}`**：默认值中不能出现 `}`，会被提前截断。
