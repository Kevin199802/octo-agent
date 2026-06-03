import "../octo-tokens.css"
import { createSignal, For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { TabBar } from "../components/result-viewer/tab-bar"
import type { ResultTab, ResultTabType } from "../components/result-viewer/tab-store"

/**
 * Dev-only 样张:ResultViewer 顶部 TabBar 在「产出 tab 较多」时的横向溢出现状取证。
 *
 * 复现 bug:tab 列表用 overflow-x-auto + scrollbar-width:none(见 tab-bar.tsx),
 * tab 多了能滚但无任何可视提示——没有滚动条、没有左右翻页箭头。
 *
 * 本地无文件上传权限造不出真实产出,故此处纯 mock:用真实 <TabBar> 组件 +
 * 一组假 tab,放进模拟右栏宽度的容器里,直观看到溢出后"看不见也够不到"的 tab。
 *
 * 路由:/_dev/result-tabs(见 dev-routes.tsx)。
 */

// ── mock tab 工厂:覆盖 6 种产出类型,标题长短混合贴近真实文件名 ──────────
const MOCK_TITLES: { title: string; type: ResultTabType }[] = [
  { title: "用户访谈纪要", type: "markdown" },
  { title: "竞品功能对比表", type: "table" },
  { title: "需求优先级思维导图", type: "mindmap" },
  { title: "调研报告 V3 终稿", type: "file" },
  { title: "原始问卷数据.json", type: "json" },
  { title: "落地页交互原型", type: "html" },
  { title: "用户画像与典型场景拆解卡片", type: "markdown" },
  { title: "满意度评分汇总", type: "table" },
  { title: "用户旅程地图", type: "mindmap" },
  { title: "访谈录音转写_第二批.file", type: "file" },
  { title: "埋点字段定义.json", type: "json" },
  { title: "数据看板原型(高保真)", type: "html" },
  { title: "结论与下一步行动建议", type: "markdown" },
  { title: "渠道转化漏斗表", type: "table" },
]

function makeTabs(n: number): ResultTab[] {
  return MOCK_TITLES.slice(0, n).map((m, i) => ({
    id: `mock-${i}`,
    title: m.title,
    type: m.type,
    source: "inline" as const,
    content: "",
    createdAt: new Date(),
  }))
}

// 模拟右栏宽度的画框:让 TabBar 真实溢出。可切换宽度看不同断点。
const FRAME_WIDTHS = [560, 480, 400] as const

export default function ResultTabsDevPage(): JSX.Element {
  const [count, setCount] = createSignal(8)
  const [frameWidth, setFrameWidth] = createSignal<number>(480)
  const [activeId, setActiveId] = createSignal<string | null>("mock-0")
  const [tabs, setTabs] = createSignal<ResultTab[]>(makeTabs(8))

  function regen(n: number) {
    setCount(n)
    setTabs(makeTabs(n))
    setActiveId("mock-0")
  }

  function closeTab(id: string) {
    setTabs((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div
      class="size-full overflow-y-auto"
      style={{
        background: "var(--octo-shell-bg, #f5f6f8)",
        "font-family": "var(--octo-font, system-ui)",
      }}
    >
      <div class="mx-auto" style={{ "max-width": "760px", padding: "40px 24px 80px" }}>
        <A href="/_dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>
          ← Dev 预览索引
        </A>

        <div style={{ "margin-top": "12px", "margin-bottom": "6px", "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)" }}>
          ResultViewer TabBar 溢出现状
        </div>
        <div style={{ "margin-bottom": "24px", "font-size": "13px", "line-height": 1.6, color: "var(--octo-text-secondary)" }}>
          tab 数超过画框宽度后,当前实现(<code>overflow-x-auto</code> + <code>scrollbar-width:none</code>)能横向滚动,
          但<b>没有滚动条、也没有左右翻页箭头</b>——溢出的 tab 既看不见也难够到。请拖动/滚轮横向滑动来确认。
        </div>

        {/* ── 控制区 ───────────────────────────────────── */}
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "16px", "margin-bottom": "20px", "align-items": "center" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)" }}>tab 数</span>
            <For each={[3, 6, 8, 12, 14]}>
              {(n) => (
                <button
                  type="button"
                  onClick={() => regen(n)}
                  style={{
                    "font-size": "12px",
                    padding: "4px 10px",
                    "border-radius": "6px",
                    cursor: "pointer",
                    border: "1px solid var(--octo-border-default, #ddd)",
                    background: count() === n ? "var(--octo-brand, #6b4eff)" : "var(--octo-surface-page, #fff)",
                    color: count() === n ? "#fff" : "var(--octo-text-primary)",
                  }}
                >
                  {n}
                </button>
              )}
            </For>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)" }}>画框宽度</span>
            <For each={FRAME_WIDTHS}>
              {(w) => (
                <button
                  type="button"
                  onClick={() => setFrameWidth(w)}
                  style={{
                    "font-size": "12px",
                    padding: "4px 10px",
                    "border-radius": "6px",
                    cursor: "pointer",
                    border: "1px solid var(--octo-border-default, #ddd)",
                    background: frameWidth() === w ? "var(--octo-brand, #6b4eff)" : "var(--octo-surface-page, #fff)",
                    color: frameWidth() === w ? "#fff" : "var(--octo-text-primary)",
                  }}
                >
                  {w}px
                </button>
              )}
            </For>
          </div>
        </div>

        {/* ── 画框:模拟右栏,真实 TabBar 在此溢出 ──────────── */}
        <div
          style={{
            width: `${frameWidth()}px`,
            "max-width": "100%",
            background: "var(--octo-surface-result, #fff)",
            border: "1px solid var(--octo-border-divider, #eee)",
            "border-radius": "var(--octo-radius-md, 8px)",
            overflow: "hidden",
            "box-shadow": "0 1px 3px rgba(0,0,0,.06)",
          }}
        >
          <TabBar
            tabs={tabs()}
            activeId={activeId()}
            onActivate={setActiveId}
            onClose={closeTab}
            onCollapse={() => { /* 预览:收起按钮仅占位,验证它不随 tab 滚动 */ }}
          />
          <div
            style={{
              height: "120px",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "font-size": "13px",
              color: "var(--octo-text-disabled)",
            }}
          >
            (产出内容区占位)
          </div>
        </div>

        <div style={{ "margin-top": "16px", "font-size": "12px", "line-height": 1.7, color: "var(--octo-text-disabled)" }}>
          画框右端固定的「收起」chevron 不随 tab 滚动(<code>shrink-0</code>),符合预期。
          问题只在 tab 列表本身:溢出无提示。修复方向见 commit <code>7cd3c7a</code>(预置提示词胶囊已补左右箭头)同款思路。
        </div>
      </div>
    </div>
  )
}
