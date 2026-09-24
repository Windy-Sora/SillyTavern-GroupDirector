# 暮羽 Agent 模块开发规范

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
