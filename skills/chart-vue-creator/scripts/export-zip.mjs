#!/usr/bin/env node
/**
 * export-zip —— 打交付包(SPEC-DES-001 §5.6)
 *
 * v12 起这是**正确性需求而不是便利性**:依赖链接建在工程根之后(标准布局,
 * 为的是产物目录里 `yarn serve` 直接可用),整目录压缩会跟随链接把 1GB 依赖打进去。
 * 干净交付包只能由这里产出。
 *
 * 用法: node export-zip.mjs --project-dir=<new-session 返回的 PROJECT_DIR> [--out=<路径>]
 *       (--session-dir=<.octo/<sid>> 是旧参数,仍可用)
 */
import { mkdirSync, readFileSync, readdirSync, lstatSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, usage, log, parseArgs } from "./lib/result.mjs"
import { MARKER_FILE, RUNTIME_DIR, envDir, projectPaths, readSkillName, sessionContext } from "./lib/paths.mjs"
import { locateProject } from "./lib/project.mjs"
import { writeZip } from "./lib/zip.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 工程此刻还没定位出来,先挂共享池,定位后改写工程内(§5.1.1)。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))

// 定位规则与 verify 相同(SPEC-DES-008 §3.5)
const loc = locateProject(
  { projectDir: args["project-dir"], sessionDir: args["session-dir"] },
  { ...sessionContext(), skillName: readSkillName() },
)
if (!loc.ok && loc.usage) usage(loc.reason)
if (!loc.ok) fail(loc.code, loc.reason, { hint: loc.hint, blocks: loc.blocks })

const projectDir = loc.projectDir
const PP = projectPaths(projectDir)
setLogSink(PP.log)
const name = path.basename(projectDir)
// 交付包放工程的运行时目录里,不放工程旁边 —— 代码工作区下工程就在工作区根,放旁边会越积越多
const outPath = args.out ? path.resolve(String(args.out)) : path.join(PP.exportDir, `${name}.zip`)
mkdirSync(path.dirname(outPath), { recursive: true })

// 排除清单。node_modules 全量排除、不设例外:开发拿到包必然要 yarn install,
// 那会重新生成 .bin,带不带它行为完全一样;而"排除 node_modules 但放行某个子路径"
// 是排除规则里最容易写错的一类逻辑。
// 运行时目录与工程标记含本机路径(共享池、node、skill 位置),不该交给开发(SPEC-DES-008 §3.5)
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".cache", ".turbo", ".history", RUNTIME_DIR])
const EXCLUDE_FILES = [/\.log$/i, /^\.DS_Store$/, /^Thumbs\.db$/i, /^yarn-error\.log$/i, /^\.octo-fastui\.json$/]

const entries = []
let skippedLinks = 0

function walk(abs, rel) {
  let items
  try {
    items = readdirSync(abs, { withFileTypes: true })
  } catch (e) {
    fail("READ_FAILED", `读不到目录 ${abs}: ${e.message}`)
  }
  for (const it of items) {
    const childAbs = path.join(abs, it.name)
    const childRel = rel ? `${rel}/${it.name}` : it.name

    // 用 lstat 判断,不跟随链接 —— 跟随就会把共享池那 1GB 打进来
    const st = lstatSync(childAbs)
    if (st.isSymbolicLink()) {
      skippedLinks++
      continue
    }
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(it.name)) continue
      entries.push({ name: `${childRel}/`, data: Buffer.alloc(0), mtime: st.mtime, isDir: true })
      walk(childAbs, childRel)
      continue
    }
    if (EXCLUDE_FILES.some((re) => re.test(it.name))) continue
    entries.push({ name: childRel, data: readFileSync(childAbs), mtime: st.mtime })
  }
}

walk(projectDir, "")
if (entries.length === 0) fail("EMPTY_PROJECT", `${projectDir} 里没有可打包的文件`)

log(`[zip] ${entries.length} 个条目,跳过 ${skippedLinks} 个链接`)
const bytes = await writeZip(outPath, entries)

// 自检:交付包里绝不能出现 node_modules。这条不是防御脚本自己写错,
// 是防御以后有人加排除规则时手滑 —— 打出一个带 1GB 依赖的包比不打包更糟。
const bad = entries.find((e) => e.name.split("/").some((seg) => seg === "node_modules" || seg === RUNTIME_DIR || seg === MARKER_FILE))
if (bad) fail("EXPORT_CONTAMINATED", `打包结果里混进了不该交付的内容: ${bad.name}`)

ok({
  ZIP_PATH: outPath,
  ZIP_BYTES: bytes,
  FILE_COUNT: entries.filter((e) => !e.isDir).length,
  SKIPPED_LINKS: skippedLinks,
  PROJECT_DIR: projectDir,
})
