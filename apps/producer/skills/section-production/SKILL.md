---
name: section-production
description: 逐节生产编排（阶段 3）：研究→写作→图示→课件→主编评审的单节工作流与收敛规则
version: 0.3.0
---

# 逐节生产编排

消费者：节生产驱动 Agent（每节一次会话或一个子代理）。输入：一节（sectionId）+
钉住素材；输出：节教材 + 图示规划 + 1–3 课件全部过三层校验入 draft。

## 前置（缺一不做）

- 门禁① 已批准（骨架/术语表/概念图谱落库生效）。
- 节骨架已存在（`cloud_sections_write` list 可查）。
- 该节钉住素材的理解产物完整（`cloud_source_units_search` 覆盖素材时间轴）。

## 工作流（每节顺序执行）

1. **研究**：按节素材拉全量 source units，产出研究简报（概念清单/实例/可用 keyframe 时间点）。
2. **节教材**：按 `chapter-authoring` 工艺写 grounded 正文（Markdown + 富文本 DSL 容器块），
   `cloud_section_article_write({sectionId, markdown, citations})`；400/409 按错误修正重写。
3. **概念回填**：把本节实际覆盖的概念 id 写回节（`cloud_sections_write` 更新 conceptRefs）与 summary。
4. **课件**：按 `courseware-design` 选型与撰写，`cloud_section_article_write` 之后逐个
   `cloud_widget_write`；409 assertion_unproven 按 failed 断言修正（≤3 次）。
5. **图示**：按 `diagram-authoring` 选型——diagram 路产出 `{template, params}`，keyframe 路从 units 的
   keyframes.sec 选讲解帧——逐个 `cloud_figure_write({sectionId, ...})` 落库拿 `figureId`，
   正文用 `:::figure figureId=... caption="..." unitId=...` 引用；每节 diagram ≤2、keyframe ≤6，
   超配额 `409 figure_quota_exceeded`，`sec` 不落 source unit `400 sec_not_grounded`。
6. **主编评审**：先 `cloud_section_preview({sectionId})` 读回本节成品（教材正文 + 课件 spec + 图示），
   再按 `quality-rubric` 打分——**不靠记忆评分**；verdict=reject 按修改指令重写对应部分
   （≤3 轮），仍不过转人工待办并如实汇报。
7. **溯源**：本节完成的写作与课件分别上报 `content.section_draft` / `content.widget_spec`；
   评审结果另报一条 `content.rubric_review`（`summary` 带 scores/verdict/failed/comments，
   `targetId` 为 sectionId）。

## 汇报格式（每节收尾）

```
## 节生产完成 · <节标题>
- 教材：v<N>，<字数> 字，citations <M> 条
- 课件：<k> 个（类型清单，validation 全 pass）
- 概念回填：<概念列表>
- 主编自评：<各维分数>，verdict=<approve|reject>
- 遗留：<人工待办或无>
```

## 纪律

- 单节失败不阻塞其他节；跨节顺序按目录 position。
- 绝不写入其他节的 sectionId；绝不调用 publish。
- **只经 `cloud_*` 工具访问云端**：禁止用 bash/curl 直连服务端 API（含"探测"请求）。
  2026-11-04 事故：agent 直 curl 探测 widgets 端点产生探针课件、并绕过工具层直灌伪造
  token 的溯源记录，两者都成了人工清理项。
- **溯源 token/latency 严禁估算**：你在会话内拿不到自己的真实用量。工具结果里明确
  带出用量的（如 `cloud_understanding_run`）按返回值上报；其余调用省略 token/latency
  字段，只报 taskKey/model/provider/status/skillVersions/targetId。宁可留空，不可编造。
