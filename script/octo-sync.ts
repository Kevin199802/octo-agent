#!/usr/bin/env bun
/**
 * octo-sync —— 外网 octo-agent → UX AI 项目 合入工具
 *
 * 把外网 reference 实现的 insight 改动合入 UX AI 项目生产仓。两态:
 *   🟢 绿灯：改动只落在 pages/insight + agent prompt → 自动 rsync/cp + 双门禁
 *   🔴 非绿灯：改动越界(碰 app.tsx / 依赖 / 壳 等)→ 停手,列清单,交 AI 合入
 *
 * 用法:
 *   bun script/octo-sync.ts            # 正常合入(读锚点判范围)
 *   bun script/octo-sync.ts --dry-run  # 只判范围 + 演练 rsync,不写 UX AI 项目
 *   bun script/octo-sync.ts --init     # 一次性:告诉脚本"UX AI 项目已合到外网这一版"(设基线),不做同步
 *   bun script/octo-sync.ts --base <sha>  # 临时指定基线 sha(覆盖锚点)
 *
 * 不自动 git commit —— 同步 + 门禁通过后,由你 review 再手动提交。
 */

import { $ } from "bun"
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs"
import { resolve, join } from "node:path"

// ── 外网根 = 本脚本(script/)的上一级 ────────────────────────────────
const EXT_ROOT = resolve(import.meta.dir, "..")

// ── 路径映射(外网 → UX AI 项目),改这里即可适配结构变化 ─────────────────────
const BUSINESS = {
  ext: "packages/app/src/pages/insight", // 业务代码目录
  int: "packages/app/octoapp/pages/insight",
}
const PROMPT = {
  ext: "packages/agent/insight/agents/insight.md", // agent prompt(原样 cp,零转换)
  int: "packages/opencode/src/agent/prompt/octo_insight.md",
}
const EXCLUDE = ["_dev"] // rsync 时业务目录内排除(dev 调试页不进生产)

const BUSINESS_PREFIX = BUSINESS.ext + "/"

// 忽略范围:改了既不同步、也不报非绿灯(纯外网文档/工具/dev 调试页,对UX AI 项目零影响)
const IGNORE_PREFIXES = [
  `${BUSINESS.ext}/_dev/`, // dev 样式调试页
  "docs/", // 设计文档,不合入(handoff §5)
  "script/", // 合入工具自身(及上游构建脚本)
  ".vscode/",
  ".github/",
]
const IGNORE_EXACT = new Set(["CLAUDE.md", "ROADMAP.md", "README.md", "AGENTS.md", ".gitignore"])

const LOCAL_CFG = join(EXT_ROOT, "script/.octo-sync.local.json")
const STATE_FILE_NAME = ".insight-sync-state.json" // 锚点:UX AI 项目合到了外网哪个 sha

type Args = { dryRun: boolean; init: boolean; base?: string }
function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, init: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") a.dryRun = true
    else if (argv[i] === "--init") a.init = true
    else if (argv[i] === "--base") a.base = argv[++i]
  }
  return a
}

function die(msg: string): never {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

/** 解析UX AI 项目仓库根:配置文件优先,否则同级 ../UXAI fallback */
function resolveIntranetRoot(): string {
  let p: string | undefined
  if (existsSync(LOCAL_CFG)) {
    try {
      p = JSON.parse(readFileSync(LOCAL_CFG, "utf8")).intranetPath
    } catch {
      die(`读不动 ${LOCAL_CFG},请确认是合法 JSON: { "intranetPath": "/abs/path/UXAI" }`)
    }
  }
  if (!p) p = resolve(EXT_ROOT, "../UXAI") // 同级 fallback
  if (!existsSync(join(p, ".git")))
    die(
      `找不到UX AI 项目仓库(试了: ${p})。\n   请在 script/.octo-sync.local.json 指定: { "intranetPath": "/your/path/UXAI" }`,
    )
  return p
}

function readAnchor(intRoot: string): string | undefined {
  const f = join(intRoot, STATE_FILE_NAME)
  if (!existsSync(f)) return undefined
  try {
    return JSON.parse(readFileSync(f, "utf8")).lastSyncedExtSha
  } catch {
    return undefined
  }
}
function writeAnchor(intRoot: string, sha: string) {
  writeFileSync(
    join(intRoot, STATE_FILE_NAME),
    JSON.stringify({ lastSyncedExtSha: sha, updatedAt: new Date().toISOString() }, null, 2) + "\n",
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const INT_ROOT = resolveIntranetRoot()
  const head = (await $`git -C ${EXT_ROOT} rev-parse HEAD`.text()).trim()

  // --init:把锚点设为当前 HEAD,标记"UX AI 项目已对齐到这版",不做同步
  if (args.init) {
    writeAnchor(INT_ROOT, head)
    console.log(`\n✅ 锚点已初始化为外网 HEAD ${head.slice(0, 7)}(UX AI 项目状态文件: ${STATE_FILE_NAME})`)
    console.log(`   建议在 UX AI 项目里 commit 这个文件,让同事共享合入状态。\n`)
    return
  }

  const base = args.base ?? readAnchor(INT_ROOT)
  if (!base)
    die(
      `没有锚点(UX AI 项目无 ${STATE_FILE_NAME})。首次请先跑:\n   bun script/octo-sync.ts --init   # 标记当前已对齐\n   或 --base <sha> 指定基线`,
    )

  if (base === head) {
    console.log(`\n🟢 UX AI 项目已是最新(锚点 = 外网 HEAD ${head.slice(0, 7)}),无需合入。\n`)
    return
  }

  // ── 判范围:base..head 改了哪些文件 ───────────────────────────────
  const changed = (await $`git -C ${EXT_ROOT} diff --name-only ${base}..${head}`.text())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)

  const business: string[] = []
  const promptChanged: string[] = []
  const ignored: string[] = []
  const outOfScope: string[] = []
  for (const f of changed) {
    if (IGNORE_PREFIXES.some((p) => f.startsWith(p)) || IGNORE_EXACT.has(f)) ignored.push(f)
    else if (f.startsWith(BUSINESS_PREFIX)) business.push(f)
    else if (f === PROMPT.ext) promptChanged.push(f)
    else outOfScope.push(f)
  }

  console.log(`\n合入范围检测  (锚点 ${base.slice(0, 7)} → HEAD ${head.slice(0, 7)},共 ${changed.length} 文件改动)`)
  console.log(`  业务 pages/insight : ${business.length}`)
  console.log(`  agent prompt       : ${promptChanged.length}`)
  console.log(`  _dev 忽略          : ${ignored.length}`)
  console.log(`  越界               : ${outOfScope.length}`)

  // ── 🔴 非绿灯:停手,交 AI ────────────────────────────────────────
  if (outOfScope.length > 0) {
    console.log(`\n🔴 非绿灯 —— 改动越出 pages/insight + prompt 范围,未做任何同步。`)
    console.log(`   越界文件(贴给 AI 起对话合入):`)
    for (const f of outOfScope) console.log(`     - ${f}`)
    console.log(``)
    process.exit(2)
  }

  // ── 🟢 绿灯:rsync + cp + 双门禁 ─────────────────────────────────
  const srcBiz = join(EXT_ROOT, BUSINESS.ext) + "/"
  const dstBiz = join(INT_ROOT, BUSINESS.int) + "/"
  const excludeArgs = EXCLUDE.flatMap((d) => ["--exclude", d])
  const dryArg = args.dryRun ? ["--dry-run"] : []

  console.log(`\n🟢 绿灯 —— 开始同步${args.dryRun ? "(DRY-RUN,不写 UX AI 项目)" : ""}`)
  console.log(`① rsync 业务代码 (exclude ${EXCLUDE.join(",")})`)
  await $`rsync -a --delete ${excludeArgs} ${dryArg} ${srcBiz} ${dstBiz}`

  console.log(`② cp agent prompt(原样,零转换)`)
  if (!args.dryRun) copyFileSync(join(EXT_ROOT, PROMPT.ext), join(INT_ROOT, PROMPT.int))

  if (args.dryRun) {
    console.log(`\n🟡 DRY-RUN 结束:范围绿灯、演练完成,未写 UX AI 项目、未跑门禁。去掉 --dry-run 正式合入。\n`)
    return
  }

  // 门禁:UX AI 项目 packages/app typecheck + build,任一挂则不推进锚点
  const appDir = join(INT_ROOT, "packages/app")
  console.log(`③ 门禁 typecheck (tsgo -b)...`)
  const tc = await $`bun run typecheck`.cwd(appDir).nothrow()
  if (tc.exitCode !== 0) die(`typecheck 失败(见上),已同步文件但未推进锚点。修复后重跑或交 AI。`)

  console.log(`④ 门禁 build (vite build)...`)
  const bd = await $`bun run build`.cwd(appDir).nothrow()
  if (bd.exitCode !== 0) die(`build 失败(见上),已同步文件但未推进锚点。修复后重跑或交 AI。`)

  // 双门禁通过 → 推进锚点
  writeAnchor(INT_ROOT, head)

  console.log(`\n✅ 绿灯合入完成:业务 ${business.length} 文件 + prompt ${promptChanged.length},双门禁通过。`)
  console.log(`   锚点已推进到 ${head.slice(0, 7)}。`)
  console.log(`   下一步:到UX AI 项目 review + git commit(脚本不自动提交)。\n`)
}

main().catch((e) => die(String(e?.stack ?? e)))
