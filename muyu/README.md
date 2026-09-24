# 暮羽内核：当前实现合同

2026-09-24。实验版已接入经典设置面板，默认未启用，新GUI不提供入口。独立连接采用非流式工具调用，DeepSeek思考默认开启；用户启用并逐次确认后才发送请求。没有新增运行依赖，不修改ST核心，不提供业务写入。模型协议此前经过仓库外DeepSeek harness验证，本轮经典UI尚未完成真实宿主/CORS验收。详见 [模型适配层](model/README.md)。

## 当前模块

验收补记（2026-09-24）：同步本地release后，用户确认实机运行成功、未发现问题；基本运行链路手动试用通过。下述浏览器布局与生命周期边界清单未获得逐项确认，仍待验收，不把一次试用等同于完整兼容性结论。

- core/json-contract.js：32KiB UTF-8、深度16、节点4096、数组1024上限的JSON复制与闭合Schema子集；不是完整JSON Schema。
- core/run-state.js：纯状态转换、目标绑定和恢复时中断投影。
- core/execution.js：可注入时钟的异步超时、取消桥接和安全错误。
- tools/registry.js：冻结元数据；tools/broker.js：每Run独立的只读、串行执行与去重。
- core/runtime.js：注入执行端口的工具循环；composition.js：显式组装具体Broker，不含宿主依赖。
- application/service.js：Session/Task管理、全局串行队列、聊天切换与快照订阅。
- workspace/store.js：有界内存产物及版本管理，不写入GD配置。
- host/bridge.js：官方getContext/CHAT_CHANGED适配，聊天归属与匿名统计只读端口。
- application/controller.js：独立连接、任务授权、两个模块组装、结果发布及面板生命周期外的输入草稿。
- ui/panel.js、../ui/sections/muyu.js：经典界面可收起入口、订阅式视图、固定记忆设置导航。

## 经典GUI使用与生命周期

1. 经典界面顶部打开“暮羽助手 · 实验版”→“连接与隐私”，填写完整 `/chat/completions` HTTPS地址、模型和密钥，启用连接。首版面板使用DeepSeek协议；不保证任意兼容服务支持思考。
2. 选择“排查记忆”或“配置草稿”，确认本次外发范围。草稿还须勾选允许修改的字段；此白名单不是语义意图证明，仍需人工核对差异。
3. 排查只读取白名单设置、消息数量及匿名角色记忆计数，不读取消息/记忆正文。手工输入的文字和当前会话历史仍会外发，请勿粘贴秘密。
4. 草稿只支持记忆四字段。返回差异与校验卡片，可选择已有草稿继续修改、重新校验；没有应用/保存到真实配置按钮。
5. 关闭入口只退订视图，不取消任务；重建面板/切换语言重挂视图，任务及输入留在控制器中。密码输入框在关闭/销毁/启用时清空。
6. 切聊天取消旧聊天任务，直到上游drained才允许新任务；新聊天未发送输入不被迟到结果覆盖。全局配置草稿会话不随聊天切换取消。
7. 更换连接取消并等待清理，清空会话和产物；禁用还清空输入。页面刷新后所有会话、草稿与密钥丢失。清理无法强制停止远端计算。

宿主标识为页面随机命名空间；聊天键组合群组ID/角色头像标识及chatId，仅用于本地归属，不传模型。不将其宣称为跨登录用户身份隔离，不持久化或跨标签共享会话。无法确认当前聊天时禁用聊天范围发送，全局草稿仍可用。

网络失败只报告网络/CORS可能性，不断言密钥无效；401/403才显示认证/权限拒绝。当前非流式，没有逐字输出和思考正文展示，不会为兼容自动关闭思考。

## 启动与模型端口

`startMuyuRun({identity,input,model,registry,handlers,allowedTools,policy,clock?,limits?,onEvent?})`
返回 `{completion,drained,cancel,snapshot}`。identity为可信应用生成的id/sessionId/taskId/target；input为用户文本。completion始终返回结构化运行结果（初始化参数错误同步抛出），包括state、answer、error、规范化messages和调用计数；失败/取消时answer=null。可选previousMessages仅接收user/assistant文本；taskContext携带原始goal/constraints，作为用户内容而非系统授权。

工具允许列表默认空，policy默认拒绝，只有同步严格true放行；异步policy不能授权，审批交互尚未实现。回调及handler均为受信任的内置代码，不是恶意JS沙箱。输出Schema用于限制公开数据，不能自动识别Schema允许的字符串中是否含秘密；接入实际模块前必须添加数据脱敏与外发策略。

model.run(request,{signal})须同步返回AsyncIterable，规范化事件仅支持：

```js
{type:'text_delta',text:'文字'}
{type:'tool_call_complete',call:{callId:'c1',toolId:'muyu.test.read',version:1,args:{n:1}}}
{type:'done'}
```

每步必须有且仅有末尾done，并正常结束迭代；仅done无文本/工具视为协议错误。整步收齐且验证后才执行工具。部分工具参数、供应商原始事件、reasoning、usage映射由未来模型适配器处理，不能直接交给当前循环。等待用户/审批请求明确返回UNSUPPORTED_CAPABILITY，不制造假等待状态。每步工具ID不可重复；跨步相同callId与同参数可复用结果，不重复执行；不同参数返回CALL_ID_CONFLICT。

规范化消息为user/content、assistant/content/toolCalls、tool/callId/result。每个已接收工具请求都得到对应结果；运行中断时补RUN_STOPPED结果，未执行工具标not_started，已经派发但无法确认的标unknown。终态历史不会自动送入新的运行；未来会话投影需要显式处理跨Run工具ID命名空间。

工具handler接收隔离的args和 `{runId,callId,target,signal}`，返回outputSchema对应的data（不是完整result envelope）。Broker封装 `{ok:true,data}` 或安全错误。只允许effect=read；其他副作用即使注册、授权也拒绝。没有自动重试，所有尝试含去重/失败均消耗工具预算。

## 事件、预算和终止

onEvent收到隔离副本：eventId/sessionId/taskId/runId/seq/type/at/payload。支持run.started、model.delta、tool.requested、tool.completed、tool.failed、run.finished；监听器异常不终止执行。tool.requested表示请求交给Broker，并不代表权限通过或handler已经启动，当前没有tool.started事件。

默认模型6次、工具16次、参数错误后最多2次修正机会、活跃总时限120秒；硬上限分别16/64/2/120秒。clock须提供now/setTimeout/clearTimeout，测试时钟完全手动推进。单工具按定义timeoutMs（最多15秒），同时受总Run取消约束。工具超时返回模型可读失败；总时限终止Run。启用真实连接后的请求可能计费，不把调用计数当Token用量。

取消前不启动工作；取消中不启动后续工具，迟到返回不可覆盖终态。非合作任务只能逻辑隔离，无法抢占同步CPU或撤销工具自身外部副作用。非合作迭代器的return()只尽力调用，不能保证已退出；Promise拒绝被收集以防未处理异常。异常正文、供应商错误、堆栈不发送给模型，仅公开有限错误码。

Run成功只表示循环正常结束，不是Task验收成功或工具全部成功。工具返回失败后模型可以解释失败并正常结束；应用层将Task置为awaiting_acceptance，只有显式completeTask才完成任务。

## 应用服务与工作区

`createApplication({startRun,currentTarget,maxQueue?,maxSessions?,maxTasks?,maxRuns?,workspaceOptions?})`由可信组合层注入运行工厂。默认最多8个排队运行、16个会话、128个任务、128个运行记录；达到上限明确拒绝，不静默裁剪。首版全部在内存，刷新丢失；关闭会话保留历史并占用容量。

- createSession(target)、submit(sessionId,goal,constraints?)、continueTask(taskId,input)、completeTask(taskId)、cancel(runId)、closeSession(sessionId)、changeTarget(target|null)。会话固定目标；分派时复核。切聊天取消旧聊天排队/执行中的运行，全局会话不受影响。
- snapshot()返回隔离副本；subscribe(listener)原子返回`{snapshot,cursor,unsubscribe}`，随后通知带递增cursor。通知用于重新读取快照，不是持久事件日志。退订不取消运行；dispose取消运行、清除订阅/产物并拒绝新命令，不保证强制终止不合作的上游。
- createArtifact({taskId,sourceRunId?,kind,content})、getArtifact(id,revision?)、updateArtifact(id,expectedRevision,content)、validateArtifact(id,expectedRevision,validation)、deleteArtifact(id)。kind支持report/config-draft；非空sourceRunId必须是同任务成功运行。关闭会话后可读、不可修改。
- 默认32个产物、每个16个版本、总JSON存储256KiB；单版本仍受32KiB JSON合同约束。修改追加revision并清空当前validation，旧版校验留在旧版；过期编辑/校验拒绝。validateArtifact仅记录可信校验器给出的结果，不代表已实现GD配置校验。删除释放容量。

全局同一时刻只持有一个运行槽；同Session不能重复启动。completion是逻辑终态，drained是已跟踪模型/工具及迭代器清理Promise全部settled。两者完成后才释放运行槽；缺少或拒绝drained会阻塞队列，不假装已清理。工具超时但仍未settle期间，后续工具返回UPSTREAM_PENDING，不启动另一个handler。

startRun必须同步返回上述句柄；同步抛错只能发生在启动外部工作之前。模型和handler必须用返回的Promise/迭代器覆盖整个资源生命周期，禁止脱离跟踪的后台工作。drained不证明远端服务停止计算，也无法发现适配器隐瞒的后台任务。会话续问仅重放用户和最终回答，不跨Run重放工具记录；不含摘要/检索/Token裁剪。

## 测试与剩余范围

```text
node --test tests/unit/muyu-*.test.mjs tests/contract/muyu-boundaries.test.mjs
npm run test:static
```

专项测试覆盖多工具闭环、默认拒绝/作用域/副作用、输入输出错误、去重、串行、Run隔离、取消竞争、总/单工具超时、迟到结果、预算、异常隐藏、依赖方向，以及应用队列、清理等待、聊天归属、订阅重建、任务续问与产物版本/容量。controller/panel测试进一步覆盖默认关闭、逐次授权、密码清理、DOM重建、文本安全显示和旧聊天迟到结果。fake model及fake clock位于tests/unit/helpers/muyu-subject.mjs，仅测试使用。gd-test已包含muyu模块导入冒烟及coverage路径；DOM替身不能验证布局、焦点与CORS，未声称已经测得全量覆盖率。

尚未实现：持久化、运行中用户等待/审批交互、上下文检索/压缩、真实写入、新GUI。经典GUI和只读宿主桥接已有代码，浏览器布局、真实ST交互与浏览器DeepSeek/CORS验收仍待完成；不将此前Node harness验证当作浏览器验收。
