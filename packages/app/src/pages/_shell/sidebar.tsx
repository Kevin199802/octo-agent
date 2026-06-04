import type { JSX } from "solid-js"
import { InsightSessionList } from "@/pages/insight/components/session-list"

/**
 * OctoSidebar —— 宿主 shell 侧栏框架(SPEC-INS-010 后退化为纯壳)
 *
 * 仅摆放 Insight 会话段(自包含组件,内部自取 globalSDK/globalSync)。
 *
 * 顶部项目选择器(D5)与底部导航 技能库/资产库/设置(D7)是产品级共享 chrome,
 * 由 UXAI 封装为 `components/` 组件后我方引用同步——当前**先留空**(原写死版本是历史
 * 遗留,已删)。待共享组件就绪,在此处引用即可。
 *
 * 验收红线:本文件内不应再出现任何 /insight 字面量或 insight 会话逻辑。
 */
export function OctoSidebar(props: { width: number }): JSX.Element {
  return (
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: `${props.width}px`,
        background: "transparent",
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      {/* 顶部:项目选择器(D5,留空待共享组件) */}

      {/* 中部:Insight 会话段 */}
      <div
        class="flex-1 min-h-0 overflow-y-auto px-[12px] py-[6px]"
        style={{ "scrollbar-width": "none" }}
      >
        <InsightSessionList />
      </div>

      {/* 底部:导航 技能库/资产库/设置(D7,留空待共享组件) */}
    </div>
  )
}
