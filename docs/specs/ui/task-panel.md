# Spec — 任务面板(右侧产出过程区)

> 状态:草案 · 优先级 P1 · 规模 [L] · 领域 ui
>
> 前置阅读:[learning/agent-mental-model.md](../../learning/agent-mental-model.md)、[learning/opencode-internals.md §3-4](../../learning/opencode-internals.md#3-sse-事件协议)

---

## 1. 背景与目标

当前 Octo 主区只显示对话气泡 + reasoning 折叠块,用户**看不到 agent 在做什么**:

- 不知道 agent 调了哪些工具(read/grep/web_search/MCP/...)
- 不知道 subagent 啥时候被启用、做完没有
- 不知道工具调用花了多久、有没有出错
- 不知道有没有产出可下载/复用的物料(报告、代码、表格)

业界主流 agent 产品都把这部分独立出右栏,本 spec 在 Octo 的浅色风格内引入 **"任务面板"**:**让用户实时看到 agent 的工作过程,以及最终产出**。

### 业界对照速查

| 流派 | 代表 | 我们借鉴什么 |
|---|---|---|
| **时间线派** | Cursor agent / Devin Plan | **每步一行,可展开**;状态图标;耗时 |
| **多 tab 工作区派** | Devin (Files/Terminal/Browser) | **过程 / 产出**双 tab |
| **录屏派** | Manus | 不抄 — 太重,且我们不跑 sandbox |
| **Artifact 派** | Claude.ai / ChatGPT Canvas | **产出 tab** 多形态自适应渲染 |

**Octo 选用:时间线 + 嵌套子任务 + Artifact tab**,Phase 化推进。

---

## 2. 不在范围

- ❌ Sandbox VM 录屏 / 远程桌面流(P3 以后再说)
- ❌ 协同编辑 artifact(P3)
- ❌ 时间线事件搜索/过滤(P2)
- ❌ artifact 版本历史(P2)
- ❌ 任务暂停/分叉(P3)

---

## 3. 用户故事

| ID | 故事 | 优先级 |
|---|---|---|
| U1 | 作为用户,我能在右侧看到当前对话的所有 agent 操作步骤,实时更新 | P1 |
| U2 | 作为用户,我能看到顶部状态条:运行中/已完成/出错、已用时长、步骤数 | P1 |
| U3 | 作为用户,我能展开任意步骤看 input/output 详情(超长输出可折叠) | P1 |
| U4 | 作为用户,看到 agent 调 task 工具时,**子任务嵌套**展示在主步骤下 | P1 |
| U5 | 作为用户,看到工具失败时,有红色标记和错误详情 | P1 |
| U6 | 作为用户,需要时能切到 "产出" tab 看 agent 生成的物料(长文档/代码/数据) | P1 |
| U7 | 作为用户,能折叠/收起整个面板,主区扩到全宽 | P1 |
| U8 | 作为用户,长任务时点 "中止" 能停掉 agent | P1 |
| U9 | 作为用户,能复制/下载某个 artifact(P2) | P2 |
| U10 | 作为用户,能对比 artifact 的多个版本(P3) | P3 |

---

## 4. 数据模型

### 4.1 TimelineEvent

每条时间线事件:

```typescript
interface TimelineEvent {
  id: string                   // 来自 part.id 或 messageID
  parentId?: string            // 父事件(子任务嵌套用)
  type: TimelineEventType
  title: string                // "read_file" / "思考中" / "子任务: 分析访谈"
  subtitle?: string            // input 摘要,如 "ChatView.vue:80-120"
  status: "pending" | "running" | "completed" | "error"
  startTime?: number           // ms timestamp
  endTime?: number
  durationMs?: number          // 算好的耗时
  input?: unknown              // tool 调用 input
  output?: string              // tool 调用 output(可能很长)
  error?: string               // 错误时的详情
  expanded: boolean            // UI 状态:是否展开
  children?: TimelineEvent[]   // 子任务的子步骤
}

type TimelineEventType =
  | "thinking"      // 🤔 reasoning part
  | "tool"          // 🔧 普通工具调用
  | "task"          // 📌 task 工具(子任务)
  | "step"          // ▶ step-start/step-finish
  | "error"         // ⚠️ 错误
  | "permission"    // 🔐 权限请求
```

### 4.2 Artifact

```typescript
interface Artifact {
  id: string                   // 可以用 messageID + index
  type: ArtifactType
  title: string                // 自动从内容首句提取或 LLM 标题
  content: string              // 原始内容(markdown / json / code)
  language?: string            // 代码语言(highlight)
  source: {
    messageId: string          // 来自哪条消息
    partId?: string            // 来自哪个 part
  }
  createdAt: number
}

type ArtifactType =
  | "markdown"     // 长文档 / 报告
  | "code"         // 代码块
  | "json"         // 结构化数据
  | "table"        // 表格(Markdown 表格或解析后的数据)
  | "diff"         // 文件 diff
```

### 4.3 SSE 事件 → TimelineEvent / Artifact 映射

| SSE 事件 | Part 类型 | 映射 |
|---|---|---|
| `message.part.updated` | `step-start` | 新 TimelineEvent { type: "step", status: "running" } |
| `message.part.updated` | `step-finish` | 找到对应 step,status="completed" + endTime |
| `message.part.updated` | `reasoning` | TimelineEvent { type: "thinking" } |
| `message.part.updated` | `tool` | TimelineEvent { type: "tool" / "task" },status 跟 ToolState |
| `message.part.updated` | `text` | **不进时间线**(主对话渲染) + 检测是否成 Artifact |
| `message.part.delta` | `field: text` | 主对话拼接(已有逻辑) |
| `message.part.delta` | `field: reasoning` | 找到 thinking event 拼接 |
| `session.idle` | — | 顶部状态条切到"已完成";reload 一次 messages 校准 |
| `session.error` | — | 顶部状态条切到"出错"(已有逻辑) |
| `permission.required` | — | TimelineEvent { type: "permission" } + 弹授权 modal |

**Tool 类型识别**:`part.tool === "task"` → type="task",其他 → type="tool"。

**Artifact 提取规则(简单版,P1)**:

assistant text part 满足以下任一条件转为 artifact:
1. 包含 ` ``` ` 代码块且代码块内行数 > 5
2. 包含 markdown 表格(表头 + 至少 2 行)
3. 总长度 > 800 字符且包含 `# ` 标题

P2 加更智能的提取(LLM 标注产出范围)。

---

## 5. UI 结构

### 5.1 整体布局

主区从单栏改成**主对话 + 任务面板** 两列(可收起):

```
┌─ Octo Workspace ─────────────────────────────────────────────────────┐
│  ┌─ Sidebar ─┐  ┌─ 主对话区(flex: 1) ──┐  ┌─ 任务面板(360-420px) ──┐│
│  │           │  │                        │  │  [⨉] [↑↓]              ││
│  │ Sidebar   │  │   chat messages...     │  │  [过程] [产出 (1)]    ││
│  │           │  │                        │  │  ────────────────────  ││
│  │           │  │                        │  │                        ││
│  │           │  │                        │  │  Step 1  🤔 思考  ✓   ││
│  │           │  │                        │  │  Step 2  🔧 read  ✓   ││
│  │           │  │                        │  │  Step 3  📌 子任务⏳   ││
│  │           │  │                        │  │    └─ ...              ││
│  │           │  │                        │  │  Step 4  🔧 search⏳  ││
│  │           │  │                        │  │                        ││
│  │           │  │  [composer...]         │  │  [📦 1 份产出 →]      ││
│  └───────────┘  └────────────────────────┘  └────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

**断点行为**:

- 视口 ≥ 1280px:**默认展开**,宽度 400px
- 视口 1024-1280px:**默认收起**,顶部按钮可展开,展开时主对话变窄
- 视口 < 1024px:**强制收起**,展开时浮窗覆盖主对话(类似 Drawer)

### 5.2 顶部状态条

```
┌─ 任务面板顶部 ─────────────────────────────────────┐
│  [✕]                                       [↗ 全屏] │  ← 右上控件
│                                                     │
│  ▶ 正在生成 · Step 4/?                              │  ← 状态文字
│  18s 已运行                              [⏹ 中止]  │
│                                                     │
│  [ 过程 ]  [ 产出 (1) ]                             │  ← Tab 切换
│  ───────────────────────────────────────────────── │
└─────────────────────────────────────────────────────┘
```

**状态颜色**:
- 运行中:`var(--accent)` + 脉动动画
- 已完成:`var(--text-secondary)`
- 出错:`var(--danger)`
- 空闲:`var(--text-muted)` + "暂无运行中任务"

**[⏹ 中止] 按钮**:调 `client.session.abort({ path: { id: sessionId } })`。

### 5.3 时间线项(默认折叠)

```
┌────────────────────────────────────────────┐
│ ▸ Step 2  🔧 read_file              0.4s ✓│  ← 折叠
└────────────────────────────────────────────┘
            ↓ 点击展开
┌────────────────────────────────────────────┐
│ ▾ Step 2  🔧 read_file              0.4s ✓│
│ ┌──────────────────────────────────────┐  │
│ │ Path: ChatView.vue                   │  │
│ │ Lines: 80-120                        │  │
│ │ ─────────────────────────────────────│  │
│ │ Output (32 lines):                   │  │
│ │ <code preview, max 200 lines>       │  │
│ │ [▼ 显示完整 Output]                  │  │
│ └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

**图标对照**:

| Type | Icon | 描述 |
|---|---|---|
| thinking | 🤔 | 思考过程(reasoning) |
| tool: read* / grep / glob | 🔍 | 读取/搜索 |
| tool: edit / write / patch | ✏️ | 编辑/写入 |
| tool: bash | ⚡ | 命令行 |
| tool: web_search / web_fetch | 🌐 | 网络 |
| tool: mcp.* | 🔌 | MCP 工具 |
| tool: task | 📌 | 子任务(嵌套) |
| step | ▶ | 普通步骤标记 |
| error | ⚠️ | 错误 |
| permission | 🔐 | 权限请求 |

**子任务嵌套**:

```
Step 3  📌 子任务: 分析访谈                12s ⏳
  ├─ 3.1  🔍 read_file: interview-1.md   0.3s ✓
  ├─ 3.2  🔍 read_file: interview-2.md   0.4s ✓
  ├─ 3.3  🤔 综合洞察                    8s   ⏳
  └─ ...
```

子项缩进 16px,最多嵌套 2 层(再深用"展开完整子对话"按钮跳到子 session 视图)。

### 5.4 产出 tab

切换到产出 tab,显示 artifact 列表:

```
┌─ 产出 (3) ────────────────────────────────┐
│                                            │
│  📄 用户访谈分析                           │
│  18:23 · markdown · 1240 字                │
│  ┌────────────────────────────────────┐   │
│  │ # 用户访谈分析                      │   │
│  │ ## 共性需求                         │   │
│  │ 1. ...                             │   │
│  └────────────────────────────────────┘   │
│  [复制] [下载 .md]                         │
│                                            │
│  ────────────────────────────────────────  │
│                                            │
│  💻 demo 代码                              │
│  18:25 · typescript · 42 行                │
│  <code preview>                            │
│  [复制] [下载]                             │
│                                            │
│  ────────────────────────────────────────  │
│                                            │
│  📊 周活跃数据                             │
│  18:27 · table · 7 行                      │
│  <table preview>                           │
└────────────────────────────────────────────┘
```

**渲染器映射**:

| ArtifactType | 渲染 |
|---|---|
| markdown | `marked()` + 全局 `.md` 样式 |
| code | `<pre><code>` + 代码语言 class(prism/highlight 后续接入,P1 不带高亮也能用) |
| json | JSON pretty print + 等宽字体 |
| table | 解析 markdown 表格成 `<table>`,或直接 marked |
| diff | P1 当成 code 渲染,P2 加 +/- 高亮 |

### 5.5 折叠/全屏

- 顶部 [✕] 按钮:整个任务面板隐藏,主对话占全宽,Sidebar 保留
- 顶部 [↗] 按钮:任务面板**全屏覆盖**主对话(用户在长任务时想专注看过程),再点恢复
- 主对话区右上角浮个 "📋 任务" 按钮,任务面板隐藏时点这个唤回

---

## 6. 实现要点

### 6.1 组件拆分

```
packages/octo-ui/src/components/
├── TaskPanel/
│   ├── TaskPanel.vue           # 容器:tab 切换 + 顶部状态条 + 折叠
│   ├── TimelinePane.vue        # 时间线列表
│   ├── TimelineItem.vue        # 单个事件行(可递归渲染子项)
│   ├── ArtifactPane.vue        # artifact 列表
│   └── ArtifactCard.vue        # 单个 artifact
└── ...
```

### 6.2 状态管理

不引 Pinia,用 ChatView 内 ref + provide/inject 给 TaskPanel:

```typescript
// ChatView.vue
const timeline = ref<TimelineEvent[]>([])
const artifacts = ref<Artifact[]>([])
const taskStatus = ref<"idle" | "running" | "completed" | "error">("idle")
const taskStartTime = ref<number | null>(null)

provide("taskState", { timeline, artifacts, taskStatus, taskStartTime })

// TaskPanel.vue
const taskState = inject("taskState")
```

### 6.3 SSE 事件循环扩展

现有 ChatView 的 startEventStream 加事件 → timeline 转换:

```typescript
// 伪代码
function applyEventToTimeline(event: StreamEvent) {
  if (event.type === "message.part.updated") {
    const part = event.properties?.part
    if (part?.type === "step-start") createStepEvent(part)
    if (part?.type === "tool") upsertToolEvent(part)
    if (part?.type === "reasoning") upsertReasoningEvent(part)
  }
  if (event.type === "message.part.delta") {
    if (event.properties?.field === "reasoning") {
      appendToReasoningEvent(event.properties.messageID, event.properties.delta)
    }
  }
  if (event.type === "session.idle") {
    taskStatus.value = "completed"
    extractArtifacts()  // 扫主对话提取 artifact
  }
  if (event.type === "session.error") {
    taskStatus.value = "error"
  }
}
```

### 6.4 Artifact 提取策略

`session.idle` 后扫所有 assistant text part,按 §4.3 规则识别。简单实现:

```typescript
function extractArtifacts() {
  for (const msg of messages.value) {
    if (msg.role !== "assistant" || !msg.text) continue
    const text = msg.text

    // 规则 1: 长代码块
    const codeMatch = text.match(/```(\w+)?\n([\s\S]+?)\n```/)
    if (codeMatch && codeMatch[2].split("\n").length > 5) {
      artifacts.value.push({
        id: `${msg.id}-code`,
        type: "code",
        language: codeMatch[1] || "text",
        title: codeMatch[1] ? `${codeMatch[1]} 代码` : "代码片段",
        content: codeMatch[2],
        source: { messageId: msg.id },
        createdAt: Date.now(),
      })
    }

    // 规则 2: 长 markdown 文档
    if (text.length > 800 && /^#\s/m.test(text)) {
      artifacts.value.push({
        id: `${msg.id}-md`,
        type: "markdown",
        title: text.match(/^#\s+(.+)$/m)?.[1] || "文档",
        content: text,
        source: { messageId: msg.id },
        createdAt: Date.now(),
      })
    }
    // ...
  }
}
```

### 6.5 顶部状态条计时器

```typescript
const elapsedMs = ref(0)
let timer: number | undefined

watch(taskStatus, (status) => {
  if (status === "running") {
    taskStartTime.value = Date.now()
    timer = window.setInterval(() => {
      elapsedMs.value = Date.now() - (taskStartTime.value ?? 0)
    }, 100)
  } else {
    clearInterval(timer)
  }
})
```

### 6.6 中止按钮

```typescript
async function abortTask() {
  if (!sessionId.value) return
  await client.session.abort({ path: { id: sessionId.value } })
  // session.idle 事件会自动触发,UI 切到 completed/error
}
```

---

## 7. 验收标准 (P1)

| # | 标准 |
|---|------|
| 1 | 视口 ≥ 1280px 时任务面板默认展开,< 1024px 默认收起 |
| 2 | 发起对话后,顶部状态条立即变 "运行中",计时开始累加 |
| 3 | LLM 思考时,时间线出现 🤔 thinking 项 + 流式追加内容 |
| 4 | LLM 调工具时,时间线出现 🔧 工具项,从 pending → running → completed/error |
| 5 | 工具项可展开看 input(简化展示)和 output(超长截断 + "显示完整") |
| 6 | LLM 调 task 工具时,显示 📌 子任务卡片,**嵌套**展示子步骤 |
| 7 | 工具失败显示红色 ⚠️ + 错误详情 |
| 8 | session.idle 时状态条切 "已完成",计时停止 |
| 9 | session.error 时状态条切 "出错" + 主区已有错误展示 |
| 10 | 中止按钮能停止 agent 并切状态 |
| 11 | "产出" tab 显示从对话中提取的 artifact(代码/长文档/表格) |
| 12 | artifact 卡片有"复制"按钮(下载按钮 P2) |
| 13 | 整个任务面板可隐藏/恢复,响应式断点正常 |
| 14 | 切换 session 时时间线和 artifact 重置 |
| 15 | 重新打开历史 session 时,从 SSE 重放或从消息记录重建时间线(P1 简化:历史 session 时间线为空,只显示主对话) |

---

## 8. 实现步骤建议

按这个顺序最稳:

1. **Step 1**:在 ChatView 加 `timeline / artifacts / taskStatus` ref,扩展 SSE 事件循环写入(不渲染,先打日志)
2. **Step 2**:新建 `components/TaskPanel/` 目录,搭顶层容器 + tab 骨架
3. **Step 3**:实现 `TimelineItem.vue` (单项渲染,折叠展开)
4. **Step 4**:实现 `TimelinePane.vue` (列表)
5. **Step 5**:接入 ChatView,主区改两列布局,响应式断点
6. **Step 6**:顶部状态条 + 计时器 + 中止按钮
7. **Step 7**:子任务嵌套(递归 TimelineItem)
8. **Step 8**:错误/权限项渲染
9. **Step 9**:`extractArtifacts` 简单实现 + `ArtifactPane` + `ArtifactCard`
10. **Step 10**:折叠/恢复任务面板 + 浮按钮
11. **Step 11**:验收

---

## 9. 风险与待定

| 项 | 风险 | 缓解 |
|---|---|---|
| SSE 事件顺序 | reasoning delta 可能先于 step-start 到 | upsert 模式:找不到 event 就先创建 placeholder |
| 子任务 child session 拉取 | task 工具的子 session 历史没现成 API | P1 只展示 task 工具自身的 input/output(opencode 工具已经聚合了子任务结果);P2 拉子 session 完整渲染 |
| 长 output 卡 UI | tool output 几 MB 时浏览器卡 | 截到 200 行 + 隐藏完整(用户点开才载入到 DOM) |
| Artifact 提取误判 | 用户简单回答里也有代码块 | 长度阈值 + 用户可手动"标记为非 artifact"(P2) |
| 历史 session 时间线 | 旧消息已经无 SSE | P1 不重建,空时间线;P2 从 message parts 反推 |
| 任务面板状态丢失 | 切 session 重置 | 用 sessionId 作为 timeline ref 的 key,组件不复用,自然 reset |
| 跟主对话 SSE 重复处理 | 一个事件会同时影响主对话和时间线 | 在同一个 startEventStream 内处理,共用 event 引用 |
| 中止按钮实测 | session.abort 是否立即触发 idle? | 实施时验证,如果延迟可在前端先乐观切 status="completed" |

---

## 10. 给执行者的接力 brief 模板

如果要丢给新对话(Sonnet 4.6)实施,直接复制下面这段:

```
我在 /Users/huowenkai/Desktop/projects/octo-agent 这个 Vue 3 + Electron 项目里
实施任务面板功能。

详细 spec 见 docs/specs/ui/task-panel.md(必读全文)。
背景知识可参考 docs/learning/agent-mental-model.md 和 opencode-internals.md §3。

约束:
1. Vue 3 Composition API + <script setup lang="ts">
2. Tailwind 4 utility class + 三层 token + scoped CSS
3. 颜色用 token 变量,不能硬编码
4. 不引入 Pinia,用 ref + provide/inject
5. 不破坏现有 ChatView 的 SSE+REST 双层逻辑(防复读)和错误展示

关键文件:
- packages/octo-ui/src/views/ChatView.vue (要扩展 SSE 事件循环 + 主区改两列)
- packages/octo-ui/src/composables/useOpencode.ts (client 单例,Electron 优先 preload)
- packages/octo-ui/src/styles/tokens.css (token 体系)
- packages/octo-ui/src/components/Sidebar.vue (参考组件风格)
- packages/octo-ui/src/views/SettingsView.vue (参考卡片风格)
- packages/opencode/src/session/message-v2.ts (Part 类型权威定义)

验收:跑 bun run --cwd packages/desktop-electron dev,
按 spec §7 验收 15 项逐项检查。

按 spec §8 的 11 步顺序实施。
每完成一个 Step 列变更文件 + 简要说明,等我确认才进下一步。
不要 git commit,等所有 Step 完成后等我决定。
```

---

## 11. 后续衔接

- 实施完成后,本 spec §7 验收过的项目移到 ROADMAP "已完成" 区
- 未实现的 P2/P3 项整理进 [ROADMAP](../../../ROADMAP.md) P2/P3
- learning 文档可能要更新 [agent-mental-model.md](../../learning/agent-mental-model.md) 增加"用户视角:任务面板看到了什么"的章节
