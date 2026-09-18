/**
 * 与宿主(Octo 桌面端主进程)的协作(SPEC-DES-004 §3.7)。
 *
 * 在 Octo 里,dev server 一律由宿主起并持有 —— 脚本是短命进程,自己起的服务宿主收不到,
 * 关掉 Octo 后就成了占着端口的孤儿。所以脚本需要服务时**投一个请求**,由宿主去起。
 *
 * 请求放在共享池下的**全局目录**,而不是会话目录:后台跑着的对话用户未必点开过,
 * 宿主不可能提前知道要去监听哪个会话目录;共享池一台机器只有一份,宿主盯住它就够了。
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"

export const requestDir = (envRoot) => path.join(envRoot, ".devserver-requests")

/**
 * 每次起 dev server 之前往它的日志里写一行这个标记(宿主与本脚本都写)。
 * 日志是按产物追加的,换过进程之后,verify 靠它找到「新进程从哪一行开始」,
 * 旧进程那几轮编译结果不作数。标记行不匹配 lib/compile.mjs 的任何编译标志。
 */
export const START_MARK = "[octo-devserver] start port="
export const pidRegistryDir = (envRoot) => path.join(envRoot, ".devserver-pids")
const heartbeatFile = (envRoot) => path.join(envRoot, ".octo-host.json")

export function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM:进程在,只是不归我们管 —— 仍算活着
    return e?.code === "EPERM"
  }
}

/**
 * 宿主在不在。
 *
 * 判据是宿主写的心跳文件里的 pid 还活着。pid 被复用会误判成"在" —— 后果只是多等一会儿
 * 再自己起,不会出错;反过来误判成"不在"才麻烦(会和宿主各起一个),而 pid 活着这一条不会漏报。
 */
export function hostPresent(envRoot) {
  try {
    const hb = JSON.parse(readFileSync(heartbeatFile(envRoot), "utf8"))
    return pidAlive(Number(hb?.pid))
  } catch {
    return false
  }
}

/**
 * 请宿主为某个产物工程起服务(已在跑的话宿主会直接复用,重复投递无害)。
 * 先写临时名再改名 —— 宿主只读 `.json`,不会读到写了一半的文件。
 */
export function postRequest(envRoot, { sessionDir, projectDir, name }) {
  const dir = requestDir(envRoot)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const tmp = path.join(dir, `${id}.json.tmp`)
  writeFileSync(tmp, JSON.stringify({ sessionDir, projectDir, name, at: Date.now() }))
  renameSync(tmp, path.join(dir, `${id}.json`))
}

/** 登记自己起的 dev server,供宿主下次启动时清理(脚本退出后没人管它) */
export function registerPid(envRoot, record) {
  const dir = pidRegistryDir(envRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${record.pid}.json`), JSON.stringify(record))
}

/**
 * 结束一个 dev server 及其子进程。
 * Windows 用 taskkill /T;其他平台服务是以独立进程组起的,向整组发信号。
 */
export function killTree(pid) {
  if (!pidAlive(pid)) return
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
    } else {
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        process.kill(pid, "SIGKILL")
      }
    }
  } catch {
    /* 已经退出 */
  }
}
