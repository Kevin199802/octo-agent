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
      class="flex items-center overflow-x-auto shrink-0 px-[16px] gap-[8px]"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        "min-height": "48px",
        "scrollbar-width": "none",
      }}
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.id === props.activeId
          return (
            <div
              class="flex items-center gap-[4px] shrink-0 transition-colors px-[12px] py-[6px] cursor-pointer"
              style={{
                "max-width": "240px",
                "border-radius": "16px",
                background: isActive() ? "var(--octo-surface-selected)" : "transparent",
                color: isActive() ? "var(--octo-brand)" : "var(--octo-text-secondary)",
              }}
              onClick={() => props.onActivate(tab.id)}
            >
              <button
                type="button"
                class="flex-1 min-w-0 text-[13px] text-left truncate transition-colors outline-none"
                style={{ "font-weight": isActive() ? "500" : "400" }}
              >
                {tab.title}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onClose(tab.id)
                }}
                class="w-[16px] h-[16px] flex items-center justify-center rounded-full flex-shrink-0 transition-colors hover:bg-black/5 outline-none"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M7.5 2.5L2.5 7.5M2.5 2.5l5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
}
