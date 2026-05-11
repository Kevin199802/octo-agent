import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
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
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"

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
      const parts = dataStore.part[part.messageID]
      if (!parts) { setDataStore("part", part.messageID, [part]); return }
      const result = Binary.search(parts, part.id, (p) => p.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
      } else {
        setDataStore("part", part.messageID, produce((d) => { d.splice(result.index, 0, part) }))
      }
      return
    }

    if (event.type === "session.status") {
      const { sessionID, status } = event.properties
      if (sessionID !== sessionId) return
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

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return dataStore.session_status[id] ?? { type: "idle" }
  })

  const isBusy = createMemo(() => sessionStatus().type === "busy")

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

  // Bug 修复 B：切换 session 时重置 ResultViewer 的 Tabs
  createEffect(on(() => params.id, () => { tabStore.reset() }, { defer: true }))

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

  async function sendMessage(sessionId: string, text: string) {
    setSending(true)
    try {
      const fileParts: FilePartInput[] = attachments().map((a) => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.dataUrl,
      }))
      const textPart: TextPartInput = { type: "text", text }
      await globalSDK.client.session.prompt({
        sessionID: sessionId,
        parts: [textPart, ...fileParts],
      })
      setAttachments([])
    } catch (err) {
      console.error("[InsightPage] prompt failed", err)
    } finally {
      setSending(false)
    }
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

  function addAttachments(files: File[]) {
    const slots = 5 - attachments().length
    const toAdd = files.slice(0, slots)
    for (const file of toAdd) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            mime: file.type || "application/octet-stream",
            dataUrl,
          },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
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

  const inputDisabled = () => sending() || isBusy()
  const maxAttachments = () => attachments().length >= 5

  return (
    <DataProvider data={dataStore} directory={homeDir() || ""}>
      <div class="size-full flex overflow-hidden relative">

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

                <div class="flex items-center justify-between px-2.5 pb-2.5">
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
                    class="flex items-center gap-1 px-2 py-1 text-xs transition-colors octo-btn-attachment"
                    title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
                  >
                    <span style={{ "font-size": "14px", "line-height": "1" }}>＋</span>
                    <span>附件</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!prompt().trim() || inputDisabled()}
                    class="octo-btn-send flex-shrink-0"
                  >
                    {sending() ? "…" : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M1 7h10M7 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    )}
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
        />

        {/* ── 右栏：Workspace 占位 (P2) ──────────────── */}
        <div />
      </div>
    </DataProvider>
  )
}

function ChatEmptyState(): JSX.Element {
  return (
    <div class="size-full flex flex-col items-center justify-center gap-2 text-center px-8">
      <div class="text-[15px] font-semibold" style={{ color: "var(--octo-text-strong)" }}>Octo Insight</div>
      <div class="text-[13px] max-w-[200px] leading-relaxed" style={{ color: "var(--octo-text-secondary)" }}>
        上传访谈材料，发送指令开始分析
      </div>
    </div>
  )
}
