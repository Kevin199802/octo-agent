// Insight 内网 debug 观测层(自包含,不动 opencode 上游)
// ─────────────────────────────────────────────────────────────
// 背景:opencode 数据流是「promptAsync 发出请求 → server 经 SSE /event 把这一轮所有变化
// 流式推回 → GlobalSync 的 event-reducer 写进 sync.data → memo 派生渲染」。promptAsync 成功
// 只代表请求受理,生成的真相全在 SSE event 里。内网只有 console、抓不到 Network/SSE 时,这一段
// 是盲区。本模块做两件事:
//   1. 旁路订阅 globalSDK.event.listen()(与 GlobalSync 的订阅并行、只读、互不影响),把当前
//      session 的每个 SSE event 打成 [octo:event] 日志。
//   2. 挂 window.octoDebug 控制台 API + 事件/发送环形缓冲:出 bug 后敲一行命令即可「回放」最近
//      发生的一切、dump 当前 session 原始数据,不必预先开日志重现。
//
// 文档:docs/insight-debugging.md(§日志字典 [octo:event] / §window.octoDebug 命令 / §Network 速查)

import type { Event, Message, Part } from "@opencode-ai/sdk/v2/client"

const LOG = "[octo:event]"

// 环形缓冲容量:默认静默/精简下也常驻内存,供 octoDebug.events()/sends() 回放。
const EVENT_RING_CAP = 200
const SEND_RING_CAP = 30
// 高频 message.part.delta 不逐条打,按 partID 聚合,最多每这么久 flush 一次摘要。
const DELTA_FLUSH_MS = 1000

export type DebugMode = "quiet" | "compact" | "verbose"

// doSendPrompt 每次发送时回灌的一条记录,供 octoDebug.lastSend()/sends() 回放「究竟发了什么」。
export type SendRecord = {
  ts: number
  source: string
  sessionID: string
  messageID: string
  model: { providerID: string; modelID: string } | undefined
  modelResolved: boolean
  statusAtSend: string
  cleanText: string
  uploadBlock: string
  attachmentsCount: number
  endpoint: string
}

type RingEntry = { ts: number; type: string; summary: unknown }

// 任意 event 的宽松视图(SDK 的 Event 是判别联合,这里按 type 取 properties 即可)
type AnyEvent = { type: string; properties?: Record<string, unknown> }

export type DebugDeps = {
  // useGlobalSDK() 返回值的子集
  globalSDK: {
    url?: string
    event: { listen: (cb: (e: { name: string; details: Event }) => void) => () => void }
  }
  // useSync().data —— 读当前 session 的库
  syncData: {
    message: Record<string, Message[] | undefined>
    part: Record<string, Part[] | undefined>
    session_status: Record<string, { type?: string } | undefined>
    permission: Record<string, unknown[] | undefined>
    question: Record<string, unknown[] | undefined>
  }
  // 取「当前所在 session」(响应式读 params.id)
  currentSessionID: () => string | undefined
}

export type InsightDebug = {
  recordSend: (rec: SendRecord) => void
  dispose: () => void
}

// ── 事件分类:决定精简模式下打不打 ───────────────────────────
// 全局/连接类:无 sessionID,任何模式(含精简)都打 —— 连接状态最关键。
const GLOBAL_TYPES = new Set([
  "server.connected",
  "global.disposed",
  "server.instance.disposed",
])
// 卡轮关键信号:agent 在等授权/等回答,这一轮会停住直到回复。精简模式也打,且用 warn 显眼。
const BLOCKING_TYPES = new Set(["permission.asked", "question.asked"])
const BLOCKING_RESOLVE_TYPES = new Set(["permission.replied", "question.replied", "question.rejected"])
// 精简模式默认打的 session 级事件(其余如 session.created/todo.updated/lsp.updated 仅 verbose 打)。
const COMPACT_SESSION_TYPES = new Set([
  "session.status",
  "message.updated",
  "message.part.updated",
  "message.part.removed",
  "message.removed",
])

/** 从 event 里尽量取出 sessionID(不同事件字段位置不同);取不到返回 undefined = 全局事件 */
function sessionIDOf(ev: AnyEvent): string | undefined {
  const p = ev.properties ?? {}
  if (typeof p.sessionID === "string") return p.sessionID
  const info = p.info as { sessionID?: string } | undefined
  if (info && typeof info.sessionID === "string") return info.sessionID
  const part = p.part as { sessionID?: string } | undefined
  if (part && typeof part.sessionID === "string") return part.sessionID
  return undefined
}

/** 精简模式下,把事件压成一行关键字段(verbose 模式直接打整个 properties) */
function compactSummary(ev: AnyEvent): unknown {
  const p = ev.properties ?? {}
  switch (ev.type) {
    case "session.status":
      return { status: (p.status as { type?: string })?.type, sessionID: p.sessionID }
    case "message.updated": {
      const info = p.info as { role?: string; id?: string; sessionID?: string } | undefined
      return { role: info?.role, msgID: info?.id }
    }
    case "message.part.updated": {
      const part = p.part as { type?: string; tool?: string; id?: string; messageID?: string; state?: { status?: string } } | undefined
      return { partType: part?.type, tool: part?.tool, partStatus: part?.state?.status, partID: part?.id, msgID: part?.messageID }
    }
    case "message.part.removed":
      return { partID: p.partID, msgID: p.messageID }
    case "message.removed":
      return { msgID: p.messageID }
    default:
      // permission/question/全局类:整包打,字段不确定但信息量最大
      return p
  }
}

export function installInsightDebug(deps: DebugDeps): InsightDebug {
  let mode: DebugMode = "compact"
  const eventRing: RingEntry[] = []
  const sendRing: SendRecord[] = []

  const pushEvent = (type: string, summary: unknown) => {
    eventRing.push({ ts: Date.now(), type, summary })
    if (eventRing.length > EVENT_RING_CAP) eventRing.shift()
  }

  // ── delta 聚合 ─────────────────────────────────────────────
  const deltaAgg = new Map<string, { count: number; chars: number; field: string; msgID: string }>()
  let deltaTimer: ReturnType<typeof setTimeout> | undefined
  const flushDeltas = () => {
    deltaTimer = undefined
    if (deltaAgg.size === 0) return
    const summary = Array.from(deltaAgg.entries()).map(([partID, a]) => ({
      partID, msgID: a.msgID, field: a.field, count: a.count, chars: a.chars,
    }))
    deltaAgg.clear()
    pushEvent("message.part.delta(agg)", summary)
    if (mode !== "quiet") console.log(`${LOG} message.part.delta ×聚合`, summary)
  }
  const armDeltaFlush = () => { if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS) }

  // ── 单个 event 处理 ───────────────────────────────────────
  const handle = (ev: AnyEvent) => {
    const sid = sessionIDOf(ev)
    const isGlobal = sid === undefined || GLOBAL_TYPES.has(ev.type)
    // 只关心当前 session(全局/连接事件除外),避免别的 session 噪音
    if (!isGlobal && sid !== deps.currentSessionID()) return

    // delta:聚合,不逐条进 ring;verbose 才逐条打
    if (ev.type === "message.part.delta") {
      const p = ev.properties ?? {}
      const partID = String(p.partID ?? "")
      const cur = deltaAgg.get(partID) ?? { count: 0, chars: 0, field: String(p.field ?? ""), msgID: String(p.messageID ?? "") }
      cur.count += 1
      cur.chars += typeof p.delta === "string" ? p.delta.length : 0
      deltaAgg.set(partID, cur)
      armDeltaFlush()
      if (mode === "verbose") console.log(`${LOG} message.part.delta`, { partID, field: p.field, deltaLen: (p.delta as string)?.length })
      return
    }

    // 非 delta:进 ring(精简或整包,取决于模式)
    const summary = mode === "verbose" ? (ev.properties ?? {}) : compactSummary(ev)
    pushEvent(ev.type, summary)

    if (mode === "quiet") return

    // 该不该往 console 打
    const shouldLog =
      isGlobal ||
      BLOCKING_TYPES.has(ev.type) ||
      BLOCKING_RESOLVE_TYPES.has(ev.type) ||
      COMPACT_SESSION_TYPES.has(ev.type) ||
      mode === "verbose"
    if (!shouldLog) return

    if (BLOCKING_TYPES.has(ev.type)) {
      // ⚠️ 卡轮信号:醒目 warn,这是「发了消息却卡住不动」最常见且当前不可见的根因
      console.warn(`${LOG} ${ev.type} ⚠️ agent 在等用户响应,这一轮会停住直到回复/拒绝`, ev.properties)
    } else {
      console.log(`${LOG} ${ev.type}`, summary)
    }
  }

  const unsub = deps.globalSDK.event.listen((e) => {
    try { handle(e.details as unknown as AnyEvent) } catch { /* 观测层永不影响主流程 */ }
  })

  // ── window.octoDebug 控制台 API ────────────────────────────
  const dbg = {
    help() {
      const lines = [
        "octoDebug —— Insight 内网控制台调试。命令:",
        "  octoDebug.state()        当前 session 状态摘要(status/消息数/未决 permission·question)",
        "  octoDebug.dump()         当前 session 完整 message+part 原始 JSON(出 bug 复制这个发出来)",
        "  octoDebug.events(n=50)   最近 n 条 SSE 事件(环形缓冲,可回放)",
        "  octoDebug.sends(n=10)    最近 n 次发送的完整入参",
        "  octoDebug.lastSend()     上一次发送(messageID/model/cleanText/uploadBlock/endpoint)",
        "  octoDebug.pending()      当前未回复的 permission/question(排查「卡住不动」)",
        "  octoDebug.snapshot()     一键打包现场(state+事件+发送+session 原始数据)并复制到剪贴板,粘给排查方",
        "  octoDebug.mode('quiet'|'compact'|'verbose')   切日志详尽度(默认 compact)",
        "  octoDebug.verbose(true|false)                 verbose 开关(等价 mode)",
      ]
      console.log(lines.join("\n"))
      return undefined
    },
    state() {
      const sid = deps.currentSessionID()
      if (!sid) return { sessionID: undefined, note: "当前在首页/无会话" }
      const msgs = deps.syncData.message[sid] ?? []
      return {
        sessionID: sid,
        status: deps.syncData.session_status[sid]?.type ?? "idle",
        messages: msgs.length,
        userMessages: msgs.filter((m) => m.role === "user").length,
        assistantMessages: msgs.filter((m) => m.role === "assistant").length,
        pendingPermissions: (deps.syncData.permission[sid] ?? []).length,
        pendingQuestions: (deps.syncData.question[sid] ?? []).length,
        mode,
      }
    },
    dump() {
      const sid = deps.currentSessionID()
      if (!sid) return { sessionID: undefined }
      const messages = (deps.syncData.message[sid] ?? []) as Message[]
      const parts: Record<string, Part[]> = {}
      for (const m of messages) parts[m.id] = (deps.syncData.part[m.id] ?? []) as Part[]
      const out = { sessionID: sid, status: deps.syncData.session_status[sid]?.type ?? "idle", messages, parts }
      console.log(`${LOG} dump`, out)
      return out
    },
    events(n = 50) {
      const out = eventRing.slice(-n)
      console.log(`${LOG} events (最近 ${out.length}/${eventRing.length} 条)`, out)
      return out
    },
    sends(n = 10) {
      const out = sendRing.slice(-n)
      console.log(`${LOG} sends (最近 ${out.length}/${sendRing.length} 次)`, out)
      return out
    },
    lastSend() {
      const out = sendRing[sendRing.length - 1]
      console.log(`${LOG} lastSend`, out)
      return out
    },
    pending() {
      const sid = deps.currentSessionID()
      if (!sid) return { permissions: [], questions: [] }
      const out = {
        permissions: deps.syncData.permission[sid] ?? [],
        questions: deps.syncData.question[sid] ?? [],
      }
      console.log(`${LOG} pending`, out)
      return out
    },
    // 一键打包「现场」为 JSON 并复制到剪贴板:state + 未决 + 最近发送 + SSE 事件环形缓冲 + 当前
    // session message/part 全量。出 bug 后敲 octoDebug.snapshot() → 直接粘给排查方,无需手选 console。
    snapshot() {
      const sid = deps.currentSessionID()
      const messages = sid ? ((deps.syncData.message[sid] ?? []) as Message[]) : []
      const parts: Record<string, Part[]> = {}
      for (const m of messages) parts[m.id] = (deps.syncData.part[m.id] ?? []) as Part[]
      const snap = {
        ts: new Date().toISOString(),
        sessionID: sid,
        mode,
        status: sid ? deps.syncData.session_status[sid]?.type ?? "idle" : undefined,
        pending: {
          permissions: sid ? deps.syncData.permission[sid] ?? [] : [],
          questions: sid ? deps.syncData.question[sid] ?? [] : [],
        },
        lastSend: sendRing[sendRing.length - 1],
        sends: sendRing.slice(),
        events: eventRing.slice(),       // 全量环形缓冲
        session: { messages, parts },    // 当前 session 原始 message+part
      }
      const json = JSON.stringify(snap, null, 2)
      const copied = navigator.clipboard?.writeText?.(json)
      if (copied) void copied.then(
        () => console.log(`${LOG} snapshot 已复制到剪贴板(${json.length} 字符),直接粘给排查方即可`),
        () => console.log(`${LOG} snapshot 已生成(${json.length} 字符),剪贴板不可用 → 从返回值复制`),
      )
      else console.log(`${LOG} snapshot 已生成(${json.length} 字符) → 从返回值复制`)
      return json
    },
    mode(m?: DebugMode) {
      if (m === undefined) return mode
      if (m !== "quiet" && m !== "compact" && m !== "verbose") {
        console.warn(`${LOG} mode 仅支持 'quiet' | 'compact' | 'verbose'`)
        return mode
      }
      mode = m
      console.log(`${LOG} mode → ${mode}`)
      return mode
    },
    verbose(on = true) {
      mode = on ? "verbose" : "compact"
      console.log(`${LOG} mode → ${mode}`)
      return mode
    },
  }

  // 挂全局,供 DevTools console 直接敲。多实例(keyed 重挂)时后挂的覆盖,dispose 时清。
  ;(window as unknown as { octoDebug?: typeof dbg }).octoDebug = dbg

  return {
    recordSend(rec: SendRecord) {
      sendRing.push(rec)
      if (sendRing.length > SEND_RING_CAP) sendRing.shift()
    },
    dispose() {
      unsub()
      if (deltaTimer) clearTimeout(deltaTimer)
      const w = window as unknown as { octoDebug?: typeof dbg }
      if (w.octoDebug === dbg) delete w.octoDebug
    },
  }
}
