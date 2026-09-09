#!/usr/bin/env node
/**
 * setup-env —— 装依赖、写环境清单(SPEC-DES-001 §4.1 的 ③④⑤)
 *
 * 由 install.ps1 / install.sh 在装好 portable node 之后 exec 调用 ——
 * 引导脚本只负责"把 node 弄下来",跨平台的业务逻辑只在这里写一份,
 * 否则 PowerShell 和 bash 各写一遍必然漂移。
 *
 * 用法: node setup-env.mjs [--env-dir=] [--registry=] [--upgrade] [--proxy=<地址>]
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
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

/**
 * 子进程的环境:**默认把代理变量摘掉**(v14,§4.4.8 第二批坑 1)。
 *
 * install 脚本那边已经强制直连了,但 npm / yarn 是 `run()` 拉起来的子进程,
 * `env: process.env` 会把 agent 宿主注入的 `HTTP_PROXY` / `HTTPS_PROXY` 原样传下去 ——
 * 于是同一个 504 会在"装 yarn"这步原样复现,只是卡点从第 1 步挪到第 3 步。
 * 2026-09-07 日志里那条 `YARN_INSTALL_FAILED: … <池子>/node/bin/npm install -g yarn`
 * 就是活样本:node 已经在池子里了,失败发生在 npm 这一步。
 *
 * **为什么是删变量而不是设 `NO_PROXY=*` / `npm_config_noproxy=*`**:
 * 这次 504 的头号嫌疑正是 `NO_PROXY` 没被正确解析(那台 curl 是 7.86.0,
 * 环境里明明配了 `.huawei.com`)。既然刚被 noproxy 的匹配实现坑过,就不该再把修复
 * 建立在"npm / yarn / curl 各自都能正确解析 noproxy"这个假设上 —— 删变量是确定的。
 *
 * 前提:deps 的依赖源全在内网(§4.1「③④ 的 registry 必须分开处理」——
 * 模板自带的 `.npmrc` 已配全内网 registry 与各 scope 独立源,且项目级配置
 * 优先级高于用户的 `~/.npmrc`)。若哪天依赖树里混进了外网源,用 `--proxy` 传回来。
 */
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
function childEnv() {
  const e = { ...process.env }
  for (const k of PROXY_ENV_KEYS) delete e[k]
  // npm 还会读 .npmrc 里的 proxy=,而**那一层优先级高于环境变量**,光删变量堵不住。
  // 用 npm_config_* 顶掉它 —— 注意必须是字符串 "false",**空串 "" 顶不掉**(npm 10.9.4 实测:
  // 设成 "" 之后 `npm config get proxy` 仍返回 .npmrc 里的值,设成 "false" 才生效)。
  e.npm_config_proxy = "false"
  e.npm_config_https_proxy = "false"
  const proxy = String(args.proxy || "")
  if (proxy) {
    // 显式要求经代理。**同样要堵满三层** —— 只设环境变量的话,npm 会回落到 .npmrc 的
    // `proxy=`(那一层压过环境变量),于是 --proxy 被静默忽略、走成机器上那个旧代理。
    // 触发时人正在排查代理,静默走错比报错更难查。
    // 同时清掉继承来的 NO_PROXY —— 否则 yarn 1(走 request 库,读 NO_PROXY)可能把
    // 刚指定的代理又静默旁路掉,与 install.sh 的 `--proxy … --noproxy ''` 保持一致。
    for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) e[k] = proxy
    for (const k of ["NO_PROXY", "no_proxy"]) delete e[k]
    e.npm_config_proxy = proxy
    e.npm_config_https_proxy = proxy
  }
  return e
}

const run = (bin, argv, cwd) => {
  log(`$ ${bin} ${argv.join(" ")}${cwd ? `   (cwd=${cwd})` : ""}`)
  return execFileSync(bin, argv, { cwd, stdio: ["ignore", "inherit", "inherit"], env: childEnv() })
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
      hint: `把 ${P.node} 的目录树报给用户,由人判断是重装还是修复。不要自己执行删除命令(见 SKILL.md 硬约束 0)`,
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

// yarn 1 **不读 `npm_config_*`**,而 `.npmrc` / `.yarnrc` 里的 `proxy` 优先级高于环境变量 ——
// 上面 childEnv() 删掉的环境变量堵不住这一层。往**我们自己这份拷贝**末尾追加空值即可
// (实测 `.yarnrc` 压得过 `.npmrc`;而 CLI 传 `--proxy ""` 会被 yarn 当空参数忽略,不管用)。
// 只动共享池里的副本,不碰 template,更不碰用户的 ~/.yarnrc。
// 用标记块包起来并在写入前剥掉旧的 —— 必须幂等:上面那段复制只在 template 里**有** .yarnrc 时
// 才会覆盖 deps/.yarnrc,template 里没有的话这个文件会一直留着,每次 --upgrade 都追加一次就累积了。
const OCTO_YARNRC_MARK = "# --- octo: 强制直连(SPEC-DES-001 §4.4.8 第二批坑 6),重跑会被整块替换 ---"
{
  const yarnrc = path.join(P.deps, ".yarnrc")
  let cur = exists(yarnrc) ? readFileSync(yarnrc, "utf8") : ""
  const at = cur.indexOf(OCTO_YARNRC_MARK)
  if (at !== -1) cur = cur.slice(0, at) // 剥掉上一次追加的块
  cur = cur.replace(/\s*$/, "")
  // 两种情形都要写标记块,不能只在直连时写 —— 只剥不写的话 yarn 会回落到
  // 文件里原有的 proxy 行(那一层压过环境变量),--proxy 就被静默忽略了。
  const want = args.proxy ? String(args.proxy) : ""
  writeFileSync(yarnrc, `${cur}\n${OCTO_YARNRC_MARK}\nproxy "${want}"\nhttps-proxy "${want}"\n`)
  log(want ? `[deps] 已在 ${yarnrc} 写入 proxy ${want}` : `[deps] 已在 ${yarnrc} 写入空 proxy(强制直连;要经代理请传 --proxy)`)
}

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
