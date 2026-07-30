# SPEC-INS-007 — 产品流程改版:预置提示词 + promptAsync + 输入区整改

> 状态:✅ 主体已落地(预置提示词 + promptAsync + FIFO 队列)· 优先级 P0 · 规模 [L] · 领域 ui/insight · 类型:实现 spec
>
> 代码在 UXAI 仓 `packages/app/octoapp/pages/insight/`(`store/preset-prompts.ts` + `components/preset-prompts.tsx`)。行号为实现时快照。
>
> **上游已实现**:
> - ✓ promptAsync + optimistic 标准发送链路([prompt-input/submit.ts](../../../packages/app/octoapp/components/prompt-input/submit.ts) `sendFollowupDraft`)
> - ✓ 输入区 busy 期间允许键入(chat 的 contenteditable 全程可编,见 [prompt-input.tsx:1339](../../../packages/app/octoapp/components/prompt-input.tsx))
> - △ followup queue 子系统([session.tsx:541-1678](../../../packages/app/octoapp/pages/session.tsx))**深度耦合 settings / persist / composer**,本期不整体复用,自实现轻量版(理由见 §2.3)
> - ✗ "预置提示词按钮组"(上游只有斜杠命令 [slash-popover.tsx](../../../packages/app/octoapp/components/prompt-input/slash-popover.tsx),交互形态不同)

---

## 1. 背景与目的

### 1.1 触发动机

[SPEC-INS-005](insight-data-layer-reuse.md) PR1 修完数据层 bug 后,审视当前提示词模板交互(PromptTemplateSelector 下拉)发现两个产品级问题:

1. **session 级元提示词污染**:当前模板通过 `system` 字段传入,**每个 turn 都带**(ADR-007),用户切换话题时前一段 system 仍在影响 LLM 行为,只能新建 session 才能脱离
2. **下拉框对"任务触发"语义弱**:用户实际意图是"我要触发 X 任务",但下拉框 + 输入框组合让用户以为还要再写一段描述

### 1.2 改版目标

把"提示词模板 = session 元设定"转成"**预置提示词 = 单次任务录入**":

- 输入框顶部加横向滚动的圆角按钮(每个对应一个 MCP 任务触发 tool)
- 点击 → 把模板文本填入输入框(用户可再编辑)→ 用户点发送 → 单次 turn 调对应 tool
- **不再走 `system` 字段**(消除 session 级污染)

同时**顺手吃掉**两个挂在 005 spec 的工作(避免重复改 doSendPrompt):

- 原 PR2:`session.prompt` → `session.promptAsync` + optimistic(消除"点完按钮屏幕没反应")
- 原任务 2:textarea `disabled` 整改 + 简化 queue(对齐主流 chat 体感)

### 1.3 一句话总结

一次 PR 完成:**新产品流程 + 体验对齐 chat**。

---

## 2. 架构决策(列业界对比)

### 2.1 模板交互形态(session 元 vs 单 turn 录入 vs tool 激活)

| 模式 | 代表 | 适合什么 | 用在 insight 的痛点 |
|---|---|---|---|
| Session 元提示词 | GPTs instructions / Claude Project / Cursor rules | 整段对话的**角色定型** | 用户中途换话题时前文指令仍在污染 ← **当前方案痛点** |
| **单 turn 模板填充** ★ 采用 | ChatGPT Suggested replies / Claude 斜杠命令预填 / IDE quick action | **临时触发一个具体任务** | 用户每次要重新点(可接受) |
| Tool 激活 toggle | Gemini 生图 / ChatGPT canvas/search/data analyst | 强制 LLM 调特定 tool **多轮** | insight 当前不需要;模板文本已能精确驱动 MCP tool,加 toggle 是冗余 UI 状态 |

**采用:单 turn 模板填充**。tool 激活留 backlog,触发条件见 §9。

### 2.2 模板 ↔ tool 映射策略

| 策略 | 描述 | 选择 |
|---|---|---|
| **1:1**(本期) | 每个预置按钮对应一个 MCP tool。~~文本明示 tool 名~~ → 2026-06-15 起文本改纯中文,工具映射由 agent 提示词「工具选择指南」承担,但按钮↔tool 仍是 1:1 | ✓ 当前 4 个长任务 tool 数量适中,1:1 关系最清晰 |
| 1:N | 一个按钮触发一个意图,LLM 自由选 tool | ✗ LLM 选错 tool 风险大,排查成本高 |

> **2026-06-15 说明**:本期仍是 1:1(一个按钮稳定对一个 tool),只是**触发方式从"文本明示工具名"退回到"文本描述意图、模型映射"**。这把"选对 tool"的责任从客户端文本转移到了模型 + 系统提示词,弱模型场景下的鲁棒性见 §6 风险表与 §11 升级阶梯。
| N:1 | 多个按钮对应同一 tool 的不同变体 | ✗ 当前 tool 没有"变体"语义 |

### 2.3 Queue 策略(简化版 vs 完全复用 vs 不做)

| 方案 | 代码量 | 用户感知 | 选择 |
|---|---|---|---|
| **A. 简化 queue**(单容量、内存、无 dock、无设置项)★ 采用 | ~30 行 | busy 时打字 + enter 输入框清空,状态栏轻提示"排队中",idle 自动发出 | ✓ 覆盖 80% 场景;可向后扩 |
| B. 完全复用上游 followup | 引入 settings/persist 改动 + composer state 适配,几百行 | 多条排队 + 持久化 + 编辑 + 删除 | ✗ insight 用户极少同时排 3+ 条任务;过度 |
| C. 不做 queue | 0 | busy 时只能干等 | ✗ 体验差 |

### 2.4 错误展示(toast vs notification panel vs silent)

| 方案 | 描述 | 选择 |
|---|---|---|
| **toast** ★ 采用 | promptAsync reject → 调用方 catch → showToast,与 chat [submit.ts:570](../../../packages/app/octoapp/components/prompt-input/submit.ts) 一致 | ✓ 用户瞬时感知 |
| notification panel | 走 [NotificationProvider](../../../packages/app/octoapp/context/notification.tsx) 列表 + 系统通知 | △ 已经在用,仅作为补充(LLM 中途 SSE error) |
| silent console.error | 当前实现 | ✗ 用户感知不到 |

---

## 3. 改动清单

按改动域分 3 个 subsection。**一个 PR 完成**,不再拆。

### 3.1 预置提示词按钮组(替换 PromptTemplateSelector)

#### 3.1.1 数据 schema

新建 [packages/app/octoapp/pages/insight/store/preset-prompts.ts](../../../packages/app/octoapp/pages/insight/store/preset-prompts.ts),替换现有 [store/prompt-template.ts](../../../packages/app/octoapp/pages/insight/store/prompt-template.ts):

```typescript
export type PresetPrompt = {
  id: string                  // 与 expectedTool 同名,便于追踪
  label: string               // 按钮上的短文案 (4-6 字最佳)
  text: string                // 点击后填入输入框的文本
  expectedTool: string        // 预期调用的 MCP tool 名(spec §2.2 1:1 关系)
  categories: string[]        // 外网将按 category 过滤;本期 octo 不读
  description?: string        // 可选:tooltip 用,本期可不填
}

export const PRESET_PROMPTS: PresetPrompt[] = [/* 见 §3.1.2 */]
```

**关键设计点**:
- `categories: string[]` **本期必填(可空数组)**,目的:外网未来加分类筛选时不用破坏性改 schema(响应用户原话"业务上后续可能会在外网再加一个页面")
- `expectedTool` 不参与 UI,**仅用于追踪 / 审计 / 调试日志**(后续可加 console.log 验证 LLM 实际调用是否与预期一致)
- 删除原 `group / systemHint` 字段:新方案不走 `system` 字段、不分组

#### 3.1.2 预置内容(初版,可微调)

> **修订(2026-06-15):去掉 text 里的明示工具名,改用设计师友好中文。**
>
> 2026-05-27 版为"text 前补 `请使用 X 工具`"以保证 LLM 100% 调对工具。但该写法把英文 MCP 工具名暴露在用户可见的输入框文本里,设计师反馈不友好。本次按设计师文案改为纯业务中文,**工具选择改由 agent 系统提示词 [octo_insight.md](../../../packages/opencode/src/agent/prompt/octo_insight.md) 的「工具选择指南」表负责**(把该表从"自由输入兜底"提升为"主路径",并补齐 `观点解析 / 评估问题分析` 等设计师文案关键词)。
>
> **决策反转依据**:设计师文案仍保留强关键词(观点 / 聚类 / 思维导图 / 可用性测试),与指南表逐词对得上;真正难的"多角色文件拆桶"不受文案影响。代价是放弃了"明示工具名"这条对弱模型最稳的捷径——**故必须配套内网弱模型评测,失败时按 §11 升级阶梯回退**。

label 与 text 由设计师统一给出:**label 用业务语义**(用户看到的按钮文字),**text 为纯业务中文、不含工具名**:

```typescript
export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: "key_findings",
    label: "观点解析报告",
    expectedTool: "key_findings",
    categories: ["interview"],
    text: "基于上传的访谈逐字稿,解析用户观点并生成报告。",
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    expectedTool: "run_guide_analysis",
    categories: ["interview"],
    text: "基于上传的访谈大纲和逐字稿,聚类用户观点并生成报告。",
  },
  {
    id: "mindmap",
    label: "思维导图",
    expectedTool: "mindmap",
    categories: ["interview"],
    text: "基于上传的逐字稿,生成思维导图。",
  },
  {
    id: "run_usability_analysis",
    label: "评估问题分析",
    expectedTool: "run_usability_analysis",
    categories: ["usability"],
    text: "基于上传的任务书和逐字稿,做可用性测试分析并生成报告。",
  },
]
```

> `expectedTool` 字段保留:它本就只用于追踪/审计,正好可在内网联调时对账「文案 → 实际 tool call」是否与预期一致(见 §11 评测)。

**多文件角色识别(如按提纲聚类的"大纲 vs 逐字稿")责任归 MCP tool description**(UXR 团队),客户端 prompt 不重复定义。详见 [mcp-contract.md §Tool 描述写法原则](../agents/mcp-contract.md)。

**不本期上的一个**:
- `search_reports` / 知识问答:**引用型工具,UX 与产物型差异大,本期不开预置入口**。该工具契约已在 [mcp-contract.md §引用型工具契约](../agents/mcp-contract.md#引用型工具契约) 定义(`_octoDisplay: "reference"` + ReferenceList chip 清单),与产物型(OutputCard 大卡)的渲染模型完全不同。要做胶囊需要先理顺"问答类预置"的整体交互方向(单 turn 触发 / 上下文连续追问 / 角标定位 / chip 收起等),作为独立专题做,**不在本 PR 范围**。当前用户仍可通过自由对话触发(LLM 自然语言识别)。

**初版**:本 PR 落地后跟内网联调时可再微调文案。

#### 3.1.3 UI 组件

新建 [packages/app/octoapp/pages/insight/components/preset-prompts.tsx](../../../packages/app/octoapp/pages/insight/components/preset-prompts.tsx):

```tsx
type Props = {
  prompts: PresetPrompt[]
  onClick: (preset: PresetPrompt) => void
  disabled?: boolean
}

export function PresetPrompts(props: Props): JSX.Element {
  let scrollRef!: HTMLDivElement
  const [canScrollRight, setCanScrollRight] = createSignal(false)

  const updateScrollState = () => {
    if (!scrollRef) return
    setCanScrollRight(scrollRef.scrollLeft + scrollRef.clientWidth < scrollRef.scrollWidth - 1)
  }

  const scrollRight = () => {
    scrollRef?.scrollBy({ left: scrollRef.clientWidth * 0.6, behavior: "smooth" })
  }

  onMount(() => {
    updateScrollState()
    // ResizeObserver 监听容器宽度变化,刷新箭头可见性
    const ro = new ResizeObserver(updateScrollState)
    if (scrollRef) ro.observe(scrollRef)
    onCleanup(() => ro.disconnect())
  })

  return (
    <div class="relative flex items-center">
      <div
        ref={scrollRef!}
        class="flex gap-1.5 overflow-x-auto scrollbar-hide"
        onScroll={updateScrollState}
      >
        <For each={props.prompts}>
          {(preset) => (
            <button
              type="button"
              onClick={() => props.onClick(preset)}
              disabled={props.disabled}
              class="octo-preset-chip"   /* 在 octo-tokens.css 加样式 */
              title={preset.description ?? preset.text}
            >
              {preset.label}
            </button>
          )}
        </For>
      </div>
      <Show when={canScrollRight()}>
        <button type="button" onClick={scrollRight} class="octo-preset-scroll-right" aria-label="向右滚动">
          →
        </button>
      </Show>
    </div>
  )
}
```

**样式约束**(写进 `octo-tokens.css`):
- 胶囊圆角 `border-radius: 999px`,padding `4px 12px`,字号 `12px`
- 横向滚动:`overflow-x: auto` + 隐藏滚动条
- 右滚箭头:绝对定位,带背景渐变遮罩(暗示更多内容)
- `disabled` 状态:半透明 + cursor not-allowed(busy 时禁用)

#### 3.1.4 InsightPage 接线

```tsx
// 删除 PromptTemplateSelector 相关 state / import
// const [templateId, setTemplateId] = createSignal(DEFAULT_TEMPLATE_ID)  ← 删

// 加预置点击处理
function handlePresetClick(preset: PresetPrompt) {
  setPrompt(preset.text)
  console.log("[octo:preset] click", { id: preset.id, expectedTool: preset.expectedTool })
  // focus 输入框,让用户可继续编辑或直接 enter 发送
  textareaRef?.focus()
}

// JSX 布局:
<AttachmentBar ... />
<PresetPrompts prompts={PRESET_PROMPTS} onClick={handlePresetClick} disabled={isBusy()} />  {/* ← 新增,在输入框上方 */}
<div class="rounded-[var(--octo-radius-lg)] ...">
  <textarea ... />
  <div class="flex items-center gap-2 px-2.5 pb-2.5">
    <button> 附件 </button>
    {/* ← 删除 <PromptTemplateSelector ... /> */}
    <button class="ml-auto"> 发送 </button>
  </div>
</div>
```

### 3.2 promptAsync + optimistic(吞原 PR2)

完整实施细节见 [SPEC-INS-005 §3.2(2026-05-25 修订版)](insight-data-layer-reuse.md#32-pr2发消息链路改-promptasync--optimistic) 和 [§12 修订记录](insight-data-layer-reuse.md#12-pr2-修订记录2026-05-25)。**关键改动复述**:

- `doSendPrompt` 内:`Identifier.ascending("message")` 预生成 messageID → `sync.session.optimistic.add({ sessionID, message, parts })` → `globalSDK.client.session.promptAsync({ ..., messageID })`
- catch:`sync.session.optimistic.remove({ sessionID, messageID })` + `showToast({ title: "发送失败", description })`
- **去掉 `system` 字段传递**(本 PR 同时移除模板机制,system 不再有内容);agent 默认提示词不受影响
- 删除 `sending()` 信号,所有使用点改 `isBusy()`
- 去掉 `try/catch` 后 `console.error` silent 输出

**与 005 §3.2 不同的一点**:由于本 PR 同时移除 PromptTemplateSelector,`doSendPrompt` 的 `promptPayload` 不再有 `system: template.systemHint` 字段。

### 3.3 输入框 disabled 整改 + 简化 queue(吞原任务 2)

#### 3.3.1 textarea disabled 解除

```tsx
// 当前:
<textarea ... disabled={inputDisabled()} />  // inputDisabled = sending() || isBusy()

// 改后:
<textarea ... />  // 不再 disabled,用户全程可编辑(对齐 chat、ChatGPT、Claude Code)
```

textarea 的视觉 disabled 样式(灰色文字)也一并去掉。

#### 3.3.2 send 按钮 disabled 调整

```tsx
// 当前:
<button disabled={!prompt().trim() || inputDisabled() || hasUploadingAttachments()}>

// 改后:
<button disabled={!prompt().trim() || hasUploadingAttachments()}>  // 不再因 busy 禁用
```

**注意**:虽然 send 按钮 busy 时可点,但 click 处理走 queue 路径(见下)。视觉上 busy 时按钮文案/图标可以微调成"⏎ 排队"(可选,本 PR 可不实现)。

#### 3.3.3 FIFO 多容量 queue(内存、无 dock、无持久化)

> ⚠️ **修订(2026-07-30)——drain 触发器架构已迁出页面,见 [SPEC-INS-027 会话排队 drain 运行器](session-queue-runner.md)**：本节下面的 `createEffect(on(isBusy, …, {defer}))` in-page flush 触发器是**已知缺陷来源**——切到 `/skills` 路由页或相邻 agent tab 时 insight 页面卸载,该 effect 被 dispose,会话后台跑完的 busy→idle 边沿没人听 → 排队死等。**队列语义(FIFO、入队追加、逐条 flush、一条一回合)仍以本节为事实层**;drain 触发器改为「应用根常驻、UI 无关、level-triggered + in-flight 守卫」的全局 runner,详见 027。下方代码保留作历史设计记录。

> **修订(2026-06-09)**:原方案为「单容量、第二次 submit 覆盖上一次」。上线后用户反馈「busy 时连发 3 条,只有最后一条生效」——正是 §6 风险表与 §9 后续预留的升级触发条件(「被反馈丢消息」/「经常排 3+ 条」)。本节据此升级为 **FIFO 多容量队列**。仍**不做** dock / 持久化(reload 丢失),那两项触发条件未到。

`queuedText: string | null` 升级为 `queue: string[]`。入队 **push 追加**;busy→idle 时**逐条 flush**(每次只发队首一条,该条发出后 session 重新进入 busy,下次 idle 再 flush 下一条)——这样既保持发送顺序,又让每条各占一个独立 turn(对齐 chat「一条一回合」体感)。

```typescript
const [queue, setQueue] = createSignal<string[]>([])

async function handleSubmit() {
  const text = prompt().trim()
  if (!text || hasUploadingAttachments()) return
  setPrompt("")

  // busy 时入队(FIFO 追加,不再覆盖)
  if (isBusy()) {
    setQueue((q) => [...q, text])
    console.log("[octo:queue] enqueued", { sessionID: params.id, len: text.length, depth: queue().length })
    return
  }

  let sid = params.id
  if (!sid) {
    sid = await createAndNavigate()
    if (!sid) return
  }
  await sendMessage(sid, text)
}

// busy → idle 自动 flush 队首一条;链式触发(发出→busy→idle→flush 下一条)
createEffect(on(isBusy, (busy, prev) => {
  if (!prev || busy) return
  const q = queue()
  const sid = params.id
  if (q.length === 0 || !sid) return
  const [next, ...rest] = q
  setQueue(rest)
  console.log("[octo:queue] flushing", { sessionID: sid, len: next.length, remaining: rest.length })
  void sendMessage(sid, next)
}, { defer: true }))
```

**逐条 flush 的依据**:`sendMessage` 内部走 `promptAsync` + optimistic,发出后 session 立即转 busy;待该 turn 结束转 idle,同一个 effect 再次触发,弹出下一条。无需额外定时器或循环。若某条发送后 session **始终不进入 busy**(异常),链路会停在该处,剩余队列保留可见——与单容量时代「no-feedback watchdog」同一风险类,不新增处理。

#### 3.3.4 队列提示条 UI(多条列表)

在输入框上方显示一个轻提示卡:顶部一行「排队中 N」,下方按 FIFO 顺序逐条列出,每条带序号 + 文本 + 单条移除按钮(`queue().length > 0` 时显示):

```tsx
<Show when={queue().length > 0}>
  <div class="octo-queue-banner">
    <span class="octo-queue-banner-label">排队中 {queue().length}</span>
    <div class="octo-queue-banner-list">
      <For each={queue()}>{(item, i) => (
        <div class="octo-queue-banner-item">
          <span class="octo-queue-banner-index">{i() + 1}</span>
          <span class="octo-queue-banner-text">{item}</span>
          <button type="button" class="octo-queue-banner-cancel"
                  onClick={() => removeQueued(i())}
                  title="移除这条(输入框为空时回填,便于编辑)" aria-label="移除排队项">×</button>
        </div>
      )}</For>
    </div>
  </div>
</Show>
```

**单条移除规则**(`removeQueued`):从队列剔除该条;若当前输入框**为空**,把被移除的文本回填到输入框便于编辑;若输入框已有草稿则直接丢弃(不覆盖草稿)。

```typescript
function removeQueued(index: number) {
  const item = queue()[index]
  if (item === undefined) return
  setQueue((q) => q.filter((_, i) => i !== index))
  setPrompt((cur) => (cur ? cur : item))   // 输入框为空才回填,避免覆盖草稿
  console.log("[octo:queue] removed", { index, remaining: queue().length })
}
```

#### 3.3.5 abort / 切 session 时清空整个 queue

- **切 session**:清空,避免「在 session A 排的队被错发到 session B」。
- **abort**(用户点停止):清空**整个**队列(不逐条回填——abort 是明确的「全部停下」意图;多条无法都塞回输入框)。

```typescript
const clearQueue = () => setQueue([])

// 切 session reset 块内:
clearQueue()

// handleAbort 内,先于 session.abort:
if (queue().length) clearQueue()
```

---

## 4. 数据迁移 / 兼容性

- **删除**:[store/prompt-template.ts](../../../packages/app/octoapp/pages/insight/store/prompt-template.ts)、[components/prompt-template-selector.tsx](../../../packages/app/octoapp/pages/insight/components/prompt-template-selector.tsx) 整个文件
- **新建**:[store/preset-prompts.ts](../../../packages/app/octoapp/pages/insight/store/preset-prompts.ts)、[components/preset-prompts.tsx](../../../packages/app/octoapp/pages/insight/components/preset-prompts.tsx)
- 用户**无持久化数据**依赖被删字段(`templateId` 只是组件 state,不存 localStorage / persist)。无迁移成本。
- 内网集成手册 [docs/intranet-handoff.md](../../intranet-handoff.md):本 PR **会触发**对外契约变化(模板机制改变),按 CLAUDE.md "内网集成手册维护" 在合入物里程碑前更新。

---

## 5. 不做什么(明确边界)

| 不做项 | 理由 / 触发条件 |
|---|---|
| **Tool 激活 toggle**(Gemini 模式) | §2.1 已分析,预置提示词文本已能精确驱动 MCP tool;触发条件:用户反馈"重复点烦"或 LLM 选错 tool 严重 |
| **外网分类筛选 UI** | 业务上属外网新页面,octo 本期只在 schema 预留 `categories` 字段 |
| **queue dock**(独立面板 / 拖拽排序 / 编辑已排项) | §2.3 已分析,过度;FIFO 多容量已覆盖「连排 3+ 条」诉求(2026-06-09 升级,见 §3.3.3),dock 触发条件未到 |
| **queue 持久化**(reload 后还在) | 触发条件:用户反馈"reload 丢消息";当前为内存队列 |
| **预置按钮 icon / 配色 / tooltip 富文本** | 等设计师切图;本期文字按钮够用,登记到 [design-assets-needed.md](design-assets-needed.md) |
| **预置按钮上显示"会调用 X tool"提示** | `expectedTool` 字段已留,未来要加只是 UI 改动 |
| **send 按钮 busy 时改文案为"⏎ 排队"** | 锦上添花,本 PR 可省;若实施成本 < 5 行可顺手 |
| **LLM 中途 session.error toast** | 与 chat 行为一致(走 NotificationProvider 列表);触发条件:用户反馈"出错没提示" |
| **`expectedTool` 实际调用一致性校验**(对账 console) | 留到内网联调阶段;本 PR 只埋 console.log,不做断言 |

---

## 6. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| 预置文本对 LLM 调用准确性不足(LLM 没调对 tool) | **中→高(2026-06-15 文案去工具名后升级)** | ~~强制文本提名 tool 名~~ 已撤;现依赖系统提示词「工具选择指南」做意图映射(已补齐设计师文案关键词)。**强制内网弱模型评测**:对账 `[octo:preset].expectedTool` 与实际 tool call,不一致先改文案/指南关键词;仍不行按 §11 升级阶梯回退(最终可恢复文本明示工具名) |
| `search_reports` 用户不知道有这个能力(没胶囊) | 低 | 自由对话可触发;"问答类预置"作为独立专题排期 |
| ~~queue 容量=1 第二次 submit 覆盖第一次~~ → **已升级 FIFO 多容量**(2026-06-09) | — | §3.3.3:入队 push 追加 + idle 逐条 flush;原"丢消息"风险消除 |
| 多条 flush 顺序错乱 / 并发发送 | 中 | 逐条 flush,每条占独立 turn(发出→busy→idle→下一条);同一 effect 串行,无并发 promptAsync |
| busy→idle flush 时机:用户已手动清队列但 effect 还没跑 | 低 | flush effect 读 `queue()`,空数组自然 noop |
| 切 session 时 queue 没清干净导致错发 | 中 | §3.3.5 effect 已处理,checklist 必测 |
| optimistic + queue 链路联动时序(queue flush 时 optimistic add 是否仍正确)| 中 | `sendMessage` → `doSendPrompt` 内部统一走 optimistic.add,与首次发送同路径,无特殊处理 |
| 移除 system 字段后,LLM 行为变化(原本被元提示词约束的输出格式可能丢失)| 低 | 预置文本里**显式说明输出格式**(如"以三列 Markdown 表格输出"),已在 §3.1.2 体现 |
| PresetPrompts 的 ResizeObserver 在某些早期 webkit 下不存在 | 低 | Electron 14+ 内置 chromium,有 ResizeObserver,不兼容旧 webview |

---

## 7. checklist

### 7.1 功能

- [ ] 输入框顶部出现 4 个圆角按钮("观点解析 / 按提纲聚类 / 思维导图 / 可用性分析")
- [ ] 容器变窄时,按钮溢出区域可横向滚动;右侧出现"→"快速右滚按钮,滚到底时箭头消失
- [ ] 点击按钮 → 输入框被填入对应文本 → textarea 自动 focus → 用户可编辑后 enter 发送
- [ ] 发送后立即在消息列表看到自己说的话(optimistic)
- [ ] LLM 响应正常显示;optimistic 消息平滑合并(不闪烁、ID 不变)
- [ ] busy 期间 textarea **可继续键入**,光标不被强制移开
- [ ] busy 期间点 send 或按 enter → 输入框清空 + 上方提示条出现 + 计数为 1
- [ ] busy 期间**连发多条** → 提示条按顺序追加列出,「排队中 N」计数递增(**不再覆盖**)
- [ ] LLM idle 后,队列**按 FIFO 顺序逐条**自动发出(一条回完再发下一条),全部发完提示条消失
- [ ] 单条移除按钮 ×:从队列剔除该条;输入框为空时回填该条文本,非空时直接丢弃不覆盖草稿
- [ ] abort(停止)→ 整个队列清空,提示条消失
- [ ] 切 session → 队列清空,不会错发到新 session
- [ ] 任务卡片"刷新 / 终止"按钮链路正常(走 promptAsync + optimistic)

### 7.2 错误 / 边界

- [ ] 断网点发送 → toast "发送失败" + optimistic 消息被清除
- [ ] 模型 401 / 服务端 4xx → toast 提示对应描述
- [ ] 附件上传中点 send → 按钮 disabled,无反应
- [ ] 空文本点 send → 无反应
- [ ] 无 `console.error("[InsightPage] prompt failed", ...)` silent 残留

### 7.3 控制台日志

- [ ] `[octo:preset] click` 出现且 `expectedTool` 字段正确
- [ ] `[octo:queue] enqueued` 在 busy 时触发,`depth` 随连发递增
- [ ] `[octo:queue] flushing` 在每次 busy→idle 触发,`remaining` 递减到 0
- [ ] `[octo:queue] removed` 在点单条 × 时触发
- [ ] `[octo:prompt] sent (async)` 与 `[octo:prompt] optimistic added` 配对

### 7.4 删除清理

- [ ] [store/prompt-template.ts](../../../packages/app/octoapp/pages/insight/store/prompt-template.ts) 文件已删
- [ ] [components/prompt-template-selector.tsx](../../../packages/app/octoapp/pages/insight/components/prompt-template-selector.tsx) 文件已删
- [ ] InsightPage 不再 import `PromptTemplateSelector` / `PROMPT_TEMPLATES` / `DEFAULT_TEMPLATE_ID` / `PromptTemplateId`
- [ ] 删 `templateId / setTemplateId` signal 及所有使用点
- [ ] 删 `sending / setSending` signal 及所有使用点
- [ ] `system: template.systemHint` 字段从 promptPayload 移除

### 7.5 人工验证脚本:FIFO 多容量队列(2026-06-09 升级专项)

> 目的:复现并验证「busy 连发 3 条只剩最后一条」已修复。打开 DevTools Console 过滤 `[octo:queue]` 同步观察。每条提示词都设计成**让 LLM 输出里明确回显序号**,这样在消息列表里一眼能看出三条是否都按序生效。

**场景 A — 连发 3 条全部按序生效(核心回归)**

1. 新建会话,发送第 1 条触发 LLM 进入 busy:
   > `请逐条、慢一点回答我接下来的问题,每条回答开头都先重复我这条问题的编号。第一条:用一句话解释什么是用户体验地图。`
2. 趁 LLM 还在回答(busy),**不等它结束**,连续发送:
   > `第二条:用一句话解释什么是可用性测试。`
   > `第三条:用一句话解释什么是 A/B 测试。`
3. 预期:
   - [ ] 提示条显示「排队中 2」,列出「第二条…」「第三条…」两行,顺序与发送一致
   - [ ] Console:两条 `[octo:queue] enqueued`,`depth` 依次为 1、2
   - [ ] 第 1 条回答完 → 自动发出第二条(提示条变「排队中 1」)→ 再回完 → 发出第三条 → 提示条消失
   - [ ] 消息列表最终能看到**三条用户消息 + 三条回答**,回答里依次出现「第一条/第二条/第三条」,**无一丢失、顺序不乱**
   - [ ] Console:两条 `[octo:queue] flushing`,`remaining` 依次为 1、0

**场景 B — 排队中移除中间一条**

1. 重复场景 A 的第 1、2 步,使「排队中 2」(队列:第二条、第三条)。
2. 点「第二条…」行的 ×(此时输入框保持空)。
3. 预期:
   - [ ] 队列只剩「第三条…」,计数变「排队中 1」
   - [ ] 输入框被回填「第二条…」原文(因为输入框当时为空)
   - [ ] Console 出现 `[octo:queue] removed`
   - [ ] LLM idle 后只发出「第三条」;被移除的「第二条」不会自动发出

**场景 C — 移除时不覆盖草稿**

1. 同场景 B 排好队列后,先在输入框里打一段草稿(如 `这是我正在写的草稿`),**不发送**。
2. 点任意排队项的 ×。
3. 预期:
   - [ ] 该排队项被丢弃,输入框草稿 `这是我正在写的草稿` **保持不变**(不被回填覆盖)

**场景 D — abort 清空整个队列**

1. 排好 ≥2 条队列(队列非空且 LLM busy)。
2. 点输入框的停止键(busy 且输入框空时,发送键变停止键)。
3. 预期:
   - [ ] LLM 中止 + 整个队列清空,提示条消失
   - [ ] idle 后**不会**再自动发出任何排队消息

**场景 E — 切 session 不串台**

1. 在 session A 排好 ≥1 条队列。
2. 从侧栏切到另一个 session B。
3. 预期:
   - [ ] 队列清空,提示条消失
   - [ ] 回到 A 或在 B 等待,均**不会**把 A 排的消息错发出去

---

## 8. 实施步骤

1. **本 spec 评审通过**(user review)
2. 新建 [store/preset-prompts.ts](../../../packages/app/octoapp/pages/insight/store/preset-prompts.ts) + [components/preset-prompts.tsx](../../../packages/app/octoapp/pages/insight/components/preset-prompts.tsx)
3. `octo-tokens.css` 加 `.octo-preset-chip` / `.octo-preset-scroll-right` / `.octo-queue-banner` 样式
4. `index.tsx`:
   - 替换 import + 删除模板相关代码
   - 改 `doSendPrompt` 走 promptAsync + optimistic + toast
   - 删除 `sending()` 信号,所有使用点改 `isBusy()`
   - 加 `queuedText` signal + `handleSubmit` queue 逻辑 + busy→idle flush effect
   - 加切 session 清 queue effect
   - JSX 替换 `<PromptTemplateSelector>` 为 `<PresetPrompts>`,加队列提示条
   - 解 textarea / send 按钮的 busy disable
5. 删除 [store/prompt-template.ts](../../../packages/app/octoapp/pages/insight/store/prompt-template.ts) + [components/prompt-template-selector.tsx](../../../packages/app/octoapp/pages/insight/components/prompt-template-selector.tsx)
6. 跑 7.1 / 7.2 / 7.3 / 7.4 checklist
7. 内网包确认:`[octo:preset]` 日志的 expectedTool 与 LLM 实际 tool call 一致
8. 更新 [docs/intranet-handoff.md](../../intranet-handoff.md)(对外契约变更)
9. 改动集中在 `pages/insight/`,不涉及壳 / opencode 上游

---

## 9. 后续 follow-up(本 PR 不做)

- 预置按钮 icon / tooltip 富文本(等设计师切图,登记 [design-assets-needed.md](design-assets-needed.md))
- 预置按钮上标"会调用 X tool"提示(`expectedTool` 字段已留)
- 加入"问答类预置"专题(覆盖 `search_reports` 等引用型工具,见 [insight-references.md](insight-references.md));需独立设计 UX(单 turn 触发 / 连续追问 / 角标 / chip 收起等),与产物型胶囊**不混排**
- ~~queue 升级:多容量~~ **已做**(2026-06-09,FIFO 多容量,见 §3.3.3);剩余 dock / 持久化仍待(条件:用户反馈"reload 丢消息"或需要拖拽排序/编辑已排项)
- Tool 激活 toggle(条件:用户反馈"重复点烦"或 LLM 选错 tool)
- 外网分类筛选页(`categories` schema 已留,本期不写 UI)
- LLM 中途 `session.error` toast(条件:用户反馈"出错没提示")
- `expectedTool` 实际调用一致性校验(对账 console)

---

## 10. 与其他 spec / ADR 的关系

| 文档 | 关系 |
|---|---|
| [SPEC-INS-005](insight-data-layer-reuse.md) | 本 PR 吞掉原 §3.2 PR2 实施;§3.2 内容仍为权威实现细节 |
| [SPEC-INS-006](insight-component-audit.md) | 本 PR 落实 §4.2 的所有"短期行动"P0 项 |
| [ADR-005 提示词模板 vs Subagent](../../adr/005-prompt-template-vs-subagent.md) | 不冲突。ADR-005 决策"用模板不用 subagent",本 PR 改的是模板**交互形态**(下拉 → 按钮)与**作用域**(session → 单 turn),技术路线未变 |
| [ADR-007 提示词模板通过 system 字段传递](../../adr/007-prompt-template-via-system-field.md) | **部分作废**。新方案模板文本走 `parts[0].text`(用户消息正文),不走 `system`。需在 ADR-007 顶部加"被 SPEC-INS-007 部分覆盖"标注 |
| [ADR-008 cascading 配置](../../adr/008-cascading-config.md) | 无影响,本 PR 不动 agent 配置 |
| [mcp-contract.md §提示词模板 → MCP 工具映射](../agents/mcp-contract.md) | 表格内容需要同步更新(去掉 `knowledge_qa`,可能改 `run_usability_analysis` 状态);本 PR 实施后同步更新 |

---

## 11. 弱模型工具意图识别:评测与升级阶梯(2026-06-15)

文案去掉明示工具名后,"选对 tool"完全压在内网弱模型 + 系统提示词上。本节定义**怎么验证它行不行**,以及**不行时按什么顺序加码**——每一级都比前一级更重、更偏离"纯文案",所以**从轻到重逐级试,能停就停**。

### 11.1 先量化:评测怎么做

不靠手感,靠 `expectedTool` 对账(字段本就为此预留):

1. 4 个预置按钮 × 各点 N 次(建议 N≥10),记录每次实际 tool call;
2. 再补一批**自由输入**样本(用设计师文案的近义说法,如"帮我看看访谈里的主要观点""做个评估问题分析"),覆盖不走按钮的路径;
3. 指标:**工具命中率**(实际 tool == expectedTool)。同时分开看两类错误——
   - **选错工具**(如观点解析→调了 mindmap):指南关键词/语义问题;
   - **文件拆桶错**(多角色工具把大纲塞进了 `download_links`):这是另一类、与文案无关的弱模型短板,见 11.3 第 4 级。
4. 通过线建议:预置按钮命中率 ≥95%(按钮是确定意图,应当接近满分),自由输入 ≥85%。

### 11.2 触发判定

- 按钮命中率即可接受(≥95%)→ **维持方案 B,不加码**,只持续盯日志。
- 按钮命中率不达标 → 进入 11.3 升级阶梯,从第 1 级开始。

### 11.3 升级阶梯(从轻到重,够用即止)

| 级 | 手段 | 改哪里 | 代价 | 何时升下一级 |
|---|---|---|---|---|
| **1** | **调指南关键词**:把出错样本的原话补进「工具选择指南」表;给每个工具加一句"何时用/何时不用"的判别语 | 仅 `octo_insight.md`/.txt 提示词 | 极低,纯文案 | 关键词加了仍频繁选错 |
| **2** | **few-shot 示例**:在系统提示词里加 3-4 条"用户这样说 → 调这个工具(含参数雏形)"的完整范例 | 仅提示词(变长,注意弱模型上下文预算) | 低 | 弱模型仍不稳定/上下文吃紧 |
| **3** | **客户端隐藏工具锚点**(原方案 A):按钮显示友好中文,实际发送文本 append `[tool:xxx]`,渲染时剥离;或改用 metadata 旁路而非正文 | InsightPage 发送链路 + 渲染 | 中,侵入原生数据流(本 spec 当初否掉的方案,见会话记录) | 锚点方案有泄漏/维护问题,或想彻底不靠模型选 |
| **4** | **确定性路由,绕开模型选工具**:预置按钮不再发自然语言让模型猜,而是带 `expectedTool` 直接驱动对应 MCP 调用(模型只负责填参数/拆文件,不负责选工具) | InsightPage + agent 调用约定 | 中高,改"按钮=填输入框"的产品语义 | — (这级已基本消除"选错工具";剩下的只有文件拆桶问题) |
| **5** | **回退到明示工具名**(2026-05-27 旧方案):text 重新前缀 `请使用 X 工具` | 仅 `preset-prompts.ts` | 低,但牺牲设计师要的友好文案 | 兜底终点;与设计师确认取舍 |

> 顺序说明:1→2 是"加强提示词",最便宜先试;3→4 是"把选工具的责任从模型搬到客户端代码",治本但侵入;5 是"放弃友好文案"的纯兜底。**多角色文件拆桶错(11.1 第二类错误)**只有第 4 级的"模型只填参数"或 MCP tool description 加强(责任在 UXR 团队,见 [mcp-contract.md](../agents/mcp-contract.md))能根治,前几级对它无效——评测时务必把两类错误分开统计,别用文案手段去治拆桶问题。

### 11.4 不做什么

- 不一上来就上第 3/4 级:方案 B 未经评测就预设它不行,是过度工程。先拿命中率数据。
- 不为单条 badcase 改架构:个别样本错先进第 1 级补关键词。
