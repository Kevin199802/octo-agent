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
#                   [--proxy=<地址>]   # 默认强制直连,只有确实必须经代理才传
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

MANIFEST=""; ENV_DIR=""; FROM_LOCAL=""; REGISTRY=""; UPGRADE=""; SKIP_NODE=""; STRICT_CERT=""; PROXY=""
for a in "$@"; do
  case "$a" in
    --manifest=*)   MANIFEST="${a#*=}" ;;
    --env-dir=*)    ENV_DIR="${a#*=}" ;;
    --from-local=*) FROM_LOCAL="${a#*=}" ;;
    --registry=*)   REGISTRY="${a#*=}" ;;
    --upgrade)      UPGRADE=1 ;;
    --skip-node)    SKIP_NODE=1 ;;
    --strict-cert)  STRICT_CERT=1 ;;
    --proxy=*)      PROXY="${a#*=}" ;;
    *) echo "RESULT: FAIL | BAD_USAGE: 未知参数 $a"; exit 2 ;;
  esac
done

fail() { echo "RESULT: FAIL | $1: $2"; [ -n "${3:-}" ] && echo "DETAIL: $3"; [ -n "${4:-}" ] && echo "HINT: $4"; exit 1; }

# 内网证书基本都是自签名的,默认放行 —— 传 --strict-cert 才严格校验。
# 完整性靠下载后的 sha256 比对保证,那比 TLS 证书链更强(校验的是文件内容本身)。
#
# **内网 host 一律强制直连**(v14,SPEC-DES-001 §4.4.8 第二批坑 1)。
# 2026-09-08 内网实测:agent 宿主进程注入了出外网的代理(proxyhk.huawei.com:8080),
# NO_PROXY 里明明有 .huawei.com 却没能生效(那台 curl 是 7.86.0),请求被送进 CONNECT
# 隧道,代理连不上内网上游 → 504 Gateway Timeout,首装从第一步就卡死。
# 而内网服务解析到 10.x 内网地址,压根不需要出外网的代理 —— 直连是唯一走得通的路。
#
# 不做"失败了自动回退走代理":那会用第二次的结果掩盖第一次失败的真实原因,
# 日志里反而看不出发生了什么。谁真需要经代理,显式传 --proxy=<地址>。
#
# 用数组而不是字符串:`--noproxy *` 里的 * 一旦经过不带引号的变量展开,
# 会被 shell 当通配符展开成当前目录的文件名。
# 显式传 --proxy 时也要把 --noproxy 定死成空:curl 在给了 --proxy 却没给 --noproxy 时
# 仍会读环境里的 NO_PROXY,逃生开关可能被静默旁路掉。
CURL_ARGS=(--noproxy '*')
[ -n "$PROXY" ] && CURL_ARGS=(--proxy "$PROXY" --noproxy '')
[ -z "$STRICT_CERT" ] && CURL_ARGS+=(-k)

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

# ── 取 manifest ────────────────────────────────────────────────
# **无论要不要下载 node,这一段都要跑**(v14,§4.4.8 第二批坑 4)。
# v13 把它整块放在 else 分支里,于是走 --skip-node 时 REGISTRY 一直是空、不传给
# setup-env,同一台机器上 install.sh 与 install.sh --skip-node 会用两个不同的 npm 源 ——
# npm 源的取值挂在了"要不要下载 node"这个毫不相干的条件上。
TMP="$(mktemp -d)"; trap '[ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf "$TMP"' EXIT

# 注意这个判据是有意的:**不带 --upgrade 时,即使 node 已在也会重下重解**。
# 因为不带 --upgrade 的调用来自 ensure-env 报 ENV_MISSING,那时环境状态本就存疑,
# 按"修复性重装"处理;--upgrade 才是"环境好着,只是依赖树要升"。
NEED_NODE=1
if [ -n "$SKIP_NODE" ] || { [ -x "$NODE_BIN" ] && [ -n "$UPGRADE" ]; }; then
  NEED_NODE=""
  echo "[skip] 复用已有 node: $NODE_BIN" >&2
fi

MJSON=""; BASE=""
if [ -n "$FROM_LOCAL" ]; then
  MJSON="$FROM_LOCAL/manifest.json"
  [ -f "$MJSON" ] || fail NO_MANIFEST "离线目录里没有 manifest.json: $MJSON"
  BASE="$FROM_LOCAL"
elif [ -n "$MANIFEST" ]; then
  MJSON="$TMP/manifest.json"
  BASE="$(dirname "$MANIFEST")"
  # 加时间戳破缓存 —— 服务端没设 no-store,升级后别读到旧的(§4.4.4)
  # manifest URL 可能自带 query,拼第二个 ? 会拿到 404 —— ps1 那侧一直判了,两边行为要一致
  case "$MANIFEST" in *\?*) SEP="&" ;; *) SEP="?" ;; esac
  if ! curl "${CURL_ARGS[@]}" -fsSL -H 'Cache-Control: no-cache' "$MANIFEST${SEP}t=$(date +%s)" -o "$MJSON"; then
    if [ -n "$NEED_NODE" ]; then
      fail DOWNLOAD_FAILED "拉不到 manifest: $MANIFEST" \
        "已强制直连(不经代理)。若这台机器确实必须经代理才能到内网,传 --proxy=<地址>" \
        "先手工确认一次:curl -v --noproxy '*' '$MANIFEST' —— 看它连到了哪个 IP、返回什么"
    fi
    # 只是为了拿 registry 的话不阻塞:node 已经在了,registry 缺省也能继续
    echo "[warn] 拉不到 manifest,registry 回落到本机 npm 配置" >&2
    MJSON=""
  fi
elif [ -n "$NEED_NODE" ]; then
  fail NO_MANIFEST "没有 manifest 地址" "传 --manifest=<url> 或 --from-local=<目录>"
fi

# registry 从 manifest 取;命令行 --registry 优先
if [ -z "$REGISTRY" ] && [ -n "$MJSON" ]; then
  REGISTRY="$("$PY" -c "import json,sys;print(json.load(open(sys.argv[1])).get('npmRegistry',''))" "$MJSON")"
fi

# ── 下载 + 校验 + 解压 node ────────────────────────────────────
if [ -n "$NEED_NODE" ]; then
  [ -n "$MJSON" ] || fail NO_MANIFEST "要装 node,但没有可用的 manifest"

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

  # ── 下载 + 校验 ──────────────────────────────────────────────
  PKG="$TMP/$(basename "$FILE")"
  if [ -n "$FROM_LOCAL" ]; then
    cp "$BASE/$FILE" "$PKG" || fail NO_LOCAL_PKG "离线目录里没有 $FILE"
  else
    echo "[download] $BASE/$FILE" >&2
    curl "${CURL_ARGS[@]}" -fSL "$BASE/$FILE" -o "$PKG" \
      || fail DOWNLOAD_FAILED "下载 node 包失败: $BASE/$FILE" \
           "已强制直连(不经代理)。manifest 能拉到不代表这个包也能 —— 它有几十 MB,先核对 Content-Length(§4.4.4)" \
           "curl -sI --noproxy '*' '$BASE/$FILE' | grep -i content-length"
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
[ -n "$PROXY" ] && ARGS+=(--proxy="$PROXY")   # 不透传的话,逃生开关只对下载 node 那一步有效
exec "$NODE_BIN" "$SKILL_DIR/scripts/setup-env.mjs" "${ARGS[@]}"
