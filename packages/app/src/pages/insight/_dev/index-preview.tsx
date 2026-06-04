import "../octo-tokens.css"
import { For, type JSX } from "solid-js"
import { A } from "@solidjs/router"

/**
 * Dev-only 预览索引页 — 列出所有 /_dev/* 样式沙箱页,统一入口互相跳转。
 *
 * 路由:/_dev(见 app.tsx)。新增 dev 预览页时,在下方 DEV_PAGES 加一条
 * (并按 docs/development.md §8.3 注册路由)。
 */

const DEV_PAGES: { path: string; title: string; desc: string }[] = [
  {
    path: "/_dev/insight-cards",
    title: "Insight 卡片预览",
    desc: "任务卡片(5 态)+ 文件结果卡片(6 类)",
  },
  {
    path: "/_dev/typography",
    title: "对话区排版样张",
    desc: "正文 / 思维链每个元素的现状取证,含思维链容器提案粗 UI",
  },
  {
    path: "/_dev/result-tabs",
    title: "ResultViewer TabBar 溢出",
    desc: "产出 tab 较多时横向溢出现状:能滚但无滚动条 / 无左右箭头",
  },
  {
    path: "/_dev/file-fallback",
    title: "FileFallback 新 UI",
    desc: "不可预览文件兜底面板新设计:渐变背景 + 大图标 + 三按钮(图标占位待替换)",
  },
  {
    path: "/_dev/attachment-bar",
    title: "上传文件 Chip 新 UI",
    desc: "输入框上方附件条三态:上传成功(40px)、上传中(旋转光芒)、上传失败(56px 红色提示行)",
  },
  {
    path: "/_dev/panel-header",
    title: "ConversationHeader 布局验证",
    desc: "复现「产出(N)按钮遮挡三点菜单」bug，验证 badge 移入 header flex 行后三点始终可点",
  },
  {
    path: "/_dev/attachment-parse",
    title: "上传卡片解析验证（文件名带空格）",
    desc: "复现「发送后对话框上方文件列表丢带空格文件名」真bug：对比旧正则（\\S+遇空格截断丢行）与新indexOf切分（全保留）",
  },
]

export default function DevIndexPage(): JSX.Element {
  return (
    <div
      class="size-full overflow-y-auto"
      style={{
        background: "var(--octo-shell-bg, #f5f6f8)",
        "font-family": "var(--octo-font, system-ui)",
      }}
    >
      <div class="mx-auto" style={{ "max-width": "640px", padding: "48px 24px 80px" }}>
        <div style={{ "margin-bottom": "8px", "font-size": "22px", "font-weight": 600, color: "var(--octo-text-strong)" }}>
          Dev 预览索引
        </div>
        <div style={{ "margin-bottom": "28px", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          样式沙箱:mock 数据渲染真实组件,纯本地,不连 SDK / Sync。仅 DEV 构建可访问。
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
          <For each={DEV_PAGES}>
            {(page) => (
              <A href={page.path} style={{ "text-decoration": "none" }}>
                <div
                  style={{
                    background: "var(--octo-surface-page, #fff)",
                    "border-radius": "var(--octo-radius-md, 8px)",
                    border: "1px solid var(--octo-border-divider, #eee)",
                    padding: "16px 18px",
                    transition: "border-color .15s",
                  }}
                >
                  <div style={{ "font-size": "15px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "4px" }}>
                    {page.title}
                  </div>
                  <div style={{ "font-size": "13px", color: "var(--octo-text-secondary)", "margin-bottom": "6px" }}>
                    {page.desc}
                  </div>
                  <div
                    style={{
                      "font-size": "12px",
                      color: "var(--octo-text-disabled)",
                      "font-family": "var(--octo-font-mono, ui-monospace, monospace)",
                    }}
                  >
                    {page.path}
                  </div>
                </div>
              </A>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
