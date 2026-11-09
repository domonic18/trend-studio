#!/usr/bin/env bash
# 教员生产端一键安装脚本。
#
#   curl -fsSL <站点>/install-producer.sh | bash
#
# 脚本做的事：查发布清单 → 下载安装包 → 校验 SHA-256 → 解包 → 跑装机向导
# （写 profile、复制九个工艺包、装依赖、装完自检）。
# 装机零提问、不碰机密：登录在 dsh 里跑 /trend login，模型密钥在 dsh 设置页粘贴。
#
# __BASE_URL__ 由云端在响应时替换成站点地址（PUBLIC_BASE_URL）；命令行
# --base-url 优先于它——教员从别的域名访问站点时用得着。
set -euo pipefail

BASE_URL="${TREND_CLOUD_URL:-__BASE_URL__}"
PROFILE="trend-producer"
WORK_DIR=""
EXTRA_ARGS=""

usage() {
  cat <<'EOF'
用法：
  curl -fsSL <站点>/install-producer.sh | bash
  bash install-producer.sh --base-url <站点地址> [--profile trend-producer]

选项：
  --base-url <url>   云端站点地址（默认用站点自带的地址；也可用环境变量 TREND_CLOUD_URL）
  --profile <name>   dsh profile 名，默认 trend-producer
  --model-api <协议>       模型协议，默认 openai-completions（另一可选 anthropic-messages）
  --model-base-url <url>   模型 base url，默认 https://api.minimaxi.com/v1
  --model-id <id>          模型 id，默认 MiniMax-M3.1-Flash
  -h, --help         显示本帮助

装机全程零提问；登录与模型密钥装完后在 dsh 里做（/trend login、设置 → 模型）。
EOF
}

die() {
  echo "✗ $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then rm -rf "$WORK_DIR"; fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --base-url=*) BASE_URL="${1#*=}"; shift ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    # 模型参数原样转给装机向导（--model-id / --model-name / --model-api /
    # --model-base-url / --model-provider / --model-key-ref / --token-ref）。
    --model-*|--token-ref) EXTRA_ARGS="${EXTRA_ARGS}$1
${2:-}
"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$BASE_URL" ] || { echo "缺少站点地址：用 --base-url 指定，或设 TREND_CLOUD_URL" >&2; usage >&2; exit 2; }
BASE_URL="${BASE_URL%/}"

command -v node >/dev/null 2>&1 || die "没找到 node。请先装 Node.js 22 或更高版本。"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js 版本过低（当前 ${NODE_MAJOR}），生产端需要 22 或更高。"

command -v curl >/dev/null 2>&1 || die "没找到 curl。"
command -v tar >/dev/null 2>&1 || die "没找到 tar。"

WORK_DIR="$(mktemp -d)"
trap cleanup EXIT

echo "▸ 读取发布清单：$BASE_URL/v1/portal/releases"
curl -fsSL "$BASE_URL/v1/portal/releases" -o "$WORK_DIR/releases.json" \
  || die "读不到发布清单（$BASE_URL 是不是云端地址？网络通吗？）"

META_FILE="$WORK_DIR/meta.env"
node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const plugin = manifest.producerPlugin;
if (!plugin || !plugin.fileName) {
  console.error("官网尚未发布生产端插件安装包");
  process.exit(3);
}
const out = [
  `FILE_NAME=${plugin.fileName}`,
  `SHA256=${plugin.sha256 ?? ""}`,
  `VERSION=${plugin.version ?? ""}`,
  `DSH_VERSION=${manifest.dshVersion ?? ""}`,
];
fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
' "$WORK_DIR/releases.json" "$META_FILE" || die "发布清单里没有生产端插件。"

# shellcheck disable=SC1090
. "$META_FILE"
[ -n "${FILE_NAME:-}" ] || die "发布清单缺少安装包文件名。"

echo "▸ 安装包：$FILE_NAME${VERSION:+（v${VERSION}）}"

curl -fsSL "$BASE_URL/downloads/$FILE_NAME" -o "$WORK_DIR/$FILE_NAME" \
  || die "下载安装包失败：$BASE_URL/downloads/$FILE_NAME"

if [ -n "${SHA256:-}" ]; then
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA="$(shasum -a 256 "$WORK_DIR/$FILE_NAME" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA="$(sha256sum "$WORK_DIR/$FILE_NAME" | awk '{print $1}')"
  elif command -v openssl >/dev/null 2>&1; then
    ACTUAL_SHA="$(openssl dgst -sha256 "$WORK_DIR/$FILE_NAME" | awk '{print $NF}')"
  else
    ACTUAL_SHA=""
  fi
  if [ -z "$ACTUAL_SHA" ]; then
    echo "⚠ 没有 sha256 工具，跳过校验。"
  elif [ "$(printf '%s' "$ACTUAL_SHA" | tr 'A-Z' 'a-z')" != "$(printf '%s' "$SHA256" | tr 'A-Z' 'a-z')" ]; then
    die "校验值对不上：期望 ${SHA256}，实际 ${ACTUAL_SHA}。安装包可能损坏或被篡改，已中止。"
  else
    echo "▸ 校验通过：$ACTUAL_SHA"
  fi
else
  echo "⚠ 清单未提供校验值，跳过校验。"
fi

tar -xzf "$WORK_DIR/$FILE_NAME" -C "$WORK_DIR" || die "解压安装包失败。"
[ -f "$WORK_DIR/package/scripts/setup.mjs" ] || die "安装包里没有 scripts/setup.mjs，制品不对。"

echo "▸ 跑装机向导（零提问）…"

set -- all --profile "$PROFILE" --tarball "$WORK_DIR/$FILE_NAME" --cloud "$BASE_URL"
if [ -n "$EXTRA_ARGS" ]; then
  printf '%s' "$EXTRA_ARGS" > "$WORK_DIR/extra-args"
  while IFS= read -r extra; do
    if [ -n "$extra" ]; then set -- "$@" "$extra"; fi
  done < "$WORK_DIR/extra-args"
fi

node "$WORK_DIR/package/scripts/setup.mjs" "$@" < /dev/null

echo ""
echo "装好了。接下来三步（都在 dsh 里）："
echo "  1. 打开 dsh --profile $PROFILE"
echo "  2. 会话框输入 /trend login —— 浏览器自动打开云端授权页，用教员账号登录"
echo "  3. dsh 设置 → 模型，粘贴 MiniMax API Key"
echo ""
echo "然后直接开工："
echo "  dsh --profile $PROFILE \"用 ~/Movies/课程1.mp4 做第一节\""
echo "（没预装 dsh 的话：npx --yes @deepseek-ai/dsh@${DSH_VERSION:-0.2.1-rc.5} --profile $PROFILE \"用 ~/Movies/课程1.mp4 做第一节\"）"
