# Tools 与 Permissions 配置指南

> 前置阅读：[agent-mental-model.md](agent-mental-model.md)  
> 解答：opencode 有哪些内置工具、MCP 工具怎么接入、权限规则怎么配置。

---

## 1. 工具的本质

工具（Tool）= **一个 JSON Schema 描述 + 一个执行函数**。

opencode 把工具的 JSON Schema 放进 LLM API 的 `tools` 参数，LLM 读完决定"我要调哪个工具、传什么参数"，然后 opencode 执行对应函数，把结果回喂给 LLM，循环继续。

LLM **只能调用它看得到的工具**。agent 的 `tools` 白名单决定了 LLM 的视野范围。

---

## 2. opencode 内置工具（桌面 app 始终可用，共 11 个）

| 工具 ID | 作用 | 典型调用场景 |
|---|---|---|
| `bash` | 执行 shell 命令 | 运行脚本、查系统信息、调 CLI |
| `read` | 读取文件内容 | 看代码、读配置、查日志 |
| `glob` | 文件路径模式匹配（`src/**/*.ts`） | 批量找文件 |
| `grep` | 在文件/目录内搜索文本 | 找函数定义、查引用 |
| `edit` | 精确字符串替换编辑文件 | 改代码、改配置 |
| `write` | 写入/新建文件 | 生成文件、覆盖写入 |
| `task` | 启动 subagent（独立上下文子任务） | 大任务拆分、并行处理 |
| `webfetch` | 抓取指定 URL 的网页内容 | 查文档、看 API 返回 |
| `todowrite` | 在对话里维护 TODO 清单 | 追踪任务进度 |
| `skill` | 加载 Skill 指令包（注入领域 prompt） | 按需扩展 LLM 行为 |
| `question` | 向用户提问（桌面模式始终开启） | 缺少信息时主动确认 |

条件启用（Octo 场景不涉及）：
- `websearch` / `codesearch`：仅限 opencode 官方 provider 或 Exa
- `lsp`：实验性 flag（`OPENCODE_EXPERIMENTAL_LSP_TOOL=true`）
- `apply_patch`：GPT 系列模型专用替代 `edit`

---

## 3. MCP 工具（动态接入）

MCP 工具来自外部 MCP server，通过 `~/.config/octo/octo.json` 的 `mcp` 字段配置。

### 3.1 配置格式

```jsonc
// ~/.config/octo/octo.json
{
  "mcp": {
    "uxr-tool": {                         // 自定义名称，任意字符串
      "type": "remote",                   // remote = HTTP 接入（推荐，服务端部署）
      "url": "https://your-mcp-server/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      },
      "enabled": true,
      "timeout": 30000                    // 分析类请求耗时较长，建议 30s
    }
  }
}
```

`type` 选项：
- `remote`：opencode 作为 HTTP 客户端连接外部服务，工具在服务端执行（团队共用，推荐）
- `local`：opencode 在本机起子进程（stdio），工具在用户本机执行（个人工具，不推荐团队场景）

### 3.2 与内置工具的区别

| | 内置工具 | MCP 工具 |
|---|---|---|
| 代码位置 | `packages/opencode/src/tool/*.ts` | 外部 MCP server |
| 加载时机 | opencode 启动时静态注册 | 连接 MCP server 时动态获取 |
| 执行位置 | opencode 进程内 | MCP server 进程内或远端 |
| agent 白名单过滤 | 完全相同的机制 | 完全相同的机制 |

**对 agent 来说没有区别**：白名单里写工具名，opencode 统一过滤，不区分来源。

### 3.3 Octo insight agent 接入的 MCP 工具

工具接口的完整定义（参数、枚举、返回格式）统一维护在：

> **[docs/specs/agents/mcp-contract.md](../specs/agents/mcp-contract.md)** — 唯一真相来源，本节不重复参数细节。

当前共 **2 个 MCP 工具**：

| 工具 ID | 作用 | 状态 |
|---|---|---|
| `analyze_interview` | 结构化分析（支持 8 种 analysis_type，含思维导图 JSON） | 待联调 |
| `search_reports` | 内网用研知识库 RAG 检索 | 待联调 |

> 注：文件上传（`upload_document`）**不是 MCP 工具**，由 InsightPage 直接调用 HTTP 上传接口，详见 [ADR-006](../adr/006-upload-architecture.md)。

---

## 4. Agent 工具白名单配置

### 4.1 写法（`octo.json`）

```jsonc
{
  "agent": {
    "insight": {
      "tools": {
        "<tool_a>": true,
        "<tool_b>": true
        // 不写 = 不可见；写 false = 显式禁用（效果一样）
        // bash、read、write 等内置工具不在这里 = LLM 看不到
      }
    }
  }
}
```

> insight agent 当前实际工具白名单见 [mcp-contract.md "与 agent 配置的对应关系"](../specs/agents/mcp-contract.md)。本节只讲**白名单的写法机制**。

### 4.2 白名单的作用机制

```
全部工具（11 内置 + N 个 MCP）
         ↓  ∩  agent.tools 白名单
LLM 实际看到的工具集（仅列出的那几个）
```

**白名单只写需要的工具**，其余全部不可见。不需要逐个 `false` 禁用。

### 4.3 特殊工具：`task`（subagent 开关）

`task` 工具允许 LLM 启动 subagent。不写在白名单里，LLM 就无法派发子任务。

insight agent 当前是否启用 task 见 mcp-contract.md。决策依据：是否有"多文档/多任务并行"等需要 subagent 隔离的场景。

---

## 5. Permissions（权限规则）

### 5.1 什么是权限规则

权限规则决定某个工具调用**是否需要先问用户确认**再执行。

| 行为 | 含义 |
|---|---|
| `allow` | 直接执行，不问用户 |
| `ask` | 执行前弹出确认对话框，用户点击后继续 |
| `deny` | 拒绝执行，返回错误给 LLM |

### 5.2 配置格式

权限规则是一个数组，每条规则格式为：

```
"<行为> <工具ID>[/<参数值>]"
```

```jsonc
{
  "agent": {
    "insight": {
      "permission": [
        "allow <safe_tool>",          // 只读/无副作用工具直接执行
        "deny bash",                  // bash 完全禁止（双保险，工具白名单已排除）
        "ask *"                       // 其余工具执行前问用户
      ]
    }
  }
}
```

更精细的参数级控制（了解即可，insight 暂不需要）：

```
"allow bash/ls *"        // bash 只允许执行 ls 开头的命令
"deny bash/rm *"         // bash 拒绝 rm 开头的命令
```

### 5.3 Octo insight agent 的权限策略

策略**全部放行**（具体工具列表见 mcp-contract.md）。理由：
- 当前 MCP 工具都是只读/分析类操作，没有破坏性
- 每次分析都要反复调用，弹确认框会严重影响体验
- LLM 已被工具白名单限制，无法调用危险工具（bash、write 等），不需要再多一层 ask

### 5.4 全局 permission 与 agent permission 的关系

```jsonc
{
  "permission": [           // 全局默认
    "ask bash",
    "allow *"
  ],
  "agent": {
    "insight": {
      "permission": [       // agent 专属（覆盖全局，不叠加）
        "allow <tool_a>",
        "allow <tool_b>"
      ]
    }
  }
}
```

agent 专属 permission 存在时，**完全替换全局规则**（不是合并）。

---

## 6. 当前 insight agent 完整配置

> 当前实际配置（含工具白名单、权限规则）维护在 [mcp-contract.md](../specs/agents/mcp-contract.md) 和 [agent-config-deploy.md](../specs/infra/agent-config-deploy.md)，本文档不重复以避免漂移。

---

## 7. 验证 agent 已注册

重启 Octo 后，打开 DevTools（`OCTO_DEVTOOLS=1` 启动），在 Console 搜索：

```
[agent] loaded: insight    ← 说明 insight agent 被识别
[agent] default: insight   ← 说明默认 agent 已切换
```

发一条任意消息，观察 Console 里的 agent 标签是否从 `build` 变为 `insight`。

也可以在代码里打印确认：

```ts
// 临时调试代码（验证完删除）
const agents = await globalSDK.client.agent.list()
console.log("[debug] agents:", agents.map(a => a.name))
```
