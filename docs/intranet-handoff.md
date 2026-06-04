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

### 1.0 合入方式：跑 `octo-sync` 脚本（先读这个）

外网侧用 [`script/octo-sync.ts`](../script/octo-sync.ts) 把改动合入 UX AI 项目，无需手动逐步操作。

**一次性配置**：复制 `script/.octo-sync.local.json.example` → `script/.octo-sync.local.json`，填 UX AI 项目仓库绝对路径。若两仓同级放置（同一父目录），可不配，脚本自动 fallback 到 `../UXAI`。

**每次合入**：

```bash
bun script/octo-sync.ts            # 正式合入
bun script/octo-sync.ts --dry-run  # 只判范围 + 演练 rsync，不写 UX AI 项目
```

> **首次启用脚本**（或 UX AI 项目结构重构后）先跑一次 `bun script/octo-sync.ts --init`：把“基线锚点”设为外网当前版本，告诉脚本“UX AI 项目已对齐到这一版”，之后增量才算得对。日常合入用不到它。

脚本按改动范围给两种结果：

**🟢 绿灯 —— 改动只落在 `pages/insight/` + agent prompt**
脚本全自动：rsync 业务代码（排除 `_dev`）→ 原样 cp prompt → UX AI 项目 `packages/app` 跑 **typecheck + build 双门禁** → 推进锚点。你只需到 UX AI 项目 review + `git commit`（脚本**不自动提交**）。下面 §1.1–§1.6 是脚本已封装的细节，绿灯时无需手动。

**🔴 非绿灯 —— 改动越界（碰 `app.tsx` / 桌面壳 / 依赖等）**
脚本**不动任何文件**，打印越界清单，例如：

```
🔴 非绿灯 —— 改动越出 pages/insight + prompt 范围，未做任何同步。
   越界文件(贴给 AI 起对话合入):
     - packages/app/src/app.tsx
     - packages/desktop-electron/src/preload/index.ts
     ...
```

这时开对话让 AI 合入，提示词模板（让 AI 做**完整合入**，因为非绿灯时业务代码也还没同步）：

> 基于 `docs/intranet-handoff.md` 的合入规则，以及下面 octo-sync 的输出，帮我把外网改动**完整**合入 UX AI 项目（业务代码 §1.1 也一并 rsync，越界文件按 §1.6 / §2.1 处理对应的 UX AI 项目改动）：
>
> ```
> <粘贴 octo-sync 的完整 console 输出>
> ```

AI 会按本文档 §1.1–§1.6 做业务 rsync + 越界文件对应的 UX AI 项目改动（壳 API 补齐 / 路由注册 / 依赖）。

**判定规则速查**：

| 改动落点 | 结果 |
|---|---|
| `packages/app/src/pages/insight/**`（除 `_dev/`） | 🟢 自动同步 |
| `packages/agent/insight/agents/insight.md` | 🟢 自动同步（原样 → `octo_insight.md`） |
| `_dev/`、`docs/`、`CLAUDE.md`、`script/` 等纯外网文件 | ⚪ 忽略（不同步也不报警） |
| `app.tsx` / `packages/desktop-electron/` / 依赖 / 其他 | 🔴 非绿灯，交 AI |

范围判定靠 `git diff <锚点>..HEAD`，锚点存 UX AI 项目 `.insight-sync-state.json`（记 UX AI 项目合到外网哪个 sha）。

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

- 接口形态、S3 路径策略（`<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>/<filename>`，UUID 独立一层而非拼文件名）、响应封装、错误码、DB 表设计、联调步骤全部见 [file-upload.md](specs/infra/file-upload.md)
- 客户端走环境变量注入端点，对接后填 `VITE_OCTO_UPLOAD_ENDPOINT=...` 即可，无需改源码
- 客户端有全链路 console 日志（前缀 `[octo:upload]`），隔空联调时让客户端同学截 Console 给你
- ADR-006 已明确：本上传服务**与 UXR 团队的 MCP 工具产物上传互不相关**
- ⚠️ **返回的 `url` 字段必须 URL-encode（空格 → `%20`，中文等非 ASCII 同理）**：服务端若把未编码的原始文件名拼进 URL，URL 里会出现空格——客户端解析层已做兼容（不丢卡片），但 **LLM 拿到带空格的 URL 去下载文件时会在空格处截断，导致 Agent 取不到文件内容**（卡片显示正常但实际下载失败，极隐蔽）。实测现象：一次上传 10 个文件、文件名带空格的几个，下载会挂。请确保 `url` 是合法编码后的 URL。

### 1.6 桌面壳 API 依赖

业务代码运行时依赖 `window.api` 暴露的若干桌面能力，rsync 同步业务代码后，**你方内网 Electron 壳必须暴露下列同名同签名方法**，否则按钮点击会走 "桌面 API 不可用" toast。

`packages/app/src/pages/insight/lib/electron-api.ts` 的 `DesktopApi` 类型是 **SOT**——下表与该文件保持一致；外网代码改动若新增 / 修改字段，须同步本节。

| `window.api` 方法 | 触发位置（业务侧） | 用途 | 实现要点 |
|---|---|---|---|
| `openPath(path, app?)` | `result-viewer/FileFallback`「用本地应用打开」 | 唤起系统默认应用打开本地文件 | `shell.openPath(path)`；可选 `app` 指定打开方式（mac: `open -a <app> <path>` / win: 直接 exec） |
| `saveFilePicker({ title?, defaultPath? })` | `FileFallback`「另存为」 | 弹原生保存对话框，返回用户选择路径或 `null`（取消） | `dialog.showSaveDialog` |
| `downloadResource(url, destPath)` | `FileFallback`「另存为」第二步 | 远程 URL → 落本地指定路径 | node `fetch` → `mkdir -p` → `fs.writeFile`；通用底层能力，不限二进制 |
| `downloadResourceToTemp(url, namespace, filename)` | `FileFallback`「用本地应用打开」/「在文件夹中打开」前置 | 远程 URL → 落 OS 临时目录 `<tmp>/octo/<namespace>/<filename>`，返回最终本地路径 | sanitize filename 防路径穿越；namespace 通常传 tabID/sessionID 隔离 |
| `showItemInFolder(path)` | `FileFallback`「在文件夹中打开」 | 在 Finder / Explorer 中定位并选中文件 | `shell.showItemInFolder(path)`，fire-and-forget |

**合入流程**：合入 PR 前对照本表 vs 内网 Electron 壳已暴露的方法，缺失项需对应补 IPC handler + preload exposure；新增依赖在 PR description 显式列出。

**外网参考实现**：[architecture.md §5.4](architecture.md#54-上游接线壳改动清单) 的 `preload/types.ts` / `preload/index.ts` / `main/ipc.ts` 三个子节（可读不可抄；内网壳代码自行组织）。

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
