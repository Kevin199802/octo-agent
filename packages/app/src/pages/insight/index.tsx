import type { Message, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
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
      if (!messages) {
        setDataStore("message", sessionId, [info])
        return
      }
      const result = Binary.search(messages, info.id, (m) => m.id)
      if (result.found) {
        setDataStore("message", sessionId, result.index, reconcile(info))
      } else {
        setDataStore(
          "message",
          sessionId,
          produce((draft) => { draft.splice(result.index, 0, info) }),
        )
      }
      return
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionId) return
      if (SKIP_PART_TYPES.has(part.type)) return
      const parts = dataStore.part[part.messageID]
      if (!parts) {
        setDataStore("part", part.messageID, [part])
        return
      }
      const result = Binary.search(parts, part.id, (p) => p.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
      } else {
        setDataStore(
          "part",
          part.messageID,
          produce((draft) => { draft.splice(result.index, 0, part) }),
        )
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
      setDataStore(
        "part",
        messageID,
        produce((draft) => {
          const part = draft[result.index] as Record<string, unknown>
          part[field] = ((part[field] as string) ?? "") + delta
        }),
      )
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

  async function createAndNavigate() {
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
      await globalSDK.client.session.prompt({
        sessionID: sessionId,
        parts: [{ type: "text", text }],
      })
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

  const inputDisabled = () => sending() || isBusy()

  return (
    <DataProvider data={dataStore} directory={homeDir() || ""}>
      <div class="size-full flex bg-background-base overflow-hidden">

        {/* 左栏：对话区 */}
        <div
          class="flex flex-col border-r border-border-base overflow-hidden"
          style={{ width: "380px", "flex-shrink": "0" }}
        >
          <div class="flex-1 overflow-y-auto min-h-0">
            <Show
              when={params.id && userMessages().length > 0}
              fallback={<EmptyState onNew={createAndNavigate} loading={sending()} />}
            >
              <div class="py-4 px-3 flex flex-col gap-0">
                <For each={userMessages()}>
                  {(msg) => (
                    <SessionTurn
                      sessionID={params.id!}
                      messageID={msg.id}
                      status={sessionStatus()}
                      active={isBusy()}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* 输入区 */}
          <div class="shrink-0 border-t border-border-base px-3 py-3">
            <div class="flex gap-2 items-end">
              <textarea
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入指令，按 Enter 发送…"
                rows={1}
                disabled={inputDisabled()}
                style={{
                  flex: "1",
                  resize: "none",
                  padding: "8px 12px",
                  "border-radius": "8px",
                  border: "1px solid var(--border-base)",
                  background: "var(--background-stronger)",
                  color: "var(--text-base)",
                  "font-size": "13px",
                  "line-height": "1.5",
                  outline: "none",
                  "max-height": "120px",
                  "overflow-y": "auto",
                  "font-family": "inherit",
                  opacity: inputDisabled() ? "0.5" : "1",
                }}
              />
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!prompt().trim() || inputDisabled()}
                classList={{
                  "h-9 px-4 rounded-lg text-13-medium transition-colors shrink-0": true,
                  "bg-blue-600 text-white hover:bg-blue-700": !(!prompt().trim() || inputDisabled()),
                  "bg-background-stronger text-text-weak cursor-default": !prompt().trim() || inputDisabled(),
                }}
              >
                {sending() ? "…" : "发送"}
              </button>
            </div>
          </div>
        </div>

        {/* 右栏：结果区（待实现） */}
        <div class="flex-1 min-w-0 bg-background-base" />
      </div>
    </DataProvider>
  )
}

function EmptyState(props: { onNew: () => void; loading: boolean }): JSX.Element {
  return (
    <div class="size-full flex flex-col items-center justify-center gap-4 text-center px-6">
      <div class="text-20-medium text-text-strong">Octo Insight</div>
      <div class="text-14-regular text-text-weak max-w-xs">用研 Agent，在下方输入指令开始新对话</div>
      <button
        type="button"
        onClick={props.onNew}
        disabled={props.loading}
        classList={{
          "mt-2 px-5 py-2 rounded-lg text-14-medium transition-colors": true,
          "bg-blue-600 text-white hover:bg-blue-700": !props.loading,
          "bg-background-stronger text-text-weak cursor-default": props.loading,
        }}
      >
        新建对话
      </button>
    </div>
  )
}
