import { createSignal } from "solid-js"
import type { OutputCard } from "../insight-turn"

export type ResultTabType = "table" | "mindmap" | "markdown" | "file" | "json" | "html"

/** 视图模式:preview=渲染态(markmap/表格/iframe/markdown),source=原始代码态。仅 toggle 类型有意义 */
export type TabViewMode = "preview" | "source"

// 支持「预览/代码」切换的类型:预览=渲染态,代码=原始源(shiki 高亮)。
// json 本身即源、file 无源,不在其列(单视图)。见 output-renderers.md §1 视图切换。
const TOGGLE_TYPES = new Set<ResultTabType>(["mindmap", "html", "table", "markdown"])
export function isToggleType(type: ResultTabType): boolean {
  return TOGGLE_TYPES.has(type)
}

export type ResultTab = {
  id: string
  title: string
  type: ResultTabType
  source: "inline" | "uri"
  content?: string          // inline 必填;uri 模式下作为 fetch 后的 session 缓存(懒填充)
  uri?: string              // uri 模式必填
  mimeType?: string         // uri 模式必填(影响渲染路由)
  fileName?: string         // uri 模式来自 resource_link.name,供下载默认文件名
  description?: string      // uri 模式来自 resource_link.description,可在 ActionBar 副标题展示
  viewMode?: TabViewMode    // 预览/代码 切换态(缺省视作 "preview");仅 mindmap/html/table/markdown 用
  createdAt: Date
}

export function createTabStore() {
  const [tabs, setTabs] = createSignal<ResultTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  function openTab(card: OutputCard) {
    // 去重优先级(spec: task-card.md §3.5 入口冗余 ≠ tab 重复):
    //   1. (uri, type) 复合命中 → 激活(多入口指向同一产物 + 同一渲染视图)
    //   2. id 命中 → 激活(inline 模式 / 同入口重复点击)
    //   3. 都不命中 → 新建
    // 同一 URI 不同 type 可并存(典型场景:mindmap JSON 文件既可走 json 高亮预览,
    // 也可走 mindmap 思维导图渲染——两个 tab 互不冲突)。
    const current = tabs()
    if (card.uri) {
      const byUriAndType = current.find((t) => t.uri === card.uri && t.type === card.type)
      if (byUriAndType) {
        console.log("[octo:tab] dedupe-by-uri-and-type", {
          existingTabId: byUriAndType.id,
          incomingCardId: card.id,
          uri: card.uri,
          type: card.type,
        })
        setActiveId(byUriAndType.id)
        return
      }
    }
    const byId = current.find((t) => t.id === card.id)
    if (byId) {
      console.log("[octo:tab] dedupe-by-id", { tabId: card.id })
      setActiveId(card.id)
      return
    }
    const tab: ResultTab = {
      id: card.id,
      title: card.title,
      type: card.type,
      source: card.source,
      content: card.content,
      uri: card.uri,
      mimeType: card.mimeType,
      fileName: card.fileName,
      description: card.description,
      createdAt: card.createdAt,
    }
    console.log("[octo:tab] openTab", {
      id: card.id,
      type: card.type,
      source: card.source,
      uri: card.uri,
      title: card.title,
    })
    setTabs((prev) => [...prev, tab])
    setActiveId(card.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const next = prev.filter((t) => t.id !== id)
      if (activeId() === id) {
        setActiveId(next[Math.max(0, idx - 1)]?.id ?? null)
      }
      return next
    })
  }

  function activate(id: string) {
    setActiveId(id)
  }

  function setViewMode(id: string, mode: TabViewMode) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, viewMode: mode } : t)))
  }

  function reset() {
    setTabs([])
    setActiveId(null)
  }

  // URI 模式下 fetch 完成后回写 content。
  // tab.type 在对话流出卡时已由 business_type / mimeType 确定,此处不再修改 type
  // (旧 retypeAs 参数已删除,详见 output-renderers.md §2.5.2 删除二次判断 retype 说明)
  function cacheContent(id: string, content: string) {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content } : t)),
    )
  }

  return { tabs, activeId, activate, openTab, closeTab, reset, cacheContent, setViewMode }
}

export type TabStore = ReturnType<typeof createTabStore>
