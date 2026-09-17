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
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, usage, warn, log, block, emit, logPath, parseArgs } from "./lib/result.mjs"
import { devserverPaths, envDir, envPaths, readManifest, readJson, sessionPaths, resolveRuntime } from "./lib/paths.mjs"
import { findFreePort, isServing } from "./lib/port.mjs"
import { hostPresent, killTree, postRequest, registerPid } from "./lib/host.mjs"
import { parseRounds, extractErrors } from "./lib/compile.mjs"
import { lintMissingImports, lintMissingVueApis } from "./lib/lint.mjs"

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
// 服务记录与日志按产物工程分(SPEC-DES-004 §3.9):同一对话的两个工程要能同时预览
const name = path.basename(projectDir)
const D = devserverPaths(S.sessionRoot, name)

const P = envPaths(envDir())
// 起 dev server 用哪个 node:共享池里有就用池子的,没有就用跑着本脚本的这个 ——
// 系统 node 够用的机器上共享池里根本没有 node(§4.1),写死 P.nodeBin 会 ENOENT。
const RT = resolveRuntime(P)

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
const LOG_FILES = process.platform === "win32" ? [D.log, D.log + ".err"] : [D.log]

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

// ── 找到这个产物工程的 dev server(SPEC-DES-004 §3.7)────────────────
// 在 Octo 里服务一律由宿主起并持有 —— 本脚本是短命进程,自己起的服务宿主收不到,
// 关掉 Octo 后就成了占着端口的孤儿。所以这里只负责「找到它」或「请宿主起」,
// 只有不在 Octo 里(外网 V0、终端直接跑)才自己起。
const HOST_WAIT_MS = (Number(args["host-wait"]) || 60) * 1000

/** 这个工程当前的服务记录;进程已经不在就当没有 */
const readRecord = () => {
  const r = readJson(D.record)
  return r?.pid && r.projectDir === projectDir && pidAlive(r.pid) ? r : null
}

let reused = false
let port = null
let pid = null

if (args.restart) {
  const r = readRecord()
  if (r) {
    killTree(r.pid)
    log(`[kill] --restart:结束旧 dev server pid=${r.pid} port=${r.port}`)
    // 给它一点时间释放端口和文件句柄(Windows 的 taskkill 返回时进程未必已经退干净)
    await sleep(800)
  }
}

// --port:接管一个已经在跑的 dev server(不管是谁起的),只做编译判定。
// 存在的意义是把「dev server 起不起得来」和「编译判定/预览链路通不通」拆成两件事分别验证。
if (args.port) {
  const attach = Number(args.port)
  if (!(await isServing(attach))) {
    fail("ATTACH_FAILED", `${attach} 端口上没有在跑的服务`, {
      hint: `先手工起 dev server(在 ${portalDir} 下跑 yarn serve),再用 --port=${attach} 接管`,
    })
  }
  const r = readRecord()
  reused = true
  port = attach
  pid = r?.port === attach ? r.pid : null
  log(`[attach] 接管 127.0.0.1:${attach} 上已有的 dev server`)
} else {
  let r = readRecord()
  if (!r && hostPresent(P.root)) {
    postRequest(P.root, { sessionDir: S.sessionRoot, projectDir, name })
    log(`[host] 已请求宿主起 dev server,等待中(最多 ${HOST_WAIT_MS / 1000} 秒)…`)
    const deadline = Date.now() + HOST_WAIT_MS
    while (!r && Date.now() < deadline) {
      await sleep(500)
      r = readRecord()
    }
    if (!r) log("[host] 宿主未在时限内起好服务,改由本脚本自己启动")
  }
  if (r) {
    reused = true
    port = r.port
    pid = r.pid
    log(`[reuse] dev server pid=${pid} port=${port} owner=${r.owner ?? "unknown"}`)
  }
}

if (!reused) {
  log("[fallback] 不在 Octo 里(或宿主没有响应),由本脚本自己启动 dev server")
  const cli = resolveCliService()
  if (!cli) {
    fail("CLI_SERVICE_NOT_FOUND", `共享池里找不到 @turboui/turbo-ui-cli-service 的入口`, { hint: "先跑 ensure-env.mjs" })
  }
  mkdirSync(D.dir, { recursive: true })

  // 端口在 spawn 这一刻挑,不沿用任何记下来的端口(SPEC-DES-004 §3.4)。
  // 探测到真正 listen 之间有窗口,可能被抢 —— 靠下面的 EADDRINUSE 重试兜住。
  let candidate = Number(manifest.portRangeStart) || 8081
  let started = false
  for (let attempt = 1; attempt <= 3 && !started; attempt++) {
    const free = await findFreePort(candidate)
    if (!free) fail("NO_FREE_PORT", `从 ${candidate} 起找不到空闲端口`)
    port = free

    const cliArgs = [cli, "serve", "--replace-policy=dev", "--target=esnext"]
    const childEnv = { ...process.env, OCTO_DEPS: P.depsModules, OCTO_PORT: String(port) }
    // 只看本次启动之后新写的日志 —— 日志是追加的,上一次的 EADDRINUSE 会被误认成这一次的
    const logOffset = readLogs().length

    if (process.platform === "win32") {
      // Windows 下 Node 的 detached **不足以**脱离 —— 实测:verify 退出(或宿主的
      // bash 工具收尾)后 dev server 被一起收走。根因是父进程所在的 Job Object 被关闭时
      // 会连坐整棵进程树,而 detached 只是新建进程组,并不脱离 Job。
      // PowerShell 的 Start-Process 创建的是真正独立的进程,不在调用者的 Job 里。
      const q = (v) => `'${String(v).replace(/'/g, "''")}'`
      const psScript = [
        // 输出也定成 UTF-8:PowerShell 的中文报错默认按系统代码页(内网 GBK)出来,错误信息必须能读(§5.1.2)
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8`,
        `$env:OCTO_DEPS=${q(P.depsModules)}`,
        `$env:OCTO_PORT=${q(String(port))}`,
        `$p = Start-Process -FilePath ${q(RT.node)}` +
          ` -ArgumentList @(${cliArgs.map(q).join(",")})` +
          ` -WorkingDirectory ${q(portalDir)}` +
          ` -RedirectStandardOutput ${q(D.log)}` +
          ` -RedirectStandardError ${q(D.log + ".err")}` +
          ` -WindowStyle Hidden -PassThru`,
        `$p.Id`,
      ].join("; ")
      // **必须走 -EncodedCommand,不能用 -Command**(v15):PowerShell 5.1 按系统 ANSI 代码页
      // 解释命令行参数,项目路径里有中文就是乱码。-EncodedCommand 收 UTF-16LE 的 Base64,绕开代码页。
      const encoded = Buffer.from(psScript, "utf16le").toString("base64")
      try {
        const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
          encoding: "utf8",
          windowsHide: true,
        })
        pid = Number(String(out).trim().split(/\s+/).pop())
      } catch (e) {
        // 取 e.stderr 而不是 e.message:message 里带着 1300+ 字符的 base64 argv,会把真正的报错挤到后面
        const detail = String(e.stderr || e.message).trim().split(/\r?\n/).slice(0, 5).join(" ")
        fail("SPAWN_FAILED", `Start-Process 启动 dev server 失败: ${detail}`, { log: D.log })
      }
    } else {
      const fd = openSync(D.log, "a")
      // detached:以独立进程组启动,结束时能连同子进程一起收掉(host.mjs killTree)
      const child = spawn(RT.node, cliArgs, {
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
    const fresh = readLogs().slice(logOffset)
    if (/EADDRINUSE/i.test(fresh)) {
      log(`[retry ${attempt}] 端口 ${port} 被抢占,换一个`)
      candidate = port + 1
      continue
    }
    if (!pidAlive(pid)) {
      fail("DEVSERVER_EXITED", "dev server 启动后立即退出", { log: D.log })
    }
    started = true
  }
  if (!started) fail("PORT_RACE", "连续 3 次端口都被抢占")

  const startedAt = new Date().toISOString()
  // 本脚本退出后没人持有这个进程 —— 登记下来,由宿主下次启动时清理
  try {
    registerPid(P.root, { pid, projectDir, startedAt, owner: "skill" })
  } catch (e) {
    log(`[warn] 登记 dev server pid 失败(不影响本次验证): ${e.message}`)
  }
  writeFileSync(D.record, JSON.stringify({ port, pid, projectDir, logPath: D.log, startedAt, owner: "skill" }, null, 2))
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
  // 服务进程已经没了就不可能等到编译结果 —— 立即失败,不要干等到超时
  if (pid && !pidAlive(pid)) {
    emit(`RESULT: FAIL | DEVSERVER_EXITED: dev server 进程已退出(pid=${pid})\nPORT: ${port}\nLOG: ${logPath()}\nDEVSERVER_LOG: ${D.log}\n`)
    block("LOG_TAIL", readLogs().split(/\r?\n/).filter((l) => l.trim()).slice(-40).join("\n"))
    process.exit(1)
  }
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
    // 编译通过不等于页面能渲染:漏 import webpack 编不出错,但浏览器里整页白屏。
    // 这是 verify 唯一能在"返回 OK"之前替模型兜住的一类运行时错误,不查白不查。
    //
    // **两类分两档,理由见 lib/lint.mjs 的文件头** —— 简言之不是按后果轻重
    // (两类都是 100% 白屏),而是按「判据在不在本文件内闭合」:组件可能被脚手架
    // 全局注册(lint 看不见那个文件)→ WARN;vue API 不存在全局注册 → FAIL。
    for (const r of lintMissingImports(writeDir)) {
      warn(`${path.relative(projectDir, r.file)} 用了 ${r.missing.join(" / ")} 但没有 import —— 页面会白屏,必须补上`)
    }

    const apiMisses = lintMissingVueApis(writeDir)
    if (apiMisses.length) {
      // 走 FAIL 而不是 warn():`ref` 漏 import 是 `ReferenceError` → setup 抛错 → 整页白屏,
      // 且 100% 可判定。WARN 在 SKILL.md 里的既定语义是"不阻塞、不用管",
      // 用它承载一个必然白屏的错误等于不查。
      //
      // **故意不输出 PREVIEW_CARD** —— 有它模型就可能直接跳到第 ⑤ 步宣布完成。
      // dev server 不受影响(仍在跑、服务记录已写),下一轮 verify 复用它,秒级返回。
      //
      // **契约行在前、块在后,与下面的 COMPILE_ERROR 分支同形**(§5.1.1)。
      // 人排障时的习惯动作是"从 `RESULT:` 那行往下截一段贴出去" —— 块要是放在
      // RESULT 之前,截出来的正好没有文件名和该补哪个 API,而那是这个块的全部价值。
      // 所以这里手写契约行(fail() 会立刻 exit,块排不到后面),用 emit() 保证同时落盘。
      //
      // 块内一律 ASCII 标签(`MISSING` / `ADD` 而不是"缺" / "补")——
      // 内网 Windows 终端代码页是 GBK,中文在截图/复制出来的片段里可能是乱码,
      // 而这个块的全部用途就是**被人原样贴到外网来定位**(§5.1.1、§8.4)。
      // 路径里的中文躲不掉(产物名可以是中文),但 API 名和那行 import 必须始终可读。
      emit(
        `RESULT: FAIL | MISSING_VUE_IMPORT: ${apiMisses.length} 个文件用了 vue 的 API 但没 import —— 运行时 ReferenceError,页面会整页白屏\n` +
          `HINT: 按下面 MISSING_IMPORTS 块给的 import 行补进对应文件,然后重跑 verify\n` +
          `PORT: ${port}\nPID: ${pid}\nPROJECT_DIR: ${projectDir}\nCOMPILE: OK\n` +
          `LOG: ${logPath()}\nDEVSERVER_LOG: ${D.log}\n`,
      )
      block(
        "MISSING_IMPORTS",
        apiMisses
          .map(
            (r) =>
              `${path.relative(projectDir, r.file)}\n  MISSING: ${r.missing.join(", ")}\n` +
              `  ADD: import { ${r.missing.join(", ")} } from 'vue'`,
          )
          .join("\n"),
      )
      process.exit(1)
    }
    ok({
      // 卡片只记产物,不记端口(SPEC-DES-004 §3.3):端口会过期,产物不会。
      // 整行拼好给模型原样输出,不让它自己拼。
      PREVIEW_CARD: `<artifact type="text/link">fastui://${name}</artifact>`,
      PORT: port,
      PID: pid,
      PROJECT_DIR: projectDir,
      REUSED: reused,
      COMPILE_MS: Date.now() - t0,
      LOG: D.log,
    })
  }

  const errors = extractErrors(last)
  // 用 emit() 而不是裸 process.stdout.write:后者绕过 persist,于是日志里只留下一个
  // 没有上文的 ERRORS 块,连"这是哪次、哪个端口、失败码是什么"都查不到(v15 S5 的遗漏)。
  // `LOG:` 两个失败分支指同一份(本脚本日志,自包含);webpack 原始输出另给一个 key,
  // 免得同一个 key 在不同分支指向不同文件、把顺着它去找的人带偏。
  emit(
    `RESULT: FAIL | COMPILE_ERROR: webpack 编译未通过\n` +
      `PORT: ${port}\nPID: ${pid}\nLOG: ${logPath()}\nDEVSERVER_LOG: ${D.log}\n`,
  )
  // ── 运行时不兼容的指纹:命中就把方向指对(§4.1 / §5.5)──────────────
  //
  // 我们**不设 node 版本门禁**(手上有能跑的 node 就用,不管大版本),因为拿猜出来的版本名单
  // 卡人的代价比风险本身大。代价是"node 大版本与老构建链不兼容"这类失败会以**编译错误**的
  // 形态出现 —— 而 SKILL.md 把 COMPILE_ERROR 定性成"你自己写的代码的问题,改完重跑",
  // 模型会拿着它去改 .vue **死循环**,永远不会怀疑 node。所以这里必须替它点出来。
  //
  // 判据是**精确字符串**,不是模糊猜测:这几条都是特定运行时错误的固定文本。
  // 没命中就什么都不打 —— 绝不在编译错误上追加"也许是 node 的问题"这种噪音。
  const RUNTIME_SIGNATURES = [
    ["ERR_OSSL_EVP_UNSUPPORTED", "node 17+ 带的 OpenSSL 3 不再提供老 webpack 用的 md4 哈希"],
    ["digital envelope routines", "同上 —— OpenSSL 3 的 EVP 不支持这个算法"],
    ["error:0308010C", "同上 —— OpenSSL 3 的错误码"],
    ["NODE_MODULE_VERSION", "有原生模块是给另一个 node 大版本编的(ABI 不匹配)"],
    ["was compiled against a different Node.js version", "同上 —— 原生模块 ABI 不匹配"],
  ]
  const sig = RUNTIME_SIGNATURES.find(([needle]) => errors.includes(needle))
  if (sig) {
    let ver = ""
    try {
      ver = execFileSync(RT.node, ["-v"], { encoding: "utf8" }).trim()
    } catch {
      /* 版本拿不到不影响这条提示的价值 */
    }
    // 同上一段:必须走 emit —— 裸 stdout.write 绕过 persist,这两行就不进 octo-fastui.log。
    // 而内网只能取到日志文件(或它的截图),这条又是 v16 去掉版本门禁之后**唯一**的补偿控制,
    // 不落盘等于没有。
    emit(
      `NODE_SUSPECT: ${sig[0]} —— ${sig[1]}\n` +
        `HINT: 这条编译错误**不是你写的代码的问题**,别改 .vue 重试。` +
        `当前 node 是 ${ver || "(取不到版本)"}(${RT.node})。` +
        `把这一行和 ERRORS 原样报给用户,并说明:换一个 node 大版本、或让安装脚本下载定版的 portable node` +
        `(install.sh --force-portable-node / install.ps1 -ForcePortableNode)可以绕开\n`,
    )
  }
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

// 同 COMPILE_ERROR 那段:走 emit 才落盘。超时是最难排查的一种失败,
// 而它恰恰最依赖事后翻日志 —— 这三行以前一个字都不进 octo-fastui.log。
emit(
  `RESULT: FAIL | COMPILE_TIMEOUT: 等待编译结果超过 ${timeoutMs / 1000} 秒\n` +
    `STAGE: ${stage}\nROUNDS_SEEN: ${roundsSeen}\nPORT: ${port}\nPID: ${pid}\n` +
    `HINT: ${stageHint}\nLOG: ${logPath()}\nDEVSERVER_LOG: ${D.log}\n`,
)
block("LOG_TAIL", tailLines)
process.exit(1)
