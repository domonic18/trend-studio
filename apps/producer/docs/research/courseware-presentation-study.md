# 教材呈现形式调研与设计建议

版本：v0.3（2026-11-05）
状态：调研稿 + 增量提案。**P1 提案已于 2026-11-05 经 M10 工作线评审采纳（带 3 处修正，正式契约已写入云端架构 v0.10 / 清单 v0.8 / 需求 v0.9 C14）**，见 [`m10-replay-annotation-proposal.md`](m10-replay-annotation-proposal.md) 状态行；P2（A 类文生图）维持可选未来扩展。
配套原型：[`prototype/section-preview.html`](../../prototype/section-preview.html)（总论卷第 1 节静态演示，行情/转写/时间锚/标注均为演示数据）。v0.2 已把「逐根回放」与「老师标注」从视觉效果升级为可操作的判断—揭晓闭环，见 §2.6；v0.3 已按 C29 把原型与本文全部改写为 Markdown 扩展容器块 DSL，并起草 [`m10-replay-annotation-proposal.md`](m10-replay-annotation-proposal.md)（需求 v0.8 C14 / 对接清单 §3.14 增补提案），见 §2.7。

## 1. 问题定位

用户反馈：现有产物「Markdown 纯文字 + Mermaid 图」不好看，排版、内容形式丰富性、配图与配图呈现都不够好。

先明确一点：视频原片中已有老师画好的 K 线与标注，学员可直接在章节内播放对应片段，因此**不做「帧图 + 标注层」这类重复造轮子的工作**。目标是让课程内容的「教材本体」更好看、更好用。

根因不在生成质量，而在内容模型：

- 调研当时 `cloud_section_article_write` 存的是一整段 Markdown 字符串；M10 §6.6.1 已把它升级为「Markdown + DSL 容器块」。问题定位的结论仍然成立，只是根因已由并行工作线消除。
- 云端管理台渲染链路为 `react-markdown + remark-gfm + mermaid`（`trend-coach-cloud/web/admin/src/lib/markdown.tsx`），`pre` 块命中 `language-mermaid` 时转 Mermaid 组件。
- 这条链路决定了产物上限只能是「文字 + 一个 Mermaid 块」：排版不可控、无法嵌入交互组件、无法承载多模态，无论怎么调 prompt 都跳不出去。

本文最初建议「把一节教材从一整段 Markdown 升级为块级 JSON Spec 数组」（每块 `{type, props, citations, assertions, provenance}`，客户端按白名单映射组件）。**但这条建议已被仓库内并行工作线否决（C29），落地必须按 Markdown 扩展容器块 DSL；本文与原型已于 v0.3 全文改写到位。**

同类模型：H5P content type、Editor.js / Plate 的 block、Notion 块、MyST directive、MDX 组件。Editor.js 的关键论点是输出结构化数据而非 HTML blob，才能 sanitize、validate、多处复用——这一精神与 C29 一致，只是存储格式选了 Markdown 容器而非 JSON。

### 1.1 与并行 M10 工作的对齐（2026-11-05 发现）

查 git 状态时发现，同日已有另一条工作线完成了 M10 教材呈现层的契约设计并写入文档：

- 云端 `docs/architecture/architecture-design.md` **v0.8 §6.6**（教材呈现层与个股实盘对照），需求 v0.8 C14、对接清单 §3.14。
- producer `docs/requirements/product-requirements.md` **v0.2**（新增 F7 呈现层生产、里程碑 T5）、`docs/architecture/architecture-design.md` v0.2。
- 云端架构决策记录 **C29 明确「否决 blocks JSON 与自由 HTML」，正文承载选 Markdown 扩展容器块 DSL**（理由：作者与人工都在 Markdown 语境工作，citations / diff / 评审 / 渐进迁移可复用；JSON 容器对 LLM 产出稳定性与人工可读性双输）。DSL v1 已冻结：`dslVersion` 随响应下发，容器块含板书引用卡、大数字卡、对比卡、时间轴、警示卡、配图卡、片段卡、个股锚点。

因此本文的定位调整为**独立探索稿**，落地前需与 M10 对齐，具体差异：

| 本文建议 | M10 已定 | 处置 |
|---|---|---|
| 块级 JSON Spec 数组 | Markdown 扩展容器块 DSL（C29） | **按 C29 改为 DSL 容器 + 逐组件 zod schema**；本文「块」仅作为概念模型保留 |
| A 类文生图概念插画 | 关键帧选帧配图卡 + 参数化 SVG 模板（取代 Mermaid） | M10 未采用文生图；A 类作为可选未来扩展，需单独评审，不进 T5 |
| B 类结构化图 | SVG 模板 spec（`{template, params}` 白名单 4 类） | 一致，按 M10 模板白名单实现 |
| 前后对比、分支情景 | 课件扩容 `image-juxtaposition` / `branching-scenario` | 一致 |
| 交互 K 线数据源待定 | §6.6.3 已定：腾讯前复权日 K + 课程侧行情缓存 `quotes_sync`，单源无备用、失败降级 | **已解决**，本文 §2.5 的架构决策问题作废 |
| — | §6.6.3 交互基线 V3：双面板、M60、十字线、缩放/平移、事件锚点三角标记、双击复位 | 本文原型可作为该基线的补充 |
| 画中画 video-sync | 片段卡 `(assetId, fromSec, toSec)` 每节 ≤3、单窗 ≤60s | 一致，按片段卡实现 |
| **老师标注结构化详情** | 仅有 `kline-annotator` 的 `annotations?[]`（练习用的标注答案） | **M10 未覆盖，本文 §2.6 为增量 → `:::annotation`（dslVersion=2）** |
| **逐根回放 + 判断点暂停** | 仅有 `step-reveal`（分步解盘展示，合成 bars） | **M10 未覆盖，本文 §2.6 为增量 → `:::replay` + `bar-replay-decision`（spec_version=2）** |

结论：本文大部分结论与 M10 同向，**真正需要新提契约的只有「老师标注」与「逐根回放 + 判断点」这一对**；已按 M10 DSL 容器块语法改写（原型块类型清单、spec 示例、本文分期与原则均已同步），并形成独立增补提案交 M10 工作线评估，见 [`m10-replay-annotation-proposal.md`](m10-replay-annotation-proposal.md) 与 §2.7。

## 2. 调研结论

### 2.1 学习科学：改进方向是「减装饰 + 加强标注 + 加可操作性」

Richard Mayer 多媒体学习原则（数十项实验、多次元分析，效应量中到大）与 2026 年 Banks et al. 针对 56 项课堂随机试验的元分析（约 +0.5 SD）给出一致结论：

- **相干（coherence）**：装饰性配图不仅无益，还会 measurable 地降低学习效果。
- **标注（signaling）**：带明确标注的图，效果约为无标注图的两倍。这是投入产出比最高的一项。
- **分块（segmenting）**：长内容拆成学习者可控的小段，对理解影响最大。
- **空间/时间邻近**：图与说明文字紧贴；标签直接标在图上，而非放在图下的图例里。
- **冗余（redundancy）**：图上已有文字时不要叠加大段正文；图与正文不能互相复读。
- **预训（pretraining）**：先教术语再看主内容。
- 注意：双通道效应主要在「当堂理解」，两周后衰减，因此必须配检索练习与间隔重复，不能只靠图。

结论：用户要的「精美」应定义为「信息设计清晰 + 交互有教学价值」，不是增加装饰元素。每个视觉元素都要能回答「它教了什么」。

### 2.2 AI 生成课件：两阶段生成 + 增量修改

MAIC-UI（arXiv:2604.25806, 2026）是目前最贴近本场景的研究：从教材/PPT/PDF 生成可交互课件。其 formative study 中教师抱怨的四点（知识准确性、改不动、被动观看、过程性知识被写成静态描述）与本项目现状高度重合。可借鉴三点：

1. **两阶段 generate–verify–optimize**：阶段一产出内容对齐的交互模拟，阶段二只做布局校验 / 主题套用 / 动画打磨，不改事实。
2. **Click-to-Locate + Unified Diff 增量生成**：点选元素、自然语言描述修改，只打补丁，编辑响应从全量重生成的 200–600 秒降到 10 秒内。
3. **生成前结构化知识分析**（最多 50 页），把知识准确性作为独立门禁。

对照本项目：现有「校验失败回灌重写 ≤3 次」是整节重生成，成本高；拆成「内容 pass + 呈现 pass」并改成 diff 式增量，是明确的优化方向。

GenAIReading（AHs 2025）给出配图侧实证：图像摘要 + 悬停触发配图，理解测验较纯文本 +7.5%；但两点限制必须记住——AI 生图存在风格漂移（他们用「上一张图回喂作参考」保持一致性），且偏文字型学习者会被图干扰，故配图需可关闭 / 按需展开。

### 2.3 文生图用于教育图示：可信度是硬约束

KVBench（arXiv:2604.22302, 2026）用 30+ 本权威教材构建 1800 条知识密集型生图 prompt，评测 14 个主流模型，结论是「视觉上合理 ≠ 领域正确」：逻辑推理、符号精度、空间关系普遍不足。GEM-WebGT100 基准中 GPT Image 1.5 结构正确率 58.75%（地图类仅 34%），专用教育模型 GEM Image 为 92.25%。行业实践共识（2026 教材出版指南）：

- 精确结构图、带轴标签的图、数学符号、**图内嵌文字**仍不可信。
- 可用做法：先定视觉风格指南；prompt 写成像教学 brief 而非许愿；用参考图锁风格；**标签不放图内，由排版层叠加**；建立已审资产库复用；记录 model / prompt / 日期 / 审核人；每张生成图必须显式标注「AI 生成示意图」。
- 若图像承载学员可能被考到的事实，必须有学科专家签字。

KVBench 配套的 **KE-Check**（Knowledge Elaboration 知识扩写 → Checklist-Guided Refinement 逐项约束校验）几乎就是本项目 `assertions` + `quality-rubric` 的现成模板，可直接抄成评分维度。

**因此本项目必须把图示分成两类**（原型中已演示）：

| | A 类 · 概念类比插画 | B 类 · 结构化图 |
|---|---|---|
| 用途 | 建立直觉，如「阻尼运动 ≈ 弹簧衰减」 | 承载考点：形态、指标、概念依赖 |
| 生成 | 允许文生图 | 文本 → 结构化图规约 → 确定性渲染（Mermaid / D2 / 自研 SVG） |
| 图内文字 | **禁止**任何文字、数字、术语 | 每个标签都是结构化字段 |
| 溯源 | 标「AI 示意图 · 非考点」+ prompt/model/seed/审核人 | 每个节点、箭头挂 citation（原片时间锚） |
| 校验 | 风格一致 + 术语表比对 + 主编 rubric | 术语 ∈ glossary、citation 可回溯、云端可复检 |
| 能否进考点 | 否 | 是 |

起步建议：文生图先只用于章节封面、概念隐喻、分隔插图等非考点视觉，考点图一律结构化。

### 2.4 富交互教材的成熟参考

- **H5P**：开源交互内容体系，50+ content type，2026-02 Core 1.28 统一重做视觉（Daylight 主题、排版间距、移动端一致性）。除已覆盖的选择题/闪卡/清单/时间轴外，值得借鉴：Interactive Video（视频时间轴叠问题）、Image Hotspots、Image Juxtaposition（前后对比）、Agamotto（图像序列渐变，适合讲形态演化）、Branching Scenario、Mark the Words、Sort the Paragraphs、Accordion、Interactive Book。
- **Explorable Explanations / Distill.pub / Seeing Theory / Transformer Explainer / TensorFlow Playground**：把过程性知识做成可操作模型，先玩再定义，静态图无法替代。
- **Quarto / Jupyter Book 2（MyST）+ Tufte CSS**：出版级排版共识——非对称双栏、边注（sidenote 紧贴所注行）、callout 分型、图与说明紧贴、颜色只留给数据、HTML 出交互版 / PDF 自动回退静态图、交叉引用与图号自动编号。MyST directive 可直接当作教材正文的版面词汇表。
- **交易教学垂类**（TradingView 绘图工具、Devexperts DXcharts 教育版）：历史回放、自动形态识别、图上内嵌课程、clean-chart rule（不再帮助判断的标注应隐藏或删除）、标注要写清「为什么重要、什么条件证伪」。本项目因原片已有标注，这些能力只作为「交互层」参考，不重做视频内容。

### 2.5 交互 K 线：技术选型与本地资产

开源库对比（2026 年资料）：

| 库 | 许可 | 体积 | 特点 | 适配度 |
|---|---|---|---|---|
| KLineChart | Apache-2.0 | ~40–58KB | 27 指标 + 16 画线工具、中文文档、5 万条 37ms | 高（开箱即用） |
| Apache ECharts | Apache-2.0 | ~157KB（K 线最小集） | `option` 即纯 JSON，数据驱动 | **最高**（最贴 spec-only） |
| Lightweight Charts | Apache-2.0（需 attribution） | ~45–62KB | 最轻、金融渲染最优，但指标/画线全自研 | 中 |
| Highcharts Stock / TradingView Advanced Charts | 商业 | 大 | 功能最全 | 低（许可） |

推荐 **ECharts 或 KLineChart**：其配置本身就是JSON spec，云端可复检、无需执行任何代码，正好对应 `spec + assertions + citations`。Lightweight Charts 更轻但分析层要自己写。canvas 图表默认无 ARIA，需补文字替代。

**本地已有数据资产**（`~/Code/ai-invest-assisstant`）：TimescaleDB 超表 `quote_kline_stock_daily`（开高低收 / 成交量 / 成交额 / 振幅 / 涨跌幅 / 换手率）、`quote_kline_stock_minute`、周月季年线查询时聚合、`GET /api/v1/stocks/{code}/kline`、`/api/v1/kline`、以及 `kline_drawing` 画线标注与「AI 标注 → 人工采纳」流程。

但 `trend-coach-cloud/README.md` 明确写了「不耦合 ai-invest：独立实现，只借鉴技术选型」。~~待拍板：复制精简行情表 or 只读网关~~ —— **该问题已由并行 M10 §6.6.3 解决**：采用腾讯前复权日 K 单源 + 课程侧行情缓存（`pipeline_jobs.kind='quotes_sync'`，`section_case_stocks` 白名单内才下发，失败降级为「行情暂不可用」，不伪造数据），保持与 ai-invest 解耦。渲染组件契约为纯数据 `{bars, events, window}`，组件自身无网络依赖——与 spec-only 完全一致。

交互能力按教学价值排序：K 线 + 成交量副图 → 缩放/十字光标 → MA/MACD/VOL 叠加 → 区间与课程时间锚联动 → 老师标注层（结构化、可开关）→ **逐根回放**（先判断再揭晓，价值最高）→ 点击 K 线回跳原片秒数 → 正误案例对照。契约表达分两处：正文用 DSL 容器块声明标注与回放入口，widget spec 声明判断点，行情 bars 由宿主按 §6.6.3 取；时间锚、术语、引用全部挂 citation。

### 2.6 逐根回放 + 老师标注：这两个块为什么值得优先做

用户在原型评审中明确指出这两块最有意思。它们恰好是「把已有视频资产转成可复用教学资产」的杠杆点——不重做视频、不做帧图标注，只把老师原片里的一次性讲解沉淀成结构化、可校验、可联动的数据。

**老师标注（原型 `teacher-annotation` → 契约 `:::annotation`）**

以下两段描述的是原型内部的演示数据结构；**正式契约表达见 §2.7**（按交易日期 `d` 定位、属性即回溯键）。

原片里老师画过的线、圈过的位置、说过的那句判断，目前只存在于视频帧里，看完即逝。结构化之后每条标注是：

```
{ bar, kind, label, quote, atMs, glossary[], citations[], decision? }
```

- `kind` 分三类：结构点（摆动高低点）/ 证伪点（结构破坏）/ 节奏点（回撤衰减），渲染层按类型着色与过滤。
- 点击标注展开详情：老师原话、原片时间码、关联术语（须 ∈ glossary）、`sourceUnitId` + `atMs` 引用、跳回原片按钮。
- 数据来源有两条，可并行：① 理解阶段产出的 source units 已含转写与关键帧时间锚，可由模型抽取候选标注；② 教员在管理台对候选做一次确认/修正，之后按 `assetId + atMs` 长期复用。这正好落在现有 `provenance` 与门禁②（主编评审）流程里，不需要新建审批机制。
- 与「不可信文本」纪律一致：详情卡里的 quote 来自云端，渲染前做转义（原型里已实现 `esc()`）。

**逐根回放（`replay + decision`）**

不是动画效果，是一个「先判断、后揭晓」的检索练习循环，对应 Mayer 的 segmenting 与 generative processing，也呼应交易教学里成熟的 bar replay 训练法：

```
播放到 pauseAtBar（契约层为 pauseAtDate）→ 暂停并遮罩未揭示区域 → 弹出判断点问题
→ 学员提交（答案被锁定，不能回改）→ 显示老师当时的结论 + 原话 + 时间码
→ 继续揭晓 → 下一个判断点 → 结束给出小结（对了几处、错因通常在哪一步）
```

关键设计：判断点设在标注 bar 的前一根（原型如 `bar:40` → `pauseAtBar:39`；契约层为 `pauseAtDate < d`），确保学员在看到老师结论之前先自己判断；回放期间纵轴用全区间定标，避免逐根揭示时图形跳动。原型会给出「对了几处、错因通常在哪一步」的小结，但**提案明确把学员作答留在本地**：不落库、不上报、不进 provenance／M2 事件；若未来要做「哪一步最容易错」统计，须另立需求评审同意模型。

原型已实现：播放/暂停、单步、1×/2× 速度、重置、进度条上的判断点刻度、未揭示遮罩、三类标注过滤、标注详情卡、判断提交与 verdict、回放小结，以及一份 `:::annotation` 的 DSL 容器块示例。

**为什么它俩要绑在一起做**：标注提供「在哪里停、停了看什么」，回放提供「什么时候看、看完要做什么」。单独做标注只是静态图层，单独做回放只是动画；合起来才把视频里的一次性讲解变成可重复练习、可统计、可溯源的教学资产。这也是 `video-sync`（画中画）之后最值得进 P1 的一对块。

### 2.7 按 M10 DSL 的表达（v0.3 补充）

C29 否决 blocks JSON 后，这两块不再作为「教材块数组」的两个 `type`，而是三类增量，全部挂在 M10 已冻结的机制上：

| 增量 | 版本 | 承载 |
|---|---|---|
| `:::annotation` | `dslVersion=2` | 正文容器块：属性行 `unitId/assetId/code/kind/atMs` 全必填，body 单个 JSON（`d`/`label`/`quote`/`glossary[]`/`decision?`） |
| `:::replay` | `dslVersion=2` | 正文容器块：属性行 `widgetId/code/caption` 全必填、body 空，就地嵌入回放 |
| `bar-replay-decision` | `spec_version=2` | 第 3 类扩容 widget（与 `image-juxtaposition` / `branching-scenario` 同批），`bars` 由宿主按 §6.6.3 取、不入 spec |

三个关键修正，都是对齐 M10 后才发现的：

1. **定位改用交易日期 `d`，不用 bar 索引**。行情回填分页、复权口径、窗口裁剪都会改变 bars 数量；日期与 `case_stocks.events[].date`、§6.6.3 `events` 口径一致，映射不到按「行情暂不可用」降级，不伪造数据。
2. **标注详情文本不重复落库**。widget spec 只带稳定键 `{unitId, atMs}` 引用 DSL 标注，避免双份真相源；`validation` 只记录正确答案的程序证明。
3. **学员作答不上报**。判断点答案只做本地即时反馈，不进 M2 事件白名单、不进 provenance、不进 `validation`；要做「哪一步最容易错」统计须另立需求评审同意模型。这条是把教学价值与隐私口径切开的关键护栏。

校验、断言词表（新增 `decisionPointsGrounded` / `revealMonotonic` / `annotationTermsGrounded`）、错误码、验收用例、实施影响与可直接复制的增补文本，全部在提案里。**提案不直接修改云端正式文档**，按契约先行交 M10 工作线评估。

## 3. 设计原则（建议写入 skill / rubric）

1. 模型只输出 **Markdown 正文 + DSL 容器块**（结构化 body 为 JSON），绝不输出 HTML/JS；渲染组件按白名单映射，新增 directive 随 `dslVersion` 升版本并随客户端发版。
2. 一节教材有固定版式骨架：目标 → 核心图示 → 分块讲解（边注术语）→ 判断依据 → 实例（原片 + 交互行情）→ 自检 → 常见误用。
3. A/B 类图示分离，考点图必须可校验、可溯源。
4. 每个视觉元素都要回答「它教了什么」；装饰图为 0。
5. 每个图必须有 caption 且被正文引用（signaling）；图上术语 ∈ glossary；每个数字/箭头有 citation。
6. 每个落库块上报 provenance（含 skillVersions / assetRefs），否则按既有硬约束视为该产物生产失败。
7. 渐进披露：折叠「先想一想」、可关闭配图、按需展开的边注，兼顾偏文字型学习者与移动端。
8. 无障碍与降级：canvas 图补文字替代、暗色模式、窄屏单栏、静态回退。

## 4. 落地分期

| 阶段 | 内容 | 契约改动 | 出口 |
|---|---|---|---|
| P0 | `chapter-authoring` / `section-production` 按 M10 DSL v1 写规范与用例（F7 / T5 已定）；`quality-rubric` 0.4.0 加「版式与视觉」维度与 Mayer 机检项 | 无（DSL v1 已冻结，skill 是数据不需发版） | T5：单节按 DSL 重写过门禁② |
| P1 | 本提案：`dslVersion=2` 增 `:::annotation` / `:::replay`；`spec_version=2` 增 `bar-replay-decision`；断言词表与 publish 门禁增项 | **需先改云端 C14 / §3.14 / 架构 §6.6 / OpenAPI + 契约测试** | 提案评估通过 + 契约测试对齐验收用例 |
| P2 | A 类文生图概念插画（非考点）+ 审核门禁 + 风格锁 | 需单独评审（M10 未采用文生图） | 可选未来扩展，不进 T5 |
| P3 | `video-sync` 画中画逐句联动、scrollytelling、边注、热点练习 | 需改云端 | 与 R2/R3 出口对齐 |

优先级建议：**P0 随 M10 的 T5 走（零新增契约）→ 用原型定风格 → P1 提增补提案（已完成，待评估）**。其中 `video-sync`（原片 + 转写 + 行情联动）不重做任何已有素材，只接三样现成资产，却同时解决排版单薄、配图缺失、缺少交互三个问题，建议列为 P1 之后第一个实现的高价值块；本轮用户明确更看重「逐根回放 + 老师标注」，故 P1 优先推这一对。

## 5. 风险

- 「精美」滑向「装饰」：违反相干原则，且每个新增视觉都增加审核与溯源成本。
- 文生图幻觉：结构/符号/标签错误会被学员当成事实；必须审核门禁 + 图内无文字 + 显式标注。
- 生成式 UI 与 spec-only 的边界被突破：一旦模型开始输出 HTML/JS，现有安全模型（不可信文本处理、最小权限、云端复检）即失效。
- 版权与合规：AI 生成图的商用条款与标注义务、行情数据用于教学的授权范围，都需在门禁中确认。
- 性能与可访问性：多 canvas 块、移动端、离线、暗色模式、ARIA 替代文本。
- 契约先行：任何字段变更必须先改云端需求 v0.8 C14 / 清单 §3.14 / 架构 v0.8 §6.6，再同步 producer `src/host/contracts.ts`、两个 skill 与实现；不可在探索稿或原型里单方面定义契约。

## 6. 参考

- Mayer 多媒体学习 12 原则 / 认知负荷：https://www.structural-learning.com/post/multimedia-for-learning
- Dual coding 2026 元分析要点：https://www.chalklearning.io/wiki/dual-coding-theory
- MAIC-UI: Making Interactive Courseware with Generative UI (2026)：https://arxiv.org/html/2604.25806
- KVBench / KE-Check: Knowledge Visualization benchmark (2026)：https://arxiv.org/abs/2604.22302
- GEM-WebGT100 教育生图结构正确性基准：https://www.huggingface.co/blog/AIPreplabs/gem-image
- GenAIReading (AHs 2025)：https://lacuna.tiptreesystems.com/work/genaireading-augmenting-human-cognition-with-interactive/version/art_c42a09a326fa6ce7a9426966b5f8aef0
- AI 教材插画 2026 实践指南：https://www.text2img.pro/?p=16105
- H5P 内容类型清单：https://h5p.org/content-types-and-applications ；Core 1.28 视觉更新：https://www.h5p.org/node/1555998
- Tufte CSS（边注 / 图文紧邻 / 颜色克制）：https://edwardtufte.github.io/tufte-css/
- Editor.js（块级 JSON 输出）：https://editorjs.io
- Quarto / Jupyter Book 2 对比：https://docsio.co/blog/jupyter-book
- Distill.pub 交互式文章：https://distill.pub/ ；Explorable Explanations：https://explorabl.es
- 金融图表库 2026 对比：https://redsurgetechnology.com/blog/best-javascript-financial-charting-libraries-2026
- 交易教育图表能力：https://devexperts.com/blog?p=8398

## 7. 执行状态（v0.3）

已完成：

- 按 C29 把原型的块类型清单与 spec 示例全部改写为 Markdown 扩展容器块 DSL；附录新增「这一页的呈现如何落到 M10 契约」的映射表（v1 已有 / v2 已定 / 本提案 v2 增量 / 未覆盖）。
- 起草 [`m10-replay-annotation-proposal.md`](m10-replay-annotation-proposal.md)：需求 v0.8 C14 / 清单 §3.14 增补提案，含 `:::annotation` / `:::replay` 语法、body schema、校验与错误码、`bar-replay-decision` spec 与 3 条新断言、版本兼容、门禁演进、11 条验收用例、实施影响、6 个开放问题、采纳后的写入顺序，以及可直接复制进云端文档的增补文本。
- 本文 §1 / §1.1 / §2.7 / §3 / §4 / §5 全部同步到 DSL 口径。

未执行（有意保留）：

- **未直接修改云端任何正式文档**（需求、架构、对接清单、OpenAPI、契约测试）——按契约先行，增补提案交 M10 工作线评估后由对方写入。
- 未修改任何 skill、rubric、`src/host/contracts.ts`、云端代码；未触碰并行工作线改动的 `docs/requirements/product-requirements.md`、`docs/architecture/architecture-design.md`（两文件在本次会话期间由其他进程改为 v0.2，已保留原样）。
- 原型、本文、提案均为新增未跟踪文件，未提交 git。
- 不采集学员作答、不新增端点与数据表、不改 `contractVersion`；这三条在提案中写为硬护栏。
