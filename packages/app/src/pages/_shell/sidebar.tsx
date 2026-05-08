import type { Session } from "@opencode-ai/sdk/v2/client"
import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transform: props.collapsed ? "rotate(0deg)" : "rotate(90deg)",
        transition: "transform 150ms ease",
        "flex-shrink": "0",
      }}
    >
      <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
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

function SettingsIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2" />
      <path d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.5 3.5L4.5 4.5M11.5 11.5L12.5 12.5M12.5 3.5L11.5 4.5M4.5 11.5L3.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  )
}

const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: SkillIcon },
  { key: "knowledge_base", label: "资产库", Icon: AssetIcon },
] as const

export function OctoSidebar(): JSX.Element {
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

  const activeSessionId = () => {
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  const [insightCollapsed, setInsightCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)

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
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: "240px",
        background: "rgba(255, 252, 255, 0)",
        "backdrop-filter": "blur(4px)",
        "-webkit-backdrop-filter": "blur(4px)",
      }}
    >
      {/* Scrollable: Insight + Make sessions */}
      <div
        class="flex-1 min-h-0 overflow-y-auto px-[12px] py-[4px]"
        style={{ "scrollbar-width": "none" }}
      >
        {/* ─── Octo Insight ─── */}
        <div class="mb-[4px]">
          <div class="flex items-center px-[4px] py-[5px]">
            <button
              type="button"
              onClick={() => setInsightCollapsed((v) => !v)}
              class="flex items-center gap-[4px] flex-1 min-w-0 text-left"
              style={{ color: "rgba(25,25,25,0.4)" }}
            >
              <ChevronRightIcon collapsed={insightCollapsed()} />
              <span
                class="text-[12px] font-semibold select-none"
                style={{ color: "rgba(25,25,25,0.55)" }}
              >
                Octo Insight
              </span>
            </button>
            <button
              type="button"
              onClick={newSession}
              title="新建 Insight 对话"
              class="w-5 h-5 flex items-center justify-center rounded-md transition-colors hover:bg-[rgba(20,118,255,0.08)]"
              style={{ color: "rgba(25,25,25,0.4)" }}
            >
              <PlusIcon />
            </button>
          </div>

          <Show when={!insightCollapsed()}>
            <div class="flex flex-col gap-[1px]">
              <Show
                when={!sessions.loading}
                fallback={
                  <div class="px-[12px] py-[3px] text-[11px]" style={{ color: "rgba(25,25,25,0.3)" }}>
                    加载中…
                  </div>
                }
              >
                <Show
                  when={(sessions() ?? []).length > 0}
                  fallback={
                    <div class="px-[12px] py-[3px] text-[11px]" style={{ color: "rgba(25,25,25,0.3)" }}>
                      暂无对话
                    </div>
                  }
                >
                  <For each={sessions() ?? []}>
                    {(session) => {
                      const isActive = () => activeSessionId() === session.id
                      return (
                        <button
                          type="button"
                          onClick={() => navigate(`/insight/${session.id}`)}
                          classList={{
                            "w-full text-left px-[12px] py-[6px] rounded-[6px] text-[12px] truncate transition-colors": true,
                            "bg-[rgba(20,118,255,0.12)] text-[#0a59f7] font-medium": isActive(),
                            "text-[#191919] hover:bg-[rgba(0,0,0,0.05)]": !isActive(),
                          }}
                        >
                          {session.title || "无标题"}
                        </button>
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>
        </div>

        {/* ─── Octo Make ─── */}
        <div class="mb-[4px]">
          <div class="flex items-center px-[4px] py-[5px]">
            <div
              class="flex items-center gap-[4px] flex-1 min-w-0"
              style={{ color: "rgba(25,25,25,0.4)" }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ "flex-shrink": "0" }}>
                <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span
                class="text-[12px] font-semibold select-none"
                style={{ color: "rgba(25,25,25,0.55)" }}
              >
                Octo Make
              </span>
            </div>
            <button
              type="button"
              title="新建 Make 对话"
              class="w-5 h-5 flex items-center justify-center rounded-md transition-colors hover:bg-[rgba(20,118,255,0.08)]"
              style={{ color: "rgba(25,25,25,0.4)" }}
            >
              <PlusIcon />
            </button>
          </div>
          <div class="px-[12px] py-[3px] text-[11px]" style={{ color: "rgba(25,25,25,0.3)" }}>
            即将上线
          </div>
        </div>
      </div>

      {/* Fixed bottom: 技能库 / 资产库 nav items */}
      <div
        class="shrink-0 flex flex-col gap-[2px] px-[12px] pt-[6px]"
        style={{ "border-top": "1px solid rgba(0,0,0,0.06)" }}
      >
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () => activeNav() === item.key
            return (
              <button
                type="button"
                onClick={() => setActiveNav((v) => (v === item.key ? null : item.key))}
                title={item.label}
                classList={{
                  "w-full relative flex items-center gap-[12px] px-[12px] py-[9px] rounded-[8px] transition-colors text-[14px]": true,
                  "bg-[rgba(239,246,255,0.85)] text-[#0a59f7] font-medium": isActive(),
                  "text-[#191919] hover:bg-[#f2f2f2]": !isActive(),
                }}
              >
                <span class="flex items-center justify-center shrink-0">
                  <item.Icon />
                </span>
                <span class="whitespace-nowrap leading-[22px]">{item.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute right-[4px] top-1/2 rounded-[99px] bg-[#0a59f7]"
                    style={{ height: "32px", width: "4px", transform: "translateY(-50%)" }}
                  />
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      {/* Settings */}
      <div class="shrink-0 px-[12px] py-[8px]">
        <button
          type="button"
          title="设置"
          class="w-full h-9 rounded-[10px] flex items-center gap-2 px-[12px] transition-colors text-[#191919] hover:bg-[#f5f5f5]"
        >
          <SettingsIcon />
          <span class="text-[14px] leading-none">设置</span>
        </button>
      </div>
    </div>
  )
}
