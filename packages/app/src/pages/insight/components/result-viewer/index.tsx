import { createMemo, createResource, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { ResultTab, ResultTabType } from "./tab-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { MindmapRenderer } from "./mindmap-renderer"
import { HtmlRenderer } from "./html-renderer"
import { IllustrationResultEmpty } from "../../icons/illustrations"
import { isMindmapJSON, stripCodeFence } from "../../utils/detect"
import { fetchResourceText } from "../../utils/resource-link"

// ── JSON 渲染器 ────────────────────────────────────────────────
function JsonRenderer(props: { content: string }): JSX.Element {
  const code = createMemo(() => {
    const raw = stripCodeFence(props.content)
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  })
  return (
    <div class="p-4 h-full overflow-auto">
      <pre
        class="text-sm text-[var(--octo-text-primary)] p-4 rounded-lg overflow-auto"
        style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
      >
        {code()}
      </pre>
    </div>
  )
}

// ── Markdown 渲染器（复用上游 <Markdown> 组件） ────────────────
function MarkdownRenderer(props: { content: string }): JSX.Element {
  return (
    <div class="p-4 h-full overflow-auto prose prose-sm max-w-none">
      <Markdown text={props.content} />
    </div>
  )
}

// ── 主容器 ────────────────────────────────────────────────────
export function ResultViewer(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** URI 模式 fetch 完成后回写缓存(含可选的 type 修正,如 json → mindmap shape 二次判断) */
  onCacheContent?: (id: string, content: string, retypeAs?: ResultTabType) => void
}): JSX.Element {
  const activeTab = createMemo(() => props.tabs.find((t) => t.id === props.activeId) ?? null)

  return (
    <div
      class="flex flex-col flex-1 min-w-0 overflow-hidden"
      style={{ background: "var(--octo-surface-result)" }}
    >
      <Show when={props.tabs.length > 0} fallback={<ResultViewerEmpty />}>
        <TabBar
          tabs={props.tabs}
          activeId={props.activeId}
          onActivate={props.onActivate}
          onClose={props.onClose}
        />
        <Show when={activeTab()}>
          {(tab) => (
            <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
              <ActionBar tab={tab()} />
              <div class="flex-1 overflow-hidden">
                <TabBody tab={tab()} onCacheContent={props.onCacheContent} />
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}

// ── Tab 内容容器:按 source 分流(inline 直渲染 / uri 走 fetch + Suspense) ──
function TabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string, retypeAs?: ResultTabType) => void
}): JSX.Element {
  return (
    <Show
      when={props.tab.source === "uri" && !props.tab.content}
      fallback={<TabContent tab={props.tab} />}
    >
      <UriTabBody tab={props.tab} onCacheContent={props.onCacheContent} />
    </Show>
  )
}

// URI 模式 + 未缓存:fetch → 回写 cache → 由父层 Show 自动切到 inline 分支渲染
function UriTabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string, retypeAs?: ResultTabType) => void
}): JSX.Element {
  const [resource, { refetch }] = createResource(
    () => (props.tab.uri ? { id: props.tab.id, uri: props.tab.uri } : null),
    async (src) => {
      const text = await fetchResourceText(src.uri)
      // application/json 二次判断:命中 mindmap shape 则修正 type
      let retypeAs: ResultTabType | undefined
      if (props.tab.type === "json" && isMindmapJSON(text)) retypeAs = "mindmap"
      props.onCacheContent?.(src.id, text, retypeAs)
      return text
    },
  )

  return (
    <Show
      when={!resource.error}
      fallback={
        <ResourceErrorFallback
          tab={props.tab}
          error={resource.error}
          onRetry={() => refetch()}
        />
      }
    >
      <Show when={!resource.loading} fallback={<ResourceLoading />}>
        {/* fetch 成功后 onCacheContent 已把 tab.content 写回,父层 Show 会切到 inline 分支;
            此处兜底:若 onCacheContent 未传(测试场景),直接用 resource() 渲染 */}
        <Show when={!props.onCacheContent}>
          <TabContent tab={{ ...props.tab, content: resource() }} />
        </Show>
      </Show>
    </Show>
  )
}

// 实际内容渲染(content 已就位,inline 或缓存后均走这里)
function TabContent(props: { tab: ResultTab }): JSX.Element {
  const content = () => props.tab.content ?? ""
  return (
    <Switch
      fallback={
        <div class="p-4 overflow-auto h-full">
          <pre class="text-sm text-[var(--octo-text-primary)] whitespace-pre-wrap font-mono">{content()}</pre>
        </div>
      }
    >
      <Match when={props.tab.type === "table"}>
        <TableRenderer content={content()} />
      </Match>
      <Match when={props.tab.type === "markdown"}>
        <MarkdownRenderer content={content()} />
      </Match>
      <Match when={props.tab.type === "mindmap"}>
        <MindmapRenderer content={content()} />
      </Match>
      <Match when={props.tab.type === "html"}>
        <HtmlRenderer content={content()} />
      </Match>
      <Match when={props.tab.type === "json"}>
        <JsonRenderer content={content()} />
      </Match>
      <Match when={props.tab.type === "file"}>
        <FileFallback tab={props.tab} />
      </Match>
    </Switch>
  )
}

function ResourceLoading(): JSX.Element {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>
        正在加载结果…
      </div>
    </div>
  )
}

function ResourceErrorFallback(props: {
  tab: ResultTab
  error: unknown
  onRetry: () => void
}): JSX.Element {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>
        加载失败
      </div>
      <div class="text-xs" style={{ color: "var(--octo-text-disabled)" }}>
        {message()}
      </div>
      <div class="flex gap-2 mt-1">
        <button
          type="button"
          onClick={() => props.onRetry()}
          class="px-3 py-1 text-xs rounded"
          style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
        >
          重试
        </button>
        <Show when={props.tab.uri}>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(props.tab.uri!).catch(console.error)}
            class="px-3 py-1 text-xs rounded"
            style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
          >
            复制链接
          </button>
        </Show>
      </div>
    </div>
  )
}

// 二进制 / 未识别 mimeType:不在内嵌渲染,仅提供下载 / 唤起本地应用入口(详见 ADR-009)
function FileFallback(props: { tab: ResultTab }): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>
        {props.tab.fileName || "文件"}
      </div>
      <div class="text-xs" style={{ color: "var(--octo-text-disabled)" }}>
        {props.tab.mimeType || "未知类型"} · 该格式不在应用内预览
      </div>
      <Show when={props.tab.uri}>
        <a
          href={props.tab.uri}
          target="_blank"
          rel="noreferrer"
          class="px-3 py-1 mt-1 text-xs rounded"
          style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
        >
          打开 / 下载
        </a>
      </Show>
    </div>
  )
}

function ResultViewerEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
      <IllustrationResultEmpty width={80} height={80} />
      <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>对话产出将在这里展示</div>
      <div class="text-[12px]" style={{ color: "var(--octo-text-disabled)" }}>点击左侧输出卡片即可打开</div>
    </div>
  )
}
