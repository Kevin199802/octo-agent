/**
 * 验证路径是否是有效的用户工作目录
 * 过滤无效路径：空字符串、'/' (Unix root)、Windows 盘符根
 */
export function isValidUserPath(path: string | undefined): boolean {
  if (!path || path === "") return false
  if (path === "/") return false  // Unix root 不适合作为用户工作目录
  // Windows: 排除仅有盘符的路径
  if (/^[A-Z]:$/i.test(path)) return false
  if (/^[A-Z]:[\\/]$/i.test(path)) return false
  return true
}
