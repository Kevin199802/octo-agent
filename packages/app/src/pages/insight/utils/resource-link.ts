import type { OutputCardType } from "../components/insight-turn"

/**
 * resource_link part 在 MCP 协议中的形态。
 * opencode 把 MCP CallToolResult.content[] 转 part 的具体字段路径需联调确认,
 * 本模块按"独立 resource_link part"主路径实现 + defensive 兜底扫 tool part 的 metadata/output。
 */
/**
 * MCP resource_link 解析后的客户端形态。
 * `business_type` 是 octo + UXR 私有扩展字段,标准必填,取值 = 产生该资源的 MCP tool 名。
 * 详见 docs/specs/agents/mcp-contract.md §resource_link 业务类型声明字段 business_type。
 *   - 第一版:"run_usability_analysis" | "run_guide_analysis" | "key_findings" | "mindmap" | "search_reports"
 *   - 客户端路由:`"mindmap"` → 双卡(json + mindmap);其他取值 → 单卡按 mimeType 路由
 *   - 未来加新 tool 时取值自动扩展(无需改类型),客户端按需加渲染分支
 * 类型用 string 而不是 enum 联合:与"取值 = tool 名"哲学一致,服务端扩展零客户端类型变更。
 */
export type ResourceLink = {
  uri: string
  name: string
  mimeType: string
  description?: string
  business_type?: string
}

/**
 * 在一组 part 中查找所有 resource_link(MCP completed 时可能返回 N 个文件,见 mcp-contract.md §completed)。
 * 优先级:
 *   A. 独立 part type === "resource_link"(MCP 协议标准形态)
 *   B. 任意 part 的 metadata.resource_link(单个)
 *   C. 任意 tool part 的 metadata.content[] 或 output(JSON string)中含 resource_link 项(可能多个)
 * 联调时打 log 确认实际形态后,可删多余分支。
 *
 * 返回顺序 = MCP content[] 声明顺序(承载"先摘要、后文件"的语义)。
 */
export function findResourceLinks(parts: unknown[]): ResourceLink[] {
  const out: ResourceLink[] = []
  const branchHits = { A: 0, B: 0, C1: 0, C2: 0 }
  for (const part of parts) {
    out.push(...readPart(part, branchHits))
  }
  if (out.length > 0) {
    console.log("[octo:resource-link] found", {
      count: out.length,
      branches: branchHits,
      mimes: out.map((r) => r.mimeType),
      names: out.map((r) => r.name),
      businessTypes: out.map((r) => r.business_type ?? "(default)"),
    })
  } else if (parts.some((p) => (p as { type?: string } | null)?.type === "resource_link" || (p as { type?: string } | null)?.type === "tool")) {
    // 有 tool/resource_link 类型 part 但没解析出来 — 形态可能跟 spec 假设不一致,打详情供外网定位
    console.log("[octo:resource-link] none-found-but-candidates-present", {
      partsCount: parts.length,
      types: parts.map((p) => (p as { type?: string } | null)?.type),
      sample: parts.find((p) => (p as { type?: string } | null)?.type === "tool"),
    })
  }
  return out
}

/**
 * 从 raw resource_link 对象提取 business_type 字段(MCP 私有扩展,见 mcp-contract.md)。
 * 字段是 MUST(标准必填,取值 = tool 名);客户端做防御性兜底:
 *   - 缺失 / 非 string → 视作 undefined,console warn(服务端违反契约)
 *   - 任意非空 string → 透传(客户端按 if/else 路由,未知值兜底走 mimeType)
 */
function readBusinessType(obj: Record<string, unknown>): string | undefined {
  const v = obj.business_type
  if (typeof v === "string" && v.length > 0) return v
  console.warn("[octo:resource-link] missing-business-type", {
    name: obj.name,
    uri: obj.uri,
    mimeType: obj.mimeType,
  })
  return undefined
}

function readPart(part: unknown, branchHits?: { A: number; B: number; C1: number; C2: number }): ResourceLink[] {
  if (!part || typeof part !== "object") return []
  const p = part as Record<string, unknown>
  const found: ResourceLink[] = []

  // A. 独立 resource_link part
  if (p.type === "resource_link" && typeof p.uri === "string" && typeof p.mimeType === "string") {
    if (branchHits) branchHits.A++
    found.push({
      uri: p.uri,
      name: typeof p.name === "string" ? p.name : "",
      mimeType: p.mimeType,
      description: typeof p.description === "string" ? p.description : undefined,
      business_type: readBusinessType(p),
    })
    return found
  }

  // B. metadata.resource_link(单个)
  const meta = p.metadata as Record<string, unknown> | undefined
  if (meta) {
    const direct = meta.resource_link
    if (direct && typeof direct === "object") {
      const d = direct as Record<string, unknown>
      if (typeof d.uri === "string" && typeof d.mimeType === "string") {
        if (branchHits) branchHits.B++
        found.push({
          uri: d.uri,
          name: typeof d.name === "string" ? d.name : "",
          mimeType: d.mimeType,
          description: typeof d.description === "string" ? d.description : undefined,
          business_type: readBusinessType(d),
        })
      }
    }
    // C1. metadata.content[] 数组中找(可能多个 resource_link 并列)
    const content = meta.content
    if (Array.isArray(content)) {
      for (const item of content) {
        const sub = readPart(item, branchHits)
        if (sub.length > 0 && branchHits) {
          // sub 已经在 A 分支里 ++ 过,但是来源是 C1 路径;这里追加 C1 标记
          branchHits.C1 += sub.length
        }
        found.push(...sub)
      }
    }
  }

  // C2. tool part state.output 是 JSON 字符串,parse 后扫 content[](可能多个)
  if (p.type === "tool") {
    const state = p.state as Record<string, unknown> | undefined
    if (state?.status === "completed" && typeof state.output === "string") {
      try {
        const parsed = JSON.parse(state.output)
        if (parsed && typeof parsed === "object") {
          const c = (parsed as Record<string, unknown>).content
          if (Array.isArray(c)) {
            for (const item of c) {
              const sub = readPart(item, branchHits)
              if (sub.length > 0 && branchHits) {
                branchHits.C2 += sub.length
              }
              found.push(...sub)
            }
          }
        }
      } catch {
        // 非 JSON output,忽略
      }
    }
  }

  return found
}

/**
 * MCP mimeType → OutputCardType 路由。
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
 * resource_link → OutputCardType 统一路由(business_type 优先,mimeType 兜底)。
 * `business_type: "mindmap"` → 单张 mindmap 卡(打开后用 预览/代码 切换看 markmap 或原始 JSON,
 * 见 output-renderers.md §1 视图切换);其余按 mimeType 走通用产物路由。
 * 两条出卡路径(insight-turn 路径 A / index buildOutputCardsFromTask 任务卡)共用本函数,避免漂移。
 */
export function linkToOutputType(link: { business_type?: string; mimeType: string }): OutputCardType {
  if (link.business_type === "mindmap") return "mindmap"
  return mimeToOutputType(link.mimeType)
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
