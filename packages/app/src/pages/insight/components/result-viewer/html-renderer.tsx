import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { stripCodeFence } from "../../utils/detect"

export function HtmlRenderer(props: { content: string }): JSX.Element {
  const html = createMemo(() => stripCodeFence(props.content).trim())

  return (
    <Show
      when={html().length > 0}
      fallback={
        <div class="flex items-center justify-center h-32 text-sm text-[#9ca3af]">
          HTML 内容为空
        </div>
      }
    >
      <iframe
        sandbox="allow-scripts"
        srcdoc={html()}
        title="HTML preview"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: "white",
          display: "block",
        }}
      />
    </Show>
  )
}
