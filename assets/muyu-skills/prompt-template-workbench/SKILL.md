---
name: prompt-template-workbench
display-name: Prompt与模板设计
description: 用户希望修改功能Prompt、创建自定义Prompt数据源、调整输出示例或模板引用时使用；区别提示词、Schema和可执行Provider。
version: "1.0"
---

# Prompt 与模板设计

先完整读取 references/workflow.md。先确定模板在哪个功能使用和想改变什么行为。直接承接已有对象，不把所有 Prompt 混成一个入口。

查询实际字段合同或自定义条目，读齐原文，保留未要求的规则和占位符。优化文字不顺便补开总开关、不实际渲染、不调用业务模型。需要代码数据源时与 Provider 技能配合，但不把普通模板改成脚本。

输出示例、JSON Schema、Prompt 正文和模板包装是不同对象；按具体模块的验证语义设计。只有真实渲染和模型结果才能验证效果，保存或格式通过不等于可用。

用“自定义提示词”“生成提示词”“输出示例”等界面名称，必要时补字段名。引用重命名／删除风险和后续 Provider 运行开销要说清楚。
