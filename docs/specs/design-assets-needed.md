# 设计素材替换清单

所有素材当前用 inline SVG 占位。设计师交付切图后按下表路径替换。

---

## 1. Topbar

| 用途 | 当前占位 | 期望格式 | 替换位置 |
|---|---|---|---|
| Octo AI 主 Logo | 蓝圆+五角星 SVG | SVG 或 PNG@2x，20×20 | `topbar.tsx → OctoLogoIcon()` |
| Chat Tab 图标 | 气泡轮廓 SVG | SVG，13×13 | `topbar.tsx → ChatIcon()` |
| Cowork Tab 图标 | 双人轮廓 SVG | SVG，13×13 | `topbar.tsx → CoworkIcon()` |
| Studio Tab 图标 | 四宫格轮廓 SVG | SVG，13×13 | `topbar.tsx → StudioIcon()` |

---

## 2. Sidebar

| 用途 | 当前占位 | 期望格式 | 替换位置 |
|---|---|---|---|
| Octo Insight 区块图标 | 无（纯文字） | SVG，14×14，带色 | `sidebar.tsx` Insight 标题左侧 |
| Octo Make 区块图标 | 无（纯文字） | SVG，14×14，带色 | `sidebar.tsx` Make 标题左侧 |
| Session 列表项前缀图标 | 无 | SVG，12×12 | `sidebar.tsx` For session item |
| 技能库 图标 | 星形轮廓 SVG | SVG，16×16 | `sidebar.tsx → SkillIcon()` |
| 资产库 图标 | 立方体轮廓 SVG | SVG，16×16 | `sidebar.tsx → AssetIcon()` |
| 设置 图标 | 齿轮轮廓 SVG | SVG，14×14 | `sidebar.tsx → SettingsIcon()` |

---

## 3. Insight 页

| 用途 | 当前占位 | 期望格式 | 替换位置 |
|---|---|---|---|
| 发送按钮图标 | 文字"发送" | SVG 箭头，或保留文字 | `insight/index.tsx` 发送按钮 |
| 空状态插图 | 无 | SVG / PNG，建议 120×120 | `insight/index.tsx → EmptyState()` |

---

## 替换方式

推荐将所有 SVG 切图放入 `packages/app/src/pages/_shell/icons/` 或 `insight/icons/`，以 SolidJS 组件方式 export，再在对应文件中替换 inline SVG 函数即可。PNG/WebP 资产放 `public/assets/`，通过 `<img src>` 引用。
