import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings, IconSettings1,
} from "./icons"

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
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

const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1 },
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

  // ── 右键上下文菜单 ──────────────────────────────────────────
  const [contextMenu, setContextMenu] = createSignal<{ id: string; x: number; y: number } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")

  // Esc 关菜单
  createEffect(() => {
    if (!contextMenu()) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeContextMenu() }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })

  function closeContextMenu() {
    setContextMenu(null)
    setConfirmDeleteId(null)
  }

  function openRename(sessionId: string) {
    closeContextMenu()
    const session = sessions()?.find((s) => s.id === sessionId)
    const raw = session?.title ?? ""
    setRenameDraft(/^New session/.test(raw) ? "" : raw)
    setRenamingId(sessionId)
  }

  async function handleRenameConfirm(sessionId: string) {
    const next = renameDraft().trim()
    setRenamingId(null)
    if (!next) return
    try {
      await globalSDK.client.session.update({ sessionID: sessionId, title: next })
    } catch (err) {
      console.error("[sidebar] rename failed", err)
    }
  }

  async function handleDelete(sessionId: string) {
    closeContextMenu()
    try {
      await globalSDK.client.session.delete({ sessionID: sessionId })
      if (activeSessionId() === sessionId) navigate("/insight")
    } catch (err) {
      console.error("[sidebar] delete failed", err)
    }
  }

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
                        <Show
                          when={renamingId() === session.id}
                          fallback={
                            <button
                              type="button"
                              onClick={() => navigate(`/insight/${session.id}`)}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setConfirmDeleteId(null)
                                setContextMenu({ id: session.id, x: e.clientX, y: e.clientY })
                              }}
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
                          }
                        >
                          {/* 内联重命名输入框 */}
                          <div
                            class="w-full px-[8px] rounded-[4px] flex items-center"
                            style={{
                              height: "32px",
                              background: "var(--octo-surface-selected, #EFF6FF)",
                            }}
                          >
                            <input
                              type="text"
                              value={renameDraft()}
                              onInput={(e) => setRenameDraft(e.currentTarget.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === "Enter") { e.preventDefault(); void handleRenameConfirm(session.id) }
                                if (e.key === "Escape") { e.preventDefault(); setRenamingId(null) }
                              }}
                              onBlur={() => void handleRenameConfirm(session.id)}
                              ref={(el) => requestAnimationFrame(() => { el.focus(); el.select() })}
                              class="w-full bg-transparent text-[12px] outline-none"
                              style={{
                                color: "var(--octo-brand, #0067D1)",
                                "font-weight": "500",
                                border: "none",
                              }}
                            />
                          </div>
                        </Show>
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
                  <Show when={isActive()} fallback={<item.Icon size={16} />}>
                    <item.IconActive size={16} />
                  </Show>
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
          <IconSettings size={16} />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>

      {/* ── 右键上下文菜单 ───────────────────────────────────── */}
      <Show when={contextMenu()}>
        {(menu) => (
          <>
            {/* 全屏透明遮罩，点击关闭菜单 */}
            <div
              style={{ position: "fixed", inset: "0", "z-index": "9998" }}
              onClick={closeContextMenu}
              onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }}
            />
            <div
              style={{
                position: "fixed",
                top: `${menu().y}px`,
                left: `${menu().x}px`,
                "z-index": "9999",
                background: "var(--octo-surface-page, #fff)",
                border: "1px solid var(--octo-border-default, #E5E7EB)",
                "border-radius": "6px",
                "box-shadow": "0 4px 16px rgba(0,0,0,0.10)",
                padding: "4px",
                "min-width": "128px",
              }}
            >
              <Show
                when={confirmDeleteId() === menu().id}
                fallback={
                  <>
                    <button
                      type="button"
                      onClick={() => openRename(menu().id)}
                      class="w-full text-left px-[10px] py-[6px] text-[12px] rounded-[4px] transition-colors"
                      style={{ color: "var(--octo-text-primary, #191919)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "" }}
                    >
                      重命名
                    </button>
                    <div style={{ height: "1px", background: "var(--octo-border-default, #E5E7EB)", margin: "2px 0" }} />
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(menu().id)}
                      class="w-full text-left px-[10px] py-[6px] text-[12px] rounded-[4px] transition-colors"
                      style={{ color: "var(--octo-danger, #DC2626)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(220,38,38,0.06)" }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "" }}
                    >
                      删除
                    </button>
                  </>
                }
              >
                {/* 二次确认态 */}
                <div class="px-[10px] py-[6px] text-[12px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                  确认删除？
                </div>
                <div class="flex gap-[4px] px-[6px] pb-[4px]">
                  <button
                    type="button"
                    onClick={() => void handleDelete(menu().id)}
                    class="flex-1 px-[8px] py-[4px] text-[12px] rounded-[4px] transition-colors"
                    style={{
                      background: "var(--octo-danger, #DC2626)",
                      color: "#fff",
                    }}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={closeContextMenu}
                    class="flex-1 px-[8px] py-[4px] text-[12px] rounded-[4px] transition-colors"
                    style={{
                      background: "var(--octo-surface-hover, #F5F5F5)",
                      color: "var(--octo-text-primary, #191919)",
                    }}
                  >
                    取消
                  </button>
                </div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
