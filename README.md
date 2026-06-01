# SillyTavern Group Director

解决 SillyTavern 群聊中**所有角色一起抢话**的问题。

在群聊生成前，对每个被激活的角色打分或调用大模型，只让**最相关的角色**发言，其余角色静默跳过。零修改 SillyTavern 核心代码。

---

## 功能

- **公式判断模式** — 本地评分，零 API 调用
  - 名字被提及加分
  - 角色描述关键词触发
  - 近期未发言奖励 / 连续发言惩罚
  - Talkativeness 权重
  - 主动性随机扰动（防止某角色永远沉默）
  - Top-N：只放行分数最高的 N 个角色

- **大模型判断模式** — 调用当前主模型
  - 结合最近消息上下文，让 LLM 决定谁发言、按什么顺序
  - Prompt 可完全自定义，支持 `{{recentMessages}}` / `{{characters}}` / `{{maxSpeakers}}` 占位符
  - `speakers` 数组顺序即发言顺序
  - **严格顺序**：接管 ST 激活循环，通过 `force_chid` 按导演决定的顺序逐人生成
  - **仅过滤集合**：只约束谁能发言，顺序由 ST 激活策略决定
  - 角色描述长度可控：全量传入或切片截断（可配长度）
  - 名字模糊匹配：大小写不敏感 + 子串匹配
  - JSON 解析加固：平衡大括号提取、尾逗号修复、单引号转换、多策略降级
  - LLM 调用失败时透明放行（不破坏聊天）
  - 使用 `generateRaw` 绕过角色 persona 注入，避免 LLM 认知混淆

- **三种模式互斥** — 关闭 / 公式判断 / 大模型判断，UI 用单选按钮切换

---

## 安装

### 方式一：扩展商店安装（推荐）

1. 打开 SillyTavern → 顶部 **Extensions** 面板
2. 点击 **Install extension**
3. 粘贴仓库地址：

```
https://github.com/WindySora/SillyTavern-GroupDirector
```

4. 点击 Install，重启 SillyTavern

### 方式二：手动克隆

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/WindySora/SillyTavern-GroupDirector.git
```

### 方式三：下载 ZIP

1. 前往 [Releases](https://github.com/WindySora/SillyTavern-GroupDirector/releases/tag/v0.4.6) 下载最新版
2. 解压到 `SillyTavern/public/scripts/extensions/third-party/SillyTavern-GroupDirector/`
3. 重启 SillyTavern

---

## 使用

1. 打开 **Extensions** 面板 → 找到 **Group Director** 折叠区
2. 选择判断模式：

| 模式 | 效果 |
|---|---|
| **关闭** | 不干预，SillyTavern 默认行为 |
| **公式判断** | 本地评分 Top-N，无额外 token 消耗 |
| **大模型判断** | 调用主模型决定发言者和顺序 |

3. **公式模式** — 调整 Top-N 和各项权重
4. **大模型模式** — 配置 Prompt 模板、最大发言人数、角色描述长度

> **群聊设置建议**：把群聊的 Activation Strategy 设为 **List**，Generation Mode 设为 **Swap**。List 让所有成员每轮都进入候选池，导演才能在全员中自由筛选和排序。

---

## 配置说明

### 公式判断参数

| 参数 | 默认 | 说明 |
|---|---|---|
| Top-N | 1 | 每轮放行人数 |
| 分析最近消息条数 | 10 | 评分时回看多少条 |
| 连续发言惩罚 | 15 | 每条连续发言扣分 |
| 名字被提及权重 | 30 | 消息中出现角色名的加分 |
| 关键词匹配权重 | 15 | 角色描述中的词出现在消息里的加分 |
| 近期未发言加权 | 20 | 越久没说话加分越高 |
| Talkativeness 权重 | 10 | 角色卡 talkativeness 字段的权重 |
| 触发器开关 | 开 | 启用/禁用关键词触发器 |
| 触发器加分 | 40 | 触发器命中时的固定加分 |
| 主动性开关 | 开 | 启用/禁用随机扰动 |
| 主动性基础值 | 5 | 随机扰动范围 0~该值 |

评分公式：

```
score = mention × w_mention
      + (trigger ? w_trigger : 0)
      + recency × w_recency
      - consecutive × w_consecutive_penalty
      + talkativeness × w_talkativeness
      + initiative (random 0~base)
```

### 大模型判断参数

| 参数 | 默认 | 说明 |
|---|---|---|
| 每轮最多发言人数 | 3 | 截断 LLM 返回的 speakers 列表 |
| 严格按顺序发言 | 开 | 接管 ST 循环，严格按 LLM 顺序 `force_chid` 逐人生成 |
| 角色描述模式 | 切片 | 全量传入 / 切片截断 |
| 切片长度 | 200 | 切片模式下保留前 N 个字符 |
| Director Prompt | (内置模板) | 可完全自定义，见下方占位符 |

Prompt 占位符：

| 占位符 | 替换为 |
|---|---|
| `{{recentMessages}}` | 最近 N 条聊天记录（名字+内容） |
| `{{characters}}` | 群成员列表（名字+描述） |
| `{{maxSpeakers}}` | 配置的最大发言人数 |

LLM 需返回严格 JSON（不要代码围栏，不要额外文字）：

```json
{
  "speakers": ["Alice", "Bob"],
  "reason": "Alice was directly asked a question, Bob should react"
}
```

`speakers` 数组的**顺序即发言顺序**。

---

## 严格顺序实现

启用"严格按顺序发言"后，Director 通过接管机制确保 LLM 指定的顺序得到遵守：

1. LLM 返回 ordered speakers → 标记接管
2. ST 原激活循环中的所有角色被 `abort(false)` 跳过
3. `GROUP_WRAPPER_FINISHED` 触发手动生成循环
4. 按 LLM 顺序逐个调用 `Generate('normal', { force_chid })`
5. 嵌套的 `GROUP_WRAPPER_STARTED` 被 `takeoverGenCount` 守卫保护，状态不重置

关闭严格顺序时，仅按集合过滤（集合内角色按 ST 激活顺序发言）。

---

## 兼容性

- SillyTavern 1.12+
- 不修改 SillyTavern 核心代码
- 兼容所有 LLM 后端（OpenAI / Claude / Kobold / Local / DeepSeek / ...）
- 大模型模式使用 `generateRaw` 绕过角色 persona 注入

---

## 文件结构

```
SillyTavern-GroupDirector/
├── manifest.json     # 插件元数据 + interceptor 声明
├── index.js          # 主逻辑
├── settings.html     # 设置面板
├── style.css         # UI 样式
├── DESIGN.md         # 技术设计文档
├── LICENSE           # MIT
└── README.md         # 本文件
```

---

## 许可

[MIT](LICENSE)
