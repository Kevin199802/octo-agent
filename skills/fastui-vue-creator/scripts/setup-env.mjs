#!/usr/bin/env node
/**
 * setup-env —— 装依赖、写环境清单(SPEC-DES-001 §4.1 的 ③④⑤)
 *
 * 由 install.ps1 / install.sh 在装好 portable node 之后 exec 调用 ——
 * 引导脚本只负责"把 node 弄下来",跨平台的业务逻辑只在这里写一份,
 * 否则 PowerShell 和 bash 各写一遍必然漂移。
 *
 * 用法: node setup-env.mjs [--env-dir=] [--registry=] [--upgrade]
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, log, parseArgs } from "./lib/result.mjs"
import { TEMPLATE_DIR, envDir, envPaths, readManifest, readJson, exists, resolveYarnJs } from "./lib/paths.mjs"
import { sha256File, sameHash } from "./lib/hash.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 这个脚本可能在还没有任何会话时跑(首装),所以落共享池(§5.1.1)。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))
const manifest = readManifest()
const P = envPaths(envDir(args["env-dir"]))
const isUpgrade = Boolean(args.upgrade)

if (!exists(P.nodeBin)) fail("NODE_MISSING", `共享池里没有 node: ${P.nodeBin}`, { hint: "先跑 install.ps1 / install.sh" })

const templatePkgPath = path.join(TEMPLATE_DIR, "package.json")
const templateLockPath = path.join(TEMPLATE_DIR, "yarn.lock")
if (!exists(templatePkgPath) || !exists(templateLockPath)) {
  fail("SKILL_NOT_ASSEMBLED", "skill 的 template/ 缺少 package.json 或 yarn.lock", { hint: `把内网脚手架工程(排除根目录 node_modules)复制到 ${TEMPLATE_DIR}` })
}

const run = (bin, argv, cwd) => {
  log(`$ ${bin} ${argv.join(" ")}${cwd ? `   (cwd=${cwd})` : ""}`)
  return execFileSync(bin, argv, { cwd, stdio: ["ignore", "inherit", "inherit"], env: process.env })
}

/**
 * 跑 yarn。**不能直接 spawn `yarn.cmd`** —— Node 18 起出于命令注入防护
 * (CVE-2024-27980)禁止直接执行 .cmd/.bat,报 EINVAL,内网实测踩过。
 * 所以走共享池 node + yarn 的 JS 入口,两平台统一、不经 shell。
 *
 * **回落分支不再用 `shell: true`**(v14):`shell: true` 时 Node 把 file 与 args
 * 裸拼成命令字符串交给 shell、不加引号,而 envDir 默认落在 `Application Support` 下,
 * 路径必然含空格 —— 命令会在空格处被劈成两半。2026-09-08 本地复现确认。
 * Windows 上没有 JS 入口就没有退路(yarn.cmd 不能 spawn),与其执行一个被截断的命令,
 * 不如响亮失败。
 */
const runYarn = (argv, cwd) => {
  const yarnJs = resolveYarnJs(P)
  if (yarnJs) return run(P.nodeBin, [yarnJs, ...argv], cwd)
  if (process.platform === "win32") {
    fail("YARN_NOT_FOUND", `装好了 yarn 却找不到它的 JS 入口(${P.node} 下)`, {
      hint: "删掉共享池的 node 目录后重跑安装脚本;若反复出现,把 <envDir>/node/ 的目录树贴出来",
    })
  }
  log(`[warn] 找不到 yarn 的 JS 入口,直接执行 ${P.yarnBin}`)
  return run(P.yarnBin, argv, cwd)
}

// ── ③ 装 yarn ────────────────────────────────────────────────────
// portable node 的 global prefix 落在 node 自己的目录里,不碰 /usr/local,
// 所以不需要 sudo —— Agent 内执行 sudo 会静默挂住等密码,没有交互通道。
if (!exists(P.yarnBin)) {
  const registry = String(args.registry || process.env.OCTO_NPM_REGISTRY || "")
  const npmBin = process.platform === "win32" ? path.join(P.node, "npm.cmd") : path.join(P.node, "bin", "npm")
  const argv = ["install", "-g", "yarn"]
  if (registry) argv.push(`--registry=${registry}`)   // ← 只有装 yarn 这一步传 registry
  try {
    run(npmBin, argv)
  } catch (e) {
    fail("YARN_INSTALL_FAILED", `安装 yarn 失败: ${e.message}`, { hint: registry ? undefined : "试试 --registry=<内网 npm 源>" })
  }
} else {
  log(`[skip] yarn 已存在: ${P.yarnBin}`)
}

// ── ④ 复制依赖清单到 deps/,在那里 install ──────────────────────────
// 不是"在模板里装完再移过去" —— 那样 node_modules 被移走后 template 里空了,
// 下次升级 yarn install 就是全量重装 1GB,增量升级直接失效(§4.1)。
mkdirSync(P.deps, { recursive: true })
for (const f of ["package.json", "yarn.lock", ".npmrc", ".yarnrc", ".yarnrc.yml"]) {
  const src = path.join(TEMPLATE_DIR, f)
  if (exists(src)) copyFileSync(src, path.join(P.deps, f))
}

// workspace 成员只复制 package.json,不复制源码 —— 但目录必须存在且带 package.json,
// 否则 yarn 的 hoist 结果与真实工程不同(那会让 lockfileHash 过而依赖树其实不对)。
const templatePkg = readJson(templatePkgPath, {})
const patterns = Array.isArray(templatePkg.workspaces) ? templatePkg.workspaces : (templatePkg.workspaces?.packages ?? [])
let members = 0
for (const pattern of patterns) {
  const star = pattern.indexOf("*")
  if (star === -1) {
    const src = path.join(TEMPLATE_DIR, pattern, "package.json")
    if (exists(src)) {
      mkdirSync(path.join(P.deps, pattern), { recursive: true })
      copyFileSync(src, path.join(P.deps, pattern, "package.json"))
      members++
    }
    continue
  }
  const baseRel = pattern.slice(0, star).replace(/\/$/, "")
  const baseAbs = path.join(TEMPLATE_DIR, baseRel)
  let entries = []
  try {
    entries = readdirSync(baseAbs, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    continue
  }
  for (const e of entries) {
    const src = path.join(baseAbs, e.name, "package.json")
    if (!exists(src)) continue
    mkdirSync(path.join(P.deps, baseRel, e.name), { recursive: true })
    copyFileSync(src, path.join(P.deps, baseRel, e.name, "package.json"))
    members++
  }
}
log(`[deps] 复制了 ${members} 个 workspace 成员的 package.json`)

// ⚠️ 这里绝对不要加 --registry ——
// 脚手架自带的 .npmrc / .yarnrc 已配好各 scope 的独立源(@lake / @turboui 等),
// 传 --registry 会把它们全部覆盖掉,表现是"包找不到",极难往这个方向想。
try {
  runYarn(["install"], P.deps)
} catch (e) {
  fail("YARN_INSTALL_FAILED", `依赖安装失败: ${e.message}`, {
    hint: "检查 deps/.npmrc 与 .yarnrc 是否随 template 一起复制过来了",
  })
}

// ── ⑤ 校验 + 写清单 ──────────────────────────────────────────────
const wantHash = sha256File(templateLockPath)
const gotHash = sha256File(P.depsLock)
if (!sameHash(wantHash, gotHash)) {
  fail("LOCKFILE_DRIFT", "装完之后 deps/yarn.lock 与 template 的不一致", {
    hint: "yarn 改写了 lockfile,说明 template 的 package.json 与 yarn.lock 本身不匹配,需要在内网维护机上重新生成",
    extra: { EXPECTED_LOCK: wantHash, ACTUAL_LOCK: gotHash },
  })
}

const nodeVersion = execFileSync(P.nodeBin, ["-v"], { encoding: "utf8" }).trim()
let yarnVersion = ""
try {
  const yarnJs = resolveYarnJs(P)
  yarnVersion = yarnJs
    ? execFileSync(P.nodeBin, [yarnJs, "-v"], { encoding: "utf8" }).trim()
    : execFileSync(P.yarnBin, ["-v"], { encoding: "utf8" }).trim()
} catch {
  /* 诊断字段,拿不到不阻塞 */
}

// keyPackages 从实际装好的包里读出来,不是抄清单 —— 这样它才有诊断价值
const keyPackages = {}
for (const name of Object.keys(readJson(P.lockFile, {})?.keyPackages ?? {}).concat([
  "vue",
  "element-plus",
  "@lake/lake-pro-component",
  "@lake/lake-report-component",
  "@turboui/turbo-ui-cli-service",
])) {
  const pkg = readJson(path.join(P.depsModules, ...name.split("/"), "package.json"))
  if (pkg?.version) keyPackages[name] = pkg.version
}

const lock = {
  // v11:只留一个版本字段。envVersion 与 templateVersion 在 v9 之后承载的是同一件事 ——
  // template 决定一切(package.json + yarn.lock 都在里面),而依赖树本身已被 lockfileHash 严格约束。
  envVersion: templatePkg.octoTemplateVersion ?? "unknown",
  lockfileHash: gotHash,
  platform: process.platform,
  arch: process.arch,
  nodeVersion,
  yarnVersion,
  installedAt: new Date().toISOString(),
  keyPackages,
}
writeFileSync(P.lockFile, JSON.stringify(lock, null, 2))

ok({
  ENV_DIR: P.root,
  ENV_VERSION: lock.envVersion,
  NODE_VERSION: nodeVersion,
  YARN_VERSION: yarnVersion,
  DEPS_DIR: P.depsModules,
  LOCKFILE_HASH: gotHash,
  MODE: isUpgrade ? "upgrade" : "install",
})
