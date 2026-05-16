# 设计素材替换清单

所有素材当前用 inline SVG / 文字占位。设计师交付切图后按下表路径替换。

**维护规则**：UI 开发过程中凡遇到图标、插图、品牌资产等无法用代码精确还原的元素，须立即在本文件对应区块追加一行记录，不得跳过。

**命名约定**：图标文件统一放 `packages/app/src/pages/_shell/icons/` 或各页面目录的 `icons/` 子目录，以 PascalCase SolidJS 组件导出，文件名即下表"图标名"列。

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
