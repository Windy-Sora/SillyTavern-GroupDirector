# 模型适配层：非流式 Chat Completions

2026-10-02 接口页：GUI 可显式选择现有 `deepseek` / `chat-completions` 协议，DeepSeek 思考强度可选 low/high/max。测试连接、获取模型不自动启用；协议及思考选项随可选的记住密钥持久化，旧保存记录默认 DeepSeek/high。通用协议不发送 DeepSeek 专属思考参数；没有新增 Responses/Anthropic 适配器、多连接管理或服务端密钥库。离线专项通过，真实浏览器 CORS/服务兼容性仍需实际测试。

2026-09-24。已完成离线协议与Runtime组合测试；未连接真实服务、未验证浏览器CORS、未挂载GUI。旧utils/custom-api.js保持不变。没有新增依赖、自动重试或模型回退。

## 组装

```js
import { createChatCompletionsModel } from './chat-completions.js';
const model = createChatCompletionsModel({
    connection: {
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: credentialFromTrustedOwner,
        model: selectedModel,
        profile: 'deepseek',
        supportsTools: true,
        thinking: true,
        reasoningEffort: 'high',
        maxTokens: 8192,
    },
});
// 将model注入startMuyuRun；此处不执行网络请求。
```

connection由可信组合层提供并在创建时固定，不从模型消息读取。endpoint必须是完整/chat/completions地址，不追加/v1；禁止URL凭据、查询参数及片段。默认只允许HTTPS，allowLocalHttp:true可允许精确loopback主机的HTTP开发端点。重定向报错，不携带cookie、ST CSRF或referrer。不支持宿主代理；如果浏览器CORS不允许，必须单独设计并核实宿主支持的路径，不静默绕过。

profile支持chat-completions和deepseek；后者默认thinking:true、reasoningEffort:high，可选low/high/max或关闭thinking。通用profile不接受thinking:true，不把兼容协议当作推理能力证明。supportsTools默认false，是配置声明而不是探测结果；模型工具能力还需真实服务验证。maxTokens默认8192，配置范围1–32768，是本实现的预算上限，不是供应商的上下文上限。

## 协议与隐私

2026-10-01：可信调用方可在无工具、无工具轨迹的请求上设置 `reasoning: 'disabled'`。DeepSeek 仅对该次请求发送 thinking=disabled 并省略 reasoning_effort；计量、解码与私有推理存储均使用该次有效配置，不修改连接或影响正常工具续接。其他值或携带工具/工具轨迹时在网络前拒绝；不能通过该入口开启思考。通用兼容 profile 不发送专有思考参数，不保证未知服务端关闭推理。摘要层使用此入口；依然先验证完整响应，length 不发出半截摘要。

工具定义按ID排序映射为muyu_tool_N；版本固定在本地，模型不能指定权限、处理函数或版本。规范消息转换后逐一检查工具结果配对。完整响应批次通过检查才发送事件；JSON参数结构错误拒绝整个批次，合法JSON但不符合工具Schema由Broker拒绝，允许现有有界修正流程处理。

仅接受一个choice、stop/tool_calls完成原因；length明确报MODEL_OUTPUT_TRUNCATED，content_filter报MODEL_CONTENT_FILTERED。未知结束、未知工具、重复调用ID、空答案或畸形数据拒绝。reasoning不能替代最终回答。

DeepSeek推理仅保存在适配器的WeakMap运行私有区。Runtime每次Run传入独立context，同Run各模型步骤复用；适配器按消息位置与内容签名核验回传，成功/失败/取消时Runtime调用同步releaseContext清理。推理不进入公开messages、事件、快照、日志、工作区或onUsage。调用者若绕过Runtime直接调用run，必须提供稳定且独占的context并在结束时releaseContext。

跨Run目前只保存用户文本与最终回答，没有旧推理。新Run中的旧assistant回答被转换为带标签的user角色参考资料，而不是伪造缺少reasoning_content的供应商assistant消息。旧工具轨迹缺少私有状态则拒绝，不尝试修补。此机制不是完整供应商会话持久化；持久化或跨Run保留推理需要单独设计。

供应商返回的usage通过onUsage回调提供inputTokens/outputTokens/totalTokens，缺少或不合法为null；不暴露原始usage。该回调当前不汇总到应用快照，回调异常不影响运行。Runtime原usage仍是modelCalls/toolAttempts，不能误读为Token用量。

## 限制与清理

HTTP请求默认1MiB、响应256KiB字节上限；transportLimits可设置maxRequestBytes/maxResponseBytes，最大各1MiB。响应按流读取但不向上游输出流式事件；即使没有Content-Length也受限。单条公开DTO仍受内核32KiB限制。推理每条128KiB、每Run合计512KiB、最多16条；超限明确失败，不截断协议需要的推理。

运行时间上限由Runtime提供；直接调用适配器须由调用方提供有时限的signal。取消同时传给fetch和body reader，等待底层fetch/read/cancel全部settle；不会用提前拒绝的Promise伪称已清理。非合作传输可能使drained持续等待；本地取消不证明远端停止计算或计费。错误响应正文不读取、不输出；401/403、429、5xx、其他HTTP和网络错误分别归为有限代码，不自动重试。

## 依据与验证

协议核对：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。仅以已核对字段实施，不承诺其他兼容服务的行为。架构参考本地Claude Code快照的API/执行分层，以及deepseek-harness的serialize/translate/adapter分工，未复制其实现；本地快照与当前官方回传说明不一致时，以官方协议为准。

tests/unit/muyu-model.test.mjs包含18项离线测试：工具闭环、思考回传/隔离/清理、历史签名、参数修正、输出限制、错误分类及取消。真实模型质量、鉴权、工具能力、CORS和浏览器资源生命周期尚待单独验收；不得把fixture通过写成服务兼容性认证。
