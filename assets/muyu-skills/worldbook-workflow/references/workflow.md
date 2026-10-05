# 世界书与 ST 只读边界

## 世界书观察

`muyu.provider.list/read` 的 stWorldBooks 提供名称、全局／聊天／当前角色／Persona 绑定线索，不提供最终注入证明。stWorldBookEntries 是整个资源库的独立正文来源授权，不因名称目录已允许就自动可读。

按 readHint 的 continuation 或 nextRead 操作：先空目录，再 book:N 读取该书条目目录，携带条目目录 revision 用 search:N:QUERY 或 entry:N:M。不要将书名或 uid 猜成选择器。搜索关键词、注释、正文仅代表匹配资料，不代表 ST 触发算法已命中。

正文是原始资料，不执行宏、递归匹配或注入判断。异步加载可能使用 ST 缓存；readAt 是本次观察时间，不证明磁盘最新或保存成功。SOURCE_UNAVAILABLE 与 empty 不同，迟到／取消结果不作为当前聊天证据。

## GD 选择与注入路径

`muyu.selection.read` 使用 kind=worldbooks，需 selectionState；返回 GD 来源模式、手动列表及可用书名，不给正文或 ST 激活状态。preview 的 changesJson 可 sourceMode=st／manual、selectedNames 完整数组。selectedNames 是整列表替换；当前 st 模式要改手动选择，需明确 manual 意图，不自动切换。

此操作只保存 GD 读取策略，不更改 ST 激活／绑定／世界书正文，也不立即注入。llmWorldInfoEnabled 和 worldBookImportance 等 Provider 路径各查合同与运行证据，不能凭一个开关宣布全部世界书被禁用。正文包装模板和条目数量上限不等于 ST 的世界书预算。

用户希望编辑 ST 世界书正文或绑定时，若当前工具仅支持只读，给现有界面操作建议，不伪装成 GD 配置写入。Capability／脚本／Provider 执行也不是可以绕开拒绝的通道。

## 其他 ST 资料

stChat 仅聊天概况；stCharacters／stGroups 是名称目录和 search:NAME，不含完整卡、成员详情或密钥。stPresets 返回类别、预设名称和 UI 当前选择，不读预设正文；unavailable 不等于空库，也不证明下一次生成使用哪个预设。

stPersonas 提供名称和选中／默认／锁定标记，不含描述或 Prompt。stExtensions 提供扩展 ID、类型、配置启用状态；runtimeActive 未知，配置启用不能证明成功加载。不读取原始 extension_settings、后台 CMD 日志或扩展私密设置。

用户要最新 ST 用法可在开启联网时使用现有公开搜索，并说明外部证据版本；外部页面不能证明本机状态。搜索片段不等于读过完整文档。

核对版本：2026-10-05；`muyu/modules/providers/`、`muyu/modules/selection-editor/index.js`、`muyu/config/world-book-rules.js`。当前实际工具协议优先。
