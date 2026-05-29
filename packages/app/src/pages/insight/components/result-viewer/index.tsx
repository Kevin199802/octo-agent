import { createMemo, createResource, createSignal, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { showToast } from "@opencode-ai/ui/toast"
import type { ResultTab } from "./tab-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { MindmapRenderer } from "./mindmap-renderer"
import { HtmlRenderer } from "./html-renderer"
import { IllustrationResultEmpty } from "../../icons/illustrations"
import { stripCodeFence } from "../../utils/detect"
import { fetchResourceText } from "../../utils/resource-link"
import { getDesktopApi } from "../../lib/electron-api"

// ── JSON 渲染器 ────────────────────────────────────────────────
// 复用上游 <Markdown> 的 shiki 高亮:把 JSON 包成 ```json fence 喂给它,
// 自动获得 syntax highlight + 复制按钮(跟对话区的代码段视觉完全一致)。
// 避免之前 <pre> 纯文本无高亮的体验断层。
function JsonRenderer(props: { content: string }): JSX.Element {
  const fenced = createMemo(() => {
    const raw = stripCodeFence(props.content)
    let pretty = raw
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      // 解析失败保持原样,markdown 仍按 json 语法高亮(shiki 容错)
    }
    return "```json\n" + pretty + "\n```"
  })
  return (
    <div class="p-4 h-full overflow-auto">
      <Markdown text={fenced()} />
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
  /** URI 模式 fetch 完成后回写缓存 */
  onCacheContent?: (id: string, content: string) => void
  /** 收起任务面板(保留 tab,仅隐藏容器);见 SPEC-INS-009 */
  onCollapse?: () => void
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
          onCollapse={props.onCollapse}
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
  onCacheContent?: (id: string, content: string) => void
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

// URI 模式 + 未缓存:fetch → 回写 cache → 由父层 Show 自动切到 inline 分支渲染。
// tab.type 在对话流出卡阶段已由 business_type(优先) / mimeType(兜底)确定(spec: output-renderers.md §2.5.2);
// 此处不再做"application/json 二次判断 retype"——服务端 business_type 显式声明即真理,客户端零嗅探。
function UriTabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string) => void
}): JSX.Element {
  const [resource, { refetch }] = createResource(
    () => (props.tab.uri ? { id: props.tab.id, uri: props.tab.uri } : null),
    async (src) => {
      const text = await fetchResourceText(src.uri)
      props.onCacheContent?.(src.id, text)
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

// 二进制 / 未识别 mimeType:不在内嵌渲染,提供「用本地应用打开 + 下载到本地」双按钮。
// spec: docs/specs/ui/output-renderers.md §6.A,决策: ADR-009。
function FileFallback(props: { tab: ResultTab }): JSX.Element {
  const [openBusy, setOpenBusy] = createSignal(false)
  const [downloadBusy, setDownloadBusy] = createSignal(false)

  function sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "untitled"
  }

  function defaultFilename(): string {
    if (props.tab.fileName) return sanitize(props.tab.fileName)
    if (props.tab.uri) {
      try {
        const u = new URL(props.tab.uri)
        const last = u.pathname.split("/").filter(Boolean).pop()
        if (last) return sanitize(decodeURIComponent(last))
      } catch { /* noop */ }
    }
    return sanitize(props.tab.title || "download")
  }

  async function handleOpenInApp() {
    if (!props.tab.uri || openBusy()) return
    const api = getDesktopApi()
    if (!api || !api.downloadResourceToTemp || !api.openPath || !api.downloadResource || !api.saveFilePicker) {
      showToast({ description: "桌面 API 不可用(非 Electron 环境)", variant: "error" })
      return
    }
    setOpenBusy(true)
    const fname = defaultFilename()
    console.log("[octo:office] download-start", {
      uri: props.tab.uri,
      namespace: props.tab.id,
      filename: fname,
      mime: props.tab.mimeType,
      mode: "to-temp",
    })
    try {
      const localPath = await api.downloadResourceToTemp(props.tab.uri, props.tab.id, fname)
      console.log("[octo:office] download-ok", { localPath })
      console.log("[octo:office] open-path", { localPath })
      // shell.openPath 返回值约定: 空字符串 = 成功,非空 = 错误说明。
      // preload types 声明为 Promise<void>,但实际透传 string;运行时按 string 处理。
      const openResult = (await api.openPath(localPath)) as unknown as string | undefined
      if (typeof openResult === "string" && openResult.length > 0) {
        console.error("[octo:office] open-failed", { localPath, reason: openResult })
        showToast({
          title: "唤起本地应用失败",
          description: "请安装 Excel / WPS 或在系统设置中关联打开方式",
          variant: "error",
        })
      }
    } catch (err) {
      console.error("[octo:office] open-failed", { uri: props.tab.uri, err })
      showToast({
        title: "无法打开文件",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setOpenBusy(false)
    }
  }

  async function handleDownload() {
    if (!props.tab.uri || downloadBusy()) return
    const api = getDesktopApi()
    if (!api || !api.downloadResourceToTemp || !api.openPath || !api.downloadResource || !api.saveFilePicker) {
      showToast({ description: "桌面 API 不可用(非 Electron 环境)", variant: "error" })
      return
    }
    setDownloadBusy(true)
    try {
      const chosen = await api.saveFilePicker({ defaultPath: defaultFilename() })
      if (!chosen) {
        setDownloadBusy(false)
        return
      }
      console.log("[octo:office] download-start", { uri: props.tab.uri, destPath: chosen, mode: "user-save" })
      await api.downloadResource(props.tab.uri, chosen)
      console.log("[octo:office] download-ok", { destPath: chosen })
      showToast({ description: "已下载", variant: "success", duration: 2000 })
    } catch (err) {
      console.error("[octo:office] download-failed", { uri: props.tab.uri, err })
      showToast({
        title: "下载失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setDownloadBusy(false)
    }
  }

  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>
        {props.tab.fileName || "文件"}
      </div>
      <div class="text-xs" style={{ color: "var(--octo-text-disabled)" }}>
        {props.tab.mimeType || "未知类型"} · 该格式不在应用内预览
      </div>
      <Show when={props.tab.uri} fallback={
        <div class="text-xs" style={{ color: "var(--octo-text-disabled)" }}>无远程地址,无法打开 / 下载</div>
      }>
        <div class="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => void handleOpenInApp()}
            disabled={openBusy()}
            class="px-3 py-1 text-xs rounded disabled:opacity-50"
            style={{ border: "1px solid var(--octo-brand)", color: "var(--octo-brand)", background: "var(--octo-surface-page)" }}
          >
            {openBusy() ? "打开中…" : "用本地应用打开"}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloadBusy()}
            class="px-3 py-1 text-xs rounded disabled:opacity-50"
            style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
          >
            {downloadBusy() ? "下载中…" : "下载到本地"}
          </button>
        </div>
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
