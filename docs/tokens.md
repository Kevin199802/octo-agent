# Octo Designer 设计系统 — BASE

## 本文件职责

- 定义全局 token、尺寸基线、交互状态规则和通用组件映射。
- 作为所有页面、组件和 AI 生成任务的基础约束。

## 本文件不负责

- 不定义单个组件的完整变体、状态和业务语义。
- 不描述同步流程、命令和维护步骤。

## 设计原则

- 工具优先：支持高频操作、扫描、筛选、管理，不做营销展示。
- 低干扰：白/浅灰背景为主，品牌蓝只用于主操作和当前状态。
- 紧凑清晰：控件高度固定，布局不随内容变化跳动。
- 组件化：优先组合已有组件，不为单页创造新样式。
- 状态完整：每个可交互组件至少覆盖默认、hover、选中、禁用四态。

## 颜色 Token

| Token | 值 | 用途 |
|---|---|---|
| `brand.primary` | `#0067D1` | 主按钮、当前导航下划线、关键操作 |
| `brand.primary.hover` | `#2E86DE` | 主按钮 hover |
| `text.primary` | `#191919` | 正文、导航文本、菜单文本 |
| `text.strong` | `#101828` | 品牌名、当前导航、重要标题 |
| `text.secondary` | `#777777` | 辅助说明、placeholder |
| `text.tertiary` | `#364153` | 左侧导航分组标题 |
| `border.default` | `#E5E7EB` | 顶部导航分隔线、通用浅边框 |
| `border.input` | `#C9C9C9` | 输入框边框 |
| `surface.page` | `#FFFFFF` | 页面主背景 |
| `surface.selected` | `#EFF6FF` | 选中背景（导航、列表） |
| `surface.avatar` | `#D1D5DC` | 头像兜底背景 |

颜色规则：品牌蓝禁止大面积铺背景；普通文本禁止使用蓝色；同一页面不得出现多套高饱和颜色。

## 状态色（语义色）

| 语义 | 前景色 | 背景色（浅） | 用途 |
|---|---|---|---|
| Success | `#52C41A` | `#F6FFED` | 成功状态、Badge、Alert |
| Warning | `#FAAD14` | `#FFFBE6` | 警告状态 |
| Error | `#FF4D4F` | `#FFF2F0` | 错误状态、必填星号 |
| Info | `#0067D1` | `#EFF6FF` | 信息提示（同 brand.primary） |
| Disabled 文本 | `#BFBFBF` | — | 禁用态文字 |
| Disabled 背景 | — | `#F5F5F5` | 禁用态控件背景 |

规则：语义色只用于状态标识（Badge、Alert 色条、状态点），不铺大面积背景。

## 字体

```css
font-family: "HarmonyOS Sans", Inter, "Noto Sans JP", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

## 字号规格

### 标题层级

| 级别 | 字号 / 行高 / 字重 | 用途 |
|---|---|---|
| H1 | 24px / 32px / Semibold | 页面主标题 |
| H2 | 20px / 28px / Semibold | 区块标题 |
| H3 | 16px / 24px / Medium | 卡片 / 面板标题 |
| H4 | 14px / 22px / Medium | 表单分组标题 |

### 正文 / 控件

| 场景 | 字号 | 行高 | 字重 |
|---|---|---|---|
| 品牌名 | 14px | 20px | Bold |
| 主文本 / 按钮 | 14px | 22px | Regular |
| 输入框 / 搜索框 | 12px | 18px | Regular |
| 左侧菜单 | 12px | 20px | Regular |
| 左侧分组标题 | 12px | 20px | Medium |
| 面包屑 | 12px | 20px | Regular |
| 辅助说明 / 步骤描述 | 12px | 20px | Regular |
| Tag 标签 | 10px | 16px | Regular |

## 间距 Token

| Token | 值 | 用途 |
|---|---|---|
| `space.1` | 4px | 按钮垂直内边距 |
| `space.2` | 8px | 图标与文字间距 |
| `space.3` | 12px | 输入框水平内边距 |
| `space.4` | 16px | 导航左右边距、工具栏间距 |
| `space.8` | 32px | 页签间距 |
| `space.10` | 40px | 左侧菜单文本缩进 |

## 圆角 Token

| Token | 值 | 用途 |
|---|---|---|
| `radius.sm` | 4px | 按钮、输入框、Tag、Badge、下拉触发器 |
| `radius.md` | 6px | 图标按钮 hover 容器、Popover |
| `radius.lg` | 8px | 卡片、Modal、Drawer |
| `radius.full` | 9999px | 头像、Switch、圆形步骤图标 |

## 阴影层级

| Token | 值 | 用途 |
|---|---|---|
| `shadow.sm` | `0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1)` | 卡片、悬浮工具栏 |
| `shadow.md` | `0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)` | 下拉菜单、Popover |
| `shadow.lg` | `0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)` | Modal、Drawer、Sheet |

## 图标尺寸

| 尺寸 | 用途 |
|---|---|
| 10px | Tag 内图标 |
| 12px | 面包屑图标、Badge 内图标 |
| 14px | 按钮内图标、菜单图标、侧栏展开箭头 |
| 16px | 工具栏操作图标、侧栏图标、Checkbox / Radio |
| 20px | 步骤条 ✓ 图标 |
| 24px | 导航高亮图标（较大） |

## 动效 Token

| Token | 值 | 用途 |
|---|---|---|
| `duration.fast` | 100ms | hover、Tooltip 显隐 |
| `duration.normal` | 200ms | 下拉展开、Switch、Collapse |
| `duration.slow` | 300ms | Modal、Drawer 弹出 |
| `easing` | `cubic-bezier(0.4, 0, 0.2, 1)` | 通用缓动曲线 |

## 交互状态规则

| 状态 | 规则 |
|---|---|
| Focus ring | `2px solid #0067D1`，offset 2px（键盘导航时显示） |
| Active / Pressed | 比 hover 深一档（约 `#004EA8`） |
| Disabled | 文本 `#BFBFBF`，背景 `#F5F5F5`，`cursor:not-allowed` |
| 输入框 focus | 边框 `#0067D1` + 光晕 `box-shadow: 0 0 0 2px rgba(0,103,209,0.2)` |

## 关键组件尺寸

| 组件 | 高度 / 尺寸 |
|---|---|
| 顶部导航 | 56px |
| 左侧导航宽度 | 255px |
| 侧栏菜单项 | 36px（px-16） |
| 主按钮 / 次按钮 | ~30px（py-4，水平 px-16，字号 14px/22px） |
| 输入框 / 搜索框 / Select | 32px（px-12） |
| Icon Button | 30×30px |
| Switch | 38×20px |
| Tag | 高 22px（py-2，px-8） |
| Checkbox / Radio | 16×16px |
| Steps 图标 | 32px 圆形 |
| Drawer 宽度 | 378–480px |
| Avatar S/M/L/XL | 24 / 32 / 40 / 64px |
| Tabs 容器 | 54px 高，页签间距 32px |

## Shadcn/ui 组件映射

| 用途 | 组件 |
|---|---|
| 主 / 次 / 文本按钮 | `Button`（variant 扩展） |
| 图标按钮 | `Button` variant="icon" |
| 输入框 | `Input` |
| 搜索框 | `Input` + lucide `Search` |
| 下拉选择 | `Select` |
| 复选框 | `Checkbox` |
| 单选框 | `RadioGroup` |
| 开关 | `Switch` |
| 顶部页签 | `Tabs` 或自定义 NavTabs |
| 左侧导航 | `Sidebar` / 自定义 nav item |
| 面包屑 | `Breadcrumb` |
| 下拉菜单 | `DropdownMenu` |
| 弹窗 | `Dialog` |
| 侧边面板 | `Sheet` |
| 表格 | `Table` |
| 状态标签 / Tag | `Badge`（仅用于状态，不用于装饰） |
| 头像 | `Avatar`（含 Fallback） |
| 进度条 | `Progress` |
| 骨架屏 | `Skeleton` |
| 提示气泡 | `Tooltip` |
| 气泡确认 | `Popover` + 确认按钮 |

实现规则：不直接修改 Shadcn/ui 源组件；所有颜色落到 CSS variables 或 Tailwind theme；图标库统一用 lucide-react。

## AI 生成规则

**必须：**
- 使用上方 token、组件和尺寸约束
- 生成真实可操作的工具界面，不生成展示型落地页
- 包含必要状态（空态、加载态、选中态、hover 态）
- 文案使用工具型命令式：「导出」「新建」「保存」「取消」
- 使用图标表达常见动作：搜索、更多、关闭、展开、导入、导出

**禁止：**
- 大面积紫蓝渐变、玻璃拟态、装饰光斑
- 把页面主体验包在大卡片中
- 多套不一致的圆角、边框或按钮风格
- 同一区域超过一个主按钮
- 营销型文案和无业务意义的装饰插画

## 验收清单

- [ ] 主色使用 `#0067D1`，未滥用于背景或普通文本
- [ ] 按钮 30px、输入框 32px、菜单项 36px、顶部导航 56px
- [ ] 圆角统一（按钮/输入框 4px，卡片 ≤ 8px）
- [ ] 无营销型 Hero 和装饰大卡片
- [ ] 当前状态、选中态、hover 有明确视觉反馈
- [ ] 常见桌面宽度下正常显示
- [ ] 文案是工具型、动作型、具体明确
- [ ] 组件可映射到 Shadcn/ui
- [ ] 颜色未硬编码，落在 CSS variables 或 Tailwind theme
