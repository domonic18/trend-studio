---
name: section-production
description: 逐节生产编排（阶段 3）：九步生产状态机（引擎强制顺序）+ 研究→读证据→案例股→图示→写作→课件→主编评审的单节工作流与收敛规则
version: 0.7.0
---

# 逐节生产编排

消费者：节生产驱动 Agent（每节一次会话或一个子代理）。输入：一节（sectionId）+
钉住素材；输出：节教材 + 图示规划 + 1–3 课件全部过三层校验入 draft。

## 前置（缺一不做）

- 门禁① 已批准（骨架/术语表/概念图谱落库生效）。
- 节骨架已存在（`cloud_sections_write` list 可查）。
- 该节钉住素材的理解产物完整（`cloud_source_units_search` 覆盖素材时间轴）。

## 实际写入顺序（由依赖倒推，不是流水账）

```
案例股 → 行情同步 → 行情读回 → 图示 → 回放课件 → 正文 → 其余课件 → 评审 → 溯源
```

- 案例股先于正文：正文 `[[stock:]]` 内联锚校验该股在本节案例股清单内。
- 行情同步先于正文与回放课件：`:::annotation` 的 `d` 与回放判断点 `atDate` 都必须是缓存里的
  实际交易日；`cloud_quotes_sync` 按本节案例股清单取代码，案例股没落库就同步不到行情。
- 回放课件先于正文：正文 `:::replay` 按 `code` 解析本节唯一一份回放课件。
- 图示先于正文：正文 `:::figure figureId=...` 校验该 figure 属于本节。

## 流程向导（九步速查）

下表由契约真相源（`@trend/contracts` 的 `PRODUCTION_STEP_GUIDE`）渲染，与管理台「生产看板」
的流程向导步骤卡是**同一份数据**——人看到的卡片与你看到的这张表不会漂移。
改步骤说明要改契约再重渲染（`node scripts/render-flow-guide.mjs`），不要直接改这张表。

<!-- flow-guide:start -->
| 步 | 步骤 | 目标 | 工具 | 常见坑 |
|---|---|---|---|---|
| 1 | 案例股 | 落本节案例股清单（含周期口径），供正文股票锚与行情同步取数。 | `cloud_case_stocks_write` | 清单没落库就写正文 → 400 stock_not_in_list（股票锚校验本节清单）；每只股票都要定 period（1d 日线 / 1w 周线）：日线源只回溯到 2024-03 前后，讲更早年份必须写 1w |
| 2 | 行情同步 | 同步课程级行情缓存（按案例股代码取日/周 K），让标注与回放判断点有真实交易日可用。 | `cloud_quotes_sync` | 案例股没落库就同步不到行情——本步依赖第 1 步；同步是幂等的，可重跑；跑完不保证有数据，要看第 3 步读回多少根 |
| 3 | 行情读回 | 从缓存读回 bar，正文里的价格与成交量只能取自这次读回。 | `cloud_quotes_read` | 标注日期与判断点日期只能从返回的 tradeDate 里挑——视频里出现的日期未必落在缓存窗口内；禁止绕道外部行情源取价：渲染层画的就是这份缓存，数字对不上等于正文没 grounded |
| 4 | 图示 | 按 diagram-authoring 选型落图示拿到 figureId，供正文 :::figure 引用。 | `cloud_figure_write`、`cloud_figure_delete` | 图示没落库就写正文 → 400 figure_ref_unknown；超配额（diagram ≤2、keyframe ≤6）→ 409 figure_quota_exceeded；写错了要删而不是覆盖：cloud_figure_delete 不可恢复，正文若已引用该 id 要一并改 |
| 5 | 回放课件 | 落本节唯一一份回放课件（bar-replay-decision），正文 :::replay 按 code 解析它。 | `cloud_widget_write`、`cloud_widget_delete` | 课件没落库就写正文 → 400 replay_widget_unknown；同 code 两份 → 400 replay_widget_ambiguous；spec 的 period 与 overlays（均线位）必须与正文所讲周期、均线口径一致 |
| 6 | 正文 | 写 grounded 正文（Markdown + 富文本 DSL 容器块），段落级证据用 [[unit:]] 锚挂住。 | `cloud_section_article_write` | 引用未落库的图示 / 回放课件 / 非交易日标注会被拒（400），先补前序步骤；锚的 unitId 必须属于本课程，否则 400 unit_anchor_unknown；没有依据的具体说法不得落笔 |
| 7 | 其余课件 | 补齐其余白名单课件，并让每份课件的断言全部证明通过。 | `cloud_widget_write` | 409 assertion_unproven：按返回的 failed 断言改，不要盲改 spec；image-juxtaposition 可能引用本节 figureId，须等第 4 步图示落库后再写 |
| 8 | 评审 | 读回本节成品（教材 + 课件 + 图示）按 quality-rubric 打分，结论落 approve / reject。 | `cloud_section_preview` | 不靠记忆评分——先读回成品再打分；reject 重写后要把重写的那一步重新上报（attempt 自增），不能原地改 note 假装通过；≤3 轮仍不过转人工 |
| 9 | 溯源 | 上报本节的溯源记录：content.section_draft / content.widget_spec / content.rubric_review。 | `cloud_provenance` | token 与 latency 严禁估算——拿不到就留空，只报可核字段；溯源是发布门禁的一环，漏报会让内容无法正常发布 |
<!-- flow-guide:end -->

## 九步状态机（每步都要上报，引擎强制顺序）

这九步同时是**生产任务状态机**的九步，`cloud_production_task_write` 的 `step` 枚举：
`case_stocks` 案例股 → `quotes_sync` 行情同步 → `quotes_read` 行情读回 → `figures` 图示 →
`replay_widget` 回放课件 → `article` 正文 → `widgets` 其余课件 → `review` 评审 → `provenance` 溯源。

- **开工先读进度**：`cloud_production_tasks_read({courseId, sectionId})` 回九步状态、
  「当前该做第几步」与被挡步骤。返回的 `currentStep` 就是下一件该做的事。
  **已 `done` 的步骤不要重做**——续跑从 `currentStep` 起。
- **开始做某步先报 `running`，做完报 `done` 并在 `note` 写明产出**（≤2000 字）；
  出错报 `failed` 并在 `note` 写错误码；还没轮到报 `pending`；被上游挡住报 `blocked`。
- **顺序由引擎强制**：报 `running`/`done` 时前置步骤必须已 `done`，否则工具报错并告诉你
  「当前该做第几步」。`pending`/`blocked`/`failed` 只是记录，不受顺序约束。
- **回灌预算 3 次**：`attempt` 是这一步已开始的次数（首次 1，失败后重跑 +1），
  超预算工具会拒（提示转人工待办）——**不要继续重跑**，如实转人工。
- **状态落在云端 DB**（云 DB 即 checkpoint）：任何时候中断，重开会话读
  `cloud_production_tasks_read` 就能续跑，不必依赖对话历史。
- 评审 `reject` 重写后**重跑的那步要重新上报**（`attempt` 自增），不要在原地改 note 假装通过。

## 工作流（每节顺序执行，顺序不可换）

1. **研究**：按节素材拉全量 source units，产出研究简报（概念清单/实例/可用 keyframe 时间点）。
   `cloud_source_units_search` 回的是**摘要**，够选材、不足以支撑具体叙述。
2. **读证据**：对简报里要写进正文的 unitId 批量 `cloud_source_units_read`（每次 ≤20 个），
   取回转写原文、视觉描述、窗内关键帧与播放会话。**正文里每个具体说法都要有这一步的依据**；
   摘要级信息不得直接落笔。全有或全无：409 `unit_not_readable` 时剔除不可读项后重试。
3. **概念回填**：把本节实际覆盖的概念 id 写回节（`cloud_sections_write` 更新 conceptRefs）与 summary。
4. **案例股**（状态机 `case_stocks`）：`cloud_case_stocks_write` 落本节案例股清单。**必须早于正文**——正文的
   `[[stock:sz000713|丰乐种业]]` 内联锚会校验该股在本节案例股清单内，未落库即
   `400 stock_not_in_list`。
   每只股票同时定 `period`（`"1d"` 日线 / `"1w"` 周线，缺省 `"1d"`）：**按本节实际讲解的周期写**，
   讲周线结构就写 `"1w"`。这个值决定案例股面板画日线还是周线图，与正文口径必须一致；
   也决定行情同步取哪条源——**日线源只回溯到 2024-03 前后，早于该年的历史窗口必须写 `"1w"`**
   （周线源可回溯到 2013–2014）。写 `"1d"` 却讲 2015/2019 的行情，缓存里会一根都没有。
   开工报 `running`，清单落库后报 `done`（note 写「N 只案例股，周期口径 …」）。
5. **行情同步**（`quotes_sync`）：`cloud_quotes_sync({courseId})` 触发课程级行情缓存。**必须早于正文**——
   正文 `:::annotation` 的交易日 `d` 必须是该股行情缓存的实际交易日，否则
   `400 annotation_date_not_trading_day`。可重跑，幂等。报 `running` → `done`（note 写同步了哪些代码）。
6. **行情读回**（`quotes_read`）：用 `cloud_quotes_read({courseId, codes, period})` 读回缓存，**`d` / `atDate` 只能从返回的
   tradeDate 里挑**——视频里出现的日期未必落在缓存窗口内（日线缓存只回溯约 641 根日K，
   周线约 640 根周K；周期按案例股声明取，跨周期读会读空）。
   **正文里的价格与成交量只能取自这次读回的 bar**（返回里逐根列出日期/开/高/低/收/量）；
   **禁止绕道自行抓取外部行情源**——渲染层画的就是这份缓存，外部源会与之漂移，
   数字对不上就等于正文没 grounded。要看更早的 bar，用 `from`/`to` 缩小窗口再读一次。
   读回成功报 `done`（note 写读到多少根、窗口范围）。
7. **图示**（`figures`）：按 `diagram-authoring` 选型——diagram 路产出 `{template, params}`，keyframe 路从
   units 的 keyframes.sec 选讲解帧——逐个 `cloud_figure_write({sectionId, ...})` 落库拿 `figureId`。
   **必须早于正文**——正文的 `:::figure figureId=...` 容器块会校验该 figure 属于本节，
   未落库即 `400 figure_ref_unknown`。每节 diagram ≤2、keyframe ≤6，超配额
   `409 figure_quota_exceeded`，`sec` 不落 source unit `400 sec_not_grounded`。
   **写错了要删**：同节同 kind 同 caption 重写是覆盖（`figure_id` 不变），但覆盖救不回
   「废图烧掉配额」与「这张图不该存在」——用 `cloud_figure_delete({sectionId, figureId})`
   删掉重来（不可恢复；正文若已 `:::figure` 引用该 id，须一并改写正文）。
8. **回放课件（必须早于正文）**（`replay_widget`）：本节要用的 `bar-replay-decision` 先落库。正文 `:::replay`
   按 `code` 解析本节唯一一份回放课件——课件未落库就写正文必然 `400 replay_widget_unknown`
   （同 code 两份则 `400 replay_widget_ambiguous`）。其余题型（mcq-quiz / checklist /
   flashcards / timeline-explorer）不受此约束，可在本步之后补写。
   逐个 `cloud_widget_write`；409 assertion_unproven 按 failed 断言修正（≤3 次）。
   同节同 code 的回放课件**只能有一份**——写错了先
   `cloud_widget_delete({sectionId, widgetId})` 删旧再写新，不要留两份让回放入口歧义。
   `bar-replay-decision` 的 spec 要写 `period`（日线 `"1d"` / 周线 `"1w"`）与 `overlays`
   （均线位，白名单 M5/M10/M20/M30/M60，≤3 条）：**与本节正文所讲周期、均线口径一致**，
   否则图上画的线与正文说的线对不上。
   `image-juxtaposition` 同样要早于正文（它可能引用本节图示的 `figureId`），
   且**必须晚于第 7 步的图示落库**——`figureId` 侧未落库会 409 assertion_unproven。
   `branching-scenario` 是纯文本决策树，不依赖任何顺序。
9. **节教材**（`article`）：按 `chapter-authoring` 工艺写 grounded 正文（Markdown + 富文本 DSL 容器块），
   `cloud_section_article_write({sectionId, markdown, citations})`；400/409 按错误修正重写。
   正文里的段落级证据用 `[[unit:su_xxx|label]]` 内联锚（见下节「证据锚点」）。
10. **其余课件**（`widgets`）：按 `courseware-design` 选型与撰写，逐个 `cloud_widget_write`；
    409 assertion_unproven 按 failed 断言修正（≤3 次）。
11. **主编评审**（`review`）：先 `cloud_section_preview({sectionId})` 读回本节成品（教材正文 + 课件 spec + 图示），
    再按 `quality-rubric` 打分——**不靠记忆评分**；verdict=reject 按修改指令重写对应部分
    （≤3 轮），仍不过转人工待办并如实汇报。**reject 后重写的那步要把对应状态重新报一遍**
    （该步 `attempt` 自增；重写后报 `done`）。
12. **溯源**（`provenance`）：本节完成的写作与课件分别上报 `content.section_draft` / `content.widget_spec`；
    评审结果另报一条 `content.rubric_review`（`summary` 带 scores/verdict/failed/comments，
    `targetId` 为 sectionId）。

## 证据锚点（`[[unit:su_xxx|label]]`）

- **正文叙述具体证据处用锚**：`[[unit:su_0123456789abcdef|均线方向证据]]`。锚在学员端渲染为
  可点徽章，点了能回到该 unit 的出处；label ≤50 字，不写就留空由渲染端截短显示。
- **锚的 unitId 必须属于本课程**：不属于即 `400 unit_anchor_unknown`；格式非法即 400。
- **引用集口径 = 扁平 citations 字段 ∪ 正文全部 `[[unit:]]` 锚**（云端去重后落库）。
  锚不会让 citations 重复计数，但锚里没在 citations 里列过的 unitId 也会计入。
- **锚 vs 扁平 citations 怎么选**：正文里"这句话的依据是这段语料"——用锚；
  一个单元支撑整节多个段落、只想一次性声明来源——写进扁平 citations 即可，不必逐段挂锚。
  两者都写不冲突，但别为了凑数重复罗列同一 unitId。
- 容器块上的 `unitId=` 属性（`:::board` / `:::clip` / `:::figure`）与内联锚是两回事：
  前者是该块本身的溯源（`unit_ref_unknown`），后者是段落级引用（`unit_anchor_unknown`）。

## 权限边界（producer 无发布权）

- producer 角色只能写内容端点（source-units / sections / article / widgets / figures /
  case-stocks / concepts / edges / provenance），**没有 publish 权限**：publish 属
  operator/admin。发现自己在调 publish 端点即 403，说明该走审批流。
- 发布链路（由 operator/admin 执行，producer 不参与）：
  1. `POST /v1/admin/content/courses/:courseId/approvals`（gate=`final`）——服务端算课程内容指纹
     并落审批记录；
  2. 发布时服务端重算指纹比对：内容在审批后又被改过 → `409 approval_stale`；
     没有 final 审批 → `409 approval_required`。
- 因此 producer 交付的终点是**全部内容入 draft 且自评通过**；审批与发布由人/运维触发，
  不要在汇报里承诺"已发布"。

## 汇报格式（每节收尾）

```
## 节生产完成 · <节标题>
- 九步状态：案例股 done / 行情同步 done / 行情读回 done / 图示 done / 回放课件 done / 正文 done / 其余课件 done / 评审 approve / 溯源 done
- 教材：v<N>，<字数> 字，citations <M> 条（其中锚 <K> 个）
- 课件：<k> 个（类型清单，validation 全 pass）
- 图示：<k> 个（<类型清单>）
- 案例股：<代码清单>
- 概念回填：<概念列表>
- 主编自评：<各维分数>，verdict=<approve|reject>
- 遗留：<人工待办或无；发布待 operator/admin 审批>
```

要看整门课的进度用 `cloud_production_board_read({courseId})`（每节一行九步状态 + 正文版本 +
课件/图示/案例股计数 + 最近评审结论 + 最近的追加素材决策），**不要凭记忆汇报进度**。

## 正文版本升级回灌（呈现层扩容时）

DSL 升版（如 v2→v3）后存量节要跟上，走**增量回灌**：保留既有内容，只补新块。

- **既有内容逐字保留**：`[[unit:]]` 锚、`[[stock:]]` 锚，以及 `:::board`/`:::bignum`/`:::cmp`/`:::timeline`/`:::clip`/`:::figure`/`:::annotation`/`:::replay` 各块的属性与 body JSON 一个字符都不许改；既有 `:::warn` **只加 `variant`，body 不动**。
- **新增块的事实先读证据**：新增块涉及的事实先经 `cloud_source_units_read` 读回转写原文与视觉描述，不得自造。
- **写回后逐块核对**：把回灌前的锚集、figureId、annotation 属性、replay code 与回灌后逐项比对，一个都不能少——升级只许增不许改。
- 回灌同样经 `cloud_section_article_write` 写入，溯源报 `content.section_edit`。

## 纪律

- 单节失败不阻塞其他节；跨节顺序按目录 position。
- 绝不写入其他节的 sectionId。
- **只经 `cloud_*` 工具访问云端**：禁止用 bash/curl 直连服务端 API（含"探测"请求）。
  2026-11-04 事故：agent 直 curl 探测 widgets 端点产生探针课件、并绕过工具层直灌伪造
  token 的溯源记录，两者都成了人工清理项。
- **行情数据只来自 `cloud_quotes_read`**：禁止用 bash/curl 去任何行情站取价算指标。
  渲染层画的就是课程缓存这份数据，外部取价会与图上数字漂移，且绕过工具层无法溯源。
- **溯源 token/latency 严禁估算**：你在会话内拿不到自己的真实用量。工具结果里明确
  带出用量的（如 `cloud_understanding_run`）按返回值上报；其余调用省略 token/latency
  字段，只报 taskKey/model/provider/status/skillVersions/targetId。宁可留空，不可编造。
