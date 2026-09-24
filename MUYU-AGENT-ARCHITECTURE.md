# 暮羽 Agent 架构设计

状态：设计草案 v0.1，待评审；2026-09-24。本文所有 `muyu.*` 接口、目录和设置名均为拟议协议，不是已经实现的 API。

实施更新：已实现独立基础协议、只读工具循环、应用队列、内存会话及版本化工作区、非流式模型适配器（含DeepSeek思考回传），以及只读记忆排查与记忆配置草稿试点。现已增加官方宿主桥接、应用控制器和经典GUI实验入口；真实模型此前已在仓库外Node harness验证，浏览器宿主/CORS验收待完成。精确范围见 [muyu/README.md](muyu/README.md)。新GUI暂缓，无真实写入。下文未被实施说明确认的能力仍为设计，不是当前可用API。

配套：[模块开发规范](MUYU-AGENT-DEVELOPMENT.md)、[实施路线与验收](MUYU-AGENT-ROADMAP.md)。

## 1. 定位与不变量

暮羽是面向 SillyTavern / Group Director 的受限任务 Agent。问答只是一种任务；核心是取证、工具调用、草稿与可验证结果。聊天框是客户端，不是状态所有者。

必须遵守：

- 不修改 ST 核心；宿主接入只走已确认的 Extension API/支持接口。现有导入不是新能力必然受支持的证明，新增宿主接入须独立核验。
- 所有用户配置放在插件设置；不将连接密钥复制到模型上下文、知识、产物或日志。
- 模型提出工具请求，程序决定授权、参数合法性和是否执行；模型不能授予权限或自行标记操作成功。
- 模型、知识与工具返回正文都不是可执行指令；严禁任意 JS、shell、任意 URL 请求或文件系统访问工具。
- GD 业务系统拥有真实数据与写入契约；Agent 不复制一套保存、导入、回滚实现。
- 运行绑定启动时的目标，不根据当前 UI 页面重新解释旧运行归属。
- 取消不等于回滚；超时不等于服务端未执行；持久化未知不得报告“已保存”。
- 本轮只设计，不改变已发布世界书版暮羽；两者可并存，默认不互相导入历史或注入知识。

## 2. 现有实现复核与复用决定

以下来自当前工作树源码，不是宿主兼容性认证。

| 现有模块 | 已确认行为 | 设计决定 |
| --- | --- | --- |
| [systems/agent-runtime.js](systems/agent-runtime.js) | AgentRegistry、固定 pipelineOrder、managedCall、超时、进程内 trace；execute 顺序执行阶段 | 保留原用途；不把 Director/Custom Agent 改成暮羽循环。超时模式可参考，需独立运行测试；不直接沿用默认重试策略 |
| [utils/custom-api.js](utils/custom-api.js) | generate(prompt) 返回文本；独立请求支持 signal；native caller 标记 supportsAbort=false，不用全局停止中断它 | 现有文本 caller 只作降级适配；新增工具协议适配器，不改变旧 caller 合同。不能声称现有接口已支持流式 tools |
| [systems/execution-snapshot.js](systems/execution-snapshot.js) | 对象身份、序列化值和资源快照检查 | 可在单次浏览器生命周期内适配；不是可持久化 chatId，也不是跨标签页事务锁 |
| [systems/memory-system.js](systems/memory-system.js) | getStats/listMemories 等读取与生成、修改接口 | 首版只包装统计和白名单设置；不把整个系统或返回的可变引用交给工具 |
| [systems/config-profile-validation.js](systems/config-profile-validation.js) | 根格式及部分字段校验；drawers 仅要求布尔值；导入剥离 agentConfigs 等 | 复用结构校验，新增助手生成契约白名单和语义检查，不能把原验证成功当成准确方案 |
| [systems/config-profile-system.js](systems/config-profile-system.js) | getDrawerKeys；普通键逐项应用；对象基于默认值重建；变量有额外条件；实际导入会保存配置档 | 实际写入继续调用原系统；首版预览不能为校验而调用 live import/apply。用隔离合成实例验证支持的字段范围 |
| [systems/chat-metadata-save-confirmation.js](systems/chat-metadata-save-confirmation.js) | 读取原聊天头确认保存，区分读回失败的 persistenceUnknown | 后续写工具遵循同类结果语义；不是可无条件套给全局设置的通用保存器 |
| [ui/quick-actions.js](ui/quick-actions.js) | UI 无关订阅状态、共享 pending、作用域校验，可跨面板重建 | 借鉴订阅/清理模式；不是暮羽运行队列。不得通过它偷渡生成等副作用 |
| [ui/settings-init.js](ui/settings-init.js)、[ui/navigation-model.js](ui/navigation-model.js) | reload 重建 DOM，导航有独立 featureId；属于未发布 UI 开发分支 | 界面适配独立；先实现经典界面端口，新导航暂缓，内核不 import UI |
| [tests/harness](tests/harness)、[TESTING.md](TESTING.md) | fake host、事件、场景、属性测试和 gd-test 分层 | 复用测试设施；新增脚本化模型，不默认联网。已有外部暮羽评测只作可选质量评测 |

决策：新增 `muyu/` 边界，不重命名既有 AgentRegistry，不让双方自动发现对方的工具。共享连接配置也不意味着共享运行状态、Prompt 或授权。

## 3. 分层与依赖

```text
聊天面板 / 任务列表 / 页面快捷入口
                 │ Commands / snapshot + events
                 ▼
        Application Service（组装、会话、任务）
                 │
        Agent Runtime（纯状态机与循环）
          ├─ Model Port
          ├─ Context / Knowledge Port
          ├─ Policy + Tool Broker
          └─ Workspace / Store Port
                         │
               内置能力模块的 GD Adapter
                         │
                  已有 GD / 宿主接口
```

- core 只能依赖协议与纯工具函数，不依赖 DOM、jQuery、ST imports、全局 settings 或业务模块。
- composition root 显式注入端口与模块。模块不能反向访问应用根对象，不共享可变全局依赖包。
- 模块之间通过公开工具/产物协议协作，不访问彼此内部对象；依赖图加载前查环。
- 首版单模型、单 Agent、串行工具调度；同一 Session 最多一个活跃 Run，全应用最多一个主动运行，其余有界排队。后续并行须声明资源冲突和有界执行，不先实现调度集群。

拟议目录，按阶段创建，禁止一次性生成空壳：

```text
muyu/
  composition.js
  core/          contracts.js runtime.js reducer.js errors.js
  application/   service.js sessions.js tasks.js
  model/         adapter.js text-fallback.js
  context/       assembler.js budget.js
  knowledge/     catalog.js retriever.js bundles.js
  tools/         registry.js broker.js policy.js
  workspace/     artifacts.js store.js
  adapters/      host.js settings.js navigation.js
  modules/       memory/ config-profile/
  ui/            panel.js presentation.js
tests/unit/muyu-*.test.mjs
tests/integration/muyu-*.test.mjs
tests/contract/muyu-*.test.mjs
```

## 4. 领域对象与数据归属

所有持久化/跨端口对象为 JSON DTO，含 schemaVersion；禁止函数、DOM、Error 原对象、宿主对象引用。内部 AbortController 单独管理，不序列化。

| 对象 | 关键字段 | 生命周期与权限 |
| --- | --- | --- |
| Session | id、scope、messages、revision | scope 为 global 或指定 chat；聊天不同默认新建会话，不自动搬历史 |
| Task | id、sessionId、goal、constraints、acceptance、status | 保留用户目标和拒绝事项；摘要不能覆盖原始约束或制造授权 |
| Run | id、taskId、target、status、capabilities、budget、startedAt | 一次执行固定目标和允许能力；切聊天不重绑定 |
| ToolCall | id、runId、toolId/version、argsDigest、status、result | 以 (runId, callId) 去重，重复 ID 且参数不同视为协议错误 |
| Artifact | id、revision、kind/schemaVersion、content、target、sourceRefs、validation | 草稿/报告/配置包；新修改创建新 revision，旧确认失效 |
| Snapshot | id、targetKey、resourceVersion/hash、capturedAt、redactedData | 环境证据可过期；不是权限令牌；不将敏感原值哈希当脱敏替代 |
| Confirmation | id、runId、artifactRevision、argsDigest、target、expectedVersion、expiresAt、consumed | 后续写能力才实现，不能由模型创建“已批准”状态 |

targetKey 由宿主适配器产生，至少区分用户命名空间、单聊/群聊与实际聊天标识。无稳定聊天标识时仅允许全局只读/草稿，不借数组下标作为长期标识。对象身份只作本页运行的辅助防陈旧检查。

## 5. 运行状态机与事件

```text
queued → running ⇄ awaiting_input / awaiting_approval
             ├→ succeeded
             ├→ failed
             ├→ cancelling → cancelled
             └→ interrupted（刷新、进程退出或无法恢复）
```

- queued 也可取消。终态不可继续接收 delta 或执行新工具；用户继续会创建新 Run。
- awaiting_input 由结构化补充信息请求产生；awaiting_approval 只能由 Policy/Broker 发起。用户回复校验并关联原 task，不从任意聊天的“可以”提取授权。
- “success”表示本次运行完成，而非内容必然事实正确。Task 验收由程序检查必需产物/校验结果；若需要用户判断，保持待验收，不由模型关闭。
- 有工具执行结果不明时返回 `OUTCOME_UNKNOWN`，运行 failed 或 interrupted，记录不确定副作用；不得标记为普通 cancelled 然后自动重试。
- 首版切换聊天时，聊天范围的 Run 取消并清除未用确认；全局只读 Run 可继续。已生成草稿仍归原会话。取消不了的上游响应只丢弃，不写入新聊天。
- 面板卸载只解绑 UI 订阅，任务继续；应用 dispose 则取消、清理定时器/订阅。重建先取当前快照再订阅，避免漏终态。

事件统一为 `{eventId, sessionId, taskId, runId, seq, type, at, payload}`。seq 在 Run 内递增，UI 去重；业务侧只有 reducer/broker 可发出执行终态，模块仅报告结果和有界进度。

首版事件：run.started、model.delta、tool.requested、tool.started、tool.completed、tool.failed、artifact.updated、input.required、run.finished。后续加入 approval.required/resolved。不做完整事件溯源：权威状态是 reducer 快照，事件用于订阅与审计；断线/重建重新取快照。

## 6. 模型端口与上下文

拟议 `ModelAdapter.run(request, {signal}) -> AsyncIterable<ModelEvent>`：request 含规范化 messages、tools、generationOptions；事件限定为 text_delta、tool_call_delta、tool_call_complete、usage、done、error。非流式适配器也可产生同一事件序列。

- 工具参数完整收到且 Schema 通过后才能执行，绝不根据流式半截 JSON 产生动作。
- 保留 toolCallId 和结果关联；一轮多个请求首版串行处理，不静默漏掉后续请求。
- capabilities 显式声明 tools/streaming/requestAbort/usage；缺 tools 降为问答，绝不从普通文本/代码块解析可执行操作。声明需要适配测试验证，不仅靠服务名推断。
- 不展示/记录供应商内部 reasoning 字段作为工具结果或用户正文。usage 不可得时标记 unknown，不填0。
- 不复用宿主全局 stop 停止暮羽；native 无请求级取消时采用逻辑取消、禁止超时重试及并发重入。
- 端点由用户配置的连接决定，模型不能提供 URL 或切换凭据。沿用连接配置边界但新增适配层；支持的协议、路径和宿主版本在实施时验证，不在本文假定任意兼容端点都支持 tools。

上下文组装顺序：系统策略 → 当前任务与原始硬约束 → 完整工具协议 → 所需契约包 → 脱敏状态快照 → 相关历史/摘要 → 用户消息。按角色分隔非可信材料，不把检索正文拼成系统授权。

历史摘要包含 sourceMessageIds 和 revision，仅帮助理解，不替代原始许可、接口契约、实时状态。资料不够则发起检索/精准补问，模型不自行把历史猜测升级成事实。

## 7. 知识与契约包

Knowledge Port 提供 search(query, filters) 与 loadBundle(ids, purpose, budget)。返回 `{id,moduleId,version,sourceRefs,content,requiredDependencies,completeness,omitted}`；未知状态显式表达，不伪装成“已经完整”。

首版模块目录、字段精确索引和全文匹配；不引入向量数据库依赖。向量检索以后替换候选召回层，不改变 bundle、权限、版本或校验协议。

配置包的原子证据至少包括根格式、目标字段类型/单位、缺省及应用范围；预算不足时先减少不相关历史，再请求更小任务或返回 evidence_incomplete。不得裁掉必需字段后继续生成。

代码契约维护为版本化清单，并与 DEFAULT_SETTINGS、getDrawerKeys、实际应用测试比对；不能从默认值推导完整允许范围。人工说明与结构化契约关联，但不是从世界书全文运行时“猜 Schema”。世界书作为素材，不作为唯一权威版本。

## 8. Tool Broker 与安全策略

工具定义包含稳定 namespace ID、契约版本、输入/输出 Schema、scope、effect、dataClasses、confirmation、timeout、retryPolicy、resourceKeys。详见开发规范。

调用顺序固定：工具允许列表 → 参数验证 → 目标绑定 → 数据授权 → 前置状态 → 执行 → 输出验证/脱敏 → 结果记录。不可因“只读”自动允许外发隐私。

权限分开表达：读取本地状态、将指定数据发送给当前模型连接、修改真实数据、发起额外外部请求。首版仅允许内置工具，用户启用时明确告知模型将接收哪些白名单字段；聊天正文、记忆原文和角色私密资料默认不读取，需要独立范围授权，首版不实现。

浏览器扩展同页面运行，模块限制是能力边界而非恶意 JS 沙箱；不加载不可信可执行模块。Schema 使用有界 JSON 子集，限制大小/深度/数组长度，禁止原型污染键与引用逃逸；工具结果也做同样处理。

生成内容和工具返回以转义文本/受限 Markdown 展示；不执行 HTML/脚本，不自动访问链接。提示注入测试须覆盖用户上传资料、世界书文本、错误日志和模型伪造“已确认”。

首版建议预算：最多6次模型调用、16次工具调用、2次参数修正、120秒活跃时间；单工具默认15秒且服从剩余总时限，模块可声明更短。输出大小单工具32KiB、产物256KiB，超限返回结构化错误。初始值可配置但有硬上限；Token预算按连接能力估算并明确估算状态。预算结束保存已有草稿、说明未完成，不循环到“满意”为止。

等待用户期间暂停活跃时间计费，但取消仍即时可用；等待超过30分钟转 interrupted。未来确认默认10分钟失效，继续时重新校验范围、权限和资源版本。只读工具可有限重试，模型请求重试也占总预算；写操作不得套通用重试。

## 9. 工作区、存储与后续写入

首版 Workspace 存在内存中，面板重建不丢、页面刷新会丢；UI 明示这一点，允许用户导出选定草稿。配置（连接引用、预算、权限偏好）放插件设置的拟议 muyu 分组；默认关闭助手，不复用开发 harness 的密钥。

会话持久化作为独立阶段，先实现 Store Port 和 MemoryStore。后续持久化后端须确认官方宿主存储接口或经批准的浏览器本地方案、用户隔离、容量和迁移；没有确认前不伪造宿主文件写 API。不得把长对话塞进每次全局 settings 保存。暮羽会话/产物默认不随配置档导出；接入新配置键时显式更新覆盖/排除测试，不携带运行许可与密钥。

持久化合同：schemaVersion + revision、原子保存完整快照、失败保持旧版本、迁移先保留旧副本、未来版本拒绝写回；恢复后运行标记 interrupted，批准记录不恢复为有效，写调用绝不自动重放。原始工具正文默认不存，只存脱敏摘要/来源；设置可清空历史、限制条数与容量，配额失败必须可见。

未来写入采用 prepare/commit，不提前开放：

1. prepare 在隔离数据上计算 artifact、完整差异、target、expectedVersion、工具版本与参数摘要。
2. UI 展示精确方案，用户确认；程序签发本页短期一次性 Confirmation。
3. commit 重读状态并比较前提；变更则 `STALE_PLAN`，要求重新预览，不静默 rebase 用户批准内容。
4. 调已有业务接口，返回 not_started/applied/partial/unknown 与保存证据。业务没有撤销能力时不展示“撤销”。

本页检查不能阻止其他标签页/外部宿主并发；若底层没有原子版本条件写，必须标明能力限制，并在该类写工具开放前选择可保证的范围，不能把前置快照称作跨进程事务。首版无写工具规避此风险。

## 10. 两个首版模块与完成判据

Memory Diagnostics：查询契约、读取脱敏统计及开关/间隔，输出有来源的诊断报告和受控功能定位。只读，不调用 generateForCharacter，不读取记忆原文。没有已记录的最后失败原因时返回 unknown，不编造。

Config Draft：只支持试点白名单（自动记忆开关、间隔、记忆总开关以及已验证世界书设置），提供契约、验证、隔离预览、产物保存。未知字段拒绝或补资料，不直接调用真实 importProfileFromJson/applyProfile；插件映射支持某字段不等于助手首版支持它。

第二个模块接入不修改 core 状态机/运行循环；新增逻辑应只位于模块、契约与组合注册。如果做不到，先修改架构，不继续堆特殊分支。详细阶段门见路线文档。

## 11. 本地 Agent 项目参考后的补充决策

2026-09-24：仅研究本地快照，不宣称代表上游最新实现；无源码复制、依赖引入或参考项目修改。Claude 快照README自述为非官方暴露源码镜像，不能当官方可复用发行版；此处采用职责划分的思想，不移植实现。DeepSeek Harness 根LICENSE标注MIT，但本轮同样只借鉴设计。

| 本地观察依据 | 值得学习的点 | 暮羽采用方式 |
| --- | --- | --- |
| `claude-code-main/src/QueryEngine.ts` 的 submitMessage/interrupt/getMessages 与 `src/query.ts` | 外层引擎掌握会话输入/中断，内层执行模型与工具循环 | Application Service管理输入和归属，Runtime不依赖聊天组件；不复制该快照中大量CLI、供应商及UI依赖 |
| `claude-code-main/src/Tool.ts` 的输入输出Schema、validateInput、checkPermissions、只读/并发/中断描述 | 工具不是裸函数；参数、权限、执行特性要分别表达 | 注册定义和Broker分离，策略不可被展示层或工作流绕过。并发属性只作未来调度输入，首版串行 |
| 同文件的模型结果映射与界面渲染方法 | 同一个结果面向模型和面向用户的表达并不相同 | 增加纯投影层：规范化结果→model DTO / UI view model。权威结果只有一份，投影不能改变成功状态或产生副作用；核心定义不携带React/DOM函数 |
| `claude-code-main/src/query/deps.ts` | 模型与压缩I/O可注入，便于无真实调用测试 | 暮羽从第一版就注入模型、时钟、ID、存储和工具执行端口；不把生产I/O imports带进纯core |
| `claude-code-main/src/query/tokenBudget.ts` 及 `src/services/compact/` 的职责划分 | 长任务预算与上下文压缩不应该散落在UI | Budget与Context独立；压缩不能拆散toolCall/result配对，不能丢批准/原始用户约束，也不能改变工具执行事实 |
| `deepseek-harness-master/docs/architecture.md` 与 `docs/tool-execution-pipeline.md` | 能力定义、提供者、消费者分离；执行守卫与最终结果有统一入口 | 保留端口/适配器/Broker，不引入Cordis、YAML运行时插件加载或可变执行钩子链；安全检查顺序固定 |
| `deepseek-harness-master/packages/core/agent-loop/src/tool-calls.ts` | 执行次序、模型可见结果次序和取消收尾分别处理 | 首版工具串行仍保证每个已接受callId有可解释终态；中断后的未执行请求明确not_started，不能伪装执行成功 |

补充的明确边界：

1. 将规范化会话消息与UI渲染数据分开；未来上下文投影须保持完整工具轮次。事件日志不直接等于所有模型可见文本，也不默认永久存储隐私原文。
2. 人类命令、权限确认、模型调用使用不同入口。用户点击导航/取消可直接产生应用command，不必让模型重新解释，也不能被模型伪造为用户command。
3. 新用户输入只能在明确执行边界进入下一轮；不能修改正在执行工具的args、target或批准内容。插队/steering先定义语义再开放，首版忙时拒绝或由应用有界排队。
4. 预留presentation投影，不把每个工具写成UI组件插件；视图可展示部分流式参数，执行只能接受完整校验后的参数。
5. 不采用当前不需要的shell/文件系统、多Agent、自动权限分类放行、供应商专属提示缓存、复杂压缩实现及后台任务。源码规模不是暮羽需要的复杂度目标。

初步代码落地仅包含有界JSON/Schema子集、不可变工具元数据注册和纯Run状态转换。没有Broker、模型循环或GD接入，不能据此声称已经有可用Agent。用户要求进一步研究架构后，暂停扩大实现，先保留这些独立基础件及测试。
