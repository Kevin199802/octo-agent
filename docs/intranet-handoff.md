# Octo Insight — 对接契约（给 UXAI 开发参考）

> insight 的实现代码在 UXAI 仓维护。本文是 insight 与外部系统(MCP / 文件上传 / 桌面壳)
> 对接的**设计契约真相源**——在 UXAI 开发 insight、对接内网服务时按本文对照。
> 文中路径均为 UXAI 仓实际路径。

---

## 0. 关键坐标（UXAI 仓）

| 维度 | UXAI 路径 / 值 |
|---|---|
| insight 页面 | `packages/app/octoapp/pages/insight/` |
| OctoShell 框架 | `packages/app/octoapp/pages/_shell/` |
| 路由入口 | `packages/app/octoapp/octo.tsx`(`@opencode-ai/app` 包入口,desktop renderer 用) |
| Agent prompt 源 | `packages/opencode/src/agent/prompt/octo_insight.md`(`.txt` 为 agent.ts import 的变体) |
| Agent 注册 | `packages/opencode/src/agent/agent.ts`(硬编码,见 §5) |
| Agent 名 | `octo_insight` |
| 用户配置文件 | `~/.config/octo/octo.json`(opencode fork 原生读取) |

> 归档的 octo-agent 旧实现用 `packages/app/src/pages/insight/` + `packages/agent/octo_insight/agents/` 命名;现役以上表为准。

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

业务代码运行时依赖 `window.api` 暴露的桌面能力,**桌面壳(`packages/desktop/`)必须暴露下列同名同签名方法**,
否则按钮点击会走"桌面 API 不可用" toast。类型 SOT 是
`packages/app/octoapp/pages/insight/lib/electron-api.ts` 的 `DesktopApi`。

本表列的是 **insight 真实调用到的方法**(2026-07-17 逐个核对调用点),与 `DesktopApi` 类型的已知出入
见下方"类型缺口"——类型不等于依赖清单,两边都要看。

**打开 / 定位 / 另存**

| `window.api` 方法 | 触发位置 | 用途 | 实现要点 |
|---|---|---|---|
| `openPath(path, app?)` | FileFallback「用本地应用打开」/ ActionBar「本地打开」 | 唤起系统默认应用打开本地文件 | `shell.openPath(path)`;可选 `app` 指定打开方式。**返回错误串:空串 = 成功,非空 = 失败原因**(渲染端按此判定,不 throw) |
| `showItemInFolder(path)` → `Promise<{ ok, reason? }>` | 文件管理「打开所在文件夹」/ 文件预览「文件夹」 | 在 Finder / Explorer 中定位文件 | 先探路径存在性(如 `lstat`)再 `shell.showItemInFolder(path)`;文件不存在返回 `{ ok: false, reason: "not-found" }`,**约定永不 throw**。详见下方 ⚠️ |
| `saveFilePicker({ title?, defaultPath? })` | 「另存为」/ 文件管理「下载」 | 弹原生保存对话框,返回路径或 `null`(取消) | `dialog.showSaveDialog` |
| `downloadResource(url, destPath)` | 「另存为」第二步 | 远程 URL → 落本地指定路径 | `fetch` → `mkdir -p` → `writeFile` |
| `downloadResourceToTemp(url, namespace, filename, baseDir?, sessionId?)` | 「用本地应用打开」/「在文件夹中打开」前置;uri md 卡预览 | 远程 URL → 落 `baseDir` 的会话目录(缺省落临时目录),返回本地路径 | sanitize filename 防穿越;`namespace` 传**资源 URI**(资源身份)做幂等,不传卡片 id;`sessionId` 用于 `insight/<sessionId>/outputs/` 分桶 |
| `writeFileBuffer(path, buffer)` | 文件管理「下载」第二步 | `ArrayBuffer` → 落本地指定路径 | `mkdir -p` → `writeFile` |

**本地工作目录(worktree,SPEC-INS-014)**

| `window.api` 方法 | 触发位置 | 用途 | 实现要点 |
|---|---|---|---|
| `getPathForFile(file)` → `string` | 拖拽 / 选取附件 | 取 `File` 的真实本地路径 | Electron 32+ 已移除 `File.path`,用 `webUtils.getPathForFile`(preload 内同步解析);非桌面端返回 `undefined` |
| `copyFileToWorktree(srcPath, baseDir, filename)` | 附件添加 / 文件管理「上传」 | 拷进 `<baseDir>/insight/uploads/` 预会话落地区,返回落地路径 | sanitize 文件名;撞名加后缀 `name (2).ext`,**不覆盖** |
| `movePendingUploadToSession(srcPath, baseDir, sessionId)` | 发送消息时 | 把预会话区附件 rename 进 `<baseDir>/insight/<sessionId>/uploads/`,返回新路径 | `sessionId` 需 allow-list 清洗(`[A-Za-z0-9_-]`)防路径穿越——渲染进程不是安全边界 |
| `writeFile(path, content)` | markdown 编辑器自动保存 | 覆盖写本地文本文件 | 主进程需校验路径白名单(限 `insight/<sessionId>/{uploads,outputs}` 等),不可任意写盘 |
| `readFileBuffer(path)` → `ArrayBuffer \| null` | uri md 卡读「本地工作副本」 | 读本地文件为二进制;**文件不存在返回 `null`**(不 throw) | — |

**其他**

| `window.api` 方法 | 触发位置 | 用途 | 实现要点 |
|---|---|---|---|
| `openLink(url)` | 外链点击 | 用系统默认浏览器打开外链 | `shell.openExternal`;避免在 webview 内导航后无法返回 |
| `writeClipboardText(text)` | 诊断信息复制(`error-beacon` / `octoDebug`) | 写系统剪贴板 | `clipboard.writeText` |

> `DesktopApi` 各方法均为可选(`?:`):壳未暴露时按钮走 toast 兜底,不崩。
> 壳侧 preload / main IPC 由 `packages/desktop/` 自行组织,本表只约定 renderer 侧依赖的接口形态。

**类型缺口(与 SOT 的已知不一致,2026-07-17 核对)**

- `setTitlebar` / `onDownloadSavePath` 在 `DesktopApi` 里有声明,但 insight **当前无任何调用点**;
  本表不列,壳不实现也不影响 insight。

⚠️ **`showItemInFolder` 不能做成 fire-and-forget**(本表 2026-07-17 前的写法就是,已修正):
`shell.showItemInFolder` 返回 `void`,且**路径不存在时静默 no-op** —— 用户把文件从磁盘改名 / 移走后
点「打开所在文件夹」会毫无反应,渲染端也无从得知。壳必须自己先探路径存在性,把结果回传。

- **返回结果对象、不要 reject**:渲染端存在不 `await` 的裸调用,reject 会变成 unhandled rejection
- 壳未跟上本约定(仍返回 `void`)时,渲染端拿到 `undefined` 会判空后静默退回原行为,**不会误报**"文件不存在"——
  即新旧壳都不崩,但只有实现了本约定的壳才能给出用户可见的提示

---

## 5. 路由与 Agent 注册

- **路由分叉**:`packages/app/octoapp/octo.tsx` 的 `RouterRoot` 用 `isOctoPage()` / `isInsightPage()` 把 `/insight/:id?` 等导向 InsightPage(insight 自带侧栏,不再套外层 OctoSidebarLayout)。
- **Agent 注册**:`octo_insight` **硬编码注册在** `packages/opencode/src/agent/agent.ts`——`name` / `description` / `mode: "primary"` / `permission` / `skills: ["interview-analysis"]` / `mcp: ["uxr-tool"]` 直接写在 agent 定义里,`prompt` 从 `import PROMPT_OCTO_INSIGHT from "./prompt/octo_insight.txt"` 注入。**不是从 .md frontmatter 派生**(这点与归档的 octo-agent 本地壳机制不同,见 [agent-config-deploy.md banner](specs/infra/agent-config-deploy.md))。

---

## 6. frontmatter schema 边界

业界 agent frontmatter 调研 + 字段对照见
[agent-config-deploy.md §0](specs/infra/agent-config-deploy.md)。要点:

- `octo_insight.md` 的 frontmatter 字段跟 **opencode 上游对齐**(跨 fork 可移植)
- `mcp` / `skills` 是 **opencode fork 私有扩展**:不放进上游 frontmatter schema,而是在 `agent.ts` 的注册块里直接声明(见 §5)

---

## 7. 进一步阅读

- MCP 接口契约:[mcp-contract.md](specs/agents/mcp-contract.md)
- 文件上传契约:[file-upload.md](specs/infra/file-upload.md)
- 配置部署机制(octo-agent 本地壳历史 + ADR-008 理由):[agent-config-deploy.md](specs/infra/agent-config-deploy.md)、[ADR-008](adr/008-cascading-config.md)
- 架构总览:[architecture.md](architecture.md)
- 设计决策:[adr/](adr/)
</content>
