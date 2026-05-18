import { stripCodeFence, tryParseJSON } from "./detect"

type MindmapNode = { name?: string; children?: MindmapNode[] }

export function uxrJsonToMarkdown(text: string): string | null {
  const json = tryParseJSON(stripCodeFence(text))
  if (json == null) return null

  const roots = collectRoots(json)
  if (roots.length === 0) return null

  return roots.map((node) => renderNode(node, 0)).join("\n")
}

function collectRoots(json: unknown): MindmapNode[] {
  if (Array.isArray(json)) {
    return json.flatMap((item) => collectRoots(item))
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    if (Array.isArray(obj.nodes)) {
      return obj.nodes.flatMap((n) => collectRoots(n))
    }
    if (typeof obj.name === "string" || Array.isArray(obj.children)) {
      return [obj as MindmapNode]
    }
  }
  return []
}

function renderNode(node: MindmapNode, depth: number): string {
  const name = (node.name ?? "(空)").trim() || "(空)"
  const prefix = depth === 0 ? "# " : "  ".repeat(depth - 1) + "- "
  const line = prefix + name
  const children = Array.isArray(node.children) ? node.children : []
  const childLines = children.map((c) => renderNode(c, depth + 1))
  return [line, ...childLines].join("\n")
}
