import { For, Match, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export type AttachmentStatus = "uploading" | "done" | "error"

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  status: AttachmentStatus
  url?: string // status=done 时有
  error?: string // status=error 时有（用于 tooltip）
  // 是否可重传：仅"通过校验、真正发起过上传"的失败 chip 可重传(filesById 里有原 File)。
  // 客户端校验失败(扩展名/大小/空文件)的 chip 重试同文件必然同错,不提供重试,只能删除重选。
  retriable?: boolean
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
  // 放在输入胶囊内部顶部:单行横向滚动(类 Claude/Gemini),不随内容撑开胶囊;
  // 单 chip 文件名溢出省略,chip 数量溢出横向滚动。下方 textarea 自有纵向滚动区。
  return (
    <Show when={props.attachments.length > 0}>
      <div class="octo-attach-strip flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        <For each={props.attachments}>
          {(att) => {
            const style = () => STATUS_STYLE[att.status]
            // chip 本体;error 态由外层 Tooltip 显示错误原因,非 error 用原生 title 显示全名
            const chip = () => (
              <div
                class="flex flex-shrink-0 items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs whitespace-nowrap"
                title={att.status === "error" ? undefined : att.filename}
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
                <Show when={att.status === "error" && att.retriable && props.onRetry}>
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
            // error chip 用样式化 Tooltip 显式给出失败原因(原生 title 太弱不易察觉);
            // 校验失败(不可重传)时追加一句操作引导,让"为什么没重试按钮"有解释。
            return (
              <Show when={att.status === "error"} fallback={chip()}>
                <Tooltip
                  placement="top"
                  class="flex-shrink-0"
                  value={
                    <div class="text-xs leading-snug">
                      <div>{att.error ?? "上传失败"}</div>
                      <Show when={!att.retriable}>
                        <div style={{ opacity: 0.7, "margin-top": "2px" }}>请删除后重新选择文件</div>
                      </Show>
                    </div>
                  }
                >
                  {chip()}
                </Tooltip>
              </Show>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
