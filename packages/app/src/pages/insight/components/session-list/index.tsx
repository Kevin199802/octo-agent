import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { sessionTitle } from "@/utils/session-title"
import { Spinner } from "@opencode-ai/ui/spinner"

/**
 * InsightSessionList —— Insight 会话段(SPEC-INS-010 §11.3 / D11)
 *
 * 与 UX AI 会话列表 1:1:新建行 + 状态点(工作中 Spinner / 待处理权限 / 错误 / 未读),
 * 由同源 opencode 子系统驱动(globalSync.child / notification / permission)——这些 context
 * API 两仓**同名同签**(核对见 §11.3),故无需 lib 适配层,真 1:1。
 *
 * 与 UX AI 的两处**有意差异**(经 spec 锁定):
 *  - 新建 = 懒创建跳空页(D4),不 eager session.create
 *  - agent 过滤用优雅降级 `!s.agent || s.agent === "octo_insight"`(§10.4):外网 server 不返回
 *    agent → 列全部;内网带 agent → 精确匹配。同一份源码 rsync 两边都正确。
 *
 * 自包含、对外零参数:globalSDK / globalSync / notification / permission 自取
 * (均在 AppBaseProviders 全局层,搬出后照样拿得到)。宿主 shell 仅 import 摆位。
 */

const AGENT = "octo_insight" // 与发送链路 index.tsx:475 的 agent 名一致

// 折叠箭头:与 UXAI 1:1(向下箭头,展开 0deg / 收起 -90deg)
function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none"
      style={{
        transform: props.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgba(0,0,0,0.6)"/>
    </svg>
  )
}

export function InsightSessionList(): JSX.Element {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const notification = useNotification()
  const permission = usePermission()

  const homeDir = () => globalSync.data.path.home

  const [sessions, { refetch }] = createResource(homeDir, async (dir) => {
    if (!dir) return [] as Session[]
    const result = await globalSDK.client.session.list({ directory: dir })
    // v2 Session 类型不暴露 agent;外网 server 也不返回 → 以 optional 字段读,优雅降级过滤
    const data = ((result.data ?? []) as Array<Session & { agent?: string }>).sort(
      (a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0),
    )
    return data.filter((s) => !s.agent || s.agent === AGENT)
  })

  // reconcile(key=id):保持 <For> 行引用稳定,避免每次 refetch 重建每行的 globalSync.child
  // 订阅与状态点 memo(否则状态点会闪)。
  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 1000)
    }
  })
  onCleanup(unsub)
  onCleanup(() => clearTimeout(refetchTimer))

  const activeSessionId = () => {
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  const [insightCollapsed, setInsightCollapsed] = createSignal(false)

  // 懒创建(D4):跳空会话页,发首条消息才建记录;不 eager session.create
  function newSession() {
    navigate("/insight")
  }

  // ── 右键改名/删除(我方在 1:1 之上的功能并集;UXAI 会话列表无此菜单)──────
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
    const session = sessionList.find((s) => s.id === sessionId)
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
      console.error("[insight:session-list] rename failed", err)
    }
  }

  async function handleDelete(sessionId: string) {
    closeContextMenu()
    try {
      await globalSDK.client.session.delete({ sessionID: sessionId })
      if (activeSessionId() === sessionId) navigate("/insight")
    } catch (err) {
      console.error("[insight:session-list] delete failed", err)
    }
  }

  return (
    <div class="flex flex-col">
      {/* 新建行 */}
      <button
        type="button"
        class="flex items-center gap-3 w-full mb-[8px] rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
        style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
        onClick={newSession}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="shrink-0">
          <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span>新建</span>
      </button>
      <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 0 6px" }} />

      {/* ─── Octo Insight ─── */}
      <div class="mb-[2px]">
        <div class="flex items-center h-[36px] px-[12px]">
          <button
            type="button"
            onClick={() => setInsightCollapsed((v) => !v)}
            class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
          >
            <span class="flex items-center gap-[12px] min-w-0">
              <img src="/insightIcon.svg" alt="" style={{ width: "20px", height: "20px" }} />
              <span class="text-[12px] leading-[20px] select-none truncate" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                Octo Insight
              </span>
            </span>
            <ChevronRightIcon collapsed={insightCollapsed()} />
          </button>
        </div>

        <Show when={!insightCollapsed()}>
          <div class="flex flex-col">
            <Show
              when={!sessions.loading}
              fallback={
                <div class="px-[8px] py-[6px]">
                  <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                </div>
              }
            >
              <Show
                when={sessionList.length > 0}
                fallback={
                  <div class="px-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                    暂无对话
                  </div>
                }
              >
                <For each={sessionList}>
                  {(session) => {
                    const isActive = () => activeSessionId() === session.id
                    const [sessionStore] = globalSync.child(session.directory)
                    const isWorking = createMemo(() => {
                      const status = sessionStore.session_status[session.id]
                      return status !== undefined && status.type !== "idle"
                    })
                    const unseenCount = createMemo(() => notification.session.unseenCount(session.id))
                    const hasError = createMemo(() => notification.session.unseenHasError(session.id))
                    const hasPermissions = createMemo(() =>
                      !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, session.id, (item) =>
                        !permission.autoResponds(item, session.directory),
                      ),
                    )
                    return (
                      <Show
                        when={renamingId() === session.id}
                        fallback={
                      <button
                        type="button"
                        onClick={() => {
                          notification.session.markViewed(session.id)
                          navigate(`/insight/${session.id}`)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setConfirmDeleteId(null)
                          setContextMenu({ id: session.id, x: e.clientX, y: e.clientY })
                        }}
                        class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center relative"
                        style={{
                          height: "36px",
                          padding: "0 24px 0 44px",
                          color: isActive() ? "#0A59F7" : undefined,
                        }}
                        classList={{
                          "bg-[rgba(10,89,247,0.08)]": isActive(),
                          "hover:bg-surface-base-hover": !isActive(),
                        }}
                      >
                        <Show when={isActive()}>
                          <span
                            class="absolute right-[12px] top-1/2 rounded-full pointer-events-none"
                            style={{
                              height: "28px",
                              width: "4px",
                              background: "#0A59F7",
                              transform: "translateY(-50%)",
                            }}
                          />
                        </Show>
                        <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
                          <div class="shrink-0 size-6 flex items-center justify-center absolute left-[12px]">
                            <Switch>
                              <Match when={isWorking()}>
                                <Spinner class="size-[15px]" />
                              </Match>
                              <Match when={hasPermissions()}>
                                <div class="size-1.5 rounded-full bg-surface-warning-strong" />
                              </Match>
                              <Match when={hasError()}>
                                <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
                              </Match>
                              <Match when={unseenCount() > 0}>
                                <div class="size-1.5 rounded-full bg-text-interactive-base" />
                              </Match>
                            </Switch>
                          </div>
                        </Show>
                        <span class="flex-1 min-w-0 truncate">{sessionTitle(session.title) || "无标题"}</span>
                      </button>
                        }
                      >
                        {/* 内联重命名输入框 */}
                        <div
                          class="w-full rounded-[8px] flex items-center"
                          style={{ height: "36px", padding: "0 12px 0 44px", background: "rgba(10,89,247,0.08)" }}
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
                            style={{ color: "#0A59F7", "font-weight": "500", border: "none" }}
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
                    style={{ background: "var(--octo-danger, #DC2626)", color: "#fff" }}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={closeContextMenu}
                    class="flex-1 px-[8px] py-[4px] text-[12px] rounded-[4px] transition-colors"
                    style={{ background: "var(--octo-surface-hover, #F5F5F5)", color: "var(--octo-text-primary, #191919)" }}
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
