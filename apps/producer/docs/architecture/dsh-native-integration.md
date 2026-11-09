# 教员端 dsh 原生集成（登录 / 密钥 / 命令 / 看板）

版本：v1.1（2026-11-09）
状态：批次 1 代码与测试已完成（插件 126/126、云端契约全绿），待本地端到端验证后验收。本文是教员端「与 dsh 融为一体」的单一真相源；与云端架构文档的设备码章节联动。

## 1. 背景与目标

现行装机向导在安装时连问四类问题（模型 id / base url / 协议 / API 密钥，再问云端账号密码），教员反馈「让人很懵」。目标形态：

- **装机零交互**：一行命令装完，不问任何问题；
- **登录后置**：打开 dsh 后首次使用时登录，登录界面是云端浏览器授权页，由插件自动拉起；
- **模型密钥后置**：在 dsh 设置页粘贴，热生效；
- **产品一体化**（批次 2）：生产看板长进 dsh Web 右侧栏，对话在左、工作台在右。

## 2. dsh 扩展点判据（0.2.1-rc.5 实测）

| 机制 | 接口 | 实测结论 |
|---|---|---|
| 授权流 | `ctx.authorization.registerFlow(flow)`；`run(session)` 内 `session.notify({message,url,code})` / `session.prompt({kind:'text'\|'secret'\|'select'})` / `session.commit(record)` | 存在；`dsh-llm-pi-ai` 内置先例（各 provider 登录流）。**rc.5 的 Web 设置页尚无通用「授权列表」界面**——流必须自带浏览器拉起，未来 dsh 更新后原生界面自动点亮 |
| 凭据双键空间 | ref（`CredentialRef`，env 名，`ctx.credentials.resolve/describe`）与 record（`CredentialKey` = `<scope>/<id>`，`readRecord/modifyRecord`） | 存在；**coach 插件已用 `kind:'grant'` record 存设备授权**（`apps/coach/src/auth.ts`），模式有先例。ref 按操作热解析——改完即生效，无需重启 |
| 插件命令 | `ctx.commands.register(definition)`：`name` + `handler(invocation)`，直接执行不经模型 | 存在；`CommandResult` 一次性返回文本 |
| 右侧栏 tab | `ctx.sidebarRightTabs.register({id,kind,patterns,...})` + `sidebar.right.pane.tab` slot | 存在（批次 2 用） |
| 模型密钥 | `llm-pi-ai` provider 条目 `apiKeyEnv` 指向 ref；设置页模型区列出 ref 并可写入 | 实测 rc.5 设置模型页消费 `apiKeyEnv` + credential ref 的 describe/set |

## 3. 目标体验

```
curl -fsSL <站点>/install-producer.sh | bash        # 零提问装完
dsh --profile trend-producer                         # 打开 harness（Web/桌面）
/trend login                                          # 插件命令
  → 浏览器自动打开 https://<站点>/device?code=XXXX    # 登录界面（云端授权页）
  → 教员输入账号密码 → 批准
  → 令牌自动落凭据记录，立即生效                      # 无需重启会话
dsh 设置 → 模型 → 粘贴 MiniMax API Key                # TREND_PRODUCER_MODEL_KEY ref，热生效
「用 ~/Movies/课程1.mp4 做第一节」                     # 正常生产
```

## 4. 设计

### 4.1 云端：设备码 `scope=console` 变体

学员设备码流程签发的是 tokens 表设备令牌；教员端 API（`/v1/admin/content/*`）认的是 sessions 表 console 会话。为设备码流程加第二个 scope：

- `device_codes` 表加 `scope` 列（`'student'` 默认 / `'console'`），幂等迁移。
- `startDeviceCode(deviceId, clientId)`：`clientId='dsh-plugin-trend-producer'` → scope `'console'`；学员 client 保持原语义（响应形状不变，coach 兼容）。
- `approveDeviceCode`：console scope 校验批准者角色 ∈ {operator, admin, producer}（学员拒），且不写 devices 绑定（console 会话与设备无关）。
- `pollDeviceToken`：console scope 批准后签发 **console 会话**（sessions 表，`scope='console'`，TTL 同 `SESSION_TTL_SECONDS`），响应形状 `{ status:'authorized', session:{ token, expiresAt, user } }`；student 响应保持 `{ status:'authorized', grant:{...} }` 原样。
- `/device` 授权页按 user_code 反查 scope：console 时标题文案改「教员端授权」（仅教员角色账号可批准）。

### 4.2 插件：授权流

`src/host/authorization.ts` 注册一条流：

- key：`credentialKey('trend-producer', 'console')`；label「趋势云端 · 教员账号」；method `browser`（浏览器登录）。
- `run()`：`POST /v1/auth/device/code`（clientId=producer，deviceId 每次随机，无需持久化）→ `session.notify({message, url, code})` 并**宿主侧拉起浏览器**（darwin `open` / Linux `xdg-open`，失败只记日志——远程无桌面时教员仍可从通知里的 URL 手动打开）→ 按 `interval` 轮询 `/v1/auth/device/token`，signal 撤销 / 过期即抛错 → `session.commit({ kind:'grant', payload:{ token, expiresAt, user } })`。

### 4.3 插件：令牌解析与降级

`src/host/auth.ts` 解析顺序：

1. 凭据记录 `trend-producer/console`（payload 含 `token`/`expiresAt`；过期视同缺失）；
2. 兜底 legacy ref `TREND_PRODUCER_CONSOLE_TOKEN`（既有装机向导写的 env 引用，保持可用）。

缺失 / 失效的报错文案统一引导：「在 dsh 里运行 `/trend login` 重新登录」。

### 4.4 插件：`/trend` 命令

`src/host/commands.ts` 注册单条 `trend` 命令，`rawInput` 分发子命令：

- `/trend login`：`ctx.authorization.begin({key, interaction})`，交互仅日志兜底（浏览器已自开）；阻塞至授权完成（设备码 TTL 内），返回结果文本。
- `/trend status`：云端可达性（`GET /health`）+ 登录态（`readRecord` 读 console 记录本体并判新鲜度：未登录 / 用户名（角色）+ 剩余时长 / 已过期，较设计稿的 describeRecord 更直接——describe 拿不到过期时刻，无法区分「已过期」与「未登录」）+ 模型 ref 是否已配置（`ctx.credentials.describe`）。

### 4.5 插件：装机零交互

- `setup.mjs all` = install + doctor：模型参数全部走默认值（`--model-*` 开关仍可覆盖），**不再询问**密钥与账号密码，不再调 login。
- `login` 子命令保留但改为引导输出（「在 dsh 对话里运行 /trend login」），终端口子收敛到一处。
- doctor 增列：console 凭据记录状态、模型 ref 状态。
- 装机脚本结尾提示更新为「打开 dsh → /trend login → 设置页粘模型密钥」。

### 4.6 模型密钥：不做授权流

会话模型（llm-pi-ai provider `apiKeyEnv`）与插件理解模型共用同一个 ref（`TREND_PRODUCER_MODEL_KEY`）——单一真相源在 dsh 凭据设置；若为它再造一条 record 流会形成第二真相。教员动线：dsh 设置 → 模型 → 粘贴密钥（热生效）。

## 5. 批次划分

| 批次 | 内容 | 状态 |
|---|---|---|
| 1 | 云端 console 设备码 + 插件授权流/命令/令牌解析/零交互装机 + 测试 | 代码与测试完成（待端到端验证） |
| 2 | 右侧栏生产看板 tab（插件 client 模块打包、host→云端取数） | 待批次 1 验收后 |

## 6. 风险与明确不做

- **rc.5 无通用授权界面**：靠浏览器自开 + 命令文本结果；dsh 后续版本若提供原生授权列表页，已注册的流自动出现。
- **授权流刷新即作废**（seam 限制：一次尝试只存活于发起进程）：重试成本低，接受。
- **console 会话 12h TTL**：过期重登（`/trend login`），不做自动轮换。
- **不做模型密钥流**：见 §4.6。
- **不做登出流**：seam 无吊销语义；删记录走凭据管理（后续需要再加）。
