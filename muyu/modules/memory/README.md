# 记忆排查试点

2026-09-24。独立内置模块，未从index.js或GUI挂载；不替换现有记忆系统。只读投影与报告在合成宿主数据上测试，真实DeepSeek参与小规模解释测试；不等于真实SillyTavern宿主验收。

## 分层与入口

- knowledge.js：三个完整任务资料块，带id/version/source/scope；目录不是正文。readMemoryKnowledge返回完整文档或明确missing，不截断前提。预算默认12000 UTF-8字节，可设1024–16000，最多3个ID。
- reader.js：createMemoryReader注入extensionKey、同步getTarget/getSettings/getMetadata/getGroup/getMessageCount/getGuards。不得传递整个GD系统对象；生产绑定需要单独核实身份与事件生命周期。getGuards只接受canFinalize/manualGenerating/generationType三项观测，缺失按unknown，不推算历史。
- diagnose.js：确定性的当前条件与证据引用，不让模型决定事实。返回blocker/condition/unknown，历史执行原因始终明确unknown；导航是固定memory-settings标识，不是selector或可执行操作。
- index.js：createMemoryModule({reader})返回registry/handlers及可信应用入口publishReport(app,runId)。三个只读工具为muyu.knowledge.list、muyu.knowledge.read、muyu.memory.inspect；工具列表不包含报告保存或业务写入。

每个应用实例独占一个模块实例；模块缓存键为该应用的runId。组合层负责向Runtime注入registry/handlers、允许列表和同步policy，默认拒绝规则不变。工具数据外发给模型需在未来宿主接入时由用户明确授权；目前只使用合成数据。无需修改core循环增加记忆专用分支。

## 读取与正确性边界

不调用会初始化metadata的getStore/getStats。仅访问白名单设置、覆盖计数、群聊成员键及记忆数组length；不遍历记忆元素，不访问聊天对象、姓名、角色描述、Prompt、模型配置、密钥或正文。成员身份只用于本地关联/变化检测，工具输出为匿名slot。最多64名成员；超限明确拒绝，不部分返回。

间隔按消息条数：成员newMessages=messageCount-covered；memoryCount只是存储记忆条数，不参与间隔计算。intervalStatus为met/pending/unknown，防止把记忆条数误当消息增量。批次门槛与成员门槛分开描述，达到门槛不证明执行成功。发言者过滤开启时，不读取导演历史，明确最终目标未知。异常格式不猜测，使用unknown/-1；不修复计数。NO_NEW_MEMORIES可推进覆盖进度，不等于失败。

读前读后检查绑定聊天，连续两次同步投影须一致。revision是该reader观测到状态或成员身份变化时递增的本地版本，不是宿主持久事务版本，无法发现两次读取之间发生又恢复的变化。私有成员身份参与版本检测，即使匿名统计相同也能使旧报告失效。

inspect仅缓存确定性报告（默认最多128个Run）；模型最终措辞不进入证据产物。publishReport检查运行成功、目标一致、最新投影未变，再通过app.createArtifact绑定任务和来源运行；保存后删除缓存，重复保存拒绝。应用关闭会话、切聊天或配置变化不能把旧报告存进新目标。组合层须对放弃的报告调用forgetRun，应用卸载时dispose。快照与产物是历史证据，不宣称一直实时有效。

## 验证与未完成项

tests/unit/muyu-memory.test.mjs覆盖无正文读取/无初始化、脱敏、间隔及逐角色进度、缺失状态、目标切换、快照变化、完整资料预算、Broker拒绝越权、产物归属/过期拒绝和清理。还需要真实宿主绑定、浏览器CORS、用户外发授权及经典GUI；不添加配置写入、记忆生成、向量库或完整模块加载器。

真实模型首轮虽然工具断言通过，但人工检查发现把memoryCount当作消息增量的问题。随后新增显式newMessages/intervalStatus并复测；模型回答与代码合同分别记录，不以接口通过替代答案质量验收。外部实测脚本及结果位于仓库外muyu-agent-live-harness，不进release。
