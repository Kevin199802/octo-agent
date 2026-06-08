# Octo Insight — 对接契约（给 UXAI 开发参考）

> insight 的实现代码在内网 UXAI 仓维护。本文是 insight 与外部系统(MCP / 文件上传 / 桌面壳)
> 对接的**设计契约真相源**——在 UXAI 开发 insight、对接内网服务时按本文对照。
> 文中 octo-agent 路径与 UXAI 路径的对应见 §0。

---

## 0. 路径映射

| 维度 | 文档里(octo-agent 命名) | UXAI 仓 |
|---|---|---|
| pages 路径 | `packages/app/src/pages/insight/` | `packages/app/octoapp/pages/insight/` |
| Agent 配置文件 | `packages/agent/octo_insight/agents/octo_insight.md` | `packages/opencode/src/agent/prompt/octo_insight.md` |
| Agent 名 | `octo_insight` | `octo_insight` |
| 用户配置文件 | `~/.config/octo/octo.json` | `~/.config/octo/octo.json` |

---

## 1. npm 依赖

insight 用到的依赖,UXAI 对应 package.json 需具备:

| 包 | 用途 |
|---|---|
| `markmap-view` / `markmap-lib` | 思维导图渲染 |
| `write-excel-file` | Excel 导出 |

---

## 2. MCP 对接

MCP 工具清单、每个工具的入参 / 出参约定、description 写法,**完全以
[mcp-contract.md](specs/agents/mcp-contract.md) 为准**(单一真相源,本文不复述)。

- 客户端配置:`octo.json` 的 `mcp.uxr-tool.url` 指向内网 MCP 端点
- opencode 默认即启用 MCP,**MCP 启动失败不阻塞 server**(无需 `enabled` 字段)
- 工具按业务能力铺开(N tools),不走单 tool + enum,见 [ADR-012](adr/012-mcp-tools-by-capability.md)

---

## 3. 文件上传对接

> 上传是 agent 自有能力:客户端在 insight 内实现,**服务端由内网团队对接 S3 落地**。
> 完整契约见 [file-upload.md](specs/infra/file-upload.md);决策见 [ADR-006](adr/006-upload-architecture.md)。

- 客户端通过环境变量 `VITE_OCTO_UPLOAD_ENDPOINT` 读上传端点(`.env.local` 填实际地址),对接后无需改源码
- S3 路径策略:`<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>/<filename>`(UUID 独立一层,不拼进文件名)
- 客户端有全链路 console 日志(前缀 `[octo:upload]`),隔空联调时让客户端同学截 Console
- 上传与 MCP 工具产物上传**互不相关**(ADR-006)
- ⚠️ **返回的 `url` 字段必须 URL-encode**(空格 → `%20`,中文同理):服务端若把未编码文件名拼进 URL,
  **LLM 拿带空格的 URL 下载会在空格处截断,取不到文件内容**(卡片显示正常但下载失败,极隐蔽)。务必返回合法编码后的 URL。

---

## 4. 桌面壳 `window.api` 依赖（SOT）

业务代码运行时依赖 `window.api` 暴露的桌面能力,**UXAI 内网 Electron 壳必须暴露下列同名同签名方法**,
否则按钮点击会走"桌面 API 不可用" toast。`insight/lib/electron-api.ts` 的 `DesktopApi` 类型是 SOT,
本表与之一致。

| `window.api` 方法 | 触发位置 | 用途 | 实现要点 |
|---|---|---|---|
| `openPath(path, app?)` | FileFallback「用本地应用打开」 | 唤起系统默认应用打开本地文件 | `shell.openPath(path)`;可选 `app` 指定打开方式 |
| `saveFilePicker({ title?, defaultPath? })` | 「另存为」 | 弹原生保存对话框,返回路径或 `null` | `dialog.showSaveDialog` |
| `downloadResource(url, destPath)` | 「另存为」第二步 | 远程 URL → 落本地指定路径 | `fetch` → `mkdir -p` → `writeFile` |
| `downloadResourceToTemp(url, namespace, filename)` | 「用本地应用打开」/「在文件夹中打开」前置 | 远程 URL → 落 OS 临时目录,返回本地路径 | sanitize filename 防穿越;namespace 传 tabID/sessionID 隔离 |
| `showItemInFolder(path)` | 「在文件夹中打开」 | 在 Finder / Explorer 中定位文件 | `shell.showItemInFolder(path)`,fire-and-forget |

> 参考实现:[architecture.md §5.4](architecture.md#54-上游接线壳改动清单octo-agent-本地壳) 的
> `preload/types.ts` / `preload/index.ts` / `main/ipc.ts` 子节(可读不可抄,UXAI 壳代码自行组织)。

---

## 5. 一次性配置

- **路由分叉**:`app.tsx` 加 OctoShell 路由分叉(`/insight/:id?` → InsightPage 等)
- **Agent 注册**:`octo_insight` 定义从 `octo_insight.md` frontmatter 派生 `mode` / `description` /
  `permission`(从 `tools` 字段转),不硬编码

---

## 6. frontmatter schema 边界

业界 agent frontmatter 调研 + 字段对照见
[agent-config-deploy.md §0](specs/infra/agent-config-deploy.md)。要点:

- insight 的 frontmatter 字段跟 **opencode 上游对齐**(跨 fork 可移植),不加 `mcp` / `skills`
- 内网 `mcp` / `skills` 是 **fork 私有扩展**,由内网在 `agent.ts` 或私有 frontmatter loader 维护,不要求对齐

---

## 7. 进一步阅读

- MCP 接口契约:[mcp-contract.md](specs/agents/mcp-contract.md)
- 文件上传契约:[file-upload.md](specs/infra/file-upload.md)
- 配置部署机制:[ADR-008](adr/008-cascading-config.md)
- 设计决策:[adr/](adr/)
