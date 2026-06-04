import "../octo-tokens.css"
import { createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { For, Show } from "solid-js"
import { formatUploadsForPrompt, parseUploadedFiles } from "../lib/upload"

/**
 * Dev-only 预览页 — 「文件名带空格」上传卡片解析验证
 *
 * 路由: /_dev/attachment-parse
 * 复现的真实 bug:内网上传 10 个文件、发送后对话框上方文件列表少几个,丢的恰好都是
 * **文件名带空格**的。根因:服务端把未编码的原始文件名拼进返回 URL → URL 含空格 →
 * 旧正则 (https?:\/\/\S+) 的 \S+ 在空格处截断 → \s*$ 匹配失败 → 整行被丢弃。
 *
 * 本页用真实的 formatUploadsForPrompt(拼 synthetic 块) → parseUploadedFiles(解析回卡片)
 * 全链路,对比旧正则 vs 新解析,直观看出"带空格的几个"是否还会丢。
 */

// 旧实现(已被 upload.ts 替换):内联在此仅作对照,证明它会丢带空格的行。
function parseUploadedFilesOld(block: string): Array<{ filename: string; url: string }> {
  const out: Array<{ filename: string; url: string }> = []
  for (const line of block.split("\n")) {
    const m = line.match(/^-\s+(.+?):\s+(https?:\/\/\S+)\s*$/)
    if (m) out.push({ filename: m[1], url: m[2] })
  }
  return out
}

// 文件名扩展名徽标(与 insight-turn.tsx 的 extBadge 一致,本页自包含不外引)
function extBadge(filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase()
  return ext && ext !== filename.toUpperCase() ? ext : "FILE"
}

// 10 个原始文件名:奇数带空格,偶数不带,便于一眼看出"带空格的丢了"
const MOCK_FILENAMES = [
  "竞品分析.xlsx",
  "用研报告 2024Q4.docx", // 带空格
  "用户画像.pdf",
  "访谈 录音 转写稿.txt", // 带空格(多个)
  "NPS数据汇总.xlsx",
  "焦点小组 记录.docx", // 带空格
  "体验地图.pdf",
  "可用性测试 报告 final.pdf", // 带空格
  "痛点优先级矩阵.md",
  "原始问卷 v2.xlsx", // 带空格
]

// 模拟内网服务端行为:把**未编码**的原始文件名直接拼进 URL 路径。
// 文件名带空格 → URL 也带空格(这正是 bug 的源头)。
function mockServerUrl(filename: string, i: number): string {
  return `https://oss.internal/files/insight/2026-06-04/uuid-${i}/${filename}`
}

export default function AttachmentParsePreviewPage(): JSX.Element {
  const uploads = MOCK_FILENAMES.map((filename, i) => ({ filename, url: mockServerUrl(filename, i) }))

  // 真实链路第一步:拼 synthetic 上传块(发送时写进 message part)
  const uploadBlock = createMemo(() => formatUploadsForPrompt(uploads))

  // 第二步:两种解析对照
  const parsedOld = createMemo(() => parseUploadedFilesOld(uploadBlock()))
  const parsedNew = createMemo(() => parseUploadedFiles(uploadBlock()))

  // 被旧实现丢掉的文件名(用于高亮)
  const droppedByOld = createMemo(() => {
    const kept = new Set(parsedOld().map((f) => f.filename))
    return MOCK_FILENAMES.filter((n) => !kept.has(n))
  })

  return (
    <div
      class="size-full overflow-y-auto"
      style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}
    >
      <div class="mx-auto" style={{ "max-width": "880px", padding: "32px 24px 80px" }}>
        <div style={{ "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "4px" }}>
          上传卡片解析验证 ·「文件名带空格」
        </div>
        <div style={{ "font-size": "13px", color: "var(--octo-text-secondary)", "margin-bottom": "8px" }}>
          复现真实 bug:上传 10 个文件、发送后对话框上方只剩几个,丢的恰好都是<strong>文件名带空格</strong>的。
          走真实 <code>formatUploadsForPrompt → parseUploadedFiles</code> 全链路,对比旧正则 vs 新解析。
        </div>
        <div style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "margin-bottom": "24px" }}>
          mock 模拟内网服务端把<strong>未编码</strong>的原始文件名拼进 URL → 文件名带空格则 URL 也带空格(bug 源头)。
          本页 10 个文件中 4 个带空格:
          <For each={MOCK_FILENAMES.filter((n) => n.includes(" "))}>
            {(n) => <span style={{ color: "#b91c1c", "margin-left": "6px" }}>「{n}」</span>}
          </For>
        </div>

        {/* synthetic 上传块原文 */}
        <SectionTitle>① synthetic 上传块原文(formatUploadsForPrompt 产出 → 发送时写进 message part)</SectionTitle>
        <pre
          style={{
            background: "var(--octo-surface-page, #fff)", border: "1px solid var(--octo-border-divider, #eee)",
            "border-radius": "8px", padding: "14px 16px", "font-size": "12px",
            "font-family": "var(--octo-font-mono, ui-monospace, monospace)", "white-space": "pre-wrap",
            color: "var(--octo-text-strong)", "margin-bottom": "28px", "line-height": 1.7,
          }}
        >
          {uploadBlock()}
        </pre>

        {/* 旧正则 */}
        <ParseResult
          label="② 旧正则解析 /^-\s+(.+?):\s+(https?:\/\/\S+)\s*$/"
          tag="✗ 旧实现"
          color="red"
          parsed={parsedOld()}
        />
        <Show when={droppedByOld().length > 0}>
          <div style={{ "font-size": "12px", color: "#b91c1c", "margin-top": "-18px", "margin-bottom": "28px" }}>
            被丢弃 {droppedByOld().length} 个(全是带空格的):
            <For each={droppedByOld()}>{(n) => <span style={{ "margin-left": "6px" }}>「{n}」</span>}</For>
          </div>
        </Show>

        {/* 新解析 */}
        <ParseResult
          label="③ 新解析 indexOf(': ') 切分(upload.ts 当前实现)"
          tag="✓ 修复后"
          color="green"
          parsed={parsedNew()}
        />
      </div>
    </div>
  )
}

function SectionTitle(props: { children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "10px" }}>
      {props.children}
    </div>
  )
}

function ParseResult(props: {
  label: string
  tag: string
  color: "red" | "green"
  parsed: Array<{ filename: string; url: string }>
}): JSX.Element {
  const ok = () => props.color === "green"
  const tagColor = () => (ok() ? "#15803d" : "#b91c1c")
  const tagBg = () => (ok() ? "rgba(34,197,94,0.08)" : "rgba(220,38,38,0.08)")
  const border = () => (ok() ? "rgba(34,197,94,0.35)" : "rgba(220,38,38,0.3)")

  return (
    <div style={{ "margin-bottom": "28px" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "10px" }}>
        <span style={{ "font-size": "14px", "font-weight": 600, color: "var(--octo-text-strong)" }}>{props.label}</span>
        <span style={{
          "font-size": "11px", "font-weight": 600, padding: "2px 8px", "border-radius": "999px",
          background: tagBg(), color: tagColor(),
        }}>
          {props.tag}
        </span>
        <span style={{ "margin-left": "auto", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          解析出{" "}
          <strong style={{ color: props.parsed.length === 10 ? "#15803d" : "#b91c1c" }}>{props.parsed.length}</strong>
          {" "}/ 10
        </span>
      </div>
      <div
        style={{
          border: `1px solid ${border()}`, "border-radius": "12px",
          background: "var(--octo-surface-page, #fff)", padding: "12px", "min-height": "56px",
        }}
      >
        {/* 用真实的 octo-input-attachments 结构渲染,与对话框上方文件列表一致 */}
        <div class="octo-input-attachments" style={{ "justify-content": "flex-start" }}>
          <For each={props.parsed}>
            {(f) => (
              <div class="octo-input-attachment-card" title={f.filename}>
                <span class="octo-input-attachment-card__badge">{extBadge(f.filename)}</span>
                <span class="octo-input-attachment-card__name">{f.filename}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
