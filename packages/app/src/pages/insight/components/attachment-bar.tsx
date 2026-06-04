import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { fileTypeIconUrl } from "../icons/illustrations"

export type AttachmentStatus = "uploading" | "done" | "error"

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  status: AttachmentStatus
  url?: string // status=done 时有
  error?: string // status=error 时有
  // 是否可重传：仅"通过校验、真正发起过上传"的失败 chip 可重传(filesById 里有原 File)。
  // 客户端校验失败(扩展名/大小/空文件)的 chip 重试同文件必然同错,不提供重试,只能删除重选。
  retriable?: boolean
}

// 8 条旋转光芒的角度
const SPIN_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

// 文件类型图标（24×24）— 按 filename/mime 走 fileTypeIconUrl(与结果卡 / FileFallback 同源)。
// 上传中:图标上叠半透明黑遮罩 + 白色旋转光芒。
function FileTypeIcon(props: { filename: string; mime: string; uploading?: boolean }): JSX.Element {
  return (
    <div style={{ position: "relative", width: "24px", height: "24px", "flex-shrink": "0" }}>
      <img
        src={fileTypeIconUrl(props.filename, props.mime)}
        width={24}
        height={24}
        alt=""
        aria-hidden="true"
        style={{ display: "block" }}
      />
      <Show when={props.uploading}>
        <div
          style={{
            position: "absolute",
            inset: "0",
            background: "rgba(0,0,0,0.4)",
            "border-radius": "4px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
          }}
        >
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

function ExclamationCircleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
      <circle cx="5" cy="5" r="4.45" stroke="rgb(224,33,40)" stroke-width="0.65" />
      <path d="M5 2.7v3.1" stroke="rgb(224,33,40)" stroke-width="0.9" stroke-linecap="round" />
      <circle cx="5" cy="7.15" r="0.55" fill="rgb(224,33,40)" />
    </svg>
  )
}

function XMarkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="rgba(0,0,0,0.6)" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  )
}

function AttachmentChip(props: {
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
      {/* 文件图标区——错误态下移 8px 使其垂直居中于 56px 容器 */}
      <div style={{ position: "absolute", left: "12px", top: isError() ? "16px" : "8px" }}>
        <FileTypeIcon filename={props.att.filename} mime={props.att.mime} uploading={isUploading()} />
      </div>

      {/* 文字区 */}
      <div style={{ position: "absolute", left: "44px", top: "8px", right: "28px" }}>
        <div style={{
          "font-size": "13px",
          color: "rgba(0,0,0,0.9)",
          "line-height": "24px",
          "white-space": "nowrap",
          overflow: "hidden",
          "text-overflow": "ellipsis",
        }}>
          {props.att.filename}
        </div>

        {/* 错误第二行：感叹圆 + 错误文本 + 可选重试按钮 */}
        <Show when={isError()}>
          <div style={{ display: "flex", "align-items": "center", gap: "4px", height: "18px" }}>
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

export function AttachmentBar(props: {
  attachments: Attachment[]
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
}): JSX.Element {
  return (
    <Show when={props.attachments.length > 0}>
      <div
        class="octo-attach-strip"
        style={{
          display: "flex",
          "align-items": "flex-start",
          gap: "8px",
          padding: "10px 12px 8px",
          "overflow-x": "auto",
          "flex-shrink": "0",
        }}
      >
        <For each={props.attachments}>
          {(att) => (
            <AttachmentChip
              att={att}
              onRemove={props.onRemove}
              onRetry={props.onRetry}
            />
          )}
        </For>
      </div>
    </Show>
  )
}
