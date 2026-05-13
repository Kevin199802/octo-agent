import { createMemo, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { ResultTab } from "./tab-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { IllustrationResultEmpty } from "../../icons/illustrations"

// ── 从 markdown 字符串里提取第一个特定语言代码块的内容 ──────────
function extractCodeBlock(text: string, lang: string): string {
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n?```", "i")
  const m = text.match(re)
  return m ? m[1].trim() : text.trim()
}

// ── Mermaid 占位渲染器（Phase 2 将替换为 SVG 渲染） ────────────
function MermaidPlaceholder(props: { content: string }): JSX.Element {
  const code = createMemo(() => extractCodeBlock(props.content, "mermaid"))
  return (
    <div class="p-4 h-full overflow-auto flex flex-col gap-3">
      <div
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
        style={{
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.25)",
          color: "#92400e",
        }}
      >
        <span>⚠️</span>
        <span>Mermaid 图表渲染将在 Phase 2 实现，当前显示源码</span>
      </div>
      <pre
        class="flex-1 text-sm text-[var(--octo-text-primary)] p-4 rounded-lg overflow-auto"
        style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
      >
        {code()}
      </pre>
    </div>
  )
}

// ── JSON 代码块渲染器 ──────────────────────────────────────────
function JsonRenderer(props: { content: string }): JSX.Element {
  const code = createMemo(() => {
    const raw = extractCodeBlock(props.content, "json")
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
                <Switch
                  fallback={
                    <div class="p-4 overflow-auto h-full">
                      <pre class="text-sm text-[var(--octo-text-primary)] whitespace-pre-wrap font-mono">{tab().content}</pre>
                    </div>
                  }
                >
                  <Match when={tab().type === "table"}>
                    <TableRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "markdown"}>
                    <MarkdownRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "mindmap"}>
                    <MermaidPlaceholder content={tab().content} />
                  </Match>
                  <Match when={tab().type === "json"}>
                    <JsonRenderer content={tab().content} />
                  </Match>
                </Switch>
              </div>
            </div>
          )}
        </Show>
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
