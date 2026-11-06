# 趋势课程生产插件需求

版本：v0.6（2026-11-06）
状态：与云端需求 v0.20（C13/C14）与云端清单 v0.18 §3.13/§3.14、云端架构 v0.23 §6.5/§6.6 对齐；本文只定义插件侧职责与验收。v0.6 P0 收口：新增 `cloud_figure_delete` 工具（图示纠错回路，与 `cloud_widget_delete` 对称）——图示写入的覆盖语义救不回「废图烧掉配额」与「图示本身不该存在」两类情形，此前生产端无任何图示删除通道。v0.4 M3b 呈现层 R2/R3 代码落地：`cloud_quotes_sync`/`cloud_quotes_read`/`cloud_widget_delete` 工具已接线（producer 可触发行情回填、读回实际交易日、删除课件纠错）；`bar-replay-decision` 与 DSL v2（`:::annotation`/`:::replay`）写作工艺、工具描述、断言口径已落地；**真产一节已跑通**（TC-ZONGLUN「阻尼运动」节，2026-11-06，主编自评 approve）。v0.5 M10 R3 落地：TC-ZONGLUN 全 6 节 DSL 重写回灌完成（全部 `dsl_version=2`：24 图示 / 14 案例股 / 32 课件，每节唯一一份 `bar-replay-decision` 且四项断言全 pass，43 个标注与回放交易日全部落在行情缓存的实际交易日上，6 节主编自评全 approve，含 1 次真实打回→重写回灌）；rubric 阈值按 6 正 1 负样本标定（0.4.0→0.4.1，grounded 增「行情数值可核」一票否决子项，通过线 8 不变）；回灌暴露并已修三处生产缺陷（`cloud_case_stocks_write` 的 `events` 结构声明缺失、`cloud_quotes_read` 未摊开 bar 致数值不可核、正文与课件标注标签口径混淆）；Skill 工艺包同步升至 `section-production` 0.5.0 / `courseware-design` 0.2.0 / `chapter-authoring` 0.5.0 / `diagram-authoring` 0.2.1 / `quality-rubric` 0.4.1（写入顺序改为「案例股→行情同步→行情读回→图示→回放课件→正文→其余课件→评审→溯源」）。v0.3 梳理：F7 呈现层生产收敛为「产出什么 + 验收口径」，编排细节归架构 §4；题型清单补 `bar-replay-decision` 与架构 §6.6.5 对齐；关联文档版本号校准。

## 1. 背景与目标

`trend-coach-cloud` 已定型"语料级课程生产"目标架构：约 69 集录播视频（10 卷，≈35h）经多模态理解、课程综合与逐节 grounded 生产，产出含交互课件（白名单组件 JSON spec + 断言程序证明）的图文课程。生产 Agent 循环外置于本插件，云端只提供确定性底座（帧轨道、存储、检索、复检、溯源账本、发布门禁）。

本插件目标：

1. 提供生产工具集：把云端清单 §3.13/§3.14 接口封装为 Agent 可调用的 `cloud_*` 工具族，边界校验、凭据托管、错误映射。
2. 提供生产编排：理解 → 课程综合（门禁①）→ 逐节生产（三层校验 + 门禁②）四阶段流程与断点恢复。
3. 承载 Skill 工艺包：教学法、写作结构、课件设计、图示规范、术语表、rubric 评审，以 SKILL.md 形式可热迭代。
4. 履行溯源义务：每个产物上报 provenance，保证云端账本完整覆盖生产调用。

**不做**：媒体处理（转码/抽帧/转写均在云端）、发布（云端管理台人工触发）、学员侧任何功能、模型密钥托管（密钥在生产端 dsh 模型配置自配）。

## 2. 调用方与角色

| 角色 | 说明 |
|---|---|
| 教员（生产者） | 在 dsh（web/headless）中驱动生产会话；审批门禁①② |
| 云端 | 契约对端：接收草稿与溯源，执行复检与发布门禁 |
| 主 Agent | dsh agent loop 中的编排者：装载 skill、调度子代理、调用工具 |
| 子代理 | 每节一个的并行生产者（spawn/fork），隔离上下文 |

## 3. 功能需求

### F1 工具集（T1，P0）

- `cloud_frames(assetId, from, to)`：取关键帧轨道（签名帧 URL，供多模态消息）。
- `cloud_source_units_write(units)` / `cloud_source_units_search(assetId?, q?, conceptId?)`：理解产物批量写入（幂等）与混合检索（只回摘要）。
- `cloud_source_units_read(unitIds)`：批量读完整证据（转写原文、视觉描述、窗内关键帧、播放会话），写正文前必用（M3b）。
- `cloud_concepts_write` / `cloud_concept_edges_write`：术语归一与依赖边。
- `cloud_sections_write` / `cloud_section_article_write(sectionId, markdown, citations)`：节与节教材草稿。
- `cloud_section_preview(sectionId)`：读回节的教材正文、课件 spec 与图示（主编评审前置读）。
- `cloud_widget_write(sectionId, spec)`：课件 spec 提交（服务端复检，`409 assertion_unproven` 返回给模型重写）。
- `cloud_provenance(entry)`：溯源上报。
- `cloud_pipeline_status(assetId)`：ingest/转写/帧轨道就绪状态查询。
- `cloud_figure_write(sectionId, figure)`：节级图示写入（keyframe 选帧 / SVG 模板 diagram spec），支撑配图卡（M10）。
- `cloud_case_stocks_write(sectionId, stocks)`：节级案例股清单写入（名称/代号/案例窗口/事件锚点），云端复检后落库（M10）。
- `cloud_quotes_sync(courseId)`：触发课程级行情回填/日更（M10；producer 可调用，须在写含 `:::annotation` / `:::replay` 的正文前执行）。
- `cloud_quotes_read(courseId, codes)`：读回行情缓存的实际交易日（M10；正文标注 `d` 与回放 `atDate` 只能取自返回的 tradeDate）。
- `cloud_widget_delete(sectionId, widgetId)`：删除本节一份课件（M10；生产端纠错回路，删旧再写新）。
- `cloud_figure_delete(sectionId, figureId)`：删除本节一张图示（P0；生产端图示纠错回路——覆盖写救不回废图与废配额，删除不可恢复，正文若已 `:::figure` 引用该 id 须一并改写）。
- 全部工具：入参出参 Host 边界校验、凭据经 credentials、超时映射、错误稳定码。

### F2 编排（T2–T3，P0）

- 阶段推进：理解（逐 chunk）→ 综合（目录先验校验 + 概念归一）→【门禁①】→ 逐节生产（子代理并行）→【门禁②】。
- 目录先验：以人工目录为骨架输入；目录外内容不创建。
- 断点恢复：以云端已有产物为准，按缺失单元重入队（云 DB 即 checkpoint）。
- 预算：编排步数与工具调用预算上限；超限进人工待办。

### F3 校验（T3，P0）

- 第 1 层 schema：工具边界 zod 校验（对齐云端清单 §3.13/§3.14 schema）。
- 第 2 层语义：断言自检（本地预验）、术语∈glossary、citations 可回溯、图示块（SVG 模板 spec，M10 起取代 Mermaid）grounded（模板参数中术语/数字逐条核对且可渲染）、媒体锚点对位（配图帧、片段时间窗、案例股事件日期必须落在对应 source unit 范围内）。
- 第 3 层教学质量：主编流程按 `quality-rubric` skill 结构化评分（0.4.1 起 grounded 含媒体与个股锚点，并增「行情数值可核」一票否决子项）；失败回灌重写（≤3 次），仍失败进人工待办。

### F4 课件起草（T3，P0）

- 白名单组件 spec：既有 8 类（`kline-annotator / pattern-quiz / step-reveal / calc-trainer / mcq-quiz / flashcards / checklist / timeline-explorer`）+ M10 扩容 `image-juxtaposition`（两图对比滑块）/ `branching-scenario`（决策树情境练习）/ `bar-replay-decision`（逐根回放判断，后两者随 `spec_version=2`）。
- spec 携带 `assertions` 与 `citations`；图表数据声明确定性生成器与 seed；禁止生成可执行代码。

### F7 呈现层生产（T5，P0，M10）

产出责任如下（编排顺序与产出时点见架构 §4；语法、配额与错误码以云端架构 §6.6 为准）：

- 教材正文：在 Markdown + citations 之上使用富文本 DSL 容器块（板书引用卡、大数字卡、对比卡/表、时间轴、警示卡、配图卡、片段卡，共 7 类；语法与逐组件 schema 见云端架构 §6.6.1），个股用内联锚 `[[stock:code|label]]`；`chapter-authoring` / `section-production` skill 内置 DSL 写作规范与用例。
- 配图：产出 keyframe 图示（选帧经 `cloud_figure_write` 落库）与 SVG 模板 diagram spec，正文配图卡引用；caption 带 unitId 徽章。
- 片段：声明教学时刻（概念源头、判读现场等）的片段窗写入片段卡，窗须完整落在对应 source unit 内。
- 案例股：产出节级案例股清单（名称/交易所·代号/案例窗口/事件锚点+unitId），经 `cloud_case_stocks_write` 落库，代号须经行情缓存核对存在。
- 图示 spec：`diagram-authoring` 从 Mermaid 产出改为 SVG 模板参数化 spec（模板白名单见云端架构 §6.6.4），标注文字必须正确。
- 老师标注与逐根回放（DSL/课件 v2 批次，2026-11-05 采纳，**代码/工艺已落地 2026-11-06**）：产出候选标注（结构点/证伪点/节奏点 + 原话 + `d` 交易日期 + 术语）随教材正文以 `:::annotation` 落 draft、经门禁②人工确认；产出 `bar-replay-decision` widget spec（判断点只落 widget spec，不在 DSL 标注 body 重复声明）；正文以 `:::replay` 按 code 内嵌（不带 widgetId）。写作顺序约束：案例股 → `cloud_quotes_sync` → 图示/课件 → 含 v2 DSL 块的正文。契约见云端架构 v0.17 §6.6.1/§6.6.5。

> 配图与案例股的落库工具 `cloud_figure_write` / `cloud_case_stocks_write` 已接线，T5 可全量落库。

### F5 审批卡点（T2/T4，P0）

- 门禁①（骨架/概念图谱/术语表）与门禁②（章节批量评审）经 dsh 审批 UI 由教员确认；审批结果决定流程推进或打回。

### F6 溯源（T1 起，P0）

- 每产物落库后上报 `{taskKey, model, provider, tokens, latency, skillVersions, targetId, status}`；未上报视为失败。

## 4. 非功能需求

| 类别 | 要求 |
|---|---|
| 安全 | 凭据只存 credentials；不注册 shell/文件写入工具；云端文本按不可信数据处理 |
| 稳定性 | 长任务可中断恢复（云 DB checkpoint）；编排预算上限；校验失败不静默 |
| 契约 | 接口字段与云端清单 §3.13/§3.14 一致；契约测试覆盖其验收用例 |
| 可观测 | 结构化日志（级别过滤）；产物状态可查询；不记密钥与产物正文全文 |

## 5. 验收（与云端 M9/M10 P0 对齐）

- T1：总论卷阶段 0–1 跑通（frames 可取、source units 幂等落库、溯源入账）。
- T2：骨架+概念图谱+术语表经门禁①批准落库。
- T3：单章（节教材+图示+课件）全量通过三层校验入 draft。
- T4：门禁②通过；总论卷可发布可检索；rubric 盲评占优 M8 产物；溯源账本完整。
- T5：单节按富文本 DSL 重写（含配图卡/片段卡/案例股锚点）通过门禁②（rubric 0.4.1）；媒体锚点与事件锚点全部可回溯。v2 批次（`:::annotation`/`:::replay`/`bar-replay-decision`）代码/工艺已落地，首个试点节真产运行后冻结。

## 6. 关联文档

- 云端需求 v0.16（C13/C14）/ 清单 v0.14 §3.13（M9 语料生产）与 §3.14（M10 呈现层）/ 架构 v0.17 §6.5（M9 生产）与 §6.6（M10 呈现层）——路径见 AGENTS.md
- [架构设计](./architecture-design.md)、[项目规范](./conventions/project-conventions.md)、[Skill 包格式](../../skills/README.md)
