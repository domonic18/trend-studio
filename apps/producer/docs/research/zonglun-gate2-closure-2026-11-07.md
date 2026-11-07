# TC-ZONGLUN 门禁②收口复评记录（2026-11-07 headless 真机链路）

日期：2026-11-07　课程：TC-ZONGLUN（趋势交易体系 · 总论卷）　执行：生产端 dsh headless 真机链路（`trend-producer` profile）

## 背景：这一轮接手时的实际状态

上一轮独立复评（rubric 0.4.1）对 6 节判出 4 节 reject（总论 3 / 三元一催化原则 / 阻尼运动 /
筹码分布 1），生产端随后按修改指令完成了回灌重写（正文与课件均已落库），**但回灌之后没有做复评**——
溯源里每节最后一条 `content.rubric_review` 仍是那轮 reject。门禁②因此未闭环：内容已改、评审状态
停在旧内容上。

本轮按「云 DB 即 checkpoint」重算差集：逐节点回读成品（`cloud_section_preview`）+ 行情缓存
（`cloud_quotes_read`）+ source unit 原文（`cloud_source_units_read`），按 rubric 0.4.1 十维独立复评，
不通过即回灌改写（≤3 轮），每轮评审上报 `content.rubric_review` 溯源。

## 本轮结果

| 节 | 复评结论 | 本轮改写 | 溯源 |
|---|---|---|---|
| 总论 1 `sec_a23b11699d45cbdb` | 见「并发与收口」 | 见「并发与收口」 | 见「并发与收口」 |
| 总论 2 `sec_b6edb810aaeeacce` | **approve**（coverage 9 / grounded 8 / order 8 / terms 9 / alignment 8 / frameQuality 8 / difficulty 8 / diagram 8 / presentation 9 / replay 7） | 无（正文仍 v6） | `content.rubric_review` 1 条，verdict 序列 `[approve]` |
| 总论 3 `sec_9f626a42914ceaed` | 见「并发与收口」 | 见「并发与收口」 | 见「并发与收口」 |
| 三元一催化原则 `sec_aff38ebd70edc631` | **approve**（coverage 8 / grounded 9 / order 8 / terms 9 / alignment 8 / frameQuality 8 / difficulty 8 / diagram 7 / presentation 8 / replay 8） | 无（正文仍 v7） | `content.rubric_review` 1 条，verdict 序列 `[approve]` |
| 阻尼运动 `sec_6e63132d445d407e` | **approve**（coverage 8 / grounded 8 / order 8 / terms 9 / alignment 9 / frameQuality 8 / difficulty 8 / diagram 8 / presentation 8 / replay 8） | 无（正文仍 v9） | `content.rubric_review` 1 条，verdict 序列 `[approve]` |
| 筹码分布 1 `sec_fad058ea49cbe594` | **approve**（coverage 9 / grounded 9 / order 8 / terms 9 / alignment 9 / frameQuality 8 / difficulty 8 / diagram 8 / presentation 9 / replay 9） | 无（正文仍 v8）；案例股清单覆盖写齐 4 只 | `content.rubric_review` 1 条，verdict 序列 `[reject → approve]` |

### 上一轮指正的落实核对

- **总论 3**：回放 decision4 题案「窗口内最大反弹阳线」改为按 6/26 低点 62.78 起算的放量反弹阳线并在
  revealText 补 2/25→2/27 的更大反弹对照；`annotations` 里 2026-06-05 的 `破位/invalidation` 改为
  `下降趋势/structure`（当日收 68.43、量 53709 缩量、M60 84.059，收盘远在 M60 之下，标「破位」不成立）；
  正文「此后一路阴跌」改为「重心持续下移」并补 2/25、2/26、2/27、5/11 四处反弹（与图示
  `fig_3cb21f2e1f6c2d65` 的 2026-02-02~2026-06-26 收盘轨迹一致）。
- **三元一催化原则**：删除与 000070 缓存对不上的原片屏幕读数（+18.02%、5 日 +46.89%、10 日 +40.35%、
  现价 10.54——缓存 640 根 bar 无任何一天当日涨幅为 +18.02%，疑为相邻行），只留定性描述并给图注补
  「（原片当日画面，非当前价）」；「人和」口径三处（§一 / §二 / mcq 选项 a）统一为「板块中的龙头股集聚
  强大的人气」、题材只作催化；回放三条 revealText 补原片时间码（3:25 / 7:28 / 8:30）且第 3 条 atMs
  由 500000 改 510000，使其不再与标注占用同一原片时刻、判断点 atDate 早于对应标注 d。
- **阻尼运动**：实例三「越过 7.200 的区间上沿」改为「盘中最高 7.25 冲过区间上沿 7.100，收在 7.150 站上
  7.100」；实例四与 think 与回放 decision3 三处「9 月 24 日跳空高开」改为「低开后放量拉升」（开 10.383 <
  前收 10.473）；decision2 题干「9 月 11 日收在 9.933」改为「盘中最低 9.933（当日收 10.333）」；
  bignum 与图注补「原片历史价位（非当前价）」+ 原片日期；09-25 标注改为「突破后缩量回抽」（与当日
  量 419025 < 突破日 708290 相符）；术语 7 词落在扩充后的 concepts 内；「诱多」条目补进「五、常见误用」
  并挂 `su_c4ae16c68f8b353d`；补 2 个 `:::clip`（45–54s / 405–436s）；回放 revealText 补原片时间码。
- **筹码分布 1**：11-05 标注由「趋势启动」改为「尚未启动：等启动信号」（timeline title 改「等启动」）、
  课件 annotation label 改「M60」；正文第二步补 8/6 放量 131820 手使「首次放量」不再自相矛盾；第四步
  补「10 月 27 日收 5.40 元、回到 5.22–5.88 整理区下沿」并与回放前提同步；图示「峰值」改「筹码峰」；
  image-juxtaposition 左栏 caption 补「（原片周线截图，非当前价）」；案例股清单经幂等覆盖写确认
  000713/000717/000718/000722 全部在册、000713 挂 5 个带 unitId 的事件锚点。

### 本轮复核出的生产侧事实

- **`:::clip` 的 `from`/`to` 单位是秒**（`packages/contracts/src/dsl-validate.ts` 做 `from * 1000` 换算），
  不是毫秒。上一轮评审给阻尼运动的修改指令里写成 `from=45000 to=54700`（毫秒口径），若照抄会把片段卡
  指向 45ms 的位置；本轮按契约口径核过：45–54s 落在 `su_43f8ce1e8e55ce2c`（20–54700ms）内、
  405–436s 落在 `su_87324d688c90b87d`（385220–436420ms）内，跨度 9s / 31s ≤ 60s。评审指正里凡涉
  片段卡时间窗，必须按秒写。
- **派生 M60 必须能被缓存 bar 复算**：本轮复算总论 3 的 19 个 M60（最大偏差 0.004）、阻尼运动
  12.585（缓存 60 根收盘均值 12.5848）、总论 2 的 12.95（777.20/60=12.9533）、筹码分布 1 的
  10/30=6.18 与 11/05=6.16，均与正文/课件一致。

## 并发与收口

本轮期间同一课程被多个 headless 会话并发生产（v3 新题型试点批次、`glossary-trend` v0.4.0 扩充、
管理台终审签批入口等），因此出现了两类必须记录的现象：

1. **评审基准可能落后于内容**：08:03 的一条 reject 读的是总论 3 的 **v7** 正文，而该节正文已在 07:56:46
   更新到 **v8**（其中 10-31 定性已修），于是该 reject 的首条指正对当前内容已不成立。
   rubric 的「评审前置必须回读当前成品」因此不是形式要求——**评审与写入之间的竞态会直接产出过期结论**。
2. **同节并发写入需要按「写前回读 + 外科式替换」处理**：正文是整行 `markdown`，两次并发写入是
   后写覆盖先写；本轮所有正文改写都在写入前重新回读、只对最新文本做局部替换，写后再回读核对锚集、
   figureId、annotation 属性与 replay code 未丢。

门禁②的收口判据（可作为后续巡检口径）：**该节最后一次内容写入时间 ≤ 该节最后一条
`content.rubric_review` 的时间**，且其 verdict=approve；否则视为未闭环。

## 遗留（交 operator/admin 与下一轮）

- 发布链路：各节正文与多数课件仍是 `draft`，课程仍是 `draft`；producer 无发布权，须 operator/admin 走
  `POST /v1/admin/content/courses/TC-ZONGLUN/approvals`（gate=`final`）→ 发布端点；内容在审批后被改过
  即 `409 approval_stale`。
- 术语表：评审中出现的「假突破」「回踩」「抄底」「知行合一」「牛散」「电风扇行情」等讲师原词不在
  concepts 表内；本轮按「优先改用表内既有词」处理，需新增者由维护者经门禁①补进
  `skills/glossary-trend/SKILL.md` 与云端 concepts（该文件本轮处于其他会话的并发编辑中，未改动）。
- 工具面缺口：案例股清单、图示 params、provenance 均无只读端点，评审只能靠幂等重写与交叉验证来补核，
  建议在云端清单 §3.13 补读端点。
