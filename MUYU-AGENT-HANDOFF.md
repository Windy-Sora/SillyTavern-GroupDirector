# 暮羽 Agent 续做交接（2026-10-02）

## 当前交接：代码基线170ffd0

本文是续做快照，不代表远端发布状态；开始前重新检查Git与release差异。旧交接的数量、分支状态及已完成的档案Schema队列已移除；历次验收保留在TESTING.md和阶段路线，Git历史仍可恢复旧内容。

- 统一浮窗与侧栏，非流式模型工具调用、私有思考回传、预算、取消、澄清及来源授权续接。用户不选择任务分类。
- 当前20类固定来源，含变量诊断、ST世界书异步读取、预设/Persona/扩展目录。当前酒馆正文/角色记忆/已有Provider结果可字面检索和回读；暮羽会话历史另走history工具。
- 配置12领域89叶字段，对应114默认键中的86个supported顶层键；其余17 pending、8 special-editor-pending、1 deferred、2 internal，另4动态入口。pending衡量通用配置覆盖，不意味没有独立GUI。
- 单草稿与整单批准已实现；普通全局设置可与最多六个当前聊天数值变量一并预览、一次批准后逐步执行。专用记忆上限/蓝图完成变量不混入普通整单，部分完成和未知保存不重试或自动回滚。配置档草稿可确认保存，但无任意资源CRUD。
- 普通模式按来源/任务/版本批准；连接内全权限可免去已支持读取、Provider执行及特定应用的确认，不解除开关、目标、校验或预算。已注册Provider执行不是沙箱；创建/测试/编辑/导入工作台未实现，Script Executor写入明确暂缓。
- 历史支持服务端私有文件、IndexedDB回退及可选账户设置后端；DTO v7兼容旧记录，导入只读，切ST聊天可续聊并通知范围变化。刷新不恢复执行或授权。历史外发默认auto、可选ask，独立于新宿主读取授权。
- 长期笔记默认关闭，独立账户设置仓库、账户/当前聊天范围、GUI增删查改、字面查询及明确原话保存/精确删除；无自动注入、语义查重或后台学习。联网搜索需小地球开关、Brave及附属插件。
- 原文/模型视图分离，手动/可选自动历史摘要、原文回读已实现；不压缩活跃工具/思考轨迹，失败恢复主要取回原问题，不是检查点恢复。

未适配重点：蓝图总开关、手动选世界书、语言/调试、部分档案元数据、自定义Prompt总开关及专用资源/连接。暮羽自身配置和私人仓库不经普通业务写入器开放；memoryTokenBudget及llmJsonSchemaHint无当前运行消费者，不承诺生效。

最近提交：a23792c修复检索身份、账户存储容量及笔记范围；1bbf2f4补检索/记忆证据语义；170ffd0修复Unicode回退访问计数。最近六文件专项221/221及静态检查通过，未重跑全量；该次无付费模型/浏览器验收，两份release已同步。真实模型的历次成功与失败见[TESTING.md](TESTING.md)，不保证任意问法正确。

下一轮先建立合成检索质量/成本基线，再选检索效率与按需工具/指南加载的最小切片；之后考虑偏好召回、任务检查点、执行中结果治理及有界网络恢复。详见[架构第10节](MUYU-AGENT-ARCHITECTURE.md#10-下一阶段任务效率与可恢复性规划未实施)。不增加用户任务分类，不同时重写权限或动作层。

测试入口：`node --test tests/unit/muyu-source-retrieval.test.mjs tests/unit/muyu-history-search.test.mjs tests/unit/muyu-agent-memory.test.mjs tests/unit/muyu-instructions.test.mjs tests/unit/muyu-controller.test.mjs tests/unit/muyu-panel.test.mjs`；静态`npm.cmd run test:static`，全量`npm.cmd run test:full`。专项通过不能写成全量通过，浏览器/付费模型另行记录。
