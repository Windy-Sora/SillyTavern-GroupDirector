# Provider 上下文与持续授权

## 按需检索与命中回读（2026-10-01）

局部问题可先用 `muyu.provider.search` 查字面片段，再用 `muyu.provider.match` 核对原文，避免为一个细节逐页发送整个来源。现有完整读取接口保留；全面分析不能用几个命中冒充读齐。

- 当前酒馆正文：`search({id:"chatHistory",query:"金币"})`，不传 selector。
- 指定角色记忆：先读取角色目录，再 `search({id:"charMemory",selector:"character:0",query:"金币"})`。
- 已执行 Provider 的缓存结果：`search({id,revision,resultId,query:"金币"})`，只搜索本任务该次执行的结果，不调用 `render`。原执行首屏输出不因此减少。
- 回读：原样携带来源参数与返回的 `matchToken`；每次最多4000字符，`nextToken` 可续读。局部问题无需读完无关尾部。

搜索每页最多32次记录扫描、65536个 UTF-16 字符、8个命中，每个片段最多240字符；同一条记录内可返回多个命中。默认仅忽略 ASCII 大小写，不是正则、分词或语义搜索。`cursor` 非空表示未搜完，须携带原查询和来源参数继续；完整扫描无命中也只说明该字面词未命中。修订问题需要核对后续内容，不能只取最早命中。

引用只保存位置、来源身份与变化指纹，不缓存原生正文；每个运行最多256个引用。任务结束清理，授权交接沿原运行转移，不能跨任务或聊天复用。每次调用仍核验原来源授权；缓存结果沿用具体 Provider 版本的执行授权，引用不授予权限。匹配记录变化、来源数量或私有身份变化会拒绝旧引用；这是按页核验，不是全库原子快照，也不保证此前扫描的其他记录没有变化。指纹仅用于变化检测，不是真实性证明。

所有成功返回的 JSON（含元数据）计入共享 Provider UTF-8 字节预算；容量不足不提交新引用或部分正文，预算耗尽后停止读取。原生安全上限为聊天65536条、记忆256个角色且每角色2048条、单条投影1048576字符，超出拒绝而非截断。片段边界避免拆开代理对。工具不调用模型、写入资料或重新执行用户代码。

## 读取协议提示（2026-09-30）

`provider.read` v2 增加可选闭合 `readHint`，区分 directory、content、structured 与 unavailable。目录不是正文；`exampleSelector` 仅演示格式，不保证对应条目存在。分页的 `nextRead` 包含同一来源、选择器、revision 与精确下一偏移；STALE_SOURCE 提示重新读取目录。所有提示仍需经过目标、权限、版本与预算核验，不能授予权限或触发执行。完整读取应跟随分页直到完成或实际限制，不把重复正文当作结束。

读取支持三种互斥形态：`{id}` 获取目录/结构化来源，原 `{id,selector,revision,offset}` 接口，以及 `{id,continuationToken}`。有可确定的下一页或历史正文范围时，宿主返回 `readHint.continuation={id,token}`，模型原样引用，不再计算偏移。来源 ID 保留用于 Broker 的来源授权、历史依赖与观察记录，token 不是权限。混用 token 与旧分页字段或仅填写部分旧字段返回 INVALID_READ_ARGUMENTS，不读取数据。

`continuations.js` 仅保存宿主生成的有界参数与目标身份，每个运行最多128个引用，不存正文或执行代码；引用隔离复制。相同任务授权交接时随既有 transferRun 转移，保留已用字节与原预算上限，旧运行不能使用；结束、取消或重连随运行清理，新任务不恢复 token。每次调用仍通过 Broker 授权及撤销检查，再重新读取和核验来源证据，不能用 token 返回过期快照。引用可以在同一运行重读，但仍计工具次数与字节预算；同一 call ID 的去重继续由 Broker 负责。

`readHint.error` 只给静态字段、预期格式与可否纠正，不包含原始宿主异常或私有资料。INVALID_CONTINUATION 指引重新读取目录；STALE_SOURCE 指引刷新版本；BUDGET_EXCEEDED 指明停止读取。字节预算一旦因页面无法容纳而耗尽，不能跳后续较小页面绕过。容量上限不影响旧参数兼容读取，模型可使用 nextRead。

## 通用已注册 Provider 执行（2026-09-25，当前）

`muyu.provider.discover({offset?})` 分页列出当前注册表中的内置与用户 Provider 的 ID、占位符、来源、版本和可选上下文需求；只取元数据，不执行 `render`。用户导入资产的版本由加载器私有保存的源码摘要与上下文声明决定，可跨刷新识别；没有可信源码摘要的其他注册 Provider 仍使用连接内版本。`muyu.provider.execute` v2 直接调用原有 `render(context, signal)`，默认取 `content`，也可选择 `data` 的有界 JSON 文本。发现目录不会授予执行权。

执行前必须单独申请 `providerExecution`，申请绑定当前聊天、任务、Provider ID 与版本；界面只给“允许本任务／拒绝”。批准后仍由 ToolBroker 核验。脚本替换、卸载、禁用或版本变化时重新检查身份；同一版本的热重载也不能接纳旧实例的迟到结果。新工具的 effect 是 `external`，且仅此固定工具 ID 被内部 Broker 允许执行。首屏最多8000字符；长结果由 `muyu.provider.result` 以 `resultId` 分页读取同一次执行，Run 结束即清理，不重复执行脚本。每页计入 Provider 字节预算；异常正文不外发。

这条通道执行的是酒馆页面内的 JavaScript：它可以修改宿主状态、联网或产生成本。任务超时或取消会阻止迟到结果进入模型，但不能保证中断脚本已开始的副作用。授权卡明确呈现这一点。原有来源级 `provider.read` 仍适合要求严格只读的问答。执行结果以 `source:providerExecution:<id>:<version>` 记录历史依赖；之后只有同一脚本版本在新任务中再次获批，受其影响的旧历史才可重新发送。旧备份导入只恢复惰性事实，不恢复授权。拒绝一个脚本不会批准其他脚本。

当前为“运行已注册 Provider”阶段：用户可继续使用既有导入/注册机制提供脚本；暮羽尚不创建、编辑、导入或测试新脚本。未来写码流程应先产出独立草稿、运行隔离测试、展示代码和预期权限，再经用户显式批准导入；导入后的脚本依旧走上述具体版本执行审批。隔离测试与真实宿主执行必须标明不同环境，不能凭 `readOnly` 声明认定无副作用。

对照静态资产，`assets/providers` 含约43个 Provider ID，启动实际注册由 manifest、其他模块和用户资产共同决定，以运行时 discover 为准。固定只读目录目前19类；NPC 的 `npcList` 可经通用执行读取，旧世界书 Provider `worldBooks`/`gdWorldBooks*` 会运行扫描器；新增固定只读世界书来源不运行该扫描器。`dice`/`randomDice` 生成随机结果，`systemTime`/`moonPhase` 依赖当前时间，不能当作已保存剧情证据；角色和变量类旧 render 可能读到不同于固定只读来源的有效值或完整数据。以上分类来自当前源码核对，不能推断用户脚本行为。

下文“尚未开放任意 render”是固定只读目录阶段的历史说明，适用于 `muyu.provider.read`，不适用于新执行工具。

## 来源适配与剧情试点（2026-09-24，当前）

固定目录现有 **19 个来源**：既有九个来源行为保留，另有 variables、storyBlueprint 与八个 ST 只读来源。新增来源使用 source-only：旧 chat/extended/diagnostics 整包授权不自动扩大。它们通过同一个 list/read 工具、按来源申请和历史依赖，不增加任务分类或写工具。

- variables：空 selector 读取变量与已存储角色值目录，item:N 读取具体存储值。global 明确映射为 chat-global，不是插件全局配置。没有存储值返回 missing，不代入 defaultValue，不执行规则、强制类型转换或有效值计算。角色存储键仅作内部版本证据，不导出头像路径；无法解析的名称标为 Unresolved character。定义最多256个、每变量角色键最多256个、展开目录最多512项；不读取变量日志、默认值或维护规则。
- storyBlueprint：关闭功能返回 SOURCE_DISABLED；未存储蓝图返回 empty。概况给节点层级及已存完成信号数量，node:N 返回该节点 content、子节点引用与该节点的原始信号白名单。不会运行 normalize、prune、推进或保存；不计算当前推进位置、不把信号解释为执行成功。目录明确标为不完整（省略根级自定义元数据）；详情省略额外节点字段时标 truncated。树最多512节点、16层，信号最多1024条。仅支持现有规范化存储形态，旧形态不在读取时迁移。
- stChat：chat 范围，当前聊天的类型、名称、消息数及群组成员数，不含消息正文或原始 ID。
- stCharacters / stGroups：global 范围，当前连接可见的角色／群组名称目录。空 selector 返回前40项及总数；先取目录 revision，随后以 `search:NAME` 查名称，最多20项。只显示用于区分同名项的目录索引与名称；索引不是详情选择器。不显示角色卡、头像路径、群组 ID 或成员列表。原始目录身份只用作私有 revision 证据；至多2048项。全局持续授权限当前连接，不代表所有资料均可读。

ST 聊天与名称三来源由即时 `getContext()` 白名单投影，不执行 Provider render，也不把“当前可见”解释为“正在群聊中”或“已注入提示词”。

### 世界书异步来源（2026-09-29）

- `stWorldBooks`：chat 范围，书名目录、`search:NAME` 及当前全局／聊天／当前选中角色／Persona 的绑定线索。最多512本，概况显示前80本，搜索最多20本。`promptInjection=unknown`：绑定不证明某条世界书实际进入过提示词。
- `stWorldBookEntries`：global 范围，授权范围明确是**整个世界书资源库**。空 selector 获取书名目录；携带其 revision 用 `book:N` 异步加载单书的条目目录；携带该目录 revision 用 `search:N:QUERY` 搜索该书的注释、关键词及正文，或用 `entry:N:M` 精确读取一条的原始正文。目录最多显示80条，搜索最多20条，单书最多1024条；正文不执行宏、递归匹配或注入判断。
- 两个来源独立授权。目录读取不调用 `loadWorldInfo`；单书与条目读取使用 ST 原有 `loadWorldInfo`，可能命中宿主缓存。因此 readAt 是本次观察时间，不证明磁盘持久化或最新注入。读取等待上限10秒；底层 ST 加载不支持由本适配器强行中止，但目标变化、取消或任务结束后的迟到结果不会发布。失败不向模型泄漏宿主错误正文。

### 预设、Persona 与扩展目录（2026-09-29）

- `stPresets`：global 范围。固定八类：kobold、novel、textgenerationwebui、openai、context、instruct、sysprompt、reasoning。空 selector 给类别及当前 UI 选择；`mode:N` 列出该类别最多80个名称，携带其 revision 可用 `search:N:QUERY` 查最多20个名称。只调用宿主预设管理器的 `getAllPresets` / `getSelectedPresetName`，不调用返回设置正文的方法；管理器未初始化显示 unavailable，不能解释为预设为空。当前选择是 UI 观察值，不证明下次生成一定使用它。
- `stPersonas`：chat 范围。名称目录与 `search:NAME`，显示当前选中、默认和本聊天锁定标记。头像 ID 只作私有 revision 证据，不发送给模型；不读 Persona 描述／Prompt、连接规则或头像文件。最多1024项。
- `stExtensions`：global 范围。已发现扩展 ID、local/global/system 类型、配置上是否启用，支持 `search:NAME`。`runtimeActive=unknown`，因为此 ST 版本未公开可直接读取的运行集合；“配置启用”不证明加载成功。仅从宿主设置取 `disabledExtensions` 白名单字段，不返回原始 `extension_settings`、密钥、manifest 或错误正文。最多1024项。

variables 与 storyBlueprint 的 text 是分页的 JSON 文本；ST 三来源是有界文本目录。需要时拼齐页面再理解完整内容；继续沿用2000 UTF-16单元/页、不切代理对、字节预算和版本核验。变量值和节点 content 使用有界 JSON 复制：最多16层、4096访问节点、数组1024项、单字符串32768字符、整体32768 UTF-8字节；不支持或超过详情复制边界返回 SOURCE_UNSUPPORTED，目录/总投影超界返回 SOURCE_TOO_LARGE。不得把拒绝返回解释为无数据。

### 内部扩展规范

1. catalog.js 集中声明 ID、范围、授权类别、选择器、reader 键、输出合同键与文本大小/分页限制；公开目录剔除内部字段。注册不是授权。
2. host/providers.js 使用闭合 reader 映射；原八类文本读取保持 legacy 兼容组，memoryConfig 与两个新来源独立分发。新来源不再追加到 legacy 分支，不执行旧 Provider render。现有内置对象身份核验保持不变；新来源直接由固定一方纯读取器提供，不接受自定义注册替换。
3. contracts.js 负责文本返回形状和结构化合同映射，config-contract.js 独立验证原四字段结构。新增结构化来源仍须明确修改工具 wire Schema，不能绕过闭合输出校验；工具 v2 保留，本次为新增来源及状态。
4. 业务元数据窥读由 systems/provider-read-data.js 提供；读取器不得调用会初始化、迁移、修剪或保存的 getter。声明实际支持的投影、遗漏和未知值。
5. 新来源需测试未授权零读取、旧授权不扩大、无写入、归属与撤销、历史外发、空/禁用/不支持、大小/分页、目录身份及详情变化。不得导出存储定位键或错误原文。

尚未开放：NPC、世界状态、任意自定义 Provider、配置写入或泛化脚本执行。下文九来源与旧整包操作说明为较早阶段记录，以本节为准。

## 统一助手当前授权（2026-09-24）

新面板不再区分任务或展示 chat/extended/diagnostics 整包勾选。九类 Provider 均按来源申请，其中 memoryConfig 是全局来源，其余限定当前聊天。读取仍逐次通过 Broker 核验。全局持续授权仅当前连接与所有者，聊天持续授权仅该聊天；任务授权终止即清除。旧整包实现只供内部兼容，下文旧模式操作说明不再适用于新面板。

配置核对快捷按钮要求当前仍有 memoryConfig 权限；也可直接提问让模型申请。配置草稿不预选字段，但仍限制四字段且须逐份人工确认写入。手工验收应改为：直接提问 → 查看来源与目的地 → 批准或拒绝 → 检查实际读取与范围；不再去齿轮勾选扩展资料。

## 架构与兼容

### Agent 适配合同 v2：全局结构化来源

`muyu.provider.list/read` 工具版本升级为2；旧 v1 调用明确拒绝，不跨 Run 重放旧工具调用。目录增加 scope、format、contractVersion；只列静态元数据，不探测宿主可用性。既有八类文本来源保留原 selector、分页和权限语义。

新增第九类 `memoryConfig`：global / structured / diagnostics，来源合同版本1。只允许 selector/revision为空、offset=0。返回 `data`，含 version、scope、origin=current-memory、persistence=unknown，以及四条固定字段的 field/state/value；state为value/missing/unsupported，value为规范JSON标量文本。缺失和不支持的值不填默认、不转型，不返回异常值正文。与记忆诊断的“生效间隔”投影不同，这里只报告原始存储字段。

该来源由固定一方适配器 `host/config-read.js` 提供，复用既有 readConfigBaseline 校验；通过统一 Provider 端口访问，不伪造 Prompt 占位符或注册通用渲染器。自定义 Provider 即使用相同名称也不能替换此固定读取器。其他八类仍核对启动时捕获的内置对象/render/enabled身份；不执行任意render，不初始化、迁移或保存数据。后续来源必须显式增加目录、封闭输出合同及安全读取适配，注册本身不授予Agent访问权。

通用工具的scope是global，实际边界按来源再次核验：聊天任务必须仍匹配原聊天，全局任务必须匹配原页面所有者且来源为global。全局任务不能读取聊天正文。结构化结果不分页，完整data计入已有Provider UTF-8字节预算，超过预算不返回部分对象；每次重新读取，返回的revision不是宿主持久化版本，也不能用作跨Run缓存。

memoryConfig 使用 source:memoryConfig 按需授权，已进入 `muyu.permission.request` 枚举；chat/extended 不能代替它。旧 diagnostics 授权仅保留内部兼容。core 及旧 Provider 注册 API 不变。

回执上的“核对当前配置”调用同一Provider v2、ToolBroker、diagnostics策略与providerBytes预算，最多一次读取，在本地确定性比较提议字段，不调用模型、不修改配置、不绑定草稿。仅返回读取时一致/不一致/无法核对，保存状态仍未知；结果留在原会话的临时界面状态，不覆盖旧回执，不持久化，也不自动灌入解释模型。解释按钮继续无工具。切换会话保留结果归属与输入，停止/撤销/重连会取消在途核对。

Agent → ToolBroker → modules/providers → host/providers → 既有业务数据源。
不修改旧 Provider 注册签名、不执行任意 render、不解析模板/DSL。固定内置 Provider 在启动注册完成时捕获；适配器核对对象、render、enabled 身份，替换或卸载即不可用。自定义脚本、动态 Agent、世界书扫描与写入不开放。这不是恶意同源 JS 的安全沙箱。

`systems/provider-read-data.js` 提供无初始化/迁移副作用的共用读取函数，原业务 getter 保留初始化行为。暮羽不调用会初始化、迁移或保存的 getter。读取与授权逻辑不进入 core。

## 原有文本来源（八类；另有上述 memoryConfig）

| ID | 内容与限制 |
| --- | --- |
| recentMessages | 最后 50 条消息，含名称；超出窗口明确 truncated |
| chatSummary | summaryEnabled 时最近已保存的 active 总结；不是正在生成的内容，也不证明已注入 |
| character_profiles | ready 档案目录与 summary/motivation/relationships/tags；自定义字段未返回时标记 truncated |
| charMemory | 角色目录与 event/mood；不自动迁移、删除、压缩或生成 |
| chatHistory | 当前已加载聊天任意消息范围；range:START:COUNT，单范围最多20条，不读其他聊天、备用swipe或extra |
| characters | 当前群聊成员（含标明禁用的成员）或单聊角色；name/description/personality/scenario/first_mes/mes_example/system_prompt/post_history_instructions；不扫整个角色库 |
| directorLedger | 最新保存的导演计划：reason/speakers/scripts和保存时消息数量，不读任意未知字段 |
| directorHistory | 保存的导演计划按range:START:COUNT读取，每个范围最多10条，字段同最新账本 |

后四类要求独立的 `extended` 授权。角色卡指令只作不可信资料，不执行；卡片附件/世界书/扩展字段不返回，明确标记不完整。账本是可编辑计划，不证明实际选人或脚本执行。空selector先返回消息/记录数量或角色目录，再带概况revision选择范围/角色，offset用于该范围内正文分页；概况数量不是所有历史正文的内容快照，详情分页按该详情的完整返回投影核对。记录数量变化后需重读概况。

`muyu.provider.list({})` 只返回固定来源元数据，不探测注册可用性、不执行 Provider、不读取角色目录。列出不等于业务功能已启用或用户已授权。

`muyu.provider.read({id, selector, revision, offset})`：

- 首次 selector/revision 为空、offset=0；档案/记忆先返回 character:N 目录。
- 角色详情携带目录 revision 和 character:N；身份只用本地引用，头像路径不外发。
- 续页携带返回的 revision/nextOffset。每个 Run 独立，不能跨 Run 复用。
- 返回 source/status/revision/text/nextOffset/truncated/readAt，不返回宿主聊天 ID。
- 每页至多 2000 UTF-16 单元（不切断代理对）；生产每 Run 默认2 MiB UTF-8 字节正文，可在运行预算设置中调整为6000–16777216字节，发送时固定；最多16个资料快照。最近消息窗口之外需使用历史范围入口，不一次注入全部历史。
- 单资料最多 131072 字符、角色最多 256、单角色记忆最多 2048；超过限制明确 SOURCE_TOO_LARGE，不静默宣称完整。
- 分页按完整受支持投影核对版本，不用弱哈希；目标变化/取消不发布。SOURCE_DISABLED、SOURCE_UNAVAILABLE、STALE_SOURCE、empty、预算耗尽分别处理。
- 执行过程只存来源枚举、状态、字符数与截断标志，不复制正文、角色引用或 revision。正文不自动持久化，但模型回答可能引用它。

## 授权生命周期

`application/permissions.js` 管理连接会话内授权：public 静态资料默认可读；diagnostics 是白名单配置/匿名状态；chat 是首批四类资料；extended 是历史正文、参聊角色卡和导演账本。chat 与 extended 独立，老授权不会自动扩大。最多记住 64 个聊天选择。工具调用逐次按来源ID核对权限，不仅检查通用read工具是否开放；任务白名单仍限制跨任务工具调用。

普通发送首次询问，授权后直接发送；聊天助手可选择只发送问题，后续不反复询问，可从设置授权。配置草稿仍需每次选择字段，字段不是读取权限。面板重建/关闭不撤销；换聊天不继承正文权限；换连接、禁用、刷新清除授权。

撤销立即阻止新调用、取消任务并等待物理清理，然后清空运行上下文、产物及未发送输入，打开空白会话；保留其他已授予权限。历史仓库保留只读记录，但继续旧会话必须重新满足记录所需数据类别，不能把旧回答中的资料绕过授权再次外发。界面提前告知此范围。不能撤回已经发送给服务的数据。详见 [会话仓库](../../sessions/README.md)。

## 密钥持久化与自动启用

连接表单默认勾选“记住 API Key”和“下次打开时自动启用”，可关闭；自动启用必须保存密钥。使用插件 `agentConfigs['muyu-assistant']` 存储 endpoint/model/thinking/apiKey/autoConnect，沿用配置档导出的 stripApiKeys 路径。不是本机加密保险箱：酒馆设置在宿主存储，同源脚本、服务器管理员及完整备份可能读取。不要分享完整酒馆设置。旧版已保存密钥没有 autoConnect 标记，不会自动启用。

密码框留空时仅对完全相同 endpoint 复用；不同 endpoint 必须提供新密钥。公开控制器快照只有保存状态及连接元数据，密码不填回 DOM、不进入工具或过程。只有明确保存 autoConnect 的连接会在插件加载时启用；不会主动调用模型、恢复资料授权或执行旧任务。

“清除已保存密钥”删除持久记录，不关闭当前内存连接；禁用关闭当前连接并关闭下次自动启用，不删除持久密钥。取消“记住 API Key”后启用连接会删除原保存记录。写入通过宿主确认保存，失败报告安全错误，不声称已保存；无保存记录且未勾选时不发起设置写入。

## 手工验收

1. 默认聊天助手首次授权，连问两次，只确认一次；收回气泡再打开仍有效。
2. A 聊天读取记忆后切 B，不显示 A 会话也不继承正文权限；回 A 保留原授权。
3. 设置中撤销权限，任务停止、暮羽记录清空；重新提问不复用旧资料。
4. 问“最近在聊什么”“Alice 的记忆与档案有哪些差异”，检查来源、分页和不完整提示。
5. 可选记住密钥→刷新→手动启用；不必重填密钥但需重新授权。换接口留空密钥应失败。
6. 清除保存密钥再刷新，必须重新输入；检查保存失败提示、键盘操作、中英文和窄屏。
7. 齿轮→上下文与权限开启“扩展剧情上下文”，问“结合角色卡和最近导演账本解释当前剧情”；关闭此权限再提问，不能复用旧正文。
8. 问“开场前十条说了什么”，检查读取范围和来源；对未加载的其他聊天、未返回的卡片字段应说明缺少资料，不猜测。

Node 测试不代替真实模型质量、浏览器布局和宿主保存验收。
# 角色记忆检索版本绑定（2026-10-01）

`muyu.provider.search` 的 `charMemory` 路径必须先用 `muyu.provider.read({id:'charMemory'})` 获取目录，然后携带该目录的 `revision` 和 `character:N`。后续 cursor 搜索和 match 回读沿用同一 revision。缺版本或目录身份变化返回 `STALE_SOURCE`，须重读目录并重新选择角色；不能沿用旧数字序号或换来源绕行。正文修改仍由命中引用的指纹检测。chatHistory 原生搜索与缓存 Provider 结果的版本契约不变。
