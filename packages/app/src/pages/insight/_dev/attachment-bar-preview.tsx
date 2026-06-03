import "../octo-tokens.css"
import { createSignal, For, Show, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import type { Attachment } from "../components/attachment-bar"

/**
 * Dev-only 样张：上传文件 chip 三态新 UI。
 *
 * 复现设计稿：
 *   「容器 30047上传成功.svg」「容器 30047上传中.svg」「容器 71039上传失败.svg」
 *
 * chip 尺寸：208×40px（success/uploading）、208×56px（error），rx=8，背景 rgb(243,243,243)。
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

// ── 旋转光芒角度（8 条）──────────────────────────────────────────
const SPIN_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

// ── 蓝渐变文档图标（24×24，路径从设计稿 208×40 坐标 −(12,8) 归一化）──
function DocFileIcon(props: { uploading?: boolean }): JSX.Element {
  return (
    <div style={{ position: "relative", width: "24px", height: "24px", "flex-shrink": "0" }}>
      <svg viewBox="0 0 24 24" fill="none" width="24" height="24" aria-hidden="true">
        <defs>
          <linearGradient id="att-g1" x1="12" x2="12" y1="0" y2="24" gradientUnits="userSpaceOnUse">
            <stop stop-color="rgb(57,156,255)" offset="0" />
            <stop stop-color="rgb(85,192,242)" offset="1" />
          </linearGradient>
          <linearGradient id="att-g2" x1="17.93" x2="15.00" y1="3.25" y2="7.21" gradientUnits="userSpaceOnUse">
            <stop stop-color="rgb(55,142,230)" offset="0" stop-opacity="0.8" />
            <stop stop-color="rgb(57,156,255)" offset="1" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="att-g3" x1="16.08" x2="18.19" y1="4.87" y2="2.81" gradientUnits="userSpaceOnUse">
            <stop stop-color="rgb(132,215,251)" offset="0" stop-opacity="0.9" />
            <stop stop-color="rgb(103,203,255)" offset="1" stop-opacity="0.5" />
          </linearGradient>
        </defs>
        {/* 主体 */}
        <path d="M4.263 0L14.994 0C15.2325 0 15.4613 0.0945 15.63 0.2625L20.7353 5.361C20.9048 5.5298 21 5.7593 21 5.9978L21 22.7362C21 23.4338 20.4338 24 19.7362 24L4.263 24C3.5655 24 3 23.4338 3 22.7362L3 1.263C3 0.5655 3.5655 0 4.263 0Z" fill="url(#att-g1)" />
        {/* 斜面阴影层 */}
        <path d="M4.263 0L14.994 0C15.2325 0 15.4613 0.0945 15.63 0.2625L20.7353 5.361C20.9048 5.5298 21 5.7593 21 5.9978L21 22.7362C21 23.4338 20.4338 24 19.7362 24L4.263 24C3.5655 24 3 23.4338 3 22.7362L3 1.263C3 0.5655 3.5655 0 4.263 0Z" fill="url(#att-g2)" />
        {/* 折角高光 */}
        <path d="M15.4935 0.10175L15.5013 0.10958C15.4981 0.10672 15.4968 0.10456 15.4935 0.10175ZM15.7998 0.76863C15.7998 0.78026 15.7996 0.79185 15.7991 0.80339L15.7991 3.9691C15.7991 4.6319 16.3363 5.1691 16.9991 5.1691L20.1865 5.1691C20.4751 5.1691 20.7316 5.309 20.8915 5.5246C20.848 5.4564 20.797 5.3927 20.7388 5.3347L15.58 0.18807C15.7168 0.34284 15.7998 0.54614 15.7998 0.76863Z" fill="url(#att-g3)" />
        {/* W 波形内容线 */}
        <path d="M8.25 10.4663L9.9023 17.0663L12.0255 10.4663L14.1413 17.0663L15.75 10.4663" stroke="white" stroke-linejoin="round" stroke-width="1.2" />
        {/* 上传中：黑色蒙层 */}
        <Show when={props.uploading}>
          <path d="M4.263 0L14.994 0C15.2325 0 15.4613 0.0945 15.63 0.2625L20.7353 5.361C20.9048 5.5298 21 5.7593 21 5.9978L21 22.7362C21 23.4338 20.4338 24 19.7362 24L4.263 24C3.5655 24 3 23.4338 3 22.7362L3 1.263C3 0.5655 3.5655 0 4.263 0Z" fill="rgba(0,0,0,0.4)" />
        </Show>
      </svg>
      {/* 上传中：旋转光芒 */}
      <Show when={props.uploading}>
        <div style={{ position: "absolute", inset: "0", display: "flex", "align-items": "center", "justify-content": "center" }}>
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" class="octo-att-spin" aria-hidden="true">
            {SPIN_ANGLES.map((deg, i) => {
              const rad = (deg - 90) * Math.PI / 180
              return (
                <line
                  x1={6 + 3.1 * Math.cos(rad)} y1={6 + 3.1 * Math.sin(rad)}
                  x2={6 + 5.0 * Math.cos(rad)} y2={6 + 5.0 * Math.sin(rad)}
                  stroke="white" stroke-width="1.2" stroke-linecap="round"
                  opacity={1 - i * 0.1}
                />
              )
            })}
          </svg>
        </div>
      </Show>
    </div>
  )
}

// ── 红色感叹圆圈（10×10）──────────────────────────────────────────
function ExclamationCircleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
      <circle cx="5" cy="5" r="4.45" stroke="rgb(224,33,40)" stroke-width="0.65" />
      <path d="M5 2.7v3.1" stroke="rgb(224,33,40)" stroke-width="0.9" stroke-linecap="round" />
      <circle cx="5" cy="7.15" r="0.55" fill="rgb(224,33,40)" />
    </svg>
  )
}

// ── × 关闭按钮（16×16）──────────────────────────────────────────
function XMarkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="rgba(0,0,0,0.6)" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  )
}

// ── 新版附件 Chip（三态）────────────────────────────────────────
function AttachmentChipNew(props: {
  att: Attachment
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
}): JSX.Element {
  const isError = () => props.att.status === "error"
  const isUploading = () => props.att.status === "uploading"

  return (
    <div style={{
      position: "relative",
      width: "208px",
      height: isError() ? "56px" : "40px",
      background: "rgb(243,243,243)",
      "border-radius": "8px",
      "flex-shrink": "0",
      overflow: "hidden",
    }}>
      {/* 文件图标区（24×24）——错误态图标下移 8px 使其垂直居中于 56px 容器 */}
      <div style={{ position: "absolute", left: "12px", top: isError() ? "16px" : "8px" }}>
        <DocFileIcon uploading={isUploading()} />
      </div>

      {/* 文字区 */}
      <div style={{ position: "absolute", left: "44px", top: "8px", right: "28px" }}>
        {/* 文件名行 */}
        <div style={{
          "font-size": "13px",
          color: "rgba(0,0,0,0.9)",
          "line-height": "24px",
          "white-space": "nowrap",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "font-family": "var(--octo-font, system-ui)",
        }}>
          {props.att.filename}
        </div>

        {/* 错误第二行：! 图标 + 错误文本 + 可选重试按钮 */}
        <Show when={isError()}>
          <div style={{
            display: "flex",
            "align-items": "center",
            gap: "4px",
            height: "18px",
          }}>
            <ExclamationCircleIcon />
            <span style={{
              "font-size": "11px",
              color: "rgb(224,33,40)",
              "white-space": "nowrap",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              flex: "1",
              "min-width": "0",
            }}>
              {props.att.error ?? "上传失败"}
            </span>
            <Show when={props.att.retriable && props.onRetry}>
              <button
                type="button"
                onClick={() => props.onRetry?.(props.att.id)}
                style={{
                  "font-size": "11px",
                  color: "rgb(10,89,247)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0",
                  "flex-shrink": "0",
                  "text-decoration": "underline",
                }}
              >
                重试
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* × 关闭按钮——错误态下移使其垂直居中于 56px 容器 */}
      <button
        type="button"
        onClick={() => props.onRemove(props.att.id)}
        style={{
          position: "absolute",
          right: "12px",
          top: isError() ? "20px" : "12px",
          width: "16px",
          height: "16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
        title="移除"
      >
        <XMarkIcon />
      </button>
    </div>
  )
}

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
          设计稿「容器 30047上传成功/中 + 容器 71039上传失败」。三种状态：done(40px)、uploading(40px+旋转光芒)、error(56px，第二行红色提示)。
        </div>

        {/* ── 各态单独展示 ── */}
        <div style={{ "font-size": "13px", "font-weight": 600, color: "var(--octo-text-primary)", "margin-bottom": "12px" }}>单态预览</div>
        <div style={{ display: "flex", gap: "16px", "flex-wrap": "wrap", "margin-bottom": "32px", "align-items": "flex-start" }}>
          {INITIAL_MOCKS.map((att) => (
            <div>
              <div style={{ "font-size": "11px", color: "var(--octo-text-secondary)", "margin-bottom": "6px" }}>
                {statusLabel[att.status]}{att.retriable ? "（可重试）" : att.status === "error" ? "（不可重试）" : ""}
              </div>
              <AttachmentChipNew att={att} onRemove={() => {}} onRetry={() => {}} />
            </div>
          ))}
        </div>

        {/* ── 模拟输入胶囊里的附件条 ── */}
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
          {/* 附件条：水平滚动，贴合输入胶囊顶部 */}
          <div
            class="octo-attach-strip"
            style={{ display: "flex", "align-items": "flex-start", gap: "8px", padding: "10px 12px 8px", "margin-bottom": "0", background: "var(--octo-surface-page, #fff)", "border-radius": "var(--octo-radius-lg, 8px) var(--octo-radius-lg, 8px) 0 0", "border-bottom": "1px solid var(--octo-border-divider)" }}
          >
            <For each={attachments()}>
              {(att) => (
                <AttachmentChipNew
                  att={att}
                  onRemove={remove}
                  onRetry={retry}
                />
              )}
            </For>
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
          视觉 OK 后落地替换 <code>components/attachment-bar.tsx AttachmentBar</code>。
        </div>
      </div>
    </div>
  )
}
