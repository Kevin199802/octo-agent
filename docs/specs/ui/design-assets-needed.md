# 设计素材替换清单

所有素材当前用 inline SVG 占位。设计师交付切图后按下表路径替换。

**维护规则**：UI 开发过程中凡遇到图标、插图、品牌资产等无法用代码精确还原的元素，须立即在本文件对应区块追加一行记录，不得跳过。

---

## 1. Topbar（`packages/app/src/pages/_shell/topbar.tsx`）

| 用途 | 当前占位 | 期望格式 | 替换位置 |
|---|---|---|---|
| Octo AI 主 Logo | union.svg 渐变路径（已内联） | SVG，24×24，与设计稿核对 | `topbar.tsx → OctoLogoIcon()` |
| Chat Tab 图标 | 无（纯文字） | SVG，13×13 | `topbar.tsx` Chat 标签左侧 |
| Cowork Tab 图标 | 无（纯文字） | SVG，13×13 | `topbar.tsx` Cowork 标签左侧 |
| Studio Tab 图标 | 无（纯文字） | SVG，13×13 | `topbar.tsx` Studio 标签左侧 |
| 搜索按钮图标 | 自绘放大镜 SVG | SVG，13×13 | `topbar.tsx` 搜索按钮内 |

---

## 2. Sidebar（`packages/app/src/pages/_shell/sidebar.tsx`）

| 用途 | 当前占位 | 期望格式 | 替换位置 |
|---|---|---|---|
| 技能库 图标 | 星形轮廓 SVG | SVG，16×16 | `sidebar.tsx → SkillIcon()` |
| 资产库 图标 | 立方体轮廓 SVG | SVG，16×16 | `sidebar.tsx → AssetIcon()` |
| 设置 图标 | 齿轮轮廓 SVG | SVG，16×16 | `sidebar.tsx → SettingsIcon()` |

---

## 3. Insight 页（`packages/app/src/pages/insight/index.tsx`）

| 用途 | 当前占位 | 期望格式 | 替换位置 |
|---|---|---|---|
| 空状态插图 | 无 | SVG / PNG，建议 120×120 | `insight/index.tsx → ChatEmptyState()` |

---

## 替换方式

推荐将所有 SVG 切图放入 `packages/app/src/pages/_shell/icons/` 或各页面目录下的 `icons/`，以 SolidJS 组件方式 export，再在对应文件中替换 inline SVG 函数。PNG/WebP 资产放 `public/assets/`，通过 `<img src>` 引用。
