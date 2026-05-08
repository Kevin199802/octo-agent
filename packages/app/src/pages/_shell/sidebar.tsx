import type { Session } from "@opencode-ai/sdk/v2/client"
import { createResource, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

function SettingsIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.1" />
      <path d="M7 1.5V2.5M7 11.5V12.5M1.5 7H2.5M11.5 7H12.5M3.4 3.4L4.1 4.1M9.9 9.9L10.6 10.6M10.6 3.4L9.9 4.1M4.1 9.9L3.4 10.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  )
}

function SkillIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L9.73 5.27L14 5.27L10.63 7.96L11.74 12.4L8 9.8L4.26 12.4L5.37 7.96L2 5.27L6.27 5.27L8 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
    </svg>
  )
}

function AssetIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 5L8 1.5L14.5 5V11L8 14.5L1.5 11V5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M1.5 5L8 8.5L14.5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      <path d="M8 8.5V14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  )
}

export function OctoSidebar() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()

  const homeDir = () => globalSync.data.path.home

  const [sessions, { refetch }] = createResource(homeDir, async (dir) => {
    if (!dir) return [] as Session[]
    const result = await globalSDK.client.session.list({ directory: dir })
    return ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
  })

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      void refetch()
    }
  })
  onCleanup(unsub)

  const activeId = () => {
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  async function newSession() {
    const dir = homeDir()
    if (!dir) return
    try {
      const result = await globalSDK.client.session.create({ directory: dir })
      const session = result.data as Session | undefined
      if (session) navigate(`/insight/${session.id}`)
    } catch (err) {
      console.error("[OctoSidebar] session.create failed", err)
    }
  }

  return (
    <div class="w-52 shrink-0 flex flex-col border-r border-border-base bg-background-stronger h-full overflow-hidden">

      {/* 品牌标识 */}
      <div class="px-3 py-2.5 border-b border-border-base shrink-0">
        <span class="text-13-medium text-text-strong">Octo</span>
      </div>

      {/* 主滚动区 */}
      <div class="flex-1 overflow-y-auto min-h-0 py-1">

        {/* Octo Insight */}
        <div class="px-3 pt-3 pb-1 flex items-center justify-between">
          <span class="text-12-medium text-text-base select-none">Octo Insight</span>
          <button
            type="button"
            onClick={newSession}
            title="新建会话"
            class="size-5 rounded flex items-center justify-center text-text-weak hover:text-text-base hover:bg-background-base transition-colors text-base leading-none"
          >
            +
          </button>
        </div>

        <Show
          when={!sessions.loading}
          fallback={<div class="px-3 py-1.5 text-12-regular text-text-weak">加载中…</div>}
        >
          <Show
            when={(sessions() ?? []).length > 0}
            fallback={<div class="px-3 py-1.5 text-12-regular text-text-weak">暂无会话</div>}
          >
            <For each={sessions() ?? []}>
              {(session) => (
                <button
                  type="button"
                  onClick={() => navigate(`/insight/${session.id}`)}
                  classList={{
                    "w-full px-3 py-1.5 text-left text-13-regular truncate rounded-md mx-1 max-w-[calc(100%-8px)] transition-colors": true,
                    "bg-background-base text-text-strong": activeId() === session.id,
                    "text-text-base hover:bg-background-base": activeId() !== session.id,
                  }}
                >
                  {session.title || "无标题"}
                </button>
              )}
            </For>
          </Show>
        </Show>

        {/* Octo Make */}
        <div class="px-3 pt-4 pb-1">
          <span class="text-12-medium text-text-base select-none">Octo Make</span>
        </div>
        <div class="px-3 py-1.5 text-12-regular text-text-weak">即将上线</div>
      </div>

      {/* 底部图标导航 */}
      <div class="shrink-0 border-t border-border-base px-2 py-2 flex items-center gap-1">
        <button
          type="button"
          title="技能库"
          class="flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-md text-text-weak hover:text-text-base hover:bg-background-base transition-colors"
        >
          <SkillIcon />
          <span style={{ "font-size": "10px", "line-height": "14px" }} class="select-none">技能库</span>
        </button>
        <button
          type="button"
          title="资产库"
          class="flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-md text-text-weak hover:text-text-base hover:bg-background-base transition-colors"
        >
          <AssetIcon />
          <span style={{ "font-size": "10px", "line-height": "14px" }} class="select-none">资产库</span>
        </button>
      </div>

      {/* 设置 */}
      <div class="shrink-0 border-t border-border-base py-1 px-1">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-13-regular text-text-weak hover:text-text-base hover:bg-background-base rounded-md transition-colors flex items-center gap-2"
        >
          <SettingsIcon />
          设置
        </button>
      </div>
    </div>
  )
}
