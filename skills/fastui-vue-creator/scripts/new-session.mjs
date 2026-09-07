#!/usr/bin/env node
/**
 * new-session —— 创建会话工程(SPEC-DES-001 §5.3)
 *
 * 用法: node new-session.mjs --artifact-dir=<[Artifact Folder] 绝对路径> [--name=<产物名>] [--env-dir=]
 *
 * [Artifact Folder] 就是 .octo/<sessionId>/outputs(Design 现行约定,§3.2)。
 * 依赖链接建在它的父级 —— 产物目录里因此零链接,设计师随手压缩是安全的。
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, usage, log, parseArgs } from "./lib/result.mjs"
import { SKILL_DIR, TEMPLATE_DIR, envDir, envPaths, readManifest, sessionPaths, readJson, exists } from "./lib/paths.mjs"
import { claimPort, findFreePort } from "./lib/port.mjs"
import { ensureDirLink } from "./lib/link.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 有会话上下文的脚本一律写**会话目录**,和 devserver.log 放在一起 ——
// 排查时只需要看一个目录,不用在共享池和会话目录之间来回找(§5.1.1)。
// 会话目录此刻可能还没解析出来,先挂共享池,解析出来后再改指向。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))
if (!args["artifact-dir"]) usage("缺少 --artifact-dir=<[Artifact Folder] 绝对路径>")

const manifest = readManifest()
const P = envPaths(envDir(args["env-dir"]))
const S = sessionPaths(String(args["artifact-dir"]))
const name = String(args.name || "fastui-app")
if (!/^[\w.\-一-龥]+$/.test(name)) usage(`--name 含非法字符: ${name}`)

const projectDir = path.join(S.outputs, name)
// 会话目录已知,日志改写这里 —— 与 devserver.log 同目录,一处就能看全
setLogSink(path.join(S.sessionRoot, "octo-fastui.log"))
const writeDir = path.join(projectDir, "packages", "portal", "src", "views")

if (!exists(P.depsModules)) {
  fail("ENV_MISSING", `共享依赖池不存在: ${P.depsModules}`, { hint: "先跑 ensure-env.mjs" })
}

// 复制完必须齐的关键文件。少一个后面都会以"编译报找不到模块"的形态爆出来,
// 而那时根因(复制没完成)已经隔了好几步,极难往回追 —— 内网实测踩过一次:
// 复制中断后 config/index.ts 引用的 ../../../package.json 不存在,报到编译阶段才发现。
const REQUIRED_FILES = [
  "package.json",
  "yarn.lock",
  "packages/portal/turboui.config.js",
  "packages/portal/src/main.vue",
  "packages/portal/src/views/index.vue",
]

function missingFiles(root) {
  return REQUIRED_FILES.filter((rel) => !exists(path.join(root, ...rel.split("/"))))
}

// ① 复制工程骨架。已存在则整体跳过 —— 绝不覆盖用户/模型已经写过的东西。
let reused = false
if (exists(projectDir)) {
  // 但"已存在"不等于"完整":上次复制到一半失败留下的残骸也会走到这里,
  // 然后被当成正常会话跳过复制,于是**永远修不好**。所以先验一遍。
  const missing = missingFiles(projectDir)
  if (missing.length) {
    fail("PROJECT_INCOMPLETE", `产物目录已存在但缺少 ${missing.length} 个关键文件`, {
      hint: `多半是上次复制中断留下的残骸。删掉 ${projectDir} 后重跑本脚本即可重建`,
      extra: { MISSING: missing.join(", ") },
    })
  }
  reused = true
  log(`[skip] 产物目录已存在,复用: ${projectDir}`)
} else {
  mkdirSync(S.outputs, { recursive: true })
  try {
    cpSync(TEMPLATE_DIR, projectDir, { recursive: true, dereference: false, errorOnExist: true, force: false })
  } catch (e) {
    // 复制失败要把半成品删掉,否则下次跑会因为"目录已存在"跳过复制,残缺状态被固化
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {
      /* 删不掉就让下面的自检去报 */
    }
    fail("COPY_FAILED", `复制模板失败: ${e.message}`, {
      hint: `源: ${TEMPLATE_DIR}\n目标: ${projectDir}\n路径含中文或超长时 Windows 上更容易失败,可先换一个纯英文短路径的项目目录试`,
    })
  }

  const missing = missingFiles(projectDir)
  if (missing.length) {
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
    fail("TEMPLATE_INCOMPLETE", `模板复制完成但缺少 ${missing.length} 个关键文件`, {
      hint: `已清理半成品目录,可直接重跑。若反复出现,说明模板本身就不完整,检查 ${TEMPLATE_DIR}`,
      extra: { MISSING: missing.join(", ") },
    })
  }
}

// ② 依赖链接建在工程根 —— 标准布局,`yarn serve` 在产物目录里直接可用(v12)
let linkState
try {
  linkState = ensureDirLink(path.join(projectDir, "node_modules"), P.depsModules)
} catch (e) {
  fail("LINK_FAILED", `建依赖链接失败: ${e.message}`, {
    hint: process.platform === "win32" ? "确认目标盘是 NTFS 且路径无中文以外的特殊字符" : undefined,
  })
}

// ③ 分配端口。已有状态文件且那个端口还空着就沿用,免得每次调用都换端口。
const prev = readJson(S.state)
let port = null
if (prev?.port) {
  const { probe } = await import("./lib/port.mjs")
  if (await probe(prev.port)) port = prev.port
  else if (prev.projectDir === projectDir) port = prev.port // 被自己的 dev server 占着
}
if (!port) {
  const octoRoot = path.dirname(S.sessionRoot)
  port = await findFreePort(Number(manifest.portRangeStart) || 8081, 50, (p) => claimPort(octoRoot, p, S.sessionRoot))
}
if (!port) fail("NO_FREE_PORT", `从 ${manifest.portRangeStart} 起连续 50 个端口都被占用`)

const state = {
  name,
  projectDir,
  writeDir,
  port,
  envDir: P.root,
  depsDir: P.depsModules,
  // 宿主要调 scripts/export-zip.mjs 打交付包(§8.6.2),得知道 skill 装在哪。
  // 让它自己去猜是不可靠的:skill 目录随平台/配置而变,而 XDG_CONFIG_HOME 在
  // Electron 主进程与 server 子进程之间还可能不一致 —— 唯一确定知道这个路径的是脚本自己。
  skillDir: SKILL_DIR,
  createdAt: prev?.createdAt ?? new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
writeFileSync(S.state, JSON.stringify(state, null, 2))

ok({
  PROJECT_DIR: projectDir,
  WRITE_DIR: writeDir,
  ENTRY_FILE: path.join(writeDir, "index.vue"),
  PORT: port,
  DEPS_DIR: P.depsModules,
  SKILL_DIR,
  SESSION_STATE: S.state,
  LINK: `${path.join(projectDir, "node_modules")} -> ${P.depsModules} (${linkState})`,
  REUSED: reused,
})
