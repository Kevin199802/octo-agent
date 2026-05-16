# Spec: OutputCard 渲染器与分发

> 服务端返回的内容类型（Markdown 表格 / 思维导图 JSON / 其他）由客户端检测后路由到对应渲染器。  
> 本 spec 是渲染器实现的唯一真相来源。

---

## 1. 输出类型 taxonomy

当前支持 4 种 OutputCard 类型（与 6 个提示词模板的对应见 [insight-analysis-mode.md §2](insight-analysis-mode.md)）：

| 类型 | 触发模板 / 来源 | 服务端返回形态 | 渲染器 | 状态 |
|---|---|---|---|---|
| `table` | 观点解析 / 按提纲聚类 / AI用户画像 / 评估问题整理 | Markdown 表格字符串 | TableRenderer | ✅ 已实现 |
| `mindmap` | 思维导图 | JSON 结构（UXR 现有接口） | MindmapRenderer | ⚠️ 待实现 |
| `html` | 未来富展示类 MCP tool（如独立的用户画像/可视化 tool）| HTML 字符串（建议 ```html``` fence 包裹） | HtmlRenderer | ⚠️ 待实现 |
| `markdown` | 用研知识问答 + 长文本 fallback | Markdown 纯文本 | MarkdownRenderer | ✅ 已实现 |

**未规划**：
- Office 文件应用内预览（docx/pptx/xlsx）—— 伪需求，详见 [ADR-009](../../adr/009-no-office-preview.md)

实际 type 集合最终以 UXR MCP 服务端返回的内容为准——客户端按内容形态路由，不绑定 analysis_type。HTML 渲染器先做基础能力（iframe sandbox），具体由哪些 MCP tool 触发等 UXR 上线后再调整 systemHint。

---

## 2. detectCard 分发规则

### 2.1 现状

`packages/app/src/pages/insight/components/insight-turn.tsx:28` 的 `detectCard`：

```ts
// 优先级从上到下
1. isMarkdownTable(text)             → table
2. /```mermaid/i.test(text)          → mindmap     ← 已废弃逻辑
3. /```json/i.test(text)             → json
4. text.length > 200                 → markdown
```

### 2.2 改造目标

把 mindmap 检测从"```mermaid``` 代码块"改为"JSON 结构匹配"，并加入 HTML 检测。

```ts
// 改造后的优先级
1. isMarkdownTable(text)             → table
2. isMindmapJSON(text)               → mindmap     ← 新规则
3. isHTML(text)                      → html        ← 新规则
4. isPlainJSON(text)                 → json (通用 JSON viewer)
5. text.length > 200                 → markdown
6. (短文本)                          → null（不开 OutputCard，对话内显示）
```

**优先级理由**：mindmap JSON 在 HTML 之前，避免 HTML 内嵌的 JSON-like 字符串误判；HTML 在 plain JSON 之前，因为 HTML 中可能含 `<script>{...}</script>` 这种文本会让 JSON 检测失败但应走 HTML 路径。

### 2.3 检测实现

```ts
// 1. Markdown 表格（现状保留）
function isMarkdownTable(text: string): boolean {
  const lines = text.split("\n")
  return lines.some(l => /^\|.*\|$/.test(l.trim())) &&
         lines.some(l => /^\|[\s\-:|]+\|$/.test(l.trim()))
}

// 2. Mindmap JSON：尝试解析 + shape 匹配
function isMindmapJSON(text: string): boolean {
  const json = tryParseJSON(stripCodeFence(text))
  if (!json) return false
  // UXR 思维导图 JSON 的最小特征：有 children 或 nodes 字段（具体 shape 待 UXR 确认）
  return Array.isArray(json.children) || Array.isArray(json.nodes)
}

// 3. HTML：优先检测 ```html``` fence，fallback 检测 doctype / 顶层标签
function isHTML(text: string): boolean {
  if (/```html\s*\n[\s\S]+?\n```/i.test(text)) return true
  const trimmed = text.trim()
  if (/^<!DOCTYPE\s+html/i.test(trimmed)) return true
  if (/^<html[\s>]/i.test(trimmed)) return true
  // 富 HTML 片段（无 doctype 但顶层是 div/section/article 且有标签密度）
  if (/^<(div|section|article|main|body)[\s>]/i.test(trimmed)) {
    const tagCount = (trimmed.match(/<[a-z][^>]*>/gi) ?? []).length
    return tagCount >= 3
  }
  return false
}

// 4. 通用 JSON
function isPlainJSON(text: string): boolean {
  return tryParseJSON(stripCodeFence(text)) !== null
}

// helper
function stripCodeFence(text: string): string {
  const m = text.match(/```(?:json|mindmap|html)?\s*\n([\s\S]+?)\n```/i)
  return m ? m[1] : text.trim()
}
function tryParseJSON(text: string): any {
  try { return JSON.parse(text) } catch { return null }
}
```

### 2.4 业界对照

| 工具 | 分发方式 |
|---|---|
| ChatGPT / Claude.ai | Code fence + 语言标签优先，启发式 fallback |
| VS Code Chat | 类似 |
| GitHub Markdown | 严格按 fence 语言 |

我们走的是"结构化解析（JSON shape）+ 正则（表格）"的启发式路线，因为：
- UXR 服务端返回的 JSON 不一定带 ```json fence
- Markdown 表格在文档场景里识别率高
- 整体可控（系统提示词约束了输出格式）

`stripCodeFence` 是兼容层：如果 LLM 给 JSON 加了 ```json 也能正确识别。

---

## 3. TableRenderer

### 3.1 现状

`packages/app/src/pages/insight/components/result-viewer/table-renderer.tsx`：
- 输入：Markdown 表格字符串
- 渲染为 HTML `<table>`
- 支持横向滚动、空单元格占位

### 3.2 ActionBar 导出（现状 + 新增 Excel）

`packages/app/src/pages/insight/components/result-viewer/action-bar.tsx`：

**现状：**
- 复制：复制 Markdown 原文
- 下载：表格类型 → CSV（hand-rolled `markdownTableToCSV`）；其他类型 → .md

**改造：**

1. **提取共享 helper**：

```ts
// utils/markdown-table.ts
export function parseMarkdownTable(md: string): string[][] {
  const lines = md.split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith("|"))
    .filter(l => !/^\|[\s\-:|]+\|$/.test(l)) // 去掉分隔行
  return lines.map(l => 
    l.slice(1, -1).split("|").map(c => c.trim())
  )
}
```

2. **CSV 导出**（用 helper）：

```ts
function tableToCSV(md: string): string {
  return parseMarkdownTable(md)
    .map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n")
}
```

3. **Excel 导出**（新增）：

依赖：`write-excel-file`（~30KB，简单 2D 数组→xlsx）

```ts
import writeXlsxFile from "write-excel-file"

async function tableToXlsx(md: string, filename: string) {
  const rows = parseMarkdownTable(md)
  if (rows.length === 0) return
  const data = rows.map(row => row.map(c => ({ value: c, type: String })))
  await writeXlsxFile(data, { fileName: filename })
}
```

4. **ActionBar 按钮**：

```
[复制]  [下载 ▾]
        ├─ Markdown (.md)
        ├─ CSV (.csv)
        └─ Excel (.xlsx)    ← 新增
```

下载按钮改为下拉菜单，避免占用太多空间。或者保留单按钮 + 默认 CSV，加单独的 "导出 Excel" 二级菜单——UI 形态由实现时再定。

### 3.3 Excel 库选择理由

| 库 | 大小 | 评价 |
|---|---|---|
| `write-excel-file` | ~30KB | ✅ 推荐——API 简单，覆盖我们用例 |
| `xlsx` (SheetJS) | ~400KB | 全功能，对我们 overkill |
| `exceljs` | ~600KB | 同上 |

`write-excel-file` 是 ESM、支持 Tree Shaking，对 bundle size 影响最小。

### 3.4 跨平台兼容

Excel 文件在浏览器/Electron 渲染进程**生成 .xlsx 二进制**后下载，不依赖系统 Office。
- Mac：用户拿到 .xlsx，可用 Numbers / Excel for Mac / WPS 打开
- Windows：可用 Excel / WPS / LibreOffice 打开
- 无平台差异

---

## 4. MindmapRenderer（新）

### 4.1 输入

UXR `analyze_interview(analysis_type="mindmap")` 返回的 JSON。实际 shape（UXR 测试环境确认）：

```json
[
  [
    {
      "name": "用研主题",
      "children": [
        {
          "name": "痛点",
          "children": [
            { "name": "调试流程复杂", "children": [] }
          ]
        },
        {
          "name": "机会点",
          "children": []
        }
      ]
    }
  ]
]
```

特征：
- 外层数组包裹数组（双层 `[]`）—— 外层视作 group 列表，内层是该 group 的 root 节点列表
- 每个节点只有两个字段：`name`（string）和 `children`（递归数组）
- 叶子节点 `children` 是空数组 `[]`

### 4.2 渲染库选择

视觉效果是核心需求。对比：

| 库 | 视觉评估 | 工作量 | 维护活跃度 |
|---|---|---|---|
| **markmap-view** | ✅ 手绘曲线连接、节点动画、平滑 pan/zoom，业界 mindmap 视觉标杆（Obsidian Mind Map 用它） | JSON→markdown 适配函数（递归 ~15 行） | 高 |
| AntV G6 mindmap layout | ⚠️ 默认偏"节点图"风格，要做出 mindmap 质感需深度 customize edge/style | 节点+边格式转换 + 大量样式配置 | 极高 |
| jsmind | ⚠️ 默认样式偏旧 | 直接吃 JSON | 中等（更新放缓）|
| mermaid mindmap | ⚠️ 静态 SVG，无交互 | JSON→mermaid 文本 | 高（但已决定不走） |
| ECharts tree | ⚠️ 工业图表风，非 mindmap 风 | 大 | 极高 |

**采用 `markmap-view`**。理由：单论视觉效果优势明显，bundle ~300KB 桌面 app 可接受，适配工作量低。

### 4.3 实现要点

```tsx
// components/result-viewer/mindmap-renderer.tsx
import { Transformer } from "markmap-lib"
import { Markmap } from "markmap-view"
import { onMount, onCleanup } from "solid-js"

const transformer = new Transformer()

export function MindmapRenderer(props: { content: string }) {
  let svgRef: SVGSVGElement | undefined
  let mm: Markmap | undefined

  onMount(() => {
    if (!svgRef) return
    const markdown = uxrJsonToMarkdown(props.content)
    if (!markdown) return
    const { root } = transformer.transform(markdown)
    mm = Markmap.create(svgRef, undefined, root)
  })

  onCleanup(() => mm?.destroy())

  return (
    <svg
      ref={svgRef}
      class="mindmap-canvas"
      style={{ width: "100%", height: "100%" }}
    />
  )
}
```

### 4.4 适配层：UXR JSON → Markdown

```ts
// utils/mindmap-adapter.ts
import { stripCodeFence, tryParseJSON } from "./detect"

export function uxrJsonToMarkdown(text: string): string | null {
  const json = tryParseJSON(stripCodeFence(text))
  if (!Array.isArray(json)) return null

  const roots = json.flat()  // 拆掉外层数组包裹（[[...]] → [...]）
  if (roots.length === 0) return null

  return roots.map(node => renderNode(node, 0)).join("\n")
}

function renderNode(node: { name: string; children?: any[] }, depth: number): string {
  const prefix = depth === 0 ? "# " : "  ".repeat(depth - 1) + "- "
  const line = prefix + (node.name ?? "(空)")
  const childLines = (node.children ?? []).map(c => renderNode(c, depth + 1))
  return [line, ...childLines].join("\n")
}
```

转换示例：
```
[[{name: "主题", children: [{name: "痛点", children: [{name: "A", children: []}]}]}]]
        ↓
# 主题
- 痛点
  - A
        ↓ markmap-lib transformer
INode 树 → markmap-view 渲染为 SVG
```

### 4.5 导出（ActionBar）

| 选项 | 实现 |
|---|---|
| 复制 JSON | 复制原始 JSON 字符串 |
| 下载 .json | blob 下载原始 JSON |
| 导出 SVG | 直接 `svgRef.outerHTML` 序列化下载 |
| 导出 PNG | SVG → canvas → toBlob，P2 视需求实现 |

### 4.6 边界处理

| 场景 | 行为 |
|---|---|
| 外层不是数组 | 解析失败 → §8 错误处理 fallback |
| 外层数组但 flat 后为空 | 显示"思维导图为空"占位 |
| 节点没有 name 字段 | 渲染为 "(空)" |
| children 不是数组 | 视作叶子节点 |

---

## 5. HtmlRenderer（新）

### 5.1 输入

UXR 未来会通过新增 MCP tool（如独立的用户画像可视化 tool）返回 HTML 字符串，可能形态：
- ```html\n<!DOCTYPE html>...\n``` （fence 包裹完整文档，推荐）
- 不带 fence 的完整 `<!DOCTYPE html>...` 文档
- HTML 片段（`<div>...</div>`，无 doctype）

`detectCard` 三种都能识别（见 §2.3）。渲染时统一交给 iframe srcDoc。

### 5.2 渲染：iframe sandbox

HTML 内容来自 LLM/MCP 服务端，**不能信任为完全无害**（即便内网）。用 iframe sandbox 隔离：

```tsx
// components/result-viewer/html-renderer.tsx
export function HtmlRenderer(props: { content: string }) {
  const html = stripCodeFence(props.content)  // 复用 §2.3 的 helper
  
  return (
    <iframe
      sandbox="allow-scripts"
      srcdoc={html}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        background: "white",
      }}
    />
  )
}
```

### 5.3 sandbox 策略

| 属性 | 启用 | 理由 |
|---|---|---|
| `allow-scripts` | ✅ | 可视化（D3/echarts 等内联 JS）需要 |
| `allow-same-origin` | ❌ | **绝不启用**，与 allow-scripts 同时启用相当于无 sandbox |
| `allow-forms` | ❌ | 没有表单提交场景 |
| `allow-top-navigation` | ❌ | 防止 HTML 跳转主窗口 |
| `allow-popups` | ❌ | 防止弹窗骚扰 |
| `allow-modals` | ❌ | 防止 alert/confirm 阻塞 |

只开 `allow-scripts`，其他全关。这样 HTML 里的 JS 能跑（可视化 OK），但拿不到 cookie、没法跳转、没法访问父页面。

### 5.4 srcDoc vs src

用 `srcdoc`（内联 HTML 字符串）而不是 `src=blob:URL`：
- ✅ 简单：不需要管理 blob URL 生命周期
- ✅ 沙箱效果一致
- ⚠️ 注意：`srcdoc` 内容超大（>1MB）时部分浏览器有性能问题，UXR 输出预期 < 100KB，无影响

### 5.5 高度处理

iframe 默认高度 0，需要显式给。三种方案：

| 方案 | 优劣 |
|---|---|
| 固定铺满父容器 + 内部滚动 | ✅ 简单，与 ResultViewer panel 一致 |
| postMessage 通信传 contentHeight | 复杂，需要约定协议 |
| ResizeObserver | 跨 iframe 不可用 |

推荐**方案 1**（固定铺满 + 内部滚动），与 TableRenderer / MindmapRenderer 一致。

### 5.6 ActionBar 导出

| 选项 | 实现 |
|---|---|
| 复制 HTML 源码 | 复制原始字符串（去除 fence） |
| 下载 .html | blob 下载 `text/html;charset=utf-8` |
| 在浏览器打开 | `window.api.openPath(tempFilePath)` 唤起系统默认浏览器（需主进程协助写临时文件） |

前两个 P1 实现，"在浏览器打开" P2 视需求。

### 5.7 安全清单

- [ ] `sandbox` 属性只含 `allow-scripts`，不含 `allow-same-origin`
- [ ] 不在 srcDoc 之外把 HTML 内容插到主文档（避免 XSS）
- [ ] 不允许 HTML 内 JS 通过 postMessage 与父页面通信（默认就不允许）
- [ ] 下载文件时 filename 做基础 sanitize（去掉路径分隔符）

---

## 6. MarkdownRenderer（现状）

长文本 / 知识问答回复走通用 Markdown 渲染（已实现）。无规划变动。

---

## 7. 与 systemHint 的协作

提示词模板的 `systemHint` 已经隐式约束了 LLM 输出格式：

| 模板 | systemHint 约束 | 期望 detectCard 命中 |
|---|---|---|
| 观点解析 | "输出三列 Markdown 表格" | `table` |
| 按提纲聚类 | "Markdown 表格" | `table` |
| AI用户画像 | "画像维度..." | `table` |
| 评估问题整理 | "输出三列..." | `table` |
| 思维导图 | "返回 JSON 直接原样输出" | `mindmap` |
| 用研知识问答 | "基于检索结果回答" | `markdown` |

如果 LLM 输出与预期不符（比如表格模板输出了纯文本），fallback 到 `markdown` 渲染器，不会渲染失败。

---

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| Markdown 表格解析失败（行不齐等） | 渲染前 2 列，剩余忽略；不中断 |
| Mindmap JSON 解析失败 | OutputCard 显示"思维导图数据格式异常"，下方显示原始内容 |
| Excel 库加载失败 | Toast 提示"导出失败，请重试"，CSV 按钮保留可用 |
| HTML 内 JS 执行报错 | iframe 沙箱内静默失败，不影响主窗口；用户可下载 .html 自行排查 |
| HTML 内容为空字符串 | OutputCard 显示"HTML 内容为空"占位，避免空白 iframe |

---

## 9. 验证清单

### 9.0 联调前手动自验（无需 UXR MCP）

> **目的**：单测覆盖 detect 逻辑 / adapter 转换 / CSV 转义等纯逻辑（见 `packages/app/src/pages/insight/utils/detect.test.ts`，26 个 case）。本节流程覆盖**眼睛才能看见的东西**：markmap SVG 是否真画出、iframe 沙箱是否真隔离、.xlsx 在 Numbers/Excel 里是否真打开。
>
> **前置**：InsightPage 配好任意 LLM provider，能正常对话。下列 prompt 直接粘进输入框即可。

#### V0-A 思维导图渲染 + 导出

**粘这条 prompt**：

```
直接输出 JSON，不要任何解释文字，不要 ```json fence。
shape: [[{"name": "...", "children": [{"name": "...", "children": [...]}]}]]
主题"调试工具用户研究"，至少 3 层、8 个节点。
```

**验收**：
- [ ] 对话区出现 OutputCard，类型图标为思维导图（`IconCardMindmap`），标题非空
- [ ] 点开卡片 → ResultViewer 显示 markmap SVG（**手绘曲线连接节点**，不是直线/矩形框）
- [ ] 鼠标滚轮可缩放、拖拽可平移
- [ ] 点节点可折叠/展开子树
- [ ] ActionBar [下载 ▾] → JSON (.json) → 文件能用任意文本编辑器打开，内容是原始 JSON

#### V0-B HTML 可视化 + 沙箱

**粘这条 prompt**：

```
输出一段完整 HTML，用 ```html fence 包裹，含 <!DOCTYPE>、<style>、内联 <script>。
内容：用 div + CSS 画一个 4 柱柱状图（柱高分别 30% / 60% / 80% / 45%，柱子颜色不同）。
<script> 里加 console.log("html-renderer ok")。
```

**验收**：
- [ ] OutputCard 类型图标为 HTML（`IconCardHtml`）
- [ ] 点开卡片 → ResultViewer 渲染出 4 柱柱状图（**真的有不同高度和颜色**，不是源码 pre 块）
- [ ] 打开 DevTools Console → 能看到 `html-renderer ok`（说明 `allow-scripts` 生效）
- [ ] DevTools Elements 检查 iframe → `sandbox="allow-scripts"`，**不含** `allow-same-origin`
- [ ] ActionBar [下载 ▾] → HTML (.html) → 双击下载文件能在浏览器打开

#### V0-C 表格 + Excel 导出

**触发方式**：用现有"观点解析"提示词模板触发一次正常分析（systemHint 已约束 markdown 表格输出）。或粘这条 prompt：

```
输出一个 markdown 表格，3 列，第一列"观点"，第二列"频次"，第三列"代表用户"，至少 5 行真实示例内容（用研场景）。
```

**验收**：
- [ ] OutputCard 类型图标为表格（`IconCardTable`）
- [ ] 点开卡片 → ResultViewer 显示 HTML 表格（表头浅灰、行斑马纹）
- [ ] ActionBar [下载 ▾] 下拉显示 **3 个选项**：Markdown / CSV / Excel
- [ ] 下载 .md → 用文本编辑器打开，是原始 markdown 表格语法
- [ ] 下载 .csv → 双击用 Excel/Numbers 打开，**中文不乱码**，列结构正确
- [ ] 下载 .xlsx → 双击用 Excel/Numbers 打开，**中文不乱码**，列结构正确

#### V0-D fallback 行为

**粘这条 prompt（短文本）**：

```
就回我一个字"好"，不要别的内容。
```

**验收**：
- [ ] 对话区直接显示助手文字"好"，**不开 OutputCard**

**粘这条 prompt（长 markdown）**：

```
写一段约 300 字的用研访谈纪要，包含 # 一级标题、若干 ## 二级标题、若干 - 项目。不要表格，不要 JSON，不要 HTML。
```

**验收**：
- [ ] OutputCard 类型图标为 Markdown（`IconCardMarkdown`）
- [ ] 点开卡片 → ResultViewer 用 markdown 渲染（标题大小不同、列表有缩进）

---

### 9.1 已被单测覆盖的部分（无需手动）

下列项已在 `detect.test.ts` 验证，改代码会自动回归，不必每次手动跑：

- detectCard 优先级（table > mindmap JSON > HTML > plain JSON > markdown）
- `isMindmapJSON` 对带 fence / 不带 fence / 单根 / 双层数组 shape 的识别
- `isHTML` 对 fence / doctype / 富片段（≥3 标签）的识别
- `parseMarkdownTable` 切分 + `tableToCSV` 引号转义
- `uxrJsonToMarkdown` 双层数组 → markmap markdown 转换、空节点占位、空数组返回 null

---

## 10. Phase 与依赖

| 工作项 | Phase | 依赖 |
|---|---|---|
| detectCard 改造（mermaid → mindmap JSON + HTML 检测） | 当前可做 | 无 |
| TableRenderer Excel 导出 + parseMarkdownTable helper | 当前可做 | 无 |
| MindmapRenderer + 适配层 | 当前可做（用 mock JSON 调试） | UXR mindmap JSON 实际 shape（待 MCP 联调时确认并调整 adapter）|
| HtmlRenderer + sandbox iframe + 下载 | 当前可做（用 mock HTML 调试） | 无（UXR 上线 HTML tool 后无需改客户端，已 ready）|

**联调期可能的小调整**：
- mindmap：`parseMindmapJSON` (§4.4) adapter 字段名根据 UXR 实际 shape 微调
- html：如 UXR 输出 HTML 不带 fence 也不带 doctype，可能需要在 `isHTML` (§2.3) 加更宽松的检测规则
