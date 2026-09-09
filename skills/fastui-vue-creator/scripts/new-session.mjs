#!/usr/bin/env node
/**
 * new-session —— 创建会话工程(SPEC-DES-001 §5.3)
 *
 * 用法: node new-session.mjs --artifact-dir=<[Artifact Folder] 绝对路径> [--name=<产物名>] [--env-dir=] [--reset]
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

/**
 * 删半成品前的护栏(v14)。
 *
 * `projectDir` 是 `--artifact-dir` 拼出来的,参数传空、传错、或被中文路径截断时,
 * 它可能解析到完全意外的位置 —— 而 `rmSync(recursive, force)` 不可逆、不进回收站。
 *
 * 2026-09-07 内网出过一次 agent 误删用户磁盘目录的事故(§5.1.2)。那次不是这段代码干的,
 * 但**我们自己的代码里不能留同样的形状**:能递归强删一个由外部参数推导出来的路径。
 *
 * 判据要求同时满足,任何一条不满足就拒绝删并响亮失败 —— 宁可留个半成品让人手工看,
 * 也不能删错一次。
 */
function assertSafeToRemove(dir) {
  const abs = path.resolve(dir)
  const root = path.resolve(S.sessionRoot)
  const segments = abs.split(path.sep).filter(Boolean)
  const ok =
    abs.startsWith(root + path.sep) &&      // 必须在本会话目录之下
    segments.includes(".octo") &&           // 路径里必须有 .octo 段
    segments.length >= 3                    // 不可能是盘符根或一级目录
  if (!ok) {
    fail("UNSAFE_CLEANUP", `拒绝删除 ${abs} —— 它不在本次会话的目录内`, {
      hint: `会话根应为 ${root}。多半是 --artifact-dir 传错了。请手工确认该目录内容后再决定怎么处理,不要让脚本删`,
    })
  }
}

// ① 复制工程骨架。已存在则整体跳过 —— 绝不覆盖用户/模型已经写过的东西。
let reused = false
if (exists(projectDir)) {
  // 但"已存在"不等于"完整":上次复制到一半失败留下的残骸也会走到这里,
  // 然后被当成正常会话跳过复制,于是**永远修不好**。所以先验一遍。
  const missing = missingFiles(projectDir)
  if (missing.length && args.reset) {
    // 显式要求重建。删除动作**留在脚本里**并照样过护栏 —— SKILL.md 硬约束 0 禁止
    // agent 自己执行删除命令(2026-09-07 内网因此丢过用户数据,§5.1.2),
    // 所以必须由脚本提供这条合法出口,否则 PROJECT_INCOMPLETE 就是个死结:
    // 这条路径脚本自己不会自愈,而 agent 又不许删。
    assertSafeToRemove(projectDir)
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch (e) {
      // 另外两处 rmSync 都包了 catch,这里不能漏:Windows 上 dev server 还占着该目录时
      // rmSync 会抛,未捕获就是裸崩、连 RESULT: FAIL 都打不出来。
      fail("RESET_FAILED", `删不掉残缺的产物目录: ${e.message}`, {
        hint: `多半是 dev server 还占着它。先让宿主停掉该会话的 dev server 再重试;仍不行则把 ${projectDir} 报给用户`,
      })
    }
    log(`[reset] 已删除残缺的产物目录,将重建: ${projectDir}`)
  } else if (missing.length) {
    fail("PROJECT_INCOMPLETE", `产物目录已存在但缺少 ${missing.length} 个关键文件`, {
      hint:
        `多半是上次复制中断留下的残骸。重跑本脚本并加 --reset,由脚本删掉残骸后重建。\n` +
        `⚠️ --reset 只在这次自检不完整时才会删,但它会清空 ${projectDir},该目录下已经写过的代码会一并丢失。\n` +
        `不要自己执行删除命令(见 SKILL.md 硬约束 0)`,
      extra: { MISSING: missing.join(", ") },
    })
  } else {
    reused = true
    log(`[skip] 产物目录已存在,复用: ${projectDir}`)
  }
}

if (!exists(projectDir)) {
  mkdirSync(S.outputs, { recursive: true })
  try {
    cpSync(TEMPLATE_DIR, projectDir, { recursive: true, dereference: false, errorOnExist: true, force: false })
  } catch (e) {
    // 复制失败要把半成品删掉,否则下次跑会因为"目录已存在"跳过复制,残缺状态被固化
    assertSafeToRemove(projectDir)
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
    assertSafeToRemove(projectDir)
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
