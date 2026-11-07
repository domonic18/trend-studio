# 生产端（producer）端到端用户旅程、目标流程与实施计划

日期：2026-11-07　范围：`apps/producer`（dsh 插件）+ `apps/cloud/web/admin`（管理台）+ `apps/cloud/src/media`（媒体服务）

本文档三部分：
- **§1–§3 现状**：今天是什么样（基线，供对照）
- **§4 目标流程**：愿景「配好模型即可制作课件」下的应有形态
- **§5–§7 决策与实施**：已拍板的决策、生产体验线的实施计划

§4 起的内容均为**待实施目标**，不代表现状。现状与目标冲突处，以本文档显式标注为准。

---

## 0. 一句话结论

**发布侧（签批 → 发布 → 复核）已是产品化的；生产侧（素材入库 → 逐节生产 → 评审 → 交接）目前仍是
「终端 + markdown 文档 + 人记纪律」。** 目标是把生产侧做到「**配好模型即可制作课件**」——
人只负责拖素材、说意图、做三个决策，其余由 Agent 按引擎强制的流程跑完。

---

# 第一部分 · 现状

## 1. 角色与分权

| 角色 | 工作面 | 能做 | 不能做 |
|---|---|---|---|
| **producer**（课件制作人员） | **终端** `dsh --profile trend-producer headless "..."` | 写内容（正文 / 课件 / 图示 / 案例股 / 行情 / 术语 / 溯源） | 签批、发布、素材上传、建课建节、任务发起 |
| **operator / admin**（运营 / 管理员） | **浏览器** `/admin` | 看内容、管素材与建课任务、签批、发布、查 AI 运行记录 | — |

- 分权在**云端 API guard**（`apps/cloud/src/production/routes.ts:43` 的 producerGuard、
  `apps/cloud/src/content/routes.ts:69` 的 staffGuard）；管理台**前端不按角色拦截内容组页面**
  （`apps/cloud/web/admin/src/router.tsx:73-116`）。
- 生产端工具面共 **21 个 `cloud_*`**（`apps/producer/src/host/tools.ts`）；插件**不注册**
  shell / 文件写入 / 联网搜索（`AGENTS.md` 硬约束 10）。
- 生产端只写草稿；发布只由云端管理台触发（`AGENTS.md` 硬约束 1）。

> 生产插件用的是 dsh credentials 里的 `TREND_PRODUCER_CONSOLE_TOKEN`
> （`src/host/config.ts:53`），与管理台网页登录令牌是**两份独立令牌**。

## 2. 端到端旅程（现状）

### 阶段 1 · 领账号与令牌

| 用户动作 | 现状证据 |
|---|---|
| admin 在「系统管理 → 账号」建 producer 账号 | `pages/Accounts/`；`apps/cloud/src/ai/accounts/routes.ts:133-161` |
| producer 在 `/admin/login` 登录 | 登录页写着**「仅限运营与管理员账号。」** ← `pages/Login/LoginPage.tsx:58` |
| producer 另行换发插件令牌 | 无界面，需手工 `POST /v1/auth/session` 后写入 dsh credentials（`src/host/auth.ts:48-58`） |

**🟡** 同一套账号密码，网页与插件却是两份令牌、两个地方。

### 阶段 2 · 素材 → 骨架

| 用户动作 | 现状证据 |
|---|---|
| 管理台「视频建课」上传原片 → 处理转写 → 生成 → 应用到草稿课程 | `pages/Pipeline/PipelinePage.tsx:159-250`、`AssetTable.tsx:144-201`、`JobTable.tsx:65-141` |
| 终端跑 producer 做课程骨架（目录校验 → 概念归一 → 节骨架），门禁①后停 | `skills/curriculum-synthesis/`、`skills/section-production/SKILL.md:14-17` |

**🟡** 这步在终端、产物在浏览器；「门禁①停下」没有界面信号。

### 阶段 3 · 逐节生产（主体，约 90% 时间）

终端里一节一节派活，**每节执行 9 步固定顺序**（`skills/section-production/SKILL.md:20-28`）：

```
案例股 → 行情同步 → 行情读回 → 图示 → 回放课件 → 正文 → 其余课件 → 评审 → 溯源
```

顺序由依赖倒推：正文 `[[stock:]]` 校验案例股在册；`:::annotation` 的 `d` 与回放 `atDate` 必须是缓存真实交易日；
正文 `:::figure` 校验 figure 属于本节；`:::replay` 按 `code` 解析本节唯一一份回放课件。

**🔴** 21 个工具只能通过 Agent 调用；9 步顺序**代码层无强制**，跑错只会得到下游错误码；
`cloud_quotes_sync` **管理台无按钮**；没有生产进度看板。

### 阶段 4 · 评审闭环

- 评审十维各有通过线（`skills/quality-rubric/SKILL.md:23-34`），verdict 只有 approve / reject，
  同节 ≤3 轮回灌（`skills/section-production/SKILL.md:80-82`）。
- 评审结论落在 `ai_runs`（`content.rubric_review`），但只能在 `/admin/ai/runs` 按**任务 + 时间**筛，
  **不能按节检索**，且 **producer 进不去**（RequireOps）。

**🔴** 生产者对的作品没有可见的评审档案。

> 门禁②收口判据：**该节最后一次内容写入时间 ≤ 该节最后一条 `content.rubric_review` 的时间，
> 且 verdict=approve**（`docs/research/zonglun-gate2-closure-2026-11-07.md:74-75`）。

### 阶段 5 · 交接（跨角色断层）

交付物是**一份 markdown**：`docs/research/tc-zonglun-publish-readiness.md`。数据都在库里，却要人写文档当交接单。

**🔴**

### 阶段 6 · 签批 → 发布 → 复核

- 「签批终审」按钮 + 二次确认 + 签批状态签（`pages/Content/TreeEditor.tsx:132-139, 204-248`）
- 发布失败按 7 个错误码给中文指引（`lib/publishErrors.ts:7-15`）

**🟢**（本轮 2026-11-07 补齐）；遗留：producer 也看得见这两个按钮，点了才知无权；签批失败除 403 外出英文。

## 3. 顺畅度汇总

| 阶段 | 顺畅度 | 主要问题 |
|---|---|---|
| 1 领账号令牌 | 🟡 | 网页与插件两份令牌；登录页文案与实际不符 |
| 2 素材→骨架 | 🟡 | 终端与浏览器来回切；门禁①停止无界面信号 |
| 3 逐节生产 | 🔴 | 21 工具纯命令行；9 步顺序无强制；无进度看板；quotes-sync 无按钮 |
| 4 评审闭环 | 🔴 | producer 看不到评审记录；不能按节检索 |
| 5 交接 | 🔴 | 交接物是 markdown |
| 6 签批发布复核 | 🟢 | 按钮未按角色隐藏；签批失败仍出英文 |

---

# 第二部分 · 目标流程

## 4. 愿景与验收标准

> 愿景：**配好模型，即可制作课件。**

**验收尺子**：一个新同事拿到「插件包 + 模型 API key + 云端账号」，**几步之内**能做出第一节课件。

| 现状 | 目标 |
|---|---|
| 步数不确定（20+ 步，含 3 处手工改配置文件） | **3 步** |

| 步 | 人做什么 | 系统做什么 | 人看得见 |
|---|---|---|---|
| 1 | 装插件 | 装 profile + 插件 + 挂 skills | 终端一行回执 |
| 2 | 填 3 个值（模型 key / 云端地址 / 账号令牌） | 交互式提示 + **当场连通性自检** | 3 个 ✓ 全绿，缺一个立刻红字 |
| 3 | 打开 dsh，拖一个视频进对话框，说「用这个视频做第一节」 | 自动建素材 → 直传 → 转写 → 理解 → 骨架 → 逐节生产 | 步骤卡逐条打勾 |

之后全程，人只在**三个决策点**被打断：① 门禁①骨架放行 ② 评审 reject 要不要改 ③ 签批。

## 5. 目标流程（六阶段）

### 阶段 0 · 一次性装机

```
$ dsh plugin --profile trend-producer install dsh-plugin-trend-producer.tgz
  → 自动生成 profile（skills 活挂载）+ 插件 + 单一模型配置位
$ dsh plugin --profile trend-producer login
  → 交互式：模型 provider + API key / 云端地址 / 账号密码
  → 换发令牌写进 credentials（全程不碰配置文件）+ 连通性自检
$ dsh web --profile trend-producer
```

要点：
- **一个 profile、一个生产模型位**。现状 `trend-producer`（mimo-v2.6-flash）与
  `trend-producer-web`（MiniMax-M3.1-Flash）两个 profile 两个模型，且 web profile 实际未被使用
- **令牌换发有交互入口**（现状是手工 curl + 手改 `~/.dsh/.credentials.yaml`）
- **装完即体检**：模型可达？云端可达？令牌有效且角色是 producer？插件版本 == 仓库版本？
  skills 挂上了？**任一不过当场报，不等到跑到一半 403**

### 阶段 1 · 拖一个视频进来（入口场景）

**dsh 侧已支持**（查证 `dsh-attachment`）：任何非图片文件以通用文件形式附加到提示词，**确切字节只读保存在
harness 主目录**（本机 `~/.dsh/attachments/v1/`），消息记录文件名/字节数/摘要，**模型收到一行保存路径**，
需要时用文件工具读取；**无文件类型白名单、无大小上限**。官方文档也直说「音频和视频暂无专门处理」。
→ **拖拽视频进 dsh 是开箱可用的**。

**断链点**（现状）：

| 环节 | 端点 | 现状 | 缺什么 |
|---|---|---|---|
| 建素材 | `POST /v1/admin/content/media-assets` | ✅ producerGuard（A2 已开） | 缺生产端工具 |
| 签发凭据 | `POST .../media-assets/:assetId/upload-ticket` | ✅ producerGuard（A2 新增） | 缺生产端工具 |
| 传字节 | `PUT /v1/admin/content/media-assets/:assetId/source`（octet-stream，`x-file-sha256`） | ✅ 会话或签名凭据二选一（A2 已开） | 缺生产端工具 |
| 落库确认 | `POST .../media-assets/:assetId/upload-confirm` | ✅ producerGuard（A2 新增） | 缺生产端工具 |
| 入队转写 | `POST .../media-assets/:assetId/ingest` | ✅ producerGuard（A2 已开） | 缺生产端工具 |
| 轮询任务 | `GET /v1/admin/pipeline/jobs` | ✅ | 有 `cloud_pipeline_status` |
| 读转写 / 取帧 | `GET .../transcript`、`GET .../frames` | ✅ | 有 `cloud_transcript` / `cloud_frames` |
| VLM 理解 | — | ✅ | 有 `cloud_understanding_run`（要求 assetId） |

另有一个客户端硬伤：`TrendCloudClient.send()` 只发 JSON（`src/host/cloud-client.ts:73-77`），
**没有二进制/流式上传通道**。

**目标形态**：

```
人：拖入 课程1.mp4 → 「用这个视频做第一节」
  ↓
① cloud_asset_create(courseId, title)          → assetId
② cloud_asset_upload_ticket(assetId, size, sha256) → { uploadUrl, headers, expiresAt }
③ 直传：PUT 到 uploadUrl（字节不经插件进程）      ← 签名直传
④ cloud_asset_upload_confirm(assetId, sha256)   → 云端落元数据（status='uploaded'）
⑤ cloud_asset_ingest(assetId, language)        → jobId
⑥ 轮询 cloud_pipeline_status（阶段化进度）→ 转写完成
⑦ cloud_transcript / cloud_frames / cloud_understanding_run → source units
  ↓
⑧ 课程综合（目录校验 → 概念归一 → 骨架）→ 停在门禁①
```

### 阶段 2 · 逐节生产（9 步变成引擎强制的状态机）

把 9 步从「文档纪律」变成「云端可持久化的生产任务」：

```
生产任务（每节一个，云端持久化）
  待开始 → 案例股 → 行情 → 图示 → 回放课件 → 正文 → 其余课件 → 评审 → 已定稿
```

带来四件事：
1. **顺序由引擎强制**，跑错序会被挡住并提示「当前该做第 N 步」
2. **进度可见** —— 看板显示每节停在哪一步
3. **断点续跑** —— 「接着做第 3 节」就是真的接着做（呼应「云 DB 即 checkpoint」硬约束 8）
4. **预算可管** —— 「≤3 轮回灌」「步数上限」从纪律变成字段

### 阶段 3 · 评审

- 十维分数条 + 通过线标记 + verdict + reject 的逐段修改指令，**从终端输出变成结构化卡片**
- 收在同一处看：**每节的评审历史**（第 1 轮 reject → 第 2 轮 approve），按节检索
- 门禁②收口判据不变

### 阶段 4 · 交接

管理台课程编辑页出现「**发布就绪度**」卡片：

```
门禁① 概念/图示解析   ✓
门禁② 课件断言证明     ✓ 36/36
门禁③ 片段窗           ✓ 9/9
门禁④ 标注与回放       ✓
门禁⑤ 终审签批         ✗ 待 operator/admin
当前指纹  9f784726…
待办     ① 签批  ② 发布  ③ 复核
```

markdown 降级为历史留档。

### 阶段 5 · 签批 → 发布 → 复核

现状已达标，补两点：producer 不显示签批/发布入口；签批失败也给中文。

### 贯穿 · 生产看板

| 节 | 正文 | 课件 | 图示 | 案例股 | 行情 | 步骤 | 评审 | 溯源 |
|---|---|---|---|---|---|---|---|---|
| 总论 1 | v7 ✓ | 5 | 3 ✓ | 3 ✓ | ✓ | 9/9 | approve ✓ | → |
| 总论 2 | v6 ✓ | 7 | 4 ✓ | 3 ✓ | ✓ | 7/9 | — | → |

每格带动作：`继续生产` / `看评审` / `看溯源` / `看预览`。

---

## 6. 场景 A / 场景 B（素材入库的两条路）

### 场景 A · 首次制作
拖入视频 → 建课 → 建骨架 → 逐节生产。

### 场景 B · 追加素材（课程做到一半，再拖一个视频进来）

**必须让用户选择**，不得由 Agent 自作主张。选择点设计：

> 这批新素材（`第2讲.mp4`，38 分钟）到货了。这节课已经做完了，想怎么处理？
>
> **A. 只补这节**（推荐）—— 新素材作为这节课的补充证据，只重跑这节的素材理解、正文与评审，其他 5 节不动。
> **B. 重做课程骨架** —— 新素材可能带出新章节/新节，重新跑一遍目录校验与课程骨架，已有 6 节保留不删。
> **C. 只入库，先不生产** —— 素材转写好放着，等决定了再动内容。
>
> 选 A 会重评：总论 2。选 B 会重评：全部 6 节。

设计约束：
- **默认 A**，且**必须列出影响范围**（哪几节会被重评）——人最怕「不知道它会动什么」
- 选择结果**存进生产任务**，不是一次性问答
- **B 触发目录先验校验**（硬约束 7：编排不得发明章节/节）—— 新章节必须来自人工目录

---

## 7. 存储通道：签名直传

**现状**：媒体落本地盘（`PIPELINE_STORAGE_DIR`）；源文件经 cloud 进程转发（`PUT .../source`）；
但**帧与播放会话已在用签名 URL**（`mediaSigningSecret` + `mediaBaseUrl` + TTL 600s，
`apps/cloud/src/production/routes.ts:71`，`apps/cloud/src/media/figure-sign.ts`）。

**目标**：把上传也变成签名直传，插件不碰字节。

| 步 | 谁做 | 内容 |
|---|---|---|
| ① | 生产端 | `cloud_asset_create` → assetId |
| ② | 云端 | `cloud_asset_upload_ticket` → 签发 `{ uploadUrl, method, headers, expiresAt }` |
| ③ | dsh / 客户端 | 直接 `PUT` 到 uploadUrl（**字节不经插件进程**） |
| ④ | 生产端 | `cloud_asset_upload_confirm` → 云端落元数据（`source_rel_path` / `size` / `sha256` / `status='uploaded'`） |

优点：插件进程不做搬运 → 可后台跑、可断点续传、可重试；2GB 上限不再是插件的内存/超时问题；
分片直传由媒体服务承接。

**要新增**：媒体服务支持 `PUT`（`apps/cloud/src/media/routes.ts` 现在只有 GET）
+ 一个 ticket 端点 + 云端把 create / ticket / confirm 放开给 producer。

---

## 8. producer 权限矩阵（目标：AI 加持下自由制作课件）

| 端点 | 现状 | 目标 |
|---|---|---|
| `POST /v1/admin/content/courses` 建课程 | staff | ✅ **开** |
| `POST .../courses/:courseId/chapters` 建章 | staff | ✅ **开** |
| `PUT /v1/admin/content/sections` 建节 | producerGuard ✅ | 已开 |
| `POST .../knowledge-points` 知识点 | staff | ✅ **开** |
| `PUT .../chapters/:chapterId/quiz` 章级随堂测验 | staff | ✅ **开**（已拍板：教学内容，非课程结构） |
| `POST /media-assets` 建素材 | staff | ✅ **开** |
| 上传 ticket / confirm | staff | ✅ **开** |
| `POST .../media-assets/:id/ingest` | producerGuard ✅ | 补工具 |
| `PUT /sections` 节元数据 / `PUT .../article` 正文 | producerGuard ✅ | — |
| widgets / figures / case-stocks / concepts | producerGuard ✅ | — |
| `PATCH /courses/:id` 改课程标题与状态 | staff | **保持 staff**（状态是发布语义） |
| `POST .../approvals` 签批 | staff | **保持** |
| `POST .../publish` 发布 | staff | **保持** |

**分权原则**：producer 能建任何结构、能写任何教学内容，**但所有写入都是 draft**，
且**签批/发布永远是别人的**。

---

## 9. 进度与长任务：行业做法与我们的对照

### 行业惯例

| 惯例 | 谁在做 |
|---|---|
| **① 阶段化而非百分比** | Runway、ElevenLabs、Descript |
| **② 增量产出**（先出粗稿，边跑边精确） | Whisper / AssemblyAI |
| **③ 后台跑 + 完成通知** | 所有 SaaS AI（Midjourney 队列、Sora、Runway） |
| **④ 任务列表可回看**（状态 / 输入 / 产物 / 重试） | ElevenLabs、Runway |
| **⑤ 失败可重试且保留输入** | 全行业 |
| **⑥ ETA 只在同质统计后给** | 谨慎型产品 |

### 我们的现状：基础设施已有一半

- `JOB_STAGES` 已标准阶段化（`apps/cloud/src/pipeline/types.ts:17-29`）：
  `queued → probe → transcode → transcribe → keyframes → structure → generate
  → figure_plan → figure_render → finalize → done`
- `pipeline_jobs` 有 `stage` + `progress` + `setProgress()`（`apps/cloud/src/pipeline/jobs.ts:172`）
- 管理台管线页**已在渲染进度条 + 阶段中文标签 + 2.5s 轮询**（`JobTable.tsx:65-67`、`PipelinePage.tsx:58-67`）

### 缺口与对策

| 缺口 | 对策 | 落点 |
|---|---|---|
| 进度没暴露到 dsh | Agent 轮询 `cloud_pipeline_status` 时把 stage/progress 翻成人话推进对话；长任务改后台跑 + 完成通知 | 生产端 |
| 没有增量产出 | 转写未完成即可消费部分 source units，让理解与生产提前起跑 | 云端 `media_transcripts` / `source_units` 就绪语义 |
| 没有生产任务历史列表 | 生产任务表 + 看板「任务」页 | 云端 + 管理台 |

---

## 10. 素材与课程的关系：MasterClass 模型（已有 schema，无需新建）

### 行业做法

| 模式 | 谁 | 做法 |
|---|---|---|
| 素材库与课程解耦，素材跨课复用 | Shopify Media Library、Canva、Notion | 素材独立实体，课程**引用**它 |
| 一节课引用多个素材 | Coursera、edX | lesson 可挂多个 video + reading + quiz |
| **节内把素材切成时间码片段** | **MasterClass 的 moments**、YouTube 章节 | 一个长视频 → 若干「时刻」，各带标题与讲解 |

### 我们的对应物（已存在）

```
sections.source_asset_ids  jsonb                          ← 这节课引用哪些【素材】（多值）
source_units (asset_id, start_ms, end_ms)                 ← 素材被切成的【片段】
正文 [[unit:su_xxx]] 锚                                   ← 引用到【片段】粒度
```

这正是 MasterClass 模型：素材 → 片段（moments）→ 课件引用片段。

**结论：不需要新增数据结构**。要补的是：
1. 界面暴露并可编辑 `source_asset_ids`（并入「内容可编辑」）
2. 场景 B 的挂载决策 —— 新素材挂到哪几节，就是往哪些节的 `source_asset_ids` 追加

附带收益：该模型天然支持**跨课复用素材**（同一段原片可同时出现在总论卷与进阶卷），
在「AI 自由制作」下会是常见需求，schema 已支持。

---

# 第三部分 · 决策与实施

## 11. 决策记录（已拍板）

| # | 决策 | 决定 | 理由 |
|---|---|---|---|
| D1 | 场景 B 的处理 | 保留多种可能，**由 Agent 提示用户选择**（A 只补这节 / B 重做骨架 / C 只入库），默认 A 并列出影响范围 | 追加素材的语义无法自动判定；人最怕「不知道它会动什么」 |
| D2 | 上传通道 | **新增存储通道**（签名直传），字节不经插件进程 | 可后台跑、可断点续传、可重试；不受插件内存/超时约束 |
| D3 | producer 建素材 | **允许**，且目标是「AI 加持下自由制作课件」 | 建素材只写 `media_assets`，不改课程内容、不改发布状态、不进发布指纹 |
| D4 | 节级测验 | **开放给 producer** | 它是教学内容而非课程结构；按 D3 的原则应开 |
| D5 | 增量转写产出 | **加入实施计划** | 惯例②，最省时间的一条；让理解与生产提前起跑 |
| D6 | 批切分 | **先做「生产体验线」** | 素材入库 + 状态机 + 看板 + 向导 + 小修小补；发布交接线（就绪度卡片、内容可编辑）留到下一批 |

## 12. 实施计划 · 生产体验线

### 12.1 批次与依赖

```
A1 契约与云端文档（packages/contracts + 云端需求 v0.23 / 清单 v0.21）
   └→ A2 云端：素材直传链路 + 权限放开
        └→ A3 生产端：素材工具 + 二进制通道
A4 生产任务状态机（云端表 + 迁移 + 端点）
   └→ A5 生产端编排改造（9 步引擎强制 + 场景 B 选择）
A6 增量转写产出（云端就绪语义）
A7 管理台：生产看板 + quotes-sync 按钮 + 角色显隐 + 错误文案
A8 流程向导：SKILL.md 双渲染
A9 装机向导（单 profile / 单模型 / 交互 login / 自检）
```

### 12.2 明细

| 批次 | 内容 | 落点 | 量 |
|---|---|---|---|
| **A1** | 新增契约：`mediaAssetCreate` / `uploadTicket` / `uploadConfirm` / `assetIngest` / `productionTask*`；云端需求 v0.23（分权矩阵 D3/D4）、清单 v0.21（端点与验收用例） | `packages/contracts`、云端 docs | S |
| **A2** | ① `POST /media-assets` 放开 producer；② 新增 `POST .../upload-ticket`（签发 PUT 凭据）；③ 新增 `POST .../upload-confirm`（落元数据）；④ 直传 PUT 落在管线路由上（`PUT .../media-assets/:id/source`，会话或签名凭据二选一，复用 `mediaSigningSecret`；不另开媒体服务路由，避免 CDN 前置的媒体域承担校验）⑤ 放开建课程/章/节/知识点/测验 | `apps/cloud/src/pipeline/routes.ts`、`apps/cloud/src/pipeline/service.ts`、`apps/cloud/src/media/upload-sign.ts`、`apps/cloud/src/content/routes.ts` | **M** |
| **A3** | 4 个新工具 + `TrendCloudClient` 二进制通道；直传由 dsh 侧发起（附件本地路径 → PUT） | `apps/producer/src/host/tools.ts`、`src/host/cloud-client.ts`、`src/host/contracts.ts` | **M** |
| **A4** | 生产任务表（节 × 步骤 × 状态 × 预算）+ 迁移 + 只读聚合端点（看板用） | `apps/cloud/src/production/`、迁移脚本、`packages/contracts` | **M** |
| **A5** | 编排改造：按任务状态推进 9 步（引擎在生产端本地判定，云端只存状态）；场景 B 选择点（A 只补这节 / B 重做课程骨架 / C 只入库），影响面先算后问、决策持久化 | `apps/producer/src/host/production-steps.ts`、`src/host/production-tools.ts`、`apps/cloud/src/production/material-choices.ts`、skills | **M** |
| **A6** | 转写未完成即可消费部分 source units（增量就绪语义） | `apps/cloud/src/pipeline/`、`media_transcripts` / `source_units` | **M** |
| **A7** | 生产看板页；`quotes-sync` 按钮；按钮按角色显隐；错误文案补齐（签批/素材/任务三类） | `apps/cloud/web/admin/` | **M** |
| **A8** | SKILL.md 双渲染：同一份真相源既给模型（现有）又给人（步骤卡） | `apps/producer/skills/*` + 看板 | **M** |
| **A9** | 装机向导：单 profile / 单模型位 / 交互式 login / 连通性自检 | `apps/producer` + 安装脚本 | **M** |

**落地状态（2026-11-07）**：A1 ✅ 契约 `assets.ts` / `production-task.ts`，云端需求 v0.23 / 清单 v0.21；
A2 ✅ 云端 `upload-ticket` / `upload-confirm` / PUT 直传（带凭据即以凭据为准，会话不顶替）+ producer 权限放开；
A3 ✅ 生产端 `cloud_asset_create` / `cloud_asset_upload` / `cloud_asset_ingest` / `cloud_asset_list`
+ 流式直传通道（字节不经插件进程）+ `material-ingest` 技能包；
A4 ✅ 云端 `production_tasks` 表（节 × 步骤 × 状态 × 预算，迁移 022）+ 三个端点
（`POST/GET /production-tasks`、`GET /courses/:id/production-board`），看板聚合含步骤、产出计数与最近评审结论；
A5 ✅ 生产端 `production-steps.ts`（纯引擎：当前步 / 门禁 / 回灌计数）+ 5 个工具
（`cloud_production_task_write` / `cloud_production_tasks_read` / `cloud_production_board_read` /
`cloud_material_impact` / `cloud_material_choice`）；云端 `production_material_choices` 表（迁移 023）
+ `POST /material-impact` / `POST /material-choices` 两个端点；`section-production` 与
`material-ingest` 两个技能包同步九步状态机与 A/B/C 决策链。
A6 ✅ 云端管线**边转写边发布**（`worker.ts` 的 chunk runner 每转完一个 chunk 即落成 segment；
并发发布经 `media_transcripts` 行锁串行化、锁内重读 chunk 状态，杜绝旧快照覆盖新快照）；
关键帧轨道提前到 ASR 之前抽完（抽帧与转写无关，保证部分理解阶段画面证据齐备）；
读侧语义：转写回执增必填 `transcript.partial`、`total` 变为「当前可读段数」；
`source-units/read` 回执增必填 `partial`，素材闸门放宽到 `ready` 与 `processing`
（`failed`/`archived` 仍 `409 unit_not_readable`）；生产端播放会话增 `allowPartial`
（**学员端不变**）；生产端 `understanding.ts` 翻页改按「本页读满 limit」终止（不拿会移动的 `total` 当终点）；
`transcript-understanding` 与 `material-ingest` 两个技能包同步增量产出纪律。
A7 ✅ 管理台「生产看板」页（`/admin/courses/:courseId/board`）：每节一行九步状态 + 产出计数
（正文版本 / 课件 / 图示 / 案例股）+ 最近评审结论 + **当前步**（口径与生产端引擎一致：九步里第一个未
`done` 的，含尚未落库任务的步）+ 最近的追加素材决策；看板页带「同步行情」按钮
（`POST .../quotes-sync`，只写行情缓存不改内容状态，故对 producer 开放；`upserted=0` 时提示
「可能还没有案例股或行情源暂无数据」而不当成功报）；签批与发布按钮**对 producer 直接隐藏**
（分权不变，不靠点下去吃 403 才发现没权限）；新增 `lib/productionSteps.ts`（九步契约副本，
浏览器端不引 zod）与 `lib/productionErrors.ts`（素材 / 任务 / 行情三类失败的可执行中文指引）；
顺带补上素材与任务表此前**完全没有 onError** 的静默失败（上传 / 处理 / 生成 / 归档 / 取消 / 重试）。
**引擎在本地、云端只存状态**——顺序/预算/影响面规则不落云端，「云 DB 即 checkpoint」不变。

### 12.3 每批次的完成定义

- `pnpm --filter @trend/contracts build && test`
- `pnpm --filter trend-coach-cloud check && test`（两个不同库：守卫脚本生效）
- `pnpm --filter dsh-plugin-trend-producer check && test`
- `pnpm --filter dsh-plugin-trend-coach check && test`（K 线/渲染未回归）
- 契约变更必须对齐云端清单的验收用例（硬约束 11）
- 每个落库产物有 provenance 记录（硬约束 6）
- 提交遵循 Conventional Commits，分批提交（`AGENTS.md` 完成定义）

### 12.4 出界不做（本轮）

- 发布交接线：**发布就绪度卡片**、**内容可编辑**（节 / 案例股 / 术语抽屉）—— 属 D6 的下一批
- 学生端富媒体页面
- 云端真机部署与真实模型压测（沿用本机 dev 库 + 本地 profile 验收）

---

## 附 · 证据索引

| 主题 | 位置 |
|---|---|
| 21 个生产工具注册 | `apps/producer/src/host/tools.ts` |
| 生产端只有 JSON 通道 | `apps/producer/src/host/cloud-client.ts:73-77` |
| 凭据与 baseUrl 配置 | `apps/producer/src/host/config.ts:50-64` |
| 写入顺序约束 | `apps/producer/skills/section-production/SKILL.md:20-28` |
| 评审十维与通过线 | `apps/producer/skills/quality-rubric/SKILL.md:23-34, 70` |
| dsh 附件机制（任意文件、无白名单、给模型保存路径） | `@deepseek-ai/dsh-attachment` README.zh.md |
| 素材端点与 guard | `apps/cloud/src/pipeline/routes.ts:80-158, 277` |
| 媒体服务（只有 GET） | `apps/cloud/src/media/routes.ts:36, 90, 119` |
| 签名 URL 范式 | `apps/cloud/src/media/figure-sign.ts`、`keyframe-sign.ts` |
| 素材落盘与 sha256 校验 | `apps/cloud/src/pipeline/service.ts:650-690` |
| 作业阶段枚举与进度 | `apps/cloud/src/pipeline/types.ts:17-29`、`jobs.ts:172` |
| 管理台已渲染进度条 | `apps/cloud/web/admin/src/pages/Pipeline/JobTable.tsx:65-67` |
| 内容写端点与 staff guard | `apps/cloud/src/content/routes.ts:69, 86-266` |
| producer 开放的写端点 | `apps/cloud/src/production/routes.ts:43, 158-322` |
| 发布门禁与错误码 | `apps/cloud/src/pipeline/service.ts:1129-1153`；`apps/cloud/web/admin/src/lib/publishErrors.ts:7-15` |
| 发布指纹覆盖范围 | `apps/cloud/src/production/digest.ts:152-158, 223-325` |
| 管理台路由与角色拦截 | `apps/cloud/web/admin/src/router.tsx:27-116` |
| 签批 / 发布入口 | `apps/cloud/web/admin/src/pages/Content/TreeEditor.tsx:132-139, 204-256` |
| 登录页文案矛盾 | `apps/cloud/web/admin/src/pages/Login/LoginPage.tsx:58` |
| 节不可编辑 | `apps/cloud/web/admin/src/pages/Content/SectionsList.tsx:32-50` |
| 节 → 素材绑定（已有字段） | `sections.source_asset_ids`（`012_m9_production.sql`） |
| 本轮清理与门禁复跑记录 | `docs/research/tc-zonglun-publish-readiness.md`、`zonglun-gate2-closure-2026-11-07.md` |
