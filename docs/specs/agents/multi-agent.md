# Spec — 多 Agent 协作

> 状态:草案 · 优先级 P1 · 规模 [L] · 领域 agents
>
> 前置阅读:[learning/agent-mental-model.md](../../learning/agent-mental-model.md)

> 注:本 spec 取代旧 `multi-agent-shell.md`(已废弃,该旧 spec 写于 shell 概念阶段,现已不准确)。

> **上游已实现:✓/✗ 混合**
>
> - ✓ 工具调用内联渲染(U8, §5.4):上游 `PART_MAPPING["tool"]`(message-part.tsx:1301+)已实现工具卡片;`basic-tool.tsx`、`tool-error-card.tsx`、`tool-count-summary.tsx` 是零件,SessionTurn 组合渲染
> - ✓ Reasoning 默认折叠(U7, §5.3):上游 `PART_MAPPING["reasoning"]`(message-part.tsx:1512+)已实现,默认折叠行为已内置
> - ✓ Task 子任务卡片(U3/U4, §5.2):上游 `message-part.tsx:1318+` 已实现 `task-tool-card`(含 spinner/状态切换/颜色)
> - ✓ Agent 列表 API:opencode SDK `/agent` 接口已暴露(useGlobalSync 的 sync.data.agent)
> - ✓ Session 创建时指定 agent:opencode 后端原生支持
> - ✗ OctoSidebar 的 primary agent 切换 UI(U1/U2):Octo 自写,显示在 sidebar agent 列表
> - ✗ 权限请求 modal(U5, §5.5):上游无独立 permission dialog,Octo 自写
> - ✗ 设置页 Agent 管理编辑器(U6-U8, §5.6-5.7,P2):Octo 自写
>
> **M2 结论**:§5.3(reasoning渲染)、§5.4(工具调用卡片)、§8 Step 5/8/9 已由上游 SessionTurn 覆盖,无需重复实现。Octo 需自写:OctoSidebar agent 列表 + permission modal + Agent 编辑器(P2)。

---

## 1. 背景与目标

opencode 后端**已经原生实现**完整的多 agent 系统(primary / subagent / task tool / 配置驱动)。本 spec 关注 Octo UI 如何**暴露并简化**这些能力,让用户:

- 能在对话框里**切换不同 primary agent**(用研助手 / 代码评审 / 通用问答)
- 体验**自动 subagent 调度**(不感知,但能看到 task 进度)
- 能**创建/编辑/删除自定义 agent**(P2)
- 理解 agent 的"思考过程"(reasoning + tool calls)

最终效果对标:Claude Code 的 `/agents` + `Agent` 工具,但有 GUI。

---

## 2. 不在范围

- **显式工作流编排**(模式 C,见 learning §5)— P3 再说,需要时单独 spec
- 跨用户分享 agent 配置 — P3
- agent marketplace — 不做
- agent 性能/成本统计 — P3

---

## 3. 用户故事

| ID | 故事 | 优先级 |
|---|---|---|
| U1 | 作为用户,我能在对话输入框旁的下拉里看到所有可用 primary agent,选一个开始对话 | P1 |
| U2 | 作为用户,我新建对话时默认沿用上次用的 agent | P1 |
| U3 | 作为用户,当 agent 调用 subagent 时,我能在对话流里看到"📌 subagent 正在做 X"的卡片 | P1 |
| U4 | 作为用户,subagent 完成后,我能展开看它的完整子对话 | P1 |
| U5 | 作为用户,当 agent 想跑 bash/读文件等敏感操作时,弹授权对话框给我决定 | P1 |
| U6 | 作为用户,我能在设置页看 agent 列表,新建/编辑/删除 agent | P2 |
| U7 | 作为高级用户,我能复制内置 agent 当模板自定义改 | P2 |
| U8 | 作为高级用户,我能给 agent 指定模型/工具白名单/permission 规则 | P2 |

---

## 4. 内置 agent 清单(Phase 2 起)

Octo Agent 默认提供以下 primary agent。每个对应一个 markdown 文件放在 `~/.config/octo/agents/<name>.md`(随安装包初始化)。

| Agent | 角色 | 默认工具 | 适合 |
|---|---|---|---|
| `general` | 通用问答 | 全部 | 兜底 / 不知道选什么时 |
| `research` | 用研助手 | read / web_search / mcp.* / task | 用户访谈分析、洞察提炼 |
| `coder` | 代码助手 | read / edit / bash / grep / glob / lsp | 代码理解和修改 |
| `reviewer` | 评审助手 | read / grep / git_log(MCP) | 代码评审、文档审校 |

**subagent 清单**(由 primary 自动调用,用户不直接选):

| Subagent | 角色 |
|---|---|
| `explore` | 大范围搜索/探查,只读 |
| `interview-analyzer` | 单份访谈深度分析 |
| `data-query` | 内网数据库查询(MCP) |
| `compaction` | 上下文压缩(opencode 内置,不显示) |

实际清单可调,本 spec 不锁死。

---

## 5. UI 交互

### 5.1 对话框 — Agent 选择器

参考设计师截图,输入框底部已有 `[ ✦ 通用问答 ▾ ]` 按钮。点开:

```
┌─ 选择 Agent ──────────────────┐
│  Primary Agent                │
│  ✓ 通用问答     general       │
│    用研助手     research      │
│    代码助手     coder         │
│    评审助手     reviewer      │
│                               │
│  ─────────────────────────────│
│  [ + 新建自定义 agent... ]    │  P2 才有
└───────────────────────────────┘
```

**交互细节**:

- 选中后高亮 + 输入框左侧显示 agent 图标
- **新对话**默认沿用上次的 agent(localStorage 记一下)
- **已开始的对话**切换 agent → 提示"将影响后续消息,历史保持不变"
- subagent 不出现在选择器里(隐藏)

### 5.2 对话流 — Subagent 调用渲染

当 primary agent 调 `task` 工具时,SSE 推 `tool` part(`tool: "task"`)。UI 渲染成:

```
┌─ 📌 子任务:分析访谈记录 1-3 ─────────┐
│  Subagent: research                   │
│  状态:运行中  ⏳                     │
│  ───────────────────────────────────  │
│  > 正在 read interview-1.md           │
│  > 正在 read interview-2.md           │
│  > ...                                │
│  [▾ 展开完整子对话]                   │
└───────────────────────────────────────┘
```

完成后:

```
┌─ ✅ 子任务:分析访谈记录 1-3 ─────────┐
│  Subagent: research  · 8 步  · 12s    │
│  ───────────────────────────────────  │
│  访谈中共发现 3 类共性需求:           │
│  1. ...                              │
│  [▾ 展开完整子对话]                   │
└───────────────────────────────────────┘
```

**展开子对话** → 弹 modal 或新 tab,展示该 subagent session 的完整消息流(用 `parent_id` 关联到该 task 的 child session)。

### 5.3 思考过程渲染

`reasoning` part **当前已实现**(见 ChatView),保持现有"思考过程 ▾"折叠 UI。

新需求:**默认折叠**(避免占视觉空间),hover/click 才展开。

### 5.4 工具调用渲染

每个工具调用渲染成一个**卡片**(参考 Claude Code 的 tool 调用卡片):

```
┌─ 🔧 read_file ──────────────────────┐
│  packages/octo-ui/src/views/Chat... │
│  lines 80-120                       │
│  [▾ 显示输出 (32 行)]                │
└─────────────────────────────────────┘
```

不同工具用不同图标:

| 工具类 | 图标 |
|---|---|
| 读取(read/grep/glob) | 🔍 |
| 编辑(edit/write/patch) | ✏️ |
| 执行(bash/run) | ⚡ |
| 搜索(web_search) | 🌐 |
| 任务(task) | 📌 |
| MCP 工具 | 🔌 |
| 其他 | 🔧 |

### 5.5 权限请求对话框

opencode 推 `permission.required` 事件时,UI 弹 modal:

```
┌─ Agent 请求授权 ────────────────────┐
│  Agent "coder" 想要执行:           │
│  ───────────────────────────────────│
│  bash:  rm -rf /tmp/build           │
│  ───────────────────────────────────│
│  [ 拒绝 ] [ 仅本次允许 ] [ 总是允许 ]│
└─────────────────────────────────────┘
```

- 拒绝 → 工具调用返回错误,agent 接收并继续推理
- 仅本次允许 → 这次执行
- 总是允许 → 写入该 agent 的 permission ruleset(`pattern: "rm -rf /tmp/*"` allow)

模态**必须阻塞**该对话流(不能错过授权),其他对话可以继续。

### 5.6 设置页 — Agent 管理(P2)

设置页加 "Agents" 分类:

```
┌─ Agents ────────────────────────────────┐
│  + 新建 agent                            │
│                                          │
│  Primary                                │
│  ▸ general    通用问答         ⚙️       │
│  ▸ research   用研助手         ⚙️       │
│  ▸ coder      代码助手         ⚙️       │
│  ▸ reviewer   评审助手         ⚙️       │
│                                          │
│  Subagent                               │
│  ▸ explore           ⚙️                  │
│  ▸ interview-analyzer ⚙️                 │
│                                          │
│  ─────── 按钮:导入 / 导出 ──────────── │
└─────────────────────────────────────────┘
```

点 ⚙️ 进 agent 编辑器(P2 设计)。

### 5.7 Agent 编辑器(P2)

```
┌─ Edit Agent: research ──────────────────┐
│  Name:        [ research              ] │
│  Description: [ 用户研究助手           ] │
│  Mode:        [ primary ▾ ]              │
│  Model:       [ bailian/qwen3-coder ▾ ] │
│  Steps Max:   [ 30 ]                     │
│                                          │
│  System Prompt                          │
│  ┌────────────────────────────────────┐ │
│  │ 你是用研专家...                    │ │
│  └────────────────────────────────────┘ │
│                                          │
│  Tools                                  │
│  ☑ read_file        ☑ web_search        │
│  ☑ task            ☐ bash               │
│  ☑ mcp.devkit-db.* ☑ ...                │
│                                          │
│  Permissions                            │
│  + 添加规则                              │
│  bash → ask                              │
│                                          │
│  [ 取消 ]  [ 保存 ]                     │
└─────────────────────────────────────────┘
```

---

## 6. 数据存储

### 6.1 Agent 配置位置

按 opencode 约定,有两种存法,**Octo 同时支持**:

| 形式 | 位置 | 适合 |
|---|---|---|
| **Markdown 文件** | `~/.config/octo/agents/<name>.md` | 简单 agent,frontmatter + prompt 正文 |
| **配置 JSON** | `~/.config/octo/octo.config.json` 的 `agent` 字段 | 复杂配置 |

Markdown 例(`research.md`):

```markdown
---
mode: primary
description: 用户研究助手
model: bailian/qwen3-coder-plus
tools:
  read_file: true
  web_search: true
  bash: false
  task: true
permission:
  - permission: bash
    pattern: "*"
    action: deny
---
你是用研专家,擅长访谈分析和洞察提炼。

## 工作风格
- 提问时给出可选答案,降低用户认知负担
- 输出按"用户引述 → 共性需求 → 推荐措施"三段式
```

### 6.2 项目级覆盖(P2)

项目目录的 `.octo/agents/<name>.md` 优先于全局同名 agent。

---

## 7. 验收标准 (P1)

| # | 标准 |
|---|------|
| 1 | 对话框选择器显示所有 primary agent(开箱即用至少 4 个) |
| 2 | 切换 agent 后新消息使用新 agent,历史保持原 agent 不变 |
| 3 | 新对话默认用上次选的 agent(localStorage 持久化) |
| 4 | Agent 调 task 工具时,UI 显示"📌 子任务"卡片,运行中→完成状态正确切换 |
| 5 | 子任务卡片可展开,显示 subagent 完整对话流 |
| 6 | Agent 触发权限请求时,弹授权对话框,三个按钮都生效 |
| 7 | reasoning part 默认折叠,可展开 |
| 8 | tool call 渲染成卡片,正确显示工具名和精简的 input/output |
| 9 | 创建一个 `.md` 文件放进 `~/.config/octo/agents/`,重启 Octo 后能在选择器看到 |
| 10 | 删除该 `.md` 文件,重启后选择器里也消失 |

---

## 8. 实现步骤建议

1. **Step 1**:Octo 主进程预置 4 个内置 agent `.md` 模板,首次启动时拷到 `~/.config/octo/agents/`(如果不存在)
2. **Step 2**:`useOpencode` 加 `client.agent.list()` 调用(opencode 已有 API)
3. **Step 3**:`ChatView` 输入框底部加 agent 选择器,绑定 localStorage
4. **Step 4**:`session.create` 时传 `agent` 参数(opencode 支持)
5. **Step 5**:`ChatView` 加 `tool` part 渲染分支,识别 `tool === "task"` 渲染子任务卡片
6. **Step 6**:子任务展开 → 用 `client.session.message.list({ id: child_session_id })` 拉子 session 消息
7. **Step 7**:订阅 `permission.required` SSE 事件,弹授权 modal,通过 `client.permission.respond` 回复
8. **Step 8**:reasoning part 加默认折叠样式
9. **Step 9**:tool call 渲染卡片
10. **Step 10**:验收

---

## 9. 风险与待定

| 项 | 风险 | 缓解 |
|---|---|---|
| Agent 列表来源 | opencode 是否区分内置/用户自定义? | 看 API 返回是否带 `native` 字段(看了 schema:**有** `native: z.boolean()`) |
| Subagent 嵌套深度 | subagent 调 subagent 会无限套娃? | opencode 应该有保护,但 UI 渲染建议限制展开层级到 2 |
| 权限模态阻塞多对话 | 多 session 同时请权限,UI 怎么排队? | 用 toast 通知 + 队列,只有当前 session 的弹模态 |
| agent 删除时正在跑 | 删除 active session 用的 agent 怎么办? | 拒绝删除,提示"该 agent 有进行中的会话" |
| 模型不可用 | agent 配的模型 provider 被删了 | session 创建时报错,UI 引导回设置页 |
