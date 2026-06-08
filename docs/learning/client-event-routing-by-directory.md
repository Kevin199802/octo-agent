# 客户端按目录分发事件:directory / worktree / project 三层模型 + child store 架构

> 这篇讲的是**前端(app/octoapp)如何把服务端推回的实时事件,按"目录"分发到正确的数据 store**,
> 以及由此引出的一个隐蔽 bug 类型:**「页面数据层目录」与「事件投递目录」错位 → 永久白屏**。
>
> 与 [opencode-db-and-storage.md](opencode-db-and-storage.md) 不重叠:那篇是**服务端 SQLite 怎么存**,
> 这篇是**客户端实时事件怎么按目录路由到内存 store**。两者一个落盘、一个内存,互补。
>
> 锚点案例:Octo Insight 在「非 home 目录」新建对话后发消息,聊天区白屏、刷新才出。我们花了很久
> 才定位到根因。
>
> ⚠️ **订正记录(2026-06-08)**:本文初版把根因归为「`event.directory` = VCS worktree 根、数据层应
> 改用 home」——**该结论已证伪**。`event.directory` 其实 = 客户端请求**传入的 directory**(经
> `resolve` 归一),与 worktree 无关;真正的白屏根因是 insight **发送时错用了不带 directory 的
> `globalSDK.client`**。完整方案见 [SPEC-INS-012](../specs/ui/insight-directory-scoping.md)。本文已按
> 正确模型重写。

---

## 0. 一句话结论(先看这个)

**前端是"每个目录一个数据 store"。实时事件按 `event.directory` 这个 key 投递到对应 store。
页面要能看到实时更新,它的「数据层目录」必须和「触发这一轮的请求所用的 directory」一致——
因为服务端打的 `event.directory` 就等于那个请求的 directory(`resolve` 归一后),不是 worktree。**

错位的两种典型来源:
1. **数据层目录 ≠ 建会话/发送用的 directory**(例:数据层用 worktree 或 home,但发送用子目录)。
2. **发送走了不带 directory 的 client**(例:`globalSDK.client.session.promptAsync`),
   导致该轮跑在 `process.cwd()` 实例,事件 `event.directory = cwd` 落到 cwd 的 store。← 本案根因

后果:事件被正确地 apply 进了"另一个目录"的 store,但页面在读"自己目录"的空 store → 白屏。
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
  (`packages/app/octoapp/context/global-sync/child-store.ts`)。

每个页面(chat / make / insight / studio)在自己子树顶层挂:

```tsx
<SDKProvider directory={() => 某目录}>   // 决定这棵子树的"数据层目录",并向 sdk.client 注入 directory
  <SyncProvider>                          // 内部: current = globalSync.child(sdk.directory)
    <PageContent/>                         // useSync().data 读的就是那个 child store
```

**两个关键认知:**
- `SDKProvider` 传的目录,决定了这个页面"读哪个 child store"。`useSync().data.message[id]` 取的是
  `globalSync.child(sdk.directory)` 那个 store 的数据。
- `useSDK().client`(scoped)= `globalSDK.createClient({ directory: sdk.directory })`,**所有请求都带
  这个 directory**;而 `useGlobalSDK().client`(global)**不带 directory**(`context/global-sdk.tsx`)。
  这俩的区别正是本案命门(§4)。

---

## 2. 一条实时事件从服务端到某个 child store 的完整路径

```
①服务端某实例 Bus.publish(session.status / message.updated / message.part.delta ...)
   └→ bus/index.ts 转发到 GlobalBus,带 { directory: InstanceState.directory, ... }   ★
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

- **★(服务端)`event.directory = InstanceState.directory`**。这就是**处理该轮的实例目录**,
  而实例目录 = **客户端请求传入的 directory**(`resolve` 归一后)。链路:
  `httpapi/middleware/instance-context.ts`(`store.provide({ directory: route.directory })`)→
  `workspace-routing.ts`(取 `?directory` / `x-opencode-directory` header,**缺省 `process.cwd()`**)→
  `project/instance-store.ts` `boot`:`ctx.directory = input.directory`。
  ⚠️ 不是 worktree:`boot` 里 worktree 另存为 `ctx.worktree = result.sandbox`,但事件用的是 `ctx.directory`。
- **★★(客户端)分发按 `directoryKey(event.directory)` 严格命中 child store**,命中不了就 `return` 丢掉。
  注意"丢掉"≠"没收到":事件**到了**客户端(③),只是④没找到对应 store。

**推论(本案命门):** 如果某个请求**没传 directory**(用了 global client),服务端 `workspace-routing`
缺省到 `process.cwd()` → 该轮实例目录 = cwd → 它产出的所有事件 `event.directory = cwd`。
若页面数据层目录 ≠ cwd,这些事件全被丢弃 → 白屏。

---

## 3. directory / worktree / project:三个别搞混的概念

| 概念 | 是什么 | 谁用它 |
|---|---|---|
| **directory** | 你传给 API 的目录(`resolve` 归一);不传则服务端缺省 `cwd` | `session.create/promptAsync({directory})`、SDKProvider、**`event.directory` 就是它** |
| **worktree** | 服务端从 directory 向上解析出的 **VCS 根**(`boot` 的 `result.sandbox`) | 存进会话的 `worktree` 字段、会话 `path`(相对 worktree)的计算基准 |
| **project** | 服务端按 worktree 归并出的项目(有 `project_id`) | `session.list` 过滤的一部分 |

会话行同时存 `directory`(你传的)、`worktree`(解析的)、`path`(directory 相对 worktree 的相对路径)。

推论(都很重要):
- **实时事件按 directory 走**(★),不是 worktree。页面数据层目录若不是"建会话/发送用的 directory",就收不到。
- **`session.list` 默认(非 workspace)按 `project_id` + `directory` 精确过滤**(`session.ts` `listByProject`)。
  传 `path` 参数时改走 path 前缀过滤。insight/make 列表传的是 `directory`,所以**建会话用的 directory
  必须与列表查询的 directory 一致**,否则列表查不到(本案"记录落根目录"即此:建会话用 home、列表用所选目录)。
- **HTTP 直读 `session.messages({sessionID})` 按 ID 找**,跟目录形态无关 → 所以刷新总能出。

---

## 4. 为什么 chat / make 没事,insight 踩坑(锚点案例)

需求:insight 对话**跟随所选目录**(在所选目录建会话、该目录列表显示、不白屏)。

三个页面的目录处理对比:

| 页面 | 数据层目录(SDKProvider) | 发送用的 client | 结果 |
|---|---|---|---|
| chat / studio | `octoSessionsDir(config)`(固定) | scoped `sdk.client`(带 directory) | ✅ 三处一致 |
| make | `globalSync.data.path.home` | scoped `sdk.client`(带 directory) | ✅ 三处一致 |
| **insight(改坏时)** | 跟随所选目录 / 或 home | **`globalSDK.client`(不带 directory!)** | ❌ 发送轮跑 cwd,事件落 cwd store |

insight 的 `doSendPrompt` 当时用的是 `globalSDK.client.session.promptAsync({ sessionID })`——**没传
directory**。于是 LLM 这一轮跑在 `cwd`(= sidecar 启动目录 = home)实例,回复事件 `event.directory=home`,
落到 home 的 store;而页面数据层在读"所选目录"的 store → 永远读不到 → 白屏。

```
[octo:dispatch] { eventDirectory: '/Users/x'(=home=cwd), key: '/Users/x', type: 'message.part.delta', sid: 'ses_...' }
   ^ 事件挂在 home 的 store
insight sdkDirectory = '/Users/x/Downloads/agent-test'(所选目录)  ← 页面读这个空 store → 白屏
```

**为什么 `home` 一度"能用"**:当数据层也用 home 时,恰好 `home == cwd`,发送轮的事件正好落进页面读的
那个 store。纯属巧合,不是设计对。一旦数据层改成所选目录,这个巧合就破了 → 白屏。

**为什么 chat/make 没事**:它们发送走 scoped `sdk.client`(注入了各自的 directory),事件 `event.directory`
= 数据层目录 → 落进页面读的 store → 实时出。

### 修复(SPEC-INS-012)

让 insight **三处目录统一到所选目录**,且会话操作全部走 scoped `sdk.client`:

```diff
- const globalSDK = useGlobalSDK()
- await globalSDK.client.session.promptAsync({ sessionID, ... })   // ❌ 不带 directory → 跑 cwd
+ const sdk = useSDK()                                              // scoped,注入 sdk.directory
+ await sdk.client.session.promptAsync({ sessionID, ... })         // ✅ 带所选目录
```

- 数据层 keyed 在 `useProjectDir()`(所选目录);create/prompt/abort/get 全走 `sdk.client`;
  目录引用统一 `sdk.directory`。三处一致 → 不白屏、记录落所选目录、列表查得到。
- 切目录时 `navigate("/insight")` 回新建空态(用 `server.projects.last()` 做信号,跳过启动抖动)。

> 设计教训(订正版):**白屏不是"目录该不该用 home"的问题,而是"数据层目录、建会话/发送 directory、
> 列表 directory 三处是否一致"。** 最隐蔽的一处是发送 client——用 global(不带 directory)还是 scoped
> (带 directory),决定了事件落哪个 store。初版误判成 worktree,是因为只看了"事件落别处"的现象、
> 没核到"该轮实例目录从哪来"。

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
5. **核到"该轮实例目录从哪来"**(本案关键、初版漏的一步):看发送请求用的是
   `globalSDK.client`(不带 directory → cwd)还是 `sdk.client`(带 directory)。`eventDirectory == cwd`
   且发送走 global client → 就是它。

### ⚠️ 一个会浪费你半天的大坑:octoapp 有自己的 context

`packages/app/` 下有**两套** context:

- `packages/app/src/context/`(opencode 原版 web app 用)
- `packages/app/octoapp/context/`(**桌面端 octoapp 用**,有自己的 `global-sdk.tsx` / `global-sync.tsx`)

桌面端 insight 的 `import { useGlobalSDK } from "@/context/global-sdk"` 解析到的是 **octoapp 那份**。
**你改 `src/context/` 的同名文件,对桌面端是死代码,日志永远不出现。** 排查桌面端务必改
`packages/app/octoapp/context/`。

---

## 6. 顺带:pathKey 不折叠大小写(潜在坑,本案最终非此因)

`directoryKey`/`pathKey` 归一了分隔符和尾斜杠,但**没折叠大小写**。理论上 Windows(大小写不敏感)
若两条代码路径产出不同大小写的同一路径(`C:` vs `c:`),会算出两个 key、事件路由错位。

本案最终证伪了大小写假设(macOS 正斜杠也复现)。但留意:**如果未来在 Windows 上遇到"同一目录两个
store"的现象,先查 pathKey 大小写**。修法是仅对 Windows 路径 `toLowerCase()`(POSIX 大小写敏感,不能折叠)。

---

## 7. 速查

- 事件分发点(命门):`packages/app/octoapp/context/global-sync.tsx`,`globalSDK.event.listen` 内
  `const existing = children.children[key]; if (!existing) return`。
- 服务端事件打目录:`packages/opencode/src/bus/index.ts`,`directory: InstanceState.directory`(= `ctx.directory` = 请求传入的 directory,**非 worktree**)。
- 请求目录解析/缺省:`server/routes/instance/httpapi/middleware/workspace-routing.ts`(缺省 `process.cwd()`)。
- scoped vs global client:`context/sdk.tsx`(`useSDK` 注入 directory) vs `context/global-sdk.tsx`(`globalSDK.client` 不带)。
- 会话列表过滤:`packages/opencode/src/session/session.ts` `listByProject`(默认 `project_id` + `directory`)。
- **黄金法则**:**数据层目录 ≡ 建会话/发送的 directory ≡ 列表查询的 directory**;发送务必走 scoped
  `sdk.client`(带 directory),别用 `globalSDK.client`。目录跟随是"三处统一到所选目录",不是只改一处。
