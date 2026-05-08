import type { ParentProps } from "solid-js"
import { OctoSidebar } from "./sidebar"
import { OctoTopbar } from "./topbar"

/** Insight 专用：topbar + sidebar + 内容区 */
export function OctoShell(props: ParentProps) {
  return (
    <div class="flex flex-col h-dvh bg-background-base overflow-hidden">
      <OctoTopbar />
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <OctoSidebar />
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
          {props.children}
        </div>
      </div>
    </div>
  )
}

/** Chat / Studio：仅 topbar，内容区占满剩余高度 */
export function OctoPageShell(props: ParentProps) {
  return (
    <div class="flex flex-col h-dvh bg-background-base overflow-hidden">
      <OctoTopbar />
      <div class="flex-1 min-h-0 overflow-hidden">
        {props.children}
      </div>
    </div>
  )
}
