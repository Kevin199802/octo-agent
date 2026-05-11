import { For } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"

type TabDef = { label: string; href: string }

const TABS: TabDef[] = [
  { label: "Chat", href: "/chat" },
  { label: "Cowork", href: "/insight" },
  { label: "Studio", href: "/studio" },
]

// macOS traffic lights end at x≈80px (x:12 origin + 3 buttons + spacing ≈ 68px)
const TRAFFIC_LIGHT_INSET = 80

function OctoLogoIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M10.0293 0.887569C11.1594 -0.295261 12.9919 -0.296126 14.1221 0.886593L19.8516 6.88366C20.9815 8.06659 20.9807 9.98498 19.8506 11.1678L14.8232 16.4296L17.3926 19.119L21.0771 15.2645L24 18.2206L20.3115 22.0809C18.7533 23.7114 16.1488 23.7107 14.5908 22.08L12 19.368L9.44043 22.0467C7.86502 23.6956 5.2318 23.6955 3.65625 22.0467L0 18.2206L2.92285 15.2655L6.60645 19.12L9.25195 16.3514L4.29883 11.1678C3.16918 9.98489 3.16984 8.0664 4.2998 6.88366L10.0293 0.887569ZM8.02441 9.08679L12.1162 13.371L16.209 9.08679L12.1162 4.80359L8.02441 9.08679Z" fill="url(#topbar-logo-grad)" />
      <defs>
        <linearGradient id="topbar-logo-grad" x1="10.9968" y1="14.3721" x2="19.7973" y2="23.3463" gradientUnits="userSpaceOnUse">
          <stop stop-color="#015DE1" />
          <stop offset="1" stop-color="#64CDF7" />
        </linearGradient>
      </defs>
    </svg>
  )
}

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
        <OctoLogoIcon />
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
            class="absolute top-[3px] bottom-[3px] rounded-[7px] bg-white"
            style={{
              left: "3px",
              width: "calc((100% - 6px) / 3)",
              transform: `translateX(calc(${tabIndex()} * 100%))`,
              "box-shadow": "0 1px 4px rgba(0,0,0,0.14)",
              transition: "transform 200ms cubic-bezier(0.34, 1.2, 0.64, 1)",
            }}
          />
          <For each={TABS}>
            {(tab) => {
              const isActive = () => activeHref() === tab.href
              return (
                <button
                  type="button"
                  onClick={() => navigate(tab.href)}
                  class="relative z-10 flex-1 px-[22px] py-[5px] text-[13px] font-medium leading-none select-none rounded-[7px] transition-colors"
                  style={{ color: isActive() ? "#191919" : "rgba(0,0,0,0.42)" }}
                >
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
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" stroke-width="1.4" />
            <path d="M8.5 8.5L11 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
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
