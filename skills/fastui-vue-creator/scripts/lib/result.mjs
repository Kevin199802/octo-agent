/**
 * 脚本输出契约(SPEC-DES-001 §5.1.1)。
 *
 * stdout 只放契约行,过程输出一律走 stderr —— agent 解析 stdout,人看 stderr。
 * 失败原因写成「英文错误码: 中文说明」:内网 Windows 终端代码页是 GBK,
 * 中文可能显示成乱码,但错误码是 ASCII,截图出来仍然可读(§8.4)。
 */
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

/**
 * 所有输出同时落盘一份(v15 S5:**不再只落契约行**)。
 *
 * 宿主 UI 未必把脚本 stdout 原样展示给人看(Octo 的 agent 侧做过大量改造),
 * 于是"失败信息自包含可截图"这个前提在真实环境里不成立 —— 人根本看不到那几行。
 * 落到一个路径固定、可预测的文件里,事后能查。
 *
 * v14 只有 ok()/fail() 落盘,于是 2026-09-08 那次 504 排查时,日志里只留下一句
 * `YARN_INSTALL_FAILED: … npm install -g yarn`,npm 自己打的几十行错误原文
 * (状态码、URL、重试记录)一个字节都没留下。判据是「发日志就能定位」,
 * 那次不成立 —— 所以 log()/warn()/block() 与子进程原文现在全部落盘。
 */
let LOG_SINK = null
let headerDone = false

export function setLogSink(p) {
  LOG_SINK = p
  headerDone = false
}

/** 当前日志路径,没设过就是 null —— fail() 用它自动补 `LOG:` 行 */
export function logPath() {
  return LOG_SINK
}

/**
 * 原样落盘。**收 Buffer 时不解码**:Windows 上 npm/yarn 的输出是 GBK 字节,
 * 按 UTF-8 解一遍再写回去就成了乱码,而那正是 §5.1.2 那条根因链的一环 ——
 * 日志里必须留下原始字节,人用什么编码打开是人的事。
 * @param {string|Buffer} chunk
 */
function persist(chunk) {
  if (!LOG_SINK) return
  try {
    mkdirSync(dirname(LOG_SINK), { recursive: true })
    if (!headerDone) {
      headerDone = true
      appendFileSync(LOG_SINK, `\n===== ${new Date().toISOString()} ${process.argv.slice(1).join(" ")}\n`)
    }
    appendFileSync(LOG_SINK, chunk)
  } catch {
    /* 落盘失败绝不能影响脚本本身 */
  }
}

/** hh:mm:ss —— 过程行带上它,好判断是哪一步耗了十分钟 */
const stamp = () => new Date().toTimeString().slice(0, 8)

/**
 * 契约里 `<KEY>: <value>` 是**单行**(§5.1.1)。值来自子进程输出时未必守规矩
 * (`yarn -v` 之类偶尔会多吐几行),多行会让 agent 把后续行当成新的 key 解析。
 * 多行内容有 block() 那条正路,这里一律压成一行。
 */
const oneLine = (v) => String(v).replace(/\s*\r?\n\s*/g, " ").trim()

/** @param {Record<string, string|number|undefined>} fields */
export function ok(fields = {}) {
  const lines = ["RESULT: OK"]
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    lines.push(`${k}: ${oneLine(v)}`)
  }
  const text = lines.join("\n") + "\n"
  persist(text)
  process.stdout.write(text)
  process.exit(0)
}

/**
 * @param {string} code  英文错误码,如 ENV_MISSING
 * @param {string} reason 中文一句话说明
 * @param {{hint?: string, log?: string, extra?: Record<string, string|number|undefined>}} [opts]
 */
export function fail(code, reason, opts = {}) {
  const lines = [`RESULT: FAIL | ${code}: ${oneLine(reason)}`]
  if (opts.hint) lines.push(`HINT: ${oneLine(opts.hint)}`)
  // 没显式给就用当前 sink —— 契约里 `LOG:` 本就是失败块的一部分(§5.1.1),
  // 而"日志在哪"是失败之后的第一个问题,不该靠调用方每处记得手写。
  const lp = opts.log ?? LOG_SINK
  if (lp) lines.push(`LOG: ${lp}`)
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (v === undefined || v === null) continue
    lines.push(`${k}: ${oneLine(v)}`)
  }
  const text = lines.join("\n") + "\n"
  persist(text)
  process.stdout.write(text)
  process.exit(1)
}

/** 用法错误(参数缺失/非法),与业务失败区分:退出码 2 */
export function usage(reason) {
  const text = `RESULT: FAIL | BAD_USAGE: ${reason}\n`
  persist(text)
  process.stdout.write(text)
  process.exit(2)
}

/** 不阻塞的诊断行,累积后随 ok() 一起输出 */
export function warn(msg) {
  const text = `WARN: ${oneLine(msg)}\n`
  persist(text)
  process.stdout.write(text)
}

/** 多行块(verify 的编译错误原文用) */
export function block(name, text) {
  const out = `${name}_BEGIN\n${text.replace(/\s+$/, "")}\n${name}_END\n`
  persist(out)
  process.stdout.write(out)
}

/** 过程输出:给人看,不进契约 */
export function log(msg) {
  process.stderr.write(`${msg}\n`)
  persist(`${stamp()} ${msg}\n`)
}

/** 整段报告(doctor 用):stdout 与日志各一份 */
export function emit(text) {
  persist(text)
  process.stdout.write(text)
}

/**
 * 子进程原文:原样落盘 + 原样转发到 stderr。
 *
 * 超长只留尾部 —— yarn install 顺利时能打几千行,全留会把日志撑爆;
 * 而排查要看的永远是**尾部**(失败发生在最后)。
 * @param {string} label 段落标题,如 `npm install -g yarn (stderr)`
 * @param {Buffer|null|undefined} buf
 * @param {number} tailKb 保留尾部多少 KB
 */
export function logChild(label, buf, tailKb = 64) {
  if (!buf || buf.length === 0) return
  const max = tailKb * 1024
  const cut = buf.length > max
  const body = cut ? buf.subarray(buf.length - max) : buf
  const head = `--- ${label}${cut ? ` (共 ${buf.length} 字节,只留尾部 ${tailKb}KB)` : ""} ---\n`
  persist(head)
  persist(body)
  if (body[body.length - 1] !== 0x0a) persist("\n")
  process.stderr.write(head)
  process.stderr.write(body)
}

/**
 * 取 buffer 里最后一行非空文本,给契约行当摘要用。
 * ANSI 颜色码与控制字符要剔掉 —— 否则 npm 的彩色输出会把 `RESULT:` 那行搅成乱麻。
 */
export function lastLine(buf, max = 200) {
  if (!buf || buf.length === 0) return ""
  const lines = buf
    .toString("utf8")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((s) => s.replace(/[\x00-\x1f\x7f]/g, " ").trim())
    .filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  return last.length > max ? last.slice(0, max) + "…" : last
}

/** 解析 --key=value / --flag 形式的参数 */
export function parseArgs(argv = process.argv.slice(2)) {
  /** @type {Record<string, string|boolean>} */
  const out = {}
  for (const a of argv) {
    if (!a.startsWith("--")) continue
    const eq = a.indexOf("=")
    if (eq === -1) out[a.slice(2)] = true
    else out[a.slice(2, eq)] = a.slice(eq + 1)
  }
  return out
}
