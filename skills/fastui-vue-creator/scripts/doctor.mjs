#!/usr/bin/env node
/**
 * doctor —— **环境快照**(SPEC-DES-002 §4.4.9,v15 Q10 重做)
 *
 * 只清点这台机器上有什么:skill 组装了没有、共享池装到哪一步、本进程看到的代理变量。
 * **不做任何网络探测** —— 网络归 `install.sh --check` / `install.ps1 -Check` 管。
 *
 * 为什么把探测搬走(2026-09-08 的教训):doctor 用 Node 的 `fetch`,而 `fetch`(undici)
 * **完全忽略 `HTTP_PROXY` 环境变量**,install 脚本用的 curl / .NET WebRequest 则会读 ——
 * 于是 doctor 报 `MANIFEST_HTTP_STATUS: 200`、install 同时 504,**诊断工具回答了另一个问题**,
 * 排查方向被带偏一轮。两套并行实现必然漂移,所以探测只保留一份,放在真正会去下载的
 * 那个脚本里(同一套代理开关、同一个 URL 拼法、同一个 HTTP 客户端),零漂移。
 *
 * 代理环境变量仍然留在这里:那是**纯读本进程的环境**,不是探测,不存在漂移。
 * 而且必须由 agent 在它自己的进程里跑 —— 代理这类问题只存在于 agent 宿主进程的环境里,
 * 人在终端跑会得到一个看起来一切正常的假象(§4.4.9)。
 *
 * 用法: node doctor.mjs [--env-dir=]
 */
import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import { setLogSink, emit, log, parseArgs } from "./lib/result.mjs"
import { SKILL_DIR, TEMPLATE_DIR, VENDOR_DIR, envDir, envPaths, readManifest, readJson, exists, resolveYarnJs, resolveRuntime } from "./lib/paths.mjs"
import { sha256File } from "./lib/hash.mjs"

const args = parseArgs()
const P = envPaths(envDir(args["env-dir"]))
const LOG = path.join(P.root, "octo-fastui.log")
// 同样落盘 —— 宿主 UI 未必把 stdout 展示出来,而 doctor 的输出恰恰是最需要事后能翻到的
setLogSink(LOG)
const lines = []
const put = (k, v) => lines.push(`${k}: ${v}`)

put("PLATFORM", `${process.platform}-${process.arch}`)
put("NODE_RUNNING_THIS", process.version)
put("SKILL_DIR", SKILL_DIR)
put("ENV_DIR", P.root)
// 版本要打出来:外网排查时手里有整个仓库,`UNEXPECTED` 给的行号、错误码字典都随版本变,
// 对错版本会指到别处。读不到不阻塞 —— doctor 的职责是"把看得见的都说出来",不是拦人。
try {
  put("SKILL_VERSION", readManifest().skillVersion ?? "unknown")
} catch {
  put("SKILL_VERSION", "读不到 references/env.manifest.json")
}

// ── skill 组装状态 ───────────────────────────────────────────────
const placeholders = [path.join(TEMPLATE_DIR, "PLACEHOLDER.md"), path.join(VENDOR_DIR, "PLACEHOLDER.md")]
put("SKILL_ASSEMBLED", placeholders.some(exists) ? "NO(占位文件还在)" : "YES")
put("TEMPLATE_PKG", exists(path.join(TEMPLATE_DIR, "package.json")) ? "OK" : "MISSING")
put("TEMPLATE_LOCK", exists(path.join(TEMPLATE_DIR, "yarn.lock")) ? "OK" : "MISSING")
put("VENDOR_DIRS", exists(VENDOR_DIR) ? readdirSync(VENDOR_DIR).join(",") || "(空)" : "MISSING")

// ── 共享池状态 ───────────────────────────────────────────────────
// POOL_NODE 是 MISSING **不等于环境有问题**:机器上有能跑的 node 时安装脚本会直接复用它,
// 那种机器上共享池里本来就没有 node(§4.1)。真正在用哪个,看下面 EFFECTIVE_NODE。
put("POOL_NODE", exists(P.nodeBin) ? P.nodeBin : "MISSING(不一定是问题,见 EFFECTIVE_NODE)")
if (exists(P.nodeBin)) {
  try {
    put("POOL_NODE_VERSION", execFileSync(P.nodeBin, ["-v"], { encoding: "utf8" }).trim())
  } catch (e) {
    put("POOL_NODE_VERSION", `执行失败: ${e.message}`)
  }
}
const RT = resolveRuntime(P)
put("EFFECTIVE_NODE", `${RT.node}(${RT.source === "pool" ? "共享池" : "系统"})`)
// 值域是「解析出的绝对路径」/ MISSING,不是 OK/MISSING —— 只说 MISSING 而不说去哪找的、
// 找到了什么,正是 2026-09-08 白花一轮才发现路径猜错的原因(§4.4.8 第二批坑 3)
put("POOL_YARN_JS", resolveYarnJs(P) ?? "MISSING")
put("POOL_DEPS", exists(P.depsModules) ? "OK" : "MISSING")
put("POOL_LOCKFILE", exists(P.depsLock) ? sha256File(P.depsLock) : "MISSING")
put("SKILL_TEMPLATE_LOCKFILE", exists(path.join(TEMPLATE_DIR, "yarn.lock")) ? sha256File(path.join(TEMPLATE_DIR, "yarn.lock")) : "MISSING")
const lock = readJson(P.lockFile)
put("ENV_LOCK_JSON", lock ? `OK(envVersion=${lock.envVersion})` : "MISSING")
// 两个 lockfile 哈希一眼看不出等不等,直接判一行 —— 这是 ensure-env 的主判据(§5.2.1)。
// **缺文件时也要打这一行**:同 PROXY 那条原则,不打的话分不清"没比"和"比了没问题"。
if (exists(P.depsLock) && exists(path.join(TEMPLATE_DIR, "yarn.lock"))) {
  const same = sha256File(P.depsLock) === sha256File(path.join(TEMPLATE_DIR, "yarn.lock"))
  put("LOCKFILE_MATCH", same ? "YES" : "NO(共享池与当前 skill 的依赖树不一致,要跑 --upgrade)")
} else {
  put("LOCKFILE_MATCH", "UNKNOWN(两个 lockfile 至少缺一个,见上面两行)")
}

// ── 系统 node/yarn(不是必需,但知道有没有对排查有用)────────────────
const sysVersions = {}
for (const [name, bin] of [["SYSTEM_NODE", "node"], ["SYSTEM_YARN", "yarn"], ["SYSTEM_NPM", "npm"]]) {
  try {
    // 这里的 shell: true 是安全的,与 §4.4.8 第二批坑 3 那次不同:
    // bin 是固定字面量、argv 只有 "-v",不含任何路径 —— 不存在空格被劈开或中文被代码页搞乱的问题。
    // Windows 上必须走 shell,否则找不到 yarn.cmd / npm.cmd(Node 18+ 不许直接 spawn .cmd)。
    sysVersions[name] = execFileSync(bin, ["-v"], { encoding: "utf8", shell: process.platform === "win32" }).trim()
    put(name, sysVersions[name])
  } catch {
    put(name, "(没有)")
  }
}
// 安装脚本会不会去下载 node,这一行直接给结论 —— 让人自己拿上面几行去推,
// 就是把"没查"和"没问题"混起来的另一种形态(§4.4.9)。
// **不做版本判定**:有能跑的 node 就复用,不管大版本(§4.1)。
// 判据必须与 install.sh 逐字一致:**要求 `node -v` 真的吐出 `vX.Y.Z`**,不是"命令没报错"。
// 松一点点就会出现"doctor 说不用下载、install 却去下载"——诊断工具回答了另一个问题,
// 正是 Q10 要根治的那一类(§4.4.9)。
const sysNodeUsable = /^v\d+\./.test(sysVersions.SYSTEM_NODE ?? "")
put(
  "WILL_DOWNLOAD_NODE",
  exists(P.nodeBin) || sysNodeUsable
    ? "NO(手上已有能跑的 node,首装不需要下载,也不会读 manifest)"
    : "YES(池子里和系统里都没有能跑的 node —— 这条路要网络,见 NET_CHECK_CMD)",
)

// ── 本进程看到的代理变量:内网最常见的拦路虎 ────────────────────────
// 一个都没有时也要显式打一行,否则分不清"没有代理"和"没查代理"(§4.4.9)。
let sawProxy = false
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
  if (process.env[k]) {
    put(`PROXY_${k}`, process.env[k])
    sawProxy = true
  }
}
if (!sawProxy) put("PROXY", "(无)")

// ── 网络:不在这里做 ─────────────────────────────────────────────
put("MANIFEST_URL", readManifest().manifestUrl ?? "(未配置)")
const checkCmd =
  process.platform === "win32"
    ? `powershell -ExecutionPolicy Bypass -File "${path.join(SKILL_DIR, "scripts", "install", "install.ps1")}" -Check`
    : `bash "${path.join(SKILL_DIR, "scripts", "install", "install.sh")}" --check`
// **必须是个状态字段,不能只写句说明**:只跑了 doctor 的 agent 看到满屏正常会得出
// "环境没问题",而网络这一格其实是"没查"。这跟 PROXY 那条"一个都没有也要打一行"是同一条
// 原则 —— 分不清"没问题"和"没查"就是把人往沟里带(§4.4.9)。
put("NETWORK", "UNKNOWN(本脚本不探测;必须再跑下面这条 NET_CHECK_CMD 才有结论)")
put("NETWORK_PROBE_WHY", "doctor 与安装脚本不是同一个 HTTP 客户端,自己探会给出另一个问题的答案")
put("NET_CHECK_CMD", checkCmd)

// 日志在哪 —— 找不到日志是最常见的二次求助,直接打出来
put("LOG_INSTALL", LOG)
put("LOG_PER_SESSION", "<项目目录>/.octo/<会话id>/ 下的 octo-fastui.log 与 devserver.log")
put("LOG_HINT", "两份日志文件名:octo-fastui.log(脚本输出,含子进程原文)、devserver.log(dev server 与编译报错原文)")

emit("OCTO_FASTUI_DOCTOR\n" + lines.join("\n") + "\n")
log(`\n整段截图或复制出来即可 —— 每行自解释,不需要再补充上下文。同一份也写到了 ${LOG}`)
log(`网络能不能到内网,跑这条(它走的是真实安装的那条代码路径):\n  ${checkCmd}`)
