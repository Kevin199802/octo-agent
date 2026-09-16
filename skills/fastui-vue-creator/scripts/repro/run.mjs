#!/usr/bin/env node
/**
 * SPEC-DES-004 §7.1 —— 预览服务身份与端口治理的自动化复现。
 *
 * **在外网跑,不需要内网组件库、不需要 skill 运行环境、不需要起 Octo。**
 * 用一个假 dev server 替换 @turboui/turbo-ui-cli-service,其余全是真代码:
 * new-session.mjs / verify.mjs / lib/port.mjs 一行未改地被调用。
 *
 *   node scripts/repro/run.mjs            # 跑全部用例
 *   node scripts/repro/run.mjs E2 E5      # 只跑指定用例
 *   node scripts/repro/run.mjs --keep     # 跑完保留工作目录(排查用)
 *
 * 退出码 0 = 全通过。修复之前预期 E2/E3/E4/E5 失败,那就是缺陷本身。
 */
import { spawn } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPRO_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_SRC = path.resolve(REPRO_DIR, "..", "..")
const argv = process.argv.slice(2)
const KEEP = argv.includes("--keep")
const ONLY = argv.filter((a) => /^E\d+$/i.test(a)).map((a) => a.toUpperCase())

// 起点选高位端口:复现脚本不该去抢设计师机器上真在用的 8081
const PORT_START = 18081

const LAB = mkdtempSync(path.join(tmpdir(), "fastui-repro-"))
const SKILL = path.join(LAB, "skill")
const SHARED_DEPS = path.join(LAB, "shared-deps", "node_modules")

/** 起过的 dev server,用例之间与退出时统一收 */
const spawned = new Set()

// ── 基础设施 ────────────────────────────────────────────────────

function setupLab() {
  // skill 副本:scripts 是真代码,template / references 换成 fixture
  mkdirSync(SKILL, { recursive: true })
  cpSync(path.join(SKILL_SRC, "scripts"), path.join(SKILL, "scripts"), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}repro`), // 别把自己复制进去
  })
  cpSync(path.join(REPRO_DIR, "fixtures", "fake-template"), path.join(SKILL, "template"), { recursive: true })
  mkdirSync(path.join(SKILL, "references"), { recursive: true })
  const manifest = JSON.parse(readFileSync(path.join(SKILL_SRC, "references", "env.manifest.json"), "utf8"))
  manifest.portRangeStart = PORT_START
  writeFileSync(path.join(SKILL, "references", "env.manifest.json"), JSON.stringify(manifest, null, 2))

  // 共享依赖池里只需要那一个包
  mkdirSync(path.join(SHARED_DEPS, "@turboui"), { recursive: true })
  cpSync(path.join(REPRO_DIR, "fixtures", "fake-cli"), path.join(SHARED_DEPS, "@turboui", "turbo-ui-cli-service"), {
    recursive: true,
  })
}

/** 每个用例一个独立共享池 —— 于是 .ports 登记表天然隔离,用例之间不互相污染 */
function envFor(caseId) {
  const dir = path.join(LAB, caseId, "env")
  mkdirSync(path.join(dir, "deps"), { recursive: true })
  symlinkSync(SHARED_DEPS, path.join(dir, "deps", "node_modules"), "dir")
  return dir
}

function run(script, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SKILL, "scripts", script), ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", (code) => resolve({ code, out }))
  })
}

/** 从脚本输出里取一行契约值 */
const field = (out, key) => out.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null

function get(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 3000 }, (res) => {
      let body = ""
      res.on("data", (d) => (body += d))
      res.on("end", () => resolve(body))
    })
    req.on("error", () => resolve(null))
    req.on("timeout", () => {
      req.destroy()
      resolve(null)
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })
}

/** 建会话并起服务 */
async function boot(caseId, projectRoot, sid, pageText, { listenDelayMs = 0 } = {}) {
  const envDir = path.join(LAB, caseId, "env")
  const artifactDir = path.join(projectRoot, ".octo", sid, "outputs")
  const sessionDir = path.dirname(artifactDir)
  const ns = await run("new-session.mjs", [`--artifact-dir=${artifactDir}`, "--name=app"], {
    OCTO_FASTUI_ENV_DIR: envDir,
  })
  const allocPort = Number(field(ns.out, "PORT"))
  const writeDir = field(ns.out, "WRITE_DIR")
  if (!writeDir) throw new Error(`new-session 失败:\n${ns.out}`)
  writeFileSync(path.join(writeDir, "index.vue"), `<template><div>${pageText}</div></template>\n`)
  const vf = await run("verify.mjs", [`--session-dir=${sessionDir}`, "--restart", "--timeout=60"], {
    OCTO_FASTUI_ENV_DIR: envDir,
    FAKE_LISTEN_DELAY_MS: String(listenDelayMs),
  })
  let pid = null
  try {
    pid = JSON.parse(readFileSync(path.join(sessionDir, ".devserver.json"), "utf8")).pid
    spawned.add(pid)
  } catch {
    /* 没起来 */
  }
  return {
    allocPort,
    port: Number(field(vf.out, "PORT")) || allocPort,
    card: field(vf.out, "PREVIEW_CARD"),
    sessionDir,
    pid,
    out: vf.out,
  }
}

function kill(pid) {
  if (!pid) return
  try {
    process.kill(pid)
  } catch {
    /* 已经没了 */
  }
  spawned.delete(pid)
}

function killAll() {
  for (const pid of [...spawned]) kill(pid)
}

// ── 用例 ────────────────────────────────────────────────────────

const CASES = [
  {
    id: "E1",
    title: "同一工作目录下 6 个会话并发 new-session",
    expect: "6 个互不相同的端口（改前改后都该通过，防回归）",
    async run(caseId) {
      const envDir = envFor(caseId)
      const root = path.join(LAB, caseId, "proj")
      const results = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((i) =>
          run("new-session.mjs", [`--artifact-dir=${path.join(root, ".octo", `s${i}`, "outputs")}`, "--name=app"], {
            OCTO_FASTUI_ENV_DIR: envDir,
          }),
        ),
      )
      const ports = results.map((r) => field(r.out, "PORT"))
      return { pass: new Set(ports).size === 6 && !ports.includes(null), detail: `分到的端口: ${ports.join(", ")}` }
    },
  },
  {
    id: "E2",
    title: "两个【不同工作目录】的会话并发 new-session",
    expect: "两个不同端口（修复前：两边都拿到同一个端口）",
    async run(caseId) {
      const envDir = envFor(caseId)
      const [a, b] = await Promise.all(
        ["p1", "p2"].map((p) =>
          run(
            "new-session.mjs",
            [`--artifact-dir=${path.join(LAB, caseId, p, ".octo", "s", "outputs")}`, "--name=app"],
            { OCTO_FASTUI_ENV_DIR: envDir },
          ),
        ),
      )
      const pa = field(a.out, "PORT")
      const pb = field(b.out, "PORT")
      return { pass: pa !== null && pb !== null && pa !== pb, detail: `目录1 -> ${pa}，目录2 -> ${pb}` }
    },
  },
  {
    id: "E3",
    title: "跨目录的两个会话并发起 dev server（模拟 webpack 先编译后 listen）",
    expect: "两个服务都活着且各自 serve 自己的工程（修复前：一个被 EADDRINUSE 打死）",
    async run(caseId) {
      envFor(caseId)
      const [a, b] = await Promise.all([
        boot(caseId, path.join(LAB, caseId, "p1"), "sA", "PAGE-A", { listenDelayMs: 3000 }),
        boot(caseId, path.join(LAB, caseId, "p2"), "sB", "PAGE-B", { listenDelayMs: 3000 }),
      ])
      const bodyA = await get(a.port)
      const bodyB = await get(b.port)
      const okA = Boolean(bodyA?.includes("PAGE-A"))
      const okB = Boolean(bodyB?.includes("PAGE-B"))
      const say = (body, ok) => (ok ? "自己的页面 OK" : body ? "内容不对" : "无响应")
      return {
        pass: okA && okB && a.port !== b.port,
        detail: `A :${a.port} -> ${say(bodyA, okA)}；B :${b.port} -> ${say(bodyB, okB)}`,
      }
    },
  },
  {
    id: "E4",
    title: "卡片端口只有一个来源（PREVIEW_CARD）",
    expect: "verify 输出 PREVIEW_CARD，端口 = 真实监听端口、title = 产物文件夹名（修复前：没有这一行）",
    async run(caseId) {
      envFor(caseId)
      const a = await boot(caseId, path.join(LAB, caseId, "p1"), "sA", "PAGE-A")
      if (!a.card) return { pass: false, detail: "verify 没有输出 PREVIEW_CARD 这一行" }
      const cardPort = Number(a.card.match(/127\.0\.0\.1:(\d+)/)?.[1])
      const cardTitle = a.card.match(/title="([^"]*)"/)?.[1]
      const body = await get(cardPort)
      const served = Boolean(body?.includes("PAGE-A"))
      return {
        pass: served && cardTitle === "app",
        detail: `card 端口 ${cardPort}（实际监听 ${a.port}，new-session 曾分配 ${a.allocPort}）；title="${cardTitle}"；该端口${served ? "正是本会话的服务" : "没有回本会话的页面"}`,
      }
    },
  },
  {
    id: "E5",
    title: "【端口回收改嫁】A 的服务没了之后，另一目录的新会话会不会捡走它的端口",
    expect: "新会话拿到别的端口，A 的旧卡片不会变成 B 的页面（修复前：B 捡走该端口，A 的旧卡片显示 B 的内容）",
    async run(caseId) {
      envFor(caseId)
      const a = await boot(caseId, path.join(LAB, caseId, "p1"), "sA", "PAGE-A")
      const oldCardPort = a.port
      kill(a.pid) // A 的 dev server 消失:宿主 LRU 淘汰 / Octo 重启 / 用户关窗口
      await sleep(800)
      if (!(await portFree(oldCardPort))) return { pass: false, detail: `杀不掉 A 的服务，:${oldCardPort} 仍被占用` }

      const b = await boot(caseId, path.join(LAB, caseId, "p2"), "sB", "PAGE-B")
      const bodyOnOldCard = await get(oldCardPort)
      const hijacked = Boolean(bodyOnOldCard?.includes("PAGE-B"))
      return {
        pass: b.port !== oldCardPort && !hijacked,
        detail: `A 的旧卡片端口 :${oldCardPort}；B 分到 :${b.port}；点 A 的旧卡片 -> ${hijacked ? "显示了 B 的页面（改嫁）" : bodyOnOldCard ? "显示了别的内容" : "无响应（正确：坏掉而不是串台）"}`,
      }
    },
  },
  {
    id: "E6",
    title: "同一工作目录下的端口回收（防回归）",
    expect: "新会话不捡走旧端口（改前改后都该通过）",
    async run(caseId) {
      envFor(caseId)
      const root = path.join(LAB, caseId, "proj")
      const a = await boot(caseId, root, "sA", "PAGE-A")
      const oldCardPort = a.port
      kill(a.pid)
      await sleep(800)
      const b = await boot(caseId, root, "sB", "PAGE-B")
      const bodyOnOldCard = await get(oldCardPort)
      const hijacked = Boolean(bodyOnOldCard?.includes("PAGE-B"))
      return {
        pass: b.port !== oldCardPort && !hijacked,
        detail: `A 的旧卡片端口 :${oldCardPort}；B 分到 :${b.port}；点 A 的旧卡片 -> ${hijacked ? "显示了 B 的页面" : "无响应 / 非 B（正确）"}`,
      }
    },
  },
]

// ── 主流程 ──────────────────────────────────────────────────────

async function main() {
  setupLab()
  const picked = ONLY.length ? CASES.filter((c) => ONLY.includes(c.id)) : CASES
  const results = []

  console.log(`工作目录: ${LAB}`)
  console.log(`端口起点: ${PORT_START}\n`)

  for (const c of picked) {
    process.stdout.write(`${c.id}  ${c.title} ... `)
    let r
    try {
      r = await c.run(c.id)
    } catch (e) {
      r = { pass: false, detail: `用例本身出错: ${e.message}` }
    }
    killAll()
    await sleep(500)
    console.log(r.pass ? "PASS" : "FAIL")
    console.log(`    期望: ${c.expect}`)
    console.log(`    实际: ${r.detail}\n`)
    results.push({ ...c, ...r })
  }

  const failed = results.filter((r) => !r.pass)
  console.log("-".repeat(72))
  console.log(
    `${results.length - failed.length}/${results.length} 通过` +
      (failed.length ? `    失败: ${failed.map((f) => f.id).join(", ")}` : ""),
  )
  if (KEEP) console.log(`\n工作目录已保留: ${LAB}`)
  return failed.length === 0
}

const cleanup = () => {
  killAll()
  if (!KEEP) {
    try {
      rmSync(LAB, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  }
}
process.on("exit", cleanup)
process.on("SIGINT", () => process.exit(130))

main().then(
  (allPass) => process.exit(allPass ? 0 : 1),
  (e) => {
    console.error(e)
    process.exit(2)
  },
)
