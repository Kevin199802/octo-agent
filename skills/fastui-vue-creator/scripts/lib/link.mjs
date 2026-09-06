import { execFileSync } from "node:child_process"
import { lstatSync, readlinkSync, symlinkSync } from "node:fs"
import path from "node:path"

/**
 * 建依赖链接(§2):Windows 用目录联接 junction,macOS 用 symlink —— 两者都不需要管理员权限。
 * 幂等:已指向正确目标就跳过;指向别处则报错,不擅自改用户的东西。
 *
 * @returns {"created"|"reused"}
 */
export function ensureDirLink(linkPath, targetPath) {
  let st = null
  try {
    st = lstatSync(linkPath)
  } catch {
    /* 不存在,继续创建 */
  }

  if (st) {
    if (st.isSymbolicLink()) {
      const cur = path.resolve(path.dirname(linkPath), readlinkSync(linkPath))
      if (cur === path.resolve(targetPath)) return "reused"
      throw new Error(`${linkPath} 已存在但指向 ${cur},期望 ${targetPath}`)
    }
    if (st.isDirectory()) {
      // Windows 的 junction 在 lstat 下表现为目录,无法直接读出目标,
      // 只能认它已存在 —— 重建的风险高于复用。
      if (process.platform === "win32") return "reused"
      throw new Error(`${linkPath} 已存在且是真实目录(不是链接),请先手动确认后移除`)
    }
    throw new Error(`${linkPath} 已存在且不是目录`)
  }

  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "mklink", "/J", linkPath, targetPath], { stdio: "pipe" })
  } else {
    symlinkSync(targetPath, linkPath, "dir")
  }
  return "created"
}
