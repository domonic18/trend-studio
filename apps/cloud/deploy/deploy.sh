#!/usr/bin/env bash
# ============================================================
# 生产部署脚本 —— CI/CD 的唯一部署入口
#
# 用法：
#   sudo bash deploy/deploy.sh --env prod --tag main-<sha>
#
# 流程：参数校验 → 预检 → .env.prod 备份轮转 + 钉 IMAGE_TAG → 数据库备份（前置）→
#       拉镜像 → 数据库迁移（先行）→ 换容器 → 健康检查 → 落 .deploy-state →
#       失败自动回滚 → 镜像/备份清理
#
# 设计约束（详见 docs/operations/deployment-runbook.md）：
#   - 部署逻辑只有这一份，可评审、可回溯；CI 不内联长命令
#   - 迁移先行：迁移失败则旧版本继续服务，零影响
#   - 迁移与应用同一个镜像（镜像内含 migrations/）：线上执行的迁移必然与本次发布的代码同 commit
#   - 失败自动回滚到上一个 tag，回滚保留现场（日志不删）
#   - 镜像按仓库保留最新 N 个（当前 + N-1 个回滚目标）；
#     只清悬空层，绝不用 docker image prune -a（会删掉回滚目标）
#
# 依赖：docker + docker compose v2；生产机需 root（docker 组权限不足）
# ============================================================
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

ENV_NAME=""
IMAGE_TAG=""
KEEP_IMAGES="${DEPLOY_KEEP_IMAGES:-3}"
DISK_MIN_FREE_GB="${DEPLOY_DISK_MIN_FREE_GB:-5}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-300}"
ENV_FILE=".env.prod"
STATE_FILE="$APP_ROOT/.deploy-state"
COMMIT_FILE="$APP_ROOT/.deploy-commit"
LOG_DIR="$APP_ROOT/.deploy"
# 应用镜像服务（app 与 migrate 共用一个镜像，pull 一次即可）
APP_SERVICES="app migrate"
# 基础镜像服务：版本固定、服务器上长期存在，拉取失败可容忍（本地已有副本）
BASE_SERVICES="db caddy"

log()  { printf '[deploy %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { printf '[deploy %s] WARN: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
fail() { printf '[deploy %s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
用法: bash deploy/deploy.sh --env prod --tag main-<sha>

  --env   prod（生产）。staging 尚未接线，暂不支持。
  --tag   期望 main-<sha>（短 sha 或完整 sha）
EOF
}

# ---------------------------------------------------------------- 参数解析

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --env) ENV_NAME="${2:-}"; shift 2 ;;
            --tag) IMAGE_TAG="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) fail "未知参数：$1（-h 看用法）" ;;
        esac
    done
    [ -n "$ENV_NAME" ] || { usage >&2; fail "缺少 --env"; }
    [ -n "$IMAGE_TAG" ] || { usage >&2; fail "缺少 --tag"; }
}

validate() {
    [ "$ENV_NAME" = "prod" ] || fail "--env 目前只支持 prod（staging 环境未接线），收到：$ENV_NAME"
    # tag 同时是镜像引用的一部分，只放行白名单正则，杜绝注入与误传 latest
    local tag_re='^main-[0-9a-f]{7,40}$'
    echo "$IMAGE_TAG" | grep -Eq "$tag_re" \
        || fail "非法镜像 tag：${IMAGE_TAG}（要求匹配 ${tag_re}）"
}

compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }

# ---------------------------------------------------------------- 小工具

stat_owner() {
    stat -c '%u:%g' "$1" 2>/dev/null || stat -f '%u:%g' "$1" 2>/dev/null || echo ""
}

env_get() {
    # 读 .env.prod 的某个键（不做 shell 求值，避免值里的 ${VAR} 被提前展开）
    local key="$1" default="${2:-}" val
    val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$val" ]; then printf '%s' "$val"; else printf '%s' "$default"; fi
}

rotate_env_backup() {
    # .env.prod → .env.prod.bak → .env.prod.bak.1 → .env.prod.bak.2（最多 3 份）
    rm -f .env.prod.bak.2
    [ -f .env.prod.bak.1 ] && mv .env.prod.bak.1 .env.prod.bak.2 || true
    [ -f .env.prod.bak ] && mv .env.prod.bak .env.prod.bak.1 || true
    cp "$ENV_FILE" .env.prod.bak
}

set_env_var() {
    local key="$1" val="$2" tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/deploy-env.XXXXXX")"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        awk -v k="$key" -v v="$val" '
            $0 ~ "^"k"=" { print k"="v; next }
            { print }
        ' "$ENV_FILE" > "$tmp"
    else
        cat "$ENV_FILE" > "$tmp"
        printf '%s=%s\n' "$key" "$val" >> "$tmp"
    fi
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
}

restore_owner() {
    # 生产机以 root 执行本脚本，.env.prod 属主须还原给运维账号
    local owner="$1"
    [ -n "$owner" ] || return 0
    chown "$owner" "$ENV_FILE" .env.prod.bak .env.prod.bak.1 .env.prod.bak.2 2>/dev/null || true
}

restore_prev_tag() {
    # 失败发生在换容器之前：把 IMAGE_TAG 退回上一个版本，保持配置与实际运行版本一致
    local prev="$1" owner="$2"
    set_env_var IMAGE_TAG "$prev"
    restore_owner "$owner"
    warn "IMAGE_TAG 已退回 ${prev:-（空）}"
}

# ---------------------------------------------------------------- 预检

preflight() {
    command -v docker >/dev/null 2>&1 || fail "docker 不存在"
    docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用（需 compose plugin）"
    docker info >/dev/null 2>&1 || fail "无权访问 docker daemon（生产机请用 sudo 执行本脚本）"

    [ -f docker-compose.prod.yml ] || fail "缺少 compose 文件：docker-compose.prod.yml"
    [ -f "$ENV_FILE" ] || fail "缺少 $ENV_FILE（部署前须先准备）"
    # 迁移服务必须存在：没有它就没有独立的迁移步骤
    # grep 不带 -q：-q 命中即退出会让上游吃 SIGPIPE，pipefail 下误判为失败
    compose --profile migrate config --services 2>/dev/null | grep -x migrate >/dev/null \
        || fail "compose 未定义 migrate 服务（迁移独立执行要求该服务存在）"

    # 磁盘余量：workspace（数据库 + 管线 + 证书）所在卷才是真正会涨的地方
    local free_gb disk_path="$APP_ROOT"
    free_gb="$(df -Pk "$disk_path" | awk 'NR==2 {printf "%d", $4/1048576}')"
    if [ "${free_gb:-0}" -lt "$DISK_MIN_FREE_GB" ]; then
        fail "磁盘剩余 ${free_gb}G < 阈值 ${DISK_MIN_FREE_GB}G（${disk_path}），先清理磁盘"
    fi
    log "预检通过：磁盘剩余 ${free_gb}G（${disk_path}）"

    local db_id db_health
    db_id="$(compose ps -q db 2>/dev/null || true)"
    [ -n "$db_id" ] || fail "db 容器未运行（先执行 compose up -d db --wait）"
    db_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_id")"
    [ "$db_health" = "healthy" ] || [ "$db_health" = "running" ] \
        || fail "db 未就绪：$db_health"
}

# ---------------------------------------------------------------- 备份

run_backup() {
    # 发布前备份：迁移 forward-only 且不做自动回滚，schema 变更不可逆，
    # 没有这份备份就没有退路。备份失败即中止发布（旧版本继续服务）。
    if [ "${DEPLOY_SKIP_BACKUP:-0}" = "1" ]; then
        warn "DEPLOY_SKIP_BACKUP=1，跳过发布前备份"
        return 0
    fi
    [ -x scripts/backup.sh ] || { warn "缺少 scripts/backup.sh，无法执行发布前备份"; return 1; }
    log "执行发布前数据库备份"
    if ! ENV_FILE="$ENV_FILE" COMPOSE_FILE=docker-compose.prod.yml bash scripts/backup.sh; then
        warn "发布前备份失败"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------- 迁移

run_migrations() {
    # 迁移与应用同一个镜像：镜像内的迁移文件与本次发布的代码同 commit。
    # --no-deps：db 已在跑（预检已确认健康），不让 compose 再动它
    # --pull never：镜像已在 pull 阶段拉好，现场绝不联网拉取
    # -T：非交互（CI / SSH）下不分配 TTY
    log "执行数据库迁移（与应用同镜像，先行，失败即中止，旧版本继续服务）"
    compose run --rm --no-deps --pull never -T migrate
}

# ---------------------------------------------------------------- 镜像拉取

# 镜像仓库前缀（如 ccr.ccs.tencentyun.com/domonic18）从 compose 推导，
# 避免脚本里再写一份镜像地址。
# 注意：config --images 的输出顺序是散列序，不能取第一行——第一行可能是
#       caddy:2-alpine 这类三方镜像，推出来的前缀就错了。
#       只认「registry/namespace/repo」三段式，本项目自有镜像才符合。
image_prefix() {
    { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml config --images 2>/dev/null \
        | grep -E '^[^/]+/[^/]+/[^/]+:' | sed -n '1p' | sed -E 's|/[^/]+:[^/:]+$||' || true; }
}

pull_images() {
    # sha 短 tag 不可变：拉取失败但本地已有同 tag 镜像时继续走（回滚场景下仓库不可达）
    local svc prefix repo failed=""
    prefix="$(image_prefix)"
    repo="${prefix##*/}"
    for svc in $APP_SERVICES; do
        if compose pull "$svc"; then
            continue
        fi
        if [ -n "$repo" ] && docker image inspect "$prefix/$repo:$IMAGE_TAG" >/dev/null 2>&1; then
            warn "$svc 拉取失败，本地已有 $prefix/$repo:${IMAGE_TAG}，继续"
        else
            failed="$failed $svc"
        fi
    done
    [ -z "$failed" ] || { warn "镜像拉取失败且本地无对应镜像：$failed"; return 1; }

    # 基础镜像：版本固定、服务器上长期存在，拉不动就靠本地副本
    for svc in $BASE_SERVICES; do
        compose pull "$svc" >/dev/null 2>&1 || warn "$svc 基础镜像拉取失败，沿用服务器本地副本"
    done
    return 0
}

# ---------------------------------------------------------------- 健康检查

wait_healthy() {
    local timeout="$1" deadline bad name running health
    deadline=$(( $(date +%s) + timeout ))
    while :; do
        bad=""
        for cid in $(compose ps -q --all 2>/dev/null); do
            name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')"
            running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo unknown)"
            health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"
            if [ "$running" != "true" ]; then
                bad="$bad ${name}(running=$running)"
            elif [ "$health" != "none" ] && [ "$health" != "healthy" ]; then
                bad="$bad ${name}(health=$health)"
            fi
        done
        [ -z "$bad" ] && return 0
        if [ "$(date +%s)" -ge "$deadline" ]; then
            warn "超时 ${timeout}s 仍未健康：$bad"
            return 1
        fi
        sleep 5
    done
}

probe_health() {
    # 容器内探活：不依赖公网 DNS，证书刚签发或 DNS 未生效时也能判活
    local cid
    cid="$(compose ps -q app 2>/dev/null || true)"
    [ -n "$cid" ] || return 1
    docker exec "$cid" node -e \
        "fetch('http://127.0.0.1:'+(process.env.PORT??3939)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
        >/dev/null 2>&1
}

# ---------------------------------------------------------------- 状态与回滚

read_state_field() {
    [ -f "$STATE_FILE" ] || return 0
    grep -E "^$1=" "$STATE_FILE" | tail -n 1 | cut -d= -f2- || true
}

resolve_commit() {
    # 本次发布的 commit：CI 直传时落盘的 .deploy-commit 最准（服务器没有 git 仓库）；
    # 其次用 tag 里的 sha 反查本地 git；最后退化为 tag 的 sha 片段
    local tag="$1" sha
    sha="${tag#*-}"
    if [ -f "$COMMIT_FILE" ]; then
        cat "$COMMIT_FILE"
        return 0
    fi
    git rev-parse --verify "$sha" 2>/dev/null || echo "$sha"
}

write_state() {
    local status="$1" current="$2" previous="$3" commit="$4"
    cat > "$STATE_FILE" <<EOF
current_tag=$current
previous_tag=$previous
commit=$commit
deployed_at=$(date '+%Y-%m-%dT%H:%M:%S%z')
status=$status
EOF
}

rollback_to() {
    local prev="$1" prev_commit="$2"
    if [ -z "$prev" ]; then
        warn "没有可回滚的版本（.env.prod.bak 中无 IMAGE_TAG），保持现场等待人工处理"
        return 1
    fi
    [ -n "$prev_commit" ] || prev_commit="${prev#*-}"
    warn "开始回滚到 $prev"
    set_env_var IMAGE_TAG "$prev"
    restore_owner "$ENV_OWNER"
    if pull_images >/dev/null 2>&1 && compose up -d --wait --remove-orphans --no-build --pull never >/dev/null 2>&1; then
        if wait_healthy 180 && probe_health; then
            warn "回滚成功：当前运行 $prev"
            write_state ROLLED_BACK "$prev" "" "$prev_commit"
            return 0
        fi
    fi
    warn "回滚失败，需人工介入"
    write_state FAILED_ROLLED_BACK_FAILED "$prev" "" "$prev_commit"
    return 1
}

# ---------------------------------------------------------------- 镜像与备份清理

cleanup_images() {
    local current_tag="$1" protect_tag="$2" prefix repo tags i t
    prefix="$(image_prefix)"
    [ -n "$prefix" ] || { warn "无法推导镜像仓库前缀，跳过镜像清理"; return 0; }
    repo="${prefix##*/}"

    tags="$(docker images --format '{{.Tag}}\t{{.CreatedAt}}' "$prefix/$repo" 2>/dev/null \
        | awk -F'\t' '$1 ~ /^main-[0-9a-f]{7,40}$/' \
        | sort -k2 -r | cut -f1)"
    [ -n "$tags" ] || return 0
    i=0
    for t in $tags; do
        i=$((i + 1))
        # 当前版本与上一个版本（回滚目标）永不删除
        if [ "$i" -gt "$KEEP_IMAGES" ] && [ "$t" != "$current_tag" ] && [ "$t" != "$protect_tag" ]; then
            docker image rm "$prefix/$repo:$t" >/dev/null 2>&1 \
                || warn "镜像删除失败（可能被容器引用）：$prefix/$repo:$t"
        fi
    done
    # 只清悬空层：docker image prune -a 会连回滚目标一起删掉
    docker image prune -f >/dev/null 2>&1 || true
    log "镜像清理完成（保留最新 $KEEP_IMAGES 个）"
}

prune_backups() {
    #（head -n -N 在 BSD head 上不支持，改用计数 + sed 取前 N 行；
    #  不用 head：head 提前退出会让上游吃 SIGPIPE，pipefail 下误判为失败）
    local files count
    files="$(ls -1 .env.prod.bak* 2>/dev/null | sort || true)"
    count="$(printf '%s' "$files" | grep -c . || true)"
    if [ "${count:-0}" -gt 3 ]; then
        printf '%s\n' "$files" | sed -n "1,$((count - 3))p" | while read -r f; do
            rm -f "$f"
        done
    fi
    if [ -d "$LOG_DIR" ]; then
        ls -1t "$LOG_DIR"/*.log 2>/dev/null | tail -n +11 | while read -r f; do
            rm -f "$f"
        done
    fi
}

# ---------------------------------------------------------------- 主流程

main() {
    parse_args "$@"
    validate
    preflight

    local owner previous commit prev_commit
    owner="$(stat_owner "$ENV_FILE")"
    ENV_OWNER="$owner"
    # 上一个版本 = 当前配置里的 IMAGE_TAG（改之前）；空则退到备份与状态文件
    previous="$(env_get IMAGE_TAG '')"
    [ -n "$previous" ] || previous="$(grep -E '^IMAGE_TAG=' .env.prod.bak 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    [ -n "$previous" ] || previous="$(read_state_field previous_tag)"
    # 上一个版本的 commit = 旧状态文件里的 commit（本次发布覆盖前先取出来）
    prev_commit="$(read_state_field commit)"
    commit="$(resolve_commit "$IMAGE_TAG")"

    rotate_env_backup
    set_env_var IMAGE_TAG "$IMAGE_TAG"
    restore_owner "$owner"
    log "IMAGE_TAG 钉为 ${IMAGE_TAG}（上一个版本：${previous:-无}）"

    # 拉镜像 / 备份 / 迁移阶段失败时还没换容器，必须把 IMAGE_TAG 退回上一个版本——
    # 否则配置会指向一个从未跑起来的 tag，下一次部署的回滚目标就错了
    if ! pull_images; then
        restore_prev_tag "$previous" "$owner"
        fail "镜像拉取失败：$IMAGE_TAG"
    fi

    if ! run_backup; then
        restore_prev_tag "$previous" "$owner"
        fail "发布前备份失败：已中止发布，旧版本继续服务（未换容器）"
    fi

    if ! run_migrations; then
        restore_prev_tag "$previous" "$owner"
        fail "数据库迁移失败：已中止发布，旧版本继续服务（未换容器）"
    fi

    if ! compose up -d --wait --remove-orphans --no-build --pull never; then
        warn "容器更新失败"
        write_state FAILED "$IMAGE_TAG" "$previous" "$commit"
        rollback_to "$previous" "$prev_commit" || true
        fail "部署失败，已尝试回滚"
    fi

    if ! wait_healthy "$HEALTH_TIMEOUT" || ! probe_health; then
        warn "健康检查未通过"
        write_state FAILED "$IMAGE_TAG" "$previous" "$commit"
        rollback_to "$previous" "$prev_commit" || true
        fail "部署失败（健康检查未通过），已尝试回滚"
    fi

    write_state OK "$IMAGE_TAG" "$previous" "$commit"
    log "部署成功：${IMAGE_TAG}（commit ${commit}）"

    cleanup_images "$IMAGE_TAG" "$previous"
    prune_backups
    log "完成"
}

main "$@"
