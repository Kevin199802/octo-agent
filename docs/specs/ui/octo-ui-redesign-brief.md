# Brief — UI 风格刷新与基础组件落地

> 状态:可执行 brief · 优先级 P1 · 规模 [M]
>
> **本文档定位:接力 brief**。本意是 Claude Code 主对话规划完后,把 UI 实施工作给到 Codex CLI / Antigravity / Cursor 等工具去做。**不写完整 spec**,只列必要约束。

---

## 1. 目标

把 octo-ui 的视觉刷新到接近设计师的浅色风格(参考 `/Users/huowenkai/Desktop/projects/Octo-AI-UI/octo-client-shell`),**复用现有组件结构,不大重构**。同时引入 Tailwind CSS 4,为后续 P1 spec(provider-config / multi-agent / skill-system / mcp-integration)的页面落地铺好基础。

---

## 2. 必须做(P1)

### 2.1 引入 Tailwind CSS 4

设计师代码用了 Tailwind 4,octo-ui 跟着引:

```bash
bun add -D tailwindcss @tailwindcss/vite
```

`vite.config.ts` 加 `@tailwindcss/vite` plugin。

`packages/octo-ui/src/styles/tokens.css` 顶部加 `@import "tailwindcss";`,**保留现有的 CSS 变量**(三层 token 体系),让 Tailwind 和 token 共存:

- 用 `@theme` block 让 Tailwind 知道我们的 token
- 组件继续用 CSS 变量(`var(--bg-app)`),utility class 处理布局/间距

### 2.2 改成浅色主题

参考设计师配色,在 `tokens.css` 调整 semantic 层:

```css
:root {
  /* 浅色主题 */
  --bg-app:        #ffffff;
  --bg-sidebar:    #f7f7f8;
  --bg-elevated:   #ffffff;
  --bg-hover:      #f0f0f1;
  --bg-active:     #e8e9ec;
  --bg-input:      #ffffff;

  --text-primary:   #1a1a1a;
  --text-secondary: #595961;
  --text-muted:     #91919d;

  --border:         #e5e5e8;
  --border-input:   #cfcfd5;

  --accent:         #3b82f6;
  --accent-hover:   #2563eb;
  --accent-bg:      #eff6ff;
}
```

**保留** dark theme 在 `[data-theme="dark"]` 选择器下,设置页加切换(P2)。

### 2.3 重做 Sidebar

参考设计师截图的 Sidebar 结构,改造现有 [Sidebar.vue](../../../packages/octo-ui/src/components/Sidebar.vue):

- 顶部:Logo + 品牌名 (`Octo AI`)
- 搜索框 (`搜索对话和文件 Enter` 占位,P1 不实现搜索逻辑,只放 UI)
- 项目卡片 (固定显示 `Devkit / ICT 计算`,P1 不可切换 — 用户已确认项目/版本概念后置)
- 当前版本卡片 (`当前版本:V_261230`)
- 导航分组:
  - `[+] 新建对话` → 调 createSession
  - `[ ] 技能库` → 路由到 `/skills`(页面 P1 留空白占位即可)
  - `[ ] 资产库` → 路由到 `/assets`(P1 留空白占位)
- "历史记录" 标题 + 会话列表(已实现)
- 底部:`[⚙] 设置`(已实现)

宽度可以从 240px 调到 264px(对齐设计师)。

### 2.4 重做 ChatView 输入框

参考设计师截图,输入框升级:

```
┌─────────────────────────────────────────────────┐
│ 描述你想生成的内容,输入 / 唤起技能,或通过 + ...│
│                                                 │
│                                                 │
├─────────────────────────────────────────────────┤
│ [+] [✦ 通用问答 ▾]                          [➤]│
└─────────────────────────────────────────────────┘
```

- `[+]` 按钮:占位(P1 不实现上传)
- `[✦ 通用问答 ▾]`:agent 选择器(P1 占位,值固定 `general`,后续 multi-agent spec 实现)
- `[➤]` 发送按钮:已有,调整样式

输入框 focus 状态加蓝色边框(`--border-input` → `--accent`)。

### 2.5 重做 ChatView 欢迎屏

参考设计师"你好!我是 Octo AI..."欢迎屏,改 ChatView 空对话状态:

```
你好!我是 Octo AI。

请描述你的设计需求,我将会根据你的描述自动执行任务

· 通用问答:回答各类问题
· 用研助手:模拟用户访谈,生成用研报告
· 代码助手:阅读修改代码
· 评审助手:文档与代码评审

每种类型对应右侧一个 agent。
```

> 设计师原稿提到 5 个 Octo 能力(Octo Design / Make / Canvas / Insight / Review),那是设计师产品想象,**我们不照搬**,改成跟 [multi-agent.md §4](../agents/multi-agent.md#4-内置-agent-清单phase-2-起) 内置的 4 个 agent 对齐。

### 2.6 主区背景与圆角

主对话区的容器从纯色背景改为带阴影的卡片(参考设计师圆角 + 微阴影),增加视觉层次。

---

## 3. 不要做(避免范围扩张)

- ❌ **不要**实现 P1 spec 里详细的 Settings 子页(provider-config)— 那是单独的 spec 落地工作
- ❌ **不要**实现技能库/资产库的内容(P1 只是路由占位 + 空白页 + 一句"功能开发中")
- ❌ **不要**实现右侧任务区(用户已确认不做)
- ❌ **不要**实现搜索功能(P1 只放搜索框 UI)
- ❌ **不要**实现 Mac 菜单栏定制(设计师包里有,Electron 默认菜单够用)
- ❌ **不要**改主进程或 opencode 后端
- ❌ **不要**重构数据流(SSE + REST 双层逻辑保持原样,在 [ChatView.vue](../../../packages/octo-ui/src/views/ChatView.vue) 中)
- ❌ **不要**引入 React 代码或其他状态库(继续用 Vue Composition API + ref)

---

## 4. 关键约束

| 约束 | 说明 |
|---|---|
| 框架 | Vue 3 `<script setup lang="ts">` + Composition API,不用 Options API |
| 样式 | Tailwind 4 utility class + scoped CSS + 三层 token |
| 颜色 | **不能硬编码**,只用 token 变量或 Tailwind 主题映射 |
| 浏览器/Electron 兼容 | 保持 `-webkit-app-region` 拖拽区域 |
| 路由 | 用 vue-router,新增页面要 lazy import |
| 文件位置 | 新组件放 `packages/octo-ui/src/components/`,新页面放 `views/` |
| 不破坏现有功能 | ChatView 的 SSE/REST 双层逻辑必须保留(否则会复读),Sidebar 的 session 列表逻辑保留 |

---

## 5. 设计师代码包速查

设计师代码:`/Users/huowenkai/Desktop/projects/Octo-AI-UI/octo-client-shell`

关键文件:

| 文件 | 内容 | 怎么用 |
|---|---|---|
| `src/index.css` | Tailwind 入口 + 自定义 token | 抄 token 配色到我们的 tokens.css |
| `src/layout/ClientShell.tsx` | 主布局(Sidebar + 主区) | 参考布局结构,翻译成 Vue |
| `src/components/AIAssistantPanel.tsx` | 对话面板 | 参考输入框样式 |
| `src/pages/VibeDesign.tsx` | 一个 demo 页面 | **不用看**(我们不做这个功能) |
| `src/pages/OctoBuild.tsx` | 另一个 demo 页面 | **不用看** |
| `tailwind.config.*` 或 `@theme` block | Tailwind 主题配置 | 抄主题色/字体到我们的 vite 配置 |

**重点**:**只参考视觉风格**(颜色、间距、圆角、字体、阴影、hover 状态),**不参考业务逻辑和交互模型**(我们的 agent / skill / mcp 模型独立设计,见对应 spec)。

---

## 6. 验收

| # | 标准 |
|---|------|
| 1 | `bun run --cwd packages/desktop-electron dev` 起来后,打开 Electron 看到浅色主题 |
| 2 | Sidebar 接近设计师视觉(品牌、搜索框、项目卡、版本卡、导航、历史、设置) |
| 3 | ChatView 欢迎屏接近设计师视觉(标题、能力列表) |
| 4 | 输入框样式升级,有 +/agent 选择器/发送按钮三个区域 |
| 5 | 切换会话、新建会话、发消息、SSE 流式、思考折叠、复读保护 — **全部回归正常** |
| 6 | 设置页能打开,内容仍是简单的"在 ~/.config/octo/octo.config.json 中配置..."的提示 |
| 7 | 路由 `/skills`、`/assets` 可访问,显示空白占位页 |
| 8 | 没有 console error,Vue 警告也清理 |
| 9 | Tailwind utility class 和 CSS 变量都能用 |
| 10 | 跟现有 dark theme(`[data-theme="dark"]`)能切换(P1 切换 UI 不做,但 token 必须能 work) |

---

## 7. 给执行 agent 的 brief 模板

如果要丢给 Codex CLI / Antigravity 等工具,直接复制下面这段:

```
我在 /Users/huowenkai/Desktop/projects/octo-agent 这个 Vue 3 + Electron 项目里需要做 UI 风格刷新。

任务详细要求见 docs/specs/ui/octo-ui-redesign-brief.md。

设计师参考代码在 /Users/huowenkai/Desktop/projects/Octo-AI-UI/octo-client-shell(React + Tailwind 4,只看视觉,不抄逻辑)。

约束:
1. 严格遵守 brief 的"必须做 / 不要做"清单
2. 严格遵守 brief 的关键约束(Vue Composition API、Tailwind + token、不破坏现有功能)
3. 改完跑 bun run --cwd packages/desktop-electron dev 验证
4. 改完列出变更文件清单,等我确认才能 git commit

读完 brief 和现有代码后,你应该能列出"我准备改哪些文件"的清单给我,然后再开始改。
```

---

## 8. 后续工作

完成本 brief 后,以下页面在对应 spec 里详细做:

- `/settings/models` — [provider-config.md](provider-config.md)
- 对话框 agent 选择器实质化 — [multi-agent.md](../agents/multi-agent.md)
- `/skills` 内容 — [skill-system.md](../agents/skill-system.md)
- `/settings/mcp` — [mcp-integration.md](../agents/mcp-integration.md)
