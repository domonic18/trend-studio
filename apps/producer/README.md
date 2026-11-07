# dsh-plugin-trend-producer（apps/producer）

monorepo（`~/Code/trend-studio`）的生产插件应用。趋势交易课程**生产插件**：运行在教员本机 dsh 上，驱动"约 69 集录播视频（≈35h）→ 结构化图文课程 + 交互课件"的生产 Agent 编排。

- 与学员伴学插件 `dsh-plugin-trend-coach` 配对：本插件管**生产**（写草稿、上报溯源、接受审批），云端 `trend-coach-cloud` 管**门禁与存储**，学员插件管**消费**（只读已发布内容）。
- 生产 Agent 循环、Skill 工艺包与审批卡点在本插件；云端不内嵌 Agent，发布必须云端管理台人工触发。
- 契约真相源：`trend-coach-cloud` 需求 v0.9 C13/C14 / 对接清单 v0.8 §3.13（M9）、§3.14（M10）/ 架构 v0.10 §6.5、§6.6。

详见 [AGENTS.md](./AGENTS.md)。

## 装机（A9 装机向导）

教员本机装生产端只需要三步，**全程不碰配置文件**——机密只落 dsh 托管凭据库
（`~/.dsh/.credentials.yaml` 的 `refs`），profile 里只留引用名。

```bash
cd ~/Code/trend-studio/apps/producer

pnpm setup              # 全流程：装 profile → 换发令牌 → 自检
pnpm setup:install      # 只装：打包插件 → 写 profile + patch → 装依赖 → 写模型密钥
pnpm setup:login        # 只换发云端会话令牌（交互式账号密码）
pnpm setup:doctor       # 只自检
```

- **一个 profile、一个模型位**：`trend-producer` profile 里装 `base + headless + 本插件`
  三个 bundle；模型位是**单一** provider + **单一** model，agent 与理解阶段共用同一个密钥。
  （**不装 `dsh-web-app`**：该 bundle 在宿主层把 `skill-filesystem` / `tool-skill` 整行禁用，
  工艺包会静默不加载；且本 profile 用的是 headless 应用面。）
- **`install` 做什么**：打包插件 tarball → 写 `~/.dsh/profiles/trend-producer/package.json`
  （bundle 并集 + 插件依赖）→ `dsh plugin --profile trend-producer install` 装依赖 →
  写 `cordis.patch.yml`（五个托管条目：模型位 / agent 默认模型 / 生产端配置 / skills 活挂载 / 凭据开关；
  用户手加的条目原样保留，旧文件备份为 `.bak`）→ 交互式收模型 API key 写进凭据库。
- **`login` 做什么**：交互式收账号密码 → `POST /v1/auth/session` 换发令牌 → 写进凭据库
  （`TREND_PRODUCER_CONSOLE_TOKEN`）。
- **`doctor` 做什么**：八项独立自检，逐项报告、任一不过当场报：
  **凭据库权限**（文件只有所有者可读写——权限不对 dsh 拒绝加载，等于没装）、
  插件版本（装进 profile 的 == **安装包**的）、技能包挂载、**技能链路启用**（读 `dsh --dump-config`
  的组合配置，确认 `skill-filesystem` / `tool-skill` 没被禁）、模型位唯一、模型可达
  （真发一次最小生成请求）、云端可达（`GET /health`）、会话令牌有效且**角色是 producer**
  （角色不对会明确说「生产端需要 producer」）。

非交互环境（CI / 脚本）用 `--non-interactive`，密钥与账号密码分别从环境变量
`TREND_PRODUCER_MODEL_KEY` / `TREND_PRODUCER_USERNAME` / `TREND_PRODUCER_PASSWORD` 取。

装完后的日常入口：

```bash
dsh --profile trend-producer "用 ~/Movies/课程1.mp4 做第一节"
```

## 免仓库装机（教员）

教员**不必克隆本 monorepo**——从官网下载插件安装包（门户 `/teacher` 或 `/downloads`），
校验 sha256 → 解压 → 跑同一个装机脚本：

```bash
npm i -g @deepseek-ai/dsh@0.2.1-rc.5   # harness；版本必须精确匹配（或全程用 npx 兜底）
shasum -a 256 dsh-plugin-trend-producer-0.1.9.tgz   # 与页面给出的 sha256 比对
tar -xzf dsh-plugin-trend-producer-0.1.9.tgz
cd package && node scripts/setup.mjs     # 交互填云端地址/模型 id/base url/协议/模型 key → 换发令牌 → 八项自检
```

- **安装包自带九个工艺包**（`skills/`）、装机脚本与 bundle 依赖——`customSkillDirs` 指的是目录，
  不带 `skills/` 会静默丢掉全部工艺包。
- 免仓库模式下工艺包复制进 `~/.dsh/profiles/trend-producer/skills`，patch 指向该目录；
  安装包副本留在 `profile/artifacts/`，**重装不依赖「下载」目录**。
- `doctor` 的版本检查是「**与安装包一致**」（免仓库时取自解包出的 `package/package.json`）。
- 找不到安装包时脚本会报错并提示用 `--tarball` 指定路径——不猜路径。

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
2. 该账号换会话令牌：**走装机向导的 `pnpm setup:login`**（交互式收账号密码 → 换发 → 写进
   dsh 托管凭据库的 `TREND_PRODUCER_CONSOLE_TOKEN`）。插件按 credential-ref 引用
   （配置项 `consoleTokenRef`，默认 ref 名 `TREND_PRODUCER_CONSOLE_TOKEN`）。
   令牌只在请求头出现，不进日志/配置/代码。
3. 令牌过期就重新跑 `pnpm setup:login` 换发；换发不需要重建账号。

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
