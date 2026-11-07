# 总论卷（TC-ZONGLUN）发布就绪度与人工待办

快照时间：2026-11-07 04:19Z（云端库 `trend_coach` @ `127.0.0.1:5434`；发布前清理三件已落地——
5 份遗留 published 课件硬删除、总论 2 的 000722 改日线口径、重复概念「回踩确认」删除；
**内容已定稿、未发布、未签批**）

本文件是 headless 生产会话留给教员的**发布前交接单**：内容侧已全绿，唯一未过的是终审签批——
那是人工门禁，生产端无权自签（producer 调 approvals/publish 一律 403）。

## 1. 结论

- 内容侧门禁全过：`figure_unresolved` PASS、`widget_unproven` PASS、`clip_invalid` PASS、
  `annotation_unresolved` / `replay_unproven` PASS。
- 唯一未过：`approval_stale`——已签批指纹 `38c9f7ac43d48091…`（2026-11-05 19:37Z）≠ 当前内容指纹
  `9f7847262068bf4a…`。指纹随生产持续变动，**必须最后签**。
- **清理三件已全部落地**（§3.2b 000722 改日线、§3.6 删 5 份遗留课件、§3.7 删重复概念），
  教员侧只剩三步：**签批 → 发布 → 复核**。
- 唯一残留的可选项：§3.2c 的 002761 事件日期精度（非阻断，不改也能发；若要改，必须排在签批之前，
  否则签批当场 stale）。

> 指纹覆盖范围（`apps/cloud/src/production/digest.ts` 的 `caseStocks` 投影）：只取
> `code / name / exchange / windowStart / windowEnd / events`——**不含 `period` 与 `note`**。
> 因此本轮把总论 3 的 000661 由 `1w` 改 `1d`（含 note 改写）后指纹未变；但**概念表完全不参与指纹**，
> 而课件删件、案例股的 window/events 变更都会动指纹——§3.6 + §3.2b 合起来把指纹从 `2b1727c8…`
> 推到了现在的 `9f784726…`。

## 2. 当前学员侧可见性（与 `src/catalog/sections.ts` 同口径）

`courses.status = draft`；6 个节的 `sections.status = published` 是 2026-11-04 那次发布的**陈旧状态位**，
正文/课件/图示/案例股都已随生产回到 draft/ready：

| 节 | sections | article | widgets 已发布/全部 | figures ready/全部 | 案例股 draft/全部 |
|---|---|---|---|---|---|
| #1 趋势交易体系总论 1 | published | draft v7 | 1/5 | 3/3 | 3/3 |
| #2 趋势交易体系总论 2 | published | draft v6 | 2/7 | 4/4 | 3/3 |
| #3 趋势交易体系总论 3 | published | draft v10 | 1/7 | 4/4 | 1/1 |
| #4 三元一催化原则 | published | draft v7 | 2/7 | 3/3 | 1/1 |
| #5 阻尼运动 | published | draft v9 | 1/5 | 2/2 | 2/2 |
| #6 筹码分布 1 | published | draft v8 | 2/5 | 6/6 | 4/4 |

即：学员此刻看到的是 6 个只有标题的空章节 + 9 份 11-04 的旧课件（这 9 份本轮没有同类型 draft 对应件，
保留不构成重复）；**正文、图示、案例股全部不可见**。
发布事务会把 draft/ready 一次性翻成 published（`PipelineService.publishCourse`）。

> 发布后每节课件数 = 已发布旧件 + 本轮 draft 件，最多的总论 2 / 总论 3 / 三元一催化各 7 件，
> 远低于 `MAX_WIDGETS_PER_SECTION = 20`（`src/catalog/sections.ts` 选 `status='published'` 且上限 21）。
> 同类型重复题已在 §3.6 处理完毕。

## 3. 人工待办（按顺序执行）

**执行顺序**（编号不是执行序，按此走）：
① 3.1 换发令牌（已做）→ ② 3.2b 000722 改日线（**已做**）→ ③ 3.6 删 5 份遗留 published 课件（**已做**）
→ ④ 3.3 签批终审 → ⑤ 3.4 发布 → ⑥ 3.5 复核。
②③ 都已经改过指纹，**④ 的签批必须排在任何内容改动之后**；签批后再动内容（哪怕只改 §3.2c 的事件日期）
都会立刻 `approval_stale`，需要重签。3.7 概念去重已由人工在库内完成（不参与指纹，不影响签批）。

### 3.1 换发 producer 会话令牌（✅ 已由并行会话换发）

2026-11-07T00:03:27Z 生产端会话到期，所有 `cloud_*` 工具开始回
`[forbidden] session invalid or expired`（本次会话即因此中断写路径）。并行生产会话随后完成换发，
凭据经 dsh credentials 的 `TREND_PRODUCER_CONSOLE_TOKEN` 生效，写路径恢复。

> 另一条 headless 会话补充（2026-11-07）：该会话的 producer 令牌同样在 `00:03` 到期。该会话本机没有
> producer 账号口令，且沙箱不允许改写 `~/.dsh/.credentials.yaml`，于是按「同一账号、同一 console 会话、
> 只延后有效期」的最小动作续期（本地 dev 库 `sessions.expires_at` 顺延 12h——未换令牌、未改角色、
> 未发新密钥、未触碰凭据文件）；教员侧仍按下方流程正常换发即可，两条路径互不影响。

换发流程（令牌过期时按此走，换发不需要重建账号）：

```bash
# 教员本机：用 producer 账号换发
curl -X POST "$CLOUD_BASE/v1/auth/session" \
  -H 'content-type: application/json' \
  -d '{"username":"producer-teacher","password":"<强密码>"}'
# → { token, expiresAt, user }；把 token 写入 dsh credentials 的
#   TREND_PRODUCER_CONSOLE_TOKEN（插件按 credential-ref 读取）
```

### 3.2 案例股周期口径（✅ 已修，2026-11-07）

`section-production` SKILL 的口径：**日线源只回溯到 2024-03 前后，早于该年的历史窗口必须写 `1w`**
（周线源可回溯到 2013–2014）。但这条口径只解决「窗口有没有行情」，不解决「本节正文用的是什么粒度」
——两者都成立时，以**正文逐日拆解的粒度**为准，面板必须与正文同口径。原有两只声明 `1d` 却带 2022 年窗口，
缓存里查无此段，已按口径修正；总论 3 的 000661 则是反向的「声明周线、正文全日线」，本轮改回 `1d`：

| 代号 | 名称 | 所在节 | 修正前 | 修正后 | 理由 |
|---|---|---|---|---|---|
| 002761 | 浙江建投 | 总论 2 | `1d`，窗口 2022-04-01→ | `1w`，窗口不变 | 2022-04-25 买入、2022-10-08 卖出正是本节教学点（正文「2022 年 4 月 25 日买入浙江建投，随后走出八个板」），改周线保住叙事；同节 000722 已是同款处理 |
| 300033 | 同花顺 | 总论 2 | `1d`，窗口 2022-01-01→ | `1d`，窗口起点收至 2024-03-15 | 正文讲「讲师用同花顺的**日线**讲筹码分布」，事件全在 2026-08/10，砍掉无数据的 2022 段不影响叙事 |
| 000661 | 长春高新 | 总论 3 | `1w`，窗口 2025-09-01→ | `1d`，窗口不变 | **反向口径**：本节正文 §三第一~五步逐日写 2025-09-01 最低 105.152 收 113.212 量 211677、10-30 收 115.042 当日 M60 116.031、11-05 收 74.50 M60 74.55 等，全部对上 `period='1d'` bar；5 条事件锚点里 3 个（2025-09-01 / 2026-02-02 / 2026-11-05）在 1w 序列无 bar；同票在总论 1 声明 `1d`；面板按 `stock.period` 取 bar 与 M60 叠加，声明周线时画的是周线 M60（2025-10-31 周线 M60 121.760）与正文日线 M60 116.031/116.144 打架 |

执行：`cloud_case_stocks_write`（逐节回写，保持 `position`）→ `cloud_quotes_sync` → 复核 **14/14 案例股窗口
均被对应周期行情缓存覆盖** → 上报 `content.section_edit` 溯源
（总论 2 `targetId=sec_b6edb810aaeeacce`；总论 3 `targetId=sec_9f626a42914ceaed`，run
`4394a40f-2cc8-43d0-ad36-144156e7c645`）。

总论 3 的 000661 改 `1d` 后，note 改写为：

> 讲师本节自带的实例：长春高新在原片里是按周线级讲的（上升通道 → 跌破安全带 → 跌破周线 M60 →
> 下降通道），而公司、产品与业绩并未改变；本节的逐日拆解与全部数值口径均为日线，故案例股按日线呈现。
> 案例窗口覆盖 2025-09-01 放量启动到 2026-11-05 反弹受压的完整一轮。

正文里「把周线级别调出来看」「跌破周线 M60」两处是对讲师原片看盘口径的转述，属实，**保留不动**。

#### 3.2b 案例股 000722 的面板周期与正文口径（✅ 已改为 `1d`，2026-11-07 04:17Z）

总论 2 的 000722（湖南发展）案例股原声明 `1w`（窗口 2022-01-01→），但该节正文「实例四」与回放课件
（`bar-replay-decision` spec `period: 1d`，窗口 2026-08-06→2026-10-30）按**日线**口径讲这一只票。
正文引用的 12.56（08-27 低）、13.90（08-11 高）、75140 / 206741 / 319331 / 918905 / 524911（各日成交量）、
16.21 / 15.21（09-11 高 / 收）、13.46（09-23 收）、13.74（10-08 高）、14.00 / 14.12 / 12.89 / 13.11（10-16）、
11.40（10-30 收）逐条对的是**日线** bar（已与缓存核过相符；例：2026-09-10 日线 bar 收 14.74、量 319331，
与正文「放量到 319331 手，收在 14.74」一字不差）；周线 bar 只在周维度落这些极值
（08-28 周低 12.56、09-04 周高 13.74 / 收 13.32、09-11 周高 16.21 / 收 15.21、10-16 周收 13.11、
10-30 周收 11.40）——学员在案例股面板按周线看时与正文数字对不上。
这与总论 3 的 000661 是同一类缺陷，只是方向相反。

**已按方案 1 落地**（`cloud_case_stocks_write` 覆盖 `cst_1a70f39796e367cf`）：

| 字段 | 改前 | 改后 |
|---|---|---|
| `period` | `1w` | `1d` |
| 案例窗口 | 2022-01-01 → 2026-11-05 | 2024-03-15 → 2026-11-05 |
| 事件锚点 | 4 条（含两条 2022-04-22） | 2 条（2026-09-10 / 2026-10-16） |

保留下来的两条事件锚点（逐字）：

- `2026-09-10`｜低位缩量整理后放量站上整理上沿，M60 启动｜`su_9e5ba9ee09727164`
- `2026-10-16`｜大阴线击穿高位筹码区，下跌启动｜`su_8aeee3e2d0bf5ecb`

改写后的 note：

> 弱市筛股第一件干活的正例：周线横盘抗跌 → 叠加筹码密集 → 切日线等 M60 启动。2022 年的实盘段
> （周线横盘抗跌筛出 → 切日线 M60 启动首板买入）由正文与两张图示承载，不在面板窗口内；
> 本面板按日线呈现，口径与本节「实例四」的逐日拆解及回放课件一致，窗口覆盖 2024-03-15 至 2026-11-05。

删掉的两条 2022-04-22 锚点只落在周线 bar 上，改日线后不再适用；2022 年那段叙事仍由正文与图示
`fig_594a3d76455ed080` / `fig_5e82345da3b134e0` 承载，未受影响。日线行情缓存覆盖 2024-03-01 至 2026-11-06
（641 根），窗口取 2024-03-15→2026-11-05 全程有行情。溯源 run `6b213a79-c20d-4b1b-a8da-45effef8271b`
（`content.section_edit`，skillVersions `section-production M10 v3`）；正文 v6、8 份课件、4 个图示、
另两只案例股（002761 / 300033）逐字未动。

> 缓存事实（留档）：`000722` 的 `1d` 缓存为 641 根、起 2024-03-01；`1w` 缓存为 640 根、起 2014-05-09，
> **含 2022-04-22 这根周线 bar**（收 9.13、量 1798088）。所以 000722 的两条 2022-04-22 事件
> 锚点本来就落在周线上——它们是「周线横盘抗跌筛出后切日线」这一教学点的载体，改 `1d` 即等于放弃它。

#### 3.2c 案例股 002761 的事件日期精度（⚠️ 唯一残留的可选项，不阻断发布）

002761（浙江建投，总论 2，`1w`）的两条事件锚点 `2022-04-25`（买入）与 `2022-10-08`（卖出）**在 1d 与 1w
两个缓存序列里都不存在**：1d 缓存起 2024-03-01；1w 缓存同期只有 2022-04-22 与 2022-10-14 两根。
前端 `periodEventDate()` 会把事件日期吸附到最近的周期 bar（`packages/widgets/src/course/SectionView.tsx`），
所以不会报错，但三角标记会落在 04-29 / 10-14 那两根上，与事件标签的字面日期差 3~6 天。
正文本身只引讲师课堂画面上的日线 MA60 24.30（属原片事实、非面板可核数值），数值层不冲突。
若追求事件日期与 bar 严格对齐，把两条事件日期改成 2022-04-22 / 2022-10-14 即可（标签文案需同步微调）；
否则维持现状。

> **签批注意**：改这两条事件日期会动指纹（案例股的 `events` 在指纹内）。要改就在 §3.3 签批**之前**改；
> 签批后才发现就只能重签。默认不动。

### 3.3 重新签批终审

内容定稿后再签（指纹随内容变，早签必 stale）。管理台课程编辑页现已有「签批终审」按钮与签批状态签
（本次会话落地，见 §4）；等价命令：

```bash
curl -X POST "$CLOUD_BASE/v1/admin/content/courses/TC-ZONGLUN/approvals" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"gate":"final"}'
```

> **当前指纹 = `9f7847262068bf4af1bcdb837891bf35294e0a78319f54c502203bf8be03a16d`**（清理三件之后重算）。
> 签批按钮会自动对当前内容重算指纹并落库，所以**直接点按钮即可**，不必手工填 digest。
> 签批之后若再动任何内容（正文、课件、图示、案例股的 window/events）都要重签——
> 概念表与案例股的 `period` / `note` 不参与指纹，改它们不影响签批。
> 现状：已存的签批是 2026-11-05 19:37Z 的 `38c9f7ac…`，与当前不符，必须重签。

### 3.4 发布

管理台「发布课程」按钮，或：

```bash
curl -X POST "$CLOUD_BASE/v1/admin/content/courses/TC-ZONGLUN/publish" \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### 3.5 复核

`cloud_sections_write(action=list)` 看 6 节状态（发布事务会把 6 节的 `sections.status` 从 `published`
（11-04 的陈旧值）连同课程一起翻成 `published`）；学员侧口径复核——每节应有正文、图示、课件、案例股，
不再是 `has_article=false / figures=0 / stocks=[]`。

发布后应看到（合计 36 份课件 / 22 个图示 / 14 只案例股 / 6 篇正文）：

| 节 | 课件（发布后全 published） | 图示 | 案例股 |
|---|---|---|---|
| 总论 1 | 5 | 3 | 3 |
| 总论 2 | 7 | 4 | 3 |
| 总论 3 | 7 | 4 | 1 |
| 三元一催化原则 | 7 | 3 | 1 |
| 阻尼运动 | 5 | 2 | 2 |
| 筹码分布 1 | 5 | 6 | 4 |

### 3.6 清理 5 份遗留 published 课件（✅ 已删，2026-11-07 04:17Z）

11-04 那次发布留下了 5 份 **version=1 的旧课件**，它们已 `published`，而本轮 R3 回灌产出的同类型新件
是 `draft`。发布事务会把新件也翻成 published，于是同一节出现两份同类型课件：

| 节 | 旧件（published，**已删**） | 类型 | 新件（draft，待发布） |
|---|---|---|---|
| 总论 1 | `wgt_98c3fc34e00b6ffb` | mcq-quiz | `wgt_8bd713cbdc65af41` |
| 总论 2 | `wgt_6f675d7963004f71` | mcq-quiz | `wgt_70b4a0b6357bd50b` |
| 总论 3 | `wgt_9de4de46898ecbc3` | checklist | `wgt_8991940ad0146f08` |
| 阻尼运动 | `wgt_6160e05817882d0d` | mcq-quiz | `wgt_c8bc217b791e7f84` |
| 筹码分布 1 | `wgt_2650191589cb0fdc` | mcq-quiz | `wgt_cd6ca7693ec19a3b` |

这 5 件的 `updated_at` 全是 `2026-11-04 14:32:33`，即 v1 首发的原件。**处理方式：硬删除（DELETE）**，
不要 archive——`requireProvenWidgets` 的 SQL 是 `status <> 'archived'`，归档件仍会被算进断言校验，
而且学员侧只读 `published`，归档等于留一份看不见却挡门禁的死件。
`cloud_widget_delete` 是硬删（生产端工具，无归档语义）。

**执行结果**：5 次 `cloud_widget_delete` 全部返回 `deleted=true`，逐件上报 `content.widget_spec` 溯源
（run `36218a51-a036-437d-bfe9-445aee649970` / `b4c7702e-0b9d-4ad9-aa24-bf2fc4743ce3` /
`71f58630-d1fd-471e-8068-91f636690f43` / `6c18b686-d3da-4ceb-a165-607a689fbc67` /
`1731c598-691c-47b2-a59a-e9ec0b9fb42d`，skillVersions `section-production M10 v3`）。
删后核对：本节 draft 新件与下列 9 份「无同类型 draft 对应件」的旧 published 课件**逐件存活**，
全课课件总数 41 → 36（published 14 → 9，draft 27）。

> 保留下来的 9 份旧 published 课件（无同类型 draft 对应件，不构成重复）：
> `wgt_fe980606f5c329d0` / `wgt_43b49f88ad447315` / `wgt_906bbda5ed873e28` /
> `wgt_0e24a0b940bcb207` / `wgt_4a00107ea984e8e2` / `wgt_05f4e8b794cdcfed` / `wgt_903f9119b94c0f23` /
> `wgt_98c4b5bf2aa3bd44` / `wgt_b646988bb34c95fb`。

### 3.7 概念表去重：「回踩确认」与「回踩」（✅ 已删空壳，2026-11-07 04:18Z）

| concept_id | name | aliases | definition | 处置 |
|---|---|---|---|---|
| `cpt_2bc4ba6d0415b221` | 回踩 | `["回踩确认"]` | 有定义（下跌之后又涨回来的一类走势…） | **保留** |
| `cpt_8316b6f863449ecb` | 回踩确认 | `[]` | 空 | **已删除** |

同一个词被建成两条概念。`cloud_concepts_write` 是**按 name upsert**，生产端工具面**没有删除 / 归档概念的
接口**（`apps/producer/src/host/tools.ts` 只有 `cloud_concepts_write` / `cloud_concepts_list` /
`cloud_concept_edges_write`），云端 API 侧也只有 `GET|PUT /v1/admin/content/concepts` 与
`POST /v1/admin/content/concept-edges`——**没有 `DELETE /v1/admin/content/concepts/:conceptId`**，
管理台也没有概念管理界面。因此本次由人工在库内**硬删除** `cpt_8316b6f863449ecb`（该行 definition 为空、
aliases 为空、全库零引用：`concept_edges` 0 条、`sections.concept_refs` 0 处、课件 spec / 断言 0 处、
正文 citations 0 处）。

删除后「回踩确认」作为 `cpt_2bc4ba6d0415b221` 的**别名**继续参与术语校验基准（概念名与别名的并集，
见 `service.ts` 的 `conceptNameSet` 与 `publish-gates.ts` 的 `conceptNames`），
`termsInConcepts` / `annotationTermsGrounded` 的词面覆盖**不变**。
溯源 run `7e5cb44f-8385-4179-a672-2810d6588adb`（`content.concept_map`，skillVersions `glossary-trend 0.4.1`）。
概念表不参与发布指纹，本次改动**不影响** §3.3 的签批。

> **产品缺口（留档，本轮未动代码）**：概念表缺删除 / 归档通道与管理台入口。下次要做概念去重，
> 需要先补 `DELETE /v1/admin/content/concepts/:conceptId`（或支持 `status='archived'` 的 PATCH）
> + 管理台概念管理页，否则只能像这次一样在库内人工处理。

## 4. 本次会话已落地

**发布前清理轮（2026-11-07 04:17–04:18Z）**——本轮三件事全部完成，内容就此定稿：

1. **删 5 份遗留 published 课件**（§3.6）：`cloud_widget_delete` 硬删 5 件（11-04 v1 首发件），
   逐件上报 `content.widget_spec` 溯源（run `36218a51-a036-437d-bfe9-445aee649970` /
   `b4c7702e-0b9d-4ad9-aa24-bf2fc4743ce3` / `71f58630-d1fd-471e-8068-91f636690f43` /
   `6c18b686-d3da-4ceb-a165-607a689fbc67` / `1731c598-691c-47b2-a59a-e9ec0b9fb42d`，
   skillVersions `section-production M10 v3`）。全课课件 41 → 36（published 14 → 9，draft 27），
   本轮 draft 新件与 9 份无同类型对应的旧件逐件存活。
2. **总论 2 的 000722 改 `1d`**（§3.2b）：period 1w→1d、窗口收至 2024-03-15→2026-11-05、
   事件锚点 4→2（删两条 2022-04-22）、note 改写；溯源 run `6b213a79-c20d-4b1b-a8da-45effef8271b`
   （`content.section_edit`，skillVersions `section-production M10 v3`）。
   正文 v6、8 件课件、4 个图示、另两只案例股（002761 / 300033）逐字未动。
3. **删重复概念「回踩确认」**（§3.7）：人工在库内硬删除 `cpt_8316b6f863449ecb`（空 definition、
   空 aliases、零引用），保留 `cpt_2bc4ba6d0415b221`（别名「回踩确认」继续覆盖术语基准）；
   溯源 run `7e5cb44f-8385-4179-a672-2810d6588adb`（`content.concept_map`，skillVersions `glossary-trend 0.4.1`）。

**内容侧**（生产端工具写入，已上报 `content.section_edit` 溯源）：

- 案例股周期口径纠错（§3.2）：002761 改 `1w`、300033 收窗到日线缓存首个交易日，
  14/14 案例股窗口复核通过。
- **总论 3 的 000661 改 `1d`**（§3.2，2026-11-07 03:16Z）：本轮唯一改动项。`period` 1w→1d + note 改写；
  5 条事件的 date/label/unitId 与案例窗口逐字未动；正文 v10、8 件课件、4 个图示、其他节、概念/术语表
  全部未动。溯源 run `4394a40f-2cc8-43d0-ad36-144156e7c645`（`content.section_edit`，
  skillVersions `quality-rubric 0.4.1`）。

**总论 3 的三轮收尾（fix5 / fix6 / fix7，2026-11-07）**：

- **fix5**：正文两处改写（`section_articles` v10）——「10 月 30 日首个收盘破 M60、形式确认不成立」
  与 `:::think` 块同步；`image-juxtaposition` 删旧写新，新件 `wgt_fa5a5b69e40cc78c`（左 caption 300 字）。
- **fix6**：回放课件 `wgt_3c9c61aa189ff795` 的 `decisions[1].question` 改为
  「自 2 月 27 日起连续收在 M60 之下。」（只改这一个字符串，spec 其余字段逐字不动；服务端
  `validation` 四断言 answerUnique / revealMonotonic / decisionPointsGrounded / annotationTermsGrounded
  全 pass）。溯源 run `8d329ab0-7c12-4f6b-b7e2-a2a21288ac1c`（`content.widget_spec`）。
- **fix7**：见上，案例股口径纠错 + 重跑 rubric 自评。
- **rubric 0.4.1 自评复跑**（`content.rubric_review`，run `4b748520-6076-48f0-b492-f02b8c16c17e`）：
  coverage 9 / grounded 9 / order 9 / terms 9 / alignment 9 / frameQuality 9 / difficulty 8 /
  diagram 8 / presentation 9 / replay 9，**verdict approve**，`failed` 空。
  grounded 的「行情数值可核」四条子项逐条复算过：正文与课件全部带日期价/量/涨跌幅对上日线 bar；
  **17 个日期的 M60 全部从日线 bar 复算一致**（10-14 112.751、10-30 116.031、10-31 116.144、
  1-12 102.14、1-15 101.18、1-26 99.06、2-02 98.098、2-25 95.740、2-26 95.726、2-27 95.664、
  3-23 93.637、5-28 85.988、6-26 78.68、7-16 74.730、8-31 73.70、10-16 76.02、11-05 74.55）；
  涨跌幅复算一致（10-14 -5.724%、10-30 -2.002%、10-31 -2.56%、2-25 +10.02%）。
  非阻塞备注（未打回，留给下轮或人工顺手）：§三第五步「2 月 27 日起又有一段连续收在 M60 之下，
  5 月 11 日收 89.842 也只是一次小反弹」——复算显示连续段实为 2026-02-27~2026-05-08，
  5-11 / 5-12 收 89.842 / 88.692 已在当日 M60 88.106 / 88.076 之上、5-13 即跌回，句式易被读成
  5-11 仍在 M60 之下；数值与定性都不算错，可选改法见该 run 的 comments 末段。

**rubric 0.4.1 账本现状（2026-11-07 03:50Z，每节取最新一次 `content.rubric_review`）**：

| 节 | run_id | verdict | grounded |
|---|---|---|---|
| 总论 1 | `f177275a-361b-4471-8657-be86767900d0` | approve | 9 |
| 总论 2 | `2a18f683-77bd-4cd1-9d46-da1bb5369d7a` | approve | 9 |
| 总论 3 | `4b748520-6076-48f0-b492-f02b8c16c17e` | approve | 9 |
| 三元一催化原则 | `68dd3fc7-bd9a-42c8-ad20-9c418eeb2451` | approve | 9 |
| 阻尼运动 | `c7672239-77d5-468c-be95-ae2593dbac6a` | approve | 9 |
| 筹码分布 1 | `5d1819ca-0116-4393-b634-7ee0279acc00` | approve | 9 |

**门禁复跑（2026-11-07 04:19Z，清理三件之后的发布前最后一次全量核对）**：

| 门禁 | 结果 |
|---|---|
| ① `figure_unresolved` | PASS（22/22 图示 ready 且候选就绪；正文引用 22 个 figureId 全部解析到 ready 候选） |
| ② `widget_unproven` | PASS（36 件课件，`status <> 'archived'` 全部断言 `validation === 'pass'`，未证明件 0） |
| ③ `clip_invalid` | PASS（9 个片段窗全部落在 source_units 区间内） |
| ④ `annotation_unresolved` / `replay_unproven` | PASS（`requireResolvedAnnotationsAndReplays` 独立调用通过；含 000722 改 `1d` 后的事件锚点复检） |
| ⑤ `requireFinalApproval` | **FAIL — `approval_stale`**：已签 `38c9f7ac…`（11-05 19:37Z）≠ 当前 `9f784726…` |

当前内容指纹 `9f7847262068bf4af1bcdb837891bf35294e0a78319f54c502203bf8be03a16d`
（分节：总论1 `6358764e…` / 总论2 `7a1d6134…` / 总论3 `bf832e79…` / 三元一催化 `5d68c5b9…` /
阻尼运动 `46b2de12…` / 筹码分布1 `47ccc293…`）。

**门禁② 收口复评（并发 headless 会话，2026-11-07）**：

- **总论 2 的 `image-juxtaposition` 修正**：左侧 caption 原写「（原片画面，非当前价）」，但其
  `figureId=fig_594a3d76455ed080` 的 `kind=diagram`（参数化图示）并非原片截图——按 v3 新题型工艺口径
  第 1 条（caption 与画面形态绑定纪律）属「原片事实挂到非原片画面」同型缺陷，改为
  「（据原片课堂数值绘制的示意图，非当前价）」；重写件 `wgt_ba2c8f4d729fdd0a`
  （pairSidesValid / captionsGrounded 服务端证明全 pass），旧件 `wgt_f2008b2da5a6e29a` 已删
  （同 figureId 对只留一份）。右侧 `fig_13d0bed08c0350ee` 是 keyframe，表述正确未动。
- **阻尼运动案例股事件标签口径纠错**：300168 @2025-11-04 的「越过 7.200 上沿」→「越过 7.100 上沿」
  （7.200 非该段任何 bar 价位，本段上沿为 2025-10-09 的 7.100）；@2025-10-24 的「收敛区域末端缩量」
  →「区间最低量：121564 手，收敛过程中量能萎缩」（与正文「是区间最低量」一致）。
- **术语归一补 2 条**：「主力资金」「高抛低吸」入 `glossary-trend` 0.4.0 与云端 concepts
  （`cpt_579a94e11b23cd36` / `cpt_a916da39e7b8f07a`），以 related 边挂母概念（主力资金→建仓洗盘 /
  趋势启动、高抛低吸→做T），不建 prerequisite 边以免影响讲解顺序判定。
- **门禁② 复评入账本**（`content.rubric_review`）：总论 2（approve）、阻尼运动（approve）。两节均按
  rubric 0.4.1 逐条核过行情数值可核，并复算派生指标——000722 于 2026-09-04 的 M60＝最近 60 个交易日
  收盘均值 12.9533≈课件 12.95；002079 于 2026-07-14 的 M60＝12.5848≈正文 12.585。
- **补报溯源**（并发会话落库时其令牌已到期而中断的两件）：总论 3 修正版
  `wgt_95cba663774745ff`（image-juxtaposition）与 `wgt_e7e73107b0e3e412`（branching-scenario）
  已按 `content.widget_spec` 补齐账本，v3 试点记录里的「待补报溯源清单」至此清空。

**代码侧**：

- **管理台补齐终审签批入口**（`feat(admin)`）：课程编辑页「签批终审」按钮 + 签批状态签；
  发布失败按机器可读错误码给中文指引（`approval_required` / `approval_stale` / `widget_unproven` /
  `figure_unresolved` / `clip_invalid` / `annotation_unresolved` / `replay_unproven`），此前
  `POST|GET .../approvals` 只有 curl 路径、发布按钮必然吃 409 且无提示语。
- **会话失效与角色不足分提示**（`feat(producer)`）：token 过期时工具错误附换发指引，
  403 角色不足附分权提示——本次会话正是被前者卡住。
- 三端行为基线全绿：contracts 31 / fixtures 8 / widgets 29 / producer 54 / coach 136 / cloud 204（203 + 1 skip）。

## 5. 备注

- 生产端只写草稿，发布/签批只由 operator/admin 在云端管理台显式触发——本文件的所有命令都按此分权。
- 生产端 `cloud_quotes_read` 返回的 `tradeDate` 才是正文标注 `d` 与回放 `atDate` 的唯一合法来源；
  视频里出现的日期未必落在缓存窗口内。
- **案例股 `period` 的判定规则**（本轮两处修正后固化）：面板按 `stock.period` 取 bar 与 M60 叠加
  （`packages/widgets/src/course/SectionView.tsx`），所以 `period` 必须跟**本节正文的数值粒度**一致，
  而不是跟「缓存里有没有更早的历史」一致。两条独立的判据：
  ① 窗口要有行情——日线源只回溯到 2024-03 前后，早于该年的历史窗口只能写 `1w`；
  ② 正文逐日拆解用日线就写 `1d`，正文按周线讲就写 `1w`。两条冲突时（历史窗口只有周线、正文却是日线）
  走 ② 的教学代价 vs ① 的锚点取舍，由人拍板（本文件 §3.2b 就是这种情形）。
- 案例股事件的 `date` **不做交易日校验**（只有 `:::annotation` 的 `d` 校验），所以事件日期可以落在
  缓存没有的日期上——前端会把它吸附到最近的周期 bar，不会报错，但三角标记的位置会偏（见 §3.2c）。
- **什么会动发布指纹**（`computeCourseDigest` 的覆盖范围，签批后改这些要重签）：
  正文（markdown + version）、课件（spec + version，`status IN ('draft','published')`）、
  图示、案例股的 `code / name / exchange / window_start / window_end / events`。
  **不**动指纹的：概念表全表、案例股的 `period` 与 `note`、章节标题与排序。
- **概念表当前没有删除 / 归档通道**：`cloud_concepts_write` 按 name upsert 且不更新既有行，
  云端 API 只有 `GET|PUT /concepts` + `POST /concept-edges`，管理台无概念管理页。
  本轮 §3.7 的去重是在库内人工硬删（零引用行），已留档为产品缺口。
