# Spec — 长任务卡片(对话流内)

> 状态:草案 · 优先级 P1 · 规模 [M] · 领域 ui
>
> 决策依据:[ADR-013](../../adr/013-long-task-progress-strategy.md) — 卡片刷新按钮 + LLM 触发查询(SSE 不可行前的务实选择)。
>
> 契约依据:[mcp-contract.md §任务管理](../agents/mcp-contract.md) — `task_id` / `get_task_result` / `stop_task` / LLM 调用规范。
>
> 衔接:completed 时复用 [output-renderers.md](output-renderers.md) 现有 OutputCard 体系,不重写渲染器。

---

## 上游已实现:✗

opencode `@opencode-ai/ui` 的 `SessionTurn` / `MessagePart` 渲染普通 tool 调用卡片(状态、错误、output),但**没有"长任务卡片"概念**:不会从 MCP `structuredContent.task_id` 识别长任务,不会聚合同一 task_id 跨多个 turn 的最新状态,也不会渲染"刷新 / 终止"操作按钮。

本 spec 在 InsightPage 内自包含实现,**不动**上游组件。

---

## 与现有组件的边界(重要)

| 组件 | 关系 | 本 spec 是否改动 |
|---|---|---|
| `ResultViewer` + `tabStore`(右侧产出区) | 是 [task-panel.md](task-panel.md) 中"产出 tab"概念的 SolidJS 落地 | **不动**。`completed` 时把结果转 `OutputCard` 注入 `tabStore.openTab()`,复用现有路径 |
| `InsightTurn` 内现有"text → OutputCard" 检测 | 现状:从最后一条 `text` part 跑 `detectCard()` 出卡片 | **保留并行**。task_id 路径与 text-detect 路径并存,task_id 优先级更高(同一 turn 有 task_id 就不再走 text-detect) |
| `OutputCard` / 各 renderer(table / mindmap / html / markdown) | 业务结果渲染零件 | **不动**。`completed` 状态把卡片转成 `OutputCard` 后直接复用 |
| `task-panel.md` 中"过程 tab / 时间线" | 至今未实现,与本 spec 无关 | 不碰 |
| `ResultViewer` 内 `source: "uri"` fetch 路径([output-renderers §2.5](output-renderers.md#25-resource_link-来源的检测与分发)) | 长任务 `completed` 返回 `resource_link` 时由该路径渲染 | 本 spec 不实现 §2.5,本 spec 只负责"把 resource_link part 喂进 OutputCard / tabStore",§2.5 落地与本 spec 并行 |

**ADR-013 不做的"任务面板"** 指方案 2.1 给长任务专门做的独立轮询面板 + 跨 session 任务托盘,不是 ResultViewer 或 task-panel.md 中的"产出 tab"。本 spec 与 ADR-013 一致:不引入独立面板、不轮询、不跨 session 托盘。

---

## 1. 范围与目标

### 1.1 必须做

- 识别 MCP 业务工具返回 part 中的 `structuredContent.task_id`,在对话流(`InsightTurn` 内)渲染任务卡片
- 5 种状态视觉态:`pending` / `processing` / `completed` / `failed` / `stopped`
- 刷新按钮:点击 → inject prompt → LLM 调 `get_task_result` → 卡片就地更新
- 终止按钮:二次确认 → inject prompt → LLM 调 `stop_task`
- 同一 task_id 3 分钟刷新防抖,倒计时 UI 反馈
- 终态卡片(`completed` / `failed` / `stopped`):刷新按钮隐藏或禁用,终止按钮隐藏
- `completed` 时:卡片内嵌简要状态 + 把 text 摘要 + resource_link 转 OutputCard 注入 ResultViewer
- "在对话里继续讨论"按钮(P1 可选):inject 种子文本到输入框

### 1.2 不做(与 ADR-013 一致)

- ❌ 独立任务面板(右侧 tab / 浮窗 / 抽屉)
- ❌ 自动轮询(任何 setInterval / setTimeout 轮询)
- ❌ 跨 session 任务列表 / 任务托盘 / 全局通知
- ❌ Electron 主进程 TaskWatcher
- ❌ 新增 HTTP API(只用现有 MCP 工具 `get_task_result` / `stop_task`)
- ❌ Session 切换 / app 关闭后的持久化追踪(防抖 Map 在内存,session reset 时清空)

---

## 2. 数据模型

### 2.1 TaskCard

```ts
// pages/insight/components/task-card/types.ts
export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "stopped"

export type TaskCard = {
  taskId: string
  status: TaskStatus
  toolName: string                 // 来源业务工具:run_usability_analysis / key_findings / ...
  message?: string                 // structuredContent.message(进度阶段描述 / 错误说明)
  submittedAt: Date                // 首次提交时间(从最早的 part 推断)
  lastUpdatedAt: Date              // 最近一次状态更新时间(来自最新匹配 task_id 的 part)
  // completed 时附带的展示物
  resultText?: string              // text part 内容(摘要 / 完整内容)
  resourceLink?: {
    uri: string
    name: string
    mimeType: string
  }
}
```

### 2.2 防抖状态

```ts
// 客户端内存 Map,session reset 时清空
type RefreshState = {
  lastRefreshAt: number            // ms timestamp
}
const refreshState = new Map<string /* taskId */, RefreshState>()
const REFRESH_COOLDOWN_MS = 3 * 60 * 1000   // 3 分钟
```

---

## 3. 触发与识别

### 3.1 数据来源

opencode SSE 把 MCP `CallToolResult.content[]` 转发为 `Part[]`,InsightPage 已在 [index.tsx:50](../../../packages/app/octoapp/pages/insight/index.tsx) 维护 `dataStore.part[messageID]`。识别逻辑读这份 store,不另起数据通道。

### 3.2 task_id 识别规则

扫描某 turn 内 assistant 消息的所有 part,符合以下任一即视为"任务相关 part":

```ts
function getTaskIdFromPart(part: Part): { taskId: string; status?: TaskStatus; message?: string; toolName?: string } | null {
  // 路径 1:MCP tool 结果 part(含 structuredContent)
  //   形态待联调确认,opencode 可能把它放在 part.state.output / part.state.metadata / part.structuredContent
  //   spec 假设最终可读到 { task_id, status?, message? }
  const sc = readStructuredContent(part)
  if (sc?.task_id) {
    return {
      taskId: sc.task_id,
      status: sc.status as TaskStatus | undefined,
      message: sc.message,
      toolName: extractToolName(part),
    }
  }
  return null
}
```

> ⚠️ **联调待确认**:opencode 把 MCP `structuredContent` 暴露到 Part 的具体字段名未在 spec 之前完整观测过。实现前先用 `console.log` 在 `index.tsx` 现有 `[octo:sse] tool part` 埋点位置(已存在,见 [index.tsx:110](../../../packages/app/octoapp/pages/insight/index.tsx#L110))确认形态,`readStructuredContent` helper 按观测结果实现。

### 3.3 同一 task_id 跨 turn 聚合

一个 task_id 可能出现在多条 assistant 消息里:

```
turn 1: 用户 "做观点解析"
        assistant: 调 key_findings → part(task_id=T1, status=pending)

turn 2: 用户点了刷新按钮 → inject "查询任务 T1 进度"
        assistant: 调 get_task_result(T1) → part(task_id=T1, status=processing)

turn 3: 用户再次刷新
        assistant: 调 get_task_result(T1) → part(task_id=T1, status=completed, resource_link=...)
```

**聚合策略**:遍历当前 session 所有 part,按 task_id 分组,每组取**时间上最新的状态**(用 part 所在 message 的 time / createdAt 排序;同 message 内多个匹配 part 取最后一个)。

**产物链接复用原产物(重复查询不重生成)**:`status` / `message` / `resultText` 取**最新** part,但 `resourceLinks` 例外 —— 锁定到**该 task_id 首次 completed 且带 resource_link 的那次捕获**,后续重查返回的链接一律忽略。

> 原因:completed 任务产物逻辑上不可变,但用户每次"查询任务进度"都会重调 `get_task_result`(§6.2、并见 octo_insight agent "无条件重新调用"规则),内网 MCP server **可能为同一任务每次返回一批新 URI**。若取最新链接,会让新 URI 顶替原始文件,用户感知成"又重新生成了一份"。锁定首次产物 = 把最初那批文件稳定地拿回来(右侧栏 tab / 内联卡 / 自动打开三处一致)。
>
> 实现:[task-detect.ts](../../../packages/app/src/pages/insight/utils/task-detect.ts) `aggregateTaskCards`,`resourceLinks = group.find(g => g.status==="completed" && g.resourceLinks.length>0)?.resourceLinks ?? latest.resourceLinks`。

**渲染锚点**:任务卡片**只渲染在该 task_id 第一次出现的 turn**(初始提交 turn);后续刷新 turn 产生的 part 仅用于"喂状态",不重复渲染卡片。

理由:卡片"原地更新"语义清晰,与对话线性时间不冲突;后续 turn 里 LLM 的文字回复(如"任务已完成,结果如下...")用现有 SessionTurn 渲染,不被遮蔽。

### 3.4 与现有 text-detect 路径的优先级

`InsightTurn` 当前从最后一条 `text` part 跑 `detectCard()`(见 [insight-turn.tsx:107](../../../packages/app/octoapp/pages/insight/components/insight-turn.tsx#L107))。本 spec 修改后的优先级:

```
该 turn 的 assistant part 里:
  ├─ 有 task_id              → 渲染 TaskCard(本 spec)
  │                             completed 时同时把结果以 OutputCard 注入 tabStore
  └─ 无 task_id              → 走现有 text → detectCard → OutputCard 路径(不变)
```

同 turn 内既有 task_id 又有 text 的情况:走 task_id 路径,文字内容由 `SessionTurn` 自身渲染(任务卡片下方),不再额外开 OutputCard。

### 3.5 故意保留的冗余:刷新 turn 的 OutputCard(入口冗余,非 tab 重复)

刷新场景下,turn N(用户点 ↻ 触发的 `get_task_result` turn)的 part 里**也含有** N 个 resource_link(completed 返回)。当前实现没有抑制这些 part 进 `outputCards` memo,因此 turn N 会和 turn 1 的 TaskCard 同时呈现同一批文件入口("一式两份")。

**这不是 bug,是 trade-off 的产物**:

- ADR-013 明确不做"任务面板 / 跨 session 任务列表 / 任务托盘"
- 当前也没有"从 turn N 跳回锚点 turn 1 卡片"的导航能力
- 长对话(十几轮以上)场景下,用户在 turn N 看到 LLM 转述"任务完成了"时,**滚回 turn 1 找 TaskCard 按钮的成本高**
- turn N 直接 surface OutputCard 是这种约束下的**导航兜底** — 用户在当前位置就能点开结果

#### ⚠️ 入口冗余 ≠ tab 重复(重要边界澄清)

**入口冗余**(保留):turn 1 任务卡片的"查看完整结果"按钮 + turn N 的 SSE inline 卡片,**两个入口**指向同一份产物 — 保留,服务于上述导航兜底。

> **冗余入口也必须指向同一份原始产物**:turn N 的内联卡**不能**直接用本 turn `get_task_result` 返回的链接渲染 —— server 重查可能给新 URI(见 §3.3 产物链接复用),那样 turn N 的卡会比 turn 1 多/换一批文件,"一式两份"变"两份不同"。实现要求:内联卡渲染前按 part 的 `task_id` 经 `resolveTaskLinks(taskId)` 换回该任务首次确定的产物链接,再出卡([insight-turn.tsx](../../../packages/app/src/pages/insight/components/insight-turn.tsx) `outputCards`)。无 `task_id` 的普通 resource_link turn 不受影响,仍走原 `findResourceLinks`。

> **⚠️ 内联卡只出现在真正查到 completed 结果的那一次 turn(2026-07 修复,PR MyHeavenDyf/UXAI#384)**:早期实现只要本 turn 扒到 `task_id` 就经 `resolveTaskLinks` 回填产物卡,而 `readTaskInfo` 对**处理中**的 `get_task_result` 也返回 `task_id`;叠加 `resolveTaskLinks` 跨 turn 聚合「一旦任务完成就恒返回那批产物」,导致每一次「处理中」查询回答下方都被回填了最终产物卡(用户困惑:为什么还没查完的那几次也出卡)。**修复:gate 在本 turn 是否真正观测到该任务 `status === "completed"`** —— 仅 completed 的那次 turn 才 `resolveTaskLinks` 出卡,处理中的查询 turn 不出卡。这样"哪次真正查到结果,卡就出现在哪次",符合直觉。实现:`outputCards` 内 `completedTask = parts.find(readTaskInfo(p)?.status === "completed")`,`taskId` 取自它。

**tab 重复**(禁止):点击两个入口后,ResultViewer 里**同一 URI 被开成两个独立 tab** — 这是 bug,必须避免。

业界对照(VS Code / Cursor / Notion 等):同一文件路径 / document ID 在多个入口被打开时,**激活已有 tab,不新建**。我们的 tab 去重 key 应该是 `uri`,而不是 OutputCard.id(因为任务卡和 SSE 卡的 id 不同,但 uri 相同)。

**实现要求**([tab-store.ts](../../../packages/app/octoapp/pages/insight/components/result-viewer/tab-store.ts) 的 `openTab`):

```
1. 优先按 uri 匹配现有 tab → 命中即 activate,不新建
2. URI 不存在(inline 模式卡)→ 按 id 匹配
3. 都不命中 → 新建 tab
```

去重命中时打 `[octo:tab] dedupe-by-uri` console,便于联调。详见 [output-renderers.md §9.0 V0-F](output-renderers.md#v0-f-tab-去重同一-uri-多入口不重复开-tab) 验证步骤。

#### 未来去掉入口冗余的可能(目前不做)

**未来若引入下列任一能力,可考虑去掉入口冗余**(改动只需 `outputCards` memo 加一行 filter):

- "活跃任务"chip 条(输入框上方),点击滚回锚点
- ResultViewer Tab 顶部加"返回任务卡片"链接(从 tab.id 推回 task_id → 滚到锚点 user message)
- 任务列表 / 任务托盘(ADR-013 排除,需重新评估)

未实现上述任一前,**不要**为了"看起来清爽"去抑制 turn N 的 OutputCard。但 **tab 去重必须做**,这与入口冗余正交。

---

## 4. 状态机

```
                  [初始提交,业务工具返回 task_id]
                              │
                              ▼
            ┌──────────► pending ──┐
            │              │       │
            │              ▼       │
            │           processing │      (来自后续 get_task_result)
            │              │       │
            │              ▼       │
            └────┬───── completed ─┴────┐
                 │                      │
                 │      failed          │
                 │                      │
                 │      stopped         │
                 │                      │
              [终态,刷新/终止按钮收起]
```

| 状态 | 含义 | 刷新按钮 | 终止按钮 | 视觉色 |
|---|---|---|---|---|
| `pending` | 任务已入库,排队中 | ✅ 可用(受防抖) | ✅ 可用 | `--octo-text-secondary` + 灰色脉冲 |
| `processing` | 分析进行中 | ✅ 可用(受防抖) | ✅ 可用 | `--octo-brand-primary` + 进度脉冲 |
| `completed` | 完成 | ❌ 隐藏 | ❌ 隐藏 | `--octo-success`(待 token 确认,无则用 brand) |
| `failed` | 失败 | ❌ 隐藏 | ❌ 隐藏 | `--octo-danger`(待 token 确认) |
| `stopped` | 用户终止 | ❌ 隐藏 | ❌ 隐藏 | `--octo-text-muted` |

> 颜色 token 名称未在 [octo-tokens.css](../../../packages/app/octoapp/pages/insight/octo-tokens.css) 中预定义的(success / danger),实现时按现有 token 命名约定补充,并按 CLAUDE.md "设计素材清单"要求在 [design-assets-needed.md](design-assets-needed.md) 登记需要的设计件。

---

## 5. UI 结构

### 5.1 卡片布局(对话流内,与现有 OutputCard 同一栏宽度)

```
┌──────────────────────────────────────────────────────────────┐
│  ⏳  观点解析 · 任务 ID T_abc123              ↻ 刷新  ⏹ 终止 │
│  ────────────────────────────────────────────────────────── │
│  状态:进行中                                                 │
│  阶段:正在聚合用户痛点...(来自 message 字段)               │
│                                                              │
│  提交于 17:11 · 30 秒前刷新                                  │
└──────────────────────────────────────────────────────────────┘
```

`completed` 态:

```
┌──────────────────────────────────────────────────────────────┐
│  ✓  观点解析 · 任务 ID T_abc123                              │
│  ────────────────────────────────────────────────────────── │
│  分析完成。摘要:从 12 份访谈中提取 23 条观点,Top 3 ...      │
│                                                              │
│  [📄 查看完整结果 →]   [💬 在对话里继续讨论]                │
└──────────────────────────────────────────────────────────────┘
```

- "查看完整结果"按钮:调 `tabStore.openTab(buildOutputCard(taskCard))`,与现有 OutputCard 点击行为一致
- "在对话里继续讨论":把种子文本 `基于 task ${taskId} 的结果,我想...` 填到输入框(`setPrompt`),光标定位,不自动发送

`failed` 态:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠  观点解析 · 任务 ID T_abc123                              │
│  ────────────────────────────────────────────────────────── │
│  分析失败:<错误说明,来自 message 字段>                    │
│                                                              │
│  提交于 17:11 · 失败时间 17:42                               │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 防抖 UI 反馈

刷新按钮在冷却期内禁用 + 显示倒计时:

```
   非冷却:[ ↻ 刷新 ]
   冷却中:[ ↻ 2:34 ]   ← 剩余 mm:ss
```

`hover` 时 tooltip:"3 分钟内只能刷新一次,避免高频骚扰 LLM"。

### 5.3 终止按钮二次确认

点击 [⏹ 终止] → 卡片内出现行内确认:

```
┌──────────────────────────────────────────────────────────────┐
│  ⏳  观点解析 · 任务 ID T_abc123                             │
│  ────────────────────────────────────────────────────────── │
│  ⚠️ 确定终止该任务?已耗费的服务端资源不可恢复。            │
│  [取消]    [确定终止]                                        │
└──────────────────────────────────────────────────────────────┘
```

不弹原生 Modal / Dialog —— 与 InsightPage 整体浅交互风格一致。

---

## 6. 行为:LLM 触发链路

### 6.1 inject prompt 机制

**复用 [index.tsx:226](../../../packages/app/octoapp/pages/insight/index.tsx#L226) 的 `sendMessage(sessionId, text)`**,不新增 API:

```ts
// 刷新按钮
async function handleRefresh(taskId: string) {
  if (!params.id) return
  if (isInCooldown(taskId)) return         // 防抖兜底
  markRefreshed(taskId)
  await sendMessage(params.id, `查询任务 ${taskId} 的进度`)
  // sendMessage 已带 agent: "insight" + systemHint,LLM 会按 [mcp-contract.md §LLM 调用规范] 调 get_task_result
}

// 终止按钮(确认后)
async function handleStop(taskId: string) {
  if (!params.id) return
  await sendMessage(params.id, `终止任务 ${taskId}`)
}
```

inject 出来的 user 消息**正常显示在对话流中**(与用户手输无差),不做 "invisible turn"。理由:

- 用户能看见自己"问了什么",符合对话线性直觉
- LLM context 中本来就要有这条 user message 触发 tool 调用,不存在"额外污染"
- 业界做法(ChatGPT plugin / Cursor agent)均无 invisible inject

**注意**:inject 调用复用 `sendMessage` 时,`attachments` 状态保持不变(用户当前正在选附件的话,不应被 inject 清空)。实现需在 `sendMessage` 内部判断:文本来源为 inject 时跳过 `filesById.clear()` / `setAttachments([])`,或者抽出 `sendInjectedPrompt(sessionId, text)` 不消费附件状态。**推荐方案**:抽 `sendInjectedPrompt`,逻辑更清晰。

### 6.2 LLM 实际调用谁

按 [mcp-contract.md §LLM 调用规范](../agents/mcp-contract.md):

- 收到 "查询任务 X 进度" → LLM 调 `get_task_result(X)`
- 收到 "终止任务 X" → LLM 调 `stop_task(X)`
- 客户端**不**直接调 MCP 工具,**不**直接访问任务管理 API

工具调用约束写在 agent prompt(`packages/opencode/src/agent/prompt/octo_insight.md`)里,本 spec 不重复定义。

### 6.3 卡片状态更新

LLM 调 `get_task_result` 后,新的 tool part 通过 SSE 进入 `dataStore.part`。`InsightPage` 的 `outputCard` / `taskCard` memo 重新计算,§3.3 聚合策略找到同 task_id 的最新 part,卡片就地更新。

**整条链路全部走现有 SSE + memo 反应式**,无主动定时器、无 IPC。

---

## 7. 防抖

### 7.1 规则

- **粒度**:per `task_id`
- **冷却时长**:3 分钟(3 × 60 × 1000 ms)
- **作用范围**:刷新按钮;终止按钮不防抖(终止是单次终态操作)
- **存储**:进程内存 `Map<taskId, lastRefreshAt>`,**不持久化**
- **session 切换**:**不清空** Map(`task_id` 全局唯一,无跨 session 误判;切走再切回必须延续倒计时,否则切换 session 可绕过防抖 — 2026-06-11 问题 #48 修正,原设计为切换时清空);过期条目由倒计时 tick 自动剔除,无需手动清理

### 7.2 冷却倒计时实现

```ts
// 单一 setInterval(1s)更新所有 task 倒计时显示,在 task-card 容器层启动
// 不是"轮询任务状态",只是"驱动 UI 倒计时数字渲染",不违反 ADR-013 "不轮询"
const [now, setNow] = createSignal(Date.now())
const timer = setInterval(() => setNow(Date.now()), 1000)
onCleanup(() => clearInterval(timer))

function remainingSeconds(taskId: string): number {
  const state = refreshState.get(taskId)
  if (!state) return 0
  const elapsed = now() - state.lastRefreshAt
  return Math.max(0, Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000))
}
```

只在**当前 session 至少有一个进行中(non-terminal)任务**时启动 timer,所有任务终态后停止 — 避免空跑。

### 7.3 为什么是 3 分钟

参考 ADR-013 §"决策" 与 mcp-contract:任务实际时长 30 分钟级别,3 分钟刷新一次可在最多 10 次操作内覆盖全周期,既避免高频 token 消耗,也保证用户主动查询时反馈不过迟。

---

## 8. completed 渲染衔接

### 8.1 卡片内简要呈现

`completed` 态卡片不直接渲染完整结果(避免对话流过长 / 富 HTML 等不适合内联展示),仅显示:

- 摘要文字(来自 `text` part 内容前 N 字,N≈120,超出截断 + ellipsis)
- "查看完整结果"按钮(主入口)
- "在对话里继续讨论"按钮(次入口)

### 8.2 转 OutputCard 注入 ResultViewer

```ts
function buildOutputCardFromTask(task: TaskCard): OutputCard {
  // resourceLink 路径:走 output-renderers §2.5 的 source: "uri" 渲染
  // 当前 OutputCard 还没扩 source 字段(§2.5 待联调),实现时按以下二选一:
  //   方案 A(临时):resourceLink 存在 → 卡片标题用 resourceLink.name,
  //                content 仍传 text 摘要,渲染走 markdown;
  //                等 §2.5 落地后切换为 source: "uri"
  //   方案 B(推荐):本 spec 实现时一并把 OutputCard 加 source / uri / mimeType 字段,
  //                走 §2.5 完整路径
  // 二选一在实施第一步与我对齐,不在 spec 里钉死
  return {
    id: `task-${task.taskId}`,
    title: task.toolName + " 结果",      // 可选:从 resourceLink.name 提取更人性化标题
    type: detectTypeByMime(task.resourceLink?.mimeType) ?? "markdown",
    content: task.resultText ?? "",
    createdAt: task.lastUpdatedAt,
  }
}

// 完成时:if (status transitioned to completed) tabStore.openTab(buildOutputCardFromTask(task))
//   注意:防止重复 openTab(同 id 已存在则 activate 不 add)— tabStore 现有行为应已覆盖,实现时验证
```

### 8.3 自动打开 vs 仅显示按钮

**默认不自动打开**右侧 Tab。理由:用户可能正在看其他 Tab(对比另一个分析结果),自动跳走打断专注。点"查看完整结果"按钮才打开。

例外:**当前 ResultViewer 为空态**(`tabs().length === 0`)时,自动把**本会话所有 completed 任务的产物一次性 openTab**,默认激活第一个(其余作为待选 tab 并存)。

> 进对话即铺满本会话生成的全部文件(如 a 的 x,y + b 的 m,n → 顶部 tab 栏并排 x,y,m,n),而非只开第一个任务、要求用户逐个叉掉才看到下一个。`autoOpenedTaskIds` 已记录开过的 task,用户**手动关掉后不会被重新弹开**。会话中途新完成的任务因 viewer 非空不再自动插入(点任务卡按钮打开),与"不打断专注"一致。

---

## 9. 边界与错误

| 场景 | 行为 |
|---|---|
| MCP tool 返回 `isError: true`(`failed` 状态) | 卡片切 `failed` 态,展示 `structuredContent.message`(可能为空,空时显示通用"分析失败");不弹 toast |
| `stop_task` 对已终态任务返回(非 isError) | 卡片状态保持当前终态;在对话流中 LLM 会有解释文字 |
| inject prompt 时 session busy(`isBusy() === true`) | 按钮禁用,tooltip:"等待当前任务完成后再操作" |
| inject prompt 失败(网络等) | 走现有 `sendMessage` 的 `console.error`,卡片状态不变,用户可重试(防抖不消耗) |
| 防抖 Map 跨 session 常驻 | 预期行为(§7.1):`task_id` 全局唯一不会误判;切换 session 再切回延续倒计时,防止绕过防抖;过期条目随 tick 剔除,不累积 |
| 同一 session 内同一 task_id 在多个 turn 都被识别 | 仅在最早出现的 turn 渲染卡片(§3.3),其余 turn 仅参与状态聚合 |
| 用户手动输入"查询任务 xxx 进度"(不走刷新按钮) | LLM 仍会调 `get_task_result`,卡片状态正常更新;防抖不约束手输路径(用户自己负责) |

---

## 10. 业界对照(简表)

| 产品 | 长任务呈现 | 我们的取舍 |
|---|---|---|
| Devin | 独立任务面板 + 后台轮询 + 全局通知 | ADR-013 已排除,工期 & 用户量不匹配 |
| Cursor Background Agent | 对话流内卡片 + 点击查看详情面板 | 形态最接近本 spec,但他们走 SSE 实时进度 |
| ChatGPT Code Interpreter | 对话流内 inline progress + 完成后 inline 结果 | 单 turn < 1 min,与我们 30min 长任务场景不匹配 |
| OpenAI Batch API | 异步任务 + 用户主动查询 | 形态最接近本 spec(查询触发 + 终态结果) |

**Cursor Background Agent + Batch API 的组合形态** = 本 spec 当前取舍。当 UXR 后端把单次任务压到 5 分钟内,直接演化到 Cursor 形态(SSE 流式)。

---

## 11. 文件组织

按 CLAUDE.md "页面自包含",全部在 `packages/app/octoapp/pages/insight/` 内:

```
pages/insight/
├── components/
│   ├── task-card/
│   │   ├── index.tsx              # TaskCard 容器
│   │   ├── status-badge.tsx       # 状态徽章 + 颜色
│   │   ├── action-buttons.tsx     # 刷新 / 终止 / 二次确认 / follow-up
│   │   └── types.ts               # TaskCard / TaskStatus / 防抖 state
│   ├── insight-turn.tsx           # 改造:任务路径与现有 text-detect 路径并行
│   └── ...
├── utils/
│   ├── task-detect.ts             # readStructuredContent / 跨 turn 聚合 / mime → OutputCardType
│   └── task-refresh.ts            # 防抖 Map + 倒计时辅助
└── index.tsx                      # 改造:抽 sendInjectedPrompt;createEffect 切 session 清防抖 Map
```

---

## 12. 验证清单

### 12.0 联调速查 — Console 节点表(粘 Console 定位)

> 准备:打开 InsightPage → 开 DevTools Console → 触发一次"观点解析"模板。
>
> 按以下顺序检查 log,**任何一步缺失就把当时整条 console 输出粘回对话**,基本能立刻定位。

| 步骤 | 操作 | 期望看到的 log | 缺失时的判断 |
|---|---|---|---|
| **1** | 触发"观点解析",输入框发送 | `[octo:prompt] send` 带 `source: "user"` + `template: "..."` | session.prompt 调用失败 → 看 `[InsightPage] prompt failed` |
| **2** | 5 秒内 | `[octo:sse] new part` + `[octo:sse] tool part` 含 `tool: "key_findings"` + `state.status: "completed"` + 展开 `fullPart.state.metadata` / `state.output` 看 task_id 形态 | 无 → MCP 工具没被 LLM 调用;看 agent prompt(`packages/opencode/src/agent/prompt/octo_insight.md` 是否声明了该工具白名单) |
| **3** | 紧接着 | `[octo:task] aggregate diff` 含 `changes: [{ taskId, from: null, to: "pending\|processing" }]` + `snapshot` 数组 | 无 → defensive 解析没命中,**粘 step 2 的 `fullPart` 完整对象**;`readStructuredContent` 三个分支需调 |
| **4** | 卡片渲染后,点 **↻ 刷新** | `[octo:task] refresh click` → `[octo:task] markRefreshed` → `[octo:prompt] send` 带 `source: "task-refresh"` + `text: "查询任务 xxx 的进度"` | "blocked: busy" → 当前 turn 没结束;"blocked: cooldown" → 3 分钟内已刷过 |
| **5** | 几秒后 | 新一条 `[octo:sse] tool part` 含 `tool: "get_task_result"` → `[octo:task] aggregate diff` 含 status 变化 | LLM 没调 get_task_result → 看 agent prompt 是否落了 [mcp-contract.md §LLM 调用规范](../agents/mcp-contract.md) |
| **6** | 状态变 `completed` 后 | `[octo:task] aggregate diff` 含 `status: "completed"` + `hasResourceLink` / `hasResultText` 标记;若 ResultViewer 为空,会自动 `[octo:task] auto-openResult (viewer empty)` | hasResourceLink = false 说明 resource_link 没被识别;粘 step 5 的 `fullPart` |
| **7** | 点 **📄 查看完整结果**(或自动 openTab 触发) | `[octo:task] openResult` → 切到 source: "uri" 时 `[octo:resource] fetch start` → `[octo:resource] fetch ok` 含 bytes 数 | `fetch failed` → 看 status / statusText;`fetch error` → 跨域 / 网络层 / URL 不可达 |
| **8** | 点 **⏹ 终止** → "确定终止" | `[octo:task] stop click` → `[octo:task] stop confirmed` → `[octo:prompt] send` 带 `source: "task-stop"` | 同 step 4 排查 |
| **9** | 点 **💬 在对话里继续讨论** | `[octo:task] followup seed` + 输入框出现种子文本 `基于 task xxx(...)的结果,我想…` | 输入框未填 → setPrompt 调用失败,看 SolidJS 报错 |
| **10** | 切换 session | `[octo:task] session switched, view state reset (refresh cooldown preserved)` | 无 → params.id 没变化,路由问题 |

**特殊情况**:**操作后毫无 console 反应**(即上述任何 log 都不出现)→ SSE 通道断了或 globalSDK 初始化失败,看页面顶部网络状态 / 重启 app。

**给 Claude 粘 Console 的最佳格式**:
1. 完整 console(不要截断,我需要看 fullPart 等大对象)
2. 说明当前操作了什么(粘哪一步 step 之前 / 之后)
3. 说明卡在哪里(卡片没出现 / 出现了但状态没变 / 按钮点了没反应)

---

### 12.1 触发与识别

- [ ] 用 "观点解析" 模板调 `key_findings`,Console 出现 `[octo:sse] tool part` 日志,部分内容含 `task_id`
- [ ] 对话流第一条 assistant 消息位置渲染任务卡片,状态 `pending` 或 `processing`
- [ ] 卡片显示工具名(中文化:"观点解析"等)、task_id 缩短显示(前 8 位 + ...)、提交时间

### 12.2 刷新

- [ ] 点击 [↻ 刷新] → 对话流出现 user 消息 "查询任务 xxx 进度"
- [ ] LLM 调 `get_task_result` 后,**同一卡片**(不是新卡片)状态更新
- [ ] 3 分钟内再次点刷新,按钮显示倒计时 + 不可点
- [ ] 倒计时每秒减少,到 0 后按钮恢复可用
- [ ] hover 冷却中的按钮,tooltip 显示防抖说明

### 12.3 终止

- [ ] 点击 [⏹ 终止] → 卡片内出现二次确认行(不弹 Modal)
- [ ] 点 [取消] → 确认行消失,无副作用
- [ ] 点 [确定终止] → 对话流出现 user 消息 "终止任务 xxx"
- [ ] LLM 调 `stop_task` 后卡片切 `stopped` 态,刷新 / 终止按钮收起

### 12.4 完成

- [ ] LLM 调 `get_task_result` 返回 `completed` 后,卡片切 `completed` 态,显示摘要 + 操作按钮
- [ ] 点 [📄 查看完整结果] → 右侧 ResultViewer 新增 Tab(或激活已有同 id Tab),渲染走现有 OutputCard 路径
- [ ] ResultViewer 此前为空时,首个 completed 任务自动 openTab
- [ ] 点 [💬 在对话里继续讨论] → 输入框填入 `基于 task xxx 的结果,我想...`,光标定位,不自动发送

### 12.5 状态聚合

- [ ] 同一 task_id 在 turn 1 提交 + turn 2 / 3 查询 → 卡片只在 turn 1 渲染,turn 2 / 3 的 part 仅触发卡片状态更新
- [ ] 切到另一个 session 再切回,卡片状态从消息历史正确恢复(无需 SSE 重放)

### 12.6 边界

- [ ] session busy 时,刷新 / 终止按钮禁用
- [ ] 失败任务(`failed`)卡片正确显示错误消息,无刷新 / 终止按钮
- [ ] 冷却中切到其他 session 再切回,刷新按钮仍显示剩余倒计时(不可借切换绕过防抖)
- [ ] 关闭 app 重开后,历史 task_id 卡片正确渲染,刷新按钮可用(冷却 Map 不持久化,符合预期)

---

## 13. Phase 与依赖

| 工作项 | Phase | 依赖 |
|---|---|---|
| `readStructuredContent` helper(联调确认 part 形态) | 第 1 步 | UXR MCP 至少一个业务工具能跑通(返回 task_id) |
| TaskCard 数据模型 + 跨 turn 聚合 memo | 第 1 步 | 同上 |
| TaskCard UI(5 种状态视觉态) | 第 2 步 | octo-tokens success / danger 颜色定义(可与设计同步) |
| 刷新按钮 + 防抖 | 第 3 步 | — |
| 终止按钮 + 行内二次确认 | 第 3 步 | — |
| `completed` 衔接 OutputCard / tabStore | 第 4 步 | 决策方案 A(临时)/ 方案 B(扩 source 字段)(§8.2)与本任务对齐 |
| "在对话里继续讨论" 按钮 | 第 5 步(P1 可选) | — |

每完成一步 review 一次(对应用户原始任务的 "每完成一块及时给我 review")。

---

## 14. 与其他 spec 的引用关系

| 引用方 | 引用项 | 说明 |
|---|---|---|
| 本 spec → [ADR-013](../../adr/013-long-task-progress-strategy.md) | 决策依据 / 不做范围 | 形态由 ADR-013 钉死,本 spec 不重复论证 |
| 本 spec → [mcp-contract.md](../agents/mcp-contract.md) | task_id / get_task_result / stop_task 契约 / LLM 调用规范 | 接口语义以 mcp-contract.md 为准,本 spec 不复述 |
| 本 spec → [output-renderers.md](output-renderers.md) | OutputCard 渲染 / §2.5 resource_link 路径 | `completed` 复用,本 spec 不重写 |
| 本 spec → [insight-overview.md](insight-overview.md) | InsightPage 整体三栏布局 | 本 spec 仅扩对话流(左栏)内的 turn 渲染 |
| 本 spec → [task-panel.md](task-panel.md) | "产出 tab" 概念 | 边界澄清(§"与现有组件的边界"),不动 task-panel 已落地的 ResultViewer 部分 |
| [ROADMAP.md](../../../ROADMAP.md) → 本 spec | 实现条目 | 按 [M] ui 加入"当前"或"P1"区,引用 ADR-013 + 本 spec |
