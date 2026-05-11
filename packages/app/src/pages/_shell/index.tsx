import { createSignal } from "solid-js"
import type { ParentProps } from "solid-js"
import { OctoSidebar } from "./sidebar"
import { OctoTopbar } from "./topbar"

export function OctoShell(props: ParentProps) {
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
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <OctoSidebar width={sidebarWidth()} />
        {/* sidebar 拖拽句柄 */}
        <div
          style={{
            width: "5px",
            cursor: "col-resize",
            "flex-shrink": "0",
            "align-self": "stretch",
            "z-index": "10",
          }}
          onMouseDown={handleSidebarResize}
        />
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
          {props.children}
        </div>
      </div>
    </div>
  )
}

export function OctoPageShell(props: ParentProps) {
  return (
    <div class="flex flex-col h-dvh overflow-hidden" style={{ background: "#f3f6fb" }}>
      <OctoTopbar />
      <div class="flex-1 min-h-0 overflow-hidden">
        {props.children}
      </div>
    </div>
  )
}
