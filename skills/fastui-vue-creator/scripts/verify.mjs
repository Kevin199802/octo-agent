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
// execFileSync:Windows 分支用它跑 PowerShell 的 Start-Process(v15 改走 -EncodedCommand 时引入)
import { execFileSync, spawn } from "node:child_process"
import { existsSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, usage, warn, log, block, parseArgs } from "./lib/result.mjs"
import { envDir, envPaths, readManifest, readJson, sessionPaths } from "./lib/paths.mjs"
import { findFreePort, isServing } from "./lib/port.mjs"
import { parseRounds, extractErrors } from "./lib/compile.mjs"
import { lintMissingImports } from "./lib/lint.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 有会话上下文的脚本一律写**会话目录**,和 devserver.log 放在一起 ——
// 排查时只需要看一个目录,不用在共享池和会话目录之间来回找(§5.1.1)。
// 会话目录此刻可能还没解析出来,先挂共享池,解析出来后再改指向。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))
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
// 会话目录已知,日志改写这里 —— 与 devserver.log 同目录,一处就能看全
setLogSink(path.join(S.sessionRoot, "octo-fastui.log"))
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
// Windows 的 Start-Process 不允许 stdout/stderr 重定向到同一个文件,
// 于是 stderr 落在 <log>.err —— 判定时两份都要看(编译错误可能走 stderr)
const LOG_FILES = process.platform === "win32" ? [S.devserverLog, S.devserverLog + ".err"] : [S.devserverLog]

function readLogs() {
  return LOG_FILES.map((f) => {
    try {
      return readFileSync(f, "utf8")
    } catch {
      return ""
    }
  }).join("\n")
}

const logSize = () => {
  let total = -1
  for (const f of LOG_FILES) {
    try {
      total = Math.max(total, 0) + statSync(f).size
    } catch {
      /* 还没生成 */
    }
  }
  return total
}
const logMtime = () => {
  let newest = 0
  for (const f of LOG_FILES) {
    try {
      newest = Math.max(newest, statSync(f).mtimeMs)
    } catch {
      /* 还没生成 */
    }
  }
  return newest
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

// --port:接管一个已经在跑的 dev server(不管是谁起的),只做编译判定。
// 存在的意义是把「dev server 起不起得来」和「编译判定/预览链路通不通」拆成两件事分别验证 ——
// Windows 下 detached 失效时(实测:关掉 PowerShell 窗口进程就被收走),
// 这条路让后面几段仍然可调,不至于卡在第一步。
if (args.port) {
  const attach = Number(args.port)
  if (!(await isServing(attach))) {
    fail("ATTACH_FAILED", `${attach} 端口上没有在跑的服务`, {
      hint: `先手工起 dev server(在 ${portalDir} 下跑 yarn serve),再用 --port=${attach} 接管`,
    })
  }
  reused = true
  port = attach
  pid = dev?.port === attach ? dev.pid : null
  log(`[attach] 接管 127.0.0.1:${attach} 上已有的 dev server`)
}

// 宿主(Electron 主进程)可能正在起 —— 它监听 .octo-fastui.json,出现即 spawn(§8.6.1)。
// 这里等它一会儿再决定自己动手,否则两边会各起一个 dev server 打架。
if (!reused && !args.restart) {
  for (let i = 0; i < 30; i++) {
    const d = readJson(S.devserver)
    if (d?.pid && d.projectDir === projectDir && pidAlive(d.pid) && (await isServing(d.port))) {
      reused = true
      port = d.port
      pid = d.pid
      log(`[host] 宿主已起好 dev server pid=${pid} port=${port}`)
      break
    }
    if (i === 0) log("[wait] 等宿主启动 dev server(最多 15 秒)…")
    await sleep(500)
  }
}

if (!reused) {
  log("[fallback] 宿主没有接管,由本脚本自己启动 —— Windows 下这个进程活不过本次调用(§6.3),属已知模式差异")
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

    const cliArgs = [cli, "serve", "--replace-policy=dev", "--target=esnext"]
    const childEnv = { ...process.env, OCTO_DEPS: P.depsModules, OCTO_PORT: String(port) }

    if (process.platform === "win32") {
      // Windows 下 Node 的 detached **不足以**脱离 —— 实测:verify 退出(或宿主的
      // bash 工具收尾)后 dev server 被一起收走,`Get-Process -Id <pid>` 查不到。
      // 根因是父进程所在的 Job Object 被关闭时会连坐整棵进程树,而 detached 只是
      // 新建进程组,并不脱离 Job。
      // PowerShell 的 Start-Process 创建的是真正独立的进程,不在调用者的 Job 里。
      const q = (v) => `'${String(v).replace(/'/g, "''")}'`
      const psScript = [
        // 输出也定成 UTF-8:PowerShell 的中文报错默认按系统代码页(内网 GBK)出来,Node 这边
        // 按 utf8 读就是乱码,而"乱码报错"正是 2026-09-07 误删事故的起点(§5.1.2)——错误信息必须能读。
        // 只设 `[Console]::OutputEncoding`:`$OutputEncoding` 管的是 PS 经管道传给外部程序的
        // stdin 编码,这段脚本里没有那种管道,设了是空转。
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8`,
        `$env:OCTO_DEPS=${q(P.depsModules)}`,
        `$env:OCTO_PORT=${q(String(port))}`,
        `$p = Start-Process -FilePath ${q(P.nodeBin)}` +
          ` -ArgumentList @(${cliArgs.map(q).join(",")})` +
          ` -WorkingDirectory ${q(portalDir)}` +
          ` -RedirectStandardOutput ${q(S.devserverLog)}` +
          ` -RedirectStandardError ${q(S.devserverLog + ".err")}` +
          ` -WindowStyle Hidden -PassThru`,
        `$p.Id`,
      ].join("; ")
      // **必须走 -EncodedCommand,不能用 -Command**(v15)。
      //
      // PowerShell 5.1 读命令行参数时按系统 ANSI 代码页解释(内网是 GBK),而 Node 按 UTF-8
      // 编码 argv 传出去 —— 项目路径里只要有中文,传过去就是乱码,Start-Process 报"找不到路径"。
      // 2026-09-09 内网实测:工作目录 `D:\10 agent测试\` 下 dev server 起不来。
      // 这跟 install.ps1 那条"必须存 UTF-8 with BOM"是同一个根因(PS 5.1 的编码假设)。
      //
      // -EncodedCommand 收的是 UTF-16LE 的 Base64,完全绕开代码页,是微软给的标准解法;
      // 顺带也免掉了命令行里的引号转义问题。
      const encoded = Buffer.from(psScript, "utf16le").toString("base64")
      try {
        const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
          encoding: "utf8",
          windowsHide: true,
        })
        pid = Number(String(out).trim().split(/\s+/).pop())
      } catch (e) {
        // 取 e.stderr 而不是 e.message:execFileSync 的 message 是
        // `Command failed: <完整 argv>\n<stderr>`,而 argv 里那串 base64 有 1300+ 字符,
        // 会把真正的报错挤到后面 —— 这一行是要 agent 原样转达给用户的,必须能读(§5.1.2)。
        const detail = String(e.stderr || e.message).trim().split(/\r?\n/).slice(0, 5).join(" ")
        fail("SPAWN_FAILED", `Start-Process 启动 dev server 失败: ${detail}`, { log: S.devserverLog })
      }
    } else {
      const fd = openSync(S.devserverLog, "a")
      const child = spawn(P.nodeBin, cliArgs, {
        cwd: portalDir,
        env: childEnv,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      })
      child.unref()
      pid = child.pid
    }

    await sleep(1500)
    const tail = readLogs().slice(-4000)
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
  const text = readLogs()
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
    // 编译通过不等于页面能渲染:漏 import 的组件 webpack 编不出错,
    // 但浏览器里会 `Failed to resolve component` 然后整页白屏。这是 verify 唯一
    // 能在"返回 OK"之前替模型兜住的一类运行时错误,不查白不查。
    for (const r of lintMissingImports(writeDir)) {
      warn(`${path.relative(projectDir, r.file)} 用了 ${r.missing.join(" / ")} 但没有 import —— 页面会白屏,必须补上`)
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
    return readLogs().split(/\r?\n/).filter((l) => l.trim()).slice(-40).join("\n")
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
