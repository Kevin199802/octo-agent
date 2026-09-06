#!/usr/bin/env node
/**
 * new-session —— 创建会话工程(SPEC-DES-001 §5.3)
 *
 * 用法: node new-session.mjs --artifact-dir=<[Artifact Folder] 绝对路径> [--name=<产物名>] [--env-dir=]
 *
 * [Artifact Folder] 就是 .octo/<sessionId>/outputs(Design 现行约定,§3.2)。
 * 依赖链接建在它的父级 —— 产物目录里因此零链接,设计师随手压缩是安全的。
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ok, fail, usage, log, parseArgs } from "./lib/result.mjs"
import { TEMPLATE_DIR, envDir, envPaths, readManifest, sessionPaths, readJson, exists } from "./lib/paths.mjs"
import { claimPort, findFreePort } from "./lib/port.mjs"
import { ensureDirLink } from "./lib/link.mjs"

const args = parseArgs()
if (!args["artifact-dir"]) usage("缺少 --artifact-dir=<[Artifact Folder] 绝对路径>")

const manifest = readManifest()
const P = envPaths(envDir(args["env-dir"]))
const S = sessionPaths(String(args["artifact-dir"]))
const name = String(args.name || "fastui-app")
if (!/^[\w.\-一-龥]+$/.test(name)) usage(`--name 含非法字符: ${name}`)

const projectDir = path.join(S.outputs, name)
const writeDir = path.join(projectDir, "packages", "portal", "src", "views")

if (!exists(P.depsModules)) {
  fail("ENV_MISSING", `共享依赖池不存在: ${P.depsModules}`, { hint: "先跑 ensure-env.mjs" })
}

// ① 依赖链接建在会话根(outputs 的父级)
let linkState
try {
  mkdirSync(S.sessionRoot, { recursive: true })
  linkState = ensureDirLink(S.link, P.depsModules)
} catch (e) {
  fail("LINK_FAILED", `建依赖链接失败: ${e.message}`, {
    hint: process.platform === "win32" ? "确认目标盘是 NTFS 且路径无中文以外的特殊字符" : undefined,
  })
}

// ② 复制工程骨架。已存在则整体跳过 —— 绝不覆盖用户/模型已经写过的东西。
let reused = false
if (exists(projectDir)) {
  reused = true
  log(`[skip] 产物目录已存在,复用: ${projectDir}`)
} else {
  mkdirSync(S.outputs, { recursive: true })
  try {
    cpSync(TEMPLATE_DIR, projectDir, { recursive: true, dereference: false, errorOnExist: true, force: false })
  } catch (e) {
    fail("COPY_FAILED", `复制模板失败: ${e.message}`)
  }
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
  SESSION_STATE: S.state,
  LINK: `${S.link} -> ${P.depsModules} (${linkState})`,
  REUSED: reused,
})
