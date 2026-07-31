# SPEC-INS-027：会话排队 drain 运行器（UI 无关 · 跨模块通用）

> 状态：草案（待实现）· 优先级 P1 · 规模 [M] · 领域 ui（跨模块）· 类型：实现 spec + 接入指南
> 上游已实现：✗（opencode 无 UI 无关的后台 drain 运行器；followup 队列的 drain 触发器同样绑在 `session.tsx` 页面组件内，见 §1.3）
> 关联：
> - [SPEC-INS-007 §3.3.3 发送排队](insight-prompt-redesign.md)（FIFO 队列语义的事实层；本 spec 只改「drain 触发器归属」这一架构层，§3.3.3 已加修订备注正向链接过来）
> - [SPEC-INS-024 composer-draft](composer-draft.md)（**姊妹先例**：同为「页面态放组件 signal、切走即失效」的架构缺层，同样做成「per 会话分桶 + 脱离视图层存活 + insight 先接、其他模块复用」）
> - [SPEC-INS-023 §8 queue 兼容](insight-mention-at.md)（队列项携带 `skills`/`files`）

---

## 0. 一句话

把「busy→idle 后弹出下一条排队」的 **drain 触发器**从 insight 页面组件里拽出来，做成一个**挂在应用根（`GlobalSyncProvider` 内）、UI 无关、level-triggered、带 per-session in-flight 守卫**的常驻运行器；队列数据仍 per-session 分桶、每模块各持一份，天然隔离；insight 先接入，其他模块按 §5 接入指南复用同一 runner 内核。

---

## 1. 背景与根因

### 1.1 现象（用户复现）

insight 会话 busy、输入框上方有排队项时：

- **切到技能库（对话区嵌路由页 `/skills`）/ 切到相邻 agent tab（chat/design 等）→ 排队卡死**：会话在后台正常跑完转 idle，但排队不往前走。
- **切换会话列表里的对话 → 排队又继续往前走**。

用户对「切页面卡死、切对话却能救」这个差异觉得奇怪——这正是根因的指纹。

### 1.2 根因：队列数据是全局/长期的，drain 触发器却是页面组件级的

排队被拆成生命周期不一致的两半：

| 部分 | 现状位置 | 存活范围 |
|---|---|---|
| **队列数据** `Record<sid, QueuedSend[]>` | 模块级 signal（`packages/app/octoapp/pages/insight/utils/send-queue.ts`） | 长期，跨 tab / 跨会话常驻 |
| **drain 触发器**（两处 `createEffect`） | insight 页面组件内（`index.tsx`） | 只活在 insight 页面挂载期间 |

现网 `index.tsx` 有**两处** in-page drain 触发器：

```typescript
// A. busy → idle 那一刻自动 flush 队首（edge-triggered）
createEffect(on(isBusy, (busy, prev) => {
  if (!prev || busy) return
  flushQueueHead()
}, { defer: true }))

// B. 切回某 session 时补一次 flush（切会话时才触发）
createEffect(on(() => params.id, () => {
  flushQueueHead()
}, { defer: true }))
```

- **A 是 edge-triggered**：只在「亲眼看到 busy→idle 那一跳」时弹队列，且订阅者活在页面组件的 reactive root 里。
- **B 是开发者已经打的创可贴**：切 `params.id` 时补一次 flush——这就是「切对话能救」的原因。

`send-queue.ts` 顶部注释已经点出把**数据**提到模块级的理由（"insight 页在切走 tab 时会卸载，组件内 signal 会被销毁导致排队丢失"），但**触发器仍留在页面组件内**——数据搬了家，泵没搬。

### 1.3 三种切换为何表现不同

- **切 `/skills` / 切 agent tab**：是**路由切换**，insight 页面组件卸载 → SolidJS 销毁其 reactive root → 触发器 A、B 全部被 dispose。会话在后台照常从 SSE 收到 busy→idle，但**这一跳没有任何人在听**（A 没了），也没有 `params.id` 变化（B 不触发）。因为 A 是边沿触发，这个 idle 边沿一旦错过就永远错过 → 死等。（注意：`{defer:true}` 使 B 在重新回到 insight 重挂时也**不会**补触发——它只认「变化」，重挂初始那次被 defer 跳过。）
- **切对话列表**：是**同路由换 `params.id`**，insight 页面组件**不卸载**（正因常驻才需要那些 `on(() => params.id, …)` 的 reset/补偿 effect），触发器 B 因 `params.id` 变化而触发 → 补一次 flush → 队列继续。
- 上游 `session.tsx` 的 followup 队列 drain（`packages/app/octoapp/pages/session.tsx` 的自动 drain effect）是**裸 `createEffect` 读队首 + `busy` 对账**（level-triggered），也在页面组件内——所以它离开会话页也会停，但 level-triggered + `persisted` 存储让它回到页面时能对账补上，比 insight 的 edge-triggered 少踩一格。**同一类架构缺陷，只是严重度不同。**

**结论：drain 触发器不该活在任何页面组件里。** 它要驱动的状态（会话 busy→idle、队列本身）是全局且长期的，触发器就必须同层常驻。

---

## 2. 业界做法对比与选型

比较对象是 **agent 客户端**（用户明确要「业界 agent 最佳实践」），不是云服务队列：

| 方案 | 代表 | drain 触发器归属 | 后台推进（离开当前视图时） | 评价 |
|---|---|---|---|---|
| **① 页面组件内触发器**（现状） | ——（insight 现网 / 上游 followup 也基本是这形态） | 视图组件 | ✗ 组件卸载即停 | 就是本 bug 的来源 |
| **② 视图内 level-triggered + 回视图对账** | 上游 `session.tsx` followup | 视图组件（但 level-triggered） | ✗ 仍不后台推进，只回视图时对账 | 比 ① 少踩边沿坑，但仍受挂载约束；不可跨模块复用（只是一处 per-page effect） |
| **③ 会话控制器/数据层拥有 drain loop** ★采用 | Claude Code / ChatGPT / Slack 草稿队列 | 独立于视图的长期控制器，按会话生命周期事件驱动 | ✓ 你切到别处，排队照样往下发 | 队列 + 抽水泵都属数据层；视图只负责入队/展示/取消 |

**采用 ③。** 理由：

1. 用户诉求就是「对话完成了排队要往前走」，而且明确「全局接入」「符合业界 agent 最佳实践」——③ 是唯一真正做到**后台推进**的形态。
2. ② 只是把现网创可贴做得更稳，本质仍是 per-page effect，**不可抽取复用**；③ 的 runner 内核天然是跨模块可复用件（每模块给一个页面无关的 send 适配器即可）。
3. 与 [SPEC-INS-024](composer-draft.md) 的处置同构：那次把「输入草稿」从页面 signal 提到「per 会话分桶 + 脱离视图层」；这次把「drain 触发器」从页面 effect 提到「应用根常驻 + 脱离视图层」。同一味药。

> 「为什么上游没这么做（做成全局 runner）」的自我质疑：opencode 的 followup 深度耦合 `settings/persist/composer`（SPEC-INS-007 §2.3 已记录，insight 当初正因此拒绝整体复用），它把 drain 留在页面是历史包袱下的务实选择，不代表这是对的架构。我们自建的轻量队列没有那层包袱，正好一步到位。

---

## 3. 设计

### 3.1 隔离模型：每模块一 store 一 runner 实例（数据不共享，代码共享）

- **队列数据 per (module, sessionID) 分桶**：insight 的队列在 `insight/utils/send-queue.ts`，只可能装 insight 会话（只有 insight 会往里 enqueue）；其他模块若接，各自持有自己的 store。
- **一个 session 只归属一个 agent**（`session.agent`，见 console `agent:'octo_insight'` / 「会话 agent 归属字段化」spec），故按 sessionID 分桶 = 天然按 agent-per-session 隔离。**不存在跨模块共享桶**：切到 chat 显示 chat 的队列、切到 insight 显示 insight 的，绝不混用。
- **runner 内核是共享代码，实例与数据各自独立**：insight 起一个 runner 实例、只 drain insight 自己的 store；其他模块接时各起各的。runner **无需查 `session.agent`**——它只遍历「自己这份 store 里的 sid」，隔离免维护地成立。

> 「全局」二字只指 **drain 触发器的存活范围**（挂应用根、跨 tab 常驻、不随页面卸载而死），**不是把队列数据合并成一份**。

### 3.2 runner 内核契约

```typescript
// packages/app/octoapp/utils/session-queue-runner.ts（跨模块通用件，放 octoapp/utils，与 composer-draft 同级）
export interface QueueRunnerAdapter<Item> {
  /** reactive：返回当前所有非空队列桶 { sid: Item[] }（读时自动追踪变化） */
  buckets: () => Record<string, Item[]>
  /** reactive：某 session 是否忙（busy）。来源必须是全局 session_status，不是页面态 */
  isBusy: (sid: string) => boolean
  /** 弹掉某 session 的队首（runner 在确认可发送后调用；实现里做 setStore 去头） */
  shift: (sid: string) => Item | undefined
  /** 页面无关的发送：把一条队列项发给指定 session。必须自包含，不依赖任何已挂载页面 */
  send: (sid: string, item: Item) => Promise<void>
}

/** 在 Solid owner 下调用一次；返回 dispose。内部 createEffect + onCleanup */
export function createSessionQueueRunner<Item>(adapter: QueueRunnerAdapter<Item>): void
```

runner 主体（level-triggered + per-session in-flight 守卫）：

```typescript
export function createSessionQueueRunner<Item>(a: QueueRunnerAdapter<Item>) {
  const inflight = new Set<string>()  // 已 dispatch、等待 turn 真正开始的 sid
  createEffect(() => {
    const buckets = a.buckets()               // 追踪队列变化
    for (const sid of Object.keys(buckets)) {
      const q = buckets[sid]
      if (!q?.length) continue
      const busy = a.isBusy(sid)               // 追踪该 sid 的 busy 变化
      if (busy) { inflight.delete(sid); continue } // 已进入 turn → 清 in-flight，等下次 idle
      if (inflight.has(sid)) continue          // 已 dispatch、还没转 busy → 别重复发
      const item = a.shift(sid)
      if (!item) continue
      inflight.add(sid)
      void a.send(sid, item).catch((err) => {
        inflight.delete(sid)                   // 发送失败：释放守卫（下轮 idle 可重试/停在原地）
        console.warn("[octo:queue] drain send failed", { sid, err })
      })
    }
  })
}
```

要点：

- **level-triggered**：判据是「idle 且队列非空」这个**状态**，不是「我看到的那一跳」。错过边沿也能靠状态补回来——彻底根治 §1 的边沿丢失。
- **per-session in-flight 守卫**：`inflight` 防「发出后、session 还没来得及转 busy」的窗口里被同一 effect 重复触发；observed busy 时清守卫，保证**一条一回合**顺序（对齐现网 §3.3.3「链式触发」语义）。
- **无定时器、无轮询**：纯靠 `buckets()` 与 `isBusy()` 的响应式变化驱动。
- **发送失败**：释放守卫、保留剩余队列可见（与现网「no-feedback watchdog 同一风险类，不新增处理」一致）。

### 3.3 挂载点

在 `packages/app/octoapp/octo.tsx` 的 `GlobalSDKProvider > GlobalSyncProvider` 之内挂一个 headless 组件（如 `<InsightQueueRunner/>`，无 DOM 产出），它：

- 处于**跨所有 tab / 路由常驻**的层级（Router 在其内层，insight/chat/make/pattern/skills 页面切换都不会卸载它）；
- 能读全局 `session_status`（`useGlobalSync()`）与全局 SDK（`useGlobalSDK()`）；
- 在自身 Solid owner 下调用 `createSessionQueueRunner(insightAdapter)`。

### 3.4 页面无关的 send（insight adapter 的关键）

现网 `doSendPrompt` 深耦页面态（`attachments()`/`projectDir()`/optimistic 写入 insight-scoped `sync`/`local.model.current()`/`showToast`）。但**排队 flush 走的子集很窄**——队列项只带 `text` / `skills` / `files`（+ 本 spec 新增的 `chip`），**不带附件**（附件不入队）。故抽一个页面无关的发送：

```typescript
// insight/utils/send-queue.ts（或新 queue-drain.ts）
export async function sendQueuedItem(
  globalSDK, sessionId: string, item: QueuedSend,
): Promise<void>
```

它复用 doSendPrompt 里**本就是纯函数**的构块：`formatUploadsForPrompt`（files → `[附件/引用文件]` synthetic）、`buildChipTemplate`/`buildChipDeclaration`（chip → synthetic）、`getDesktopApi().getSkillContent`（skills → `<skill_content>` synthetic，desktop API 全局可用），组 parts 后用**目录级 scoped client**（从全局按会话 directory 建，见 §3.5 实现点）调 `client.session.prompt`（promptAsync）。

**取舍**：后台 drain（页面未挂载时）**跳过 optimistic 渲染**——optimistic 写的是 insight-scoped `sync`，页面没挂就没有；真实消息会经全局 SSE 落库，用户切回 insight 时正常显示（略滞后一帧，可接受）。页面挂载着时同样由 runner 发送，此时若要即时气泡可让 send 内部在 `sync` 存在时补 optimistic（可选优化，非必须）。

### 3.5 实现点（起草期标注，实现时坐实）

1. **队列项自包含**：`enqueue` 时把 chip 选择态一并存进 `QueuedSend`（现网 flush 时才 `mcpSelection()` 读**当前**输入框态，后台发送没有输入框；改为入队即固化）。`QueuedSend` 增 `chip?: { selection: McpSelection }`。
2. **会话 directory**：runner 的 `send` 需要 scoped client，按会话 directory 建。**directory 入队即固化进 `QueuedSend`**（页面此刻知道 `projectDir()`），`sendQueuedItem` 用它 `globalSDK.createClient({directory})`；缺则跳过该次 drain（保留队列可见）。runner 另用组件稳定 owner `pin` 有排队的目录，使其 `session_status` 经 SSE 常驻、不被 TTL 驱逐。
3. **model**：`local.model.current()` 的会话级选择也**入队即固化**进 `QueuedSend.model`，保住用户选的模型；缺则服务端按 agent 默认。
4. **移除 in-page 触发器**：删掉 `index.tsx` 两处 flush effect（§1.2 A、B），drain 归 runner 独占，避免双发（runner 的 in-flight 守卫 + 单一 owner 已足够）。页面保留 enqueue / cancel / removeQueued / 队列条 UI。
5. **abort/cancel 语义不变**：`clearSessionQueue(sid)` 清桶后 runner 因 `buckets` 变化自然不再 drain 该 sid。

### 3.7 排队项的附件快照（修内网回归：排队上传文件丢失）

**内网实测回归**：排队时「上传文件 + 写提示词」，前一 turn 完成后**只有提示词发出、文件没跟着发**；改前版本文件会随第一条排队消息发出。

**根因**：上传的**附件**（`attachments()`，页面组件的共享附件栏）**从来就不在队列模型里**。改前老代码 flush 走 `doSendPrompt(consumeAttachments: true)`，在 flush 那一刻**读实时附件栏**把文件顺手挂上——文件不是「跟着队列项」走的，是「从共享栏抓的」。这本身是**错的语义**：多条排队时所有文件都绑到第一条、绑错；只是单条时碰巧对。改后 drain 走**页面无关**的 `sendQueuedItem`（页面可能已卸载，读不到附件栏），我们又漏了把附件快照进队列项 → 文件丢失。

**业界做法**：一条消息 = 文本 + **它自己的附件** + 元数据的原子单位；排队即入队整体，附件在**撰写/入队那一刻绑定到那条消息**（快照），只跟这条走、不外溢（ChatGPT / Claude / Slack 草稿 / opencode followup 一致）。**没有「共享附件托盘、下一次发送谁先谁抓」的模型。**

**改法**（对齐业界，且顺带修好老版本多条排队绑错）：附件在**入队时快照进 `QueuedSend`**，`sendQueuedItem` 从快照重建附件 parts；入队后清空共享附件栏。

- `QueuedSend` 增 `uploads?: {filename,path}[]`（非图片，已 done、已搬进会话 `uploads/` 的最终 path）与 `images?: {filename,url,mime?}[]`（图片 S3 url）。附件入队时必为 `done`（`handleSubmit` 有 `hasUploadingAttachments()` 拦截，上传中不让入队），故快照稳定。
- 入队时 `snapshotAttachmentsForQueue`：done 分流（非图片 / 图片）+ 把还在 `.octo/tmps` 的 pending 上传 **rename 进会话 `uploads/`**（sid 入队已知）；随后**清空附件栏**（`revokeAllPreviews` + `filesById.clear` + `setAttachments([])`，与正常发送 consume 同款）+ 有本地附件则 `filesRefreshKey++`（文件管理刷新）。**镜像 `doSendPrompt` 的附件解析但自包含，不碰 `doSendPrompt`。**
- **组 parts 走公共骨架**（防两套漂移）：新增 `insight/utils/build-prompt-parts.ts` 的 `assembleInsightParts`（集中「cleanText → synthetic 文本 → txt/md FilePart → 图片 FilePart」的顺序 + FilePart 映射）。`doSendPrompt`（正常发送）与 `sendQueuedItem`（排队）**共用**它——`doSendPrompt` 只把最后组 parts 那几段换成调用它，**附件解析 / 搬迁 / skill 读取 / optimistic / 日志全部不动**（行为等价，用组装器单测锁死）。
- **取消排队** `removeQueued`：把快照附件**还原回附件栏**（栏为空才还原，不覆盖用户正在选的），使取消编辑后可原样重发；文件本就在会话目录、不会丢，还原只是补回可见 chip。

> **对正常发送零影响**：本节只把「组 parts」这一段抽成公共件共用，`doSendPrompt` 的附件解析 / 上传 / optimistic 核心逻辑一行未动;组装器有单测、`doSendPrompt` 改动经 typecheck + 静态逐项等价核对。

---

## 4. insight 接入改动面（实际落地）

- 新增 `packages/app/octoapp/utils/session-queue-runner.ts`：跨模块 runner 内核（§3.2）+ `runDrainPass` 纯函数（便于单测）。
- 新增 `packages/app/octoapp/utils/session-queue-runner.test.ts`：runner 单测 6 例。
- 新增 `packages/app/octoapp/pages/insight/queue-runner.tsx`：headless `<InsightQueueRunner/>`，装配 insight adapter。
- 新增 `packages/app/octoapp/pages/insight/utils/queue-drain.ts`：页面无关 `sendQueuedItem` + `snapshotAttachmentsForQueue`（§3.7）。
- 新增 `packages/app/octoapp/pages/insight/utils/build-prompt-parts.ts` + `.test.ts`：`assembleInsightParts` 组 parts 公共骨架（正常发送 + 排队共用，§3.7）+ 单测 6 例。
- `packages/app/octoapp/pages/insight/utils/send-queue.ts`：`QueuedSend` 增 `directory`/`model`/`chip`/`uploads`/`images`；`allQueues()` 导出（runner 遍历）。
- `packages/app/octoapp/octo.tsx`：`GlobalSyncProvider` 内挂 `<InsightQueueRunner/>`。
- `packages/app/octoapp/pages/insight/index.tsx`：删两处 in-page flush effect + `flushQueueHead`；`enqueue` 固化 directory/model/chip + 附件快照 + 清栏；`removeQueued` 还原附件；`doSendPrompt` 组 parts 改调 `assembleInsightParts`（其余不动）。
- [`docs/insight-debugging.md`](../../insight-debugging.md)：`[octo:queue]` 段同步（`drain-send`/`drain send failed`/`enqueued` 字段，§1.4）。

---

## 5. 其他模块接入指南（本节整节进 PR 描述）

> 面向 chat/design/make/pattern/studio 等模块的开发同学。**当前只有 insight 有自造排队；本节是「你若要给你的模块加同款排队，怎么复用这套 runner」的指南，不是要你现在就改。**

### 5.1 先判断你属于哪种情况

- **你的模块走上游 `session.tsx`（followup 队列）**（如 chat / 走 `session.command` 的 Design）：**不要**改到这套 runner——那是上游代码，重写会制造 merge 痛点，且它已是 level-triggered + persisted，没 insight 那么脆。本 runner 的价值对你是「模式参考」，需要时把「drain 归数据层」的思路反馈上游即可。
- **你要新造一份模块自有的排队**（像 insight 这样）：按下面接入，别再把 drain 触发器写进页面组件（那正是 SPEC-INS-027 修的坑）。

### 5.2 三步接入

1. **建你模块自己的 per-session 队列 store**（module 级 signal，`Record<sid, YourItem[]>`，仿 `send-queue.ts`）。你的 `YourItem` 自定，但**必须自包含**——发送所需的一切（文本 + 你模块的注入项 + 模型/模式选择）在**入队那一刻**就固化进去，不要在发送时去读页面态。
2. **写一个页面无关的 `send(sid, item)`**：用全局 SDK 按会话 directory 建 scoped client 发送，不依赖任何已挂载页面组件。
3. **在 `octo.tsx` 的 `GlobalSyncProvider` 内**挂你自己的 headless runner 组件，调 `createSessionQueueRunner(yourAdapter)`（`yourAdapter` 见 §3.2 契约）。

### 5.3 硬约束（照抄 insight 的教训）

- **触发器不进页面组件**：drain 只能由 §3.2 那个常驻 runner 发起；页面组件只做入队 / 展示 / 取消。
- **level-triggered + per-session in-flight 守卫**：不要用 `on(isBusy, …, {defer})` 这种边沿触发（会漏 idle 边沿）。
- **数据 per (module, sessionID) 分桶、各模块各持一份**：不要跨模块共享一个队列桶；runner 只 drain 自己 store 里的 sid，隔离白送。
- **面向用户文案专业化**：队列条 / 取消 / 失败提示等用户可见文字用专业措辞，不用开发口吻（团队通则）。

---

## 6. 验证

> 纯前端 + 本地开发环境即可复现，**无内网依赖**，故只有外网验证节。

### 6.1 自动化

- **typecheck**：`bun run typecheck`（app 包；push 前 pre-push hook 亦跑）。
- **runner 单测**（`session-queue-runner.test.ts`，6 例）：用假 adapter（内存 `buckets` + 可控 `isBusy` + 记录 `send`）验证——V1 idle+非空→drain 队首；V2 busy 不 drain，busy→idle 后链式 drain；V3 in-flight 守卫不重复发；V4 多 sid 隔离；V5 `send` reject 释放守卫、不死循环；空桶不触发。
- **组装器单测**（`build-prompt-parts.test.ts`，6 例，§3.7）：锁死 parts 顺序契约（cleanText → synthetic → txt/md FilePart → 图片 FilePart）+ FilePart 映射（txt/md file://、office 过滤、图片 mime 缺省）+ 空 synthetic 跳过。**这条同时是正常发送不回归的护栏**——`doSendPrompt` 与 `sendQueuedItem` 共用它。
- **doSendPrompt 等价性**：改动仅把「组 parts」段换成 `assembleInsightParts`，附件解析 / 搬迁 / optimistic / 日志一行未动；经 typecheck + 静态逐项等价核对（synthetic 顺序、txt/md、图片、optimistic 引用均不变）。

### 6.2 手动驱动（本地 Electron / web 预览）

前置：本地起 insight，选一个会答较久的模型。

1. **原 bug 场景 A（切路由页）**：会话 busy 时排队 → 切「技能库」`/skills` → 等原会话后台跑完 →**预期：排队在后台继续逐条发出**（切回队列已减少、消息已在对话流）。回归前此处死等。
2. **原 bug 场景 B（切 agent tab）**：busy 排队 → 切 chat/design tab → 等跑完 → 切回 insight →**预期：排队已推进**。
3. **对照（切对话）**：busy 排队 → 切别的 insight 会话 → 回来 →**预期：仍推进，且不误发到别的会话**（隔离）。
4. **附件回归（§3.7，内网测出的那条）**：busy 时**上传文件 + 写提示词**排队 → 前一 turn 完成 →**预期：文件随该条消息一起发出**（对话流出现文件卡片 + 模型能读到）;排 msg1(带文件A) + msg2(带文件B) →**预期：A 跟 msg1、B 跟 msg2，不绑错**。
5. **正常发送不回归（重点)**：**非排队**状态直接发「文本 + 附件（txt/md + 图片 + office）」→**预期：与改前完全一致**（[附件]卡片、txt/md 内联、图片 vision、optimistic 即时气泡都在）。
6. **取消排队**：排一条带附件的 → 点 × 移除 →**预期：文本 + 附件 chip 还原到输入区**，可编辑后重发。
7. **abort**：排队中点停止 → 队列清空、不再 drain。
8. **一条一回合**：排 3 条 → 逐条串行发出（不并发、不乱序）。

观测点：console `[octo:queue] enqueued / drain-send / drain send failed`（`docs/insight-debugging.md` §1.4）。

---

## 7. 对既有 spec 的影响

- **SPEC-INS-007 §3.3.3**：FIFO 队列语义（入队追加、逐条 flush、一条一回合）仍以 007 为事实层；本 spec 只改「drain 触发器归属」架构层。已在 007 §3.3.3 节首加修订备注正向链接本 spec（事实层不复制，走引用）。
- **SPEC-INS-024 composer-draft**：姊妹先例，架构处置同构，互相 See also。
