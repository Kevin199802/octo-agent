#!/usr/bin/env node
/**
 * export-zip —— 打交付包(SPEC-DES-001 §5.6)
 *
 * v12 起这是**正确性需求而不是便利性**:依赖链接建在工程根之后(标准布局,
 * 为的是产物目录里 `yarn serve` 直接可用),整目录压缩会跟随链接把 1GB 依赖打进去。
 * 干净交付包只能由这里产出。
 *
 * 用法: node export-zip.mjs --session-dir=<.octo/<sid>> [--project-dir=] [--out=<路径>]
 */
import { readFileSync, readdirSync, lstatSync, statSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, usage, log, parseArgs } from "./lib/result.mjs"
import { envDir, readJson, sessionPaths } from "./lib/paths.mjs"
import { writeZip } from "./lib/zip.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 有会话上下文的脚本一律写**会话目录**,和 devserver.log 放在一起 ——
// 排查时只需要看一个目录,不用在共享池和会话目录之间来回找(§5.1.1)。
// 会话目录此刻可能还没解析出来,先挂共享池,解析出来后再改指向。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))

let sessionRoot = args["session-dir"] ? path.resolve(String(args["session-dir"])) : null
if (!sessionRoot && args["project-dir"]) {
  sessionRoot = path.dirname(path.dirname(path.resolve(String(args["project-dir"]))))
}
if (!sessionRoot) usage("缺少 --session-dir=<.octo/<sessionId>> 或 --project-dir=")

const S = sessionPaths(path.join(sessionRoot, "outputs"))
// 会话目录已知,日志改写这里 —— 与 devserver.log 同目录,一处就能看全
setLogSink(path.join(S.sessionRoot, "octo-fastui.log"))
const state = readJson(S.state)
const projectDir = args["project-dir"] ? path.resolve(String(args["project-dir"])) : state?.projectDir
if (!projectDir) fail("NO_SESSION", `找不到会话状态 ${S.state}`, { hint: "先跑 new-session.mjs" })

const name = path.basename(projectDir)
const outPath = args.out ? path.resolve(String(args.out)) : path.join(S.outputs, `${name}.zip`)

// 排除清单。node_modules 全量排除、不设例外:开发拿到包必然要 yarn install,
// 那会重新生成 .bin,带不带它行为完全一样;而"排除 node_modules 但放行某个子路径"
// 是排除规则里最容易写错的一类逻辑。
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".cache", ".turbo", ".history"])
const EXCLUDE_FILES = [/\.log$/i, /^\.DS_Store$/, /^Thumbs\.db$/i, /^yarn-error\.log$/i]

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
const bad = entries.find((e) => e.name.split("/").includes("node_modules"))
if (bad) fail("EXPORT_CONTAMINATED", `打包结果里混进了 node_modules: ${bad.name}`)

ok({
  ZIP_PATH: outPath,
  ZIP_BYTES: bytes,
  FILE_COUNT: entries.filter((e) => !e.isDir).length,
  SKIPPED_LINKS: skippedLinks,
  PROJECT_DIR: projectDir,
})
