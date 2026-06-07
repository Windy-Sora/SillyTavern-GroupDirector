# SillyTavern Group Director
🌏 Language

- English: [README_EN.md](README_EN.md)
- 中文: 当前页面

---
**SillyTavern 的可编程叙事运行时 / Programmable Narrative Runtime**

Group Director 不只是一个“谁先说话”的过滤器。
它是一个面向 SillyTavern 群聊的导演层：

* 决定谁应该发言
* 决定发言顺序
* 生成角色剧本与场景指导
* 维持剧情连续性
* 读取世界书 / Lorebook 信息
* 记录导演账本（Ledger）
* 支持可扩展的数据接口与模板查询
* 支持递归渲染与调试模式

它的设计目标不是把世界状态写死在代码里，而是让状态、结构和叙事逻辑能够通过 Prompt、Provider 和 Ledger 自然生长。

---

## 这解决什么问题？

在群聊 RP / 多角色叙事中，最常见的问题不是“没人说话”，而是：

* 所有人都想抢着回应
* 角色发言顺序混乱
* 重要角色被淹没
* 场景推进缺乏节奏
* 长线剧情很难持续

Group Director 在角色生成前加入一个“导演层”，把原本的“谁被激活就谁说话”，升级为：

> 当前剧情里，哪些角色真正应该说话？

---

## 核心能力

### 1) Formula Director（公式导演）

本地评分模式，不需要额外 API 调用。

它会根据以下信息计算角色优先级：

* 是否被提及
* 关键词触发
* 最近发言情况
* 连续发言惩罚
* Talkativeness
* 主动性随机扰动

适合：

* 大型群聊
* 长期 RP
* 希望尽量节省 Token 的场景

---

### 2) LLM Director（大模型导演）

由当前主模型直接担任导演。

它会结合：

* 最近聊天内容
* 角色描述
* 角色档案
* 世界书内容
* 历史导演计划
* 当前剧情状态

来决定：

* 谁应该发言
* 发言顺序
* 场景应该如何推进
* 是否需要为角色写入剧本指导

---

### 3) Director Script（导演剧本）

导演不仅决定“谁说话”，还可以为每个角色单独生成一段表演指导。

这些剧本会被注入到角色 Prompt 中，但角色不会知道导演、其他人的剧本或完整计划的存在。

适合：

* 情绪控制
* 氛围塑造
* 戏剧张力
* 多角色协同演出

---

### 4) Director Ledger（导演账本）

导演每次决策都可以保存成结构化 JSON，并写入聊天元数据。

账本不限制字段结构，因此你可以自由扩展：

* 剧情进度
* 角色关系
* 阵营状态
* 世界状态
* 任务状态
* 任何你想维护的长期变量

这让 Group Director 不只是一个导演工具，而是一个可持续生长的剧情状态容器。

---

### 5) 剧情连续性

你可以选择让导演只参考上一轮计划，也可以参考完整历史。

这非常适合：

* 长篇剧情
* 连载 RP
* 多章节叙事
* 伏笔与回收

---

### 6) 世界书感知

Director 可以读取当前激活的世界书 / Lorebook 内容，并把这些信息纳入决策。

这样导演不只是看对话，也能理解：

* 世界观设定
* 地区背景
* 势力关系
* 历史事件
* 当前环境

---

## 模板系统

Group Director 内置统一的模板与 Provider 机制。

所有 Prompt 编辑框都可以使用相同的数据接口，例如：

* `{{recentMessages}}`
* `{{characters}}`
* `{{character_profiles}}`
* `{{worldInfo}}`
* `{{previousPlan}}`
* `{{previousPlans}}`
* `{{directorLedger}}`
* `{{directorHistory}}`

### 路径查询

你也可以直接从 Provider 的 JSON 数据中取字段：

* `{{?directorLedger:reason}}`
* `{{?directorLedger:scripts.$character}}`
* `{{?directorHistory:[-1].reason}}`
* `{{?directorLedger:memory.location|未知地点}}`

### 递归渲染

模板支持递归解析。

你可以设置最大递归轮数，并在调试模式下保留未识别的占位符，方便排查模板问题。

---

## 角色档案系统

Group Director 还内置了角色档案生成与渲染系统，用于把角色信息整理成结构化数据。

它支持：

* 批量生成角色档案
* 自动检测角色变动
* JSON Schema 自定义
* 渲染模板自定义
* Token 预算压缩
* 档案状态管理

可提取的信息通常包括：

* summary
* tags
* motivation
* relationships

但这些字段并不是固定死的，你可以通过 Prompt 和 Schema 自己扩展。

---

## 工作流程

```text
用户输入
    ↓
Director 分析剧情
    ↓
读取世界书 / 角色档案 / 历史账本
    ↓
选择发言角色
    ↓
生成导演剧本（可选）
    ↓
注入角色 Prompt
    ↓
角色开始生成
```

---

## 适用场景

Group Director 特别适合：

* 酒馆群像
* 学院题材
* 冒险小队
* 宫廷政治
* 家族群像
* 战争剧情
* 长篇剧情 RP
* 多角色协作叙事

角色越多，效果越明显。

---

## 安装

### 方式一：扩展商店

在 SillyTavern 扩展商店中安装本项目。

### 方式二：手动安装

```bash
git clone https://github.com/Windy-Sora/SillyTavern-GroupDirector.git
```

然后将文件放入：

```text
SillyTavern/public/scripts/extensions/third-party/
```

重启 SillyTavern 后即可使用。

---

## 设置面板

Group Director 的设置面板提供了完整可编辑的配置项，包括：

* 判断模式：关闭 / 公式 / 大模型
* Top-N 与权重设置
* 触发器引擎
* 主动性系统
* Director Prompt
* Script Prompt / Script Wrapper
* 历史账本与连续性模式
* World Info 注入
* 角色档案系统
* 递归渲染与调试模式
* 语言切换

---

## 设计理念

Group Director 不是一个发言过滤器。
也不是一个简单的 speaker selector。

它更像一个轻量级、可编程的叙事运行时。

目标不是让更少的人说话，
而是让最合适的人，在最合适的时机，以最合适的方式说话。

更进一步地说，它希望让群聊像一场真正被导演过的故事。

---

## 模板占位符参考

### 基础占位符

| 占位符                      | 说明              |
| ------------------------ | --------------- |
| `{{recentMessages}}`     | 最近对话记录          |
| `{{characters}}`         | 角色列表            |
| `{{character_profiles}}` | 角色结构化档案         |
| `{{maxSpeakers}}`        | 每轮最多发言人数        |
| `{{worldInfo}}`          | 激活的世界书条目        |
| `{{previousPlan}}`       | 上一轮导演计划         |
| `{{previousPlans}}`      | 历史导演计划数组        |
| `{{directorLedger}}`     | 最新导演决策（完整 JSON） |
| `{{directorHistory}}`    | 全部导演历史数组        |

| 语法 | 示例 | 说明 |
|------|------|------|
| `{{?name:path}}` | `{{?directorLedger:reason}}` | 点号访问嵌套字段 |
| `{{?name:path\|默认值}}` | `{{?directorLedger:memory.location\|未知}}` | 路径不存在时返回默认值 |
| `{{?name:arr[0]}}` | `{{?directorHistory:0.speakers}}` | 数组下标 |
| `{{?name:arr[-1]}}` | `{{?directorHistory:[-1].reason}}` | 倒数索引 |
| `{{?name:arr[key=value]}}` | `{{?worldInfo:entries[active=true]}}` | 属性过滤 |
| `{{?name:path.$var}}` | `{{?directorLedger:scripts.$character}}` | 运行时变量 |

### 运行时变量

| 变量               | 值             |
| ---------------- | ------------- |
| `$character`     | 当前角色名         |
| `$speakerIndex`  | 发言顺序（1-based） |
| `$speakerIndex0` | 发言顺序（0-based） |
| `$speakerCount`  | 本轮总发言人数       |

---

## 许可证

见 `LICENSE`。
