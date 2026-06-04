import { createSignal, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { type TaskCardEntry, type TaskStatus, toolDisplayName } from "../../utils/task-detect"
import { isInCooldown, remainingSeconds, formatCooldown } from "../../utils/task-refresh"
import {
  IconRefresh,
  IconStop,
  IconEye,
  IconChevron,
  IconStatusProcessing,
  IconStatusCompleted,
  IconStatusFailed,
} from "./icons"

/**
 * 长任务卡片 — 5 态视觉(2026-06 设计稿改版)
 * spec: docs/specs/ui/task-card.md §5
 *
 * 设计稿决策(见 memory insight-card-redesign-decisions):
 * - 统一白底卡面(不再按状态变背景色),仅图标/按钮带色
 * - 过程卡副文案优先 message,缺省"请稍后点击刷新获取结果"
 * - 完成卡简化为"共生成 N 份文件,请点击查看"
 * - 失败卡错误详情可展开
 * - pending/stopped 设计稿未给图,先用近似(灰调)
 */
export function TaskCardView(props: {
  card: TaskCardEntry
  busy: boolean
  onRefresh: (taskId: string) => void
  onStop: (taskId: string) => void
  onOpenResult: (taskId: string) => void
}): JSX.Element {
  const status = () => props.card.status
  const isTerminal = () => status() === "completed" || status() === "failed" || status() === "stopped"
  const [confirming, setConfirming] = createSignal(false)

  return (
    <div
      class="mx-3 mb-3 p-4"
      style={{
        "border-radius": "12px",
        border: "1px solid rgba(0,0,0,0.1)",
        background: "linear-gradient(90deg, rgb(245,248,255) 0%, rgb(255,255,255) 49.85%)",
        "box-shadow": "0 1px 3px rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.03)",
        "font-family": '"HarmonyOS Sans SC", system-ui, sans-serif',
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
          onOpenResult={() => {
            console.log("[octo:task] open result click", { taskId: props.card.taskId })
            props.onOpenResult(props.card.taskId)
          }}
        />
        <Body card={props.card} />
        {/* footer:提交时间 + ID(失败态不显示,错误详情已占位) */}
        <Show when={status() !== "failed"}>
          <Footer card={props.card} />
        </Show>
      </Show>
    </div>
  )
}

// ── Header(状态图标 + 标题 + 右侧操作按钮) ──
function Header(props: {
  card: TaskCardEntry
  busy: boolean
  onRefresh: () => void
  onStop: () => void
  onOpenResult: () => void
}): JSX.Element {
  const status = () => props.card.status
  const inProgress = () => status() === "pending" || status() === "processing"

  return (
    <div class="flex items-center gap-2.5">
      <StatusIcon status={status()} />
      <span class="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: "var(--octo-text-strong)" }}>
        {statusLabel(status())}
      </span>

      {/* 进行中:刷新 + 终止 */}
      <Show when={inProgress()}>
        <div class="flex items-center gap-2 flex-shrink-0">
          <RefreshButton taskId={props.card.taskId} busy={props.busy} onClick={props.onRefresh} />
          <button
            type="button"
            onClick={props.onStop}
            disabled={props.busy}
            class="flex items-center justify-center gap-1.5 h-7 rounded-[6px] text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            style={{
              "min-width": "74px",
              padding: "0 12px",
              border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--octo-text-secondary)",
              background: "var(--octo-surface-page)",
            }}
            title={props.busy ? "请等待当前任务完成后再操作" : "终止任务"}
          >
            <IconStop size={13} />
            终止
          </button>
        </div>
      </Show>

      {/* 完成:查看结果 */}
      <Show when={status() === "completed"}>
        <button
          type="button"
          onClick={props.onOpenResult}
          class="flex items-center justify-center gap-1.5 h-7 rounded-[6px] text-[13px] font-medium flex-shrink-0 transition-colors"
          style={{ "min-width": "102px", padding: "0 14px", background: "var(--octo-brand)", color: "#FFFFFF" }}
        >
          <IconEye size={15} />
          查看结果
        </button>
      </Show>
    </div>
  )
}

function RefreshButton(props: { taskId: string; busy: boolean; onClick: () => void }): JSX.Element {
  // remainingSeconds 反应式(订阅 task-refresh now signal)
  const remaining = () => remainingSeconds(props.taskId)
  const cooling = () => remaining() > 0
  const disabled = () => props.busy || cooling()

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={disabled()}
      class="flex items-center justify-center gap-1.5 h-7 rounded-[6px] text-[13px] font-medium transition-colors disabled:cursor-not-allowed flex-shrink-0"
      style={{
        "min-width": "74px",
        padding: "0 12px",
        background: cooling() ? "var(--octo-brand-subtle)" : "var(--octo-brand)",
        color: cooling() ? "var(--octo-brand)" : "#FFFFFF",
        opacity: props.busy ? 0.5 : 1,
      }}
      title={props.busy ? "请等待当前任务完成后再操作" : cooling() ? "3 分钟内只能刷新一次" : "查询任务进度"}
    >
      <IconRefresh size={14} />
      <Show when={cooling()} fallback={<>刷新</>}>
        {formatCooldown(remaining())}
      </Show>
    </button>
  )
}

// ── Body(副文案 / 完成提示 / 失败可展开) ──
function Body(props: { card: TaskCardEntry }): JSX.Element {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div class="mt-2.5">
      <Switch>
        <Match when={props.card.status === "pending" || props.card.status === "processing"}>
          <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>
            {props.card.message ?? "请稍后点击刷新获取结果"}
          </div>
        </Match>

        <Match when={props.card.status === "completed"}>
          <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>
            {completedSummary(props.card.resourceLinks.length)}
          </div>
        </Match>

        <Match when={props.card.status === "failed"}>
          <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>
            请稍后重启客户端并重试
          </div>
          <Show when={props.card.message}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              class="mt-1.5 flex items-center gap-1 text-[12px] w-full text-left"
              style={{ color: "var(--octo-text-disabled)" }}
            >
              <span class="flex-1 min-w-0 truncate">{firstLine(props.card.message!)}</span>
              <IconChevron size={13} open={expanded()} />
            </button>
            <Show when={expanded()}>
              <pre
                class="mt-1.5 p-2.5 text-[12px] whitespace-pre-wrap break-all"
                style={{
                  color: "var(--octo-danger)",
                  background: "var(--octo-danger-subtle)",
                  "border-radius": "var(--octo-radius-md)",
                  "font-family": "var(--octo-font-mono, ui-monospace, monospace)",
                }}
              >
                {props.card.message}
              </pre>
            </Show>
          </Show>
        </Match>

        <Match when={props.card.status === "stopped"}>
          <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>
            任务已被终止
          </div>
        </Match>
      </Switch>
    </div>
  )
}

// ── Footer(提交时间 + ID,两端对齐) ──
function Footer(props: { card: TaskCardEntry }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-3 mt-3 text-[12px]" style={{ color: "var(--octo-text-disabled)" }}>
      <span class="truncate">提交时间: {formatFullTime(props.card.submittedAt)}</span>
      <span class="truncate flex-shrink-0" title={props.card.taskId}>
        ID: {props.card.taskId}
      </span>
    </div>
  )
}

// ── 行内二次确认(终止) ──
function StopConfirmRow(props: { onCancel: () => void; onConfirm: () => void }): JSX.Element {
  return (
    <div class="flex flex-col gap-2.5">
      <div class="text-[13px]" style={{ color: "var(--octo-text-primary)" }}>
        ⚠️ 确定终止该任务?已耗费的服务端资源不可恢复。
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          class="px-3.5 h-8 text-[13px] rounded-lg"
          style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-secondary)" }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          class="px-3.5 h-8 text-[13px] rounded-lg font-medium"
          style={{ color: "#FFFFFF", background: "var(--octo-danger)" }}
        >
          确定终止
        </button>
      </div>
    </div>
  )
}

// ── 状态图标 ──
function StatusIcon(props: { status: TaskStatus }): JSX.Element {
  return (
    <Switch>
      <Match when={props.status === "processing" || props.status === "pending"}>
        <IconStatusProcessing size={20} />
      </Match>
      <Match when={props.status === "completed"}>
        <IconStatusCompleted size={20} />
      </Match>
      <Match when={props.status === "failed"}>
        <IconStatusFailed size={20} />
      </Match>
      <Match when={props.status === "stopped"}>
        <span style={{ color: "var(--octo-text-disabled)" }} class="flex-shrink-0 flex">
          <IconStop size={18} />
        </span>
      </Match>
    </Switch>
  )
}

// ── 文案辅助 ──

function statusLabel(s: TaskStatus): string {
  switch (s) {
    case "pending": return "任务排队中"
    case "processing": return "任务进行中"
    case "completed": return "任务完成"
    case "failed": return "任务失败"
    case "stopped": return "任务已终止"
  }
}

function completedSummary(fileCount: number): string {
  if (fileCount <= 0) return "分析已完成,请点击查看"
  return `共生成${cnNum(fileCount)}份文件,请点击查看`
}

/** 量词前小数字中文化(2 用"两");超出范围回落阿拉伯数字 */
function cnNum(n: number): string {
  const map = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"]
  return map[n] ?? String(n)
}

function firstLine(text: string): string {
  const idx = text.indexOf("\n")
  return idx === -1 ? text : text.slice(0, idx)
}

function formatFullTime(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
