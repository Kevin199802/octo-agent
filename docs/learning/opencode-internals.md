# opencode 后端工作原理

> 上次同步:2026-04-27,基于当前 `packages/opencode/` 源码。
>
> 本文档假设读者**没接触过 agent 框架开发**,从概念到实现都做解释。读完目标:能完整描绘 octo-ui 发一条消息后,opencode 内部经历了什么。

---

## 1. opencode 是什么

一句话:**一个本地运行的 AI Agent 后端**,把 LLM 调用、会话管理、工具执行、文件读写、SQLite 持久化全部打包成一个 Hono HTTP 服务。

它不是一个聊天 SDK,也不是 Claude Code 那种 CLI 工具(虽然 opencode 自带一个 TUI)。它的定位是 **headless agent runtime** —— 任何前端(Web、Electron renderer、TUI、VS Code 插件)只要会发 HTTP + 订阅 SSE,就能用。

我们用它的核心原因:**不用自己实现 LLM provider 适配、消息 part 拆分、工具执行循环、SQLite 持久化**。这些都是 agent 应用的通用底层,opencode 已经做完。

### 跟其他类似项目对比

| | opencode | LangChain | LlamaIndex | Claude Code |
|---|---|---|---|---|
| 形态 | 本地 HTTP server | npm 库 | npm 库 | CLI |
| 多 provider 切换 | 配置文件即可,运行时切换 | 代码切换 | 代码切换 | 仅 Anthropic |
| 持久化 | 内置 SQLite + Drizzle | 自己接 | 自己接 | 内置 |
| 工具执行 | 内置 + MCP 协议 | 内置 | 内置 | 内置 + MCP |
| 适合做什么 | **桌面 app、IDE 插件、本地 agent 平台** | 库式集成 | RAG 应用 | 终端用户 |

简化版理解:**opencode = "Claude Code 的引擎部分,剥离 CLI,改成 HTTP 服务"**。

---

## 2. 进程模型

opencode 在 Octo Agent 里的运行方式:

```
Electron 主进程 (Node.js v20)
├── 启动时 import("virtual:opencode-server")  ← electron-vite 打包出的 Node bundle
├── 调用 Server.listen({ port: 4096, ... })   ← 内部起一个 Hono HTTP server
└── opencode 跟 Electron 主进程同进程,共享 Node.js 运行时

Renderer (Vue)
└── @opencode-ai/sdk  → fetch("http://127.0.0.1:4096/...")  → 同进程 HTTP
```

**关键认知**:

- 没有 sidecar 二进制,没有跨进程 IPC,opencode 就是主进程 import 的一坨代码
- HTTP/SSE 是为了让 renderer(浏览器环境,无法直接 import Node 模块)能调到它
- 主进程 console.log 能看到 opencode 的日志(因为同进程)
- 关闭 Electron 窗口 = opencode 一起退

详见 [ADR-001](../adr/001-electron-vs-tauri.md)。

---

## 3. SSE 事件协议

### 3.1 为什么用 SSE 而不是 WebSocket

opencode 选用 [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE):单向、长连接、自动重连、HTTP 友好。Agent 场景里 server → client 是绝大部分流量(LLM token 流),client → server 走普通 POST 就够,WebSocket 的双向能力是过剩的。

### 3.2 订阅入口

```typescript
import { OpencodeClient } from "@opencode-ai/sdk"
const client = new OpencodeClient({ baseUrl: "http://127.0.0.1:4096" })

const stream = client.event.subscribe()  // GET /event,SSE 长连接
for await (const e of stream) {
  // e.type = 事件名, e.properties = payload
}
```

### 3.3 关键事件类型

opencode 发的事件远不止下面这些(还有 `installation.*`、`permission.*`、`file.*` 等),Octo 当前**关心的**是:

| 事件 | 什么时候触发 | payload 关键字段 | UI 怎么用 |
|---|---|---|---|
| `message.part.updated` | 一个 part 创建或整体更新(非增量) | `properties.part`(完整 Part 对象) | 用 `step-start` 类型来识别"新一轮 assistant 消息开始了" |
| `message.part.delta` | 文本流式增量 | `properties.messageID`、`properties.delta`(片段)、`properties.field`(`text` / `reasoning`) | 拼接到对应 message 的 text 或 reasoning 字段 |
| `session.idle` | 该轮 LLM 调用 + 工具执行全部完成 | `properties.sessionID` | 触发 REST 重新拉取该 session 的完整消息列表,作为权威状态 |

### 3.4 为什么用"REST 为权威 + SSE 为体验"

早期实现完全靠 SSE 拼:`message.part.delta` 来一段就 append 一段。看似自然,实际遇到三类问题:

1. **乱序**:网络抖动或 opencode 内部调度让 delta 顺序错乱,UI 显示成乱码或重复
2. **复读**:`message.part.delta` 事件会为**所有** part 触发,包括 user message 的 part,旧代码会把用户消息当成 assistant 内容追加,导致"AI 复读用户问题"
3. **遗漏**:某条事件丢了,UI 内容就跟后端永久不一致

最终方案在 [ChatView.vue](../../packages/octo-ui/src/views/ChatView.vue):

- SSE 只用于**流式打字效果**(让用户看到字一个一个冒出来)
- 等 `session.idle` 一到,**立即用 REST GET `/session/:id/message` 覆盖整条消息列表**,以服务端持久化为准
- 这样即便 SSE 错了,最终状态也一定是对的

---

## 4. Part 类型清单

opencode 把一条消息拆成有序的 **Part 数组**(而不是单一 text 字段),便于流式、混合内容、工具调用展示。完整定义见 [packages/opencode/src/session/message-v2.ts](../../packages/opencode/src/session/message-v2.ts):

| Part type | 含义 | UI 当前是否处理 |
|---|---|---|
| `text` | 纯文本内容(用户问题、AI 普通回复) | ✅ 用 marked 渲染 |
| `reasoning` | 思维链(Anthropic `thinking` block 等) | ✅ 折叠"思维过程"显示 |
| `step-start` | 一轮 assistant 步骤开始,标记新消息边界 | ✅ 仅用作识别信号,不渲染 |
| `step-finish` | 一轮 assistant 步骤结束 | 暂不处理 |
| `tool` | 工具调用(state: pending/running/completed/error) | ❌ 未实现,Phase 2 接入 |
| `file` | 文件附件 | ❌ 未实现 |
| `subtask` | 子任务(嵌套 agent 调用) | ❌ 未实现 |
| `agent` | agent 切换标记 | ❌ 未实现 |
| `snapshot` | 文件快照 | ❌ 未实现 |
| `patch` | 文件 diff | ❌ 未实现 |
| `retry` | 重试标记 | ❌ 未实现 |
| `compaction` | 历史压缩标记 | ❌ 未实现 |

> Phase 2 接入用研 agent 时会大量用到 `tool`,届时需要在 ChatView 加渲染分支。

---

## 5. 配置加载

opencode 启动时按以下**优先级**加载配置(在 [packages/opencode/src/config/config.ts](../../packages/opencode/src/config/config.ts) 实现):

1. `process.env.OPENCODE_CONFIG`(单文件路径) — **Octo Agent 强制注入此项**
2. `process.env.OPENCODE_CONFIG_DIR`(目录,合并 `config.json` + `opencode.json` 等)
3. xdg 默认路径 `~/.config/opencode/config.json`
4. 项目本地 `opencode.jsonc` / `opencode.json` / `config.json`(从当前目录向上查)
5. `process.env.OPENCODE_CONFIG_CONTENT`(直接传 JSON 字符串)

### Octo 的注入实现

[packages/desktop-electron/src/main/index.ts](../../packages/desktop-electron/src/main/index.ts) 在 opencode server 启动**之前**:

```typescript
if (!process.env.OPENCODE_CONFIG) {
  process.env.OPENCODE_CONFIG = join(homedir(), ".config", "octo", "octo.json")
}
```

效果:

- Octo Agent **永远只读** `~/.config/octo/octo.json`
- 用户机器上即便装了 opencode CLI(读 `~/.config/opencode/config.json`),两者数据完全隔离
- 用户可以用环境变量临时覆盖(高级用法,如调试)

### Schema 严格校验的坑

opencode 用 Zod `.strict()` 校验配置 schema,**任何未知字段都会让 session 创建报 500**。常见误写:

| 错误 | 正确 |
|---|---|
| `"providers": {...}` (复数) | `"provider": {...}` (单数) |
| provider 顶层放 `apiKey` | 放在 `options.apiKey` 下 |
| `"apikey"` / `"api_key"` | `"apiKey"`(camelCase) |
| 自创字段如 `"description": "..."` | 删掉,schema 不允许 |

调试技巧:启动 dev 后看主进程 stdout,有 schema 错会打印 `loaded custom config` + 详细字段路径。

---

## 6. SQLite 持久化

opencode 用 **Drizzle ORM + SQLite**,数据库文件在 `~/.local/share/opencode/opencode-local.db`(macOS,XDG 默认)。完整 schema 见 [packages/opencode/src/storage/schema.ts](../../packages/opencode/src/storage/schema.ts) 和各 `*.sql.ts` 文件。

### 主要表

| 表 | 含义 | 关键字段 |
|---|---|---|
| `session` | 一次"对话",对应 UI 侧栏一条 | `id`、`project_id`、`title`、`directory`、`time_compacting`(历史压缩状态) |
| `message` | session 下的一条消息(user 或 assistant) | `id`、`session_id`、`data`(JSON,包含 role/model/agent 等) |
| `part` | message 拆出的 part(见 §4) | `id`、`message_id`、`session_id`、`data`(JSON,Part 对象) |
| `todo` | agent 内部维护的任务清单(用于多步任务) | `session_id`、`text`、`status` |
| `permission` | 工具调用授权记录(用户对某操作允许/拒绝) | `session_id`、`tool`、`pattern`、`allow` |
| `project` | 工作目录(每个 directory 一条) | `id`、`directory` |
| `account` | 账号信息(主要给 SaaS 部署用,本地无关紧要) | — |

### 重要观察

- **消息内容存在 `data` JSON 字段**,不是范式化拆开 —— 设计取舍是 agent 场景下消息 schema 演化频繁,JSON 比频繁迁移友好
- **part 是消息的子表**,有自己的主键和 message_id 外键,这样流式 append 不需要重写整条 message
- **session ↔ project ↔ directory** 是绑定的,opencode 知道你"在哪个目录开了哪个会话"
- 删除 `~/.local/share/opencode/` 整个目录 = 清空所有会话和工作记录,**不影响配置文件**

### 想看自己的数据?

```bash
sqlite3 ~/.local/share/opencode/opencode-local.db ".tables"
sqlite3 ~/.local/share/opencode/opencode-local.db "SELECT id, title FROM session ORDER BY time_created DESC LIMIT 10;"
```

---

## 7. HTTP 路由概览

> ⚠️ **这节只是路由列表,不是路由框架的全貌**——本仓实际同时有两套后端实现(传统 Hono 路由 + 新的
> 类型化 Effect HttpApi),`dev`/`beta`/`local` 渠道默认只有后者在跑,前者对这些渠道是死代码。
> 新增接口该写在哪、两套怎么选、404 排查方法论,见
> [hono-vs-effect-httpapi-routing.md](hono-vs-effect-httpapi-routing.md)。

完整路由在 [packages/opencode/src/server/instance/](../../packages/opencode/src/server/instance/) 各文件,Hono + hono-openapi 注册。常用路由:

| 路由 | 方法 | 用途 |
|---|---|---|
| `/event` | GET (SSE) | 订阅所有事件流 |
| `/session` | GET / POST | 列出/创建会话 |
| `/session/:id` | GET / DELETE | 取详情 / 删除 |
| `/session/:id/message` | GET / POST | 取消息列表 / 发新消息 |
| `/session/:id/abort` | POST | 中断当前 LLM 调用 |
| `/config` | GET / POST | 取配置 / 重新加载 |
| `/provider` | GET | 列出可用 provider 和 model |
| `/project/current` | GET | 当前工作目录信息 |
| `/file/*` | GET / POST | 文件读写(给 agent 工具用) |
| `/pty/*` | WebSocket | 终端代理(给 agent 跑命令用) |
| `/permission` | GET / POST | 工具调用授权管理 |
| `/mcp/*` | — | MCP(Model Context Protocol) server 管理 |

SDK 已经把这些封装好,平时**不用直接拼 URL**:

```typescript
client.session.list()
client.session.create({ body: { ... } })
client.session.message.send({ path: { id }, body: { ... } })
```

OpenAPI schema(`/doc`)可以浏览器打开 `http://127.0.0.1:4096/doc` 看完整定义(dev 启动后)。

---

## 8. Provider 接入

opencode 通过 `npm` 字段动态加载 [Vercel AI SDK](https://sdk.vercel.ai/) 的 provider 包,支持的协议:

| `npm` 字段值 | 协议 | 适合接入 |
|---|---|---|
| `@ai-sdk/anthropic` | Anthropic Messages API | Anthropic 直连、Anthropic 兼容网关(百炼/某些代理) |
| `@ai-sdk/openai` | OpenAI Chat Completions | OpenAI 直连 |
| `@ai-sdk/openai-compatible` | OpenAI 兼容(自定义 baseURL) | DeepSeek、Moonshot、各内网网关 |
| `@ai-sdk/google` | Google Generative AI | Gemini |
| `@ai-sdk/azure`、`@ai-sdk/bedrock` 等 | 云厂商 | 按需 |

### 配置例(Anthropic 兼容网关)

```jsonc
{
  "provider": {
    "bailian": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
        "apiKey": "sk-xxx"
      },
      "models": {
        "qwen3-coder-plus": {
          "name": "Qwen3 Coder Plus",
          "limit": { "context": 1000000, "output": 65536 }
        }
      }
    }
  },
  "model": "bailian/qwen3-coder-plus"
}
```

### thinking / reasoning 字段

支持思维链的模型,在 `options` 加:

```jsonc
"options": {
  "thinking": { "type": "enabled", "budgetTokens": 8192 }
}
```

但注意:**这只是告诉 SDK 客户端"请求时带上 thinking 参数"**。能否真正出 reasoning,取决于服务端是否在响应里回 Anthropic 协议的 `thinking` block(或 OpenAI 协议的 `reasoning_content`)。第三方网关行为不一致,需要实测。

不同 provider 的 thinking/reasoning 协议差异计划在 `learning/provider-protocols.md` 单独整理。

---

## 9. 切换 provider 不会热重载

修改 `~/.config/octo/octo.json` 后:

- opencode **不会自动重新加载配置**
- 需要重启整个 dev 进程(因为 opencode 内嵌主进程,主进程不重启就拿不到新配置)
- 这是 opencode 的设计限制,不是 bug

实操:改完配置 `Ctrl+C` 关掉 dev,再 `bun run --cwd packages/desktop-electron dev`。

---

## 10. 常见疑问

**Q:opencode 的 LLM 调用是流式的吗?**
A:是。opencode 内部用 Vercel AI SDK 的 `streamText`,token 一来就 publish `message.part.delta` 事件。

**Q:工具调用是 opencode 自己做还是 LLM 做?**
A:LLM **决定**调什么工具(返回 tool_use),opencode **执行**工具(调本地代码或 MCP server),把结果发回 LLM,然后 LLM 继续生成。这个循环 opencode 内部叫 "agent loop"。

**Q:agent 是什么?跟 opencode 有什么关系?**
A:在 opencode 里,"agent" 是一个**配置**(prompt + 允许调用的工具集 + 模型偏好),不是独立进程。一个 session 默认用 `general` agent。我们后续做 `agent-research` 是想自定义这个 agent 配置(有用研专属 prompt 和工具)。详细心智模型见 `learning/agent-mental-model.md`(待写)。

**Q:多 session 并行调 LLM 行吗?**
A:行。opencode 每个 session 是独立的 agent loop,SQLite 是行级锁,SSE 事件用 `sessionID` 过滤。Octo 暂未做并行 UI,但底层支持。

**Q:能在没有 Electron 的纯 Node 环境跑 opencode 吗?**
A:能。opencode 自带 CLI(`packages/opencode/src/cli/`),可以独立装独立用。Electron 只是把它内嵌进了主进程而已。

---

## 11. 进一步阅读

- 源码入口:[packages/opencode/src/index.ts](../../packages/opencode/src/index.ts)
- HTTP 路由:[packages/opencode/src/server/instance/*.ts](../../packages/opencode/src/server/instance/)
- 消息/Part 定义:[packages/opencode/src/session/message-v2.ts](../../packages/opencode/src/session/message-v2.ts)
- SQL schema:[packages/opencode/src/session/session.sql.ts](../../packages/opencode/src/session/session.sql.ts)
- 配置加载:[packages/opencode/src/config/config.ts](../../packages/opencode/src/config/config.ts)
- 上游官网文档:https://opencode.ai/docs
