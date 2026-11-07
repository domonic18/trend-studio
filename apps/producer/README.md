# dsh-plugin-trend-producer（apps/producer）

monorepo（`~/Code/trend-studio`）的生产插件应用。趋势交易课程**生产插件**：运行在教员本机 dsh 上，驱动"约 69 集录播视频（≈35h）→ 结构化图文课程 + 交互课件"的生产 Agent 编排。

- 与学员伴学插件 `dsh-plugin-trend-coach` 配对：本插件管**生产**（写草稿、上报溯源、接受审批），云端 `trend-coach-cloud` 管**门禁与存储**，学员插件管**消费**（只读已发布内容）。
- 生产 Agent 循环、Skill 工艺包与审批卡点在本插件；云端不内嵌 Agent，发布必须云端管理台人工触发。
- 契约真相源：`trend-coach-cloud` 需求 v0.9 C13/C14 / 对接清单 v0.8 §3.13（M9）、§3.14（M10）/ 架构 v0.10 §6.5、§6.6。

详见 [AGENTS.md](./AGENTS.md)。

## 角色与凭据（M3b 分权）

云端把**生产**与**发布**拆成两个角色：插件用 `producer` 角色账号，审批与发布由
`operator`/`admin` 账号在云端管理台做。producer 调 publish 端点直接 403。

| 角色 | 内容写端点（source-units / sections / article / widgets / figures / case-stocks / concepts / edges / provenance） | 发布 / 审批 |
|---|---|---|
| `producer` | ✅ | ❌（403） |
| `operator` | ✅ | ✅ |
| `admin` | ✅ | ✅ |
| `student` | ❌ | ❌ |

### 获取 producer 凭据

1. 管理员在云端建 producer 账号（**admin-only** 端点，operator/admin 都不能建）：
   ```bash
   curl -X POST "$CLOUD_BASE/v1/admin/users" \
     -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"username":"producer-teacher","displayName":"教员","role":"producer","password":"<强密码>"}'
   ```
2. 该账号换会话令牌（console 域；student 角色被拒，producer/operator/admin 可）：
   ```bash
   curl -X POST "$CLOUD_BASE/v1/auth/session" \
     -H 'content-type: application/json' \
     -d '{"username":"producer-teacher","password":"<强密码>"}'
   # → { token, expiresAt, user }
   ```
3. 令牌存进 dsh credentials，插件按 credential-ref 引用（配置项 `consoleTokenRef`，
   默认 ref 名 `TREND_PRODUCER_CONSOLE_TOKEN`）。令牌只在请求头出现，不进日志/配置/代码。
4. 令牌过期就重新走第 2 步换发；换发不需要重建账号。

   令牌过期时所有 `cloud_*` 工具会回 `[forbidden] session invalid or expired`，并附带换发指引
   （`POST /v1/auth/session` 换发 → 写入 dsh credentials 的 `TREND_PRODUCER_CONSOLE_TOKEN`）；
   角色不足（producer 调发布/签批）回的是另一种提示——两者不可混为一谈。

发布链路由 operator/admin 走：`POST /v1/admin/content/courses/:courseId/approvals`
（gate=`final`，服务端算课程内容指纹）→ 发布端点。发布时服务端重算指纹比对，内容在
审批后被改过即 `409 approval_stale`，无 final 审批即 `409 approval_required`。
producer 不参与这两步。

管理台（`/admin/` 课程编辑页）已带这两个动作：课程编辑页「签批终审」按钮 + 签批状态签，
再点「发布课程」；发布失败按错误码给中文指引（未签批提示先签批、内容变更提示重签）——
此前签批只有 curl 路径，发布按钮点下去必然吃 `409` 且无提示语。
