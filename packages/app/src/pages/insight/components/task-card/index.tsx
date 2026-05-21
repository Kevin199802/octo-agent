import { createSignal, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { type TaskCardEntry, type TaskStatus, toolDisplayName } from "../../utils/task-detect"
import { isInCooldown, remainingSeconds, formatCooldown } from "../../utils/task-refresh"

/**
 * 长任务卡片 — 5 态视觉 + 刷新 / 终止 / follow-up 操作
 * spec: docs/specs/ui/task-card.md §5
 */
export function TaskCardView(props: {
  card: TaskCardEntry
  busy: boolean                                  // session busy 时禁用按钮
  onRefresh: (taskId: string) => void
  onStop: (taskId: string) => void
  onOpenResult: (taskId: string) => void
  onFollowup: (taskId: string) => void
}): JSX.Element {
  const status = () => props.card.status
  const isTerminal = () => status() === "completed" || status() === "failed" || status() === "stopped"
  const [confirming, setConfirming] = createSignal(false)

  return (
    <div
      class="mx-3 mb-3 p-3"
      style={{
        "border-radius": "var(--octo-radius-md)",
        border: `1px solid ${statusBorderColor(status())}`,
        background: statusBgColor(status()),
        width: "calc(100% - 1.5rem)",
      }}
      data-task-id={props.card.taskId}
      data-task-status={status()}
    >
      <Show
        when={!confirming()}
        fallback={
          <StopConfirmRow
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false)
              console.log("[octo:task] stop confirmed", { taskId: props.card.taskId })
              props.onStop(props.card.taskId)
            }}
          />
        }
      >
        <Header
          card={props.card}
          busy={props.busy}
          onRefresh={() => {
            console.log("[octo:task] refresh click", {
              taskId: props.card.taskId,
              inCooldown: isInCooldown(props.card.taskId),
              busy: props.busy,
            })
            if (props.busy || isInCooldown(props.card.taskId)) return
            props.onRefresh(props.card.taskId)
          }}
          onStop={() => setConfirming(true)}
        />
        <Body
          card={props.card}
          onOpenResult={() => {
            console.log("[octo:task] open result click", { taskId: props.card.taskId })
            props.onOpenResult(props.card.taskId)
          }}
          onFollowup={() => {
            console.log("[octo:task] followup click", { taskId: props.card.taskId })
            props.onFollowup(props.card.taskId)
          }}
        />
      </Show>
      <Show when={!isTerminal()}>
        <Footer card={props.card} />
      </Show>
    </div>
  )
}

// ── Header(图标 + 标题 + 操作按钮) ──
function Header(props: {
  card: TaskCardEntry
  busy: boolean
  onRefresh: () => void
  onStop: () => void
}): JSX.Element {
  const status = () => props.card.status
  const isTerminal = () => status() === "completed" || status() === "failed" || status() === "stopped"

  return (
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-base flex-shrink-0">{statusIcon(status())}</span>
      <div class="flex flex-col min-w-0 flex-1">
        <span class="text-sm font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>
          {toolDisplayName(props.card.toolName)}
          <span class="text-xs ml-2" style={{ color: "var(--octo-text-secondary)" }}>
            {statusLabel(status())}
          </span>
        </span>
        <span class="text-xs truncate mt-0.5" style={{ color: "var(--octo-text-secondary)" }}>
          ID: {shortId(props.card.taskId)}
        </span>
      </div>
      <Show when={!isTerminal()}>
        <div class="flex items-center gap-1 flex-shrink-0">
          <RefreshButton
            taskId={props.card.taskId}
            busy={props.busy}
            onClick={props.onRefresh}
          />
          <button
            type="button"
            onClick={props.onStop}
            disabled={props.busy}
            class="px-2 py-1 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-secondary)" }}
            title={props.busy ? "等待当前任务完成后再操作" : "终止任务"}
          >
            ⏹ 终止
          </button>
        </div>
      </Show>
    </div>
  )
}

function RefreshButton(props: { taskId: string; busy: boolean; onClick: () => void }): JSX.Element {
  // remainingSeconds 是 reactive(订阅 task-refresh now signal)
  const remaining = () => remainingSeconds(props.taskId)
  const cooling = () => remaining() > 0
  const disabled = () => props.busy || cooling()

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={disabled()}
      class="px-2 py-1 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        border: "1px solid var(--octo-border-default)",
        color: cooling() ? "var(--octo-text-secondary)" : "var(--octo-brand)",
      }}
      title={
        props.busy
          ? "等待当前任务完成后再操作"
          : cooling()
            ? "3 分钟内只能刷新一次,避免高频骚扰 LLM"
            : "查询任务进度"
      }
    >
      <Show when={cooling()} fallback={<>↻ 刷新</>}>
        ↻ {formatCooldown(remaining())}
      </Show>
    </button>
  )
}

// ── Body(状态消息 / completed 摘要 + 操作) ──
function Body(props: {
  card: TaskCardEntry
  onOpenResult: () => void
  onFollowup: () => void
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.card.status === "pending" || props.card.status === "processing"}>
        <div class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>
          {props.card.message ?? (props.card.status === "pending" ? "排队中…" : "分析进行中…")}
        </div>
      </Match>
      <Match when={props.card.status === "completed"}>
        <div class="flex flex-col gap-2">
          <Show when={props.card.resultText}>
            <div
              class="text-xs leading-relaxed"
              style={{ color: "var(--octo-text-primary)", "white-space": "pre-wrap" }}
            >
              {truncate(props.card.resultText!, 200)}
            </div>
          </Show>
          {/* 多文件时列出每个文件名,让用户一眼看到产出 */}
          <Show when={props.card.resourceLinks.length > 1}>
            <ul class="flex flex-col gap-0.5 mt-1 mb-0.5 pl-3">
              {props.card.resourceLinks.map((link) => (
                <li
                  class="text-xs leading-tight"
                  style={{ color: "var(--octo-text-secondary)" }}
                >
                  • {link.name || link.uri}
                  <Show when={link.description}>
                    <span style={{ color: "var(--octo-text-disabled)" }}> — {link.description}</span>
                  </Show>
                </li>
              ))}
            </ul>
          </Show>
          <div class="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={props.onOpenResult}
              class="px-3 py-1 text-xs rounded"
              style={{
                border: "1px solid var(--octo-brand)",
                color: "var(--octo-brand)",
                background: "var(--octo-surface-page)",
              }}
            >
              <Show
                when={props.card.resourceLinks.length > 1}
                fallback={<>📄 查看完整结果 →</>}
              >
                📄 查看完整结果({props.card.resourceLinks.length} 份)→
              </Show>
            </button>
            <button
              type="button"
              onClick={props.onFollowup}
              class="px-3 py-1 text-xs rounded"
              style={{
                border: "1px solid var(--octo-border-default)",
                color: "var(--octo-text-secondary)",
              }}
            >
              💬 在对话里继续讨论
            </button>
          </div>
        </div>
      </Match>
      <Match when={props.card.status === "failed"}>
        <div class="text-xs" style={{ color: "var(--octo-danger)" }}>
          {props.card.message ?? "分析失败"}
        </div>
      </Match>
      <Match when={props.card.status === "stopped"}>
        <div class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>
          任务已被终止
        </div>
      </Match>
    </Switch>
  )
}

// ── Footer(进行中:提交时间 + 最近更新) ──
function Footer(props: { card: TaskCardEntry }): JSX.Element {
  return (
    <div class="text-[11px] mt-2 pt-2" style={{ color: "var(--octo-text-disabled)", "border-top": "1px solid var(--octo-border-divider)" }}>
      提交于 {formatTime(props.card.submittedAt)}
      <Show when={props.card.lastUpdatedAt.getTime() !== props.card.submittedAt.getTime()}>
        <> · 更新于 {formatTime(props.card.lastUpdatedAt)}</>
      </Show>
    </div>
  )
}

// ── 行内二次确认(终止) ──
function StopConfirmRow(props: { onCancel: () => void; onConfirm: () => void }): JSX.Element {
  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs" style={{ color: "var(--octo-text-primary)" }}>
        ⚠️ 确定终止该任务?已耗费的服务端资源不可恢复。
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          class="px-3 py-1 text-xs rounded"
          style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-secondary)" }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          class="px-3 py-1 text-xs rounded"
          style={{
            border: "1px solid var(--octo-danger)",
            color: "#FFFFFF",
            background: "var(--octo-danger)",
          }}
        >
          确定终止
        </button>
      </div>
    </div>
  )
}

// ── 视觉态映射 ────────────────────────────────────

function statusIcon(s: TaskStatus): string {
  switch (s) {
    case "pending": return "⏸"
    case "processing": return "⏳"
    case "completed": return "✓"
    case "failed": return "⚠"
    case "stopped": return "⏹"
  }
}

function statusLabel(s: TaskStatus): string {
  switch (s) {
    case "pending": return "排队中"
    case "processing": return "进行中"
    case "completed": return "已完成"
    case "failed": return "失败"
    case "stopped": return "已终止"
  }
}

function statusBgColor(s: TaskStatus): string {
  switch (s) {
    case "pending":
    case "processing": return "var(--octo-brand-a3)"
    case "completed": return "var(--octo-success-subtle)"
    case "failed": return "var(--octo-danger-subtle)"
    case "stopped": return "var(--octo-surface-hover)"
  }
}

function statusBorderColor(s: TaskStatus): string {
  switch (s) {
    case "pending":
    case "processing": return "var(--octo-brand-a25)"
    case "completed": return "var(--octo-success)"
    case "failed": return "var(--octo-danger)"
    case "stopped": return "var(--octo-border-default)"
  }
}

function shortId(taskId: string): string {
  return taskId.length > 12 ? `${taskId.slice(0, 8)}…` : taskId
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

function formatTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
