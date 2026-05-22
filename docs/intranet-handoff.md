# Octo Insight — 内网仓库集成手册

> 给内网 octoAI 仓库集成者（人或 AI）的对外操作手册。  
> 我方（octo-agent 外网仓库）是设计实验室 + reference implementation，最终生产代码在内网。  
> 每次合入按本文档操作。

---

## 0. 仓库与命名映射

| 维度 | 外网（我方）| 内网（你方）|
|---|---|---|
| pages 路径 | `packages/app/src/pages/` | `packages/app/octoapp/pages/` |
| Agent 配置目录 | `packages/agent/insight/agents/` | `packages/opencode/src/agent/prompt/` |
| Agent 文件名 | `insight.md`（含 frontmatter）| `octo_insight.md`（待你方落地 P1）|
| Agent 名 | `insight` | `octo_insight` |
| 用户配置文件 | `~/.config/octo/octo.json` | `~/.config/octo/octo.json` |

---

## 1. 合入物（每次合入做的事）

### 1.1 同步 `pages/insight/` 目录

```bash
rsync -av --delete \
  /path/to/octo-agent/packages/app/src/pages/insight/ \
  ./packages/app/octoapp/pages/insight/
```

整目录覆盖，文件结构对应。

### 1.2 同步 `insight.md`

```bash
cp /path/to/octo-agent/packages/agent/insight/agents/insight.md \
   ./packages/opencode/src/agent/prompt/octo_insight.md
```

前提：你方已实施 P1（loader 直读 `.md` 而非 `.txt`）。

### 1.3 安装 npm 依赖

合入物当前用到的依赖（在我方 `packages/app/package.json`）：

| 包 | 用途 |
|---|---|
| `markmap-view` | 思维导图渲染 |
| `markmap-lib` | markmap transformer |
| `write-excel-file` | Excel 导出 |

加到你方对应 package.json 后 install。

### 1.4 MCP URL

我方 `default-config.json.mcp.uxr-tool.url` 当前是 `http://7.192.161.60:8005/mcp`（内网测试地址）。如内网生产用别的 URL，你方在等效配置位置同步修改。

不再需要 enabled 字段——opencode 默认即启用，MCP 启动失败不会阻塞 server。

### 1.5 文件上传服务

Insight（以及未来其他 agent）的文件上传是 agent 项目自有的能力——客户端在我方实现，**服务端由内网开发团队对接 S3 落地**。完整 spec：[file-upload.md](specs/infra/file-upload.md)。

**合入物**：

| 路径（我方） | 路径（你方） | 内容 |
|---|---|---|
| `packages/app/.env.example` | `packages/app/.env.example` | 环境变量模板（含 `VITE_OCTO_UPLOAD_ENDPOINT` 注释） |
| `packages/app/src/pages/insight/lib/upload.ts` | `packages/app/octoapp/pages/insight/lib/upload.ts` | 客户端上传实现（随 §1.1 rsync 自动同步） |

**上游壳改动（手动 mirror 一行 diff）**：

`packages/app/src/env.d.ts` 的 `ImportMetaEnv` 接口里追加了一行：

```ts
readonly VITE_OCTO_UPLOAD_ENDPOINT?: string
```

你方对应文件加同一行即可（与上游 `VITE_OPENCODE_SERVER_HOST` 等并列）。

**首次集成（一次性）**：

```bash
# 在你方 packages/app/ 下
cp .env.example .env.local
# 编辑 .env.local，填入内网 S3 上传服务实际地址
```

**对接要点**（给内网开发服务端实现的同学）：

- 接口形态、S3 路径策略（`<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>_<filename>`）、响应封装、错误码、DB 表设计、联调步骤全部见 [file-upload.md](specs/infra/file-upload.md)
- 客户端走环境变量注入端点，对接后填 `VITE_OCTO_UPLOAD_ENDPOINT=...` 即可，无需改源码
- 客户端有全链路 console 日志（前缀 `[octo:upload]`），隔空联调时让客户端同学截 Console 给你
- ADR-006 已明确：本上传服务**与 UXR 团队的 MCP 工具产物上传互不相关**

---

## 2. 一次性配置（首次集成时做一次）

### 2.1 路由分叉

我方 `packages/app/src/app.tsx` 加入了 OctoShell 路由分叉（`/insight/:id?` → InsightPage 等）。你方应已合入第一版，无需重复操作；新增页面才需要追加路由。

### 2.2 Agent 注册

你方 `packages/opencode/src/agent/agent.ts` 已注册 `octo_insight`。**实施 P1 + P2 后**，octo_insight 定义应从 `octo_insight.md` frontmatter 自动派生 `mode` / `description` / `permission`（从 `tools` 字段转），不再硬编码。

---

## 3. ⚠️ 业界 schema 与双方差异（关键）

业界 agent frontmatter 调研详见 **[docs/specs/infra/agent-config-deploy.md §0](specs/infra/agent-config-deploy.md)**（事实报告 + 字段对照）。

**简要结论**：

| 字段 | opencode 上游 | Claude Code | 我方 frontmatter | 内网 agent.ts |
|---|---|---|---|---|
| `name` / `mode` / `description` / `prompt` | ✅ | ✅ | ✅ | ✅ |
| `tools` | ⚠️ deprecated | ✅ | ✅（待迁移到 `permission`）| 用 permission |
| `permission` | ✅ | `permissionMode` | 待迁移 | ✅ |
| `mcp` per-agent | ❌ | ✅（mcpServers） | ❌ | ✅（fork 私有扩展）|
| `skills` | ❌ | ✅ | ❌ | ✅（fork 私有扩展）|

**双方边界**：

- 我方 frontmatter 字段跟 **opencode 上游对齐**（跨 fork 可移植），不会加 `mcp` / `skills`
- 内网 `mcp` / `skills` 字段是**你方 fork 的私有扩展**，由你方自己在 agent.ts 或私有 frontmatter loader 里维护，不要求我方 mirror

---

## 4. 已知不一致 / 待清理项

### 4.1 `octo_insight.txt` → `octo_insight.md`（P1，你方已答应）

你方 loader 从 `.txt` 改为 `.md`，运行时 strip frontmatter。完成前每次合入要手动转格式（避免）。

### 4.2 `agent.ts` permission 字段从 frontmatter 派生（P2，你方已答应）

只派生 `permission`（从我方 frontmatter `tools` 字段转），`mcp` / `skills` 由你方继续在 agent.ts 维护。

### 4.3 MCP 工具清单对齐

MCP 工具按业务能力铺开（[ADR-012](adr/012-mcp-tools-by-capability.md)），完整工具清单、入参 / 出参约定见 [mcp-contract.md](specs/agents/mcp-contract.md)（单一真相来源，本文档不重复列出，避免漂移）。

你方 `octo_insight.txt` 中的工具引用以最新 mcp-contract.md 为准对齐。

---

## 5. 不合入的内容

| 路径 | 原因 |
|---|---|
| `packages/desktop-electron/` | 我方 Electron 脚手架（含 cascading config 实现），仅供本地调试。可参考思路（[ADR-008](adr/008-cascading-config.md)），不要复制代码 |
| `docs/` | 我方设计文档，长期由本仓库维护。欢迎查阅但不要复制到内网 |
| `ROADMAP.md` / `CLAUDE.md` | 我方迭代计划 + 工作规则 |

---

## 6. 合入触发节奏

外网作者主动通知你方"可以合一版了"即触发。无固定节奏。

你方 AI 收到通知后**直接读本文档**按 §1 步骤执行——本文档自包含，不需要外网另发操作清单。

典型触发时机：
- 里程碑级功能落地
- 线上 bug 修复
- 依赖变更（特别注意：build 会因 npm 依赖缺失而挂，外网作者通常会显式提醒）

---

## 7. 进一步阅读（仅参考，不复制）

- 业界 agent schema 调研：[agent-config-deploy.md §0](specs/infra/agent-config-deploy.md)
- 我方设计决策：[adr/](adr/)
- MCP 接口契约：[specs/agents/mcp-contract.md](specs/agents/mcp-contract.md)
- 配置部署机制：[adr/008-cascading-config.md](adr/008-cascading-config.md)
