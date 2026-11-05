# §3.14 增补提案：老师标注结构化详情 + 逐根回放判断闭环

状态：**已评估采纳（2026-11-05，M10 工作线评审，带 3 处修正）** · 正式契约已写入：云端架构 v0.10（§6.6.1 组件扩容 v2 / §6.6.3 标注层输入 / §6.6.5 `bar-replay-decision` / §6.6.6 门禁 / ADR C33/C34）、对接清单 v0.8 §3.14、云端需求 v0.9 C14、producer 需求 v0.3 F7 与架构 v0.4。评审修正（与原提案差异）：①删除 DSL 标注 body 的 `decision?`——判断点只落 widget spec，避免双份真相源；②`:::replay` 去 `widgetId` 按 `code` 解析唯一 widget（零个 `400 replay_widget_unknown`、多个 `400 replay_widget_ambiguous`）；③`d` 与 `pauseAtDate` 须为本股行情缓存实际交易日（`400 annotation_date_not_trading_day`）。开放问题 1–4/6 已裁决（见云端架构 v0.10 开放问题 28），问题 5（无障碍验收）随 R3 试点定。本文保留为提案原稿与决策依据。
来源：`prototype/section-preview.html`（总论卷第 1 节静态原型）在 2026-11-05 原型评审中，「逐根回放」与「老师标注」被明确指为最有价值的两块；调研结论见 [`courseware-presentation-study.md`](courseware-presentation-study.md) §2.6。
依据（提案当时）：云端架构 v0.8 §6.5.5 / §6.6.1 / §6.6.3 / §6.6.5 / §6.6.6、需求 v0.8 C14、对接清单 v0.6 §3.14、ADR C24 / C29 / C30 / C32。

> 本提案**不另起契约**：沿用 C29 的 Markdown 扩展容器块 DSL、C24 的白名单 spec + 断言程序证明、§6.6.3 的实盘层行情缓存与纯数据渲染组件。不新增端点、不新增数据表、不改 `contractVersion`（仍为 3）、不引入任何 HTML/JS 生成、不采集学员作答、不耦合 `ai-invest`。若采纳，请由云端工作线按「契约先行」顺序写入正式文档；本文件与两个并行文档（`docs/architecture/architecture-design.md`、`docs/requirements/product-requirements.md`）互不覆盖。

---

## 1. 增量边界：M10 已覆盖什么，还缺什么

| 能力 | M10 现状 | 本提案 |
|---|---|---|
| 节教材正文 | DSL v1 容器块 8 个 directive（§6.6.1，已冻结） | 增 2 个 directive（`:::annotation` / `:::replay`），随 `dslVersion=2` |
| 分步解盘 | `step-reveal` widget（§6.5.5）：按步**展示**老师结论，数据来自确定性合成 `generator+seed+bars` | `bar-replay-decision` widget：在**真实案例股 bars** 上逐根揭示、**先判断后揭晓** |
| K 线标注 | `kline-annotator` 的 `annotations?[]`（§6.5.5）：练习用的标注**答案**（趋势线触点等） | 老师原片标注的**详情层**：原话、时间码、术语、citation、跳回原片 |
| 实盘 K 线 | §6.6.3 渲染组件：输入 `{bars, events, window}`，`events` 仅 `{date,label}`，交互基线为缩放/十字线/M60/事件点选 | 输入扩 `annotations[]`（纯数据）；新增回放与判断点渲染 |
| 片段卡 | `:::clip`（assetId + from/to + unitId），HLS 时间窗直放 | 复用，标注与判断点用 `assetId + atMs` 跳回原片，不预切片（C30） |
| 断言证明 | 词表 v1（§6.5.5）；M10 新题型断言草案（§6.6.5） | 新增 3 条断言，证法沿用 §6.5.5「证明记录写入 `validation`，缺失 `409 assertion_unproven`」 |
| 视频联动 | 正文 `:::clip` 与实盘侧栏是两条独立链路 | 由 `:::annotation` 的 `assetId+atMs` 与 `d`（交易日期）建立时间锚映射 |

**结论**：M10 的空白恰好是「把原片里一次性讲完的判断，沉淀成可重复练习、可统计、可溯源的教学资产」。`step-reveal` 只解决「老师按步讲」，不解决「学员先判断」；`kline-annotator` 只解决「学员画线」，不解决「老师当时为什么这么标」。二者绑在一起才有教学闭环：标注决定「在哪停、停了看什么」，回放决定「什么时候看、看完做什么」。

---

## 2. 提案 A：`dslVersion=2` 新增 `:::annotation`

### 2.1 语法（严格套用 §6.6.1）

```
:::annotation unitId=su_0062 assetId=asset_53cc88bf29d3e03e code=sz000713 kind=invalidation atMs=665000
{ "d": "2019-05-17", "label": "结构破坏 · 先证伪",
  "quote": "但这个位置结构被破坏了，先证伪，别急着确认。",
  "glossary": ["证伪条件", "结构破坏"],
  "decision": { "pauseAtDate": "2019-05-16",
                "question": "只标出这一个高点，方向能确认吗？",
                "options": ["找理由维持趋势判断", "先回到震荡假设", "立刻反手做空"],
                "correct": 1 } }
:::
```

- 属性行 5 项**全部必填**、未声明属性 `400`（沿用 v1 白名单校验）：
  - `unitId` — source unit 标识，`atMs` 必须落在其 `[startMs, endMs]` 内；
  - `assetId` — 原片资产，用于详情卡跳回原片（复用 `:::clip` 的签名 HLS 时间窗会话，不预切片）；
  - `code` — 内联锚同一格式（`sz|sh|bj` + 6 位数字），必须 ∈ 本节案例股清单；
  - `kind` — 枚举 `structure | invalidation | rhythm`（结构点 / 证伪点 / 节奏点），渲染层按类型着色与过滤；
  - `atMs` — 原片时间锚（毫秒整数）。
- body 为**单个 JSON 对象**（zod 逐组件 schema），字段：
  - `d`（`YYYY-MM-DD`，必填）— 用**交易日期**定位 K 线，不用 bar 索引。理由：行情回填分页、复权口径、窗口裁剪都会改变 bars 数量，索引会漂移；日期是稳定锚点，且与 `case_stocks.events[].date`、§6.6.3 `events` 口径一致。渲染时按 `d` 映射为 bar 索引，映射失败按「行情暂不可用」降级，不伪造数据（原则 6）。
  - `label` 1–50 字符；`quote` 1–500 字符（与 `:::board` 引文同限）；`glossary[]` 每项必须 ∈ 本课程 `concepts`。
  - `decision?` 可选，一旦声明则 `pauseAtDate` / `question` / `options[2–4]` / `correct` 全部必填，且 `pauseAtDate < d`（保证学员在看到老师结论**之前**作答）。
- 配额：每节 `:::annotation` ≤12（对标 `keyframe` ≤6 / `clip` ≤3），超出 `409 annotation_quota_exceeded`。

### 2.2 服务端写入校验（第 2 层语义，随 `PUT .../article` 复检）

| 校验 | 失败 |
|---|---|
| `unitId` 存在、`atMs` 落 `[startMs,endMs]`、`assetId` 存在 | `400 annotation_not_grounded` |
| `code` ∈ 本节案例股清单（案例股须先于或同批写入） | `400 stock_not_in_list`（复用 §6.6.1） |
| `d` 落在该股案例窗口 `[windowStart, windowEnd]` 内 | `400 annotation_date_out_of_window` |
| `glossary[]` 每项 ∈ `concepts`（含别名） | `400 annotation_term_unknown` |
| `decision.pauseAtDate < d`、`correct` ∈ options 索引、options 文本非空且互异 | `400 decision_not_leading` / `400 decision_invalid` |
| 属性越界、body 非法 JSON、未知字段 | `400`（沿用 v1「未声明属性 400」） |
| 超过每节 12 条 | `409 annotation_quota_exceeded` |

- 文本纪律：`quote` 属不可信云端文本，渲染前转义（原型已实现 `esc()`），禁止嵌套块级 Markdown 与 HTML（§6.6.1 安全约束不变）。
- 渲染：详情卡展示老师原话、原片时间码、关联术语、交易日期、citation 徽章、跳回原片；三类标注可按类型过滤与开关。本节全部 `:::annotation` 作为**纯数据** `annotations[]` 传给 §6.6.3 实盘 K 线组件（组件自身仍无网络依赖）。
- 数据来源不新增机制：理解阶段产出的 source units 已含转写与关键帧时间锚，由生产端模型抽候选标注 → 门禁②（主编评审 / 教员确认）→ 随节教材 DSL 正文一起落 `draft`。provenance 沿用 `POST /v1/admin/content/provenance` 的 `content.section_draft` / `content.section_edit` 任务键，不新建审批链路。

---

## 3. 提案 B：`spec_version=2` 新增 widget `bar-replay-decision`

M10 §6.6.5 已确定「白名单扩容首批随 `spec_version=2` 冻结；服务端同时接受 1/2，v2 不改动 v1 组件形状」。本提案作为**第 3 个新增类型**并入同一冻结批次，不改任何 v1 组件形状。

### 3.1 spec 字段（未列字段一律拒绝）

| 字段 | 说明 |
|---|---|
| `specVersion` | `2` |
| `code` | 案例股代号，必须 ∈ 本节案例股清单 |
| `window{from,to}` | 与 `case_stocks` 案例窗口一致或为其子区间 |
| `overlays?[]` | 渲染选项枚举，建议 `MA60 | VOL`（§6.6.3 交互基线为 M60，原型演示为 MA5/MA10，需与 V3 定版统一） |
| `annotations[]` | 引用 DSL 中的标注：稳定键 `{unitId, atMs}`，附 `kind` / `d` / `label`（详情文本不重复落库，避免双份真相源） |
| `decisions[]` | `{atDate, question, options[2–4]{label}, correct, revealText, unitId, atMs}`，`atDate` 严格递增且早于对应标注的 `d` |
| `citations[]` | ≥1 条，指向存在的 source unit（通用包络 §6.5.5） |
| `assertions{}` | 必带 `decisionPointsGrounded` + `revealMonotonic` + `answerUnique`；可选 `termsInConcepts` |

**关键：`bars` 不在 spec 里**。行情由宿主按 `code + window` 走 §6.6.3 已定接口取得（管理台 admin 通道 / 学员端 `GET /v1/courses/{courseId}/stocks/{code}/quotes`），组件只收纯数据，复权口径与「不构成投资建议」声明位沿用 §6.6.3。这样 spec 不随行情回填变化、不产生快照漂移，也保持「组件自身无网络依赖」。

### 3.2 断言词表增补（v2，证法沿用 §6.5.5）

| 断言 | 参数 | 证明方式 |
|---|---|---|
| `decisionPointsGrounded` | `true` | 每条 `decision` 与 `annotation` 的 `unitId` 存在、`atMs` 落其 `[startMs,endMs]`、`atDate`/`d` 落 `window` 且落案例股窗口 |
| `revealMonotonic` | `true` | `decisions[].atDate` 严格递增；每个 `atDate` 早于其后最近标注的 `d`；回放遮罩区间单调不重叠 |
| `annotationTermsGrounded` | `true` | 所有 `glossary` / `revealText` 中术语 ∈ `concepts`，且 `revealText` 非空 1–2000 字符 |

已有 `answerUnique`、`termsInConcepts` 直接复用，不重复实现。证明记录写入 `widget_specs.validation`，任一缺失 `409 assertion_unproven`（§6.5.5）。

### 3.3 回放运行时行为（渲染器契约，非 spec 数据）

```
逐根揭示（纵轴用全区间定标，避免图形跳动）
→ 到 decision.atDate 暂停 + 遮罩未揭示区域 + 弹出判断题
→ 学员提交（答案锁定不可回改）→ 显示 revealText + 老师原话 + 原片时间码
→ 继续揭晓 → 下一个判断点 → 结束给小结（对了几处、错因通常在哪一步）
```

- 控制项：播放/暂停、单步、1×/2×、重置、进度条判断点刻度、标注层按 `kind` 过滤。
- **隐私护栏（写死，不可协商）**：学员提交的答案只做**本地即时反馈**，不落库、不进 `validation`、不进 M2 事件白名单（§5）、不随 provenance 上报。`validation` 只记录**正确答案**的程序证明。若未来要做「哪一步最容易错」的统计，须另立需求评审同意模型与字段白名单，本提案不含。
- 无障碍：canvas 提供文字替代与键盘操作；移动端窄屏单栏；行情未就绪按 §6.6.3 降级文案。

---

## 4. 提案 C：`dslVersion=2` 新增 `:::replay`（正文内嵌入口）

```
:::replay widgetId=wgt_014 code=sz000713 caption="这一根，先自己判断"
:::
```

- 属性全必填、body 空（与 `:::figure` / `:::clip` 同形）：`widgetId` 必须指向本节已存在且 `type=bar-replay-decision` 的 widget（`400 replay_widget_unknown`）；`code` 必须 ∈ 本节案例股清单且与 widget 一致（`400 stock_not_in_list`）；`caption` 1–200 字符。每节 ≤2，超出 `409 replay_quota_exceeded`。
- 渲染：在正文讲到该案例处就地嵌入回放组件，与实盘侧栏共享同一份 `bars`（宿主只取一次），不重复请求。
- **降级选项**：若工作线不希望 DSL 正文与 `widgets[]` 产生引用耦合，可取消 `:::replay`，改由节响应 `widgets[]` 在教材末尾统一渲染，提案 A / B 完全不变。此为本提案可裁剪的最小面。

### 4.1 版本与兼容

| 项 | 取值 | 说明 |
|---|---|---|
| `dslVersion` | `2` | 组件扩容升版本（只增不减，渲染器按版本门禁，§6.6.1）；服务端同时接受 1/2，v1 正文零改动 |
| `spec_version` | `2` | 并入 M10 §6.6.5 已定冻结批次；v2 不改动 v1 组件形状 |
| `contractVersion` | `3`（不变） | M10 呈现层字段已并入同一版本（§6.6.6），新 directive / widget 靠上面两个版本号门禁，不另开号 |

---

## 5. 门禁与校验演进（并入 §6.6.6 / §3.14）

| 层 | 增补 | 失败处理 |
|---|---|---|
| 1 schema | 两个 directive 的属性白名单与 JSON body zod；`bar-replay-decision` 的 spec 字段白名单 | `400` 附错误定位，错误回灌模型重写 |
| 2 语义 | `annotation` 的 unit/时间/术语/日期/判断点校验（§2.2）、`replay` 的 widget 引用校验、3 条新断言程序证明 | 错误回灌重写；3 次不过进人工待办 |
| 3 教学质量 | `quality-rubric 0.4.0` 的 `grounded` 维度扩义到标注原话与判断点（quote / atMs / 术语 / revealText 全部可回溯）；可选 `pedagogy` 维度检查「判断点是否先于结论」 | reject 回灌整节重写（阈值随 R3 试点标定，不在本提案定死） |
| publish 硬门禁 | 新增 `409 annotation_unresolved`（正文标注引用了不存在的 unit/股票/日期）、`409 replay_unproven`（复用 `widget_unproven` 语义，附 widgetIds）；既有 `figure_unresolved` / `clip_invalid` / `case_stock_invalid` 不变 | 显式错误，不部分发布 |

实施顺序挂现有 R2 / R3：R2 实盘层（K 线组件已落地）之后补 `annotations[]` 输入与 `bar-replay-decision` 渲染器 → R3 质量收敛时选 1 节做试点，随 6 节按 DSL 重写回灌一并验收。

---

## 6. 验收用例（可直接并入 §3.14「验收用例」表）

| 用例 | 期望 |
|---|---|
| `:::annotation` 合法 | 保存 `version+1`；详情卡可展示原话 / 时间码 / 术语 / 跳回原片；三类标注可过滤 |
| 标注未 grounded | `unitId` 不存在或 `atMs` 越界 → `400 annotation_not_grounded`；`code` 不在清单 → `400 stock_not_in_list`；`glossary` 含课程外术语 → `400 annotation_term_unknown` |
| 定位稳定性 | 窗口内行情回填条数变化后，`d` 仍映射到同一交易日；映射不到时显示「行情暂不可用」，不伪造数据 |
| 判断点顺序 | `pauseAtDate ≥ d` 或 decisions 非递增 → `400 decision_not_leading`；options 为空 / correct 越界 → `400 decision_invalid` |
| 配额 | 每节 `:::annotation` >12、`:::replay` >2 → `409` |
| `:::replay` 引用 | widgetId 不存在或 type 不匹配 → `400 replay_widget_unknown` |
| 断言证明 | `decisionPointsGrounded` / `revealMonotonic` / `annotationTermsGrounded` 任一无证明记录 → `409 assertion_unproven` 附 `failed` 数组 |
| 回放交互 | 判断点暂停并遮罩、提交后答案锁定、揭晓显示老师结论与原片时间码、进度条刻度、纵轴全区间定标不跳动 |
| 隐私 | 学员作答不出现在请求、日志、`validation`、provenance 与 M2 事件中 |
| publish 门禁 | 标注引用失效 / 回放 widget 未证明 → `409` 附明细；补齐后照常 publish |
| 版本兼容 | `dslVersion=1` 的存量正文照常保存与渲染；服务端同时接受 `spec_version` 1/2 |

---

## 7. 实施影响（分工，均不在本提案内执行）

| 侧 | 需要改动 | 备注 |
|---|---|---|
| 云端 | `PUT .../article` 的 DSL 解析器加 2 个 directive 与 schema；断言证明器加 3 条词表；publish 门禁加 2 个错误码；OpenAPI 与契约测试 | **零新端点、零新表**：标注随 `section_articles.markdown` 存储，widget 随 `widget_specs` |
| 云端 `web/widgets` | 实盘 K 线组件输入扩 `annotations[]`；新增 `bar-replay-decision` 渲染器；详情卡文本转义 | 独立包边界不变（§6.6），管理台先行，学员端随 `contractVersion=3` 已有节奏 |
| producer | `src/host/contracts.ts` 加 widget 类型；`chapter-authoring` / `section-production` skill 加 DSL v2 两个 directive 的写法与用例；`quality-rubric` 加 grounded 扩义项 | skill 是数据不用发版，skillVersions 随 provenance 上报可回归；**本提案未改任何 skill / rubric / contracts** |
| 数据 | 无 | 行情源、案例股清单、缓存、复权口径全部沿用 §6.6.3 |
| 学员端 | 随既有 `contractVersion=3` 渲染器版本门禁 | 低于最低版本提示升级，不静默降级 |

---

## 8. 开放问题（请 M10 工作线裁决）

1. 标注候选由生产端模型在写作时直接从 source units 抽取（**倾向，零接口改动**），还是需要独立的 `cloud_annotation_candidates` 工具与人工确认端点？后者会新增端点与表，本提案不含。
2. `:::replay` 是否保留（正文内嵌，教学上更顺）还是退化为节响应 `widgets[]` 末尾渲染（契约更松）？见 §4 降级选项。
3. `overlays` 与 §6.6.3 V3 交互基线统一到 `M60`，还是允许每节声明 MA 周期？原型演示为 MA5/MA10，需定一。
4. 教员是否可在管理台直接微调 `decisions[].options` 与 `correct`（属既有 operator/admin widget 编辑能力，还是需单独权限）？
5. 回放的键盘操作、canvas 文字替代与移动端降级文案，是否纳入 R3 无障碍验收？
6. 若未来要做「哪一步最容易错」的统计，须另立指标事件与同意模型（§5 白名单）；本提案明确**不采集**。

---

## 9. 采纳后的写入顺序（契约先行）

若评估通过，建议按既有规矩依次落地，本提案不代写：

1. 云端需求 v0.8 **C14 增补**（或立 C15）：把「老师标注详情 + 逐根回放判断」列为 M10 呈现层增量目标；
2. 云端架构 v0.8：§6.6.1 组件表增 2 行 + `dslVersion=2` 说明；§6.6.3 渲染组件输入扩 `annotations[]`；§6.6.5 表格增 `bar-replay-decision` 一行与 3 条断言；§6.6.6 门禁表增行；ADR 决策记录建议新增 C33（回放判断闭环）/ C34（老师标注详情层）；
3. 对接清单 **§3.14** 增补 DSL 示例、错误码与本文 §6 验收用例；同步 OpenAPI 与契约测试；
4. producer：`src/host/contracts.ts` → 两个 skill → `quality-rubric`，按 T5 出口做单节试点（含配图卡 / 片段卡 / 案例股锚点 / 标注 / 回放）过门禁②；
5. 渲染器与管理台预览 → 6 节回灌时选 1 节做金标准盲评。

---

## 附录：可直接复制的增补文本

**A. 架构 §6.6.1 组件清单增行**

| directive | 用途 | 关键属性 | body |
|---|---|---|---|
| `:::annotation` | 老师标注详情（原话 / 时间码 / 术语 / citation，v2） | `unitId`、`assetId`、`code`、`kind`、`atMs` 必填 | JSON `{d,label,quote,glossary[],decision?{pauseAtDate,question,options[2-4],correct}}` |
| `:::replay` | 正文内嵌逐根回放练习（v2） | `widgetId`、`code`、`caption` 必填 | 空 |

**B. 架构 §6.6.5 白名单扩容表增行**

| 组件 | 用途 | spec 要点 | 必带断言（草案） |
|---|---|---|---|
| `bar-replay-decision` | 真实案例股逐根回放 + 先判断后揭晓 | `code`、`window`、`annotations[]{unitId,atMs,kind,d,label}`、`decisions[]{atDate,question,options[],correct,revealText,unitId,atMs}`；`bars` 由宿主按 §6.6.3 取，不入 spec | `decisionPointsGrounded`、`revealMonotonic`、`annotationTermsGrounded`（+ 复用 `answerUnique`） |

**C. 清单 §3.14 正文 DSL 示例增行**

```
:::annotation unitId=su_0062 assetId=asset_53cc88bf29d3e03e code=sz000713 kind=invalidation atMs=665000
{ "d": "2019-05-17", "label": "结构破坏 · 先证伪", "quote": "但这个位置结构被破坏了，先证伪，别急着确认。",
  "glossary": ["证伪条件", "结构破坏"],
  "decision": { "pauseAtDate": "2019-05-16", "options": ["找理由维持趋势判断", "先回到震荡假设", "立刻反手做空"], "correct": 1 } }
:::
:::replay widgetId=wgt_014 code=sz000713 caption="这一根，先自己判断"
:::
```
