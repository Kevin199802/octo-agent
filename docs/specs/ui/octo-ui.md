# Spec: octo-ui 前端架构

## 状态
已完成（基础架构 + 对话 UI ✅，组件库待定 ⬜）

## 目标

- 从零搭建全新 Vue3 UI（不引用任何 opencode / SolidJS 组件）
- 支持多人并行开发：每个 Agent 的 UI 模块完全独立，互不影响
- 选用开源组件库加速开发，统一视觉风格

---

## 技术选型

| 层次 | 选型 | 说明 |
|---|---|---|
| 框架 | Vue3 + TypeScript | Composition API + `<script setup>` |
| 构建 | Vite 7 | dev proxy → opencode :4096，含 rewrite |
| 路由 | Vue Router 4 | hash 模式（兼容 Electron 文件协议） |
| 状态 | Pinia | 每个 Agent 模块独立 store，不共享 |
| 组件库 | 待定 | 候选：Naive UI / Element Plus |
| 样式 | CSS 自定义属性（token） | 详见下文 |
| 请求 | `@opencode-ai/sdk/client` | 必须用子路径导入，避免引入 Node.js 代码 |

> 组件库确定后更新本 spec，补充安装命令、主题配置和禁止使用的组件。

---

## 目录结构

```
packages/octo-ui/src/
├── main.ts
├── App.vue                  # 仅含 <RouterView>
├── router/index.ts          # 路由表（含各 Agent 子路由）
├── composables/
│   └── useOpencode.ts       # SDK 客户端单例
├── stores/app.ts            # 全局状态（主题等）
├── styles/
│   ├── tokens.css           # CSS 变量（颜色、间距、字体）
│   └── base.css             # reset + 全局基础样式
├── components/              # 全局公共组件
├── views/
│   ├── HomeView.vue         # 首页：会话列表 + 新建会话
│   ├── SessionView.vue      # 对话视图：流式输出
│   └── SettingsView.vue     # 设置页
└── modules/                 # 各 Agent UI 模块
    ├── research/
    ├── synthesis/
    ├── report/
    └── coding/
```

---

## 多人并行开发：模块隔离方案

每个 Agent 对应一个 `modules/<name>/` 目录，**不得跨模块引用**：

```
modules/research/
├── index.ts          # 导出路由配置（lazy import）
├── views/ResearchView.vue
├── components/       # 仅 research 内部使用
└── stores/research.ts
```

### 路由注册

```typescript
// src/router/index.ts — 主路由只注册，不引用具体组件
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: () => import("@/views/HomeView.vue") },
    { path: "/settings", component: () => import("@/views/SettingsView.vue") },
    { path: "/session/:id", component: () => import("@/views/SessionView.vue") },
    { path: "/research/:page?", component: () => import("@/modules/research/views/ResearchView.vue") },
    { path: "/synthesis/:page?", component: () => import("@/modules/synthesis/views/SynthesisView.vue") },
    { path: "/report/:page?", component: () => import("@/modules/report/views/ReportView.vue") },
    { path: "/coding/:page?", component: () => import("@/modules/coding/views/CodingView.vue") },
  ],
})
```

各模块开发时直接访问对应路由，不依赖其他模块：

```
http://localhost:5174/#/research
http://localhost:5174/#/synthesis
```

---

## CSS Token 规范

统一在 `src/styles/tokens.css` 中定义，**组件内禁止硬编码颜色值**：

```css
:root {
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;

  --color-bg-base: #0f0f0f;
  --color-bg-surface: #1a1a1a;
  --color-bg-raised: #242424;

  --color-text-primary: #f5f5f5;
  --color-text-muted: #888;
  --color-border: #2e2e2e;

  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;

  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
  --font-size-base: 14px;
}
```

---

## 与 opencode SDK 通信

```typescript
// src/composables/useOpencode.ts
// 必须从 /client 子路径导入，避免把 server.ts（Node.js only）打包进浏览器 bundle
import { createOpencodeClient } from "@opencode-ai/sdk/client"

const OPENCODE_BASE_URL = import.meta.env.DEV ? "/api" : "http://127.0.0.1:4096"

export const opencodeClient = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL })
export function useOpencode() { return opencodeClient }
```

---

## 验收条件

- [ ] 浏览器访问 `localhost:5174`，首页正常显示项目路径和会话列表
- [ ] 新建会话 → 发送消息 → AI 流式回复正常
- [ ] 访问 `localhost:5174/#/research` 加载 research 模块，不影响其他路由
- [ ] 各模块 JS chunk 独立，首屏不加载其他 Agent 代码
- [ ] 组件内无硬编码颜色值
