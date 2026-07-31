# Insight — Console 日志 × Bug 排查对照手册

> 用途:内网出 bug 时,照着 console 日志前缀快速定位原因。
>
> 范围:`packages/app/octoapp/pages/insight/` 全部 console 日志。这是**只读排查文档**,不改任何代码。
>
> 怎么用:复现一次问题 → 打开 DevTools Console → 按下面 §2 的「症状表」找到对应行 → 顺着「看哪几条日志」逐条核对 → 落到「可能原因 / 下一步」。
>
> 内外网隔空调试约定:`[octo:assistant] *-detail` / `[octo:prompt] send-full` 等日志会**完整 dump**(不截断),内网把这几条从 Console 复制粘到外网即可定位「LLM 究竟返回了什么」「究竟发了什么」。

---

## 0. 前缀总览

> **日志分两类来源,先认清在哪看**(这是定位的第一步,搞错地方会"搜不到"):
>
> | 类 | 来源进程 | 在哪看 | 哪些前缀 |
> |---|---|---|---|
> | **A · 客户端 DevTools** | renderer(Electron 渲染层,`packages/app/octoapp/pages/insight/`) | 复现 → 打开 **DevTools Console** → 搜前缀 | §0.1 整表 |
> | **B · server 端 / sidecar** | opencode 子进程(`packages/opencode/`) | **落盘日志文件**(见 §0.3),**不在 DevTools** | §0.2 整表 |
>
> 用构建产物排查、或要看 MCP/上传注入/知识库这类后端链路时,**只能去 B 的日志文件**,DevTools 里搜不到。

### 0.1 客户端 DevTools 日志(renderer · DevTools Console)

| 前缀 | 来源文件 | 关注什么 |
|---|---|---|
| `[octo:event]` | [lib/debug-observer.ts](../packages/app/octoapp/pages/insight/lib/debug-observer.ts) | **SSE 服务器推回的事件流**——busy/idle、消息/part 落定、卡轮的 permission/question(发送链路的"另一半") |
| `[global-sdk]` | **opencode 原生**(context/global-sdk.tsx) | **SSE 连接层**自身报错(`event stream error`/`failed`)——判断"事件管道还活着没"的直接证据,非我们打的 |
| `[octo:sync]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | 会话加载、busy↔idle 状态切换 |
| `[octo:prompt]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | 发送链路全程:入参、optimistic、async 受理、无反馈探测 |
| `[octo:queue]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | busy 期间排队 / flush / 取消 |
| `[octo:assistant]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | 一轮结束后完整 dump assistant message 原始内容 |
| `[octo:task]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) · [utils/task-refresh.ts](../packages/app/octoapp/pages/insight/utils/task-refresh.ts) | 长任务卡片:切会话清状态、刷新/终止/打开产物、聚合 diff;`child-session navigation blocked` = task 子会话导航被拦截(SPEC-INS-021 §1:子会话不作为用户级对话暴露) |
| `[octo:upload]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | **SPEC-INS-015 后**:客户端校验 + 非图片导入 worktree(`doImport`)+ **图片 change 即传 S3**(`image-upload`)+ 重试。非图片 S3 上传已下沉 server 端插件(`[octo:inject] lazy-upload`)。 |
| `[octo:chip]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | **SPEC-INS-017「研究工具」chip**(纯常驻的范围限制,只手动 × 取消):选功能(`chip-select`)/取消(`chip-clear`)/发送含 tools gate(`chip-send`)/turn 完成对账工具调用结果(`chip-result`;`not-called` 不必然是失败——是否调用归模型判断)。取代原 `[octo:preset]`(预置胶囊行已随 017 下线,功能并入 chip 菜单) |
| `[octo:permission]` | [components/permission-dock.tsx](../packages/app/octoapp/pages/insight/components/permission-dock.tsx) | **SPEC-INS-021 §2 权限询问 Dock**:`pending`(询问浮出:permissionID/permission/patterns——出现即该轮在等用户点选,对应旧「贴外部路径卡在正在探索」)/ `respond`(用户点了 拒绝/仅本次/总是允许) |
| `[octo:task-detect]` | [utils/task-detect.ts](../packages/app/octoapp/pages/insight/utils/task-detect.ts) | 从 part 读 task_id |
| `[octo:detect]` / `[octo:card]` | [components/insight-turn.tsx](../packages/app/octoapp/pages/insight/components/insight-turn.tsx) | text → 卡片检测、resource_link 卡片 |
| `[octo:resource-link]` / `[octo:resource]` | [utils/resource-link.ts](../packages/app/octoapp/pages/insight/utils/resource-link.ts) | resource_link 识别 / fetch |
| `[octo:tab]` | [components/result-viewer/tab-store.ts](../packages/app/octoapp/pages/insight/components/result-viewer/tab-store.ts) | 产物 tab 打开 / 去重 |
| `[octo:office]` | [components/result-viewer/index.tsx](../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx) | Office 文件下载 / 打开 / 另存 / 定位 |
| `[octo:worktree]` | [desktop/src/main/ipc.ts](../packages/desktop/src/main/ipc.ts)(主进程·terminal) | **SPEC-INS-014 本地工作目录布局**:源文件拷贝进 `insight/sources`、产物落 `insight/outputs`。见下 §1.6.1 |
| `[octo:mindmap]` | [components/result-viewer/mindmap-renderer.tsx](../packages/app/octoapp/pages/insight/components/result-viewer/mindmap-renderer.tsx) | 脑图渲染 |
| `[octo:mdedit]` | [components/markdown-editor/index.tsx](../packages/app/octoapp/pages/insight/components/markdown-editor/index.tsx) | markdown 全屏编辑器(Vditor):open / save-start / save-ok / save-failed / close([spec](specs/ui/insight-markdown-editor.md)) |
| `[insight:session-list]` | [components/session-list/index.tsx](../packages/app/octoapp/pages/insight/components/session-list/index.tsx) | 会话重命名 / 删除失败 |
| `[InsightPage]` | [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) | 兜底 error(session.create / upload 失败) |
| `[dev:preview]` | [__dev/cards-preview.tsx](../packages/app/octoapp/pages/insight/__dev/cards-preview.tsx) | **仅开发预览页**,mock 不连 SDK,排查线上问题时无视 |

### 0.2 server 端日志(opencode sidecar 进程 · 落盘文件,不在 DevTools)

| 前缀 | 来源文件 | 关注什么 |
|---|---|---|
| `[octo:inject]` | [packages/opencode/src/agent/octo-upload-inject.ts](../packages/opencode/src/agent/octo-upload-inject.ts) | **server 端插件**:MCP 工具执行前读 `[附件]` 清单的本地路径、**按需上传 S3**、把模型填的文件名/路径换成精确 URL([SPEC-INS-015 文件传参](specs/infra/insight-file-passing.md) ④);**chip turn 另走声明强制对齐**(`chip-declaration enforced`,[SPEC-INS-017 §2.1](specs/infra/insight-mcp-explicit-entry.md))。地址由 `OCTO_UPLOAD_ENDPOINT` 控制 |
| `[octo:extract]` | [packages/opencode/src/tool/extract_document.ts](../packages/opencode/src/tool/extract_document.ts) | **server 端工具**:文档→文本抽取(docx=mammoth / pdf=unpdf / xlsx=exceljs / pptx=jszip 直抽,[SPEC-INS-016](specs/infra/insight-extract-document.md);**SPEC-INS-021 §3 起支持 txt/md 直读**,过程条 title 中文「提取文档正文:xx」),gate 到 octo_insight。`ok`:path/format/chars/tokenEstimate/ms/pages·sheets·slides;`failed`:path/reason(`not-found`·`unsupported`·`parse-error`)/format/err |
| `[octo:kb]` | [packages/opencode/src/tool/knowledge_search.ts](../packages/opencode/src/tool/knowledge_search.ts) | **server 端工具**:chat 内网知识库检索(getKnowledgeVector)。spec 见 [specs/agents/chat-knowledge-search.md](docs/specs/agents/chat-knowledge-search.md) |
| `[octo:mcp]` | [config/config.ts](../packages/opencode/src/config/config.ts) · [mcp/index.ts](../packages/opencode/src/mcp/index.ts) | **server 端**:内建 MCP(uxr-tool)生效配置 + 连接过程参数。地址由 `OCTO_UXR_MCP_URL` 控制(见 [config/builtin-mcp.ts](../packages/opencode/src/config/builtin-mcp.ts) + [specs/agents/mcp-contract.md §MCP server 地址配置](docs/specs/agents/mcp-contract.md)) |

### 0.3 server 端日志怎么读取

opencode 子进程的日志**不进 DevTools**,落盘到 `Global.Path.log`(`<xdgData>/opencode/log/`),每次启动新建一个**时间戳命名**的 `.log`(`2026-06-22T020714.log`),保留最近几个、旧的自动清理。**最新修改时间那个 = 当前 session**。

**落点分两种,别找错**(这是"run dev 和成品包日志不在一起"的根因):

| 怎么跑的 | sidecar 日志目录 |
|---|---|
| **run dev / 裸 `opencode` CLI** | macOS/Linux `~/.local/share/opencode/log/` · Windows `%LOCALAPPDATA%\opencode\log\` |
| **桌面成品包**(beta/prod) | `<userData>/xdg-data/opencode/log/`(内置 sidecar 的 `XDG_DATA_HOME` 被 [sidecar.ts](../packages/desktop/src/main/sidecar.ts) 关进 userData;run dev 连的是外部 opencode,userData 里没有 `xdg-data/`) |

> `<userData>` = `<appData>/<appId>`。appId 与"那一堆相似文件夹"的辨认、①主进程 `main.log`、②renderer 转发 `insight-debug.log`(macOS 在 `~/Library/Logs/<显示名>/`,不在 userData)等**全部本地日志的定位**,见 **[find-local-logs.md](./find-local-logs.md)**。

命令行(macOS/Linux · run dev)捞最新一个里的 server 端日志:

```bash
DIR=~/.local/share/opencode/log
grep -E "\[octo:(mcp|kb|inject|extract)\]" "$DIR/$(ls -t "$DIR" | head -1)"
```

> 实现:日志路径见 `packages/core/src/util/log.ts` 的 `file()` / `Global.Path.log`(`packages/core/src/global.ts`,`app="opencode"`)。dev 模式文件名固定 `dev.log`。

> 约定:`⚠️` 出现在 `console.warn`,`✗`/红色出现在 `console.error`。正常链路只有 `console.log`。
>
> `[octo:inject]` 关键字段:`lazy-upload ok`(按需上传成功:`localPath`/`url`/`ms`/`cacheSize`,无此条而工具又用了文件 → 没触发上传;multipart 文件名 = 原样 basename,客户端不清洗——字符集安全交上传服务合同 v2,见 file-upload.md 顶部提案;v2 前特殊字符名下载失败属已知窗口)；`args rewritten` 的 `before`(模型填的,应是文件名或本地路径)/ `after`(注入后,应是精确 S3 URL)/ `changed`(是否真替换了,false=模型填的串不在引用键表)/ `knownRefs`(整个 session 已知引用键数=文件名+完整路径+磁盘 basename,约文件数×3,2026-07-03 起)/ `uploaded`(本次按需上传或命中缓存的引用数)。匹配为**三键精确命中**——不做去空白等启发式归一化(2026-07-03 加过、同日复审回退:有静默误配风险且"模型改写引用"是无界类);模型抄错文件名 → `changed:false` / 部分未替换 → 工具失败错误回灌,根治见 SPEC-INS-017 §2.1(chip 声明钉死参数)。**无该日志** = 工具 args 里没有"以文档扩展名结尾"的串(`hasFileRef` 早退,非文件工具都这样,正常),或该工具是 `extract_document`(显式跳过)。`args 含文件名形态串但 session 无 [附件] 区块` = 清单没注入或格式被破坏。`OCTO_UPLOAD_ENDPOINT 未配置` = sidecar 没拿到上传地址(查 electron.vite define + `.env` 的 `VITE_OCTO_UPLOAD_ENDPOINT`)。上传失败会抛错让工具调用失败、错误回灌模型(SPEC-INS-015)。
>
> `[octo:inject]` **chip 声明路径**(SPEC-INS-017 §2.1,2026-07-06 修订语义:字段校验 + URL 固定替换 + 注入,**不覆盖文件集**——文件选择/分桶归模型):chip turn 的 `uxr-tool_*` 调用命中当前 turn 的 `[MCP声明]` 时走该路径,不再走上面的通用替换。`chip-declaration enforced`:`files`(替换的文件数)/ `userPromptCorrected`(true = 模型改写了用户原文、被矫正回声明原文)/ `correctionHits`(进程内累计)/ `before` / `after`。**校验失败即抛错**(错误回灌模型,信息附可用文件清单):`download_links 必须是非空` = 模型没填/填空(常见于没附件硬调,模板本要求它先向用户要材料);`不在 [附件] 清单` = 模型抄错文件名(三键精确 miss);`要求 outline_file_path` = 多角色工具漏填大纲。`chip-declaration parse failed`(error)= 声明 JSON 坏,客户端 bug;`chip-declaration tool mismatch`(⚠️)= 声明的工具 ≠ 实际调用(如 chip turn 里模型违规调 get_task_result),回落通用路径。前端对账日志见 DevTools `[octo:chip]`。注意:MCP 工具(`uxr-tool_*`)自 2026-07-06 起**不做 hasFileRef 早退**(校验要接管"模型漏填文件参数"的情况),每次调用都会拉一次 session 消息。
>
> **注意上传在 sidecar(Node 进程)、不在渲染 DevTools**:渲染器 Network 看不到这个上传请求。**`[octo:inject]` / `[octo:extract]` 是裸 `console.log`,跟随 sidecar stdout——成品包被主进程 pipe 进 `main.log`(2026-07-08 内网实证,不在 opencode 的 log 目录!),run dev 打在外部 server 终端**;opencode log 目录里的是 `service=` 结构化日志(`[octo:mcp]` 连接、`toolsForAgent` 等)。落点定位细节见 [find-local-logs.md](./find-local-logs.md) ③。桌面 sidecar 是 Node 运行时(Electron utilityProcess.fork),插件与 extract_document 用 `node:fs`、不能用 `Bun.*`(会 `Bun is not defined`)。
>
> `[octo:kb]` 四条(出在 server 进程,不在客户端 DevTools):
> - `config`:**排查 env/域名首选**。`envBaseUrl`(server 读到的 `OCTO_KB_BASE_URL`,由 `.env.<channel>` 经 electron.vite define + createSidecarEnv 注入)/ `usingMockDefault`(true=没读到 base、回落 localhost:8787 mock,内网出现这个=没在对的 .env 里设 `OCTO_KB_BASE_URL`)/ `resolvedBase` / `url`(**实际请求的完整地址,拿它和 Insomnia 能跑通的 URL 逐字对比**)。
> - `response`:`status`/`ok`/`bodyHead`。**404 = host 不对**(beta/prod 仅 host 不同、路径固定;非服务问题);在对应 `.env.<channel>` 改 `OCTO_KB_BASE_URL` 重打包即可。
> - `parsed`:`totalDocs`/`topScores`/`titles`——检索成功但答非所问时看命中文档。
> - `检索失败 url=…`(error):网络层失败(连不上 / 超时 / abort),带完整 url。
>
> `[octo:mcp]` 五条(出在 server 进程 / sidecar 日志,不在客户端 DevTools;**确认 uxr-tool 连的是 beta 还是 prod 看这组**):
> - `builtin-config`:**排查 env/地址首选**(config.ts,每次 config load 打一条)。`url`(uxr-tool 生效地址,拿它判 beta `7.192.161.60` / prod `7.185.124.42`)/ `source`(`env(OCTO_UXR_MCP_URL)` = 读到了环境变量;`default(beta)` = **没读到、回落 beta**,内网出现这个=没在对的 `.env.<channel>` 设 `OCTO_UXR_MCP_URL` 或没用 `build:prod` 打包)/ `proxy` / `timeout` / `userOverridesUxr`(true=用户 opencode.json 也配了 uxr-tool,实际生效以用户配置为准)。
> - `connect-remote`:连接前的解析入参。`url`(最终请求地址)/ `proxyMode`(代理决策镜像:`bypass(forced)` = 已 `proxy:false` 强制绕过;`system(public)` = 走系统代理,7.x 内网段落到这里易触发 504)/ `timeout` / `oauth` / `headerKeys`。
> - `transport-try`:每个传输各一条(先 `StreamableHTTP` 后 `SSE`),带 `url` / `timeout`。
> - `connected`:连上了,带 `transport`(实际生效的传输)/ `url`。
> - `transport-failed`(warn):某传输失败的 info/warn 级镜像(debug 级 `transport connection failed` 生产可能被过滤),带 `url` / `proxyMode` / `error`——判代理问题看 `proxyMode`。
> - **完全无 `[octo:kb]` 日志** = 模型没调用该工具(检查是否 octo_ai agent、问题是否被识别为内网问题)。

---

## 0.5 opencode 数据流全貌(发一条消息时发生了什么)

排查前先建立心智模型。一次发送的完整链路:

```
①发送  doSendPrompt → globalSDK.client.session.promptAsync()
        └→ POST /session/:id/prompt_async    ← server 立即受理返回,响应体≈空!
                                                 (Network 里这条请求看不到生成内容,内容在 ② SSE)
②SSE流  globalSDK.event.start() → GET /event  ← 一条长连,这一轮所有"动静"从这里流式推回
③分发   globalSDK.event.listen((e)=>…)        ← GlobalSync 订阅它;我们的 debug-observer 也旁路订阅
④写库   event-reducer 按 event.type 写进 sync.data.{ session_status, message, part, permission, question }
⑤渲染   insight 的 memo 读 sync.data 派生渲染
```

**核心认知:`promptAsync` 成功 ≠ 这一轮会跑。生成的真相全在 ② 的 SSE event 里。** `[octo:prompt]` 只覆盖 ①;`[octo:event]`(下面 §1.0)覆盖 ②③ —— 两者合起来才是完整发送链路。①②③④全是 opencode 原生,我们只在 insight 侧加了**只读旁路观测**,不改上游。

---

## 1. 日志前缀字典

每条说明格式:**时机** / **关键字段** / **正常 vs 异常**。

### 1.0 `[octo:event]` — SSE 服务器事件流(排查核心)

> 来源 [lib/debug-observer.ts](../packages/app/octoapp/pages/insight/lib/debug-observer.ts):旁路订阅 `globalSDK.event.listen()`,把当前 session 的每个 SSE event 打成一行。**默认精简模式**只打下表"精简打✓"的类型;`message.part.delta` 高频,按 partID 聚合成 `message.part.delta ×聚合`。要看全部敲 `octoDebug.verbose(true)`(见 §3)。
>
> 这是「发了消息有没有动静」的直接证据:一条 event 都不来 = SSE 没连/server 没启动该轮;来 `permission.asked`/`question.asked` = agent 在等用户、这一轮卡住。

| event.type | 精简打 | 字段 / 含义 |
|---|---|---|
| `session.status` | ✓ | `{status, sessionID}` — busy/idle,这一轮"启动没/结束没"的唯一真相 |
| `message.updated` | ✓ | `{role, msgID}` — 新增/更新一条消息(assistant 冒出来) |
| `message.part.updated` | ✓ | `{partType, tool, partStatus, partID, msgID}` — 一个 part(text/tool)落定 |
| `message.part.removed` | ✓ | `{partID, msgID}` |
| `message.removed` | ✓ | `{msgID}` |
| `message.part.delta` | 聚合 | `{partID, msgID, field, count, chars}` — 流式文本增量;精简下每秒聚合一次,verbose 才逐条 |
| **`permission.asked`** | ⚠️ | 整包 properties。**agent 在等授权,这轮停住直到回复**——"发了没反应"的隐形杀手 |
| **`question.asked`** | ⚠️ | 整包 properties。**agent 在问问题等回答**,同上 |
| `permission.replied` / `question.replied` / `question.rejected` | ✓ | 授权/问题已回 → 轮应恢复推进 |
| `server.connected` | ✓ | SSE(重)连上了 |
| `global.disposed` / `server.instance.disposed` | ✓ | **server 实例没了** → 之后任何发送都不会有反馈 |
| `session.created/updated/deleted`、`todo.updated`、`session.diff`、`vcs.branch.updated`、`lsp.updated` | verbose | 噪音类,精简模式不打,`verbose` 才打 |
| `server.heartbeat` | **忽略** | 高频保活(每~10s),**不入 ring、不打印**(否则刷屏+占满缓冲+掩盖规则1)。只记最后心跳时间供 why 判断 SSE 存活 |

- **正常**:发送后依次见 `session.status{busy}` → 若干 `message.updated`/`message.part.updated`/`delta 聚合` → `session.status{idle}`。
- **异常**:① 发送后**一条 `[octo:event]` 都没有** → SSE 没把事件推回(连接断 / server 没启动该轮);先翻有没有上游原生的 **`[global-sdk] event stream error/failed`**(红字)——有=连接管道断了,没有=管道活着但 server 没产出该轮;② 见到 `permission.asked ⚠️`/`question.asked ⚠️` 后**再无下文** → 卡在等用户,需在 UI 响应(用 `octoDebug.pending()` 看是什么);③ 见到 `global.disposed`/`server.instance.disposed` → server 掉了。

### 1.1 `[octo:sync]` — 会话加载与状态

#### `[octo:sync] session.sync`
- **时机**:切到某会话、或缓存被驱逐导致 `message[id]` 重新变 `undefined` 时,触发原生 sync 加载。([index.tsx:165](../packages/app/octoapp/pages/insight/index.tsx#L165))
- **字段**:`sessionID` — 正在加载的会话 id。
- **正常**:切会话时**恰好打一条**,随后中间区渲染出历史消息。
- **异常**:
  - 切会话后**完全没有这条** → effect 没触发(`params.id` 没变或路由没进来);
  - **反复刷屏同一 id** → `message[id]` 一直是 `undefined`,sync 始终没把数据写回(server 没响应 / 连接断),配合「白屏」症状,见 §2.1。

#### `[octo:sync] status`
- **时机**:`sessionStatus` 变化(`idle`↔`busy`)时打,`defer:true` 不打初始值。([index.tsx:241](../packages/app/octoapp/pages/insight/index.tsx#L241))
- **字段**:`sessionID`、`type`(`idle` / `busy`)。
- **正常**:发消息后短时内出现 `type:"busy"`,一轮结束出现 `type:"idle"`。
- **异常**:发消息后**迟迟不出现 `busy`** → server 没启动该轮(见 §2.2 no-feedback 探测器)。

### 1.2 `[octo:assistant]` — 一轮结束的完整 dump

> 这三条只在 **busy→idle 那一刻**打(`defer:true`,初始 idle 不打),把刚结束的最新 assistant message 原始内容全量 dump。内网抓不到 SSE network 时,靠这几条还原真相。

#### `[octo:assistant] turn-complete`
- **时机**:busy→idle 切换瞬间。([index.tsx:265](../packages/app/octoapp/pages/insight/index.tsx#L265))
- **字段**:`sessionID`、`msgID`、`partsCount`、`textPartsCount`、`toolPartsCount`、`toolNames[]`。
- **正常**:`partsCount>0`,`toolNames` 含预期工具。
- **异常**:`partsCount:0` 或全 0 → LLM 这轮没产出任何 part(空回复 / 被中断)。

#### `[octo:assistant] text-part-detail`
- **时机**:turn-complete 之后,每个 text part 各打一条,**完整文本不截断**。([index.tsx:277](../packages/app/octoapp/pages/insight/index.tsx#L277))
- **字段**:`msgID`、`partIdx`、`partID`、`textLen`、`text`(全文)。
- **用途**:卡片没出来 / 渲染怪 → 看 `text` 全文里 LLM 实际写了什么(html fence?表格?)。

#### `[octo:assistant] tool-part-detail`
- **时机**:turn-complete 之后,每个 tool part 各打一条。([index.tsx:296](../packages/app/octoapp/pages/insight/index.tsx#L296))
- **字段**:`toolName`、`status`、`metadata`、`outputRaw`(原始字符串)、`outputParsed`(尝试 JSON.parse 后的对象,失败则同 raw)。
- **用途**:长任务卡片不对 / 产物缺失 → 看 `outputParsed` 里有没有 `task_id` / `resource_link` / `structuredContent`。

### 1.3 `[octo:prompt]` — 发送链路(排查核心)

一次正常发送,按顺序应出现:`send` → `send-full` → `optimistic added` → `sent (async)` →(8s 后)`feedback-ok`。

#### `[octo:prompt] send`
- **时机**:`doSendPrompt` 调用 `promptAsync` **之前**,组装好入参时。([index.tsx:558](../packages/app/octoapp/pages/insight/index.tsx#L558))
- **关键字段**:
  - `source` — 触发来源:`user`(手动发送)/ `task-refresh` / `task-stop` /(队列 flush 也是 `user`)。
  - `model` — `{modelID, providerID}` 或 **`undefined`**。
  - `modelResolved` — `!!model`。**`false` = 前端没解析到模型**,会把 `model:undefined` 发给 server,由 server 按 agent 默认配置兜底;**若 agent 也无默认模型,这轮可能根本不启动**。
  - `statusAtSend` — 发送那一刻的 session 状态(正常 `idle`)。
  - `text`(截断 120 字预览)、`textLen`、`attachmentsCount`、`uploads[]`。
- **正常**:`modelResolved:true`、`statusAtSend:"idle"`。
- **异常**:`modelResolved:false` → 见 §2.2 / §2.3;`statusAtSend:"busy"` 而仍走到这里 → 理论不该发生(busy 应走队列),属逻辑异常。

#### `[octo:prompt] send-full`
- **时机**:紧跟 `send`,**完整不截断**。([index.tsx:572](../packages/app/octoapp/pages/insight/index.tsx#L572))
- **字段**:`cleanText`(用户可见全文)、`uploadBlock`(synthetic 上传块,喂 LLM、气泡不显示)。
- **用途**:把怪 case 原样粘到外网复现;核对附件 URL 是否真拼进了 `uploadBlock`。

#### `[octo:prompt] optimistic added`
- **时机**:乐观消息写入 `sync.data` 之后。([index.tsx:584](../packages/app/octoapp/pages/insight/index.tsx#L584))
- **字段**:`messageID`、`partsCount`(1=纯文本,2=带 synthetic 上传块)。
- **正常**:这条一出,用户气泡应**立即**出现在中间区。

#### `[octo:prompt] sent (async)`
- **时机**:`promptAsync` **resolve 之后**(server 已受理这轮请求)。([index.tsx:599](../packages/app/octoapp/pages/insight/index.tsx#L599))
- **字段**:`messageID`、`sessionID`、`method:"POST"`、`endpoint`(`.../session/:id/prompt_async`,拿去 Network 面板筛)、`statusAfterSend`(受理后那一刻状态)、`response`(server 返回 data)。
- **正常**:能看到这条 = HTTP 请求成功返回;`statusAfterSend` 通常很快变 `busy`(也可能此刻还没翻,以 `[octo:sync] status` 为准)。
- **异常**:**没有这条**但有 `send` → `promptAsync` 抛错了,应同时出现 `[octo:prompt] failed`。

#### `[octo:prompt] failed`
- **时机**:`promptAsync` 抛异常(catch)。([index.tsx:608](../packages/app/octoapp/pages/insight/index.tsx#L608))
- **字段**:`source`、`messageID`、`err`。同时会回滚 optimistic 消息 + 弹「发送失败」toast。
- **用途**:`err` 里看 HTTP 状态 / SDK 报文。

#### `[octo:prompt] no-feedback ⚠️`(无反馈探测器)
- **时机**:`sent (async)` 后启动 8s 看门狗(`NO_FEEDBACK_WATCHDOG_MS=8000`),到点时若 session **既没进 busy 也没新增 assistant 消息**,打这条 warn。([index.tsx:481](../packages/app/octoapp/pages/insight/index.tsx#L481))
- **字段**:`sessionID`、`messageID`、`status`(8s 后的状态)、`messageCount`、`assistantBefore` / `assistantNow`(发送前后 assistant 消息数)、`hint`。
- **正常**:**不出现**,而是出现 `feedback-ok`。
- **异常(出现即说明发了消息但没动静)**:
  - `status` 仍是 `idle` 且 `assistantNow <= assistantBefore` → server 没启动该轮 → 查 SSE 事件流是否在收 / server 是否启动了该轮 / `modelResolved` 是否为 false 且 agent 无默认模型。是 §2.2 的主证据。

#### `[octo:prompt] feedback-ok`
- **时机**:8s 看门狗到点,判定为「有反馈」(已 busy 或已有新 assistant)。([index.tsx:494](../packages/app/octoapp/pages/insight/index.tsx#L494))
- **字段**:`status`、`assistantBefore` / `assistantNow`。
- **正常**:发送链路健康的标志。

### 1.4 `[octo:queue]` — busy 期间排队

> **SPEC-INS-027(2026-07-30)**:drain(flush)触发器已从 insight 页面组件迁到应用根常驻的全局 runner（`octoapp/utils/session-queue-runner.ts` + `pages/insight/queue-runner.tsx`）。**入队仍在页面**（`index.tsx` handleSubmit），**发送改由 runner 发起**。原 `[octo:queue] flushing`(页面内)已被 runner 的 `drain-send` 取代。

#### `[octo:queue] enqueued`
- **时机**:busy/retry 时用户再次发送,文本入队(FIFO 多容量,push 追加;SPEC-INS-027 起入队即固化 directory/model/chip + **上传附件快照**,并清空共享附件栏)。页面 `handleSubmit`。
- **字段**:`sessionID`、`len`、`depth`、`hasChip`、`uploads`(非图片附件数)、`images`(图片数)。
- **相关**:`[octo:queue] enqueue upload-move failed`——入队搬迁 pending 上传(.octo/tmps→会话 uploads/)失败,快照退化为旧路径仍可读(`snapshotAttachmentsForQueue`)。
#### `[octo:queue] drain-send`
- **时机**:全局 runner 观测到某会话 idle 且队列非空,发出队首一条(页面无关发送 `sendQueuedItem`)。取代旧的页面内 `flushing`。
- **字段**:`sessionID`、`directory`、`messageID`、`model`、`skills`、`files`、`uploads`、`images`、`chip`。正常后面紧跟服务端回传(注意:后台 drain 不写 insight optimistic,气泡经 SSE 落库后显示)。
#### `[octo:queue] drain send failed`
- **时机**:runner 发送 reject(网络/服务端异常)。释放 per-session in-flight 守卫,失败项已消费不自动重试。
- **字段**:`sid`、`err`。
#### `[octo:queue] removed`
- **时机**:用户从队列条单条移除;输入框为空时回填便于编辑。页面 `removeQueued`。
- **字段**:`index`、`remaining`。
- **相关**:abort 时 `handleAbort` 先 `clearSessionQueue` 清整桶(避免 idle 后 runner 续发),不单独打日志。

### 1.5 `[octo:task]` — 长任务卡片

#### `[octo:task] session switched, view state reset (refresh cooldown preserved)`
- **时机**:切会话时,重置 tabs / 自动开记录 / 队列 / 未发送附件;刷新冷却**不重置**(per task_id 延续倒计时,防切换绕过防抖)。([index.tsx:432](../packages/app/octoapp/pages/insight/index.tsx#L432))
- **正常**:每次切会话一条。(旧文案 `refresh state cleared`,2026-06-11 起更名)
#### `[octo:task] aggregate diff`
- **时机**:`taskCards` 聚合结果变化时打快照 diff。([index.tsx:932](../packages/app/octoapp/pages/insight/index.tsx#L932))
- **字段**:`total`、`changes[]`(`{taskId, from, to}`,`to` 形如 `status|message`,`"gone"` 表卡片消失)、`snapshot`。
- **用途**:卡片状态不更新 / 闪烁 → 看 changes 有没有按预期推进(pending→processing→completed)。
#### `[octo:task] markRefreshed`
- **时机**:点刷新成功,记冷却时间戳。([utils/task-refresh.ts:44](../packages/app/octoapp/pages/insight/utils/task-refresh.ts#L44))字段 `cooldownMs`。
#### `[octo:task] refresh blocked: busy` / `refresh blocked: cooldown`
- **时机**:刷新被拦(正忙 / 冷却中)。([index.tsx:814](../packages/app/octoapp/pages/insight/index.tsx#L814))→ 「刷新点了没反应」正常拦截,不是 bug。
#### `[octo:task] stop blocked: busy`
- **时机**:终止被拦(正忙)。([index.tsx:829](../packages/app/octoapp/pages/insight/index.tsx#L829))
#### `[octo:task] openResult` / `auto-openResult (viewer empty)`
- **时机**:打开产物(手动 / 首个 completed 自动开)。([index.tsx:880](../packages/app/octoapp/pages/insight/index.tsx#L880) / [index.tsx:902](../packages/app/octoapp/pages/insight/index.tsx#L902))字段 `count`、`tabs[]`。
#### `[octo:task] openResult: card not found` / `no result yet` ⚠️
- **时机**:点「打开结果」但卡片不存在 / 还没产物。([index.tsx:872](../packages/app/octoapp/pages/insight/index.tsx#L872))→ 产物按钮点了打不开时看这两条。

### 1.6 `[octo:upload]` — 附件导入(SPEC-INS-015 后:不再 eager 上传 S3)

**SPEC-INS-015 后**:选**非图片**文件只做客户端校验 + 把源文件**导入 worktree**(`doImport` → `copyFileToWorktree`,拷进 `insight/sources` 拿本地路径),发送时注入 `[附件]` 清单;**图片仍 change 即传 S3**(`image-upload`)。非图片 S3 上传已下沉 server 端 `octo-upload-inject` 插件(模型调 MCP 时按需上传,`[octo:inject] lazy-upload`)。原 `1/5 → 5/5` eager 上传链路已删除,`uploadFile` 现只服务图片。

| 日志 | 级别 | 时机 / 含义 | 关键字段 |
|---|---|---|---|
| `[octo:upload] client-validate rejected` | warn | 选文件后客户端校验未过(空文件 / 超 100MB / 扩展名不在白名单)。**不存 File、不可重试,只能删除重选**。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx)) | `id`、`code`、`message` |
| `[octo:upload] imported without local path (degraded…)` | warn | 非图片导入成功但拿不到本地路径(无 projectDir / 非桌面 / 剪贴板内存 blob)→ done 但**无 path**,不进 `[附件]` 清单、②④ 用不了(降级,不报错)。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx)) | `id`、`filename` |
| `[octo:upload] import to worktree failed` | error | 非图片 `copyFileToWorktree` 抛错(真失败)→ chip 标红可重试。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx)) | `id`、`filename`、`err` |
| `[octo:upload] image-upload failed` | error | **图片** change 即传 S3 失败 → chip 标红可重试。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx)) | `id`、`filename`、`err` |
| `[octo:upload] retry import / retry image-upload` | log | 点 chip 重试:非图片重新导入 worktree,图片重传 S3。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx)) | `id`、`filename` |
| `[octo:upload] retry skipped: no original File` | warn | 客户端校验失败的 chip 没有原 File,无法重试(正常该按钮已隐藏,走到此为兜底)。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx)) | `id` |

> 真正的 S3 上传链路看 server 端 `[octo:inject] lazy-upload`(§0.2),不在 DevTools。前端只到「文件本地就绪」为止。

### 1.6.1 `[octo:worktree]` — 本地工作目录布局(SPEC-INS-014,主进程·terminal)

源文件拷贝进 `insight/sources`、MCP 产物落 `insight/outputs`。**均在主进程**(看 terminal,非 DevTools)。
> ⚠️ 落点分两种:裸 `console.log` 的行(下表 log 级)只打主进程 stdout,**不进 `main.log`**;
> `result-materialize-failed` / `download-resource failed` 两条走 electron-log(`log.error`),**成品包里落 `main.log`**——内网远程排障优先搜这两条。
> SPEC-INS-015 后:非图片 S3 上传不再 eager,改由 server 端 `octo-upload-inject` 插件在模型调 MCP 时按需上传(`[octo:inject] lazy-upload`)。本地 `source-copy ok` 拿到的 dest 路径即 `[附件]` 清单里映射的本地路径。

| 日志 | 级别 | 时机 / 含义 | 关键字段 |
|---|---|---|---|
| `[octo:worktree] ensure-dir` | log | 首次创建 `insight/sources` 或 `insight/outputs`。([desktop/src/main/ipc.ts](../packages/desktop/src/main/ipc.ts)) | `dir`、`created` |
| `[octo:worktree] source-copy ok` | log | 源文件拷贝进 `insight/sources` 成功(选文件即触发)。 | `srcPath`、`dest` |
| `[octo:worktree] source-copy failed` | error | 拷贝失败 —— **不阻断** MCP/发送,仅该文件本地能力线不可用。 | `srcPath`、`dest`、`reason` |
| `[octo:worktree] result-materialize` | log | MCP 产物落地 `insight/outputs`;`reused:true` = 命中本会话内存表/已落地副本(含用户改动),不 re-fetch。 | `filename`、`path`、`reused` |
| `[octo:worktree] result-materialize-failed` | error(**进 main.log**) | 产物下载失败(`download-resource-to-temp`,`net.fetch` 走 Chromium 栈)。`reason` 是展开的 cause 链(DNS/TLS/代理/连接被拒),同文案回传渲染端错误提示。 | `url`、`filename`、`sessionId`、`reason` 或 `status`+`statusText` |
| `[octo:worktree] download-resource failed` | error(**进 main.log**) | 「另存为/下载原件」下载失败(`download-resource`),字段语义同上。 | `url`、`reason` 或 `status`+`statusText` |
| `[octo:worktree] materialize-rejected` | error(**进 main.log**) | **SPEC-INS-026 §4.1**:产物文件名不合法(含 `/` `\` `NUL`、或名为 `.`/`..`),**拒绝落盘且不静默改名**。与 `result-materialize-failed`(网络类,可重试)不同,这条重试无用;渲染端据 message 前缀 `[octo:name-rejected]` 识别并 toast。([desktop/src/main/landing-name.ts](../packages/desktop/src/main/landing-name.ts)) | `url`、`filename`、`sessionId`、`reason` |
| `[octo:worktree] upload-name-rejected` | error(**进 main.log**) | 同上,发生在**上传方向**(`copy-file-to-worktree`,附件拷进 `.octo/tmps/`)。 | `srcPath`、`filename`、`reason` |

### 1.7 其他前缀(出场较少)

- `[octo:chip] chip-select / chip-clear / chip-send / chip-result` — 「研究工具」chip 全链路(SPEC-INS-017,纯常驻范围限制):选功能、取消、发送(带 `toolGate`,与 server 端 `[octo:inject] chip-declaration enforced` 对账)、turn 完成后工具调用结果(`called`/`status`;`not-called` **不必然是失败**——是否调用归模型判断,可能在向用户索取材料/确认分桶/回应其他意图;激活态无任何自动清除,只手动 ×)。([index.tsx](../packages/app/octoapp/pages/insight/index.tsx));原 `[octo:preset] click` 已随预置胶囊行下线
- `[octo:task-detect] readTaskInfo` — 从某 part 读出 task 信息。([utils/task-detect.ts:73](../packages/app/octoapp/pages/insight/utils/task-detect.ts#L73))
- `[octo:detect] start / reject / match / html-fence-found` — InsightTurn 从 text part 检测能否出卡片(`reject` 带 `reason`)。([components/insight-turn.tsx](../packages/app/octoapp/pages/insight/components/insight-turn.tsx))
- `[octo:card] resource_links (no task)` — 有 resource_link 但无 task_id 时的卡片路径。([components/insight-turn.tsx:121](../packages/app/octoapp/pages/insight/components/insight-turn.tsx#L121))
- `[octo:resource-link] found / none-found-but-candidates-present / missing-business-type` — resource_link 识别;后两条 warn 表示有候选但没匹配业务类型。([utils/resource-link.ts](../packages/app/octoapp/pages/insight/utils/resource-link.ts))
- `[octo:resource] fetch start / ok / failed / error` — `source:"uri"` 卡片的内容拉取。([utils/resource-link.ts:180](../packages/app/octoapp/pages/insight/utils/resource-link.ts#L180))
- `[octo:resource] md-local` — uri **markdown** 卡不直接 fetch(url),而是先把产物落成本地工作副本(`downloadResourceToTemp` 幂等)再读盘,使预览/编辑/重开卡回显同一份(含改动)。带 `localPath`/`bytes`。([components/result-viewer/index.tsx](../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx))
- `[octo:resource] download-original-start/ok/failed` — uri md 卡「另存为」:始终从 url 重新拉 MCP 原始版本另存到用户选定目录(不取本地工作副本/编辑后内容;与 file 类型「另存为」同义)。([components/result-viewer/action-bar.tsx](../packages/app/octoapp/pages/insight/components/result-viewer/action-bar.tsx))
- `[octo:resource] copy-link-failed` — 加载失败兜底页「复制链接」写剪贴板失败(成功/失败均有 toast)。([components/result-viewer/index.tsx](../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx))
- `[octo:resource] eager-materialize / eager-materialize-failed` — **SPEC-INS-014 v4**:MCP `uri` 产物卡「出卡即落」进 `insight/<sessionId>/outputs/`(不等点开),覆盖全部 uri 卡类型(此前只 markdown 卡点开才落、其余只 fetch 不落盘 → 思维导图等产物不进文件管理)。客户端触发侧;主进程落地本身另打 `[octo:worktree] result-materialize`,两者配对定位「出卡了没落盘」。带 `cardId`/`type`/`filename`/`sessionId`/`localPath`。([utils/local-resource.ts `materializeUriCardToOutputs`](../packages/app/octoapp/pages/insight/utils/local-resource.ts),挂载于 [index.tsx](../packages/app/octoapp/pages/insight/index.tsx) taskCards effect + [components/insight-turn.tsx](../packages/app/octoapp/pages/insight/components/insight-turn.tsx) 路径 A effect)
- `[octo:tab] openTab / dedupe-by-uri-and-type / dedupe-by-id` — 产物 tab 打开与去重。([components/result-viewer/tab-store.ts](../packages/app/octoapp/pages/insight/components/result-viewer/tab-store.ts))
- `[octo:office] download-start/ok · open-path/failed · saveas-* · reveal-*` — Office 文件下载、`window.api.openPath` 唤起本地应用、另存、文件夹定位(渲染进程)。**SPEC-INS-014 后**幂等/复用语义改由主进程的 `[octo:worktree] result-materialize`(`reused` 字段)体现,旧 `reuse-existing` / `reuse-locked` 已删除(落点扁平 + 内存表幂等,首次总写新文件、不再覆盖已开文件)。([components/result-viewer/index.tsx](../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx) · [desktop/src/main/ipc.ts](../packages/desktop/src/main/ipc.ts))
- `[octo:mindmap] render failed` — 脑图渲染失败,带 `mdPreview` 前 200 字。([components/result-viewer/mindmap-renderer.tsx:36](../packages/app/octoapp/pages/insight/components/result-viewer/mindmap-renderer.tsx#L36))
- `[octo:mdedit] open · save-start/ok/failed · close` — markdown 全屏编辑器(Vditor):进入(含 `path`/`persistent`)、自动保存防抖写盘(含 `path`/`bytes`)、关闭回写 tab。写盘走新增 `window.api.writeFile`(主进程校验:`insight/outputs`、旧 `.octo/downloads`、临时目录,或白名单外但已存在的普通文件——覆盖 write 工具产物)。`open-failed` = 定位本地文件失败(uri 未落地 / inline 无本地文件)。**不做「还原初始内容」**(要回原始版本重新从 MCP 下载即可)。([components/markdown-editor/index.tsx](../packages/app/octoapp/pages/insight/components/markdown-editor/index.tsx))
- `[insight:session-list] rename failed / delete failed` — 会话重命名 / 删除失败。([components/session-list/index.tsx](../packages/app/octoapp/pages/insight/components/session-list/index.tsx))

---

## 2. 症状 → 日志 → 原因 → 下一步

### 2.1 切回会话,中间区白屏

| | |
|---|---|
| **看哪几条** | ① `[octo:sync] session.sync {sessionID}` 是否打了;② 之后 `[octo:sync] status` / 历史消息是否出现 |
| **判读** | • **完全没有 `session.sync`** → 切会话的 effect 没触发:`params.id` 没变,或路由没进 InsightContent。查路由 / `params.id`。<br>• **`session.sync` 打了、但反复刷同一 id 且界面始终空** → sync 调了但 `message[id]` 一直没被写回(`undefined`),数据没回来。<br>• **`session.sync` 只打一次后再无下文、界面空** → server 没把该会话消息同步回来。 |
| **可能原因** | sync 缓存被驱逐(连接重置/驱逐)后 `message[id]` 变回 `undefined`,本应自动重 sync(effect 依赖里就带了这个判断);若仍空 → globalSync 的 SSE/event 流断了,或 server 侧该会话数据异常 |
| **下一步** | 1) 确认 `[octo:sync] session.sync` 的 `sessionID` == 地址栏会话 id;2) 看 Network/SSE 连接是否存活;3) 看有无 `[InsightPage] session.create failed` 之类红字;4) 该会话是否真的有消息(换会话对照) |

> 背景:白屏的根因之前是「`message[id]` 被驱逐成 `undefined` 后不再重新 sync」。现在 effect 依赖同时盯 `params.id` 和 `message[id]===undefined`,缓存被清也会重触发(`session.sync` 自带 inflight 去重,重复调用安全)。所以**正常情况下 `session.sync` 该自动补打**;若没补打,是 effect 没跑,不是 server 问题。

### 2.2 发消息后,既无「正在生成」也无回复 ★重点

| | |
|---|---|
| **看哪几条** | 按发送链路顺序核对:①`[octo:prompt] send`(`modelResolved` / `statusAtSend`)→ ②`optimistic added` → ③`sent (async)`(`statusAfterSend`)→ ④**`sent` 之后有没有 `[octo:event] *`** ⑤ 8s 后 `no-feedback ⚠️` 还是 `feedback-ok` |
| **分流** | |
| **A. 连 `send` 都没有** | 发送压根没触发:可能 `hasUploadingAttachments()`(还有附件在传)或文本为空被 `handleSubmit` 提前 return;或 busy 时走了 `[octo:queue] enqueued`(去看队列,不是 bug) |
| **B. 有 `send`、有 `optimistic added`,但没有 `sent (async)`** | `promptAsync` 抛错 → 必有 `[octo:prompt] failed {err}` + 「发送失败」toast + 气泡回滚。看 `err`(HTTP/SDK 报文) |
| **C. 有 `sent (async)`,但之后 `[octo:event]` 一条都没有** | **SSE 没把事件推回**。先看有没有上游红字 `[global-sdk] event stream error/failed`:有=连接管道断了(网络/server 不可达);没有=管道活着但 server 没启动该轮(看 `[octo:event] global.disposed`·`server.instance.disposed` 判断实例是否还在;再看 `send.modelResolved`:`false` 且 agent 无默认模型 → 无模型可用不启动 → §2.3) |
| **D. 有 `sent (async)`,也有 `[octo:event] permission.asked ⚠️` / `question.asked ⚠️`,然后没下文** | **agent 在等用户授权/回答,这轮卡住了**。敲 `octoDebug.pending()` 看具体是什么,在 UI 上响应它 |
| **E. 有 `[octo:event] session.status{busy}` 但界面无「正在生成」** | event 收到了、库也写了,但**渲染层没反映** → reducer/memo/组件问题。`octoDebug.state()` 确认 status 确实是 busy,问题在 UI 而非数据 |
| **可能原因** | 模型未解析 + agent 无默认 / SSE 事件流断 / server 未启动该轮或实例已掉 / agent 等授权卡住 / 渲染层未反映 |
| **下一步** | 1) `send.modelResolved` 是不是 false?是 → 先解决模型(§2.3);2) `sent` 后有没有 `[octo:event]`?没有=C,有 `permission/question.asked`=D,有 `busy` 但界面不动=E;3) 随时 `octoDebug.events()` 回放最近 SSE 事件、`octoDebug.lastSend()` 核对发了什么 |

> 速记:`send` 没有=没发出;`send` 有但 `sent` 没有=请求失败(看 `failed`);`sent` 有但**无 `[octo:event]`**=发出去了 server 没动静(C);有 `permission/question.asked`=卡在等用户(D);有 `busy` 但界面不动=渲染层(E)。

### 2.3 模型显示「选择模型」却仍能发送

| | |
|---|---|
| **看哪几条** | `[octo:prompt] send` 的 `model` / `modelResolved` |
| **判读** | 顶部标签文案 = `local.model.current()?.name ?? "选择模型"`([index.tsx:1106](../packages/app/octoapp/pages/insight/index.tsx#L1106) / [index.tsx:1292](../packages/app/octoapp/pages/insight/index.tsx#L1292))。显示「选择模型」= `local.model.current()` 返回 `undefined`。此时 `send` 里 `model:undefined`、`modelResolved:false`,但发送不被拦截,照样把 `model:undefined` 发给 server 兜底 |
| **可能原因** | `useLocal().model.current()` 的回退链(会话级 → agent 默认 → 全局兜底)全部落空:模型列表(ModelsProvider)还没加载好,或 agent/全局都没配默认模型。SPEC-INS-010 D2 已统一走 `useLocal().model`,设计目标是「初次进入不再显示未选却可发送」——若仍出现,是回退链没兜住 |
| **下一步** | 1) 确认 ModelsProvider 模型列表是否加载成功(无模型 → `current()` 永远 undefined);2) 检查 agent `octo_insight` 是否配了默认模型;3) 若 `modelResolved:false` 且发送后 `no-feedback ⚠️`,说明 server 端也无默认 → 这正是 §2.2-C,需补 agent 默认模型或让用户手动选 |

> 注意:「能发送」本身不是 bug(server 可按 agent 默认兜底);只有当 `modelResolved:false` **且** server 无默认导致 `no-feedback` 时才是问题。两者要连起来看。

### 2.4 附件导入 / 按需上传失败(SPEC-INS-015)

链路两段、两套日志(分清在哪段失败):**①导入** 选文件时(前端 `[octo:upload]`,DevTools)→ **②按需上传** 模型调 MCP 时(server 端 `[octo:inject]`,落盘日志)。

| | |
|---|---|
| **①导入失败(前端)** | |
| `client-validate rejected` | 文件本身不合规(空 / >100MB / 扩展名不在白名单)。看 `code`。**不可重试**,需删除重选 |
| `import to worktree failed` | `copyFileToWorktree` 抛错(磁盘 / 权限)→ chip 标红可重试(`retry import`) |
| `imported without local path (degraded…)` | 无 projectDir / 非桌面 / 内存 blob → done 但无 path,**该文件不进注入块、MCP 拿不到**(降级,非报错)。生产环境本不该出现(projectDir 恒在) |
| **②按需上传失败(server,看落盘日志)** | |
| `[octo:inject] OCTO_UPLOAD_ENDPOINT 未配置` | sidecar 没拿到上传地址 → 查 `.env` 的 `VITE_OCTO_UPLOAD_ENDPOINT` + electron.vite define(`OCTO_UPLOAD_ENDPOINT`)。工具调用会失败、错误回灌模型 |
| `[octo:inject] lazy-upload` 缺失 / 抛错 | 模型用了文件但没上传日志 = 填的文件名/路径没命中 `[附件]` 清单(看 `args rewritten` 的 `changed:false`);有日志但抛错 = 上传服务连不上 / 拒了 / 端点未配(错误文案回灌模型,工具失败) |
| **下一步** | 1) 文件「附上去了但分析说读不到」→ 先确认前端有无 `imported without local path`(降级)或 chip 是否标红;2) 否则去 server 落盘日志看 `[octo:inject]`(§0.2 grep 方法)定位上传段 |

> 注:导入失败**不影响文字发送**——只有 `status:"done"` 且**有 path** 的附件才会进 `uploadBlock`;但 `hasUploadingAttachments()` 为真(还在导入)时 `handleSubmit` 会拦发送,表现为「点发送没反应」,与 §2.2-A 区分。

---

## 3. `window.octoDebug` 控制台命令(内网只有 console 时的主力)

内网抓不到 Network/SSE 时,**不必预先开日志重现**:出 bug 后直接在 DevTools Console 敲命令,即可回放最近发生的一切、dump 当前 session 原始数据。来源 [lib/debug-observer.ts](../packages/app/octoapp/pages/insight/lib/debug-observer.ts),进入 insight 页面即自动挂载(切走/重挂会清理重建)。

> **阶段1/2(SPEC-INS-011)**:三个环形缓冲并存 —— **event ring**(SSE 事件,500条)、**send ring**(发送记录,50条)、**log ring**(console.error/warn 镜像 + `[octo:*` 前缀 console.log 链路日志 + window.onerror/unhandledrejection,200条)。全字段缓冲，展示时才精简。**阶段2 起持久化到 IndexedDB**(per-origin,与工作目录无关),**跨 reload/重启读回**——snapshot 顶部会标注「含 N 条重启前」。无 IndexedDB 时自动降级为纯内存([IndexedDB / happy-dom 科普](learning/happy-dom-and-indexeddb.md))。

| 命令 | 作用 |
|---|---|
| `octoDebug.help()` | 列出所有命令 |
| `octoDebug.state()` | 当前 session 状态摘要:`status` / 用户·assistant 消息数 / 未决 permission·question 数 / 当前 mode |
| `octoDebug.dump()` | 当前 session **完整 message + part 原始 JSON**——出 bug 时让用户「复制这个发出来」,等价 `[octo:assistant] *-detail` 但随时可取 |
| `octoDebug.events(n=50)` | 最近 n 条 SSE 事件(**event ring**,默认存 500 条;持久化跨 reload/重启,可回放) |
| **`octoDebug.logs(n=50)`** | **最近 n 条 log ring**:console.error/warn 镜像 + `[octo:*` 前缀 console.log 链路日志(prompt/upload/task…) + window.onerror/unhandledrejection 未捕获异常 |
| `octoDebug.sends(n=10)` | 最近 n 次发送的完整入参 |
| `octoDebug.lastSend()` | 上一次发送:`messageID` / `model` / `cleanText` / `uploadBlock` / `endpoint` |
| `octoDebug.pending()` | 当前未回复的 permission / question——排查「卡住不动」(§2.2-D)直接看这个 |
| **`octoDebug.why()`** | **速诊**:对照 6 条规则自动分析当前现场,给「最可能方向 + 看哪条 + 下一步」(详见 §3.2) |
| **`octoDebug.snapshot(opts?)`** | **一键参数化现场快照**,输出紧凑文本并复制到剪贴板(详见 §3.3) |
| **`octoDebug.lastError(n=1)`** | **错误信标(事故黑匣子)**:带出最近 n 条**自动捕获**的 HTTP 失败(含响应体)/ 未捕获异常 / 整页崩,输出纯文本并复制到剪贴板(详见 §3.4) |
| `octoDebug.mode('quiet'\|'compact'\|'verbose')` | 切 `[octo:event]` 日志详尽度(默认 `compact`) |
| `octoDebug.verbose(true\|false)` | `verbose` 开关(等价 `mode`):`true` 逐条打 delta + 全部噪音事件,`false` 回 compact |

三种 mode 的区别:`quiet` = 一条日志不打、只进环形缓冲(console 最干净,靠命令拉);`compact`(默认)= 打 §1.0 表里"精简打✓"的类型、delta 聚合;`verbose` = 全量逐条(含 delta 与噪音事件)。**三个环形缓冲在三种 mode 下都常驻**,所以哪怕全程 `quiet`,出问题后依旧能回放。

### 3.1 怎么把"现场"递给排查方(含 AI)

排查方(外网同事 / AI 助手)**读不到你运行中 app 的 console**——它只活在你这台机器的 DevTools 里。所以必须由你把运行时状态"递"过去。三档,按省事程度:

1. **首选 `octoDebug.snapshot()`**:复现后敲一行,现场(why 初判 + 最近 SSE 事件 + 发送记录 + console 异常)打包成**紧凑文本**并自动复制到剪贴板 → 直接粘给对方。信息密度最高、噪音最少。
2. **针对性拉**:只想看某一块就 `octoDebug.dump()`(原始 message/part) / `octoDebug.events()`(SSE 回放) / `octoDebug.logs()`(console 异常) / `octoDebug.lastSend()`,复制结果粘过去。
3. **全量兜底**:怀疑问题在我们埋点之外时——**阶段3 已把 renderer console 全量落盘**到独立文件 **`insight-debug.log`**(5MB 滚动,**偶现/渲染崩溃前的也在**);打开该文件按时间 / messageID 搜。或 DevTools Console 右键 → **Save as…** 导出当前 console。最全但最杂。
   > 对象参数序列化:`console-message` 转发只拿得到格式化字符串,对象参数落盘本是 `[object Object]`(2026-07-16 内网排障两份日志因此全废)。现**生产构建**在渲染端入口统一把 console 对象参数 JSON 序列化(Error 展开 message+cause 链、循环引用/超长截断兜底,见 [console-serialize.ts](../packages/app/octoapp/pages/insight/lib/console-serialize.ts));dev 构建不装,DevTools 保留对象可展开。**读旧版本用户的日志仍会见到 `[object Object]`。**

**日志在哪**(electron-log 默认,`{appName}` = 运行时 `app.getName()`,dev = `Octo AI Dev`,详见 [App Name learning](learning/electron-app-name.md)):
- macOS:`~/Library/Logs/{appName}/insight-debug.log`
- Windows:`%USERPROFILE%\AppData\Roaming\{appName}\logs\insight-debug.log`
- Linux:`~/.config/{appName}/logs/insight-debug.log`

> 主进程自身日志在同目录 `main.log`(与 renderer 分开);两者互不污染。

> 提示:`octoDebug.snapshot()` 已覆盖 90% 的排查所需,优先用它;真按 §2 对照表走完仍定位不了,再上全量导出。

### 3.2 `octoDebug.why()` 规则表

自动对照以下 6 条规则扫描当前现场,给出「最可能方向 + 下一步」。规则保守可解释,只给方向不下死结论。

| # | 触发条件 | 输出方向 |
|---|---|---|
| 1 | 有 send 记录,且其后无实质 event(heartbeat 不计) | 有心跳→"无实质事件但 SSE 心跳仍在 → server 未启动该轮(非连接断)";无心跳→"无事件且无心跳 → 疑似 SSE 断 → 查 log 里 [global-sdk]" |
| 2 | `pending`(未 reply 的 permission/question) > 0 | ⚠️ 卡在等用户 → `octoDebug.pending()` |
| 3 | 最近 send.modelResolved === false | ⚠️ 发送时模型未解析 → §2.3 |
| 4 | session.status 持续 busy 超 60s 且无新 message.part | ⚠️ 疑似生成卡死 |
| 5 | 有 currentSessionID 但 `message[session]` 为空 | ⚠️ 疑似白屏/未加载 → §2.1 + `snapshot({full:true})` |
| 6 | log ring 中有 window.error / unhandledrejection | ⚠️ 存在未捕获异常 → `snapshot({profile:'errors'})` |

`snapshot()` 顶部**自动附 `why()` 结论摘要**,无需手动调用。

### 3.3 `octoDebug.snapshot(opts?)` 参数与 profile

缺省(不传参)= 时间窗取 **lastSend.ts → now**。输出为紧凑文本(非 JSON),每行带绝对时刻 + 相对 Δ,并附 `why()` 初判。

**参数**:

| 参数 | 含义 | 示例 |
|---|---|---|
| `last` | 最近一段时长 | `{last:'2m'}` |
| `since` / `until` | 时间窗边界(绝对 `"14:30"` 或相对) | `{since:'14:30'}` |
| `around` / `window` | 锚到某 messageID 前后 | `{around:'msg_x', window:'30s'}` |
| `profile` | 预设场景过滤(见下表) | `{profile:'no-feedback'}` |
| `types` | 按 event.type / 来源标签过滤 | `{types:['session.status']}` |
| `full` | 附当前 session message/part 全量 | `{full:true}` |
| `events` | event 导出条数上限 | `{events:80}` |

**profile 预设**(与 §2 症状表对齐):

| profile | 用于 | 选取内容 |
|---|---|---|
| `no-feedback` | §2.2 发消息无反应 | send(全部) + key events + log.error/window.error/rejected |
| `stuck` | §2.2-D 卡在等用户 | permission/question 相关 events |
| `errors` | 任意报错 | log(全部) + global.disposed/server.instance.disposed |
| `blank` | §2.1 白屏 | session.status/message.updated + log.window_error/rejected |
| `upload` | §2.4 上传失败 | 含 `[octo:upload]` 前缀的全部来源(console.log 链路 + console.error/warn) |

常用组合:`snapshot({profile:'no-feedback'})` / `snapshot({last:'2m', profile:'errors'})` / `snapshot({full:true})`。

### 3.4 `octoDebug.lastError(n=1)` —— 错误信标 / 事故黑匣子(阶段 4)

`snapshot` 是**人工**抓 SSE 上下文;`lastError` 是**自动**抓「真实高频 bug」——**HTTP 4xx/5xx(含响应体)、未捕获异常、整页崩**。三类信号在出错那一刻就被写进 `localStorage`(key `octo:insight:error-beacons`,环形最近 5 条;**同步写,抗刷新/抗关 app/抗整页崩**)。

- **取数**:`octoDebug.lastError()` 带最近 1 条、`lastError(5)` 带 5 条 → 纯文本 + 自动复制到剪贴板 → 直接粘给 Claude 定位。
- **整页崩时**:console 往往够不着(白屏),insight 自己的 `ErrorBoundary` fallback 会显示一个**「复制错误」按钮**(等价 `lastError()`),崩溃态也能一键带出。
- **每条带** `directory` + `sessionID`(出错时的上下文)。HTTP 条目含 `method`/`url`/`status`/响应体(截断 ~2KB);异常/整页崩条目含 `message`/`stack`。
- **与 snapshot 的分工**:日常出错**先看 `lastError()`**(精炼、不用懂);要更全的 SSE 上下文再 `snapshot()` 补。
- 来源 [lib/error-beacon.ts](../packages/app/octoapp/pages/insight/lib/error-beacon.ts)。

> 这是 SPEC-INS-011 §1.4 方向纠偏的产物:此前观测维度押在 SSE,但真实高频 bug 是「HTTP 失败 + 异常 + 整页崩」,完全在 SSE 维度之外。

---

## 4. Network 面板速查

提示词请求和 health 噪音混在一起、还看不到生成内容时:

| 你想找 | 实际是什么 | 怎么定位 |
|---|---|---|
| 你发出去的提示词 | `POST /session/:id/prompt_async`,**响应体≈空**(异步接口,内容在 SSE) | Fetch/XHR 过滤框输 `prompt_async`;提示词在该请求的 **Payload → parts**(回复**不在**这条) |
| 一堆 health 噪音 | server 健康轮询 + 心跳 | 过滤框输 `-health` 把它们藏掉 |
| LLM 的回复 / 状态流 | `GET /event`(一条长连 SSE) | 点那条永远 pending 的 `/event`,看 **EventStream / Response** |

**console ↔ Network 对齐的钥匙是 `messageID`**:它前端生成,**同时**出现在 `[octo:prompt] send` 和 `prompt_async` 的请求 Payload 里。从 console 抄 `messageID`(或 `octoDebug.lastSend().messageID`)→ 在 Network Payload 里搜,就能精确锁定是哪一条请求。`[octo:prompt] sent (async)` 里也直接打了 `method` + `endpoint`,照着筛即可。

---

## 附录:一次健康发送的完整日志序列

```
[octo:sync] session.sync           {sessionID}            ← (仅切会话/首次)
[octo:prompt] send                 {modelResolved:true, statusAtSend:"idle"}
[octo:prompt] send-full            {cleanText, uploadBlock}
[octo:prompt] optimistic added     {partsCount}           ← 用户气泡立即出现
[octo:prompt] sent (async)         {method, endpoint, statusAfterSend}  ← server 受理(① 发送结束)
[octo:event] session.status        {status:"busy"}        ← ② SSE 推回:这一轮启动了
[octo:sync] status                 {type:"busy"}          ← 派生:进入"正在生成"
[octo:event] message.updated       {role:"assistant"}     ← assistant 消息冒出来
[octo:event] message.part.delta ×聚合 [{partID,count,chars}]  ← 流式生成中(每秒聚合)
[octo:event] message.part.updated  {partType, tool}       ← part 落定
[octo:task] aggregate diff         {changes}              ← (若有长任务卡片)
[octo:event] session.status        {status:"idle"}        ← SSE 推回:这一轮结束
[octo:sync] status                 {type:"idle"}
[octo:assistant] turn-complete     {partsCount, toolNames}
[octo:assistant] text-part-detail  {text 全文}
[octo:assistant] tool-part-detail  {outputParsed}
[octo:prompt] feedback-ok          {status, assistantNow} ← 8s 看门狗确认有反馈
```

任一步缺失或顺序异常,回 §2 对照表定位;`[octo:event]` 段缺失=server 没动静(§2.2-C/D/E)。
