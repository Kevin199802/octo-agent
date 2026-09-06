import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"

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
 * 原子地占住一个端口号。
 *
 * 只读一张"已登记端口"表是不够的 —— 并发跑的多个 new-session 读到的表都还是空的,
 * 于是全都选中同一个端口(V0-a 实测:5 个进程只拿到 3 个不同端口)。
 * 这里用 O_EXCL 创建标记文件:创建成功即占到,这一步是原子的,没有检查与使用之间的窗口。
 *
 * 标记文件会自清理:里面记着占用它的会话目录,那个会话的状态文件没了就视为陈旧。
 *
 * @returns 占到返回 true
 */
export function claimPort(octoRoot, port, sessionRoot) {
  const dir = path.join(octoRoot, ".ports")
  mkdirSync(dir, { recursive: true })
  const f = path.join(dir, String(port))
  const mark = () => JSON.stringify({ sessionRoot, at: Date.now() })
  try {
    writeFileSync(f, mark(), { flag: "wx" })
    return true
  } catch {
    /* 已存在,往下判断是不是自己的、或者是不是陈旧的 */
  }

  let owner = null
  try {
    owner = JSON.parse(readFileSync(f, "utf8"))
  } catch {
    return false
  }
  if (owner?.sessionRoot === sessionRoot) return true // 重入:同一个会话再跑一次

  // 陈旧判据要两条同时成立。只看"状态文件不存在"是不够的:
  // 占位与写状态文件之间有几十毫秒窗口,并发时后来者会把前一个刚占的位当成陈旧回收掉
  // (V0-a 实测:8 个进程里有两个都拿到 8081)。加一条"标记至少 60 秒没人接手"堵住这个窗口。
  const stale = Date.now() - Number(owner?.at ?? 0) > 60_000
  const abandoned = !existsSync(path.join(String(owner?.sessionRoot ?? ""), ".octo-fastui.json"))
  if (stale && abandoned) {
    try {
      unlinkSync(f)
      writeFileSync(f, mark(), { flag: "wx" })
      return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * 从 start 向上找第一个空闲且能占住的端口。端口号可预测,便于排查(§6.2①)。
 *
 * 两道判据缺一不可:probe() 管"系统层面有没有别的进程在听",
 * claimPort() 管"有没有别的会话已经选了它但还没 listen"。
 */
export async function findFreePort(start, tries = 50, claim = null) {
  for (let p = start; p < start + tries; p++) {
    if (!(await probe(p))) continue
    if (claim && !claim(p)) continue
    return p
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
