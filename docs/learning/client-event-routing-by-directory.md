# 客户端按目录分发事件:directory / worktree / project 三层模型 + child store 架构

> 这篇讲的是**前端(app/octoapp)如何把服务端推回的实时事件,按"目录"分发到正确的数据 store**,
> 以及由此引出的一个隐蔽 bug 类型:**「页面数据层目录」与「事件投递目录」错位 → 永久白屏**。
>
> 与 [opencode-db-and-storage.md](opencode-db-and-storage.md) 不重叠:那篇是**服务端 SQLite 怎么存**,
> 这篇是**客户端实时事件怎么按目录路由到内存 store**。两者一个落盘、一个内存,互补。
>
> 锚点案例:Octo Insight 在「非 home 目录」新建对话后发消息,聊天区白屏、刷新才出。我们花了很久
> 才定位到根因——本文把那次排查的结论沉淀成可复用的心智模型。

---

## 0. 一句话结论(先看这个)

**前端是"每个目录一个数据 store"。实时事件按 `event.directory` 这个 key 投递到对应 store。
页面要能看到实时更新,它的「数据层目录」必须和服务端给事件打的「`event.directory`」是同一个 key。
而服务端打的 `event.directory` 是会话的 **VCS worktree 根**,不是你传进去的子目录。**

错位的后果:事件被正确地 apply 进了 worktree 那个 store,但页面在读"子目录"那个空 store → 白屏。
而 HTTP 直读(`session.messages`)按 sessionID 找得到,所以**刷新就好**——这个"刷新能好"会强烈
误导你以为是"加载时序问题",其实是"实时事件路由错位"。

---

## 1. 前端数据层的形状:globalSync + per-directory child store

opencode 前端不是"一个全局大 store",而是 **`globalSync` 下挂一组 child store,每个目录一个**。

```
globalSync
 ├─ children[ directoryKey("/Users/x") ]        → store A(message/part/session_status/...)
 ├─ children[ directoryKey("/Users/x/proj-a") ] → store B
 └─ children[ directoryKey("/Users/x/proj-b") ] → store C
```

- `directoryKey` = `pathKey`(`packages/app/src/utils/path-key.ts`):把路径归一成 store 的 key。
  归一只做:Windows `\`→`/`、去尾斜杠、盘符补斜杠。**注意:不折叠大小写**(踩坑见 §6)。
- child store 由 `globalSync.child(directory)` 懒创建并注册进 `children`
  (`packages/app/src/context/global-sync/child-store.ts`)。默认 `bootstrap:true` 会触发
  `bootstrapInstance`(加载 sessions / providers / mcp / path)。

每个页面(chat / make / insight / studio)在自己子树顶层挂:

```tsx
<SDKProvider directory={() => 某目录}>   // 决定这棵子树的"数据层目录"
  <SyncProvider>                          // 内部: current = globalSync.child(sdk.directory)
    <PageContent/>                         // useSync().data 读的就是那个 child store
```

**关键认知:`SDKProvider` 传的目录,决定了这个页面"读哪个 child store"。**
`useSync().data.message[id]` 取的是 `globalSync.child(sdk.directory)` 那个 store 的数据。

---

## 2. 一条实时事件从服务端到某个 child store 的完整路径

```
①服务端某实例 Bus.publish(session.status / message.updated / message.part.delta ...)
   └→ bus/index.ts:101 转发到 GlobalBus,带 { directory: InstanceState.directory, ... }   ★
②客户端 /global/event 长连(一条 SSE)收到所有目录的事件
   (packages/app/octoapp/context/global-sdk.tsx:eventSdk.global.event)
③global-sdk 把事件 emit 到内部 emitter,key = event.directory
④global-sync 订阅 emitter(globalSDK.event.listen),按目录分发:        ★★
     const key = directoryKey(e.name)            // e.name = event.directory
     const existing = children.children[key]
     if (!existing) return                        // ← 没有对应 child store 就【静默丢弃】
     applyDirectoryEvent(... 写进 existing store)
⑤页面 memo 读 useSync().data(= 自己 SDKProvider 目录的 child store)派生渲染
```

两个 ★ 是命门:

- **★(服务端)`event.directory = InstanceState.directory`**。这是**会话被解析出的目录**,
  对一个传进去的子目录,服务端会**向上解析到 VCS worktree 根**,事件就打 worktree 根的目录。
  即:你 `session.create({ directory: "/Users/x/Downloads/agent-test" })`,但如果
  `/Users/x` 是个 git 仓库(或 worktree 探测回退到 home),事件的 `directory` 会是 `/Users/x`。
- **★★(客户端)分发按 `directoryKey(event.directory)` 严格命中 child store**,命中不了就 `return` 丢掉。
  注意"丢掉"≠"没收到":事件**到了**客户端(③),只是④没找到对应 store。

---

## 3. directory / worktree / project:三个别搞混的概念

| 概念 | 是什么 | 谁用它 |
|---|---|---|
| **directory** | 你传给 API 的目录(可以是任意子目录) | `session.create({ directory })`、SDKProvider |
| **worktree** | 服务端从 directory 向上解析出的 **VCS 根** | **`event.directory` 就是它**、会话的 `worktree` 字段 |
| **project** | 服务端按 worktree 归并出的项目(有 `project_id`) | `session.list` 按 **projectID** 列(`session.ts:553`) |

会话行同时存了 `directory`(你传的)和 `worktree`(解析的)两个字段(`session.ts:66-68`)。

推论(都很重要):
- **实时事件按 worktree 走**(★)。你的页面数据层目录若不是 worktree,就收不到。
- **会话列表按 project(=worktree)走**。所以 `session.list({directory: 子目录A})` 和
  `session.list({directory: 同仓另一子目录B})` 返回**同一批**会话(同 project)。
  "切目录列表变"只在**切到不同 git 仓**时才真正变;同仓不同子目录列表不变。
- **HTTP 直读 `session.messages({sessionID})` 按 ID 找**,跟目录形态无关 → 所以刷新总能出。

---

## 4. 为什么 chat / make 没事,insight 踩坑(锚点案例)

三个页面的"数据层目录"来源不同(`packages/app/octoapp/octo.tsx` 路由 + 各页 SDKProvider):

| 页面 | 路由 | 数据层目录(SDKProvider) | 与 worktree 对齐? |
|---|---|---|---|
| chat / studio | `/:dir/...` 经 `DirectoryLayout` | `octoSessionsDir(config)`(config 派生的**固定**目录) | ✅ 固定、启动即 bootstrap,事件能流 |
| make | `/make/:id` 独立 | `globalSync.data.path.home` | ✅ home 即 worktree |
| **insight(改坏时)** | `/insight/:id` 独立 | `useProjectDir()` = **`server.projects.last()`(用户选的任意子目录)** | ❌ 子目录 ≠ worktree |

insight 当时(commit `1ac439826` 引入)把数据层绑到了**用户选的子目录**(如
`/Users/x/Downloads/agent-test`)。但该会话的事件被服务端按 worktree 根 `/Users/x` 投递:

```
[octo:dispatch] { eventDirectory: '/Users/x', key: '/Users/x', hasChild: true, type: 'message.updated', sid: 'ses_...' }
   ^ 事件挂在 /Users/x 的 store(且那 store 存在、被正确写入)
insight 的 sdkDirectory = '/Users/x/Downloads/agent-test'  ← 页面读这个空 store
   → 永远读不到 → 白屏
```

而 chat/make 的数据层是固定目录 / home(本身就是 worktree),event.directory 和它一致 → 事件直接落进
页面读的那个 store → 实时出。**所以问题从来不是"目录是不是 home",而是"数据层目录和 event.directory 是否对齐"。**

### 修复

让 insight 数据层用 **home**(= worktree 根,事件落点),与 chat/make 一致:

```diff
- const projectDir = useProjectDir()        // server.projects.last() = 选中子目录
- <Show when={projectDir()} keyed> ... <SDKProvider directory={() => projectDir}>
+ const homeDir = () => globalSync.data.path.home
+ <Show when={homeDir()} keyed> ... <SDKProvider directory={() => homeDir}>
```

**"目录跟随"属于列表层职责,不属于数据/事件层。** 列表用 `session.list({directory: 选中目录})`
过滤(`session-list/index.tsx`),MCP 文件落项目用 `useProjectDir()`(`result-viewer`)——这两处
保留;只把**数据/事件层**从选中子目录改回 home。两层解耦,各司其职。

> 设计教训:**需求是"对话列表跟着目录走",不是"对话数据存进目录"。** 当初提示词写成了后者,
> 才把数据层也绑了选中目录。一个字之差,埋了这个白屏。

---

## 5. 排查方法论(这类"白屏/无反馈"通用)

按"层"逐步定位,每步用一条临时日志把不确定性消掉:

1. **发送链路在不在?** `[octo:prompt] send → optimistic → sent(async)`。有 `sent` = 服务端受理了。
2. **8s 看门狗**:`sent` 后 N 秒 session 仍没 busy、没新 assistant → 打 `no-feedback ⚠️`。
   这只说明"客户端没看到反馈",还分不清是服务端没跑还是事件没到。
3. **直读服务端**(决定性,绕过事件流/缓存):`no-feedback` 时
   `createClient({directory}).session.messages({sessionID})`。
   - 有 assistant 内容 → **轮次跑了,只是事件没到客户端**(客户端/路由问题)。← 本案就是这步定的性
   - 空 → 服务端没跑该轮(实例/模型问题)。
4. **看事件落哪个目录**:在 global-sync 分发点打 `{ eventDirectory, key, hasChild, childKeys, sid }`。
   - `eventDirectory` ≠ 页面 sdkDirectory、`hasChild:true`(挂在别的 store)→ **错位**,本案。

### ⚠️ 一个会浪费你半天的大坑:octoapp 有自己的 context

`packages/app/` 下有**两套** context:

- `packages/app/src/context/`(opencode 原版 web app 用)
- `packages/app/octoapp/context/`(**桌面端 octoapp 用**,有自己的 `global-sdk.tsx` / `global-sync.tsx`)

桌面端 insight 的 `import { useGlobalSDK } from "@/context/global-sdk"` 解析到的是 **octoapp 那份**。
**你改 `src/context/` 的同名文件,对桌面端是死代码,日志永远不出现。** 排查桌面端务必改
`packages/app/octoapp/context/`。本案一度因为改错文件,白白多跑了好几轮"日志怎么不出来"。

---

## 6. 顺带:pathKey 不折叠大小写(潜在坑,本案最终非此因)

`directoryKey`/`pathKey` 归一了分隔符和尾斜杠,但**没折叠大小写**。理论上 Windows(大小写不敏感)
若两条代码路径产出不同大小写的同一路径(`C:` vs `c:`),会算出两个 key、事件路由错位。

本案最终证伪了大小写假设(macOS 正斜杠也复现,根因是 worktree 错位)。但留意:**如果未来在 Windows
上遇到"同一目录两个 store"的现象,先查 pathKey 大小写**。修法是仅对 Windows 路径
`toLowerCase()`(POSIX 大小写敏感,不能折叠)。

---

## 7. 速查

- 事件分发点(命门):`packages/app/octoapp/context/global-sync.tsx`,`globalSDK.event.listen` 内
  `const existing = children.children[key]; if (!existing) return`。
- 服务端事件打目录:`packages/opencode/src/bus/index.ts:101`,`directory: InstanceState.directory`。
- 会话按 project 列:`packages/opencode/src/session/session.ts:553` `listByProjectWithCategory`。
- 页面数据层目录:各页 `SDKProvider directory`(chat=DirectoryLayout 的 octoSessionsDir、
  make/insight=home)。
- 黄金法则:**页面数据层目录 ≡ event.directory(worktree)**;目录跟随放列表层做过滤,别动数据层。
