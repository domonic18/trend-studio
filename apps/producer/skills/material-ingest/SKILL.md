---
name: material-ingest
description: 素材入库工艺：本地视频/音频直传云端并入队转写（生产体验线入口场景）
version: 0.1.0
---

# 素材入库工艺

消费者：素材 Agent（dsh agent）。输入：用户提供的视频/音频文件（本机绝对路径）+ 目标 courseId；
输出：素材落库（status=uploaded）+ ingest 任务入队并跟踪到 succeeded。

## 五步链路（顺序固定，不得跳步）

1. **查重**：`cloud_asset_list({courseId})` 看课程里已有素材。同一份原片**只建一次**，
   已存在且 status 非 failed 的直接复用其 assetId。
2. **建素材**：`cloud_asset_create({courseId, title})` → assetId（status=awaiting_upload）。
   title 用人可读命名，如「第2讲 原片」。
3. **直传**：`cloud_asset_upload({assetId, path})`，path 是**本机文件的绝对路径**
   （用户拖进对话框的附件路径）。插件按「签发凭据 → 流式上传 → 落库确认」一次完成，
   字节不进插件内存。云端按字节数与摘要校验，多写少写或文件中途变化都会失败——失败就重调本工具。
4. **入队转写**：`cloud_asset_ingest({assetId, language})`（language 省略即 auto）→ jobId。
5. **跟踪**：`cloud_pipeline_status({assetId})` 轮询到 ingest `succeeded` 且关键帧就绪。

## 红线

- **ingest 未 succeeded 前禁止进入理解阶段**（`transcript-understanding` 的前置检查同款）。
- 上传失败**重传同一个 assetId**，不要重新建素材——重建会留下 `failed` 的孤儿素材。
- 素材状态卡在 `processing` 时只报告进度，不重跑 ingest（重跑会重复消耗转写额度）。
- `errorCode` 非空即失败：报告原文，不要自行猜测原因。

## 追加素材（课程做到一半再拖一个视频进来）

**必须让用户选择处理方式，不得由你自作主张**：

> **A. 只补这节**（推荐）——新素材作为这节课的补充证据，只重跑这节的素材理解、正文与评审，其他节不动。
> **B. 重做课程骨架**——新素材可能带出新章节/新节，重新跑目录校验与课程骨架，已有节保留不删。
> **C. 只入库，先不生产**——素材转写好放着，等决定了再动内容。

- 选择 A 时必须**列出影响范围**（哪几节会被重评）；人最怕「不知道它会动什么」。
- 选 B 触发**目录先验校验**：新章节必须来自人工目录，不得自行发明章节或节。
- 选择结果要**记进生产任务**（`production_task` 表），不是一次性问答。
