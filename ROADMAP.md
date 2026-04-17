# Octo Agent — Roadmap

## Phase 1 — 工程基础（MVP）

**目标**：本地可调试、能与 LLM 对话、能打包分发  
**壳子**：Electron（`packages/desktop-electron` 为基础，renderer 替换为 Vue3）  
**参考 Spec**：[docs/specs/local-dev-build-release.md](docs/specs/local-dev-build-release.md)

### 里程碑

| # | 内容 | 状态 | 负责人 |
|---|---|---|---|
| M0 | 架构文档、ADR、Spec、本 Roadmap | ✅ 完成 | — |
| M1 | Monorepo 脚手架（新包注册） | ⬜ | — |
| M2 | Desktop-electron 重命名（Octo Agent 品牌） | ⬜ | — |
| M3 | `packages/octo-ui` 工程搭建 + Vite dev proxy | ⬜ | — |
| M4 | SDK 集成 & opencode 后端连通验证 | ⬜ | — |
| M5 | LLM Provider 配置（DeepSeek + Google Gemini） | ⬜ | — |
| M6 | 核心对话 UI（流式输出 + Markdown 渲染） | ⬜ | — |
| M7 | Multi-Agent 骨架（shell + agent-research + 3 空壳） | ⬜ | — |
| M8 | Electron 集成 & 端到端本地验证 | ⬜ | — |
| M9 | macOS / Windows 构建产物验证 | ⬜ | — |

### 各里程碑详细说明

#### M1 — Monorepo 脚手架

新建以下目录，各含最小 `package.json`（name + version + 空 scripts），然后在根目录 `bun install` 验证 workspace 链接：

- `packages/octo-ui/`（name: `@octo/ui`）
- `packages/shell/`（name: `@octo/shell`）
- `packages/agent-research/`（name: `@octo/agent-research`）
- `packages/agent-synthesis/`（name: `@octo/agent-synthesis`，空壳）
- `packages/agent-report/`（name: `@octo/agent-report`，空壳）
- `packages/agent-coding/`（name: `@octo/agent-coding`，空壳）

验收：`bun install` 无报错，`bun run typecheck` 新包无错误。

#### M2 — Desktop-electron 重命名

改动范围（`packages/desktop-electron/` 内）：

- `src/main/index.ts`：`APP_NAMES`、`APP_IDS` 中加入 `octo` channel
- `icons/octo/`：新建目录，放入品牌图标（1024x1024 PNG 源图）
- `electron-builder.config.ts`：`productName`、`appId`、`icon` 路径更新
- `package.json`：`name` 改为 `@octo/desktop`

验收：`bun run dev` 启动后标题栏和 Dock 显示 "Octo Agent"。

#### M3 — `packages/octo-ui` 工程搭建

技术栈：Vue3 + TypeScript + Vite + Pinia + Vue Router

关键配置：
- `vite.config.ts`：`server.proxy['/api']` → `http://127.0.0.1:4096`，`ws: true`
- `build.outDir`：`../desktop-electron/out/renderer`（或 electron-vite 指定路径）
- 初始路由：`/`（首页）、`/session/:id`、`/research`、`/settings`

验收：`bun run dev` 启动 dev server，浏览器访问 `localhost:5173` 显示首页骨架。

#### M4 — SDK 集成 & 后端连通

使用 `@opencode-ai/sdk` 的 `createOpencodeClient`，首页显示 opencode 后端返回的 project 名称。

验收端点：
- `GET /project` → 首页显示目录
- `GET /session` → 首页显示历史会话数
- `GET /provider` → 设置页显示已配置 provider

#### M5 — LLM Provider 配置

本地开发：环境变量 `DEEPSEEK_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`  
配置文件：`~/.opencode/config.json`，格式见 [ADR-003](docs/adr/003-openai-compat-provider.md)

验收：设置页能看到 provider，创建会话指定 `deepseek/deepseek-chat` 不报错。

#### M6 — 核心对话 UI

流程：HomeView 新建会话 → SessionView 发送消息 → SSE 流式渲染 AI 回复

关键实现点：
- `useStream` composable 订阅 WebSocket `session.{id}.message` 事件
- `message.partial` → 追加 token；`message.complete` → 结束；`message.error` → toast
- 消息内容支持 Markdown 渲染（`marked` + `highlight.js`）

验收：完成一次多轮对话，流式输出正确，刷新后历史保留。

#### M7 — Multi-Agent 骨架

`packages/shell/src/types.ts` 定义统一 Agent 接口：

```typescript
interface AgentTask { sessionId: string; input: string; context?: Record<string, unknown> }
interface AgentOutput { type: "token" | "complete" | "error"; content?: string }
interface Agent { id: string; name: string; run(task: AgentTask): AsyncIterable<AgentOutput>; abort(): void }
```

`packages/agent-research`：实现 `Agent` 接口，业务逻辑 TODO 占位  
其余 3 个空壳：只导出 `throw new Error("Not implemented")` 的实现

验收：`packages/shell` 单测：注册 agent-research，dispatch 任务，收到 AsyncIterable。

#### M8 — Electron 集成 & 端到端验证

`electron.vite.config.ts` 中 renderer 指向 octo-ui 而非原有 SolidJS app。

验收清单：
- Electron 窗口加载 octo-ui，无 console 错误
- 创建会话 → 发送消息 → 流式回复正常
- 关闭应用后 opencode 服务正常退出
- 重启后历史会话保留

#### M9 — 构建产物验证

详见 [docs/specs/local-dev-build-release.md](docs/specs/local-dev-build-release.md) 第 5 节。

```bash
# macOS
cd packages/desktop-electron && bun run build && bun run package:mac

# Windows（在 Windows 机器上）
cd packages/desktop-electron && bun run build && bun run package:win
```

验收：全新机器安装 dmg/exe 后应用正常启动，能完成一次对话。

---

## Phase 2 — 用研 Agent 功能

待设计稿确认后拆分 spec，届时新建 `docs/specs/agent-research.md`。

## Phase 3 — 多 Agent 协作

待 Phase 2 验证后规划。
