# Octo Agent — 项目架构文档

## 1. 上游代码库概览

本项目基于 `anomalyco/opencode`（TypeScript monorepo，包管理器 Bun 1.3.11，构建编排 Turbo）。

### 关键现有包（只读）

| 包 | 技术栈 | 职责 |
|---|---|---|
| `packages/opencode` | Bun · Hono · Effect.js · Drizzle/SQLite | AI Agent 后端，HTTP :4096 + WebSocket 流式 |
| `packages/desktop` | Tauri 2.9 · Rust · Vite | 桌面壳子，spawn opencode sidecar |
| `packages/sdk/js` | TypeScript (自动生成自 OpenAPI) | 后端 HTTP 客户端 SDK |
| `packages/shared` | TypeScript · Effect.js · Zod | 跨包共享类型与工具 |

`packages/app`、`packages/ui`、`packages/console/*` 等均不引用。

---

## 2. 目标系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  packages/desktop  (Tauri 2 壳子 — 仅改名/图标/sidecar路径，Rust不动) │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  packages/octo-ui  (Vue3 + TypeScript + Vite)                  │ │
│  │                                                                │ │
│  │  ┌──────────────┐                                              │ │
│  │  │ packages/    │  task dispatch                               │ │
│  │  │   shell      │ ──────────────┬──────────────────────────┐  │ │
│  │  │ (宿主/编排层) │               │                          │  │ │
│  │  └──────────────┘               │                          │  │ │
│  │         │                       ▼                          ▼  │ │
│  │         │            packages/agent-research   packages/agent-*│ │
│  │         │            (用户研究 Agent)           (未来子包)       │ │
│  │         │                       │                          │  │ │
│  │         └───────────────────────┴──────────────────────────┘  │ │
│  │                                 ▼                              │ │
│  │                       @opencode-ai/sdk                         │ │
│  └─────────────────────────────┬──────────────────────────────────┘ │
│                                │ HTTP + WebSocket (port 4096)       │
└────────────────────────────────┼────────────────────────────────────┘
                                 ▼
              packages/opencode  (零修改)
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              DeepSeek      Google Gemini  内网 LLM
           (openai-compat) (google sdk)  (openai-compat)
```

---

## 3. 各层职责说明

### 3.1 `packages/opencode`（完全冻结）

- Hono HTTP 服务，默认监听 `:4096`
- 主要路由：`/session`、`/project`、`/provider`、`/config`、`/file`、`/pty`
- WebSocket 流式 AI 响应（SSE / WebSocket）
- SQLite 本地持久化（Drizzle ORM，位于 `~/.opencode/`）
- 原生支持 `@ai-sdk/openai-compatible`（DeepSeek、内网 LLM 均走此 provider）
- 原生支持 `@ai-sdk/google`（Google Gemini）

### 3.2 `packages/desktop`（最小修改）

改动范围仅限：

| 文件 | 改动内容 |
|---|---|
| `src-tauri/tauri.conf.json` | `productName`、`identifier`、`mainBinaryName`、`bundle.icon` 路径 |
| `src-tauri/icons/` | 替换所有平台图标（文件名不变，内容替换） |
| `src-tauri/src/lib.rs` | 无需改动（sidecar 路径 `sidecars/opencode-cli` 不变） |
| `package.json` `build.devUrl` / `build.frontendDist` | 指向 `packages/octo-ui` 的 dev server 和构建产物 |

Rust 代码、Tauri 插件列表、权限配置均不变。

### 3.3 `packages/octo-ui`（全新开发，主战场）

**技术选型**：Vue 3 + TypeScript + Vite + Pinia + Vue Router

```
packages/octo-ui/
├── package.json          # name: "@octo/ui"
├── tsconfig.json
├── vite.config.ts        # proxy: /api → http://localhost:4096
├── index.html
└── src/
    ├── main.ts
    ├── App.vue
    ├── router/index.ts   # / home | /session/:id | /settings | /research
    ├── stores/
    │   ├── session.ts    # Pinia: 会话列表、当前会话
    │   ├── provider.ts   # Pinia: LLM provider 状态
    │   └── config.ts     # Pinia: opencode 全局配置
    ├── composables/
    │   ├── useClient.ts  # SDK 客户端单例
    │   ├── useSession.ts # 会话 CRUD + 流式订阅
    │   └── useStream.ts  # SSE/WebSocket 流封装
    ├── views/
    │   ├── HomeView.vue
    │   ├── SessionView.vue
    │   ├── ResearchView.vue   # agent-research 入口页
    │   └── SettingsView.vue
    └── components/
        ├── ChatPanel.vue
        ├── MessageBubble.vue
        └── AgentStatusBar.vue
```

### 3.4 `packages/shell`（多 Agent 宿主）

编排层，运行在 octo-ui 主进程内（也可作为 Web Worker）：

- 注册所有 `agent-*` 子包，维护 agent 注册表
- 接收 octo-ui 的任务分发请求
- 将任务路由到对应 agent
- 聚合多 agent 输出，推送回 UI store
- 管理 agent 生命周期（初始化、运行、销毁）

**Agent 统一接口**（第一阶段设计，不实现）：

```typescript
interface Agent {
  id: string
  name: string
  description: string
  run(task: AgentTask): AsyncIterable<AgentOutput>
  abort(): void
}
```

### 3.5 `packages/agent-research`（第一个业务 Agent）

用户研究专用 Agent，通过 `@opencode-ai/sdk` 与 opencode 后端通信：

- 用户访谈记录分析
- 洞察提炼与摘要
- 多轮追问对话
- 研究报告结构化输出

### 3.6 预留 Agent 子包（第一阶段只搭空壳）

| 包名 | 预期职责 |
|---|---|
| `packages/agent-synthesis` | 多轮数据聚合、跨访谈对比 |
| `packages/agent-report` | 研究报告生成与导出 |
| `packages/agent-coding` | 原型代码生成（复用 opencode 编码能力）|

---

## 4. LLM Provider 配置

opencode 通过 `~/.opencode/config.json` 配置 provider，支持多 provider 并存。

### 外网 provider（开发阶段使用）

**DeepSeek**（走 `openai-compatible`）：
```jsonc
{
  "providers": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.deepseek.com/v1" }
    }
  }
}
```
环境变量：`DEEPSEEK_API_KEY`

**Google Gemini**（走 `@ai-sdk/google`，opencode 已内置）：
```jsonc
{
  "providers": {
    "google": {}
  }
}
```
环境变量：`GOOGLE_GENERATIVE_AI_API_KEY`

### 内网 provider（生产使用，配置内置进安装包）

内网 LLM 支持 OpenAI-compat + SSE，同样走 `openai-compatible` provider：
```jsonc
{
  "providers": {
    "intranet": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://YOUR_INTRANET_HOST/v1" }
    }
  }
}
```
配置通过 `packages/desktop/src-tauri/resources/opencode-config.json` 打包进安装包，首次启动写入。

---

## 5. 构建与打包

### 跨平台打包限制（Tauri 硬约束）

> **Tauri 2 不支持从 Mac 交叉编译 Windows 包**，只能在目标平台上本地构建。

| 平台 | 本地构建（Mac） | CI 构建 |
|---|---|---|
| macOS `.dmg` / `.app` | ✅ 直接 `bun tauri build` | GitHub Actions `macos-latest` |
| Windows `.nsis` / `.msi` | ❌ 不支持 | GitHub Actions `windows-latest` |
| Linux `.deb` / `.rpm` | ❌ 不支持 | GitHub Actions `ubuntu-latest` |

第一阶段：**Mac 本地构建 macOS 包验证流程，Windows 包通过 GitHub Actions 生成**。

### 本地 macOS 构建流程

```bash
# 在 packages/octo-ui/ 先构建前端
bun run build

# 在 packages/desktop/ 打包 Tauri
bun tauri build --target aarch64-apple-darwin   # Apple Silicon
bun tauri build --target x86_64-apple-darwin    # Intel Mac
```

产物：`packages/desktop/src-tauri/target/release/bundle/dmg/*.dmg`

### Windows 构建（GitHub Actions）

`.github/workflows/build-windows.yml` 使用 `windows-latest` runner，步骤：
1. `bun install`
2. `bun run build`（在 `packages/octo-ui/`）
3. `bun tauri build`（在 `packages/desktop/`）
4. 上传 `.nsis` artifact

---

## 6. 包依赖关系图

```
packages/octo-ui
    ├── @opencode-ai/sdk          ← 通信层
    ├── packages/shell            ← multi-agent 宿主
    │       ├── packages/agent-research
    │       ├── packages/agent-synthesis  (空壳)
    │       ├── packages/agent-report     (空壳)
    │       └── packages/agent-coding     (空壳)
    └── packages/shared           ← 共享类型

packages/desktop
    ├── packages/octo-ui          ← 前端构建产物 (dist/)
    └── packages/opencode         ← sidecar 二进制

packages/opencode                 ← 冻结，零修改
```

---

## 7. 明确不动的部分

| 包 | 原因 |
|---|---|
| `packages/app` | 原 SolidJS UI，完全弃用 |
| `packages/ui` | SolidJS 组件库，不引用 |
| `packages/console/*` | SaaS 控制台，内网场景不需要 |
| `packages/enterprise` | 企业版功能，不需要 |
| `packages/web` | 官网，不需要 |
| `sdks/vscode` | VSCode 扩展，不需要 |
