# 暮羽联网搜索

2026-09-30，首版支持 `muyu.web.search` 与 Brave Search API。模型仍走原有 Chat Completions / function calling，无需更换模型。实现只参考本机 Codex 的独立工具边界、Claude Code 的搜索与网页抓取分离；未复制代码。

## 用户入口

聊天输入工具栏左侧的小地球是实际联网授权开关，默认关闭。开启后暮羽按需发送精简的搜索词至 Brave，不再逐次弹出资料授权卡；关闭后本轮后续搜索拒绝执行，已有请求取消，迟到结果丢弃。普通模式和全权限模式都遵守此开关。切换模型连接、禁用或刷新后关闭；面板重建与切换 ST 聊天保留当前连接的选择。不因开启开关自动发送输入或执行搜索。未配置模型或搜索密钥时跳转齿轮的模型连接页，输入草稿保留。

配置页包含独立 Brave API Key、可选记住密钥、每任务搜索次数（1–8，默认3）、单次结果数（1–10，默认5）、每任务结果预算（2000–24000 UTF-8字节，默认12000）。限制在任务开始时捕获，权限/澄清交接沿用已有开销。工具调用和任务时间仍受现有预算约束，结果进入下一次模型请求并接受上下文计量。搜索失败计入尝试次数，不自动重试。

密钥仅保存在 host 私有闭包中；选择记住时写入 `agentConfigs['muyu-web-search'].apiKey`，沿用配置档导出的密钥剔除机制。未加密，ST 设置备份及同源脚本仍可能访问。不进入模型工具参数、控制器公开快照、历史文件或错误信息。浏览器只对已认证的 ST 服务端插件发送密钥；后者仅将它放入固定 Brave HTTPS 上游的认证头，不写入文件。

## 边界与部署

- `contract.js`：设置、请求和结果合同，URL验证与结果字节裁剪。
- `../modules/web/index.js`：工具定义与任务搜索预算，交接时保留次数/字节。
- `../host/web-search.js`：插件设置、私有凭据和同源有界 HTTP 传输。
- `../ui/web-search-view.js`：小地球、状态提示及配置编辑器。
- `../server-plugin/web-search.cjs`：Brave 适配与路由，复用现有服务端插件部署；可增加其他后端而不改 Agent core。

安装/更新时复制 `muyu/server-plugin` 下的全部 `.cjs` 文件至 `<ST>/plugins/gd-muyu-history/`，启用 ST `enableServerPlugins` 后重启。插件 ID 和旧历史路由不变，新路由为 `GET /web/health` 与 `POST /web/search`；缺席时明确报告 unavailable，不临时寻找其他代理。health 仅证明本机路由可达，不验证搜索密钥或上游网络。

服务端只请求 `https://api.search.brave.com/res/v1/web/search`，不接受自定义上游地址，不跟随重定向，不携带 ST cookie/认证头。请求超时12秒，上游响应最多1MiB，同账户最多两项并发请求。浏览器等待上限14秒、响应最多128KiB，工具超时15秒。客户端断开、用户停止或关闭联网会取消请求；无法撤回已送出的搜索词或已产生的费用。

结果是标题、URL、网页摘要与检索时间，供模型引用原始链接；不抓取正文、不执行网页脚本。检索时间不等于文章发表时间。返回链接限 HTTP(S)、无URL凭据，并去重。网页内容只作外部不可信资料，不能授予读取/写入权限。配置问题优先使用项目内真实契约，最新外部事实再搜索。

参考 API：[Brave Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/get)。需要用户自己的 Brave Search API key，与 DeepSeek key 无关。离线测试覆盖模型工具流、开关撤销、GUI草稿、凭据保存失败、固定上游、异常规范化、取消与跨执行段预算；真实搜索与浏览器布局仍需用户配置密钥后验收。
