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

  // 解析失败 / shape 不符 → uxrJsonToMarkdown 返回 null。
  // 正常流程下 ResultViewer 已用 isMindmapJSON 预校验、内容违约时降级为代码视图,
  // 故此处是组件自身的防御兜底(常态不触达),仅显示一行「无法渲染为思维导图」占位。
  // 详见 output-renderers.md §2.5.2 路径 A 内容违约兜底。
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
        fallback={<MindmapFormatError />}
      >
        <svg ref={svgRef} class="w-full h-full" style={{ display: "block" }} />
      </Show>
    </div>
  )
}

function MindmapFormatError(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-primary)" }}>
        无法渲染为思维导图
      </div>
      <div class="text-xs leading-relaxed" style={{ color: "var(--octo-text-secondary)", "max-width": "360px" }}>
        该文件不符合思维导图数据格式(需要 <code>{"{name, children}"}</code> 嵌套结构)。
      </div>
    </div>
  )
}
