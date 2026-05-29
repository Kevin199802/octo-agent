import { createEffect, onCleanup, onMount, Show, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { Transformer } from "markmap-lib"
import { Markmap } from "markmap-view"
import { uxrJsonToMarkdown } from "../../utils/mindmap-adapter"

const transformer = new Transformer()

export function MindmapRenderer(props: { content: string }): JSX.Element {
  let wrapperRef: HTMLDivElement | undefined
  let svgRef: SVGSVGElement | undefined
  let instance: Markmap | undefined

  // 解析失败 / shape 不符 → uxrJsonToMarkdown 返回 null。常见场景:
  //   - MCP 返回 business_type:"mindmap" 但实际内容不是 mindmap shape(服务端违反契约)
  //   - LLM 输出的 JSON 嗅探为 mindmap shape 但解析出错(罕见)
  // 兜底:显示友好错误占位 + 提示用户去看原始 JSON tab。详见 output-renderers.md §6.A。
  const markdown = createMemo(() => uxrJsonToMarkdown(props.content))

  function hasSize(): boolean {
    return !!wrapperRef && wrapperRef.clientWidth > 0 && wrapperRef.clientHeight > 0
  }

  // 仅在容器有真实尺寸时创建实例 —— 否则 markmap 按 0 宽算布局会得到 NaN transform
  // (面板按需弹出时以 width:0 挂载,见 SPEC-INS-009 的滑入动画)。容器尺寸由
  // ResizeObserver 兜底:首次拿到尺寸时创建,后续尺寸变化(滑入动画 / 拖拽分隔线)时 fit() 重适配。
  function renderMindmap() {
    const md = markdown()
    if (!svgRef || !md || !hasSize()) return
    instance?.destroy()
    instance = undefined
    try {
      const { root } = transformer.transform(md)
      instance = Markmap.create(svgRef, undefined, root)
    } catch (err) {
      console.error("[octo:mindmap] render failed", { err, mdPreview: md.slice(0, 200) })
    }
  }

  // content 变化 → 重新渲染(容器无尺寸时跳过,等 ResizeObserver 兜底)
  createEffect(() => {
    markdown()
    renderMindmap()
  })

  onMount(() => {
    if (!wrapperRef) return
    const ro = new ResizeObserver(() => {
      if (!hasSize()) return
      if (!instance) renderMindmap()        // 容器首次拿到尺寸 → 创建
      else void instance.fit()              // 尺寸变化 → 重新适配(修正 NaN / 居中)
    })
    ro.observe(wrapperRef)
    onCleanup(() => ro.disconnect())
  })

  onCleanup(() => instance?.destroy())

  return (
    <div ref={wrapperRef} class="w-full h-full overflow-hidden" style={{ background: "white" }}>
      <Show
        when={markdown()}
        fallback={<MindmapFormatError contentPreview={props.content.slice(0, 200)} />}
      >
        <svg ref={svgRef} class="w-full h-full" style={{ display: "block" }} />
      </Show>
    </div>
  )
}

function MindmapFormatError(props: { contentPreview: string }): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-primary)" }}>
        无法渲染为思维导图
      </div>
      <div class="text-xs leading-relaxed" style={{ color: "var(--octo-text-secondary)", "max-width": "360px" }}>
        该文件不符合思维导图数据格式(需要 <code>{"{name, children}"}</code> 嵌套结构)。
        请到旁边的 <strong>JSON tab</strong> 查看原始内容。
      </div>
      <pre
        class="mt-2 text-xs p-2 rounded overflow-auto"
        style={{
          background: "var(--octo-surface-hover)",
          color: "var(--octo-text-disabled)",
          "max-height": "80px",
          "max-width": "360px",
          "font-family": "monospace",
        }}
      >
        {props.contentPreview}{props.contentPreview.length >= 200 ? "…" : ""}
      </pre>
    </div>
  )
}
