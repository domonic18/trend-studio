---
name: curriculum-synthesis
description: 课程综合工艺（阶段 2）：概念归一、目录校验、节骨架落库与门禁①呈报
version: 0.1.0
---

# 课程综合工艺（架构师 Agent）

消费者：架构师 Agent（dsh agent）。输入：`catalog/<卷>.yaml`（人工目录先验）+ 该卷全部 source units。
输出：`concepts`/`concept_edges`/`sections` 草稿落库 + 门禁① 呈报。**呈报后停止，等教员批准再进逐节生产。**

## 执行顺序

### 1. 目录先验校验（原则 11，不得发明目录）

- 读 `catalog/<卷>.yaml`：courseId/chapter/sections 的 title、position、assetId 是唯一骨架输入。
- 逐条校验：每个 assetId 在云端存在且 ingest succeeded（`cloud_pipeline_status`）；课时数、顺序、
  命名与文件一致。发现目录与素材对不上 → 停止并报告差异，**禁止自行改名或增删**。

### 2. 语料通读

- 按课时逐个 `cloud_source_units_search(assetId)`（不带 q 按时间轴翻页）取全量 source units，
  通读 summary 与 visual.description。整卷 units 预计 100–200 条，分课时读入。

### 3. 概念抽取与归一

- 以 `glossary-trend` 种子术语为基准：语料中出现且种子已有的 → 直接复用（不重复建）；
  种子没有但跨课时反复出现（≥2 个课时）的概念 → 新建；单课时偶发概念暂不建，留节生产时按需。
- 每个概念：`cloud_concepts_write({courseId, name, aliases, definition})`；name 用讲师板书写法。
- 依赖标注：`cloud_concept_edges_write` 标 `prerequisite`（教学前置序，如 震荡 prerequisite 于
  趋势线有效性——先认识三种趋势才能谈趋势线）；不确定依赖的只标 `related` 或不标。
- **冲突处理**：`409`（name 已存在）→ 用 `cloud_source_units_search` 确认语义一致后跳过；
  语义不同的同名概念报告人工，不得强行覆盖。

### 4. 节骨架落库

- 按 catalog 逐条 `cloud_sections_write({courseId, chapterId, title, position, sourceAssetIds:[assetId]})`；
  一课时一节；summary 先留空（逐节生产时回填）。

### 5. 门禁① 呈报（然后停止）

最终回复按此结构（教员据此批准）：

```
## 门禁① 呈报 · <卷名>
### 目录骨架（N 课时）
| # | 节标题 | 素材 | 状态 |
### 术语表（M 概念）
| 术语 | 别名 | 定义摘要 | 依赖 |
### 概念依赖图
prerequisite 边列表（文字描述：A → B 表示 A 是 B 的前置）
### 与人工目录的差异
无差异 / 具体差异说明
### 请教员确认
确认后回复"批准骨架"，将进入逐节生产；要调整请直接说明改法。
```

## 纪律

- 目录不可发明（原则 11）；发现缺口只能呈报。
- 门禁①未批准前禁止调用节教材/课件相关写入。
- 概念写入与骨架写入各自完成后上报溯源（taskKey=content.concept_map / content.curriculum）。
