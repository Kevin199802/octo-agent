import net from "node:net"

/** 端口空闲? 只探 127.0.0.1 —— dev server 也只监听环回(§6.4) */
export function probe(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })
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
export function isServing(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = net.connect({ port, host: "127.0.0.1" })
    const done = (v) => {
      req.destroy()
      resolve(v)
    }
    req.setTimeout(timeoutMs, () => done(false))
    req.once("connect", () => done(true))
    req.once("error", () => done(false))
  })
}
