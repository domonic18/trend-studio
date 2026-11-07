# 总论卷（TC-ZONGLUN）发布就绪度与人工待办

快照时间：2026-11-07（云端库 `trend_coach` @ `127.0.0.1:5434`，只读核对，未发布、未签批）

本文件是 headless 生产会话留给教员的**发布前交接单**：内容侧已全绿，唯一未过的是终审签批——
那是人工门禁，生产端无权自签（producer 调 approvals/publish 一律 403）。

## 1. 结论

- 内容侧门禁全过：`figure_unresolved` PASS、`widget_unproven` PASS、
  `annotation_unresolved` / `replay_unproven` PASS。
- 唯一未过：`approval_stale`——已签批指纹 `38c9f7ac43d48091…`（2026-11-05）≠ 当前内容指纹
  `3f71dd1d39f64314…`。指纹随生产持续变动，**必须最后签**。
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

### 3.1 换发 producer 会话令牌（阻塞一切写操作）

2026-11-07T00:03:27Z 生产端会话到期，所有 `cloud_*` 工具开始回
`[forbidden] session invalid or expired`（本次会话即因此中断写路径）。

```bash
# 教员本机：用 producer 账号换发（换发不需要重建账号）
curl -X POST "$CLOUD_BASE/v1/auth/session" \
  -H 'content-type: application/json' \
  -d '{"username":"producer-teacher","password":"<强密码>"}'
# → { token, expiresAt, user }；把 token 写入 dsh credentials 的
#   TREND_PRODUCER_CONSOLE_TOKEN（插件按 credential-ref 读取）
```

### 3.2 修案例股周期口径（2 只，日线窗口早于日线缓存起点）

`section-production` SKILL 的口径：**日线源只回溯到 2024-03 前后，早于该年的历史窗口必须写 `1w`**
（周线源可回溯到 2013–2014）。下列两只声明 `1d` 却带 2022 年窗口，缓存里查无此段：

| 代号 | 名称 | 现声明 | 窗口 | 该周期缓存实际范围 | 判定 |
|---|---|---|---|---|---|
| 002761 | 浙江建投 | `1d` | 2022-04-01 → 2026-11-05 | 日线 2024-03-01 → 2026-11-06 | ✗ 窗首无数据 |
| 300033 | 同花顺 | `1d` | 2022-01-01 → 2026-11-05 | 日线 2024-03-15 → 2026-11-06 | ✗ 窗首无数据 |

修法（两条路径，都走生产端工具，不绕过服务端复检）：

- **002761 浙江建投 → `1w`**：它的 2022-04-25 买入、2022-10-08 卖出正是本节教学点
  （正文「2022 年 4 月 25 日买入浙江建投，随后走出八个板」），窗口保留不动；
  同节的 000722 湖南发展已是同款处理（`1w`，note 写明「周线横盘抗跌 → 叠加筹码密集 → 切日线等 M60 启动」）。
- **300033 同花顺 → 保留 `1d`，窗口起点收到 2024-03-15**（= 该股日线缓存首个交易日）：
  正文讲的是「讲师用同花顺的**日线**讲筹码分布」，事件全在 2026-08/10，砍掉无数据的 2022 段不影响叙事。

```text
cloud_case_stocks_write(sectionId=sec_b6edb810aaeeacce, stocks=[
  000722 湖南发展 1w 2022-01-01→2026-11-05（原样回写，保持 position 1）
  002761 浙江建投 1w 2022-04-01→2026-11-05（period 由 1d 改 1w，events 三条不动）
  300033 同花顺   1d 2024-03-15→2026-11-05（windowStart 由 2022-01-01 收到缓存首个交易日，events 三条不动）
])
cloud_quotes_sync(courseId=TC-ZONGLUN)      # 按新声明的周期补 002761 周线
cloud_quotes_read(courseId=TC-ZONGLUN, codes=['002761','300033'], period='1w'|'1d')
```

回写注意：`cloud_case_stocks_write` 是**同节同代号覆盖**且按提交顺序重排 `position`——三只一起回写，
否则 000722 会与新提交项撞 position。

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

## 4. 本次会话已落地（代码侧）

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
