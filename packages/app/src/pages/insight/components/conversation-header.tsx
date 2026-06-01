import { createMemo, createSignal, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { sessionTitle } from "@/utils/session-title"

/**
 * ConversationHeader —— Insight 对话面板顶部的会话标题栏
 *
 * 上游已实现:✓ —— 参照 opencode 原生 packages/app/src/pages/session/message-timeline.tsx
 * 的标题 header（showHeader / childTitle / 双击改名 / dot-grid 菜单 / DialogDeleteSession）。
 * Insight 是单层用研会话，无父子/subagent/share/archive，故精简为：
 *   标题 + busy spinner + 双击改名(session.update) + dot-grid 菜单(重命名 / 删除)。
 *
 * 数据层复用 sync（sync.session.get / sync.set）+ useSDK（带 directory 的 sdk.client）。
 * 视觉走 insight 的 --octo token，保持页面自包含。
 */
function errorDescription(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return "请稍后重试"
}

export function ConversationHeader() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()

  const sessionID = () => params.id
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  // 占位标题（"New session - <iso>"）尚未由 LLM 生成真标题，展示为「新会话」
  const realTitle = createMemo(() => {
    const v = titleValue()
    if (!v || /^New session/.test(v)) return ""
    return sessionTitle(v) ?? ""
  })
  const displayTitle = createMemo(() => realTitle() || "新会话")
  const busy = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return sync.data.session_status[id]?.type === "busy"
  })

  const [title, setTitle] = createStore({ draft: "", editing: false, menuOpen: false, pendingRename: false })
  const [pending, setPending] = createSignal(false)
  let titleRef: HTMLInputElement | undefined

  const openTitleEditor = () => {
    if (!sessionID()) return
    setTitle({ editing: true, draft: realTitle() })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (pending()) return
    setTitle("editing", false)
  }

  const saveTitleEditor = async () => {
    const id = sessionID()
    if (!id || pending()) return

    const next = title.draft.trim()
    if (!next || next === realTitle()) {
      setTitle("editing", false)
      return
    }

    setPending(true)
    try {
      await sdk.client.session.update({ sessionID: id, title: next })
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === id)
          if (index !== -1) draft.session[index].title = next
        }),
      )
      setTitle("editing", false)
    } catch (err) {
      showToast({ title: "重命名失败", description: errorDescription(err) })
    } finally {
      setPending(false)
    }
  }

  const deleteSession = async (id: string) => {
    try {
      await sdk.client.session.delete({ sessionID: id })
      sync.set(
        produce((draft) => {
          draft.session = draft.session.filter((s) => s.id !== id)
        }),
      )
      // 删的是当前会话 → 回到 Insight 首页（sidebar 监听 session.deleted 自动刷新列表）
      if (params.id === id) navigate("/insight")
    } catch (err) {
      showToast({ title: "删除失败", description: errorDescription(err) })
    }
  }

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(() => sessionTitle(sync.session.get(props.sessionID)?.title) || "新会话")
    const handleDelete = async () => {
      await deleteSession(props.sessionID)
      dialog.close()
    }
    return (
      <Dialog title="删除会话" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            确定要删除「{name()}」吗？此操作不可撤销。
          </span>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              取消
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              删除
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Show when={sessionID()}>
      {(id) => (
        <div
          class="shrink-0 h-12 flex items-center justify-between gap-2 px-4"
          style={{ "border-bottom": "1px solid var(--octo-border-default, #E5E7EB)" }}
        >
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <Show when={busy()}>
              <Spinner class="size-4 shrink-0" style={{ color: "var(--octo-brand, #0067D1)" }} />
            </Show>
            <Show
              when={title.editing}
              fallback={
                <h1
                  class="text-[14px] font-medium truncate min-w-0 cursor-default"
                  style={{ color: "var(--octo-text-primary, #191919)" }}
                  title={displayTitle()}
                  onDblClick={openTitleEditor}
                >
                  {displayTitle()}
                </h1>
              }
            >
              <InlineInput
                ref={(el: HTMLInputElement) => {
                  titleRef = el
                }}
                value={title.draft}
                disabled={pending()}
                class="text-[14px] font-medium grow min-w-0 rounded-[6px] pl-1 -ml-1"
                onInput={(event) => setTitle("draft", event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveTitleEditor()
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    closeTitleEditor()
                  }
                }}
                onBlur={() => void saveTitleEditor()}
              />
            </Show>
          </div>

          <DropdownMenu
            gutter={4}
            placement="bottom-end"
            open={title.menuOpen}
            onOpenChange={(open) => setTitle("menuOpen", open)}
          >
            <DropdownMenu.Trigger
              as={IconButton}
              icon="dot-grid"
              variant="ghost"
              class="size-6 rounded-md shrink-0 data-[expanded]:bg-surface-base-active"
              aria-label="更多操作"
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                style={{ "min-width": "104px" }}
                onCloseAutoFocus={(event) => {
                  // 菜单关闭动画结束后再进编辑态，避免焦点被菜单抢回（与原生一致）
                  if (title.pendingRename) {
                    event.preventDefault()
                    setTitle("pendingRename", false)
                    openTitleEditor()
                  }
                }}
              >
                <DropdownMenu.Item onSelect={() => setTitle({ pendingRename: true, menuOpen: false })}>
                  <DropdownMenu.ItemLabel>重命名</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id()} />)}>
                  <DropdownMenu.ItemLabel>删除</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      )}
    </Show>
  )
}
