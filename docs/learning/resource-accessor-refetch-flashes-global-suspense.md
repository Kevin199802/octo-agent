# learning/ — 在 render 里读 resource accessor → refetch 闪全局 Suspense(整页"初始加载动画")

> 真实排查复盘(2026-06-27,UXAI Insight)。用户反馈:**每次发送消息、每次生成完回答,整个页面"闪一下、像把会话重置了一样,连应用的初始加载动画都出来了"**,有时还伴随滚动条乱跳(回顶部 / 被强行拽到底)。
>
> 我前后试错了好几个方向——`<For>` 按对象 key 重建、`createMemo` 缺 `equals`、`autoScroll` 的 `working` 配置、`<Show keyed>` 的 `projectDir` 抖动、session 缓存驱逐——**全是错的**。最后靠诊断日志一锤定音:**没有任何重挂、`message[id]` 从不变空**,真凶是一个**会话列表 `createResource` 在 render 里被读 → 事件触发 refetch → 把全局 `<Suspense>` 重新打回 fallback**,而那个 fallback 正是全屏的 `<Splash animate-pulse>`(应用启动时的"初始加载动画")。
>
> 这篇记下:Solid 的 "refetch 会重新挂起 Suspense" 这个反直觉机制、为什么子树不卸载却整页闪、怎么用日志在 3 个假设里快速排除、以及修法。

相关阅读:[session-category-enum-400-crash.md](session-category-enum-400-crash.md)(**同一个** session-list `createResource` 的另一种故障模式:fetcher 抛错冒泡 ErrorBoundary)、[client-event-routing-by-directory.md](client-event-routing-by-directory.md)(session 列表按目录拉 + SSE 事件触发 refetch)、[opencode-ui-composition.md](opencode-ui-composition.md)(Provider / Suspense 体系)。

---

## 0. 症状(用户视角)

- 在一个**已有对话**里发一条消息 → 画面"闪一下"。
- 等回答**生成完** → 又"闪一下"。
- 那个"闪"**不是局部**:用户描述成"感觉像整个会话被重置了,连应用刚打开时的加载动画都出来了"。
- 副作用:滚动条乱跳——有时回到最顶,有时被强行拽到底。

几个关键反直觉点(后面逐一解释):
1. 它**不是滚动 bug**。滚动乱跳只是"整页闪"的副作用。
2. 它**不是重挂**。组件、Provider、effect 全程没卸载没重建。
3. 它**不是数据丢失**。`message[id]` 全程有值,聊天内容一直在。
4. 触发点是 **`session.updated` 事件**——发送和生成完都会发它。

---

## 1. 一句话根因

**会话列表用 `createResource` 拉取;它的 accessor `sessions()` 被在 render(`hasMore`)里读。每次 `session.updated` 事件防抖 1s 后 `refetch()`,`createResource` 进入 refetching 态——而 Solid 里"在 Suspense 追踪范围内读一个正在 loading 的 resource accessor"会把 Suspense 打回 fallback。该组件没有就近 Suspense 边界,于是冒泡到最外层那个 `<Suspense fallback={<Splash animate-pulse>}>`,整页闪一帧"初始加载动画"。**

---

## 2. 链路逐段拆解

### 2.1 最外层有一个全屏 Suspense,fallback 是 `<Splash>`

```tsx
// packages/app/octoapp/octo.tsx(以及 app.tsx 同款)
<Suspense fallback={
  <div class="h-dvh w-screen flex ... justify-center bg-background-base">
    <Splash class="w-16 h-20 opacity-50 animate-pulse" />
  </div>
}>
  {props.children}   {/* ← 整个 app 都在它下面 */}
</Suspense>
```

`<Splash>` 那张 logo + `animate-pulse` 就是用户说的"应用初始加载动画"。**任何后代触发 Suspense、且自己没有更近的边界,都会闪这张全屏图。**

### 2.2 会话列表:`createResource` + SSE 事件 refetch

```ts
// packages/app/octoapp/pages/insight/components/session-list/index.tsx
const [sessions, { refetch }] = createResource(
  () => ({ dir: projectDir(), limit: limit() }),
  async ({ dir, limit }) => { /* GET /insight/sessions → { items, total } */ },
)

// 关键:render 里读了 accessor
const hasMore = () => sessionList.length < (sessions()?.total ?? 0)   // ← sessions() 在 render 被读

// SSE:发送 / 生成完都会发 session.updated
globalSDK.event.listen((e) => {
  const t = e.details.type
  if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
    clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => void refetch(), 1000)   // ← 防抖 1s 后 refetch
  }
})
```

> `session.updated` 在**很多**时机发:会话 `time.updated` 变、标题生成、状态 busy↔idle 切换……发送一条消息、生成完一次回答,都至少各发一次。所以"发送闪一下、生成完闪一下"对得上;流式中连续发的 `updated` 被 1s 防抖压成"停下来后 refetch 一次"。

### 2.3 反直觉核心:Solid 的 "refetch 重新挂起 Suspense"

Solid 的 `createResource`:
- 初次加载:状态 `pending`,读 accessor → 挂起 Suspense(显示 fallback)。这一步大家都知道。
- **refetch(已有值):状态进入 `refreshing`。读 accessor 仍返回上一帧的旧值,但同时会把"我在 loading"上报给最近的 Suspense → Suspense 再次显示 fallback。** ← 这一步反直觉,是本案根因。

也就是说:**只要 render 里读了 `sessions()`,每次 refetch 都会闪一次 Suspense fallback**,除非你用 `startTransition` / `useTransition` 把这次更新标成 transition(transition 期间保留旧 UI、不显示 fallback)。

而 `.loading` / `.error` 这种**属性读不会挂起 Suspense**(它们只是普通信号)。本组件别处用 `sessions.loading` 控制本地"加载更多"按钮是安全的——**唯一闯祸的是 `hasMore` 里那一处 `sessions()`**。

### 2.4 为什么"整页闪却不卸载"——日志怎么证的

Solid 的 Suspense 显示 fallback 时,**不卸载子树**,只是把它移到 offscreen / 隐藏;effect 继续跑、`onCleanup` 不触发、信号值不变。所以诊断日志呈现出"什么都没变,但用户看到全屏闪":

```
[octo:diag] InsightContent MOUNT {...}      // 只打印一次
// 之后发送 + 生成完整个过程:
//   ✗ 没有 CLEANUP(没卸载)
//   ✗ 没有第二次 MOUNT(没重挂)
[octo:diag] projectDir "C:\Users\86153"     // 全程不变(否定 <Show keyed> 重挂假设)
[octo:diag] branch { msgUndef:false, msgLen:38→40, umLen:19→20, showConv:true, busy:false→true→false }
//   showConv 全程 true(否定"渲染分支抖动 / 闪欢迎页"假设)
//   msgUndef 全程 false(否定"message[id] 变 undefined / 转圈"假设)
//   唯一在变的只有 busy
```

**关键方法论**:当"整页像重置但代码上看不到任何重挂/数据变化"时,优先怀疑**祖先 Suspense 被某个 resource 重新挂起**——它正是"子树不卸载、却整屏换 fallback"的唯一机制。

---

## 3. 修复

**根治(零成本、最稳)**:render 里**绝不读 resource accessor**。把 `total` 在 effect 里镜像进一个普通信号,`hasMore` 改读信号:

```ts
const [sessionList, setSessionList] = createStore<Session[]>([])
const [sessionTotal, setSessionTotal] = createSignal(0)
createEffect(on(sessions, (data) => {       // effect 里读 sessions 不触发 Suspense
  if (data) {
    setSessionList(reconcile(data.items, { key: "id" }))
    setSessionTotal(data.total)
  }
}, { defer: true }))

const hasMore = () => sessionList.length < sessionTotal()   // 只读信号,不读 sessions()
```

效果:refetch 时**没有任何 render-tracked 的 accessor 读** → resource 再怎么 `refreshing` 都不会上报 Suspense → 全局 Splash 永不再闪。初次加载仍由本组件自己的 `sessions.loading`(本地 spinner)兜,不冒泡。

> 其它两种可行但更弱的修法,记着对比:
> - `startTransition(() => refetch())`:transition 期间保留旧 UI、压住 fallback。能治本案,但只要将来有人再在 render 里读 accessor 就会复发——**治标**。
> - 给该子树包一层就近 `<Suspense fallback={局部占位}>`:闪的是局部而非全屏,**仍然闪**,只是没那么吓人。
>
> 首选"render 不读 accessor",因为它从结构上消除了挂起源,对未来改动免疫。

**附带**:本案排查中曾把 `autoScroll` 从 `working:isBusy` 改成 `working:()=>true` 想治"滚动乱跳",属误诊——滚动乱跳是 Suspense 隐藏→恢复滚动容器的副作用,根因修掉后已回滚为 `working:isBusy`。**别把上层症状下沉到滚动层去补**。

---

## 4. 排查方法论:这次踩的坑 → 下次怎么更快

### 4.1 "整页像重置"的三种可能,按代价从低到高排除

| 假设 | 怎么证伪 | 本案结果 |
|---|---|---|
| **A. Provider/组件重挂** | 顶层组件加 `onMount`/`onCleanup` 日志,看发送/完成时是否成对打印 | ✗ MOUNT 只一次,无 CLEANUP |
| **B. `<Show keyed>` 的 key 抖动致整页重挂** | 把 key 表达式(本案 `projectDir()`)打进 effect 日志,看是否变值 | ✗ 全程同一值 |
| **C. 渲染分支抖动 / 数据瞬时丢失**(闪欢迎页或转圈) | 把分支条件 + 关键数据长度打日志(本案 `showConv` / `umLen` / `msgUndef`) | ✗ 全程稳定 |
| **D. 祖先 Suspense 被 resource 重新挂起** | A/B/C 全否定后,grep 整页范围内的 `createResource`/`useQuery`,找"在 render 里读 accessor 且会 refetch"的那个 | ✓ 真凶 |

**A/B/C 是"会变结构"的假设,有日志就能秒否。三个都否 → 几乎必是 D**(子树不卸载却整屏换画,只有 Suspense 这一个机制)。

### 4.2 指纹速记

- **"整页闪/像重置/出现启动加载动画,但代码无重挂、数据无变化"** ⇒ 优先查**祖先 Suspense 被某 resource refetch 重新挂起**。
- **闪的节奏 = 某 SSE 事件节奏**(本案 `session.updated`,且有 ~1s 防抖延迟)⇒ 顺藤摸到那个监听 + refetch。
- 看到 `<Splash animate-pulse>` / `OctoLogo.svg` 这类**全屏 logo**当 fallback ⇒ 它是**最外层 Suspense** 的兜底,任何深层 resource 挂起都会把它顶出来。

---

## 5. 一句话教训

**`createResource` 的 accessor(`sessions()`)一旦在 render 里被读,它就和"最近的 Suspense"绑定了**——之后每一次 `refetch()` 都会把那个 Suspense 打回 fallback,即使值没变、子树没卸载。当这个 resource 还**挂在 SSE 事件上自动 refetch**、而最近的 Suspense 又是**全屏启动占位**时,一次后台列表刷新就被放大成"整页闪一下初始加载动画"。
**根治不是去包 transition、也不是去 Suspense 边界打补丁,而是:render 里只读镜像信号 / `.loading` / `.error`,绝不读 resource accessor 本身。**
