import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { ResultTab } from "./tab-store"
import { IconTabClose } from "../../icons"

export function TabBar(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** 收起任务面板(保留 tab,仅隐藏容器);未传则不渲染收起按钮 */
  onCollapse?: () => void
}): JSX.Element {
  return (
    <div
      class="flex items-center shrink-0 px-[16px] gap-[8px]"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        "min-height": "48px",
      }}
    >
      {/* tab 列表横向滚动;收起按钮固定在右侧不随滚动 */}
      <div
        class="flex items-center gap-[8px] overflow-x-auto flex-1 min-w-0"
        style={{ "scrollbar-width": "none" }}
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
                <IconTabClose size={10} />
              </button>
            </div>
          )
        }}
      </For>
      </div>

      <Show when={props.onCollapse}>
        <button
          type="button"
          onClick={() => props.onCollapse?.()}
          title="收起面板"
          aria-label="收起面板"
          class="shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-full transition-colors hover:bg-black/5 active:bg-black/10 outline-none"
          style={{ color: "var(--octo-text-secondary)" }}
        >
          <Icon name="chevron-right" class="size-4" />
        </button>
      </Show>
    </div>
  )
}
