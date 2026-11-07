---
name: material-ingest
description: 素材入库工艺：本地视频/音频直传云端并入队转写（生产体验线入口场景）+ 追加素材的 A/B/C 处理决策
version: 0.2.0
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

### 三步决策链（工具名按此顺序）

1. **算影响面**：`cloud_material_impact({courseId, assetId, choice, sectionId?})`——
   只读，不落库。回的是「这个选择会让哪几节被重跑、几个步骤重置为待开始」。
   A 必须给 `sectionId`（缺了服务端报 400）；B 不给；C 不给。
   **把 `affectedTitles`（哪几节）与 `resetStepCount`（几个步骤要重做）原样报给人看**——
   人最怕「不知道它会动什么」。先算再问，不要先问再算。
2. **让人选**：把 A/B/C 三条连同影响面列给人，**等明确答复**。
   不得由你代选，也不得默认选 A。
3. **落决策**：`cloud_material_choice({courseId, assetId, choice, sectionId?, note?})`——
   把选择写进云端生产任务（`production_material_choices` 表），并把受影响节的九步状态
   重置为 `pending`（`attempt` 清零、回灌预算保留），A 还会把新素材挂进该节的素材清单。
   回执里的 `affectedSectionIds` 就是接下来要重跑的节。

### 落决策之后

- **重跑从 `cloud_production_tasks_read` 读到的 `currentStep` 起**：受影响节的九步已回到
  `pending`，按 `section-production` 的九步状态机逐步重跑并重新上报状态。
- **选 B 触发目录先验校验**：新章节必须来自人工目录，不得自行发明章节或节。
- 决策是**持久记录不是一次性问答**：`cloud_production_board_read({courseId})` 会带回
  本课程最近的追加素材决策，交接时看它即可。
