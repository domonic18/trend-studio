---
name: quality-rubric
description: 主编评审标准：结构化评分表、阈值与打回规则（三层校验第 3 层，门禁②）
version: 0.3.1
---

# 主编评审 rubric

消费者：主编 Agent（门禁②，逐节批量评审）。输出为结构化评分，低于阈值即 reject 回灌重写；
同一节重写上限 3 次，仍不过转人工待办（不静默放行）。

## 评审前置（不可省）

评分前必须 `cloud_section_preview({sectionId})` 读回本节成品——教材正文、课件 spec 与断言、图示
一次取齐。**禁止凭写作时的记忆打分**：正文与课件落库后可能已被改写，只看回读结果。

## 评分维度（每项 0–10 分）

| 维度 | 判据 | 通过线 |
|---|---|---|
| 概念覆盖度 | 节钉住的 source units 中的核心概念全部出现在正文；抽查 3 个 unit 的讲解要点逐一对正文 | 7 |
| grounded 引用 | 事实性段落带 citations；抽查 3 处引用回看 source unit，转述不得改变原意 | 8 |
| 讲解顺序 | 符合 `concepts` prerequisite 依赖序（先依赖后应用），无越级讲解 | 7 |
| 术语一致性 | 正文术语 ∈ `concepts`（含别名）；自造同义词一律打回 | 9 |
| 课件与正文对齐 | 课件 spec 考核的答案能在节教材中找到依据；无正文未讲就考的题 | 8 |
| 帧描述质量（理解产物抽查） | 每节抽 1 个 source unit：画面描述含转写外画面事实、chartType 判定合理 | 7 |
| 难度梯度 | 定义→判断依据→实例→检查清单 顺序完整，无跳步；新手可跟 | 6 |
| 图示 grounded | 节级 diagram 图示逐条核对：术语∈glossary 且正文出现过、数字有 source unit 出处、图上判断与正文陈述一致、template 在四类白名单内、渲染通过 | 7 |

## 输出格式

```json
{"sectionId":"sec_...","scores":{"coverage":8,"grounded":9,"order":7,"terms":9,"alignment":8,"frameQuality":7,"difficulty":7,"diagram":null},
 "verdict":"approve|reject","failed":["alignment"],"comments":"具体到段落位置的修改指令，reject 时必填"}
```

- `diagram`：本节**无** diagram 图示时记 `null`（视为不适用，不计入通过线，不因缺图扣分）；
  有图时按 `diagram-authoring` 自检逐条核对给 0–10 分。

## 打回规则

- 任一维度低于通过线 → `reject`，`failed` 列出维度，`comments` 给出**可执行的修改指令**
  （指明哪个段落、改成什么，不写"质量待提升"这类空话）。
- `verdict=approve` 必须所有维度过线；主编不得为了省事放行 borderline。
- 每轮评审打分与 verdict 计入溯源（`content.rubric_review`），rubric 版本随 `skillVersions` 上报。
  上报形状：`{taskKey:'content.rubric_review', model, provider, status, targetId: sectionId,
  skillVersions:{'quality-rubric':'<版本>'}, summary:{scores, verdict, failed, comments}}`——
  `summary` 即上面那份评审 JSON，云端落 `ai_runs.summary`，是评审留痕的唯一去处。
- 阈值当前为**试点默认值**（2026-11-04），随总论卷试点的金标准对比校准，调整需改本文件版本号。
