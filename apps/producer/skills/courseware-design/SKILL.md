---
name: courseware-design
description: 课件设计工艺：11 类白名单组件选型与 spec/assertions 撰写规范（断言证明的供给侧）
version: 0.4.0
---

# 课件设计工艺

消费者：节 Author 子代理（每节 1–3 个课件）。输出：`cloud_widget_write` 可通过的
`{type, specVersion, spec, assertions, citations}`。云端断言证明器是确定性程序：
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
| **逐根回放判断（M10 v2）** | **`bar-replay-decision`** | **真实行情 bars + 老师决策点** |
| **前后对比（M10 v3）** | **`image-juxtaposition`** | **课程图示 figureId 或生成器合成 K 线** |
| **分支情景练习（M10 v3）** | **`branching-scenario`** | **决策树节点 + 逐节点反馈** |

- 一个节 1–3 个课件；优先覆盖本节核心概念的可练习性，装饰性课件不做。
- `generated` 文生图与课件无关（那是图示域）；课件图表数据**一律用确定性生成器**声明。
- `bar-replay-decision` 是唯一使用真实行情的组件，**不需要生成器**；行情由云端按 `code` 从
  课程缓存自动取得。
- `image-juxtaposition` 与 `branching-scenario` 都是 `specVersion=2`；前者两侧画面可引用本节
  图示（`figureId`），后者是纯文本决策树，**都不依赖行情**。

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

## bar-replay-decision（M10 v2）

- 用途：让学员逐根看真实行情，在关键 bar 出现时做判断（买/卖/观望/止损等）。
- `specVersion=2`；`spec` 形状（架构 §6.6.5）：
  - `code`: 案例股代码（`sz|sh|bj`+6 位），必须在本节案例股清单内。
  - `window`: `{from, to}` 案例窗口（YYYY-MM-DD），必须落在该股行情缓存实际范围内。
  - `period`: 可选，K 线周期 `"1d"` 日线 / `"1w"` 周线，缺省 `"1d"`。**须与正文所讲周期一致**——
    正文讲周线结构就写 `"1w"`（行情按周期原生存放：日线与周线各存一份，周线取腾讯原生周 K）。
  - `overlays`: 可选，均线位数组，白名单 `M5/M10/M20/M30/M60`，最多 3 条，缺省 `["M5","M10","M60"]`。
    讲短线节奏用 `M5/M10`，讲中期趋势用 `M20/M30`，讲主趋势/生命线用 `M60`。
  - `annotations`: 老师标注点数组，每条 `{unitId, atMs, kind, d, label}`，用于回放进度条刻度；
    `kind`∈`structure|invalidation|rhythm`，`d` 必须是交易日。
  - `decisions`: 判断点数组，每条 `{atDate, question, options[{label}], correct, revealText, unitId, atMs}`；
    `options` 2–4 个，`correct` 为正确选项索引；`atDate` 递增（revealMonotonic）。
  - `citations`: ≥1 条支撑本课件教学的 source unit。
- **必带断言**：`decisionPointsGrounded`、`revealMonotonic`、`annotationTermsGrounded`、`answerUnique`。
  - `decisionPointsGrounded`: 每个 `decisions[].atDate` 都是交易日且在 window 内；`unitId/atMs` 可回溯。
  - `revealMonotonic`: `decisions` 按 `atDate` 严格递增，不能倒流。
  - `annotationTermsGrounded`: `annotations[].label` 必须**逐字等于**某个概念名（主词或别名，
    判定是集合包含不是子串匹配）；`decisions[].revealText` 只需**包含**至少一个概念名。
    标签写「龙头股与助攻股」这种并列表述会不过，改成裸术语「龙头股」。
  - `answerUnique`: 每道题有且只有一个正确答案。
- 写入顺序：必须先 `cloud_case_stocks_write` 落案例股 → `cloud_quotes_sync` 同步行情 →
  再写 `bar-replay-decision`；否则 window 或交易日校验会失败。
- **必须早于正文**：正文 `:::replay code=... caption="..."` 按 code 解析本节唯一一份回放课件，
  课件未落库就写正文会 `400 replay_widget_unknown`（同 code 两份则 `400 replay_widget_ambiguous`）。
  `code` 在本节必须唯一。

## image-juxtaposition（M10 v3）

- 用途：把「同一只票在某个结构点前后」或「错误做法 vs 正确做法」并排给学员，拖动滑块比对。
- `specVersion=2`；`spec` 形状：
  - `left` / `right`: 两侧画面，**二选一**且不可混写——
    `{"figureId":"fig_…"}`（引用本节已落库的图示）或
    `{"generator":"uptrend|downtrend|range|uptrend-platform|downtrend-platform","seed":<整数>,"bars":20..300}`（合成 K 线）。
  - `labels`: `{left, right}` 两侧角标短标签（画面上的浮层文字）。
  - `captions`: `{left, right}` 两侧说明文字，**每条必须包含至少一个课程术语**（否则 409）。
  - `citations`: ≥1 条支撑本课件教学的 source unit。
- **必带断言**：`pairSidesValid`（figureId 侧必须在本节图示清单内；生成器侧参数合法）、
  `captionsGrounded`（两条 caption 都含课程术语）。
- 写入顺序：`figureId` 侧必须先 `cloud_figure_write` 落图示，否则 409；
  生成器侧不依赖任何写入顺序。
- **caption 与画面的绑定纪律**：caption 写的是画面上可核对的事。
  - `figureId` 侧：caption 的日期/价位必须来自该图示本身（正文已写过的数字），不另造。
  - `generator` 侧：画面是**合成 K 线**，没有原片的日期与价位——caption **不得**绑定某个原片交易日
    （「8 月 25 日涨停那根」这类写法是硬伤：合成图上不存在那一天）。要么把 caption 改写成
    「环境成立／环境不成立」这类结构判断，要么改用 `figureId` 侧引用真实图示。

## branching-scenario（M10 v3）

- 用途：把「这根长阳是启动还是诱多」这类判断题做成有分支的决策树，学员逐节点作答。
- `specVersion=2`；`spec` 形状：
  - `scenario`: 情境陈述（学员看到的题面）。
  - `entryId`: 入口节点 id，必须是某个 `nodes[].id`。
  - `nodes`: 决策树节点数组；每节点 `{id, prompt, options?}`，
    `id` 全树唯一；非末节点 `options` **2–4 项**，每项 `{label, next, feedback}`，
    `next` 必须是树中已存在的节点 id，`feedback` 是选该项后的即时反馈（不能为空）。
    末节点无 `options`（即无后续分支的终点）。
  - `optimalPath`: 最优路径的节点 id 数组，首元素必须是 `entryId`，每一步都要有边可达。
  - `citations`: ≥1 条支撑本课件教学的 source unit。
- **必带断言**：`graphAcyclic`（决策树不得成环）、`allPathsTerminate`（每条路径都能走到末节点）、
  `optimalPathReachable`（最优路径真实可达）、`feedbackNonEmpty`（每项反馈非空）。
- 作答只在本机内存，不落库、不进 validation、不进 provenance——反馈文本写在课件里即可。
- **树形口径**：`optimalPath` 走的是**讲师口径**，不是「最不容易错」的路径；
  非最优分支同样要能走到末节点（`allPathsTerminate` 会查），且每条 feedback 都要落在正文讲过的判断上，
  不能是正文没讲的泛泛之谈。

## spec 白名单的已知回灌点（都是 400，不是断言问题）

- **`spec` 里不能带 `type` 字段**——`400 spec.type is not allowed`。类型由外层 `type` 参数表达，
  spec 只放该类型的专属字段。标杆节里的旧课件带 `type` 是旧服务端版本的产物，照抄会挂。
  （服务端落库时会自行补写 `type`，所以 `cloud_section_preview` 回读看到 `spec.type` 属正常，
  不要因此再发一遍带 `type` 的 spec。）
- **`assertions` 的参数形状按类型定**：`cardCount` 是对象 `{min,max}`，不是数字；
  `slopeRange` 是数组 `[min,max]`；`trendlineTouches` 是 `{min}`。
- 这些是形状校验失败（400），不会进 409 断言回灌流程——按错误信息改形状即可，别反复重写。

## citations 与溯源

- 全部组件 `citations` ≥1（支撑本课件教学的 source unit）；课件落库后上报
  `content.widget_spec` 溯源。

## 收敛纪律

- 409 回灌 ≤3 次（按 failed 断言修正）；3 次不过放弃该课件转人工，不降级规格硬塞。

## spec 载荷形态（嵌套数组易被改写）

写 spec 的 tool-call 载荷若含多层嵌套数组（`branching-scenario` 的 `nodes[].options[]`
最典型），可能在传输中被改写成单键对象，服务端回 `400 spec.nodes must be an array`——
**这不是 spec 形状错，是载荷问题**。对策：

- 把 spec 压成**单行紧凑 JSON**，整份控制在 2000 字符以内；节点 id 用纯 ASCII 短标识
  （`n1`/`n2`/`end`），不用中文或长名。
- 决策树刻意做小：3–4 个节点、每个非末节点恰好 2 个选项、feedback ≤40 字。
- 收到 400 形状错误时先怀疑载荷：把 spec 再压小重试；仍不行就把同一份 JSON 交给
  **新起的子代理**写入（子代理的 tool-call 载荷更稳），不要去研究 harness 源码。
- `spec` 里始终不许带 `type` 字段。

## v2 新题型的落库口径（真产验证，2026-11-07）

`image-juxtaposition` / `branching-scenario` 已在真实内容上跑通（总论 1/2/3 三节各 1 件，
断言证明全部一次通过）。落库口径按下面四条走：

1. **`spec.citations` 与外层 `citations` 都要给**：服务端缺 `spec.citations` 回
   `400 spec.citations is required`（只给外层 `citations` 不够）。两处都是**扁平字符串数组**，
   写成 `[["…"]]` 会被判形状错。
2. **断言值形状两种都被接受**：`image-juxtaposition` 用布尔 `true`
   （`{"pairSidesValid":true,"captionsGrounded":true}`）；`branching-scenario` 的四项用空对象
   `{}` 即可（`{"graphAcyclic":{},"feedbackNonEmpty":{},"allPathsTerminate":{},"optimalPathReachable":{}}`），
   服务端回读显示为 `""` 属正常——证明器只看键在不在。
3. **载荷被改写时的实测解法**：`nodes[].options[]` / `optimalPath[]` 这类嵌套数组被改写后回
   `400 spec.nodes must be an array of 1–20 items`；把同一份 JSON 压成**单行紧凑**重发即可通过
   （已实测：一次失败、单行重发成功）。别改内容形状去迁就载荷。
4. **同 figureId 对不要出两份 image-juxtaposition**：画面重复会让学员对着同一张图读两遍。
   同一节里若已有同 figureId 对的一份，**删自己那份**（`cloud_widget_delete`），保留信息更精确、
   数字更可核的那份；删完上报一条 `status=error` + `errorCode=artifact_retracted` 的溯源留痕。
