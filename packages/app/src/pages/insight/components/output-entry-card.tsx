import type { JSX } from "solid-js"
import { fileTypeIconUrl } from "../icons/illustrations"
import type { OutputCard, OutputCardType } from "./insight-turn"

/**
 * 文件结果卡片(紧凑预览入口) — 2026-06 设计稿改版。
 * spec: docs/specs/ui/output-renderers.md §6.B + memory insight-card-redesign-decisions
 *
 * 抽成独立组件,供 InsightTurn(真实对话流)与 _dev/cards-preview(预览页)共用,
 * 保证 dev 预览与线上完全同源("结合项目,不脱离项目")。
 *
 * 设计稿决策:
 * - 图标按文件类型走(fileTypeIconUrl,与 FileFallback 同源):DOCX/XLSX/PPT/
 *   PDF/HTML/MD/思维导图/视频/图片/代码各不同,其余落「其他文件」图标
 * - 副文案改"创建时间: …",去掉右侧"预览 →"(整卡可点)
 */

// inline 卡(自由文本嗅探)无 fileName/mimeType,按 card.type 合成一个能被
// fileTypeIconUrl 命中的扩展名/mime;uri 卡(MCP resource_link)直接用真实文件名。
const TYPE_SYNTH: Partial<Record<OutputCardType, { name?: string; mime?: string }>> = {
  html: { name: "x.html" },
  markdown: { name: "x.md" },
  mindmap: { name: "x.json", mime: "application/json+mindmap" },
  json: { name: "x.json" },
}

function cardIconUrl(card: OutputCard): string {
  if (card.fileName || card.mimeType) return fileTypeIconUrl(card.fileName, card.mimeType)
  const synth = TYPE_SYNTH[card.type]
  return fileTypeIconUrl(synth?.name, synth?.mime)
}

export function OutputEntryCard(props: { card: OutputCard; onClick: () => void }): JSX.Element {
  return (
    <button type="button" class="octo-preview-entry" onClick={props.onClick}>
      <span class="octo-preview-entry__icon">
        <img src={cardIconUrl(props.card)} width={28} height={28} alt="" aria-hidden="true" />
      </span>
      <span class="octo-preview-entry__body">
        <span class="octo-preview-entry__title">{previewEntryLabel(props.card)}</span>
        <span class="octo-preview-entry__desc">创建时间: {formatCreatedTime(props.card.createdAt)}</span>
      </span>
    </button>
  )
}

/**
 * 入口卡标题文案。优先用 card.title(来自 resource_link.name / heading);
 * 缺省时按类型给默认词,贴近用户语言("可视化页面"而非"HTML")。
 */
function previewEntryLabel(card: OutputCard): string {
  if (card.title && card.title.length > 0 && card.title !== "分析结果") return card.title
  switch (card.type) {
    case "html": return "可视化页面"
    case "mindmap": return "思维导图"
    case "table": return "分析表格"
    case "markdown": return "Markdown 文档"
    case "json": return "JSON 数据"
    case "file": return card.fileName || "文件"
  }
}

function formatCreatedTime(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
