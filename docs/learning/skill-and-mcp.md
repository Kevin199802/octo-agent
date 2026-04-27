# Skill 与 MCP

> 上次同步:2026-04-27。读完这篇,你应该能区分 Skill 和 MCP,知道两者各自适合什么场景,以及 opencode 后端已经支持到什么程度。

前置阅读:[agent-mental-model.md](agent-mental-model.md) 第 2 节"Agent = LLM + 工具集 + Prompt + 模型"。

---

## 1. 一句话区分

| | Skill | MCP |
|---|---|---|
| 是什么 | **可复用的"知识 + 工具 + 资源"包** | **工具/资源跟 agent 通信的协议** |
| 类比 | npm 包 | HTTP 协议 |
| 形态 | 文件夹(`.md` + 脚本 + 资源) | server 进程 / 远程服务 |
| 谁开发 | 你或团队 | 厂商 / 社区 / 你 |
| 加载方式 | 文件系统扫描 | 配置 server 端点 + 启动连接 |
| 典型例子 | "鸿蒙规范生成"、"用研访谈分析" | GitHub MCP、Filesystem MCP、Slack MCP |

**Skill 是"内容 + 工具的捆绑包"**,MCP 是"工具的通信协议"。一个 Skill **可以**包含 MCP server 的配置,反过来不成立。

---

## 2. 先讲 MCP — 协议层

### 2.1 MCP 是什么

**Model Context Protocol** 是 Anthropic 2024 年底推出的开放协议,目标是**统一 LLM 跟外部工具/数据源的通信方式**。

类比:

| 类比物 | 解决了什么 |
|---|---|
| **HTTP** | 浏览器跟 Web 服务器通信,不用每个网站都重发明 |
| **LSP**(Language Server Protocol) | IDE 跟语言服务器通信,VS Code/Vim/Emacs 共享同一个 Python LSP |
| **MCP** | LLM agent 跟工具/数据源通信,Claude Desktop / Cursor / opencode / 自研 agent 共享同一个 MCP server |

**核心价值**:你写一个 GitHub MCP server,Claude Desktop 能用,Cursor 能用,opencode 也能用,**完全不用各自适配**。

### 2.2 MCP 暴露的三类东西

一个 MCP server 可以提供:

| 类型 | 含义 | 例子 |
|---|---|---|
| **Tool** | LLM 能主动调用的函数 | `github_create_issue`、`run_sql`、`send_slack_message` |
| **Resource** | LLM 能读的资源(URI 形式) | `file:///docs/spec.md`、`db://users/123` |
| **Prompt** | 预制 prompt 模板 | `summarize_pr`、`code_review` |

**绝大多数实际应用只用 Tool**。Resource 和 Prompt 用得很少。

### 2.3 三种传输方式

MCP 协议跟传输无关,opencode 支持三种传输:

| 传输 | 启动方式 | 适合 |
|---|---|---|
| **stdio** | 本地起子进程,通过 stdin/stdout 通信 | 本地工具(filesystem、git、本地数据库) |
| **HTTP / streamable HTTP** | 连接远程 HTTP 服务器 | 远程 SaaS(GitHub、Linear、Slack) |
| **SSE** | 同上但走 SSE | 同上(逐渐被 streamable HTTP 取代) |

opencode 的实现见 [packages/opencode/src/mcp/index.ts](../../packages/opencode/src/mcp/index.ts) —— 引入了官方 `@modelcontextprotocol/sdk`。

### 2.4 配置例子

在 `~/.config/octo/octo.config.json` 里:

```jsonc
{
  "mcp": {
    "filesystem": {
      "type": "local",                   // stdio
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/docs"],
      "enabled": true
    },
    "github": {
      "type": "remote",                  // HTTP
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ghp_xxx" },
      "enabled": true
    }
  }
}
```

opencode 启动时会:
1. 读 `mcp` 配置
2. 对每个 enabled 的 server 建立连接
3. 拉取 server 的 tool 清单
4. **自动注入到 agent 的工具集**(只要该 agent 的 `tools` 字段允许)

agent 拿到的工具名通常带前缀:`filesystem_read_file`、`github_create_issue`,避免冲突。

### 2.5 MCP 的认证

很多远程 MCP server 需要认证:

- **简单**:配置里写死 API key 在 `headers` 里
- **OAuth**:opencode 内置了 [McpOAuthProvider](../../packages/opencode/src/mcp/oauth-provider.ts),首次连接时浏览器弹 OAuth 流程,token 存本地

UI 层(我们)需要做的:

- 配置入口让用户填 server 信息
- OAuth 流程触发后,UI 显示"正在等待浏览器授权..."的 loading 状态
- 失败时给清晰的错误提示

---

## 3. 再讲 Skill — 内容层

### 3.1 Skill 是什么

Skill 是一个**自包含的 Agent 能力包**,包含:

- 一个 `skill.md`(描述这个 skill 是什么、什么时候用、怎么用 —— 给 LLM 看的)
- 可选的 `prompt.md`(系统 prompt 增强)
- 可选的 **脚本工具**(`.ts` / `.py`,作为本地工具暴露)
- 可选的 **资源文件**(参考文档、示例、模板)
- 可选的 **agent 配置**(`Agent/` 目录下挂 sub-agent)
- 可选的 **MCP server 配置**(skill 自带 MCP)

参照设计师截图里的"鸿蒙规范生成"skill:

```
skills/
  └── 鸿蒙规范生成/
      ├── skill.md                       ← 描述
      ├── Agent/
      │   └── system-prompt.md           ← 给 LLM 的 prompt
      ├── Assets/
      │   └── tokens.json                ← 鸿蒙设计 token
      ├── eval-viewer/
      │   └── README.md
      ├── references/
      │   └── harmony-guidelines.md      ← 鸿蒙规范文档(给 LLM 当知识)
      ├── Agents/
      │   └── agent-config.json          ← sub-agent 配置
      └── Scripts/
          └── validate.ts                ← 校验工具
```

LLM 用这个 skill 时,能:

- 读 `skill.md` 理解"我能做什么"
- 读 `references/` 里的鸿蒙规范作为知识
- 调 `Scripts/validate.ts` 做规则校验
- 调用 `Agents/` 里配置的 sub-agent

### 3.2 Skill 跟 Agent 的关系

很容易混淆,这里说清楚:

| 维度 | Agent | Skill |
|---|---|---|
| 角色 | "工人" | "工具箱 + 知识包 + 操作手册" |
| 数量 | 一个会话固定一个 primary agent | 一个 agent 可以同时引用**多个** skill |
| 包含 | prompt + tools + model + permission | prompt 增强 + tools + 资源 + 子 agent + MCP 配置 |
| 复用粒度 | 整个 agent 切换 | 按需挂载 skill 到 agent |

**类比**:Agent 是"全栈工程师",Skill 是"写好的库"。一个全栈工程师可以同时用 React、Python、PostgreSQL 三个库 —— 这就是 agent 引用多个 skill。

### 3.3 Skill 是 Anthropic 推的

Skill 概念来自 Anthropic 2025 年的 ["Agent Skills"](https://www.anthropic.com/news/agent-skills):

- Claude 桌面 app / Claude Code 的 skill 都是同一套
- opencode 也已经实现 skill discovery,但目前是**通过 URL 拉远程 skill 包**(`Skill.discovery.pull(url)`)
- 完整 file-system 扫描 skill 的能力还没看到 opencode 完全暴露,需要 Octo 这边补一层

### 3.4 平台 Skill vs 项目 Skill(设计师概念)

设计师截图里把 skill 分两类:

| 类型 | 范围 | 存储 |
|---|---|---|
| **平台技能** | 所有项目共享 | `~/.config/octo/skills/` |
| **项目技能** | 仅当前项目可用 | `<project>/.octo/skills/` |

opencode 后端目前没明确这个区分,Octo 实现时可以用 **目录优先级覆盖** 实现:同名 skill 项目级优先于平台级。

---

## 4. Skill vs MCP — 怎么选

| 场景 | 用 Skill | 用 MCP |
|---|---|---|
| 给 agent 加一段领域知识(规范文档) | ✅ Skill 的 `references/` | ❌ |
| 给 agent 加一个本地脚本(校验、转换) | ✅ Skill 的 `Scripts/` | ⚠️ 也行,但杀鸡用牛刀 |
| 接入第三方 SaaS(GitHub/Slack) | ❌ | ✅ MCP server |
| 操作本地数据库 | ⚠️ 也行 | ✅ MCP filesystem/db server |
| 复用社区生态 | 自己写 | ✅ MCP 已有大量现成 server |
| 跨工具复用(Claude Desktop + Cursor + Octo) | ❌ | ✅ |

**实际上两者经常**配合**:Skill 包里的 `Agents/` 配置可以引用某个 MCP server 的工具,Skill 是"打包带配置 + 知识",MCP 是"实际跑工具"。

---

## 5. opencode 后端能力 vs Octo 要做的

| 能力 | opencode 后端 | Octo UI 要做 |
|---|---|---|
| MCP stdio/HTTP/SSE 连接 | ✅ 已实现 | UI 配置入口 |
| MCP OAuth 流程 | ✅ 已实现 | UI loading + 错误提示 |
| MCP 工具自动注入 agent | ✅ 已实现 | 无 |
| MCP server 状态监控 | ⚠️ Bus 事件已发,但 UI 要订阅展示 | UI 显示 server 健康状态 |
| Skill discovery (URL 拉) | ✅ 已实现 | URL 输入框 |
| Skill 文件系统扫描 | ⚠️ 部分 | UI 列出本地 skill 目录 |
| **在线创建 Skill** | ❌ | **完整向导:填表 → 生成 skill.md → 落盘** |
| Skill 编辑 | ❌ | UI 文本编辑器(参考设计师截图) |

详细 UI 交互见 [specs/agents/skill-system.md](../specs/agents/skill-system.md) 和 [specs/agents/mcp-integration.md](../specs/agents/mcp-integration.md)。

---

## 6. 安全模型

### 6.1 MCP 的安全风险

MCP server 拿到的工具调用参数和返回结果都流过 LLM,有几个风险点:

| 风险 | 说明 | 缓解 |
|---|---|---|
| **Prompt injection** | MCP 返回的内容里塞攻击指令,操控 LLM 后续行为 | 不要把不可信源的 MCP 数据当指令对待;agent prompt 里加防御 |
| **数据外泄** | 恶意 MCP server 收集你发的所有 tool 调用 | 只用可信 server;敏感场景配 OUTBOUND 网络限制 |
| **权限提升** | MCP 工具被 LLM 滥用(比如 LLM 决定 rm -rf) | opencode 内置 `permission` 询问机制 |

### 6.2 opencode 的权限机制

每个 agent 配置 `permission` 规则,匹配 tool 调用时:

```jsonc
{
  "agent": {
    "research": {
      "permission": [
        { "permission": "bash", "pattern": "git *", "action": "allow" },
        { "permission": "bash", "pattern": "rm *", "action": "deny" },
        { "permission": "bash", "pattern": "*", "action": "ask" }   // 其他都问
      ]
    }
  }
}
```

`ask` 时,opencode 通过 SSE 推 `permission.required` 事件,UI 弹对话框让用户授权,用户回应后 agent 继续。

UI 层要做:**永远不能跳过权限对话框**,这是 agent 安全的最后一道防线。

---

## 7. 常见疑问

**Q:不用 Skill 也能配 agent 啊,为什么要 Skill?**
A:能。Skill 的价值是**复用和分发**。一个 prompt 写在 agent 里只有这个 agent 能用;封装成 skill 后,任何 agent 引用即可使用,还能 git 同步、团队共享。

**Q:Skill 跟 RAG 是一回事吗?**
A:不是。RAG 是"动态从向量库检索 chunk 注入 prompt",skill 是"静态打包的能力包"。Skill 里的 `references/` 文档可以一次性全塞进 prompt(适合中小知识体量),也可以配 RAG 做向量检索(opencode 暂不内置 RAG)。

**Q:MCP 工具会不会跟 opencode 内置工具冲突?**
A:opencode 给 MCP 工具自动加 server 名前缀(`filesystem_read_file` vs 内置 `read_file`),所以**名字不会冲突**。但**功能可能冗余**(同时启用 MCP filesystem 和内置 read_file,LLM 会迷惑选哪个),实践中**不要重复注册**。

**Q:能在 UI 里调试 MCP server 吗?**
A:opencode 有 `mcp.tools.changed`、`mcp.browser.open.failed` 等 bus 事件,UI 可以订阅展示。但完整的"调试器"(看每次 tool call 的请求/响应)需要 UI 自己搭。属于 P3 增强。

**Q:Skill 跟 OpenAI Custom GPT 是一回事吗?**
A:理念接近,实现完全不同。Custom GPT 是 OpenAI 平台锁定的、只能 OpenAI 用;Skill 是开放格式的文件包,任何支持的 agent 框架都能加载。

---

## 8. 进一步阅读

- MCP 官方:https://modelcontextprotocol.io/
- Anthropic Agent Skills:https://www.anthropic.com/news/agent-skills
- opencode MCP 实现:[packages/opencode/src/mcp/index.ts](../../packages/opencode/src/mcp/index.ts)
- opencode Skill 发现:[packages/opencode/src/skill/discovery.ts](../../packages/opencode/src/skill/discovery.ts)
- 落地交互:[specs/agents/skill-system.md](../specs/agents/skill-system.md)、[specs/agents/mcp-integration.md](../specs/agents/mcp-integration.md)
