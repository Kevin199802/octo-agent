import { useLocation, useNavigate } from "@solidjs/router"
import { For } from "solid-js"
import type { JSX } from "solid-js"

type TabDef = { label: string; href: string }

const TABS: TabDef[] = [
  { label: "Chat", href: "/chat" },
  { label: "Cowork", href: "/insight" },
  { label: "Studio", href: "/studio" },
]

function OctoLogoIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="9" fill="#2563EB" />
      <path d="M10 3.5L11.6 8H16.3L12.4 10.7L13.9 15.2L10 12.5L6.1 15.2L7.6 10.7L3.7 8H8.4L10 3.5Z" fill="white" />
    </svg>
  )
}

function ChatIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 1.5C3.74 1.5 1.5 3.38 1.5 5.68c0 1.3.63 2.46 1.64 3.23L2.5 11.5l2.26-1.13c.54.2 1.13.31 1.74.31 2.76 0 5-1.88 5-4.2 0-2.3-2.24-4.18-5-4.18z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
    </svg>
  )
}

function CoworkIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="4.5" cy="5" r="1.9" stroke="currentColor" stroke-width="1.1" />
      <circle cx="8.5" cy="5" r="1.9" stroke="currentColor" stroke-width="1.1" />
      <path d="M1.5 11c0-1.66 1.34-3 3-3h4c1.66 0 3 1.34 3 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  )
}

function StudioIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1.5" y="1.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1" />
      <rect x="7.5" y="1.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1" />
      <rect x="1.5" y="7.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1" />
      <rect x="7.5" y="7.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1" />
    </svg>
  )
}

const TAB_ICONS: Record<string, () => JSX.Element> = {
  Chat: ChatIcon,
  Cowork: CoworkIcon,
  Studio: StudioIcon,
}

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
    <div
      class="shrink-0 h-10 flex items-center border-b border-border-base bg-background-base"
      style={{ "-webkit-app-region": "drag" }}
    >
      {/* macOS 红绿灯占位 */}
      <div class="shrink-0 w-20" />

      {/* Logo */}
      <div class="flex items-center gap-2 mr-6" style={{ "-webkit-app-region": "no-drag" }}>
        <OctoLogoIcon />
        <span class="text-13-medium text-text-strong select-none">Octo AI</span>
      </div>

      {/* Tabs */}
      <div class="flex items-center gap-0.5 flex-1 justify-center" style={{ "-webkit-app-region": "no-drag" }}>
        <For each={TABS}>
          {(tab) => {
            const Icon = TAB_ICONS[tab.label]
            const isActive = () => activeHref() === tab.href
            return (
              <button
                type="button"
                onClick={() => navigate(tab.href)}
                classList={{
                  "px-3 h-7 rounded-md text-13-medium transition-colors flex items-center gap-1.5 select-none": true,
                  "text-white bg-blue-600": isActive(),
                  "text-text-weak hover:text-text-base hover:bg-background-stronger": !isActive(),
                }}
              >
                <Icon />
                {tab.label}
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}
