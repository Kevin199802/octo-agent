import type { OutputCardType } from "../components/insight-turn"

/**
 * resource_link part 在 MCP 协议中的形态。
 * opencode 把 MCP CallToolResult.content[] 转 part 的具体字段路径需联调确认,
 * 本模块按"独立 resource_link part"主路径实现 + defensive 兜底扫 tool part 的 metadata/output。
 */
export type ResourceLink = {
  uri: string
  name: string
  mimeType: string
  description?: string
}

/**
 * 在一组 part 中查找 resource_link。
 * 优先级:
 *   A. 独立 part type === "resource_link"(MCP 协议标准形态)
 *   B. 任意 part 的 metadata.resource_link
 *   C. 任意 tool part 的 metadata.content[] 或 output(JSON string)中含 resource_link 项
 * 联调时打 log 确认实际形态后,可删多余分支。
 */
export function findResourceLink(parts: unknown[]): ResourceLink | null {
  for (const part of parts) {
    const link = readPart(part)
    if (link) return link
  }
  return null
}

function readPart(part: unknown): ResourceLink | null {
  if (!part || typeof part !== "object") return null
  const p = part as Record<string, unknown>

  // A. 独立 resource_link part
  if (p.type === "resource_link" && typeof p.uri === "string" && typeof p.mimeType === "string") {
    return {
      uri: p.uri,
      name: typeof p.name === "string" ? p.name : "",
      mimeType: p.mimeType,
      description: typeof p.description === "string" ? p.description : undefined,
    }
  }

  // B. metadata.resource_link
  const meta = p.metadata as Record<string, unknown> | undefined
  if (meta) {
    const direct = meta.resource_link
    if (direct && typeof direct === "object") {
      const d = direct as Record<string, unknown>
      if (typeof d.uri === "string" && typeof d.mimeType === "string") {
        return {
          uri: d.uri,
          name: typeof d.name === "string" ? d.name : "",
          mimeType: d.mimeType,
          description: typeof d.description === "string" ? d.description : undefined,
        }
      }
    }
    // C1. metadata.content[] 数组中找
    const content = meta.content
    if (Array.isArray(content)) {
      for (const item of content) {
        const link = readPart(item)
        if (link) return link
      }
    }
  }

  // C2. tool part state.output 是 JSON 字符串,parse 后扫 content[]
  if (p.type === "tool") {
    const state = p.state as Record<string, unknown> | undefined
    if (state?.status === "completed" && typeof state.output === "string") {
      try {
        const parsed = JSON.parse(state.output)
        if (parsed && typeof parsed === "object") {
          const c = (parsed as Record<string, unknown>).content
          if (Array.isArray(c)) {
            for (const item of c) {
              const link = readPart(item)
              if (link) return link
            }
          }
        }
      } catch {
        // 非 JSON output,忽略
      }
    }
  }

  return null
}

/**
 * MCP mimeType → OutputCardType 路由。
 * application/json 走 "json" 占位,渲染前 ResultViewer 二次判断是否走 mindmap shape。
 */
export function mimeToOutputType(mimeType: string): OutputCardType {
  if (mimeType === "text/html") return "html"
  if (mimeType === "text/markdown") return "markdown"
  if (mimeType === "application/json") return "json"
  if (mimeType === "text/csv") return "table"
  // pdf / office / image / 其他二进制走 file fallback(下载按钮 / openPath)
  return "file"
}

/**
 * fetch resource URI 文本内容。session 内缓存由 tab-store.cacheContent 承担,本函数仅负责单次 fetch。
 */
export async function fetchResourceText(uri: string): Promise<string> {
  console.log("[octo:resource] fetch start", { uri })
  try {
    const res = await fetch(uri)
    if (!res.ok) {
      console.warn("[octo:resource] fetch failed", { uri, status: res.status, statusText: res.statusText })
      throw new Error(`fetch ${uri}: ${res.status} ${res.statusText}`)
    }
    const text = await res.text()
    console.log("[octo:resource] fetch ok", {
      uri,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bytes: text.length,
    })
    return text
  } catch (err) {
    console.error("[octo:resource] fetch error", { uri, err })
    throw err
  }
}
