# Skill 工艺包

本目录存放课程生产 Skill 包：**指令与规范是数据，不是代码**——改进教学质量不需要发版，包版本随 provenance 上报（`skillVersions`），与 rubric 评估集联动做质量回归。

## 包格式

对齐 Agent Skills 规范（SKILL.md），每个包一个目录：

```
skills/<skill-name>/
  SKILL.md        必需。YAML frontmatter（name / description / version）+ Markdown 指令正文
  <辅助文件>       可选：示例、术语表 JSON、评分表等，由 SKILL.md 引用
```

- `name`：kebab-case，与目录名一致；`version`：语义化版本，内容变更必须递增。
- 正文只写"指令给谁、按什么结构产出什么、如何自检"；不写代码。
- 加载：dsh `dsh-skill` + `dsh-skill-filesystem` + `dsh-tool-skill` 挂载本目录（profile patch 层配置，见云端架构 §6.5.1）。

## 包清单

| 包 | 职责 | 主要消费者 |
|---|---|---|
| `transcript-understanding` | 理解工艺：分块规划、prompt 红线（时间锚点/输出预算/keyframes 归一）、写入与溯源流程 | 理解 Agent |
| `curriculum-synthesis` | 课程综合：目录先验校验、概念归一落库、节骨架与门禁①呈报 | 架构师 Agent |
| `trend-pedagogy` | 趋势理论教学法：概念依赖序、讲解顺序、常见误解库 | 理解/架构师/Author |
| `chapter-authoring` | 写作工艺：概念→判断依据→实例→检查清单→常见误用 结构模板与 grounded 规则 | 节 Author |
| `courseware-design` | 课件设计：8 类白名单组件选型与 spec/assertions 撰写规范；M10 新题型（`image-juxtaposition`/`branching-scenario`/`bar-replay-decision`，`spec_version=2`）工艺 | 节 Author |
| `diagram-authoring` | 图示规范：参数化 SVG 模板选型与参数写法、grounded 标注规则；keyframe/generated 分工红线 | 节 Author |
| `glossary-trend` | 术语表：统一术语 + 别名归一（与云端 `concepts` 同源） | 全部角色 |
| `section-production` | 逐节生产编排：研究→写作→课件→评审工作流与收敛纪律 | 节生产驱动 Agent |
| `quality-rubric` | 评审标准：覆盖率/引用准确率/术语一致性/课件有效性评分表与阈值 | 主编 |

## 状态

已填充（2026-11-04，批次 B）：`curriculum-synthesis`、`transcript-understanding`（含选型实测三条红线）、
`quality-rubric`（评分表+试点默认阈值，2026-11-05 升 0.3.1：图示维度改为按 diagram 图示核对；先读后评、评审溯源走 `content.rubric_review`）、
`glossary-trend`（总论卷 11 条种子术语）、`section-production`（单节工作流，2026-11-05 升 0.2.0：评审前先读回节产物）、
`courseware-design`（8 类选型与断言供给侧）。

已填充（2026-11-05，M10 呈现层）：`diagram-authoring` 升 0.2.0——从「教材内嵌 Mermaid」改为**参数化 SVG 模板**
（四类白名单，见云端架构 §6.6.4），因为 Mermaid 通道已退出教材图示（ADR C32）；`chapter-authoring` 升 0.3.0——
新增富文本 DSL 容器块写法（7 容器块 + 1 个股内联锚）与配图走 `cloud_figure_write` 的规则；
`section-production` 升 0.3.0——图示步骤改为按模板选型并落库，`cloud_figure_write` / `cloud_case_stocks_write` 已接线。

待试点迭代后填充：`trend-pedagogy`（依赖序需概念图谱数据）。填充前不建空壳文件。
