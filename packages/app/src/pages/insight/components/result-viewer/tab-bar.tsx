import { For } from "solid-js"
import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"

export function TabBar(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
}): JSX.Element {
  return (
    <div
      class="flex items-stretch overflow-x-auto shrink-0"
      style={{
        "border-bottom": "1px solid rgba(0,0,0,0.07)",
        "min-height": "38px",
        "scrollbar-width": "none",
      }}
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.id === props.activeId
          return (
            <div
              class="flex items-center gap-1 shrink-0 border-b-2 transition-colors"
              style={{
                "border-color": isActive() ? "#2563eb" : "transparent",
                "max-width": "180px",
              }}
            >
              <button
                type="button"
                onClick={() => props.onActivate(tab.id)}
                class="flex-1 min-w-0 px-3 py-2 text-xs text-left truncate transition-colors"
                classList={{
                  "text-[#2563eb] font-medium": isActive(),
                  "text-[#6b7280] hover:text-[#374151]": !isActive(),
                }}
              >
                {tab.title}
              </button>
              <button
                type="button"
                onClick={() => props.onClose(tab.id)}
                class="w-5 h-5 flex items-center justify-center rounded mr-1 text-[11px] leading-none flex-shrink-0 transition-colors"
                classList={{
                  "text-[#9ca3af] hover:text-[#374151] hover:bg-[rgba(0,0,0,0.07)]": true,
                }}
              >
                ×
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
}
