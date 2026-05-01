# opencode Agent 系统

> 来源:阅读 `packages/opencode/src/config/agent.ts` 等源码后总结。事实截止 2026-05-01。任何字段以源码为准。

## 1. Agent 是什么

opencode 里一个 agent = **一份 markdown 文件**:
- 路径:`<config-dir>/{agent,agents}/**/*.md` 或项目 `.opencode/agent/`、`.opencode/agents/`
- frontmatter(YAML)= 配置字段
- markdown 正文 = 系统 prompt

Octo 的 config-dir 已通过 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` 隔离,所以 Octo agent 全部放在 `~/.config/octo/agent/<name>.md`。

## 2. 完整字段(zod schema:`packages/opencode/src/config/agent.ts`)

```yaml
---
# 模型(覆盖默认全局模型)
model: anthropic/claude-sonnet-4-6
variant: thinking          # 该模型的变体(可选)
temperature: 0.7
top_p: 0.95

# 描述
description: "用于用研访谈分析,擅长生成结构化报告"

# 模式
mode: primary              # primary / subagent / all
hidden: false              # subagent 模式下是否在 @ 提示中隐藏

# 颜色(sidebar/UI 显示用)
color: "#3b82f6"           # 或 "primary" / "secondary" / "accent" / ... 主题色

# 步数限制
steps: 30                  # 最大 agentic 迭代(超过强制吐文本)

# 工具权限
permission:                # 取代旧的 tools 字段
  edit: ask                # allow / ask / deny
  bash: deny
  read: allow

# 自定义选项(开放字段)
options:
  custom_key: custom_value

# 禁用
disable: false
---

# 系统 Prompt 在这里写

你是一名专业的用户研究分析师...
```

**关键点**:
- 字段未在 zod 已知列表中的会自动收进 `options`(开放扩展)
- `mode: primary` = 用户主动选择的入口 agent(在 sidebar / agent 列表里能看到)
- `mode: subagent` = 其他 agent 通过 `@<name>` 调用的子 agent
- `mode: all` = 两种身份都有
- **agent 不能直接定义自己的 tools 实现**——它只能控制现有 tools(或 MCP / skill 注入的 tools)的允许/拒绝

## 3. 加载流程

`packages/opencode/src/config/agent.ts` 的 `load(dir)` 函数:
1. 用 glob `{agent,agents}/**/*.md` 扫描目录
2. 对每个文件解析 frontmatter + 正文
3. zod schema 校验,失败的发 `Session.Event.Error` 事件,UI 能收到
4. 返回 `{[name]: Info}` map

后端启动时会扫描 config-dir + 项目 dir,合并出一份 agent 列表。前端可通过 SDK 拿到。

## 4. 跟 Tools / Skills / MCP 的关系

| 概念 | 谁定义 | 谁注入到 agent |
|---|---|---|
| **Tool** | opencode 内置(read/write/edit/bash/glob/grep/patch/task)或 MCP server 提供 | 默认所有 agent 都能用,通过 `permission` 字段限制 |
| **Skill** | 用户在 `<config-dir>/skill/<name>.md` 定义 | 默认所有 agent 都能用,可在 agent frontmatter 关联(具体机制需进一步查证 `packages/opencode/src/skill/`) |
| **MCP Server** | 用户在 config 文件里配置 `mcp.servers` | MCP 暴露的 tools 自动注入到所有 agent,通过 `permission` 限制 |

> ⚠️ Skill 与 agent 的精确绑定机制本文档未深挖,M3+ 实施 skill 系统时再查。当前认知:skill 是 agent 可调用的"指令文件",agent 在 prompt 里通过 `Skill(<name>)` 之类引用。

## 5. Agent 切换(前端视角)

**SDK 暴露**:`/agent` 接口列出所有 agent(对应 `useGlobalSync` 的 `sync.data.agent`)。

**上游 prompt-input 的切换器**(`packages/app/src/components/prompt-input.tsx`):
- 通过 `@<agent-name>` 输入触发 popover,候选项 = `agent.filter(!hidden && mode !== "primary")`(也就是 subagent 列表)
- 用户在某个 session 里发消息时可以指定 `parts: [{type: "agent", name: "research"}, ...]`,后端按指定 agent 处理
- **session 本身不绑定单一 agent**——每条消息都可以指定 agent

**Octo 的设计选择**:
- 我们想要 sidebar 列出 4 个 primary agent(用研 / 综合 / 报告 / 编码),用户点击 = 创建一个新 session,并在第一条消息里 prepend `@<agent>`
- 或者实现"session 与 agent 绑定"的 Octo 业务约定(每个 session 在 session metadata 里记一个 agent_id,UI 层面强制一个 session 只用一个 agent)

## 6. Octo 端实施要点(M2 起点)

1. `~/.config/octo/agent/research.md` 写第一份 agent(用研助手 prompt + 颜色)
2. 启动 dev,通过 SDK `client.agent.list()`(具体 API 待查)拿到列表
3. Sidebar 渲染 = primary agent 列表 + "新建会话"按钮
4. 点击 agent = 创建新 session + 在第一条消息 prepend `@research`(或采用业务约定)

## 7. 待进一步验证

- SDK 拉 agent 列表的精确 endpoint
- Skill 与 agent 的绑定机制
- 上游 prompt-input 是否暴露"agent 选择"为 prop,以便我们传初始值
- session 是否支持 metadata 字段记 agent_id(查 `packages/opencode/src/session/`)

这些细节在 M2 实施时按需查证,不预先深挖。
