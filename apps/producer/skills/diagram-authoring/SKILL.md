---
name: diagram-authoring
description: 图示工艺：参数化 SVG 模板的选型、参数写法与 grounded 标注规则；keyframe/generated 分工红线
version: 0.2.1
---

# 图示工艺

消费者：节 Author 子代理。输出：节级 diagram 图示 spec（`{template, params}`），经 `cloud_figure_write` 落库为
服务端渲染的 SVG 候选；教材正文用 `:::figure figureId=... caption="..." unitId=...` 容器块引用它。
图示不是装饰——**图上的每个字都要能被回溯**，图是正文判断依据的可视化，不是配图。

> 0.1.0 起的「教材内嵌 Mermaid 代码块」写法已废弃（2026-11-05 原型否决：排版不可控）。Mermaid 不是本包内容，
> 写了正文也渲染不出图。SVG 模板是唯一可用的图示通道（ADR C32，云端架构 §6.6.4）。

## 三路分工与当前状态

| 路径 | 载体 | 标注可核验 | 教学承载 | 当前状态 |
|---|---|---|---|---|
| diagram | `figures.kind=diagram`，`spec={template, params}`，服务端渲染 SVG | 100%（文字由 params 直出） | **可承载** | ✅ 唯一可用 |
| keyframe | `figures.kind=keyframe`，源画面关键帧 | 画面 | 辅助 | ✅ 可用（配图卡，`cloud_figure_write` 选帧） |
| generated | 文生图 | 无 | **禁承载** | ❌ 不写 |

diagram 与 keyframe 是**两路**，不是互斥：一张图承载不了讲师原话画面时要配 keyframe；能用参数化图讲清的
优先用 diagram（文字正确性由代码保证）。每节配额：diagram ≤2、keyframe ≤6（云端架构 §6.6.2）。

## 模板白名单（只用这四类，扩模板需冻结版本）

| template | 什么时候用 | 关键参数 |
|---|---|---|
| `chip-contrast` | 密集 vs 发散对照（筹码分布两种形态） | `left`/`right` 两侧峰位、峰宽%、离散度% |
| `chip-horizontal` | 横线筹码示意（单峰/多峰价位线） | `peaks[]`：标签、价位、筹码占比% |
| `timeline` | 阶段推进时间轴 | `events[]`：日期、标题、描述（3–8 个） |
| `stat-inline` | 关键数字 + 走势配景 | 标签、数值、单位、迷你图（line/bar）点数 |

## 参数写法（照抄这套形状，不自由发挥）

### chip-contrast

```json
{ "title": "密集 vs 发散：同一只票的两种筹码形态",
  "left":  { "head": "密集形态", "peakPrice": "8.68", "peakWidthPct": 12, "dispersionPct": 18, "note": "峰窄而集中" },
  "right": { "head": "发散形态", "peakPrice": "9.40", "peakWidthPct": 46, "dispersionPct": 55, "note": "峰宽且分散" } }
```

### chip-horizontal

```json
{ "title": "多峰价位线",
  "peaks": [ { "label": "主峰", "price": "8.68", "weightPct": 38 },
             { "label": "套牢区", "price": "9.40", "weightPct": 22 } ] }
```

### timeline

```json
{ "title": "结构破坏到确认的两步",
  "events": [ { "date": "2019-05-16", "title": "跌破 M60", "desc": "首次收盘跌破" },
              { "date": "2019-05-17", "title": "放量确认", "desc": "成交放大" },
              { "date": "2019-05-20", "title": "反抽不过前高" } ] }
```

### stat-inline

```json
{ "label": "峰位成本", "value": "8.68", "unit": "元", "note": "筹码集中处",
  "spark": { "kind": "line", "points": [8.1, 8.3, 8.5, 8.62, 8.68, 8.66] } }
```

要点：
- `head`/`label`/`title` 等展示文字 ≤ 20 字，`note`/`desc` ≤ 100 字；超限云端 `400`。
- `peakPrice`/`price`/`value` 写**字符串**（保留讲师原话里的写法，如 `8.68`、`8.7 元`），不写数字。
  **`value` 还要写成不可被解析为纯数字的字符串**——传输层会把 `"8.32"` 强制转成 number 再被
  zod 拒掉（400），写成 `"8.32 元"` 才过。`stat-inline` 的 `spark` 是必填，漏了 400。
- 百分比类参数（`peakWidthPct`/`dispersionPct`/`weightPct`）是 0–100 的数字，不带 `%` 号。
- `date` 一律 `YYYY-MM-DD`；`points` 至少 2 个、最多 24 个有限数值。
- 服务端按模板 zod 严格校验（同参数重放逐字节一致），**多写一个未声明字段即 400**。

## grounded 规则（图比正文更容易编造）

- 图中每个术语标签 ∈ `glossary-trend`（主词或别名），且与正文用词一致；不得用正文没有的近义词。
- 图中的数字（价位、比例、周期、天数）必须与支撑它的 source unit **逐字一致**；无出处的数字不写进图里。
- 图上不得出现正文没有的判断：正文没说「跌破 M60 导致破位」，图里就不能出现这条因果。
- 图不得承载讲师未表达的观点，也不得把讲师的条件性表述（「在 X 前提下」）画成无条件因果。
- 图里出现的每个概念都要在本节正文出现过——图不能引入新概念。
- `note`/`desc` 写的是「记住什么」，不是复述图上已有的字。

## 放置与配套（脱离正文的图等于噪声）

- 图放在它所解释的那一段**之后**，前面必须有一句正文引导句（如「下图是两种筹码形态的对照」），
  后面必须有一句图注。图与文脱节即为不合格。
- 正文引用写 `:::figure figureId=fig_xxx caption="..." unitId=su_xxx`；`figureId` 来自
  `cloud_figure_write` 的返回，caption 与图内标注不重复、不矛盾。
- 每节 diagram ≤2 张，超出云端 `409 figure_quota_exceeded`；图示配额以云端架构 §6.6.2 为准。

## 自检

- [ ] `template` 在四类白名单内，params 字段与模板形状一致、无多余字段
- [ ] 所有术语 ∈ glossary-trend，且正文出现过
- [ ] 所有数字有 source unit 出处，且与正文逐字一致
- [ ] `date` 为 YYYY-MM-DD；`points` ≥2 且为有限数值
- [ ] 有引导句 + 有图注；caption 与图内标注不矛盾
- [ ] 本节 diagram ≤2 张
- [ ] 在管理台节预览页渲染通过（渲染失败会显示源码与报错信息）
