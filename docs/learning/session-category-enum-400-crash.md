# learning/ — 一条 `category` 枚举值炸掉整个会话列表:从"点链接整页崩"到"必须删库"

> 真实事故复盘(2026-06-12,内网)。一个看似无关的改动——给子 agent 会话打个 `category="subagent"` 标签——
> 让 Insight 用户"跑完任务、问个文件、点一下链接"就**整页崩**,重启复现,最后只能删 `opencode-local.db` 才恢复。
> 根因是一个**严格枚举 Schema 的"半截改动"**,加上前端**一处缺失的兜底**。
>
> 这篇把整条链路拆开,因为它串起好几个值得记住的机制:effect HttpApi 的**整列响应编码**、
> `Schema.Union` 严格枚举的脆弱性、`fromRow` 的 TS cast 骗过编译期、空 body 400 的来源、
> server 日志到底写哪、以及"db 脏行"和"WAL 物理损坏"两种长得很像但完全不同的故障。

相关阅读:[opencode-db-and-storage.md](opencode-db-and-storage.md)(SQLite/WAL/Drizzle)、
[opencode-internals.md](opencode-internals.md)(HTTP 路由 / SSE)、
[client-event-routing-by-directory.md](client-event-routing-by-directory.md)(session 列表按目录拉 + 事件触发 refetch)、
[plugin-hooks-url-injection.md](plugin-hooks-url-injection.md)(`[octo:inject]` 日志)、
[electron-app-name.md](electron-app-name.md)(日志目录在哪)。

---

## 0. 症状(用户视角)

- 在某工作目录跑完一个 Insight 任务、出结果。
- 问"这个文件里还有什么信息" → agent 自动 web fetch 一个文件地址。
- **点一下那个蓝色链接 → 整个 Insight 页面变成"出了点问题 / 加载应用程序时发生错误"(ErrorBoundary 兜底页)。**
- **重启 app 还是这个页**;切到别的工作目录正常;**只有删掉 `opencode-local.db` 才恢复**。
- DevTools 里唯一的红色报错:
  ```
  Error: opencode server GET http://127.0.0.1:60460/session?directory=C%3A%5CUsers%5Ch00574684%5CDocuments%5CZoom
    → 400 Bad Request: (empty response body)
  ```

几个关键反直觉点,后面逐一解释:
1. 报错是 `GET /session`(拉**会话列表**),不是发消息,也不是 web fetch 本身。
2. "点链接"不是元凶,**它只是触发了一次列表 refetch**。
3. 直接 web fetch 同一个地址**不复现**——必须是"任务上下文"里那条路径。
4. 重启不好、删库才好 ⇒ 坏的是**磁盘上的数据**,不是内存状态。

---

## 1. 一句话根因

**`tool/task` 给子 agent 会话写了 `category="subagent"` 存进库,但 `Session.Info` 的响应 Schema 里 `category` 联合**没有** `"subagent"`。
`session.list` 把整列会话用 `Schema.Array(Session.Info)` 编码返回时,这一行编码失败 → 整个响应 400(空 body)。**一行脏数据炸掉整列。**

---

## 2. 链路逐段拆解

### 2.1 `/session` 列表是"整列一起编码"的

list 端点(effect HttpApi)声明 `success: Schema.Array(Session.Info)`,**没有声明任何 error**:

```ts
// packages/opencode/src/server/routes/instance/httpapi/groups/session.ts
HttpApiEndpoint.get("list", SessionPaths.list, {
  query: ListQuery,
  success: described(Schema.Array(Session.Info), "List of sessions"),
})
```

effect HttpApi 返回前会把响应**逐行用 `Session.Info` 编码**。**只要数组里有一行不满足 schema,整个响应就失败**——不是跳过那一行,是整列拿不到。这是"一行脏数据 = 整列瘫痪"的结构性原因。

### 2.2 `category` 是严格字面量联合

```ts
// packages/opencode/src/session/session.ts(Session.Info)
category: optionalOmitUndefined(Schema.Union([
  Schema.Literal("dev"), Schema.Literal("design"), Schema.Literal("prototype"),
  Schema.Literal("analysis"), Schema.Literal("creative"), Schema.Literal("planning"),
])),
```

只允许这 6 个值。`"subagent"` 不在其中 → 编码这一行时 `HttpApiSchemaError`。

### 2.3 `fromRow` 的 TS cast 骗过了编译期(为什么写得进、读才炸)

```ts
// packages/opencode/src/session/session.ts —— fromRow
category: category as Info["category"],   // ← 运行期不校验,纯 TS 断言
```

`category` 从 `SessionCategoryTable` join 出来是个普通字符串。`as Info["category"]` 是**编译期断言**,
运行期**不做任何校验**,于是 `"subagent"` 被原样塞进 `Info` 对象。**编译通过、写入通过,直到响应编码那一刻才暴露。**

### 2.4 引入 bug 的那次"半截改动"(`78a548296`)

提交 `feat: 子 session 分类改为 subagent` 改了 **3 处、漏了第 4 处**:

| | 文件 | 改了什么 |
|---|---|---|
| ✅ | `session-category.sql.ts` | `SessionCategory` 类型加 `\| "subagent"`(于是写入侧 TS 通过) |
| ✅ | `session-category.ts` | `AGENT_TO_CATEGORY` 加 `subagent` |
| ✅ | `tool/task.ts` | 子 session 建好后 `insertCategory(id, "subagent")` 真写进库 |
| ❌ **漏** | **`session.ts`** | **`Session.Info.category` 的 `Schema.Union` 没加 `Schema.Literal("subagent")`** |

**写入侧类型扩了、读取侧响应 schema 没扩** —— 这就是全部。`make` 等模块不走 `task` 这条写入路径,所以不中招;
只有 Insight 任务会 spawn 子 agent(`task` 工具),所以只有 Insight 用户撞上。

### 2.5 为什么 client 看到的是"400 empty body"

server 侧:`HttpApiSchemaError` 被 errorLayer 透传(它只兜"defect-only 的空 500",对已声明的 schema 错误放行),
最终成一个 **400、且 body 为空/`{}`** 的响应(见 `error.ts` 的注释:*Keep typed HttpApi failures on their declared error path*)。

client 侧:v2 SDK 的拦截器专门给"空/`{}` 错误体"拼了这句兜底文案:

```ts
// packages/sdk/js/src/v2/client.ts
return new Error(`opencode server ${method} ${url} → ${status}${statusText}: (empty response body)`)
```

所以"(empty response body)"几乎是"server 端 schema 校验/编码失败"的一个**指纹**——看到它优先怀疑 schema,而不是网络。

### 2.6 前端:一次列表失败,顶崩了整页

```ts
// packages/app/octoapp/pages/insight/components/session-list/index.tsx(修复前)
const [sessions, { refetch }] = createResource(projectDir, async (dir) => {
  const result = await globalSDK.client.session.list({ directory: dir })  // ← 抛 400,无 try/catch
  ...
})
```

`createResource` 的 fetcher 抛错 → resource 进 error 态 → 渲染读它时把错误**冒泡到最近的 ErrorBoundary** → 整页"出了点问题"。
**一个会话列表请求失败,本不该让整页崩。** 这是比 category 更根本的健壮性缺口(`_shell/sidebar.tsx` 同样没兜)。

### 2.7 触发时机:为什么"点链接"才崩、为什么直接 web fetch 不复现

session-list 监听 SSE 事件,`session.created/updated/deleted` 都会 `refetch()`:

```ts
if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
  refetchTimer = setTimeout(() => void refetch(), 1000)
}
```

链路:**任务 spawn 子 agent → 写入 `category="subagent"` 的子会话 → server 推 `session.created` → session-list `refetch()` → 重新 `session.list` → 撞上那行 → 400 → 整页崩。**
"点链接"只是恰好触发了一次 refetch;脏行是**任务阶段**就写进库的。直接 web fetch 一个普通 URL 不会产生带 `subagent` 分类的子会话,所以不复现。

---

## 3. 两个"长得像但完全不同"的故障,别混

排查中一度跑偏,记下来:

| | **db 脏行(本案根因)** | **`database disk image is malformed`** |
|---|---|---|
| 层次 | **应用层**:行数据合法 SQLite、但违反响应 schema | **物理层**:SQLite 文件/页损坏 |
| 触发 | 写了越界枚举值 | WAL 同伴文件不匹配 / 网络盘 / 进程中途被杀 |
| 本案里 | 真凶 | **是手动还原 db 时自己搞出来的副作用**(只拷了 `.db`、留了不匹配的 `-wal`/`-shm`) |
| 修法 | 改 schema / 容错 / 清坏行 | 删 `-wal`/`-shm` 或 `VACUUM INTO` 单文件再放 |

教训:`malformed` 是物理损坏的专有信号,**不要拿它去解释"点某操作稳定复现的崩溃"**——稳定复现 = 确定性代码 bug,不是文件碰巧坏。

---

## 4. 修复(两层)

1. **server 读取侧(根治,`900f347`)**:给 `Session.Info.category` 的 Union 补 `Schema.Literal("subagent")`。
   效果:`category="subagent"` 的行能正常编码返回 —— **已中招用户的旧库不用删就能加载恢复**。
   > 更根本的健壮性方向:让 `session.list` 对**单行编码失败容错跳过**,而不是整列 400。这样对任何未来的脏数据都免疫。
2. **前端兜底(UXAI PR #109)**:session-list 的 `createResource` fetcher 加 try/catch,失败时**保留上次列表 + `console.error`**,
   降级为"列表不刷新"而非"整页崩"。注意要显式标 `createResource<Session[], string>` 泛型,否则引用 `info.value` 会触发循环推断、typecheck 不过。

> **职责划分**:读取侧接纳/容错是公共后端(opencode),前端兜底是 Insight。`make` 已天然一致(strict agent 过滤,
> 子 agent 因 `agent` 字段≠父 agent 名被排除)——所以"把子 agent 对话塞进父列表"这种想法会重新引入风险,别做。

---

## 5. 排查方法论:这次踩的坑 → 下次怎么更快

### 5.1 真凶日志在哪(关键)

- **opencode server 的错误日志写在它自己的 log 目录,不在 Electron 的 `main.log`。**
  sidecar 起 server 时 `Log.init({ level: "INFO" })` **没传 `print`**,于是日志**写文件**:
  `Global.Path.log` = `<xdgData>/opencode/log/<时间戳>.log` —— **就在 `opencode-local.db` 同级的 `log/` 子目录**
  (Windows 通常 `…\AppData\Local\opencode\log\`)。出 400 时这里有 `log.error("failed", { error })` 的真实堆栈。
- `main.log`(`…\AppData\Roaming\<appName>\logs\main.log`)只转发 sidecar 的 stdout/stderr 摘要(`sidecar stdout/stderr`),
  以及 `[octo:inject]` 这类 server 端 `console.log`。**看不到上面那条 schema 错误。**
- renderer 全量在 `insight-debug.log`(见 [insight-debugging.md](../insight-debugging.md) §3.1),能看 SDK 抛的完整 error 和崩溃链,但**是 client 视角,看不到 server 为什么 400**。

### 5.2 指纹速记

- `→ 400 ... (empty response body)` ⇒ 优先怀疑 **server 端 schema 校验/编码失败**(不是网络)。
- "重启复现、删库才好" ⇒ 坏的是**磁盘上的数据行**,不是内存。
- "某操作稳定复现 + 多人同样路径" ⇒ **确定性 bug**,不是文件碰巧损坏。

---

## 6. 一句话教训

**一个枚举值在系统里有多处定义**——写入侧类型(`SessionCategory`)、SQL 列类型、**响应 Schema 的 `Union`**、以及由 schema 生成的 SDK 类型。
**改任一处,必须 grep 全所有定义点一起改**;漏掉响应 schema 这一处,编译期(靠 `as` cast)和写入期都安然无恙,直到运行期"整列响应编码"那一刻才爆——而且因为是**整列一起编码**,一行脏数据就能让整个列表 400、让前端(若无兜底)整页崩、让数据持久化后"重启也救不了、只能删库"。
**严格 `Schema.Union` + 整列响应编码 + 前端无兜底**,三者叠加,把一个标签字段的小疏漏放大成了删库级事故。
