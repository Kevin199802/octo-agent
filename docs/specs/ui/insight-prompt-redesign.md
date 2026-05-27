# SPEC-INS-007 — 产品流程改版:预置提示词 + promptAsync + 输入区整改

> 状态:草案 · 优先级 P0 · 规模 [L] · 领域 ui/insight · 类型:实现 spec
>
> **上游已实现**:
> - ✓ promptAsync + optimistic 标准发送链路([prompt-input/submit.ts](../../../packages/app/src/components/prompt-input/submit.ts) `sendFollowupDraft`)
> - ✓ 输入区 busy 期间允许键入(chat 的 contenteditable 全程可编,见 [prompt-input.tsx:1339](../../../packages/app/src/components/prompt-input.tsx))
> - △ followup queue 子系统([session.tsx:541-1678](../../../packages/app/src/pages/session.tsx))**深度耦合 settings / persist / composer**,本期不整体复用,自实现轻量版(理由见 §2.3)
> - ✗ "预置提示词按钮组"(上游只有斜杠命令 [slash-popover.tsx](../../../packages/app/src/components/prompt-input/slash-popover.tsx),交互形态不同)

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
| **1:1**(本期) | 每个预置按钮对应一个 MCP tool,文本明示 tool 名 | ✓ 当前 4 个长任务 tool 数量适中,1:1 关系最清晰 |
| 1:N | 一个按钮触发一个意图,LLM 自由选 tool | ✗ LLM 选错 tool 风险大,排查成本高 |
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
| **toast** ★ 采用 | promptAsync reject → 调用方 catch → showToast,与 chat [submit.ts:570](../../../packages/app/src/components/prompt-input/submit.ts) 一致 | ✓ 用户瞬时感知 |
| notification panel | 走 [NotificationProvider](../../../packages/app/src/context/notification.tsx) 列表 + 系统通知 | △ 已经在用,仅作为补充(LLM 中途 SSE error) |
| silent console.error | 当前实现 | ✗ 用户感知不到 |

---

## 3. 改动清单

按改动域分 3 个 subsection。**一个 PR 完成**,不再拆。

### 3.1 预置提示词按钮组(替换 PromptTemplateSelector)

#### 3.1.1 数据 schema

新建 [packages/app/src/pages/insight/store/preset-prompts.ts](../../../packages/app/src/pages/insight/store/preset-prompts.ts),替换现有 [store/prompt-template.ts](../../../packages/app/src/pages/insight/store/prompt-template.ts):

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

label 与 text 由设计师统一给出(2026-05-27 修订):**label 用业务语义**(用户看到的按钮文字),**text 在设计师文案前补 tool 名**(确保 LLM 100% 调对工具,见 §6 风险表"预置文本对 LLM 调用准确性不足"):

```typescript
export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: "key_findings",
    label: "观点解析报告",
    expectedTool: "key_findings",
    categories: ["interview"],
    text: "请使用 key_findings 工具,基于上传的访谈逐字稿,解析用户观点并生成报告。",
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    expectedTool: "run_guide_analysis",
    categories: ["interview"],
    text: "请使用 run_guide_analysis 工具,基于上传的访谈大纲和逐字稿,聚类用户观点并生成报告。",
  },
  {
    id: "mindmap",
    label: "思维导图",
    expectedTool: "mindmap",
    categories: ["interview"],
    text: "请使用 mindmap 工具,基于上传的逐字稿,生成思维导图。",
  },
  {
    id: "run_usability_analysis",
    label: "评估问题分析",
    expectedTool: "run_usability_analysis",
    categories: ["usability"],
    text: "请使用 run_usability_analysis 工具,基于上传的任务书和逐字稿,做可用性测试分析并生成报告。",
  },
]
```

**多文件角色识别(如按提纲聚类的"大纲 vs 逐字稿")责任归 MCP tool description**(UXR 团队),客户端 prompt 不重复定义。详见 [mcp-contract.md §Tool 描述写法原则](../agents/mcp-contract.md)。

**不本期上的一个**:
- `search_reports` / 知识问答:**引用型工具,UX 与产物型差异大,本期不开预置入口**。该工具契约已在 [mcp-contract.md §引用型工具契约](../agents/mcp-contract.md#引用型工具契约) 定义(`_octoDisplay: "reference"` + ReferenceList chip 清单),与产物型(OutputCard 大卡)的渲染模型完全不同。要做胶囊需要先理顺"问答类预置"的整体交互方向(单 turn 触发 / 上下文连续追问 / 角标定位 / chip 收起等),作为独立专题做,**不在本 PR 范围**。当前用户仍可通过自由对话触发(LLM 自然语言识别)。

**初版**:本 PR 落地后跟内网联调时可再微调文案。

#### 3.1.3 UI 组件

新建 [packages/app/src/pages/insight/components/preset-prompts.tsx](../../../packages/app/src/pages/insight/components/preset-prompts.tsx):

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

#### 3.3.3 简化 queue(单容量、内存、无 dock)

```typescript
const [queuedText, setQueuedText] = createSignal<string | null>(null)

async function handleSubmit() {
  const text = prompt().trim()
  if (!text || hasUploadingAttachments()) return
  setPrompt("")

  // busy 时入队(单容量:第二次 submit 会覆盖上一次)
  if (isBusy()) {
    setQueuedText(text)
    console.log("[octo:queue] enqueued", { sessionID: params.id, len: text.length })
    return
  }

  let sid = params.id
  if (!sid) {
    sid = await createAndNavigate()
    if (!sid) return
  }
  await sendMessage(sid, text)
}

// busy → idle 自动 flush
createEffect(on(isBusy, (busy, prev) => {
  if (prev && !busy) {
    const text = queuedText()
    const sid = params.id
    if (text && sid) {
      setQueuedText(null)
      console.log("[octo:queue] flushing", { sessionID: sid })
      void sendMessage(sid, text)
    }
  }
}, { defer: true }))
```

#### 3.3.4 队列提示条 UI

在输入框上方加一行轻提示(`queuedText()` 非空时显示):

```tsx
<Show when={queuedText()}>
  <div class="octo-queue-banner flex items-center gap-2 px-3 py-1.5 text-xs">
    <span>排队中:</span>
    <span class="truncate flex-1">{queuedText()}</span>
    <button type="button" onClick={cancelQueued} title="取消并恢复到输入框">×</button>
  </div>
</Show>

// cancelQueued = () => { setPrompt(queuedText() ?? ""); setQueuedText(null) }
```

#### 3.3.5 切 session 时清空 queue

```typescript
createEffect(on(() => params.id, () => {
  setQueuedText(null)
  // ... 其他 reset 逻辑
}, { defer: true }))
```

避免"在 session A 排了一条,切到 session B 时被错发到 B"。

---

## 4. 数据迁移 / 兼容性

- **删除**:[store/prompt-template.ts](../../../packages/app/src/pages/insight/store/prompt-template.ts)、[components/prompt-template-selector.tsx](../../../packages/app/src/pages/insight/components/prompt-template-selector.tsx) 整个文件
- **新建**:[store/preset-prompts.ts](../../../packages/app/src/pages/insight/store/preset-prompts.ts)、[components/preset-prompts.tsx](../../../packages/app/src/pages/insight/components/preset-prompts.tsx)
- 用户**无持久化数据**依赖被删字段(`templateId` 只是组件 state,不存 localStorage / persist)。无迁移成本。
- 内网集成手册 [docs/intranet-handoff.md](../../intranet-handoff.md):本 PR **会触发**对外契约变化(模板机制改变),按 CLAUDE.md "内网集成手册维护" 在合入物里程碑前更新。

---

## 5. 不做什么(明确边界)

| 不做项 | 理由 / 触发条件 |
|---|---|
| **Tool 激活 toggle**(Gemini 模式) | §2.1 已分析,预置提示词文本已能精确驱动 MCP tool;触发条件:用户反馈"重复点烦"或 LLM 选错 tool 严重 |
| **外网分类筛选 UI** | 业务上属外网新页面,octo 本期只在 schema 预留 `categories` 字段 |
| **完整 followup queue** | §2.3 已分析,过度;触发条件:用户反馈"经常要排 3+ 条" |
| **queue 持久化**(reload 后还在) | 同上;触发条件同上 |
| **预置按钮 icon / 配色 / tooltip 富文本** | 等设计师切图;本期文字按钮够用,登记到 [design-assets-needed.md](design-assets-needed.md) |
| **预置按钮上显示"会调用 X tool"提示** | `expectedTool` 字段已留,未来要加只是 UI 改动 |
| **send 按钮 busy 时改文案为"⏎ 排队"** | 锦上添花,本 PR 可省;若实施成本 < 5 行可顺手 |
| **LLM 中途 session.error toast** | 与 chat 行为一致(走 NotificationProvider 列表);触发条件:用户反馈"出错没提示" |
| **`expectedTool` 实际调用一致性校验**(对账 console) | 留到内网联调阶段;本 PR 只埋 console.log,不做断言 |

---

## 6. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| 预置文本对 LLM 调用准确性不足(LLM 没调对 tool) | 中 | §3.1.2 已强制文本提名 tool 名;内网联调时观察 `[octo:preset]` 日志 + tool call 实际值,不一致就改文案 |
| `search_reports` 用户不知道有这个能力(没胶囊) | 低 | 自由对话可触发;"问答类预置"作为独立专题排期 |
| queue 容量=1 用户认知:第二次 submit 会覆盖第一次 | 中 | 提示条显示当前排队内容,用户可感知;若被反馈"丢消息"再升级 |
| busy→idle flush 时机:如果用户已经手动清了 `queuedText` 但 effect 还没跑 | 低 | `setQueuedText(null)` 后 effect 读到 `null` 自然 noop |
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
- [ ] busy 期间点 send 或按 enter → 输入框清空 + 上方出现"排队中:xxx"提示条 + 按钮可取消
- [ ] LLM idle 后,queue 自动发出 + 提示条消失
- [ ] 排队期间再次发送 → 覆盖上一条 queue(提示条文案变成新内容)
- [ ] 取消按钮 → queue 清空,文本回填到输入框
- [ ] 切 session → queue 清空,不会错发到新 session
- [ ] 任务卡片"刷新 / 终止"按钮链路正常(走 promptAsync + optimistic)

### 7.2 错误 / 边界

- [ ] 断网点发送 → toast "发送失败" + optimistic 消息被清除
- [ ] 模型 401 / 服务端 4xx → toast 提示对应描述
- [ ] 附件上传中点 send → 按钮 disabled,无反应
- [ ] 空文本点 send → 无反应
- [ ] 无 `console.error("[InsightPage] prompt failed", ...)` silent 残留

### 7.3 控制台日志

- [ ] `[octo:preset] click` 出现且 `expectedTool` 字段正确
- [ ] `[octo:queue] enqueued` 在 busy 时触发
- [ ] `[octo:queue] flushing` 在 busy→idle 时触发
- [ ] `[octo:prompt] sent (async)` 与 `[octo:prompt] optimistic added` 配对

### 7.4 删除清理

- [ ] [store/prompt-template.ts](../../../packages/app/src/pages/insight/store/prompt-template.ts) 文件已删
- [ ] [components/prompt-template-selector.tsx](../../../packages/app/src/pages/insight/components/prompt-template-selector.tsx) 文件已删
- [ ] InsightPage 不再 import `PromptTemplateSelector` / `PROMPT_TEMPLATES` / `DEFAULT_TEMPLATE_ID` / `PromptTemplateId`
- [ ] 删 `templateId / setTemplateId` signal 及所有使用点
- [ ] 删 `sending / setSending` signal 及所有使用点
- [ ] `system: template.systemHint` 字段从 promptPayload 移除

---

## 8. 实施步骤

1. **本 spec 评审通过**(user review)
2. 新建 [store/preset-prompts.ts](../../../packages/app/src/pages/insight/store/preset-prompts.ts) + [components/preset-prompts.tsx](../../../packages/app/src/pages/insight/components/preset-prompts.tsx)
3. `octo-tokens.css` 加 `.octo-preset-chip` / `.octo-preset-scroll-right` / `.octo-queue-banner` 样式
4. `index.tsx`:
   - 替换 import + 删除模板相关代码
   - 改 `doSendPrompt` 走 promptAsync + optimistic + toast
   - 删除 `sending()` 信号,所有使用点改 `isBusy()`
   - 加 `queuedText` signal + `handleSubmit` queue 逻辑 + busy→idle flush effect
   - 加切 session 清 queue effect
   - JSX 替换 `<PromptTemplateSelector>` 为 `<PresetPrompts>`,加队列提示条
   - 解 textarea / send 按钮的 busy disable
5. 删除 [store/prompt-template.ts](../../../packages/app/src/pages/insight/store/prompt-template.ts) + [components/prompt-template-selector.tsx](../../../packages/app/src/pages/insight/components/prompt-template-selector.tsx)
6. 跑 7.1 / 7.2 / 7.3 / 7.4 checklist
7. 内网包确认:`[octo:preset]` 日志的 expectedTool 与 LLM 实际 tool call 一致
8. 更新 [docs/intranet-handoff.md](../../intranet-handoff.md)(合入物对外契约变更)
9. 按 CLAUDE.md "非业务包变更登记":本 PR **未涉及** packages/app 外文件,无需登记 architecture.md §5.4

---

## 9. 后续 follow-up(本 PR 不做)

- 预置按钮 icon / tooltip 富文本(等设计师切图,登记 [design-assets-needed.md](design-assets-needed.md))
- 预置按钮上标"会调用 X tool"提示(`expectedTool` 字段已留)
- 加入"问答类预置"专题(覆盖 `search_reports` 等引用型工具,见 [insight-references.md](insight-references.md));需独立设计 UX(单 turn 触发 / 连续追问 / 角标 / chip 收起等),与产物型胶囊**不混排**
- queue 升级:多容量 / dock / 持久化(条件:用户反馈"经常排 3+ 条"或"reload 丢消息")
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
