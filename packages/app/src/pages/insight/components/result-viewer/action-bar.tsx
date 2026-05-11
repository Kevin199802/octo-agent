import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"

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
        "border-bottom": "1px solid rgba(0,0,0,0.06)",
        background: "rgba(255,255,255,0.5)",
        "min-height": "36px",
      }}
    >
      <span class="text-xs text-[#6b7280] truncate max-w-[55%]">{props.tab.title}</span>
      <div class="flex items-center gap-0.5">
        <ActionBtn icon="⎘" label="复制" onClick={() => copyToClipboard(props.tab.content)} />
        <ActionBtn icon="↓" label="下载" onClick={handleDownload} />
      </div>
    </div>
  )
}

function ActionBtn(props: { icon: string; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#6b7280] hover:text-[#374151] hover:bg-[rgba(0,0,0,0.05)] transition-colors"
    >
      <span>{props.icon}</span>
      <span>{props.label}</span>
    </button>
  )
}
