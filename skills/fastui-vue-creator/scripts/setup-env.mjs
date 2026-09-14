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
import { execFileSync, spawn } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { setLogSink, ok, fail, log, logChild, lastLine, tailBuffer, parseArgs } from "./lib/result.mjs"
import { TEMPLATE_DIR, envDir, envPaths, readManifest, readJson, exists, resolveYarnJs, resolveNpmJs, resolveRuntime } from "./lib/paths.mjs"
import { sha256File, sameHash } from "./lib/hash.mjs"

const args = parseArgs()
// 契约行同时落盘 —— 宿主 UI 未必把 stdout 展示给人看,失败了要能事后查。
// 这个脚本可能在还没有任何会话时跑(首装),所以落共享池(§5.1.1)。
setLogSink(path.join(envDir(args["env-dir"]), "octo-fastui.log"))
// **不能让它裸抛**(§5.1.2):读不了就是一条 SyntaxError / ENOENT 堆栈,一行 `RESULT:` 都没有,
// 而"发日志就能定位"正是这套脚本的判据。v16 之后这个文件还多了个 `npmRegistry` ——
// 它是复用已有 node 那条主路径上装 yarn 的源,不再只承载 skillVersion / manifestUrl。
let manifest
try {
  manifest = readManifest()
} catch (e) {
  fail("SKILL_MANIFEST_BROKEN", `读不了 skill 自带的 references/env.manifest.json:${e.message}`, {
    hint: "skill 包没组装好或文件被编辑坏了,重新上架一版。要临时绕开,传 --registry=<内网 npm 源>",
  })
}
const P = envPaths(envDir(args["env-dir"]))
const isUpgrade = Boolean(args.upgrade)

/**
 * 用哪个 node:共享池里有 portable node 就用它,没有就是**跑着本脚本的这个**(系统 node)——
 * install.sh / install.ps1 决定复用系统 node 时,正是用系统 node 来 exec 本脚本的(§4.1)。
 * 所以这里不再硬性要求共享池里有 node,只要求手上有一个能跑的。
 */
const RT = resolveRuntime(P)
log(`[node] ${RT.source === "pool" ? "共享池" : "系统"} node: ${RT.node}`)

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

/**
 * 从子进程输出里挑**一行**拼进 `RESULT:` 行 —— **不能直接取末行**。
 *
 * 实测(2026-09-12 复核):两个工具的末行恰好都是最没用的一行 ——
 *   npm : `npm error A complete log of this run can be found in: /Users/…/_logs/….log`(固定 boilerplate)
 *   yarn: `    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16)`(node 内部栈帧,看着像代码 bug)
 * 真因(`ECONNREFUSED` + 那个 registry URL)在上面十几到二十行处。而这一行是要直接进
 * 契约行、被截图发出来的(§8.4),取错等于整条失败路径只剩一个退出码。
 *
 * 判据是**固定 boilerplate 的精确模式**,不是"猜哪行重要":命中就继续往上找,
 * 全是 boilerplate 时退回末行 —— 不会比以前更差。
 */
// 两个工具都在每行前面加自己的前缀(`npm error ` / `npm ERR! `),判据先剥掉它再看
const TOOL_PREFIX = /^npm (error|ERR!)\s?/i
// **噪音**:出现在末尾、但不含任何定位信息的固定文本
const TAIL_NOISE = [
  /^A complete log of this run can be found in/i, // npm 的固定结尾
  /^If you are behind a proxy/i, //                 npm 的通用建议(两行)
  /^'proxy' config is set properly/i,
  /^info /i, //                                    yarn 的 info(含 "Visit https://yarnpkg.com/…")
  /^\s*at /, //                                    node 栈帧
  /^[{}[\],]*$/, //                                错误对象 dump 的括号行
  /^\w+:\s*'[^']*',?$/, //                         错误对象 dump 的字段行(code: 'ECONNREFUSED',)
]
// **高信号**:真正带原因的那一行,按优先级从高到低
const TAIL_SIGNALS = [
  /\b\w*Error:\s/, //            `FetchError: request to <url> failed, reason: connect ECONNREFUSED …`
  /^error code [A-Z0-9_]+/i, //  npm 的规范码行(`npm error code ECONNREFUSED`)
  /^error\s+\S/i, //             yarn 1 的 `error An unexpected error occurred: "…"`
]
const MAX_SCAN_LINES = 60
function errorTail(buf, max = 200) {
  const lines = (buf?.toString("utf8") ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/[\x00-\x1f\x7f]/g, " ").trim())
    .map((l) => l.replace(TOOL_PREFIX, "").trim())
  const window = lines.slice(-MAX_SCAN_LINES).filter(Boolean)
  const clip = (l) => (l.length > max ? `${l.slice(0, max)}…` : l)
  // ① 先找高信号行(从后往前,同一档取最靠后的那条)
  for (const sig of TAIL_SIGNALS) {
    for (let i = window.length - 1; i >= 0; i--) if (sig.test(window[i])) return clip(window[i])
  }
  // ② 没有高信号就退回"跳过 boilerplate 的最后一条"
  for (let i = window.length - 1; i >= 0; i--) {
    if (!TAIL_NOISE.some((re) => re.test(window[i]))) return clip(window[i])
  }
  // ③ 全是 boilerplate —— 退回原行为,不会比以前更差
  return lastLine(buf, max)
}

/**
 * 跑子进程:**原文实时转发到 stderr,同时把尾部落盘**(v15 S5,§5.1.1「日志里必须有什么」)。
 *
 * v14 用的是 `stdio: ["ignore", "inherit", "inherit"]` —— 子进程输出直接继承到父进程,
 * 一个字节都不经日志。于是 2026-09-08 排 504 时,日志里只有一句
 * `YARN_INSTALL_FAILED: … npm install -g yarn`,npm 自己打的几十行(状态码、URL、
 * 重试记录)全丢了,只能靠"agent 的思考过程里提过 504"这种二手记忆。
 * (顺带:那种写法还把子进程的 stdout 混进了**我们自己的 stdout**,而那条流按 §5.1.1
 * 只能放契约行 —— 现在两条流一律转发到 stderr,契约流是干净的。)
 *
 * 为什么是 `spawn` 流式,不是 `spawnSync` 一次性取:
 * `yarn install` 装 1GB 依赖要跑几分钟,一次性取意味着这几分钟**一个字节都不输出** ——
 * 宿主或工具层若有「长时间无输出即判挂起」的逻辑会直接把它 kill,那就不是体验问题,
 * 是装不上。所以必须边跑边吐。
 *
 * 另两个要点:
 * - **成功也写**。装成功但依赖树不对时,要能回头看 yarn 当时说了什么。
 * - 收到的是 Buffer,**不解码**:Windows 上 npm 输出是 GBK 字节,按 UTF-8 解一遍
 *   再写回去就是乱码(§5.1.2 那条根因链的一环)。日志留原始字节,人用什么编码开是人的事。
 * - 内存有界:只留尾部 64KB(`tailBuffer`),不把整段攒在内存里。
 */
const RUN_TAIL_KB = 64
/**
 * `label` 是日志里那段原文的标记(`--- <label> stderr ---`)。**必须显式传**:
 * v16 之后 npm 与 yarn 都是 `run(RT.node, [<那个工具的 .js>, …])` 起的(Node 18+ 不许
 * spawn `.cmd`),`path.basename(bin)` 对两者都是 `node` —— 一次安装里两段原文长得一模一样,
 * 分不出是哪一步挂的;而排查手册正让内网的人去搜 `--- npm stderr ---` 这个字符串。
 */
const run = async (bin, argv, cwd, label) => {
  const tag = label || path.basename(bin)
  log(`$ ${bin} ${argv.join(" ")}${cwd ? `   (cwd=${cwd})` : ""}`)
  const started = Date.now()
  const child = spawn(bin, argv, { cwd, stdio: ["ignore", "pipe", "pipe"], env: childEnv() })
  const outTail = tailBuffer(RUN_TAIL_KB)
  const errTail = tailBuffer(RUN_TAIL_KB)
  // 两条都转发到 **stderr**:stdout 是契约流,不能混进子进程的话(§5.1.1)
  child.stdout.on("data", (b) => {
    outTail.push(b)
    process.stderr.write(b)
  })
  child.stderr.on("data", (b) => {
    errTail.push(b)
    process.stderr.write(b)
  })
  const r = await new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      resolve(v)
    }
    // spawn 失败(ENOENT 等)走 error;正常结束走 close ——
    // 用 close 而不是 exit:exit 可能早于 stdout/stderr 读完,那样会丢掉最后几行
    child.on("error", (e) => finish({ status: null, error: e }))
    child.on("close", (code) => finish({ status: code, error: null }))
  })
  // echo: false —— 上面已经边跑边转发过了,这里只补日志,不然人会看到两份
  logChild(`${tag} stdout`, outTail.buffer(), { tailKb: RUN_TAIL_KB, total: outTail.total, echo: false })
  logChild(`${tag} stderr`, errTail.buffer(), { tailKb: RUN_TAIL_KB, total: errTail.total, echo: false })
  log(`[exit] ${tag} status=${r.status ?? "null"} ${Date.now() - started}ms`)
  // 这里不抛 spawn 的原始异常就没人抛了 —— 调用方接着用 e.message 拼 RESULT 行,
  // 所以把**最有用的那一行**(由 errorTail 挑,不是末行 —— 见它的注释)带上,
  // 别让契约行只剩个退出码。
  if (r.error) {
    r.error.message = `${bin}: ${r.error.message}`
    throw r.error
  }
  if (r.status !== 0) {
    const tail = errorTail(errTail.buffer()) || errorTail(outTail.buffer())
    throw new Error(`${tag} 退出码 ${r.status}${tail ? ` | ${tail}` : ""}`)
  }
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
const runYarn = async (argv, cwd) => {
  const yarnJs = resolveYarnJs(P)
  if (yarnJs) return run(RT.node, [yarnJs, ...argv], cwd, "yarn")
  if (process.platform === "win32") {
    fail("YARN_NOT_FOUND", `装好了 yarn 却找不到它的 JS 入口(${P.node} 下)`, {
      hint: `把 ${P.node} 的目录树报给用户,由人判断是重装还是修复。不要自己执行删除命令(见 SKILL.md 硬约束 0)`,
    })
  }
  log(`[warn] 找不到 yarn 的 JS 入口,直接执行 ${P.yarnBin}`)
  return run(P.yarnBin, argv, cwd, "yarn")
}

/**
 * registry 的回落源:**skill 自带的 `references/env.manifest.json` 的 `npmRegistry`**。
 *
 * 装 yarn 这一步必须显式给 registry —— 此刻还没有任何项目级配置可依赖(cwd 不在 deps/ 下)。
 * 命令行 `--registry` 优先(安装脚本从远端 manifest 取到时会传),但手上有能跑的 node 时
 * 安装脚本**根本不去拉 manifest**(那正是 v16 的收益:绕开曾经 504 / 403 的那条链路),
 * 于是需要一个**不走网络的本地来源** —— skill 自带的那份 manifest 就是它,随 skill 包走。
 *
 * ⚠️ **绝对不能回落到 `template/.npmrc`**(v16 起草时就是这么写的,2026-09-14 复核发现是错的)。
 * 那两个 registry 是**两件东西**,§4.1「③④ 的 registry 必须分开处理」说的就是它们:
 *   - `npmRegistry`(manifest)     → 通用 npm 镜像,**yarn 这个包只在这里有**
 *   - `template/.npmrc` 的 registry → 项目依赖源(外加 @lake / @turboui 各 scope 独立源),
 *                                     只服务这棵依赖树,**装 yarn 会直接报错**
 * 拿后者去装 yarn,复用系统 node 的机器(v16 的主路径)首装必挂在 `npm i -g yarn` 这一步。
 */
function registryFromSkillManifest() {
  return String(manifest.npmRegistry ?? "")
}

/**
 * 第四档(什么都没配到)时,本机 npm 配置生效的那个值 —— **只为把它打进日志**。
 *
 * 这一档的源来自机器上的 `~/.npmrc`,是整条回落链里唯一我们完全不控的输入,
 * 却恰恰是最需要看清的一档:它万一指着公网 `registry.npmjs.org`,表现是超时 /
 * ECONNREFUSED,而排查手册会把人引向"首选怀疑代理" —— 又一次"错误信息指向错误方向"。
 * 打一行本地进程调用换来的可观测性(不走网络),让手册那条"看 registry=<X>"恒定有 X 可看。
 *
 * 拿不到就返回空串,继续走 —— 这只是诊断,不能因为诊断失败挡住安装。
 */
function registryFromLocalNpmConfig(npmJs) {
  try {
    return execFileSync(RT.node, [npmJs, "config", "get", "registry"], { encoding: "utf8", env: childEnv() }).trim()
  } catch {
    return ""
  }
}

// ── ③ 装 yarn ────────────────────────────────────────────────────
//
// **`--prefix` 固定指向共享池里的 `node/`**,这一步因此与"node 是哪来的"无关:
// 全局安装落在我们自己的目录里,不碰 /usr/local,**系统 node 下同样不需要 sudo**
// (2026-09-11 实测:`npm i -g yarn --prefix=<自定义目录>` 装到 <prefix>/bin/yarn,
// 权限、软链都正常)。Agent 内执行 sudo 会静默挂住等密码、没有交互通道 ——
// 要躲的是这个,而 portable node 只是躲开它的**一种**办法,不是唯一一种(§4.1)。
if (!exists(P.yarnBin)) {
  // 回落链:命令行(远端 manifest)→ 环境变量 → skill 自带的 manifest → 本机 npm 配置。
  //
  // **第四档为什么不响亮失败**:`references/env.manifest.json` 的 `npmRegistry` 是随 skill 包
  // 提交的,所以走到第四档等价于"skill 包是旧版本或坏了"。此时 `OCTO_NPM_REGISTRY` 这个逃生口
  // 还在,而硬失败会让一台其实装得上的机器直接停摆 —— 正是 v16 想避免的那类代价。
  // 代价换成**可观测**:下面把本机 npm 生效的那个值也打进日志(§5.1.1),不留"没有源可看"的死角。
  const registry = String(args.registry || process.env.OCTO_NPM_REGISTRY || registryFromSkillManifest() || "")
  // npm 也不能直接 spawn `npm.cmd`(Node 18+ 禁执行 .cmd/.bat,报 EINVAL),
  // 而系统 node 的 npm 布局与 portable 包的又不同 —— 顺着 node 二进制去找它自己的 npm。
  const npmJs = resolveNpmJs(RT.node)
  if (!npmJs) {
    fail("NPM_NOT_FOUND", `找不到 ${RT.node} 对应的 npm`, {
      hint: "这个 node 没带 npm(精简发行版或被裁剪过)。装一个自带 npm 的 node,或让安装脚本下载 portable node:install.sh / install.ps1 不带 --skip-node 重跑",
    })
  }
  const argv = [npmJs, "install", "-g", "yarn", `--prefix=${P.node}`]
  if (registry) argv.push(`--registry=${registry}`)   // ← 只有装 yarn 这一步传 registry
  // 这一行是排查手册 §2.2 的判读依据,**必须恒有一个源可看**:配到了就打配到的,
  // 没配到就把本机 npm 生效的那个查出来打(见 registryFromLocalNpmConfig)。
  const effectiveReg = registry || registryFromLocalNpmConfig(npmJs)
  log(
    `[yarn] 装到 ${P.node},registry=${effectiveReg || "(取不到)"}` +
      (registry ? "" : "(本机 npm 配置 —— skill 自带 manifest 里没有 npmRegistry,多半是旧版 skill 包)"),
  )
  try {
    await run(RT.node, argv, undefined, "npm")
  } catch (e) {
    fail("YARN_INSTALL_FAILED", `安装 yarn 失败: ${e.message}`, { hint: registry ? undefined : "试试 --registry=<内网 npm 源>" })
  }
  if (!exists(P.yarnBin) && !resolveYarnJs(P)) {
    // npm 退出码 0 但东西不在该在的地方 —— 多半是机器上的 `~/.npmrc` 里写死了 `prefix=`。
    // 在这里响亮失败,别让它拖到后面变成"找不到 yarn 的 JS 入口"那种离根因很远的形态。
    fail("YARN_INSTALL_FAILED", `npm 报成功,但 ${P.yarnBin} 不存在`, {
      hint: "多半是 ~/.npmrc 里有 prefix= 之类的全局配置在抢落点。把 npm config list 的输出报给用户",
    })
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
  await runYarn(["install"], P.deps)
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

const nodeVersion = execFileSync(RT.node, ["-v"], { encoding: "utf8" }).trim()
let yarnVersion = ""
try {
  const yarnJs = resolveYarnJs(P)
  yarnVersion = yarnJs
    ? execFileSync(RT.node, [yarnJs, "-v"], { encoding: "utf8" }).trim()
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
  // 记的是**实际装依赖时用的那个 node**,精确到小版本 —— ensure-env 只比大版本(§5.2),
  // 这两个字段是诊断用:"同一台机器行为变了"时,先看它是不是换了运行时。
  nodeVersion,
  nodeSource: RT.source,
  nodePath: RT.node,
  yarnVersion,
  installedAt: new Date().toISOString(),
  keyPackages,
}
writeFileSync(P.lockFile, JSON.stringify(lock, null, 2))

ok({
  ENV_DIR: P.root,
  ENV_VERSION: lock.envVersion,
  NODE_VERSION: nodeVersion,
  NODE_SOURCE: RT.source,
  YARN_VERSION: yarnVersion,
  DEPS_DIR: P.depsModules,
  LOCKFILE_HASH: gotHash,
  MODE: isUpgrade ? "upgrade" : "install",
})
