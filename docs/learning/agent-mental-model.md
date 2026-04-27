# Agent 心智模型

> 上次同步:2026-04-27。读完这篇,你应该能回答"Agent 跟普通 LLM 调用差什么、为什么需要 multi-agent"。

---

## 1. Agent 不是 LLM 调用,是个**循环**

普通 LLM 调用是单轮:你发一句话,模型生成一段回复,结束。

```
User: "今天北京天气怎么样?"
LLM:  "我无法获取实时天气信息..."
[结束]
```

**Agent 是把 LLM 放进一个循环**,让它有能力**调用工具拿真实信息**,再继续推理:

```
User: "今天北京天气怎么样?"
LLM:  "我需要查天气" → 决定调用工具 [tool: web_search("北京 天气")]
opencode: 执行工具 → 返回结果 [JSON: { temp: 18, condition: "晴" }]
LLM:  收到结果,继续推理 → "今天北京 18°C 晴朗"
[结束]
```

这个 "LLM 决策 → 工具执行 → 结果回喂 LLM → LLM 继续" 的循环就是 **agent loop**(opencode 内部叫 agent loop,Anthropic 文档叫 agentic loop)。一轮对话里这个循环可能跑 1 次,也可能跑 30 次(每次工具调用算一步)。

### 一个具象例子

用户:"帮我看看 ChatView.vue 里的复读 bug 修了吗"

```
Step 1  LLM 调 grep("ChatView.vue", "复读") → 找到 5 处提及
Step 2  LLM 调 read("packages/octo-ui/src/views/ChatView.vue", lines 80-150)
Step 3  LLM 看到 message.part.delta 处理逻辑,调 git log("ChatView.vue", "--grep=复读")
Step 4  LLM 看到提交记录,综合判断 → 回复"已修,采用 REST 权威 + SSE 体验方案,在 session.idle 重新拉取消息"
[结束]
```

**4 次 LLM 调用 + 3 次工具执行 + 1 次综合**。这就是 agent。

---

## 2. Agent = LLM + 工具集 + 系统 Prompt + 模型配置

把 agent 拆开看,只有四件东西:

| 组成部分 | 作用 | 例子 |
|---|---|---|
| **System Prompt** | 告诉 LLM"你是谁、要做什么、怎么做" | "你是用研专家,擅长访谈分析..." |
| **工具集** | LLM 能调用的能力清单 | `read_file`、`web_search`、`run_sql` |
| **模型配置** | 用哪个 LLM、温度、max tokens | `bailian/qwen3-coder-plus`,temp=0.3 |
| **权限规则** | 哪些工具/操作需要授权 | `bash` 默认要问用户 |

**这就是全部**。Agent 不是黑魔法,是这四样东西的打包。

opencode 里 agent 的定义([packages/opencode/src/agent/agent.ts](../../packages/opencode/src/agent/agent.ts)):

```typescript
{
  name: string                    // agent 标识
  description?: string            // 给用户看的说明
  mode: "primary" | "subagent" | "all"
  prompt?: string                 // system prompt
  model?: { providerID, modelID } // 模型选择
  permission: Ruleset             // 权限规则
  options: Record<string, any>    // 模型选项(thinking 等)
  steps?: number                  // 最多循环步数
  // ...
}
```

---

## 3. opencode 后端的 Agent 能力**已经全做完了**

> 这是关键认知。我们不是从零搭 agent 框架,opencode 后端已经实现了完整的 agent 系统,我们只在 UI 暴露。

opencode 后端原生提供:

- **Agent 注册与运行**:从配置文件 / `.md` 文件 / plugin 发现 agent,自动加载到 `Agent.Service`
- **agent loop 执行**:用户消息 → 自动跑循环 → 直到 LLM 不再调工具或达到 `steps` 上限
- **工具集分发**:根据 agent 配置筛选可用工具子集喂给 LLM
- **权限询问**:工具调用时如果触发权限规则,通过 SSE 推 `permission.required` 事件,UI 展示授权对话框,用户回应后继续
- **流式输出**:每个 step 的 LLM token、tool 调用、工具结果都通过 SSE 推流

UI 层(我们)要做的是:

- 让用户能**看到有哪些 agent 可选**
- 让用户能**切换当前对话用的 agent**
- 让用户能**编辑/创建 agent**(可选,P2 再做)
- 让 agent 跑工具时的**权限对话框、工具进度**渲染出来

仅此而已。

---

## 4. Primary Agent vs Subagent

opencode 把 agent 分两类(`mode` 字段):

| mode | 谁触发 | 例子 |
|---|---|---|
| **primary** | 用户在 UI 里**直接对话** | "通用问答"、"用研助手"、"代码评审" |
| **subagent** | 别的 agent 通过 `task` 工具**调起来** | "搜索专员"、"测试运行专员"、"安全审查专员" |
| `all` | 两者皆可 | 罕见 |

### 为什么需要 subagent?(独立上下文窗口)

LLM 有上下文窗口上限(qwen3-coder-plus 是 100 万 token,但 token 不是免费的)。一个 primary agent 跑久了,上下文会塞满文件内容、工具结果、历史对话。

**Subagent 的核心价值**:在**独立的上下文**里完成一个子任务,只把**最终结论**返回给主 agent。

例子:

```
Primary Agent (用户对话):
  "帮我分析这个项目里所有访谈记录,找出共性需求"
   ↓
   调用 task tool,启动 subagent "research"
   ↓
   ┌─────────────────────────────────────────────┐
   │ Subagent "research" (独立 session/上下文)   │
   │   1. read 12 份访谈文件    (上下文 +50k token) │
   │   2. 提取每份的关键洞察   (上下文 +30k token) │
   │   3. 跨访谈聚类           (上下文 +20k token) │
   │   4. 输出结构化结论         (返回 2k token)   │
   └─────────────────────────────────────────────┘
   ↓
   Primary 只收到 2k token 的结论,继续跟用户对话
```

主 agent 上下文只增加了 2k,而不是 100k+。这就是"独立上下文"的价值。

### Claude Code 类比

你用过 Claude Code 就知道:`Agent` 是一个工具(tool),你能 call 它,选 `subagent_type`(像 `general-purpose`、`Explore`、`Plan`)。每个 subagent 是独立"清空记忆"启动的,跑完只回报结果。

**opencode 的 `task` 工具就是同一个东西**(连参数都对齐了:`description / prompt / subagent_type`,见 [tool/task.ts](../../packages/opencode/src/tool/task.ts))。

---

## 5. 多 Agent 协作的三种模式

你的初步认知"对话框选 agent"对应的是**模式 A**。实际上多 agent 有三种典型组合:

### 模式 A:用户切换 Primary Agent(最简单)

UI 提供下拉切换当前对话的 agent。每次新对话只能选一个 primary。

```
[ 通用问答 ▾ ]   ← 用户从这里选
[ 用研助手   ]
[ 代码评审   ]
```

**适合**:不同场景用不同 prompt + 工具集。比如"代码评审"agent 不需要 web_search 工具但需要 git 工具。

### 模式 B:Primary 自动调度 Subagent(opencode 原生)

用户跟一个 primary agent 对话,primary 自己判断"这个子任务我搞不定/会污染上下文",调用 `task` tool 派给 subagent。**用户感知不到 subagent 存在**(只看到 primary 在"思考")。

```
User → Primary "用研助手"
        ├─ task("分析访谈 1-3", subagent_type="interview-analyzer")
        ├─ task("分析访谈 4-6", subagent_type="interview-analyzer")  ← 可并行
        └─ 综合结论,回复用户
```

**适合**:
- 大任务拆并行子任务
- 需要"清空上下文"的探查工作
- 复杂工作流编排

### 模式 C:显式工作流编排(P3 才考虑)

用代码 / DSL 定义"agent A → agent B → agent C"的流水线。比如:

```
研究 agent → 综合 agent → 报告 agent → 审校 agent
   ↓              ↓             ↓             ↓
  访谈记录       聚类洞察       Markdown      校对修订
```

**适合**:固定流程的批处理任务(每周用研报告生成)。**注意**:opencode 后端**没有内置工作流引擎**,这个要在 `@octo/shell` 里自己写。

---

## 6. octo-agent 选哪个模式?

| 阶段 | 用什么模式 | 实现 |
|---|---|---|
| **Phase 1**(现在) | 模式 A 简化版:就一个默认 agent | 已经在跑,ChatView 直连 opencode |
| **Phase 2** | 模式 A + 模式 B:多个 primary agent + 各自的 subagent | UI 加 agent 选择器;agent 配置文件 |
| **Phase 3**(可选) | 模式 C:`@octo/shell` 实现工作流编排 | 真做"用研流水线"再启动 |

详细 UI 交互见 [specs/agents/multi-agent.md](../specs/agents/multi-agent.md)。

---

## 7. Agent 配置在哪里来的?

opencode 从三处发现 agent:

1. **配置文件 `agent` 字段**(在 `~/.config/octo/octo.config.json`):
   ```jsonc
   {
     "agent": {
       "research": {
         "mode": "primary",
         "description": "用户研究助手",
         "prompt": "你是用研专家...",
         "model": { "providerID": "bailian", "modelID": "qwen3-coder-plus" },
         "tools": { "web_search": true, "bash": false }
       }
     }
   }
   ```

2. **本地 markdown 文件**(`~/.config/octo/agents/*.md` 或项目内 `.octo/agents/*.md`),frontmatter 写元数据,正文是 prompt:
   ```markdown
   ---
   mode: primary
   description: 用户研究助手
   model: bailian/qwen3-coder-plus
   tools: [web_search, read_file]
   ---
   你是用研专家,擅长...
   ```

3. **plugin 提供**:opencode plugin 可以注册 agent(高级用法,Octo 不用)

**当前** Octo Agent 还没用上述任何一种,跑的是 opencode 内置的默认 agent("general")。

---

## 8. 工具集如何决定?

每个 agent 配置可以指定 `tools` 字段(`Record<string, boolean>`),决定该 agent 能用哪些工具:

```jsonc
{
  "agent": {
    "research": {
      "tools": {
        "read_file": true,
        "web_search": true,
        "bash": false,           // 显式禁用
        "task": true             // 允许调用 subagent
      }
    }
  }
}
```

**工具来自三处**:

1. **opencode 内置工具**:`read_file / write_file / edit / bash / grep / glob / web_search / lsp / patch / task / todowrite / ...`(见 [packages/opencode/src/tool/](../../packages/opencode/src/tool/))
2. **MCP 工具**:配置的 MCP server 提供的工具(见 [skill-and-mcp.md](skill-and-mcp.md))
3. **Skill 提供的工具**:Skill 包里挂的脚本工具

每个 agent 看到的工具集 = 全集 ∩ 该 agent 的 `tools` 白名单。

---

## 9. 关于"思考"(reasoning / thinking)

部分模型(Anthropic Claude、Qwen3-thinking、GLM-4 等)会在回复前**输出一段思考过程**,不算最终答案。Agent 框架里这段会被识别成 `reasoning` part(见 [opencode-internals.md §Part 类型](opencode-internals.md#4-part-类型清单))。

UI 层通常折叠展示("思考过程 ▾"),不影响 agent loop 逻辑 —— 思考完该调工具调工具,该回答回答。

详情见 [provider-protocols.md](provider-protocols.md)。

---

## 10. 容易混淆的概念

| 概念 | 误解 | 实际 |
|---|---|---|
| Agent | "一个 chatbot" | 一个 LLM + 工具循环的配置 |
| Agent 多轮对话 | "agent 有记忆" | 上下文是 session 持久化的消息列表,LLM 自己没记忆 |
| Subagent | "另一个进程" | 同进程,独立 session 上下文,完了归并结果 |
| 工具 | "插件" | 一个 JSON Schema 描述 + 一个执行函数,opencode 把 schema 喂给 LLM,LLM 决定何时调 |
| Skill | "Agent 的别名" | Skill 是"prompt + 工具 + 资源"的可复用包,**可以被多个 agent 引用**,详见 [skill-and-mcp.md](skill-and-mcp.md) |
| MCP | "另一种 agent 协议" | 一个**工具与资源的标准化协议**,让外部 server 暴露工具给 agent 用 |

---

## 11. 进一步阅读

- 源码:[packages/opencode/src/agent/agent.ts](../../packages/opencode/src/agent/agent.ts)
- task 工具:[packages/opencode/src/tool/task.ts](../../packages/opencode/src/tool/task.ts)
- Anthropic 官方"Building Effective Agents":https://www.anthropic.com/research/building-effective-agents
- 衔接文档:[skill-and-mcp.md](skill-and-mcp.md)、[provider-protocols.md](provider-protocols.md)
- 落地交互:[specs/agents/multi-agent.md](../specs/agents/multi-agent.md)
