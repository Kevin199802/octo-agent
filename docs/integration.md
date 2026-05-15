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
| `packages/agent/insight/agents/insight.md` | 注入 `octo.config.json`（主进程自动写入，见 §3） | 见 §3 |

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
## 3. Agent 配置（主进程自动写入，用户无需手动操作）

Agent 配置通过 Electron 主进程在首次启动时写入 `~/.config/octo/octo.config.json`，详见 §5 及 [learning/agent-deploy.md](learning/agent-deploy.md)。

源文件：`packages/agent/insight/agents/insight.md`
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

## 6. MCP + 上传对接（内网 UXR 服务）

> 接口参数完整定义见 **[docs/specs/agents/mcp-contract.md](specs/agents/mcp-contract.md)**，本节只说接线方式。

### 6.1 架构

```
InsightPage ──multipart/form-data──▶ UXR HTTP 上传接口（非 /mcp）
                                          │ 返回 S3 URL
                                          ▼
InsightPage 将 URL 注入 session.prompt()
                │
                ▼
LLM 调 analyze_interview(doc_urls=[...]) ──MCP── UXR /mcp
```

两个接口分开：上传走普通 HTTP（binary），分析走 MCP（JSON-RPC）。

### 6.2 Octo 客户端配置

```jsonc
// ~/.config/octo/octo.config.json — 在 LLM 配置基础上追加
{
  "mcp": {
    "uxr-tool": {
      "type": "remote",
      "url": "https://uxr-service.company-intranet.com/mcp",
      "enabled": true,
      "timeout": 30000
    }
  },
  "uxr": {
    "upload_url": "https://uxr-service.company-intranet.com/api/upload"
  }
}
```

### 6.3 UXR 服务团队需要做的事

**① 文件上传 HTTP 接口**（非 MCP，普通 HTTP）：

```python
# FastAPI 示例
from fastapi import UploadFile, Form
import requests

@app.post("/api/upload")
async def upload_file(file: UploadFile, path: str = Form(...), prefix_dir: str = Form(...)):
    content = await file.read()
    response = requests.post(
        OBS_UPLOAD_URL,
        files={"file": (file.filename, content, file.content_type)},
        data={"path": path, "prefix_dir": prefix_dir}
    )
    obs_url = response.json()["url"]  # OBS 返回的 S3 地址（格式待确认）
    return {"url": obs_url}
```

**② MCP 分析接口**（`/mcp` 路由，2 个工具）：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("uxr-tool")

@mcp.tool()
async def analyze_interview(doc_urls: list[str], analysis_type: str, context: str) -> str:
    """
    对访谈逐字稿进行结构化分析。
    doc_urls 是 S3/OBS 文件地址列表（由 InsightPage 上传后提供，非文件名）。
    context 为必填项，填写业务背景可显著提升分析质量。
    analysis_type 枚举与含义见 mcp-contract.md（保持单一真相来源，避免与本文档漂移）。
    除 mindmap 类型返回 JSON 外，其余类型均返回 Markdown 表格。
    """
    result = await internal_service.analyze(doc_urls=doc_urls, type=analysis_type, context=context)
    return result  # Markdown 字符串或 JSON 字符串

@mcp.tool()
async def search_reports(query: str) -> str:
    """
    基于内网用研知识库 RAG 检索。
    query 为自然语言检索词，经 embedding 后做向量检索，非 LLM prompt。
    返回 JSON 数组。
    """
    results = await rag_service.search(query)
    return json.dumps(results, ensure_ascii=False)

# 挂载到现有 FastAPI 应用
app.mount("/mcp", mcp.streamable_http_app())
```

**Tool description 写法原则**（影响 LLM 调用准确性）：
- 写明 `doc_urls` 来源："来自客户端上传后的 S3 URL，非文件名"
- 写明 `context` 必填
- 枚举每个 `analysis_type` 的中文含义

---

## 7. 文件上传流程（InsightPage 直传）

> 上传不经过 MCP，由 InsightPage 直接调用 UXR HTTP 上传接口。决策见 [ADR-006](adr/006-upload-architecture.md)。

### 7.1 InsightPage 上传逻辑

```ts
// insight/components/attachment-bar.tsx
async function uploadFiles(files: File[]): Promise<string[]> {
  const uploadUrl = config.uxr.upload_url  // 来自 octo.config.json
  const urls: string[] = []
  for (const file of files) {
    const form = new FormData()
    form.append("file", file)                          // binary，无需 base64
    form.append("path", `aiInterview/${file.name}`)
    form.append("prefix_dir", "asset/aiInterview")
    const res = await fetch(uploadUrl, { method: "POST", body: form })
    const { url } = await res.json()
    urls.push(url)
  }
  return urls
}
```

### 7.2 将 S3 URL 注入 session.prompt()

```ts
// 上传完成后，URL 以文本形式注入 context
const uploadedUrls = await uploadFiles(selectedFiles)

const urlContext = [
  "[已上传文件]",
  ...uploadedUrls.map((url, i) => `- ${selectedFiles[i].name}: ${url}`)
].join("\n")

session.prompt({
  parts: [
    { type: "text", text: urlContext + "\n\n" + promptWithPrefix },
  ]
})
```

LLM 从 `[已上传文件]` 区块提取 `doc_urls`，调用 `analyze_interview`。

### 7.3 文件格式支持

UXR 服务负责文档解析（txt、md、docx、xlsx、pdf），客户端直接上传原始文件，无需自行解析。

---

## 8. 联调验证

### Octo 侧检查

1. 打开 DevTools（`OCTO_DEVTOOLS=1` 启动），Console 里确认：
   ```
   [mcp] connected
   [mcp] tools: analyze_interview, search_reports
   ```
2. 上传文件 → 确认 Network 面板出现对 `upload_url` 的 POST 请求，返回 S3 URL
3. 发指令后 Console 出现 `[mcp] tool call: analyze_interview`，参数中 `doc_urls` 包含正确 URL
4. 对话区出现 OutputCard（表格类型）

### UXR 服务侧检查

```python
# 加临时请求日志
@app.middleware("http")
async def log_mcp(request, call_next):
    body = await request.body()
    print(f"[mcp] {request.method} {str(body)[:300]}")
    return await call_next(request)
```

确认：
- `GET /mcp` 返回工具清单（2 个工具）
- `POST /api/upload` 收到 multipart 请求，返回 S3 URL
- `POST /mcp` 收到 `analyze_interview` 请求并返回 Markdown 表格

### 端到端验证提示词

```
我上传了一份访谈逐字稿，请提取关键用户发现，用表格输出。
```

附一个任意文件，观察完整链路：文件上传 → S3 URL 注入 → LLM 调 analyze_interview → OutputCard。

---

## 9. 本仓库接线改动（供参考，不合入）

| 文件 | 改动 | 目的 |
|---|---|---|
| `desktop-electron/src/main/index.ts` | 注入 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` | 隔离 Octo 配置 |
| `desktop-electron/src/main/index.ts` | 注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | 防污染 agent 行为 |
