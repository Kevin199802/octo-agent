#!/usr/bin/env node
/**
 * verify 与宿主协作的回归测试(SPEC-DES-004 §3.7)。
 *
 * 用假 dev server 真起进程、真占端口;verify.mjs 原样调用。
 * 用法: node scripts/verify.test.mjs
 */
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { START_MARK } from "./lib/host.mjs"
import { readSkillName } from "./lib/paths.mjs"
import { writeMarker } from "./lib/project.mjs"
import { probe } from "./lib/port.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VERIFY = path.join(HERE, "verify.mjs")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 假 dev server:监听 OCTO_PORT;FAKE_COMPILE=ok 时在 listen 后打一轮成功编译,否则只打「开始」
const FAKE_SERVER = `
const port = Number(process.env.OCTO_PORT)
console.log("Compiling...")
require("http").createServer((_q, r) => r.end(process.cwd())).listen(port, "127.0.0.1", () => {
  if (process.env.FAKE_COMPILE === "ok") setTimeout(() => console.log("Compiled successfully in 10ms"), 300)
})
`

const children = []
function fakeServer({ cwd, port, log, compile }) {
  const fd = log ? ["ignore", "pipe", "pipe"] : "ignore"
  const child = spawn(process.execPath, ["-e", FAKE_SERVER], {
    cwd,
    env: { ...process.env, OCTO_PORT: String(port), FAKE_COMPILE: compile ? "ok" : "" },
    stdio: fd,
  })
  if (log) {
    child.stdout.on("data", (b) => appendFileSync(log, b))
    child.stderr.on("data", (b) => appendFileSync(log, b))
  }
  children.push(child)
  return child
}

const SKILL_NAME = readSkillName()

/**
 * 新布局沙箱(SPEC-DES-008):工程在 `<工作区>/alpha`,工程根带标记,运行时文件在 `alpha/.octo-fastui/`。
 * `legacy: true` 时搭旧布局:`<工作区>/.octo/s1/outputs/alpha`,状态文件在会话目录。
 */
function sandbox({ legacy = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fastui-verify-")))
  const env = path.join(root, "env")
  const cli = path.join(env, "deps", "node_modules", "@turboui", "turbo-ui-cli-service")
  mkdirSync(path.join(cli, "bin"), { recursive: true })
  writeFileSync(path.join(cli, "package.json"), JSON.stringify({ name: "fake", bin: { "turbo-ui-cli-service": "bin/cli.js" } }))
  writeFileSync(path.join(cli, "bin", "cli.js"), FAKE_SERVER.replace('process.env.FAKE_COMPILE === "ok"', "true"))
  const ws = path.join(root, "work")
  const session = path.join(ws, ".octo", "s1")
  const projectDir = legacy ? path.join(session, "outputs", "alpha") : path.join(ws, "alpha")
  mkdirSync(path.join(projectDir, "packages", "portal", "src", "views"), { recursive: true })
  writeFileSync(path.join(projectDir, "packages", "portal", "src", "views", "index.vue"), "<template><div/></template>")
  if (legacy) {
    mkdirSync(session, { recursive: true })
    writeFileSync(path.join(session, ".octo-fastui.json"), JSON.stringify({ name: "alpha", projectDir }))
  } else {
    writeMarker(projectDir, { schema: 1, skill: SKILL_NAME, name: "alpha", sessions: ["s1"] })
  }
  const dev = path.join(projectDir, ".octo-fastui")
  mkdirSync(dev, { recursive: true })
  return {
    root,
    env,
    ws,
    session,
    projectDir,
    portal: path.join(projectDir, "packages", "portal"),
    record: path.join(dev, "devserver.json"),
    log: path.join(dev, "devserver.log"),
  }
}

/** 默认按 --project-dir 调;`target` 传数组就用它替换定位参数(空数组 = 不传) */
function runVerify(sb, extra = [], { target, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VERIFY, ...(target ?? [`--project-dir=${sb.projectDir}`]), ...extra], {
      env: { ...process.env, OCTO_FASTUI_ENV_DIR: sb.env, OCTO_SESSION_ID: "", OCTO_WORKSPACE_DIR: "", ...env },
    })
    let out = ""
    child.stdout.on("data", (b) => (out += b))
    child.stderr.on("data", (b) => (out += b))
    const started = Date.now()
    child.on("exit", (code) => resolve({ code, out, ms: Date.now() - started, result: (out.match(/^RESULT: .*$/m) || [""])[0] }))
    children.push(child)
  })
}

/** verify 自己起的服务在测试结束时收掉 */
function reap(out) {
  const pid = Number(field(out, "PID"))
  if (pid) children.push({ kill: () => { try { process.kill(-pid, "SIGKILL") } catch { try { process.kill(pid) } catch {} } } })
}

const field = (out, key) => (out.match(new RegExp(`^${key}: (.*)$`, "m")) || [])[1]

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test("B1:verify 等待期间宿主换了服务进程 —— 跟到新进程,不误报 DEVSERVER_EXITED", async () => {
  const sb = sandbox()
  await sleep(50) // 让日志的 mtime 晚于 views 的 mtime
  appendFileSync(sb.log, `\n${START_MARK}18281\n`)
  const a = fakeServer({ cwd: sb.portal, port: 18281, log: sb.log, compile: false })
  await sleep(500)
  writeFileSync(sb.record, JSON.stringify({ port: 18281, pid: a.pid, projectDir: sb.projectDir, owner: "host", status: "ready" }))

  const pending = runVerify(sb, ["--timeout=40"])
  await sleep(2000)
  // 宿主重起服务:杀旧进程 → 写启动标记 → 起新进程 → 改写记录(与 fastui-devserver.ts 同序)
  a.kill()
  appendFileSync(sb.log, `\n${START_MARK}18282\n`)
  const b = fakeServer({ cwd: sb.portal, port: 18282, log: sb.log, compile: true })
  writeFileSync(sb.record, JSON.stringify({ port: 18282, pid: b.pid, projectDir: sb.projectDir, owner: "host", status: "ready" }))

  const r = await pending
  if (!r.result.startsWith("RESULT: OK")) throw new Error(`期望 OK,实际 ${r.result}\n${r.out.slice(-800)}`)
  if (field(r.out, "PORT") !== "18282") throw new Error(`期望跟到新端口 18282,实际 ${field(r.out, "PORT")}`)
  if (!/\[switch\]/.test(r.out)) throw new Error("没有看到切换到新进程的日志")
})

test("宿主报告起服务失败 —— verify 立即失败(HOST_START_FAILED),不白等、不自己起", async () => {
  const sb = sandbox()
  writeFileSync(path.join(sb.env, ".octo-host.json"), JSON.stringify({ pid: process.pid }))
  // 模拟宿主:收到请求就写一份 error 记录
  const reqDir = path.join(sb.env, ".devserver-requests")
  const requests = []
  let stop = false
  const host = (async () => {
    while (!stop) {
      let files = []
      try {
        files = readdirSync(reqDir).filter((f) => f.endsWith(".json"))
      } catch {}
      for (const f of files) {
        requests.push(JSON.parse(readFileSync(path.join(reqDir, f), "utf8")))
        rmSync(path.join(reqDir, f), { force: true })
        writeFileSync(sb.record, JSON.stringify({ projectDir: sb.projectDir, status: "error", error: "找不到用于启动预览服务的 node", at: Date.now() }))
      }
      await sleep(200)
    }
  })()
  const r = await runVerify(sb, ["--timeout=60"])
  stop = true
  await host
  if (!r.result.includes("HOST_START_FAILED")) throw new Error(`期望 HOST_START_FAILED,实际 ${r.result}\n${r.out.slice(-800)}`)
  if (r.ms > 10_000) throw new Error(`应当立即失败,实际用了 ${r.ms}ms`)
  if (/\[fallback\]/.test(r.out)) throw new Error("宿主在时不应自己起服务")
  // V4:请求只带工程目录(SPEC-DES-008 §3.5),宿主不再从会话目录推
  const req = requests[0]
  if (!req || req.projectDir !== sb.projectDir || req.name !== "alpha" || "sessionDir" in req) {
    throw new Error(`请求格式不对:${JSON.stringify(req)}`)
  }
})

test("以前留下的 error 记录不作数 —— 不在 Octo 里时照常自己起", async () => {
  const sb = sandbox()
  writeFileSync(sb.record, JSON.stringify({ projectDir: sb.projectDir, status: "error", error: "old", at: Date.now() - 60_000 }))
  const r = await runVerify(sb, ["--timeout=40"])
  if (!r.result.startsWith("RESULT: OK")) throw new Error(`期望 OK,实际 ${r.result}\n${r.out.slice(-800)}`)
  reap(r.out)
})

test("记录里的 pid 活着但端口不应答(pid 被复用)—— 不在它上面干等", async () => {
  const sb = sandbox()
  const bystander = spawn("sleep", ["60"], { stdio: "ignore" })
  children.push(bystander)
  writeFileSync(sb.record, JSON.stringify({ port: 18299, pid: bystander.pid, projectDir: sb.projectDir, owner: "host", status: "ready" }))
  const r = await runVerify(sb, ["--timeout=40"])
  if (!r.result.startsWith("RESULT: OK")) throw new Error(`期望 OK,实际 ${r.result}\n${r.out.slice(-800)}`)
  if (field(r.out, "PORT") === "18299") throw new Error("不应复用不应答的旧记录")
  if (r.ms > 15_000) throw new Error(`应当很快自己起好,实际 ${r.ms}ms`)
  reap(r.out)
})

test("端口探测:别人监听在 0.0.0.0 上时判为被占(只试绑 127.0.0.1 看不到)", async () => {
  const srv = net.createServer()
  await new Promise((r) => srv.listen(18310, "0.0.0.0", r))
  try {
    if (await probe(18310)) throw new Error("0.0.0.0 上已有监听,却被判为空闲")
  } finally {
    srv.close()
  }
  await sleep(100)
  if (!(await probe(18310))) throw new Error("端口释放后应判为空闲")
})

test("等待期间要周期性吐进度行 —— 被 agent 的 bash 超时掐断时,模型才拿得到 STAGE", async () => {
  const sb = sandbox()
  appendFileSync(sb.log, `\n${START_MARK}18320\n`)
  const a = fakeServer({ cwd: sb.portal, port: 18320, log: sb.log, compile: false })
  await sleep(600)
  writeFileSync(sb.record, JSON.stringify({ port: 18320, pid: a.pid, projectDir: sb.projectDir, owner: "host", status: "ready" }))
  // 模拟"watcher 没捕获到这次改动":views 的 mtime 比 dev server 日志新,而日志之后再没动静
  writeFileSync(path.join(sb.portal, "src", "views", "index.vue"), "<template><div/></template>")

  const r = await runVerify(sb, ["--timeout=6", "--progress-interval=2"])
  const waits = r.out.split(/\r?\n/).filter((l) => l.includes("[wait] STAGE:"))
  // 多于一行 = 真的是"边等边吐",不是只在超时后补打一行
  if (waits.length < 2) throw new Error(`期望等待期间有多行进度,实际 ${waits.length} 行\n${r.out.slice(-800)}`)
  if (!waits.every((l) => l.includes("WAITING_FOR_OUTPUT"))) throw new Error(`阶段应为 WAITING_FOR_OUTPUT:\n${waits.join("\n")}`)
  // 负数就是 watcher 嫌疑的那个判据 —— 它没打出来,这次改动等于白做
  if (!/LOG_VS_EDIT: -/.test(waits[waits.length - 1])) throw new Error(`进度行里没有负的 LOG_VS_EDIT:\n${waits.join("\n")}`)
  if (!r.result.includes("COMPILE_TIMEOUT")) throw new Error(`期望 COMPILE_TIMEOUT,实际 ${r.result}\n${r.out.slice(-800)}`)
  if (!/^LOG_VS_EDIT: -/m.test(r.out)) throw new Error("超时契约块里也该带 LOG_VS_EDIT")
})

test("V1:新布局 —— 运行时文件落在工程内,PREVIEW_CARD 用产物名", async () => {
  const sb = sandbox()
  const r = await runVerify(sb, ["--timeout=40"])
  reap(r.out)
  if (!r.result.startsWith("RESULT: OK")) throw new Error(`期望 OK,实际 ${r.result}\n${r.out.slice(-800)}`)
  if (!existsSync(sb.record)) throw new Error(`服务记录应在 ${sb.record}`)
  if (!/fastui:\/\/alpha</.test(r.out)) throw new Error("PREVIEW_CARD 不对")
  if (existsSync(path.join(sb.session, "devservers"))) throw new Error("不应再写会话级 devservers/")
})

test("V2:旧布局 + 旧参数 --session-dir —— 照样定位到旧工程", async () => {
  const sb = sandbox({ legacy: true })
  const r = await runVerify(sb, ["--timeout=40"], { target: [`--session-dir=${sb.session}`] })
  reap(r.out)
  if (!r.result.startsWith("RESULT: OK")) throw new Error(`期望 OK,实际 ${r.result}\n${r.out.slice(-800)}`)
  if (field(r.out, "PROJECT_DIR") !== sb.projectDir) throw new Error(`定位错了:${field(r.out, "PROJECT_DIR")}`)
})

test("V3:不传定位参数 —— 本会话恰好一个工程就用它,两个就报错列出候选", async () => {
  const sb = sandbox()
  const env = { OCTO_SESSION_ID: "s1", OCTO_WORKSPACE_DIR: sb.ws }
  const one = await runVerify(sb, ["--timeout=40"], { target: [], env })
  reap(one.out)
  if (!one.result.startsWith("RESULT: OK")) throw new Error(`一个工程时期望 OK,实际 ${one.result}\n${one.out.slice(-800)}`)

  const beta = path.join(sb.ws, "beta")
  mkdirSync(path.join(beta, "packages", "portal"), { recursive: true })
  writeMarker(beta, { schema: 1, skill: SKILL_NAME, name: "beta", sessions: ["s1"] })
  const two = await runVerify(sb, ["--timeout=40"], { target: [], env })
  if (!two.result.includes("NO_PROJECT")) throw new Error(`两个工程时期望 NO_PROJECT,实际 ${two.result}`)
  if (!/PROJECTS_BEGIN[\s\S]*alpha[\s\S]*PROJECTS_END/.test(two.out) || !/beta \|/.test(two.out)) {
    throw new Error(`应列出两个候选:\n${two.out.slice(-600)}`)
  }
})

test("--project-dir 指向不是工程的目录 —— NO_PROJECT,不往上猜", async () => {
  const sb = sandbox()
  const r = await runVerify(sb, [], { target: [`--project-dir=${sb.ws}`] })
  if (!r.result.includes("NO_PROJECT")) throw new Error(`期望 NO_PROJECT,实际 ${r.result}`)
})

let passed = 0
const t0 = Date.now()
for (const t of tests) {
  try {
    await t.fn()
    passed++
    console.log(`PASS ${t.name}`)
  } catch (e) {
    console.log(`FAIL ${t.name}\n  ${String(e.message).split("\n").join("\n  ")}`)
  }
}
for (const c of children) {
  try {
    c.kill()
  } catch {}
}
console.log(`\n${passed} / ${tests.length} 通过,耗时 ${Date.now() - t0}ms`)
process.exit(passed === tests.length ? 0 : 1)
