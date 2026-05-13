import { For, Show } from "solid-js"
import type { Component, JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import {
  OctoLogo, IconSearch,
  IconChat, IconChat1,
  IconCowork, IconCowork1,
  IconStudio, IconStudio1,
} from "./icons"

type TabDef = {
  label: string
  href: string
  Icon: Component<{ size?: number }>
  IconActive: Component<{ size?: number }>
}

const TABS: TabDef[] = [
  { label: "Chat", href: "/chat", Icon: IconChat, IconActive: IconChat1 },
  { label: "Cowork", href: "/insight", Icon: IconCowork, IconActive: IconCowork1 },
  { label: "Studio", href: "/studio", Icon: IconStudio, IconActive: IconStudio1 },
]

// macOS traffic lights end at x≈80px (x:12 origin + 3 buttons + spacing ≈ 68px)
const TRAFFIC_LIGHT_INSET = 80

export function OctoTopbar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const activeHref = () => {
    const p = location.pathname
    if (p.startsWith("/chat")) return "/chat"
    if (p.startsWith("/studio")) return "/studio"
    return "/insight"
  }

  const tabIndex = () => Math.max(0, TABS.findIndex((t) => t.href === activeHref()))

  return (
    <div
      class="h-[56px] shrink-0 flex items-center gap-[16px]"
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        "backdrop-filter": "blur(20px)",
        "-webkit-backdrop-filter": "blur(20px)",
        "border-bottom": "1px solid rgba(0, 0, 0, 0.07)",
        "-webkit-app-region": "drag",
        "padding-left": `${TRAFFIC_LIGHT_INSET}px`,
        "padding-right": "16px",
      }}
    >
      {/* Left: Logo + Brand — starts after traffic lights */}
      <div
        class="flex items-center gap-[8px] shrink-0"
        style={{ "min-width": "160px", "-webkit-app-region": "no-drag" }}
      >
        <OctoLogo size={24} />
        <span class="font-semibold text-[17px] text-[#191919] leading-none select-none">Octo AI</span>
      </div>

      {/* Center: Segmented control */}
      <div
        class="flex-1 flex justify-center"
        style={{ "-webkit-app-region": "no-drag" }}
      >
        <div
          class="relative flex items-center rounded-[10px] p-[3px]"
          style={{ background: "rgba(0, 0, 0, 0.07)" }}
        >
          {/* Sliding pill */}
          <div
            class="absolute top-[3px] bottom-[3px] rounded-[7px]"
            style={{
              background: "#ffffff",
              left: "3px",
              width: "calc((100% - 6px) / 3)",
              transform: `translateX(${tabIndex() * 100}%)`,
              "box-shadow": "0 1px 4px rgba(0,0,0,0.14)",
              transition: "transform 250ms cubic-bezier(0.34, 1.2, 0.64, 1)",
            }}
          />
          <For each={TABS}>
            {(tab) => {
              const isActive = () => activeHref() === tab.href
              return (
                <button
                  type="button"
                  onClick={() => navigate(tab.href)}
                  class="relative z-10 flex-1 px-[18px] py-[5px] text-[13px] font-medium leading-none select-none rounded-[7px] transition-colors flex items-center justify-center gap-[5px]"
                  style={{ color: isActive() ? "var(--octo-brand)" : "rgba(0,0,0,0.42)" }}
                  onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.color = "var(--octo-text-primary)" }}
                  onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.color = "rgba(0,0,0,0.42)" }}
                >
                  <Show when={isActive()} fallback={<tab.Icon size={14} />}>
                    <tab.IconActive size={14} />
                  </Show>
                  {tab.label}
                </button>
              )
            }}
          </For>
        </div>
      </div>

      {/* Right: Search + Avatar placeholders */}
      <div
        class="flex items-center gap-[10px] shrink-0"
        style={{ "min-width": "200px", "justify-content": "flex-end", "-webkit-app-region": "no-drag" }}
      >
        <button
          type="button"
          aria-label="搜索对话和文件"
          class="h-[32px] rounded-[8px] px-[10px] flex items-center gap-[6px] text-[12px]"
          style={{
            background: "rgba(255, 255, 255, 0.50)",
            color: "rgba(0, 0, 0, 0.45)",
            border: "1px solid rgba(0,0,0,0.09)",
          }}
        >
          <IconSearch size={13} />
          <span>搜索对话和文件</span>
        </button>
        <div
          class="w-[28px] h-[28px] rounded-full shrink-0 flex items-center justify-center text-white text-[11px] font-semibold select-none"
          style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}
        >
          U
        </div>
      </div>
    </div>
  )
}
