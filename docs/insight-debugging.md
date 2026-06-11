# Insight — Console 日志 × Bug 排查对照手册

> 用途:内网出 bug 时,照着 console 日志前缀快速定位原因。
>
> 范围:`packages/app/src/pages/insight/` 全部 console 日志。这是**只读排查文档**,不改任何代码。
>
> 怎么用:复现一次问题 → 打开 DevTools Console → 按下面 §2 的「症状表」找到对应行 → 顺着「看哪几条日志」逐条核对 → 落到「可能原因 / 下一步」。
>
> 内外网隔空调试约定:`[octo:assistant] *-detail` / `[octo:prompt] send-full` 等日志会**完整 dump**(不截断),内网把这几条从 Console 复制粘到外网即可定位「LLM 究竟返回了什么」「究竟发了什么」。

---

## 0. 前缀总览

| 前缀 | 来源文件 | 关注什么 |
|---|---|---|
| `[octo:event]` | [lib/debug-observer.ts](../packages/app/src/pages/insight/lib/debug-observer.ts) | **SSE 服务器推回的事件流**——busy/idle、消息/part 落定、卡轮的 permission/question(发送链路的"另一半") |
| `[global-sdk]` | **opencode 原生**(context/global-sdk.tsx) | **SSE 连接层**自身报错(`event stream error`/`failed`)——判断"事件管道还活着没"的直接证据,非我们打的 |
| `[octo:sync]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) | 会话加载、busy↔idle 状态切换 |
| `[octo:prompt]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) | 发送链路全程:入参、optimistic、async 受理、无反馈探测 |
| `[octo:queue]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) | busy 期间排队 / flush / 取消 |
| `[octo:assistant]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) | 一轮结束后完整 dump assistant message 原始内容 |
| `[octo:task]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) · [utils/task-refresh.ts](../packages/app/src/pages/insight/utils/task-refresh.ts) | 长任务卡片:切会话清状态、刷新/终止/打开产物、聚合 diff |
| `[octo:upload]` | [lib/upload.ts](../packages/app/src/pages/insight/lib/upload.ts) · [index.tsx](../packages/app/src/pages/insight/index.tsx) | 附件上传 5 段链路 + 客户端校验 + 重试 |
| `[octo:preset]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) | 预置提示词点击 |
| `[octo:task-detect]` | [utils/task-detect.ts](../packages/app/src/pages/insight/utils/task-detect.ts) | 从 part 读 task_id |
| `[octo:detect]` / `[octo:card]` | [components/insight-turn.tsx](../packages/app/src/pages/insight/components/insight-turn.tsx) | text → 卡片检测、resource_link 卡片 |
| `[octo:resource-link]` / `[octo:resource]` | [utils/resource-link.ts](../packages/app/src/pages/insight/utils/resource-link.ts) | resource_link 识别 / fetch |
| `[octo:tab]` | [components/result-viewer/tab-store.ts](../packages/app/src/pages/insight/components/result-viewer/tab-store.ts) | 产物 tab 打开 / 去重 |
| `[octo:office]` | [components/result-viewer/index.tsx](../packages/app/src/pages/insight/components/result-viewer/index.tsx) | Office 文件下载 / 打开 / 另存 / 定位 |
| `[octo:mindmap]` | [components/result-viewer/mindmap-renderer.tsx](../packages/app/src/pages/insight/components/result-viewer/mindmap-renderer.tsx) | 脑图渲染 |
| `[insight:session-list]` | [components/session-list/index.tsx](../packages/app/src/pages/insight/components/session-list/index.tsx) | 会话重命名 / 删除失败 |
| `[InsightPage]` | [index.tsx](../packages/app/src/pages/insight/index.tsx) | 兜底 error(session.create / upload 失败) |
| `[dev:preview]` | [_dev/cards-preview.tsx](../packages/app/src/pages/insight/_dev/cards-preview.tsx) | **仅开发预览页**,mock 不连 SDK,排查线上问题时无视 |
| `[octo:inject]` | [packages/opencode/src/agent/octo-upload-inject.ts](../packages/opencode/src/agent/octo-upload-inject.ts) | **server 端插件**:MCP 工具执行前把 handle 换成精确 S3 URL([ADR-014](docs/adr/014-url-injection-via-plugin.md))。**注意:出在 opencode 服务进程 console,不在客户端 DevTools** |

> 约定:`⚠️` 出现在 `console.warn`,`✗`/红色出现在 `console.error`。正常链路只有 `console.log`。
>
> `[octo:inject]` 关键字段:`args rewritten` 的 `before`(模型填的,含 handle)/ `after`(注入后,应是精确 URL)/ `changed`(是否真替换了,false=模型填的 handle 都不在已知表里)/ `knownHandles`(整个 session 已解析到的文件数)。**无该日志** = 工具 args 里没有 handle 形态串(`hasHandle` 早退,非文件工具都这样,正常)。`args 含 handle 但 session 无上传区块` = 模型瞎编了 handle 或区块格式被破坏。

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

> 来源 [lib/debug-observer.ts](../packages/app/src/pages/insight/lib/debug-observer.ts):旁路订阅 `globalSDK.event.listen()`,把当前 session 的每个 SSE event 打成一行。**默认精简模式**只打下表"精简打✓"的类型;`message.part.delta` 高频,按 partID 聚合成 `message.part.delta ×聚合`。要看全部敲 `octoDebug.verbose(true)`(见 §3)。
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

- **正常**:发送后依次见 `session.status{busy}` → 若干 `message.updated`/`message.part.updated`/`delta 聚合` → `session.status{idle}`。
- **异常**:① 发送后**一条 `[octo:event]` 都没有** → SSE 没把事件推回(连接断 / server 没启动该轮);先翻有没有上游原生的 **`[global-sdk] event stream error/failed`**(红字)——有=连接管道断了,没有=管道活着但 server 没产出该轮;② 见到 `permission.asked ⚠️`/`question.asked ⚠️` 后**再无下文** → 卡在等用户,需在 UI 响应(用 `octoDebug.pending()` 看是什么);③ 见到 `global.disposed`/`server.instance.disposed` → server 掉了。

### 1.1 `[octo:sync]` — 会话加载与状态

#### `[octo:sync] session.sync`
- **时机**:切到某会话、或缓存被驱逐导致 `message[id]` 重新变 `undefined` 时,触发原生 sync 加载。([index.tsx:165](../packages/app/src/pages/insight/index.tsx#L165))
- **字段**:`sessionID` — 正在加载的会话 id。
- **正常**:切会话时**恰好打一条**,随后中间区渲染出历史消息。
- **异常**:
  - 切会话后**完全没有这条** → effect 没触发(`params.id` 没变或路由没进来);
  - **反复刷屏同一 id** → `message[id]` 一直是 `undefined`,sync 始终没把数据写回(server 没响应 / 连接断),配合「白屏」症状,见 §2.1。

#### `[octo:sync] status`
- **时机**:`sessionStatus` 变化(`idle`↔`busy`)时打,`defer:true` 不打初始值。([index.tsx:241](../packages/app/src/pages/insight/index.tsx#L241))
- **字段**:`sessionID`、`type`(`idle` / `busy`)。
- **正常**:发消息后短时内出现 `type:"busy"`,一轮结束出现 `type:"idle"`。
- **异常**:发消息后**迟迟不出现 `busy`** → server 没启动该轮(见 §2.2 no-feedback 探测器)。

### 1.2 `[octo:assistant]` — 一轮结束的完整 dump

> 这三条只在 **busy→idle 那一刻**打(`defer:true`,初始 idle 不打),把刚结束的最新 assistant message 原始内容全量 dump。内网抓不到 SSE network 时,靠这几条还原真相。

#### `[octo:assistant] turn-complete`
- **时机**:busy→idle 切换瞬间。([index.tsx:265](../packages/app/src/pages/insight/index.tsx#L265))
- **字段**:`sessionID`、`msgID`、`partsCount`、`textPartsCount`、`toolPartsCount`、`toolNames[]`。
- **正常**:`partsCount>0`,`toolNames` 含预期工具。
- **异常**:`partsCount:0` 或全 0 → LLM 这轮没产出任何 part(空回复 / 被中断)。

#### `[octo:assistant] text-part-detail`
- **时机**:turn-complete 之后,每个 text part 各打一条,**完整文本不截断**。([index.tsx:277](../packages/app/src/pages/insight/index.tsx#L277))
- **字段**:`msgID`、`partIdx`、`partID`、`textLen`、`text`(全文)。
- **用途**:卡片没出来 / 渲染怪 → 看 `text` 全文里 LLM 实际写了什么(html fence?表格?)。

#### `[octo:assistant] tool-part-detail`
- **时机**:turn-complete 之后,每个 tool part 各打一条。([index.tsx:296](../packages/app/src/pages/insight/index.tsx#L296))
- **字段**:`toolName`、`status`、`metadata`、`outputRaw`(原始字符串)、`outputParsed`(尝试 JSON.parse 后的对象,失败则同 raw)。
- **用途**:长任务卡片不对 / 产物缺失 → 看 `outputParsed` 里有没有 `task_id` / `resource_link` / `structuredContent`。

### 1.3 `[octo:prompt]` — 发送链路(排查核心)

一次正常发送,按顺序应出现:`send` → `send-full` → `optimistic added` → `sent (async)` →(8s 后)`feedback-ok`。

#### `[octo:prompt] send`
- **时机**:`doSendPrompt` 调用 `promptAsync` **之前**,组装好入参时。([index.tsx:558](../packages/app/src/pages/insight/index.tsx#L558))
- **关键字段**:
  - `source` — 触发来源:`user`(手动发送)/ `task-refresh` / `task-stop` /(队列 flush 也是 `user`)。
  - `model` — `{modelID, providerID}` 或 **`undefined`**。
  - `modelResolved` — `!!model`。**`false` = 前端没解析到模型**,会把 `model:undefined` 发给 server,由 server 按 agent 默认配置兜底;**若 agent 也无默认模型,这轮可能根本不启动**。
  - `statusAtSend` — 发送那一刻的 session 状态(正常 `idle`)。
  - `text`(截断 120 字预览)、`textLen`、`attachmentsCount`、`uploads[]`。
- **正常**:`modelResolved:true`、`statusAtSend:"idle"`。
- **异常**:`modelResolved:false` → 见 §2.2 / §2.3;`statusAtSend:"busy"` 而仍走到这里 → 理论不该发生(busy 应走队列),属逻辑异常。

#### `[octo:prompt] send-full`
- **时机**:紧跟 `send`,**完整不截断**。([index.tsx:572](../packages/app/src/pages/insight/index.tsx#L572))
- **字段**:`cleanText`(用户可见全文)、`uploadBlock`(synthetic 上传块,喂 LLM、气泡不显示)。
- **用途**:把怪 case 原样粘到外网复现;核对附件 URL 是否真拼进了 `uploadBlock`。

#### `[octo:prompt] optimistic added`
- **时机**:乐观消息写入 `sync.data` 之后。([index.tsx:584](../packages/app/src/pages/insight/index.tsx#L584))
- **字段**:`messageID`、`partsCount`(1=纯文本,2=带 synthetic 上传块)。
- **正常**:这条一出,用户气泡应**立即**出现在中间区。

#### `[octo:prompt] sent (async)`
- **时机**:`promptAsync` **resolve 之后**(server 已受理这轮请求)。([index.tsx:599](../packages/app/src/pages/insight/index.tsx#L599))
- **字段**:`messageID`、`sessionID`、`method:"POST"`、`endpoint`(`.../session/:id/prompt_async`,拿去 Network 面板筛)、`statusAfterSend`(受理后那一刻状态)、`response`(server 返回 data)。
- **正常**:能看到这条 = HTTP 请求成功返回;`statusAfterSend` 通常很快变 `busy`(也可能此刻还没翻,以 `[octo:sync] status` 为准)。
- **异常**:**没有这条**但有 `send` → `promptAsync` 抛错了,应同时出现 `[octo:prompt] failed`。

#### `[octo:prompt] failed`
- **时机**:`promptAsync` 抛异常(catch)。([index.tsx:608](../packages/app/src/pages/insight/index.tsx#L608))
- **字段**:`source`、`messageID`、`err`。同时会回滚 optimistic 消息 + 弹「发送失败」toast。
- **用途**:`err` 里看 HTTP 状态 / SDK 报文。

#### `[octo:prompt] no-feedback ⚠️`(无反馈探测器)
- **时机**:`sent (async)` 后启动 8s 看门狗(`NO_FEEDBACK_WATCHDOG_MS=8000`),到点时若 session **既没进 busy 也没新增 assistant 消息**,打这条 warn。([index.tsx:481](../packages/app/src/pages/insight/index.tsx#L481))
- **字段**:`sessionID`、`messageID`、`status`(8s 后的状态)、`messageCount`、`assistantBefore` / `assistantNow`(发送前后 assistant 消息数)、`hint`。
- **正常**:**不出现**,而是出现 `feedback-ok`。
- **异常(出现即说明发了消息但没动静)**:
  - `status` 仍是 `idle` 且 `assistantNow <= assistantBefore` → server 没启动该轮 → 查 SSE 事件流是否在收 / server 是否启动了该轮 / `modelResolved` 是否为 false 且 agent 无默认模型。是 §2.2 的主证据。

#### `[octo:prompt] feedback-ok`
- **时机**:8s 看门狗到点,判定为「有反馈」(已 busy 或已有新 assistant)。([index.tsx:494](../packages/app/src/pages/insight/index.tsx#L494))
- **字段**:`status`、`assistantBefore` / `assistantNow`。
- **正常**:发送链路健康的标志。

### 1.4 `[octo:queue]` — busy 期间排队

#### `[octo:queue] enqueued`
- **时机**:busy 时用户再次发送,文本入队(单容量,第二次覆盖)。([index.tsx:634](../packages/app/src/pages/insight/index.tsx#L634))
- **字段**:`sessionID`、`len`。
#### `[octo:queue] flushing`
- **时机**:busy→idle 时自动把队列里的文本发出。([index.tsx:656](../packages/app/src/pages/insight/index.tsx#L656))
- **字段**:`sessionID`、`len`。正常后面紧跟一组 `[octo:prompt] send`。
#### `[octo:queue] canceled, restored to input`
- **时机**:用户取消排队 / abort 前清队,文本回填输入框。([index.tsx:665](../packages/app/src/pages/insight/index.tsx#L665))

### 1.5 `[octo:task]` — 长任务卡片

#### `[octo:task] session switched, view state reset (refresh cooldown preserved)`
- **时机**:切会话时,重置 tabs / 自动开记录 / 队列 / 未发送附件;刷新冷却**不重置**(per task_id 延续倒计时,防切换绕过防抖)。([index.tsx:432](../packages/app/src/pages/insight/index.tsx#L432))
- **正常**:每次切会话一条。(旧文案 `refresh state cleared`,2026-06-11 起更名)
#### `[octo:task] aggregate diff`
- **时机**:`taskCards` 聚合结果变化时打快照 diff。([index.tsx:932](../packages/app/src/pages/insight/index.tsx#L932))
- **字段**:`total`、`changes[]`(`{taskId, from, to}`,`to` 形如 `status|message`,`"gone"` 表卡片消失)、`snapshot`。
- **用途**:卡片状态不更新 / 闪烁 → 看 changes 有没有按预期推进(pending→processing→completed)。
#### `[octo:task] markRefreshed`
- **时机**:点刷新成功,记冷却时间戳。([utils/task-refresh.ts:44](../packages/app/src/pages/insight/utils/task-refresh.ts#L44))字段 `cooldownMs`。
#### `[octo:task] refresh blocked: busy` / `refresh blocked: cooldown`
- **时机**:刷新被拦(正忙 / 冷却中)。([index.tsx:814](../packages/app/src/pages/insight/index.tsx#L814))→ 「刷新点了没反应」正常拦截,不是 bug。
#### `[octo:task] stop blocked: busy`
- **时机**:终止被拦(正忙)。([index.tsx:829](../packages/app/src/pages/insight/index.tsx#L829))
#### `[octo:task] openResult` / `auto-openResult (viewer empty)`
- **时机**:打开产物(手动 / 首个 completed 自动开)。([index.tsx:880](../packages/app/src/pages/insight/index.tsx#L880) / [index.tsx:902](../packages/app/src/pages/insight/index.tsx#L902))字段 `count`、`tabs[]`。
#### `[octo:task] openResult: card not found` / `no result yet` ⚠️
- **时机**:点「打开结果」但卡片不存在 / 还没产物。([index.tsx:872](../packages/app/src/pages/insight/index.tsx#L872))→ 产物按钮点了打不开时看这两条。

### 1.6 `[octo:upload]` — 附件上传

链路编号 `1/5 → 5/5`,正常一路 log,任一段失败转 warn/error 并 throw。`meta = {filename, size, mime}` 贯穿全程。

| 日志 | 级别 | 时机 / 含义 | 关键字段 |
|---|---|---|---|
| `[octo:upload] client-validate rejected` | warn | 选文件后客户端校验未过(空文件 / 超 100MB / 扩展名不在 txt,md,docx,xlsx,pdf)。**不存 File、不可重试,只能删除重选**。([index.tsx:721](../packages/app/src/pages/insight/index.tsx#L721)) | `code`、`message` |
| `[octo:upload] 1/5 start` | log | `uploadFile` 入口。([upload.ts:92](../packages/app/src/pages/insight/lib/upload.ts#L92)) | meta |
| `[octo:upload] validate failed (client-side)` | warn | `uploadFile` 内再校验未过。([upload.ts:96](../packages/app/src/pages/insight/lib/upload.ts#L96)) | `code` |
| `[octo:upload] endpoint not configured` | error | **`VITE_OCTO_UPLOAD_ENDPOINT` 没配**。`hint` 提示改 `packages/app/.env.local` 后重启 dev。([upload.ts:107](../packages/app/src/pages/insight/lib/upload.ts#L107)) | `hint` |
| `[octo:upload] 2/5 request` | log | 即将 POST。([upload.ts:113](../packages/app/src/pages/insight/lib/upload.ts#L113)) | `endpoint`、meta |
| `[octo:upload] network failed` | error | fetch 抛异常(连不上 / 跨域 / DNS)。([upload.ts:123](../packages/app/src/pages/insight/lib/upload.ts#L123)) | `error` |
| `[octo:upload] 3/5 response` | log | 收到响应,打 `httpStatus` / `httpOk` / `body`(非 JSON 时为 `{rawText:前500字}`)。([upload.ts:137](../packages/app/src/pages/insight/lib/upload.ts#L137)) | `httpStatus`、`httpOk`、`body` |
| `[octo:upload] http failed` | error | body 不符约定且 HTTP 非 2xx,按状态码兜底(413/415/429/5xx)。([upload.ts:148](../packages/app/src/pages/insight/lib/upload.ts#L148)) | `httpStatus`、`mappedCode` |
| `[octo:upload] bad response format` | error | HTTP 2xx 但 body 缺 `success`/`errorCode` 字段(不符内网封装约定)。([upload.ts:155](../packages/app/src/pages/insight/lib/upload.ts#L155)) | `body`、`rawText` |
| `[octo:upload] 4/5 business error` | error | `success:false`,按 `errorCode` 映射(305/413/415/429/5xx)。([upload.ts:161](../packages/app/src/pages/insight/lib/upload.ts#L161)) | `errorCode`、`errorMessage`、`mappedCode` |
| `[octo:upload] empty content` | error | `success:true` 但 `content` 为空。([upload.ts:171](../packages/app/src/pages/insight/lib/upload.ts#L171)) | `body` |
| `[octo:upload] 5/5 success` | log | 成功,拿到 `url` / `fileId`。([upload.ts:175](../packages/app/src/pages/insight/lib/upload.ts#L175)) | `url`、`fileId` |
| `[octo:upload] retry` | log | 点 chip 重试,重新 `doUpload`。([index.tsx:771](../packages/app/src/pages/insight/index.tsx#L771)) | `filename` |
| `[octo:upload] retry skipped: no original File` | warn | 客户端校验失败的 chip 没有原 File,无法重试(正常该按钮已隐藏,走到此为兜底)。([index.tsx:768](../packages/app/src/pages/insight/index.tsx#L768)) | `id` |
| `[InsightPage] upload failed` | error | `doUpload` catch 兜底(上面任一 throw 都会落到这,带最终 message,chip 标红可重试)。([index.tsx:750](../packages/app/src/pages/insight/index.tsx#L750)) | `filename`、`err` |

### 1.7 其他前缀(出场较少)

- `[octo:preset] click` — 点预置提示词,填入输入框。([index.tsx:685](../packages/app/src/pages/insight/index.tsx#L685))
- `[octo:task-detect] readTaskInfo` — 从某 part 读出 task 信息。([utils/task-detect.ts:73](../packages/app/src/pages/insight/utils/task-detect.ts#L73))
- `[octo:detect] start / reject / match / html-fence-found` — InsightTurn 从 text part 检测能否出卡片(`reject` 带 `reason`)。([components/insight-turn.tsx](../packages/app/src/pages/insight/components/insight-turn.tsx))
- `[octo:card] resource_links (no task)` — 有 resource_link 但无 task_id 时的卡片路径。([components/insight-turn.tsx:121](../packages/app/src/pages/insight/components/insight-turn.tsx#L121))
- `[octo:resource-link] found / none-found-but-candidates-present / missing-business-type` — resource_link 识别;后两条 warn 表示有候选但没匹配业务类型。([utils/resource-link.ts](../packages/app/src/pages/insight/utils/resource-link.ts))
- `[octo:resource] fetch start / ok / failed / error` — `source:"uri"` 卡片的内容拉取。([utils/resource-link.ts:180](../packages/app/src/pages/insight/utils/resource-link.ts#L180))
- `[octo:tab] openTab / dedupe-by-uri-and-type / dedupe-by-id` — 产物 tab 打开与去重。([components/result-viewer/tab-store.ts](../packages/app/src/pages/insight/components/result-viewer/tab-store.ts))
- `[octo:office] download-start/ok · open-path/failed · saveas-* · reveal-*` — Office 文件下载、`window.api.openPath` 唤起本地应用、另存、文件夹定位。([components/result-viewer/index.tsx](../packages/app/src/pages/insight/components/result-viewer/index.tsx))
- `[octo:mindmap] render failed` — 脑图渲染失败,带 `mdPreview` 前 200 字。([components/result-viewer/mindmap-renderer.tsx:36](../packages/app/src/pages/insight/components/result-viewer/mindmap-renderer.tsx#L36))
- `[insight:session-list] rename failed / delete failed` — 会话重命名 / 删除失败。([components/session-list/index.tsx](../packages/app/src/pages/insight/components/session-list/index.tsx))

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
| **判读** | 顶部标签文案 = `local.model.current()?.name ?? "选择模型"`([index.tsx:1106](../packages/app/src/pages/insight/index.tsx#L1106) / [index.tsx:1292](../packages/app/src/pages/insight/index.tsx#L1292))。显示「选择模型」= `local.model.current()` 返回 `undefined`。此时 `send` 里 `model:undefined`、`modelResolved:false`,但发送不被拦截,照样把 `model:undefined` 发给 server 兜底 |
| **可能原因** | `useLocal().model.current()` 的回退链(会话级 → agent 默认 → 全局兜底)全部落空:模型列表(ModelsProvider)还没加载好,或 agent/全局都没配默认模型。SPEC-INS-010 D2 已统一走 `useLocal().model`,设计目标是「初次进入不再显示未选却可发送」——若仍出现,是回退链没兜住 |
| **下一步** | 1) 确认 ModelsProvider 模型列表是否加载成功(无模型 → `current()` 永远 undefined);2) 检查 agent `octo_insight` 是否配了默认模型;3) 若 `modelResolved:false` 且发送后 `no-feedback ⚠️`,说明 server 端也无默认 → 这正是 §2.2-C,需补 agent 默认模型或让用户手动选 |

> 注意:「能发送」本身不是 bug(server 可按 agent 默认兜底);只有当 `modelResolved:false` **且** server 无默认导致 `no-feedback` 时才是问题。两者要连起来看。

### 2.4 附件上传失败

| | |
|---|---|
| **看哪几条** | 顺着 `[octo:upload]` 编号链路找**第一条 warn/error** |
| **定位表** | |
| `client-validate rejected` / `validate failed (client-side)` | 文件本身不合规(空 / >100MB / 扩展名不在 txt,md,docx,xlsx,pdf)。看 `code`。**前者不可重试**,需删除重选 |
| `endpoint not configured` | `VITE_OCTO_UPLOAD_ENDPOINT` 没配 → 改 `packages/app/.env.local` 后**重启 dev**(`hint` 里有原文) |
| `network failed` | fetch 抛错:连不上上传服务 / 跨域 / DNS。看 `error`,确认服务存活与地址可达 |
| `http failed` (`httpStatus`) | HTTP 非 2xx 且 body 不符约定:413 太大 / 415 格式 / 429 限流 / 5xx 服务端 |
| `bad response format` | HTTP 2xx 但响应缺 `success`/`errorCode` 字段 → 服务端没按内网封装协议返回。看 `rawText` |
| `4/5 business error` (`errorCode`) | 服务端 `success:false`:305 文件无效 / 413 / 415 / 429 / 5xx。看 `errorMessage` |
| `empty content` | `success:true` 但 `content` 为空 → 服务端逻辑问题 |
| **下一步** | 1) 先看 `3/5 response` 的 `httpStatus`/`body` 锁定是「没到服务」(network)还是「服务拒了」(business/http);2) `[InsightPage] upload failed` 是最终兜底,带用户看到的 message;3) 失败 chip 若可重试会有 `[octo:upload] retry`,客户端校验失败的不可重试 |

> 注:上传失败**不影响文字发送**——只有 `status:"done"` 的附件才会进 `uploadBlock`([index.tsx:507](../packages/app/src/pages/insight/index.tsx#L507));但 `hasUploadingAttachments()` 为真(还在传)时 `handleSubmit` 会拦发送,表现为「点发送没反应」,与 §2.2-A 区分。

---

## 3. `window.octoDebug` 控制台命令(内网只有 console 时的主力)

内网抓不到 Network/SSE 时,**不必预先开日志重现**:出 bug 后直接在 DevTools Console 敲命令,即可回放最近发生的一切、dump 当前 session 原始数据。来源 [lib/debug-observer.ts](../packages/app/src/pages/insight/lib/debug-observer.ts),进入 insight 页面即自动挂载(切走/重挂会清理重建)。

| 命令 | 作用 |
|---|---|
| `octoDebug.help()` | 列出所有命令 |
| `octoDebug.state()` | 当前 session 状态摘要:`status` / 用户·assistant 消息数 / 未决 permission·question 数 / 当前 mode |
| `octoDebug.dump()` | 当前 session **完整 message + part 原始 JSON**——出 bug 时让用户「复制这个发出来」,等价 `[octo:assistant] *-detail` 但随时可取 |
| `octoDebug.events(n=50)` | 最近 n 条 SSE 事件(**环形缓冲**,默认存 200 条;即便没开 verbose 也留着,可回放) |
| `octoDebug.sends(n=10)` | 最近 n 次发送的完整入参 |
| `octoDebug.lastSend()` | 上一次发送:`messageID` / `model` / `cleanText` / `uploadBlock` / `endpoint` |
| `octoDebug.pending()` | 当前未回复的 permission / question——排查「卡住不动」(§2.2-D)直接看这个 |
| **`octoDebug.snapshot()`** | **一键打包现场**(state + 事件环形缓冲 + 最近发送 + 当前 session 原始 message/part)为 JSON 并复制到剪贴板,直接粘给排查方/AI |
| `octoDebug.mode('quiet'\|'compact'\|'verbose')` | 切 `[octo:event]` 日志详尽度(默认 `compact`) |
| `octoDebug.verbose(true\|false)` | `verbose` 开关(等价 `mode`):`true` 逐条打 delta + 全部噪音事件,`false` 回 compact |

三种 mode 的区别:`quiet` = 一条日志不打、只进环形缓冲(console 最干净,靠命令拉);`compact`(默认)= 打 §1.0 表里"精简打✓"的类型、delta 聚合;`verbose` = 全量逐条(含 delta 与噪音事件)。**环形缓冲在三种 mode 下都常驻**,所以哪怕全程 `quiet`,出问题后 `octoDebug.events()` 依旧能回放。

### 3.1 怎么把"现场"递给排查方(含 AI)

排查方(外网同事 / AI 助手)**读不到你运行中 app 的 console**——它只活在你这台机器的 DevTools 里。所以必须由你把运行时状态"递"过去。三档,按省事程度:

1. **首选 `octoDebug.snapshot()`**:复现后敲一行,现场(状态 + 最近 SSE 事件 + 发送记录 + 当前会话原始数据)打包成 JSON 并自动复制到剪贴板 → 直接粘给对方。信息密度最高、噪音最少。
2. **针对性拉**:只想看某一块就 `octoDebug.dump()`(原始 message/part) / `octoDebug.events()`(SSE 回放) / `octoDebug.lastSend()`,复制结果粘过去。
3. **全量兜底**:怀疑问题在我们埋点之外时,DevTools Console 空白处右键 → **Save as…** 导出整个 console 为 `.log`(含上游所有日志)发出去。最全但最杂。

> 提示:`octoDebug.snapshot()` 已覆盖 90% 的排查所需,优先用它;真按 §2 对照表走完仍定位不了,再上全量导出。

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
