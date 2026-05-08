import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, onCleanup, Show } from "solid-js"
import { createResource } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

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
      {/* 项目名占位 */}
      <div class="px-3 py-2.5 border-b border-border-base shrink-0">
        <span class="text-13-medium text-text-strong">Octo</span>
      </div>

      <div class="flex-1 overflow-y-auto py-1 min-h-0">
        {/* Octo Insight 区块 */}
        <div class="px-2 pt-2 pb-0.5 flex items-center justify-between">
          <span class="text-11-medium text-text-weak uppercase tracking-wide select-none">Octo Insight</span>
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

        {/* Octo Make 占位 */}
        <div class="px-2 pt-4 pb-0.5">
          <span class="text-11-medium text-text-weak uppercase tracking-wide select-none">Octo Make</span>
        </div>
        <div class="px-3 py-1.5 text-12-regular text-text-weak">即将上线</div>
      </div>

      {/* 底部链接 */}
      <div class="shrink-0 border-t border-border-base py-1 px-1">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-13-regular text-text-weak hover:text-text-base hover:bg-background-base rounded-md transition-colors"
        >
          设置
        </button>
      </div>
    </div>
  )
}
