---
name: section-production
description: 逐节生产编排（阶段 3）：研究→读证据→案例股→图示→写作→课件→主编评审的单节工作流与收敛规则
version: 0.4.0
---

# 逐节生产编排

消费者：节生产驱动 Agent（每节一次会话或一个子代理）。输入：一节（sectionId）+
钉住素材；输出：节教材 + 图示规划 + 1–3 课件全部过三层校验入 draft。

## 前置（缺一不做）

- 门禁① 已批准（骨架/术语表/概念图谱落库生效）。
- 节骨架已存在（`cloud_sections_write` list 可查）。
- 该节钉住素材的理解产物完整（`cloud_source_units_search` 覆盖素材时间轴）。

## 工作流（每节顺序执行，顺序不可换）

1. **研究**：按节素材拉全量 source units，产出研究简报（概念清单/实例/可用 keyframe 时间点）。
   `cloud_source_units_search` 回的是**摘要**，够选材、不足以支撑具体叙述。
2. **读证据**：对简报里要写进正文的 unitId 批量 `cloud_source_units_read`（每次 ≤20 个），
   取回转写原文、视觉描述、窗内关键帧与播放会话。**正文里每个具体说法都要有这一步的依据**；
   摘要级信息不得直接落笔。全有或全无：409 `unit_not_readable` 时剔除不可读项后重试。
3. **概念回填**：把本节实际覆盖的概念 id 写回节（`cloud_sections_write` 更新 conceptRefs）与 summary。
4. **案例股**：`cloud_case_stocks_write` 落本节案例股清单。**必须早于正文**——正文的
   `[[stock:sz000713|丰乐种业]]` 内联锚会校验该股在本节案例股清单内，未落库即
   `400 stock_not_in_list`。
5. **行情同步**：`cloud_quotes_sync({courseId})` 触发课程级行情缓存。**必须早于正文**——
   正文 `:::annotation` 的交易日 `d` 必须是该股行情缓存的实际交易日，否则
   `400 annotation_date_not_trading_day`。可重跑，幂等。
   同步完用 `cloud_quotes_read({courseId, codes})` 读回缓存，**`d` / `atDate` 只能从返回的
   tradeDate 里挑**——视频里出现的日期未必落在缓存窗口内（缓存只回溯最近约 320 根日K）。
6. **图示**：按 `diagram-authoring` 选型——diagram 路产出 `{template, params}`，keyframe 路从
   units 的 keyframes.sec 选讲解帧——逐个 `cloud_figure_write({sectionId, ...})` 落库拿 `figureId`。
   **必须早于正文**——正文的 `:::figure figureId=...` 容器块会校验该 figure 属于本节，
   未落库即 `400 figure_ref_unknown`。每节 diagram ≤2、keyframe ≤6，超配额
   `409 figure_quota_exceeded`，`sec` 不落 source unit `400 sec_not_grounded`。
7. **节教材**：按 `chapter-authoring` 工艺写 grounded 正文（Markdown + 富文本 DSL 容器块），
   `cloud_section_article_write({sectionId, markdown, citations})`；400/409 按错误修正重写。
   正文里的段落级证据用 `[[unit:su_xxx|label]]` 内联锚（见下节「证据锚点」）。
8. **课件**：按 `courseware-design` 选型与撰写，逐个 `cloud_widget_write`；
   409 assertion_unproven 按 failed 断言修正（≤3 次）。
   同节同 code 的回放课件**只能有一份**（正文 `:::replay` 按 code 解析）——写错了先
   `cloud_widget_delete({sectionId, widgetId})` 删旧再写新，不要留两份让回放入口歧义。
9. **主编评审**：先 `cloud_section_preview({sectionId})` 读回本节成品（教材正文 + 课件 spec + 图示），
   再按 `quality-rubric` 打分——**不靠记忆评分**；verdict=reject 按修改指令重写对应部分
   （≤3 轮），仍不过转人工待办并如实汇报。
10. **溯源**：本节完成的写作与课件分别上报 `content.section_draft` / `content.widget_spec`；
    评审结果另报一条 `content.rubric_review`（`summary` 带 scores/verdict/failed/comments，
    `targetId` 为 sectionId）。

## 证据锚点（`[[unit:su_xxx|label]]`）

- **正文叙述具体证据处用锚**：`[[unit:su_0123456789abcdef|均线方向证据]]`。锚在学员端渲染为
  可点徽章，点了能回到该 unit 的出处；label ≤50 字，不写就留空由渲染端截短显示。
- **锚的 unitId 必须属于本课程**：不属于即 `400 unit_anchor_unknown`；格式非法即 400。
- **引用集口径 = 扁平 citations 字段 ∪ 正文全部 `[[unit:]]` 锚**（云端去重后落库）。
  锚不会让 citations 重复计数，但锚里没在 citations 里列过的 unitId 也会计入。
- **锚 vs 扁平 citations 怎么选**：正文里"这句话的依据是这段语料"——用锚；
  一个单元支撑整节多个段落、只想一次性声明来源——写进扁平 citations 即可，不必逐段挂锚。
  两者都写不冲突，但别为了凑数重复罗列同一 unitId。
- 容器块上的 `unitId=` 属性（`:::board` / `:::clip` / `:::figure`）与内联锚是两回事：
  前者是该块本身的溯源（`unit_ref_unknown`），后者是段落级引用（`unit_anchor_unknown`）。

## 权限边界（producer 无发布权）

- producer 角色只能写内容端点（source-units / sections / article / widgets / figures /
  case-stocks / concepts / edges / provenance），**没有 publish 权限**：publish 属
  operator/admin。发现自己在调 publish 端点即 403，说明该走审批流。
- 发布链路（由 operator/admin 执行，producer 不参与）：
  1. `POST /v1/admin/content/courses/:courseId/approvals`（gate=`final`）——服务端算课程内容指纹
     并落审批记录；
  2. 发布时服务端重算指纹比对：内容在审批后又被改过 → `409 approval_stale`；
     没有 final 审批 → `409 approval_required`。
- 因此 producer 交付的终点是**全部内容入 draft 且自评通过**；审批与发布由人/运维触发，
  不要在汇报里承诺"已发布"。

## 汇报格式（每节收尾）

```
## 节生产完成 · <节标题>
- 教材：v<N>，<字数> 字，citations <M> 条（其中锚 <K> 个）
- 课件：<k> 个（类型清单，validation 全 pass）
- 图示：<k> 个（<类型清单>）
- 案例股：<代码清单>
- 概念回填：<概念列表>
- 主编自评：<各维分数>，verdict=<approve|reject>
- 遗留：<人工待办或无；发布待 operator/admin 审批>
```

## 纪律

- 单节失败不阻塞其他节；跨节顺序按目录 position。
- 绝不写入其他节的 sectionId。
- **只经 `cloud_*` 工具访问云端**：禁止用 bash/curl 直连服务端 API（含"探测"请求）。
  2026-11-04 事故：agent 直 curl 探测 widgets 端点产生探针课件、并绕过工具层直灌伪造
  token 的溯源记录，两者都成了人工清理项。
- **溯源 token/latency 严禁估算**：你在会话内拿不到自己的真实用量。工具结果里明确
  带出用量的（如 `cloud_understanding_run`）按返回值上报；其余调用省略 token/latency
  字段，只报 taskKey/model/provider/status/skillVersions/targetId。宁可留空，不可编造。
