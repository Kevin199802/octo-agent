import { For, Show } from "solid-js"
import type { JSX } from "solid-js"

export type Attachment = {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

function getMimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼"
  if (mime === "application/pdf") return "📕"
  if (mime.includes("word") || mime.includes("docx")) return "📝"
  if (mime.includes("excel") || mime.includes("xlsx") || mime.includes("spreadsheet")) return "📊"
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

// 仅展示 chips，不含 + 按钮和 input（由父组件统一管理）
export function AttachmentBar(props: {
  attachments: Attachment[]
  onRemove: (id: string) => void
}): JSX.Element {
  return (
    <Show when={props.attachments.length > 0}>
      <div
        class="flex flex-wrap gap-1.5 px-3 py-2"
        style={{ "border-bottom": "1px solid rgba(0,0,0,0.06)" }}
      >
        <For each={props.attachments}>
          {(att) => (
            <div
              class="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs"
              style={{
                background: "rgba(37,99,235,0.08)",
                border: "1px solid rgba(37,99,235,0.16)",
                color: "#1e40af",
              }}
            >
              <span style={{ "font-size": "12px" }}>{getMimeIcon(att.mime)}</span>
              <span class="max-w-[110px] truncate" title={att.filename}>
                {truncateFilename(att.filename)}
              </span>
              <button
                type="button"
                onClick={() => props.onRemove(att.id)}
                class="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-[rgba(37,99,235,0.15)] transition-colors text-[11px] font-bold flex-shrink-0"
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
