# SPEC-INS-024 输入区草稿保留（per 会话分桶 · 跨模块通用）

- **状态**：v1 已实现（外网，UXAI 分支 `feat/composer-draft-per-session`；insight 已接入，make / pattern / studio 待接）
- **领域**：ui（跨模块基础设施，非 insight 专属）
- **上游已实现**：✓ —— chat 侧由 [`octoapp/context/prompt.tsx`](https://github.com/MyHeavenDyf/UXAI/blob/dev/packages/app/octoapp/context/prompt.tsx) 提供（per `(dir, sessionID)` 分桶 + LRU + 落盘）。本 spec 是**自实现 composer 的等价物**，不改上游那份。
- **关联**：[SPEC-INS-015 文件传参机制](../infra/insight-file-passing.md)（附件的 path / url / status 语义）、[SPEC-INS-007 §3.3.3 发送排队](insight-prompt-redesign.md)（同款「提到模块级」的先例）

---

## 背景 / 问题

insight 的输入区状态（正文 / 附件 / MCP chip）此前都是 `InsightPage` 的组件内 signal，于是用户在两种再普通不过的操作里丢内容：

1. **切会话** —— `/insight/:id?` 是单例路由，换 `id` 组件不卸载，但组件内 signal 是页面级的、跨不了 `id`。当时的处理是在切换 effect 里**主动清空**（注释写着「设计确认」）。清空在不分桶的前提下是必要的：不清就串台（在 A 写的内容跟着切到 B）。
2. **切顶层 tab**（Chat / Make / Studio）—— insight 页整个卸载，signal 一并销毁。

同样的问题在 make（只有正文的 localStorage 草稿，附件仍丢）、pattern、studio 上都存在。而 chat 不丢——因为它用的是上游那套路由之上的分桶 store。**缺的不是"少写了个保存"，是架构上少了一层。**

## 业界惯例

「输入框草稿按会话分桶、脱离视图层存活」是共识，分歧只在存内存还是存盘：

| 产品 | 行为 | 机制 |
|---|---|---|
| ChatGPT / Gemini | 切对话保留正文，刷新清空 | 内存态，per conversation |
| Claude web | 正文 + 附件保留，刷新后正文仍在 | per chat 草稿本地持久化 |
| Slack | per channel/thread 草稿含未发附件，重启还在、跨设备同步 | 草稿是**服务端实体**（`drafts.list`） |
| Linear / VS Code | 评论框 / SCM 提交框 per 实体草稿，重启还在 | 本地持久化 |
| opencode | 切会话、切页面都保留正文和附件 | `context/prompt.tsx`，per `(dir, sessionID)` + LRU 20 + `persisted()` |

**没有一家是「切走就清」的**，也没有一家是「全局单草稿」（会串台）。本 spec 取「分桶 + 持久化」。

---

## 决策

### D1 · 分桶键 = `<scope>/<sessionID>`，未建会话单独一桶

`scope` 是模块名（`insight` / 后续 `make` …），既是内存桶前缀也是落盘命名空间。尚未建会话（欢迎页）用 `__new__` 桶——它与任何真实会话都隔离，切进切出各归各的。

### D2 · 模块级单例 + 同步 localStorage，**不**做 Provider

上游 `context/prompt.tsx` 走 `utils/persist` 的 `persisted()`，那东西要 `usePlatform()`（`createSimpleContext`）与 SolidJS owner，因此必须 Provider 化；桌面端还是异步存储，要 `ready()` 门闸，否则首帧空、且可能覆盖用户已键入的字。

本模块改用同步 `localStorage`——与 make 的 prompt 草稿、两处 `chat-width` 同款做法（桌面端已验证），换来「import 即用、无 Provider、无异步门闸、无首帧闪烁」。代价是不与桌面 store 统一，可接受：只存元数据（文件名 / 本地路径 / S3 url），不存任何 blob，20 桶撑死几 KB。

> 曾评估「v1 先做内存、二期补落盘，API 预留 serialize/hydrate 口子」。否掉：难的从来不是序列化，是所有权模型与恢复时序，留个函数签名帮不上忙；既然最终要落盘，分两步做等于把每个接入页面重测两遍。

### D3 · 落盘编解码由**页面**提供，不由存储层猜

能不能跨重启是**语义**问题：只有页面知道哪些附件态活得过重启、缩略图怎么重建。存储层只负责调用与存取（`saveAttachment` / `loadAttachment` / `saveExtra` / `loadExtra`）。不提供编解码的 scope 就是纯内存草稿（切会话 / 切 tab 保留，刷新重置）——make / pattern 接入时可以先只要这一档。

### D4 · LRU 上限 20，**按 scope 独立计**

对齐上游 `MAX_PROMPT_SESSIONS`。按 scope 而非全局计：多模块共用同一个 store，全局计会让活跃模块把别的模块的草稿挤掉。淘汰时释放该桶附件的 objectURL 与原 File 引用，并删掉落盘记录。

---

## insight 的落盘编解码（D3 的具体实例）

| 字段 | 落盘 | 恢复 |
|---|---|---|
| 正文 | ✓ | 原样 |
| `status: "done"` 附件的 `id/filename/mime/size/path/url` | ✓ | 原样；`path` 与 `url` 都没有的丢弃（恢复了也参与不了发送） |
| `status: "uploading"` 附件 | ✗ | —— 进行中的上传物理上活不过 reload |
| `status: "error"` 附件 | ✗ | —— 重试依赖进程内的原 `File` 引用，进程一没就废；与其恢复出一个点了没反应的失败 chip，不如不落 |
| `previewUrl` | ✗ | **重建**：有本地 `path` 走 `local://`（与文件管理添加图片同源），纯 S3 图片直接用 S3 `url` |
| 原 `File` 引用 | ✗ | 丢失（仅影响失败重试，而失败态本就不落盘） |
| MCP chip | 只落 `presetId` | 查回 `PRESET_PROMPTS` 的规范对象，避免落盘副本与菜单定义漂移 |

过滤后什么都不剩（整桶只有上传中 / 失败的附件）时不写空记录。

**落盘态存活校验**：恢复出来的附件指向本地磁盘文件，用户可能在两次启动之间把文件删了。不在读盘时同步核（会为每个附件串一次 IPC、拖慢首屏），**进入某个会话后异步核一遍、静默剔除**，每桶只核一次（核过之后的增删都在本进程内，已由 `removeAttachmentsByPath` 兜住）。探测本身失败（IPC 异常）按存活处理——宁可留一条发送时才报错的附件，也不误删用户的东西。

---

## 三个必须处理的时序问题

改成「草稿保留」后暴露出来的，不是搬代码能绕开的。

### T1 · 异步上传回调的写回归属

导入 / 上传是异步的，回调此前写的是「当前组件 signal」。草稿一旦保留，在 A 传文件、传完前切到 B，回调按 id 在 B 的数组里匹配不到 → **A 那条附件永远停在 uploading**，还会因 `hasUploadingAttachments()` 把 A 的发送键锁死。

→ 发起时快照桶 key，回调走 `updateAttachments(owner, …)` 写回**发起时那个桶**。涉及 `doImport` / `doImageUpload` / `retryUpload` / `addAttachments` / `addInsightFileToSession`。

### T2 · 首次发送的整桶改名

欢迎页发第一条会 `createAndNavigate()` 现建会话、翻 `params.id`。待发送附件要留给本次发送消费，常驻的 MCP chip 也要跟进新会话（chip 不随发送复位）。

→ 在 `navigate()` **之前** `rename("insight/__new__" → "insight/<sid>")`，`params.id` 翻新时新桶已就位，输入区不闪空。为此给 `createAndNavigate` 加了 `beforeNavigate` 回调。原先用来防"切换 effect 抢清附件"的 `sendingNavigation` 补丁 flag 随之删除。

同理，`doSendPrompt` 消费哪个桶必须由调用方**显式钉死**（`draftOwner`），不能读当下的 `params.id`——发送过程中它正在翻新。

### T3 · 资源生命周期

objectURL 与原 `File` 引用不再随组件卸载消失，必须显式管。三处统一走 `dispose()`：删附件、发送消费、桶被 LRU 淘汰。另加一处：按路径批量摘附件（文件管理删文件）此前不释放，现补上。

---

## 实现

| 文件 | 角色 |
|---|---|
| `packages/app/octoapp/utils/composer-draft.ts` | 存储层：分桶 store + 落盘 + LRU + 资源释放 |
| `packages/app/octoapp/hooks/use-composer-draft.ts` | Solid 适配层：页面唯一入口 |
| `packages/app/octoapp/utils/composer-draft.test.ts` | 14 用例 |
| `packages/app/octoapp/pages/insight/index.tsx` | 接入 + insight 的落盘编解码 |

页面侧接入后，原有 `prompt()` / `setPrompt()` / `attachments()` / `setAttachments()` 调用点**一行未改**——hook 返回同签名的 accessor/setter：

```ts
const draft = useComposerDraft<Attachment, McpSelection | null>({
  scope: "insight",
  session: () => params.id,
  emptyExtra: null,          // extra 用来放 MCP chip
  persist: DRAFT_PERSIST,
})
const prompt = draft.text, setPrompt = draft.setText
const attachments = draft.attachments, setAttachments = draft.setAttachments
const mcpSelection = draft.extra, setMcpSelection = draft.setExtra
```

渲染层零改动。切会话 effect 只保留**视图**复位（ResultViewer tabs / 面板 / 任务快照），不再动用户输入。

### 单测口径

`bun test` 把 `solid-js` 解析到 `dist/server.js`（**无响应式**，memo 只算一次），所以断言一律打在存储层（`readDraft`）而不是 hook 的 memo 上——memo 只是 3 行透传，正确性归 Solid；要守的是分桶路由、落盘过滤、恢复、LRU 释放这些自己的逻辑。跑法：`bun test --preload ./happydom.ts ./octoapp`（注意 `test:unit` 只跑 `./src`，octoapp 下的单测不在默认脚本里，是既有缺口）。

---

## 打点

**不新增**。这是消除数据丢失的状态保留，不是新增用户行为；`message-send`（含 `attachmentCount`）/ `attachment-add` 等既有点位语义不变。若后续要量化「草稿被恢复」的频次再补。

---

## 待办 / 已知边界

- **图片 url 无 TTL（2026-07-27 已确认）** —— 与 [file-upload §合同修订提案 v2 第 3 条](../infra/file-upload.md) 的设计一致：下载地址是上传服务自有域名上的稳定资源路径 `GET /octoAiServer/files/<uuid>.<ext>`（查表 → 流式转发 S3），**不是预签名短时地址**。因此图片草稿跨重启恢复后，缩略图（直接用该 url 作 `<img src>`）与发送产出的 vision `FilePart{url}` 都仍然有效。若后续按该条备注改成「302 预签名 URL 卸载数据面」，本结论失效，届时需要给恢复出来的图片附件加过期兜底。
- 上传中 / 失败的附件不跨重启（见上表，物理约束）。
- **待接入**：make（顺带并掉它 text-only 的 localStorage 草稿）、pattern、studio。
- chat 不动（上游 `context/prompt.tsx` 已覆盖，且属上游核心）。
