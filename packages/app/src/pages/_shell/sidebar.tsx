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
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
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

// 判断 session 标题是否还在生成中（仍是默认占位标题）
function isTitlePending(title: string): boolean {
  return /^New session/.test(title)
}

export function OctoSidebar(props: { width: number }): JSX.Element {
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

  function newSession() {
    navigate("/insight")
  }

  return (
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: `${props.width}px`,
        background: "transparent",
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      {/* Scrollable: Insight + Make sessions */}
      <div
        class="flex-1 min-h-0 overflow-y-auto px-[12px] py-[6px]"
        style={{ "scrollbar-width": "none" }}
      >
        {/* ─── Octo Insight ─── */}
        <div class="mb-[2px]">
          {/* 分组标题行 */}
          <div class="flex items-center h-[32px] px-[4px]">
            <button
              type="button"
              onClick={() => setInsightCollapsed((v) => !v)}
              class="flex items-center gap-[4px] flex-1 min-w-0 text-left"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
            >
              <ChevronRightIcon collapsed={insightCollapsed()} />
              <span
                class="text-[12px] font-medium select-none leading-[20px]"
                style={{ color: "var(--octo-text-tertiary, #364153)" }}
              >
                Octo Insight
              </span>
            </button>
            <button
              type="button"
              onClick={newSession}
              title="新建 Insight 对话"
              class="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-brand-a8, rgba(0,103,209,0.08))"; e.currentTarget.style.color = "var(--octo-brand, #0067D1)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--octo-text-secondary, #777777)" }}
            >
              <PlusIcon />
            </button>
          </div>

          <Show when={!insightCollapsed()}>
            <div class="flex flex-col gap-[1px]">
              <Show
                when={!sessions.loading}
                fallback={
                  <div class="px-[8px] py-[6px]">
                    <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                  </div>
                }
              >
                <Show
                  when={(sessions() ?? []).length > 0}
                  fallback={
                    <div class="px-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                      暂无对话
                    </div>
                  }
                >
                  <For each={sessions() ?? []}>
                    {(session) => {
                      const isActive = () => activeSessionId() === session.id
                      const pending = () => isTitlePending(session.title)
                      return (
                        <button
                          type="button"
                          onClick={() => navigate(`/insight/${session.id}`)}
                          classList={{
                            "w-full text-left px-[8px] rounded-[4px] text-[12px] leading-[20px] transition-colors flex items-center relative": true,
                          }}
                          style={{
                            height: "32px",
                            background: isActive() ? "var(--octo-surface-selected, #EFF6FF)" : "transparent",
                            color: isActive() ? "var(--octo-brand, #0067D1)" : "var(--octo-text-primary, #191919)",
                            "font-weight": isActive() ? "500" : "400",
                          }}
                          onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
                          onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
                        >
                          <Show when={isActive()}>
                            <span
                              class="absolute left-0 top-1/2 rounded-r-[3px]"
                              style={{
                                height: "16px",
                                width: "3px",
                                background: "var(--octo-brand, #0067D1)",
                                transform: "translateY(-50%)",
                              }}
                            />
                          </Show>
                          <Show
                            when={pending()}
                            fallback={<span class="truncate block w-full">{session.title || "无标题"}</span>}
                          >
                            {/* 标题生成中：骨架动效 */}
                            <span
                              class="inline-block rounded-[3px] animate-pulse"
                              style={{
                                width: "72px",
                                height: "10px",
                                background: isActive() ? "var(--octo-brand-a20, rgba(0,103,209,0.2))" : "rgba(0,0,0,0.1)",
                              }}
                            />
                          </Show>
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
        <div class="mb-[2px]">
          <div class="flex items-center h-[32px] px-[4px]">
            <div
              class="flex items-center gap-[4px] flex-1 min-w-0"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ "flex-shrink": "0" }}>
                <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span
                class="text-[12px] font-medium select-none leading-[20px]"
                style={{ color: "var(--octo-text-tertiary, #364153)" }}
              >
                Octo Make
              </span>
            </div>
            <button
              type="button"
              title="新建 Make 对话"
              class="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-brand-a8, rgba(0,103,209,0.08))"; e.currentTarget.style.color = "var(--octo-brand, #0067D1)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--octo-text-secondary, #777777)" }}
            >
              <PlusIcon />
            </button>
          </div>
          <div class="px-[8px] py-[2px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
            即将上线
          </div>
        </div>
      </div>

      {/* Fixed bottom: 技能库 / 资产库 */}
      <div
        class="shrink-0 flex flex-col gap-[2px] px-[8px] pt-[6px]"
        style={{ "border-top": "1px solid var(--octo-border-default, #E5E7EB)" }}
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
                  "w-full relative flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors text-[14px] leading-[22px]": true,
                }}
                style={{
                  height: "36px",
                  background: isActive() ? "var(--octo-surface-selected, #EFF6FF)" : "transparent",
                  color: isActive() ? "var(--octo-brand, #0067D1)" : "var(--octo-text-primary, #191919)",
                  "font-weight": isActive() ? "500" : "400",
                }}
                onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
                onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
              >
                <span class="flex items-center justify-center shrink-0">
                  <item.Icon />
                </span>
                <span class="whitespace-nowrap">{item.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute right-0 top-1/2 rounded-l-[3px]"
                    style={{
                      height: "20px",
                      width: "3px",
                      background: "var(--octo-brand, #0067D1)",
                      transform: "translateY(-50%)",
                    }}
                  />
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      {/* Settings */}
      <div class="shrink-0 px-[8px] py-[8px]">
        <button
          type="button"
          title="设置"
          class="w-full flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors"
          style={{ height: "36px", color: "var(--octo-text-primary, #191919)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        >
          <SettingsIcon />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>
    </div>
  )
}
