---
name: courseware-design
description: 课件设计工艺：8 类白名单组件选型与 spec/assertions 撰写规范（断言证明的供给侧）
version: 0.1.0
---

# 课件设计工艺

消费者：节 Author 子代理（每节 1–3 个课件）。输出：`cloud_widget_write` 可通过的
`{type, specVersion:1, spec, assertions, citations}`。云端断言证明器是确定性程序：
**spec 与 assertions 写不合规 = 409 回灌**，本工艺是首次写对的最短路径。

## 选型规则（按教学目的选组件，不硬凑）

| 教学目的 | 组件 | 数据来源 |
|---|---|---|
| 训练画趋势线/识别触点 | `kline-annotator` | 生成器合成 K 线（generator+seed） |
| 训练形态识别 | `pattern-quiz` | 正确项+干扰项各配生成器 |
| 分步解盘回放讲解 | `step-reveal` | 生成器 + 每步 markers |
| 参数化计算练习 | `calc-trainer` | 公式白名单（position-size/risk-reward/drawdown-recovery） |
| 概念理解选择 | `mcq-quiz` | 选项文本，术语 ∈ concepts |
| 术语记忆卡 | `flashcards` | front/back + conceptRef |
| 操作清单自检 | `checklist` | 条目 + conceptRef |
| 概念依赖浏览 | `timeline-explorer` | 节点概念 + 依赖边 |

- 一个节 1–3 个课件；优先覆盖本节核心概念的可练习性，装饰性课件不做。
- `generated` 文生图与课件无关（那是图示域）；课件图表数据**一律用确定性生成器**声明。

## kline-annotator 撰写要点（证明器视角）

- `spec.data`: `{source:"synthetic", generator, seed, bars}`；generator 白名单
  `uptrend|downtrend|range|uptrend-platform|downtrend-platform`，bars 20–120。
- `solution.trendline`: `{startIdx, endIdx}` 两锚点 bar 索引（startIdx < endIdx < bars）。
- **必带断言**（缺一 400）：`trendlineTouches:{min}`（min 3–6 起步）、`slopeRange:[min,max]`
  （角度=数据适配视图口径，水平≈0°，45°=每 bar 走一个价格区间；上升趋势线写 `[10,60]` 先宽后紧）、
  `noBreakBelow:true`。
- 选 seed 有技巧：固定一个 seed 反复试锚点直到三断言全过（断言在本地可预判：触点=线贴低点次数，
  角度越陡越大，平台族锚点取 1 与 bars-2 通常 40° 左右）。失败别硬调，换 seed 重来。

## mcq-quiz / flashcards / checklist

- 必带断言：mcq=answerUnique+termsInConcepts；flashcards=termsInConcepts+cardCount(3–20)；
  checklist=itemsNonEmpty。
- `conceptRefs` 必须逐字匹配 `concepts` 名称或别名（含别名）；错字=409。
- 干扰项要有教学意义（常见误解），不是随机凑数。

## calc-trainer

- 必带断言：examplesRecomputable+paramsInBounds；公式与参数域是服务端白名单常量。
- examples 1–10 条，answer 必须是程序复算的精确值（自己先按公式算一遍再写）。

## timeline-explorer

- 必带断言：edgeRefsExist+acyclicPrerequisite；节点/边引用的概念 ∈ concepts；
  prerequisite 子图不得成环（依赖序按 glossary 的 prerequisite 列）。

## citations 与溯源

- 全部组件 `citations` ≥1（支撑本课件教学的 source unit）；课件落库后上报
  `content.widget_spec` 溯源。

## 收敛纪律

- 409 回灌 ≤3 次（按 failed 断言修正）；3 次不过放弃该课件转人工，不降级规格硬塞。
