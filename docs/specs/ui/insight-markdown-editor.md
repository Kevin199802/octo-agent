# Spec: Markdown 卡全文编辑器（Vditor 全屏分屏）

> **上游已实现 ✗** —— opencode 上游无 markdown 编辑器、无 CodeMirror/Vditor、无全屏写作层。
> 仅 [resize-handle](../../../packages/ui/src/components/resize-handle.tsx) / [dialog](../../../packages/ui/src/components/dialog.tsx) 可作 overlay 基础复用（本 spec 选 Vditor 后分栏/工具栏均不依赖它们）。
>
> 本 spec 是 markdown 卡「编辑」能力的唯一真相来源。预览侧契约见 [output-renderers.md §2.5.2 + §6](output-renderers.md)；内容来源契约见 [mcp-contract.md](../agents/mcp-contract.md)（docx→md）。

---

## 0. 背景与目标

markdown 卡（路径 A `text/markdown` resource_link，**含 2026-06 起 docx 产物改 md 返回**，见 [output-renderers.md §2.5.2](output-renderers.md)）当前**只读**：ResultViewer 内 `MarkdownRenderer`（上游 `<Markdown>` 渲染）+「预览/代码」切换的只读 `SourceCodeView`。

本期加**全文编辑**：

- **触发后全屏** —— 盖住 insight 三栏布局的编辑 overlay
- **左右分栏** —— 左 md 源 / 右实时预览 + 同步滚动
- **可关闭** —— Esc / × 退出，回到原 tab
- **直接编辑本地产物文件** —— MCP 产物本就落在 **`<所选目录>/.octo/downloads/`**（[insight-directory-scoping.md §5](insight-directory-scoping.md)）。编辑器直接读/写**这份已落地的本地文件**，自动保存即覆盖原文件，**不回传云端**（云端同步明确不做，见 §10）

**不做**（本期）：WYSIWYG 为默认形态、协同编辑、版本历史、回写远程 S3 / MCP / 任何云端同步。

---

## 1. 选型：Vditor（业界对照）

### 1.1 «Arya 效果好» 的真相 = Vditor

参考对象 Arya（[nicejade/markdown-online-editor](https://github.com/nicejade/markdown-online-editor)）是个 Vue SPA，**核心集成的就是开源编辑器 Vditor**（[Vanessa219/vditor](https://github.com/Vanessa219/vditor)，思源笔记同源 B3log 出品）。即「Arya 的体验」= Vditor 的体验。

### 1.2 三路线对比

| 路线 | 代表 | 「左右分栏」怎么来 | 取舍 | 选 |
|---|---|---|---|---|
| **Vditor** | Arya / 思源笔记 | **自带 `sv` 分屏模式**（左 md 源 / 右实时预览 + 同步滚动），另带 `wysiwyg`、`ir`(Typora 式) 两模式可切 | 开箱即用：工具栏 / 分栏 / 同步滚动 / 大纲 / 导出 / 撤销栈全有，省大量自拼。vanilla 框架无关，Solid `onMount` 集成。**代价**：自带预览引擎（Lute）不复用上游 `<Markdown>`；体积偏大；默认部分资源走 CDN（katex/mermaid/echarts），内网需本地化 | ✅ |
| CodeMirror 6 + 自拼分屏 | GitHub / Obsidian 源码模式 | 左 CodeMirror、右复用上游 `<Markdown>`、分隔条用 [resize-handle](../../../packages/ui/src/components/resize-handle.tsx) | 轻、无损往返、预览与对话区一致；但工具栏 / 同步滚动 / 导出 / 大纲全部自己写 | ✗ |
| Milkdown WYSIWYG | Notion 式 | 单栏所见即所得（**非分栏**） | 对非技术用户最友好；但往返有损、Solid 手接、最重，且不符合「左右分栏」诉求 | ✗ |

### 1.3 选 Vditor 的理由

1. **用户已认可其效果**（Arya 同款），降低预期偏差风险
2. **`sv` 模式天然就是诉求的全屏左右分栏**，且自带同步滚动 / 工具栏 / 撤销栈，省掉 CodeMirror 路线的大量自拼工作
3. 框架无关，对 SolidJS 友好（vanilla DOM 挂载）
4. 中文社区 / 文档活跃，用研同学是主要用户，中文工具栏与 i18n 现成
5. 三模式可切：默认 `sv`（贴合诉求），但用户也能切 `ir`/`wysiwyg` 获得 Typora/Notion 式体验，未来无需换库

> **撤销之前的临时决定**：上一轮（无 Arya 参考时）临时定过「CodeMirror 6 源码模式」。本轮用户给出 Arya 参考后改选 Vditor —— 决策依据变了，更新合理。

---

## 2. 交互形态

### 2.1 触发入口

markdown 类型 tab 的 ActionBar 增加「编辑」按钮（铅笔图标），仅 `type === "markdown"` 出现。

```
ActionBar:  [预览 | 代码]   ……   [✎ 编辑]   [复制]  [下载 ▾]
```

> 仅 markdown 卡可编辑（table/mindmap/html/json/file 不在本期范围）。

### 2.2 全屏编辑 overlay

点「编辑」→ 进入覆盖整个 insight 页面（含三栏）的全屏 overlay：

```
┌─ 顶栏(细) ────────────────────────────────────────────────┐
│ ✎ interview-analysis.md        [已保存]   [sv|ir|所见] [✕] │
├───────────────────────────────────────────────────────────┤
│  ┌── 左:md 源 ──────┐│┌── 右:实时预览 ──────┐               │
│  │ # 标题            ││ 标题(渲染)            │  ← Vditor sv  │
│  │ - 列表            ││ • 列表                │     模式      │
│  │ ...               ││ ...                   │  同步滚动     │
│  └───────────────────┘│└───────────────────────┘              │
└───────────────────────────────────────────────────────────┘
```

- 顶栏：文件名 + **保存状态指示**（`已保存` / `保存中…` / `保存失败`）+ 模式切换（sv / ir / 所见即所得）+ 关闭 ✕
- 主体：Vditor 实例，默认 `mode: "sv"`
- 关闭：✕ 或 `Esc` → 退出 overlay，回到原 tab；tab.content 同步为编辑后的最新内容
- overlay 之上不再嵌 ResultViewer 的「预览/代码」切换（编辑器内部已有分屏/预览，避免重复）

### 2.3 与现有 ResultViewer / tab 的关系

- 编辑器是 ResultViewer 之上的**独立全屏层**，不替换 tab 体系
- 退出后：`tabStore.cacheContent(tabId, editedContent)` 回写，使「预览/代码」态显示编辑后的内容
- 同一 tab 重复进出编辑器，内容连续

---

## 3. 数据流：直接编辑 `.octo/downloads/` 的本地文件

**核心**：md 产物本就落在本地（[insight-directory-scoping.md §5](insight-directory-scoping.md)），编辑器**复用现有落地机制**拿到本地路径、读/写同一份文件——不另造目录、不"远程内容再落地"。

### 3.1 落地路径（复用现有 IPC）

[result-viewer FileFallback](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx) 已有：`window.api.downloadResourceToTemp(uri, namespace, filename, baseDir)` → 把 uri 落到 **`<baseDir>/.octo/downloads/`** 并返回 `localPath`（已落地则复用、占用时回退已下载副本，见 [insight-debugging.md](../../insight-debugging.md) `[octo:office] reuse-locked`）。

| 入参 | md 编辑器取值 |
|---|---|
| `uri` | `tab.uri` |
| `namespace` | `tab.id` |
| `filename` | 复用 FileFallback 的 `defaultFilename()`（`tab.fileName` → uri basename → `tab.title`）+ `sanitize()`；非 `.md` 结尾补 `.md` |
| `baseDir` | `useProjectDir()() \|\| undefined`（空 → 落 OS 临时目录，**非持久**，见 §3.4） |

> `sanitize` / `defaultFilename` 已存在于 result-viewer，抽成共享 util 复用，避免两套规则漂移。

### 3.2 读（进编辑器）

1. 进编辑器先 `ensureLocalFile()` = 调 `downloadResourceToTemp(...)` 拿 `localPath`（幂等：已落地直接复用）
2. 编辑器初始 `value`：首版直接用 tab 已 fetch 的 `tab.content`（与本地文件内容一致，省一次读盘）；**严谨读本地**可加 `readFile(localPath)` IPC（P2，§5）

### 3.3 存（自动保存）

`writeFile(localPath, value)` **覆盖同一份本地文件**（§4 防抖）。即用户编辑的、保存的、本地应用打开的、下次再开卡看到的，**都是 `.octo/downloads/` 里这一份**。

> **路径校验**：`localPath` 来自受信的 `downloadResourceToTemp` 返回值（主进程构造），不是渲染进程拼接；写盘时主进程仍校验其在 `<projectDir>/.octo/downloads/`（或临时目录）之下，防越权。

### 3.4 未选目录（projectDir 为空）

`downloadResourceToTemp` 无 `baseDir` 时落 **OS 临时目录**（重启可能被清）。此时编辑/保存仍可用，但**非持久** —— 顶栏提示「未关联本地目录，编辑暂存临时目录、可能丢失，建议先关联目录」。不硬禁编辑。

---

## 4. 保存策略：自动保存（防抖）+ 兜底

### 4.1 自动保存

- Vditor `input` 回调触发 → **防抖 1000ms** → 调 `window.api.writeFile(targetPath, value)`
- 与业界一致（VS Code `afterDelay`、Obsidian、Typora 均防抖写本地 md）；小 md 文件 SSD 写入微秒级，**频繁 IO 无性能后果**
- 顶栏保存状态：编辑中→`保存中…`；写成功→`已保存`；失败→`保存失败`（红）

### 4.2 兜底（应对「误改即落盘」与写失败）

| 风险 | 兜底 |
|---|---|
| 自动保存把误删/误改立即写盘 | 编辑器内撤销栈（Vditor 自带，Cmd/Ctrl+Z）。~~「还原初始内容」快照~~ —— **实现时去掉**（2026-06 决策）：要回原始版本，关掉卡片重开即重新从 MCP 下载，不需要编辑器内单独维护快照/还原按钮（按钮本身也易与自动保存语义打架） |
| 文件被外部应用占用 / 无权限 / 磁盘满 | `writeFile` 抛错 → toast「保存失败：<原因>」+ 保存状态置红 + **内存内容不丢**（下次输入或手动重试再写） |
| projectDir 为空（未关联本地目录） | 落 OS 临时目录、**不禁编辑**，顶栏提示「暂存临时目录、可能丢失，建议先关联目录」（§3.4） |

### 4.3 手动保存（可选增强）

`Cmd/Ctrl+S` 立即 flush 一次（绕过防抖），并给即时反馈。低成本，建议带上。

---

## 5. 接线层依赖（新增主进程 IPC）

`downloadResourceToTemp` / `openPath` / `saveFilePicker` / `downloadResource` 已有；**缺写本地文件能力**，需新增 `writeFile`（形态类比 `downloadResource`）：

```ts
// preload: window.api.writeFile
writeFile(path: string, content: string): Promise<void>
// main 实现:校验 path 在 <projectDir>/.octo/downloads/ 或 OS 临时目录下 → fs.writeFile(path, content, "utf-8")
```

改动点：
- `packages/desktop/src/preload/index.ts` + `types.ts`：暴露 `writeFile`
- `packages/desktop/src/main/ipc.ts`：`ipcMain.handle("write-file", ...)`，**主进程侧校验**路径（不信任渲染进程传入，限制在 `.octo/downloads/` / 临时目录下）
- [electron-api.ts](../../../packages/app/octoapp/pages/insight/lib/electron-api.ts) `DesktopApi` 类型加 `writeFile`（可选 `readFile`，见下）

> `localPath` 虽来自受信的 `downloadResourceToTemp` 返回值，主进程仍**独立做目录白名单校验**（渲染进程不是安全边界）。
>
> **可选 `readFile(path)`（P2）**：若要严谨「初始内容直接读本地文件」而非用 `tab.content`，再加；首版用 `tab.content` 即可（与本地文件一致）。

---

## 6. Vditor 集成要点

### 6.1 实例化（SolidJS）

```tsx
import Vditor from "vditor"
import "vditor/dist/index.css"

onMount(() => {
  vditor = new Vditor(el, {
    mode: "sv",                       // 默认左右分屏
    value: initialContent,
    theme: isDark() ? "dark" : "classic",
    cdn: LOCAL_VDITOR_CDN,            // ★ 见 6.2 资源本地化
    cache: { enable: false },         // 我们自管落盘,关掉 Vditor 的 localStorage 缓存
    toolbar: TRIMMED_TOOLBAR,         // 裁剪到需要的按钮(见 6.3)
    input: (val) => scheduleSave(val),// 防抖自动保存
    after: () => { /* 就绪 */ },
    preview: { /* 同步滚动等默认即可 */ },
  })
})
onCleanup(() => vditor?.destroy())
```

API：`getValue()` / `setValue()` / `destroy()` / `setTheme()`。

### 6.2 ★ 资源本地化（关键落地坑）

Vditor 默认运行时从公网 CDN（`https://unpkg.com/vditor@x`）按需加载 katex / mermaid / echarts / graphviz 等懒加载资源（由 `cdn` 选项控制 baseURL）。**内网访问公网 CDN 不稳定 / 离线必然失败**。**本期决定全功能、零公网 CDN 本地化**（保留公式/流程图/图表/五线谱，见 §10.4）。两层分开处理：

**① 装依赖 → 内网 npm 私有源**
- `npm install vditor` 从内网私有源装（私有源有该包或代理 npmjs 即可）。仅解决"包怎么进来"。

**② 运行时资源 → 本地自托管（关键，否则仍会拉公网 CDN）**
- Vditor 的 npm 包 **`dist/` 目录自带**全部第三方资源（`dist/js/katex`、`dist/js/mermaid`、`dist/js/echarts`、`dist/js/graphviz`…）
- 把整个 `node_modules/vditor/dist` 作为**本地静态资源**伺服，Vditor `cdn` 选项指向该**本地路径**：
  - 开发期：Vite serve `/vendor/vditor`（`vite-plugin-static-copy` 或 publicDir 拷 dist）
  - 打包后：dist 随 Electron app 落地，渲染进程用内置协议 / 相对路径访问（**不可指向 `unpkg.com`**）
- 结果：所有资源本地取，**零公网 CDN、断网可用**。参照系：思源笔记即 Vditor 做的纯离线桌面 app
- **不做按需裁剪**（"功能齐全"诉求）；体积本地打包一次付清，懒加载保证首屏不受拖累

> 落地**成败项**：必须验证「**断网**下公式 / 代码高亮 / mermaid / echarts / 流程图 全部本地可用」（见 §8 验证 E）。任何一项还在打 `unpkg.com` 即未达标。

### 6.3 工具栏（落地后实际裁剪 · 2026-06）

保留：标题、加粗/斜体/删除线、链接、列表/有序/任务、缩进、引用、分割线、代码块/行内码、表格、撤销/重做、大纲、预览（👁 纯预览 ↔ 分屏切换）。**公式 / 流程图 / 图表 / 脑图**是预览渲染特性（写 `$$` / ` ```mermaid ` 即出图，资源走本地 cdn），无需工具栏按钮。

**工具栏 tooltip**：Vditor 自带 tooltip = `.vditor-tooltipped::after { content: attr(aria-label) }`，但默认多**朝上**（`__n/__ne/__nw`：`bottom:100%`），工具栏在编辑器顶部 → 气泡向上溢出被顶栏 / `overflow:hidden` 裁掉看不到。
- ~~曾试「补原生 `title`」~~：Chromium/Electron 原生 title 气泡不稳定（闪一下就消失、再 hover 不复现），且与 Vditor 的 `::after` 气泡打架，**放弃**。
- 落地做法：**CSS 把工具栏 tooltip 强制朝下**（`.octo-md-editor-host .vditor-toolbar .vditor-tooltipped::after { top:100%; bottom:auto }` + 隐藏 `::before` 箭头）。气泡本身自带 `z-index:1000000`，朝下后落在内容区、不被裁，hover 稳定显示功能名。在 `octo-tokens.css`。

落地时**额外去掉**（除上传 `upload`/录音 `record`/`@` 外）：

| 去掉项 | 原因 |
|---|---|
| `content-theme` / `code-theme`（换肤） | 与「跟随 app 明暗」（§6.4）冲突，给用户徒增困惑 |
| `fullscreen` | 本就是全屏 overlay，且 Vditor 进全屏后无可见退出入口，冗余 |
| `edit-mode`（所见即所得/即时渲染/分屏） | 固定用分屏 `sv`；纯预览用工具栏末「预览」👁 切换即可。三选项里「所见即所得」「即时渲染」对本场景区分意义不大，去掉减少困惑（撤销 §2.2 顶栏模式切换 + §9 P2 模式偏好持久化） |
| `export`（Vditor 自带导出） | 其 **PDF 导出走 `window.print()` 会弹系统打印框**（非静默存盘），体验差。改由**顶栏自建「导出 ▾」**，见下 |
| 预览面板设备/平台切换栏 | `preview.actions: []` 清空 Desktop/Tablet/Mobile-Wechat/知乎/刷新——写作场景用不到 |

**自建「导出 ▾」（顶栏）**：当前只给 **Markdown (.md)**（`vditor.getValue()`）与 **HTML (.html)**（`vditor.getHTML()` 包整页），走浏览器 `<a download>` 落 OS 下载目录。
- **PDF 暂不做**（用户决策 2026-06）：后续要做时走现成的 `html-to-pdf` IPC（Electron 离屏 `printToPDF`，**静默返回 buffer、不弹打印框**）→ `saveFilePicker` 选位置 → `writeFileBuffer` 存盘。零新增主进程能力。

### 6.3.1 卡片预览与编辑器预览同源（2026-06）

markdown 卡的「预览」态原走上游 `<Markdown>`，与编辑器内的 Vditor 预览**渲染效果不一致**（加粗/表格/代码块等），且编辑↔看卡来回切换观感割裂。落地时把 `ResultViewer` 的 `MarkdownRenderer` 改为**复用 Vditor 渲染引擎**（`Vditor.preview(el, md, { cdn: 本地, mode, hljs, theme })`，组件 `MarkdownPreview`），与编辑器**同一套 Lute 渲染**，卡片预览 = 编辑器预览。外链点击同样走 §6.5 系统浏览器。
- 「代码」态仍是**原始 md 源**（shiki 高亮）——注意：md 源**不可** `stripCodeFence`（md 里合法含代码围栏，strip 会把整篇抠成第一个围栏的内容，曾致「代码」视图只剩一行）。仅 json/html 源才 strip。详见 [output-renderers.md §1](output-renderers.md)。

### 6.4 主题

跟随 octo 明暗（`useTheme().mode()`），`setTheme("dark"|"classic", contentTheme, codeTheme)` + 预览主题对应切换。

### 6.5 预览外链 → 系统浏览器

预览里点 `http(s)` / `mailto` 外链 → 拦截后走 `window.api.openLink`（`shell.openExternal`）**唤起系统浏览器**；不在 Electron webview 内导航（否则无返回入口、用户被困）。锚点（`#标题`，大纲跳转）与相对链接放行。

---

## 7. 安全

- Vditor 预览渲染来自 LLM/产物的不可信内容 → 启用 Vditor 内置 sanitize（默认开），不额外 `innerHTML` 注入
- 写盘路径主进程独立校验（渲染进程不是安全边界）：允许 ① `.octo/downloads/` 或 OS 临时目录（`octo/`）下，**或** ② 白名单外但**已存在的普通文件（非符号链接）**——覆盖 write 工具产物（路径 C，落在 `~/Downloads/...` 等任意位置，§3.1 path 源）。拒绝凭空新建任意系统文件、拒绝经符号链接越权。文件名 `sanitizeFilename` 去分隔符
- 预览外链走系统浏览器（`openLink`），不在 webview 内导航（§6.5）
- 不引入 Vditor 的远程图片/外链上传能力（关闭 upload）

---

## 8. 验证清单

> 前置：InsightPage 配好 provider；有一个 markdown 卡（联调期可 hardcode 一个 `text/markdown` resource_link，或本地放一份 .md 走 inline）。

- **A 触发 + 全屏**：markdown 卡 ActionBar 出现「✎ 编辑」；点击 → 全屏 overlay 盖住三栏；Esc / ✕ 退出回原 tab
- **B 分屏 + 同步滚动**：固定 `sv` 左右分栏；左改右即时更新；滚动同步（已去 `edit-mode` 模式切换，§6.3）。工具栏 hover 显示原生 title（功能名）
- **B2 预览一致 + 代码源完整**：卡片「预览」与编辑器预览**渲染效果一致**（Vditor 同源，§6.3.1）；切「代码」显示**完整 md 源**（含代码围栏，不再被 strip 成一行）
- **C 自动保存**：编辑停手约 1s → 顶栏 `保存中…`→`已保存`；到 `<projectDir>/.octo/downloads/` 下确认**本地 .md 文件真被覆盖写入**且内容一致；重开同卡 / 用「本地应用打开」看到的都是这一份；重开编辑器内容延续
- **D 兜底**：① 误删后 Cmd+Z 可撤销（不再有「还原初始内容」按钮，§4.2）；② mock writeFile 拒绝 / 文件被占用 → toast「保存失败」+ 状态红 + 内容不丢；③ projectDir 为空 → 落临时目录 + 顶栏提示（不硬禁编辑）
- **H 导出 / 外链**：顶栏「导出 ▾」→ Markdown / HTML 落盘正常（**无 PDF**，§6.3）；预览里点 http 外链 → **系统浏览器**打开（不在 webview 内导航，§6.5）
- **E ★ 离线资源（成败项）**：**断网**下打开编辑器 → 代码高亮 / 表格 / 公式 / mermaid / echarts / 流程图 预览全部正常；DevTools Network **无任何 `unpkg.com` / 公网请求**（全走本地 `/vendor/vditor`）
- **F 主题**：切 app 明暗 → 编辑器与预览主题跟随
- **G 安全**：内容含 `<script>` / onerror 图片 → 预览不执行（sanitize 生效）；尝试 `../` 文件名 → 写盘被拒

console 埋点：`[octo:mdedit] open`（含 path + persistent）/ `open-failed` / `save-start` / `save-ok` / `save-failed`（含 path + bytes）/ `open-link` / `close`。

---

## 9. Phase 与依赖

| 工作项 | Phase | 依赖 |
|---|---|---|
| 新增 `writeFile` IPC（preload + main 校验 + DesktopApi 类型） | P1 | desktop 壳 |
| Vditor 接入 + 资源本地化（cdn 指本地 + Vite 拷 dist） | P1 | npm `vditor` |
| 全屏 overlay + 触发按钮 + 退出回写 tab | P1 | ResultViewer / tab-store |
| 自动保存（防抖）+ 保存状态 + 兜底（快照/写失败/空 dir） | P1 | writeFile IPC |
| 主题跟随 + 工具栏裁剪 + sanitize | P1 | — |
| 模式切换（sv/ir/wysiwyg）持久化偏好 | P2 | — |
| 手动 Cmd+S flush | P2 | — |

---

## 10. 开放问题 / 已定结论

1. ✅ **数据流已定**（2026-06）：md 产物本就落 `<所选目录>/.octo/downloads/`（[directory-scoping §5](insight-directory-scoping.md)）。编辑器复用 `downloadResourceToTemp` 拿 `localPath`、`writeFile` 覆盖同一份本地文件（§3）。不另造目录、不"远程再落地"。
2. ✅ **云端回写：明确不做**。编辑只改本地这份文件，不回传 S3 / 服务端 / MCP。未来若要云端同步，另立 spec。
3. ⏳ **读初始内容**：首版用 `tab.content`（已 fetch，与本地一致）；是否加 `readFile(localPath)` 严谨读本地，实现时定（§5 列 P2）。
4. ⏳ **Vditor 体积 / 按需**：本地化后实际 bundle 增量，**落地时评估**（用户已认可体积影响不大，按需关 mermaid/echarts 等重特性即可）。
