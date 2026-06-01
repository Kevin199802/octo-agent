import type { JSX } from "solid-js"
import docPurpleUrl from "../icons/IconCardDocPurple.svg?url"
import type { OutputCard } from "./insight-turn"

/**
 * 文件结果卡片(紧凑预览入口) — 2026-06 设计稿改版。
 * spec: docs/specs/ui/output-renderers.md §6.B + memory insight-card-redesign-decisions
 *
 * 抽成独立组件,供 InsightTurn(真实对话流)与 _dev/cards-preview(预览页)共用,
 * 保证 dev 预览与线上完全同源("结合项目,不脱离项目")。
 *
 * 设计稿决策:
 * - 图标统一紫色文档(不再按 type 分 6 种)
 * - 副文案改"创建时间: …",去掉右侧"预览 →"(整卡可点)
 */
export function OutputEntryCard(props: { card: OutputCard; onClick: () => void }): JSX.Element {
  return (
    <button type="button" class="octo-preview-entry" onClick={props.onClick}>
      <span class="octo-preview-entry__icon">
        <img src={docPurpleUrl} width={28} height={28} alt="" aria-hidden="true" />
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
