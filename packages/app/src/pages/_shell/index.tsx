import type { ParentProps } from "solid-js"
import { OctoSidebar } from "./sidebar"
import { OctoTopbar } from "./topbar"

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
