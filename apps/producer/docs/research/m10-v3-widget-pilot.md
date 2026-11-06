# M10 v3 新题型真产试点记录（image-juxtaposition / branching-scenario）

日期：2026-11-07　课程：TC-ZONGLUN（趋势交易体系 · 总论卷）　执行：生产端 dsh headless 真机链路

## 背景

`image-juxtaposition`（前后对比滑块）与 `branching-scenario`（分支情景练习）自 M10 v3 起进入
白名单（`specVersion=2`），但此前**从未在真实内容上生产过**——producer 架构文档记为「待试点冻结」。
本批次是两类题型的首个真产批次：证据先行 → 课件 spec → 服务端断言证明 → 门禁② 评审 → 溯源。

## 产出清单

| 节 | 课件 | widgetId | 断言证明 | 门禁② |
|---|---|---|---|---|
| 总论 1（sec_a23b11699d45cbdb） | image-juxtaposition | `wgt_5b786805ac24d28c` | pairSidesValid / captionsGrounded 全 pass | approve（coverage 9 / grounded 9 / order 8 / terms 9 / alignment 9 / frameQuality 8 / difficulty 8 / diagram 8 / presentation 9 / replay 8） |
| 总论 1 | branching-scenario | `wgt_666c6cb8a2213896` | graphAcyclic / allPathsTerminate / optimalPathReachable / feedbackNonEmpty 全 pass | 同上 |
| 三元一催化（sec_aff38ebd70edc631） | image-juxtaposition | `wgt_8877001167bc0f53` → **打回** → `wgt_ff84d049df14a531` | 全 pass | 第 1 轮 **reject**（grounded 7 / alignment 7）→ 修正 → 第 2 轮 **approve**（grounded 9 / alignment 9） |
| 三元一催化 | branching-scenario | `wgt_9427990d33e646dc` → **打回** → `wgt_714aca0c24b033e8` | 全 pass | 同上 |

溯源（`content.widget_spec`）：`6c36ed12`（总论1 对比滑块）、`e0cfba42`（总论1 分支树）、
`427f5002`（三元一催化 对比滑块·修正版）、`2f148a91`（三元一催化 分支树·修正版）；
评审（`content.rubric_review`）：`102c4850`（总论1 approve）、`f0e35f8f`（三元一催化 第 1 轮 reject）、
`5497adc4`（三元一催化 第 2 轮 approve）。

并发 headless 运行另在总论 2 / 总论 3 产出同两类课件（`wgt_f2008b2da5a6e29a`、`wgt_e0cb4c3cd84bd97c`、
`wgt_8b3427349c66eca4`、`wgt_c4a9134b362dcb42`），由各自会话自评，不在本记录范围。

## 两条被评审打回的生产缺陷（已修）

1. **合成图冒充真实 bar（grounded 一票否决）**：三元一催化节的 image-juxtaposition 两侧用
   生成器合成 K 线，caption 却写「8 月 25 日涨停那根」「9 月 28 日跌停那根」——图上根本没有那两根。
   与 rubric 0.4.1「原片事实挂到非原片画面」同型。改法：caption 显式标「合成示意，非原片画面」，
   真实 bar 只能以「真实案例对照见正文」引用。
2. **optimalPath 与题面相反（alignment）**：同一节的 branching-scenario 题面写「板块今天只有一只票
   涨停、其余没跟」，按正文口径地利不成立、讲师答案是「休息不开单」，但 optimalPath 走的是
   「可以按纪律开单」，且 n2 题面假定「已有三个以上涨停板」，与题面自相矛盾。改法：保留题面，
   n2 改为「数完涨停板结果说明什么」，新增 n4（龙头股分歧换手/人气），optimalPath 改为
   `["n1","n2","n3"]`。

## 行情数值可核（rubric 0.4.1 子项）

- 总论 1：长春高新 000661（07-16 收 75.94/量 181292、08-11 高 91.00/量 264484、08-31 收 73.20、
  10-23 收 72.08/量 68097、11-05 收 74.50）、云南白药 000538（11-03 收 55.60/量 191148、11-05 收 54.76）、
  金龙鱼 300999（10-09 收 25.29/量 213354、10-23 收 25.91）——逐条与 `cloud_quotes_read` 一致。
- 三元一催化：特发信息 000070（08-25 收=高 16.07/量 535900、09-11 收 17.16/量 1389336、
  09-21 高 19.47/量 1666630、09-28 收=低 16.15/量 649297、11-03 收 11.75/量 327352）——与缓存一致；
  节内 diagram `fig_ec965d54f3b96c58` 取的是案例窗口 bar，不是原片截图价（10.54 / +18.02%）。

## 冻结的工艺口径（已写入 `courseware-design`）

1. **caption 与画面的绑定纪律**：生成器侧 caption 不得绑定原片交易日；要结构判断或改用 `figureId` 侧。
2. **树形口径**：`optimalPath` 走讲师口径；非最优分支同样要终止，且每条 feedback 落在正文讲过的判断上。
3. **服务端补 type**：落库时服务端自行补写 `spec.type`，preview 回读看到属正常，**不要**因此再发带
   `type` 的 spec（`400 spec.type is not allowed`）。

## 遗留

- 新课件一律 `draft`，课程/节发布属 operator/admin 权限，producer 不参与。
- **并发风险（已实测）**：多个 headless 会话对同一节并行试点，会在同节留下同类型课件。总论 1 曾同时
  出现 2 份同 figureId 对的 image-juxtaposition（已按「同 figureId 对只留一份」删去一份，保留数字更可核
  的 `wgt_5b786805ac24d28c`）；该节现存 2 份 branching-scenario，但教学点不同（一份练「放量却仍在
  M60 之下＝反弹不是反转」，一份练「先判三类趋势再定动作」），非重复课件，可并存。
- **载荷形态实测**：嵌套数组（`spec.citations`、`nodes[].options[]`）在 tool-call 载荷里会被改写成
  `[[...]]`，服务端回 `400 spec.citations must be an array of 1–20 items`；压成单行扁平数组重发即可，
  仍不行就把同一份 JSON 交给新起的子代理写入。
- `fig_ddf2fedc62529391` 存储 caption 末尾多一个半角引号（正文内联 caption 正确），观感瑕疵，未修。
- 三元一催化节残留观察（评审不打回）：n2 选项 B 的 feedback 以「对」开头易生歧义；左 caption 未写
  「人和＝龙头股集聚人气」；`fig_ec965d54f3b96c58` 的 params 在 preview 读不到，图上数字须人工确认取
  案例窗口 bar。
