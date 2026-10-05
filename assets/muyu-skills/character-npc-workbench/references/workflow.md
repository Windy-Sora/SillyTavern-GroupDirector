# 档案与 NPC 工作流

## 人工档案

`muyu.profile_editor.list/read/preview` 使用 profileEditState。list 的 profile-role:N 与 revision 用于现有记录；read 分页取正文及旧归档。update 仅允许 summary、motivation、relationships、tags 等合同字段，保留自定义／来源字段。delete 移除当前档案并替换同角色上一份归档，需展示可能丢失的旧归档，不能说成无损收藏。

新建用 create_targets／create_preview，来源 profileCreateState，选择 profile-character:N。标准四字段人工档案需非空 summary，可选 motivation／relationships／tags。任何已有记录，包括 pending／failed／null，不以新建覆写；共享 Schema 不兼容时停止，不伪造升级。不修改 ST 卡或全局模板，也不补开开关。

## 人工 NPC

`muyu.npc_editor.list/read/preview` 使用 npcEditState，现有目标由 npc:N 与 revision 确定。可改 name、description、personality、scenario 和已存在的 first_mes；不能在 absent 时借更新新增 first_mes。保留导入标志、时间、角色卡关联和自定义内容。改 NPC 不会更新已导出 ST 卡；删除仅移除 NPC 记录，无归档或角色卡删除。

新建先 create_read 获取 npcCreateState 的姓名及容量约束，再 create_preview。需非空 name／description，名称不得与 NPC 或任何已知 ST 角色忽略大小写／首尾空格后冲突。达到容量不自动删旧记录；不生成或导入角色卡、不自动启用功能。

## 实际生成与批量

`muyu.profile_generation.targets/prepare/execute`：单角色、标准四字段 Schema；save 仅创建缺失档案，不覆写任何已有状态；需功能已启用，不自动打开。自定义 Schema 不支持此生成路径时，在付款／渲染前说明限制，不能按标准字段硬套。

`muyu.npc_generation.state/prepare/execute`：按实际容量与批次数量准备，save 追加唯一名称 NPC，不覆写、裁剪或导入卡。试问／试生成使用 trial，仅返回产物不存储。

多目标可用 `muyu.generation_batch.prepare/execute`，一份确切有序列表最多八步 memory／profile／npc，角色目标先从各生成目录读取。memory／profile 提供 character 不提供 count；NPC 可 count 不提供 character，同域角色不重复且最多一个 NPC 步骤。execute 的 maxModelCalls 必须覆盖清单最大业务尝试数，最多八次；这些额外于暮羽模型调用。批量不是普通配置整单，也不包含蓝图生成。

准备是纯操作；执行才实际渲染 Prompt／Provider、调用业务模型或 ST 原生连接，可能有代码、网络与费用副作用，trial 不是沙箱。整单一次执行许可不等于其他清单许可。部分保存或未知停止后续步骤，已确认部分可能保留，不重试未知清单或新票据绕过拒绝。

人工预览与生成结果仍受完整差异／结果预算限制；正文省略不等于失败。角色创作、已存档案和真实剧情事实不可互代。仅报告实际回执，保存确认仍是历史结果。

## 生成内容的事实核对

试生成成功和 outputFormatChecked／formatChecked 只证明执行或格式，不证明内容正确。解释产物时优先对照本任务已经获授权的原始角色／聊天证据；来源缺失则明确未做事实核对，不说“自洽”“符合剧情”。额外读取仍遵守来源授权，不能为核对扩大用户限制。

逐项核对“谁做了什么、谁具有该身份／动机、哪句支持该标签”：例如“Bob说港口缺一名船夫”不证明Bob是船夫；不能把环境需求变成说话者的职业，也不能把推测写成既有事实。NPC创作可提出新设定，但须标明创作产物，不回灌为旧角色经历。档案只是从资料提炼，没有证据的职业、动机和关系不可凭关联补齐。

发现归因错误时指出具体问题、将其排除出自己的事实结论；原始回执与产物保持原样，不能声称已修好、悄悄改存储或自动再生成。用户明确要求纠正后再选择人工编辑预览或新执行单，分别授权。全权限也不能把模型产物变成已验证事实。

核对版本：2026-10-05；`muyu/modules/profile-editor/`、`npc-editor/`、`profile-generation/`、`npc-generation/`、`generation-batch/`。以实际工具定义为准，路径仅供维护。
