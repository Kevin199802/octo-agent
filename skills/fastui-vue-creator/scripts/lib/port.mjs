import net from "node:net"

/** 能不能在 127.0.0.1 上绑住这个端口 */
function bindable(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })
}

/**
 * 端口空闲?
 *
 * 只试绑 127.0.0.1 有盲区:监听在 0.0.0.0 / :: / ::1 上的进程看不到(macOS 上 Node 给监听设了
 * SO_REUSEADDR,别人占着 0.0.0.0 时照样能绑上 127.0.0.1),于是可能两个服务占着同一个端口号。
 *
 * **不改成去试绑 0.0.0.0**:Windows 上监听非环回地址会弹防火墙确认框(SPEC-DES-001 §6.4)。
 * 改为补连接探测 —— 发往环回地址的连接同样会落到通配地址上的监听,有人应答就是被占。
 */
export async function probe(port) {
  if (!(await bindable(port))) return false
  if (await isServing(port, 800, "127.0.0.1")) return false
  if (await isServing(port, 800, "::1")) return false
  return true
}

/**
 * 从 start 向上找第一个空闲端口。
 *
 * 只在 spawn 的那一刻调用 —— 端口不写进卡片、不写进状态文件,也就不需要登记表
 * (SPEC-DES-004 §3.4)。探测到 listen 之间的窗口由调用方的 EADDRINUSE 重试兜住。
 */
export async function findFreePort(start, tries = 50) {
  for (let p = start; p < start + tries; p++) {
    if (await probe(p)) return p
  }
  return null
}

/** dev server 是否已经在这个端口上应答 */
export function isServing(port, timeoutMs = 1500, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const req = net.connect({ port, host })
    const done = (v) => {
      req.destroy()
      resolve(v)
    }
    req.setTimeout(timeoutMs, () => done(false))
    req.once("connect", () => done(true))
    req.once("error", () => done(false))
  })
}
