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

[result-viewer FileFallback](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx) 已有：`window.api.downloadResourceToTemp(uri, namespace, filename, baseDir)` → 把 uri 落到 **`<baseDir>/.octo/downloads/`** 并返回 `localPath`（**幂等**：已落地直接复用、不 re-fetch/覆盖,见 `[octo:office] reuse-existing`；文件被外部应用独占锁定时回退已有副本,见 `[octo:office] reuse-locked`；均见 [insight-debugging.md](../../insight-debugging.md)）。

> **2026-06 修复**：`downloadResourceToTemp` 此前**每次都 re-fetch + 覆盖**(本函数最初只服务 Office 只读临时预览),导致「本地打开/编辑 → 改 → 关闭 → 再打开」被重新下载的 MCP 原版盖掉用户改动。改为「目标已存在即复用」后幂等成立,本地工作副本的改动才真正持久。详见 §3.5。

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

### 3.5 「本地工作副本」模型：卡片预览 / 本地打开 / 编辑 / 下载的一致性（2026-06）

把 uri markdown 卡的本地落地件视为用户的**工作文件**，所有读路径都指向它、唯一例外是「另存为」，对齐主流软件心智（下载即得本地副本可改，要原件重新下载）。三处改动：

1. **`downloadResourceToTemp` 幂等**（[desktop/src/main/ipc.ts](../../../packages/desktop/src/main/ipc.ts)）—— 目标已存在即复用、不覆盖（§3.1 修复）。这是根因修复:`本地打开`(FileFallback)与编辑器都走它,改完此处两条路径的改动才不被 re-fetch 盖掉。
2. **卡片预览读本地副本**（[result-viewer `UriMarkdownTabBody`](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx)）—— uri markdown 卡不再直接 `fetch(url)`,而是先 `downloadResourceToTemp`(幂等)落本地、再 `readFileBuffer(localPath)` 读盘渲染。于是预览/编辑/重开卡(含 app 重启,`namespace=tab.id` 稳定 → `localPath` 稳定)看到的都是同一份含改动的本地文件。`filename`/`namespace` 与编辑器 `ensureLocalFile` 完全一致才命中同一份。非桌面端(`__dev`/测试)缺能力时退回 `fetch(url)` 只读预览。
3. **「另存为」= 拉原件**（[result-viewer/action-bar.tsx](../../../packages/app/octoapp/pages/insight/components/result-viewer/action-bar.tsx)）—— uri markdown 卡的下载菜单项改名「另存为」(与 file 类型同名),走 `saveFilePicker` + `downloadResource(url, dest)`,**始终拉 MCP 原始版本**另存到任意目录,不取本地工作副本/编辑后内容。

> 仅作用于 **markdown** 类型;file 类型(Office/二进制,FileFallback 不内嵌预览)维持现状 —— 改动 1 幂等后其`本地打开`也自动持久。其余 uri 类型(json/html/table/mindmap)仍走 `fetch(url)` 只读预览(无编辑场景)。

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
- **仅 hover 显示**：Vditor 默认 `:focus`/`:active` 也显示 tooltip，点「导出」展开面板后 tooltip 仍挂着、朝下正好压住下拉项（Markdown/HTML）→ 抑制 `:focus`/`:active`，只留 `:hover`。

落地时**额外去掉**（除上传 `upload`/录音 `record`/`@` 外）：

| 去掉项 | 原因 |
|---|---|
| `content-theme` / `code-theme`（换肤） | 与「跟随 app 明暗」（§6.4）冲突，给用户徒增困惑 |
| `fullscreen` | 本就是全屏 overlay，且 Vditor 进全屏后无可见退出入口，冗余 |
| `edit-mode`（所见即所得/即时渲染/分屏） | 固定用分屏 `sv`；纯预览用工具栏末「预览」👁 切换即可。三选项里「所见即所得」「即时渲染」对本场景区分意义不大，去掉减少困惑（撤销 §2.2 顶栏模式切换 + §9 P2 模式偏好持久化） |
| 预览面板设备/平台切换栏 | `preview.actions: []` 清空 Desktop/Tablet/Mobile-Wechat/知乎/刷新——写作场景用不到 |

**导出 = Vditor 原生入口（工具栏内）+ CSS 隐藏 PDF**（2026-06 修订）：
- ~~曾改「顶栏自建导出 ▾」~~：放右上角在 **Windows 上与原生窗口控件（最小化/最大化/关闭）位置重合**，弃用。
- 落地：保留 Vditor 工具栏原生 `export`（在工具栏左侧，不与窗口控件冲突）。其面板是 `.vditor-hint`，含 `<button data-type="markdown|pdf|html">` 三项；**CSS 隐藏 `data-type="pdf"`**（`.octo-md-editor-host .vditor-hint button[data-type="pdf"]{display:none}`），只留 Markdown / HTML。
- **PDF 暂不做**（其走 `window.print()` 弹系统打印框）：后续要做走现成 `html-to-pdf` IPC（Electron 离屏 `printToPDF`，**静默返回 buffer、不弹打印框**）→ `saveFilePicker` → `writeFileBuffer`。零新增主进程能力。

**顶栏窗口控件避让**：无边框窗口下顶栏作拖拽区，**mac 左侧避让红绿灯（80px）、Windows 右侧避让 titleBarOverlay 控件（138px）**，使文件名/关闭 ✕ 不与原生控件重合；交互按钮设 `-webkit-app-region: no-drag`。

### 6.3.1 卡片预览与编辑器预览同源（2026-06）

markdown 卡的「预览」态原走上游 `<Markdown>`，与编辑器内的 Vditor 预览**渲染效果不一致**（加粗/表格/代码块等），且编辑↔看卡来回切换观感割裂。落地时把 `ResultViewer` 的 `MarkdownRenderer` 改为**复用 Vditor 渲染引擎**（`Vditor.preview(el, md, { cdn: 本地, mode, hljs, theme })`，组件 `MarkdownPreview`），与编辑器**同一套 Lute 渲染**，卡片预览 = 编辑器预览。外链点击同样走 §6.5 系统浏览器。
- 「代码」态仍是**原始 md 源**（shiki 高亮）——注意：md 源**不可** `stripCodeFence`（md 里合法含代码围栏，strip 会把整篇抠成第一个围栏的内容，曾致「代码」视图只剩一行）。仅 json/html 源才 strip。详见 [output-renderers.md §1](output-renderers.md)。

### 6.4 主题

跟随 octo 明暗（`useTheme().mode()`），`setTheme("dark"|"classic", contentTheme, codeTheme)` + 预览主题对应切换。

### 6.5 预览外链 → 系统浏览器

预览里点 `http(s)` / `mailto` 外链 → 拦截后走 `window.api.openLink`（`shell.openExternal`）**唤起系统浏览器**；不在 Electron webview 内导航（否则无返回入口、用户被困）。锚点（`#标题`，大纲跳转）与相对链接放行。

### 6.6 双向同步滚动（2026-06 补）

**Vditor `sv` 模式自带的同步滚动是单向的**——只在「左源编辑器（`.vditor-sv`）」上绑 scroll 监听、按比例驱动「右预览（`.vditor-preview`）」，**没有反向**（核对 dist 源码：`.vditor-preview` 上 0 个 scroll 监听）。所以默认左滚右动、右滚左不动，与 Arya 的双向体验不一致。

**落地补「右 → 左」反向同步**（`setupScrollSync`，`after()` 里给右栏挂监听）。难点是 Vditor 正向监听**无条件、无节流**（左滚就写右），拖右栏时它会和用户拖拽抢着写右栏 → 闪烁。两件事配合解决：

**① 反解 Vditor 正向公式做映射**（保证两向对齐一致）：

```
Vditor 正向(dist 实测): pv = sv/r>0.5 ? (sv+r)*i/pvSH - r : sv*i/pvSH
  r=左 clientHeight, i=左 scrollHeight - paddingBottom(内联), pvSH=右 scrollHeight
逆解(目标 pv=P): 线性支 sv=P*i/pvSH;若 >r/2(拐点支)则 sv=(P+r)*i/pvSH - r
```

**② 拦掉 Vditor 对右栏的回写（防闪核心）**：用户拖右栏期间，给右栏元素的 `scrollTop` **setter 做实例级覆盖**、丢弃写入。原理——用户原生拖拽/滚轮是引擎层改 scrollTop，**不走 JS setter**；只有 Vditor 的 `pv.scrollTop=` 走 setter。于是右栏被用户独占、不被 Vditor 拽回，不闪。

**「用户正驱动右栏」的判定**（关键，踩过坑）：
- **拖拽**：右栏 `pointerdown` 起、`pointerup`/`pointercancel`/窗口 `blur` 止——**整段按住都算**。⚠️ 不能只靠 scroll 事件续期：拖到顶/底时 scrollTop 夹住、不再发 scroll 事件，锁会过期，再拖回来左栏就不同步了（实测 bug）。故拖拽必须靠 pointer 维持。
- **滚轮/惯性**：右栏 `wheel` 起、末次滚动后 200ms 内（scroll 事件续期）。
- 左栏发生手势 → 释放右栏动量锁，让 Vditor 正向接管。

> 对齐**按比例**（与 Vditor 左→右一致），非「共用一个滚动条」的像素方案（长文档源/渲染高度差大时会漂，设计评估「效果一般」未采用）。
> **固有小瑕疵**（非本实现引入）：Vditor 正向公式在「滚动≈半屏」处有拐点，左右内容高度不等时该公式本身不连续 → 两向都可能有个小跳（Arya 同款，可接受）。
> **代价**：耦合 Vditor 正向公式 + `Element.prototype.scrollTop` 覆盖；若上游改公式，逆解会偏、退化回轻微抖（不崩）。cleanup 解绑监听 + `delete pv.scrollTop` 还原访问器。

**两栏滚动条统一**：Vditor 默认 `.vditor-preview::-webkit-scrollbar { display:none }`（单向假设下藏掉预览滚动条），左栏 `.vditor-sv` 则是系统原生。双向后两者并存就**不一致**（左原生 overlay、右自定义）。右栏**无法退回真·原生**——WebKit 里元素只要存在任意 `::-webkit-scrollbar` 作者规则就进自定义渲染、回不去原生，而 Vditor 已声明该规则。故反过来**让两栏都用同一套自定义样式**（细、深色半透明圆角 thumb：`border:3px solid transparent` + `background-clip:content-box` 做内缩细条，贴近 Mac 观感；透明 track，hover 加深）→ 两边一模一样。**不做自动显隐**（始终可见，从简，设计决定）。在 `octo-tokens.css`。

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
- **B 分屏 + 同步滚动**：固定 `sv` 左右分栏；左改右即时更新；**滚动双向同步**（左滚右动、右滚左也动，§6.6；连续滚 / 鼠标在哪栏滚都不抖、不卡死）（已去 `edit-mode` 模式切换，§6.3）。工具栏 hover 显示功能名（CSS tooltip，§6.3）
- **B2 预览一致 + 代码源完整**：卡片「预览」与编辑器预览**渲染效果一致**（Vditor 同源，§6.3.1）；切「代码」显示**完整 md 源**（含代码围栏，不再被 strip 成一行）
- **C 自动保存**：编辑停手约 1s → 顶栏 `保存中…`→`已保存`；到 `<projectDir>/.octo/downloads/` 下确认**本地 .md 文件真被覆盖写入**且内容一致；重开同卡 / 用「本地应用打开」看到的都是这一份；重开编辑器内容延续
- **D 兜底**：① 误删后 Cmd+Z 可撤销（不再有「还原初始内容」按钮，§4.2）；② mock writeFile 拒绝 / 文件被占用 → toast「保存失败」+ 状态红 + 内容不丢；③ projectDir 为空 → 落临时目录 + 顶栏提示（不硬禁编辑）
- **H 导出 / 外链**：工具栏原生「导出」→ 面板只有 Markdown / HTML（**PDF 已 CSS 隐藏**，§6.3）；预览里点 http 外链 → **系统浏览器**打开（不在 webview 内导航，§6.5）。Windows 下顶栏右侧不与原生窗口控件重合
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
