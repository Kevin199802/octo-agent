# Per-call System Prompt — opencode 元数据传递机制

> 前置阅读：[agent-mental-model.md](agent-mental-model.md) — 理解 agent.prompt 是什么。  
> 这篇解释：怎么在不修改 agent 本身的情况下，给单次对话注入额外的系统指令。

---

## 1. 问题场景

InsightPage 有 6 个提示词模板。每次发送时需要告诉 LLM 当前选了哪个，但又不想：

- 改 agent.prompt（那是全局的，写死 6 种模板不现实）
- 污染用户消息（`[模板:xxx] ...` 在历史里碍眼）
- 每次都重写完整规则（与 agent.prompt 重复）

需要一个**单次有效的系统指令注入**机制。

---

## 2. 业界做法（同类能力对照）

| 平台 | 字段 | 行为 |
|---|---|---|
| Anthropic Messages API | `system` | 每次调用独立传，与历史 messages 分离 |
| OpenAI Assistants API | `additional_instructions` | 每次 run 追加到 assistant 的 instructions |
| LangChain | `RunnableConfig.configurable` | 运行时上下文，不污染 prompt template |
| **opencode** | `session.prompt({ system })` | 每次调用追加到 agent.prompt 之后 |

本质都是把"单次指令"与"全局 prompt"分离，避免污染。

---

## 3. opencode 的实现细节

### 3.1 API 形态

```ts
await session.prompt({
  sessionID,
  agent: "insight",
  system: "本轮请使用 analysis_type=key_findings",   // ← 单次系统指令
  parts: [{ type: "text", text: 用户输入 }]
})
```

`system` 字段在 SDK 类型定义中是 `string`（可选）：

```ts
// packages/sdk/js/src/gen/types.gen.ts
export type SessionPromptData = {
  body?: {
    agent?: string
    system?: string                  // ← 这个字段
    parts: Array<...>
    // ...
  }
}
```

### 3.2 服务端拼接顺序

opencode 服务端把所有系统级 prompt **拼成一条** system 消息发给 LLM，顺序如下（[packages/opencode/src/session/llm.ts:100-112](../../packages/opencode/src/session/llm.ts#L100-L112)）：

```ts
const system: string[] = []
system.push([
  ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
  ...input.system,                              // ← 本次调用传入的
  ...(input.user.system ? [input.user.system] : []),
].filter(x => x).join("\n"))
```

最终 LLM 收到的 system 消息长这样：

```
<agent.prompt 内容（insight.md 全文）>
<input.system 内容（本次模板指令）>
<user.system 内容（罕见）>
```

三段拼接，`\n` 分隔，一条 system role 消息送达 LLM。

### 3.3 与对话历史的关系

- system 消息**只代表当前请求**，不影响历史消息
- 下一次请求 `system` 字段可以不同，LLM 会看到新的 system 消息
- 历史 user/assistant 消息保持不变

所以用户切换模板时，每次发送都重新声明当前模板，**不会发生记忆漂移**。

### 3.4 三层 Prompt 结构总览

把上面的拼接逻辑可视化，可以理解为 prompt engineering 的三层结构：

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1：agent.prompt（系统提示词，per-agent 写死）          │
│   位置：insight.md frontmatter                              │
│   生效范围：这个 agent 的所有对话                              │
│   内容：角色定位、工作流、analysis_type 选择规则、注意事项         │
├──────────────────────────────────────────────────────────┤
│ Layer 2：input.system（per-CALL 系统指令，每次调用可不同）     │
│   位置：session.prompt({ system: "..." })                  │
│   生效范围：这一次发送                                         │
│   内容：本轮模板的 systemHint / A/B 测试变体 / 临时调试约束       │
├──────────────────────────────────────────────────────────┤
│ Layer 3：parts[].text（用户输入，每次调用可不同）               │
│   位置：session.prompt({ parts: [{type:"text", ...}] })    │
│   生效范围：这一次发送                                         │
│   内容：用户在输入框打的字                                      │
└──────────────────────────────────────────────────────────┘
        ↓ opencode 服务端拼接（llm.ts:100-112）
        ↓
LLM 实际收到：
  system role: <Layer 1>\n<Layer 2>     ← 拼成一条 system 消息
  user role:   <Layer 3>                 ← 用户消息
```

**关键认知**：
- Layer 1 是"定义层"，写一次用很多次（agent 全局规则）
- Layer 2 是"调用层"，每次发送可不同（动态系统指令注入）
- Layer 3 是"输入层"，用户实际输入

Layer 2 和 Layer 3 都是 per-call 的，区别在于：Layer 2 进 system role（指令性），Layer 3 进 user role（对话性）。这个角色分离让 LLM 能正确识别"任务约束"和"用户问题"。

### 3.5 各层在仓库里的实际位置（开发期速查）

> 这是开发时最常用的"我要改 prompt 应该改哪个文件"速查表。  
> Layer 1 完整的部署架构见 [agent-deploy.md §2](agent-deploy.md) 和 [agent-config-deploy.md spec](../specs/infra/agent-config-deploy.md)。

| 层 | 角色 | 文件路径 | 改了之后怎么生效 |
|---|---|---|---|
| L1 | agent.prompt 源（系统提示词） | `packages/agent/insight/agents/insight.md` | 重启 main 进程，cascading 自动注入到 runtime |
| L1 | agent 结构 / MCP URL 源 | `packages/desktop-electron/resources/default-config.json` | 重启 main 进程，cascading 自动合并 |
| L2 | systemHint 定义（6 个模板） | `packages/app/src/pages/insight/store/prompt-template.ts` | HMR 即时生效（前端代码） |
| L2 | systemHint 调用 | `packages/app/src/pages/insight/index.tsx` 的 `handleSend` | HMR 即时生效 |
| L3 | 用户输入 | （运行时，无文件） | 来自 `PromptInput` 组件 |

**Layer 1 与 Layer 2 在不同包的原因**：
- Layer 1（agent 定义、prompt）是 opencode 后端读取的，属于 agent 配置，源在 `packages/agent/`（合入物，会同步到内网仓库）
- Layer 2（提示词模板）是前端 UI 代码，属于客户端业务逻辑，源在 `packages/app/src/pages/insight/`（同样是合入物）

两者都是合入物，但归属不同：L1 给 opencode 读，L2 给前端用。

**运行时合并产物**（不要手动改）：`~/.config/octo/.octo-runtime.json` —— 主进程把 bundle 默认值（包含 L1）+ 用户文件（API key / model）合并后写入这里，opencode 实际读取它。详见 [ADR-008](../adr/008-cascading-config.md)。

---

## 4. 典型使用场景

### 4.1 单次任务约束（本项目用法）

```ts
// 用户选了"观点解析"模板
session.prompt({
  system: "本轮使用 analysis_type=key_findings，三列 Markdown 表格输出",
  parts: [{ type: "text", text: 用户消息 }]
})
```

### 4.2 A/B 测试 prompt 变体

```ts
const variant = Math.random() > 0.5 ? "你必须用第一人称回答" : "你必须用第三人称回答"
session.prompt({ system: variant, parts: [...] })
```

### 4.3 调试临时约束

```ts
session.prompt({
  system: "本轮回答只输出 JSON，禁止任何额外文字",
  parts: [...]
})
```

---

## 5. 注意事项

### 5.1 模型兼容性

所有支持 OpenAI Chat Completions 标准的模型都能处理 system role：

- 国产模型（DeepSeek / Qwen / GLM / MiniMax）协议层完全兼容
- 不同模型对系统指令的**遵循能力**不一样：大模型严格执行，小模型可能忽略细节
- 联调时观察"切换模板 → LLM 是否真的换了 analysis_type"

### 5.2 prompt cache 影响

DeepSeek 等支持 prompt cache 的模型：
- 同模板下多轮对话：system 不变 → 缓存命中
- 切换模板：system 变化 → 缓存失效一次，下轮重新命中

成本影响在用户切换模板时存在，但模板内多轮对话仍享受缓存。

### 5.3 不要用 system 字段做什么

- ❌ 传文件内容（用 parts.file 或注入到 user 消息）
- ❌ 传业务数据（dropdown 选项、表单字段等用 metadata 类机制，本项目暂不需要）
- ❌ 替代 agent.prompt（agent 全局规则应该写在 insight.md，不要每次调用都重传）

---

## 6. 与本项目的对应

提示词模板架构使用本机制，决策见 [ADR-007](../adr/007-prompt-template-via-system-field.md)，实现规格见 [docs/specs/ui/insight-analysis-mode.md](../specs/ui/insight-analysis-mode.md)。
