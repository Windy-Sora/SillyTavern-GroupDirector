# SillyTavern Group Director

🌏 Language

- English: [README_EN.md](README_EN.md)
- 中文: 当前页面

---
一个为 SillyTavern 群聊设计的「导演系统」。

Group Director 不只是决定谁发言。

它会像导演一样管理整场群聊：

* 决定谁应该回应
* 控制发言顺序
* 抑制无意义抢话
* 为角色编写表演指令
* 保持多轮剧情连贯性
* 利用世界书参与决策

全部基于官方 Extension API 实现，无需修改 SillyTavern 核心代码。

---

# 为什么需要它？

传统群聊通常会遇到一个问题：

> 所有人都想说话。

用户发出一句话后：

```text
用户：今晚怎么办？

骑士：我认为应该……
法师：根据我的研究……
商人：我有个建议……
女仆：主人……
刺客：……
```

结果：

* 群聊节奏混乱
* 回复越来越长
* 角色互相抢戏
* 重要角色被淹没
* 对话失去重点

Group Director 在角色生成之前增加了一层决策系统。

它不再问：

> 哪些角色被激活了？

而是问：

> 现在哪些角色真正应该说话？

---

# 核心功能

## Formula Director（公式导演）

本地评分系统。

无需 API 调用。
无需额外 Token。

根据以下因素综合计算：

* 角色是否被提及
* 关键词触发
* 最近发言情况
* 连续发言惩罚
* Talkativeness
* 主动性随机扰动

然后只允许最相关的角色发言。

适合：

* 大型群聊
* 长期 RP
* 希望降低 Token 消耗

---

## LLM Director（大模型导演）

让模型直接担任导演。

Director 会综合分析：

* 最近聊天内容
* 角色描述
* 世界书信息
* 历史导演计划（可选）

然后决定：

* 谁应该发言
* 发言顺序是什么
* 当前场景应该如何推进

示例：

```json
{
  "speakers": [
    "骑士",
    "法师",
    "国王"
  ],
  "reason": "国王应该在听取意见后最终拍板。"
}
```

---

## 发言顺序控制

不仅决定谁说话。

还决定：

> 谁先说。

例如：

默认激活顺序：

```text
骑士
法师
国王
```

导演认为更合理的是：

```text
法师
骑士
国王
```

Group Director 可以接管生成流程，严格按照导演指定顺序生成。

---

## 导演剧本（Director Script）

这是 Group Director 最强大的功能之一。

Director 不仅选择角色。

还会为每个角色单独编写表演指导。

例如：

```json
{
  "scripts": {
    "Alice": "表面保持冷静，但逐渐流露出不安。",
    "Bob": "试图掩饰愤怒，不要直接爆发。"
  }
}
```

然后：

* Alice 只会看到 Alice 的剧本
* Bob 只会看到 Bob 的剧本
* 角色不会知道导演的存在
* 不会暴露剧本内容

从而实现：

* 情绪控制
* 氛围控制
* 戏剧张力控制
* 多角色协同演出

---

## 连贯剧本

普通 Director 每轮独立思考。

连贯剧本模式会将上一轮导演计划带入下一轮决策。

这样导演能够持续维护：

* 剧情主线
* 角色关系
* 情绪发展
* 场景目标

适合长篇剧情和持续 RP。

---

## 世界书感知

Director 可以读取当前激活的世界书（Lorebook）内容。

在做决策前了解：

* 世界观设定
* 势力关系
* 地区背景
* 历史事件
* 当前环境信息

从而做出更合理的角色调度和剧情安排。

---

# 工作模式

## 关闭

完全不干预。

SillyTavern 保持默认行为。

---

## Formula

本地评分模式。

特点：

* 快速
* 稳定
* 无额外成本

推荐大部分用户使用。

---

## LLM

导演决策模式。

特点：

* 理解上下文
* 理解剧情
* 理解角色关系

适合重度 RP 玩家。

---

# 使用场景

Group Director 特别适合：

* 多角色群聊
* 酒馆场景
* 学院题材
* 冒险队伍
* 家族群像
* 宫廷政治
* 长篇剧情 RP
* 多角色协作叙事

对于人数较多的群聊，效果尤为明显。

---

# 技术特点

* 基于官方 Extension API
* 不修改 SillyTavern 核心代码
* Generate Interceptor 驱动
* 支持 World Info 集成
* 支持角色级 Prompt 注入
* 支持 Director Script
* 支持严格顺序生成
* 支持 Formula 与 LLM 双模式

兼容 SillyTavern 1.12+

---

# 安装

扩展商店安装：

```text
https://github.com/Windy-Sora/SillyTavern-GroupDirector
```

或手动安装：

```bash
git clone https://github.com/Windy-Sora/SillyTavern-GroupDirector.git
```

放入：

```text
SillyTavern/public/scripts/extensions/third-party/
```

然后重启 SillyTavern。

---

# 设计理念

Group Director 不是一个发言过滤器。

它是一个群聊导演系统。

目标不是让更少的人说话。

而是让最合适的人，在最合适的时机，以最合适的方式说话。
