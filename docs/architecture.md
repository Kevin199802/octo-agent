# Octo Agent — 架构

> 上次同步:2026-05-01(M1 达成,octo-app 渲染入口跑通)。任何分歧以代码为准。

---

## 1. 一图看懂

```
┌─────────────────────── Electron 主进程 ───────────────────────┐
│  packages/desktop-electron/  (上游壳子,仅品牌+接线+调试)          │
│   ├─ 启动 BrowserWindow                                         │
│   ├─ 内嵌 opencode Server (Node 模块,同进程)                     │
│   └─ 注入 OPENCODE_CONFIG=~/.config/octo/octo.config.json       │
│                                                                  │
│   ┌─────────────────── Renderer ───────────────────┐             │
│   │  packages/octo-app/   (Octo 自研入口,SolidJS)    │             │
│   │   ├─ src/main.tsx                               │             │
│   │   │   (boot 复制自上游 desktop renderer,自维护)  │             │
│   │   └─ 挂载 <AppInterface> ← @opencode-ai/app     │             │
│   │       (整套 IDE UI: Chat/Tools/Dialogs/Agent)    │             │
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

opencode 不是 sidecar 二进制,是 `import("virtual:opencode-server")` 加载的 Node 模块,**与 Electron 主进程同进程**,只是再开一个本地 HTTP 服务给 renderer 用。详见 [ADR-001](adr/001-electron-vs-tauri.md);后端内部细节见 [learning/opencode-internals.md](learning/opencode-internals.md)。

---

## 2. 包总览(改动政策一表清)

> 这是定位任何代码归属的**唯一入口表**。看到一个目录拿不准能不能改,先查这里。

### 2.1 Octo 自研 — 自由改

新功能往这里加。无审批。

| 包 | 路径 | 角色 |
|---|---|---|
| `@octo/app` | [packages/octo-app/](../packages/octo-app/) | **渲染入口**(SolidJS)。boot 代码 `src/main.tsx` 复用上游 platform 抽象,组合 `@opencode-ai/app` 的 `AppInterface` 挂完整 UI;Octo 业务页面以后加在这里 |
| `@octo/shell` | [packages/shell/](../packages/shell/) | Agent 任务调度层(规划中,Phase 2 启用) |
| `@octo/agent-research` | [packages/agent/research/](../packages/agent/research/) | 用研业务封装(Phase 2 起接入) |
| `docs/`、`ROADMAP.md`、`CLAUDE.md` | 文档 | 全部自由维护 |

> Phase 2 引入 synthesis / report / coding 子 agent 时,放在 `packages/agent/<name>/`。

### 2.2 上游核心 — **一行不动**

包括 SolidJS UI 组件库、完整 app、后端引擎、SDK、上游 renderer 与 IPC 桥。**任何改动都会成为内网合入冲突源头**——多团队并行修改这些目录,我们改了上游就分不清"哪行是 Octo 哪行是上游"。Octo 端有 UI 定制需求时走 §3 的"四层降级"(CSS 覆盖优先,Layer 4 改上游需 ADR 决议)。

| 包 / 路径 | 用途 |
|---|---|
| `packages/opencode/` | AI Agent 后端引擎(Hono HTTP + SSE + SQLite) |
| `packages/sdk/` | OpenAPI 自动生成的 TS 客户端 + JSON schema |
| `packages/ui/`(`@opencode-ai/ui`) | SolidJS 组件库(`SessionTurn`、`MessagePart`、`prompt-input`、`TextShimmer`、各 dialog) |
| `packages/app/`(`@opencode-ai/app`) | SolidJS 完整 app(`AppInterface` 挂载完整 UI;`@opencode-ai/app/vite` 提供 vite plugin 组) |
| `packages/desktop-electron/src/renderer/` | 上游 desktop renderer(参考代码,octo-app 的 boot 复制自此) |
| `packages/desktop-electron/src/preload/` | IPC 桥 |

### 2.3 上游接线壳 — 限改(品牌/接线/调试)

仅允许"应用叫什么"、"指向哪个前端"、"如何启动"层面的修改,绝不改业务逻辑。改动必须同步登记到 §4.4。

| 文件 | 改动政策 |
|---|---|
| `packages/desktop-electron/src/main/` | 主进程入口、品牌名、env 注入 |
| `packages/desktop-electron/electron.vite.config.ts` | renderer 接线(指向 octo-app),plugins |
| `packages/desktop-electron/electron-builder.config.ts` | 打包品牌 |
| `packages/desktop-electron/package.json` | 加必要依赖(`@octo/app`、`vite-plugin-solid` 等) |
| 仓库根 [package.json](../package.json) | `workspaces` + dev 脚本 |
| [turbo.json](../turbo.json) | 任务编排 |

### 2.4 仓库内但完全不用 — 既不动也不删

历史遗留或非桌面端形态。保留是为了便于跟上游同步。**不要 import,也不要修改,也不要"清理"**。

| 路径 | 用途(仅为认知,非工作目标) |
|---|---|
| `packages/desktop/` | Tauri 壳(被 ADR-001 否决,留作历史) |
| `packages/web/` | opencode 官网/web 入口 |
| `packages/console/*`(`app`/`core`/`function`/`mail`/`resource`/`vscode`) | opencode 商业控制台 |
| `packages/enterprise/` | 企业版 |
| `packages/extensions/` | 扩展机制 |
| `packages/containers/` | 容器化运行时 |
| `packages/function/` | 云 function |
| `packages/identity/` | 鉴权 |
| `packages/plugin/` | Plugin 框架 |
| `packages/script/` | 脚本工具 |
| `packages/shared/` | 上游内部共享代码 |
| `packages/slack/` | Slack 集成 |
| `packages/storybook/` | UI 组件 storybook |
| `sdks/vscode/` | VS Code 扩展 |

---

## 3. 渲染层定制策略 — 四层降级

任何 UI 改动按下表从上往下依次尝试,绝不无理由下沉。

| 层级 | 手段 | 适用占比(估) | 例子 |
|---|---|---|---|
| **Layer 1** | CSS 变量覆盖 | ~70% | 改 `--background-base` `--color-accent` `--font-family-sans` 把上游 UI 涂成 Octo 品牌 |
| **Layer 2** | 组合 wrapper(在 octo-app 包出来,import 到 main.tsx) | ~20% | 把 Octo "技能库"页面挂到上游路由 |
| **Layer 3** | 复制单文件到 `packages/octo-app/src/forks/<name>.tsx` 自维护 | ~8% | 上游 sidebar 信息架构跟我们差异大,fork 一份 |
| **Layer 4** | 直接修改上游(`packages/ui/` `packages/app/` `packages/desktop-electron/src/renderer/`) | ~2% | **需 ADR 单独决议**;每次改动都是合入冲突点 |

> 原则:Layer 1 → 2 → 3 → 4。能在上一层解决的,绝不下沉。Layer 4 是最后的逃生口,正常工作流不应该走到这里。

---

## 4. 自研代码地图

```
packages/octo-app/   (SolidJS 渲染入口)
├── src/
│   ├── main.tsx              # boot: createPlatform() + AppInterface 挂载
│   │                         # (一次性复制自 desktop-electron/src/renderer/index.tsx,自维护)
│   ├── i18n/                 # 复制自上游 desktop renderer(15 处相对路径已修)
│   ├── styles.css            # 占位
│   ├── updater.ts            # 复制自上游 desktop renderer
│   ├── webview-zoom.ts       # 复制自上游 desktop renderer
│   ├── env.d.ts              # window.api 类型声明(引上游 preload types)
│   ├── octo-theme.css        # (P1 后新增)CSS 变量覆盖,Octo 品牌
│   ├── octo-pages/           # (P1 后新增)Octo 自研业务页面
│   └── forks/                # (按需)上游单文件 fork 副本
├── index.html                # <div id="root"> + theme preload script
├── vite.config.ts            # 独立 dev 用(electron-vite 不读它)
├── tsconfig.json
└── package.json              # 依赖 @opencode-ai/{app,ui,sdk}、@solid-primitives/storage 等

packages/shell/      (Agent 调度,Phase 2)
└── src/index.ts

packages/agent/research/   (用研 Agent,Phase 2)
└── src/index.ts
```

> Vue 包 `packages/octo-ui/` 已删除(ADR-004 收尾)。

---

## 5. 数据流与外部接口

### 5.1 会话与消息

1. 用户在 prompt-input(上游组件)输入 → `client.session.message.send`
2. opencode 向 LLM provider 发请求,持续推 SSE 事件给所有订阅者
3. UI 通过 `client.event.subscribe` 接收 SSE,事件类型:
   - `message.part.updated` — 新增 part(`step-start` 标记新 assistant 消息边界)
   - `message.part.delta` — 文本 / 推理流式增量(通过 `part.type` 区分 `text` vs `reasoning`)
   - `session.idle` — 该轮结束,**触发 REST 重新拉取消息作为权威状态**
   - `session.error` — 调用出错,UI 渲染错误气泡
4. UI 仅在 `session.idle` 后用 REST 数据覆盖,SSE 只负责流式打字效果

> "REST 为权威 + SSE 为体验"是为规避 SSE 事件乱序导致的复读 bug。SSE 事件清单和 part 类型见 [learning/opencode-internals.md §3](learning/opencode-internals.md#3-sse-事件协议)。

### 5.2 配置文件

opencode 后端启动时**优先级**:

1. `process.env.OPENCODE_CONFIG`(单文件路径) — Octo 主进程**强制注入**为 `~/.config/octo/octo.config.json`
2. `process.env.OPENCODE_CONFIG_DIR`(目录覆盖)
3. fallback 到默认 `~/.config/opencode/config.json`

由于第 1 项被主进程注入(见 [packages/desktop-electron/src/main/index.ts](../packages/desktop-electron/src/main/index.ts)),**Octo Agent 永远只读 `~/.config/octo/octo.config.json`**,与用户机器上可能装的 opencode CLI 完全隔离。schema 关键字段:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {                                  // 单数,Zod .strict() 任何未知字段会让 session 创建报 500
    "<provider-id>": {
      "npm": "@ai-sdk/<package>",                // anthropic / openai-compatible / google
      "options": { "baseURL": "...", "apiKey": "..." },
      "models": { "<model-id>": { "name": "...", "limit": {...} } }
    }
  },
  "model": "<provider-id>/<model-id>"
}
```

详细加载流程见 [learning/opencode-internals.md §5](learning/opencode-internals.md#5-配置加载)。

### 5.3 持久化

opencode 内置 SQLite(Drizzle ORM),数据在:

- macOS: `~/.local/share/opencode/opencode-local.db`
- 路径来自 `XDG_DATA_HOME` 或默认 `~/.local/share/opencode/`

虽然 Octo 的**配置**已隔离,但**数据库**仍写到 opencode 默认目录。理由:数据用户不会主动看;改 SQLite 路径需要侵入 opencode 内部逻辑,代价大。

主要表:`session`、`message`、`part`、`todo`、`permission`、`project`、`account`(详细字段见 learning 文档)。删除整个 `~/.local/share/opencode/` 即清空所有会话历史,不影响配置。

### 5.4 上游接线壳已有改动清单

`git diff main...HEAD -- packages/desktop-electron/` 当前列表(M1 后状态):

| 文件 | 改了什么 | 性质 |
|---|---|---|
| [src/main/index.ts](../packages/desktop-electron/src/main/index.ts) | 应用名 OpenCode → Octo Agent;App ID;SQLite 文件名兼容(支持 `opencode-local.db` + `opencode.db`);**注入 `OPENCODE_CONFIG=~/.config/octo/octo.config.json`**;**注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true`** 防读取用户 `~/.claude/CLAUDE.md` 污染 | 品牌 + 配置隔离 |
| [src/main/windows.ts](../packages/desktop-electron/src/main/windows.ts) | dev 模式自动开 DevTools;`OCTO_DEVTOOLS=1` 环境变量打开打包版 DevTools;**注入 `__OPENCODE__.windowChrome`**(mac 红绿灯位置 + sidebar inset + windows titlebar overlay 高度,供 Octo 自定义 sidebar 避免与 titlebar 重叠) | 调试 + 接线 |
| [electron-builder.config.ts](../packages/desktop-electron/electron-builder.config.ts) | 包名/图标/产品标识 | 品牌 |
| [electron.vite.config.ts](../packages/desktop-electron/electron.vite.config.ts) | renderer `root` 指向 `../octo-app`;import `@opencode-ai/app/vite` plugin 组(自动获得 `@` alias / theme-preload / tailwind / solid) | 接线 |
| [package.json](../packages/desktop-electron/package.json) | dependencies 加 `marked`;devDependencies 加 `@octo/app`、`@tailwindcss/vite`、`vite-plugin-solid`、`@opencode-ai/app`、`@opencode-ai/ui`、`@solid-primitives/storage`、`@solidjs/meta`、`@solidjs/router`、`@solid-primitives/i18n`、`solid-js` 等 | 接线 |
| 仓库根 [package.json](../package.json) | `workspaces.packages` 含 `packages/octo-app`、`packages/shell`、`packages/agent/*`;`dev:ui` 脚本指向 `packages/octo-app` | 接线 |

> **新增改动必须同步更新本表**,否则架构文档会再次跟代码漂移。

**撤回到纯上游**(合入内网最坏情况):
1. `rm -rf packages/octo-app/`
2. 上面所有上游接线壳改动按此表逆向回滚
3. `electron.vite.config.ts` 把 root 指回 `./src/renderer`
→ 仓库可跑通上游原版

---

## 6. 上游同步策略

ADR-004 修订后,所有上游目录**一行不动**(§2.2)。Octo 端仅在 `packages/octo-app/` 内自维护 boot 代码副本。

| 范围 | 策略 |
|---|---|
| 整个上游(opencode / sdk / ui / app / desktop-electron 全部) | **保持原样**。需要从上游同步新版时直接 git merge / pull,目录无 Octo 改动,无冲突 |
| `packages/octo-app/src/main.tsx` 等 boot 副本 | **手动评估上游变化**。上游 desktop renderer 重大改动时(IPC 协议变 / API 变),人肉 diff 上游 `packages/desktop-electron/src/renderer/index.tsx`,把相关变更搬进 octo-app |
| 上游接线壳 `packages/desktop-electron/src/main/` 等 | **限改清单**(§5.4)。新增改动登记入表 |

不引入 patch-package、subtree、submodule 等机械化机制——人工判断 + git 操作即可。

---

## 7. Shell + Agent 架构(规划中)

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

详见 [docs/specs/agents/multi-agent.md](specs/agents/multi-agent.md)。

> ADR-004 落地后,multi-agent / skill / mcp / provider-config 等 spec 要相应缩水(具体见各 spec 顶部的"上游已成品"标注,迁移期更新)。

---

## 8. 相关 ADR 与 learning

- [ADR-001 — 桌面壳:Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ADR-002 — Vue 3 替换 SolidJS](adr/002-vue3-ui-rewrite.md) **(已弃用)**
- [ADR-003 — LLM Provider 接入方案](adr/003-openai-compat-provider.md)
- [ADR-004 — 切回 SolidJS,复用上游 UI](adr/004-solidjs-ui-reuse.md) **(当前生效)**
- [learning/opencode-internals.md](learning/opencode-internals.md) — opencode 后端工作原理
- [learning/agent-mental-model.md](learning/agent-mental-model.md) — Agent 模型
- [learning/skill-and-mcp.md](learning/skill-and-mcp.md) — Skill 与 MCP
- [learning/provider-protocols.md](learning/provider-protocols.md) — Provider 协议
- [learning/context-and-memory.md](learning/context-and-memory.md) — 上下文与记忆
