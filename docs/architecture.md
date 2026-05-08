# Octo Agent — 架构

> 上次同步：2026-05-07。任何分歧以代码为准。

---

## 1. 一图看懂

```
┌─────────────────────── Electron 主进程 ───────────────────────┐
│  packages/desktop-electron/  (上游壳，仅品牌+接线)               │
│   ├─ 启动 BrowserWindow                                         │
│   ├─ 内嵌 opencode Server (Node 模块，同进程)                    │
│   └─ 注入 OPENCODE_CONFIG=~/.config/octo/octo.config.json       │
│                                                                  │
│   ┌─────────────────── Renderer ───────────────────┐             │
│   │  packages/desktop-electron/src/renderer/        │             │
│   │  (上游原版，不动)                                │             │
│   │   └─ AppInterface → RouterRoot                   │             │
│   │       ├─ isInsight()  → OctoShell                │             │
│   │       │   └─ /insight/:id? ← InsightPage         │             │
│   │       ├─ isOctoPage() → OctoPageShell            │             │
│   │       │   ├─ /chat  ← ChatPage                   │             │
│   │       │   └─ /studio  ← StudioPage               │             │
│   │       └─ 其余路由 → AppShellProviders (上游原版)  │             │
│   └─────────┬──────────────────────────────────────┘             │
│             │ HTTP + SSE                                          │
│             ▼                                                     │
│   ┌──────────────────────────────────────┐                       │
│   │  内嵌 opencode Server (动态端口)       │                       │
│   │  来自 packages/opencode (上游冻结)     │                       │
│   │   ├─ Hono HTTP routes                │                       │
│   │   ├─ SSE event bus                   │                       │
│   │   └─ SQLite (Drizzle ORM)            │                       │
│   └─────────┬────────────────────────────┘                       │
│             │ Vercel AI SDK                                       │
└─────────────┼────────────────────────────────────────────────────┘
              ▼
   外部 LLM Provider (Anthropic / DeepSeek / 通义 / Google / ...)
```

opencode 不是 sidecar 二进制，是 `import("virtual:opencode-server")` 加载的 Node 模块，**与 Electron 主进程同进程**，再开一个本地 HTTP 服务给 renderer 用。详见 [ADR-001](adr/001-electron-vs-tauri.md)；后端细节见 [learning/opencode-internals.md](learning/opencode-internals.md)。

---

## 2. 包总览（改动政策一表清）

> 定位任何代码归属的**唯一入口表**。不确定能不能改，先查这里。

### 2.1 Octo 自研 — 自由改

| 路径 | 角色 | 合入内网 |
|---|---|---|
| `packages/app/src/pages/_shell/` | OctoShell 框架层（sidebar + topbar） | 直接同步目录 |
| `packages/app/src/pages/insight/` | 用研 Agent 页面 | 直接同步目录 |
| `packages/app/src/pages/chat/` | Chat 页面 | 直接同步目录 |
| `packages/app/src/pages/studio/` | Studio 页面 | 直接同步目录 |
| `packages/agent/research/agents/` | opencode agent 配置文件（`.md`） | 部署至 `~/.config/octo/agent/` |
| `docs/`、`ROADMAP.md`、`CLAUDE.md` | 文档 | 自由维护 |

> 其他 agent 各自在 `packages/app/src/pages/<name>/` 建立相同结构。

### 2.2 上游核心 — 不动

改了跟上游 diff 会乱，合入内网会冲突。

| 包 / 路径 | 用途 |
|---|---|
| `packages/opencode/` | AI Agent 后端引擎 (Hono HTTP + SSE + SQLite) |
| `packages/sdk/` | OpenAPI 自动生成的 TS 客户端 |
| `packages/ui/`（`@opencode-ai/ui`） | SolidJS 组件库 |
| `packages/app/`（`pages/_shell/`、`insight/`、`chat/`、`studio/` 和 app.tsx 路由分叉除外） | SolidJS 完整 app；`@opencode-ai/app/vite` 提供 Tailwind + 主题 + SolidJS |
| `packages/desktop-electron/src/renderer/` | 上游 renderer，不修改 |
| `packages/desktop-electron/src/preload/` | IPC 桥 |

### 2.3 上游接线壳 — 限改（品牌/接线/调试）

仅允许"应用叫什么"、"如何启动"层面的修改，绝不改业务逻辑。**改动必须同步登记到 §5.4**。

| 文件 | 改动政策 |
|---|---|
| `packages/desktop-electron/src/main/` | 主进程入口、品牌名、env 注入 |
| `packages/desktop-electron/electron-builder.config.ts` | 打包品牌 |
| `packages/desktop-electron/package.json` | 必要依赖调整 |
| `packages/app/src/app.tsx` | **限改**：仅加路由注册行，不动其他 |
| 仓库根 `package.json` | dev 脚本 |

### 2.4 仓库内但完全不用 — 既不动也不删

历史遗留或非桌面端形态，保留是为了便于跟上游同步。**不要 import，不要修改，不要"清理"**。

| 路径 | 用途（仅为认知） |
|---|---|
| `packages/desktop/` | Tauri 壳（被 ADR-001 否决） |
| `packages/web/` | opencode 官网/web 入口 |
| `packages/console/*` | opencode 商业控制台 |
| `packages/enterprise/` | 企业版 |
| `packages/extensions/` | 扩展机制 |
| `packages/containers/` | 容器化运行时 |
| `packages/shared/` | 上游内部共享代码 |
| `packages/storybook/` | UI 组件 storybook |
| `sdks/vscode/` | VS Code 扩展 |

---

## 3. 渲染层定制策略

UI 改动按下表从上往下依次尝试，绝不无理由下沉。

| 层级 | 手段 | 例子 |
|---|---|---|
| **Layer 1** | 自研组件直接用 Tailwind 具名色 | `_shell/`、`insight/` 等 Octo 自研组件 **不继承上游 CSS 变量**，直接写死色值（见下方说明） |
| **Layer 2** | 在 `insight/` 内自写组件，import `@opencode-ai/ui` 零件 | InsightPage 自写 PromptInput，复用 SessionTurn |
| **Layer 3** | 单文件 fork 到 `insight/forks/` 自维护 | 某个上游组件行为差异大时 fork 一份 |
| **Layer 4** | 直接修改上游（需 ADR 决议） | 正常工作流不应走到这里 |

### 3.1 Octo Shell 样式独立原则

上游 `@opencode-ai/ui` 的 CSS 变量（`--background-base`、`--text-base` 等）在浅色模式下对比度不足（如 `--text-base: #6f6f6f`、`--background-base: #f8f8f8` 与 `--background-stronger: #fcfcfc` 几乎无差）。

**决策：`_shell/` 和各 Octo 页面的自研组件，一律使用 Tailwind 具名色（如 `bg-gray-50`、`text-gray-900`、`text-blue-600`），不使用上游 CSS token。** 原因：

1. 上游 token 的实际解析值随主题切换变化，Octo 设计稿只有浅色一版，硬编码更可预期
2. Octo 页面不复用上游组件样式，样式隔离不会产生冲突
3. 设计师切图交付后只需替换 SVG/图片资产，不需要重新梳理 token 映射

---

## 4. 自研代码地图

```
packages/app/src/pages/
├── _shell/            # OctoShell 框架层
│   ├── index.tsx      # OctoShell + OctoPageShell 导出
│   ├── sidebar.tsx    # 左侧导航栏（Insight/Chat/Studio 入口）
│   └── topbar.tsx     # 顶部栏（Logo + Tab 切换）
├── insight/           # 用研 Agent 页面
│   └── index.tsx      # InsightPage（DataStore + PromptInput + SessionTurn）
├── chat/              # Chat 页面（占位）
│   └── index.tsx
└── studio/            # Studio 页面（占位）
    └── index.tsx

packages/agent/research/
└── agents/research.md  # 用研 agent 配置，部署至 ~/.config/octo/agent/
```

---

## 5. 数据流与外部接口

### 5.1 会话与消息

1. 用户在 PromptInput 输入 → `client.session.message.send`
2. opencode 向 LLM provider 发请求，持续推 SSE 事件
3. UI 通过 `client.event.subscribe` 接收 SSE，事件类型：
   - `message.part.updated` — 新增 part
   - `message.part.delta` — 文本/推理流式增量
   - `session.idle` — 该轮结束，**触发 REST 重新拉取作为权威状态**
   - `session.error` — 调用出错
4. UI 仅在 `session.idle` 后用 REST 数据覆盖，SSE 只负责流式打字效果

> "REST 为权威 + SSE 为体验"是为规避 SSE 事件乱序导致的复读 bug。详见 [learning/opencode-internals.md](learning/opencode-internals.md)。

### 5.2 配置文件

opencode 后端启动时优先级：

1. `process.env.OPENCODE_CONFIG`（单文件路径）— Octo 主进程**强制注入**为 `~/.config/octo/octo.config.json`
2. fallback 到默认 `~/.config/opencode/config.json`

由于第 1 项被主进程注入，**Octo Agent 永远只读 `~/.config/octo/octo.config.json`**，与用户机器上可能装的 opencode CLI 完全隔离。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "<provider-id>": {
      "npm": "@ai-sdk/<package>",
      "options": { "baseURL": "...", "apiKey": "..." },
      "models": { "<model-id>": { "name": "..." } }
    }
  },
  "model": "<provider-id>/<model-id>"
}
```

### 5.3 持久化

opencode 内置 SQLite（Drizzle ORM），数据在：

- macOS：`~/.local/share/opencode/opencode-local.db`

配置已隔离，数据库仍写到 opencode 默认目录（改路径需侵入上游，代价大）。

### 5.4 上游接线壳改动清单

> **新增改动必须同步更新本表**，否则架构文档会再次跟代码漂移。

#### `packages/desktop-electron/src/main/index.ts`

| 改了什么 | 性质 |
|---|---|
| 应用名 OpenCode → Octo Agent；App ID | 品牌 |
| 注入 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` | 配置隔离 |
| 注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | 防读取用户 `~/.claude/CLAUDE.md` 污染 agent |

#### `packages/desktop-electron/src/main/windows.ts`

| 改了什么 | 性质 |
|---|---|
| dev 模式自动开 DevTools；`OCTO_DEVTOOLS=1` 打开打包版 DevTools | 调试 |
| 注入 `__OPENCODE__.windowChrome`（mac 红绿灯位置 + sidebar inset） | 接线 |

#### `packages/desktop-electron/electron-builder.config.ts`

包名 / 图标 / 产品标识。品牌改动。

#### `packages/app/src/app.tsx`

| 改了什么 | 性质 |
|---|---|
| 新增 `OctoShell`、`OctoPageShell` import（来自 `@/pages/_shell`） | OctoShell 路由分叉 |
| 新增 `InsightPage`、`ChatPage`、`StudioPage` lazy import | 页面注册 |
| `RouterRoot` 加 `isInsight()` / `isOctoPage()` 分支，insight 走 `OctoShell`，chat/studio 走 `OctoPageShell`，其余走原版 `AppShellProviders` | 路由分叉核心逻辑 |
| 新增 `/`、`/insight/:id?`、`/chat`、`/studio` 路由声明 | 路由注册 |

#### `packages/desktop-electron/package.json`

| 改了什么 | 性质 |
|---|---|
| 移除 `@octo/app` workspace devDependency（随 octo-app 删除） | 清理 |

#### `bun.lock`

随 `octo-app` workspace 条目删除自动更新。非手动修改。

**撤回到纯上游**（合入内网最坏情况）：

1. 上面所有改动逆向回滚
2. → 仓库可跑通上游原版

---

## 6. 上游同步策略

所有上游目录不动（§2.2）。需要从上游同步新版时直接 git merge / pull，无冲突。

接线壳（§2.3）有少量改动，新版上游出现时对照 §5.4 清单手动评估是否影响接线。

---

## 7. 相关 ADR 与 learning

- [ADR-001 — 桌面壳：Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ADR-002 — Vue 3 替换 SolidJS](adr/002-vue3-ui-rewrite.md) **（已弃用）**
- [ADR-003 — LLM Provider 接入方案](adr/003-openai-compat-provider.md)
- [ADR-004 — 切回 SolidJS，复用上游 UI](adr/004-solidjs-ui-reuse.md) **（当前生效）**
- [learning/opencode-internals.md](learning/opencode-internals.md)
- [learning/agent-mental-model.md](learning/agent-mental-model.md)
- [learning/skill-and-mcp.md](learning/skill-and-mcp.md)
- [learning/provider-protocols.md](learning/provider-protocols.md)
- [learning/context-and-memory.md](learning/context-and-memory.md)
