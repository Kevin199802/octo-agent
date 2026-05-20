import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import type { TextPartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { Binary } from "@opencode-ai/shared/util/binary"
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { PromptTemplateSelector } from "./components/prompt-template-selector"
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"
import { PROMPT_TEMPLATES, DEFAULT_TEMPLATE_ID, type PromptTemplateId } from "./store/prompt-template"
import { IconAttach, IconSend } from "./icons"
import { IllustrationInsightEmpty } from "./icons/illustrations"
import { uploadFile, validateFile, formatUploadsForPrompt, UploadError } from "./lib/upload"
import { aggregateTaskCards, readTaskInfo, toolDisplayName, type TaskCardEntry } from "./utils/task-detect"
import { mimeToOutputType } from "./utils/resource-link"
import { clearRefreshState, markRefreshed, isInCooldown } from "./utils/task-refresh"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])

type DataStore = {
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  session_diff: { [sessionID: string]: SnapshotFileDiff[] }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

export default function InsightPage() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const homeDir = () => globalSync.data.path.home

  const [dataStore, setDataStore] = createStore<DataStore>({
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
  })

  createEffect(
    on(
      () => params.id,
      async (id) => {
        if (!id) return
        try {
          const result = await globalSDK.client.session.messages({ sessionID: id })
          const items = result.data ?? []
          const msgs: Message[] = []
          const partMap: { [msgId: string]: Part[] } = {}
          for (const { info, parts } of items as { info: Message; parts: Part[] }[]) {
            msgs.push(info)
            const visible = parts.filter((p) => !SKIP_PART_TYPES.has(p.type))
            if (visible.length > 0) partMap[info.id] = visible
          }
          batch(() => {
            setDataStore("message", id, reconcile(msgs, { key: "id" }))
            for (const [msgId, ps] of Object.entries(partMap)) {
              setDataStore("part", msgId, reconcile(ps, { key: "id" }))
            }
          })
        } catch (err) {
          console.error("[InsightPage] messages load failed", err)
        }
      },
    ),
  )

  const unsub = globalSDK.event.listen((e) => {
    const sessionId = params.id
    if (!sessionId) return
    const event = e.details

    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.sessionID !== sessionId) return
      const messages = dataStore.message[sessionId]
      if (!messages) { setDataStore("message", sessionId, [info]); return }
      const result = Binary.search(messages, info.id, (m) => m.id)
      if (result.found) {
        setDataStore("message", sessionId, result.index, reconcile(info))
      } else {
        setDataStore("message", sessionId, produce((d) => { d.splice(result.index, 0, info) }))
      }
      return
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionId) return
      if (SKIP_PART_TYPES.has(part.type)) return
      // log tool_call parts (critical for MCP debugging)
      if ((part as { type: string }).type === "tool-invocation" || (part as { type: string }).type === "tool_call") {
        console.log("[octo:sse] tool part", { type: part.type, part })
      }
      const parts = dataStore.part[part.messageID]
      if (!parts) { setDataStore("part", part.messageID, [part]); return }
      const result = Binary.search(parts, part.id, (p) => p.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
      } else {
        // new part first arrival
        console.log("[octo:sse] new part", { type: part.type, partID: part.id, msgID: part.messageID })
        setDataStore("part", part.messageID, produce((d) => { d.splice(result.index, 0, part) }))
      }
      return
    }

    if (event.type === "session.status") {
      const { sessionID, status } = event.properties
      if (sessionID !== sessionId) return
      console.log("[octo:sse] session.status", sessionID, status)
      setDataStore("session_status", sessionID, reconcile(status))
      return
    }

    const raw = event as unknown as { type: string; properties: Record<string, unknown> }
    if (raw.type === "message.part.delta") {
      const { messageID, partID, field, delta } = raw.properties as {
        messageID: string; partID: string; field: string; delta: string
      }
      const parts = dataStore.part[messageID]
      if (!parts) return
      const result = Binary.search(parts, partID, (p) => p.id)
      if (!result.found) return
      setDataStore("part", messageID, produce((d) => {
        const p = d[result.index] as Record<string, unknown>
        p[field] = ((p[field] as string) ?? "") + delta
      }))
    }
  })
  onCleanup(unsub)

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    return (dataStore.message[id] ?? []).filter((m) => m.role === "user")
  })

  // ── 长任务卡片聚合(spec: docs/specs/ui/task-card.md §3.3)──
  // 扫所有 assistant message 的 part,按 task_id 分组取最新状态;锚点 = 最早 part 所在 user message
  const taskCards = createMemo((): Map<string, TaskCardEntry> => {
    const id = params.id
    if (!id) return new Map()
    const messages = dataStore.message[id] ?? []
    const items: Parameters<typeof aggregateTaskCards>[0] = []
    let lastUserMsgID = ""
    for (const msg of messages) {
      if (msg.role === "user") {
        lastUserMsgID = msg.id
        continue
      }
      if (msg.role !== "assistant" || !lastUserMsgID) continue
      const parts = dataStore.part[msg.id] ?? []
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
          resourceLink: info.resourceLink,
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
    return dataStore.session_status[id] ?? { type: "idle" }
  })

  const isBusy = createMemo(() => sessionStatus().type === "busy")

  const [templateId, setTemplateId] = createSignal<PromptTemplateId>(DEFAULT_TEMPLATE_ID)
  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  // 对话面板宽度，可拖拽，范围 200–520px
  const [chatWidth, setChatWidth] = createSignal(320)

  function handleDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    const onMove = (ev: MouseEvent) => {
      setChatWidth(Math.max(240, Math.min(Math.floor(window.innerWidth * 0.45), startWidth + ev.clientX - startX)))
    }
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const tabStore = createTabStore()

  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })

  // 切换 session 时重置 ResultViewer tabs / 模板 / 任务卡片防抖 / 自动 openTab 记录
  createEffect(on(() => params.id, () => {
    tabStore.reset()
    setTemplateId(DEFAULT_TEMPLATE_ID)
    clearRefreshState()
    autoOpenedTaskIds.clear()
    lastTaskSnapshot = new Map()
    console.log("[octo:task] session switched, refresh state cleared", { sessionID: params.id })
  }, { defer: true }))

  // ── session 操作 ──────────────────────────────────────────

  async function createAndNavigate(): Promise<string | undefined> {
    const dir = homeDir()
    if (!dir) return
    setSending(true)
    try {
      const result = await globalSDK.client.session.create({ directory: dir })
      const session = result.data as Session | undefined
      if (session) {
        navigate(`/insight/${session.id}`)
        return session.id
      }
    } catch (err) {
      console.error("[InsightPage] session.create failed", err)
    } finally {
      setSending(false)
    }
    return undefined
  }

  /**
   * 共享的 prompt 调用底层。
   *   - consumeAttachments=true(用户手动发送):附件随消息发送,发送后清空附件状态
   *   - consumeAttachments=false(刷新/终止/follow-up 按钮 inject):不消费附件,保留用户正在选的附件状态
   * spec: docs/specs/ui/task-card.md §6.1
   */
  async function doSendPrompt(sessionId: string, text: string, opts: { consumeAttachments: boolean; source: string }) {
    setSending(true)
    try {
      const template = PROMPT_TEMPLATES.find((t) => t.id === templateId())!
      const doneAttachments = opts.consumeAttachments
        ? attachments().filter((a) => a.status === "done" && a.url)
        : []
      const fullText = text + formatUploadsForPrompt(
        doneAttachments.map((a) => ({ filename: a.filename, url: a.url! })),
      )
      const textPart: TextPartInput = { type: "text", text: fullText }
      const promptPayload = {
        sessionID: sessionId,
        agent: "insight",
        system: template.systemHint,
        parts: [textPart],
      }
      console.log("[octo:prompt] send", {
        source: opts.source,
        sessionID: sessionId,
        agent: promptPayload.agent,
        template: templateId(),
        systemHint: template.systemHint?.slice(0, 80),
        text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
        textLen: text.length,
        attachmentsCount: doneAttachments.length,
        uploads: doneAttachments.map((a) => ({ name: a.filename, url: a.url })),
      })
      await globalSDK.client.session.prompt(promptPayload)
      if (opts.consumeAttachments) {
        filesById.clear()
        setAttachments([])
      }
    } catch (err) {
      console.error("[InsightPage] prompt failed", { source: opts.source, err })
    } finally {
      setSending(false)
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
    if (!text || sending()) return
    setPrompt("")
    let sid = params.id
    if (!sid) {
      sid = await createAndNavigate()
      if (!sid) return
    }
    await sendMessage(sid, text)
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
    const slots = 5 - attachments().length
    const toAdd = files.slice(0, slots)
    for (const file of toAdd) {
      const id = crypto.randomUUID()
      const mime = file.type || "application/octet-stream"
      const validationErr = validateFile(file)
      if (validationErr) {
        setAttachments((prev) => [
          ...prev,
          { id, filename: file.name, mime, size: file.size, status: "error", error: validationErr.message },
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
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "error", error: message } : a)),
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
      // 客户端 validate 失败的 chip 没有原 File，无法重传；用户应删除重新选
      return
    }
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "uploading", error: undefined } : a)),
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
  }

  // ── 长任务卡片操作(spec: docs/specs/ui/task-card.md §6) ──────

  function handleTaskRefresh(taskId: string) {
    const sid = params.id
    if (!sid) return
    if (isBusy() || sending()) {
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
    if (isBusy() || sending()) {
      console.log("[octo:task] stop blocked: busy", { taskId })
      return
    }
    void sendInjectedPrompt(sid, `终止任务 ${taskId}`, "task-stop")
  }

  function handleTaskFollowup(taskId: string) {
    // 填种子文本到输入框,光标定位,不自动发送(spec §6.1 "在对话里继续讨论")
    const card = taskCards().get(taskId)
    const toolHint = card ? toolDisplayName(card.toolName) : "任务"
    const seed = `基于 task ${taskId}(${toolHint})的结果,我想…`
    setPrompt(seed)
    console.log("[octo:task] followup seed", { taskId, seed })
    // 滚动到输入框 / focus — 由用户自然交互完成,不强抢焦点
  }

  function buildOutputCardFromTask(card: TaskCardEntry): OutputCard | null {
    if (card.status !== "completed") return null
    const baseTitle = `${toolDisplayName(card.toolName)} 结果`
    if (card.resourceLink) {
      return {
        id: `task-${card.taskId}`,
        title: card.resourceLink.name || baseTitle,
        type: mimeToOutputType(card.resourceLink.mimeType),
        source: "uri",
        uri: card.resourceLink.uri,
        mimeType: card.resourceLink.mimeType,
        fileName: card.resourceLink.name,
        createdAt: card.lastUpdatedAt,
      }
    }
    if (card.resultText && card.resultText.length > 0) {
      return {
        id: `task-${card.taskId}`,
        title: baseTitle,
        type: "markdown",
        source: "inline",
        content: card.resultText,
        createdAt: card.lastUpdatedAt,
      }
    }
    return null
  }

  function handleTaskOpenResult(taskId: string) {
    const card = taskCards().get(taskId)
    if (!card) {
      console.warn("[octo:task] openResult: card not found", { taskId })
      return
    }
    const oc = buildOutputCardFromTask(card)
    if (!oc) {
      console.warn("[octo:task] openResult: no result yet", { taskId, status: card.status })
      return
    }
    console.log("[octo:task] openResult", { taskId, tabType: oc.type, source: oc.source })
    tabStore.openTab(oc)
  }

  // ── 自动 openTab(ResultViewer 当前为空时,首个 completed 任务自动开;spec §8.3)──
  const autoOpenedTaskIds = new Set<string>()
  createEffect(() => {
    if (tabStore.tabs().length > 0) return
    for (const card of taskCards().values()) {
      if (card.status !== "completed") continue
      if (autoOpenedTaskIds.has(card.taskId)) continue
      const oc = buildOutputCardFromTask(card)
      if (!oc) continue
      autoOpenedTaskIds.add(card.taskId)
      console.log("[octo:task] auto-openResult (viewer empty)", { taskId: card.taskId, tabType: oc.type })
      tabStore.openTab(oc)
      break  // 一次只自动开一个
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
          hasResourceLink: !!c.resourceLink,
          hasResultText: !!c.resultText,
        })),
      })
    }
    lastTaskSnapshot = currentSnap
  })

  const inputDisabled = () => sending() || isBusy()
  const maxAttachments = () => attachments().length >= 5
  const hasUploadingAttachments = () => attachments().some((a) => a.status === "uploading")

  return (
    <DataProvider data={dataStore} directory={homeDir() || ""}>
      <div class="size-full flex overflow-hidden relative" data-page="insight">

        {/* ── 左栏：对话面板（固定宽度，始终可拖拽） ──── */}
        <div
          class="flex flex-col overflow-hidden flex-shrink-0"
          style={{
            width: `${chatWidth()}px`,
            flex: "0 0 auto",
            background: isDragOver() ? "var(--octo-brand-a3)" : "var(--octo-shell-bg)",
            outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            {/* 消息列表（autoScroll 挂在 scrollRef 容器，contentRef 挂在内容 div） */}
            <div
              class="flex-1 overflow-y-auto min-h-0"
              ref={autoScroll.scrollRef}
              onScroll={autoScroll.handleScroll}
              onMouseUp={autoScroll.handleInteraction}
            >
              <Show
                when={params.id && userMessages().length > 0}
                fallback={<ChatEmptyState />}
              >
                <div ref={autoScroll.contentRef} class="py-3 flex flex-col gap-0">
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
                        onTaskFollowup={handleTaskFollowup}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* 输入区 */}
            <div class="shrink-0 p-4">
              <AttachmentBar
                attachments={attachments()}
                onRemove={removeAttachment}
                onRetry={retryUpload}
              />

              <div
                class="rounded-[var(--octo-radius-lg)] overflow-hidden"
                style={{
                  background: "var(--octo-surface-page)",
                  "box-shadow": "0 2px 12px rgba(0, 0, 0, 0.08)",
                  "margin-top": attachments().length > 0 ? "6px" : "0",
                }}
              >
                <textarea
                  value={prompt()}
                  onInput={(e) => setPrompt(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入指令，按 Enter 发送…"
                  rows={3}
                  disabled={inputDisabled()}
                  class="w-full resize-none px-3 pt-2.5 pb-2 bg-transparent text-sm outline-none"
                  style={{
                    color: inputDisabled() ? "var(--octo-text-disabled)" : "var(--octo-text-primary)",
                    "font-family": "var(--octo-font)",
                    "max-height": "120px",
                    "overflow-y": "auto",
                  }}
                />

                <div class="flex items-center gap-2 px-2.5 pb-2.5">
                  <input
                    ref={fileInputRef!}
                    type="file"
                    multiple
                    class="hidden"
                    accept="*/*"
                    onChange={handleFileInputChange}
                  />
                  <button
                    type="button"
                    onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                    disabled={maxAttachments()}
                    class="flex items-center gap-1 px-2 py-1 text-xs transition-colors octo-btn-attachment flex-shrink-0"
                    title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
                  >
                    <IconAttach size={14} />
                  </button>

                  <PromptTemplateSelector
                    value={templateId()}
                    onChange={setTemplateId}
                  />

                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!prompt().trim() || inputDisabled() || hasUploadingAttachments()}
                    title={hasUploadingAttachments() ? "等待附件上传完成" : undefined}
                    class="octo-btn-send flex-shrink-0 ml-auto"
                  >
                    {sending() ? "…" : <IconSend size={14} />}
                  </button>
                </div>
              </div>
            </div>

        </div>

        {/* ── 聊天/结果 拖拽分隔线（半侧贴边胶囊） */}
        <div
          class="absolute top-0 bottom-0 flex items-center justify-center group"
          style={{ left: `${chatWidth() - 10}px`, width: "20px", cursor: "col-resize", "z-index": 10 }}
          onMouseDown={handleDividerMouseDown}
        >
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
          </div>
        </div>

        {/* ── 中栏：ResultViewer（始终渲染，无 tab 时显示空态） */}
        <ResultViewer
          tabs={tabStore.tabs()}
          activeId={tabStore.activeId()}
          onActivate={tabStore.activate}
          onClose={tabStore.closeTab}
          onCacheContent={tabStore.cacheContent}
        />

        {/* ── 右栏：Workspace 占位 (P2) ──────────────── */}
        <div />
      </div>
    </DataProvider>
  )
}

function ChatEmptyState(): JSX.Element {
  return (
    <div class="size-full flex flex-col items-center justify-center gap-3 text-center px-8">
      <IllustrationInsightEmpty width={120} height={120} />
      <div class="text-[15px] font-semibold" style={{ color: "var(--octo-text-strong)" }}>Octo Insight</div>
      <div class="text-[13px] max-w-[200px] leading-relaxed" style={{ color: "var(--octo-text-secondary)" }}>
        上传访谈材料，发送指令开始分析
      </div>
    </div>
  )
}
