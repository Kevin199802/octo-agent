import { createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { PROMPT_TEMPLATES, type PromptTemplateId, type PromptTemplate } from "../store/prompt-template"

type Props = {
  value: PromptTemplateId
  onChange: (id: PromptTemplateId) => void
}

const GROUPS: Array<[string, PromptTemplate[]]> = (() => {
  const map = new Map<string, PromptTemplate[]>()
  for (const t of PROMPT_TEMPLATES) {
    if (!map.has(t.group)) map.set(t.group, [])
    map.get(t.group)!.push(t)
  }
  return [...map.entries()]
})()

export function PromptTemplateSelector(props: Props) {
  const [open, setOpen] = createSignal(false)
  const [l1Pos, setL1Pos] = createSignal<{ bottom: string; left: string } | null>(null)
  const [subPanel, setSubPanel] = createSignal<{ group: string; top: number; left: number } | null>(null)
  let triggerRef!: HTMLButtonElement
  let l1Ref: HTMLDivElement | undefined
  let l2Ref: HTMLDivElement | undefined
  let subTimer: ReturnType<typeof setTimeout> | undefined

  const current = () => PROMPT_TEMPLATES.find((t) => t.id === props.value)!

  const triggerLabel = () => {
    const t = current()
    return t.group === t.label ? t.label : `${t.group} / ${t.label}`
  }

  function clearSubTimer() {
    clearTimeout(subTimer)
  }

  function openL1() {
    const rect = triggerRef.getBoundingClientRect()
    setL1Pos({
      bottom: `${window.innerHeight - rect.top + 6}px`,
      left: `${rect.left}px`,
    })
    setOpen(true)
    setSubPanel(null)
  }

  function close() {
    clearSubTimer()
    setOpen(false)
    setSubPanel(null)
  }

  function toggle() {
    open() ? close() : openL1()
  }

  // L1 项悬浮：分支项立即展开二级，叶子项延迟 150ms 关闭二级
  // 150ms 的窗口让鼠标有时间从 L1 滑向 L2 而不触发关闭
  function handleL1Enter(group: string, templates: PromptTemplate[], el: HTMLButtonElement) {
    clearSubTimer()
    if (templates.length > 1) {
      const rect = el.getBoundingClientRect()
      setSubPanel({ group, top: rect.top, left: rect.right + 4 })
    } else {
      subTimer = setTimeout(() => setSubPanel(null), 150)
    }
  }

  // 进入 L2 时取消关闭计时器
  function handleL2Enter() {
    clearSubTimer()
  }

  // 离开 L2 时延迟关闭（方便重新进入 L1）
  function handleL2Leave() {
    subTimer = setTimeout(() => setSubPanel(null), 150)
  }

  function handleOutside(e: MouseEvent) {
    const target = e.target as Node
    if (
      !triggerRef?.contains(target) &&
      !l1Ref?.contains(target) &&
      !l2Ref?.contains(target)
    ) {
      close()
    }
  }

  onMount(() => document.addEventListener("mousedown", handleOutside))
  onCleanup(() => {
    document.removeEventListener("mousedown", handleOutside)
    clearSubTimer()
  })

  const subTemplates = () => {
    const sp = subPanel()
    if (!sp) return []
    return GROUPS.find(([g]) => g === sp.group)?.[1] ?? []
  }

  return (
    <>
      <button ref={triggerRef} class="template-trigger" onClick={toggle} type="button">
        <span class="template-label">{triggerLabel()}</span>
        <span class="template-chevron">▾</span>
      </button>

      <Show when={open() && l1Pos()}>
        <Portal>
          {/* 一级面板：3 个分组 */}
          <div
            ref={(el) => (l1Ref = el)}
            class="template-dropdown"
            style={{ position: "fixed", bottom: l1Pos()!.bottom, left: l1Pos()!.left }}
          >
            <For each={GROUPS}>
              {([group, templates]) => {
                const isLeaf = templates.length === 1
                const isSelected = () => templates.some((t) => t.id === props.value)
                const isActive = () => subPanel()?.group === group
                return (
                  <button
                    type="button"
                    class="template-option"
                    classList={{ selected: isSelected(), active: isActive() }}
                    onMouseEnter={(e) => handleL1Enter(group, templates, e.currentTarget)}
                    onClick={() => {
                      if (isLeaf) {
                        props.onChange(templates[0].id)
                        close()
                      }
                    }}
                  >
                    <Show when={isSelected()}>
                      <span class="template-check">✓</span>
                    </Show>
                    {group}
                    <Show when={!isLeaf}>
                      <span class="template-sub-arrow">›</span>
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>

          {/* 二级面板：访谈观点洞察的 4 个子项 */}
          <Show when={subPanel()}>
            <div
              ref={(el) => (l2Ref = el)}
              class="template-dropdown"
              style={{
                position: "fixed",
                top: `${subPanel()!.top}px`,
                left: `${subPanel()!.left}px`,
              }}
              onMouseEnter={handleL2Enter}
              onMouseLeave={handleL2Leave}
            >
              <For each={subTemplates()}>
                {(t) => (
                  <button
                    type="button"
                    class="template-option"
                    classList={{ selected: t.id === props.value }}
                    onClick={() => {
                      props.onChange(t.id)
                      close()
                    }}
                  >
                    <Show when={t.id === props.value}>
                      <span class="template-check">✓</span>
                    </Show>
                    {t.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Portal>
      </Show>
    </>
  )
}
