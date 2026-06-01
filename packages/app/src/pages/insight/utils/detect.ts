// 路径 B(自由文本嗅探)的检测规则。
// 设计原则与边界见 docs/specs/ui/output-renderers.md §0 + §2。
// 路径 A(MCP resource_link 强契约)走 resource-link.ts,与本文件无关。

export function tryParseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function stripCodeFence(text: string): string {
  const m = text.match(/```(?:json|mindmap|html)?\s*\n([\s\S]+?)\n?```/i)
  return (m ? m[1] : text).trim()
}

export function isMarkdownTable(text: string): boolean {
  if (/\|[\s]*[-:]+[-:\s|]*\|/.test(text)) return true
  const tableLines = text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && (l.match(/\|/g) ?? []).length >= 3)
  return tableLines.length >= 2
}

// mindmap 检测已迁至 mindmap-adapter.isMindmapJSON(与渲染共用 uxrJsonToMarkdown 同一规则,
// 避免"判定命中但渲染为空"的漂移)。detect 不再重复实现 shape 嗅探。

/**
 * 整段判别是否为 HTML —— 保留供单测复用,但 detectCards 主路径不再用它,
 * 改用 scanFencedHtml(支持多 fence + 未闭合 fence,扫所有 text part)。
 */
export function isHTML(text: string): boolean {
  if (/```html\s*\n[\s\S]+?\n?```/i.test(text)) return true
  const stripped = stripCodeFence(text)
  if (/^<!DOCTYPE\s+html/i.test(stripped)) return true
  if (/^<html[\s>]/i.test(stripped)) return true
  if (/^<(div|section|article|main|body)[\s>]/i.test(stripped)) {
    const tagCount = (stripped.match(/<[a-z][^>]*>/gi) ?? []).length
    return tagCount >= 3
  }
  return false
}

export type HtmlFenceBlock = {
  /** fence 内的 HTML 字符串(已剥离 fence 包裹) */
  html: string
  /** 是否已闭合(false = 流式中途,fence 未配对) */
  closed: boolean
  /** 该 fence 来自的 text part 索引(便于联调定位) */
  partIndex: number
}

/**
 * 扫一组 text part 找所有 ```html fence 块,支持:
 *   - 一个 part 内多个闭合 fence → 多个 block
 *   - 最后一个未闭合 fence(流式中途)→ 取到末尾,closed: false
 *   - 跨多个 part 累加
 * 每块要求 ≥50 字符,过滤空 fence。
 *
 * 设计:扫 part 而不是直接判别整段文本,避免"前置说明文字 + 代码块"被整段当 HTML
 * 误传给 HtmlRenderer 渲染失败。详见 output-renderers.md §2.1。
 */
export function scanFencedHtml(parts: Array<{ text?: string }>): HtmlFenceBlock[] {
  const blocks: HtmlFenceBlock[] = []
  for (let i = 0; i < parts.length; i++) {
    const text = parts[i]?.text
    if (typeof text !== "string" || text.length === 0) continue

    // 已闭合 fence:全局匹配,可能多个
    const closedRe = /```html\b\s*\n([\s\S]+?)\n?```/gi
    let m: RegExpExecArray | null
    let lastClosedEnd = 0
    while ((m = closedRe.exec(text)) !== null) {
      const html = m[1]
      if (html.trim().length >= 50) {
        blocks.push({ html, closed: true, partIndex: i })
      }
      lastClosedEnd = closedRe.lastIndex
    }

    // 未闭合 fence:最后一个 ```html 之后无配对 ``` 的内容
    const tail = text.slice(lastClosedEnd)
    const tailMatch = tail.match(/```html\b\s*\n([\s\S]+)$/i)
    if (tailMatch && !tailMatch[1].includes("```")) {
      const html = tailMatch[1]
      if (html.trim().length >= 50) {
        blocks.push({ html, closed: false, partIndex: i })
      }
    }
  }
  return blocks
}
