#!/usr/bin/env bash
# fastui-vue-creator 环境安装(macOS) —— SPEC-DES-001 §4.1 / §4.4
#
# 本脚本只负责一件事:把 portable node 弄到共享池里。
# 拿到 node 之后立刻 exec setup-env.mjs —— 装 yarn、装依赖、写清单那些跨平台逻辑
# 只在 .mjs 里写一份,PowerShell 和 bash 各写一遍必然漂移。
#
# 用法:
#   bash install.sh [--manifest=<url|path>] [--env-dir=<路径>] [--from-local=<目录>]
#                   [--registry=<npm 源>] [--upgrade] [--skip-node]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

MANIFEST=""; ENV_DIR=""; FROM_LOCAL=""; REGISTRY=""; UPGRADE=""; SKIP_NODE=""
for a in "$@"; do
  case "$a" in
    --manifest=*)   MANIFEST="${a#*=}" ;;
    --env-dir=*)    ENV_DIR="${a#*=}" ;;
    --from-local=*) FROM_LOCAL="${a#*=}" ;;
    --registry=*)   REGISTRY="${a#*=}" ;;
    --upgrade)      UPGRADE=1 ;;
    --skip-node)    SKIP_NODE=1 ;;
    *) echo "RESULT: FAIL | BAD_USAGE: 未知参数 $a"; exit 2 ;;
  esac
done

fail() { echo "RESULT: FAIL | $1: $2"; [ -n "${3:-}" ] && echo "HINT: $3"; exit 1; }

PY="$(command -v python3 || true)"
[ -z "$PY" ] && fail NO_PYTHON "找不到 python3,无法解析 manifest.json" "安装 Xcode Command Line Tools: xcode-select --install"

[ -z "$ENV_DIR" ] && ENV_DIR="${OCTO_FASTUI_ENV_DIR:-$HOME/Library/Application Support/OctoAgent/fastui-env}"
NODE_DIR="$ENV_DIR/node"
NODE_BIN="$NODE_DIR/bin/node"

# manifest 默认从 skill 的 env.manifest.json 里读(§4.4.6:URL 直接写死在那里)
if [ -z "$MANIFEST" ] && [ -z "$FROM_LOCAL" ]; then
  MANIFEST="$("$PY" -c "import json,sys;print(json.load(open(sys.argv[1])).get('manifestUrl',''))" "$SKILL_DIR/references/env.manifest.json")"
fi

ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
PLATFORM_KEY="darwin-$ARCH"

if [ -n "$SKIP_NODE" ] || { [ -x "$NODE_BIN" ] && [ -n "$UPGRADE" ]; }; then
  echo "[skip] 复用已有 node: $NODE_BIN" >&2
else
  # ── 取 manifest ──────────────────────────────────────────────
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  if [ -n "$FROM_LOCAL" ]; then
    MJSON="$FROM_LOCAL/manifest.json"
    [ -f "$MJSON" ] || fail NO_MANIFEST "离线目录里没有 manifest.json: $MJSON"
    BASE="$FROM_LOCAL"
  else
    [ -n "$MANIFEST" ] || fail NO_MANIFEST "没有 manifest 地址" "传 --manifest=<url> 或 --from-local=<目录>"
    MJSON="$TMP/manifest.json"
    # 加时间戳破缓存 —— 服务端没设 no-store,升级后别读到旧的(§4.4.4)
    curl -fsSL -H 'Cache-Control: no-cache' "$MANIFEST?t=$(date +%s)" -o "$MJSON" \
      || fail DOWNLOAD_FAILED "拉不到 manifest: $MANIFEST"
    BASE="$(dirname "$MANIFEST")"
  fi

  read -r FILE SHA STRIP NODEVER <<EOF
$("$PY" - "$MJSON" "$PLATFORM_KEY" <<'PYEOF'
import json,sys
m=json.load(open(sys.argv[1])); p=m.get("node",{}).get("platforms",{}).get(sys.argv[2])
if not p: print("__MISSING__ __MISSING__ 1 __MISSING__"); sys.exit(0)
print(p.get("file",""), p.get("sha256",""), p.get("stripComponents",1), m.get("node",{}).get("version",""))
PYEOF
)
EOF
  [ "$FILE" = "__MISSING__" ] && fail NO_PLATFORM_PKG "manifest 里没有 $PLATFORM_KEY 的 node 包" "在 manifest.json 的 node.platforms 里补一条"
  [ -z "$REGISTRY" ] && REGISTRY="$("$PY" -c "import json,sys;print(json.load(open(sys.argv[1])).get('npmRegistry',''))" "$MJSON")"

  # ── 下载 + 校验 ──────────────────────────────────────────────
  PKG="$TMP/$(basename "$FILE")"
  if [ -n "$FROM_LOCAL" ]; then
    cp "$BASE/$FILE" "$PKG" || fail NO_LOCAL_PKG "离线目录里没有 $FILE"
  else
    echo "[download] $BASE/$FILE" >&2
    curl -fSL "$BASE/$FILE" -o "$PKG" || fail DOWNLOAD_FAILED "下载 node 包失败: $BASE/$FILE"
  fi

  # sha256 十六进制大小写不敏感,统一转小写再比 —— 否则会把完全正确的包判成损坏
  GOT="$(shasum -a 256 "$PKG" | awk '{print tolower($1)}')"
  WANT="$(echo "$SHA" | tr 'A-Z' 'a-z' | sed 's/^sha256://')"
  if [ -n "$WANT" ] && [ "$GOT" != "$WANT" ]; then
    fail SHA256_MISMATCH "node 包校验失败(下载可能被截断或代理改写)" "重新投放资源后重试;实测值 $GOT"
  fi

  # ── 解压 ────────────────────────────────────────────────────
  mkdir -p "$NODE_DIR"
  tar -xzf "$PKG" -C "$NODE_DIR" --strip-components="${STRIP:-1}" \
    || fail EXTRACT_FAILED "解压失败: $PKG"
  [ -x "$NODE_BIN" ] || fail EXTRACT_FAILED "解压后找不到 $NODE_BIN(stripComponents 可能不对)"
  echo "[node] $("$NODE_BIN" -v) → $NODE_DIR" >&2
fi

# ── 交给 setup-env.mjs ────────────────────────────────────────
ARGS=(--env-dir="$ENV_DIR")
[ -n "$REGISTRY" ] && ARGS+=(--registry="$REGISTRY")
[ -n "$UPGRADE" ] && ARGS+=(--upgrade)
exec "$NODE_BIN" "$SKILL_DIR/scripts/setup-env.mjs" "${ARGS[@]}"
