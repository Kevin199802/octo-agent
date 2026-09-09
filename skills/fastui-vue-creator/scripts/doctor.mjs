#!/usr/bin/env node
/**
 * doctor —— 环境诊断(SPEC-DES-001 §4.4)
 *
 * 装不上的时候跑它,一次性把「到底卡在哪一环」问清楚:网络能不能到 manifest、
 * 证书/代理有没有挡、共享池装到哪一步了、skill 组装了没有。
 *
 * 存在的理由:内网出问题时人只能截图(§8.4),而"装不上"的表象背后有十几种可能。
 * 挨个手工试要来回好几轮,不如一次跑完全部探针。
 *
 * 用法: node doctor.mjs [--env-dir=]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { setLogSink, log, parseArgs } from "./lib/result.mjs"
import { SKILL_DIR, TEMPLATE_DIR, VENDOR_DIR, envDir, envPaths, readManifest, readJson, exists, resolveYarnJs } from "./lib/paths.mjs"
import { sha256File } from "./lib/hash.mjs"

const args = parseArgs()
const manifest = readManifest()
const P = envPaths(envDir(args["env-dir"]))
// 同样落盘 —— 宿主 UI 未必把 stdout 展示出来,而 doctor 的输出恰恰是最需要事后能翻到的
setLogSink(path.join(P.root, "octo-fastui.log"))
const lines = []
const put = (k, v) => lines.push(`${k}: ${v}`)

put("PLATFORM", `${process.platform}-${process.arch}`)
put("NODE_RUNNING_THIS", process.version)
put("SKILL_DIR", SKILL_DIR)
put("ENV_DIR", P.root)

// ── skill 组装状态 ───────────────────────────────────────────────
const placeholders = [path.join(TEMPLATE_DIR, "PLACEHOLDER.md"), path.join(VENDOR_DIR, "PLACEHOLDER.md")]
put("SKILL_ASSEMBLED", placeholders.some(exists) ? "NO(占位文件还在)" : "YES")
put("TEMPLATE_PKG", exists(path.join(TEMPLATE_DIR, "package.json")) ? "OK" : "MISSING")
put("TEMPLATE_LOCK", exists(path.join(TEMPLATE_DIR, "yarn.lock")) ? "OK" : "MISSING")
put("VENDOR_DIRS", exists(VENDOR_DIR) ? (await import("node:fs")).readdirSync(VENDOR_DIR).join(",") || "(空)" : "MISSING")

// ── 共享池状态 ───────────────────────────────────────────────────
put("POOL_NODE", exists(P.nodeBin) ? P.nodeBin : "MISSING")
if (exists(P.nodeBin)) {
  try {
    put("POOL_NODE_VERSION", execFileSync(P.nodeBin, ["-v"], { encoding: "utf8" }).trim())
  } catch (e) {
    put("POOL_NODE_VERSION", `执行失败: ${e.message}`)
  }
}
put("POOL_YARN_JS", resolveYarnJs(P) ?? "MISSING")
put("POOL_DEPS", exists(P.depsModules) ? "OK" : "MISSING")
put("POOL_LOCKFILE", exists(P.depsLock) ? sha256File(P.depsLock) : "MISSING")
put("SKILL_TEMPLATE_LOCKFILE", exists(path.join(TEMPLATE_DIR, "yarn.lock")) ? sha256File(path.join(TEMPLATE_DIR, "yarn.lock")) : "MISSING")
const lock = readJson(P.lockFile)
put("ENV_LOCK_JSON", lock ? `OK(envVersion=${lock.envVersion})` : "MISSING")

// 日志在哪 —— 找不到日志是最常见的二次求助,直接打出来
put("LOG_INSTALL", path.join(P.root, "octo-fastui.log"))
put("LOG_PER_SESSION", "<项目目录>/.octo/<会话id>/ 下的 octo-fastui.log 与 devserver.log")
put("LOG_HINT", "两份日志文件名:octo-fastui.log(脚本输出)、devserver.log(dev server 与编译报错原文)")

// ── 系统 node/yarn(不是必需,但知道有没有对排查有用)────────────────
for (const [name, bin] of [["SYSTEM_NODE", "node"], ["SYSTEM_YARN", "yarn"], ["SYSTEM_NPM", "npm"]]) {
  try {
    // 这里的 shell: true 是安全的,与 §4.4.8 第二批坑 3 那次不同:
    // bin 是固定字面量、argv 只有 "-v",不含任何路径 —— 不存在空格被劈开或中文被代码页搞乱的问题。
    // Windows 上必须走 shell,否则找不到 yarn.cmd / npm.cmd(Node 18+ 不许直接 spawn .cmd)。
    put(name, execFileSync(bin, ["-v"], { encoding: "utf8", shell: process.platform === "win32" }).trim())
  } catch {
    put(name, "(没有)")
  }
}

// ── 代理环境变量:内网最常见的拦路虎 ──────────────────────────────
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) {
  if (process.env[k]) put(`PROXY_${k}`, process.env[k])
}

// ── 网络:manifest 能不能拿到 ────────────────────────────────────
const url = manifest.manifestUrl
put("MANIFEST_URL", url ?? "(未配置)")
if (url) {
  const started = Date.now()
  try {
    // 内网证书基本是自签名的,和 install 脚本保持一致:不校验证书,完整性靠 sha256
    const { Agent } = await import("node:https")
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
      // @ts-ignore node 的 fetch 支持 dispatcher/agent 的形态随版本而变,拿不到就走默认
      agent: new Agent({ rejectUnauthorized: false }),
      signal: AbortSignal.timeout(15000),
    })
    put("MANIFEST_HTTP_STATUS", res.status)
    put("MANIFEST_ELAPSED_MS", Date.now() - started)
    if (res.ok) {
      const text = await res.text()
      put("MANIFEST_BYTES", text.length)
      try {
        const m = JSON.parse(text)
        put("MANIFEST_NODE_VERSION", m?.node?.version ?? "(缺 node.version)")
        put("MANIFEST_PLATFORMS", Object.keys(m?.node?.platforms ?? {}).join(",") || "(空)")
        put("MANIFEST_HAS_MY_PLATFORM", m?.node?.platforms?.[`${process.platform}-${process.arch}`] ? "YES" : "NO")
      } catch {
        put("MANIFEST_PARSE", "失败 —— 返回的不是 JSON(多半是代理/网关的错误页)")
        put("MANIFEST_HEAD", text.slice(0, 120).replace(/\s+/g, " "))
      }
    }
  } catch (e) {
    put("MANIFEST_HTTP_STATUS", "请求失败")
    put("MANIFEST_ELAPSED_MS", Date.now() - started)
    put("MANIFEST_ERROR", String(e?.cause?.message ?? e?.message ?? e))
  }
}

const report = "OCTO_FASTUI_DOCTOR\n" + lines.join("\n") + "\n"
try {
  const { appendFileSync, mkdirSync } = await import("node:fs")
  mkdirSync(P.root, { recursive: true })
  appendFileSync(path.join(P.root, "octo-fastui.log"), `\n===== ${new Date().toISOString()} doctor\n${report}`)
} catch {
  /* 落盘失败不影响诊断本身 */
}
process.stdout.write(report)
log(`\n整段截图或复制出来即可 —— 每行自解释,不需要再补充上下文。同一份也写到了 ${path.join(P.root, "octo-fastui.log")}`)
