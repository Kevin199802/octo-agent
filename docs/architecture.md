# Octo Agent — 架构

> 上次同步:2026-04-27。本文档描述**当前真实架构**,任何分歧以代码为准。

## 1. 顶层结构

Octo Agent 是基于 [opencode](https://github.com/anomalyco/opencode) monorepo 二次开发的桌面应用,壳子用 Electron,前端用 Vue 3 重写,后端 opencode 内嵌为 Node 模块。

```
┌──────────────── Electron 主进程 (packages/desktop-electron) ────────────────┐
│                                                                              │
│   ┌──────────── Renderer (Vue 3, packages/octo-ui) ────────────┐             │
│   │                                                            │             │
│   │   Sidebar.vue  ChatView.vue  SettingsView.vue              │             │
│   │           │                                                │             │
│   │           ▼                                                │             │
│   │   composables/useOpencode.ts ── @opencode-ai/sdk ──┐       │             │
│   └────────────────────────────────────────────────────┼───────┘             │
│                                                       HTTP + SSE             │
│                                                        ▼                     │
│                                  内嵌 opencode server (127.0.0.1:4096)        │
│                                  来自 packages/opencode 的 Node bundle        │
│                                                        │                     │
└────────────────────────────────────────────────────────┼─────────────────────┘
                                                         ▼
                                            外部 LLM Provider
                                            (百炼/DeepSeek/Anthropic/...)
```

**关键点**:opencode 不是 sidecar 二进制,是 `import("virtual:opencode-server")` 加载的 Node 模块,跟 Electron 主进程**同进程**,只是再开一个本地 HTTP 服务给 renderer 用。详见 [ADR-001](adr/001-electron-vs-tauri.md)。

opencode 后端的内部工作原理(SQLite 表、HTTP 路由、SSE 协议、provider 接入)详见 [learning/opencode-internals.md](learning/opencode-internals.md)。

---

## 2. 包清单

### 2.1 自研包(可改)

| 包 | 路径 | 类比 Claude Code | 类比 VS Code | 真正职责 |
|---|---|---|---|---|
| `@octo/ui` | [packages/octo-ui/](../packages/octo-ui/) | 终端里的对话窗 | renderer 窗口 | 用户**看到 / 点 / 输入**的所有东西。纯渲染层 |
| `@octo/shell` | [packages/shell/](../packages/shell/) | skill / agent runtime | extension host | 任务调度:"该派给哪个 agent;多 agent 流水线如何编排" |
| `@octo/agent-research` | [packages/agent/research/](../packages/agent/research/) | `general-purpose` 这种 sub-agent | 一个具体 extension | 用研业务封装(prompt + 工具集 + 工作流) |

> Phase 1 现状:`shell` 和 `agent-research` 是空壳,ChatView 直连 opencode。Phase 2 接入用研流水线时启用,Phase 3 多 agent 协作扩展。

### 2.2 上游包(冻结,见 CLAUDE.md)

| 包 | 路径 | 用途 |
|---|---|---|
| `opencode` | [packages/opencode/](../packages/opencode/) | AI Agent 后端。Hono HTTP + SSE + SQLite,内置多 provider |
| `@opencode-ai/desktop` | [packages/desktop-electron/](../packages/desktop-electron/) | Electron 主进程 + preload,我们做最小化品牌/接线/调试改动 |
| `@opencode-ai/sdk` | [packages/sdk/js/](../packages/sdk/js/) | 由 OpenAPI 自动生成的客户端 |

### 2.3 仓库内但**完全不用**的包

`packages/app`(SolidJS UI)、`packages/ui`(SolidJS 组件库)、`packages/desktop`(Tauri 壳)、`packages/console/*`、`packages/enterprise`、`packages/web`、`packages/slack`、`sdks/vscode` —— 历史遗留,不删除是为了便于跟上游同步,**不要 import 也不要修改**。

---

## 3. 修改边界与上游改动清单

### 3.1 三档边界

**自由修改** —— 自研包全部 + 文档:

- `packages/octo-ui/`、`packages/shell/`、`packages/agent/*`
- `docs/`、`ROADMAP.md`、`CLAUDE.md`
- `.github/workflows/`(自研 workflow,**不含** `upstream/` 目录里归档的)

**仅允许品牌 / 接线 / 调试钩子修改** —— 上游壳子:

- `packages/desktop-electron/` 主进程及配置(见 §3.2 现有改动清单)
- 仓库根 `package.json` 的 `workspaces` 字段
- `turbo.json`(任务编排)

> 原则:绝不改业务逻辑,只改"如何启动"、"叫什么名字"、"指向哪个前端"。

**严禁修改** —— 上游核心包:

- `packages/opencode/`(后端引擎)
- `packages/desktop-electron/src/preload/`(IPC 桥接)
- `packages/sdk/`(SDK 自动生成)
- 第 2.3 节"完全不用"列出的所有包

需要新能力时优先在 octo-ui 侧实现。确实需要主进程支持时先开 issue 讨论。

### 3.2 上游壳子已有的修改清单

`git diff main...HEAD -- packages/desktop-electron/` 当前列表:

| 文件 | 改了什么 | 性质 |
|---|---|---|
| [src/main/index.ts](../packages/desktop-electron/src/main/index.ts) | 应用名 OpenCode → Octo Agent;App ID;SQLite 文件名兼容(支持 `opencode-local.db` + `opencode.db` 两种);**注入 `OPENCODE_CONFIG` 指向 `~/.config/octo/octo.config.json`** | 品牌 + 配置隔离 |
| [src/main/windows.ts](../packages/desktop-electron/src/main/windows.ts) | dev 模式自动开 DevTools;`OCTO_DEVTOOLS=1` 环境变量打开打包版 DevTools | 调试 |
| [electron-builder.config.ts](../packages/desktop-electron/electron-builder.config.ts) | 包名/图标/产品标识 | 品牌 |
| [electron.vite.config.ts](../packages/desktop-electron/electron.vite.config.ts) | renderer `root` 指向 `packages/octo-ui`,加 `@vitejs/plugin-vue`,proxy 配置 | 接线 |
| [package.json](../packages/desktop-electron/package.json) | 加 `@octo/ui`、`marked`、`@vitejs/plugin-vue` 依赖 | 接线 |

> 改动只增不删:任何新增上游壳子修改,**必须同步更新本表**,否则架构文档会再次跟代码漂移。

### 3.3 仓库根改动

- [package.json](../package.json) workspaces 字段加入 `packages/octo-ui`、`packages/shell`、`packages/agent/*`
- `.github/workflows/upstream/` —— 上游 workflow 全部移入此目录归档(不再触发),自研 workflow(若有)放在 `.github/workflows/` 根

---

## 4. 数据流

### 4.1 会话与消息

1. 用户在 [ChatView.vue](../packages/octo-ui/src/views/ChatView.vue) 输入,调用 `client.session.message.send`
2. opencode 向 LLM provider 发请求,持续推 SSE 事件给所有订阅者
3. ChatView 通过 `client.event.subscribe` 接收 SSE,事件类型:
   - `message.part.updated` — 新增 part(`step-start` 标记新 assistant 消息边界)
   - `message.part.delta` — 文本流式增量
   - `session.idle` — 该轮回复结束,**触发 REST 重新拉取消息作为权威状态**
4. UI 仅在 `session.idle` 后用 REST 数据覆盖,SSE 只负责流式打字效果。

> "REST 为权威 + SSE 为体验"是为规避 SSE 事件乱序导致的复读 bug。详细的 SSE 事件清单和 part 类型见 [learning/opencode-internals.md §SSE 协议](learning/opencode-internals.md#3-sse-事件协议)。

### 4.2 配置文件

opencode 后端启动时**优先级**:

1. `process.env.OPENCODE_CONFIG`(单文件路径) — Octo 主进程**强制注入**为 `~/.config/octo/octo.config.json`
2. `process.env.OPENCODE_CONFIG_DIR`(目录覆盖)
3. fallback 到默认 `~/.config/opencode/config.json`

由于第 1 项被主进程注入(见 [packages/desktop-electron/src/main/index.ts](../packages/desktop-electron/src/main/index.ts)),**Octo Agent 永远只读 `~/.config/octo/octo.config.json`**,跟用户机器上可能装的 opencode CLI 完全隔离。schema 关键字段:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {                                  // 单数 provider,Zod .strict()
    "<provider-id>": {
      "npm": "@ai-sdk/<package>",                // anthropic / openai-compatible / google
      "options": { "baseURL": "...", "apiKey": "..." },
      "models": { "<model-id>": { "name": "...", "limit": {...} } }
    }
  },
  "model": "<provider-id>/<model-id>"
}
```

任何未知字段会让 session 创建报 500。详细加载流程见 [learning/opencode-internals.md §配置加载](learning/opencode-internals.md#5-配置加载)。

### 4.3 持久化

opencode 内置 SQLite(Drizzle ORM),数据在:

- macOS: `~/.local/share/opencode/opencode-local.db`
- 路径来自 `XDG_DATA_HOME` 或默认 `~/.local/share/opencode/`

**注意**:虽然 Octo 的**配置**已隔离到 `~/.config/octo/`,但**数据库**仍写到 opencode 默认目录(没改)。理由:数据用户不会主动看;改 SQLite 路径需要改 opencode 内部逻辑,代价大且会破坏跟上游同步。

主要表:`session`、`message`、`part`、`todo`、`permission`、`project`、`account`(详细字段见 learning 文档)。删除整个 `~/.local/share/opencode/` 即清空所有会话历史,不影响配置。

---

## 5. UI 架构(octo-ui)

### 5.1 目录结构(当前实际)

```
packages/octo-ui/src/
├── App.vue                # 布局: <Sidebar /> + <RouterView />
├── main.ts                # 入口,挂载 router 和全局样式
├── router/index.ts        # / 和 /session/:id 都映射到 ChatView,/settings 懒加载
├── styles/tokens.css      # 三层 token: primitives → semantic → component
├── components/
│   └── Sidebar.vue        # 240px 左侧栏:品牌 / 新建 / 会话列表 / 设置
├── views/
│   ├── ChatView.vue       # 唯一对话视图,首页和具体会话共用
│   └── SettingsView.vue   # 设置页(目前只有配置文件路径提示)
└── composables/
    └── useOpencode.ts     # OpencodeClient 单例
```

### 5.2 设计 token

[styles/tokens.css](../packages/octo-ui/src/styles/tokens.css) 三层结构:

1. **Primitives** — 原始色值(`--gray-900`、`--blue-500`),不直接用
2. **Semantic** — 语义令牌(`--bg-app`、`--text-primary`、`--border`),组件**只引用这一层**
3. **Component** — 特定组件变量(目前未单独建立,如需再加)

CSS 中**禁止硬编码颜色**,新增颜色先加 primitive 再绑定 semantic。

### 5.3 状态管理

当前规模下使用 Composition API + `ref` 直接管状态,**未引入 Pinia**(包依赖也已移除)。复杂跨视图状态出现后再考虑引入。

---

## 6. Shell + Agent 架构(规划中,未实现)

Phase 1 ChatView 直连 opencode,**不经过 shell**。Phase 2 起 shell 介入做多 Agent 任务路由。

预期接口(参考,未实现):

```typescript
interface Agent {
  id: string
  name: string
  description: string
  run(task: AgentTask): AsyncIterable<AgentOutput>
  abort(): void
}
```

详见 [docs/specs/agents/multi-agent-shell.md](specs/agents/multi-agent-shell.md)。

---

## 7. 相关 ADR 与 learning

- [ADR-001 — 桌面壳:Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ADR-002 — Vue 3 替换 SolidJS](adr/002-vue3-ui-rewrite.md)
- [ADR-003 — LLM Provider 接入方案](adr/003-openai-compat-provider.md)
- [learning/opencode-internals.md](learning/opencode-internals.md) — opencode 后端工作原理
