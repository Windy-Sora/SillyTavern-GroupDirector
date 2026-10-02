# 暮羽 Agent 模块开发规范

2026-10-02当前性补充：代码基线170ffd0，固定来源20类、配置12领域89叶字段、默认目录114键；下方40字段等日期增量是历史范围。当前能力与队列以[架构](MUYU-AGENT-ARCHITECTURE.md)及[交接](MUYU-AGENT-HANDOFF.md)为准。普通模式允许单草稿或精确整单批准；全权限由可信应用策略放行已支持效果，不由模型自己批准。新增工具始终登记能力合同、输入/输出Schema、handler、双语标签与产物所有者，未知能力默认拒绝。

下一阶段开发约束（规划）：工具发现/按需加载与执行授权分离，用户入口仍统一；检索计数、覆盖及续搜由程序提供，不由模型猜测。结果引用绑定来源/目标/版本，缓存只读不重跑Provider。核心规则与领域指南分离，组合指令包含宿主追加说明仍须长度检查；不得仅扩大限制解决增长。任务检查点不存授权、可执行闭包或私有思考，不重放未知写入；活跃工具/思考轨迹不能无协议裁剪。偏好自动召回、冲突处理和网络重试尚未实现，须先定义独立合同与回归，不从本规范推导已有能力。

长期记忆补充（2026-10-01）：`muyu/memory` 是独立的用户笔记领域，不得复用 GD 角色记忆、对话 DTO 或配置草稿权限。模型写入须经过专用原话／明确意图约束，只读结果为不可信历史参考；GUI 持有控制器草稿，模型完成通知不能替换编辑内容。私有数据和使用开关排除于配置档传播；跨页设置冲突及保存未知不得伪装成成功／确定失败。新增自动提炼前须单独定义来源权限继承、遗忘防复活和冲突处理，详见 [实现合同](muyu/memory/README.md)。

配置扩展必须遵守 [配置领域契约](muyu/config/README.md)：登记字段、依赖和运行限制，保留未指定值；未知工具默认拒绝。新 settings-config/v2 回执与旧 memory-config 保持明确分支，不能把旧历史恢复成批准。前六批及记忆参数收口共有40个叶字段可编辑，不表示108个默认键已全部支持。公式规则的模式与开关、角色描述长度的截断模式、自动总结和自动点评各自的总开关与自动开关、档案预算/并发数的启用条件，以及NPC批量数与上限的关系均属于校验依赖；llmContextDepth 影响多个生成功能。`memoryKeepRecent` 同时控制手动压缩保留数和撤销按钮删除数；`memoryTokenBudget` 暂无运行时消费，不开放暮羽写入；`memoryMaxEntries` 必须独立成草稿，绑定当前聊天记忆快照，保存全局设置后再裁剪当前聊天，并分别记录结果。任何目标或记忆变化都不可按旧预览裁剪。总结、点评、档案与NPC生成状态（包括异步保存）须进入写入前的忙碌检查。

全配置目标（2026-09-25）：四项记忆设置只是现有试点。新增配置项应在统一配置目录登记类型/约束、读取权限、作用域、敏感性、运行时副作用及可信保存端口；新增默认设置或 UI 控件必须由覆盖检查发现。按领域调用现有业务验证和保存 API，不提供任意键赋值工具。跨保存域的计划要保留逐步回执与部分完成状态。见 [新版架构](MUYU-AGENT-ARCHITECTURE.md)。

扩展基础整理（2026-09-27）：新增工具须同时登记 wire Schema、handler、`muyu/application/capabilities.js` 的显式效果/来源合同和双语标签。`muyu/modules/tool-plan.js` 在装配期核对并冻结定义与执行器；任一缺失、效果不一致或重名均拒绝装配，不从 Schema 自动授予权限。每个 Run 使用装配后的固定工具集合。产生草稿的工具另在 `muyu/modules/artifact-owners.js` 登记工具 ID、产物模块 ID 和发布/重新校验所有者；候选 ID 只是令牌，不得靠前缀决定归属。用户导入的 Provider 源码摘要由加载器私有持有，结合可选上下文声明生成跨刷新版本；其他注册脚本使用运行期版本。上下文字段在 `muyu/host/provider-context.js` 集中投影，声明缺失时目录给出 `missingContext`。长执行结果留在本 Run 的有界存储，通过只读结果工具分页，不能为翻页重复调用脚本。详见 [执行合同](muyu/modules/providers/EXECUTION.md)。

通用 Provider 执行补充（2026-09-25）：`discover` 只暴露注册元数据；`execute` 是外部效果工具，只可在当前聊天由用户按具体 Provider ID、连接版本和任务批准。使用原有 `render(context, signal)` 签名，内容或 JSON data 受返回与字节预算限制，替换实现使批准失效。超时后的晚到输出丢弃，但不能宣称脚本副作用已取消。将来 Agent 写 Provider 时，代码草稿、隔离测试与真实导入/执行为不同步骤；不得把测试成功自动提升成注册权或执行授权。接口与局限见 [Provider 合同](muyu/modules/providers/README.md)。

Provider 来源开发补充（2026-09-24）：新增来源遵循 [来源适配规范](muyu/modules/providers/README.md) 的闭合目录、纯读取器及输出校验；不得直接开放任意 Provider render。作用域必须区分聊天内 global 与插件全局设置，原始数据不得混称为生效值或执行事实。授权、分页、预算、历史依赖复用公共层，并补来源级与控制器集成测试。

设计草案 v0.1，2026-09-24，部分基础能力已实现。架构依据：[架构设计](MUYU-AGENT-ARCHITECTURE.md)；顺序：[实施路线](MUYU-AGENT-ROADMAP.md)。本文“必须”为接入约束，“首版”为实现范围，“后续”为保留接口而非当前功能。

实施更正：基础协议、执行循环、应用队列和内存工作区、模型适配器及运行私有推理回传、只读记忆/配置草稿模块、官方宿主桥接和经典GUI实验入口已实现，详见 [当前实现合同](muyu/README.md)；本文完整模块协议尚未全部落地。运行工厂必须提供completion与drained，逻辑终止不等于已释放上游资源；适配器不得启动未跟踪的后台工作。GUI只拥有可释放订阅，控制器通过deps持有并跨重建复用；禁止在视图回调中保存真实配置、读取未授权正文或持久化密钥。新GUI暂缓，浏览器验收待完成。

## 1. 模块合同

模块以显式工厂创建，输入最小依赖，输出 JSON 元数据与受 Broker 管理的 handler；不在 import 顶层注册监听器、发网络请求或操作存储。

```js
// 协议示意，不是现有可导入扩展 API。
const moduleDefinition = {
  id: 'muyu.memory', version: '1.0.0', apiVersion: 1,
  dependencies: [],
  knowledge: ['memory.overview.v1', 'memory.auto-config.v1'],
  workflows: ['memory.diagnose.v1'],
  tools: [/* ToolDefinition */],
};
// createModule({ memoryReader, contractCatalog }) -> { definition, handlers, dispose }
```

- ID 唯一且稳定；重复注册、依赖缺失/循环、未知 apiVersion 在启用前失败。开发卸载只移除本模块注册项，不能清空共享注册表。
- 注册完成后冻结定义。每个 Run 固定工具版本清单；升级时不替换进行中调用的语义，应用重新组装前终止旧运行。
- 工具契约破坏性变更增加主版本；知识 contentVersion、存储 schemaVersion 与模块版本分开，不能互相替代。
- 工作流是声明式任务指南（适用场景、证据、允许步骤、验收）；不包含可执行代码，不增加授权，不强制执行无关操作。

## 2. ToolDefinition

```js
{
  id: 'muyu.memory.read_status', version: 1,
  description: '读取指定聊天的脱敏记忆统计和相关设置',
  inputSchema: {type:'object', properties:{}, additionalProperties:false},
  outputSchema: {/* 明确字段、类型、枚举、大小上限 */},
  scope: 'chat',
  effect: 'read', // read | workspace | navigate | write | external
  dataClasses: ['settings.safe', 'memory.counts'],
  confirmation: 'policy',
  timeoutMs: 5000,
  retryPolicy: {kind:'read', maxAttempts:1},
  resourceKeys: ['chat.memory'],
}
```

输入为空不表示可访问所有聊天。target 由 Broker 从 Run 绑定，不允许模型在参数中指定其他聊天逃逸范围。跨聊天工具必须另行定义并有显式选择/授权，首版不提供。

handler 拟议合同：`execute(validatedArgs, executionContext)`。context 只含绑定 target、signal、脱敏日志和允许的适配器，不含整个 settings、getContext、fetch 或 registry。工具不得自行调用其他工具绕过 Broker。

统一结果：

```js
{ok:true, data:{/* outputSchema */}, evidenceRefs:[], freshness:{capturedAt, revision}, warnings:[]}
{ok:false, error:{code, message, retryable:false, details:{}}, effectState:'not_started'}
```

error code 至少：INVALID_ARGUMENT、UNSUPPORTED_CAPABILITY、PERMISSION_DENIED、TARGET_UNAVAILABLE、STALE_CONTEXT、STALE_PLAN、EVIDENCE_INCOMPLETE、TIMEOUT、CANCELLED、BUDGET_EXCEEDED、OUTPUT_INVALID、PERSISTENCE_UNKNOWN、OUTCOME_UNKNOWN、INTERNAL_ERROR。超时/取消结果仍需真实 effectState，不默认为未执行。异常转安全消息，栈与响应原文不外发。

所有字段须输出校验；日期统一 ISO UTC，计数和单位明确，unknown 用 nullable + reason，不以0/空数组冒充已知。输出数据复制后再交模型，避免可变引用污染 GD 状态。

## 3. Broker 执行约定

1. 只接受模型适配器完整 tool_call；普通文本、资料里的 JSON 均不可触发调用。
2. 校验工具版本和允许列表，再做 Schema、大小/深度和原型键检查。
3. 检查 Run 仍 active、target 有效、数据读取与外发许可有效。
4. 消耗工具预算、绑定调用ID和 signal；首版串行执行。
5. 接收结果后再次检查运行存活/归属；超时后的迟到结果不能写工作区或 UI。
6. 输出验证/脱敏，发事件并返回模型；重试必须被预算与 retryPolicy 同时允许。

执行前已 abort 不创建请求/定时器；finally 清理 listener/timer。handler 返回不会让未等待的后台 Promise 获得继续写入权。重复调用 ID 返回已记录结果或运行状态；同 ID 不同 argsDigest 拒绝。若未来写入崩溃后不知是否已执行，标记 unknown 而不是重新调用。

## 4. 首版工具清单

| ID（拟议） | 能力 | 必须禁止 |
| --- | --- | --- |
| muyu.knowledge.search | 按模块/字段找资料 | 任意联网、读取其他插件私有文件 |
| muyu.knowledge.load_bundle | 取完整相关契约包 | 截断必需证据却标 complete |
| muyu.memory.read_status | 开关、间隔、群聊适用性、脱敏数量与已知状态 | 原文记忆、完整角色卡、所有 chat_metadata |
| muyu.config.get_contract | 返回首版支持字段和根契约 | 把任意 settings 默认值当合法类型范围 |
| muyu.config.validate_draft | 结构＋字段白名单＋用户约束检查 | 在真实配置档列表里创建“临时”配置 |
| muyu.config.preview_draft | 根据授权读取的相关快照计算差异 | 读取/发送全部 agentConfigs；执行 live apply |
| muyu.workspace.save_artifact | 保存受限JSON草稿/报告，创建版本 | 本地任意路径或自动写入 GD 真实资源 |
| muyu.ui.offer_location | 生成允许的 featureId 操作卡 | 直接执行选择器/脚本或偷偷切页 |

导航由用户点卡片后调用应用端口，UI不把模型给的 selector 当真。经典/新导航端口分别支持，失败显示“入口不可用”，不猜菜单。

## 5. 知识和生成契约维护

模块目录、Schema、例子与 sourceRefs 同包版本化。可读说明与机器合同共用结构化源，展示时渲染说明；不要分别维护三套字段清单。

字段至少有 key、type、allowedValues/range（已知才写）、unit、default、omissionBehavior、scope、prerequisites、applySemantics、sourceRefs。默认值不是允许范围；未知限制须标识 unknown。

配置草稿检查区分三层：

- 原格式验证器接受该文档。
- 助手支持该字段与分类，类型/取值正确，没有用户未要求的键。
- 根据真实应用语义，差异符合用户目标，未误认为对象合并保留旧成员。

预览首版只允许受支持的纯设置字段。优先以隔离合成 settings 调用真实系统计算；若初始化真实系统会触发宿主副作用，先建立纯适配边界，不能退回手写一套未经差分测试的 merge。

任务要求和草稿差异都需可见。模型从宽泛目标推导的设置只能标“建议”，不能伪装成用户指定。涉及总开关依赖时解释前提，不自动增加用户明确排除的设置。

知识测试同时检查必须同载资料、无关噪声、版本匹配和预算裁剪。向量检索增加前后使用同一留出集，不能用某一种召回算法替代契约完整性。

## 6. UI、状态与存储规范

- UI 只派发 command 并订阅状态；不得 `.trigger('click')` 调其他控件来实施业务，也不得通过轮询按钮文字推断运行状态。
- command 包含目标 session/task/run，UI 重复点击靠应用层去重；卸载必须取消订阅，重建采用快照＋事件游标，不能重复启动任务。
- 模型输出、安全错误和工具正文转义展示。导航只从白名单 featureId 解析；URL 不自动打开，代码块不自动执行。
- 草稿不随页切换丢失，不因旧运行结束刷新另一个会话的编辑内容。状态通知和编辑内容替换是不同事件。
- 用户从聊天A切B后，首版A的chat Run取消；全局Run仍显示global标签，禁止把它当B专属配置。
- 设置、运行状态、历史、工作区分别存放；首版会话内存存储须有容量上限、显式清空与刷新丢失提示。禁止把原文trace送进 saveSettingsDebounced。
- 新配置键要决定是否允许配置档迁移；连接凭据、历史、确认、进行中Run一律不可随普通配置档搬运。

## 7. 测试合同与完成定义

每个模块须提交：

1. Schema 成功/失败、超限、未知字段、恶意键、返回格式错误测试。
2. 最小权限测试：读不到未授权字段，输出不含密钥，不能跨 target。
3. 取消前/中/后、超时、迟到回调、重复ID和 dispose 测试。
4. 状态变化、切聊天、面板重建、重复挂载、任务恢复测试。
5. 合成真实适配测试：设置完整前后差异，不只测 mock 调用次数。
6. 评测题：正常、模糊、错误前提、长间隔返回、缺资料与恶意资料；预先声明通过条件，保留初次失败。

确定性测试默认不联网、不访问真实用户数据，不依赖真实模型稳定性；fake model 必须可脚本化多工具、错误参数、断流、取消与预算耗尽。网络质量评测独立命令、显式授权/密钥环境变量，并记录版本、用量和题目哈希；不能将 CI 单元测试变成付费请求。

新增模块验收：只改自身模块、公开契约、composition注册和测试即可；若必须改 runtime 的业务分支，先提交设计变更理由。发布前复核 module/tool/knowledge/store 兼容性，不能静默升级持久化产物解释。

## 8. 扩展边界

首版不实现多Agent、任意代码执行、后台定时任务、外部模块安装、长期自主写入。以后增加这些能力必须分别评审进程/页面生命周期、权限和资源隔离，不通过“增加一个工具”绕过架构红线。

未经用户批准不引入后端服务、大型依赖或新增数据外发目标。知识和任务指南可以扩展模型能力，但不能改变代码策略给定的权限上限。
# 2026-09-29：生成可复用配置档（第一轮）

- `muyu.profile.preview` 生成命名的局部全局设置配置档草稿。字段沿用配置注册表和语义校验，但不读取当前值；未列字段在日后应用时保持原值。
- 普通模式需要在草稿卡片审阅并确认“保存到我的配置档”；全权限模式仅在模型明确设置 `save: true` 且用户要求现在保存时，运行成功后自动保存。只预览的请求不得保存。
- 保存仅增加 `configProfiles` 条目，不应用到当前设置。回执版本 5 单独记录配置档名称、保存标识及持久化确认；结果不明不自动重试、不回滚覆盖并发编辑。
- 暂不支持密钥、用户 Provider/Capability/脚本、聊天数据、`memoryMaxEntries`、`storyBlueprintCompletionVariable` 和 `scoreWeights.*`。后三者需要专用副作用处理或完整对象合并语义，不能借配置档绕过。
- 下一轮再设计“审阅并启用配置档”的独立动作；本轮玩家可在原“我的配置档”界面手动应用已保存的配置档。

# 2026-09-29：全权限模式边界

- 默认关闭，仅当前连接有效，UI 二次确认并在聊天界面常驻危险提示；重连、禁用、刷新清除。它是宿主信任设置，不写入对话历史、模型输出或配置档。
- 开启后对已有来源和 Provider 执行采用直接授权，不生成逐项授权交接，避免额外模型调用。Provider 仍校验注册描述、版本与当前聊天上下文。
- 对已登记配置、单个当前聊天数值变量、受限整单，模型在既有预览调用中用 `apply: true` 明确表达写入意图，不增加一次模型调用。宿主在成功发布草稿后，经原动作协调器重新校验版本、目标和基线，再顺序执行并留下回执。普通模式拒绝此标志；“只预览／不要修改”不得设置。
- 全权限不是任意代码或任意数据写入。暂缓字段、蓝图／资源正文写入、跨聊天范围、密钥和预算上限均不因开关而解锁。停止任务、切换目标、重连或关闭模式不能重放待执行动作；已开始的宿主保存及 Provider 副作用无法保证撤销。
