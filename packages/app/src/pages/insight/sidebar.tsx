import { createSignal, type JSX } from "solid-js"
import { InsightSessionList } from "./components/session-list"

/**
 * InsightSidebar —— insight 自带的左侧会话栏(SPEC-INS-010 §11:废弃 _shell 后侧栏归 insight)
 *
 * 自包含:宽度/拖拽/持久化 + 会话列表全在内部,对外零必填参数。insight/index.tsx 直接渲染。
 * 宿主(UXAI 等)挂 insight 时,topbar 在它之上,本组件就是 topbar 以下的左栏。
 *
 * 两个槽(props,默认空)留给宿主注入产品级 chrome:
 *   - top    顶部项目/产品切换器(D5,UXAI 抽共享组件后注入)
 *   - bottom 底部 技能库/资产库/设置(D7,同上)
 * octo-agent 本地不传 → 空着即可。
 */
const WIDTH_KEY = "octo:insight:sidebar-width"

// 初始宽度参考 UX AI make 的侧栏(默认 296);钳制 200–420 给项目切换器/长标题留余量。
const MIN_W = 200
const MAX_W = 420
function initialWidth(): number {
  const stored = localStorage.getItem(WIDTH_KEY)
  if (stored) {
    const n = parseInt(stored, 10)
    if (!isNaN(n) && n >= MIN_W && n <= MAX_W) return n
  }
  return 296
}

export function InsightSidebar(props: { top?: JSX.Element; bottom?: JSX.Element }): JSX.Element {
  const [width, setWidth] = createSignal(initialWidth())

  function handleResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setWidth(Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      localStorage.setItem(WIDTH_KEY, String(width()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div
      class="shrink-0 relative flex flex-col h-full overflow-hidden"
      style={{
        width: `${width()}px`,
        // 蓝色渐变背景:与 make / 其他栏目侧栏一致
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      {/* 顶部槽:项目/产品切换器(D5,留空待宿主注入) */}
      {props.top}

      {/* 会话列表 */}
      <div class="flex-1 min-h-0 overflow-y-auto px-[12px] py-[6px]" style={{ "scrollbar-width": "none" }}>
        <InsightSessionList />
      </div>

      {/* 底部槽:技能库/资产库/设置(D7,留空待宿主注入) */}
      {props.bottom}

      {/* 拖拽手柄:贴右边界 */}
      <div
        class="absolute top-0 bottom-0"
        style={{ right: "-3px", width: "6px", cursor: "col-resize", "z-index": "10" }}
        onMouseDown={handleResize}
      />
    </div>
  )
}
