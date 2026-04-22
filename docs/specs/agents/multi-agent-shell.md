# Spec: Multi-Agent Shell 架构

## 状态
骨架已完成，各 Agent 业务逻辑待实现

## 目标

实现一个多 Agent 宿主层（shell），统一管理多个 AI Agent 的注册、调用和流式输出。第一个 Agent 是用研 Agent（agent-research），其余三个（synthesis、report、coding）为存根，后续按设计稿拆分 spec 后补全。

---

## 背景：前端开发者需要了解的客户端分层

### Electron 的三层结构

```
┌─────────────────────────────────────┐
│  Renderer Process（渲染进程）         │
│  就是浏览器标签页，运行 Vue3 UI        │
│  packages/octo-ui/                  │
├─────────────────────────────────────┤
│  Main Process（主进程）              │
│  Node.js 环境，管理窗口、系统 API      │
│  packages/desktop-electron/src/main/ │
├─────────────────────────────────────┤
│  opencode 后端（内嵌在主进程）         │
│  Hono HTTP 服务，监听 :4096           │
│  packages/opencode/                 │
└─────────────────────────────────────┘
```

**类比**：opencode 就是 BFF 后端，主进程是 Node 服务器，渲染进程是浏览器里的 Vue 应用。三者都在用户电脑上运行，没有网络延迟。

### 为什么需要 Shell 层

opencode 是通用 AI 对话框架（支持 30+ LLM，管理会话历史）。Shell 层在它之上做**业务编排**：收到用户任务后，决定调用哪个 Agent、怎么传参、怎么聚合多个 Agent 的输出。

```
前端 UI  →  shell（任务分发）  →  agent-research（调用 opencode 完成对话）
                              →  agent-synthesis（待实现）
                              →  agent-coding（待实现）
```

---

## 文件结构

```
packages/shell/
  src/
    index.ts       — 导出 AgentRegistry
    types.ts       — Agent 接口定义
    registry.ts    — 注册与查找实现
packages/agent/
  research/src/index.ts    — ResearchAgent（实现 Agent 接口）
  synthesis/src/index.ts   — 存根
  report/src/index.ts      — 存根
  coding/src/index.ts      — 存根
```

---

## 接口定义

```typescript
// packages/shell/src/types.ts
export interface AgentTask {
  sessionId: string
  input: string
  context?: Record<string, unknown>
}

export type AgentOutputChunk =
  | { type: "token"; content: string }
  | { type: "complete" }
  | { type: "error"; message: string }

export interface Agent {
  readonly id: string
  readonly name: string
  run(task: AgentTask): AsyncIterable<AgentOutputChunk>
  abort(): void
}
```

`run()` 返回 `AsyncIterable`，前端 `for await` 逐 token 渲染，不需要等 AI 生成完整回复。

---

## ResearchAgent 实现

```typescript
// packages/agent/research/src/index.ts
import type { Agent, AgentTask, AgentOutputChunk } from "@octo/shell"

export class ResearchAgent implements Agent {
  readonly id = "research"
  readonly name = "用研 Agent"
  private abortController: AbortController | null = null

  async *run(task: AgentTask): AsyncIterable<AgentOutputChunk> {
    this.abortController = new AbortController()
    try {
      // TODO: 通过 @opencode-ai/sdk/client 的 session.prompt() 发送消息
      // 订阅 client.event.subscribe() 的 message.part.updated 事件逐 token yield
      yield { type: "token", content: `[用研 Agent] 收到任务：${task.input}` }
      yield { type: "complete" }
    } catch (err) {
      yield { type: "error", message: String(err) }
    }
  }

  abort(): void { this.abortController?.abort() }
}
```

---

## 包依赖关系

```
agent/* → shell（单向，shell 不依赖任何 agent 包）
```

各 agent 包的 `package.json` 声明：

```json
{ "dependencies": { "@octo/shell": "workspace:*" } }
```

---

## 验收步骤

```bash
# workspace 链接
bun pm ls --all | grep "@octo/"

# 类型检查
bun turbo typecheck --filter="@octo/shell" --filter="@octo/agent-*"
```

人工验证（根目录运行）：

```typescript
// verify-shell.ts（验证后删除）
import { registry } from "./packages/shell/src/index.js"
import { ResearchAgent } from "./packages/agent/research/src/index.js"

registry.register(new ResearchAgent())
for await (const chunk of registry.get("research").run({ sessionId: "test", input: "你好" })) {
  console.log(chunk)
}
// 期望输出：
// { type: 'token', content: '[用研 Agent] 收到任务：你好' }
// { type: 'complete' }
```

---

## 验收条件

- [ ] `bun turbo typecheck --filter="@octo/shell" --filter="@octo/agent-*"` 全部通过
- [ ] ResearchAgent 能通过 registry 注册和调用，输出 AsyncIterable
- [ ] 存根 Agent 调用 `run()` 抛出 `not implemented` 错误
