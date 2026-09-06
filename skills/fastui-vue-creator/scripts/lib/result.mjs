/**
 * 脚本输出契约(SPEC-DES-001 §5.2)。
 *
 * stdout 只放契约行,过程输出一律走 stderr —— agent 解析 stdout,人看 stderr。
 * 失败原因写成「英文错误码: 中文说明」:内网 Windows 终端代码页是 GBK,
 * 中文可能显示成乱码,但错误码是 ASCII,截图出来仍然可读(§8.4)。
 */

/** @param {Record<string, string|number|undefined>} fields */
export function ok(fields = {}) {
  const lines = ["RESULT: OK"]
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    lines.push(`${k}: ${v}`)
  }
  process.stdout.write(lines.join("\n") + "\n")
  process.exit(0)
}

/**
 * @param {string} code  英文错误码,如 ENV_MISSING
 * @param {string} reason 中文一句话说明
 * @param {{hint?: string, log?: string, extra?: Record<string, string|number|undefined>}} [opts]
 */
export function fail(code, reason, opts = {}) {
  const lines = [`RESULT: FAIL | ${code}: ${reason}`]
  if (opts.hint) lines.push(`HINT: ${opts.hint}`)
  if (opts.log) lines.push(`LOG: ${opts.log}`)
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (v === undefined || v === null) continue
    lines.push(`${k}: ${v}`)
  }
  process.stdout.write(lines.join("\n") + "\n")
  process.exit(1)
}

/** 用法错误(参数缺失/非法),与业务失败区分:退出码 2 */
export function usage(reason) {
  process.stdout.write(`RESULT: FAIL | BAD_USAGE: ${reason}\n`)
  process.exit(2)
}

/** 不阻塞的诊断行,累积后随 ok() 一起输出 */
export function warn(msg) {
  process.stdout.write(`WARN: ${msg}\n`)
}

/** 多行块(目前只有 verify 的编译错误原文用) */
export function block(name, text) {
  process.stdout.write(`${name}_BEGIN\n${text.replace(/\s+$/, "")}\n${name}_END\n`)
}

/** 过程输出:给人看,不进契约 */
export function log(msg) {
  process.stderr.write(`${msg}\n`)
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
