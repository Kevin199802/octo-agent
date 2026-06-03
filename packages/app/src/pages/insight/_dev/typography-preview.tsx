import "../octo-tokens.css"
import "./typography-token-preview.css"
import { createSignal, For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { Markdown } from "@opencode-ai/ui/markdown"

/**
 * Dev-only 预览页 — 对话区排版「现状取证」样张。
 *
 * 路由:/_dev/typography(见 app.tsx)。不连 SDK / Sync,纯静态样张。
 * 目的:把正文 / 思维链每个元素可靠渲染出来截图给设计师(真实对话里元素不齐、
 *       思维链不是每轮触发)。详见 docs/specs/ui/reasoning-content-typography.md。
 *
 * 注意:
 * - 正文 / 思维链用**真实** <Markdown> 与 data-component="reasoning-part" 渲染,
 *   样式来自上游(全局已加载 @opencode-ai/ui/styles),dev 页改不到,只用于取证。
 * -「思维链容器 / 标签 / 折叠」是**未实现的提案粗 UI**(inline 样式),仅供设计参考形态,
 *   真实实现将落到 insight 作用域覆盖层,不在本页。
 */
export default function TypographyPreviewPage(): JSX.Element {
  return (
    <div
      class="size-full overflow-y-auto"
      style={{
        background: "var(--octo-shell-bg, #f5f6f8)",
        "font-family": "var(--octo-font, system-ui)",
      }}
    >
      <div class="mx-auto" style={{ "max-width": "760px", padding: "32px 24px 80px" }}>
        <Header />

        <Section title="① 正文 — 全元素样张" subtitle="<Markdown /> · @opencode-ai/ui/markdown">
          <Frame label="⚠️ 重点核对:H1–H6 当前全为 14px,无字号分级;代码块 13px 硬编码;斜体无样式;数学公式是否渲染">
            <div style={{ padding: "16px 20px" }}>
              <Markdown text={CONTENT_SAMPLE} streaming={false} />
            </div>
          </Frame>
        </Section>

        <Section
          title="② 思维链 — 现状(平铺弱化,无边界)"
          subtitle='data-component="reasoning-part" + <Markdown /> · 上游现状'
        >
          <Frame label="⚠️ 这就是痛点:思维链与下方正文仅靠 13px/灰区分,平铺无容器/标签,边界模糊">
            <div style={{ padding: "16px 20px" }}>
              <div data-component="reasoning-part">
                <Markdown text={REASONING_SAMPLE} streaming={false} />
              </div>
              <div data-component="markdown" style={{ "margin-top": "8px" }}>
                <Markdown text={"这是紧随其后的**正文回答**,用于对照——能否一眼分清上面是思考、这里是回答?"} streaming={false} />
              </div>
            </div>
          </Frame>
        </Section>

        <Section title="③ 思维链容器 — 提案粗 UI(未实现,供设计参考形态)" subtitle="inline mock · 真实实现将落 insight 覆盖层">
          <Frame label="提案 A — 左竖线(DeepSeek 风)">
            <div style={{ padding: "16px 20px" }}>
              <ReasoningProposalBorderLeft />
            </div>
          </Frame>
          <Frame label="提案 B — 浅底块(Claude 风)">
            <div style={{ padding: "16px 20px" }}>
              <ReasoningProposalSurface />
            </div>
          </Frame>
          <Frame label="提案 C — 可折叠(ChatGPT 风,业界标配)">
            <div style={{ padding: "16px 20px" }}>
              <ReasoningProposalCollapsible />
            </div>
          </Frame>
        </Section>

        <Section title="④ 弱模型降级态" subtitle="无 reasoning part → 纯正文">
          <Frame label="不返回思维链的模型:无任何思考 UI,只有正文(不应出现空容器 / 孤标签)">
            <div style={{ padding: "16px 20px" }}>
              <Markdown text={"根据访谈数据,Top 3 痛点集中在登录流程、算子配置与报表导出。建议优先优化登录流程。"} streaming={false} />
            </div>
          </Frame>
        </Section>

        <Section title="⑤ tokens.md 映射表" subtitle="docs/tokens.md → 18 元素;⚠️ = tokens.md 未覆盖,需设计师补">
          <Frame label="每个元素可参照的 tokens.md token(字号规格 / 颜色 / 间距 / 圆角)">
            <MappingTable />
          </Frame>
        </Section>

        <Section title="⑥ token 应用预览(套 tokens.md,对照 ① 现状)" subtitle=".octo-md-token-preview · 草稿覆盖层,真实实现将迁 insight 层">
          <Frame label="正文 — 套 tokens.md(注意 H1–H6 出现字号分级,对比 ① 全 14px)">
            <div class="octo-md-token-preview" style={{ padding: "16px 20px" }}>
              <Markdown text={CONTENT_SAMPLE} streaming={false} />
            </div>
          </Frame>
          <Frame label="思维链 — 套 tokens.md(辅助说明 12/20 · text.secondary)">
            <div class="octo-md-token-preview" style={{ padding: "16px 20px" }}>
              <div data-component="reasoning-part">
                <Markdown text={REASONING_SAMPLE} streaming={false} />
              </div>
            </div>
          </Frame>
        </Section>
      </div>
    </div>
  )
}

// ── 提案粗 UI ─────────────────────────────────────────
// 仅 inline mock,展示形态;真实样式由设计师定稿后落 insight 覆盖层。

const PROPOSAL_LABEL = "思考过程"

function ReasoningProposalBorderLeft(): JSX.Element {
  return (
    <div style={{ "border-left": "2px solid var(--octo-border-divider, #e5e5e5)", "padding-left": "14px" }}>
      <div style={{ "font-size": "12px", "font-weight": 500, color: "var(--octo-text-secondary, #8f8f8f)", "margin-bottom": "2px" }}>
        {PROPOSAL_LABEL}
      </div>
      <div data-component="reasoning-part">
        <Markdown text={REASONING_SAMPLE} streaming={false} />
      </div>
    </div>
  )
}

function ReasoningProposalSurface(): JSX.Element {
  return (
    <div
      style={{
        background: "var(--octo-surface-raised, #f7f7f8)",
        "border-radius": "8px",
        border: "1px solid var(--octo-border-divider, #eee)",
        padding: "12px 14px",
      }}
    >
      <div style={{ "font-size": "12px", "font-weight": 500, color: "var(--octo-text-secondary, #8f8f8f)", "margin-bottom": "4px" }}>
        💭 {PROPOSAL_LABEL}
      </div>
      <div data-component="reasoning-part">
        <Markdown text={REASONING_SAMPLE} streaming={false} />
      </div>
    </div>
  )
}

function ReasoningProposalCollapsible(): JSX.Element {
  const [open, setOpen] = createSignal(true)
  return (
    <div
      style={{
        border: "1px solid var(--octo-border-divider, #eee)",
        "border-radius": "8px",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open())}
        style={{
          width: "100%",
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          "font-size": "13px",
          "font-weight": 500,
          color: "var(--octo-text-secondary, #8f8f8f)",
          "text-align": "left",
        }}
      >
        <span style={{ transform: open() ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        {PROPOSAL_LABEL}
        <span style={{ "font-weight": 400, color: "var(--octo-text-disabled, #c7c7c7)" }}>
          {open() ? "点击折叠" : "点击展开"}
        </span>
      </button>
      <div style={{ display: open() ? "block" : "none", padding: "0 14px 12px" }}>
        <div data-component="reasoning-part">
          <Markdown text={REASONING_SAMPLE} streaming={false} />
        </div>
      </div>
    </div>
  )
}

// ── 布局辅助(copy 自 cards-preview.tsx) ────────────────

function Header(): JSX.Element {
  return (
    <div style={{ "margin-bottom": "24px" }}>
      <A href="/_dev" style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}>
        ← Dev 索引
      </A>
      <div style={{ "font-size": "20px", "font-weight": 600, color: "var(--octo-text-strong)", "margin": "8px 0 4px" }}>
        对话区排版样张(dev only)
      </div>
      <div style={{ "font-size": "13px", color: "var(--octo-text-secondary)" }}>
        正文 / 思维链取证用。真实 &lt;Markdown&gt; 渲染;③ 为未实现提案粗 UI。亮 / 暗各截一遍交设计师。
      </div>
    </div>
  )
}

function Section(props: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "margin-bottom": "40px" }}>
      <div style={{ "font-size": "15px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "2px" }}>
        {props.title}
      </div>
      <div
        style={{
          "font-size": "11px",
          color: "var(--octo-text-disabled)",
          "font-family": "var(--octo-font-mono, ui-monospace, monospace)",
          "margin-bottom": "12px",
        }}
      >
        {props.subtitle}
      </div>
      {props.children}
    </div>
  )
}

function Frame(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "margin-bottom": "16px" }}>
      <div style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "margin-bottom": "6px" }}>{props.label}</div>
      <div
        style={{
          background: "var(--octo-surface-page, #fff)",
          "border-radius": "var(--octo-radius-md, 8px)",
          border: "1px solid var(--octo-border-divider, #eee)",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

// ── tokens.md 映射表 ──────────────────────────────────

type MapRow = { el: string; font: string; color: string; other: string; gap?: boolean }

const MAPPING: { group: string; rows: MapRow[] }[] = [
  {
    group: "正文(15)",
    rows: [
      { el: "H1", font: "24/32/Semibold", color: "text.strong", other: "标题层级·H1" },
      { el: "H2", font: "20/28/Semibold", color: "text.strong", other: "标题层级·H2" },
      { el: "H3", font: "16/24/Medium", color: "text.strong", other: "标题层级·H3" },
      { el: "H4", font: "14/22/Medium", color: "text.strong", other: "标题层级·H4" },
      { el: "H5 / H6", font: "13 / 12（外推）", color: "text.strong / secondary", other: "tokens.md 仅到 H4,需补", gap: true },
      { el: "段落", font: "14/22/Regular", color: "text.primary", other: "主文本" },
      { el: "加粗", font: "+Semibold", color: "text.strong", other: "—" },
      { el: "斜体", font: "italic", color: "text.primary", other: "无专门 token" },
      { el: "链接", font: "14/22", color: "brand.primary / hover brand.primary.hover", other: "—" },
      { el: "有序/无序列表", font: "14/22", color: "text.primary;marker text.secondary", other: "缩进 space.8" },
      { el: "嵌套列表", font: "—", color: "—", other: "缩进 space.4" },
      { el: "引用块", font: "14/22", color: "text.secondary", other: "左边框 border.default;内距 space.3" },
      { el: "分割线", font: "—", color: "border.default", other: "间距 space.8" },
      { el: "行内代码", font: "13", color: "text.tertiary（近似）", other: "tokens.md 无 mono 字体/语义色", gap: true },
      { el: "代码块", font: "13", color: "text.tertiary（近似）", other: "边框 border.default;圆角 radius.lg;内距 space.3;⚠️无语法高亮色", gap: true },
      { el: "表格", font: "14/22;表头 Medium", color: "text.primary;表头 text.strong", other: "线 border.default;内距 space.3" },
      { el: "图片", font: "—", color: "—", other: "圆角 radius.sm" },
      { el: "数学公式", font: "（KaTeX）", color: "text.primary", other: "tokens.md 无,需设计师定", gap: true },
    ],
  },
  {
    group: "思维链(3)",
    rows: [
      { el: "思维链正文", font: "12/20/Regular", color: "text.secondary", other: "辅助说明" },
      { el: "思考指示器", font: "12–14", color: "text.secondary", other: "动效 duration.normal" },
      { el: "单行摘要", font: "12/20", color: "text.tertiary / Disabled #BFBFBF", other: "easing" },
    ],
  },
  {
    group: "思维链新增三件套(本期做,tokens.md 可复用)",
    rows: [
      { el: "容器", font: "—", color: "边框 border.default", other: "圆角 radius.lg;左竖线 border.default" },
      { el: "标签", font: "12/20/Medium", color: "text.secondary", other: "间距 space.2" },
      { el: "折叠", font: "箭头 14px", color: "text.secondary", other: "动效 duration.normal + easing" },
    ],
  },
]

function MappingTable(): JSX.Element {
  const cell: JSX.CSSProperties = {
    padding: "7px 10px",
    "border-bottom": "1px solid var(--octo-border-divider, #eee)",
    "vertical-align": "top",
    "text-align": "left",
  }
  const head: JSX.CSSProperties = { ...cell, "font-weight": 600, color: "var(--octo-text-strong)", background: "#fafafa" }
  return (
    <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "12px", "line-height": "1.5" }}>
      <thead>
        <tr>
          <th style={head}>元素</th>
          <th style={head}>字号/行高/字重</th>
          <th style={head}>颜色 token</th>
          <th style={head}>间距/圆角/边框 / 备注</th>
        </tr>
      </thead>
      <tbody>
        <For each={MAPPING}>
          {(g) => (
            <>
              <tr>
                <td
                  colspan={4}
                  style={{ ...cell, "font-weight": 600, color: "var(--octo-text-secondary)", background: "#f5f6f8" }}
                >
                  {g.group}
                </td>
              </tr>
              <For each={g.rows}>
                {(r) => (
                  <tr style={r.gap ? { background: "#fffbe6" } : undefined}>
                    <td style={{ ...cell, "font-weight": 500, color: "var(--octo-text-strong)" }}>
                      {r.gap ? "⚠️ " : ""}
                      {r.el}
                    </td>
                    <td style={cell}>{r.font}</td>
                    <td style={cell}>{r.color}</td>
                    <td style={cell}>{r.other}</td>
                  </tr>
                )}
              </For>
            </>
          )}
        </For>
      </tbody>
    </table>
  )
}

// ── 样张内容(array.join 避免代码围栏与模板字符串冲突) ──

const CONTENT_SAMPLE = [
  "# H1 标题",
  "## H2 标题",
  "### H3 标题",
  "#### H4 标题",
  "##### H5 标题",
  "###### H6 标题",
  "",
  "正文段落，含 **加粗**、*斜体*、`行内代码`、[链接](https://example.com)，及裸 URL https://example.com/docs",
  "",
  "- 无序项 A",
  "- 无序项 B",
  "  - 嵌套 B-1",
  "  - 嵌套 B-2",
  "",
  "1. 有序项 1",
  "2. 有序项 2",
  "",
  "> 引用块 blockquote。",
  "",
  "---",
  "",
  "```ts",
  "export const value = 42 // 代码块 + 复制按钮",
  "```",
  "",
  "| 列 A | 列 B |",
  "|---|---|",
  "| 单元格 1 | 单元格 2 |",
  "| 单元格 3 | 单元格 4 |",
  "",
  "![示例图片](https://via.placeholder.com/120)",
  "",
  "数学公式：$E = mc^2$",
].join("\n")

const REASONING_SAMPLE = [
  "我需要先拆解这个问题。",
  "",
  "**第一步**:明确目标——用户想区分思维链和正文。",
  "",
  "可能的方案:",
  "1. 左竖线容器",
  "2. 浅底块",
  "3. 折叠面板",
  "",
  "对比后,`左竖线` 最轻量,先验证可行性……",
].join("\n")
