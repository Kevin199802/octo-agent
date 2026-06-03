import "../octo-tokens.css"
import { createSignal, For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { fileTypeIconUrl } from "../icons/illustrations"
import folderBlueUrl from "../icons/IconFolderBlue.svg?url"

/**
 * Dev-only 样张:FileFallback 新 UI 布局预览。
 *
 * 复现设计稿「容器 30044 新的整体 ui.svg」的 FileFallback 样式:
 * 渐变氛围背景 + 大文件图标 + 文件名标题 + 副标题 + 分隔线 + 三按钮。
 *
 * 文件类型图标通过 fileTypeIconUrl() 按扩展名/mimeType 自动映射。
 * 不依赖 SDK / Sync / 文件上传,纯 mock 数据。
 *
 * 路由:/_dev/file-fallback(见 dev-routes.tsx)。
 */

// ── mock 场景:覆盖全部文件类型图标 ──────────────────────────────
const MOCK_FILES = [
  { label: "DOCX", fileName: "算子开发工具 访谈观点聚类报告.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { label: "XLSX", fileName: "用户满意度评分汇总.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { label: "PPTX", fileName: "产品路线图规划.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { label: "PDF",  fileName: "调研报告终稿.pdf", mimeType: "application/pdf" },
  { label: "HTML", fileName: "落地页交互原型.html", mimeType: "text/html" },
  { label: "MD",   fileName: "用户旅程地图分析.md", mimeType: "text/markdown" },
  { label: "MAP",  fileName: "需求优先级思维导图.json", mimeType: "application/json+mindmap" },
  { label: "MP4",  fileName: "访谈录屏回放.mp4", mimeType: "video/mp4" },
  { label: "PNG",  fileName: "用户画像图.png", mimeType: "image/png" },
  { label: "PY",   fileName: "数据清洗脚本.py", mimeType: "text/x-python" },
  { label: "其他", fileName: "原始录音文件.mp3", mimeType: "audio/mpeg" },
]

// ── 新版 FileFallback 组件 ────────────────────────────────────
function FileFallbackNew(props: {
  fileName: string
  mimeType: string
  openBusy?: boolean
  revealBusy?: boolean
  downloadBusy?: boolean
}): JSX.Element {
  const iconUrl = () => fileTypeIconUrl(props.fileName, props.mimeType)

  return (
    <div
      class="relative flex flex-col items-center justify-center h-full overflow-hidden"
      style={{ background: "linear-gradient(145deg, #EEF4FF 0%, #F5F0FF 45%, #EFF8FF 100%)" }}
    >
      {/* 装饰光晕:左下蓝 */}
      <div class="pointer-events-none absolute" style={{ width: "560px", height: "560px", left: "-100px", bottom: "-120px", "border-radius": "50%", background: "radial-gradient(circle, rgba(10,89,247,0.20) 0%, rgba(10,89,247,0) 70%)" }} />
      {/* 装饰光晕:右下紫 */}
      <div class="pointer-events-none absolute" style={{ width: "500px", height: "500px", right: "-80px", bottom: "-80px", "border-radius": "50%", background: "radial-gradient(circle, rgba(123,97,255,0.18) 0%, rgba(123,97,255,0) 70%)" }} />
      {/* 装饰光晕:左上紫(较大) */}
      <div class="pointer-events-none absolute" style={{ width: "758px", height: "758px", left: "-108px", top: "calc(50% - 200px)", "border-radius": "50%", background: "radial-gradient(circle, rgba(123,97,255,0.18) 0%, rgba(123,97,255,0) 70%)" }} />

      <div class="relative z-10 flex flex-col items-center" style={{ width: "560px", "max-width": "calc(100% - 48px)" }}>
        {/* 文件类型图标 72×72 */}
        <img src={iconUrl()} width={72} height={72} alt="" aria-hidden="true" style={{ "margin-bottom": "20px" }} />

        {/* 文件名标题 */}
        <div style={{ "font-size": "20px", "font-weight": 700, color: "var(--octo-text-strong, #0a0a0a)", "line-height": 1.4, "text-align": "center", "word-break": "break-all", "margin-bottom": "8px", "max-width": "500px" }}>
          {props.fileName}
        </div>

        {/* 副标题 */}
        <div style={{ "font-size": "14px", color: "var(--octo-text-secondary, #6b7280)", "margin-bottom": "20px", "text-align": "center" }}>
          文档已生成完成，可选择以下方式查看
        </div>

        {/* 分隔线 */}
        <div style={{ width: "100%", "max-width": "400px", height: "1px", background: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.07) 50%, transparent 100%)", "margin-bottom": "20px" }} />

        {/* 三按钮行 */}
        <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "justify-content": "center" }}>
          {/* 主按钮:本地打开 — 实心蓝 */}
          <button type="button" disabled={props.openBusy} style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "none", background: "rgb(10,89,247)", color: "#fff", "font-size": "13px", "font-weight": 500, cursor: props.openBusy ? "not-allowed" : "pointer", opacity: props.openBusy ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="#fff" stroke-width="1.4"/>
              <path d="M5.5 14.5h5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M8 12v2.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            {props.openBusy ? "打开中…" : "本地打开"}
          </button>

          {/* 次按钮:文件夹打开 — 浅灰底蓝字 */}
          <button type="button" disabled={props.revealBusy} style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "1px solid var(--octo-border-default, #e5e7eb)", background: "rgba(243,243,243,1)", color: "rgba(10,89,247,1)", "font-size": "13px", cursor: props.revealBusy ? "not-allowed" : "pointer", opacity: props.revealBusy ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}>
            <img src={folderBlueUrl} width={14} height={12} alt="" aria-hidden="true" />
            {props.revealBusy ? "定位中…" : "文件夹打开"}
          </button>

          {/* 次按钮:下载 — 浅灰底蓝字 */}
          <button type="button" disabled={props.downloadBusy} style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "1px solid var(--octo-border-default, #e5e7eb)", background: "rgba(243,243,243,1)", color: "rgba(10,89,247,1)", "font-size": "13px", cursor: props.downloadBusy ? "not-allowed" : "pointer", opacity: props.downloadBusy ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2.5 11.5v1A1.5 1.5 0 004 14h8a1.5 1.5 0 001.5-1.5v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            {props.downloadBusy ? "保存中…" : "下载"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 预览页主体 ──────────────────────────────────────────────
export default function FileFallbackPreviewPage(): JSX.Element {
  const [selected, setSelected] = createSignal(0)
  const [openBusy, setOpenBusy] = createSignal(false)
  const [revealBusy, setRevealBusy] = createSignal(false)
  const [downloadBusy, setDownloadBusy] = createSignal(false)
  const file = () => MOCK_FILES[selected()]!

  function toggleBusy(setter: (v: boolean) => void) {
    setter(true)
    setTimeout(() => setter(false), 1500)
  }

  return (
    <div class="size-full overflow-y-auto" style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}>
      <div class="mx-auto" style={{ "max-width": "760px", padding: "40px 24px 80px" }}>
        <A href="/_dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>← Dev 预览索引</A>

        <div style={{ "margin-top": "12px", "margin-bottom": "4px", "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)" }}>FileFallback 新 UI</div>
        <div style={{ "margin-bottom": "20px", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          设计稿「容器 30044 新的整体 ui.svg」。图标通过 <code>fileTypeIconUrl()</code> 按扩展名/mimeType 自动选取。
        </div>

        {/* 文件类型选择 */}
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-bottom": "14px", "align-items": "center" }}>
          <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "align-self": "center" }}>文件类型：</span>
          <For each={MOCK_FILES}>
            {(f, i) => (
              <button type="button" onClick={() => setSelected(i())} style={{ "font-size": "12px", padding: "4px 10px", "border-radius": "6px", cursor: "pointer", border: "1px solid var(--octo-border-default, #ddd)", background: selected() === i() ? "var(--octo-brand, #6b4eff)" : "var(--octo-surface-page, #fff)", color: selected() === i() ? "#fff" : "var(--octo-text-primary)" }}>
                {f.label}
              </button>
            )}
          </For>
        </div>

        {/* busy 状态模拟 */}
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-bottom": "20px", "align-items": "center" }}>
          <span style={{ "font-size": "12px", color: "var(--octo-text-secondary)" }}>模拟 busy：</span>
          {[
            { label: "本地打开", setter: setOpenBusy },
            { label: "文件夹打开", setter: setRevealBusy },
            { label: "下载", setter: setDownloadBusy },
          ].map(({ label, setter }) => (
            <button type="button" onClick={() => toggleBusy(setter)} style={{ "font-size": "12px", padding: "3px 10px", "border-radius": "6px", cursor: "pointer", border: "1px solid var(--octo-border-default, #ddd)", background: "var(--octo-surface-page,#fff)", color: "var(--octo-text-primary)" }}>
              {label}
            </button>
          ))}
        </div>

        {/* 渲染区:模拟 ResultViewer 右栏 */}
        <div style={{ width: "560px", "max-width": "100%", height: "380px", border: "1px solid var(--octo-border-divider, #eee)", "border-radius": "var(--octo-radius-md, 8px)", overflow: "hidden", "box-shadow": "0 1px 3px rgba(0,0,0,.06)" }}>
          <FileFallbackNew
            fileName={file().fileName}
            mimeType={file().mimeType}
            openBusy={openBusy()}
            revealBusy={revealBusy()}
            downloadBusy={downloadBusy()}
          />
        </div>

        <div style={{ "margin-top": "14px", "font-size": "12px", color: "var(--octo-text-disabled)", "line-height": 1.7 }}>
          画框 560×380 模拟 ResultViewer 右栏。视觉 OK 后落地替换 <code>result-viewer/index.tsx FileFallback</code>。
        </div>
      </div>
    </div>
  )
}
