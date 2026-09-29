# 暮羽本地文件后端

此目录只包含服务端插件代码，绝不放真实聊天记录。ST 会把前端扩展目录作为静态资源提供；私密历史不能写入这里。

将 `index.cjs` 安装到 SillyTavern 的 `plugins/gd-muyu-history/index.cjs`，在 ST 配置中开启 `enableServerPlugins`，重启 ST。服务端按已认证账户写入 `<ST data root>/<user>/.group-director/muyu/history/<namespace>/<conversation-id>.json`；不会写入聊天存档或角色卡。文件未加密，备份与磁盘访问仍需由用户管理。

浏览器端优先使用该后端；服务端插件缺席时回退 IndexedDB。首次连接会复制浏览器中尚未存在于文件后端的旧会话，不删除浏览器原件；相同 ID 的文件记录不会被覆盖。无法联系已启用的后端时显示错误，不静默切换以免产生分叉。持久化仅包含受限的会话 DTO，不保存 API 密钥、授权、可恢复的执行句柄或完整工具日志。结构借鉴 Codex 的独立存储边界和按需恢复思想，没有复制其代码或引入完整 JSONL 事件日志。
