# 内网 API 对接 MCP — 概念与方法（路径 C）

> 前置阅读：[skill-and-mcp.md](skill-and-mcp.md)  
> **实现细节去哪里看**：
> - 工具接口定义 → [docs/specs/agents/mcp-contract.md](../specs/agents/mcp-contract.md)（唯一真相来源）
> - Octo 客户端配置 + UXR 服务端示例 → [docs/integration.md §6](../integration.md)
> - 文件上传为何不走 MCP → [docs/adr/006-upload-architecture.md](../adr/006-upload-architecture.md)
> - 联调检查清单 → mcp-contract.md §11

本文档不重复以上内容，只讲 MCP 对接的**概念、原理、方法论**——这部分不会随工具增减变化。

---

## 概念澄清：Skill 和 MCP 的分工

两者不是替代关系，是**分层协作**：

```
用户自然语言输入
      │
      ▼
大模型（LLM）
      │  读取 agent system prompt
      │  知道"我是用研 Agent，遇到分析任务时调对应 tool"
      │
      ▼ 决定调用哪个 Tool
MCP Tool（具体清单见 mcp-contract.md）
      │  实际执行代码，发 HTTP 请求
      ▼
内网 UXR 服务（/mcp 路由暴露这些 Tool）
```

- **Agent system prompt**：告诉大模型"是谁、能做什么、什么场景用哪个工具"——只是配置和提示词，没有可执行代码
- **MCP Tool**：真正执行 API 调用的代码
- **路径 C**：UXR 团队把 Tool 的代码写在自己服务里（`/mcp` 路由），Octo 这边只填 URL

---

## 1. 路径 C 的高层架构

```
┌──────────── Octo Agent（用户机器） ────────────┐
│  InsightPage → session.prompt() → opencode    │
│                       │                        │
│                  读 octo.config.json           │
│                  发现 mcp.uxr-tool.url          │
└───────────────────────┼────────────────────────┘
                        │ HTTP（MCP 协议）
                        ▼
┌──────── 内网 UXR 服务（已有，加一个路由） ───────┐
│  POST /mcp   ← MCP 协议入口（Streamable HTTP）  │
│  暴露的 Tools 见 mcp-contract.md               │
│  已有内部逻辑：分析模型 / 报告存储 / RAG 检索      │
└────────────────────────────────────────────────┘
```

注意：文件上传不走 MCP 协议（base64 over JSON-RPC 处理大文件不实用），InsightPage 直接 HTTP 上传到 UXR，详见 ADR-006。

---

## 2. MCP 协议是怎么工作的

MCP（Model Context Protocol）= **JSON-RPC over HTTP**，让 LLM 能"远程调函数"。

### 2.1 关键流程

```
1. 能力发现（Discovery）
   客户端 GET /mcp → 服务端返回 tool 清单 + 每个 tool 的 JSON Schema
   
2. 工具调用（Invocation）
   客户端 POST /mcp { method: "tools/call", params: { name, arguments } }
   服务端执行函数，返回 { content: [...] }
   
3. LLM 决策
   LLM 看到 tool 清单（schema + description），自己决定何时调、传什么参数
```

### 2.2 Streamable HTTP 传输

一种 MCP 官方支持的 transport，特点：
- HTTP 长连接，支持服务端推流（SSE）
- 无 session 状态（每次请求独立），易部署
- 与已有 HTTP 服务集成简单（加一个路由就行）

我们选这个 transport 就是为了"在已有 UXR 服务上加 `/mcp` 路由"，不需要单独跑一个进程。

---

## 3. Tool description 写法原则（影响 LLM 调用准确性）

Tool 的 `description` 字段直接决定 LLM 什么时候调、怎么调。**写得差会导致漏调或乱调**。

| 要写的 | 为什么 |
|---|---|
| 前置条件 | LLM 才知道是否要先调别的 tool |
| 参数来源 | 避免 LLM 把"文件名"当成 ID 传 |
| 枚举含义 | 让 LLM 把用户口语映射到正确枚举值 |
| 返回格式 | LLM 才知道结果可以直接展示还是要二次处理 |
| 适用场景 | 减少 LLM 在不该用时强行调 |

具体示例和我们当前 tool 的实际描述见 [mcp-contract.md "Tool 描述写法原则"](../specs/agents/mcp-contract.md)。

---

## 4. 调试方法

### 4.1 客户端侧三个观测点

```
[mcp] connected                      ← MCP 连接建立
[mcp] tools: <name>, <name>, ...     ← 看到的 tool 清单
[mcp] tool call: <name> { ... }      ← LLM 实际发起调用
[mcp] tool result: ...               ← 服务端返回内容
```

启动 Octo 时设环境变量 `OCTO_DEVTOOLS=1` 打开 DevTools 看上述日志。

### 4.2 排查路径

| 现象 | 大概率问题 |
|---|---|
| 没有 `[mcp] connected` | URL 不可达 / Authorization 错误 / 服务端没起 |
| 有 connected 但 tools 为空 | UXR 服务端 `tools/list` 没注册 |
| LLM 不主动调 tool | system prompt 里工作流写得不够明确，或 tool description 不清楚 |
| LLM 调 tool 但参数错 | tool description 没写清楚参数来源/枚举含义 |

### 4.3 服务端侧调试

让 UXR 团队在 `/mcp` 路由加请求日志（语言无关）：

```python
# FastAPI 示例
@app.middleware("http")
async def log_mcp(request, call_next):
    body = await request.body()
    print(f"[mcp-debug] {request.method} {str(body)[:200]}")
    return await call_next(request)
```

这样两端都有日志，对齐调用入参和返回格式很快。

---

## 5. 何时该 / 不该把能力做成 MCP Tool

不是所有功能都适合做 MCP tool。判断原则：

| 适合做 MCP tool | 不适合 |
|---|---|
| LLM 需要按需调用的能力 | UI 层固定流程（如点击按钮上传） |
| 输入输出小（< 100KB JSON）| 大文件传输（base64 撑爆 body） |
| 调用频率低（每次对话几次） | 高频实时数据流 |
| 服务端可执行的业务逻辑 | 需要本地资源访问（应通过 Electron API） |

我们的 `upload_document` 当初差点设计成 MCP tool 就是踩了第二条坑（详见 ADR-006）。**业界标准做法**：文件上传走原生 HTTP/multipart，分析这种"LLM 决策何时调"的能力才走 MCP。

---

## 6. 进一步阅读

- 当前 MCP 工具的接口契约：[mcp-contract.md](../specs/agents/mcp-contract.md)
- 完整接线步骤（配置 + UXR 服务端代码）：[integration.md §6](../integration.md)
- MCP 官方协议文档：https://modelcontextprotocol.io/
