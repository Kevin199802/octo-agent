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
 * 标记文件会自清理:里面记着占用它的会话目录,那个会话不再认领这个端口就视为陈旧。
 *
 * **`registryRoot` 必须是共享池(每台机器一份),不能是工作目录**(SPEC-DES-004 §4.2)。
 * 登记表原来建在 `<用户所选目录>/.octo/.ports/`,而端口是全机资源 —— 两个对话挂在不同
 * 工作目录时,两张表互不可见、都从 8081 开始扫,这套互斥等于没有(2026-09-14 外网实测:
 * 跨目录并发必撞)。作用域对齐后,同目录那套判据一个字都不用改(E1/E6 复验仍有效)。
 *
 * @param registryRoot 共享池根目录(`envPaths().root`)
 * @returns 占到返回 true
 */
export function claimPort(registryRoot, port, sessionRoot, meta = {}) {
  const dir = path.join(registryRoot, ".ports")
  mkdirSync(dir, { recursive: true })
  const f = path.join(dir, String(port))
  // projectDir 只为排查:一张全机表上看到 8083 被占,得能一眼知道是哪个工程占的
  const mark = () => JSON.stringify({ sessionRoot, projectDir: meta.projectDir ?? null, at: Date.now() })
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

  // 陈旧判据要两条同时成立。只看第二条是不够的:
  // 占位与写状态文件之间有几十毫秒窗口,并发时后来者会把前一个刚占的位当成陈旧回收掉
  // (V0-a 实测:8 个进程里有两个都拿到 8081)。加一条"标记至少 60 秒没人接手"堵住这个窗口。
  const stale = Date.now() - Number(owner?.at ?? 0) > 60_000
  if (stale && abandonedBy(owner, port)) {
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
 * 标记的主人还认领这个端口吗。
 *
 * 两支缺一不可:
 *   · 会话状态文件没了 —— 会话被删,标记是孤儿
 *   · 状态文件还在,但里面记的端口**已经不是这个端口** —— 宿主起服务时发现原端口被占,
 *     换了一个并回写了状态文件(SPEC-DES-004 §4.3);旧标记从那一刻起就是孤儿
 *
 * 没有第二支的话,登记表提到"一台机器一张"之后会单调累积、永不释放:
 * 一台机器上做过的每一个 fastui 会话都会终身占住一个端口号。
 *
 * **反过来,状态文件里还记着这个端口就绝不能回收** —— 那个会话的 dev server 可能只是
 * 被宿主的 LRU 暂时关掉了(`MAX_SERVERS = 3`),用户切回去就要用它。
 */
function abandonedBy(owner, port) {
  const state = path.join(String(owner?.sessionRoot ?? ""), ".octo-fastui.json")
  if (!existsSync(state)) return true
  try {
    return Number(JSON.parse(readFileSync(state, "utf8"))?.port) !== Number(port)
  } catch {
    return true // 状态文件读不动(写坏了/正在写),按孤儿处理 —— 上面的 60 秒窗口已经挡住了写入中的情况
  }
}

/**
 * 从 start 向上找第一个空闲且能占住的端口。端口号可预测,便于排查(§6.2①)。
 *
 * 两道判据缺一不可:probe() 管"系统层面有没有别的进程在听",
 * claimPort() 管"有没有别的会话已经选了它但还没 listen"。
 *
 * tries 从 50 放宽到 200(SPEC-DES-004 §4.2):登记表提到"一台机器一张"之后,
 * 表上的条目是全机所有工作目录累加的,50 个额度比原来紧得多。多扫几个端口零成本,
 * 而扫不到时报的 NO_FREE_PORT 对用户来说是条死路。
 */
export async function findFreePort(start, tries = 200, claim = null) {
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
