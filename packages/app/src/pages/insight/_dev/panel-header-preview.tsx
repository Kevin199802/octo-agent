import "../octo-tokens.css"
import { createSignal } from "solid-js"
import type { JSX } from "solid-js"

/**
 * Dev-only 预览页 — ConversationHeader 布局验证
 *
 * 路由: /_dev/panel-header
 * 目的: 本地复现「产出(N)按钮遮挡三点菜单」bug，验证修复后两者不再重叠。
 *
 * 无法渲染真实 ConversationHeader（依赖 useSync/useSDK），故用同结构的视觉 mock。
 */

/** 与真实 ConversationHeader 结构完全对应的视觉 mock */
function MockHeader(props: {
  title: string
  panelBadge?: JSX.Element
}): JSX.Element {
  return (
    <div
      class="shrink-0 h-12 flex items-center justify-between gap-2 px-4"
      style={{ "border-bottom": "1px solid var(--octo-border-default, #E5E7EB)", background: "var(--octo-surface-page, #fff)" }}
    >
      {/* 左侧：标题 */}
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <h1
          class="text-[14px] font-medium truncate min-w-0 cursor-default"
          style={{ color: "var(--octo-text-primary, #191919)" }}
        >
          {props.title}
        </h1>
      </div>

      {/* 中间插槽：panelBadge（收起时的「产出(N)」按钮） */}
      {props.panelBadge}

      {/* 右侧：三点菜单 mock */}
      <button
        type="button"
        class="size-6 rounded-md flex items-center justify-center shrink-0 text-[16px] leading-none"
        style={{
          color: "var(--octo-text-secondary, #666)",
          border: "1px solid var(--octo-border-divider, #eee)",
          background: "transparent",
          cursor: "pointer",
        }}
        title="三点菜单（重命名 / 删除）— 必须可以点到"
        onClick={() => alert("三点菜单点击成功 ✓")}
      >
        ⋯
      </button>
    </div>
  )
}

/** 产出(N) 按钮（与 index.tsx 真实按钮同样式） */
function PanelBadge(props: { count: number; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title="展开产出面板"
      class="flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium transition-colors"
      style={{
        background: "var(--octo-surface-page, #fff)",
        color: "var(--octo-text-secondary, #555)",
        border: "1px solid var(--octo-border-divider, rgba(0,0,0,0.10))",
        "box-shadow": "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      ‹ 产出 ({props.count})
    </button>
  )
}

export default function PanelHeaderPreviewPage(): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(true)
  const TAB_COUNT = 3

  return (
    <div
      class="size-full overflow-y-auto"
      style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}
    >
      <div class="mx-auto" style={{ "max-width": "800px", padding: "32px 24px 80px" }}>

        <div style={{ "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "4px" }}>
          ConversationHeader 布局验证
        </div>
        <div style={{ "font-size": "13px", color: "var(--octo-text-secondary)", "margin-bottom": "28px" }}>
          复现「产出(N)按钮遮挡三点菜单」bug 并验证修复。点击「⋯」确认可以正常触发。
        </div>

        {/* 切换按钮 */}
        <div style={{ display: "flex", gap: "8px", "margin-bottom": "24px", "align-items": "center" }}>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed())}
            style={{
              padding: "6px 16px",
              background: collapsed() ? "var(--octo-brand, #0067D1)" : "var(--octo-surface-page, #fff)",
              color: collapsed() ? "#fff" : "var(--octo-text-primary)",
              border: "1px solid var(--octo-border-divider, #ddd)",
              "border-radius": "8px",
              "font-size": "13px",
              cursor: "pointer",
            }}
          >
            {collapsed() ? "当前：右侧面板已收起（显示产出badge）" : "当前：右侧面板展开（无badge）"}
          </button>
          <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)" }}>
            点击切换状态
          </span>
        </div>

        {/* ── 场景 1：BUG（绝对定位 absolute top-3 right-3）── */}
        <Section title="场景 1：BUG ✗  — 绝对定位遮挡三点" subtitle="absolute top-3 right-3 z-20：收起态「产出」按钮浮在 header 右上角，盖住三点菜单">
          <div
            class="rounded-[12px] overflow-hidden relative"
            style={{ border: "1px solid rgba(220,38,38,0.3)", background: "var(--octo-surface-page, #fff)", height: "120px" }}
          >
            {/* 中部内容区 */}
            <MockHeader title="用研项目 2024 Q4 访谈分析" />

            {/* BUG：绝对定位浮标盖住三点 */}
            {collapsed() && (
              <button
                type="button"
                style={{
                  position: "absolute",
                  top: "12px",
                  right: "12px",
                  "z-index": 20,
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  padding: "6px 12px",
                  "border-radius": "999px",
                  "font-size": "13px",
                  "font-weight": 500,
                  background: "var(--octo-surface-page, #fff)",
                  color: "var(--octo-text-secondary, #555)",
                  border: "1px solid var(--octo-border-divider, rgba(0,0,0,0.10))",
                  "box-shadow": "0 1px 4px rgba(0,0,0,0.06)",
                  cursor: "pointer",
                }}
              >
                ‹ 产出 ({TAB_COUNT})
              </button>
            )}
            <div class="px-4 pt-3 text-sm" style={{ color: "var(--octo-text-disabled)" }}>
              （消息列表区）
            </div>
          </div>
          <div style={{
            "font-size": "12px", color: "#b91c1c",
            background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.15)",
            "border-radius": "6px", padding: "8px 12px", "margin-top": "8px",
          }}>
            收起时「产出(3)」绝对定位于 top:12px right:12px，与 header 内的 ⋯ 按钮重叠 → 三点不可点击
          </div>
        </Section>

        {/* ── 场景 2：修复（panelBadge 进 header 行）── */}
        <Section title="场景 2：修复 ✓  — badge 进 header flex 行" subtitle="panelBadge 插在 title 和 ⋯ 之间，流式布局，三点始终可点">
          <div
            class="rounded-[12px] overflow-hidden"
            style={{ border: "1px solid rgba(34,197,94,0.35)", background: "var(--octo-surface-page, #fff)", height: "120px" }}
          >
            <MockHeader
              title="用研项目 2024 Q4 访谈分析"
              panelBadge={
                collapsed()
                  ? <PanelBadge count={TAB_COUNT} onClick={() => setCollapsed(false)} />
                  : undefined
              }
            />
            <div class="px-4 pt-3 text-sm" style={{ color: "var(--octo-text-disabled)" }}>
              （消息列表区）
            </div>
          </div>
          <div style={{
            "font-size": "12px", color: "#15803d",
            background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)",
            "border-radius": "6px", padding: "8px 12px", "margin-top": "8px",
          }}>
            「产出(3)」在 header flex 行内，不覆盖任何元素。点击 ⋯ 确认三点菜单正常可触发。
          </div>
        </Section>

        {/* ── 场景 3：长标题 edge case ── */}
        <Section title="场景 3：长标题 edge case" subtitle="标题 min-w-0 + truncate 确保标题被截断而非 badge / 三点被挤出">
          <div
            class="rounded-[12px] overflow-hidden"
            style={{ border: "1px solid var(--octo-border-divider, #eee)", background: "var(--octo-surface-page, #fff)", height: "80px" }}
          >
            <MockHeader
              title="非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的会话标题，用来验证 truncate 是否正确截断"
              panelBadge={
                collapsed()
                  ? <PanelBadge count={TAB_COUNT} onClick={() => setCollapsed(false)} />
                  : undefined
              }
            />
          </div>
          <div style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "margin-top": "6px" }}>
            标题应被截断，「产出」和 ⋯ 必须完整可见
          </div>
        </Section>

      </div>
    </div>
  )
}

function Section(props: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "margin-bottom": "36px" }}>
      <div style={{ "font-size": "15px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "2px" }}>
        {props.title}
      </div>
      <div style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "margin-bottom": "10px" }}>
        {props.subtitle}
      </div>
      {props.children}
    </div>
  )
}
