#!/usr/bin/env node
/**
 * new-session / export-zip 的回归测试(SPEC-DES-008 §7.1 A1–A13、E1)。
 *
 * 真模板只在内网有,这里把整个 skill 复制到临时目录、配一个只含关键文件的假模板再原样调用 ——
 * 脚本靠 import.meta.url 推 skill 根,所以不需要往生产代码里加任何测试开关。
 * 用法: node scripts/new-session.test.mjs
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL_SRC = path.dirname(HERE)
const TEMPLATE_FILES = [
  "package.json",
  "yarn.lock",
  "packages/portal/turboui.config.js",
  "packages/portal/src/main.vue",
  "packages/portal/src/views/index.vue",
]

function sandbox({ templateMissing } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fastui-newsession-")))
  const skill = path.join(root, "skill")
  cpSync(path.join(SKILL_SRC, "scripts"), path.join(skill, "scripts"), { recursive: true })
  cpSync(path.join(SKILL_SRC, "SKILL.md"), path.join(skill, "SKILL.md"))
  cpSync(path.join(SKILL_SRC, "references"), path.join(skill, "references"), { recursive: true })
  for (const rel of TEMPLATE_FILES) {
    if (rel === templateMissing) continue
    const p = path.join(skill, "template", ...rel.split("/"))
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, rel.endsWith(".vue") ? "<template><div/></template>" : "{}")
  }
  const env = path.join(root, "env")
  mkdirSync(path.join(env, "deps", "node_modules"), { recursive: true })
  const ws = path.join(root, "ws")
  mkdirSync(ws, { recursive: true })
  return { root, skill, env, ws }
}

function run(sb, script, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(sb.skill, "scripts", script), ...args], {
    env: { ...process.env, OCTO_FASTUI_ENV_DIR: sb.env, OCTO_SESSION_ID: "", OCTO_WORKSPACE_DIR: "", ...env },
    encoding: "utf8",
  })
  const out = `${r.stdout}${r.stderr}`
  return { code: r.status, out, result: (out.match(/^RESULT: .*$/m) || [""])[0] }
}
const newSession = (sb, args, env) => run(sb, "new-session.mjs", args, env)
const field = (out, key) => (out.match(new RegExp(`^${key}: (.*)$`, "m")) || [])[1]
const marker = (dir) => JSON.parse(readFileSync(path.join(dir, ".octo-fastui.json"), "utf8"))
const s1 = (sb) => ({ OCTO_SESSION_ID: "s1", OCTO_WORKSPACE_DIR: sb.ws })
const s2 = (sb) => ({ OCTO_SESSION_ID: "s2", OCTO_WORKSPACE_DIR: sb.ws })
const expect = (cond, msg, r) => {
  if (!cond) throw new Error(`${msg}${r ? `\n${r.out.slice(-700)}` : ""}`)
}
/** 目录内容快照(相对路径 + 内容),用来断言「一个字节都没动」 */
function snapshot(dir) {
  const out = []
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) out.push(`${r}->link`)
      else if (e.isDirectory()) walk(p, r)
      else out.push(`${r}=${readFileSync(p, "utf8")}`)
    }
  }
  walk(dir, "")
  return out.join("\n")
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test("A1:代码布局新建 —— 工程在工作区下,标记记本会话,父目录不落任何文件", () => {
  const sb = sandbox()
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha", "--title=用户列表"], s1(sb))
  expect(r.result === "RESULT: OK", `期望 OK,实际 ${r.result}`, r)
  expect(field(r.out, "MODE") === "created", "MODE 应为 created", r)
  const dir = path.join(sb.ws, "alpha")
  expect(field(r.out, "PROJECT_DIR") === dir, "PROJECT_DIR 不对", r)
  const m = marker(dir)
  expect(m.schema === 1 && m.title === "用户列表" && JSON.stringify(m.sessions) === '["s1"]', `标记不对:${JSON.stringify(m)}`)
  expect(!("projectDir" in m), "标记不该记绝对路径")
  expect(lstatSync(path.join(dir, "node_modules")).isSymbolicLink(), "node_modules 应是链接")
  expect(JSON.stringify(readdirSync(sb.root).sort()) === '["env","skill","ws"]', `工作区父目录多出了文件:${readdirSync(sb.root)}`)
})

test("A2:同会话重跑 —— 复用,不报撞名", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  expect(r.result === "RESULT: OK" && field(r.out, "MODE") === "reused", `期望复用,实际 ${r.result}`, r)
})

test("A3/A4:别的会话建的工程 —— 不带 --reuse 报 NAME_TAKEN 且不动目录;带了才复用并记上本会话", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha", "--title=用户列表"], s1(sb))
  const dir = path.join(sb.ws, "alpha")
  const before = snapshot(dir)
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s2(sb))
  expect(r.result.includes("NAME_TAKEN"), `期望 NAME_TAKEN,实际 ${r.result}`, r)
  expect(/PROJECTS_BEGIN\nalpha \| 用户列表 \|.*this-session: no\nPROJECTS_END/.test(r.out), "应附上工程列表", r)
  expect(snapshot(dir) === before, "NAME_TAKEN 时目录不应变化")

  const r2 = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha", "--reuse"], s2(sb))
  expect(field(r2.out, "MODE") === "reused" && field(r2.out, "REUSED_FROM") === "other-session", "应复用并注明来自别的对话", r2)
  expect(JSON.stringify(marker(dir).sessions) === '["s1","s2"]', `sessions 不对:${marker(dir).sessions}`)
  expect(marker(dir).title === "用户列表", "复用时不传 --title 应保留原标题")
})

test("A5:同名的普通文件夹 —— 加不加 --reuse 都报 NAME_TAKEN,内容一个字节不变", () => {
  const sb = sandbox()
  const dir = path.join(sb.ws, "beta")
  mkdirSync(dir)
  writeFileSync(path.join(dir, "cover.png"), "设计师的图")
  const before = snapshot(dir)
  for (const extra of [[], ["--reuse"], ["--reuse", "--reset"]]) {
    const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=beta", ...extra], s1(sb))
    expect(r.result.includes("NAME_TAKEN"), `${extra.join(" ")} 期望 NAME_TAKEN,实际 ${r.result}`, r)
  }
  expect(snapshot(dir) === before, "普通文件夹被改动了")
})

test("A6:参数缺失或越界 —— 响亮失败,不给默认值", () => {
  const sb = sandbox()
  const noName = newSession(sb, [`--artifact-dir=${sb.ws}`], s1(sb))
  expect(noName.result.includes("BAD_USAGE") && noName.out.includes("--name"), `缺 --name 应 BAD_USAGE`, noName)
  expect(!existsSync(path.join(sb.ws, "fastui-app")), "不应再有默认产物名 fastui-app")
  const noDir = newSession(sb, ["--name=alpha"], s1(sb))
  expect(noDir.result.includes("BAD_USAGE") && noDir.out.includes("[Workspace]"), "缺 --artifact-dir 应 BAD_USAGE 并提示取值规则", noDir)
  const outside = newSession(sb, [`--artifact-dir=${sb.root}`, "--name=alpha"], s1(sb))
  expect(outside.result.includes("OUTSIDE_WORKSPACE"), `工作区外应 OUTSIDE_WORKSPACE,实际 ${outside.result}`, outside)
  expect(!existsSync(path.join(sb.root, "alpha")), "工作区外不应建出任何东西")
})

test("A7:旧布局 —— 复用旧工程,并在工程根补写标记", () => {
  const sb = sandbox()
  const session = path.join(sb.ws, ".octo", "s1")
  const dir = path.join(session, "outputs", "alpha")
  for (const rel of TEMPLATE_FILES) {
    const p = path.join(dir, ...rel.split("/"))
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, "old")
  }
  writeFileSync(path.join(session, ".octo-fastui.json"), JSON.stringify({ name: "alpha", projectDir: dir }))
  const r = newSession(sb, [`--artifact-dir=${path.join(session, "outputs")}`, "--name=alpha"], s1(sb))
  expect(field(r.out, "MODE") === "reused", `期望复用旧工程,实际 ${r.result}`, r)
  expect(marker(dir).sessions.includes("s1"), "应补写标记并记上 s1")
  expect(readFileSync(path.join(dir, "package.json"), "utf8") === "old", "旧工程内容不应被覆盖")
})

test("A8:模板不完整 —— 不留下工程目录,也不留临时目录;上次中断的临时目录被清掉", () => {
  const bad = sandbox({ templateMissing: "yarn.lock" })
  const r = newSession(bad, [`--artifact-dir=${bad.ws}`, "--name=alpha"], s1(bad))
  expect(r.result.includes("TEMPLATE_INCOMPLETE"), `期望 TEMPLATE_INCOMPLETE,实际 ${r.result}`, r)
  expect(readdirSync(bad.ws).length === 0, `工作区里不应留下任何东西:${readdirSync(bad.ws)}`)

  const sb = sandbox()
  const stale = path.join(sb.ws, ".alpha.creating-999999")
  mkdirSync(stale)
  writeFileSync(path.join(stale, "half"), "x")
  const ok = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  expect(ok.result === "RESULT: OK", `期望 OK,实际 ${ok.result}`, ok)
  expect(!existsSync(stale), "上次中断的临时目录应被清掉")
})

test("A9:--reset 只对本 skill 的残缺工程生效", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  const dir = path.join(sb.ws, "alpha")
  rmSync(path.join(dir, "package.json"))
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  expect(r.result.includes("PROJECT_INCOMPLETE"), `期望 PROJECT_INCOMPLETE,实际 ${r.result}`, r)
  const r2 = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha", "--reset"], s1(sb))
  expect(field(r2.out, "MODE") === "created" && existsSync(path.join(dir, "package.json")), "--reset 应重建", r2)
})

test("A10:--list —— 按会话标出是不是本对话的,旧布局在会话目录里照样列出", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha", "--title=甲"], s1(sb))
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=beta", "--title=乙"], s2(sb))
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--list"], s1(sb))
  expect(field(r.out, "PROJECT_COUNT") === "2", "应列出 2 个", r)
  expect(/^alpha \| 甲 \|.*this-session: yes$/m.test(r.out) && /^beta \| 乙 \|.*this-session: no$/m.test(r.out), "本会话标记不对", r)

  const session = path.join(sb.ws, ".octo", "s1")
  mkdirSync(path.join(session, "outputs", "old", "packages", "portal"), { recursive: true })
  writeFileSync(path.join(session, ".octo-fastui.json"), "{}")
  const legacy = newSession(sb, [`--artifact-dir=${path.join(session, "outputs")}`, "--list"], s1(sb))
  expect(/^old \| old \|.*this-session: yes$/m.test(legacy.out), "旧布局工程应列出且属于 s1", legacy)
})

test("A11:宿主在但心跳里没有 layout(旧版 Octo)—— HOST_OUTDATED;新版宿主收到只带工程目录的预热请求", () => {
  const sb = sandbox()
  writeFileSync(path.join(sb.env, ".octo-host.json"), JSON.stringify({ pid: process.pid }))
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  expect(r.result.includes("HOST_OUTDATED"), `期望 HOST_OUTDATED,实际 ${r.result}`, r)
  expect(!existsSync(path.join(sb.ws, "alpha")), "旧宿主下不应建工程")

  writeFileSync(path.join(sb.env, ".octo-host.json"), JSON.stringify({ pid: process.pid, layout: 2 }))
  const r2 = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  expect(r2.result === "RESULT: OK", `新宿主下期望 OK,实际 ${r2.result}`, r2)
  const reqDir = path.join(sb.env, ".devserver-requests")
  const req = JSON.parse(readFileSync(path.join(reqDir, readdirSync(reqDir).find((f) => f.endsWith(".json"))), "utf8"))
  expect(req.projectDir === path.join(sb.ws, "alpha") && req.name === "alpha" && !("sessionDir" in req), `请求格式不对:${JSON.stringify(req)}`)
})

test("A12:没有会话上下文(终端直接跑)—— 有标记就复用,与现在行为一致", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"])
  expect(field(r.out, "MODE") === "reused", `期望复用,实际 ${r.result}`, r)
})

test("A13:别的 skill 的工程 —— 带 --reuse 也不复用,--list 不列出", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  const dir = path.join(sb.ws, "alpha")
  const m = marker(dir)
  writeFileSync(path.join(dir, ".octo-fastui.json"), JSON.stringify({ ...m, skill: "some-other-skill" }))
  const r = newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha", "--reuse"], s1(sb))
  expect(r.result.includes("NAME_TAKEN") && r.out.includes("some-other-skill"), `期望 NAME_TAKEN,实际 ${r.result}`, r)
  const list = newSession(sb, [`--artifact-dir=${sb.ws}`, "--list"], s1(sb))
  expect(field(list.out, "PROJECT_COUNT") === "0", "别的 skill 的工程不应列出", list)
})

test("E1:export-zip —— 不带依赖链接、运行时目录与标记,zip 落在工程的运行时目录", () => {
  const sb = sandbox()
  newSession(sb, [`--artifact-dir=${sb.ws}`, "--name=alpha"], s1(sb))
  const dir = path.join(sb.ws, "alpha")
  mkdirSync(path.join(dir, ".octo-fastui"), { recursive: true })
  writeFileSync(path.join(dir, ".octo-fastui", "devserver.json"), "{}")
  const r = run(sb, "export-zip.mjs", [`--project-dir=${dir}`], s1(sb))
  expect(r.result === "RESULT: OK", `期望 OK,实际 ${r.result}`, r)
  expect(field(r.out, "ZIP_PATH") === path.join(dir, ".octo-fastui", "export", "alpha.zip"), `ZIP_PATH 不对:${field(r.out, "ZIP_PATH")}`, r)
  const zip = readFileSync(field(r.out, "ZIP_PATH")).toString("latin1")
  expect(zip.includes("package.json"), "zip 里应有 package.json")
  for (const bad of ["node_modules", ".octo-fastui/", ".octo-fastui.json"]) expect(!zip.includes(bad), `zip 里不应有 ${bad}`)
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
console.log(`\n${passed} / ${tests.length} 通过,耗时 ${Date.now() - t0}ms`)
process.exit(passed === tests.length ? 0 : 1)
