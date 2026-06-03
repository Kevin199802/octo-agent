import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { PresetPrompt } from "../store/preset-prompts"

type Props = {
  prompts: PresetPrompt[]
  onClick: (preset: PresetPrompt) => void
  disabled?: boolean
}

/**
 * 预置提示词按钮组(spec: docs/specs/ui/insight-prompt-redesign.md §3.1.3)
 * - 横向滚动,溢出时右侧出"→"快速右滚按钮
 * - 点击按钮 = 把 preset.text 填入输入框(由父组件处理)
 */
export function PresetPrompts(props: Props): JSX.Element {
  let scrollRef!: HTMLDivElement
  const [canScrollLeft, setCanScrollLeft] = createSignal(false)
  const [canScrollRight, setCanScrollRight] = createSignal(false)

  const updateScrollState = () => {
    if (!scrollRef) return
    setCanScrollLeft(scrollRef.scrollLeft > 1)
    setCanScrollRight(scrollRef.scrollLeft + scrollRef.clientWidth < scrollRef.scrollWidth - 1)
  }

  const scrollLeft = () => {
    if (!scrollRef) return
    scrollRef.scrollBy({ left: -scrollRef.clientWidth * 0.6, behavior: "smooth" })
  }

  const scrollRight = () => {
    if (!scrollRef) return
    scrollRef.scrollBy({ left: scrollRef.clientWidth * 0.6, behavior: "smooth" })
  }

  onMount(() => {
    updateScrollState()
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(scrollRef)
    onCleanup(() => ro.disconnect())
  })

  return (
    <div class="octo-preset-bar">
      <Show when={canScrollLeft()}>
        <button
          type="button"
          onClick={scrollLeft}
          class="octo-preset-scroll-left"
          aria-label="向左滚动"
        >
          ←
        </button>
      </Show>
      <div
        ref={scrollRef!}
        class="octo-preset-scroll"
        onScroll={updateScrollState}
      >
        <For each={props.prompts}>
          {(preset) => (
            <button
              type="button"
              onClick={() => props.onClick(preset)}
              disabled={props.disabled}
              class="octo-preset-chip"
              title={preset.description ?? preset.text}
            >
              {preset.label}
            </button>
          )}
        </For>
      </div>
      <Show when={canScrollRight()}>
        <button
          type="button"
          onClick={scrollRight}
          class="octo-preset-scroll-right"
          aria-label="向右滚动"
        >
          →
        </button>
      </Show>
    </div>
  )
}
