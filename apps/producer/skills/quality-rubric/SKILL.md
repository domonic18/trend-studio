---
name: quality-rubric
description: 主编评审标准：结构化评分表、阈值与打回规则（三层校验第 3 层，门禁②）
version: 0.4.1
---

# 主编评审 rubric

消费者：主编 Agent（门禁②，逐节批量评审）。输出为结构化评分，低于阈值即 reject 回灌重写；
同一节重写上限 3 次，仍不过转人工待办（不静默放行）。

## 评审前置（不可省）

评分前必须 `cloud_section_preview({sectionId})` 读回本节成品——教材正文、课件 spec 与断言、图示
一次取齐。**禁止凭写作时的记忆打分**：正文与课件落库后可能已被改写，只看回读结果。

**有案例股时，还必须 `cloud_quotes_read({courseId, codes: 本节案例股代号})` 读回行情缓存**
（要更早的 bar 就用 `from`/`to` 缩小窗口再读）。不读缓存就没有基准，grounded 的「行情数值可核」
子项无法成立——只读正文是发现不了「把原片截图价位当现价陈述」这类错误的。

## 评分维度（每项 0–10 分）

| 维度 | 判据 | 通过线 |
|---|---|---|
| 概念覆盖度 | 节钉住的 source units 中的核心概念全部出现在正文；抽查 3 个 unit 的讲解要点逐一对正文 | 7 |
| grounded 引用 | **四类可回溯锚点**全部成立 **且**「行情数值可核」子项通过（见下节） | 8 |
| 讲解顺序 | 符合 `concepts` prerequisite 依赖序（先依赖后应用），无越级讲解 | 7 |
| 术语一致性 | 正文术语 ∈ `concepts`（含别名）；自造同义词一律打回 | 9 |
| 课件与正文对齐 | 课件 spec 考核的答案能在节教材中找到依据；无正文未讲就考的题 | 8 |
| 帧描述质量（理解产物抽查） | 每节抽 1 个 source unit：画面描述含转写外画面事实、chartType 判定合理 | 7 |
| 难度梯度 | 定义→判断依据→实例→检查清单 顺序完整，无跳步；新手可跟 | 6 |
| 图示 grounded | 节级 diagram 图示逐条核对：术语∈glossary 且正文出现过、数字有 source unit 出处、图上判断与正文陈述一致、template 在四类白名单内、渲染通过 | 7 |
| 呈现完整性 | 本节呈现层该有的都在：图示、案例股（含事件锚点）、片段卡、老师标注、回放课件——按本节实际形态逐项核对，缺项按该节形态应有的判缺 | 6 |
| 回放闭环 | 本节有 `bar-replay-decision` 课件时核对：判断点 `atDate` 严格递增且早于对应标注 `d`、每条判断点带 `unitId`/`atMs`、`revealText` 有原片时间码 | 7 |

## grounded 的四类锚点 + 行情数值可核（0.4.1，逐类抽查）

- **文本引用**：事实性段落带 citations；抽 3 处回看 source unit，转述不得改变原意。
- **媒体锚点**：`:::figure` 的配图帧 `sec` 与 `unitId`、片段卡的窗必须落在对应 source unit 范围内。
- **个股锚点**：`[[stock:code|label]]` 内联锚的股在**本节**案例股清单内；案例股事件锚点的
  `date` 落在案例窗口内且带 `unitId`。
- **老师标注/回放判断点**：`:::annotation` 的 `unitId`/`atMs` 落在 unit 范围内、交易日 `d` 是该股
  行情缓存的实际交易日；回放判断点的 `unitId`/`atMs` 与 `revealText` 可回溯到原片。

**行情数值可核（0.4.1 新增，不可省）**——本项是 grounded 的一票否决子项：

1. 正文里每个**属于案例股且带日期**的价格/成交量/涨跌幅，必须与该日 `cloud_quotes_read`
   返回的 bar 逐条对得上（收盘价对收盘价、成交量对成交量）；对不上即不通过。
2. **原片截图上的历史价位**（讲师画面里的老价位）必须显式带原片日期、不得以现价口吻陈述；
   把截图价当现价是硬伤。
3. 派生指标（M60 等）必须能**从缓存 bar 复算**得出；复算不出的数值来源不可追溯。
4. `:::annotation` 的定性词要与当日实际形态相符——例如「筹码密集」标在收 6.30 的日子、
   而密集区在 5 元附近，属归属错误，即使日期本身是交易日也不通过。

四类锚点中缺任一类，或「行情数值可核」任一条不过 → 该维度 ≤7（不达通过线 8），
`failed` 写明缺哪类、哪条不过。

## 适用性规则

- `diagram`：本节**无** diagram 图示时记 `null`（不适用，不计入通过线，不因缺图扣分）；
  有图时按 `diagram-authoring` 自检逐条核对给 0–10 分。
- `replay`：本节**无** `bar-replay-decision` 课件时记 `null`（同上）。
- 「呈现完整性」不按适用性豁免：它是按**本节实际形态应有的东西**逐项核对——
  例：v2 形态节应有图示/案例股/标注，纯讲解节无这些形态时按实际形态核对，不硬凑。

## 输出格式

```json
{"sectionId":"sec_...","scores":{"coverage":8,"grounded":9,"order":7,"terms":9,"alignment":8,"frameQuality":7,"difficulty":7,"diagram":null,"presentation":8,"replay":null},
 "verdict":"approve|reject","failed":["alignment"],"comments":"具体到段落位置的修改指令，reject 时必填"}
```

## 打回规则

- 任一维度低于通过线 → `reject`，`failed` 列出维度，`comments` 给出**可执行的修改指令**
  （指明哪个段落、改成什么，不写"质量待提升"这类空话）。
- `verdict=approve` 必须所有维度过线；主编不得为了省事放行 borderline。
- 每轮评审打分与 verdict 计入溯源（`content.rubric_review`），rubric 版本随 `skillVersions` 上报。
  上报形状：`{taskKey:'content.rubric_review', model, provider, status, targetId: sectionId,
  skillVersions:{'quality-rubric':'<版本>'}, summary:{scores, verdict, failed, comments}}`——
  `summary` 即上面那份评审 JSON，云端落 `ai_runs.summary`，是评审留痕的唯一去处。
  **`scores` 必须嵌在 `summary.scores` 里**（平铺到 `summary` 顶层会被读回方当成缺 scores）；
  `skillVersions` 必带 `quality-rubric` 版本号。
- **阈值标定基线（2026-11-06 实测）**：阈值按「正样本过、负样本不过」标定，样本取自
  TC-ZONGLUN 真产回灌（6 节全量 DSL v2）。
  - 正样本 6/6 approve：十个维度实测落在 **8–9** 区间（`order`/`difficulty`/`frameQuality`/
    `diagram` 常在 8，其余多在 9），**从未出现 10**——说明当前量表的有效分辨力就在 8/9 两档。
  - 负样本：TC-ZONGLUN「筹码分布 1」首轮 v3 —— 把原片截图价位当现价陈述、且把「筹码密集」
    标在离密集区很远的交易日。rubric 0.3.0 判 grounded 7 → reject（**判对了**）；
    rubric 0.4.0 却判 grounded 9 → approve（**漏检**），因为 0.4.0 的 grounded 只查锚点存在性，
    不查数值是否与行情缓存对得上。0.4.1 补的「行情数值可核」正是堵这个漏。
  - 结论：**通过线 8 保持不动**（6 个正样本全过、1 个负样本被 0.3.0 判不过，8 分线本身站得住）；
    要动的是**负样本的检出率**，靠 0.4.1 的数值可核子项，不靠调阈值。调整阈值须改本文件版本号。
