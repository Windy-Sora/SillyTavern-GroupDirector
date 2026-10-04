# GD Test Lab

## 2026-10-04 review-91f9fd2 回归修复

报告三项均独立复现并确认：v21–v30 无 diff 回执导致后续启动失败；未发布／已移除草稿的私有票据未回收；Provider／脚本创建第257项突破自身容量并阻断管理入口。回执序列化补齐；十类编辑／聊天库模块采用按候选→草稿转移的私有票据生命周期，取消／失败／替换回收候选，会话卸载或草稿删除回收已无归属票据，仍可审批草稿保留。创建上限仍256，预检、脚本串行写入与Provider异步导入最终追加分别复核；旧超限集合在4096项安全读取上限内可读／删恢复，不增加创建许可。

新增32项回归：十种新回执的全部合法终态、真实控制器编辑后连续发送、70次取消与70次发布后删除会话、十类模块转移／发布／回收、保留另一可审批草稿、255／256／257边界、脚本排队与Provider摘要／注册期间容量竞争、旧超限集合删除恢复。最终全量2738项：2737通过、1跳过、0失败；静态724源码／11 JSON，17/17历史BUG契约通过。测试不接真实网络、不读取用户数据、不运行用户脚本；Provider仅执行测试自编的良性fixture。报告提及的远端基线导入回滚问题不在此次新增三项修复范围。

正式运行代码与文档同步两处本地release，测试及审计材料不发布；本轮未提交／push。核实与修复证据保留在忽略目录 .bug-hunter/review-91f9fd2-fix，不覆盖原审阅报告。

## 2026-10-04 DeepSeek 实测问题修复与复测

修复整单生成公开 Schema 与宿主合同不一致（memory/profile 不接受 count，NPC 不接受 character），并为纯准备参数错误提供可纠正的 not_started 结果；未知执行／保存结果仍不自动重试。历史回答按原说话者标注为已完成的参考资料，最新问题独立保留，不外存或伪造 thinking 内容。Provider 目录补充静态路由提示；任务方案区分操作类型与资料领域，不能把蓝图写入暂缓推断成蓝图不可读取。合成测试、预览、计费与执行票据的结果说明分别限定时点与范围。

最终全量：2706 项，2705 通过、1 跳过、0 失败；静态检查 722 个源码、11 个 JSON，17/17 历史 BUG 契约通过。未修改权限批准、默认预算或自动摘要策略。此前 100k 手动预算且未开启自动整理的长对话停止属于预算保护，不通过偷偷增加预算或付费压缩规避。

真实 DeepSeek thinking 复测：整单生成 12/12、全权限边界 8/8；最终“旧任务→猫头鹰常识→兑换条件追问”重复 3/3，常识问题未重读旧资料，兑换题读取蓝图后区分当前 35 与条件 50。Provider 合成执行和脚本拒绝后旧票据失效解释各 1/1。

保留中间失败报告：54 次对话复测自动通过 51 次，其中一次确属蓝图路由误判（随后修复并重复验证），一次是 harness 错误批准整份方案（已改为逐来源核对、任一拒绝则拒绝整单），一次为“我不知道”未被正则识别。修正 harness 后部分授权复测 2 次，自动通过 1 次，另一项人工确认拒绝生效、仅读取允许来源。不能把正则通过率等同于回答质量；仍可能出现措辞冗长或推断不够严谨。

边界：付费请求使用真实模型与生产控制器／业务管线，但宿主、保存和资料为隔离 fixture；不证明真实 ST 持久化、最终注入、账单或浏览器 UI 已验收。原始及 postfix 报告保留于外部 muyu-agent-live-harness，不随插件发布。本轮正式代码与文档同步两处本地 release；未提交、未 push。

2026-10-04能力扩展收口：仅更新当前状态、路线／交接、开发边界和临时清单归档；不增加运行代码、权限或测试用例。配置覆盖断言实际核对115默认键、96叶字段：91 supported、7 special-editor-supported、11 pending、3 special-editor-pending、3 internal。ST消息编辑和蓝图生成／续写明确跳过，人工宿主／付费模型验收仍独立保留。下方历次测试数字不代表此次人工验收。

收口全量复核2698项：2697通过、1跳过、0失败，17/17历史BUG契约通过；未调用付费模型、未提交。8份正式状态／架构／规范／交接／路线／测试／README／归档文档同步两处release并核验哈希，不复制测试或审计文件。原临时清单迁为正式扩展归档，历史内容保留。

2026-10-04整单生成入口：新增34项（20模块／权限与历史、10真实业务控制器、4双语GUI），相关491项通过。验证选中目录许可、精确task-only一次批准、批准后原调用继续而无额外模型请求、试跑／顺序保存、拒绝与全权限、业务最大调用数及聚合结果预算、重复调用、过期、保存未知停止、物理取消排空及导入不恢复执行权。首次Schema／超时登记与真实profile断言问题已修正；未放宽通用验证，未调用付费模型、未提交，真实ST待验收。

本轮全量2698项：2697通过、1跳过、0失败，17/17历史BUG契约通过。25份正式运行代码／文档同步两处release并核验哈希，测试、临时清单和审计文件不复制。

2026-10-04业务生成整单私有底座：新增38项，真实记忆／档案／NPC业务管线参与，覆盖多角色与混合顺序保存、试跑、容量预检、受控基线推进、同值引用替换及其他并发修改、未知／部分保存、取消／超时、去重、撤销和长聚合结果省略。相关201项通过；最终38项专项也通过。全量2664项：2663通过、1跳过、0失败，17/17历史BUG契约通过。未调用付费模型、未提交；工具／整单授权／GUI尚未接入，真实ST待验收。蓝图生成／续写跳过。正式代码／文档同步两处release，测试／临时清单不复制。

2026-10-04 NPC业务生成工具接入：新增31项（17模块／权限与历史、10真实业务控制器、4双语GUI），定向431项通过。覆盖closed Schema、显式effects、普通／拒绝／全权限、读权限不升级、精确task-only许可、原调用续接无额外模型请求、版本变化、预算不足零副作用、保存未知、停止物理排空、历史不恢复执行单及旧模式隐藏。新增模块用真实NPC Agent／Agent Runtime验证业务路径；未调用付费模型、未提交，真实ST验收仍待进行。

本轮全量2626项：2625通过、1跳过、0失败，17/17历史BUG契约通过。25份正式运行文件／文档同步两处release并核验哈希，测试、临时清单和审计文件不复制。

2026-10-04 NPC业务生成底座：新增43项确定性专项，真实NPC Agent与Agent Runtime管线参与；相关NPC测试66项通过。覆盖纯检查／准备、试跑不写、追加不导入角色卡、容量／全角色及批内重名、宿主生成元数据、输出边界、精确任务／业务配置／Provider／Agent当前性、一次执行、取消和物理排空、切换聊天、未知／部分保存、历史快照与长输出省略。撤销时runtime包装的异常已按内部取消信号正确分类。尚未装配暮羽工具、执行授权卡和结果预算；未调用付费模型、未提交，真实ST待验收。

本轮全量2595项：2594通过、1跳过、0失败，17/17历史BUG契约通过。正式运行文件／文档同步两处release并核验哈希，测试、临时清单和审计文件不复制。

2026-10-04 档案业务生成工具接入：新增31项（17模块／权限与存档、10真实业务控制器、4中英文授权界面）。覆盖闭合Schema、独立来源、读权限不升级、只读方案不授权执行、task-only／拒绝／full access、原调用续接无额外模型请求、预算不足零副作用、目标过期、保存未知、取消物理排空、存档导入不恢复执行权及旧模式隐藏。初轮UI测试片段带入重复import，修正测试导入后定向503项通过；后补两项模式／存档回归及调用数断言定向319项通过，生产参数和权限未放宽。最终全量2552项：2551通过、1跳过、0失败，17/17历史BUG契约通过。未调用付费模型、未提交，真实ST界面／业务连接／持久化待验收；正式运行文件／文档同步两处release并核验哈希，测试、临时清单与审计日志不复制。

2026-10-04 档案业务生成底座：新增73项确定性测试，相关档案93项通过；全量2521项：2520通过、1跳过、0失败，17/17历史BUG契约通过。覆盖纯检查／准备、标准Schema／四字段输出、试跑不写、已有任何状态不覆盖、共享Schema及归档不迁移、目标／角色／Provider／业务配置当前性、取消／超时物理排空、一次执行去重、容量、并发、未知／部分保存、安全异常和长输出省略。初轮fixture误将旧caller可省略的options视为必填，补默认值后通过；生产参数合同未放宽。尚未注册暮羽工具／权限／GUI，后续另测授权及结果预算；未调用付费模型、未提交，真实ST验收待完成。正式运行文件／文档同步两处release并核验哈希，测试与临时清单不复制。

2026-10-04 单角色记忆业务工具：新增33项（15工具／权限、10真实业务控制器、4中英文授权界面、4宿主边界）。覆盖普通／拒绝／全权限、精确来源续接、读权限不升级、常驻批准拒绝、预算不足零副作用、取消与物理排空、未知保存、存档依赖不恢复执行，以及暮羽存档不使业务授权失效。目录不复制超长聊天；私有执行仍严格检查真实上下文。集成初轮发现未绑定Run的transfer导致旧聊天澄清START_FAILED，修为未绑定空操作并复跑既有澄清；新测试fixture初轮重复callId导致CALL_ID_CONFLICT，修正测试ID，未放宽broker保护。最终全量2448项：2447通过、1跳过、0失败；17/17历史BUG契约通过，生产接线语法及diff检查通过。未调用付费模型；真实宿主待验收，未提交。正式运行文件／文档同步两处release并核验哈希；测试、临时清单及审计文件不复制。

2026-10-04 单角色记忆业务生成底座：新增43项确定性回归，复用真实memory Agent／Schema／runtime，覆盖纯准备、试跑不写、保存与容量裁剪、重复／并发执行、预取消、渲染中取消、原生物理请求超时排空、零重试、目标／配置／Provider／Agent变更、同角色及无关角色并发、未知／部分保存、输出上限、任务释放和旧接口兼容。相关定向135项通过；全量2415项：2414通过、1跳过、0失败，17/17历史BUG契约通过。首次测试错误假定原解析器的null列表一定报错，修正为原有no_result并保持零写入断言。尚未注册暮羽工具或授权／GUI路径，不算业务生成用户验收；未调用付费模型、未提交，正式运行文件／文档同步两处release，测试与临时清单不复制。

Muyu `review-246ff3c` P2 修复（2026-10-03）：确认自动应用→回执自动核对→最后一次空闲通知后，搜索保存按钮被旧 disabled 快照重新禁用。搜索表单改用共享反馈层的实时业务禁用谓词，统一叠加本地保存与外部忙碌锁，不依赖下一次无关渲染。真实 controller/panel/configWriter 的正式回归修复前失败、修复后通过，另覆盖成功/失败/取消、无密钥清除按钮、保存期间重复点击及最新密钥状态。原面板基线两次75/75；修复后专项77/77，全量1471项：1470通过、1跳过、0失败，静态和17项历史契约通过。未调用付费模型、未做真实浏览器视觉验收；审计日志不提交。

Muyu 推断边界补充（2026-10-03）：参考本地 Codex 将发现与假设分开、Claude Code 先读实现再建议及条件分支中的忠实结果报告规则（只借鉴，不复制实现）。压缩原分析指南，在原4000字符上限内补充“单一路径≠全部能力、上限≠实际结果、未读≠不存在”；配置合同、导演诊断和记忆资料提供具体边界。专项 **140/140** 通过；新增合同回传/Schema不变及LLM与非LLM报告边界测试。DeepSeek五个合成场景、11次请求完成，名称与只读检查通过；人工核对本次不再出现“上限等于成员数所以不筛选”或“关闭自动提取只能手动提取”。记忆回答仍有将当前零条记忆描述为缺少自动写入痕迹的模糊措辞，未据此宣称全面语义通过。无新增模型审查调用、无权限或执行逻辑变动，本次未重跑全量回归。

Muyu GUI 名称贯通（2026-10-02）：配置读取追加标量/枚举易读值；导演、记忆诊断及原始记忆配置 Provider 追加共享双语展示数据；报告类型本地化、代码收进技术详情，普通诊断不再作为暴露字段名的例外。名称/诊断/Provider/指令/面板专项 **115/115**；全量 **1468 项：1467 通过、1 跳过、0 失败**，静态及17项回归契约通过。长历史控制器用例的模拟测量包含完整工具输出Schema，本轮新增元数据使旧38000预算不足；用48000预算和29000字合成长回答维持“原文不携带→摘要一次→继续回答”的原断言，未改运行时保护。真实 DeepSeek 五个合成场景、10次请求全部完成：普通回答未出现检查集合内的内部名称，明确JSON请求保留原字段，无写入或草稿；Provider元数据路径另由离线闭合Schema和预算测试覆盖。人工阅读仍发现部分机制过度归纳及冗余收尾，名称检查不等于全答案语义正确。外部 `muyu-agent-live-harness/gui-names-live.mjs`/`gui-names-results.json` 不入仓库或release；未做真实浏览器像素验收。

Muyu 设置收尾与报告展示（2026-10-02）：历史设置展示实际后端和共享保存状态；分类独立滚动、固定导航、快捷入口展开定位。排查报告随原回复显示并默认折叠，兼容报告位于历史开头；连接卡片取消单独混色底。新增中英文6项回归，涵盖滚动恢复/定位优先级、实际存储与待刷新状态、内存后端、冲突恢复及报告归属/折叠/旧事件隔离；面板 **75/75 通过**。用户反馈来自上一版真实界面验收；本轮不声称完成所有宽度像素验收，未调用付费模型。

Muyu 设置反馈与纠错（2026-10-02）：共享就地反馈、保存期间锁定、失败草稿保留与字段定位；连接预检复用模型合同并区分当前连接和草稿，自动摘要开关恢复直接可见。新增5项用例（含中英文参数化），覆盖重复保存隔离、失败重试、恢复默认失败保留草稿、折叠区错误展开/聚焦、连接零请求预检、测试不切换连接和搜索失败密钥保留；既有连接用例补齐模拟密钥，以满足新增真实合同预检。GUI/控制器/模型专项 **200/200 通过**。未调用付费模型，未做浏览器像素/CORS验收。

Muyu 接口配置分层（2026-10-02）：基础连接卡片、默认收起的高级/保存选项、通用 Chat Completions 协议选择和 DeepSeek 思考强度。新增4项回归，验证中英文布局合同、草稿不自动连接/发送、通用协议关闭专属思考、切协议取消请求并隔离迟到结果、旧记录默认及新协议/强度保存恢复。GUI/控制器/模型专项 **195/195 通过**；不代表真实浏览器像素布局、CORS 或服务端兼容性验收，未调用付费模型。

Muyu `review-1bbf2f4` P3 修复（2026-10-01）：共享字面扫描器直接统计本页实际访问的不同记录，不再从 Unicode 回退后的续搜游标反推。新增真实 Provider port/module 回归：第一条格式化后占65535个 UTF-16单元、第二条以 emoji 开头，修复前计数1而非2；修复后计数2，续搜仍能命中并回读第二条完整片段。原32步／65536字符／8命中限制不变，历史检索包装层保留原闭合输出合同。相关六文件 **221/221 通过**，独立静态检查 **PASS（557源码、11 JSON、226模块冒烟）**；未重跑全量，未调用付费模型或进行浏览器验收。报告中的后续产品优化建议不在本次修复范围。

Muyu 检索与记忆结果语义（2026-10-01）：Provider 区分扫描步数／本页不同记录／所选来源总数，保留原计算上限；notes.list 返回关键词匹配覆盖范围，saved 返回真实范围、按需召回、非自动注入及未报告新建／未做语义查重。任务规则和保存工具说明约束全库数量、首次新建、自动采用及内部 ID 展示。新增5项回归，工具／历史检索／指令专项 **55/55**，控制器／GUI **165/165** 通过；最终指令仍在4000字符限制内，未放大指令合同；最终独立静态检查PASS（557源码、11 JSON、226模块冒烟）。真实 DeepSeek 思考模式五轮合成测试共 **81次请求、470375报告Token**：前3轮流程均7/7，但保存表达仍曾过度承诺，因此不记为语义全通过；全量任务规则搬迁曾导致全权限追加说明超过原4000字符合同，已收回为基础详细规则＋任务简短保存确认并保留宿主追加余量；最终控制器／GUI／指令176/176通过。加强保存工具说明后，最终记忆定向3组＋无网络安全检查2组 **5/5**，9次请求、51100报告Token，本组人工核对未再出现自动采用／首次新建／全库数量断言。角色检索在前3轮始终正确。字面风险检查不是完整语义判定，偶尔暴露角色选择器等表达细节仍有优化空间；没有保证任意问法或模型都不越界，没有自动偏好注入、真实宿主保存或浏览器验收。外部harness和结果不进入release；未重跑全量或处理既有checker-platform问题。

Muyu `review-75ec948` 三项 P2 修复（2026-10-01）：角色记忆首次搜索绑定目录 revision，拒绝重排／删除／身份替换后的旧序号；账户存档发送预检按实际后端单条8 MiB／总32 MiB及未保存工作副本检查；账户长期记忆只接受明确肯定范围前缀，否定／引用词／冲突修正不能提升范围。新增6项正式回归，相关6文件专项 **173/173 通过**，包括真实控制器模型零调用、草稿及历史保留、容量重试和后端重开选择；独立静态检查 **PASS（557源码、11 JSON、226模块冒烟）**。没有调用付费模型或修改审计脚本，未重跑全量测试或声称已消除先前 checker-platform 超时回收问题。

Muyu 长期记忆第一阶段（2026-10-01）：账户设置独立仓库、关闭默认、账户／当前聊天范围、版本化增删查改、用户明确原话写入及按需字面检索。新增24项回归（领域/仓库/预算/配置档隐私20、控制器2、双语GUI2），覆盖异步失败和未知结果、私有记忆与对话共用修改队列、并发仓库替换、账户与聊天切换、修订冲突、模型衍生内容拒绝、全权限不绕过关闭、工具预算续接、编辑草稿保留、精确重复去重及未知写入不自动重试。最终串行全量测试 **1439 项，1438 通过、1 宿主契约跳过、0 失败**，历史 BUG **17/17**；独立静态检查 **PASS（557源码、11 JSON、226模块导入冒烟）**。最终默认并发合跑两次触发既有 `gd-checker-platform` 子进程超时测试的临时 `grandchild.pid` 缺失，单独重跑8/8通过；失败测试的已确认临时残留进程已清理。串行合跑测试全部通过，但当次综合 Result 仍为 FAIL，因此不记为完整合跑通过，静态另行复验通过；本轮未修改测试平台源码或提交并发配置。Node DOM 替身不能证明真实布局与键盘焦点；未声称已完成真实模型质量、浏览器或酒馆 settings.json 落盘验收。实现与后续范围见 [长期记忆合同](muyu/memory/README.md)。

Muyu 可选账户设置存储（2026-10-01）：新增默认关闭的账户设置存储开关，刷新后切换后端，不依赖附属插件或 IndexedDB；原后端记录保留，不自动迁移。新后端复用会话 DTO、账户身份检查和保存失败工作副本；限制单条8 MiB、总32 MiB，不截断旧记录。剧情配置档导出/导入/应用排除私人历史与存储偏好。新增13项回归（存储10、双语GUI2、控制器1），专项 **100/100** 与控制器 **101/101** 通过；全量 **1415 项，1414 通过、1 宿主契约跳过、0 失败**，静态检查及历史 BUG 契约 **17/17 通过**。覆盖刷新序列化恢复、局部版本冲突、删除后不复活、保存等待/失败、并发替换保留、容量与未知版本拒绝、附属插件零探测、账户切换及草稿不丢。没有真实浏览器/酒馆文件落盘验收；账户设置是整文档保存，跨标签页或设备并发覆盖不由本页版本检查保证，GUI明确建议单标签页和备份。

Muyu 资料片段检索（2026-10-01）：新增当前酒馆正文、指定角色记忆及同任务 Provider 缓存结果的字面检索与命中回读；共享有界扫描器，不重新执行 render。新增10项回归，覆盖授权前零读取、批准交接与任务到期、撤权、跨来源/任务/聊天引用拒绝、正文与角色身份变化、同条多次命中、扫描/代理对边界、缓存只执行一次及含元数据的共享预算；历史检索兼容专项共 **18/18 通过**。全量 **1402 项，1401 通过、1 宿主契约跳过、0 失败**，静态检查及历史 BUG 契约 **17/17 通过**；原有回执解释测试确认检索指引不进入无工具任务。没有付费模型或真实浏览器验收；字面检索不是语义搜索，按页变化检测不是全库原子快照。

Muyu 摘要模型参数分离（2026-10-01）：DeepSeek 摘要请求关闭思考，正式回答/工具续接仍遵循连接设置；通用兼容接口不发送专有思考字段。摘要默认16384，自动初次最多16384，已保存自定义值保留；截断只在可提高额度且预算允许时有界重试，默认同额度不反复调用。新增3项回归并更新预算/GUI旧默认断言，覆盖适配器计量/解码、普通私有思考回传不受影响、非法覆盖网络前拒绝、截断不发出半截摘要、迁移保持明确配置。全量 **1392 项，1391 通过、1 宿主契约跳过、0 失败**；静态及历史 BUG 契约 **17/17 通过**，GUI文案最终修改后另测 **57/57**。外部 `compression-acceptance-live.mjs --live --summary-separated` 两轮共8次真实DeepSeek请求；最终120轮（130644字符）摘要5.4秒、210轮滚动摘要加回答6.7秒，3/3流程检查通过，最新修订、未知状态、操作/保存边界及两项待办回忆正确。首轮摘要误把讨论主题放入待办区，补充讨论不自动成为交付目标的规则后重跑；原结果单独保留。摘要来源标注和其他未断言事实仍需人工核对，这不是百万Token、浏览器、原文检索工具或任意模型质量验收。

Muyu 摘要待办来源（2026-10-01）：摘要分别记录用户未完成目标、助手建议/必要实现步骤、未知与条件阻塞；最新取消、拒绝、完成和范围收窄优先，普通回复遵循同样的恢复边界，不改变存档结构或授权。新增请求/恢复指令集成回归；全量 **1389 项，1388 通过、1 宿主契约跳过、0 失败**，静态检查及历史 BUG 契约 **17/17 通过**。外部 DeepSeek 合成实测共11次请求：五组摘要→恢复对照（10次）人工核对均未扩张用户待办，必要实现步骤保留；原字面检查仅1/5通过，另外四组因同义表述及否定范围约束误判，原始结果与单独人工复核记录均保留。120轮长历史另一次请求在8192输出上限下截断，未提交摘要，原文/旧摘要保留；该长历史语义验证未通过。提示词改善不构成语义正确性保证，无真实酒馆数据或浏览器验收。

Muyu 300秒可配置时间预算（2026-10-01）：整轮默认300秒，压缩新增独立 `summaryTimeMs` 默认300秒，GUI均支持10–1800秒。手动压缩受两者较小值限制；自动压缩受剩余整轮预算限制并保留10秒收尾，截断重试不重置期限。未标记旧默认升级，明确保存的预算保持不变。新增3项测试并扩展GUI用例，验证超过30秒可完成、超时/迟到结果隔离、校验持久化及迁移；全量 **1388 项，1387 通过、1 宿主契约跳过、0 失败**，静态检查及历史 BUG 契约 **17/17 通过**。DeepSeek真实9次请求：120轮手动压缩22.8秒完成，210轮滚动压缩及追问26.3秒完成；关键修訂数值正确，但待办扩张复现，原文检索耗尽外部脚本5次调用预算，整套语义验收未通过。结果保存在外部 harness 的 `compression-300s-results.json`，不进入release；没有真实酒馆数据或浏览器验收。

Muyu 存档/范围审计修复（2026-10-01，`review-ec7638b`）：修复近满记录的回答漏存、浏览器可选迁移满额阻断已有服务端历史、跨 ST 聊天手动整理先调用模型再失败。新增 8 项回归；四组专项 **179/179 通过**，全量 **1385 项，1384 通过、1 宿主契约跳过、0 失败**；静态检查与历史 BUG 契约 **17/17 通过**。验证了零调用预检/草稿保留、越界恢复导出、迁移待处理和删除后刷新重试、原聊天整理正向对照及 GUI 提示。没有付费模型请求、服务端插件变更或原生浏览器验收；恢复 JSON 是独立备份，不可作为普通记录导入。

Muyu 档案生成 Prompt 批次（2026-09-25）：`profileGeneratorPrompt` 接入选择性读取、预览及逐份确认；保留角色字段和已注册 Provider 占位符、空串恢复默认、生成中禁写及经典编辑器聚焦草稿。全量 **1099 项，1098 通过、1 跳过、0 失败**；静态检查与历史 BUG 契约 17/17 通过。真实浏览器和付费模型尚未验收。

Muyu 点评输出示例批次（2026-09-25）：`critiqueSchema` 接入选择性读取、结构预览及逐份确认；非空新草稿须为有界 JSON 示例，空串恢复默认，保留经典界面未聚焦同步与聚焦草稿。全量 **1096 项，1095 通过、1 跳过、0 失败**；静态检查及历史 BUG 契约 17/17 通过。真实浏览器和付费模型尚未验收。

Muyu Prompt 配置批次（2026-09-25）：`summaryPrompt` 与 `critiquePrompt` 进入选择性读取、预览和逐份确认流程；空值回退内置 Prompt，生成中禁止写入，重生成旧记录仍优先使用记录内 Prompt。专项测试覆盖授权、Schema 不变、长文本边界、旧草稿失效和经典编辑器焦点保护。全量 **1093 项，1092 通过、1 跳过、0 失败**；静态检查及历史 BUG 契约 17/17 通过。真实浏览器和付费模型尚未验收。

Memory-limit action (2026-09-25): `muyu-memory-limit.test.mjs` covers a single-field, current-chat-bound preview; anonymized per-character counts; zero raw-memory exposure; stale memory/chat rejection; one approved global save followed by chat pruning; and partial/unknown outcomes for save failure, a new generation, concurrent edits, or chat switching. `muyu-settings.test.mjs` retains the 40-field inventory and legacy four-field draft compatibility. Full suite: **1081 tests, 1080 passed, 1 skipped, 0 failed**; static checks and historical BUG contracts 17/17 passed. Real-browser and paid-model acceptance remain manual.

Memory-setting closure (2026-09-25): `muyu-settings.test.mjs` now checks `memoryKeepRecent` contract, 1–100 tool range, dependency freshness, exact diff, sibling preservation, and one-time application. The legacy four-field memory draft remains unchanged. `memoryTokenBudget` is explicitly inactive in the classic UI and is not offered as an agent-write field; `memoryMaxEntries` remains pending a chat-data pruning action. Full suite: **1074 tests, 1073 passed, 1 skipped, 0 failed**; static checks and historical BUG contracts 17/17 passed. No live-browser or paid-model acceptance was performed for this change.

Configuration domains round 1 (2026-09-25): `muyu-settings.test.mjs` and unified controller cases cover the explicit default-key inventory, selective reads, separate config permission, default-deny tool policy, nested sibling preservation, semantic conflicts, runtime guards, one-shot approval, async save failures, long prompts/receipts, inert history import, and invalid replacement candidates. Full suite: **1042 tests, 1041 passed, 1 skipped, 0 failed**; static checks passed; historical BUG contracts 17/17. Report: `.bug-hunter/muyu-settings-round1-tests.json`. No paid-model or real-browser acceptance was performed. The registered 13 leaf fields and remaining scope are documented in [the configuration contract](muyu/config/README.md).

Provider 扩展基础（2026-09-25）：用户脚本加载器的私有源码摘要在恢复后保持一致；运行实例替换时拒收迟到结果；可选上下文声明报告缺失并提供有界投影；Provider 执行 v2 的长结果在同一 Run 分页读取且不重复执行，Broker 按原版本授权检查每页。全量 1024 项，1023 通过、1 跳过、0 失败；随后补充的 Broker 分页授权用例另行专项通过，其他代码未变。历史 BUG 合同 17/17。

Registered Provider execution (2026-09-25): `muyu-provider-execution.test.mjs` verifies metadata discovery without render, exact script/version/task/chat approval, denial, replacement, async stale results, legacy render context, content/data projection, legacy-mode isolation, and history withholding/restoration. Panel tests verify the code-execution disclosure and absence of persistent execution approval. Full suite: 1020 tests, 1019 passed, 1 skipped, 0 failed; historical BUG contracts 17/17. This synthetic suite does not establish that arbitrary user JavaScript is sandboxed or side-effect-free.

Provider story-source stage (2026-09-24): `muyu-story-sources.test.mjs` covers raw variable values, chat-local global scope, missing/default separation, blueprint hierarchy and unpruned signals, no mutation, opaque identities, malformed/oversized data, pagination/Unicode, stale snapshots and budgets. Unified controller cases additionally verify zero pre-grant reads, independent source grants, denial, global-session rejection and history expiry. Targeted: 317/317. Full: 1013 tests, 1012 passed, 1 skipped, 0 failed; historical BUG contracts 17/17. No paid-model or browser acceptance is implied.

Unified Muyu assistant (2026-09-24): `muyu-unified.test.mjs` covers mixed-tool tasks, lazy draft binding, source-level denials across alternate readers, task-grant expiry and history withholding/restoration, explicit history omission, global/chat scope, reconnect and legacy read-only sessions. Panel tests cover Chinese/English unified entry points without pre-send permission or task selectors. Targeted: 309/309. Full: 1005 tests, 1004 passed, 1 skipped, 0 failed; 17/17 historical BUG contracts. No new paid-model or browser acceptance is implied.

Muyu config application (2026-09-24): `muyu-config-apply.test.mjs` and controller/panel
integration cover explicit one-shot approval, immutable drafts, final baseline checks,
save exceptions/unconfirmed receipts, concurrent edits and reconnect drain. Production
ST persistence is conservatively unconfirmed; see `muyu/actions/README.md`.

Muyu on-demand permissions (2026-09-24): `muyu-permissions.test.mjs` plus controller/UI
coverage verify source/task/chat isolation, rollback, zero unauthorized reads, denial,
history/summary guards, stale requests and the shared six-handoff ceiling. See
`muyu/permissions/README.md`. Deterministic tests do not imply browser or live-model acceptance.

Muyu clarification stage (2026-09-24): added bounded request/store/runtime tests,
same-task continuation and scope invalidation checks, three-question cap, draft/remount
UI coverage, and pending-drain/late-result cases. See `muyu/interactions/README.md`.
The separate synthetic DeepSeek harness exercises question/draft/answer/clear-query
flows; its model-output review is distinct from deterministic and browser acceptance.

GD Test Lab is the repository-wide automated test platform for Group Director.
It combines static validation, automatically discovered behavior tests, a reusable
fake SillyTavern host, optional real-host contract checks, coverage, and machine
readable reports.

Latest navigation/feature-migration check: 44/44 targeted tests pass, including
complete route coverage across primary and collapsed entries and a CSS contract for
the overview disclosure button's bounded content width, live profile control identity,
classic order restoration, dynamic results, language updates and listener cleanup.
Director/memory/summary coverage also verifies mode/enable ancestry, result-before-action
ordering, More disclosures and template grouping with summary status outside switched views.
The compact-page checks cover simultaneous basic/settings visibility, no view
buttons, on-demand editor expansion, connection visibility and classic restoration.
All-page disclosures additionally validate 12 curated ranges against the real
template, exact restoration, library navigation, language refresh, core-editor/error
visibility and non-mutating failure on an invalid mapping.
The profile tree fixture does not simulate CSS layout. Browser visual and keyboard
acceptance remains manual.

Control board checks add six quick-action behavior tests for disabled/no-chat/round
guards, shared locks and panel rebuild reuse, partial and total failure, chat-switch
batch termination, subscriber cleanup and mode/limit validation. An assembly contract
checks route IDs, shared action delegation, cleanup and board return-scroll wiring.
These do not substitute for real-host DOM, keyboard or layout acceptance.

The b69f6c8 follow-up adds seven state regressions: actual round-handler transitions
refresh mounted board controls; both speaker inputs restore rejected values; the
single debug control retains its listener and classic position; blueprint detail
status clears after successful, failed and blocked continuation via the shared adapter.
Six follow-up regressions preserve JSON and prompt drafts when an old continuation
settles after a chat switch, panel rebuild, or both (success and rejection paths).
The fixture also transitions continuePending from true to false while rebuilding:
the current panel must clear stale running text without a full editor refresh.

Current verified baseline (2026-09-19):

- 330 JavaScript source files and 11 JSON files pass static validation;
- 693 behavior tests are discovered, with 692 passing and one optional real-host
  contract skipped when `GD_TEST_ST_ROOT` is not configured;
- all 17 historical regression-contract IDs are represented;
- entry-point reachability is 157/165 production modules, while tests directly or
  transitively reach 86/165 production modules;
- 79 production modules are currently not test-reachable. The full JSON report
  preserves their paths, while the console groups them by top-level area;
- the pre-navigation loaded-module coverage snapshot (not remeasured for the
  navigation preview) is 94.95% lines, approximately 80.0%
  branches (the seeded suite can vary by a few hundredths), and
  92.41% functions. All eight built-in Agent modules are test-reachable; Custom
  Prompt validation reaches 98.95% lines / 93.75% branches, and Custom Prompts
  System reaches 98.36% lines / 88.50% branches / 100% functions. Memory
  System, Variable System, Memory Export, and Story Blueprint now reach 98.75%,
  96.53%, 99.32%, and 98.30% lines respectively, while Profile System reaches
  92.03% lines, 70.10% branches, and 87.18% functions. User Provider Loader now
  reaches 96.26% lines, 80.12% branches, and 84.00% functions; Script Executor
  System reaches 90.60% lines, 77.36% branches, and 93.62% functions;
  History, World Info, Asset Loader, and Summary Export reach 100% lines;
  NPC Export reaches 96.60% lines with its new transaction branches;
  NPC Library reaches 98.15% lines; Profile Library and Story Blueprint Library
  reach 96.96% and 98.66% lines respectively; Chat Summary System reaches 92.89%
  lines, 65.15% branches, and 93.33% functions;
  NPC System reaches 95.73% lines, 71.43% branches, and 70.00% functions;
  Group ZIP Import/Export reaches 89.84% lines, 82.68% branches, and 85.71%
  functions; PostSpeech Decision Store reaches 98.33% lines and 92.37% branches;
  PostSpeech Executor reaches 100% lines/functions and 96.55% branches;
  `prompt-renderer.js`, `utils/custom-api.js`, and `systems/agent-runtime.js`
  independently reach 92.86%, 96.91%, and 91.98% lines.

The reachability numbers are diagnostics, not success targets. A module can be
entry-reachable without being safe, and test reachability is not line coverage.

The workflow in `.github/workflows/gd-test.yml` runs the full platform on Windows
and Linux with Node 22 and 24 for every push and pull request, then uploads the
JSON report even when a test fails.

## Commands

Navigation preview verification adds six model tests and three assembly contracts:
classic defaults, per-area history, preference failure handling, exclusion of
private data, complete legacy-card routing, presentation-only switching and
navigation cleanup during settings reload. These tests do not verify DOM layout,
focus behavior, or browser interactions. Manual checks at 320/400/600/800px,
keyboard flows, and real-host switching remain pending; see `UI-REWORK.md`.

Install the development-only JavaScript parser before running the test platform:

```powershell
npm ci
```

Acorn is used for static import analysis (including string-literal dynamic imports).
It is not a runtime dependency of the SillyTavern extension.

```powershell
npm test
npm run test:static
npm run test:unit
npm run test:integration
npm run test:full
npm run test:coverage
```

Run a subset by file name or test name:

```powershell
node tools/gd-test/cli.mjs full --filter postspeech
```

Reproduce or vary property/fuzz cases:

```powershell
node tools/gd-test/cli.mjs quick --seed 20260726
```

Write a JSON report:

```powershell
node tools/gd-test/cli.mjs full --report test-results/full.json
```

Enable contract tests against a real SillyTavern checkout:

```powershell
node tools/gd-test/cli.mjs full `
  --st-root "E:\path\to\SillyTavern-release"
```

Alternatively set `GD_TEST_ST_ROOT`.

## Profiles

| Profile | Checks |
|---|---|
| `static` | JavaScript syntax, JSON parsing, manifest references, relative imports, merge markers, invalid replacement characters, isolated module-import smoke tests |
| `unit` | Pure modules and factory contracts |
| `integration` | Fake SillyTavern scenarios and optional real-host contracts |
| `quick` | Static + unit + regression |
| `full` | Every available check and test |

## Test platform architecture

GD Test Lab separates four responsibilities:

```text
cli.mjs
  -> core/options + core/runner + core/test-runner
  -> core/project-index
  -> checks/**/*.check.mjs (automatic discovery)
  -> reporters/console + reporters/json
```

`project-index.mjs` builds shared project facts once. Each static checker owns one
rule domain and returns structured counts/issues without printing or writing.
`check-runner.mjs` validates contracts, applies deterministic `order -> id`
ordering, runs checker loading and execution in terminable Worker Threads,
isolates crashes/timeouts, and aggregates results. A timeout waits for
`worker.terminate()` before the next checker starts, so timed-out code cannot keep
running or retain event-loop handles. The compatibility
entry at `lib/checks.mjs` contains no concrete rules.

To add a static checker, create one `tools/gd-test/checks/*.check.mjs` file and its
tests. Do not add branches to the CLI or runner. The complete Checker v1 contract
is documented in `tools/gd-test/checks/README.md`.

Behavior tests remain native Node `node:test` files discovered from
`tests/**/*.test.js` and `tests/**/*.test.mjs`; checker plugins are not a
replacement test framework.
The normative Behavior Test v1 development standard is documented in
[`tests/README.md`](tests/README.md).

Tests are discovered automatically from `tests/**/*.test.js` and
`tests/**/*.test.mjs`; no central list needs to be maintained. Tests that mutate singleton registries must clean up with
`t.after()`. Test files run with concurrency 2; each file must therefore own its
fixtures and must not depend on execution order. Tests that manipulate browser-like
globals must restore them before completion.

When the `quick` or `full` profile runs without a filter, GD Test Lab also checks
that all 17 confirmed historical bug IDs appear in executed test names. The
gate reads structured test events and only accepts passing, non-skipped, non-TODO
test cases; console output and suite names do not satisfy a contract. A filter
matching no test cases fails, including when Node reports only a passing file wrapper.
The required IDs live in `gd-test.config.mjs`; deleting or accidentally renaming the
last scenario for any historical bug therefore fails the run even if every
remaining test passes. BUG-9 is intentionally absent because it was excluded from
the confirmed audit set.

The current historical contracts cover:

- async memory provider resolution and quoted path parsing (BUG-1, BUG-2);
- custom prompt overwrite and per-character auto-memory progress (BUG-3, BUG-4);
- deferred capability timing, completion bookkeeping, loader injection and
  capability removal/revision invalidation (BUG-5 through BUG-8);
- prompt cleanup and immutable script snapshots (BUG-10, BUG-11);
- ledger text safety, scope persistence, variable collision protection, trace
  normalization, localized world-book source labels, native timeout isolation,
  and listener deduplication (BUG-12 through BUG-18).

Regression files are organized by business feature (`memory-provider`,
`capability-scope`, `execution-trace`, etc.), not collected into a growing
`historical-*` module. BUG IDs identify durable contracts but do not determine
file ownership.

Static module smoke tests are also discovered automatically under `agents/`,
`systems/`, and `utils/`. Modules that transitively import SillyTavern browser
files are classified as host-dependent and left to integration tests.

The static summary reports module reachability from both the extension entry point
and the test suite. Test reachability is not line coverage, but it immediately
shows which production modules have never been loaded by any automated test.
Node's percentage coverage only describes modules loaded during that run. Coverage
collection includes root production JavaScript plus `agents/`, `assets/`, `systems/`,
`ui/`, and `utils/`, but Node omits matching modules that were never loaded. GD Test
Lab therefore stores `moduleReachability.productionModules`, `testReachableModules`,
and `testUnreachableModules` in the static report. Use those lists together with the
percentage instead of treating loaded-module coverage as whole-project coverage.

## Round lifecycle coverage

The takeover flow is intentionally tested at three boundaries:

| Boundary | Primary modules/tests | Contract |
|---|---|---|
| Pure transition rules | `round-state.js`, `round-finalization.js`, `takeover-scheduler.js`; unit tests | No hidden state; mismatches, rerolls, finalization gates, and queue filtering are deterministic |
| Stateful coordination | `round-orchestrator.js`; `tests/integration/round-orchestrator.test.mjs` | One owner advances remaining speakers, retries failed plans, preserves completed speakers, and exposes finalization readiness |
| Host-facing execution | fake host plus `takeover-execution.test.mjs` | Ordered generation, request failure, nested wrappers, rerolls, and user stop behave correctly across asynchronous calls |

`index.js` should remain the event-and-side-effect adapter. New takeover rules
belong in the pure modules or orchestrator so they can be tested without importing
the SillyTavern browser runtime.

Import validators should be tested with malformed values at every nesting level,
including `null`, arrays where objects are expected, primitives, missing strings,
and invalid array elements. Validation failures must return structured results and
must not escape into UI event handlers as exceptions.

Variable import transaction coverage belongs in
`tests/unit/variable-system-import.test.mjs`. Tests must use a deferred persistence
promise and cover both synchronous/asynchronous rejection. On failure they must
assert that imported definitions, values, and log entries are removed while
concurrent work is retained. This includes an unrelated variable update and an
append to the same array variable; the latter must restore the pre-import sequence
and replay only the concurrent array delta. A separate save-success/chat-switch
test must capture the old chat's persisted snapshot and assert it still matches
memory when import or explicit compensation reports stale; the new chat must stay
untouched.

Profile persistence coverage belongs in `tests/unit/profile-system-data.test.mjs`.
Both direct saves and active-to-archive moves must await chat persistence and undo
only the mutation that is still present when persistence rejects. Deferred-save
tests cover restoration of prior active/archive values plus concurrent changes to
the same avatar and unrelated profiles. Generation staleness remains covered by
`tests/unit/similar-agent-concurrency.test.mjs`.

Chat Summary persistence coverage belongs in
`tests/unit/chat-summary-system.test.mjs`, with UI delegation and rejected-save
feedback in `tests/unit/chat-summary-ui.test.mjs`. Generation, regeneration,
content edits, revert, reset, pruning, and clearing must serialize system-owned
writes, remain bound to their original chat metadata, and compensate only their
own entries or fields. Deferred-save tests cover concurrent edits/additions,
restored ordering, queued target identity, incomplete rollback reporting, and a
successful old-chat save followed by a chat switch. Public reads must be detached
snapshots; UI tests prohibit direct summary array mutation and direct chat
persistence. A deferred prune must lock stale scan-number edits while persistence
is pending and rebuild the scan from current memory before unlocking on success,
rollback, or `persistenceUnknown`; an unknown readback after a successful write
must never leave old indexes editable. `tests/unit/chat-metadata-save-confirmation.test.mjs`
covers group and character readback, swallowed host failures, concurrent state,
and unavailable verification. A definite stored-state mismatch must enter normal
transaction compensation; `persistenceUnknown` must reject while retaining the
possibly persisted in-memory Summary state.

NPC Library persistence coverage belongs in `tests/unit/npc-library-system.test.mjs`,
with UI feedback and malformed legacy rendering in `tests/unit/npc-library-ui.test.mjs`.
Deferred-save cases must cover save, delete, and file import rejection while a
different library entry changes; failed downloads must release both temporary DOM
and Blob URL resources. Application through NPC Export is tested separately.
The production adapter calls the host's direct settings save and requires its
`SETTINGS_UPDATED` success event; a swallowed save failure without that event
must reject and remove the temporary listener. The dashboard delete handler
must await rejection, show an error, and refresh after rollback. The host event
has no request ID, so concurrent host saves are not strictly attributable.

Profile and Story Blueprint Library persistence coverage belongs in
`tests/unit/profile-library-system.test.mjs` and
`tests/unit/story-blueprint-library-system.test.mjs`, with awaited UI feedback in
`tests/unit/library-ui-persistence.test.mjs`. Save, delete, import, and auto-load
setting mutations must await confirmed settings persistence, serialize overlapping
writes, and compensate only their own entry or fields. Deferred-save tests retain
concurrent neighbors and newer field values. Save-current tests also switch chats
behind a blocked earlier write and require the queued entry to retain the source
name and detached payload captured at invocation. Story Blueprint library application
uses one awaited chat save through `applyImportTextAndSave`; a failed save performs
three-way rollback that removes imported state while retaining concurrent object
and array edits, followed by a compensating save; failed compensation is reported
as incomplete rather than atomic success. Production imports confirm the original
chat header after the host save; unavailable readback preserves the imported memory
and reports `persistenceUnknown` without compensation. Library download tests require temporary anchors and Blob URLs to
be released even when the synthetic click throws.

NPC Export import application coverage belongs in `tests/unit/npc-export-system.test.mjs`.
Both direct import and NPC Library application share this boundary. Tests must cover
synchronous/asynchronous chat-save rejection, operation-local rollback after
unrelated and same-NPC edits, prompt-only import, observable settings-save failure
and failed compensation, and a chat switch after successful persistence. Newly
imported NPCs edited concurrently are preserved with an explicit incomplete
rollback error. NPC Library UI must report application rejection without success
feedback; the production debounced settings callback cannot prove later disk writes.

NPC System mutation coverage belongs in `tests/unit/npc-system.test.mjs`, with
generation staleness and irreversible character-card import in
`tests/unit/similar-agent-concurrency.test.mjs`, and edit/delete feedback in
`tests/unit/npc-ui.test.mjs`. Deferred-save tests must cover synchronous and
asynchronous rejection, unrelated and same-NPC concurrent edits (including a
later same-value write), delete ordering after list replacement, generated
additions edited while saving, and chat switches after successful persistence.
Generation reports only NPCs actually added; UI feedback must wait for save.
Remote character-card creation remains a separate follow-up boundary.

Group ZIP import/export coverage belongs in `tests/unit/export-import-system.test.mjs`,
with rejected UI actions in `tests/contract/export-import-ui.test.mjs`. Import tests
must prove malformed manifests, unsafe or duplicate paths, missing member cards,
and corrupt world books make no remote requests. Host responses with HTTP 200 but
no character filename count as failures. A failed required card must not create a
group, while any attempted remote write must yield an incomplete/inspection
warning rather than a definite no-resource claim. Tests
also verify avatar remapping, avoidance of known world-book name collisions,
collision-safe mappings for valid filenames whose basenames resemble another card,
cross-call world-book reservations against both earlier imports and a replaced live
host name list, partial export manifest membership, original-chat export snapshots,
and cleanup of temporary download nodes and Blob URLs on failure. HTTP-success responses
with empty card bodies or invalid world-book payloads must not enter an export
archive that the importer would reject. Remote uploads are not a
rollback transaction; tests must not pretend partial success is atomic.

PostSpeech Executor coverage belongs in `tests/unit/executor.test.mjs`, while the
historical round-end and stale-Capability contracts remain under regression tests.
The unit suite owns malformed-intent filtering, exact/alias/fallback resolution,
disabled capabilities, numeric schema coercion and rejection, immutable nested
params and defaults, immediate and
round-end scheduling, blocking/non-blocking receipts, callback isolation, live
Capability resolution, and deferred-input validation. Unknown timing values must
log and fall back to immediate execution rather than silently becoming round-end
work. Both synchronous and asynchronous `onExecuted` failures are isolated, and
the callback contract applies in blocking mode as well.

User Provider/Capability lifecycle coverage belongs in
`tests/unit/user-provider-loader.test.mjs`. Modules must be exercised through real
dynamic import semantics, including asynchronous `register()` rejection, partial
registry mutation, and Blob URL cleanup. Deferred-save cases assert operation-local
rollback for import, delete, restored-ID persistence, and capability toggles while
preserving unrelated concurrent edits. Restore tests also own actual-ID refresh,
same-owner definition compensation, hot-reload ghost cleanup, and cross-owner
collision protection. `tests/unit/capability-registry.test.mjs` owns the registry's
same-owner refresh and owner-checked unregister contract; the UI contract verifies
that rejected persistence is reported and controls are released in `finally`.
Timeout coverage uses a short injected registration deadline and must exercise
stalled module evaluation, never-settling async `register()`, partial rollback,
late Provider/Capability rejection, continued restore of later assets, and Blob
URL cleanup. Production uses the loader's 10-second default.

Custom Prompt coverage is split across `custom-prompt-validation.test.mjs`,
`custom-prompts-system.test.mjs`, `custom-prompts-transaction.test.mjs`, and the
UI safety contract. The shared validator owns complete entry/export shapes and
fresh config-profile IDs. Deferred-save tests require rejected mutations to
restore only their own fields while preserving concurrent edits; lifecycle tests
own cross-Provider collision protection, hot-reload ghost cleanup, master/item
toggles, import identity, and Blob/anchor cleanup. UI mutations must await the
system Promise before showing success.

Config Profile JSON, ZIP, and built-in preset manifests share one validation
boundary. Applying a profile prepares settings on a detached copy, imports
variables only after preparation succeeds, and rolls live settings/variables back
when the transaction fails. JSON imports discard endpoint configuration and
name-only Provider/Capability stubs; ZIP imports may restore matching script
sources. Tests must also cover concurrent unrelated setting edits while variable
persistence is pending, concurrency-safe compensation after a later settings
failure, and list rollback when save/delete/import/preset persistence throws.
JSON/ZIP export tests own credential stripping, executable-source isolation, asset
packaging, variables, and download cleanup. UI handlers report apply/save/delete
failures without running success refreshes. The apply-handler contract also keeps
the Prompt merge-mode declaration outside its `try` block because the
post-refresh success message reads that mode after the block completes.

Script Executor tests follow the same boundary rule. The pure validator owns the
version-1 file and entry contract, while system tests cover candidate validation,
single-save batch import, conflict overwrite/skip/cancel behavior, persistence
rollback, execution ordering, trigger filtering, error isolation, and per-instance
turn state. The UI contract verifies that import/export handlers delegate to the
system instead of performing incremental `add`/`remove` mutations. Config Profile
imports reuse the validator and replace external executor IDs before storage.
CRUD tests inject both synchronous throws and asynchronous save rejections,
verify operation-local rollback and concurrent unrelated edits, require
overlapping CRUD saves to serialize, and require Promises to settle only after
the callback settles. The UI contract requires
every CRUD call to be awaited before refresh. SillyTavern's current debounced
settings save does not expose its network result, so these tests verify the
observable callback contract, not a guaranteed server commit.
Runtime tests use short injected timeouts and deferred Promises to verify that
timed-out scripts cannot mutate nested shared state, retained return values and
decision copies do not alias committed state, and an old message execution stops
launching scripts after a turn reset. Error isolation still lets subsequent
scripts run within the same live turn.

Custom Agent coverage uses the same layered contract: the validator owns field,
Schema, duplicate-ID/provider, and disabled-import rules; the system suite owns
transactional CRUD/import, Provider lifecycle, request deduplication, stale chat
and config rejection, and result/checkpoint rollback. The pure auto coordinator
tests first-enable, normal interval, ordering, and deletion-reset decisions. UI
tests should verify delegation only—the section must not mutate `customAgents`,
`_caData`, or `_autoCAG_*` directly.
Configuration tests also inject asynchronous settings-save rejection across CRUD
and import, verify serialized saves and operation-local rollback under concurrent
edits, and require the UI to await mutations. Execution tests interleave failed
chat saves with newer result or counter writes (including the same counter value)
and switch chat/configuration during a pending save. These tests verify the
observable save-callback contract; SillyTavern's debounced settings save does not
expose a guaranteed network commit result.

Critique coverage follows five independent boundaries: parser tests own balanced
JSON extraction and noisy model output; validation tests own nested critique and
export contracts; repository tests own activation, `basedOn` revert, pruning, and
persistence rollback; execution tests own the shared lock and quiet-prompt cleanup;
and the auto coordinator tests first-enable, interval, deletion reset, and
checkpoint rollback. System tests cover prompt reuse, raw-text fallback, stale-chat
rejection, and edited-result persistence. The UI contract forbids direct history
mutation, JSON parsing, and chat persistence from the section module.

Deferred-save Critique tests also interleave failed add/update/revert/reset/prune
with newer edits, including different fields on the same record. Auto-coordinator
tests cover a newer checkpoint surviving an older failed save and chat switches
during `beforeExecute` or counter save. System tests require stale rejection when
the chat switches during generation or regeneration result save; an already
successful old-chat save is not rolled back.

Imported Critique tests use deferred saves to interleave failed add, update,
and delete with newer mutations, including same-value field writes and changed
neighbor positions. They check save-time chat switches and old-chat-only
compensation. Export tests verify Blob URL and temporary anchor cleanup on
success and thrown download steps; UI tests require failed import/export to
show only an error notification.

## Asynchronous result consistency coverage

`tests/unit/similar-agent-concurrency.test.mjs` owns the shared concurrency contract
for Summary, Memory, NPC, Profile, and Story Blueprint. Deferred promises create
deterministic interleavings for chat switches, in-place message appends, manual
edits, reverts, compression, and stale LLM responses. A valid stale rejection must
use `StaleExecutionError` and leave the newer state untouched.

External side effects have a separate contract. NPC character-card tests verify
that staleness is checked before the create POST, successful creates reconcile by
stable `importId` even when a same-timestamp sibling exists and the target is
renamed, and tracking-save failure surfaces `NpcImportTrackingError` with the
created `avatarName`. The in-memory receipt remains marked imported so a later
successful chat save can flush it, while the UI warns against retrying the create.

## UI safety coverage

DOM-heavy sections keep event wiring and element mutation in the section module,
while security-sensitive transformations live in small pure helpers imported by
that same production module. Current contracts cover:

- Custom Agent UI numeric bounds and treating selector syntax as plain `data-id`
  text; field allowlisting, trusted IDs, and disabled imports live in the shared
  system validator tests;
- Execution Trace stage rendering with encoded names, errors, and output keys;
- Dashboard profile summary display formatting kept separate from the raw editor
  value, so tags, motivation labels, and `<br>` markup are never persisted;
- Profile management HTML-encodes avatar attributes and locates edit panels by DOM
  ancestry rather than interpolating imported avatar strings into element IDs.
  Loader/card failure paths must catch rejected promises, report an error, and
  restore disabled buttons in `finally`.

Prefer this boundary over copying UI logic into tests or building a broad fake DOM.
Use a browser-level contract only when the behavior depends on event propagation,
focus, layout, or a SillyTavern-owned widget.

## Writing behavior tests

This section is a quick-start summary. File ownership, naming, isolation,
concurrency, regression, and review requirements are normative in
[`tests/README.md`](tests/README.md).

Use `node:test` directly for pure modules:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('a stable behavior contract', () => {
    assert.equal(subject(), expected);
});
```

Use the scenario helper when a test needs SillyTavern state:

```js
import { scenario } from '../harness/scenario.mjs';

scenario('group lifecycle example', async ({ host, assert }) => {
    host.queueResponse({ type: 'resolve', value: 'model output' });
    const result = await host.generateRaw({ prompt: 'probe' });
    assert.equal(result, 'model output');
});
```

`FakeSillyTavernHost` supports:

- sequential asynchronous events compatible with SillyTavern;
- multiple simultaneous `generateRaw` requests;
- global stop and optional request-scoped cancellation;
- queued resolve/reject/pending model responses;
- chat, characters, groups and chat metadata;
- request, save and stop counters;
- condition waiting and deterministic cleanup.

For parsers, validators and state transformations, use the deterministic property
helper. It prints the seed, case number, and generated input on failure:

```js
import { property } from '../harness/property.mjs';

property('all generated values preserve an invariant', { cases: 500 },
    random => random.string({ maxLength: 40 }),
    value => assertInvariant(value),
);
```

## Test strategy

Every fixed bug should receive a regression test describing the desired behavior,
not the implementation. Large workflows should be decomposed into testable
coordinators with dependencies injected through factories. Real-host contract tests
protect the fake host from drifting away from SillyTavern semantics.

The platform automates execution and verification, but it cannot infer all business
requirements by itself. Coverage grows by converting each accepted behavior,
reported bug, and important lifecycle into a scenario. Unknown-bug discovery still
requires review, fuzzing, or exploratory testing.

## Muyu Agent kernel addition (2026-09-24)

The Muyu foundation, runtime, application, workspace and classic UI have 151 focused tests in
`tests/unit/muyu-foundation.test.mjs`, `tests/unit/muyu-execution.test.mjs`,
`tests/unit/muyu-application.test.mjs`, `tests/unit/muyu-model.test.mjs`,
`tests/unit/muyu-memory.test.mjs`, `tests/unit/muyu-config-draft.test.mjs`,
`tests/unit/muyu-controller.test.mjs`, `tests/unit/muyu-panel.test.mjs`, and
`tests/contract/muyu-boundaries.test.mjs`. They use scripted model events and an
injected clock; no API keys, network, ST session, or UI are required. Coverage
includes cancellation, bounded waits, call/result pairing, deduplication,
permissions, argument/output checks, budgets, and the core import boundary.
Application tests cover physical drain gating, queue limits, chat ownership,
subscription remounting, task continuation, artifact revisions and capacity.
The `muyu` directory is now included in module smoke checks and coverage selection.
This does not establish full-suite coverage or real-model/host compatibility.
Implementation limits are documented in [muyu/README.md](muyu/README.md).

Classic UI checks cover mount/dispose subscriptions, input preservation, consent reset,
text-only rendering, connection credential clearing and one-click/keyboard submission.
Controller tests cover target identity, physical drain, chat changes, global drafts,
trusted publication and stale validation. The DOM double does not validate layout.
Browser acceptance is pending (no browser was available on 2026-09-24): test
320/400/600/800px containers, keyboard focus, Chinese/English, panel rebuilding,
chat-switch cancellation and a real DeepSeek request from the ST origin (including
CORS failure reporting). Do not infer browser success from Node harness results.

Manual follow-up (2026-09-24): after syncing both local release extension directories,
the user reported successful operation with no issues. This confirms a basic real-host
smoke run, not exhaustive completion of the browser checklist above. Automated baseline:
101 Muyu tests passed; full suite 794 tests, 793 passed, 1 skipped, 0 failed; static PASS.

Floating UI follow-up: `tests/unit/floating-ui.test.mjs` verifies generic module registration,
badge aggregation, unregistration, single-window mounting, focus return, language remount,
drag handling and viewport constraints. Muyu panel tests also cover standalone subscription,
input recovery and authorization reset on reopening. These tests do not establish real-browser
layout, native resize, touch input or host z-index compatibility; the earlier user smoke run
predates the floating window.

Floating implementation validation: full suite 801 tests, 800 passed, 1 skipped,
0 failed; static PASS. The six generic floating-shell tests are separate from
the 102 Muyu-specific tests. No browser geometry verification was performed.

Chat-first UI iteration adds bubble toggle, hidden settings/return navigation, unsent-key
clearing, input preservation, pre-send authorization, task selector and message bubble tests.
The current generic floating tests number seven; the Muyu-specific tests number 105.
Ctrl+Enter opens the confirmation card only, and no model call occurs before explicit consent.
Validation: full suite 805 tests, 804 passed, 1 skipped, 0 failed; static PASS.
Visual layout and real-host interaction for this iteration still require manual acceptance.

Process observability adds `tests/unit/muyu-process.test.mjs` for safe event projection,
per-run/global bounds, replay rejection, execution versus reuse/denial, observer isolation,
logical cancellation versus physical drain, model/startup failures and exclusion from model history.
Panel tests cover persistent details nodes, expansion/list scroll and current-view cleanup.
The runtime event contract now includes model started/completed/failed and tool started/reused;
cancellation tests use attempt identity instead of hard-coded global event sequence numbers.
Process iteration result: 111 Muyu tests passed; full suite 811 tests, 810 passed,
1 skipped, 0 failed; static PASS (370 sources, 11 JSON, 92 module smoke checks).
No real-model requests or browser acceptance were performed for this iteration.

Director/context/Markdown iteration adds `muyu-director.test.mjs` and `muyu-markdown.test.mjs`,
plus controller/panel scenarios for director scope, permission wording, anonymous publication
and denial of cross-task state tools. Director tests reject changed evidence/targets and avoid
reading raw reasons. Markdown tests verify formatting and that HTML, images and unsafe links
remain inert. These are deterministic tests, not real-model quality or browser layout acceptance.

Director/context/Markdown validation: 120 Muyu-specific tests; full suite 820 tests,
819 passed, 1 skipped, 0 failed; all 17 regression contracts passed; static PASS
(378 sources, 11 JSON, 98 module smoke checks). No live-model request or browser
acceptance was performed for this iteration. Markdown is a bounded subset, not
a complete CommonMark implementation; raw HTML and remote images remain inert.

Provider/permission/credential iteration adds `muyu-provider-access.test.mjs` plus
controller, panel and process tests. Coverage includes reusable grants, chat isolation,
revocation during a pending run, reset model history, pure provider projections, directory
identity/revision checks, paging and byte budgets, disabled/replaced sources, optional
credential persistence, exact endpoint reuse, save failures and key-free snapshots/DOM.
`config-profile-export.test.mjs` verifies stripping the remembered Muyu key from snapshots
and exported profiles. Browser and live-model acceptance remain pending.

Provider iteration validation: 135 Muyu-specific tests; full suite 836 tests,
835 passed, 1 skipped, 0 failed; 17/17 historical BUG contracts passed; static PASS
(384 source files, 11 JSON, 103 module smoke checks). The final chat-only process
note adjustment was additionally checked by rerunning panel/process tests.

Extended context iteration adds six scenarios covering independent chat-scoped extended
grants, source-specific policy enforcement, older message range access, card participant
restriction and identity changes, ledger projections and staleness, and the GUI opt-in.
No arbitrary card extensions, message extras, alternate swipes or other chats are read.

Extended-context validation: 141 Muyu-specific tests; full suite 842 tests,
841 passed, 1 skipped, 0 failed; 17/17 historical BUG contracts passed; static PASS
(386 source files, 11 JSON, 105 module smoke checks). No live-model or browser
acceptance was performed for this extension; both local release copies are synced.

Workbench budget phase adds `muyu-budget.test.mjs` plus model/controller/panel cases:
closed configuration bounds, save rollback, per-run snapshots, answer-only finalization,
skipped tool-result pairing, refusal of further tools, timeout/cancellation without extra
requests, per-run Provider quota, actual/unknown token usage, private thinking replay,
and budget form persistence across progress updates. Conversation persistence and
resumable checkpoints are not implemented by this phase.

Budget-phase validation: 151 Muyu-specific tests; full suite 852 tests, 851 passed,
1 skipped, 0 failed; 17/17 historical BUG contracts passed; static PASS (390 sources,
11 JSON, 108 module smoke checks). No live-model request or browser acceptance was
performed for this phase; finalization protocol was exercised using synthetic responses.

Session-repository phase 2A adds `muyu-history.test.mjs` and `muyu-history-idb.test.mjs`,
plus controller/panel scenarios. Coverage includes opt-in persistence, lazy body reads,
failed saves and retries, CAS conflicts, atomic metadata/body rollback, verified account
namespaces, overlapping reads, bounded complete-turn replay, reconnect/revocation gates,
inert reload, draft isolation and idle runtime-cache reclamation. The IDB adapter is tested
with a narrow asynchronous transaction double, not a real browser implementation.

Phase 2A validation: full suite 871 tests, 870 passed, 1 skipped, 0 failed;
17/17 historical BUG contracts and static checks passed. A separate Muyu-only run
passed 169 tests. The final profile-export assertion excluding the history privacy
setting was checked separately (6/6 profile-export tests). No live API request or
browser acceptance was performed; native IDB quota, account switching, multiple tabs
and 320/400/600/800px layout remain manual acceptance items. Both local release copies
receive the same implementation and documentation. See [session contract](muyu/sessions/README.md).

History-workbench phase 2B adds title/scope/task/archive filters, confirmed metadata
management, read-only foreign-chat and imported records, explicit import previews,
JSON/Markdown exports, view-local scroll restoration and responsive sidebar tests.
Storage coverage includes v1-to-v2 migration, atomic deletion, stale-update rejection,
concurrent answers during metadata saves, autosave-off behavior and late reads after
deletion. Controller cases verify physical task drain before deletion and isolation
from another session's running task.

Phase 2B validation: full suite 895 tests, 894 passed, 1 skipped, 0 failed;
193/193 Muyu-specific tests, 17/17 historical BUG contracts and static checks passed.
No live-model requests or real-browser acceptance were performed. DOM/ResizeObserver
and IndexedDB doubles do not replace native quota, multi-tab, account-switching or
320/400/600/800px visual acceptance. Imports remain permanently read-only in this phase;
archive does not reclaim capacity, and confirmed deletion has no trash/undo.

Sidebar-first navigation follow-up: creation/search and collapsed filters live in the
sidebar, import is in its footer, and exports are in conversation menus (not settings).
Two added panel cases cover entry placement, narrow-screen close after selection/create,
row-specific export and stale-selection rejection. Full suite: 897 tests, 896 passed,
1 skipped, 0 failed; 17/17 historical BUG contracts passed. After the final scope-label
change, Muyu-specific tests passed 195/195. Real-browser layout remains manual acceptance.

Context-workbench phase 3 adds `muyu-context.test.mjs` plus model/controller/panel cases.
Coverage includes closed configuration and save rollback, mixed-language estimation,
complete-turn trimming, preflight limits with private reasoning/tool overhead, bounded
rolling summaries, no-tool summary protocol, cancellation/timeout/physical drain,
same-run budget accounting, one-send omission, original transcript preservation,
permission/chat/delete isolation, opt-in summary persistence and read-only JSON import.
V1/v2 records normalize to v3; the index excludes summary text. The core dependency
contract remains unchanged: context capabilities are injected by composition.

Validation: full suite 916 tests, 915 passed, 1 skipped, 0 failed; static checks and
17/17 historical BUG contracts passed. Muyu-specific coverage comprises 214 passing
tests. No live API calls, tokenizer calibration, browser layout acceptance or native
IndexedDB multi-tab/quota acceptance were performed. Summary quality is not established
by deterministic fixtures; see [context contract](muyu/context/README.md).

Behavior-preference phase adds `muyu-instructions.test.mjs` plus controller/model/panel
and config-profile cases. Covers opt-in composition, closed bounds and oversized drafts,
confirmed save rollback/concurrent editing, send-time snapshots, summary isolation,
budget enforcement, denied tool access despite malicious preferences, single system
message insertion with unchanged thinking indices, finalization replay, view remounts,
and profile import/export/apply exclusion. Core dependency rules remain unchanged.

Final validation: full suite 927 tests, 926 passed, 1 skipped, 0 failed; static checks
and 17/17 historical BUG contracts passed. Muyu-specific suite: 224 tests.
Separate DeepSeek harness: four same-question heuristic checks passed (6 requests),
then a focused constraint/unknown-state check passed after two base-rule clarifications
(2 requests). Human review found wording issues in the initial comparison; the final
wording was not rerun across all four live cases. Total reported live usage: 9522 tokens.
These are synthetic Node tests, not browser/ST acceptance or general quality guarantees.
See [instruction contract](muyu/instructions/README.md); harness stays outside the plugin.

Operation receipts add `muyu-receipts.test.mjs` and controller/context/panel cases:
closed bounded facts, inert v4 persistence/import/export, deduplication, storage failure
and data-only retry, origin-session ownership across selection changes, concurrent edits,
explicit tool-free explanation, failed explanation retry with one business write,
composer preservation, revocation/omit-history gates, summary isolation, request budgets
and Chinese/English remount behavior. Receipts are application data, not orphan tool results.
The existing single-apply tests continue to cover write confirmation and failure boundaries.
No paid model or native browser acceptance was performed for this change.
Validation: 985 total, 984 passed, 1 skipped, 0 failed; historical BUG contracts 17/17.
Muyu plus floating-UI suite: 289/289 passed.

Receipt explanation follow-up: independent task rules and explicit field semantics now
have regression assertions. Full suite: 986 total, 985 passed, 1 skipped, 0 failed;
historical BUG contracts 17/17; Muyu plus floating UI 290/290. External synthetic
DeepSeek harness repeated the three original receipt cases with thinking enabled:
3 requests, 5941 reported tokens. Human review found the previous changed-flag
misinterpretation and inappropriate Provider selectors absent in this run. Answers
remain verbose; this is a targeted comparison, not a general quality guarantee or
browser acceptance. Initial failures remain in the external harness report.

Receipt presentation follow-up adds assertions for concise/explicit instruction rules,
the human confirmation path, single receipt rendering, localized explanation status
and a separate action container in both languages. No permission or write lifecycle
changes. Native layout and live-model brevity still require user acceptance; no paid
requests were made for this presentation-only pass.

Provider adapter v2 adds `muyu-provider-config.test.mjs` plus controller/panel assertions:
structured whitelist/missing/unsupported values, no default filling or render calls,
global-owner and chat isolation, rejected structured selectors/pagination, byte accounting,
invalid payload rejection, mixed snapshot rejection, version/policy gates, diagnostic
permission independent of chat grants, protected-history revocation, and deterministic
receipt checks with no model calls, no repeated writes, preserved drafts and origin views.
Existing eight-source text, pagination and permission regressions remain in the suite.
Local checks use the shared Provider/Broker path, not a parallel configuration tool.
No paid API call or browser layout acceptance was performed in this phase.
Validation: 994 total, 993 passed, 1 skipped, 0 failed; BUG contracts 17/17.
Muyu plus floating-UI suite: 298/298 passed.
