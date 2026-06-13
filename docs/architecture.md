# Octo Insight — 架构

> 本文档描述 octo-insight 系统架构。insight 的实现代码在 UXAI 仓
> (<https://github.com/MyHeavenDyf/UXAI>)维护,本文按 UXAI 实际结构描述。
> 设计契约(MCP / 上传 / 桌面壳能力)见 [intranet-handoff.md](intranet-handoff.md)。

---

## 1. 一图看懂

```
┌──────────────── Electron 主进程：packages/desktop/（UXAI 自有壳）─────────────┐
│  品牌 Octo Agent / ai.octo.desktop                                            │
│   ├─ 启动 BrowserWindow，renderer 挂载 octoapp 的 AppInterface                 │
│   ├─ sidecar 内嵌 opencode server（virtual:opencode-server，本地动态端口）     │
│   └─ 配置目录 ~/.config/octo/                                                  │
│                                                                               │
│   ┌──── Renderer：packages/app/octoapp/（@opencode-ai/app，SolidJS）────────┐ │
│   │  app.tsx → AppInterface → RouterRoot                                     │ │
│   │   ├─ isOctoPage() → OctoSidebarLayout（OctoShell sidebar）               │ │
│   │   │     ├─ /insight/:id? ← InsightPage   （pages/insight/）              │ │
│   │   │     ├─ /make/:id?    ← MakePage       （pages/make/）                │ │
│   │   │     └─ /skills       ← SkillsPage                                    │ │
│   │   └─ 其余路由 → AppShellProviders（上游原版 Layout）                     │ │
│   │           └─ /:dir/{chat,studio,session}                                │ │
│   └────────┬───────────────────────────────────────────────────────────────┘ │
│            │ HTTP + SSE                                                        │
│            ▼                                                                   │
│   ┌──────────────────────────────────────────┐                               │
│   │  内嵌 opencode server（上游引擎）          │                               │
│   │   ├─ Hono HTTP routes                     │                               │
│   │   ├─ SSE event bus                        │                               │
│   │   ├─ SQLite (Drizzle ORM)                 │                               │
│   │   └─ agent 注册：octo_insight / octo_make │ ← src/agent/agent.ts + prompt/ │
│   └────────┬─────────────────────────────────┘                               │
│            │ Vercel AI SDK                                                     │
└────────────┼───────────────────────────────────────────────────────────────────┘
             ▼
   外部 LLM Provider (Anthropic / DeepSeek / 通义 / Google / ...)
```

opencode 不是独立二进制 sidecar,而是经 `import("virtual:opencode-server")` 在壳内拉起的 Node 服务(UXAI 壳用 sidecar worker 承载),再开本地 HTTP 给 renderer 用。桌面壳选型见 [ADR-001](adr/001-electron-vs-tauri.md);后端细节见 [learning/opencode-internals.md](learning/opencode-internals.md)。

---

## 2. 自研边界（哪些是 octo 自研，哪些是 opencode 上游）

> insight 的演进只动 **octo 自研路径**;opencode 上游路径在两个 fork(外网 opencode / 内网 UXAI)里相同,跟随上游同步,不为 insight 单独改。

### 2.1 Octo 自研

| 路径 | 角色 |
|---|---|
| `packages/app/octoapp/pages/_shell/` | OctoShell 框架层(sidebar + topbar) |
| `packages/app/octoapp/pages/insight/` | 用研 Agent 页面(本文重点) |
| `packages/app/octoapp/pages/{chat,make,studio,skills}/` | 其余 Octo 页面 |
| `packages/opencode/src/agent/prompt/octo_insight.md` | insight agent 配置(`.md` + `.txt`) |
| `docs/`、`ROADMAP.md`、`CLAUDE.md`(octo-agent 仓) | 设计文档主线 |

> `octoapp/` 是 UXAI 在 `@opencode-ai/app` 包内的 Octo 专属 app 入口(与上游 `packages/app/src/` 并存);各 Octo 页面在 `octoapp/pages/<name>/` 建立结构。

### 2.2 opencode 上游 — 跟随上游

下列路径两个 fork 相同,改了与上游 diff 会乱;insight 复用而不修改。

| 包 / 路径 | 用途 |
|---|---|
| `packages/opencode/` | AI Agent 后端引擎(Hono HTTP + SSE + SQLite) |
| `packages/sdk/` | OpenAPI 自动生成的 TS 客户端 |
| `packages/ui/`(`@opencode-ai/ui`) | SolidJS 组件库 |
| `packages/app/src/`、`octoapp/context\|hooks\|components` 等公共层 | SolidJS app 公共设施;`@opencode-ai/app/vite` 提供 Tailwind + 主题 |

> opencode agent 注册(`src/agent/agent.ts`)是 UXAI fork 对上游的少量改动:在内置 agent 之外注册 `octo_insight` 等,prompt 取自 `prompt/octo_insight.md`。`skills` / `mcp` 是 fork 私有扩展字段(见 [intranet-handoff §6](intranet-handoff.md))。

### 2.3 桌面壳 — UXAI 自有

UXAI 的 Electron 壳 `packages/desktop/`(品牌、配置注入、`window.api` IPC 能力)由 UXAI 自行组织。insight 业务代码运行时依赖的桌面能力以**契约**形式约定,见 [intranet-handoff §4](intranet-handoff.md)(`window.api` SOT 清单);本文不登记壳内部改动。

---

## 3. 渲染层定制策略

UI 改动按下表从上往下依次尝试,绝不无理由下沉。

| 层级 | 手段 | 例子 |
|---|---|---|
| **Layer 1** | 自研组件用 Octo 设计 token(`--octo-*`) | `_shell/`、`insight/` 等 Octo 自研组件,见 §3.1 |
| **Layer 2** | 在 `insight/` 内自写组件,import `@opencode-ai/ui` 零件 | InsightPage 自写 PromptInput,复用 SessionTurn / DataProvider |
| **Layer 3** | 单文件 fork 到 `insight/` 内自维护 | 某个上游组件行为差异大时 fork 一份 |
| **Layer 4** | 直接修改上游(需 ADR 决议) | 正常工作流不应走到这里 |

### 3.1 Octo 设计 token 独立原则

上游 `@opencode-ai/ui` 的 CSS 变量(`--background-base`、`--text-base` 等)随主题切换变化,且浅色模式下对比度不足(如 `--text-base: #6f6f6f` 与 `--background-base: #f8f8f8` 几乎无差),不适合 Octo 浅色单版设计稿。

**决策:Octo 页面与 Shell 维护一套独立的 `--octo-*` 设计 token,与上游 token 完全隔离。** 定义在 [`octoapp/pages/insight/octo-tokens.css`](../packages/app/octoapp/pages/insight/octo-tokens.css),`:root` 下声明品牌色 / 文字 / 表面 / 边框 / markdown 排版等具名变量,所有 Octo 组件通过 `var(--octo-*)` 引用,不直接写颜色值。原因:

1. 与上游 token 隔离,主题切换不影响 Octo 浅色设计稿的预期表现
2. 集中一处定义,改色 / 对齐设计稿只改 token 表,不散落各组件
3. 设计师切图交付后只需替换 SVG/图片资产 + 调 token,不需重新梳理上游 token 映射

---

## 4. 自研代码地图

```
packages/app/octoapp/pages/
├── _shell/                    # OctoShell 框架层
│   ├── index.tsx              # OctoShell 导出
│   ├── sidebar.tsx            # 左侧导航(Octo Insight 会话段 + 技能库/资产库入口)
│   ├── topbar.tsx             # 顶部栏
│   └── icons/                 # 导航图标
└── insight/                   # 用研 Agent 页面
    ├── index.tsx              # InsightPage（SDKProvider + SyncProvider + 业务逻辑）
    ├── sidebar.tsx            # insight 会话侧栏
    ├── octo-tokens.css        # Octo 设计 token（§3.1）
    ├── components/            # attachment-bar / conversation-header / insight-turn
    │   ├── result-viewer/     # 结果面板（html/table/mindmap renderer + tab-bar）
    │   ├── task-card/         # 任务卡
    │   └── session-list/      # 会话列表
    ├── lib/                   # upload.ts / electron-api.ts / debug-observer.ts
    ├── utils/                 # task-detect / resource-link / mindmap-adapter 等
    ├── store/                 # preset-prompts
    ├── icons/                 # 页面图标 + 插图
    └── __dev/                 # dev 预览页（routes.tsx 汇总，见 development.md）

packages/opencode/src/agent/prompt/
├── octo_insight.md            # insight agent 配置（frontmatter + prompt 正文）
└── octo_insight.txt           # 同步的 .txt 变体
```

> insight 数据层**完全复用** opencode 原生 globalSync / sync.session.sync / event-reducer,不自建本地 dataStore + SSE listener。外层 `InsightPage` 拼装 `SDKProvider + SyncProvider`(依赖 `projectDir` 就绪),内层 `InsightContent` 承载业务逻辑。详见 [SPEC-INS-005](specs/ui/insight-data-layer-reuse.md)。

---

## 5. 数据流与外部接口

### 5.1 会话与消息

1. 用户在 PromptInput 输入 → `client.session.message.send`
2. opencode 向 LLM provider 发请求,持续推 SSE 事件
3. UI 通过 `client.event.subscribe` 接收 SSE,事件类型:
   - `message.part.updated` — 新增 part
   - `message.part.delta` — 文本/推理流式增量
   - `session.idle` — 该轮结束,**触发 REST 重新拉取作为权威状态**
   - `session.error` — 调用出错
4. UI 仅在 `session.idle` 后用 REST 数据覆盖,SSE 只负责流式打字效果

> "REST 为权威 + SSE 为体验"是为规避 SSE 事件乱序导致的复读 bug。详见 [learning/opencode-internals.md](learning/opencode-internals.md)。

### 5.2 配置文件

opencode 后端启动时配置优先级:

1. `process.env.OPENCODE_CONFIG`(单文件路径)— 桌面壳注入为 `~/.config/octo/octo.json`
2. fallback 到默认 `~/.config/opencode/config.json`

由于第 1 项被壳注入,**Octo 永远只读 `~/.config/octo/octo.json`**,与用户机器上可能装的 opencode CLI 完全隔离。配置目录 `~/.config/octo/` 是壳约定(xdg-basedir 惯例);cascading 合并机制见 [ADR-008](adr/008-cascading-config.md)。

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

opencode 内置 SQLite(Drizzle ORM),数据在:

- macOS:`~/.local/share/opencode/opencode-local.db`

配置已隔离,数据库仍写到 opencode 默认目录(改路径需侵入上游,代价大)。

### 5.4 外部对接能力

insight 运行时依赖的外部能力均以**契约**形式约定(实现分属 UXAI 壳 / 内网服务端):

- **桌面壳 `window.api`**(文件打开 / 另存为 / 下载落地 / Finder 定位)— [intranet-handoff §4](intranet-handoff.md)
- **MCP 工具**(用研分析能力)— [mcp-contract.md](specs/agents/mcp-contract.md)、[ADR-012](adr/012-mcp-tools-by-capability.md)
- **文件上传**(`VITE_OCTO_UPLOAD_ENDPOINT` → 内网 S3)— [file-upload.md](specs/infra/file-upload.md)、[ADR-006](adr/006-upload-architecture.md)

---

## 6. 相关 ADR 与 learning

- [ADR-001 — 桌面壳:Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ADR-004 — 切回 SolidJS,复用上游 UI](adr/004-solidjs-ui-reuse.md) **(当前生效)**
- [ADR-008 — cascading 配置](adr/008-cascading-config.md)
- [learning/opencode-internals.md](learning/opencode-internals.md)
- [learning/agent-mental-model.md](learning/agent-mental-model.md)
- [learning/skill-and-mcp.md](learning/skill-and-mcp.md)
- [learning/provider-protocols.md](learning/provider-protocols.md)
- [learning/context-and-memory.md](learning/context-and-memory.md)
</content>
</invoke>
