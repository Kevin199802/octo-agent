#!/usr/bin/env node
/**
 * ensure-env —— 环境就绪校验(SPEC-DES-001 §5.2)
 *
 * 只读、只判断、不修复。目标 1 秒内出结果:每个会话开头都要跑,
 * 把下载与 yarn install 塞进来会让它偶尔无预警卡十分钟(那些收在 install --upgrade 里)。
 *
 * 用法: node ensure-env.mjs [--env-dir=<路径>] [--json]
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { setLogSink, ok, fail, warn, parseArgs } from "./lib/result.mjs"
import { SKILL_DIR, TEMPLATE_DIR, VENDOR_DIR, envDir, envPaths, readJson, exists, resolveRuntime, majorOf } from "./lib/paths.mjs"
import { sha256File, sameHash } from "./lib/hash.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 这个脚本可能在还没有任何会话时跑(首装),所以落共享池(§5.1.1)。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))
const dir = envDir(args["env-dir"])
const P = envPaths(dir)

const installHint =
  process.platform === "win32"
    ? `powershell -ExecutionPolicy Bypass -File "${path.join(SKILL_DIR, "scripts", "install", "install.ps1")}"`
    : `bash "${path.join(SKILL_DIR, "scripts", "install", "install.sh")}"`

/**
 * 升级开关按平台拼 —— **不能两边都写 `--upgrade`**(v14)。
 *
 * install.ps1 是 `[CmdletBinding()]` 的 PowerShell 脚本,只认 `-Upgrade`。
 * 往它后面追加 GNU 风格的 `--upgrade`,要么报"找不到匹配的参数",要么被位置绑定到
 * 第一个参数 `$Manifest` —— 后者更糟:`$Manifest = "--upgrade"` 会一路走到
 * Invoke-WebRequest,报成 DOWNLOAD_FAILED,把排查方向往"网络/代理"上带一轮,
 * 而真实情况是 `-Upgrade` 开关**从来没被打开过**。
 */
const upgradeHint = `${installHint} ${process.platform === "win32" ? "-Upgrade" : "--upgrade"}`

// ── 1. 占位未填充 ────────────────────────────────────────────────
// 最容易漏、也最容易被误判成代码 bug 的一种状态(§8.3):skill 装上了,
// 但内网组装没做,于是一跑就报"找不到文件"这种看不出根因的错。
const placeholders = [path.join(TEMPLATE_DIR, "PLACEHOLDER.md"), path.join(VENDOR_DIR, "PLACEHOLDER.md")]
for (const p of placeholders) {
  if (exists(p)) {
    fail("SKILL_NOT_ASSEMBLED", `skill 未完成内网组装,${path.relative(SKILL_DIR, p)} 仍是占位文件`, {
      hint: `【这是内网组装步骤,由 skill 维护者在维护机上执行,不是 agent 或用户能做的】把内网脚手架模板复制到 ${TEMPLATE_DIR}、三份组件 skill 复制到 ${VENDOR_DIR},再删掉这两个目录下的 PLACEHOLDER.md`,
    })
  }
}
const templatePkg = path.join(TEMPLATE_DIR, "package.json")
const templateLock = path.join(TEMPLATE_DIR, "yarn.lock")
if (!exists(templatePkg) || !exists(templateLock)) {
  fail("SKILL_NOT_ASSEMBLED", "skill 的 template/ 缺少 package.json 或 yarn.lock", {
    hint: `把内网脚手架工程(排除根目录 node_modules)复制到 ${TEMPLATE_DIR},其下应直接是 package.json,不要再套一层工程目录`,
  })
}

// ── 2. 共享池存在 ────────────────────────────────────────────────
// **node 不在这条判据里**(§4.1):共享池里可以没有 portable node —— 系统 node 大版本
// 够用时安装脚本会直接复用它,那种机器上 <envDir>/node/ 下只有 yarn。node 能不能用
// 由下面第 4 步判(那里比的是"当前会用哪个 node"),在这里判会把正常环境判成 ENV_MISSING。
if (!exists(P.depsModules)) {
  fail("ENV_MISSING", `共享依赖池未安装,找不到 ${P.depsModules}`, { hint: installHint })
}
const lock = readJson(P.lockFile)
if (!lock) {
  fail("ENV_MISSING", `环境清单缺失或损坏:${P.lockFile}`, { hint: installHint })
}

// ── 3. lockfileHash 跨边界比对(主判据,§5.2.1)────────────────────
// 比的是「当前 skill 要求的依赖树」vs「共享池里实际装的那棵」。
// 两端必须跨过 skill 与共享池的边界 —— 都在共享池内部比的话,
// skill 升级带来新 yarn.lock 时两边依然一致,升级永远不会被触发。
const wantHash = sha256File(templateLock)
const gotHash = sha256File(P.depsLock)
if (!gotHash) {
  fail("ENV_MISSING", `共享池缺少 deps/yarn.lock,无法确认装的是哪棵依赖树`, { hint: upgradeHint })
}
if (!sameHash(wantHash, gotHash)) {
  fail("ENV_OUTDATED", "共享池的依赖树与当前 skill 的 template 不一致", {
    hint: upgradeHint,
    extra: { EXPECTED_LOCK: wantHash, ACTUAL_LOCK: gotHash },
  })
}

// ── 4. node 版本:**只比大版本**(§4.1)────────────────────────────
//
// 判据从"精确相等"放宽到"major 相同":依赖树里唯一的原生模块是 fsevents
// (optional + N-API,ABI 跨大版本稳定,加载失败 chokidar 自己回落到轮询),
// 小版本差异对这棵树没有影响。而精确相等会让一批本来跑得好好的机器被判成
// ENV_NODE_MISMATCH,然后去重装一遍 50MB 的 node —— 拦住的不是问题,是它们自己。
//
// 大版本仍然拦:node 大版本会带来 OpenSSL / webpack 兼容性上的真实断裂。
const rt = resolveRuntime(P)
let nodeVersion = ""
try {
  nodeVersion = execFileSync(rt.node, ["-v"], { encoding: "utf8" }).trim()
} catch (e) {
  fail("ENV_NODE_BROKEN", `node 无法执行(${rt.node}):${e.message}`, { hint: installHint })
}
const gotMajor = majorOf(nodeVersion)
const wantMajor = majorOf(lock.nodeVersion)
if (wantMajor !== null && gotMajor !== wantMajor) {
  fail("ENV_NODE_MISMATCH", `当前 node 是 ${nodeVersion}(${rt.source === "pool" ? "共享池" : "系统"}),装依赖时用的是 ${lock.nodeVersion}`, {
    hint: upgradeHint,
  })
}
// 小版本对不上不阻塞,但要留一行 —— env.lock.json 记的是"装的时候到底是哪个 node",
// 排查"同一台机器行为变了"时,这一行就是线索(§5.2.3)。
if (lock.nodeVersion && nodeVersion !== lock.nodeVersion) {
  warn(`node 实际 ${nodeVersion},清单记录 ${lock.nodeVersion}(大版本一致,不阻塞)`)
}

// ── 5. keyPackages 抽查(诊断,不阻塞,§5.2.3)──────────────────────
for (const [name, want] of Object.entries(lock.keyPackages ?? {})) {
  const pkg = readJson(path.join(P.depsModules, ...name.split("/"), "package.json"))
  if (!pkg) warn(`${name} 在共享池里找不到(清单记录 ${want})`)
  else if (pkg.version !== want) warn(`${name} 实际 ${pkg.version},清单记录 ${want}`)
}

ok({
  ENV_DIR: P.root,
  ENV_VERSION: lock.envVersion ?? "unknown",
  NODE_VERSION: nodeVersion,
  NODE_BIN: rt.node,
  NODE_SOURCE: rt.source,
  DEPS_DIR: P.depsModules,
  LOCKFILE_HASH: gotHash,
})
