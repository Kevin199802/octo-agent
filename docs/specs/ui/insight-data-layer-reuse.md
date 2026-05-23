# SPEC-INS-005 — 对接 opencode 原生数据层（Data Layer Reuse）

> 状态：草案 · 优先级 P0 · 规模 [M] · 领域 ui/insight
>
> 上游已实现：✓ `useGlobalSync` 共享 store；✓ `useSync().session.sync(id)` 消息加载（带 inflight 去重 / optimistic / cache / prefetch）；✓ `event-reducer` SSE 事件归约；✓ `session.promptAsync` 异步发送；✓ `sync.session.optimistic.add/remove` 乐观消息；✗ 无新增

---

## 1. 背景

### 1.1 现状

InsightPage（[index.tsx](../../../packages/app/src/pages/insight/index.tsx)）的**数据层**完全自建：
- 自建 `dataStore`（`createStore<DataStore>`）
- 自建 `globalSDK.event.listen` SSE 事件监听
- 自建 REST `session.messages` 初始加载
- 同步 `session.prompt`（阻塞到 LLM 完成）发消息
- `<DataProvider data={dataStore}>` 传给子组件

而 opencode 原生 chat（[directory-layout.tsx](../../../packages/app/src/pages/directory-layout.tsx)）走的是另一条路径：
- 共享 `globalSync` store（`sync.data`）
- 复用 global-sync 内部 `event-reducer` 处理 SSE
- 用 `sync.session.sync(id)` 加载（带去重 / cache / prefetch）
- 异步 `session.promptAsync` + `sync.session.optimistic.add` 即时显示用户消息

### 1.2 内网必现 bug

内网调试发现：发消息后 SSE 流式输出文本被**每个 delta 重复处理两次**。例如：

| 时刻 | LLM 实际生成 | 客户端 dataStore.text |
|---|---|---|
| text-start | "" | "" |
| delta "好的" | "好的" | "好的好的" |
| delta ", 我先" | "好的, 我先" | "好的好的, 我先, 我先" |

加 [octo:sse] 调试日志后铁证（[commit 51556cd](../../../) console 输出）：

```
seq:3 deltaPreview:"\n\n"   lenBefore:2 → lenAfter:4   tailAfter:"\n\n\n\n"
seq:4 deltaPreview:"好的"   lenBefore:6 → lenAfter:8   tailAfter:"\n\n\n\n好的好的"
seq:5 deltaPreview:", 我先" lenBefore:11 → lenAfter:14 tailAfter:"\n\n\n\n好的好的, 我先, 我先"
```

每条 delta 处理前，文本已经凭空多了一个 deltaLen 的量。

### 1.3 根因

**SSE 事件的 `part` 对象被 globalSync 和我们的 dataStore 同时引用，SolidJS 的 createStore 通过反应式代理共享底层对象**。流程：

1. SSE `message.part.delta` 事件到达 emitter
2. **globalSync 的 event-reducer**（先注册）处理：对共享 part 的 `text` 字段 `produce(...)` 追加 delta
3. **我们的 listener**（后注册）处理同一事件：对**同一个底层对象**再次追加 delta
4. 结果：每个 delta 被 produce 两次，文本累积速度 ×2

`text-end` 的 `message.part.updated` 用 `reconcile(part)` **整体替换**而非追加，所以一旦 text-end 到达，客户端文本被服务端最终态盖回正确值（用户观察的"过一会就正常"）。

**chat 无 bug 的原因**：只走 globalSync 一条路径，没有第二个 listener。

---

## 2. 上游对照表

| 能力 | 自建实现（当前） | opencode 原生 | 状态 |
|---|---|---|---|
| 消息/部分状态 store | 本地 `dataStore`（[index.tsx:54-65](../../../packages/app/src/pages/insight/index.tsx)） | `sync.data`（来自 [global-sync.tsx](../../../packages/app/src/context/global-sync.tsx)） | **改** |
| 初始消息加载 | `globalSDK.client.session.messages()` REST 直调（[index.tsx:75-116](../../../packages/app/src/pages/insight/index.tsx)） | `sync.session.sync(id)`（带 inflight 去重 + cache + optimistic 合并） | **改** |
| SSE 事件订阅 | 自建 `globalSDK.event.listen`（[index.tsx:118-242](../../../packages/app/src/pages/insight/index.tsx)） | global-sync 内部 [event-reducer.ts](../../../packages/app/src/context/global-sync/event-reducer.ts) | **删** |
| `<DataProvider data>` | `dataStore` | `sync.data` + `onNavigateToSession` + `onSessionHref` | **改** |
| 发送消息 | `await session.prompt(...)` 同步阻塞（[index.tsx:298-342](../../../packages/app/src/pages/insight/index.tsx)） | `session.promptAsync(...)` 立即返回 + optimistic message（[submit.ts](../../../packages/app/src/components/prompt-input/submit.ts)） | **改** |
| 业务发送 wrapper | `doSendPrompt` / `sendInjectedPrompt` | 同样保留，仅替换内层调用 | **保留** |
| `sending()` 信号 | `setSending(true/false)` 包 await prompt | 监听 `sessionStatus().type === "busy"` | **改** |
| 错误处理 | `try/catch` on prompt | 监听 `session.error` SSE 事件（通过 globalSync 派发到 `notification` 通道） | **改** |
| 任务卡片刷新/终止/follow-up | `sendInjectedPrompt` 走 prompt | 内层 prompt 调用改为 promptAsync，行为一致 | **保留** |

---

## 3. 改动清单

按 PR 拆，PR1 风险低（机械替换），PR2 风险中（链路改造）。**不允许合并到一个 PR**。

### 3.1 PR1：数据层切换到 sync.data

**删除**：
- `type DataStore` 类型定义（[index.tsx:38-44](../../../packages/app/src/pages/insight/index.tsx)）
- `const [dataStore, setDataStore] = createStore<DataStore>({...})`（L54-65）
- `__octoListenerSeq` / `__octoEventSeq` 全局调试计数器（L46-49）
- `InsightPage mounted/unmounted` 调试日志（L67-73）
- `REST messages loaded` 调试日志（L90-104）
- `createEffect` 里的 `globalSDK.client.session.messages(...)` 整个调用（L75-116）
- `globalSDK.event.listen(...)` 整个 listener（L118-242）
- 配套 `onCleanup(unsub)`（L242）

**新增**：

```typescript
import { useSync } from "@/context/sync"
// ...
const sync = useSync()

// 切 session 时触发 sync 加载（带 inflight 去重，重复调用安全）
createEffect(() => {
  const id = params.id
  if (!id) return
  void sync.session.sync(id)
})
```

**替换读取点**（所有 `dataStore.X` → `sync.data.X`）：

| 当前 | 改为 |
|---|---|
| `dataStore.message[id]`（L246） | `sync.data.message[id]` |
| `dataStore.message[id] ?? []`（L255） | `sync.data.message[id] ?? []` |
| `dataStore.part[msg.id] ?? []`（L264） | `sync.data.part[msg.id] ?? []` |
| `dataStore.session_status[id]`（L295） | `sync.data.session_status[id]` |
| `<DataProvider data={dataStore} directory={homeDir() \|\| ""}>` | `<DataProvider data={sync.data} directory={homeDir() \|\| ""} onNavigateToSession={...} onSessionHref={...}>` |

**DataProvider 新增 props**（对齐 chat，让消息体内子 session 链接生效）：

```typescript
<DataProvider
  data={sync.data}
  directory={homeDir() || ""}
  onNavigateToSession={(sessionID) => navigate(`/insight/${sessionID}`)}
  onSessionHref={(sessionID) => `/insight/${sessionID}`}
>
```

**预期收益**（除修 bug 外的连带）：
- 消息头**模型/provider 标签**显示（之前 `data.store.provider` 为 undefined 静默降级）
- **subagent 标签**显示（之前 `data.store.agent` 为 undefined）
- 子 session **链接跳转**生效

### 3.2 PR2：发消息链路改 promptAsync + optimistic

**改动**：`doSendPrompt`（[index.tsx:298-342](../../../packages/app/src/pages/insight/index.tsx)）

**当前**：

```typescript
setSending(true)
try {
  // ... 构造 promptPayload
  await globalSDK.client.session.prompt(promptPayload)
  // ...
} catch (err) {
  console.error("[InsightPage] prompt failed", ...)
} finally {
  setSending(false)
}
```

**改为**（参考 [submit.ts:106-170](../../../packages/app/src/components/prompt-input/submit.ts)）：

```typescript
// 1. 生成 messageID（客户端预生成，optimistic add 用）
import { Identifier } from "@opencode-ai/shared/util/identifier"
const messageID = Identifier.ascending("message")

// 2. 构造 optimistic user message
const optimisticMessage: Message = {
  id: messageID,
  sessionID: sessionId,
  role: "user",
  time: { created: Date.now() },
  agent: "octo_insight",
  model: { providerID: ..., modelID: ..., variant: undefined },  // 从 globalSync 取默认
}

// 3. 立即显示
sync.session.optimistic.add({
  sessionID: sessionId,
  message: optimisticMessage,
  parts: [textPart],  // 用户输入的 parts
})

// 4. 异步发送（立即返回 204，不阻塞）
try {
  await globalSDK.client.session.promptAsync({ ...promptPayload, messageID })
} catch (err) {
  // promptAsync 失败时需要 remove optimistic
  sync.session.optimistic.remove({ sessionID: sessionId, messageID })
  throw err
}
```

**`sending()` 信号去除**：
- 删 `const [sending, setSending] = createSignal(false)`（L233）
- 所有 `sending()` 的使用点：
  - `inputDisabled() = sending() || isBusy()` → `inputDisabled() = isBusy()`（`isBusy` 已经反映 sessionStatus）
  - `if (sending()) return`（handleSubmit L355）→ 改为 `if (isBusy()) return`
  - `if (isBusy() || sending())`（任务卡片操作 L458/473）→ `if (isBusy())`

**错误处理**：
- 当前 try/catch 已无用（promptAsync 立即返回不报后端错误）
- 后端错误走 SSE `session.error` 事件 → 由 globalSync 派发到 `notification` 通道 → toast 自动显示
- 验证：confirm `notification.tsx` 已订阅 session.error 并触发 toast（**待 PR1 之后实测**）

### 3.3 任务卡片操作链路

`handleTaskRefresh` / `handleTaskStop` / `handleTaskFollowup` 内部都调 `sendInjectedPrompt` → `doSendPrompt`。**自动跟着 PR2 一起切到 promptAsync**，无需单独改。

**注意**：`handleTaskFollowup` 当前只是 `setPrompt(seed)` 不真发，不影响。

---

## 4. 风险

| 风险点 | 等级 | 应对 |
|---|---|---|
| sync.data 读取路径与本地 dataStore 字段形状不一致 | 低 | 类型相同（同 SDK 来源），TS 编译期可捕获 |
| `sync.session.sync(id)` 行为差异导致初始加载时序变化 | 中 | chat 实战验证过；先 PR1 单独打包试跑一次，确认消息列表展示正常 |
| optimistic message 字段不全（agent/model 拿不到默认值） | 中 | 参考 submit.ts 取值方式；若运行时 model 拿不到，从 `globalSync.data.config` 或 `globalSync.data.provider` 默认 |
| promptAsync 失败走 SSE error 通道，notification toast 未生效 | 中 | PR2 实施后必须实测一次 401/网络断 等错误，确认 toast 出现 |
| 任务卡片"refresh inflight"语义改变（之前依赖 await prompt 完成） | 低 | refresh 本质只关心 SSE 后续事件，promptAsync 不阻塞反而更符合预期 |
| DataProvider props 不传 onNavigateToSession 是否影响 SessionTurn | 低 | 已对照 chat 实现，不传只丢"子 session 跳转"功能，不会报错 |
| 失去自建 `[octo:sse]` 调试日志 | 低 | 接受；下次出问题再临时加 |

---

## 5. 回归 checklist

PR1 / PR2 各自合入后，**必须人工跑一遍**：

### 5.1 PR1 合入后

- [ ] 进入空 insight 页面，不报错，sidebar session 列表正常
- [ ] 进入一个**已有消息**的 session，历史消息正确渲染（含 user / assistant / tool / reasoning parts）
- [ ] 模型/provider 标签在 assistant message header 出现（**之前是降级状态**）
- [ ] 切换 session（点 sidebar 不同条目），消息列表无残留、无重复加载
- [ ] **流式重复 bug 不复现**：发一条消息观察文本流，不再出现"任务仍在处理中仍在处理中"类重复
- [ ] 任务卡片渲染正常（依赖 `sync.data.part`，路径已对齐）
- [ ] OutputCard / ResultViewer 正常打开

### 5.2 PR2 合入后

- [ ] 发消息后**立即看到自己说的话**（optimistic）
- [ ] LLM 流式响应正常显示
- [ ] 发消息期间输入框被 disabled（`isBusy` 信号生效）
- [ ] LLM 完成后输入框恢复
- [ ] 任务卡片"刷新 / 终止 / follow-up"按钮链路正常
- [ ] 模拟网络错误（断网发消息）→ toast 提示 + optimistic message 被清除
- [ ] 模拟服务端错误（如 model 401）→ toast 提示

---

## 6. 调试日志策略（提前埋）

为下次出 SSE / 链路类问题留观测点，**实现时一并埋好，不等出问题再加**：

| 位置 | 日志内容 | 用途 |
|---|---|---|
| `doSendPrompt` 入口 | `[octo:prompt] send` source / sessionID / agent / template / textLen | 当前已有，**保留** |
| `doSendPrompt` 成功后 | `[octo:prompt] sent (async)` messageID / sessionID | 确认 promptAsync 已发出 |
| `doSendPrompt` 失败 | `[octo:prompt] failed` error / messageID（同时 optimistic.remove） | 错误定位 |
| `optimistic.add` 调用前后 | `[octo:prompt] optimistic added` messageID / partsCount | optimistic 时序追踪 |
| `sync.session.sync` 调用 | `[octo:sync] session.sync` sessionID / forced | 切 session 时序 |
| `sessionStatus` 变化（createEffect） | `[octo:sync] status` sessionID / from / to | busy↔idle 切换观测 |
| `taskCards` 聚合 diff（已有） | `[octo:task] aggregate diff` | **保留** |
| 任务卡片操作 | `[octo:task] refresh/stop/followup click`（已有） | **保留** |

**删除**：
- `[octo:sse] InsightPage mounted/unmounted` —— globalSync 全局唯一 listener，多实例排查失去意义
- `[octo:sse] REST messages loaded` —— REST 调用本身被删掉了
- `[octo:sse] part.updated text` / `part.delta` / `delta DROPPED` —— 我们不再监听 SSE，无法获取这些数据；如需观测应去 [event-reducer.ts](../../../packages/app/src/context/global-sync/event-reducer.ts) 加，但**那是全应用共享**，不适合插业务日志
- `[octo:sse] session.status` / `tool part` / `new part` —— 同上

**原则**：日志埋在业务层（我们写的代码里），不污染上游或共享代码。

---

## 7. 输入区评估（保留自实现 + 理由更新）

**结论**：**保留** [insight/index.tsx](../../../packages/app/src/pages/insight/index.tsx) 自实现的 textarea + AttachmentBar + PromptTemplateSelector，**不切换**到上游 [PromptInput](../../../packages/app/src/components/prompt-input.tsx)。

**复评原因**：CLAUDE.md 当前理由是 "上游 PromptInput 深耦合 packages/app context"。**这个理由部分失效**（PR1 之后我们用 globalSync 的 sync.data，理论上 packages/app context 不再是障碍）。但实际盘点发现复用仍不划算，理由变成下面这样。

**真实耦合面**（验证）：
- PromptInput 顶部 import **14 个 context**：useSDK / useSync / useLocal / **useFile** / usePrompt / **useLayout** / **useComments** / useDialog / useProviders / **useCommand** / usePermission / useLanguage / usePlatform / **useSessionLayout**
- 文件 **1500+ 行**
- 其中 chat 专属（**useSessionLayout / useFile / useCommand / useComments**）的耦合我们做 PR1 也补不上 —— 这些 context 服务 chat 的代码库 @-mention、/ 斜杠命令、代码审查评论等场景

**功能集对比**：

| PromptInput 功能 | insight 需要？ |
|---|---|
| 富文本编辑器（contenteditable + 自定义片段） | ✗ textarea 够 |
| @-mention 代码库文件/符号 | ✗ insight 是文档场景非代码库 |
| / 斜杠命令 | ✗ **预置提示词按钮替代**（新需求） |
| 上箭头召回历史 | △ 可选，但不阻断 |
| 粘贴图片 | △ 可选，目前无需求 |
| 代码粘贴专用处理 | ✗ |
| 拖入文件 | ✓ 已自实现 |
| 文件/图片附件 chip | ✓ AttachmentBar 自实现（含上传到 S3 流程） |
| **预置提示词按钮**（即将替换 PromptTemplateSelector） | ✗ 原生没有 |

**重叠度 < 20%**，需要新增的功能（预置提示词）原生没有，需要替换的功能（文件上传到 S3）已自实现。结论：**复用成本远高于自实现**。

**CLAUDE.md 理由更新**（待新对话执行）：

```
- 老：PromptInput 自己写：上游 PromptInput 深耦合 packages/app context，在 insight/ 内写简化版
+ 新：PromptInput 自己写：上游 PromptInput 设计为 chat 工作流（@-mention 代码库 / 斜杠命令 / 历史回溯 / 代码粘贴），
+      深度耦合 useSessionLayout / useFile / useCommand 等 chat 专属 context，1500+ 行。
+      insight 工作流（文档上传 + 预置提示词 + MCP 任务卡片）功能集重叠度 < 20%，
+      复用成本远高于自实现。在 insight/ 内写简化版。
```

---

## 8. 实施步骤

1. **本 spec 评审通过**（用户 review）
2. PR1：数据层切换（预计 1-2h），按 §3.1 改动清单逐项执行 + §6 日志策略埋点
3. PR1 跑通 §5.1 checklist
4. **打内网包，确认 §1.2 的 bug 不复现**（关键里程碑）
5. PR2：promptAsync 链路改造（预计 2-3h），按 §3.2 + §6 日志策略埋点
6. PR2 跑通 §5.2 checklist

---

## 9. 不做什么（明确边界）

- **不动** 输入区（textarea + AttachmentBar + PromptTemplateSelector） —— 见 §7 评估结论
- **不动** ResultViewer / OutputCard / TaskCardView 等 UI 组件的渲染逻辑，仅修数据源路径
- **不动** 上游 globalSync / event-reducer / sync.session 的实现（按 CLAUDE.md "不动" 政策）
- **不动** opencode 上游事件流协议（part.updated / part.delta 等）
- **不在 PR1 同时改 promptAsync**。两件事正交，混在一起出问题难定位
- **不处理** 产品流程改版（预置提示词替换模板选择器、CLAUDE.md 过时约束清理等）—— 拆到新对话

---

## 10. 历史包袱说明

自建数据层非有意设计：[commit d65c53f](../../../) "完整 InsightPage 骨架"实现时，作者（Claude）未评估复用 globalSync，从零写了一版。事后 CLAUDE.md §"规划 spec / 写代码前的强制检查" 才加入 "必须先排查上游能力" 规则。本 spec 即是该规则的兜底落实。
