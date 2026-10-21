#!/usr/bin/env node
/**
 * new-session —— 建(或复用)工程(SPEC-DES-001 §5.3,布局按 SPEC-DES-008 §3.4)
 *
 * 用法: node new-session.mjs --artifact-dir=<绝对路径> --name=<产物名> [--title=<一句话描述>] [--reuse] [--reset] [--env-dir=]
 *       node new-session.mjs --artifact-dir=<绝对路径> --list
 *
 * `--artifact-dir`:有 [Artifact Folder] 用它(普通工作区,= .octo/<sid>/outputs),
 * 没有就用 [Workspace](代码工作区)。工程建在 `<artifact-dir>/<产物名>/`,工程根写标记文件,
 * 之后所有环节只认工程目录,不再从它往上推会话目录。
 */
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, usage, log, warn, parseArgs } from "./lib/result.mjs"
import {
  SKILL_DIR,
  TEMPLATE_DIR,
  envDir,
  envPaths,
  projectPaths,
  readSkillName,
  resolveRuntime,
  sessionContext,
  within,
  exists,
} from "./lib/paths.mjs"
import { HOST_LAYOUT, hostLayout, hostPresent, pidAlive, postRequest } from "./lib/host.mjs"
import { ensureDirLink } from "./lib/link.mjs"
import { MARKER_SCHEMA, formatProjects, identify, listProjects, safeToRemove, writeMarker } from "./lib/project.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 工程目录确定之前先挂共享池;**不能提前指到工程目录里** —— 日志落盘会顺手建出
// `<工程>/.octo-fastui/`,那个目录一存在,下面「工程是否已存在」的判断就错了。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))

const ctx = sessionContext()
const skillName = readSkillName()
const str = (v) => (typeof v === "string" ? v : "")

if (!str(args["artifact-dir"])) {
  usage("缺少 --artifact-dir=<绝对路径>。有 [Artifact Folder] 就用它,没有就用 [Workspace],都取原值")
}
const artifactDir = path.resolve(str(args["artifact-dir"]))
// 内网 2026-10-21:代码工作区下模型拿不到 [Artifact Folder],旧版按「上一级」推会话根,
// 状态文件写到了工作区外面。有工作区上下文时把这条路堵死。
if (ctx.workspaceDir && !within(artifactDir, ctx.workspaceDir)) {
  fail("OUTSIDE_WORKSPACE", `--artifact-dir 不在当前工作区内: ${artifactDir}`, {
    hint: `工作区是 ${ctx.workspaceDir}。有 [Artifact Folder] 就用它,没有就用 [Workspace],都取原值,不要自己拼`,
  })
}

const projectsBlock = () => ({
  name: "PROJECTS",
  text: formatProjects(listProjects(artifactDir, { skillName, sessionId: ctx.sessionId })),
})

if (args.list) {
  const count = listProjects(artifactDir, { skillName, sessionId: ctx.sessionId }).length
  ok({ ARTIFACT_DIR: artifactDir, PROJECT_COUNT: count }, { blocks: [projectsBlock()] })
}

const name = str(args.name)
if (!name) usage("缺少 --name=<产物名>(简短英文/拼音,同时传 --title=<一句话中文描述>)")
if (!/^[\w.\-一-龥]+$/.test(name) || name.startsWith(".")) usage(`--name 含非法字符: ${name}`)
if (!str(args.title)) warn("没有传 --title,用产物名代替;--list 和提问时会显示得不直观")

const P = envPaths(envDir(args["env-dir"]))
if (!exists(P.depsModules)) {
  fail("ENV_MISSING", `共享依赖池不存在: ${P.depsModules}`, { hint: "先跑 ensure-env.mjs" })
}
// 旧宿主只认 .octo/<sid>/outputs/<产物名>,本版建的工程它找不到 —— 卡片会打不开、verify 会空等。
// skill 先于 App 更新到用户机器时就是这个组合,必须在这里响亮失败(SPEC-DES-008 §3.4)
if (hostPresent(P.root) && hostLayout(P.root) !== HOST_LAYOUT) {
  fail("HOST_OUTDATED", "当前 Octo 版本过旧,不支持本版 skill 的工程布局", {
    hint: "这是环境问题,不是代码问题。把这一行原样告诉用户:请先升级 Octo 再继续",
  })
}

const projectDir = path.join(artifactDir, name)
const PP = projectPaths(projectDir)
const tempPrefix = `.${name}.creating-`

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
const missingFiles = (root) => REQUIRED_FILES.filter((rel) => !exists(path.join(root, ...rel.split("/"))))

/** 删除只走这里,并且每次都过护栏(SKILL.md 硬约束 0 禁止 agent 自己删,合法出口在脚本里) */
function removeOrFail(dir, code) {
  if (!safeToRemove(dir, { artifactDir, workspaceDir: ctx.workspaceDir, tempPrefix })) {
    fail("UNSAFE_CLEANUP", `拒绝删除 ${dir} —— 它不是本 skill 建的工程`, {
      hint: "请手工确认该目录内容后再决定怎么处理,不要让脚本删,也不要自己执行删除命令",
    })
  }
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    // Windows 上 dev server 还占着该目录时 rmSync 会抛,未捕获就是裸崩、连 RESULT: FAIL 都打不出来
    fail(code, `删不掉 ${dir}: ${e.message}`, {
      hint: "多半是 dev server 还占着它。先让宿主停掉这个工程的 dev server 再重试;仍不行则把路径报给用户",
    })
  }
}

// 上次创建中途被杀留下的临时目录(进程已不在才清,同名并发创建时不误伤对方)
try {
  for (const e of readdirSync(artifactDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith(tempPrefix)) continue
    if (pidAlive(Number(e.name.slice(tempPrefix.length)))) continue
    removeOrFail(path.join(artifactDir, e.name), "CLEANUP_FAILED")
    log(`[cleanup] 清掉上次中断留下的临时目录: ${e.name}`)
  }
} catch {
  /* artifactDir 还不存在 */
}

const nameTaken = (reason, hint) =>
  fail("NAME_TAKEN", reason, { hint, extra: { PROJECT_DIR: projectDir }, blocks: [projectsBlock()] })

let mode = "created"
let reusedFrom
let sessions = ctx.sessionId ? [ctx.sessionId] : []
let createdAt = new Date().toISOString()
let title = str(args.title) || name

if (exists(projectDir)) {
  const id = identify(projectDir)
  if (!id) {
    nameTaken(`${projectDir} 已存在,但不是本 skill 建的工程`, "换一个产物名重跑;这个目录不要动,也不要加 --reuse")
  }
  if (id.kind === "marker" && id.marker.skill && id.marker.skill !== skillName) {
    nameTaken(
      `${name} 是 ${id.marker.skill} 的工程,不能用 ${skillName} 接着改`,
      "两个 skill 的工程模板不同,不能混用。换一个产物名重跑",
    )
  }

  // "已存在"不等于"完整":建好之后被人删了文件也会走到这里
  const missing = missingFiles(projectDir)
  if (missing.length && !args.reset) {
    fail("PROJECT_INCOMPLETE", `工程已存在但缺少 ${missing.length} 个关键文件`, {
      hint:
        `重跑本脚本并加 --reset,由脚本删掉后重建。\n` +
        `⚠️ --reset 会清空 ${projectDir},该目录下已经写过的代码会一并丢失。\n` +
        `不要自己执行删除命令(见 SKILL.md 硬约束 0)`,
      extra: { MISSING: missing.join(", ") },
    })
  }

  // 旧布局的会话目录名就是会话 id,所以它属于哪个对话同样是确定的
  const prev = id.kind === "marker" ? (Array.isArray(id.marker.sessions) ? id.marker.sessions : []) : [id.legacy.sessionId]
  const mine = !ctx.sessionId || prev.includes(ctx.sessionId)
  if (!mine && !args.reuse) {
    nameTaken(
      `${name} 是另一个对话建的工程`,
      "先确认用户是要接着改这个工程还是新建:接着改就加 --reuse 重跑,新建就换一个产物名",
    )
  }
  if (!mine) reusedFrom = "other-session"
  sessions = [...new Set([...prev, ...sessions])]
  if (id.kind === "marker") {
    createdAt = id.marker.createdAt ?? createdAt
    title = str(args.title) || id.marker.title || title
  }

  if (missing.length) {
    // --reset:显式要求重建,过护栏后删掉,下面按新建走
    removeOrFail(projectDir, "RESET_FAILED")
    log(`[reset] 已删除残缺的工程,将重建: ${projectDir}`)
  } else {
    mode = "reused"
    log(`[skip] 工程已存在,复用: ${projectDir}`)
  }
}

const marker = {
  schema: MARKER_SCHEMA,
  skill: skillName,
  name,
  title,
  sessions,
  envDir: P.root,
  depsDir: P.depsModules,
  // 宿主起 dev server 用哪个 node。共享池里未必有 node(系统 node 够用时安装脚本不下载,§4.1),
  // 宿主自己去猜会猜错 —— 唯一确定知道的是跑着本脚本的这一侧(与 verify 的选法一致)
  nodeBin: resolveRuntime(P).node,
  // 宿主调 export-zip 要知道 skill 装在哪;唯一确定知道这个路径的是脚本自己(SPEC-DES-003 §8.6.2)
  skillDir: SKILL_DIR,
  createdAt,
  updatedAt: new Date().toISOString(),
}

if (mode === "created") {
  // 原子创建:先复制到同级临时目录,校验齐全、写好标记后再改名。
  // 最终目录要么完整、要么不存在 —— 复制中断不会留下一个"已存在但残缺"的工程
  const tmp = path.join(artifactDir, `${tempPrefix}${process.pid}`)
  mkdirSync(artifactDir, { recursive: true })
  try {
    cpSync(TEMPLATE_DIR, tmp, { recursive: true, dereference: false, errorOnExist: true, force: false })
  } catch (e) {
    if (exists(tmp)) removeOrFail(tmp, "COPY_FAILED")
    fail("COPY_FAILED", `复制模板失败: ${e.message}`, {
      hint: `源: ${TEMPLATE_DIR}\n目标: ${projectDir}\n路径含中文或超长时 Windows 上更容易失败,可先换一个纯英文短路径的工作目录试`,
    })
  }
  const missing = missingFiles(tmp)
  if (missing.length) {
    removeOrFail(tmp, "TEMPLATE_INCOMPLETE")
    fail("TEMPLATE_INCOMPLETE", `模板复制完成但缺少 ${missing.length} 个关键文件`, {
      hint: `已清理临时目录,可直接重跑。若反复出现,说明模板本身就不完整,检查 ${TEMPLATE_DIR}`,
      extra: { MISSING: missing.join(", ") },
    })
  }
  writeMarker(tmp, marker)
  try {
    renameSync(tmp, projectDir)
  } catch (e) {
    removeOrFail(tmp, "CREATE_FAILED")
    fail("CREATE_FAILED", `工程目录就位失败: ${e.message}`, { hint: "多半是同名目录刚被别的进程建出来了,重跑一次" })
  }
} else {
  writeMarker(projectDir, marker)
}

// 工程目录确定了,日志改写工程内 —— 与 dev server 日志同目录,一处就能看全
setLogSink(PP.log)

// 依赖链接建在工程根 —— 标准布局,`yarn serve` 在工程里直接可用(v12)
let linkState
try {
  linkState = ensureDirLink(path.join(projectDir, "node_modules"), P.depsModules)
} catch (e) {
  // hint 要按错误类型给。link.mjs 抛的"已存在但指向别处 / 已存在且是真实目录"这类,
  // 错误消息本身已经自解释了,再套上"确认目标盘是 NTFS"只会把人往错方向带。
  const alreadyExists = /已存在/.test(String(e.message))
  fail("LINK_FAILED", `建依赖链接失败: ${e.message}`, {
    hint: !alreadyExists && process.platform === "win32" ? "确认目标盘是 NTFS 且路径无中文以外的特殊字符" : undefined,
  })
}

// 不分配端口(SPEC-DES-004)。端口由宿主在起服务的那一刻挑,不写进标记、也不写进卡片。

// 在 Octo 里就请宿主现在起服务:模型写代码的几十秒里 webpack 已经编完进入 watch,
// 等到 verify 时只剩一次增量编译。不在 Octo 里(外网 V0、终端直接跑)就什么都不做。
if (hostPresent(P.root)) {
  try {
    postRequest(P.root, { projectDir, name })
  } catch (e) {
    log(`[warn] 投递预热请求失败(不影响后续,verify 会再请求): ${e.message}`)
  }
}

ok({
  MODE: mode,
  REUSED_FROM: reusedFrom,
  PROJECT_DIR: projectDir,
  TITLE: title,
  WRITE_DIR: PP.writeDir,
  ENTRY_FILE: path.join(PP.writeDir, "index.vue"),
  DEPS_DIR: P.depsModules,
  SKILL_DIR,
  MARKER: PP.marker,
  LINK: `${path.join(projectDir, "node_modules")} -> ${P.depsModules} (${linkState})`,
  REUSED: mode === "reused",
})
