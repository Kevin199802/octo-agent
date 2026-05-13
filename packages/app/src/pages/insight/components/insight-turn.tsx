import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { useData } from "@opencode-ai/ui/context"
import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { IconCardTable, IconCardMindmap, IconCardJson, IconCardFile, IconCardMarkdown } from "../icons"

export type OutputCardType = "table" | "mindmap" | "markdown" | "file" | "json"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  content: string
  createdAt: Date
}

// 宽松的表格检测：有标准分隔行 OR 有 2 行以上含 3+ 个 | 的行
function isMarkdownTable(text: string): boolean {
  if (/\|[\s]*[-:]+[-:\s|]*\|/.test(text)) return true
  const tableLines = text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && (l.match(/\|/g) ?? []).length >= 3)
  return tableLines.length >= 2
}

function detectCard(text: string): { type: OutputCardType; title: string } | null {
  const heading = (t: string) => t.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim()

  // 1. 表格
  if (isMarkdownTable(text)) {
    return { type: "table", title: heading(text) ?? "分析结果" }
  }
  // 2. Mermaid
  if (/```mermaid/i.test(text)) {
    return { type: "mindmap", title: heading(text) ?? "思维导图" }
  }
  // 3. JSON 代码块
  if (/```json/i.test(text)) {
    return { type: "json", title: heading(text) ?? "JSON 数据" }
  }
  // 4. 长文本 Markdown（>200 字）
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
  const outputCard = createMemo((): OutputCard | null => {
    if (showGenerating()) return null
    const parts = assistantParts()
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
      content: textPart.text,
      createdAt: new Date(),
    }
  })

  return (
    <div class="flex flex-col">
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
    </div>
  )
}
