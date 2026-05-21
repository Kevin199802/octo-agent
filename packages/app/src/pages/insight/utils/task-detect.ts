import { findResourceLinks, type ResourceLink } from "./resource-link"

/**
 * 长任务卡片状态。来源:mcp-contract.md §任务管理 status 枚举。
 * 不识别 / 异常状态归为 failed(避免卡片卡在 processing),原 status 在 message 字段保留。
 */
export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "stopped"

const KNOWN_STATUSES = new Set<TaskStatus>(["pending", "processing", "completed", "failed", "stopped"])

export type TaskInfo = {
  taskId: string
  toolName: string                  // MCP 工具名(opencode part.tool),如 "key_findings" / "get_task_result"
  status: TaskStatus
  message?: string                  // structuredContent.message(可能为空)
  resultText?: string               // completed 时 content[].text 摘要
  resourceLinks: ResourceLink[]     // completed 时 N 个 resource_link(0~N,见 mcp-contract.md §completed)
}

/**
 * 从单个 part 中读取 task 信息(structuredContent.task_id 必须存在)。
 * defensive 多分支:opencode 把 MCP structuredContent 暴露到 Part 的字段路径需联调实证,
 * 这里同时尝试 metadata 平铺 / metadata.structuredContent / output JSON 三种形态。
 * 联调后可删多余分支。
 */
export function readTaskInfo(part: unknown): TaskInfo | null {
  if (!part || typeof part !== "object") return null
  const p = part as Record<string, unknown>
  if (p.type !== "tool") return null

  const toolName = typeof p.tool === "string" ? p.tool : "unknown"
  const state = p.state as Record<string, unknown> | undefined
  if (!state) return null

  // 仅 completed 态的 tool 调用才会带 structuredContent(running/pending 没有 output)
  if (state.status !== "completed") return null

  const sc = readStructuredContent(state)
  if (!sc?.task_id) return null

  const rawStatus = typeof sc.status === "string" ? sc.status : "processing"
  const status: TaskStatus = KNOWN_STATUSES.has(rawStatus as TaskStatus)
    ? (rawStatus as TaskStatus)
    : "failed"
  const message =
    typeof sc.message === "string" && sc.message.length > 0
      ? sc.message
      : status === "failed" && !KNOWN_STATUSES.has(rawStatus as TaskStatus)
        ? `未知状态:${rawStatus}`
        : undefined

  // resultText:completed 时 content[] 里第一条 text part
  let resultText: string | undefined
  let resourceLinks: ResourceLink[] = []
  if (status === "completed") {
    const parsed = parseCallToolResult(state)
    if (parsed) {
      const textItem = parsed.content?.find(
        (c) => c && typeof c === "object" && (c as { type?: string }).type === "text",
      ) as { text?: string } | undefined
      if (textItem && typeof textItem.text === "string") resultText = textItem.text
      // resource_link 复用 §2.5 的扫描(支持独立 part / metadata / output JSON);可能 N 个
      if (parsed.content) {
        resourceLinks = findResourceLinks(parsed.content)
      }
    }
    // 兜底:从 part 本身扫 resource_link(部分形态下 link 已被 opencode 提到 part 旁)
    if (resourceLinks.length === 0) {
      resourceLinks = findResourceLinks([part])
    }
  }

  return { taskId: String(sc.task_id), toolName, status, message, resultText, resourceLinks }
}

/**
 * 读取 structuredContent。尝试位置:
 *   A. state.metadata.structuredContent
 *   B. state.metadata 平铺(task_id / status 直接在 metadata 上)
 *   C. state.output JSON.parse 后取 structuredContent
 */
function readStructuredContent(state: Record<string, unknown>): Record<string, unknown> | null {
  const meta = state.metadata as Record<string, unknown> | undefined
  if (meta) {
    const nested = meta.structuredContent
    if (nested && typeof nested === "object") return nested as Record<string, unknown>
    if (typeof meta.task_id === "string") return meta
  }
  const parsed = parseCallToolResult(state)
  if (parsed?.structuredContent && typeof parsed.structuredContent === "object") {
    return parsed.structuredContent as Record<string, unknown>
  }
  return null
}

type ParsedCallToolResult = {
  content?: unknown[]
  structuredContent?: unknown
  isError?: boolean
}

function parseCallToolResult(state: Record<string, unknown>): ParsedCallToolResult | null {
  if (typeof state.output !== "string") return null
  try {
    const parsed = JSON.parse(state.output)
    if (parsed && typeof parsed === "object") return parsed as ParsedCallToolResult
  } catch {
    // output 不是 JSON,可能是被 AI SDK 转成 LLM-friendly 纯文本,无法在客户端结构化解析
  }
  return null
}

// ── 跨 turn 聚合 ────────────────────────────────────────────

export type TaskCardEntry = {
  taskId: string
  status: TaskStatus
  message?: string
  toolName: string                  // 首次提交时的业务工具名(非 get_task_result)
  anchorUserMessageID: string       // 卡片渲染在该 user message 之后
  submittedAt: Date                 // 最早 part 时间
  lastUpdatedAt: Date               // 最新 part 时间
  resultText?: string               // completed 时的摘要
  resourceLinks: ResourceLink[]     // completed 时的 N 个资源链接(0~N)
}

// 业务工具白名单:用于识别"首次提交"(从而决定 anchor toolName)。
// get_task_result / stop_task 等任务管理工具不算"首次提交"。
const BUSINESS_TOOLS = new Set([
  "key_findings",
  "run_guide_analysis",
  "run_usability_analysis",
  "mindmap",
])

function isBusinessTool(name: string): boolean {
  // opencode MCP 工具名可能带前缀(`mcp:tool` / `clientName_tool`),做包含匹配
  for (const biz of BUSINESS_TOOLS) {
    if (name === biz || name.endsWith(`:${biz}`) || name.endsWith(`_${biz}`)) return true
  }
  return false
}

type AggregateInput = {
  taskId: string
  status: TaskStatus
  message?: string
  toolName: string
  resultText?: string
  resourceLinks: ResourceLink[]
  userMsgID: string
  time: number
}

/**
 * 把"逐 part 读出的 TaskInfo 数组"聚合为按 taskId 分组的卡片实体。
 *   - anchor = 该 taskId 最早 part 的 userMsgID
 *   - status / message / resultText / resourceLink 取最新 part 的值
 *   - toolName 优先取业务工具(避免被 get_task_result 覆盖)
 */
export function aggregateTaskCards(items: AggregateInput[]): Map<string, TaskCardEntry> {
  const grouped = new Map<string, AggregateInput[]>()
  for (const item of items) {
    const arr = grouped.get(item.taskId) ?? []
    arr.push(item)
    grouped.set(item.taskId, arr)
  }

  const result = new Map<string, TaskCardEntry>()
  for (const [taskId, group] of grouped) {
    group.sort((a, b) => a.time - b.time)
    const first = group[0]
    const latest = group[group.length - 1]
    const businessItem = group.find((g) => isBusinessTool(g.toolName))
    result.set(taskId, {
      taskId,
      status: latest.status,
      message: latest.message,
      toolName: businessItem?.toolName ?? first.toolName,
      anchorUserMessageID: first.userMsgID,
      submittedAt: new Date(first.time),
      lastUpdatedAt: new Date(latest.time),
      resultText: latest.resultText,
      resourceLinks: latest.resourceLinks,
    })
  }
  return result
}

// ── 工具名 → 中文展示 ────────────────────────────────────────

const TOOL_DISPLAY_NAME: Record<string, string> = {
  key_findings: "观点解析",
  run_guide_analysis: "按提纲聚类",
  run_usability_analysis: "可用性测试分析",
  mindmap: "思维导图",
}

export function toolDisplayName(toolName: string): string {
  // 提取 bare name(去掉前缀)
  const bare = toolName.includes(":") ? toolName.split(":").pop()! : toolName
  return TOOL_DISPLAY_NAME[bare] ?? bare
}
