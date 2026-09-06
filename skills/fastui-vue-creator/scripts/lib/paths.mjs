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
 * 会话布局(§3.2):[Artifact Folder] 就是 .octo/<sid>/outputs,
 * 依赖链接建在它的父级 —— 产物目录里因此零链接。
 */
export function sessionPaths(artifactDir) {
  const outputs = path.resolve(artifactDir)
  const sessionRoot = path.dirname(outputs)
  return {
    outputs,
    sessionRoot,
    link: path.join(sessionRoot, "node_modules"),
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
