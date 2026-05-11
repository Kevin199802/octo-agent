import { createSignal, Show } from "solid-js"
import type { ParentProps } from "solid-js"
import { OctoSidebar } from "./sidebar"
import { OctoTopbar } from "./topbar"

export function OctoShell(props: ParentProps<{ withSidebar?: boolean }>) {
  const [sidebarWidth, setSidebarWidth] = createSignal(200)

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(360, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div class="flex flex-col h-dvh overflow-hidden" style={{ background: "#f3f6fb" }}>
      <OctoTopbar />
      <div class="flex flex-1 min-h-0 overflow-hidden relative">
        <Show 
          when={props.withSidebar} 
          fallback={<div class="flex-1 min-h-0 overflow-hidden flex flex-col">{props.children}</div>}
        >
          <OctoSidebar width={sidebarWidth()} />
          {/* sidebar 拖拽句柄 */}
          <div
            class="absolute top-0 bottom-0 flex items-center justify-center group"
            style={{
              left: `${sidebarWidth() - 10}px`,
              width: "20px",
              cursor: "col-resize",
              "z-index": "10",
            }}
            onMouseDown={handleSidebarResize}
          >
            <div
              class="absolute left-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
              style={{
                width: "12px",
                height: "36px",
                "border-radius": "0 10px 10px 0",
                "box-shadow": "2px 0 4px rgba(0,0,0,0.04), inset -1px 0 0 rgba(0,0,0,0.02)",
                border: "1px solid var(--octo-border-divider)",
                "border-left": "none",
              }}
            >
              <div
                class="w-[2px] h-[14px] rounded-full ml-[2px]"
                style={{ background: "var(--octo-border-input, #c9c9c9)" }}
              />
            </div>
          </div>
          <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
            {props.children}
          </div>
        </Show>
      </div>
    </div>
  )
}

export function OctoPageShell(props: ParentProps) {
  // Backward compatibility alias just in case
  return <OctoShell withSidebar={false}>{props.children}</OctoShell>
}
