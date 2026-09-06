/**
 * webpack 编译结果判定(SPEC-DES-001 §5.5.1)
 *
 * dev server 是常驻 watch 的,模型写文件的过程中就会被触发,所以不能
 * "日志里最后一条是什么就报什么" —— 那会读到两类假信号:
 *   假失败:模型正在写多个文件,webpack 在只写了一半时编了一次
 *   假成功:读到的是模型改动之前那一轮的结果
 *
 * 判定规则(三条同时满足):
 *   1. 该次编译的开始时刻晚于本次 views/ 下所有文件的最新 mtime
 *   2. 匹配到完整的一对「开始 → 结束」,只看到结束不算
 *   3. 结束后 settleMs 内没有新的「开始」出现 —— 把"等模型写完"(不可观测)
 *      换成"等 webpack 不再被触发"(可观测)
 *
 * ⚠️ 下面这些标志是按 webpack / vue-cli-service 的通行输出写的,
 *    turbo-ui-cli-service 的实际形态待内网首次实测后校准 —— 校准时只改这里。
 */
export const MARKERS = {
  start: [/\bCompiling\b/i, /webpack\.Progress\]\s+0%/i, /\bBuilding\b.*\bmodules\b/i, /\bwebpack\s+\d+\.\d+.*compiling/i],
  success: [/Compiled\s+successfully/i, /\bDONE\b.*Compiled/i, /successfully\s+compiled/i, /Build\s+complete/i],
  failure: [/Failed\s+to\s+compile/i, /\bERROR\s+in\b/, /Module\s+not\s+found/i, /\bSyntaxError\b/],
}

const hit = (line, res) => res.some((re) => re.test(line))

/**
 * 从日志文本里切出一次次编译。返回按出现顺序排列的编译轮次。
 * @param {string} text
 * @returns {{startIdx:number, endIdx:number|null, outcome:"success"|"failure"|null, lines:string[]}[]}
 */
export function parseRounds(text) {
  const lines = text.split(/\r?\n/)
  const rounds = []
  let cur = null
  // 结束标志之后还继续收几行:内网实测 turbo-ui-cli-service 的形态是
  // `ERROR Failed to compile with N errors` 在前、逐条明细在后,停早了会把错误详情切掉。
  // 但收集必须在下一轮 start 处硬停,否则下一轮的 `Compiled successfully`
  // 会混进上一轮的错误块里(实测踩到过)。
  const TAIL_BUDGET = 40
  let tail = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (hit(l, MARKERS.start)) {
      // 连续的 start(webpack 的 Progress 会刷很多行)归入同一轮
      if (!cur || cur.outcome !== null) {
        cur = { startIdx: i, endIdx: null, outcome: null, lines: [] }
        rounds.push(cur)
        tail = 0
      }
      continue
    }
    if (!cur) continue
    if (cur.outcome !== null) {
      if (tail >= TAIL_BUDGET) continue
      tail++
      cur.lines.push(l)
      continue
    }
    cur.lines.push(l)
    if (hit(l, MARKERS.failure)) {
      cur.outcome = "failure"
      cur.endIdx = i
    } else if (hit(l, MARKERS.success)) {
      cur.outcome = "success"
      cur.endIdx = i
    }
  }
  return rounds
}

/** 失败轮次里挑出给模型看的部分:含 file:line 的错误原文,去掉进度噪音 */
export function extractErrors(round, maxLines = 60) {
  const noise = /webpack\.Progress\]|\d+%\s+(building|after|sealing|emitting)/i
  const out = round.lines.filter((l) => l.trim() && !noise.test(l))
  return out.slice(0, maxLines).join("\n")
}
