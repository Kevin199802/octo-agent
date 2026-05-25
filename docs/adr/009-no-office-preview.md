# ADR-009: 不在客户端预览 Office 文件（docx/pptx/xlsx）

## 状态
已采纳（2026-05-15）

## 背景

[insight-result-viewer.md §5.4](../specs/ui/insight-result-viewer.md) 早期规划过 `FileRenderer` 组件：
- 处理 agent 产出的 .docx / .pptx 等文件
- 对 Office 格式：显示"无法浏览器内预览" + "在本地应用打开"按钮（`window.api.openPath`）

review 时发现两个根本问题：

1. **insight agent 实际不会生成 Office 文件**：工具白名单只有 `analyze_interview` 和 `search_reports`，没有 `write` 工具，输出形态全是 Markdown / JSON 文本。"agent 产出 docx"的场景在我们项目里**不会发生**。
2. **业界主流 LLM 应用都不在 UI 内预览 Office 文件**——这个组件是规划过头了。

需要明确决策：是否还保留 FileRenderer？是否做 Office 文件预览？

## 业界对照

| 产品 | Office 文件应用内预览 | 实际做法 |
|---|---|---|
| ChatGPT Code Interpreter | ❌ 不预览 | 生成的 .xlsx 给下载链接，用户用系统应用打开 |
| Claude Artifacts | ❌ 不支持 docx/pptx | 只渲染 code / markdown / svg / html / react |
| Claude.ai 附件 | ❌ 不预览用户上传的 | 只显示文件 chip + 文件名 |
| ChatGPT 附件 | ❌ 同上 | chip 形态 |
| Slack / Teams | ⚠️ 有预览 | 但场景不同——是文件分享给他人，他人没有原文件 |

LLM 对话场景的业界共识：**不做 Office 文件应用内预览**。理由：
- **实现成本高**：需要 docxjs / pptxjs / sheetjs viewer 等重型库（每个数 MB），还原度永远差于系统原生 Office
- **价值低**：用户文件已在本地，双击就开；agent 不生成此类文件
- **跨平台维护**：不同 Office 版本、不同操作系统的兼容性问题永无止境

## 决策

**不做 Office 文件应用内预览**。但**唤起本地应用是默认行为**——MCP `resource_link` 返回 office mimeType 时，`FileFallback` 渲染器提供**双按钮**：

```
[ 用本地应用打开 ]    [ 下载到本地 ]
```

| 按钮 | 实现 |
|---|---|
| **用本地应用打开** | `window.api.downloadResource(uri, tempPath)` 落地临时文件 → `window.api.openPath(tempPath)` 由 OS 关联应用打开（Excel/WPS/Numbers/Keynote） |
| **下载到本地** | `window.api.saveFilePicker({ defaultPath: filename })` 用户选目录 → `downloadResource(uri, chosenPath)` |

旧实现（`<a target="_blank" href={uri}>`）在 Electron 渲染进程会触发 chromium 默认 window.open + 内置下载弹窗，结果是**两个窗口**（空白 Octo 页 + 另存为对话框），既没"打开"也没真"下载到指定位置"。**新方案完全走 IPC，不依赖浏览器默认行为**。

详见 [output-renderers.md §6.A FileFallback](../specs/ui/output-renderers.md#6a-filefallbackoffice--pdf--二进制)。

### 唤起优先级 / 跨平台兼容

`shell.openPath` 走 **OS 默认关联应用**，不由我们指定 app。"优先 Office 次选 WPS" 由用户机器的文件关联决定。

| 平台 | 行为 |
|---|---|
| macOS | LaunchServices 路由（Excel for Mac / Numbers / WPS / Keynote / Preview 等系统兜底） |
| Windows | ShellExecute 路由（Excel / WPS / LibreOffice 等）。内网无 OneDrive，不担心 OneDrive 抢关联到浏览器版 Office |

失败处理：toast「未找到关联应用，请安装 Excel / WPS 或在系统设置中关联打开方式」。

### 如果未来真要做应用内预览

- 先评估需求是否真实（很可能用户其实是想"打开文件"而不是"在 app 内看"）
- 即便要做，优先 `openPath` 唤起系统应用，不在 app 内嵌入 Office 渲染器

## 实际场景覆盖检查

| 场景 | 当前方案 | 状态 |
|---|---|---|
| 用户上传文件展示 | AttachmentBar chip 形态 | ✅ 已实现 |
| LLM 文本输出（table / markdown）| OutputCard TableRenderer / MarkdownRenderer | ✅ 已实现 |
| LLM mindmap JSON 输出 | MindmapRenderer（markmap-view）| ✅ 已规划 |
| LLM HTML 输出 | HtmlRenderer（iframe sandbox）| ✅ 已规划 |
| 分析结果导出 Excel | ActionBar Excel 导出（write-excel-file）| ✅ 已规划 |
| 分析结果导出 CSV / Markdown | ActionBar 已支持 | ✅ 已实现 |
| Office 文件 app 内预览 | ❌ 不做 | ✅ 业界一致 |
| Office 文件唤起本地应用 | ✅ FileFallback 双按钮（打开 / 下载） | ✅ 业界一致（Slack / Teams "Open in app" 走 OS 关联）|

所有真实场景已覆盖，不存在 FileRenderer 的合理用例。

## 后果

- ROADMAP 删除 P1 `FileRenderer + openPath` 任务
- [insight-result-viewer.md](../specs/ui/insight-result-viewer.md) §5.4 删除；§5 整体瘦身（具体 renderer 实现细节以 [output-renderers.md](../specs/ui/output-renderers.md) 为真相来源）
- 渲染器范围由 [output-renderers.md](../specs/ui/output-renderers.md) §1 taxonomy 界定。最终落地为 6 种：`table` / `mindmap` / `html` / `markdown` / `json` / `file` —— 其中 `file` 是 office/pdf/二进制的轻量入口卡（不预览，只提供"用本地应用打开 + 下载"双按钮），符合本 ADR 的"不做应用内预览"原则

## 修订历史

- 2026-05-15 — 初版，决定不做应用内预览
- 2026-05-25 — 补充"唤起本地应用是默认行为 + 双按钮拆分"，修复旧 `<a target="_blank">` 弹两窗口 bug，明确 macOS/Win 的 OS 关联兜底行为
