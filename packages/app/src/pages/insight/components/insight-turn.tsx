import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { useData } from "@opencode-ai/ui/context"
import { createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { IconCardTable, IconCardMindmap, IconCardJson, IconCardFile, IconCardMarkdown, IconCardHtml } from "../icons"
import { isMarkdownTable, isMindmapJSON, isHTML, isPlainJSON } from "../utils/detect"
import { findResourceLink, mimeToOutputType } from "../utils/resource-link"
import { type TaskCardEntry } from "../utils/task-detect"
import { TaskCardView } from "./task-card"

export type OutputCardType = "table" | "mindmap" | "markdown" | "file" | "json" | "html"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  source: "inline" | "uri"
  content?: string          // inline 必填;uri 模式下可空(fetch 后填到 tab cache)
  uri?: string              // uri 模式必填(MCP resource_link.uri)
  mimeType?: string         // uri 模式必填(影响渲染路由)
  fileName?: string         // uri 模式来自 resource_link.name
  createdAt: Date
}

function detectCard(text: string): { type: OutputCardType; title: string } | null {
  const heading = (t: string) => t.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim()

  // 1. Markdown 表格
  if (isMarkdownTable(text)) {
    return { type: "table", title: heading(text) ?? "分析结果" }
  }
  // 2. 思维导图 JSON（在 HTML 之前，避免 HTML 内嵌 JSON-like 字符串误判）
  if (isMindmapJSON(text)) {
    return { type: "mindmap", title: heading(text) ?? "思维导图" }
  }
  // 3. HTML（在 plain JSON 之前，因为 HTML 内可能含 <script>{…}</script> 文本）
  if (isHTML(text)) {
    return { type: "html", title: heading(text) ?? "可视化页面" }
  }
  // 4. 通用 JSON
  if (isPlainJSON(text)) {
    return { type: "json", title: heading(text) ?? "JSON 数据" }
  }
  // 5. 长文本 Markdown（>200 字）
  if (text.trim().length > 200) {
    return { type: "markdown", title: heading(text) ?? "分析报告" }
  }
  return null
}

function CardTypeIcon(props: { type: OutputCardType }): JSX.Element {
  switch (props.type) {
    case "table": return <IconCardTable size={16} />
    case "mindmap": return <IconCardMindmap size={16} />
    case "json": return <IconCardJson size={16} />
    case "file": return <IconCardFile size={16} />
    case "markdown": return <IconCardMarkdown size={16} />
    case "html": return <IconCardHtml size={16} />
  }
}

function formatTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function InsightTurn(props: {
  sessionID: string
  messageID: string
  status: SessionStatus
  active: boolean
  onOpenResult: (card: OutputCard) => void
  /** 锚点 = 本 turn 的 user message 下挂着的长任务卡片(每个 task_id 一张)。spec: task-card.md §3.3 */
  taskCards: TaskCardEntry[]
  /** 任务卡片操作(由 InsightPage 接线 LLM 触发) */
  onTaskRefresh: (taskId: string) => void
  onTaskStop: (taskId: string) => void
  onTaskOpenResult: (taskId: string) => void
  onTaskFollowup: (taskId: string) => void
}): JSX.Element {
  const data = useData()

  // 取该用户消息之后的第一条 assistant 消息
  const assistantMsg = createMemo((): AssistantMessage | undefined => {
    const messages = ((data.store.message as Record<string, Message[]>)?.[props.sessionID] ?? [])
    const idx = messages.findIndex((m) => m.id === props.messageID)
    if (idx === -1) return undefined
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === "assistant") return m as AssistantMessage
      if (m.role === "user") break
    }
    return undefined
  })

  const assistantParts = createMemo(() => {
    const msg = assistantMsg()
    if (!msg) return []
    return (data.store.part as Record<string, { type: string; text?: string }[]>)?.[msg.id] ?? []
  })

  // 本轮是否是最新的（最后一条）用户消息 —— 仅对最新轮次显示生成中占位
  const isLatestTurn = createMemo(() => {
    const messages = ((data.store.message as Record<string, Message[]>)?.[props.sessionID] ?? [])
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    return lastUser?.id === props.messageID
  })

  // session busy 且是最新轮次，才显示生成中
  const showGenerating = createMemo(() => props.active && isLatestTurn())

  // 只要有 text 内容就生成卡片（不依赖 time.completed 避免字段缺失时卡住）
  // 注意：parts 必须在 showGenerating 判断之前读，确保 SolidJS 始终追踪该依赖；
  // 若先 return null 则 assistantParts() 从未被追踪，session idle 后 memo 不会因 parts 变化重新触发。
  const outputCard = createMemo((): OutputCard | null => {
    const parts = assistantParts()
    if (showGenerating()) return null

    // 同 turn 有任务卡片就抑制 OutputCard:completed 由 TaskCardView 内的"查看完整结果"按钮触发 openTab
    // (spec: docs/specs/ui/task-card.md §3.4 优先级)
    if (props.taskCards.length > 0) return null

    // 路径 1：resource_link part(无 task_id 的场景,比如未来直接同步返回 resource_link 的工具)
    const link = findResourceLink(parts)
    if (link) {
      console.log("[octo:card] resource_link (no task)", { mime: link.mimeType, name: link.name, uri: link.uri, msgID: props.messageID })
      return {
        id: `card-${props.messageID}`,
        title: link.name || "分析结果",
        type: mimeToOutputType(link.mimeType),
        source: "uri",
        uri: link.uri,
        mimeType: link.mimeType,
        fileName: link.name,
        createdAt: new Date(),
      }
    }

    // 路径 2：text-detect inline(原有路径,保持向后兼容)
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (!textPart || typeof textPart.text !== "string") return null
    const text = textPart.text.trim()
    if (text.length < 10) return null
    const info = detectCard(text)
    if (!info) return null
    return {
      id: `card-${props.messageID}`,
      ...info,
      source: "inline",
      content: textPart.text,
      createdAt: new Date(),
    }
  })

  // mindmap / html / json 的原始文字对用户无价值，有卡片时隐藏 assistant 文字区
  const suppressRawOutput = createMemo(() => {
    const card = outputCard()
    return card && (card.type === "mindmap" || card.type === "html" || card.type === "json")
  })

  return (
    <div class="flex flex-col" data-suppress-raw={suppressRawOutput() ? "" : undefined}>
      <SessionTurn
        sessionID={props.sessionID}
        messageID={props.messageID}
        status={props.status}
        active={props.active}
        classes={{ root: "px-3" }}
      />

      <Show when={showGenerating()}>
        <div
          class="mx-3 mb-3 p-3"
          style={{
            "border-radius": "var(--octo-radius-md)",
            border: "1.5px dashed var(--octo-brand-a25)",
            background: "var(--octo-brand-a3)",
          }}
        >
          <span class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>⏳ 正在生成…</span>
        </div>
      </Show>

      <Show when={outputCard()}>
        {(card) => (
          <button
            type="button"
            onClick={() => props.onOpenResult(card())}
            class="mx-3 mb-3 p-3 text-left transition-all"
            style={{
              "border-radius": "var(--octo-radius-md)",
              border: "1px solid var(--octo-border-default)",
              background: "var(--octo-surface-page)",
              width: "calc(100% - 1.5rem)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--octo-brand-a20)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--octo-border-default)"
            }}
          >
            <div class="flex items-center gap-2">
              <span class="flex-shrink-0 flex items-center"><CardTypeIcon type={card().type} /></span>
              <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                <span class="text-sm font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>{card().title}</span>
                <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>{formatTime(card().createdAt)}</span>
              </div>
              <span class="text-xs flex-shrink-0" style={{ color: "var(--octo-text-secondary)" }}>→</span>
            </div>
          </button>
        )}
      </Show>

      {/* 长任务卡片(spec: docs/specs/ui/task-card.md §5) */}
      <Show when={props.taskCards.length > 0}>
        <For each={props.taskCards}>
          {(task) => (
            <TaskCardView
              card={task}
              busy={props.active}
              onRefresh={props.onTaskRefresh}
              onStop={props.onTaskStop}
              onOpenResult={props.onTaskOpenResult}
              onFollowup={props.onTaskFollowup}
            />
          )}
        </For>
      </Show>
    </div>
  )
}
