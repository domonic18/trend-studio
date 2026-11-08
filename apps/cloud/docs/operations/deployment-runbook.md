# 部署 Runbook

版本：v0.7（2026-11-08）——发布路径改为 CI 驱动：镜像推 TCR、服务器只 pull、迁移独立一步、失败自动回滚

面向运维与开发：把云端服务部署到一台 Linux 主机，覆盖 TLS、数据库迁移、备份恢复、媒体 CDN、视频管线与本地 staging 验证。监控见 [监控与告警](./monitoring.md)，数据与合规基线见 [合规与公测检查清单](./compliance.md)。

## 1. 拓扑与前置条件

```
Internet ── Caddy(80/443, 自动 TLS) ── app(Fastify, 3939, 镜像内置 ffmpeg/ffprobe)
                                          ├── db(PostgreSQL 17 + pgvector)
                                          ├── workspace/postgres（数据库数据）
                                          ├── workspace/pipeline（挂载到 /data：源视频、工作区、HLS）
                                          ├── workspace/caddy（证书与配置）
                                          └── 媒体：生产走 CDN；仅本地 staging 由 workspace/media 挂载提供
Prometheus(可选) ── 抓取 app:/metrics（Bearer METRICS_TOKEN）
Grafana(可选) ── 查询 Prometheus
```

主机要求：

- Linux + Docker Engine 24+、Compose v2；2 vCPU / 4 GB 内存起步（启用转码建议 ≥4 vCPU）。
- 公网域名（A/AAAA 指向主机），放行 80/443；数据库与 3939 不对公网暴露。
- 生产媒体域名与对象存储/CDN 已就绪（见 §7）。
- 管线磁盘：按源视频与 HLS 预留容量，至少为单次最大上传（默认 2GiB）的 3–4 倍；`PIPELINE_STORAGE_DIR` 与 `PIPELINE_HLS_DIR` 必须同卷。
- 所有运行期持久化数据位于仓库根 `workspace/`（已 gitignore）：`postgres/`、`pipeline/`、`caddy/`、`media/`、`backups/`。整个目录可直接随主机迁移或备份；Linux 上 app 容器以 node（uid 1000）写入，先执行 `chown -R 1000:1000 workspace/pipeline workspace/media`。

## 2. 准备配置与密钥

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

至少填写：`APP_ENV`、`PUBLIC_BASE_URL`、`MEDIA_BASE_URL`、`DOMAIN`、`POSTGRES_USER/PASSWORD/DB`、`METRICS_TOKEN`、`MEDIA_SIGNING_SECRET`、`CREDENTIAL_ENCRYPTION_KEY`；首次部署另填 `BOOTSTRAP_ADMIN_USERNAME` 与 `BOOTSTRAP_ADMIN_PASSWORD`。启用管线还需 `PIPELINE_ENABLED=true`、`PIPELINE_STORAGE_DIR`、`PIPELINE_HLS_DIR`。ASR/内容 LLM/embedding 的连接与密钥在管理端「模型配置」页录入，不需要写环境变量。

```bash
openssl rand -hex 32   # METRICS_TOKEN
openssl rand -hex 32   # MEDIA_SIGNING_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # CREDENTIAL_ENCRYPTION_KEY
```

规则由 `src/config.ts` 强制，配置错误会阻止启动：

- 非 local 必须 HTTPS；production 的 `PUBLIC_BASE_URL`/`MEDIA_BASE_URL` 不允许本机地址。
- `METRICS_TOKEN`、`MEDIA_SIGNING_SECRET` 至少 16 字符，且不能是本地默认值。
- `BOOTSTRAP_ADMIN_USERNAME` 与 `BOOTSTRAP_ADMIN_PASSWORD` 必须成对配置；用户名匹配 `[a-z][a-z0-9._-]{2,31}`，密码至少 12 字符。首个管理员只在库中无 active admin 时创建，创建成功后应移除这两个变量并重启。
- `POSTGRES_PASSWORD` 含 `:/@?#[]%` 等字符时，`DATABASE_URL` 需要 URL 编码；建议直接用字母数字。
- 管线启用时必须能写 `PIPELINE_STORAGE_DIR` 与 `PIPELINE_HLS_DIR`，两目录解析后不同且同卷；设置 `MEDIA_LOCAL_DIR` 时 `PIPELINE_HLS_DIR` 必须与其相同，否则启动失败。启动会用 `ffmpeg -version` / `ffprobe -version` 探活，失败则启动失败。
- `CREDENTIAL_ENCRYPTION_KEY` 至少 32 字符，非 local 必填且不得使用本地默认值；更换后已存模型密钥无法解密，需在后台重新录入，旧值应保留在密钥管理以便回滚。
- ASR/内容 LLM/embedding 由后台「模型配置」维护；未配置或未启用不阻止服务启动，但对应阶段返回 `503`。

## 3. 发布路径与首次部署

发布只有一条路径：**CI 构建镜像 → 推 TCR → SSH 调用服务器上的 `deploy/deploy.sh`**。服务器只 pull 不构建；发布逻辑只有 `deploy/deploy.sh` 一份（可评审、可回溯），CI 不内联长命令。

```
PR ──► check（类型检查）──► test（单测+契约，pgvector 服务容器）
                            └──► build（构建镜像，推 TCR：<branch>-<sha7>，不推 latest）
merge main ──► Environment: production（人工审批）──► deploy-production
                                                 └─► 直传发布资产 ─► deploy.sh ─► 健康检查 ─► 落状态
```

镜像 tag 不可变（`<branch>-<sha7>`），回滚目标稳定；`latest` 不推。

### 3.0 GitHub 侧配置项（维护方式与 ai-invest 统一）

仓库为 public，真实值一律不入代码与 workflow YAML。**变量放非密配置，secret 放凭据**：

| 位置 | 名称 | 说明 |
|---|---|---|
| 仓库变量 | `DEPLOY_HOST` | 目标机（`user@host`） |
| 仓库变量 | `DEPLOY_PATH` | 部署目录（compose 与 `.env.prod` 所在） |
| 仓库 secret | `TCR_USERNAME` / `TCR_PASSWORD` | 推 TCR 用；服务器侧另存 `/root/.docker/config.json`，CI 不向服务器传密码 |
| 仓库 secret | `TCR_NAMESPACE` | 镜像命名空间；缺失则流水线明确失败 |
| 仓库 secret | `DEPLOY_SSH_KEY` / `DEPLOY_KNOWN_HOSTS` | 发布用免密私钥与主机指纹（开启 host key 校验） |
| Environment | `production` | 发布人工闸门，required reviewer |

流水线启动即校验以上配置，缺任何一项都在动服务器之前明确失败。

### 3.1 服务器基线（一次性）

```bash
# Docker Engine 24+ 与 Compose v2；国内机器走腾讯镜像加速
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://mirrors.tencent.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.tencent.com/docker-ce/linux/ubuntu jammy stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker

# /etc/docker/daemon.json：基础镜像走加速器，容器日志限量
{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"],
  "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } } | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker

# 内存小的机器加 swap（2C2G 机器必须）
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# TCR 凭据只放服务器侧，CI 不向服务器传 registry 密码
sudo mkdir -p /root/.docker && sudo chmod 600 /root/.docker/config.json   # 写入 ccr.ccs.tencentyun.com 的 auth
```

部署目录（`DEPLOY_PATH`，即 compose 文件所在目录，相当于仓库里的 `apps/cloud`）：

```bash
sudo mkdir -p /opt/trend-coach/workspace/{postgres,pipeline,caddy/data,caddy/config,media,backups} \
  /opt/trend-coach/dist/downloads /opt/trend-coach/content
sudo chown -R 1000:1000 /opt/trend-coach/workspace/pipeline /opt/trend-coach/workspace/media /opt/trend-coach/dist/downloads
```

`.env.prod` 放服务器上（600，属主给运维账号），内容见 §2。CI 只写 `IMAGE_TAG` 与 `TREND_IMAGE_REPO`（镜像 tag 与镜像仓库路径，都必须与本次推送目标一致），其余不动。

### 3.2 首次发布

合并到 `main` 后在 GitHub 的 `production` Environment 里审批放行，CI 自动完成发布。发布后核对：

```bash
cd /opt/trend-coach
cat .deploy-state                     # current_tag / previous_tag / commit / status
sudo docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl -fsS https://$DOMAIN/health      # {"ok":true}
```

要点：

- 发布资产（`deploy/deploy.sh`、`deploy/caddy/Caddyfile`、`scripts/backup.sh`、`docker-compose.prod.yml`）由 CI 直传，落地后逐项校验齐全——服务器到 GitHub 链路不稳，不依赖服务器自己拉代码。
- 迁移是独立一步，先于换容器执行（见 §5）；失败即中止，旧版本继续服务。
- `caddy` 等待 app healthy 后启动；首次签发证书需要域名可解析且 80/443 可达。域名未就绪时 `DOMAIN=localhost` 走 Caddy 本地 CA，访问加 `-k`。
- staging 可导入种子数据（生产走内容管线，不执行）：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T app \
  node --input-type=module -e "const {loadConfig}=await import('./dist/config.js'); const {createPool}=await import('./dist/db.js'); const {seedDatabase}=await import('./dist/seed.js'); const pool=createPool(loadConfig().databaseUrl); const seed=await seedDatabase(pool); await pool.end(); console.log('seeded', seed.segments.length)"
```

- 后台登录与账号创建（首个管理员来自 `BOOTSTRAP_ADMIN_*`）：

```bash
curl -fsS -X POST https://$DOMAIN/v1/auth/session \
  -H "content-type: application/json" \
  -d '{"username":"admin01","password":"<初始密码>"}'
# 返回 token；用 admin 会话创建学员账号，role 为 student/operator/admin：
curl -fsS -X POST https://$DOMAIN/v1/admin/users \
  -H "content-type: application/json" -H "authorization: Bearer $SESSION_TOKEN" \
  -d '{"username":"student01","displayName":"张三","role":"student","password":"<初始密码>"}'
```

- 学员设备授权：打开 `https://$DOMAIN/device?code=<USER-CODE>` 输入用户名与密码（首次可用邀请码设置密码）；运营人员也可用会话直接批准：

```bash
curl -fsS -X POST https://$DOMAIN/v1/auth/device/approve \
  -H "content-type: application/json" -H "authorization: Bearer $SESSION_TOKEN" \
  -d '{"userCode":"ABCD-EFGH"}'
```

- 内容管理控制台：浏览器打开 `https://$DOMAIN/admin/`，用 operator/admin 账号登录，管理课程、章节、知识点、文章与片段。镜像构建已包含 `web/admin` 并输出到 `dist/admin`；服务端只在 `dist/admin/index.html` 存在时挂载 `/admin/`，缺失时该路径 404 而 API 不受影响。前端是纯静态 SPA，会话令牌存 `sessionStorage`，关标签即失效，不使用 Cookie，因此 `/admin/` 反向代理无需额外鉴权配置（接口本身仍校验 Bearer）。
- 公开门户：浏览器打开 `https://$DOMAIN/`。镜像构建同时输出预渲染门户 `dist/portal`（含 `routes.json`、`sitemap.xml`、`robots.txt`），服务端按精确路由托管，未知前端路径回落 SPA 壳；`/v1/*` 未命中仍为 JSON 404。门户注册/登录/个人中心会话同样存 `sessionStorage`。发布插件包时把 tgz 放入 `dist/downloads/`（已挂进容器），并更新 `content/releases.json` 的版本、文件名、SHA-256、大小与说明；两者都在宿主目录，发布后即刻生效、无需重建镜像或重启服务；下载由服务端以 `attachment` 提供。
- 视频建课：「视频建课」页创建 draft 课程与素材 → 上传 → 处理 → 查看转写 → 生成 → 预览 → 应用到草稿 → 发布。发布前会按配置重建索引；索引失败返回 `503` 且课程保持 draft。源视频默认保留在 `workspace/pipeline/storage/sources/`，清理策略未冻结前不要手工删除 `sources/`。

## 4. TLS

Caddy 为 `$DOMAIN` 自动申请与续期证书（Let's Encrypt / ZeroSSL）。不使用 Nginx 或宿主机证书。

- 验证：`curl -vI https://$DOMAIN/health`，证书签发者应为公信 CA。
- 域名未就绪的临时环境：将 `DOMAIN` 设为 `localhost` 使用 Caddy 本地 CA，访问时加 `-k`。
- 证书与私钥保存在 `caddy_data` volume；删除该 volume 会触发重新签发，注意 Let's Encrypt 速率限制。

## 5. 迁移

- 迁移是发布的独立一步，不在 app 启动时自动执行：`compose run --rm --no-deps --pull never -T migrate`，与应用同一个镜像——线上执行的迁移必然与本次发布的代码同 commit。
- 多实例并发时由 PostgreSQL advisory lock 串行化；迁移只向前，不自动回滚。
- 本地开发仍是启动即迁移（`MIGRATE_ON_START=true`，默认值）；生产 compose 置 `false`。
- 新增迁移：只追加文件、不改已执行文件；在一个事务内执行。
- 需要回退时按 §6 恢复备份，再部署对应版本镜像；不要手写逆向 SQL。

## 6. 备份与恢复

备份（默认保留 14 天，输出到 `workspace/backups/`）：

```bash
scripts/backup.sh
# 可覆盖：ENV_FILE、BACKUP_DIR、BACKUP_RETENTION_DAYS
```

建议 cron（每天 03:17，并把 `workspace/backups/` 同步到异机/对象存储）：

```cron
17 3 * * * cd /srv/trend-coach-cloud && ./scripts/backup.sh >> /var/log/trend-coach-backup.log 2>&1
```

恢复（会停 app、覆盖数据库，需显式确认）：

```bash
RESTORE_CONFIRM=yes scripts/restore.sh workspace/backups/trend-coach-20261031T031700Z.sql.gz
```

演练：至少每季度在 staging 恢复一次，并跑一次设备授权 + 检索 + 播放冒烟。

非破坏性恢复演练（推荐每次备份后抽查，不停 app、不覆盖业务库）：

```bash
# 默认取 workspace/backups 下最新备份，导入 trend_coach_restore_drill 后校验核心表并删除
scripts/restore-drill.sh
# 指定备份；DRILL_KEEP=1 保留演练库供排查
DRILL_KEEP=1 scripts/restore-drill.sh workspace/backups/trend-coach-20261031T031700Z.sql.gz
```

脚本会启动 db（若未运行）、重建演练库、导入备份，并校验迁移数、用户、课程、章节、知识点与片段可查询；任一步失败返回非零。

## 7. 媒体、CORS 与 Range

生产不在业务进程代理媒体：`MEDIA_BASE_URL` 指向 CDN 根，播放地址为 `MEDIA_BASE_URL + hlsPath?token=...`。

管线产出的 HLS 写入 `PIPELINE_HLS_DIR/hls/<assetId>/`，CDN 需把 `MEDIA_BASE_URL` 根映射到 `PIPELINE_HLS_DIR`（或同步该目录到对象存储）。`media_assets.hls_path` 形如 `hls/<assetId>/index.m3u8`，签名只覆盖该素材目录；源视频位于 `PIPELINE_STORAGE_DIR/sources/`，不得对 CDN 暴露。

CDN/对象存储必须满足：

| 要求 | 说明 |
|---|---|
| 保留查询串 | 播放与密钥请求都带 `?token=`；CDN 不得丢弃查询串 |
| CORS | `GET`/`HEAD` 返回 `access-control-allow-origin: *`（与 app 的 CORS 策略一致） |
| Range | MP4 等大文件返回 `206` 与 `accept-ranges: bytes`，否则播放器无法定位 |
| 缓存 | `index.m3u8` 与 `*.key` 不缓存或极短缓存；分片可长缓存 |
| 防盗链 | token 是短时能力 URL，建议 CDN 侧同时开启 Referer/签名校验；token 由 app 签发，有效期取 `PLAYBACK_SESSION_TTL_SECONDS` |

验收：

```bash
curl -sI https://media.example.com/hls/index.m3u8 -H 'Origin: https://example.com' | grep -i 'access-control-allow-origin'
curl -sI https://media.example.com/hls/seg0.ts -H 'Range: bytes=0-99' | grep -iE 'HTTP/|content-range|accept-ranges'
```

仅本地 staging 验证时，默认把 `workspace/media` 挂载到容器 `/media`（可用 `MEDIA_HOST_DIR` 覆盖）并设 `MEDIA_LOCAL_DIR=/media`，同时把 `MEDIA_BASE_URL` 设为 `https://$DOMAIN/media`；此时 Range、CORS 与令牌校验由 app 负责。

## 8. 健康检查与观测

- `GET /health`：检查数据库连通性；失败返回 503。Docker healthcheck 与负载均衡都用它。
- `GET /metrics`：Prometheus 指标，需 `Authorization: Bearer $METRICS_TOKEN`。该端点不属于对外契约，不写入 OpenAPI。
- 日志为 JSON 到 stdout，可由 `docker compose logs -f app` 或主机日志驱动采集；token、设备 ID 已脱敏。

监控不随 Compose 部署；`/metrics` 保留，接入外部 Prometheus 见 [监控与告警](./monitoring.md)。

发布前后用无依赖脚本做一次基线压测（详见 [监控与告警 §5](./monitoring.md#5-压测基线)）：

```bash
npm run loadtest -- --base-url https://$DOMAIN --path /health --concurrency 20 --duration 20
```

超限返回 `429` 且带 `Retry-After: 60`；压测账号应单独准备或临时调高对应 `RATE_LIMIT_*`，避免把限流命中误判为容量问题。

## 9. 发布与回滚

发布入口只有 `deploy/deploy.sh`（CI 与人工都只调它，禁止手写 `docker compose up` 发布）：

```bash
# 生产：CI 经 SSH 调用，--tag 必须是 main-<sha>
sudo bash deploy/deploy.sh --env prod --tag main-<sha7> \
  --image-repo ccr.ccs.tencentyun.com/<namespace>/trend-cloud
```

流程：预检（docker/compose/磁盘/db 健康）→ 轮转 `.env.prod` 备份并钉 `IMAGE_TAG` 与 `TREND_IMAGE_REPO` → 拉镜像 → 发布前数据库备份 → 迁移 → 换容器 → 健康检查 → 落 `.deploy-state` → 清理旧镜像与备份。

- **`--image-repo` 与 CI 推送目标同源**：CI 传 `--image-repo "$TCR_REGISTRY/$TCR_NAMESPACE/$IMAGE_NAME"`，脚本把它钉进 `.env.prod` 的 `TREND_IMAGE_REPO`（compose 的 image 引用据此拼接）。这样「CI 推的仓库」与「服务器拉的仓库」只有一个真相源，namespace 变更不会推 A 仓拉 B 仓。人工发布时必须带上该参数，否则沿用 `.env.prod` 里已钉的值。
- **CI 前置校验**：仓库变量 `TCR_NAMESPACE` 与 secret `DEPLOY_HOST`/`DEPLOY_PATH`/`DEPLOY_SSH_KEY`/`DEPLOY_KNOWN_HOSTS` 任一缺失，流水线在动服务器之前就明确失败，不带着半套配置继续发布。YAML 里只留公有常量（registry 域名、镜像仓库名），不留个人命名空间兜底。

- **失败自动回滚**：换容器或健康检查失败 → 自动退回 `previous_tag` 重新拉起并复查，状态记 `FAILED_ROLLED_BACK`，现场保留（日志不删）。迁移失败则在换容器之前中止，旧版本继续服务。
- 回滚状态与依据都在 `/opt/trend-coach/.deploy-state`（`current_tag`/`previous_tag`/`commit`/`image_repo`/`status`）。
- 镜像保留最新 3 个 `main-<sha>`（当前 + 2 个回滚目标），只清悬空层，**不用 `docker image prune -a`**（会连回滚目标一起删）。
- 发布前：`check` 与 `test` 全绿、`scripts/restore-drill.sh` 验证备份可导入。
- 发布后：`/health`、一次设备授权/刷新、一次检索、一次播放会话、打开 `/admin/` 完成一次登录与内容读写，检查 5xx 与 P95。
- 迁移已改变数据时，仅回滚镜像可能不兼容；优先前滚修复，否则按 §6 恢复。
- **构建上下文是 monorepo 根目录**：镜像用 pnpm 装依赖（`workspace:*` 无法用 npm 解析），compose 里 `build.context` 指向仓库根、`dockerfile` 指向 `apps/cloud/Dockerfile`；命令仍在 `apps/cloud` 目录执行。生产不走 `build` 这条路——镜像由 CI 构建并推 TCR，服务器只 pull（deploy.sh 带 `--no-build --pull never`）。
- **发布插件包不必重建镜像**：宿主 `dist/downloads/` 与 `content/` 已挂进容器，发布脚本写宿主这份即可——制品立刻可下、清单立刻生效（清单每次请求现读），无需重启服务。

## 10. 本地 staging 验证

用同一份 compose 在开发机走一遍 staging 配置（不依赖公网 DNS）：

`.env.prod` 关键项：

```dotenv
APP_ENV=staging
PUBLIC_BASE_URL=https://localhost
MEDIA_BASE_URL=https://localhost/media
DOMAIN=localhost
# 默认即 ./workspace/media；要复用插件样片可覆盖为 ../../coach/spike/media
MEDIA_HOST_DIR=./workspace/media
MEDIA_LOCAL_DIR=/media
PIPELINE_ENABLED=true
# 两目录必须在同一个 /media 挂载点内，HLS 才能原子 rename
PIPELINE_STORAGE_DIR=/media/pipeline
PIPELINE_HLS_DIR=/media
```

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
curl -kfsS https://localhost/health
# 设备码 → 账号密码批准 → 换 token → 检索 → 播放会话
```

验证通过后即可把同一 Compose 指向真实域名与 CDN；两者差异只在 `.env.prod`。

**本机快速路径**（开发机自测，不碰 Caddy 与公网域名）：

```bash
# 应用跑在容器里，数据库复用宿主上已有的 trend-cloud-db-5434 容器
docker compose -f docker-compose.local.yml up -d --build
curl -fsS http://127.0.0.1:3939/health
```

`docker-compose.local.yml` 只起 app：读 `apps/cloud/.env`，把 `DATABASE_URL` 指向
`host.docker.internal:5434`（容器内 127.0.0.1 是容器自身），发布 3939 端口，
并把 `workspace/pipeline`、`workspace/media`、`dist/downloads`、`content` 挂进容器。

**`MEDIA_LOCAL_DIR` 必须设**（compose 已设 `/data/hls`，须与 `PIPELINE_HLS_DIR` 相同）：不设时
业务进程不注册 `/media/*` 路由（生产走 CDN 才可不设），于是生产端拿到的关键帧签名 URL 全部 404，
VLM 无帧可用——表现为「读证据没有画面」，而不是报错。

> 排查提示：本机 `127.0.0.1:3939` 若被**宿主上的开发进程**（`tsx src/index.ts`）占着，容器虽在跑，
> 实际应答的是那个旧进程；`lsof -nP -iTCP:3939 -sTCP:LISTEN` 一看便知。

## 11. 视频管线运维

**启用检查**

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec app ffmpeg -version
docker compose --env-file .env.prod -f docker-compose.prod.yml exec app ffprobe -version
curl -fsS -H "Authorization: Bearer $SESSION_TOKEN" \
  "https://$DOMAIN/v1/admin/content/pipeline/jobs?status=failed"
```

- 管线关闭时素材/上传/转写/生成/任务接口返回 `503`，其余 API 正常。
- 任务状态在 `pipeline_jobs`；心跳超 120s 的 running 任务会被自动回收。频繁回收通常是 ffmpeg 超时、磁盘满或进程被 OOM kill。
- 失败任务先看 `errorCode`；ffmpeg stderr 与 provider 响应只在内部日志（已脱敏），不返回客户端。

**真实密钥验收**

1. 以 admin 登录后台「模型配置」：录入 ASR（启用）与 content LLM，按需录入 embedding；先点「测试连接」确认成功（保存即生效，无需重启）。
2. 上传 2–5 分钟中文样片，确认转写 `ready` 且时间戳单调；核对 `transcript_segments` 条数与音频时长。
3. 生成草稿，检查章节/知识点/待审原因与文章 Markdown；apply 后课程树为 draft。
4. 发布后确认 catalog、检索与签名播放可见；检查 `embedded` 与索引状态。
5. 再用 30–60 分钟样本验证静音切块、块级缓存与 ASR 请求数（成功块重试不应重复计费）。
6. 抽查日志：无 token、完整 deviceId、完整 query、转写正文、源路径、完整媒体 URL、provider 响应体。

**实测记录（2026-11-01，本地 127.0.0.1:3939）**

样片为 33 分 09 秒中文课程视频（210 MB，H.264/AAC），ASR 为 MiniMax，content LLM 为 `MiniMax-M3.1-Flash`（anthropic 协议），embedding 为智谱 `embedding-3`（`dimensions: 1024`）。

| 环节 | 结果 |
|---|---|
| 上传 + 探测 | 流式 PUT 成功，ffprobe 时长 1,988,926ms |
| ingest | 161s，5 个静音切块，49 条 `transcript_segments`，时间戳单调 |
| generate | ~297s，21 章节 / 30 知识点 / 30 片段，`needsReview=0` |
| apply | 写入 draft 章节/知识点/文章/片段，映射数一致 |
| publish | 首次发布 `indexed=false`（未配置 embedding）；录入 embedding 后重发布 `indexed=true`、`embedded=30` |
| 学员侧 | 设备码授权后 catalog 可见该课程（21 章节 / 30 知识点），知识点文章正文可读 |
| 检索 | 混合召回 5 条，语义查询（如「行情一旦形成会持续多久」）命中趋势方向/能量片段 |
| 播放 | `POST /v1/playback/sessions` 返回带 token 的 playlist，拉取 200、223 个分片、含 `#EXT-X-ENDLIST` |

**生成质量对比（`m1-v1` → `m1-v2`，同一样片）**

| 指标 | m1-v1 | m1-v2 |
|---|---|---|
| 章节数 | 21（1 个 0 知识点空章） | 8（无空章） |
| 知识点 / 片段 | 30 / 30 | 28 / 28 |
| 文章字数 | 89–432，中位数 202，14 篇 <200 | 381–692，中位数 511，0 篇 <200 |
| 待审数 | 0 | 0 |

`m1-v2` 改为先出全局章节大纲再按窗口提取知识点，并对重复知识点、空章节做兜底；文章生成向时间窗前后各取 60s 上下文。第二门课程 `TC-M1-VERIFY-48` 全链路通过，发布 `indexed=true`、`embedded=28`。

遗留问题：

- 智谱 `embedding-2` 返回 429「余额不足或无可用资源包」，`embedding-3` 可用；换供应商时先点「测试连接」确认 1024 维。
- 同一 30s 转写分组内提取的不同知识点共享同一播放区间（引用会指向同一段音频）；如需更细定位，应将转写分组从 30s 改为句级。

**容量与清理**

- `sources/<assetId>/source` 默认保留；`work/<assetId>/` 成功或失败后清理。
- 磁盘告警阈值建议 ≤75%；不要手工删除 `sources/`，除非已确认版权与重试需求。
- `PIPELINE_MAX_CONCURRENT_JOBS` 默认 1；提高前先评估 CPU 与内存，转码阻塞会影响 API 延迟。
- 管线数据默认落在 `workspace/pipeline/`，compose 将其整体挂到 `/data`（`storage/` 与 `hls/` 同挂载点，HLS 才能原子 rename）。镜像预建 `/data/storage`、`/data/hls` 并归属 `node`（uid 1000）；bind mount 不会继承该属主，Linux 上需先 `chown -R 1000:1000 workspace/pipeline`。
- `workspace/postgres` 与 `workspace/caddy` 同样以 bind mount 持久化；不要把手写文件放进 `workspace/`，该目录整体不入库。
