import { createEffect, onCleanup, Show, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { Transformer } from "markmap-lib"
import { Markmap } from "markmap-view"
import { uxrJsonToMarkdown } from "../../utils/mindmap-adapter"

const transformer = new Transformer()

export function MindmapRenderer(props: { content: string }): JSX.Element {
  let svgRef: SVGSVGElement | undefined
  let instance: Markmap | undefined

  const markdown = createMemo(() => uxrJsonToMarkdown(props.content))

  createEffect(() => {
    const md = markdown()
    if (!svgRef || !md) return
    instance?.destroy()
    const { root } = transformer.transform(md)
    instance = Markmap.create(svgRef, undefined, root)
  })

  onCleanup(() => instance?.destroy())

  return (
    <div class="w-full h-full overflow-hidden" style={{ background: "white" }}>
      <Show
        when={markdown()}
        fallback={
          <div class="flex items-center justify-center h-32 text-sm text-[#9ca3af]">
            思维导图数据格式异常
          </div>
        }
      >
        <svg ref={svgRef} class="w-full h-full" style={{ display: "block" }} />
      </Show>
    </div>
  )
}
