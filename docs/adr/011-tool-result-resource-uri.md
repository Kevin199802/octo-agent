# ADR-011 — MCP 工具结果交付模型：摘要 + Resource URI + 长任务 submit/query 分离

## 状态

已采纳（2026-05-19）

> 本 ADR 涵盖两个正交但相关的决策：
>
> 1. **结果形态**（§方案对比 A/B/C）— 大内容不内联，走"摘要 text + resource_link"
> 2. **长任务交付模式**（§异步长任务的提交-查询模型）— 30 min 量级的业务工具按 submit/query/stop 分离，用户主动触发查询，不走 LLM 自动轮询或 MCP progress 长连接
>
> 早期版本仅含决策 1；UXR 团队明确分析任务 ~30 min 后追加决策 2,合并在同一 ADR 以保持"工具结果如何交付"的设计完整性。

---

## 背景

`analyze_interview` 等 MCP 工具当前把完整 Markdown / JSON / HTML 内容直接放在 `CallToolResult.content[0].text` 里返回。前端 `detectCard` 嗅探类型后路由到对应渲染器。

随着 UXR 服务端输出形态越来越重（HTML 可视化报告、思维导图 JSON、长表格），这套"全内联"链路在四个层面同时承压：

| 层 | 问题 | 触发阈值 |
|---|---|---|
| **LLM 上下文窗口 / token 成本** | tool result 会被 opencode 写入 `assistant.part`，进入后续轮次 messages 上下文 replay。一份 25KB HTML ≈ 6K tokens，每多一轮都重新计费 | **几 KB 起就显著**，是最致命的一层 |
| MCP JSON-RPC body | 单 response 全文嵌在 JSON 里，受 nginx / 服务端 body limit 制约 | nginx 默认 1MB |
| SSE 流 | 单个 text part 过长拖慢首字延迟、增量解析压力 | 几 MB 起 |
| 前端渲染 | Markdown / mermaid / iframe-HTML 阻塞主线程 | 10MB+ |

我们已经在上行链路（文件上传）通过 [ADR-006](006-upload-architecture.md) 把 base64 over JSON-RPC 改成直传 S3。下行链路本质上是同一个问题的对称版本：**大内容不应该走 RPC payload，应该走对象存储 + URI**。

内网 UXR 团队主动提出："工具输出文件存在内网 S3，可以直接返回 URL，让客户端按需下载/渲染。" 方向对，但纯 URL 化会让 LLM 失去对内容的语义访问能力（用户追问"总结一下刚才报告的前三个洞察"时 LLM 无内容可读）。需要落一个能兼顾**省 token、保多轮、可渲染**的契约。

---

## 方案对比

按"LLM 能看到什么"分三类，对应业界三条主流路径：

### 方案 A：全内联（现状）

```json
{
  "content": [
    { "type": "text", "text": "<完整 Markdown / JSON / HTML 全文>" }
  ]
}
```

| 维度 | 评价 |
|---|---|
| LLM 多轮追问 | ✅ 上下文里有全文，LLM 可总结、可提问 |
| Token 成本 | ❌ 报告每轮都 replay，10KB 报告 ≈ 6K tokens/轮 |
| Body / SSE 压力 | ❌ 全部走 RPC payload |
| 渲染来源 | 客户端 text 切片直接吃 |
| 业界代表 | 早期 LangChain tool、当前的我们 |

### 方案 B：纯引用

```json
{
  "content": [
    {
      "type": "resource_link",
      "uri": "https://uxr.intranet/output/abc123.html",
      "name": "interview-analysis-2026-05-19.html",
      "mimeType": "text/html"
    }
  ]
}
```

| 维度 | 评价 |
|---|---|
| LLM 多轮追问 | ❌ LLM 只看到 URL，无法读内容，追问需要重跑工具 |
| Token 成本 | ✅ 几乎为 0 |
| Body / SSE 压力 | ✅ 无 |
| 渲染来源 | 客户端按需 fetch URI |
| 调试友好度 | ⚠️ DevTools `tool result` 只显示 URL，看不到内容形态 |
| 业界代表 | ChatGPT Code Interpreter 早期版本（file_id） |

### 方案 C：摘要 + Resource URI（采纳）

```json
{
  "content": [
    {
      "type": "text",
      "text": "已生成访谈分析报告（key_findings, 5 个核心洞察）：\n1. 调试流程复杂是最普遍痛点\n2. 算子调参依赖经验...\n（完整内容见下方 Resource）"
    },
    {
      "type": "resource_link",
      "uri": "https://uxr.intranet/output/abc123.html",
      "name": "interview-analysis-2026-05-19.html",
      "mimeType": "text/html",
      "description": "key_findings 完整分析报告"
    }
  ]
}
```

| 维度 | 评价 |
|---|---|
| LLM 多轮追问 | ✅ 摘要里有结构化要点，可总结、可提问 |
| Token 成本 | ✅ 摘要 ≤ 500 字（≈ 200 tokens），完整报告不进上下文 |
| Body / SSE 压力 | ✅ 不传大内容 |
| 渲染来源 | 客户端优先解析 `resource_link`，按 mimeType 路由到对应渲染器后 fetch URI |
| 调试友好度 | ✅ DevTools 能看到摘要 + URL，定位问题快 |
| 与 ADR-006 对称 | ✅ 上行 / 下行都走 S3 URL，心智模型一致 |
| 业界代表 | **MCP 官方规范的 `resource_link` content type**（spec 2025-06）；AWS Bedrock Agents large output handling；Anthropic computer use 截图引用模式 |

### 为什么不是方案 A 的"加大 body limit"小修

考虑过保留 A 路线，只调大 nginx body / 在客户端加截断。否决原因：

- **token 成本是物理问题，不是工程问题**——再大的 body limit 也救不了"每轮 replay 全文"
- 截断方案破坏内容完整性，渲染器无法工作（半个 JSON 解析不出来）
- 与 ADR-006 上行链路不对称，认知负担

### 为什么不是方案 B 的"纯 URL"

UXR 团队的初始提议。否决原因：

- LLM 失去对内容的语义访问能力。用户"帮我把刚才报告里 5 个洞察按优先级排序"将无法直接回答——LLM 不会自己 fetch URL，只能要求重跑工具，多轮体验显著退化。
- 调试时 `[mcp] tool result` 只看到一个 URL，要点开链接 / 处理鉴权 / 在浏览器里再渲染一次，排障路径长。
- 短内容（几 KB markdown 表格）走 URL 反而多一次 HTTP 往返，得不偿失。

---

## 决策

采纳**方案 C**：MCP 工具按内容大小分级返回。

### 契约规则

#### 小内容（≤ 10 KB 文本，且 mimeType ∈ markdown / json）

允许沿用方案 A 的纯 `text` 形态，**为短表格 / 短列表保留低延迟通路**：

```json
{ "content": [{ "type": "text", "text": "<完整 markdown 表格>" }] }
```

#### 大内容 或 二进制 mimeType（html / pdf / docx / xlsx / 图片）

**必须**使用方案 C 的"摘要 + resource_link"双 part 形态：

```json
{
  "content": [
    { "type": "text", "text": "<≤ 500 字结构化摘要>" },
    {
      "type": "resource_link",
      "uri": "<内网持久 URL>",
      "name": "<文件名>",
      "mimeType": "<标准 MIME 类型>",
      "description": "<可选,一句话补充>"
    }
  ]
}
```

详细字段约定、摘要写法指南、各 `analysis_type` 的形态映射见 [mcp-contract.md](../specs/agents/mcp-contract.md)。

### URL 鉴权 / 生命周期

- **URL 必须长期可用**：用户两天后点开旧 OutputCard 不应 404
- **不要短 TTL 预签名**——客户端持久化的是 URL，不是某个 token
- 后续若需鉴权，建议 UXR 在 URL 路径里嵌持久 doc_id，鉴权走客户端注入的 header（与上传同一套）
- Octo 跑在内网，URL 默认走 intranet 网段，不暴露到公网

### 客户端解析优先级

1. **`resource_link` part 存在** → 直接按 `mimeType` 路由到渲染器，URI 作为内容源
2. **仅有 `text` part** → 走现有 `detectCard` 启发式（兼容方案 A）

---

## 后果

### 协议层

- UXR 服务端需要按上述契约实现 `analyze_interview` / 未来其他大输出工具的返回格式
- mimeType 必须用标准 MIME（`text/html` / `application/json` / `application/vnd.openxmlformats-officedocument.wordprocessingml.document` 等），不要自造类型

### 客户端代码

- `detectCard` 增加 "resource_link part 优先"分支（实现细节见 [output-renderers.md §2.5](../specs/ui/output-renderers.md)）
- `OutputCard` 类型新增 `source: "inline" | "uri"` + `uri?: string` + `mimeType?: string` 字段
- 各 renderer 需支持"内容来自 URI"路径：`fetch(uri)` → 拿到内容后走原有渲染逻辑
- Office / PDF 等二进制 mimeType 直接走 [ADR-009](009-no-office-preview.md) 既定路径 `window.api.openPath`，不在 ResultViewer 内渲染

### 与 ADR-010 的关系

ADR-010 的"路线 B：tool_call 检测"逻辑不变，只是后续 part 形态从 `text(全文)` 变成 `text(摘要) + resource_link`。suppress 触发信号（tool_call name）和 loading 占位时机不受影响。

### 与 ADR-006 的对称

| 方向 | 协议 | 载体 |
|---|---|---|
| 上行（用户上传） | InsightPage HTTP multipart 直传 | UXR 内网 S3 URL → 注入 prompt |
| 下行（工具产出，本 ADR） | MCP `resource_link` content | UXR 内网 S3 URL → 客户端按需 fetch |

形成完整对称：**大内容永远走 S3，RPC 只搬指针 + 摘要**。

### 调试 / 联调

- DevTools `[mcp] tool result` 同时看得到摘要文字和 URL，问题定位路径短
- UXR 团队可以在 mock 环境用任意可达 URL（甚至 `data:` URI）跑通客户端渲染链路

---

---

## 异步长任务的提交-查询模型

### 背景

UXR 团队明确单次访谈分析在服务端实际耗时约 **30 分钟**。前文 §方案对比 解决了"大内容怎么传"，但没解决"长任务怎么交付"。这两个问题正交但都属于"工具结果如何送达"的设计范畴，合并在本 ADR 一起决策。

按 [ADR-012](012-mcp-tools-by-capability.md)，业务能力按 N tools 铺开（`run_usability_analysis` / `run_guide_analysis` / `key_findings` / `mindmap` 等），每一个都是长任务。下面的设计是**针对这一类长任务的通用交付模式**，与具体工具名解耦。

### 30 分钟任务的交付路径对比

| 方案 | 机制 | 评价 |
|---|---|---|
| **A. LLM 自动轮询** | tool 返回 `task_id+pending`，LLM 看到 pending 立刻 / 周期性调 status 查询 | ❌ token 爆炸。30 min 内 LLM 会触发几十次 status 查询，每次都进上下文 replay；LLM 不擅长"等多久再问"的节奏判断 |
| **B. MCP progress notifications / SSE 长连接** | tool call 打开一条 Streamable HTTP 长连接，30 min 内服务端持续推 `notifications/progress`，连接末尾返回 final result | ❌ 基础设施不友好。nginx / 云 LB / 内网代理普遍 5–15 min 强制断连；用户合笔记本、切 VPN、关 app 都断连；MCP progress 设计场景是几秒到几分钟，不是半小时批处理 |
| **C. 用户主动查询** | 业务 tool 同步返回 `task_id`（< 5s 完成入库），实际分析后台跑；LLM 提交后主动告知用户"约 30 min 后再来查"；用户**显式**触发查询时，LLM 才调 `get_task_result(task_id)` | ✅ 业界标准。AWS Bedrock Batch、OpenAI Batch API、Google Cloud long-running operations 均采用此模式 |

### 决策

采纳方案 C，配套两件事：

1. **业务工具调用即提交**：MCP 业务工具收到调用 → 立即创建任务记录 → 同步返回 `task_id`（< 5s），实际分析在后台异步进行。业务工具的返回**不包含** resource_link（任务尚未产出）
2. **统一任务管理工具**：`get_task_result(task_id)` 查询、`stop_task(task_id)` 终止。具体契约（参数、status 枚举、各状态返回形态）以 [mcp-contract.md](../specs/agents/mcp-contract.md) 为单一真相来源，本 ADR 不复述字段

### LLM 行为约束（写入 agent prompt）

- 调用任意业务工具拿到 `task_id` 后，**必须明确告诉用户** task_id 与预期时长，提示"稍后回来说'查询任务 xxx'我来帮你查结果"
- **绝不在 LLM 内部自动轮询**：看到 status=pending / processing 不要立即重试，不要循环调用
- 仅当用户**显式**说"查询进度 / 看看好了没 / 任务 xxx 怎么样"时，才调 `get_task_result`
- 用户说"取消任务 / 别跑了"时，调 `stop_task`
- 从对话历史中查找最近的 task_id（用户可能不报 id，只说"刚才那个"）

### 与决策 1 的衔接

`get_task_result` 在 `status="completed"` 时的返回，**正是**本 ADR §方案对比 C 的"摘要 + resource_link"形态。两个决策在此处汇合：

```
业务工具 submit → task_id
                    ↓ (30 min 后用户回来)
get_task_result(task_id)
   ├─ pending/processing → 友好提示文本
   ├─ completed   → text 摘要 + resource_link  (决策 1 形态)
   ├─ failed      → text 错误说明 + isError:true
   └─ stopped     → text "任务已终止"
```

### 与各方案对比的明确否决

- **不选方案 A**：即使做"客户端代码层 polling"（不是 LLM polling），用户体验也不对——30 min 任务用户根本不会傻等，他们会去做别的事。强制保持 session 活跃 / 显示 30 min loading 反而是反人类
- **不选方案 B**：即使 nginx 配到 1 小时、客户端做断线重连，依然解决不了"用户合笔记本"这种现实场景。30 min 跨设备 / 跨网络 / 跨日切换是常态，状态必须落库

### 业界对照

| 服务 | 同等量级任务的交付模式 |
|---|---|
| AWS Bedrock Batch Inference | `CreateModelInvocationJob` 返回 jobArn → 客户端调 `GetModelInvocationJob` 查询 |
| OpenAI Batch API | `POST /v1/batches` 返回 batch_id → 客户端调 `GET /v1/batches/<id>` 查询 |
| Google Cloud AI long-running ops | 返回 operation name → 客户端 poll 或等 webhook |
| GitHub Actions workflow_dispatch | 返回 run_id → 调 `GET /repos/.../runs/<id>` 查询 |

我们的差别仅在"客户端"是 LLM 对话——通过 prompt 把"用户来 poll"显式化即可，不需要重新发明轮子。

### 服务端实现要点（给 UXR 团队）

不需要长连接 / progress 推送支持。需要的：

1. **业务工具路由**：入参校验 → 创建任务记录 → 触发异步 worker（Celery / RQ / Kafka 等现有方案）→ 立即返回 task_id。**5 秒硬超时**，工具不允许阻塞超过这个时长
2. **任务存储**：至少含 `id / status / message / result_uri / created_at`。保留期 ≥ 7 天（用户可能隔几天回来查旧任务）
3. **幂等性**：相同入参短期内（如 5 min）重复提交返回同一 task_id，避免重复消耗算力。建议用入参 hash 作 idempotency key
4. **任务取消**：`stop_task` 收到时，worker 通过约定信号优雅停止；已完成 / 已失败的任务调 stop 不抛错，按当前终态返回
5. **resource_link URI 长期可用**：与决策 1 §URL 鉴权 / 生命周期 一致，不要短 TTL 预签名

---

## 参考

- [ADR-006](006-upload-architecture.md) — 文件上传走直传，不经过 MCP（上行链路）
- [ADR-009](009-no-office-preview.md) — 不在客户端预览 Office 文件
- [ADR-010](010-suppress-raw-output.md) — 机器可读卡片原始输出隐藏策略
- [ADR-012](012-mcp-tools-by-capability.md) — MCP 工具按业务能力铺开（N tools）
- [mcp-contract.md](../specs/agents/mcp-contract.md) — 接口契约（含本 ADR 实际字段约定）
- [output-renderers.md](../specs/ui/output-renderers.md) — 客户端渲染器分发规则
- MCP 官方规范 `resource_link` content type：https://modelcontextprotocol.io/specification/2025-06-18/server/tools#resource-link
