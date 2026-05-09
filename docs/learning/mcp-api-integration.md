# 内网 API 对接 MCP — 实操指南（路径 C）

> 前置阅读：[skill-and-mcp.md](skill-and-mcp.md)  
> 决策背景：内网 UXR 服务团队愿意配合，直接在已有服务上加 `/mcp` 路由，省掉中间适配层。

---

## 概念澄清：Skill 和 MCP 的分工

两者不是替代关系，是**分层协作**：

```
用户自然语言输入
      │
      ▼
大模型（LLM）
      │  读取 research.md 里的 system prompt
      │  知道"我是用研 Agent，遇到访谈分析时调 analyze_interview tool"
      │
      ▼ 决定调用哪个 Tool
MCP Tool（analyze_interview、upload_document…）
      │  实际执行代码，发 HTTP 请求
      ▼
内网 UXR 服务（/mcp 路由暴露这些 Tool）
```

- **Skill / Agent（research.md）**：告诉大模型"是谁、能做什么、什么场景用哪个工具"——只是配置和提示词，没有可执行代码
- **MCP Tool**：真正执行 API 调用的代码，"Skill 里的脚本"就是这里
- **路径 C**：UXR 团队把 Tool 的代码写在自己服务里（`/mcp` 路由），Octo 这边只填 URL

---

## 1. 总体架构

```
┌─────────────────────────── Octo Agent（用户机器） ──────────────────────────┐
│                                                                              │
│  InsightPage → session.prompt() → opencode Server → LLM                    │
│                                          │                                   │
│                              读 octo.config.json                            │
│                              发现 mcp.uxr-tool.url                          │
│                                          │                                   │
└──────────────────────────────────────────┼───────────────────────────────────┘
                                           │ HTTP（MCP 协议）
                                           ▼
┌─────────────────────── 内网 UXR 服务（已有，加一个路由） ──────────────────────┐
│                                                                              │
│  POST /mcp   ← MCP 协议入口（Streamable HTTP）                               │
│                                                                              │
│  暴露的 Tools：                                                               │
│   ├─ upload_document(filename, content_base64, mime_type) → doc_id          │
│   ├─ analyze_interview(doc_id, analysis_type, context)   → 结构化结果        │
│   ├─ batch_analyze(doc_ids[], analysis_type)             → 批量结果          │
│   └─ search_reports(query, limit)                        → 报告列表          │
│                                                                              │
│  已有内部逻辑：文本提取 / 向量索引 / 分析模型 / 报告存储…                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. UXR 服务团队侧：怎么加 `/mcp` 路由

### 2.1 安装依赖

```bash
# Node.js 服务
npm install @modelcontextprotocol/sdk

# Python 服务
pip install mcp
```

### 2.2 Node.js 实现（Express 示例）

```ts
// routes/mcp.ts — 加到已有 Express 应用里
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import type { Request, Response } from "express"

// 创建 MCP Server 实例（可复用，也可每次请求新建）
function createMcpServer() {
  const server = new McpServer({ name: "uxr-tool", version: "1.0.0" })

  server.tool(
    "upload_document",
    `上传本地文件到 UXR 平台，返回 doc_id 供后续分析使用。
     支持格式：txt、md、docx、xlsx、pdf。
     必须在调用任何分析 tool 之前先调用此 tool。`,
    {
      filename:       z.string().describe("文件名，含扩展名，如 interview.docx"),
      content_base64: z.string().describe("文件内容的 base64 编码"),
      mime_type:      z.string().describe("MIME 类型，如 text/plain"),
    },
    async ({ filename, content_base64, mime_type }) => {
      // 调用已有内部逻辑
      const docId = await internalService.uploadDocument({ filename, content_base64, mime_type })
      return { content: [{ type: "text", text: JSON.stringify({ doc_id: docId }) }] }
    }
  )

  server.tool(
    "analyze_interview",
    `对已上传的访谈逐字稿进行结构化分析。
     前置条件：必须先调用 upload_document 获得 doc_id。
     返回 Markdown 表格格式的结构化洞察，可直接展示给用户。`,
    {
      doc_id: z.string().describe("upload_document 返回的文档 ID，不是文件名"),
      analysis_type: z.enum(["key_findings", "user_journey", "pain_points", "opportunity_map"])
        .describe("key_findings=关键发现; user_journey=用户旅程; pain_points=痛点聚类; opportunity_map=机会地图"),
      context: z.string().optional()
        .describe("业务背景（可选），如'我们在做算子开发工具的改版用研'"),
    },
    async ({ doc_id, analysis_type, context }) => {
      const result = await internalService.analyzeInterview({ doc_id, analysis_type, context })
      return { content: [{ type: "text", text: result.markdown }] }
    }
  )

  // 继续注册其他 tool…
  return server
}

// Streamable HTTP 路由处理（无状态，每次请求独立）
export async function handleMcp(req: Request, res: Response) {
  // 鉴权
  const token = req.headers["authorization"]?.replace("Bearer ", "")
  if (token !== process.env.MCP_ACCESS_TOKEN) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }

  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态模式
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}
```

```ts
// app.ts — 注册路由
import express from "express"
import { handleMcp } from "./routes/mcp"

const app = express()
app.use(express.json({ limit: "50mb" })) // 文件 base64 会比较大

app.all("/mcp", handleMcp)               // GET + POST 都走这里
// 已有路由保持不变…
app.listen(3000)
```

### 2.3 Python 实现（FastAPI 示例）

```python
# routes/mcp.py
from mcp.server.fastapi import create_mcp_router
from mcp import McpServer, tool
import base64

server = McpServer("uxr-tool")

@server.tool()
async def upload_document(filename: str, content_base64: str, mime_type: str) -> str:
    """上传文件到 UXR 平台，返回 doc_id 供后续分析使用。必须在调用分析工具前先调用。"""
    content = base64.b64decode(content_base64)
    doc_id = await internal_service.upload(filename, content, mime_type)
    return f'{{"doc_id": "{doc_id}"}}'

@server.tool()
async def analyze_interview(doc_id: str, analysis_type: str, context: str = "") -> str:
    """对已上传访谈逐字稿进行结构化分析。前置：必须先 upload_document。"""
    result = await internal_service.analyze(doc_id, analysis_type, context)
    return result.markdown

# FastAPI 集成
mcp_router = create_mcp_router(server, path="/mcp")

# main.py
from fastapi import FastAPI
app = FastAPI()
app.include_router(mcp_router)
```

### 2.4 Tool 描述的写法原则

Tool 描述直接决定大模型什么时候调、怎么调，写得差会导致漏调或乱调。

| 要写的 | 示例 |
|---|---|
| 前置条件 | "必须先调用 upload_document 获得 doc_id" |
| 返回格式 | "返回 Markdown 表格，可直接展示" |
| 适用场景 | "用户上传了访谈录音稿、逐字稿时使用" |
| 参数来源 | "doc_id 来自 upload_document 的返回值，不是文件名" |
| 枚举含义 | "key_findings=关键发现; pain_points=痛点聚类" |

### 2.5 文件大小处理

base64 编码后文件体积约为原始的 1.33 倍。Express 默认 body 限制是 100kb，必须调大：

```ts
app.use(express.json({ limit: "50mb" }))  // 支持约 37MB 原始文件
```

对于超大文件（> 20MB），建议 UXR 服务提供一个预签名上传 URL（OSS/S3），客户端直传，MCP 只传引用路径。这是 P2 优化。

---

## 3. Octo Agent 侧：配置与调试

### 3.1 octo.config.json 配置

```jsonc
// ~/.config/octo/octo.config.json
{
  "model": "intranet/your-model",
  "provider": { /* 已有 LLM 配置 */ },
  "mcp": {
    "uxr-tool": {
      "type": "remote",
      "url": "https://uxr-service.company-intranet.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_ACCESS_TOKEN"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

`timeout` 设 30 秒，因为分析类请求可能耗时较长。

### 3.2 research.md 配置（Agent 侧）

```markdown
---
tools:
  - upload_document
  - analyze_interview
  - batch_analyze
  - search_reports
---

# 用研 Agent（Octo Insight）

你是专业的用户研究分析师，帮助团队从访谈材料中提取结构化洞察。

## 工作流程

用户发来文件和分析需求时，**严格按以下顺序**操作：

1. 对用户提供的每个文件，调用 `upload_document` 上传，记录返回的 doc_id
2. 根据用户需求选择合适的 `analysis_type`，调用 `analyze_interview`
3. 将返回的 Markdown 表格原样输出，不要重新总结或改写

## analysis_type 选择指南

| 用户说 | 用哪个 analysis_type |
|---|---|
| 关键发现、核心观点、主要结论 | key_findings |
| 用户旅程、使用流程、操作步骤 | user_journey |
| 痛点、问题、不满意的地方 | pain_points |
| 机会点、改进方向、建议 | opportunity_map |

## 注意

- 不要在没有 doc_id 的情况下调用 analyze_interview
- 用户如果没上传文件但让你分析，先询问是否需要上传
```

### 3.3 调试流程

**Step 1：验证 MCP 连接**

启动 Octo Electron 后，打开 DevTools（`OCTO_DEVTOOLS=1` 环境变量或菜单），在 Console 里搜：

```
[mcp] connected   ← 看到这行说明连上了
[mcp] tools:      ← 后面列出 UXR 服务暴露的 tool 清单
```

如果看到 `[mcp] connection failed`，检查：
- URL 是否可达（curl 测一下）
- `Authorization` header 是否正确
- UXR 服务是否已部署 `/mcp` 路由

**Step 2：确认 Tool 被调用**

在 InsightPage 发送一条包含文件的指令，在 Console 里观察：

```
[mcp] tool call: upload_document { filename: "xxx.docx", ... }
[mcp] tool result: { doc_id: "abc123" }
[mcp] tool call: analyze_interview { doc_id: "abc123", analysis_type: "key_findings" }
[mcp] tool result: "| 痛点 | ..."
```

如果 Tool 没被调用，检查 research.md 的工作流程描述是否足够明确。

**Step 3：端到端验证提示词**

在没有真实访谈稿的情况下，用以下提示词触发完整流程：

```
我上传了一份访谈逐字稿（见附件），请提取关键用户发现，用表格输出。
```
同时在 AttachmentBar 附一个任意 txt 文件。

观察：
1. ✅ Console 出现 `upload_document` 调用
2. ✅ 返回 `doc_id`
3. ✅ Console 出现 `analyze_interview` 调用，`analysis_type: "key_findings"`
4. ✅ InsightPage 对话区出现 OutputCard（表格类型）

**Step 4：UXR 服务侧调试**

让 UXR 服务团队在 `/mcp` 路由加请求日志：

```ts
app.all("/mcp", (req, res, next) => {
  console.log("[mcp-debug]", req.method, JSON.stringify(req.body).slice(0, 200))
  next()
}, handleMcp)
```

这样两端都有日志，可以对齐调用入参和返回格式。

---

## 4. 文件传递决策（结合路径 C）

UXR 服务自己实现 `/mcp` 后，文件处理完全在服务端，客户端只做：

```
AttachmentBar 读文件 → base64 DataURL
  → session.prompt({ parts: [text, file_part] })
  → LLM 收到 file_part（base64 内容）
  → LLM 调用 upload_document(filename, content_base64, mime_type)
  → UXR 服务接收 base64 → 文本提取 → 存储 → 返回 doc_id
  → LLM 继续调用分析 tool
```

客户端不需要关心 docx 怎么解析、文件多大——全部交给 UXR 服务处理。

| 文件类型 | 客户端操作 | UXR 服务处理 |
|---|---|---|
| txt / md | 读 base64，发 upload_document | 直接存，无需转换 |
| docx / xlsx | 读 base64，发 upload_document | 用 python-docx / openpyxl 提取文本 |
| pdf | 读 base64，发 upload_document | pdfplumber 提取文本 |
| 超大文件（> 20MB） | P2：预签名 URL 直传 | 接收后分块索引 |

---

## 5. 联调检查清单

完成对接后，双方各自验证：

**UXR 服务团队**
- [ ] `GET /mcp` 返回 tool 清单（MCP 协议的能力发现）
- [ ] `POST /mcp` 能处理 `upload_document` 调用，返回有效 `doc_id`
- [ ] `POST /mcp` 能处理 `analyze_interview` 调用，返回 Markdown 表格
- [ ] 鉴权失败时返回 401，不是 500
- [ ] body size limit 足够大（建议 50MB）

**Octo Agent 侧**
- [ ] DevTools Console 出现 `[mcp] connected` 和 tool 清单
- [ ] InsightPage 上传文件 + 发指令后，Console 出现 `upload_document` 调用
- [ ] 分析完成后对话区出现 OutputCard（表格）
- [ ] research.md 的 `tools` 字段包含所有需要的 tool 名称
