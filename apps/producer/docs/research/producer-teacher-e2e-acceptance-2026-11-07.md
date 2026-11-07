# 教员端（制作课件的老师端）端到端验收记录（2026-11-07）

日期：2026-11-07　课程：`TC-E2E-2`（趋势理论入门）　执行：生产端 dsh headless 真机链路
（`trend-producer` profile，插件 0.1.8/0.1.9）　样片：`/tmp/趋势课1.mp4`

## 背景

这是「教员打开网站 → 装生产端 → 拖一个视频 → 做出第一节课」这条链路的第一次真机端到端验收。
目标不是跑通某一个工具，而是验证**教员拿一条视频，能不能独立产出一节可用的课件**：
九步引擎强制顺序、素材入库、转写与视觉证据、行情、案例股、图示、课件、正文、评审、溯源，
外加断点续跑看得见的看板。

## 验收结论

**通过。** 九步全部 `done`，产出齐备，评审 `approve`，且过程中暴露并修掉了三个生产缺陷
（下面「查出的缺陷」一节）——前两个正是这次验收存在的意义。

## 产出核对（以云库为准，非以 Agent 自述为准）

| 项 | 结果 |
|---|---|
| 课程 | `TC-E2E-2` 趋势理论入门（draft） |
| 章 / 节 | `ch-01` / `sec_d2ede8092f34c4de`（第1讲 趋势的成立判断与顺势交易，draft） |
| 概念 | 12 个（上升趋势 / 下降趋势 / 震荡 / 顺势交易 / 止损 / 仓位管理 / M60 / M20 / 有效突破 / 让利润奔跑 / 趋势跟踪策略）+ 14 条概念边 |
| 源证据 | 2 个 source unit（口播转写 + 视觉描述），`cloud_source_units_read` 全量可读 |
| 案例股 | 4 只（000713 丰乐种业 / 300750 宁德时代 / 600519 贵州茅台 / 002415 海康威视），每只带 2–4 个事件锚点（日期落在案例窗内、锚到具体 unit） |
| 行情 | `quotes_sync` + `quotes_read` 走通；正文与回放的每个价格都能在缓存 bar 里逐字对上 |
| 图示 | 2 件 `diagram`（timeline 阶段推进 + stat-inline 收盘价序列），`status=ready` |
| 课件 | 3 件：`bar-replay-decision` / `branching-scenario` / `checklist`，**云端断言全 pass** |
| 正文 | v3，`dsl_version=2`，Markdown 5639 字符（其中 2307 个汉字，落在 1200–3000 的口径带内），2 条 citations |
| 评审 | `review` 步 attempt 2（第一轮 reject 后回灌重写），最终 approve：coverage 9 / grounded 9 / order 9 / terms 9 / alignment 9 / frameQuality 7 / difficulty 8 / diagram 8 / presentation 8 / replay 8 |
| 溯源 | `content.section_edit` / `content.widget_spec` / `content.rubric_review` 等 taskKey 正常上报 |
| 九步状态 | `case_stocks → quotes_sync → quotes_read → figures → replay_widget → article → widgets → review → provenance` 全部 done |

### 课件断言（云端判定，非自评）

| 课件 | 断言 |
|---|---|
| `bar-replay-decision` | `answerUnique` / `revealMonotonic` / `decisionPointsGrounded` / `annotationTermsGrounded` 全 pass |
| `branching-scenario` | `graphAcyclic` / `feedbackNonEmpty` / `allPathsTerminate` / `optimalPathReachable` 全 pass |
| `checklist` | `itemsNonEmpty` / `termsInConcepts` 全 pass |

## 评审闭环真的跑起来了

第一轮评审 `reject`，Agent 自己查出并修了两处真问题，不是走过场：

1. **正文与课件口径打架**：正文说「M20 在 M60 下方不能直接当空头趋势读」，检查清单却写
   「反过来看下降趋势」——自相矛盾。删掉写歪的课件、重写反馈语。
2. **行情数值不可核**：正文引的收盘价/M20/M60 数值对不上缓存 bar。逐个回读缓存 bar 复算，
   正文改到 v3 才过。

这正是 rubric 0.4.1「行情数值可核」那一票否决子项要拦的东西——拦住了，并且 Agent 自己认账改。

## 查出的缺陷（都已在本次验收内修掉）

### 缺陷一 · `cloud_source_units_read` 出参漏 `partial`（0.1.7 → 0.1.8）

dsh 按工具声明的 `output.schema` 校验返回值且 `additionalProperties: false`——云端多返回一个
未声明字段，**整个工具结果被判非法**，表现是「读证据报 schema 错」而不是「少了一个字段」。
`partial` 是云端固定返回的（素材仍在转写时为 true），漏声明即整条证据链读不出来。

### 缺陷二 · 看板 / 九步进度读不出来（0.1.8 → 0.1.9）

同一类病，换了个位置：`cloud_production_board_read` 漏声明 `chapterId`，
`cloud_production_board_read` 与 `cloud_production_tasks_read` 都漏声明 `courseId`。
Agent 在终稿报告里自己记了这一条：「`cloud_production_board_read` 与
`cloud_production_tasks_read` 目前不可用（harness 输出 schema 报错：返回体里多了
`courseId`/`chapterId` 字段，与声明不符）」。

修完拿**云端真实载荷**回归（不是只跑单测）：

```
board  top: courseId,courseTitle,materialChoices,sections
section:   sectionId,chapterId,title,position,steps,articleVersion,widgetCount,figureCount,caseStockCount,reviewVerdict
step:      taskId,courseId,sectionId,step,status,attempt,maxAttempts,note,updatedAt
→ 两个工具的出参 schema 均 PASS
```

### 缺陷三 · 本机关键帧全 404（云端 compose）

`docker-compose.local.yml` 没设 `MEDIA_LOCAL_DIR`，业务进程就不注册 `/media/*` 路由
（生产走 CDN 才可不设），于是生产端拿到的关键帧签名 URL 全部 404，VLM 无帧可用——
**表现为「读证据没有画面」，而不是报错**。

第二个坑：本机 `127.0.0.1:3939` 曾被宿主上的开发进程（`tsx src/index.ts`）占着，
容器虽在跑、实际应答的是那个旧进程。`lsof -nP -iTCP:3939 -sTCP:LISTEN` 一看便知。

## 固化：把这类缺陷变成回归

根因不是「写漏了一个字段」，而是「出参按裁剪后的形状手写，云端契约后来加字段没人回头」。
固化办法：`apps/producer/test/tools-output-schema.test.mjs`——拿 zod 契约生成样例载荷，
逐个喂给工具声明的出参 schema（用 dsh 自己的校验器 `validateJsonSchemaValue`），
**双向**卡住「漏声明」与「多声明野字段」。改契约就要改这个测试。

验证过它真的会咬：把 `courseId` 从出参里删掉，3 条测试立刻红。

## 遗留（本次不做，已记录）

1. **案例股清单没有删除接口**：本节保留 4 只，Agent 说明后三只是以「同一套判据换一只票 / 对照」
   的方式在正文里真实使用的，不是凑数；但确实缺一个纠错回路（`cloud_case_stocks_write` 只能覆盖）。
2. **原片结尾预告的下一节未创建**：等教员给目录或指令再建——这是正确的行为，不是缺陷。
3. **运行时长**：单节从建课到定稿约 1.5–2 小时（含 Agent 自算 M20/M60 与逐个复核行情数值）。
   慢的主因是评审口径要求「行情数值可核」——Agent 会回读缓存 bar 手工复算每一个数字。
   这是正确性成本，但值得后续优化（见下）。

## 后续可做

- 行情数值复核目前靠 Agent 手工回读 + 本地算均线。让云端在 `cloud_quotes_read` 直接给
  M20/M60 之类的派生指标（带公式与参数域），Agent 就不必自己算了——既快又更可核。
- 案例股删除回路（与 `cloud_widget_delete` / `cloud_figure_delete` 对称）。
