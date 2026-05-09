# 内外网对接说明

> 外网（本仓库）与内网 `packages/app/` 保持相同目录结构，按图索骥对接。

---

## 1. 代码合入边界

| 外网路径 | 内网操作 | 说明 |
|---|---|---|
| `packages/app/src/pages/_shell/` | 直接同步目录 | OctoShell 框架层（sidebar + topbar） |
| `packages/app/src/pages/insight/` | 直接同步目录 | 用研 Agent 页面，路径与内网完全一致 |
| `packages/app/src/pages/chat/` | 直接同步目录 | Chat 页面 |
| `packages/app/src/pages/studio/` | 直接同步目录 | Studio 页面 |
| `packages/app/src/app.tsx`（OctoShell 路由分叉） | 手动合并变更 | 见 §2 |
| `packages/agent/research/agents/research.md` | 部署到 `~/.config/octo/agent/` | 见 §3 |

**不合入**：`packages/desktop-electron/` 的 Electron 接线改动（内网有自己的启动方式）。

---

## 2. app.tsx 路由分叉合并

外网在 `app.tsx` 加了 OctoShell 路由分叉，内网合入时需手动对齐以下变更：

```tsx
// 1. 新增 import
import { OctoPageShell, OctoShell } from "@/pages/_shell"
const InsightPage = lazy(() => import("@/pages/insight"))
const ChatPage    = lazy(() => import("@/pages/chat"))
const StudioPage  = lazy(() => import("@/pages/studio"))

// 2. RouterRoot 内加路由分叉逻辑（isInsight / isOctoPage）
// 3. Router 内加路由声明：
<Route path="/" component={() => <Navigate href="/insight" />} />
<Route path="/insight/:id?" component={InsightPage} />
<Route path="/chat"         component={ChatPage} />
<Route path="/studio"       component={StudioPage} />
```

具体 diff 见外网 commit `040d2b2`。

---

## 3. Agent 配置部署

```bash
cp packages/agent/research/agents/research.md ~/.config/octo/agent/research.md
```

---

## 4. 本地调试（外网 Electron 开发时）

```bash
bun --cwd packages/desktop-electron dev
```

启动后直接进入 `/insight`（默认路由重定向），左侧 sidebar 点击 **"+"** 新建对话。

---

## 5. 内网 LLM 配置

```jsonc
// ~/.config/octo/octo.config.json
{
  "provider": {
    "intranet": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://your-llm/v1", "apiKey": "..." },
      "models": { "your-model": { "name": "内网模型" } }
    }
  },
  "model": "intranet/your-model"
}
```

---

## 6. MCP 对接（内网 UXR 服务）

### 6.1 架构选型

**我们选择路径 C**：由 UXR 服务团队在已有服务上直接加 `/mcp` 路由，Octo 客户端以 `remote` 模式连接，无需额外部署适配层。

```
Octo 客户端 ──HTTP（MCP 协议）──▶ 内网 UXR 服务 /mcp
                                      │
                                      ▼
                                 已有业务逻辑
                           （文本提取 / 分析 / 存储）
```

背景见 [docs/learning/mcp-api-integration.md](learning/mcp-api-integration.md)。

### 6.2 Octo 客户端配置

```jsonc
// ~/.config/octo/octo.config.json — 在 LLM 配置基础上追加
{
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

`timeout` 建议 30 秒，分析类请求耗时较长。

### 6.3 UXR 服务团队需要做的事

在已有 HTTP 服务上加一个 `/mcp` 路由，实现 Streamable HTTP 传输。以 Node.js/Express 为例：

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"

function createMcpServer() {
  const server = new McpServer({ name: "uxr-tool", version: "1.0.0" })

  server.tool(
    "upload_document",
    `上传文件到 UXR 平台，返回 doc_id 供后续分析使用。
     支持格式：txt、md、docx、xlsx、pdf。
     必须在调用任何分析 tool 之前先调用此 tool。`,
    {
      filename:       z.string().describe("文件名含扩展名"),
      content_base64: z.string().describe("文件内容 base64 编码"),
      mime_type:      z.string().describe("MIME 类型"),
    },
    async ({ filename, content_base64, mime_type }) => {
      const doc_id = await internalService.upload({ filename, content_base64, mime_type })
      return { content: [{ type: "text", text: JSON.stringify({ doc_id }) }] }
    }
  )

  server.tool(
    "analyze_interview",
    `对已上传访谈逐字稿进行结构化分析，返回 Markdown 表格。
     前置：必须先 upload_document 获得 doc_id。`,
    {
      doc_id:        z.string().describe("upload_document 返回的 ID，不是文件名"),
      analysis_type: z.enum(["key_findings","user_journey","pain_points","opportunity_map"])
                      .describe("key_findings=关键发现; user_journey=用户旅程; pain_points=痛点聚类; opportunity_map=机会地图"),
      context:       z.string().optional().describe("业务背景（可选）"),
    },
    async ({ doc_id, analysis_type, context }) => {
      const result = await internalService.analyze({ doc_id, analysis_type, context })
      return { content: [{ type: "text", text: result.markdown }] }
    }
  )

  return server
}

// 路由处理（无状态，每次请求独立）
export async function handleMcp(req, res) {
  const token = req.headers["authorization"]?.replace("Bearer ", "")
  if (token !== process.env.MCP_ACCESS_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}

// 注册路由（GET + POST 都需要）
app.use(express.json({ limit: "50mb" }))  // base64 文件体积约为原始 1.33 倍
app.all("/mcp", handleMcp)
```

**Tool 描述写法原则**（影响大模型调用准确性）：
- 写明**前置条件**（"必须先 upload_document"）
- 写明**参数来源**（"doc_id 来自 upload_document 返回值，不是文件名"）
- 枚举每个值的**中文含义**

### 6.4 research.md 工具声明

```markdown
---
tools:
  - upload_document
  - analyze_interview
  - batch_analyze
  - search_reports
---

## 工作流程

收到用户的文件和分析需求时，严格按以下顺序：
1. 对每个文件调用 upload_document，记录 doc_id
2. 根据需求选择 analysis_type，调用 analyze_interview
3. 将返回的 Markdown 表格原样输出

## analysis_type 选择

| 用户说 | analysis_type |
|---|---|
| 关键发现、核心观点 | key_findings |
| 用户旅程、操作流程 | user_journey |
| 痛点、问题 | pain_points |
| 机会点、改进方向 | opportunity_map |
```

---

## 7. 文件处理策略

### 7.1 opencode 当前行为（已确认）

| 文件类型 | opencode 处理方式 |
|---|---|
| `text/plain`（txt、md） | 解码 base64 → 以**文本**注入 LLM context |
| 其他类型（docx、xlsx、pdf 等） | 以 `type:"file"` document attachment 直传 LLM provider，**provider 自行解析** |

第二行的关键风险：provider 能否解析取决于它自身的能力，内网模型不一定支持 document attachment 格式，可能静默失败。

### 7.2 文件处理决策

```
文件大小 + MIME 类型？
  ├─ text/plain（txt、md）且 < 30KB（≈ 20K 汉字 ≈ 30K tokens）
  │    └─ opencode 自动注入文本 → LLM 直接读，无需 upload_document
  │
  ├─ text/plain 且 ≥ 30KB
  │    └─ ⚠️ 超限风险：内网模型 context window 通常 8K–32K
  │         → 走 upload_document，UXR 服务做摘要/分块后再分析
  │
  └─ 其他（docx、xlsx、pdf）
       ├─ 内网模型支持 document attachment？
       │    ├─ 支持 → 直接发，provider 解析（不稳定，不推荐生产）
       │    └─ 不支持 → 模型收到乱码或报错
       │
       └─ ✅ 推荐：一律走 upload_document
              UXR 服务负责文本提取，结果可靠且与 provider 无关
```

**30KB 阈值来源**：30KB txt ≈ 20K 汉字 ≈ 30K tokens，超过多数内网模型的安全 context 预算（为 system prompt、历史消息等保留空间）。可根据实际 provider 的 context window 调整。

### 7.3 AttachmentBar 的发送逻辑（P1 实现建议）

```ts
// insight/components/attachment-bar.tsx — 组装 parts 时的分叉
const parts = [
  { type: "text", text: promptText },
  ...attachments.map(a => ({
    type: "file",
    mime: a.mime,
    filename: a.filename,
    url: a.dataUrl,  // base64 DataURL
  }))
]
// 同时在 promptText 里追加提示（引导 LLM 走 upload_document 路径）：
// "以上附件请先调用 upload_document 上传后再分析"
```

> 这样 txt 文件 opencode 自动注入文本（LLM 也能直接读），docx/xlsx 通过 LLM 调 upload_document 走 MCP 路径，两条路并存互不干扰。

---

## 8. 联调验证

### Octo 侧检查

1. 打开 DevTools（`OCTO_DEVTOOLS=1` 启动），Console 里确认：
   ```
   [mcp] connected
   [mcp] tools: upload_document, analyze_interview, ...
   ```
2. 上传 txt 文件 + 发指令，Console 出现 `[mcp] tool call: upload_document`
3. 对话区出现 OutputCard（表格类型）

### UXR 服务侧检查

```ts
// 加临时请求日志
app.all("/mcp", (req, res, next) => {
  console.log("[mcp]", req.method, JSON.stringify(req.body).slice(0, 300))
  next()
}, handleMcp)
```

确认：
- `GET /mcp` 返回 tool 清单
- `POST /mcp` 收到 `upload_document` 请求并返回有效 `doc_id`
- `POST /mcp` 收到 `analyze_interview` 请求并返回 Markdown 表格
- 鉴权失败返回 401

### 端到端验证提示词

```
我上传了一份访谈逐字稿（见附件），请提取关键用户发现，用表格输出。
```

同时附一个任意 txt 文件，观察完整链路：上传 → doc_id → 分析 → OutputCard。

---

## 9. 本仓库接线改动（供参考，不合入）

| 文件 | 改动 | 目的 |
|---|---|---|
| `desktop-electron/src/main/index.ts` | 注入 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` | 隔离 Octo 配置 |
| `desktop-electron/src/main/index.ts` | 注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | 防污染 agent 行为 |
