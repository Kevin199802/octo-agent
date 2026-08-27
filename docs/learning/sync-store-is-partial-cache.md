# learning/ — 前端 `sync.data.session` 是"碰巧攒到的一部分",不是会话全集:拿它做判定会静默漂移

> 排查复盘(2026-08-27)。现象:insight 对话区里 `insight_reader` 子代理的 task 卡片,**偶尔**能点进去、
> 跳到子代理自己的对话页——而 SPEC-INS-021 §1 明确要求子会话不作为用户级对话暴露,拦截代码一直都在。
>
> 根因不在拦截逻辑写错,而在**它问错了人**:判定去查前端 `sync.data.session` 里这个会话的 `parentID`,
> 而那个 store 里**大部分时候根本没有子会话**——查不到 → `!!undefined?.parentID` = `false` → 判定
> 结论是"这是根会话",放行。
>
> 值得单独写一篇,是因为这个坑的形状很不友好:判定**不是稳定错的**(那样第一次自测就发现了),
> 是**当轮对、刷新后错**。而开发自测的习惯动作恰好覆盖的是对的那一半。

相关阅读:[client-event-routing-by-directory.md](client-event-routing-by-directory.md)(前端 store 按目录分片、
事件怎么进 store)、[resource-accessor-refetch-flashes-global-suspense.md](resource-accessor-refetch-flashes-global-suspense.md)
(同属"把前端数据层当成想当然的样子用")、[session-category-enum-400-crash.md](session-category-enum-400-crash.md)
(会话列表的**服务端**侧过滤)。
规格锚点:SPEC-INS-021 §1(子会话不作为用户级对话暴露)、SPEC-INS-032 §4(子代理独立 agent 名 → 侧栏天然不出现)、
UXAI PR #718(改法)。

---

## 0. 先分清两层"会话列表"

聊这件事最容易串的是:**服务端查询**和**前端 store**是两个不同的东西,不是一个东西的两个位置。

| | 是什么 | 决定了什么 |
|---|---|---|
| 服务端 `session-insight-query.ts` | 侧栏列表接口,按 `agent = octo_insight` 过滤 | **侧栏显示什么**(SPEC-INS-032 §4:子代理用独立 agent 名,子会话天然不出现) |
| 前端 `sync.data.session` | 一个 Solid store 数组,前端各处随手查 | **前端代码"以为"存在哪些会话** |

"侧栏里没有子会话"是第一层的事实,这个大家都清楚。坑在第二层:很自然会以为
`sync.data.session` 就是侧栏那份列表的镜像——**它不是**。它既不是"只有根会话",也不是"所有会话",
而是**随时间和用户操作漂移**的一个子集。

---

## 1. `sync.data.session` 里到底有什么

### 进入路径(三条)

1. **初次加载**:`loadSessions()` → `loadRootSessionsWithFallback()` 请求带 **`roots: true`**
   (`packages/app/octoapp/context/global-sync/session-load.ts:4`)。**只有根会话**,一条子会话都没有。
2. **当轮 SSE**:`session.created` / `session.updated` 事件进 `event-reducer.ts`,**子会话也走这条**
   (reducer 里那句 `if (!info.parentID) sessionTotal++` 就是在区分它俩)。所以子代理一跑起来,
   它的会话**会**出现在 store 里。
3. **按需补拉**:`warmSessions()`(`bootstrap.ts:160`)对**挂着 permission / question 的会话 id**
   逐个 `session.get` 塞进来;`sync.session.sync(id)` 在 store 里没有该 id 时也会 `session.get` 补一条
   (`context/sync.tsx:463-486`)——也就是说,**你成功跳进过一次子会话,它就进 store 了**。

### 淘汰路径(两条)

4. **`limit` 截断**:`trimSessions()` 的 base 是 `roots.slice(0, limit)`,而 child store 的
   `limit` 初值是 **5**(`child-store.ts:231`)。额外再收 `SESSION_RECENT_LIMIT`(50)条
   **4 小时内**(`SESSION_RECENT_WINDOW`)更新过的。→ **老的根会话也不在 store 里**。
5. **子会话跟着父走**:`trimSessions()` 里子会话的保留条件是「父在 keepRoots 里」或「挂着 permission」
   或「4 小时内更新过」,否则丢弃(`session-trim.ts:49-54`)。

**合起来**:store 里是"最近 5 个根会话 + 4 小时内活跃的根会话 + 本次运行期间碰巧路过的一些子会话"。
这个集合的边界,取决于**你这个页面开了多久、点过什么、刷没刷新过**。

---

## 2. 于是那个判定漏在哪

原来的拦截(UXAI `index.tsx`,已删):

```ts
function isChildSession(sessionID: string): boolean {
  const sessions = sync.data.session as Session[]
  const match = Binary.search(sessions, sessionID, (s) => s.id)
  const target = match.found ? sessions[match.index] : undefined
  return !!target?.parentID   // ← 查不到 = undefined = false = "这是根会话,放行"
}
```

两种运行时状态,同一段代码,结论相反:

| 场景 | store 里有没有这个子会话 | 判定 | 结果 |
|---|---|---|---|
| 刚跑完 task,当场点卡片 | **有**(路径 2 的 SSE 刚推过) | `true` | 拦住 ✅ |
| 刷新页面 / 重开 app 后回看历史 turn | **没有**(路径 1 只拉 root,SSE 是上辈子的事) | `false` | 放行 ❌ |

这就是"偶现"的全部内容——它一点都不随机,只是分界线不在代码里,在**你有没有刷新过**。

**为什么很难在自测时发现**:验一个"跑子代理"的功能,标准动作是发消息 → 等它跑完 → 点卡片看看。
这套动作**永远走在场景 A 上**。要撞见 B,得先跑完、再刷新、再翻回历史 turn 去点——没有理由这么做,
除非你已经知道有问题。

同一个 store 还有第二个隐藏前提:`Binary.search` 要求数组**按 id 字符串有序**。这个前提本身在这个仓
就出过事(见 `index.tsx` 里 `userMessages` 那段注释:历史会话的旧 id 格式排序不兼容,
新消息被插到数组开头)。也就是说,即便"会话在 store 里",二分也未必找得到。**一个判定叠了两层前提,
两层都不是它自己能保证的。**

---

## 3. 改法:别问运行时状态

修法不是"把查询修好"(比如查不到就 `session.get` 实拉),而是**取消这个判定**。

`DataProvider` 的 `onNavigateToSession` / `onSessionHref` 这两个回调,在上游只被
`message-part.tsx` 的 task 卡片消费,而 insight 里 task 的目标**必然**是子会话。所以 insight 干脆
**不传这两个 prop**:

```ts
const clickable = createMemo(() => !!(childSessionId() && (data.navigateToSession || href())))
```

两个 prop 缺席 → `clickable()` 恒 `false` → 卡片不渲染 ↗ 图标、不生成 `<a>`、`open()` 两条分支都进不去。
点击和 cmd/中键**一起断在渲染层**,不读任何运行时状态,也就没有"漂移"的余地。

顺带一个不那么显眼的收益:如果保留 `navigateToSession` 只是让它**空实现**,`clickable()` 仍是 `true`
——卡片照样显示可点箭头、hover 变手型,点下去没反应。**"给了入口再拦"和"不给入口"在体验上不是一回事。**

---

## 4. 一般化:前端 store 是缓存,不是数据库

判定分三类,前两类可以查 store,第三类不行:

| 用途 | 举例 | 能不能查前端 store |
|---|---|---|
| **渲染当前视图** | 侧栏列出会话、显示标题 | ✅ 本来就只画"手上有的" |
| **优化性判断** | 有缓存就跳过请求(`sync.tsx` 的 `hasSession`) | ✅ 猜错只是多发一个请求 |
| **权威判定** | 这个会话是不是子会话 / 归不归当前项目 / 有没有权限 | ❌ **查不到 ≠ 不成立** |

第三类的通用形状是:`const x = store.find(...)` 之后跟一个 `x?.foo` 或 `!!x`。
**`?.` 把"没查到"和"查到了但值是假"悄悄合并成同一个分支**,而这两件事的正确处理往往相反。

三条出路,按优先级:

1. **根本不问**(最优):把判定挪到不需要运行时状态的地方——渲染层不给入口、服务端不返回、类型上不可表达。
   代价最低且不会随时间漂移。
2. **实拉校验**:真需要知道就 `session.get` 问服务端。insight 的"刷新恢复上次会话"那条腿一直是这么做的
   (`index.tsx` 的 `bootSaved` 分支:`session.get` 拿 `parentID`),所以它**没有**跟着一起漏。
   代价是异步 + 网络失败要有兜底。
3. **服务端判定**:数据本身就别下发到不该有它的地方。

---

## 5. 怎么自查同类问题

在 `octoapp/` 里搜这些形状,逐个问一句"查不到的时候,这里的默认结论是什么,对不对":

- `sync.data.session` / `store.session` 后面跟 `.find(` / `Binary.search` / `?.`
- 任何 `!!xxx?.someField` 形式的**布尔判定**(尤其判定名字里带 `is` / `can` / `should`)
- 判定结果用于**放行/拦截**而不是**显示/隐藏**的地方

一个快速的判别问题:**"如果这个 store 是空的,这段代码会怎么走?"**
如果答案是"走宽松分支",而宽松分支的后果是用户能看到不该看到的东西,那它就是同一个坑。
