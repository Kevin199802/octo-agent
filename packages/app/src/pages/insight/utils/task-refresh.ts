import { createSignal } from "solid-js"

/**
 * 长任务刷新防抖(spec: docs/specs/ui/task-card.md §7)
 *
 * - 粒度:per task_id
 * - 冷却:3 分钟
 * - 存储:内存 Map,session 切换调 clearRefreshState() 清空
 * - 倒计时驱动:单一 setInterval(1s),仅在存在生效冷却时启动,所有冷却结束自动停止
 *
 * 注意:模块级 createSignal 没有 SolidJS owner,onCleanup 无效;timer 用"tick 内自停"
 * 避免泄漏,见 ensureTimer / maybeStopTimer。
 */

export const REFRESH_COOLDOWN_MS = 3 * 60 * 1000

const refreshState = new Map<string, number>()  // taskId → lastRefreshAt(ms)
const [now, setNow] = createSignal(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(() => {
    setNow(Date.now())
    maybeStopTimer()
  }, 1000)
}

function maybeStopTimer(): void {
  const t = Date.now()
  for (const last of refreshState.values()) {
    if (t - last < REFRESH_COOLDOWN_MS) return
  }
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

export function markRefreshed(taskId: string): void {
  refreshState.set(taskId, Date.now())
  setNow(Date.now())
  ensureTimer()
  console.log("[octo:task] markRefreshed", { taskId, cooldownMs: REFRESH_COOLDOWN_MS })
}

/** reactive:依赖 now() — 在 SolidJS 反应式上下文里读会自动追踪每秒变化 */
export function remainingSeconds(taskId: string): number {
  const last = refreshState.get(taskId)
  if (!last) return 0
  const elapsed = now() - last
  return Math.max(0, Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000))
}

export function isInCooldown(taskId: string): boolean {
  return remainingSeconds(taskId) > 0
}

export function clearRefreshState(): void {
  refreshState.clear()
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

/** 格式化倒计时 mm:ss */
export function formatCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
