---
name: transcript-understanding
description: 理解 Agent 工艺：把课时转写与关键帧加工成 source units（阶段 1，M9 §6.5.2）
version: 0.1.0
---

# 转写-关键帧理解工艺

消费者：理解 Agent（dsh agent，模型 = MiniMax-M3.1-Flash，配置见仓库 AGENTS.md）。
输入：一个素材（assetId，ingest 已 succeeded）；输出：该素材的 source units 全量落库 + 溯源全覆盖。

## 前置检查

1. `cloud_pipeline_status(assetId)`：ingest 必须 `succeeded`；未完成禁止进入理解。
2. `cloud_transcript(assetId)` 翻页取全量转写段（每段含全局毫秒时间戳）。
3. 若云端已有该素材的 source units（`cloud_source_units_search` 不带 q 列表），按 orchestrator
   差集规则只补缺失窗口——(assetId, startMs) 幂等，重跑不产生重复，但不要无谓重跑烧额度。

## 分块规则（与 src/host/orchestrator.ts 的确定性规划一致）

- 目标窗口 480 秒，相邻窗口重叠 30 秒；**在转写段边界收口**，绝不把一句讲解切成两半。
- 每窗口取帧：`cloud_frames(from=窗口起, to=窗口止)`，**每 2 帧取 1 帧**（≈1 帧/30s 定版口径）。
- K 线/指标密集卷（筹码、买卖点、指标类）如发现画面切换快于 30s，降回每帧都取（1 帧/15s），
  并在溯源 `skillVersions` 里标注采样口径。

## 调用红线（选型实测结论 2026-11-04，不得更改）

1. **max_tokens ≥ 32768**：本模型强制 thinking，预算给小了输出会被思考吃光直接截断。
2. **输出只有 JSON 数组**：每段讲解一个对象
   `{startMs, endMs, transcriptText, visual:{description, chartType, keyframes:[{sec}]}, summary}`。
3. **时间锚点**：startMs/endMs 是素材绝对毫秒，必须落在当前窗口内且 endMs > startMs；
   keyframes.sec 必须取自本窗口真实帧的秒值——**统一用对象形态 `{"sec":800}`**（模型有漂移，
   写入前把裸数字归一化为对象形态）。
4. **画面描述必须承载转写没有的画面事实**：指数/个股名称、K 线周期、均线参数、具体价位、
   指标窗格（MACD/KDJ…）、板书标题与圈注内容。转写说"看这个图"时，图上是什么由你写清楚。
5. **chartType 枚举**：`kline | indicator | annotation | talking-head | text-slide | other`，
   按"该段讲解的主要画面"判定，不按帧数占比。

## 写入与溯源

- 每窗口产物即调 `cloud_source_units_write(units)`（≤100/批）；本窗口全部 unitId 落库后，
  逐窗口调用 `cloud_provenance({taskKey:'content.chunk_summary', model, inputTokens, outputTokens,
  latencyMs, status:'success', skillVersions:{'transcript-understanding':'0.1.0'}, targetId:assetId})`。
- **未上报溯源的窗口视为失败**，断点恢复时会重跑。
- 云端 `409`/`400`（如 endMs≤startMs 的 refine 拦截）：按错误信息修正该 unit 后重写，
  不放弃整个窗口。

## 自检清单（每窗口收尾必查）

- [ ] 窗口内每段讲解都有 unit，且时间互不重叠、覆盖整个窗口区间
- [ ] 所有 keyframes.sec 落在窗口内且为对象形态
- [ ] 画面描述至少一处包含转写中不存在的画面细节（价位/指标名/板书文字）
- [ ] 溯源已上报且 status=success
