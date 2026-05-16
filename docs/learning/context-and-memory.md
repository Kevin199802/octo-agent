# 上下文管理与会话记忆

> 上次同步:2026-04-27。读完这篇,你应该知道 LLM 上下文窗口的本质、opencode 的自动压缩、项目级记忆机制(`AGENTS.md`),以及如何做"项目共享记忆"。

前置阅读:[agent-mental-model.md](agent-mental-model.md)。

---

## 1. 为什么"上下文"是 agent 应用的核心问题

LLM 没有真正的"记忆",每次调用都要把**完整的历史对话 + 系统 prompt + 工具描述**重新发过去。这一坨东西叫**上下文窗口**(context window),有 token 上限:

| 模型 | 上下文上限 |
|---|---|
| Claude Sonnet 4.6 | 200k token |
| GPT-5 | 200k token |
| Gemini 2.5 Pro | 1M token |
| Qwen3 Coder Plus | 1M token |
| GLM-5 | 200k token |

Agent 跑久了,上下文会被三类东西塞满:

1. **系统 prompt + 工具描述**(固定开销,几 k 到几十 k)
2. **历史对话**(用户消息 + assistant 回复)
3. **工具调用结果**(read_file 一个 5k 行的文件就 50k+ token,这是大头)

塞满后:

- 模型质量下降(注意力稀释)
- 报 `context length exceeded`,请求直接失败
- 钱按 token 算,越塞越贵

所以 agent 框架必须做**上下文管理**。

---

## 2. opencode 的自动压缩 (compaction)

opencode 原生支持上下文压缩。实现在 [packages/opencode/src/session/compaction.ts](../../packages/opencode/src/session/compaction.ts),核心逻辑:

### 2.1 触发时机

- **被动触发**:LLM 请求返回 "context exceeded" 错误时,opencode 自动触发压缩并重试
- **主动触发**:用户/UI 调 `/session/:id/compact` 接口
- **配置驱动**:`config.compaction.prune` 控制是否在每轮自动检查并压缩

### 2.2 压缩做什么

1. 选一个**专门的 "compaction" agent**(opencode 内置)
2. 把当前 session 的所有消息喂给它
3. 让它输出**精简摘要**(参考的 prompt 见 [packages/opencode/src/agent/prompt/compaction.txt](../../packages/opencode/src/agent/prompt/compaction.txt)):
   - 已经做了什么
   - 当前在做什么
   - 涉及的文件
   - 下一步要做什么
   - 关键决策与原因
   - 用户偏好/约束
4. 把摘要写入一个 `compaction` Part,**标记历史消息为 "已压缩"**(`time.compacted` 时间戳)
5. 后续 LLM 请求只看摘要,不看原始历史

### 2.3 部分压缩 vs 全量压缩

opencode 的实现是**渐进式**:

- 不是"一上下文超了就全部压缩",而是优先**压缩工具调用结果**(占大头),保留对话原文
- 媒体附件(图片)在极端情况下也会被剥离
- 最后才动 user/assistant 消息原文

### 2.4 配置

`~/.config/octo/octo.json`:

```jsonc
{
  "compaction": {
    "prune": true                 // 默认 true,启用每轮自动检查
  }
}
```

如果想完全禁用自动压缩(性能调试时):

```jsonc
{ "compaction": { "prune": false } }
```

### 2.5 UI 层应该做什么

opencode 通过 SSE 推 `session.compacted` 事件,UI 可以:

- **可见性**:在对话流里显示"📦 已压缩 X 条消息以节省上下文"
- **手动触发**:对话框工具栏放个"压缩"按钮
- **回查**:点压缩 part 能展开看到摘要内容(用 `compaction` Part 渲染)

Octo 当前 ChatView **没渲染** `compaction` Part —— 短期内对话不长不影响,但长会话需要补。

---

## 3. 项目级记忆 — opencode 已经支持

opencode 借鉴了 Claude Code 的 `CLAUDE.md` 机制,实现在 [packages/opencode/src/session/instruction.ts](../../packages/opencode/src/session/instruction.ts)。

### 3.1 自动加载哪些文件

opencode 启动 session 时会**自动**找以下文件并注入 system prompt:

| 位置 | 文件名 | 范围 |
|---|---|---|
| 全局 | `~/.config/opencode/AGENTS.md` | 所有 session |
| 全局 | `~/.claude/CLAUDE.md` | 所有 session(除非禁用) |
| 项目 | 当前目录向上找 `AGENTS.md` | 仅该目录的 session |
| 项目 | 当前目录向上找 `CLAUDE.md` | 仅该目录的 session |

(`CONTEXT.md` 已废弃,但仍兼容)

**注意**:opencode 默认会读 `~/.claude/CLAUDE.md` —— 这是 Claude Code 的全局记忆。**对 Octo Agent 这是污染**,会读到用户跟 Claude Code 沟通的偏好。

### 3.2 Octo 应该禁用 Claude Code prompt

opencode 提供环境变量:

```typescript
process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = "true"
```

设置后**只读 `AGENTS.md`,不读 `CLAUDE.md`**。

**建议改 [packages/desktop-electron/src/main/index.ts](../../packages/desktop-electron/src/main/index.ts)**(在 OPENCODE_CONFIG 注入旁边加一行),让 Octo 完全独立于用户的 Claude Code 配置。这是个 P0 修复,会单独跟你确认。

### 3.3 全局 vs 项目优先级

代码注释里明确:

> "The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md from every ancestor."

也就是**项目级 AGENTS.md 找到第一个就停**(向上查找,最近的赢),不会层层叠加。

注入顺序:**全局 → 项目**(项目级在 system prompt 后面,优先级更高)。

### 3.4 额外的 instructions 字段

`config.instructions` 可以追加任意文件/URL 当作 instruction:

```jsonc
{
  "instructions": [
    "/Users/me/team-conventions.md",
    "https://internal-docs.company.com/coding-style.md"
  ]
}
```

适合"团队规范、行业术语表、内网约定"这种**所有 agent 都需要的通用上下文**。

---

## 4. 项目级共享记忆 — 像 Claude Project 那样

你提的"基于内网的项目/版本级共享记忆"问题。Claude Project 的实现是:

- 项目级 system prompt(项目设定)
- 项目级文件附件(每次对话都带上)
- 没有"自动学到的"记忆,全是显式配置

opencode 已有的能力**完全能覆盖 Claude Project 的功能**,组合方式:

### 4.1 项目级 system prompt → 用 `AGENTS.md`

把项目设定写进项目根的 `AGENTS.md`:

```markdown
# 项目:Devkit (ICT 计算)

## 背景
内网开发者工具集,用户是 ICT 计算 BU 的工程师。

## 用户偏好
- 代码示例优先用 TypeScript
- 文档中文输出
- 不要建议安装新依赖,优先复用现有

## 数据访问
本项目所有数据查询走 MCP server "devkit-db",不要让用户写原始 SQL。
```

每次该项目的 session 创建时自动注入。

### 4.2 项目级附件 → 用 `instructions` 字段

需要团队所有人共享的附加文档,放进项目级 `octo.json`(注意是项目级配置,不是全局):

```jsonc
// <project>/.octo/octo.json
{
  "instructions": [
    "./docs/internal-conventions.md",
    "./docs/data-schema.md"
  ]
}
```

opencode 有项目级配置加载机制(从当前目录向上找 `opencode.json`),Octo 可以扩展为也支持 `.octo/octo.json`(实施细节见 spec)。

### 4.3 项目内多 session 共享上下文 → 用 `parent_id`

opencode 的 SessionTable 有 `parent_id` 字段([session.sql.ts:24](../../packages/opencode/src/session/session.sql.ts#L24))。一个 session 可以"派生自"另一个,继承上下文。

这就是 subagent 的实现方式:`task` 工具创建子 session,`parent_id = 父 session id`,完成时摘要回流。

实际"项目级长期记忆"也可以用这个模式:

```
项目级"主 session"(长期存在,不删)
    │
    ├─ 用户每次新建对话,parent_id 指向主 session
    │   └─ 自动继承主 session 的上下文摘要
    │
    └─ 主 session 通过定期压缩保持精炼
```

这是 P3 设计,目前不必实现。

### 4.4 内网"版本"概念怎么对应

你提到"内网的项目/版本级"。版本概念在 opencode 模型里没直接对应,**但可以映射成 project 的元数据**:

- 一个项目对应一条 `project` 表记录(按 directory 绑定)
- 版本信息可以挂在 `AGENTS.md` 里("当前版本:V_261230,所有产品决策遵循 docs/v261230-spec.md")
- 切换版本 = 切换项目目录,或者改 `AGENTS.md`

**短期不要在 opencode 数据模型上加"version"字段**,用 markdown 表达即可。

---

## 5. 上下文优化的实战清单

帮 agent 跑得久 + 跑得便宜的几个手段:

### 5.1 工具结果不要全塞

- `read_file` 大文件只读关键段(用 offset/limit)
- `bash` 长输出截断(opencode 有 [Truncate 工具](../../packages/opencode/src/tool/) 自动截尾)
- `grep` 加 -m 限制结果数

### 5.2 不必要的 part 可以剔除

opencode 把"工具调用结果"当成可压缩对象,但**有些 part 不应被压缩**:

- 用户原始问题(永远保留)
- 关键决策对话
- 当前在做的子任务

工具调用 metadata 里有 `loaded` 字段([instruction.ts:42](../../packages/opencode/src/session/instruction.ts#L42)),记录这次调用读了哪些文件 —— 如果文件被读过,后续不要重复读。

### 5.3 切到大上下文模型

短期上下文紧张,临时切到 1M token 的模型(Qwen3 Coder Plus / Gemini 2.5 Pro)便宜。

### 5.4 拆 subagent

长任务拆成多个子任务,每个 subagent 独立上下文,主 session 只看摘要。详见 [agent-mental-model.md §4](agent-mental-model.md#4-primary-agent-vs-subagent)。

### 5.5 设置 `steps` 上限

agent 配置里可以设 `steps`(最大循环步数),防止失控:

```jsonc
{
  "agent": {
    "research": { "steps": 30 }
  }
}
```

到达上限会停止并报告。

---

## 6. SQLite 持久化跟上下文的关系

容易混淆的概念:

| 是什么 | 存在哪 | 用途 |
|---|---|---|
| **历史消息** | SQLite `message` + `part` 表 | 永久保存,UI 重新打开能看到完整对话 |
| **LLM 上下文** | 内存,每次请求重新拼 | 给 LLM 看的精简版本(可能含压缩摘要) |
| **session 元数据** | SQLite `session` 表 | id、title、project_id、time_compacting 等 |

**关键点**:SQLite 里的消息**永远是原始版本**,压缩只影响"喂给 LLM 的"那份。所以 UI 能展示完整历史,LLM 看的是压缩摘要 —— 两者**不冲突**。

回放/分享会话时也用 SQLite 原始数据,不受压缩影响。

---

## 7. opencode 已有 vs Octo 要做的

| 能力 | opencode 后端 | Octo 要做 |
|---|---|---|
| 上下文压缩 | ✅ 完整实现 | UI 展示压缩 part + 手动触发按钮 |
| `AGENTS.md` 项目记忆 | ✅ 完整实现 | UI 创建/编辑 AGENTS.md 的入口(可选) |
| 全局 `~/.config/opencode/AGENTS.md` | ✅ | 改成 `~/.config/octo/AGENTS.md`(可选,跟 OPENCODE_CONFIG 类似的隔离) |
| `config.instructions` 字段 | ✅ | 设置页 UI 入口 |
| 禁用 `~/.claude/CLAUDE.md` 污染 | ⚠️ 需主进程注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | **P0 修复** |
| 项目目录扫描 `.octo/octo.json` | ❌ opencode 找的是 `opencode.json` | 改 OPENCODE_CONFIG_DIR 注入,或 P2 自行实现 |
| 项目级"主 session"长期记忆 | ⚠️ 用 parent_id 能拼,但没现成 UI | P3 设计 |

---

## 8. 常见疑问

**Q:压缩后历史还能搜吗?**
A:能。SQLite 里完整保留,UI 搜索走 SQLite 不受压缩影响。

**Q:压缩的"精简摘要"准确吗?会不会丢关键信息?**
A:取决于 compaction agent 用的模型。默认用当前 session 的同一个模型。质量不稳时可以单独配 compaction 用更强的模型(opencode 支持)。

**Q:项目目录怎么定?**
A:opencode 启动 session 时根据当前 working directory 找最近的 `.git` 或 `package.json` 等,一直向上。Octo Agent 当前 cwd 是 `homedir()`(主进程入口设置的),所以默认是用户家目录这个"项目"。要支持多项目,UI 需要让用户**显式选项目目录**(对应设计师截图里的 "Devkit/ICT计算" 项目选择器,目前不实现)。

**Q:`AGENTS.md` 跟 agent 的 prompt 字段什么关系?**
A:`AGENTS.md` 是**全局/项目共享的**指令,所有 agent 都吸收;agent 的 `prompt` 字段是**该 agent 专属**的角色设定。两者拼接成完整 system prompt。

**Q:多用户怎么共享项目记忆?**
A:把 `AGENTS.md` 放进项目 git 仓库就行 —— 团队 clone 项目自动获得共享记忆。这是 Claude Code 同款做法。

---

## 9. 进一步阅读

- 源码:[packages/opencode/src/session/compaction.ts](../../packages/opencode/src/session/compaction.ts)
- 源码:[packages/opencode/src/session/instruction.ts](../../packages/opencode/src/session/instruction.ts)
- Anthropic "Effective context engineering":https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude Code CLAUDE.md 文档:https://docs.claude.com/en/docs/claude-code/memory
