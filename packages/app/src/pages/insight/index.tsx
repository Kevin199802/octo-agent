import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { TextPartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { Icon } from "@opencode-ai/ui/icon"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { resolveThemeVariant, themeToCss } from "@opencode-ai/ui/theme"
import { ModelsProvider } from "@/context/models"
import { LocalProvider, useLocal } from "@/context/local"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { ConversationHeader } from "./components/conversation-header"
import { InsightSidebar } from "./sidebar"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { PresetPrompts } from "./components/preset-prompts"
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"
import { PRESET_PROMPTS, type PresetPrompt } from "./store/preset-prompts"
import { IllustrationInsightEmpty, IconSendBlue, IconStopBlue } from "./icons/illustrations"
import { uploadFile, validateFile, formatUploadsForPrompt, UploadError, ALLOWED_EXT, MAX_UPLOAD_SIZE } from "./lib/upload"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { aggregateTaskCards, readTaskInfo, toolDisplayName, type TaskCardEntry } from "./utils/task-detect"
import { linkToOutputType } from "./utils/resource-link"
import { clearRefreshState, markRefreshed, isInCooldown } from "./utils/task-refresh"
import { showToast, Toast } from "@opencode-ai/ui/toast"

/**
 * InsightPage —— 用研 agent 页面
 *
 * 数据层完全复用 opencode 原生 globalSync / sync.session.sync / event-reducer，
 * 不再自建本地 dataStore + SSE listener。详见 SPEC-INS-005
 * (docs/specs/ui/insight-data-layer-reuse.md)。
 *
 * 外层 InsightPage：负责拼装 SDKProvider + SyncProvider（依赖 homeDir 就绪）。
 * 内层 InsightContent：所有业务逻辑，可读写 useSync() / useSDK()。
 */
export default function InsightPage() {
  const globalSync = useGlobalSync()
  const homeDir = () => globalSync.data.path.home

  // homeDir 异步就绪。等就绪再挂 SDK/Sync providers，否则 useSDK 拿到空字符串 directory 会异常。
  // keyed: dir 变化时整体重挂，确保 SyncProvider 内部状态干净。
  return (
    <Show when={homeDir()} keyed>
      {(dir) => (
        <SDKProvider directory={() => dir}>
          <SyncProvider>
            <ModelsProvider>
              {/* 模型选择统一走 useLocal().model(SPEC-INS-010 D2):自带
                  会话级→agent 默认→全局兜底 回退链,初次进入不再"显示未选却可发送"。
                  原 InsightModelSelectionProvider/隔离 store 已删除。 */}
              <LocalProvider>
                <InsightContent />
              </LocalProvider>
            </ModelsProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

// 单轮对话最多上传文件数(超出提示分多轮处理)
const MAX_ATTACHMENTS = 10

// 文件选择器 accept:从 ALLOWED_EXT 派生(与 validateFile 同一事实源)。
// 仅是原生弹窗的预过滤提示,不做强制——拖拽绕过它,校验仍以 validateFile 为准。
const UPLOAD_ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(",")

// 添加附件按钮的 tooltip 提示:支持的文件类型 + 大小 + 数量上限(均从常量派生)。
const UPLOAD_HINT = `支持 ${ALLOWED_EXT.join("、")}，单个 ≤ ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)}MB，最多 ${MAX_ATTACHMENTS} 个`

// 刷新保路由:打包态 Electron 走 file://(dev 的 electron reload 同样不走 SPA 兜底),整页
// 重载会丢失 /insight/:id 路由、回退到首页。这里把"当前所在对话"持久化,boot 落在无 id 的
// 首页态时恢复到上次位置——实现浏览器式"原地刷新"。值为 session id;空串 = 上次在新建空态。
const LAST_SESSION_KEY = "octo:insight:last-session"
// 每次整页加载只恢复一次(模块级,页面 reload 时自然重置);避免 keyed 重挂导致重复跳转。
let didBootRestore = false

function InsightContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const sync = useSync()
  const local = useLocal()
  const themeCtx = useTheme()

  // Insight 暂不适配暗色模式：mount 时注入全局亮色 token 覆盖（selector 为 html 自身），
  // 使 portal（模型选择弹窗等）也能被覆盖到；insight 是全屏页，不影响其他页面。
  // html[data-color-scheme="dark"] 比 :root 优先级高（attribute selector），可覆盖 ThemeProvider。
  // 覆盖 token 来自 oc-2 light variant，与 ThemeProvider 写入 :root 的来源一致。
  onMount(() => {
    const oc2 = themeCtx.themes()["oc-2"]
    if (!oc2) return
    const css = themeToCss(resolveThemeVariant(oc2.light, false))
    const style = document.createElement("style")
    style.id = "oc-insight-force-light"
    style.textContent = [
      `html[data-color-scheme="dark"] {`,
      `  color-scheme: light;`,
      `  --text-mix-blend-mode: multiply;`,
      `  ${css}`,
      `}`,
    ].join("\n")
    document.head.appendChild(style)
    onCleanup(() => { document.getElementById("oc-insight-force-light")?.remove() })
  })

  const homeDir = () => globalSync.data.path.home

  // ── 刷新保路由 ─────────────────────────────────────────────
  // bootSavedId:在下方 save effect 覆盖前,同步捕获"刷新前"存的对话 id。
  const bootSavedId = localStorage.getItem(LAST_SESSION_KEY)
  onMount(() => {
    if (didBootRestore) return
    didBootRestore = true
    // 仅当本次整页加载落在"无 id 首页态"且上次确实在某对话时才尝试恢复。
    // 若上次就在新建空态(bootSavedId 为空串)→ 不跳,保持空态(浏览器式原地刷新)。
    if (params.id || !bootSavedId) return
    const dir = homeDir() // InsightContent 仅在 homeDir 就绪后挂载,理论恒有值
    if (!dir) return
    // 先校验上次会话仍存在再跳(replace 不污染历史):避免跳到已删会话卡在加载态。
    void globalSDK.client.session
      .get({ directory: dir, sessionID: bootSavedId })
      .then((r) => {
        if ((r as { data?: unknown })?.data) navigate(`/insight/${bootSavedId}`, { replace: true })
        else localStorage.removeItem(LAST_SESSION_KEY) // 已删 → 留首页 + 清记录
      })
      .catch(() => { /* 网络/未知错误:不跳,保持首页,记录留待下次 */ })
  })
  // 记录当前所在对话(空 = 新建空态),供下次整页加载恢复。
  createEffect(() => { localStorage.setItem(LAST_SESSION_KEY, params.id ?? "") })

  // 切 session 时触发原生 sync 加载（带 inflight 去重 + cache + optimistic 合并）
  // event-reducer 已在 GlobalSyncProvider 内部全局唯一注册，无需我们再监听 SSE
  //
  // 依赖同时取 params.id 和「message[id] 是否缺失」：
  // - 切到新 id → message[id] 为 undefined → 触发 sync
  // - 放置一段时间后 sync 缓存被清（连接重置/驱逐），message[id] 变回 undefined 但 id 未变
  //   → 这里仍会重新触发 sync，避免中间聊天区永久空白（白屏 bug）。
  //   sync.session.sync 自带 inflight 去重，重复调用安全；加载完 message[id] 有值后不再触发。
  createEffect(
    on(
      () => [params.id, sync.data.message[params.id ?? ""] === undefined] as const,
      ([id, missing]) => {
        if (!id || !missing) return
        console.log("[octo:sync] session.sync", { sessionID: id })
        void sync.session.sync(id)
      },
    ),
  )

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    return ((sync.data.message[id] ?? []) as Message[]).filter((m) => m.role === "user")
  })

  // 会话消息是否已加载:切到"未加载过的已存在会话"时 message[id] 为 undefined,
  // 期间不渲染首页空态(否则会闪一下 Octo Insight 首页),等加载完再按是否为空决定。
  // 无 id(全新/首页)视作已加载,正常显示首页空态。
  const sessionMessagesLoaded = createMemo(() => {
    const id = params.id
    return !id || sync.data.message[id] !== undefined
  })

  // ── 长任务卡片聚合(spec: docs/specs/ui/task-card.md §3.3)──
  // 扫所有 assistant message 的 part,按 task_id 分组取最新状态;锚点 = 最早 part 所在 user message
  const taskCards = createMemo((): Map<string, TaskCardEntry> => {
    const id = params.id
    if (!id) return new Map()
    const messages = (sync.data.message[id] ?? []) as Message[]
    const items: Parameters<typeof aggregateTaskCards>[0] = []
    let lastUserMsgID = ""
    for (const msg of messages) {
      if (msg.role === "user") {
        lastUserMsgID = msg.id
        continue
      }
      if (msg.role !== "assistant" || !lastUserMsgID) continue
      const parts = sync.data.part[msg.id] ?? []
      const msgTime = (msg as { time?: { created?: number } }).time?.created ?? Date.now()
      for (const part of parts) {
        const info = readTaskInfo(part)
        if (!info) continue
        items.push({
          taskId: info.taskId,
          status: info.status,
          message: info.message,
          toolName: info.toolName,
          resultText: info.resultText,
          resourceLinks: info.resourceLinks,
          userMsgID: lastUserMsgID,
          time: msgTime,
        })
      }
    }
    return aggregateTaskCards(items)
  })

  // 按 anchor userMessageID 分组,InsightTurn 接收"挂在自己 turn 下"的卡片
  const taskCardsByAnchor = createMemo((): Map<string, TaskCardEntry[]> => {
    const out = new Map<string, TaskCardEntry[]>()
    for (const card of taskCards().values()) {
      const arr = out.get(card.anchorUserMessageID) ?? []
      arr.push(card)
      out.set(card.anchorUserMessageID, arr)
    }
    return out
  })

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return sync.data.session_status[id] ?? { type: "idle" }
  })

  // 状态变化日志：busy ↔ idle 切换观测点
  createEffect(
    on(
      sessionStatus,
      (status) => {
        console.log("[octo:sync] status", { sessionID: params.id, type: status.type })
      },
      { defer: true },
    ),
  )

  const isBusy = createMemo(() => sessionStatus().type === "busy")

  // busy → idle 时:把刚结束的最新 assistant 消息原始内容完整 dump 到 console。
  // 内网无法抓 SSE network 时,把这条 console 粘到外网即可定位"LLM 究竟返回了什么"。
  createEffect(on(isBusy, (busy, prev) => {
    if (busy || !prev) return  // 只在 idle 切换那一刻打,不在初始 idle 打
    const sid = params.id
    if (!sid) return
    const messages = (sync.data.message[sid] ?? []) as Message[]
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
    if (!lastAssistant) return
    const parts = (sync.data.part[lastAssistant.id] ?? []) as Part[]

    const textParts = parts.filter((p) => p.type === "text") as Array<Part & { text?: string }>
    const toolParts = parts.filter((p) => p.type === "tool") as Array<
      Part & { tool?: string; state?: { status?: string; output?: string; metadata?: unknown } }
    >

    console.log("[octo:assistant] turn-complete", {
      sessionID: sid,
      msgID: lastAssistant.id,
      partsCount: parts.length,
      textPartsCount: textParts.length,
      toolPartsCount: toolParts.length,
      toolNames: toolParts.map((p) => p.tool),
    })

    // 每个 text part 单独打,完整内容(不截断)
    for (let i = 0; i < textParts.length; i++) {
      const p = textParts[i]
      console.log("[octo:assistant] text-part-detail", {
        msgID: lastAssistant.id,
        partIdx: i,
        partID: p.id,
        textLen: typeof p.text === "string" ? p.text.length : 0,
        text: p.text,
      })
    }

    // 每个 tool part 单独打,含完整 state(output JSON + metadata + status)
    for (let i = 0; i < toolParts.length; i++) {
      const p = toolParts[i]
      const state = p.state ?? {}
      let parsedOutput: unknown
      try {
        parsedOutput = typeof state.output === "string" ? JSON.parse(state.output) : state.output
      } catch {
        parsedOutput = state.output  // 非 JSON,保持原样
      }
      console.log("[octo:assistant] tool-part-detail", {
        msgID: lastAssistant.id,
        partIdx: i,
        partID: p.id,
        toolName: p.tool,
        status: state.status,
        metadata: state.metadata,
        outputRaw: state.output,
        outputParsed: parsedOutput,
      })
    }
  }, { defer: true }))

  const [prompt, setPrompt] = createSignal("")
  // queue:busy 期间用户继续发送,先入队,idle 后自动 flush(SPEC-INS-007 §3.3.3)
  // 单容量:第二次入队会覆盖上一次;切 session 时清空
  const [queuedText, setQueuedText] = createSignal<string | null>(null)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  // 首次带附件发送会 createAndNavigate 改 params.id,触发下方 session 切换 effect 清空附件草稿。
  // 但首次发送的这批附件要留给 doSendPrompt consume,不能被 effect 抢清 → 用此 flag 标记
  // "发送导致的导航",effect 消费一次后跳过清空(其余新建/切换 session 正常清)。
  let sendingNavigation = false
  let textareaRef!: HTMLTextAreaElement

  // 聊天区宽度：从 localStorage 恢复，无存储值时取约 50% 可用宽（扣除侧边栏约 240px）
  const CHAT_WIDTH_KEY = "octo:insight:chat-width"
  function getInitialChatWidth(): number {
    const stored = localStorage.getItem(CHAT_WIDTH_KEY)
    if (stored) {
      const n = parseInt(stored, 10)
      if (!isNaN(n) && n >= 345 && n <= 720) return n
    }
    return 460 // 参考 UX AI make 的对话面板默认宽
  }
  const [chatWidth, setChatWidth] = createSignal(getInitialChatWidth())

  function handleDividerPointerDown(e: PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    const target = e.currentTarget as HTMLElement
    // pointer capture:确保 pointermove / pointerup 即使光标移出 webview 也照常派发到本元素,
    // 避免 mouseup 丢失导致 body 样式(userSelect/cursor/overflow) stuck → 输入框看似不可 focus
    target.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    const restore = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth()))
    }
    const onMove = (ev: PointerEvent) => {
      setChatWidth(Math.max(345, Math.min(720, startWidth + ev.clientX - startX))) // 钳制参考 UX AI make
    }
    const cleanup = () => {
      restore()
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", cleanup)
      target.removeEventListener("pointercancel", cleanup)
      try { target.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", cleanup)
    target.addEventListener("pointercancel", cleanup)
  }

  const tabStore = createTabStore()

  // ── 任务面板按需弹出 + 过渡动画 (SPEC-INS-009) ────────────────
  // panelCollapsed:用户手动收起(保留 tab,仅隐藏容器);与"无产物"区分两种收起来源。
  // panelVisible = 有已打开产物 且 未手动收起。无产物时聊天居中铺满,有产物才 split。
  const [panelCollapsed, setPanelCollapsed] = createSignal(false)
  const panelVisible = createMemo(() => tabStore.tabs().length > 0 && !panelCollapsed())

  // 动画三态:
  //   panelMounted   —— 面板是否在 DOM(可见时挂载,收起动画播完才卸载,保证滑出可见)
  //   panelExpanded  —— 驱动聊天列宽度的目标态(滑入时延一帧置真,从 100% 过渡到 chatWidth)
  //   panelAnimating —— 仅切换期间为真;开启 width transition。拖拽分隔线不触发本 effect,
  //                     故 transition 关闭,分隔线跟手不滞后。
  const PANEL_ANIM_MS = 280
  const [panelMounted, setPanelMounted] = createSignal(false)
  const [panelExpanded, setPanelExpanded] = createSignal(false)
  const [panelAnimating, setPanelAnimating] = createSignal(false)
  let panelExitTimer: ReturnType<typeof setTimeout> | undefined
  let panelAnimEndTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(on(panelVisible, (show) => {
    if (panelExitTimer) { clearTimeout(panelExitTimer); panelExitTimer = undefined }
    setPanelAnimating(true)
    if (show) {
      setPanelMounted(true)
      // 双 rAF:确保面板先以 width:0(聊天 100%)落地一帧,再过渡到展开宽,首次也有滑入
      requestAnimationFrame(() => requestAnimationFrame(() => setPanelExpanded(true)))
    } else {
      setPanelExpanded(false)
      panelExitTimer = setTimeout(() => setPanelMounted(false), PANEL_ANIM_MS)
    }
    // 动画窗口结束后关掉 animating,使后续拖拽无 transition
    if (panelAnimEndTimer) clearTimeout(panelAnimEndTimer)
    panelAnimEndTimer = setTimeout(() => setPanelAnimating(false), PANEL_ANIM_MS + 30)
  }, { defer: true }))

  /** 打开/激活产物时统一清掉手动收起态,确保面板滑入(即便之前被收起) */
  function revealPanel() {
    if (panelCollapsed()) setPanelCollapsed(false)
  }

  /** 关 tab:若关掉的是最后一个,复位 collapsed 以便下次产物干净滑入 */
  function handleCloseTab(id: string) {
    tabStore.closeTab(id)
    if (tabStore.tabs().length === 0) setPanelCollapsed(false)
  }

  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })

  // 切换 session 时重置 ResultViewer tabs / 任务卡片防抖 / 自动 openTab 记录 / queue / 未发送附件
  // queue 必须清:在 session A 排队的 text 不能错发到 session B(SPEC-INS-007 §3.3.5)
  // 附件草稿必须清:在 session A 上传未发送的文件,新建/切换 session 后不应残留(设计确认)。
  //   例外:首次发送触发的导航(sendingNavigation)——那批附件留给 doSendPrompt consume,跳过一次。
  createEffect(on(() => params.id, () => {
    tabStore.reset()
    setPanelCollapsed(false)
    setQueuedText(null)
    clearRefreshState()
    autoOpenedTaskIds.clear()
    lastTaskSnapshot = new Map()
    if (sendingNavigation) {
      sendingNavigation = false
    } else {
      filesById.clear()
      setAttachments([])
    }
    console.log("[octo:task] session switched, refresh state cleared", { sessionID: params.id })
  }, { defer: true }))

  // ── session 操作 ──────────────────────────────────────────

  async function createAndNavigate(): Promise<string | undefined> {
    const dir = homeDir()
    if (!dir) return
    try {
      const result = await globalSDK.client.session.create({ directory: dir })
      const session = result.data as Session | undefined
      if (session) {
        navigate(`/insight/${session.id}`)
        return session.id
      }
    } catch (err) {
      console.error("[InsightPage] session.create failed", err)
      showToast({
        title: "新建会话失败",
        description: errorDescription(err),
      })
    }
    return undefined
  }

  /**
   * 错误信息提取(参考 packages/app/src/components/prompt-input/submit.ts errorMessage)
   * SDK 错误通常带 data.message,其次取 err.message,最后回落到通用提示
   */
  function errorDescription(err: unknown): string {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return "请稍后重试"
  }

  // 发送后"无反馈"探测:promptAsync 成功返回后启动,NO_FEEDBACK_WATCHDOG_MS 内若 session
  // 既未进入 busy、也无新 assistant 响应,打一条显眼 warning —— 专门定位"发消息后既无思考中、
  // 也无回复"的现象。状态没翻 busy 多半是 SSE/event 没到或 server 未启动该轮,据此分流排查。
  const NO_FEEDBACK_WATCHDOG_MS = 8000
  function armNoFeedbackWatchdog(sessionId: string, messageID: string) {
    const assistantBefore = ((sync.data.message[sessionId] ?? []) as Message[]).filter((m) => m.role === "assistant").length
    window.setTimeout(() => {
      const status = sync.data.session_status[sessionId]?.type ?? "idle"
      const msgs = (sync.data.message[sessionId] ?? []) as Message[]
      const assistantNow = msgs.filter((m) => m.role === "assistant").length
      if (status !== "busy" && assistantNow <= assistantBefore) {
        console.warn(
          `[octo:prompt] no-feedback ⚠️ 发送后 ${NO_FEEDBACK_WATCHDOG_MS}ms 内 session 未进入 busy 且无新 assistant 响应`,
          {
            sessionID: sessionId,
            messageID,
            status,
            messageCount: msgs.length,
            assistantBefore,
            assistantNow,
            hint: "status 没翻 busy → 查 globalSync 事件流(SSE)是否在收 / server 是否启动了该轮;若 model 为 undefined 且 agent 无默认模型也可能不启动",
          },
        )
      } else {
        console.log("[octo:prompt] feedback-ok", { sessionID: sessionId, messageID, status, assistantBefore, assistantNow })
      }
    }, NO_FEEDBACK_WATCHDOG_MS)
  }

  /**
   * 共享的 prompt 调用底层(SPEC-INS-007 §3.2 改用 promptAsync + optimistic)
   *   - consumeAttachments=true(用户手动发送):附件随消息发送,发送后清空附件状态
   *   - consumeAttachments=false(刷新/终止/follow-up 按钮 inject):不消费附件,保留用户正在选的附件状态
   * spec: docs/specs/ui/task-card.md §6.1 + docs/specs/ui/insight-prompt-redesign.md §3.2
   */
  async function doSendPrompt(sessionId: string, text: string, opts: { consumeAttachments: boolean; source: string }) {
    const doneAttachments = opts.consumeAttachments
      ? attachments().filter((a) => a.status === "done" && a.url)
      : []
    // 上传 URL 块走独立 synthetic text part:LLM 收得到(server 只过滤 ignored),
    // 但气泡不渲染(上游 UserMessageDisplay 过滤 synthetic)。文件卡片由 InsightTurn 解析渲染。
    const uploadBlock = formatUploadsForPrompt(
      doneAttachments.map((a) => ({ filename: a.filename, url: a.url! })),
    )
    const cleanTextPart: TextPartInput = { type: "text", text }
    const parts: TextPartInput[] = [cleanTextPart]
    if (uploadBlock) parts.push({ type: "text", text: uploadBlock, synthetic: true })
    const messageID = Identifier.ascending("message")
    const agent = "octo_insight"

    // 当前选中模型(useLocal().model.current():会话级→agent 默认→全局兜底 回退链)
    const currentModel = local.model.current()
    const model = currentModel ? {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    } : undefined

    // optimistic user message —— 立即写入 sync.data,UI 瞬时反馈
    // directory 不传 → 默认走 SDKProvider 注入的 homeDir;model 不传 → 服务端按 agent 默认配置
    const optimisticMessage: Message = {
      id: messageID,
      sessionID: sessionId,
      role: "user",
      time: { created: Date.now() },
      model,
    } as Message
    // optimistic 镜像发送的 parts:干净文本 + (有附件时)synthetic 上传块。
    // synthetic part 同样写入 optimistic,使乐观渲染就与 server 回传一致(气泡只显示干净文本)。
    const optimisticParts: Part[] = [
      {
        id: Identifier.ascending("part"),
        sessionID: sessionId,
        messageID,
        type: "text",
        text,
      } as Part,
    ]
    if (uploadBlock) {
      optimisticParts.push({
        id: Identifier.ascending("part"),
        sessionID: sessionId,
        messageID,
        type: "text",
        text: uploadBlock,
        synthetic: true,
      } as Part)
    }

    console.log("[octo:prompt] send", {
      source: opts.source,
      sessionID: sessionId,
      messageID,
      agent,
      model,                          // undefined ⇒ 服务端按 agent 默认配置;无默认时可能不启动该轮
      modelResolved: !!model,
      statusAtSend: sync.data.session_status[sessionId]?.type ?? "idle",
      text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      textLen: text.length,
      attachmentsCount: doneAttachments.length,
      uploads: doneAttachments.map((a) => ({ name: a.filename, url: a.url })),
    })
    // 完整 text 单独 dump(不截断),便于内网把怪 case 粘到外网定位
    console.log("[octo:prompt] send-full", {
      source: opts.source,
      messageID,
      cleanText: text,         // 用户可见文本
      uploadBlock,             // synthetic 上传块(喂给 LLM,气泡不显示)
    })

    sync.session.optimistic.add({
      sessionID: sessionId,
      message: optimisticMessage,
      parts: optimisticParts,
    })
    console.log("[octo:prompt] optimistic added", { messageID, partsCount: optimisticParts.length })

    if (opts.consumeAttachments) {
      filesById.clear()
      setAttachments([])
    }

    try {
      const result = await globalSDK.client.session.promptAsync({
        sessionID: sessionId,
        agent,
        model,
        parts,
        messageID,
      })
      console.log("[octo:prompt] sent (async)", {
        messageID,
        sessionID: sessionId,
        statusAfterSend: sync.data.session_status[sessionId]?.type ?? "idle",
        response: (result as { data?: unknown })?.data ?? result,
      })
      // server 已受理,启动无反馈探测(8s 内未 busy 且无 assistant 响应 → warn)
      armNoFeedbackWatchdog(sessionId, messageID)
    } catch (err) {
      console.error("[octo:prompt] failed", { source: opts.source, messageID, err })
      sync.session.optimistic.remove({ sessionID: sessionId, messageID })
      showToast({
        title: "发送失败",
        description: errorDescription(err),
      })
    }
  }

  function sendMessage(sessionId: string, text: string) {
    return doSendPrompt(sessionId, text, { consumeAttachments: true, source: "user" })
  }

  /** 任务卡片"刷新 / 终止 / follow-up"按钮通过本函数 inject prompt;不消费附件状态 */
  function sendInjectedPrompt(sessionId: string, text: string, source: string) {
    return doSendPrompt(sessionId, text, { consumeAttachments: false, source })
  }

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || hasUploadingAttachments()) return
    setPrompt("")

    // busy 时入队(SPEC-INS-007 §3.3.3):单容量,第二次会覆盖上一次
    if (isBusy()) {
      setQueuedText(text)
      console.log("[octo:queue] enqueued", { sessionID: params.id, len: text.length })
      return
    }

    let sid = params.id
    if (!sid) {
      // 首次发送:navigate 会触发 session 切换 effect,标记一下让它别抢清这批待发送附件
      sendingNavigation = true
      sid = await createAndNavigate()
      if (!sid) { sendingNavigation = false; return }
    }
    autoScroll.forceScrollToBottom()
    await sendMessage(sid, text)
  }

  // busy → idle 自动 flush 队列(SPEC-INS-007 §3.3.3)
  createEffect(on(isBusy, (busy, prev) => {
    if (!prev || busy) return
    const text = queuedText()
    const sid = params.id
    if (!text || !sid) return
    setQueuedText(null)
    console.log("[octo:queue] flushing", { sessionID: sid, len: text.length })
    void sendMessage(sid, text)
  }, { defer: true }))

  function cancelQueued() {
    const text = queuedText()
    if (!text) return
    setQueuedText(null)
    setPrompt((cur) => cur ? cur : text)
    console.log("[octo:queue] canceled, restored to input")
  }

  async function handleAbort() {
    const sid = params.id
    if (!sid) return
    // 先取消排队消息，避免 abort 完成后 idle 触发器自动 flush
    if (queuedText()) cancelQueued()
    try {
      await globalSDK.client.session.abort({ sessionID: sid })
    } catch {
      // session_status 事件自动同步状态，忽略网络错误
    }
  }

  // 输入框空 + AI 忙 → 发送键变为停止键
  const stopping = createMemo(() => isBusy() && !prompt().trim() && !hasUploadingAttachments())

  function handlePresetClick(preset: PresetPrompt) {
    setPrompt(preset.text)
    console.log("[octo:preset] click", { id: preset.id, expectedTool: preset.expectedTool })
    requestAnimationFrame(() => {
      textareaRef?.focus()
      // 光标移到文末,便于用户继续编辑
      const len = preset.text.length
      try { textareaRef?.setSelectionRange(len, len) } catch { /* noop */ }
    })
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  // ── 附件管理 ─────────────────────────────────────────────

  let fileInputRef!: HTMLInputElement
  // id -> File，保留原 File 引用以支持重传（不进 Attachment 类型避免污染 chip 渲染）
  const filesById = new Map<string, File>()

  function addAttachments(files: File[]) {
    const slots = MAX_ATTACHMENTS - attachments().length
    // 超过 10 个:提示并截断到剩余槽位(单次超额取前 N 个);已满则只提示不新增
    if (files.length > slots) {
      showToast("请保持上传文件不超过10个或分多轮对话处理")
    }
    if (slots <= 0) return
    const toAdd = files.slice(0, slots)
    for (const file of toAdd) {
      const id = crypto.randomUUID()
      const mime = file.type || "application/octet-stream"
      const validationErr = validateFile(file)
      if (validationErr) {
        // 客户端校验失败:不存 File,标 retriable=false → chip 不显示重试,只能删除重选
        console.warn("[octo:upload] client-validate rejected", {
          id, filename: file.name, code: validationErr.code, message: validationErr.message,
        })
        setAttachments((prev) => [
          ...prev,
          { id, filename: file.name, mime, size: file.size, status: "error", error: validationErr.message, retriable: false },
        ])
        continue
      }
      filesById.set(id, file)
      setAttachments((prev) => [
        ...prev,
        { id, filename: file.name, mime, size: file.size, status: "uploading" },
      ])
      void doUpload(id, file)
    }
  }

  async function doUpload(id: string, file: File) {
    try {
      const result = await uploadFile(file)
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "done", url: result.url, error: undefined } : a)),
      )
    } catch (err) {
      const message =
        err instanceof UploadError ? err.message :
        err instanceof Error ? err.message :
        "上传失败"
      console.error("[InsightPage] upload failed", { id, filename: file.name, err })
      // 已发起过上传(File 在 filesById):标 retriable=true → chip 显示重试
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "error", error: message, retriable: true } : a)),
      )
    }
  }

  function removeAttachment(id: string) {
    filesById.delete(id)
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function retryUpload(id: string) {
    const file = filesById.get(id)
    if (!file) {
      // 客户端 validate 失败的 chip 没有原 File，无法重传；用户应删除重新选。
      // 正常情况下这类 chip 已隐藏重试按钮(retriable=false),走到这里属兜底,打日志便于排查。
      console.warn("[octo:upload] retry skipped: no original File (client-validation chip)", { id })
      return
    }
    console.log("[octo:upload] retry", { id, filename: file.name })
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "uploading", error: undefined, retriable: undefined } : a)),
    )
    void doUpload(id, file)
  }

  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files))
      input.value = ""
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) addAttachments(files)
  }

  function handleOpenResult(card: OutputCard) {
    tabStore.openTab(card)
    revealPanel()
  }

  // ── 长任务卡片操作(spec: docs/specs/ui/task-card.md §6) ──────

  function handleTaskRefresh(taskId: string) {
    const sid = params.id
    if (!sid) return
    if (isBusy()) {
      console.log("[octo:task] refresh blocked: busy", { taskId })
      return
    }
    if (isInCooldown(taskId)) {
      console.log("[octo:task] refresh blocked: cooldown", { taskId })
      return
    }
    markRefreshed(taskId)
    void sendInjectedPrompt(sid, `查询任务 ${taskId} 的进度`, "task-refresh")
  }

  function handleTaskStop(taskId: string) {
    const sid = params.id
    if (!sid) return
    if (isBusy()) {
      console.log("[octo:task] stop blocked: busy", { taskId })
      return
    }
    void sendInjectedPrompt(sid, `终止任务 ${taskId}`, "task-stop")
  }

  /**
   * 把 completed task 转成 1~N 个 OutputCard,每个 resource_link 一张;
   * 无 resource_link 但有 resultText 时,fallback 为单张 markdown inline 卡;
   * 无任何产物时返回空数组(尚未 completed 或异常)。
   */
  function buildOutputCardsFromTask(card: TaskCardEntry): OutputCard[] {
    if (card.status !== "completed") return []
    const baseTitle = `${toolDisplayName(card.toolName)} 结果`
    if (card.resourceLinks.length > 0) {
      return card.resourceLinks.map((link, idx) => ({
        id: `task-${card.taskId}-${idx}`,
        title: link.name || `${baseTitle} ${idx + 1}`,
        type: linkToOutputType(link),
        source: "uri" as const,
        uri: link.uri,
        mimeType: link.mimeType,
        fileName: link.name,
        description: link.description,
        createdAt: card.lastUpdatedAt,
      }))
    }
    if (card.resultText && card.resultText.length > 0) {
      return [{
        id: `task-${card.taskId}`,
        title: baseTitle,
        type: "markdown",
        source: "inline",
        content: card.resultText,
        createdAt: card.lastUpdatedAt,
      }]
    }
    return []
  }

  function handleTaskOpenResult(taskId: string) {
    const card = taskCards().get(taskId)
    if (!card) {
      console.warn("[octo:task] openResult: card not found", { taskId })
      return
    }
    const ocs = buildOutputCardsFromTask(card)
    if (ocs.length === 0) {
      console.warn("[octo:task] openResult: no result yet", { taskId, status: card.status })
      return
    }
    console.log("[octo:task] openResult", {
      taskId,
      count: ocs.length,
      tabs: ocs.map((oc) => ({ type: oc.type, source: oc.source, file: oc.fileName })),
    })
    // 多文件:全部 openTab,激活 = 最后一个 openTab 内部已处理(activate first won't override later)
    // 用户视觉上看到最后激活的是数组里最后一个 = 第一张?— 让我们激活第一张
    for (const oc of ocs) tabStore.openTab(oc)
    tabStore.activate(ocs[0].id)
    revealPanel()
  }

  // ── 自动 openTab(ResultViewer 当前为空时,首个 completed 任务自动开;spec §8.3)──
  const autoOpenedTaskIds = new Set<string>()
  createEffect(() => {
    if (tabStore.tabs().length > 0) return
    for (const card of taskCards().values()) {
      if (card.status !== "completed") continue
      if (autoOpenedTaskIds.has(card.taskId)) continue
      const ocs = buildOutputCardsFromTask(card)
      if (ocs.length === 0) continue
      autoOpenedTaskIds.add(card.taskId)
      console.log("[octo:task] auto-openResult (viewer empty)", {
        taskId: card.taskId,
        count: ocs.length,
        tabs: ocs.map((oc) => ({ type: oc.type, file: oc.fileName })),
      })
      for (const oc of ocs) tabStore.openTab(oc)
      tabStore.activate(ocs[0].id)
      revealPanel()
      break  // 一次只自动开一个 task 的全部产物
    }
  })

  // ── 全链路 console diff:taskCards 变化时打快照 ──────────────
  let lastTaskSnapshot = new Map<string, string>()
  createEffect(() => {
    const current = taskCards()
    const currentSnap = new Map<string, string>()
    for (const [id, card] of current) {
      currentSnap.set(id, `${card.status}|${card.message ?? ""}`)
    }
    // diff:状态变化的卡片
    const changes: Array<{ taskId: string; from: string | null; to: string }> = []
    for (const [id, sig] of currentSnap) {
      const prev = lastTaskSnapshot.get(id) ?? null
      if (prev !== sig) changes.push({ taskId: id, from: prev, to: sig })
    }
    for (const id of lastTaskSnapshot.keys()) {
      if (!currentSnap.has(id)) changes.push({ taskId: id, from: lastTaskSnapshot.get(id)!, to: "gone" })
    }
    if (changes.length > 0) {
      console.log("[octo:task] aggregate diff", {
        sessionID: params.id,
        total: current.size,
        changes,
        snapshot: Array.from(current.values()).map((c) => ({
          taskId: c.taskId,
          tool: c.toolName,
          status: c.status,
          message: c.message,
          anchor: c.anchorUserMessageID,
          resourceLinkCount: c.resourceLinks.length,
          hasResultText: !!c.resultText,
        })),
      })
    }
    lastTaskSnapshot = currentSnap
  })

  const maxAttachments = () => attachments().length >= MAX_ATTACHMENTS
  function hasUploadingAttachments() {
    return attachments().some((a) => a.status === "uploading")
  }

  return (
    <DataProvider
      data={sync.data}
      directory={homeDir() || ""}
      onNavigateToSession={(sessionID: string) => navigate(`/insight/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/insight/${sessionID}`}
    >
      <Toast.Region />
      <div class="size-full flex overflow-hidden relative">
        {/* 左侧会话栏(SPEC-INS-010 §11:侧栏归 insight,单独第一列,不混入对话↔面板的 flex) */}
        <InsightSidebar />

        {/* 对话↔任务面板区(data-page 作用域;拖拽分隔线相对它左边缘绝对定位,故侧栏必须在它之外) */}
        <div class="flex-1 min-w-0 flex overflow-hidden relative" data-page="insight">

        {/* ── 左栏：对话面板 ────
             展开态:固定 chatWidth,可拖拽分隔。收起态:撑满 100%,内容居中 reading-width。
             宽度在 chatWidth ↔ 100% 间过渡;任务面板 flex:1 跟随重排自然伸缩(SPEC-INS-009 §3)。
             panelAnimating 仅切换期间为真 → 拖拽分隔线时无 transition,跟手不滞后。 */}
        <div
          class="flex flex-col overflow-hidden relative"
          style={{
            width: panelExpanded() ? `${chatWidth()}px` : "100%",
            flex: "0 0 auto",
            "min-width": "0",
            transition: panelAnimating() ? `width ${PANEL_ANIM_MS}ms ease` : "none",
            background: isDragOver() ? "var(--octo-brand-a3)" : "var(--octo-surface-page)",
            outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            <Show
              when={params.id && userMessages().length > 0}
              fallback={
                <Show
                  when={sessionMessagesLoaded()}
                  fallback={
                    /* 已有 id 但消息缓存未就绪：显示加载占位,绝不渲染空白。
                       否则切回已存在会话、缓存被清时中间区会整块空白(白屏 bug)。 */
                    <div class="size-full flex items-center justify-center">
                      <div class="octo-spinner" />
                    </div>
                  }
                >
                <div class="size-full flex flex-col items-center justify-center px-8 py-10 overflow-y-auto">
                  <IllustrationInsightEmpty width={166} height={166} />
                  <div
                    style={{
                      "margin-top": "12px",
                      "font-size": "36px",
                      "font-weight": "600",
                      "line-height": "1.2",
                      color: "var(--octo-text-strong)",
                    }}
                  >
                    Octo Insight
                  </div>
                  <div
                    style={{
                      "margin-top": "8px",
                      "font-size": "16px",
                      color: "var(--octo-text-secondary)",
                    }}
                  >
                    AI辅助用户洞察研究
                  </div>

                  <div style={{ "margin-top": "80px", width: "100%", "max-width": "800px" }}>
                    <PresetPrompts
                      prompts={PRESET_PROMPTS}
                      onClick={handlePresetClick}
                    />

                    <div
                      class="rounded-[24px] transition-all duration-300 relative group flex flex-col overflow-hidden"
                      style={{
                        border: "1px solid transparent",
                        background: `
                          linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
                          linear-gradient(135deg,
                            rgba(246, 97, 23, 1) 1%,
                            rgba(95, 45, 255, 1) 8%,
                            rgba(61, 93, 255, 1) 22%,
                            rgba(104, 138, 255, 1) 43%,
                            rgba(28, 171, 111, 1) 54%,
                            rgba(61, 93, 255, 1) 87%,
                            rgba(206, 7, 232, 1) 92%) border-box`,
                        "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
                        height: "150px",
                      }}
                    >
                      {/* 附件条在胶囊内部顶部:单行横向滚动,不撑开胶囊 */}
                      <AttachmentBar
                        attachments={attachments()}
                        onRemove={removeAttachment}
                        onRetry={retryUpload}
                      />
                      <textarea
                        ref={textareaRef!}
                        value={prompt()}
                        onInput={(e) => setPrompt(e.currentTarget.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="请描述您的需求..."
                        class="w-full flex-1 resize-none px-4 pt-3 bg-transparent text-sm outline-none relative z-10"
                        style={{
                          color: "var(--octo-text-primary)",
                          "font-family": "var(--octo-font)",
                          "overflow-y": "auto",
                        }}
                      />

                      <div class="flex items-center gap-2 px-2.5 pb-2.5 relative z-10">
                        <input
                          ref={fileInputRef!}
                          type="file"
                          multiple
                          class="hidden"
                          accept={UPLOAD_ACCEPT}
                          onChange={handleFileInputChange}
                        />
                        <Tooltip
                          placement="top"
                          class="flex-shrink-0"
                          value={maxAttachments() ? `最多 ${MAX_ATTACHMENTS} 个文件` : UPLOAD_HINT}
                          contentStyle={{ "white-space": "nowrap", "max-width": "none" }}
                        >
                          <button
                            type="button"
                            onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                            disabled={maxAttachments()}
                            class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
                            aria-label="添加附件"
                          >
                            <Icon name="plus" class="size-5" />
                          </button>
                        </Tooltip>

                        <ModelSelectorPopover
                          model={local.model}
                          triggerAs="button"
                          triggerProps={{
                            class: "flex items-center gap-1.5 min-w-0 max-w-[200px] bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group",
                            "data-action": "prompt-model",
                          }}
                          onClose={() => { requestAnimationFrame(() => textareaRef?.focus()) }}
                        >
                          {/* 不渲染 ProviderIcon:内网自部署的 provider id 不在 ui sprite 内会落到
                              synthetic 占位图标,跟 UXAI chat 一致(屏蔽 icon 只显示模型名)。 */}
                          <span class="truncate">
                            {local.model.current()?.name ?? "选择模型"}
                          </span>
                          <Icon name="chevron-down" class="size-3.5 shrink-0 opacity-60" />
                        </ModelSelectorPopover>

                        <button
                          type="button"
                          onClick={() => stopping() ? void handleAbort() : void handleSubmit()}
                          disabled={!stopping() && (!prompt().trim() || hasUploadingAttachments())}
                          title={stopping() ? "停止生成" : (hasUploadingAttachments() ? "请等待附件上传完成" : (isBusy() ? "LLM 响应中,发送会进入排队" : undefined))}
                          class="flex flex-shrink-0 items-center justify-center ml-auto bg-transparent border-0 p-0 transition-opacity duration-200 disabled:cursor-not-allowed"
                          style={{
                            opacity: (!stopping() && (!prompt().trim() || hasUploadingAttachments())) ? 0.4 : 1,
                            filter: (!stopping() && (!prompt().trim() || hasUploadingAttachments())) ? "grayscale(0.5)" : "none",
                          }}
                        >
                          <Show when={stopping()} fallback={<IconSendBlue width={40} height={40} />}>
                            <IconStopBlue width={40} height={40} />
                          </Show>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                </Show>
              }
            >
              {/* 对话面板顶部标题栏（会话标题 + 改名 + 删除） */}
              {/* 收起态唤回浮标：放进 header 行内，与三点菜单同行，避免绝对定位遮挡三点按钮 */}
              <ConversationHeader
                panelBadge={
                  tabStore.tabs().length > 0 && panelCollapsed() && !panelAnimating()
                    ? (
                      <button
                        type="button"
                        onClick={() => setPanelCollapsed(false)}
                        title="展开产出面板"
                        class="flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium transition-colors"
                        style={{
                          background: "var(--octo-surface-page)",
                          color: "var(--octo-text-secondary)",
                          border: "1px solid var(--octo-border-divider)",
                          "box-shadow": "0 1px 3px rgba(0,0,0,0.06)",
                        }}
                      >
                        <Icon name="chevron-left" class="size-3 opacity-70" />
                        产出 ({tabStore.tabs().length})
                      </button>
                    )
                    : undefined
                }
              />

              {/* 消息列表（autoScroll 挂在 scrollRef 容器，contentRef 挂在内容 div） */}
              <div
                class="flex-1 overflow-y-auto min-h-0"
                ref={autoScroll.scrollRef}
                onScroll={autoScroll.handleScroll}
                onMouseUp={autoScroll.handleInteraction}
              >
                <div
                  ref={autoScroll.contentRef}
                  class="py-3 flex flex-col gap-0 w-full mx-auto"
                  style={{ "max-width": "800px" }}
                >
                  <For each={userMessages()}>
                    {(msg) => (
                      <InsightTurn
                        sessionID={params.id!}
                        messageID={msg.id}
                        status={sessionStatus()}
                        active={isBusy()}
                        onOpenResult={handleOpenResult}
                        taskCards={taskCardsByAnchor().get(msg.id) ?? []}
                        onTaskRefresh={handleTaskRefresh}
                        onTaskStop={handleTaskStop}
                        onTaskOpenResult={handleTaskOpenResult}
                      />
                    )}
                  </For>
                </div>
              </div>

              {/* 输入区(居中 reading-width,与消息列表对齐) */}
              <div class="shrink-0 p-4 w-full mx-auto" style={{ "max-width": "800px" }}>
                {/* 队列提示条:busy 时点了发送会先入队,这里给反馈 (SPEC-INS-007 §3.3.4) */}
                <Show when={queuedText()}>
                  <div class="octo-queue-banner">
                    <span class="octo-queue-banner-label">排队中</span>
                    <span class="octo-queue-banner-text">{queuedText()}</span>
                    <button
                      type="button"
                      onClick={cancelQueued}
                      class="octo-queue-banner-cancel"
                      title="取消并恢复到输入框"
                      aria-label="取消排队"
                    >
                      ×
                    </button>
                  </div>
                </Show>

                {/* 预置提示词按钮 (SPEC-INS-007 §3.1.3):放在输入框白卡片之外,
                    视觉层级:辅助操作浮在输入框上方,与卡片解耦 */}
                <PresetPrompts
                  prompts={PRESET_PROMPTS}
                  onClick={handlePresetClick}
                />

                <div
                  class="rounded-[16px] transition-all duration-300 relative group flex flex-col overflow-hidden"
                  style={{
                    border: "1px solid transparent",
                    background: `
                      linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
                      linear-gradient(135deg,
                        rgba(246, 97, 23, 0.7) 1%,
                        rgba(95, 45, 255, 0.7) 8%,
                        rgba(61, 93, 255, 0.7) 22%,
                        rgba(104, 138, 255, 0.7) 43%,
                        rgba(28, 171, 111, 0.7) 54%,
                        rgba(61, 93, 255, 0.7) 87%,
                        rgba(206, 7, 232, 0.7) 92%) border-box`,
                    "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
                    height: "150px",
                    "margin-top": attachments().length > 0 ? "6px" : "0",
                  }}
                >
                  {/* 附件条在胶囊内部顶部:单行横向滚动,不撑开胶囊 */}
                  <AttachmentBar
                    attachments={attachments()}
                    onRemove={removeAttachment}
                    onRetry={retryUpload}
                  />
                  <textarea
                    ref={textareaRef!}
                    value={prompt()}
                    onInput={(e) => setPrompt(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="上传评估任务书、逐字稿，智能整理问题和观点"
                    class="w-full flex-1 resize-none px-3 pt-2.5 pb-2 bg-transparent text-sm outline-none relative z-10"
                    style={{
                      color: "var(--octo-text-primary)",
                      "font-family": "var(--octo-font)",
                      "overflow-y": "auto",
                    }}
                  />

                  <div class="flex items-center gap-2 px-2.5 pb-2.5 relative z-10">
                    <input
                      ref={fileInputRef!}
                      type="file"
                      multiple
                      class="hidden"
                      accept={UPLOAD_ACCEPT}
                      onChange={handleFileInputChange}
                    />
                    <Tooltip
                      placement="top"
                      class="flex-shrink-0"
                      value={maxAttachments() ? `最多 ${MAX_ATTACHMENTS} 个文件` : UPLOAD_HINT}
                      contentStyle={{ "white-space": "nowrap", "max-width": "none" }}
                    >
                      <button
                        type="button"
                        onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                        disabled={maxAttachments()}
                        class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
                        aria-label="添加附件"
                      >
                        <Icon name="plus" class="size-5" />
                      </button>
                    </Tooltip>

                    <ModelSelectorPopover
                      model={local.model}
                      triggerAs="button"
                      triggerProps={{
                        class: "flex items-center gap-1.5 min-w-0 max-w-[200px] bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group",
                        "data-action": "prompt-model",
                      }}
                      onClose={() => { requestAnimationFrame(() => textareaRef?.focus()) }}
                    >
                      {/* 不渲染 ProviderIcon:内网自部署的 provider id 不在 ui sprite 内会落到
                          synthetic 占位图标,跟 UXAI chat 一致(屏蔽 icon 只显示模型名)。 */}
                      <span class="truncate">
                        {local.model.current()?.name ?? "选择模型"}
                      </span>
                      <Icon name="chevron-down" class="size-3.5 shrink-0 opacity-60" />
                    </ModelSelectorPopover>

                    <button
                      type="button"
                      onClick={() => stopping() ? void handleAbort() : void handleSubmit()}
                      disabled={!stopping() && (!prompt().trim() || hasUploadingAttachments())}
                      title={stopping() ? "停止生成" : (hasUploadingAttachments() ? "请等待附件上传完成" : (isBusy() ? "LLM 响应中,发送会进入排队" : undefined))}
                      class="flex flex-shrink-0 items-center justify-center ml-auto bg-transparent border-0 p-0 transition-opacity duration-200 disabled:cursor-not-allowed"
                      style={{
                        opacity: (!stopping() && (!prompt().trim() || hasUploadingAttachments())) ? 0.4 : 1,
                        filter: (!stopping() && (!prompt().trim() || hasUploadingAttachments())) ? "grayscale(0.5)" : "none",
                      }}
                    >
                      <Show when={stopping()} fallback={<IconSendBlue width={40} height={40} />}>
                        <IconStopBlue width={40} height={40} />
                      </Show>
                    </button>
                  </div>
                </div>
              </div>
            </Show>

        </div>

        {/* ── 任务面板:有产物且未收起时挂载;收起动画播完才卸载(SPEC-INS-009) ── */}
        <Show when={panelMounted()}>
          {/* 聊天/结果 拖拽分隔线（半侧贴边胶囊）—— 仅在动画结束的展开稳态显示,避免滑动中错位
              top/bottom 缩进 20px：避免与 Windows classic 滚动条两端箭头（~17px）热区重合 */}
          <Show when={panelExpanded() && !panelAnimating()}>
          <div
            class="absolute flex items-center justify-center group"
            style={{ top: "20px", bottom: "20px", left: `${chatWidth() - 10}px`, width: "20px", cursor: "col-resize", "z-index": 10 }}
            onPointerDown={handleDividerPointerDown}
          >
            {/* 拖拽手柄视觉胶囊已隐藏(dev-yfy d8bc3d4):保留热区与拖拽手感,仅去掉胶囊视觉
            <div
              class="absolute right-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
              style={{
                width: "12px",
                height: "36px",
                "border-radius": "10px 0 0 10px",
                "box-shadow": "-2px 0 4px rgba(0,0,0,0.04), inset 1px 0 0 rgba(0,0,0,0.02)",
                border: "1px solid var(--octo-border-divider)",
                "border-right": "none",
              }}
            >
              <div
                class="w-[2px] h-[14px] rounded-full mr-[2px]"
                style={{ background: "var(--octo-border-input, #c9c9c9)" }}
              />
            </div> */}
          </div>
          </Show>

          {/* 中栏：ResultViewer(flex:1 跟随聊天列宽度重排,收起时被挤到 0 并裁切) */}
          <ResultViewer
            tabs={tabStore.tabs()}
            activeId={tabStore.activeId()}
            onActivate={tabStore.activate}
            onClose={handleCloseTab}
            onCacheContent={tabStore.cacheContent}
            onCollapse={() => setPanelCollapsed(true)}
            onSetViewMode={tabStore.setViewMode}
          />
        </Show>
        </div>
      </div>
    </DataProvider>
  )
}

