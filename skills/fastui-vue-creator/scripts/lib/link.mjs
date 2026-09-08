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

  // **不经 cmd.exe**(v14):Node 原生支持 junction,同样不需要管理员权限。
  //
  // 走 `cmd /c mklink` 会连撞两层编码:Node 按 UTF-8 编码 argv 交给 cmd.exe,
  // 而 cmd 按系统 ANSI(内网 GBK)解释 —— 中文路径直接变乱码、mklink 失败;
  // 失败后 `stdio: "pipe"` 捕获回来的 GBK stderr 又被按 UTF-8 解,
  // **抛出的错误信息本身也是乱码**。
  //
  // 2026-09-07 内网因此出过一次事故:agent 看到"乱码路径 + 乱码报错",
  // 把用户的正常目录判成失败操作留下的残留,执行 Remove-Item -Recurse -Force
  // 永久删除(绕过回收站)。根治办法是让这条路径压根不经过 cmd.exe。见 §5.1.2。
  //
  // junction 要求目标是绝对路径,这里显式 resolve 一次,不依赖调用方。
  symlinkSync(path.resolve(targetPath), linkPath, process.platform === "win32" ? "junction" : "dir")
  return "created"
}
