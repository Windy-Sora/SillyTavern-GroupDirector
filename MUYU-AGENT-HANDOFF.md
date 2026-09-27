# 暮羽 Agent 续做交接（2026-09-25）

下次开始先读本文，再读 [架构](MUYU-AGENT-ARCHITECTURE.md)、[配置契约](muyu/config/README.md) 与最新 [测试记录](TESTING.md)。本文记录当前工作树的事实，不代表已发布版本。插件主体已长期使用；当前主要工程是让暮羽在明确授权和人工确认下完成更多真实任务，而非重写插件核心。

## 当前能做什么

- 独立聊天框、侧栏历史、可选浏览器持久化、补充指令、运行预算、历史摘要、过程/用量展示；模型连接目前是非流式工具调用。授权与澄清可以在当前任务中续接，但任务不能跨刷新从检查点继续。
- 按来源申请资料读取；现有 11 类固定来源，包括消息、角色卡、档案、记忆、导演账本、变量和剧情蓝图。已注册的 Provider 可发现，并在按任务、ID、版本批准后调用原 `render`；长结果可在同一 Run 分页。未知工具默认拒绝，历史资料不会因导入记录而自动恢复授权。
- 查询配置目录、合同及获授权的当前内存值；提交局部配置预览，用户逐份确认后才由可信宿主端口保存，回执区分当时内存赋值与持久化确认。`memoryMaxEntries` 另有当前聊天裁剪影响预览和分步回执。模型没有任意 settings 路径写入工具。

## 配置接入进度

`muyu/config/coverage.js` 显式登记 108 个默认顶层键和 4 个动态资源入口。目前 46 个叶字段（涉及 43 个顶层键）已进入暮羽的选择性读取、预览、确认流程；另有 56 个顶层键待普通适配、9 个标为专用编辑待接入。这个目录只衡量**通用配置写入覆盖**，不等于 Agent 或插件整体完成百分比；暮羽自身部分设置已有独立 UI 端口。

已接入的重点：导演基础模式与选人参数、公式评分/触发/主动性、记忆常规参数及上限专用动作、自动总结与点评、角色档案基础参数及生成 Prompt、NPC 基础参数、世界书普通设置、若干 Prompt、点评 JSON 输出示例、Provider 默认超时。最近两批是 `critiqueSchema`（实际为 JSON 输出示例，不是标准 JSON Schema）和 `profileGeneratorPrompt`（角色字段先替换，再由 `renderPrompt` 解析已注册 Provider 占位符）。二者均保留空串恢复默认语义与经典编辑器的聚焦草稿。

尚未接入的重点：剧情蓝图和轮后反馈的配置、导演高级文本/模板、档案 `profileJsonSchema` 与 `profileRenderTemplate`、记忆高级文本、模型连接及密钥、库/配置档/用户 Provider 等结构化或可执行资产。已注册 Provider 的**运行**已完成，但“编写 → 隔离测试 → 审阅 → 确认导入”工作台尚未完成。真实聊天数据与资源的修改应走各自 Action Contract，不能扩张普通叶字段写入器。

## 本轮 bug 检查与验收

- 使用 bug-hunter 的只读、小范围顺序审计检查 `muyu/config` 的 10/10 个源码文件，并交叉阅读设置候选、UI 批准和宿主写入端口。**未确认运行时 bug**。详情在 [审计报告](.bug-hunter/audit-muyu-20260925/report.md)；这不是对整个暮羽的全面审计。
- 本轮相关测试 58/58 通过；随后重跑全量检查：1099 项，1098 通过、1 跳过、0 失败；静态检查与历史 BUG 契约 17/17 通过。最新字段没有新的真实浏览器或付费模型验收。
- 当前 Git 分支为 `feat/ui-navigation-preview`，审计时 HEAD 为 `100e151`。工作树已有大量未提交与未跟踪文件；它们是正在开发的工程状态，**不要整体重置、暂存、覆盖或视为本轮审计产生**。本轮未提交、未 push，也未同步 release。

## 下一块建议：档案 Schema

优先复核 `profileJsonSchema`，不要直接套用点评示例的校验。它会被 `JSON.parse` 后以 `strict: true` 传给模型，还参与档案 Schema 哈希；当前空串表示宿主调用不附加自定义结构化输出参数，但 UI 展示内置示例。先核对生成、解析、导入、版本哈希及旧档案行为，再定义暮羽草稿可接受的 Schema 子集和影响提示。保留“只预览 → 人工确认 → 应用回执”，生成及异步保存期间禁写，并保护经典编辑器草稿。之后再单独处理 `profileRenderTemplate`。

下一轮动手前建议先确认工作树差异和 release 当前版本，避免把尚未提交的其他模块改动误带入同步或提交。测试入口：`npm.cmd run test:full`；配置专项：`node --test tests/unit/muyu-settings.test.mjs tests/unit/muyu-config-prompt-editors.test.mjs tests/unit/profile-system-generation.test.mjs tests/unit/critique-system.test.mjs`。
