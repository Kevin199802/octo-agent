import { useLocation, useNavigate } from "@solidjs/router"
import { For } from "solid-js"

const TABS = [
  { label: "Chat", href: "/chat" },
  { label: "Cowork", href: "/insight" },
  { label: "Studio", href: "/studio" },
] as const

export function OctoTopbar() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeHref = () => {
    const p = location.pathname
    if (p.startsWith("/chat")) return "/chat"
    if (p.startsWith("/studio")) return "/studio"
    return "/insight"
  }

  return (
    <div class="shrink-0 h-10 flex items-center gap-1 border-b border-border-base bg-background-base" style={{ "-webkit-app-region": "drag" }}>
      {/* macOS 红绿灯占位，约 80px */}
      <div class="shrink-0 w-20" />
      <div class="flex items-center gap-1" style={{ "-webkit-app-region": "no-drag" }}>
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              onClick={() => navigate(tab.href)}
              classList={{
                "px-3 h-7 rounded-md text-13-medium transition-colors": true,
                "text-text-strong bg-background-stronger": activeHref() === tab.href,
                "text-text-weak hover:text-text-base": activeHref() !== tab.href,
              }}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
