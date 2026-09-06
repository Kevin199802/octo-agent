/**
 * 平台路径推导(SPEC-DES-001 §3.1 / §4.4.6)。
 *
 * skill 落在 .octo/skills/<skillName>/,但这里一律用 import.meta.url 往上推,
 * 不硬编码 —— 前期以自定义技能验证、后期上架平台技能,路径不用改。
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** scripts/lib/paths.mjs → skill 根 */
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

export const TEMPLATE_DIR = path.join(SKILL_DIR, "template")
export const VENDOR_DIR = path.join(SKILL_DIR, "vendor")

export function readManifest() {
  const p = path.join(SKILL_DIR, "references", "env.manifest.json")
  return JSON.parse(readFileSync(p, "utf8"))
}

/**
 * 共享池目录。OCTO_FASTUI_ENV_DIR 可覆盖(本地 V0 验证必需)。
 *
 * Windows 必须用 LOCALAPPDATA 而非 APPDATA —— 后者是 Roaming,
 * 域环境下 1GB 依赖会被漫游配置同步,设计师登录时会卡死(§3.1)。
 */
export function envDir(override) {
  if (override) return path.resolve(String(override))
  if (process.env.OCTO_FASTUI_ENV_DIR) return path.resolve(process.env.OCTO_FASTUI_ENV_DIR)
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local")
    return path.join(base, "OctoAgent", "fastui-env")
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "OctoAgent", "fastui-env")
  }
  // Linux 不是目标平台,但本地验证可能用到
  return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "OctoAgent", "fastui-env")
}

/**
 * 共享池里的 node/yarn 优先,没有就用系统的 —— 能跑起来最重要。
 * 真正不可替代的是 deps/(1GB 内网组件库),不是运行时本身。
 */
export function resolveRuntime(P) {
  const sysNode = process.execPath
  return {
    node: existsSync(P.nodeBin) ? P.nodeBin : sysNode,
    nodeIsSystem: !existsSync(P.nodeBin),
  }
}

export const envPaths = (dir) => ({
  root: dir,
  node: path.join(dir, "node"),
  nodeBin: process.platform === "win32" ? path.join(dir, "node", "node.exe") : path.join(dir, "node", "bin", "node"),
  yarnBin: process.platform === "win32" ? path.join(dir, "node", "yarn.cmd") : path.join(dir, "node", "bin", "yarn"),
  deps: path.join(dir, "deps"),
  depsModules: path.join(dir, "deps", "node_modules"),
  depsLock: path.join(dir, "deps", "yarn.lock"),
  lockFile: path.join(dir, "env.lock.json"),
})

/** platform-arch,用于在 manifest.json 里挑包 */
export function platformKey() {
  return `${process.platform}-${process.arch}`
}

/**
 * 会话布局(§3.2)。[Artifact Folder] 就是 .octo/<sid>/outputs。
 *
 * v12:依赖链接建在**工程根**(`outputs/<产物名>/node_modules`),即标准布局。
 * v6~v11 建在会话根(outputs 的父级),为的是"产物目录零链接、随手压缩安全",
 * 代价是产物目录里 `yarn serve` 跑不起来(yarn 只从工程根的 node_modules/.bin 找命令)。
 * 那个代价会落到最不该承担它的人身上 —— 设计师拉产线开发对接时,对方第一件事就是
 * `yarn serve`,跑不起来会被直接判定成"生成的代码有问题"。压缩体积是小事,交付信任不是。
 * 干净交付包改由 export-zip 产出(排除 node_modules),那才是设计师拿走代码的主路径。
 */
export function sessionPaths(artifactDir) {
  const outputs = path.resolve(artifactDir)
  const sessionRoot = path.dirname(outputs)
  return {
    outputs,
    sessionRoot,
    state: path.join(sessionRoot, ".octo-fastui.json"),
    devserver: path.join(sessionRoot, ".devserver.json"),
    devserverLog: path.join(sessionRoot, "devserver.log"),
  }
}

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return fallback
  }
}

export const exists = (p) => existsSync(p)
