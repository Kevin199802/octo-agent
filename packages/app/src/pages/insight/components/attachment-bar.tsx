import { For, Match, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"

export type AttachmentStatus = "uploading" | "done" | "error"

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  status: AttachmentStatus
  url?: string // status=done 时有
  error?: string // status=error 时有（用于 tooltip）
}

function getMimeIcon(filename: string, mime: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (mime.startsWith("image/")) return "🖼"
  if (ext === "pdf" || mime === "application/pdf") return "📕"
  if (ext === "docx" || mime.includes("word") || mime.includes("docx")) return "📝"
  if (ext === "xlsx" || mime.includes("excel") || mime.includes("xlsx") || mime.includes("spreadsheet")) return "📊"
  if (ext === "md") return "📄"
  if (ext === "txt") return "📄"
  return "📄"
}

function truncateFilename(name: string, max = 18): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf(".")
  if (dot > 0) {
    const ext = name.slice(dot)
    const keep = max - ext.length - 1
    if (keep > 0) return name.slice(0, keep) + "…" + ext
  }
  return name.slice(0, max - 1) + "…"
}

const STATUS_STYLE: Record<AttachmentStatus, { bg: string; border: string; color: string }> = {
  uploading: {
    bg: "rgba(148,163,184,0.12)",
    border: "1px solid rgba(148,163,184,0.24)",
    color: "#475569",
  },
  done: {
    bg: "rgba(37,99,235,0.08)",
    border: "1px solid rgba(37,99,235,0.16)",
    color: "#1e40af",
  },
  error: {
    bg: "rgba(220,38,38,0.08)",
    border: "1px solid rgba(220,38,38,0.24)",
    color: "#b91c1c",
  },
}

export function AttachmentBar(props: {
  attachments: Attachment[]
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
}): JSX.Element {
  return (
    <Show when={props.attachments.length > 0}>
      <div
        class="flex flex-wrap gap-1.5 px-3 py-2"
        style={{ "border-bottom": "1px solid rgba(0,0,0,0.06)" }}
      >
        <For each={props.attachments}>
          {(att) => {
            const style = () => STATUS_STYLE[att.status]
            return (
              <div
                class="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs"
                title={att.status === "error" ? att.error ?? "上传失败" : att.filename}
                style={{
                  background: style().bg,
                  border: style().border,
                  color: style().color,
                }}
              >
                <span style={{ "font-size": "12px" }}>
                  <Switch fallback={getMimeIcon(att.filename, att.mime)}>
                    <Match when={att.status === "uploading"}>⏳</Match>
                    <Match when={att.status === "error"}>⚠️</Match>
                  </Switch>
                </span>
                <span class="max-w-[110px] truncate">{truncateFilename(att.filename)}</span>
                <Show when={att.status === "error" && props.onRetry}>
                  <button
                    type="button"
                    onClick={() => props.onRetry?.(att.id)}
                    class="ml-0.5 px-1 rounded-full text-[10px] font-medium hover:bg-[rgba(220,38,38,0.15)] transition-colors"
                    title="重传"
                  >
                    ↻
                  </button>
                </Show>
                <button
                  type="button"
                  onClick={() => props.onRemove(att.id)}
                  class="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-[11px] font-bold flex-shrink-0"
                >
                  ×
                </button>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
