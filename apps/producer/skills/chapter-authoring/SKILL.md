---
name: chapter-authoring
description: 节教材写作工艺：五段结构、富文本 DSL 容器块写法与 grounded 规则（阶段 3 逐节生产）
version: 0.4.0
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
| `:::warn title="..."` | 讲师明确反对的做法 | 正文 1–500 字 |
| `:::figure figureId=fig_xxx caption="..." unitId=su_xxx` | 配图（SVG 模板图或 keyframe） | 无正文；figureId 来自 `cloud_figure_write` 返回 |
| `:::clip assetId=asset_xxx from=150 to=186 caption="..." unitId=su_xxx` | 教学时刻片段 | 无正文；窗 ≤60s、每节 ≤3、须完整落在 unit 内 |

- 个股内联锚：`[[stock:sz000713|丰乐种业]]`（代号带 `sz/sh/bj` 前缀），须在本节案例股清单内。
- 证据内联锚：`[[unit:su_0123456789abcdef|均线方向证据]]`（label ≤50 字，可留空），
  段落级溯源，锚的 unitId 须属于本课程。
- 属性白名单：写了未声明的属性即 `400`；结构化 body 必须是合法 JSON。
- 选型纪律：**一段文字能说清的不要塞卡片**；容器块服务于「要记住的结论」，不是排版装饰。每节容器块总数控制在个位数。
- 语法与逐组件 schema 的唯一契约源是云端架构 §6.6.1；写完在管理台节预览页回看渲染结果。

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
