# 设计素材替换清单

所有素材当前用 inline SVG / 文字占位。设计师交付切图后按下表路径替换。

**维护规则**：UI 开发过程中凡遇到图标、插图、品牌资产等无法用代码精确还原的元素，须立即在**当前活跃批次**追加一行记录，不得跳过。

**命名约定**：图标文件统一放 `packages/app/src/pages/_shell/icons/` 或各页面目录的 `icons/` 子目录，以 PascalCase SolidJS 组件导出，文件名即下表"图标名"列。

**交付格式约定（硬约束）**：

| 资产类型 | 格式 | 要求 |
|---|---|---|
| 图标（`Icon*`） | **SVG**（首选） | 经 SVGO 优化；设 `viewBox`、不写死 `width/height`（由代码控尺寸）；**单色图标**用 `fill="currentColor"`（颜色由 CSS 控，跟随主题）；**多色图标**（如文件类型图标）品牌色内联、透明背景；同一套图标 stroke 宽度一致 |
| 需动效的图标（如上传中 spinner） | **SVG** | 单段弧/单 path，可被 CSS `transform: rotate` 旋转，不要内嵌 SMIL 动画 |
| 插图（`Illustration*`） | SVG 首选；纯位图退 **WebP / 2x·3x PNG** | 透明背景；放 `packages/app/public/assets/` |

**不接受**：icon font、sprite sheet（本仓走每组件内联 SVG，不用雪碧图）、JPG（无透明通道）。
设计师按目标像素（14 / 16 / 24 / 32）对齐像素网格设计，但**交付仍是矢量 SVG**。

---

## 批次管理

按"功能 / 时间窗"分批，每批次有独立完成状态。设计师每次拿到清单只看当前活跃批次即可。

| 批次 | 范围 | 状态 |
|---|---|---|
| **Batch 1** | Topbar / Sidebar / Insight 输入区 / ResultViewer 输出卡片图标 | 已交付（§1–§5，作为存档保留） |
| **Batch 2** | 长任务卡片状态视觉态（5 态图标、按钮图标、状态色 token） | 待交付（§6） |
| **Batch 3** | 文件上传交互：附件 chip + 气泡内文件卡片（文件类型图标集、chip 状态/操作图标） | 待交付（§7） |

**追加新批次**：开新章节、批次号 +1，在本表登记范围与状态。完成后状态改 "已交付"。

**移除已交付批次**：原则上不删，留作历史存档；如清单过长可整体折叠到附录。

---

# Batch 1 — 已交付（存档）

> 以下 §1–§5 为已交付素材清单，保留作存档。如需修改，请新开 Batch。

---

## 1. Topbar（`packages/app/src/pages/_shell/topbar.tsx`）

| 图标名 | 用途 | 尺寸 | 当前占位 | 替换位置 |
|---|---|---|---|---|
| `OctoLogo` | 主品牌 Logo | 24×24 | union.svg 渐变路径（已内联） | `OctoLogoIcon()` |
| `IconChat` | Chat Tab 图标 | 13×13 | 无（纯文字） | `topbar.tsx` Chat 标签左侧 |
| `IconCowork` | Cowork Tab 图标 | 13×13 | 无（纯文字） | `topbar.tsx` Cowork 标签左侧 |
| `IconStudio` | Studio Tab 图标 | 13×13 | 无（纯文字） | `topbar.tsx` Studio 标签左侧 |
| `IconSearch` | 搜索按钮 | 13×13 | 自绘放大镜 SVG | `topbar.tsx` 搜索按钮内 |
| `AvatarUser` | 用户头像 | 28×28 | "U" 字母 + 渐变圆 | `topbar.tsx` 右侧头像区，需对接真实用户数据 |

---

## 2. Sidebar（`packages/app/src/pages/_shell/sidebar.tsx`）

| 图标名 | 用途 | 尺寸 | 当前占位 | 替换位置 |
|---|---|---|---|---|
| `IconSkill` | 技能库导航 | 16×16 | 星形轮廓 SVG | `SkillIcon()` |
| `IconAsset` | 资产库导航 | 16×16 | 立方体轮廓 SVG | `AssetIcon()` |
| `IconSettings` | 设置导航 | 16×16 | 齿轮轮廓 SVG | `SettingsIcon()` |

---

## 3. Insight 对话区（`packages/app/src/pages/insight/`）

| 图标名 | 用途 | 尺寸 | 当前占位 | 替换位置 |
|---|---|---|---|---|
| `IllustrationInsightEmpty` | 对话空状态插图 | 120×120 推荐 | 无插图，仅文字 | `insight/index.tsx → ChatEmptyState()` |
| `IconSend` | 发送按钮 | 14×14 | 文字"发送" | `insight/index.tsx` 输入框工具栏右侧 |
| `IconAttach` | 附件上传按钮 | 14×14 | 文字"＋ 附件" | `insight/index.tsx` 输入框工具栏左侧 |

---

## 4. ResultViewer 输出卡片类型图标（`insight/components/insight-turn.tsx`）

目前使用 Unicode 字符占位，需替换为统一风格图标。

| 图标名 | 用途 | 尺寸 | 当前占位 | 替换位置 |
|---|---|---|---|---|
| `IconCardTable` | 表格类型输出卡片 | 16×16 | `⊞`（Unicode） | `TYPE_ICON.table` |
| `IconCardMindmap` | 思维导图类型卡片 | 16×16 | `⎇`（Unicode） | `TYPE_ICON.mindmap` |
| `IconCardJson` | JSON 类型卡片 | 16×16 | `{}`（文字） | `TYPE_ICON.json` |
| `IconCardFile` | 文件类型卡片 | 16×16 | `📄`（Emoji） | `TYPE_ICON.file` |
| `IconCardMarkdown` | Markdown 报告卡片 | 16×16 | `📋`（Emoji） | `TYPE_ICON.markdown` |
| `IconCardHtml` | HTML 可视化卡片 | 16×16 | 自绘 SVG 占位（HTML5 简化图形） | `CardTypeIcon.html`（`insight/icons/index.tsx`） |

---

## 5. ResultViewer（`packages/app/src/pages/insight/components/result-viewer/`）

| 图标名 | 用途 | 尺寸 | 当前占位 | 替换位置 |
|---|---|---|---|---|
| `IllustrationResultEmpty` | 结果区空状态插图 | 32×32（可更大） | 自绘文档 SVG，透明度 0.2 | `result-viewer/index.tsx → ResultViewerEmpty()` |
| `IconActionCopy` | ActionBar 复制按钮 | 14×14 | 自绘 SVG | `result-viewer/action-bar.tsx` |
| `IconActionDownload` | ActionBar 下载按钮 | 14×14 | 自绘 SVG | `result-viewer/action-bar.tsx` |
| `IconTabClose` | Tab 关闭按钮 | 12×12 | `×`（文字） | `result-viewer/tab-bar.tsx` |

---

---

# Batch 2 — 待交付（长任务卡片）

> spec: [task-card.md](task-card.md)。本批次是 InsightPage 引入长任务异步呈现机制后新增的素材诉求。

## 6. 长任务卡片（`packages/app/src/pages/insight/components/task-card/`）

**视觉态需校准**：5 个状态（pending / processing / completed / failed / stopped）的图标、底色、边框色当前是开发期估值，spec 见 [task-card.md §4 §5](task-card.md)。

| 资产 | 当前占位 | 替换位置 |
|---|---|---|
| 状态图标 ⏸（pending）/ ⏳（processing）/ ✓（completed）/ ⚠（failed）/ ⏹（stopped） | Unicode 字符 | `task-card/index.tsx → statusIcon()` |
| 刷新按钮图标 `↻` | Unicode 字符 | `task-card/index.tsx → RefreshButton` |
| 终止按钮图标 `⏹` | Unicode 字符 | `task-card/index.tsx → Header` 内 |
| 操作按钮图标 `📄`（查看完整结果）/ `💬`（在对话里继续讨论） | Emoji | `task-card/index.tsx → Body` 内 |
| 二次确认警告图标 `⚠️` | Emoji | `task-card/index.tsx → StopConfirmRow` |

### 设计 token 估值（待校准）

`packages/app/src/pages/insight/octo-tokens.css` 新增的状态色 token 为开发期估值，需设计师给最终值：

| Token | 当前值 | 用途 |
|---|---|---|
| `--octo-success` | `#16A34A` | completed 卡片边框 |
| `--octo-success-subtle` | `rgba(22, 163, 74, 0.08)` | completed 卡片底色 |
| `--octo-danger` | `#DC2626` | failed 卡片边框 / 错误文案 / 终止按钮 |
| `--octo-danger-subtle` | `rgba(220, 38, 38, 0.08)` | failed 卡片底色 |

stopped 态当前复用 `--octo-surface-hover` / `--octo-border-default`，无新 token。

---

---

# Batch 3 — 待交付（文件上传交互）

> spec: [file-upload.md](../infra/file-upload.md)。本批次是 Insight 文件上传交互改版（chip 移入胶囊内部 + 气泡内文件卡片替代裸 S3 URL）后新增的素材诉求。
> 参考视觉：客户给的图一（蓝色 `DOCX` 文件图标）、图二（`MD` 徽标式文件卡片）。

## 7.1 文件类型图标集（核心，chip 与文件卡片共用）

一套统一风格的文件类型图标，**附件 chip** 和**气泡内文件卡片**两处复用。当前用 Emoji / 文字徽标占位，需设计师给一套切图。

| 图标名 | 文件类型 | 当前占位 | 用到的位置 |
|---|---|---|---|
| `IconFilePdf` | pdf | `📕` Emoji | chip：`attachment-bar.tsx → getMimeIcon()`；卡片徽标：`insight-turn.tsx → extBadge()` |
| `IconFileDocx` | doc/docx | `📝` Emoji | 同上 |
| `IconFileXlsx` | xls/xlsx | `📊` Emoji | 同上 |
| `IconFileMarkdown` | md | `📄` Emoji | 同上 |
| `IconFileTxt` | txt | `📄` Emoji | 同上 |
| `IconFileImage` | 图片 | `🖼` Emoji | 同上 |
| `IconFileGeneric` | 其他/兜底 | `📄` Emoji | 同上 |

**尺寸**：两套尺寸或一套矢量两处缩放——
- chip 内（胶囊顶部单行）：**14×14**，与 12px 文件名同行
- 气泡内文件卡片：**24×24 ~ 32×32**（参考图二卡片左侧徽标量级，可带类型色底）

**风格要求**：建议每种类型带辨识色（如 pdf 红、docx/word 蓝、xlsx/excel 绿、md/txt 灰），与图一/图二一致；矢量优先（SVG），便于两处缩放。

> 当前气泡文件卡片用纯文字徽标（`MD` / `DOCX`，`octo-tokens.css .octo-input-attachment-card__badge`）占位。
> **目标态（推荐，视觉优先）**：把徽标位替换成 §7.1 的彩色 `IconFile*` 图标（参考图一蓝色 DOCX 块），辨识度与一致性最佳。
> 纯文字徽标仅作为图标集未就绪时的降级兜底，非目标态。

## 7.2 chip 状态 / 操作图标（`attachment-bar.tsx`）

附件 chip 上的状态与操作图标，当前 Emoji / 文字占位。

| 图标名 | 用途 | 尺寸 | 当前占位 | 替换位置 |
|---|---|---|---|---|
| `IconChipUploading` | 上传中状态 | 12×12 | `⏳` Emoji | `attachment-bar.tsx` Switch `att.status === "uploading"` |
| `IconChipError` | 上传失败状态 | 12×12 | `⚠️` Emoji | `attachment-bar.tsx` Switch `att.status === "error"` |
| `IconChipRetry` | 失败重传按钮 | 11×11 | `↻` 文字 | `attachment-bar.tsx` 重传 `<button>` |
| `IconChipRemove` | 移除附件按钮 | 11×11 | `×` 文字 | `attachment-bar.tsx` 删除 `<button>` |

> `IconChipRetry` / `IconChipRemove` 与 Batch 2 长任务卡片的 `↻` / 关闭语义相近，若设计给的是通用图标可直接复用，不必单独切。
> `IconChipUploading` 若需转圈动画，建议给可 CSS 旋转的单色 SVG（spinner）。

---

## 替换方式

1. 图标放入对应页面目录的 `icons/` 子目录，以 SolidJS 函数组件导出：
   ```tsx
   // packages/app/src/pages/_shell/icons/IconSearch.tsx
   export function IconSearch(): JSX.Element {
     return <svg .../>
   }
   ```
2. 在原文件中 `import { IconSearch } from "./icons/IconSearch"` 替换 inline SVG 函数
3. 插图（`Illustration*`）放 `packages/app/public/assets/`，通过 `<img src="/assets/xxx.svg">` 引用
4. 头像等动态数据（`AvatarUser`）替换时需同步对接用户上下文 API
