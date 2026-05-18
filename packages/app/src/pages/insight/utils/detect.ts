export function tryParseJSON(text: string): any {
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

export function isMindmapJSON(text: string): boolean {
  const raw = stripCodeFence(text)
  if (!raw.startsWith("[") && !raw.startsWith("{")) return false
  const json = tryParseJSON(raw)
  if (!json) return false
  return hasMindmapShape(json)
}

function hasMindmapShape(json: unknown): boolean {
  if (Array.isArray(json)) {
    const first = json[0]
    if (Array.isArray(first)) return hasMindmapShape(first)
    if (first && typeof first === "object") return hasMindmapShape(first)
    return false
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    const hasName = typeof obj.name === "string"
    const hasChildren = Array.isArray(obj.children)
    const hasNodes = Array.isArray(obj.nodes)
    return (hasName && hasChildren) || hasNodes
  }
  return false
}

export function isHTML(text: string): boolean {
  if (/```html\s*\n[\s\S]+?\n?```/i.test(text)) return true
  // strip any code fence (with or without language tag) before pattern matching
  const stripped = stripCodeFence(text)
  if (/^<!DOCTYPE\s+html/i.test(stripped)) return true
  if (/^<html[\s>]/i.test(stripped)) return true
  if (/^<(div|section|article|main|body)[\s>]/i.test(stripped)) {
    const tagCount = (stripped.match(/<[a-z][^>]*>/gi) ?? []).length
    return tagCount >= 3
  }
  return false
}

export function isPlainJSON(text: string): boolean {
  return tryParseJSON(stripCodeFence(text)) !== null
}
