# 总论卷（TC-ZONGLUN）发布就绪度与人工待办

快照时间：2026-11-07（云端库 `trend_coach` @ `127.0.0.1:5434`；内容侧做了两处案例股口径纠错，
**未发布、未签批**）

本文件是 headless 生产会话留给教员的**发布前交接单**：内容侧已全绿，唯一未过的是终审签批——
那是人工门禁，生产端无权自签（producer 调 approvals/publish 一律 403）。

## 1. 结论

- 内容侧门禁全过：`figure_unresolved` PASS、`widget_unproven` PASS、
  `annotation_unresolved` / `replay_unproven` PASS。
- 唯一未过：`approval_stale`——已签批指纹 `38c9f7ac43d48091…`（2026-11-05）≠ 当前内容指纹
  `d5513d5cf8d6b549…`。指纹随生产持续变动，**必须最后签**。
- 签批 + 发布走完，一次性把 v3 正文、图示、课件、案例股推给学员。

## 2. 当前学员侧可见性（与 `src/catalog/sections.ts` 同口径）

`courses.status = draft`；6 个节的 `sections.status = published` 是 2026-11-04 那次发布的**陈旧状态位**，
正文/课件/图示/案例股都已随生产回到 draft/ready：

| 节 | sections | article | widgets 已发布/全部 | figures 已发布/全部 | 案例股 已发布/全部 |
|---|---|---|---|---|---|
| #1 趋势交易体系总论 1 | published | draft | 3/7 | 0/3 | 0/3 |
| #2 趋势交易体系总论 2 | published | draft | 3/8 | 0/4 | 0/3 |
| #3 趋势交易体系总论 3 | published | draft | 3/8 | 0/4 | 0/1 |
| #4 三元一催化原则 | published | draft | 2/7 | 0/3 | 0/1 |
| #5 阻尼运动 | published | draft | 2/6 | 0/2 | 0/2 |
| #6 筹码分布 1 | published | draft | 3/6 | 0/6 | 0/4 |

即：学员此刻看到的是 6 个只有标题的空章节 + 16 份 11-04 的旧课件；**正文、图示、案例股全部不可见**。
发布事务会把 draft/ready 一次性翻成 published（`PipelineService.publishCourse`）。

## 3. 人工待办（按顺序执行）

### 3.1 换发 producer 会话令牌（✅ 已由并行会话换发）

2026-11-07T00:03:27Z 生产端会话到期，所有 `cloud_*` 工具开始回
`[forbidden] session invalid or expired`（本次会话即因此中断写路径）。并行生产会话随后完成换发，
凭据经 dsh credentials 的 `TREND_PRODUCER_CONSOLE_TOKEN` 生效，写路径恢复。

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
（周线源可回溯到 2013–2014）。原有两只声明 `1d` 却带 2022 年窗口，缓存里查无此段，已按口径修正：

| 代号 | 名称 | 修正前 | 修正后 | 理由 |
|---|---|---|---|---|
| 002761 | 浙江建投 | `1d`，窗口 2022-04-01→ | `1w`，窗口不变 | 2022-04-25 买入、2022-10-08 卖出正是本节教学点（正文「2022 年 4 月 25 日买入浙江建投，随后走出八个板」），改周线保住叙事；同节 000722 已是同款处理 |
| 300033 | 同花顺 | `1d`，窗口 2022-01-01→ | `1d`，窗口起点收至 2024-03-15 | 正文讲「讲师用同花顺的**日线**讲筹码分布」，事件全在 2026-08/10，砍掉无数据的 2022 段不影响叙事 |

执行：`cloud_case_stocks_write`（三只一起回写，保持 `position`）→ `cloud_quotes_sync`（8891 bars，
002761 周线补齐、缓存回溯至 2015-06-12）→ 复核 **14/14 案例股窗口均被对应周期行情缓存覆盖** →
上报 `content.section_edit` 溯源（targetId=`sec_b6edb810aaeeacce`）。

### 3.3 重新签批终审

内容定稿后再签（指纹随内容变，早签必 stale）。管理台课程编辑页现已有「签批终审」按钮与签批状态签
（本次会话落地，见 §4）；等价命令：

```bash
curl -X POST "$CLOUD_BASE/v1/admin/content/courses/TC-ZONGLUN/approvals" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"gate":"final"}'
```

### 3.4 发布

管理台「发布课程」按钮，或：

```bash
curl -X POST "$CLOUD_BASE/v1/admin/content/courses/TC-ZONGLUN/publish" \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### 3.5 复核

`cloud_sections_write(action=list)` 看 6 节状态；学员侧口径复核——每节应有正文、图示、课件、案例股，
不再是 `has_article=false / figures=0 / stocks=[]`。

## 4. 本次会话已落地

**内容侧**（生产端工具写入，已上报 `content.section_edit` 溯源）：

- 案例股周期口径纠错（§3.2）：002761 改 `1w`、300033 收窗到日线缓存首个交易日，
  14/14 案例股窗口复核通过。

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
