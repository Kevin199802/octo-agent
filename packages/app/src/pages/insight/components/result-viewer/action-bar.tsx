import { createSignal, onCleanup, Show, For } from "solid-js"
import type { JSX } from "solid-js"
import writeXlsxFile from "write-excel-file/browser"
import type { ResultTab } from "./tab-store"
import { IconActionCopy, IconActionDownload } from "../../icons"
import { parseMarkdownTable, tableToCSV } from "../../utils/markdown-table"
import { stripCodeFence } from "../../utils/detect"

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

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
}

async function tableToXlsx(md: string, filename: string) {
  const rows = parseMarkdownTable(md)
  if (rows.length === 0) return
  const data = rows.map((row) => row.map((c) => ({ value: c, type: String })))
  await writeXlsxFile(data).toFile(filename)
}

type DownloadOption = { label: string; onClick: () => void }

function downloadOptions(tab: ResultTab): DownloadOption[] {
  const base = sanitizeFilename(tab.title)
  switch (tab.type) {
    case "table":
      return [
        {
          label: "Markdown (.md)",
          onClick: () => downloadBlob(tab.content, `${base}.md`, "text/markdown;charset=utf-8"),
        },
        {
          label: "CSV (.csv)",
          onClick: () =>
            downloadBlob("﻿" + tableToCSV(tab.content), `${base}.csv`, "text/csv;charset=utf-8"),
        },
        {
          label: "Excel (.xlsx)",
          onClick: () => {
            tableToXlsx(tab.content, `${base}.xlsx`).catch((err) => {
              console.error("Excel 导出失败:", err)
            })
          },
        },
      ]
    case "html":
      return [
        {
          label: "HTML (.html)",
          onClick: () =>
            downloadBlob(stripCodeFence(tab.content), `${base}.html`, "text/html;charset=utf-8"),
        },
      ]
    case "mindmap":
      return [
        {
          label: "JSON (.json)",
          onClick: () =>
            downloadBlob(stripCodeFence(tab.content), `${base}.json`, "application/json;charset=utf-8"),
        },
      ]
    case "json":
      return [
        {
          label: "JSON (.json)",
          onClick: () =>
            downloadBlob(stripCodeFence(tab.content), `${base}.json`, "application/json;charset=utf-8"),
        },
      ]
    default:
      return [
        {
          label: "Markdown (.md)",
          onClick: () => downloadBlob(tab.content, `${base}.md`, "text/markdown;charset=utf-8"),
        },
      ]
  }
}

export function ActionBar(props: { tab: ResultTab }): JSX.Element {
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
        <DownloadMenu tab={props.tab} />
      </div>
    </div>
  )
}

function DownloadMenu(props: { tab: ResultTab }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  let containerRef: HTMLDivElement | undefined

  const onDocClick = (e: MouseEvent) => {
    if (!containerRef) return
    if (!containerRef.contains(e.target as Node)) setOpen(false)
  }
  document.addEventListener("click", onDocClick)
  onCleanup(() => document.removeEventListener("click", onDocClick))

  return (
    <div class="relative" ref={(el) => (containerRef = el)}>
      <ActionBtn
        icon={<IconActionDownload size={14} />}
        label="下载"
        onClick={() => setOpen((v) => !v)}
      />
      <Show when={open()}>
        <div
          class="absolute right-0 mt-1 py-1 min-w-[140px] z-10 rounded shadow-md"
          style={{
            background: "var(--octo-surface-page)",
            border: "1px solid var(--octo-border-default)",
            top: "100%",
          }}
        >
          <For each={downloadOptions(props.tab)}>
            {(opt) => (
              <button
                type="button"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--octo-brand-a5)]"
                style={{ color: "var(--octo-text-primary)" }}
                onClick={() => {
                  setOpen(false)
                  opt.onClick()
                }}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </Show>
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
