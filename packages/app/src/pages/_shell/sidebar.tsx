import { createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { InsightSessionList } from "@/pages/insight/components/session-list"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings,
} from "./icons"

const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1 },
] as const

/**
 * OctoSidebar —— 宿主 shell 侧栏框架(SPEC-INS-010 后退化为纯壳)
 *
 * 已不再持有任何 insight 会话逻辑:Insight 会话段抽到 pages/insight/components/session-list,
 * 这里仅 import 摆位。底部导航(技能库/资产库/设置)为产品级 chrome(D7),暂保留现状,
 * 待同事的 SharedSidebar 落地后整体退场(PR3)。
 *
 * 验收红线:本文件内不应再出现任何 /insight 字面量或 insight 会话逻辑。
 */
export function OctoSidebar(props: { width: number }): JSX.Element {
  const [activeNav, setActiveNav] = createSignal<string | null>(null)

  return (
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: `${props.width}px`,
        background: "transparent",
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      {/* Scrollable: Insight 会话列表 */}
      <div
        class="flex-1 min-h-0 overflow-y-auto px-[12px] py-[6px]"
        style={{ "scrollbar-width": "none" }}
      >
        {/* Insight 会话段(自包含组件,内部自取 globalSDK/globalSync) */}
        <InsightSessionList />
      </div>

      {/* Fixed bottom: 技能库 / 资产库 */}
      <div
        class="shrink-0 flex flex-col gap-[2px] px-[8px] pt-[6px]"
        style={{ "border-top": "1px solid var(--octo-border-default, #E5E7EB)" }}
      >
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () => activeNav() === item.key
            return (
              <button
                type="button"
                onClick={() => setActiveNav((v) => (v === item.key ? null : item.key))}
                title={item.label}
                classList={{
                  "w-full relative flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors text-[14px] leading-[22px]": true,
                }}
                style={{
                  height: "36px",
                  background: isActive() ? "var(--octo-surface-selected, #EFF6FF)" : "transparent",
                  color: isActive() ? "var(--octo-brand, #0067D1)" : "var(--octo-text-primary, #191919)",
                  "font-weight": isActive() ? "500" : "400",
                }}
                onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
                onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
              >
                <span class="flex items-center justify-center shrink-0">
                  <Show when={isActive()} fallback={<item.Icon size={16} />}>
                    <item.IconActive size={16} />
                  </Show>
                </span>
                <span class="whitespace-nowrap">{item.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute right-0 top-1/2 rounded-l-[3px]"
                    style={{
                      height: "20px",
                      width: "3px",
                      background: "var(--octo-brand, #0067D1)",
                      transform: "translateY(-50%)",
                    }}
                  />
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      {/* Settings */}
      <div class="shrink-0 px-[8px] py-[8px]">
        <button
          type="button"
          title="设置"
          class="w-full flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors"
          style={{ height: "36px", color: "var(--octo-text-primary, #191919)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        >
          <IconSettings size={16} />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>
    </div>
  )
}
