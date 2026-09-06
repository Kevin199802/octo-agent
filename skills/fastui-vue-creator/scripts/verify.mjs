#!/usr/bin/env node
/**
 * verify —— 编译门禁(SPEC-DES-001 §5.5 / §7.3)
 *
 * 起(或复用)dev server,等编译结束,判定 success/error。失败时把错误原文
 * (含 file:line)回传给 agent,让它自己改、循环至通过。
 *
 * **没有这一步,模型会一直说「我改好了」——这是整套东西可靠性的分水岭。**
 *
 * 用法: node verify.mjs --session-dir=<.octo/<sid>> [--project-dir=] [--restart] [--timeout=300]
 */
import { spawn } from "node:child_process"
import { existsSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ok, fail, usage, log, block, parseArgs } from "./lib/result.mjs"
import { envDir, envPaths, readManifest, readJson, sessionPaths } from "./lib/paths.mjs"
import { findFreePort, isServing } from "./lib/port.mjs"
import { parseRounds, extractErrors } from "./lib/compile.mjs"

const args = parseArgs()
const manifest = readManifest()
const timeoutMs = (Number(args.timeout) || 300) * 1000
const settleMs = Number(manifest.compileSettleMs) || 800

// ── 定位会话 ─────────────────────────────────────────────────────
let sessionRoot = args["session-dir"] ? path.resolve(String(args["session-dir"])) : null
if (!sessionRoot && args["project-dir"]) {
  // outputs/<产物名> → 上两级
  sessionRoot = path.dirname(path.dirname(path.resolve(String(args["project-dir"]))))
}
if (!sessionRoot) usage("缺少 --session-dir=<.octo/<sessionId>> 或 --project-dir=")

const S = sessionPaths(path.join(sessionRoot, "outputs"))
const state = readJson(S.state)
if (!state) fail("NO_SESSION", `找不到会话状态 ${S.state}`, { hint: "先跑 new-session.mjs" })

const projectDir = args["project-dir"] ? path.resolve(String(args["project-dir"])) : state.projectDir
const portalDir = path.join(projectDir, "packages", "portal")
const writeDir = path.join(portalDir, "src", "views")
if (!existsSync(portalDir)) fail("NO_PROJECT", `工程目录不存在: ${portalDir}`, { hint: "先跑 new-session.mjs" })

const P = envPaths(envDir())

// ── 解析 cli-service 入口(不硬编码路径:版本升级换了入口文件名也不会断)──
function resolveCliService() {
  const pkgDir = path.join(P.depsModules, "@turboui", "turbo-ui-cli-service")
  const pkg = readJson(path.join(pkgDir, "package.json"))
  if (!pkg) return null
  let rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["turbo-ui-cli-service"] ?? Object.values(pkg.bin ?? {})[0]
  if (!rel) return null
  const abs = path.join(pkgDir, rel)
  return existsSync(abs) ? abs : null
}

// ── 本次改动的时间基线:views/ 下所有文件的最新 mtime ────────────────
function latestMtime(dir) {
  let newest = 0
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          newest = Math.max(newest, statSync(p).mtimeMs)
        } catch {
          /* 文件正被写入,忽略 */
        }
      }
    }
  }
  walk(dir)
  return newest
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const logSize = () => {
  try {
    return statSync(S.devserverLog).size
  } catch {
    return -1
  }
}
const logMtime = () => {
  try {
    return statSync(S.devserverLog).mtimeMs
  } catch {
    return 0
  }
}
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ── 复用还是重启 ─────────────────────────────────────────────────
const dev = readJson(S.devserver)
let reused = false
let port = state.port
let pid = null

if (!args.restart && dev?.pid && dev.projectDir === projectDir && pidAlive(dev.pid) && (await isServing(dev.port))) {
  reused = true
  port = dev.port
  pid = dev.pid
  log(`[reuse] dev server pid=${pid} port=${port}`)
} else if (dev?.pid && pidAlive(dev.pid)) {
  // 走到这里说明「有一个活着的旧 dev server,但这次不打算用它」——
  // 要么 --restart,要么它半死(进程在、端口不应答)。**必须先杀掉它**:
  // 不杀的话每次 --restart 都会多留一个 webpack dev server(每个吃数百 MB),
  // 端口还会一路往上爬。实测:连跑三次后 8082 与 8083 上各留了一个僵尸。
  try {
    process.kill(dev.pid)
    log(`[kill] 结束旧 dev server pid=${dev.pid} port=${dev.port}`)
    // 给它一点时间释放端口,否则紧接着的 probe 可能还认为端口被占
    await new Promise((r) => setTimeout(r, 800))
  } catch (e) {
    log(`[warn] 结束旧 dev server pid=${dev.pid} 失败: ${e.message}`)
  }
}

if (!reused) {
  const cli = resolveCliService()
  if (!cli) {
    fail("CLI_SERVICE_NOT_FOUND", `共享池里找不到 @turboui/turbo-ui-cli-service 的入口`, { hint: "先跑 ensure-env.mjs" })
  }

  // 端口冲突重试:探测到空闲 → 真正 listen 之间有几百毫秒窗口,理论上会被抢(§6.2③)
  let started = false
  for (let attempt = 1; attempt <= 3 && !started; attempt++) {
    const free = await findFreePort(port)
    if (!free) fail("NO_FREE_PORT", `从 ${port} 起找不到空闲端口`)
    port = free

    const fd = openSync(S.devserverLog, "a")
    // detached + stdio 全部重定向 + unref:脚本退出后 dev server 继续活着,
    // 由宿主按 .devserver.json 里的 pid 回收(§6.3 / §8.6③)。
    // ⚠️ Windows 下的 detached 语义与 Unix 不同,待内网实测(§6.3 末)。
    const child = spawn(P.nodeBin, [cli, "serve", "--replace-policy=dev", "--target=esnext"], {
      cwd: portalDir,
      env: { ...process.env, OCTO_DEPS: P.depsModules, OCTO_PORT: String(port) },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    })
    child.unref()
    pid = child.pid

    await sleep(1500)
    const tail = existsSync(S.devserverLog) ? readFileSync(S.devserverLog, "utf8").slice(-4000) : ""
    if (/EADDRINUSE/i.test(tail)) {
      log(`[retry ${attempt}] 端口 ${port} 被抢占,换一个`)
      port += 1
      continue
    }
    if (!pidAlive(pid)) {
      fail("DEVSERVER_EXITED", "dev server 启动后立即退出", { log: S.devserverLog })
    }
    started = true
  }
  if (!started) fail("PORT_RACE", "连续 3 次端口都被抢占")

  writeFileSync(
    S.devserver,
    JSON.stringify({ port, pid, projectDir, logPath: S.devserverLog, startedAt: new Date().toISOString() }, null, 2),
  )
}

// ── 等编译结束(§5.5.1 的三条规则)─────────────────────────────────
const baseline = latestMtime(writeDir)
const t0 = Date.now()
let lastSize = -1
let stableSince = 0

// 卡在哪个阶段 —— 超时时输出它,直接指向原因(见下面的 COMPILE_TIMEOUT 分支)
let stage = "WAITING_FOR_OUTPUT"
let roundsSeen = 0

while (Date.now() - t0 < timeoutMs) {
  const size = logSize()
  const mt = logMtime()

  // 规则 1:webpack 必须在文件改完之后有过输出,否则它还没反应过来
  if (mt <= baseline) {
    stage = "WAITING_FOR_OUTPUT"
    await sleep(200)
    continue
  }
  // 规则 3:稳定窗口 —— 日志停止增长 = webpack 不再被触发 = 模型确实写完了
  if (size !== lastSize) {
    stage = "WAITING_FOR_SETTLE"
    lastSize = size
    stableSince = Date.now()
    await sleep(200)
    continue
  }
  if (Date.now() - stableSince < settleMs) {
    await sleep(150)
    continue
  }

  // 规则 2:必须匹配到完整的一对「开始 → 结束」
  const text = readFileSync(S.devserverLog, "utf8")
  const all = parseRounds(text)
  roundsSeen = all.length
  const rounds = all.filter((r) => r.outcome !== null)
  const last = rounds[rounds.length - 1]
  if (!last) {
    stage = "WAITING_FOR_ROUND"
    await sleep(300)
    continue
  }

  if (last.outcome === "success") {
    if (!(await isServing(port))) {
      await sleep(500)
      continue
    }
    ok({
      PREVIEW_URL: `http://127.0.0.1:${port}`,
      PORT: port,
      PID: pid,
      PROJECT_DIR: projectDir,
      REUSED: reused,
      COMPILE_MS: Date.now() - t0,
      LOG: S.devserverLog,
    })
  }

  const errors = extractErrors(last)
  process.stdout.write(`RESULT: FAIL | COMPILE_ERROR: webpack 编译未通过\n`)
  process.stdout.write(`PORT: ${port}\nPID: ${pid}\nLOG: ${S.devserverLog}\n`)
  block("ERRORS", errors)
  process.exit(1)
}

// 超时是最难排查的一种失败:日志在内网,截图带不出来(§8.4)。
// 所以这里把定位所需的东西全部内联进输出 —— 阶段 + 识别到的轮次 + 日志尾部。
const tailLines = (() => {
  try {
    return readFileSync(S.devserverLog, "utf8").split(/\r?\n/).filter((l) => l.trim()).slice(-40).join("\n")
  } catch {
    return "(日志文件读不到)"
  }
})()

const stageHint = {
  // dev server 起来了,但文件改完之后它一个字都没输出 —— watch 没生效,或者根本没在编
  WAITING_FOR_OUTPUT: "dev server 在文件改动后没有任何输出:确认它真的起来了(看 LOG 开头),以及 views/ 在它的 watch 范围内",
  // 一直在刷日志停不下来 —— 编译真的很慢,或者有东西在无限重编
  WAITING_FOR_SETTLE: "日志持续增长未稳定:可能编译确实很慢(首次 1–3 分钟属正常),也可能有文件在被反复改写触发重编",
  // ★ 最可能的一种:日志已经稳定,但没认出"编译开始/结束"标志
  WAITING_FOR_ROUND:
    "日志已稳定但没识别出完整的编译轮次 —— 大概率是 lib/compile.mjs 的 MARKERS 与 turbo-ui-cli-service 的实际输出对不上。把下面 LOG_TAIL 里表示编译成功/失败的那几行发给开发,只改那一处即可",
}[stage]

process.stdout.write(`RESULT: FAIL | COMPILE_TIMEOUT: 等待编译结果超过 ${timeoutMs / 1000} 秒\n`)
process.stdout.write(`STAGE: ${stage}\nROUNDS_SEEN: ${roundsSeen}\nPORT: ${port}\nPID: ${pid}\n`)
process.stdout.write(`HINT: ${stageHint}\nLOG: ${S.devserverLog}\n`)
block("LOG_TAIL", tailLines)
process.exit(1)
