# 权限询问与「始终允许」:从触发到持久化的完整链路

面向想弄清 opencode 权限询问(`ctx.ask`)内部机制的读者。以 insight 里最常见的
**「读取工作区之外的本地文件」授权弹窗**(`external_directory`)为线索,讲完整条链路,
并回答两个反直觉的问题:

- 点「始终允许」到底是**只对当前会话**生效,还是所有会话?
- 这个授权**存在哪里**、重启后还在不在?

结论先放这里(细节见下文):

| 问题 | 答案 |
|---|---|
| 作用范围 | **整个项目(directory)下的所有会话**,不是单个会话 |
| 存储位置 | 设计上是 SQLite `permission` 表(`<Global.Path.data>/opencode.db`) |
| 是否持久 | ⚠️ **运行时并不写回该表,进程重启后失效** |

> 相关阅读:[tools-and-permissions.md](tools-and-permissions.md) 讲的是**静态配置**层面的
> allow / ask / deny 规则;本篇讲的是**运行时**询问与授权累积。两者在 `evaluate()` 处汇合。

---

## 一、触发:谁会发起权限询问

弹窗的源头是工具执行前的一次边界检查。以 `read` 为例
(`packages/opencode/src/tool/read.ts`):

```ts
yield* assertExternalDirectoryEffect(ctx, filepath, {
  bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
  kind: stat?.type === "Directory" ? "directory" : "file",
})

yield* ctx.ask({ permission: "read", patterns: [filepath], always: ["*"], metadata: {} })
```

共有 **7 个工具**会调 `assertExternalDirectoryEffect`:
`read` / `write` / `edit` / `apply_patch` / `glob` / `grep` / `lsp`。

`assertExternalDirectory`(`tool/external-directory.ts`)的逻辑:

```ts
if (!target) return
if (options?.bypass) return
if (containsPath(full, ins)) return          // 在工作区内 → 不询问

const dir = kind === "directory" ? full : path.dirname(full)
const glob = path.join(dir, "*")             // 注意:pattern 是「目录/*」,不是具体文件

yield* ctx.ask({
  permission: "external_directory",
  patterns: [glob],
  always: [glob],                            // ← 「始终允许」时写进 approved 的就是它
  metadata: { filepath: full, parentDir: dir },
})
```

**两个容易踩的点:**

1. **`patterns` 是目录 glob 而非具体文件。** UI 上直接展示 `patterns` 会看到
   `D:\某目录\*`,真正的文件路径在 `metadata.filepath`。做「点路径打开文件」这类交互时,
   要用 `metadata.filepath`,拿 pattern 去 `openPath` 会失败。
2. **`read` 工具会连续 ask 两次**:先 `external_directory`,再 `read`。后者默认配置是
   `"*": "allow"`,自动放行 —— 所以**外部文件真正弹出对话框的只有 `external_directory`**。

默认配置(`agent/agent.ts`):

```ts
external_directory: {
  "*": "ask",
  ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),   // tmp、skill 目录
}
```

---

## 二、阻塞:ask 如何挂起工具调用

核心在 `permission/index.ts` 的 `ask()`:

```ts
const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
  const { approved, pending } = yield* InstanceState.get(state)
  const { ruleset, ...request } = input
  let needsAsk = false

  for (const pattern of request.patterns) {
    const rule = evaluate(request.permission, pattern, ruleset, approved)   // ← approved 在此参与
    if (rule.action === "deny") return yield* new DeniedError({ ... })
    if (rule.action === "allow") continue
    needsAsk = true
  }
  if (!needsAsk) return

  const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
  pending.set(id, { info, deferred })
  yield* bus.publish(Event.Asked, info)          // 前端据此渲染弹窗
  return yield* Effect.ensuring(
    Deferred.await(deferred),                    // ← 在这里阻塞,直到有人应答
    Effect.sync(() => { pending.delete(id) }),
  )
})
```

要点:

- `evaluate(permission, pattern, ruleset, approved)` 同时吃**静态配置 ruleset** 与
  **运行时累积的 approved**,任一命中 allow 即放行。
- `Deferred.await` **阻塞的是整个工具调用**。这正是「贴了个外部路径,界面永远停在正在探索」
  的成因 —— 前端若没有权限 UI,服务端就一直挂着。
- 前端拿到 `permission.asked` 事件后写入 `sync.data.permission`(按 sessionID 分桶),
  再由权限 UI 取出渲染。

---

## 三、应答:once / always / reject 的差别

```ts
const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
  const { approved, pending } = yield* InstanceState.get(state)
  const existing = pending.get(input.requestID)
  if (!existing) return
  pending.delete(input.requestID)
  yield* bus.publish(Event.Replied, { ... })

  if (input.reply === "reject") {
    yield* Deferred.fail(existing.deferred, ...)
    // 连带 reject 同 session 的全部 pending
    for (const [id, item] of pending.entries()) {
      if (item.info.sessionID !== existing.info.sessionID) continue
      ...
    }
    return
  }

  yield* Deferred.succeed(existing.deferred, undefined)
  if (input.reply === "once") return                       // ← once 到此为止

  for (const pattern of existing.info.always) {            // ← always 才写 approved
    approved.push({ permission: existing.info.permission, pattern, action: "allow" })
  }

  for (const [id, item] of pending.entries()) {            // 顺带解开已满足的 pending
    if (item.info.sessionID !== existing.info.sessionID) continue
    ...
  }
})
```

| 应答 | 行为 |
|---|---|
| `once` | 仅解开本次阻塞,**不写 approved**,同目录下次再问 |
| `always` | 解开本次 + 把 `always` 里的 glob 写进 `approved` |
| `reject` | 本次失败,并**连带拒绝同会话**其余待答请求 |

---

## 四、⚠️ 坑一:「始终允许」的作用域是**项目**,不是会话

看到 `reply()` 里那句 `if (item.info.sessionID !== existing.info.sessionID) continue`,
很容易误以为「始终允许」只在当前会话生效。**这是误读。**

那个 sessionID 判断只作用于**「顺带把已挂起的其它请求也解开」这一步**,
属于即时解阻塞的优化,与授权规则的作用域无关。

真正决定作用域的是 `approved` 存在哪一层:

```ts
const state = yield* InstanceState.make<State>(
  Effect.fn("Permission.state")(function* (ctx) {
    const row = Database.use((db) =>
      db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
    )
    return { pending: new Map(), approved: row?.data ?? [] }
  }),
)
```

`InstanceState.make` 内部是一个按 **directory** 作 key 的 `ScopedCache`
(`effect/instance-state.ts`),`approved` 因此是**每个项目一份、全体会话共享**的数组。
`ask()` 评估时直接取这份 `approved`,**不带任何 sessionID 过滤**。

所以准确表述是:

> **即时解阻塞 = 同会话;授权规则 = 整个项目(directory)下的所有会话。**

数据库表的主键也印证了这一点 —— 是 `project_id` 而非 `session_id`。

---

## 五、⚠️ 坑二:表建好了,但运行时从不写入 —— 重启即失效

表结构(`session/session.sql.ts`):

```ts
export const PermissionTable = sqliteTable("permission", {
  project_id: text().primaryKey().references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<Permission.Ruleset>(),
})
```

DB 文件位置(`storage/db.ts`):`<Global.Path.data>/opencode.db`
(多实例场景为 `opencode-<safe>.db`)。

看起来是一套完整的持久化设计。**但全仓检索 `PermissionTable` 的写入路径,只有一处:**

```
packages/opencode/src/storage/json-migration.ts:371
  stats.permissions += insert(permValues, PermissionTable, "permission")
```

那是**旧版 JSON 存储迁移到 SQLite 的一次性脚本**。

而 `permission/index.ts` 里对该表**只有一次 select**(启动时载入),`reply()` 中
`approved.push(...)` **只改内存数组,没有任何 write-back**。

于是实际行为是:

```
进程启动 → select 一次(内容只可能来自那次历史迁移)
   ↓
点「始终允许」→ approved.push(...)   ← 仅内存
   ↓
进程退出 → 内存丢弃,DB 无变化
   ↓
下次启动 → 又从 DB 载入旧内容 → 之前授权过的目录重新弹窗
```

**「始终允许」的实际有效期 = 当前 opencode 实例的生命周期。**

### 这是 bug 还是设计?—— 是上游 opencode 有意保留的未启用代码,不是疏漏

用 git 历史查证过,结论明确:**这是上游 opencode 的行为,不是本仓改动;而且写回是
被刻意注释掉的,不是忘写。**

三条证据:

1. **全是上游作者。** `packages/opencode/src/permission/` 目录 65 次提交,作者全部是
   opencode 核心(Kit Langton 30 次、Dax Raad 14 次…),**团队成员零改动**。相关提交都
   带上游 PR 号(#22915、#18483、#10597 等)。

2. **写回代码存在,但被注释掉。** 引入 SQLite 的那次提交(`6d95f0d14` "sqlite again")
   diff 里能看到,写回逻辑在**旧的 JSON 存储时代就已经是注释状态**,迁移到 SQLite 时
   上游作者把这行注释**一起翻译成了 Drizzle 写法,依旧保留为注释**:

   ```diff
   -    // await Storage.write(["permission", Instance.project.id], s.approved)
   +    // db().insert(PermissionTable).values({ projectID: ..., data: s.approved })
   +    //   .onConflictDoUpdate({ target: PermissionTable.projectID, set: { data: s.approved } }).run()
   ```

   有人特地把一行注释掉的代码从 JSON 写法翻译成 SQLite 写法**还保留注释** —— 这是
   有意识地把持久化搁置,不是遗漏。

3. 所以之前「表建好了却不写、像遗漏」的猜测被推翻:表、schema、迁移逻辑一应俱全,
   写回代码也在,只是**被上游主动停用**。

**仍然未知的是「上游为何停用」** —— 注释里没写原因,commit message 也只有 "sqlite again"。
合理推测是安全取舍(永久放行外部目录有代价,每次重启重新确认更保守),但这是推测,无直接依据。

**对我们的行动含义:** 不要「顺手补上写回」。这不是修一个 bug,而是**推翻上游一个有意的
默认**,会让外部目录授权永久化,安全影响需单独评估、并最好对齐上游意图后再动。

---

## 六、附:客户端还有一个独立的 auto-accept

容易和「始终允许」混淆的是前端的 `autoAccept`(桌面端自动接受),
在 `packages/app/octoapp/context/permission-auto-respond.ts`:

```ts
export function autoRespondsPermission(autoAccept, session, permission, directory?) {
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}
```

这是**纯前端**机制:命中则前端自动应答、并把该请求过滤掉不渲染弹窗。
它与服务端的 `approved` 是两套东西:

| | 服务端 `approved` | 前端 `autoAccept` |
|---|---|---|
| 触发方式 | 用户点「始终允许」 | 会话/目录级别的自动接受开关 |
| 作用位置 | `ask()` 评估阶段,压根不发事件 | 事件已发出,前端自行应答并隐藏 |
| 作用域 | 项目(directory) | 按 sessionID / 父链 / `directory/*` |

排查「弹窗没出现」时,这两条路径都要看。

---

## 七、排查清单:为什么弹窗没出现

按顺序逐条排除:

1. **路径其实在工作区内** —— `containsPath` 命中 `ctx.directory` 或 `ctx.worktree`。
   注意工作区若设为盘符根目录(如 `C:\`),该盘下所有文件都算「内部」。
2. **命中白名单目录** —— 系统 tmp、skill 目录默认 `allow`。
3. **本进程内已点过「始终允许」** —— 已进 `approved`(重启后会复现询问)。
4. **走了 bypass** —— 如上传注入链路设了 `bypassCwdCheck`。
5. **前端 auto-accept 开着** —— 服务端发了事件,前端自动应答掉了。

日志锚点:服务端 `permission` service 会打 `evaluated` / `asking`;
insight 前端打 `[octo:permission] pending` / `respond`。

---

## 关键文件索引

| 文件 | 作用 |
|---|---|
| `opencode/src/tool/external-directory.ts` | 边界检查,发起 `external_directory` 询问 |
| `opencode/src/project/instance-context.ts` | `containsPath` 工作区边界判定 |
| `opencode/src/permission/index.ts` | `ask` / `reply` / `evaluate`,approved 累积 |
| `opencode/src/permission/evaluate.ts` | 规则匹配 |
| `opencode/src/session/session.sql.ts` | `PermissionTable` 表定义 |
| `opencode/src/storage/json-migration.ts` | **唯一**写入该表的地方(一次性迁移) |
| `opencode/src/effect/instance-state.ts` | `InstanceState` 按 directory 缓存 |
| `app/octoapp/context/permission-auto-respond.ts` | 前端 auto-accept |
