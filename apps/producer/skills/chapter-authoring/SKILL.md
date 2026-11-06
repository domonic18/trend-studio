---
name: chapter-authoring
description: 节教材写作工艺：五段结构、富文本 DSL 容器块写法与 grounded 规则（阶段 3 逐节生产）
version: 0.5.0
---

# 节教材写作工艺

消费者：节 Author 子代理（每节一个，并行）。输入：节钉住的 source units（`cloud_source_units_search`
检索 + `cloud_source_units_read` 读完整证据 + 节上钉住的 asset 时间窗）；输出：grounded Markdown
教材 + citations，经 `cloud_section_article_write` 落库。

## 写作前研究（必做）

1. 检索并通读本节全部 source units（`cloud_source_units_search` 拿清单与摘要）。
2. 对要写进正文的 unitId 批量 `cloud_source_units_read` 读完整证据——转写原文（`transcriptText`）
   与视觉描述（`visual`，K 线价位、指标、板书批注都在这里）才是写作依据，摘要只够选材。
3. 列出本节概念清单（对照 `glossary-trend`），确定依赖序：先讲依赖、后讲应用。
4. 产出研究简报（给自己看，不落库）：每条候选事实标注来源 unitId。

## 五段结构（缺段打回）

1. **概念**：是什么、解决什么问题；定义用讲师板书原话改写，不自造定义。
2. **判断依据**：怎么识别/怎么算，可操作的条件清单；有价位、参数就写具体值。
3. **实例**：来自语料的真实案例（如 2015 股灾、林园案例、长春高新/金龙鱼），标注视频位置
   （引用 unit 的 startMs–endMs）；实例必须真实存在于 source units，禁止编造行情数字。
4. **检查清单**：读者可逐条勾选的 self-check（3–6 条）。
5. **常见误用**：讲师明确反对的做法（如"下雨天晒被子"式硬交易），写清为什么错。

## 富文本 DSL 写法（M10 呈现层）

教材正文是 **Markdown + DSL 容器块**：普通段落照常写 Markdown，需要卡片化的地方用容器块。
容器块一律独占行，`:::name key=value … :::` 成对出现（**不可嵌套**）。

| 容器块 | 什么时候用 | 写法要点 |
|---|---|---|
| `:::board unitId=su_xxx` | 讲师板书原话 | 正文 1–500 字，贴板书原话改写；带 unitId 溯源 |
| `:::bignum` | 关键数字（价位、比例、天数） | body 是 JSON：`{"items":[{"label","value","note"?}]}`，1–3 项 |
| `:::cmp mode=card\|table` | 两个概念/两种形态对照 | body 是 JSON：`{"title"?,"left":{"head","items[]"},"right":{…}}`；`mode` 默认 card |
| `:::timeline` | 阶段推进 | body 是 JSON：`{"events":[{"date","title","desc"?}]}`，3–8 个，日期 YYYY-MM-DD |
| `:::warn title="..." variant=def\|rule\|misuse\|risk` | 概念定义 / 要点 / 误用 / 风险 | 正文 1–500 字；`variant` 缺省 `risk` |
| `:::think title="..."` | 折叠的「先想一想」 | 正文 1–800 字；默认收起，学员点开才展开 |
| `:::sidenote title="..." src="..." unitId=su_xxx` | 术语边注 | 正文 1–500 字；`title`/`src`/`unitId` 均可省 |
| `:::cards` | 目标卡网格（1–4 张） | body 是 JSON：`{"items":[{"num"?,"title","desc"?}]}` |
| `:::figure figureId=fig_xxx caption="..." unitId=su_xxx` | 配图（SVG 模板图或 keyframe） | 无正文；figureId 来自 `cloud_figure_write` 返回 |
| `:::clip assetId=asset_xxx from=150 to=186 caption="..." unitId=su_xxx` | 教学时刻片段 | 无正文；窗 ≤60s、每节 ≤3、须完整落在 unit 内 |
| `:::annotation unitId=su_xxx assetId=asset_xxx code=sz000713 kind=structure atMs=123456` | 老师在 K 线上某日的标注 | body JSON：`{"d":"YYYY-MM-DD","label":"…","quote":"…","glossary":["术语"]}`；`d` 必须是行情交易日；每节 ≤12 |
| `:::replay code=sz000713 caption="逐根回放…"` | 内嵌逐根回放判断组件 | 无正文；`code` 对应本节唯一的 `bar-replay-decision` 课件；每节 ≤2 |

- 个股内联锚：`[[stock:sz000713|丰乐种业]]`（代号带 `sz/sh/bj` 前缀），须在本节案例股清单内。
- 证据内联锚：`[[unit:su_0123456789abcdef|均线方向证据]]`（label ≤50 字，可留空），
  段落级溯源，锚的 unitId 须属于本课程。
- 属性白名单：写了未声明的属性即 `400`；结构化 body 必须是合法 JSON。
- 选型纪律：**一段文字能说清的不要塞卡片**；容器块服务于「要记住的结论」，不是排版装饰。每节容器块总数控制在个位数。
- 语法与逐组件 schema 的唯一契约源是云端架构 §6.6.1；写完在管理台节预览页回看渲染结果。

## 老师标注（`:::annotation`）与逐根回放（`:::replay`）

- **标注**用于「老师在 K 线某日画了一条线/圈了一个形态/说了一句点评」的场景；
  把老师的原话放进 `quote`，把点评日期放进 `d`，把涉及术语放进 `glossary`。
  `kind` 三选一：`structure`（结构/形态）、`invalidation`（失效/止损）、`rhythm`（节奏/时机）。
  `atMs` 是原片中的说话时刻（毫秒），用于学员端「跳回原片」。
- **回放**用于「让学员逐根看行情并做判断」的交互场景；正文只放入口，真正的判断题与
  reveal 文本写在 `bar-replay-decision` 课件里。`:::replay` 的 `code` 必须与本节某个
  `bar-replay-decision` 课件的 `code` 唯一对应，否则 `400 replay_widget_unknown/ambiguous`。
- 两种 v2 块都必须在 `cloud_quotes_sync` 之后写入：标注的交易日 `d` 需要行情缓存验证，
  回放需要行情 bars 作为渲染输入。**回放课件还要早于正文**——`:::replay` 是按 code 去本节
  找课件的，课件没落库就写正文必然 `400 replay_widget_unknown`。
- **正文的 `annotation.label` 是自由文本**（给人读的描述），做术语校验的是 body 里的
  `glossary[]`——其每一项必须 ∈ 本课程 concepts（主词或别名），否则 `400 annotation_term_unknown`。
  别把两处搞混：课件 spec 里的 `annotations[].label` 反而**必须逐字等于**概念名。
- **正文口径决定图的周期与均线**：讲周线结构（周线 M60、通道、箱体）就写「周线」，
  讲日线节奏就写「日线」——同一节不要混着说。案例股清单的 `period` 与回放课件的
  `period`/`overlays` 按这个口径填，图上的均线位与正文提到的均线（MA5/MA10/MA60 等）
  必须对得上；正文讲 M60 就别让图只画 M5。
- **正文里的价格与成交量只能取自 `cloud_quotes_read` 返回的 bar**，且必须带交易日。
  原片截图上的历史价位要显式标注原片日期，不能以现价口吻陈述——这一条是上一轮
  「筹码分布 1」被判 grounded 不过的根因。

## Grounded 规则（三层校验第 2 层的通过条件）

- 每个事实性段落携带 `citations`（支撑它的 source unitId 数组）；一个段落可多引。
- **段落级溯源用内联锚**：`[[unit:su_xxx|label]]` 写在具体说法所在的那句话里，学员端渲染为
  可点徽章。引用集口径 = 扁平 citations ∪ 正文全部 `[[unit:]]` 锚（云端去重后落库）。
  两种写法并存：锚点明"这句的依据是它"，扁平 citations 声明"整节依据是这几条"。
- 容器块上的 `unitId=` 属性（`:::board` / `:::clip` / `:::figure`）是**块级**溯源，
  与段落级内联锚互不替代：该块引用了哪条 unit 由属性说明，不靠正文锚。
- **转述不得改变原意**；讲师观点写明是观点（"讲师认为"），不要写成客观事实。
- 数字（价位、比例、年份）必须与 unit 原文或画面描述逐字一致；对不上的数字宁可不写。
- 术语 ∈ `glossary-trend`；板书原词优先。
- 正文 1200–3000 字、Markdown 子集（H2 分节 + 列表 + 强调，无 HTML/脚本/表格）；
  配图一律走节级图示：正文用 `:::figure figureId=... caption="..." unitId=...` 容器块引用，
  图示本体经 `cloud_figure_write` 落库（SVG 模板 diagram 或 keyframe 选帧），
  不内嵌外链、不写 Mermaid 代码块。
- 结尾不写总结口号；不出现"本文/本课程"式元话语。

## 交付自检

- [ ] 五段齐全且顺序正确
- [ ] 每段事实有 citations，抽查 3 处可回溯
- [ ] 正文引用的具体证据处挂了 `[[unit:]]` 锚，锚的 unitId 都来自 `cloud_source_units_read` 读回的证据
- [ ] 全部术语过表；数字逐字核对
- [ ] 字数与格式边界达标
- [ ] 容器块成对闭合、无嵌套、属性未越界；JSON body 可解析
- [ ] 若有图示：过 `diagram-authoring` 自检（模板白名单/术语过表/数字与正文逐字一致）
