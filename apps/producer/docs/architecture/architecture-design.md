# 趋势课程生产插件 · 架构设计

版本：v0.7（2026-11-06）
状态：与云端架构 v0.23 §6.5（M9 生产）/§6.6（M10 呈现层）对齐；呈现层生产职责见需求 F7（产出什么与验收口径），本文只写编排与装配。v0.7 P0 收口：新增 `cloud_figure_delete` 工具与云端 `DELETE .../sections/{id}/figures/{figureId}` 端点——图示写入的覆盖语义（同节同 kind 同 caption，`figure_id` 不变）救不回「废图烧掉配额」与「图示本身不该存在」两类情形，生产端此前唯一的纠错手段是覆盖，等于没有回路；补齐后图示纠错与课件纠错（`cloud_widget_delete`）对称。v0.5 M3b 呈现层 R2/R3 代码落地：`cloud_quotes_sync`/`cloud_quotes_read`/`cloud_widget_delete` 工具已注册；Skill 工艺包（`chapter-authoring`/`section-production`/`courseware-design`）已增补 `:::annotation`/`:::replay`/`bar-replay-decision` 规范与断言口径；**真产一节已跑通**（TC-ZONGLUN「阻尼运动」节，2026-11-06：DSL v2 正文 + 回放课件 + 图示 + 案例股 + 行情 + 溯源全链落 draft，主编自评 approve）。v0.6 M10 R3 落地：TC-ZONGLUN 全 6 节 DSL 重写回灌完成（`dsl_version=2`，含 1 次真实打回→重写回灌）；编排顺序固化为「案例股→行情同步→行情读回→图示→回放课件→正文→其余课件→评审→溯源」（回放课件必须早于正文，`d`/`atDate` 必须落在已同步的行情缓存交易日上）；rubric 阈值按 6 正 1 负样本标定（0.4.0→0.4.1，grounded 增「行情数值可核」一票否决子项，通过线 8 不变）；回灌暴露并已修三处生产缺陷（`cloud_case_stocks_write` 的 `events` 结构声明缺失、`cloud_quotes_read` 未摊开 bar 致数值不可核、正文与课件标注标签口径混淆）。v0.4 梳理：Skill 包清单按实际九个包校准（原先「六包」为 M9 早期口径）；DSL 组件表述统一为「7 容器块 + 1 个股内联锚」；接口引用补 §3.14；§4 呈现层段去除与需求 F7 的重复。云端契约变化时先改云端文档再同步本文。

## 1. 定位与边界

本插件是 dsh Host 内的生产编排半（cordis 插件），负责"想与写"；云端负责"算与存 + 守门"。与学员插件 `dsh-plugin-trend-coach` 同构不同责：本插件以 operator/admin 会话访问 `/v1/admin/content/*`（云端清单 §3.13/§3.14），只写草稿，无发布权。

```
dsh（教员本机）
  ├─ Agent Loop（主 Agent，模型走 pi-ai providers + retryPolicy）
  │    ├─ Skill 注册表（dsh-skill + dsh-tool-skill，装载 skills/ 九包）
  │    ├─ 子代理池（dsh-subagent spawn/fork，每节一个并行）
  │    ├─ 审批卡点（dsh 审批 UI：门禁①②）
  │    └─ 本插件注册的 cloud_* 工具族 ──HTTPS──▶ trend-coach-cloud admin API
  └─ 本插件 Host：边界校验 / 凭据(credentials) / 错误映射 / 溯源装配
```

## 2. 模块划分

```
src/
  index.ts                 Host 入口：name/inject/Config/apply 装配
  host/config.ts           配置 schema 与校验（environment/baseUrl/consoleTokenRef/timeoutMs/logLevel）
  host/log.ts              级别过滤日志
  host/cloud-client.ts     云端 admin API 客户端（会话凭据、超时、错误映射、响应校验）
  host/tools/*.ts          cloud_* 工具注册（每工具一个文件：入参 zod + 调用 + 出参裁剪）
  host/contracts.ts        与云端清单 §3.13/§3.14 对齐的类型与 zod schema（单一真相）
  host/untrusted.ts        不可信文本处理（边界包裹/控制字符剥离/转义）
  host/orchestrator.ts     生产编排状态机（阶段推进、预算、断点恢复查询）
  host/review.ts           主编评审流程（rubric 结构化输出、回灌重试、门禁②装配）
skills/                    Skill 工艺包（见 skills/README.md）
test/                      Host 边界/契约测试（T1 起固化）
```

依赖方向：`index → tools/orchestrator/review → cloud-client/contracts → config/log/untrusted`；工具不互相调用，编排不绕过工具直连 HTTP。

## 3. 工具族（对齐云端清单 §3.13/§3.14）

| 工具 | 云端接口 | 说明 |
|---|---|---|
| `cloud_pipeline_status` | `GET /v1/admin/content/pipeline/jobs`（既有） | ingest/转写/帧轨道就绪判断 |
| `cloud_frames` | `GET .../media-assets/{id}/frames` | 签名帧 URL 列表，供多模态消息 |
| `cloud_source_units_write` | `POST .../source-units` | 批量 ≤100，幂等回执 `deduped` |
| `cloud_source_units_search` | `GET .../source-units` | 混合检索（只回摘要，用于选材） |
| `cloud_source_units_read` | `POST .../source-units/read`（M3b 新增） | 批量 ≤20 读完整证据：转写原文 + 视觉描述 + 窗内关键帧 + 播放会话；全有或全无（`409 unit_not_readable`）；写正文前的证据来源 |
| `cloud_concepts_write` / `cloud_concepts_list` / `cloud_concept_edges_write` | `PUT /concepts`、`GET /concepts`、`POST /concept-edges` | 术语归一；`409` 冲突回灌 |
| `cloud_sections_write` / `cloud_section_article_write` | `GET/PUT /sections`、`PUT .../article` | 节草稿与教材 |
| `cloud_section_preview` | `GET .../sections/{id}/preview` | 读回节产物（教材正文 + 课件 spec + 图示）；主编评审（门禁②）的前置读 |
| `cloud_widget_write` | `POST .../widgets` | 课件 spec；`409 assertion_unproven` 回灌重写 |
| `cloud_transcript` | `GET .../media-assets/{id}/transcript`（既有） | 转写原文；评审引用窗口核对、片段窗定位 |
| `cloud_figure_write` | `POST .../sections/{id}/figures`（M10 新增） | 节级图示：`keyframe`（按秒选帧）/ `diagram`（SVG 模板 spec `{template, params}`，模板白名单见云端 §6.6.4）；补齐原全链路无图示写入端点的断链 |
| `cloud_case_stocks_write` | `PUT .../sections/{id}/case-stocks`（M10 新增） | 节级案例股清单（名称/交易所·代号/案例窗口/事件锚点+unitId/用途注记）；云端复检（日期落窗、unitId 回溯） |
| `cloud_quotes_sync` | `POST .../courses/{courseId}/quotes-sync`（M10 新增） | 触发课程级行情回填/日更；producer 可调用；须在含 `:::annotation`/`:::replay` 的正文写入前执行 |
| `cloud_quotes_read` | `GET .../courses/{courseId}/quotes`（M10 新增） | 读回行情缓存的**实际交易日**；正文标注 `d` 与回放 `atDate` 只能从这里的 tradeDate 里挑（视频里的日期未必落在缓存窗口内） |
| `cloud_widget_delete` | `DELETE .../sections/{id}/widgets/{widgetId}`（M10 新增） | 课件纠错回路：同节同 code 的回放课件写错了先删旧再写新（生产端无发布权，纠错不靠覆盖抹掉） |
| `cloud_figure_delete` | `DELETE .../sections/{id}/figures/{figureId}`（P0 新增） | 图示纠错回路：抽错帧、画歪、或废图烧掉配额时删掉重来——图示写入的覆盖语义（同节同 kind 同 caption）救不回这两类情形；删除不可恢复，正文若已 `:::figure` 引用该 id 须一并改写 |
| `cloud_provenance` | `POST .../provenance` | 溯源上报（工具内部自动随产物调用，也允许显式调用） |

工具共性：入参 zod 白名单；出参只保留 Agent 需要的字段（不透传原始响应）；云端错误映射稳定码（`bad-request/forbidden/conflict/unavailable`）；幂等键由云端承担。

## 4. 生产编排

- **状态真相在云端**：编排启动时先查询云端已有产物（source units 覆盖区间、概念、节、课件、图示、案例股），差集即待办队列；任何中断后重启都按此重算。
- **阶段推进**：理解 → 综合 →【门禁①】→ 逐节 →【门禁②】→ 完成（等待云端人工发布）。门禁在 dsh 审批 UI 落地，审批不通过则流程终止于当前阶段，不带病推进。
- **预算**：每阶段设步数/工具调用上限；子代理每节设重写上限（默认 3）；超限写人工待办（工具输出中返回明确原因）。
- **并行**：逐节生产用 subagent spawn 并行，每节隔离上下文；主编评审批量汇总后执行。
- **呈现层生产（M10；产出内容与验收口径见需求 F7）**：逐节子代理一次产出 DSL 教材正文 + 媒体锚点声明 + 课件 spec，经三层校验入 draft；图示与案例股分别经 `cloud_figure_write` / `cloud_case_stocks_write` 落库，校验归云端。案例股依赖画面理解（转写口播通常零股票名），须待 source units 的 `visual` 可用后再提取。存量 6 节按 DSL 一次性重写回灌，不做新旧双轨。
- **老师标注与逐根回放生产（M10 v2 批次，2026-11-05 采纳，代码/工艺已落地 2026-11-06）**：候选标注由写作子代理从 source units 抽取，随教材正文 `:::annotation` 落 draft、门禁②人工确认；回放 widget `bar-replay-decision` spec 起草（判断点只落 widget spec 不在 DSL 标注 body 重复；`atDate` 严格递增且早于标注 `d`、均须交易日；`bars` 不入 spec）；正文 `:::replay` 按 code 内嵌不带 widgetId。契约见云端架构 v0.17 §6.6.1/§6.6.5（ADR C33/C34），无新增工具；新增 `cloud_quotes_sync` 工具支撑行情回填前置。

## 5. 模型接入

- 生产模型在 dsh「模型设置」以 pi-ai provider 配置（`anthropic-messages`/OpenAI 兼容 + 自定义 baseURL + 主备 retryPolicy），插件不托管密钥。
- VLM：帧图经多模态消息（签名 URL 图片块）进入理解子代理；模型须具备图像输入能力，provider 选型属运维配置（见云端清单 §8 待冻结）。
- 任务键口径：生产端调用的 taskKey 命名空间（`vision.describe`、`content.chunk_summary` 等）写死在 contracts，与云端账本对齐。

## 6. Skill 工艺包

九个包（格式见 skills/README.md）：`transcript-understanding`、`curriculum-synthesis`、`trend-pedagogy`、`chapter-authoring`、`section-production`、`courseware-design`、`diagram-authoring`、`glossary-trend`、`quality-rubric`。skill 为数据不是代码：版本随 provenance 上报（`skillVersions`），质量回归以 rubric 评估集把关（每卷 2–3 节金标准）。

M10 扩充（随 R1–R3 迭代）：

| 包 | M10 变化 |
|---|---|
| `chapter-authoring` | 内置 DSL 写作规范与用例（7 容器块 + 1 个股内联锚的选用时机、媒体锚点声明规则）；v2 批次 `:::annotation`/`:::replay` 写法与用例已落地（标注三分类、`d` 用交易日期、判断点归 widget spec、写作顺序约束） |
| `diagram-authoring` | 从 Mermaid 产出改为 SVG 模板参数化 spec（模板白名单 4 类，云端 §6.6.4；标注文字必须逐字核对术语与数字） |
| `courseware-design` | 新增 `image-juxtaposition` / `branching-scenario` / `bar-replay-decision` 三类题型工艺；`bar-replay-decision` spec/断言口径已落地，其余待试点冻结 |
| `quality-rubric` | 0.3.0 → 0.4.0：`grounded` 扩义到媒体、个股与老师标注/判断点锚点（配图帧、片段窗、事件锚点、标注 quote/atMs、回放 revealText 均为可回溯引用）；0.4.0 → 0.4.1（R3 标定）：评审前置强制读回行情缓存，`grounded` 增「行情数值可核」一票否决子项（逐字对 bar、截图价须标原片日期、派生指标可复算、标注定性词与当日形态相符）；通过线 8 保持不变（6 正样本落在 8–9，负样本由子项检出） |
| `section-production` | 写入顺序固化为「案例股 → 行情同步 → 行情读回 → 图示 → 回放课件 → 正文 → 其余课件 → 评审 → 溯源」（0.5.0，回放课件必须早于正文；`d`/`atDate` 须落在已同步的行情缓存交易日上） |

## 7. 安全与隐私

- 凭据：云端会话令牌走 credentials credential-ref；模型密钥在 dsh 模型配置；均不落日志/文件。
- 不可信文本：云端转写/摘要/回执进模型前边界包裹、进工具输出前转义（`host/untrusted.ts`）。
- 最小权限：不注册 shell/文件写入工具；帧图只经签名 URL；产物正文全文不进日志。

## 8. 里程碑与开放问题

里程碑 T1–T5 见 AGENTS.md（T5：单节按富文本 DSL 重写含配图卡/片段卡/案例股锚点通过门禁②，媒体锚点全部可回溯；v2 批次代码已落地，首个试点节真产运行后冻结）；接口级待冻结项统一维护在云端清单 §8（新题型断言词表含回放三条、rubric 0.4.1 阈值口径、行情源容灾等），本仓库不另立清单。
