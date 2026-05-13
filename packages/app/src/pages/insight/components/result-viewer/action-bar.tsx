import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"
import { IconActionCopy, IconActionDownload } from "../../icons"

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error)
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function markdownTableToCSV(md: string): string {
  const lines = md.split("\n")
  const tableLines = lines.filter((l) => l.trim().startsWith("|"))
  return tableLines
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => `"${cell.trim().replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n")
}

export function ActionBar(props: { tab: ResultTab }): JSX.Element {
  function handleDownload() {
    if (props.tab.type === "table") {
      downloadBlob(markdownTableToCSV(props.tab.content), `${props.tab.title}.csv`, "text/csv;charset=utf-8")
    } else {
      downloadBlob(props.tab.content, `${props.tab.title}.md`, "text/markdown;charset=utf-8")
    }
  }

  return (
    <div
      class="flex items-center justify-between px-4 py-1.5 shrink-0"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        background: "var(--octo-surface-page)",
        "min-height": "36px",
      }}
    >
      <span class="text-xs truncate max-w-[55%]" style={{ color: "var(--octo-text-secondary)" }}>{props.tab.title}</span>
      <div class="flex items-center gap-0.5">
        <ActionBtn icon={<IconActionCopy size={14} />} label="复制" onClick={() => copyToClipboard(props.tab.content)} />
        <ActionBtn icon={<IconActionDownload size={14} />} label="下载" onClick={handleDownload} />
      </div>
    </div>
  )
}

function ActionBtn(props: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors octo-btn-action"
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}
