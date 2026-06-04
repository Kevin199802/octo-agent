import "../octo-tokens.css"
import { createSignal, For, Show, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { AttachmentBar, type Attachment } from "../components/attachment-bar"

/**
 * Dev-only 样张：上传文件 chip 三态新 UI。
 *
 * 直接复用线上真实组件 components/attachment-bar.tsx 的 <AttachmentBar>，本页只提供
 * mock 数据 + 模拟输入胶囊环境，绝不重写 chip 样式 —— dev 永远 == 线上（development.md §8.3）。
 *   历史：本页曾自绘一份 AttachmentChip 拷贝（组件落地前的设计样张），落地后两份会漂移，
 *   已按"样张落地即回收"规则改为 import 真实组件。
 *
 * 设计稿：「容器 30047上传成功/中」「容器 71039上传失败」。
 * chip 尺寸：208×40(success/uploading)、208×56(error)，rx=8，背景 rgb(243,243,243)。
 * 路由：/_dev/attachment-bar（见 dev-routes.tsx）。
 */

// ── 初始 mock 数据 ──────────────────────────────────────────────
const INITIAL_MOCKS: Attachment[] = [
  {
    id: "1",
    filename: "算子开发工具 访谈观点聚类报告.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 102400,
    status: "done",
  },
  {
    id: "2",
    filename: "用户满意度评分汇总.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 51200,
    status: "uploading",
  },
  {
    id: "3",
    filename: "产品路线图规划与里程碑.pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    size: 204800,
    status: "error",
    error: "网络错误，请重试",
    retriable: true,
  },
  {
    id: "4",
    filename: "超大文件上传失败示例.pdf",
    mime: "application/pdf",
    size: 30 * 1024 * 1024,
    status: "error",
    error: "文件超过 20MB 大小限制",
    retriable: false,
  },
]

// ── 预览页主体 ──────────────────────────────────────────────────
export default function AttachmentBarPreviewPage(): JSX.Element {
  const [attachments, setAttachments] = createSignal<Attachment[]>(INITIAL_MOCKS)

  function remove(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function retry(id: string) {
    setAttachments((prev) =>
      prev.map((a) => a.id === id ? { ...a, status: "uploading" as const, error: undefined } : a)
    )
    // 模拟 1.5s 后随机成功/失败
    setTimeout(() => {
      setAttachments((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a
          return Math.random() > 0.5
            ? { ...a, status: "done" as const }
            : { ...a, status: "error" as const, error: "重试仍失败，请检查网络", retriable: true }
        })
      )
    }, 1500)
  }

  function reset() {
    setAttachments(INITIAL_MOCKS.map((a) => ({ ...a })))
  }

  const statusLabel: Record<string, string> = {
    done: "上传成功",
    uploading: "上传中",
    error: "上传失败",
  }

  return (
    <div class="size-full overflow-y-auto" style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}>
      <div class="mx-auto" style={{ "max-width": "760px", padding: "40px 24px 80px" }}>
        <A href="/_dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>← Dev 预览索引</A>

        <div style={{ "margin-top": "12px", "margin-bottom": "4px", "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)" }}>
          上传文件 Chip 新 UI
        </div>
        <div style={{ "margin-bottom": "24px", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          复用线上真实 <code>&lt;AttachmentBar&gt;</code> 渲染。三种状态：done(40px)、uploading(40px+旋转光芒)、error(56px，第二行红色提示)。
        </div>

        {/* ── 各态单独展示：每态用真实 AttachmentBar 渲染单个 chip ── */}
        <div style={{ "font-size": "13px", "font-weight": 600, color: "var(--octo-text-primary)", "margin-bottom": "12px" }}>单态预览</div>
        <div style={{ display: "flex", gap: "16px", "flex-wrap": "wrap", "margin-bottom": "32px", "align-items": "flex-start" }}>
          <For each={INITIAL_MOCKS}>
            {(att) => (
              <div>
                <div style={{ "font-size": "11px", color: "var(--octo-text-secondary)", "margin-bottom": "6px" }}>
                  {statusLabel[att.status]}{att.retriable ? "（可重试）" : att.status === "error" ? "（不可重试）" : ""}
                </div>
                <AttachmentBar attachments={[att]} onRemove={() => {}} onRetry={() => {}} />
              </div>
            )}
          </For>
        </div>

        {/* ── 模拟输入胶囊里的附件条（真实 AttachmentBar，可交互）── */}
        <div style={{ "font-size": "13px", "font-weight": 600, color: "var(--octo-text-primary)", "margin-bottom": "12px" }}>
          输入胶囊内附件条（可交互）
        </div>

        <Show
          when={attachments().length > 0}
          fallback={
            <div style={{ "font-size": "13px", color: "var(--octo-text-disabled)", "margin-bottom": "16px" }}>
              所有 chip 已移除
            </div>
          }
        >
          {/* 模拟胶囊容器:提供白底 + 上圆角 + 下边框,把真实 AttachmentBar(透明 strip)嵌进来,
              还原线上"附件条贴合输入胶囊顶部"的环境。chip 本身完全来自真实组件。 */}
          <div style={{ background: "var(--octo-surface-page, #fff)", "border-radius": "var(--octo-radius-lg, 8px) var(--octo-radius-lg, 8px) 0 0", border: "1px solid var(--octo-border-divider)", "border-bottom": "none" }}>
            <AttachmentBar attachments={attachments()} onRemove={remove} onRetry={retry} />
          </div>

          {/* 模拟 textarea 区域 */}
          <div style={{ background: "var(--octo-surface-page, #fff)", "border-radius": "0 0 var(--octo-radius-lg, 8px) var(--octo-radius-lg, 8px)", padding: "8px 12px 10px", "min-height": "48px", "font-size": "14px", color: "var(--octo-text-placeholder, #9ca3af)", border: "1px solid var(--octo-border-divider)", "border-top": "none" }}>
            请输入消息…
          </div>
        </Show>

        {/* 重置按钮 */}
        <div style={{ "margin-top": "16px", display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={reset}
            style={{ "font-size": "12px", padding: "4px 12px", "border-radius": "6px", cursor: "pointer", border: "1px solid var(--octo-border-default, #ddd)", background: "var(--octo-surface-page, #fff)", color: "var(--octo-text-primary)" }}
          >
            重置全部 chip
          </button>
        </div>

        <div style={{ "margin-top": "28px", "font-size": "12px", color: "var(--octo-text-disabled)", "line-height": 1.7 }}>
          × 可移除单个 chip；可重试的 error chip 点击「重试」后随机 1.5s 后切为 uploading → done/error。
          chip 视觉完全来自 <code>components/attachment-bar.tsx</code> 的 <code>&lt;AttachmentBar&gt;</code>，本页不重写。
        </div>
      </div>
    </div>
  )
}
