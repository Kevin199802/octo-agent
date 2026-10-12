import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

/** 文件的 sha256,读不到返回 null(调用方据此区分"不一致"与"文件不存在") */
export function sha256File(p) {
  try {
    return "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex")
  } catch {
    return null
  }
}

/**
 * 归一化十六进制摘要再比对。
 *
 * 十六进制大小写不敏感,但来源不统一:node 产出小写、nodejs.org 的 SHASUMS256.txt 是小写、
 * 而 PowerShell 的 Get-FileHash 输出全大写 —— 直接字符串比会把"完全正确的包"判成损坏。
 * 顺带剥掉可选的 "sha256:" 前缀,manifest 里写不写都认。
 */
export function sameHash(a, b) {
  const norm = (x) =>
    String(x ?? "")
      .trim()
      .toLowerCase()
      .replace(/^sha256:/, "")
  const na = norm(a)
  const nb = norm(b)
  return na.length > 0 && na === nb
}
