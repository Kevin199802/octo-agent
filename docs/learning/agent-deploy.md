# Agent 注册的作用与配置分发

> 前置阅读：[agent-mental-model.md](agent-mental-model.md)  
> 解答两个问题：①不注册也能对话，注册到底有什么用？②配置文件在本机，发布后用户侧怎么自带？

---

## 1. 不注册 agent 也能对话，注册的意义是什么？

### 现在发生了什么

opencode 有几个**内置 agent**，默认使用的是 `build`：

```ts
// packages/opencode/src/agent/agent.ts（简化）
const agents = {
  build: {
    description: "The default agent. Executes tools based on configured permissions.",
    mode: "primary",
    permission: { "*": "allow" },   // 允许所有工具
  },
  plan: { ... },
  general: { mode: "subagent", ... },   // subagent，不是主对话用的
  explore: { mode: "subagent", ... },
}
```

我们现在没有注册任何自定义 agent，所有对话都跑在 `build` 上。能出结果，因为 `build` 已经是个完整的 agent，权限开放，工具都能用。

### 注册自定义 agent 解决的三个问题

**① System prompt — LLM 不知道自己是谁**

`build` 没有业务相关的 system prompt，LLM 接到"分析这份访谈稿"时，只能靠对话上下文猜测该怎么做：
- 不知道应该调哪个分析 tool 还是自己读文件内容
- 不知道有哪些 analysis_type 选项
- 不知道输出应该是 Markdown 表格格式

注册 `insight` agent 后，system prompt 写明了工作流程和工具选择指南，LLM 每次对话都从这个上下文出发，行为可预期。

**② 工具白名单 — LLM 看到的工具太多**

`build` agent 的权限是 `"*": allow`，MCP 配置好之后，LLM 同时能看到：
- opencode 内置工具（bash、write_file、edit、web_search…）
- 我们的 MCP 工具（具体清单见 [mcp-contract.md](../specs/agents/mcp-contract.md)）

工具太多会让 LLM 困惑，更容易选错（比如直接用 bash 处理文件而不走 MCP）。注册 `insight` agent 后，`tools` 字段只开放用研相关的 MCP 工具，LLM 的选择空间大幅缩小，调用准确率更高。

```markdown
---
tools:
  - <仅白名单内的 MCP 工具>
  # 没有 bash、write_file、edit 等
---
```

> insight agent 实际工具白名单见 [mcp-contract.md](../specs/agents/mcp-contract.md)。

**③ default_agent — 每次新建对话要手动选**

不设 `default_agent` 时，opencode 启动选第一个可见 primary agent（通常是 `build`）。如果未来加了多个 agent（insight、make、chat…），用户每次新建对话可能需要手动选择。

设置 `"default_agent": "insight"` 后，进入 InsightPage 新建的对话自动使用 insight agent，无需用户操作。

### 有无注册的对比

| | 无注册（用 build） | 注册 insight |
|---|---|---|
| LLM 行为 | 靠对话上下文猜 | 由 system prompt 明确指导 |
| 可用工具 | 全部（含 bash、edit 等） | 仅 UXR 相关 MCP 工具 |
| 工具选择准确率 | 较低 | 较高 |
| 默认 agent | build | insight（自动） |
| 误操作风险 | 高（LLM 可能随意写文件） | 低（只能调指定工具） |

---

## 2. 配置文件在本机，发布后用户侧怎么自带？

### 问题的本质

opencode 通过 `OPENCODE_CONFIG` 环境变量读取一个 JSON 文件。如果这个文件不存在或不完整，agent / MCP 都无法生效。

我们要解决的是：**怎么让用户机器上有正确的配置，且改源文件能干净地传到用户那里**。

### 决策：cascading 分层

最终方案是把配置分成三类，各管各的，运行时合并：

| 类别                                  | 谁拥有       | 写在哪                               | 升级行为             |
| ----------------------------------- | --------- | --------------------------------- | ---------------- |
| **A 产品决策**（agent / 系统提示词 / MCP URL） | 我们        | bundle 内（仓库 + 安装包）                | 每次启动从 bundle 读最新 |
| **B 用户机密**（API key / Token）         | 用户        | `~/.config/octo/octo.json` | 用户填，我们永不写        |
| **C 用户偏好**（model / baseURL）         | 用户（我们给默认） | 同上                                | 用户改，我们永不写        |

主进程启动时把 A 与 B+C 合并，写到 `~/.config/octo/.octo-runtime.json`，opencode 实际读取这个 runtime 文件。

**决策背景**：[ADR-008](../adr/008-cascading-config.md)  
**完整实现规格**：[docs/specs/infra/agent-config-deploy.md](../specs/infra/agent-config-deploy.md)

### 各层在仓库里的实际位置

| 类别  | 角色            | 路径                                                                           |
| --- | ------------- | ---------------------------------------------------------------------------- |
| A   | 系统提示词源        | `packages/agent/insight/agents/insight.md`                                   |
| A   | agent/MCP 结构源 | `packages/desktop-electron/resources/default-config.json`                    |
| A   | 安装包内的副本       | `Octo Agent.app/Contents/Resources/{agents/insight.md, default-config.json}` |
| B/C | 用户配置          | `~/.config/octo/octo.json`                                            |
| -   | 运行时合并产物       | `~/.config/octo/.octo-runtime.json`（opencode 读这个）                            |

### 本地开发 vs 打包生产

**完全相同的流程**，只是文件路径不同：

| 阶段 | A 类源读取自 | B/C 类源 |
|---|---|---|
| 开发（`bun dev`）| `packages/agent/...` 和 `packages/desktop-electron/resources/...` 直接读 | `~/.config/octo/octo.json` |
| 打包后 | `process.resourcesPath` 下的副本（extraResources 在构建时同步）| `~/.config/octo/octo.json` |

dev 与 production 行为一致——改源文件 → 重启 main 进程 → 自动生效。**不需要手动 cp 任何文件**。

### 改一处即生效的对应表

| 改什么                   | 改哪个文件                                                     | 怎么生效       |
| --------------------- | --------------------------------------------------------- | ---------- |
| 系统提示词                 | `packages/agent/insight/agents/insight.md`                | 重启 main 进程 |
| agent 工具白名单 / MCP URL | `packages/desktop-electron/resources/default-config.json` | 重启 main 进程 |
| 用户 API key / model 选择 | `~/.config/octo/octo.json`                         | 重启 main 进程 |

### 业界对照

| 工具 | 做法 |
|---|---|
| VS Code | 用户 settings.json 只存 override，默认值在 binary 内 |
| Claude Desktop | claude_desktop_config.json 用户拥有，部分 MCP 默认在 bundle |
| Git | system / global / local 三层 cascading override |

我们采用的 cascading 模式是业界标准做法。

### 当前阶段（实现前）的临时手动方案

完整自动部署逻辑见 spec，实现完成前是手动维护：
- 改 `insight.md` 后手动 cp 到 `packages/desktop-electron/resources/agents/insight.md`
- 手动同步到 `~/.config/octo/octo.json` 的 `agent.insight.prompt` 字段

实现完成后这些手动步骤全部消除。任务在 ROADMAP P2 infra：「首次启动配置写入」。
