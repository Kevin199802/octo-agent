# SPEC-INS-003 — 中间面板结果查看器（ResultViewer）

> 状态：草案 · 优先级 P1 · 规模 [L] · 领域 ui/insight
>
> 上游已实现：✓ Markdown 渲染（marked + shiki + KaTeX）；✓ HTML 表格；✗ Mermaid；✗ Tab 管理；✗ 结果查看器框架

---

## 1. 目标

InsightPage 中间面板：**多 Tab 并列显示** agent 产出结果，支持表格、Mermaid 思维导图、Markdown 文档、文件预览四种渲染模式，对应用研场景的典型输出物。

---

## 2. 上游现状

| 能力 | 状态 | 备注 |
|---|---|---|
| Markdown 渲染（`<Markdown>`） | ✓ | `packages/ui/src/context/marked.tsx`，可直接 import |
| HTML 表格（markdown `\|...\|`） | ✓ | marked 内置，DOMPurify 允许 HTML |
| 代码高亮（shiki） | ✓ | 随 `<Markdown>` 一起工作 |
| KaTeX 数学公式 | ✓ | 随 `<Markdown>` 一起工作 |
| **Mermaid 流程图** | ✗ | 需在 insight/ 内引入 `mermaid` 包 |
| **Tab 管理器** | ✗ | 需自写 |
| **结果查看器框架** | ✗ | 需自写 |

---

## 3. 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│  [Tab] 算子开发工具访谈 - 观点解析.Insight  ×    [+]            │ ← TabBar
├─────────────────────────────────────────────────────────────────┤
│  访谈观点洞察/观点解析                    [↓下载] [⎘复制] [↗导出] │ ← ActionBar
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────┬──────────────────────┬─────────────┐    │
│  │  访谈问题          │  用户观点            │  场景主体   │    │
│  ├────────────────────┼──────────────────────┼─────────────┤    │
│  │  请介绍一下团队…   │  1.团队主要负责…     │  算子开发…  │    │
│  │  算子开发的完整…   │  1.流程包括…         │  算子开发…  │    │
│  └────────────────────┴──────────────────────┴─────────────┘    │ ← 内容区
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Tab 管理

### 4.1 Tab 数据模型

```ts
type ResultTab = {
  id: string                // 唯一ID，通常是 card.id
  title: string             // 显示名称（截断）
  type: "table" | "mindmap" | "markdown" | "file" | "json"
  content: string           // 原始内容（markdown 字符串 或 文件路径）
  createdAt: Date
  dirty?: boolean           // 内容是否修改（P2 编辑功能）
}
```

### 4.2 Tab 操作

| 操作 | 行为 |
|---|---|
| 点击 OutputCard | `openTab(card)` → 若已有同 id Tab 则 focus，否则新建 |
| 点击 × | 关闭 Tab；若是活跃 Tab 则 focus 上一个 |
| 拖拽 Tab | 调整顺序（P2） |
| Tab 数量无上限 | 超过可视区域时横向滚动 |

### 4.3 状态管理

```ts
// insight/components/result-viewer/tab-store.ts
const [tabs, setTabs] = createSignal<ResultTab[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)

function openTab(tab: ResultTab) { ... }
function closeTab(id: string) { ... }
```

父组件（InsightPage）持有并通过 props 传给 ResultViewer + InsightTurn。

---

## 5. 内容渲染器

### 5.1 表格渲染（TableRenderer）

输入：包含 `| ... |` 的 markdown 字符串。

```
insight/components/result-viewer/table-renderer.tsx
```

实现：
1. 用 `marked.lexer()` 解析 markdown，提取 `table` token
2. 渲染为 styled HTML table（sticky header、交替行颜色、hover 高亮）
3. 若同时有多个表格，垂直堆叠
4. 表格上方渲染前置说明段落（`<Markdown>`）

**不**使用第三方表格库（如 TanStack Table），原始 HTML table 已满足需求。

### 5.2 Mermaid 渲染（MermaidRenderer）

输入：` ```mermaid\n...\n``` ` 代码块内容。

```
insight/components/result-viewer/mermaid-renderer.tsx
```

实现：
1. `import mermaid from "mermaid"` — 在 insight/ 内 lazy import，不影响主包
2. `mermaid.initialize({ startOnLoad: false, theme: "neutral" })`
3. `mermaid.render(id, code)` → 得到 SVG 字符串
4. 插入 DOM，支持 pinch-zoom（CSS `transform-origin`）
5. 主题跟随 light/dark 切换（`useTheme()` 监听）

> 引入 mermaid 需在 `docs/architecture.md §5.4` 登记（非业务包依赖变更）。

### 5.3 Markdown 渲染

直接复用 `@opencode-ai/ui` 的 `<Markdown>` 组件：

```tsx
import { Markdown } from "@opencode-ai/ui/markdown"
<Markdown>{content}</Markdown>
```

### 5.4 文件预览（FileRenderer）

对于 agent 产出的文件（write Part 生成的 .docx/.pptx 等）：

```
insight/components/result-viewer/file-renderer.tsx
```

- `.txt` / `.md` → 用 `<Markdown>` 渲染（读文件内容）
- `.insight` / `.make` → 特殊格式，视为 markdown 渲染
- `.docx` / `.xlsx` / `.pptx` → 显示"无法在浏览器内预览"+ [在本地应用中打开] 按钮，调用 `window.api.openPath(filePath)`
- `.json` → 语法高亮代码块

---

## 6. ActionBar

| 按钮 | 行为 |
|---|---|
| 下载 ↓ | 根据 Tab 类型导出：table → CSV/xlsx；markdown → .md；mermaid → PNG |
| 复制 ⎘ | 复制原始 markdown 内容到剪贴板 |
| 导出 ↗ | 保存到工作区（调用 server API 写文件，路径由用户选择） |

---

## 7. 空态

无 Tab 时：
```
┌─────────────────────────────────┐
│                                  │
│         [📄图标]                 │
│    对话产出将在这里展示            │
│    点击左侧输出卡片即可打开        │
│                                  │
└─────────────────────────────────┘
```

---

## 8. 组件树

```
insight/components/result-viewer/
├── index.tsx            # ResultViewer 主容器
├── tab-bar.tsx          # Tab 条（含 × 和 + 按钮）
├── action-bar.tsx       # 下载/复制/导出按钮
├── table-renderer.tsx   # Markdown 表格 → styled table
├── mermaid-renderer.tsx # Mermaid → SVG（lazy import mermaid.js）
├── markdown-renderer.tsx# 复用 @opencode-ai/ui Markdown
└── file-renderer.tsx    # 文件预览（含 openPath 唤起）
```

---

## 9. Mermaid 依赖登记

在实现前需在 `insight/` 的 package.json 范围内（或 monorepo catalog）加入 mermaid：

```json
"mermaid": "^11.x"
```

**同步更新 architecture.md §5.4**（非业务包依赖变更）。

---

## 10. 验证步骤

> 依赖 insight-conversation 验证步骤 §7.1 已完成（对话区存在一个表格 OutputCard）。

### 10.1 打开第一个 Tab（表格）

1. 点击对话区的表格 OutputCard（`⊞` 图标）
2. ✅ 预期：
   - ResultViewer 中间面板顶部出现 TabBar，显示卡片标题
   - Tab 下方出现 ActionBar（标题 + "⎘ 复制" + "↓ 下载" 按钮）
   - 内容区显示 **样式化 HTML 表格**（灰色表头、交替行色）
   - 表格单元格显示 Agent 返回的实际内容

### 10.2 多 Tab 管理

1. 不关闭当前 Tab，发送 §7.1 的提示词再次触发新一轮表格输出
2. 新一轮完成后，点击新的 OutputCard
3. ✅ 预期：TabBar 出现第二个 Tab，内容切换到新表格

**切换验证：**
1. 点击第一个 Tab
2. ✅ 预期：内容切换回第一个表格，两 Tab 均保留

### 10.3 关闭 Tab

1. 点击第二个 Tab 的 `×`
2. ✅ 预期：第二个 Tab 消失，焦点自动跳回第一个 Tab

**关闭最后一个 Tab：**
1. 点击剩余 Tab 的 `×`
2. ✅ 预期：TabBar 消失，ResultViewer 回到**空态**（📄 图标 + "对话产出将在这里展示"）

### 10.4 重复点击同一 OutputCard

1. 现有一个 Tab 已打开
2. 再次点击同一张 OutputCard
3. ✅ 预期：不新建 Tab，只切换焦点到已有 Tab

### 10.5 复制功能

1. 在 ResultViewer 有内容的状态下，点击 ActionBar **"⎘ 复制"**
2. 打开任意文本编辑器粘贴
3. ✅ 预期：粘贴内容为原始 Markdown 文本（包含 `|` 表格语法）

### 10.6 下载功能（表格 → CSV）

1. 点击 ActionBar **"↓ 下载"**
2. ✅ 预期：浏览器触发文件下载，文件名为 `<卡片标题>.csv`
3. 用 Excel / Numbers 打开 CSV，验证列结构与 Agent 表格一致

### 10.7 空态展示

1. 新开一个 InsightPage 会话（未发任何消息）
2. ✅ 预期：ResultViewer 显示空态 UI

---

## 11. 不做

- ✗ 表格内联编辑（P2）
- ✗ 结果实时流式渲染（等 session.idle 后整体渲染，避免表格/mermaid 增量渲染乱码）
- ✗ Mermaid 以外的图表库（ECharts 等留 P2 专项 spec）
