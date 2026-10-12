#!/usr/bin/env node
/**
 * verify 与宿主协作的回归测试(SPEC-DES-004 §3.7)。
 *
 * 用假 dev server 真起进程、真占端口;verify.mjs 原样调用。
 * 用法: node scripts/verify.test.mjs
 */
import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { START_MARK } from "./lib/host.mjs"
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

function sandbox() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fastui-verify-")))
  const env = path.join(root, "env")
  const cli = path.join(env, "deps", "node_modules", "@turboui", "turbo-ui-cli-service")
  mkdirSync(path.join(cli, "bin"), { recursive: true })
  writeFileSync(path.join(cli, "package.json"), JSON.stringify({ name: "fake", bin: { "turbo-ui-cli-service": "bin/cli.js" } }))
  writeFileSync(path.join(cli, "bin", "cli.js"), FAKE_SERVER.replace('process.env.FAKE_COMPILE === "ok"', "true"))
  const session = path.join(root, "work", ".octo", "s1")
  const projectDir = path.join(session, "outputs", "alpha")
  mkdirSync(path.join(projectDir, "packages", "portal", "src", "views"), { recursive: true })
  writeFileSync(path.join(projectDir, "packages", "portal", "src", "views", "index.vue"), "<template><div/></template>")
  writeFileSync(path.join(session, ".octo-fastui.json"), JSON.stringify({ name: "alpha", projectDir }))
  const dev = path.join(session, "devservers")
  mkdirSync(dev, { recursive: true })
  return {
    root,
    env,
    session,
    projectDir,
    portal: path.join(projectDir, "packages", "portal"),
    record: path.join(dev, "alpha.json"),
    log: path.join(dev, "alpha.log"),
  }
}

function runVerify(sb, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VERIFY, `--session-dir=${sb.session}`, ...extra], {
      env: { ...process.env, OCTO_FASTUI_ENV_DIR: sb.env },
    })
    let out = ""
    child.stdout.on("data", (b) => (out += b))
    child.stderr.on("data", (b) => (out += b))
    const started = Date.now()
    child.on("exit", (code) => resolve({ code, out, ms: Date.now() - started, result: (out.match(/^RESULT: .*$/m) || [""])[0] }))
    children.push(child)
  })
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
  let stop = false
  const host = (async () => {
    while (!stop) {
      let files = []
      try {
        files = readdirSync(reqDir).filter((f) => f.endsWith(".json"))
      } catch {}
      for (const f of files) {
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
})

test("以前留下的 error 记录不作数 —— 不在 Octo 里时照常自己起", async () => {
  const sb = sandbox()
  writeFileSync(sb.record, JSON.stringify({ projectDir: sb.projectDir, status: "error", error: "old", at: Date.now() - 60_000 }))
  const r = await runVerify(sb, ["--timeout=40"])
  if (!r.result.startsWith("RESULT: OK")) throw new Error(`期望 OK,实际 ${r.result}\n${r.out.slice(-800)}`)
  const pid = Number(field(r.out, "PID"))
  if (pid) children.push({ kill: () => { try { process.kill(-pid, "SIGKILL") } catch { try { process.kill(pid) } catch {} } } })
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
  const pid = Number(field(r.out, "PID"))
  if (pid) children.push({ kill: () => { try { process.kill(-pid, "SIGKILL") } catch { try { process.kill(pid) } catch {} } } })
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
