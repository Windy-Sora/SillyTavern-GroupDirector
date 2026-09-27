# 暮羽配置领域契约

本目录管理可编辑配置的登记、选择性读取、纯预览与写入前条件。业务值仍存放于插件 settings；没有新增配置仓库，也不使用配置档导入作为通用写入器。

记忆参数收口：`memoryKeepRecent` 已开放，范围为全局设置，只有随后点击手动压缩或“撤销最近一次提取”按钮时才使用；后者实际按条数删除，并非按提取批次撤销。`memoryTokenBudget` 没有被记忆生成或注入运行时读取，经典界面标为暂未生效，暮羽不提供写入。`memoryMaxEntries` 使用专用流程：只在当前聊天内预览各角色预计裁剪条数，草稿不可混入其他字段；审批前复核聊天与记忆快照，先写全局设置，再裁剪当前聊天超额旧记忆。全局设置和聊天记忆属于两个保存域，回执分别报告，任一步失败或目标变化可能部分完成，不自动重试或回滚。配置档仍可能携带上限字段，但其应用路径不是暮羽的专用审批流程。

## 已支持字段

| 领域 | 字段 | 约束与影响 |
| --- | --- | --- |
| memory | memoryEnabled、autoMemoryEnabled、autoMemoryInterval、autoMemorySpeakers、memoryKeepRecent、memoryMaxEntries | interval 为新增消息条数；工具范围 1–200；keepRecent 工具范围 1–100，仅影响之后的手动压缩和按条数撤销；maxEntries 工具范围 10–2000，独立预览当前聊天裁剪；不开启隐含前置开关 |
| director | mode、topN、llmMaxSpeakers | mode 为 off/formula/llm；人数 1–20；生成/快捷任务进行中不写入 |
| scoring | scoreWeights.mention、keyword、recency、talkativeness | 实际使用完整 scoreWeights.* 路径；非负整数，talkativeness 至少 1；只修改选定叶字段 |
| prompt | llmPrompt | 原始文本，最多 4000 字符；空串使用插件默认 Prompt；不作为 JSON 解析 |
| provider | providerTimeoutMs | 非负安全整数，单位毫秒；0 不超时；保存入口同步后续渲染调用的默认值 |
| scoring | recentMessageCount、consecutivePenalty | 公式最近消息数支持 1–200；连续发言按每条消息扣分，0 为不扣分 |
| scoring | triggerEnabled、triggerScore、initiativeEnabled、initiativeBaseScore | 触发词来自角色资料；主动性为每轮随机加分，基础分不是每个角色的固定得分 |
| director | llmContextDepth、llmRespectOrder | 上下文条数支持 1–200，并被导演、记忆、NPC、强制发言共用；严格顺序会接管 LLM 模式的发言循环 |
| director | llmCharDescMode、llmCharDescLength | full/slice；切片长度支持 1–4000；角色档案启用时可能改用档案文本 |
| summary | summaryEnabled、autoSummaryEnabled、autoSummaryInterval、summaryReusePrevious、summaryPrompt | 总开关与自动开关独立；间隔按聊天消息条数，工具支持 1–200；接续开关也影响手动总结；Prompt 为原始文本，空串使用默认值 |
| critique | critiqueEnabled、autoCritiqueEnabled、autoCritiqueInterval、critiqueReusePrevious、critiquePrompt、critiqueSchema | 总开关与自动开关独立；间隔按聊天消息条数，工具支持 1–200；接续开关也影响手动点评；Prompt 为原始文本；critiqueSchema 实际是 JSON 输出示例而非标准 JSON Schema，空串使用内置示例 |
| profiles | profileEnabled、profileTokenBudget、profileConcurrency、profileGeneratorPrompt | 启用后已有档案可参与后续注入，不立即生成；预算为估算值，并发 0 表示不限；生成 Prompt 为原始文本，空串恢复内置值，支持角色字段与已注册 Provider 占位符 |
| npc | npcEnabled、npcMaxCount、npcBatchSize、npcGenerateFirstMes | 开关控制新生成；数量上限和每批目标数工具支持 1–200；首条消息只影响新 NPC |
| worldBook | worldBookSourceMode、worldBookMaxEntries | st 跟随 ST 激活书、manual 使用现有手动勾选；不会替用户勾选书。条目上限只作用于后续 worldBookImportance Provider 的结果，本工具支持 1–200 |

现有 46 个叶字段来自 43 个默认配置键。导演和公式规则定义集中于 `speaker-rules.js`，自动总结、自动点评、档案、NPC、世界书普通设置与记忆参数分别定义于 `summary-rules.js`、`critique-rules.js`、`profile-rules.js`、`npc-rules.js`、`world-book-rules.js`、`memory-rules.js`，复用原有注册表与保存端口。消息条数、描述长度、档案预算/并发数与 NPC 数量上限是本工具支持范围，不代表旧 UI 或运行时的强制上限。`coverage.js` 显式登记全部 108 个默认顶层键，以及 configProfiles/userProviders/userCapabilities/uiState 四个动态键。尚未接入的字段明确为 pending 或 special-editor-pending，不提供写入；未来字段的细粒度校验、生效时机和业务保存适配需在接入时确认。覆盖测试拒绝遗漏或重复的默认键，以及未登记的新评分权重。

## 运行接口

统一助手使用 `muyu.settings.catalog` 查询支持状态，`contract` 按领域取契约，`read` 按字段读取当前内存值，`preview` 提交闭合 changes。工具 wire 版本为 1，配置草稿契约版本为 2。字段多时仍按领域逐步提供契约，不发送整个 settings。

memory 沿用 memoryConfig 读取授权，其他第一批领域使用独立 configSettings 授权；旧的宽泛 diagnostics 授权不包含新 Prompt 内容。模型只能生成草稿，真实写入仍由用户在 UI 确认准确差异。未知工具默认拒绝。目录不读取宿主，读取器不访问密钥或未选字段，不调用 Provider render。

预览与实际写入只保留有效差异；草稿另存 requestedChanges，保留所有显式请求字段（包括已等于目标值的字段）及其校验依赖。记忆字段的依赖包括两个开关；公式规则校验当前模式，触发加分与主动性基础分还分别依赖对应开关；描述长度依赖 full/slice 模式；自动总结和自动点评的间隔各依赖其总开关及自动开关。模式或开关不适用时给出警告，不隐式切换。发布、重新校验和执行前均检查完整请求基线，因此旧 UI 的直接编辑也能产生冲突；无关编辑不会被覆盖。旧 v2 草稿缺少 requestedChanges 时沿用其已有差异契约。模型修订预览是替代候选，不隐式累加；失败的新候选不发布旧草稿。

自动总结只在符合条件的群聊轮次结束后判断阈值，滑动和重新生成不触发。首次开启时，若当前聊天已有足够消息，下一次合格轮次可能立即生成。调低间隔不清空该聊天的覆盖计数。总结生成或重新生成期间拒绝本通道的运行中配置写入；生成失败不会推进覆盖计数。总结内容与覆盖计数仍归属当前聊天，五项设置本身影响所有聊天；Prompt 只影响之后的新总结，重生成上一份时优先沿用该份记录的旧 Prompt。

自动点评同样只在符合条件的群聊轮次结束后判断阈值，滑动和重新生成不触发。首次开启时已有消息达到阈值，下一次合格轮次可能生成；调低间隔不重置覆盖计数。点评生成或重新生成期间，包括异步保存阶段，拒绝本通道的配置写入。点评内容与覆盖计数归属当前聊天，六项设置影响所有聊天；Prompt 只影响之后的新点评，重生成上一份时优先沿用该份记录的旧 Prompt。`critiqueSchema` 的非空新草稿必须是有界 JSON 输出示例，保留对象型的导演与角色点评结构；缺少默认细项时预览警告，不把示例当成严格结果验证器。空串恢复内置示例；更新影响之后的新生成和重新生成，不改写已有点评，经典界面原有自由输入不迁移。

角色档案设置开放四个全局叶字段：启用、注入预算、批量生成并发数和生成 Prompt。启用后已有就绪档案可能进入后续提示词，不因该设置写入立即生成；若用户另行开启档案库自动加载，下次启动或切换聊天可能加载档案。预算按字符估算 Token，渲染可能保留首份并压缩后续档案，不是严格上限。并发数 0 表示不限并发；工具支持预算 1–20000、并发 0–20。生成 Prompt 最多 4000 字符，空串恢复内置值；运行时先替换四个角色字段，再交给 renderPrompt 处理已注册 Provider 占位符，不能把其他占位符一律判错。只影响后续生成，不改写已有档案或档案 Schema 哈希。非启用状态调整参数会预警，但不隐式开启。直接单角色和批量生成到异步保存结束前，均拒绝本通道配置写入。档案 Schema、渲染模板与档案库仍走专用入口。

NPC 基础设置只修改四个全局叶字段，不读取或修改当前聊天的 NPC 列表。关闭开关会在业务生成入口阻止新任务，不取消已开始的生成，也不删除已有 NPC；开启不会自动生成。数量上限调低后若已有 NPC 达到或超过上限，新生成会被拒绝；每批目标数超过上限或剩余额度时按运行时规则收紧，模型也可能返回更少。工具仅支持 1–200，旧界面的 `parseInt(...) || 10` 不能可靠设置上限 0，因此本轮不开放 0。关闭状态调整参数、批量数大于上限分别预警，不隐式修改另一字段。生成到异步保存结束前拒绝本通道配置写入；NPC Prompt、列表编辑和角色卡导入仍走专用入口。

世界书普通设置只修改来源模式与重要条目数量上限，不读取世界书正文或手动勾选列表。切到 manual 时预览提示必须已有手动选书；本操作不会替用户勾选、刷新当前聊天世界书注入，或执行 Provider。最大条目数只限制 `worldBookImportance` 的后续结果，不限制其他世界书 Provider 的完整快照。应用后清除扫描缓存并同步经典设置控件，来源模式变化时刷新列表。手动勾选资源仍走原编辑入口。

当前同一草稿只跨越同一个 settings 保存域。运行中限制及属性可写性先检查，然后同步赋值并调用宿主保存入口。没有自动重试、全仓库回滚或跨域原子提交。保存异常、并发更新和持久化未确认如实写入回执。UI 只通知共享快捷操作刷新，不重建整个设置面板或覆盖编辑器草稿。

## 版本、历史与容量

旧 memory-config 草稿和无 version 字段的旧回执继续按原契约处理。新 settings-config 草稿使用 contractVersion=2，回执使用 version=2，保留完整差异。导入历史只恢复历史事实和读取依赖，不恢复操作批准。核对当前配置走只读工具，仅检查该回执字段需要的授权，不受其他回执已过期授权阻塞；异步核对绑定原回执与会话，不跟随当前选中会话变化。模型解释仍遵守历史资料授权。核对不重复应用，也不证明持久化。

Prompt 不截断保存。草稿内容限 24000 UTF-8 字节，另受公共 DTO 32768 字节限制；4000 字符以内仍可能因旧值、编码或组合字段而超预算，此时拒绝生成候选。单独操作记录分别检查边界，避免多条有效记录合并后误触单 DTO 上限。发送给模型的长回执值仅取标记清楚的 500 字符摘录，原始回执与草稿不修改。

## 扩展要求

新增领域应声明闭合字段 Schema、语义依赖、来源/读取授权、运行限制及保存端口，再扩展预览和回归测试。不可执行任意路径赋值。结构化资源、密钥和可执行代码仍需专用流程，不通过扩大这份叶字段白名单绕过注册、输入保护或执行审批。

分层参考了本地 DeepSeek harness 的 settings namespace/validate/applies/revision 和秘密字段投影思路；未引入其框架或复制实现。这里的并发检查依赖真实值，而不是仅供 Agent 自己递增的修订号。

验收入口：`tests/unit/muyu-settings.test.mjs`、`tests/unit/muyu-unified.test.mjs`，以及原有 config-apply/receipts/history/permissions 回归。真实浏览器验收仍需人工进行。
