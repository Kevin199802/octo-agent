# MCP 接口合同 — UXR 服务团队交付物

> 本文档是 Octo Insight 与 UXR 服务团队的**唯一接口真相来源**。  
> 其他文档（learning、integration、intranet-handoff、ADR 等）均引用本文档，不重复定义接口。
>
> 工具按业务能力铺开（N tools）的决策见 [ADR-012](../../adr/012-mcp-tools-by-capability.md)。

---

## 接入方式

| 项目 | 值 |
|---|---|
| 传输协议 | Streamable HTTP（`POST /mcp`，`GET /mcp` 用于能力发现） |
| 鉴权 | 暂无（内网部署，依赖网络隔离） |
| 超时建议 | 业务工具异步返回 task_id（长任务），状态查询走轮询；具体阈值待联调 |

---

## MCP 工具清单

### 业务能力（按 [ADR-012](../../adr/012-mcp-tools-by-capability.md) 铺开）

| 工具 | 业务含义 | 输入材料 | 备注 |
|---|---|---|---|
| `run_usability_analysis` | 可用性测试分析 | 上传的访谈 / 测试材料 | 长任务，调用即提交，返回 task_id |
| `run_guide_analysis` | 大纲聚类分析（按提纲整理） | 上传的访谈材料 + 提纲 | 长任务，调用即提交，返回 task_id |
| `key_findings` | 自由解析 — 提取用户观点、场景主体、痛点需求等 | 上传的访谈材料 | 长任务，调用即提交，返回 task_id |
| `mindmap` | 思维导图生成 | 上传的访谈材料 | 长任务，调用即提交，返回 task_id；完成时结果为结构化 JSON |
| `search_reports` | 基于内网用研知识库的 RAG 检索 | 自然语言 query | 同步返回 |

**业务工具通用出参（长任务提交即返回）：**

业务工具调用 → 立即创建任务记录 → 同步返回 task_id（< 5s），实际分析后台异步执行。**不返回** `resource_link`（结果尚未产出）；客户端通过后续 [`get_task_result`](#1-get_task_resulttask_id) 查询拿结果。

```json
{
  "content": [
    {
      "type": "text",
      "text": "已提交访谈分析任务（task_id: a8f3c2d1）。\n分析在后台进行，需要一些时间。\n稍后请对我说「查询任务 a8f3c2d1」或「看看分析好了没」，我来帮你查结果。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "pending"
  }
}
```

- `content[].text`：**面向用户的友好提示**，LLM 会原样转述；task_id 嵌在文本里，用户可以记住，也存在 message 历史里供后续轮次 grep
- `structuredContent`：**面向客户端的元数据**，LLM 不看；客户端 UI 可用于显示"任务进行中" badge
- 不返回任何预估时间字段（无法可靠估算，详见 [ADR-011 §LLM 行为约束](../../adr/011-tool-result-resource-uri.md)）

详细查询契约见下方 [§任务管理](#任务管理长任务通用)。

### 任务管理（长任务通用）

> 决策依据：[ADR-011 §异步长任务的提交-查询模型](../../adr/011-tool-result-resource-uri.md)。  
> 业务工具调用即提交（< 5s 同步返回 task_id），实际分析后台异步执行。**LLM 不自动轮询，由用户在对话中显式触发查询/终止**。

#### 1. `get_task_result(task_id)`

查询任务状态与结果。同步返回（< 5s）。客户端只在用户**显式**要求查询时调用。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | string | ✓ | 来自业务工具提交时返回的 ID |

**status 枚举：**

| 值 | 含义 | isError |
|---|---|---|
| `pending` | 任务已入库，尚未开始分析（排队中） | — |
| `processing` | 分析进行中 | — |
| `completed` | 分析完成，结果可取 | — |
| `failed` | 分析失败 | `true` |
| `stopped` | 任务被手动终止（来自 `stop_task` 调用） | — |

**返回示例（按 status 分流，UXR 团队按此 wire 形态实现）：**

**① pending / processing（进行中）：**

```json
{
  "content": [
    {
      "type": "text",
      "text": "任务 a8f3c2d1 仍在分析中（正在聚合洞察）。稍后再来查询。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "processing",
    "message": "正在聚合洞察"
  }
}
```

- `message` 可选；缺失时客户端不显示阶段描述，仅显示"进行中"
- pending 与 processing 形态一致，只差 status 取值

**② completed（完成，摘要 text + N 个 resource_link 形态，决策见 [ADR-011](../../adr/011-tool-result-resource-uri.md)）：**

任务可能产出**多份产物文件**（如同时给出 HTML 报告 + 结构化 JSON + Excel 汇总）。MCP `content` 数组天然支持多个 `resource_link` part 并列，每份文件一个独立 part。

> **关于 text 与 resource_link 混排在同一数组**：`content[]` 是 MCP 协议定义的**多态内容块数组**（同 Anthropic Messages API、OpenAI Chat Completions 的 `content` 形态），text 摘要 part 与 N 个 resource_link part 混排是协议标准，不是本文档的设计选择。数组**顺序即阅读顺序**（先摘要、后文件），承载了"先告诉用户产出什么、再列出文件"的语义。
>
> 不要拆成 `{summary, files}` 这种扁平结构——会脱离 MCP 标准，opencode / Claude Desktop 等所有 MCP client 都按 `content[]` 解析，自定义形态等于 fork 协议，并丢失顺序语义和未来扩展能力（image / audio / 富 part 混排）。

> **关于字段名 `uri` 而非 `url`**：MCP `ResourceLink` 协议规范字段名就是 `uri`（对应 RFC 3986 的 URI 概念，URL 是 URI 的子集）。协议允许 `https://` / `file:///` / `data:...` / 自定义 scheme 等多种形态——例如 Claude Desktop 的文件 MCP server 大量返回 `file://` URI。我们场景下值始终是 `https://`（内网 S3），但**字段名必须沿用 MCP 标准的 `uri`**，否则 opencode 等客户端无法识别。同理，LSP 协议的 `textDocument.uri`、Anthropic Citations 的 `source_uri` 也是这个约定。

```json
{
  "content": [
    {
      "type": "text",
      "text": "任务 a8f3c2d1 已完成,产出 3 份文件:\n\n核心洞察(5 条):\n1. 调试流程复杂是最普遍痛点 (3/3 受访者提及)\n2. 算子调参高度依赖经验积累\n3. 现有可视化工具难以满足复杂场景\n4. 团队协作中文档同步成本高\n5. 新人上手周期超过预期\n\n详细内容见下方文件。"
    },
    {
      "type": "resource_link",
      "uri": "https://uxr.intranet/output/a8f3c2d1/report.html",
      "name": "interview-analysis-report.html",
      "mimeType": "text/html",
      "description": "完整分析报告（可视化版本）"
    },
    {
      "type": "resource_link",
      "uri": "https://uxr.intranet/output/a8f3c2d1/findings.json",
      "name": "key-findings.json",
      "mimeType": "application/json",
      "description": "结构化洞察数据"
    },
    {
      "type": "resource_link",
      "uri": "https://uxr.intranet/output/a8f3c2d1/quotes.xlsx",
      "name": "user-quotes.xlsx",
      "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "description": "用户原话引用汇总"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "completed"
  }
}
```

约束：

- `text` 摘要 part **只有一个**，位于 `content[0]`，统一概括所有产物
- `resource_link` part 可有 **1 至 N 个**，每个对应一份独立可下载的文件；客户端按 `mimeType` 各自路由到对应渲染器（见 [output-renderers.md §2.5](../ui/output-renderers.md)）
- 单文件产出仍合法（N=1，最常见情形）
- 不要把多文件合并成 zip——客户端按 mimeType 分发的能力会失效，业界标准是 N 个独立 resource_link
- 所有 `uri` 都必须长期可用（≥ 7 天，最好持久），见 ADR-011 §URL 鉴权 / 生命周期
- `description` 字段强烈建议填写——多文件场景下让 LLM 转述给用户时可以说明每份的用途

**摘要 text 写法约束（LLM 在多轮对话中持续看到这段，写得好可省 token 又能回答追问）：**

- ≤ 500 字 / ≤ 200 tokens
- 必须包含：核心结构概览（如"产出 3 份文件"、"5 个核心洞察"）+ 关键要点极简列表（≤ 5 条，每条 ≤ 30 字）
- **不要**塞完整段落、长引用、HTML / JSON 片段——这些放在 resource 里
- 上方 ② 的 text 字段就是合格范本

**③ failed（失败）：**

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "任务 a8f3c2d1 分析失败:文档 3 解析超时,UXR 端已记录,请联系服务团队定位。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "failed",
    "message": "文档 3 解析超时"
  }
}
```

- `isError: true` 是 MCP 标准失败标志
- `message` 在 `text` 和 `structuredContent` 双通道,LLM 转述用 text,客户端 UI 错误展示用 structuredContent

**④ stopped（已被手动终止）：**

```json
{
  "content": [
    {
      "type": "text",
      "text": "任务 a8f3c2d1 已被终止。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "stopped"
  }
}
```

#### 2. `stop_task(task_id)`

终止正在进行的任务。同步返回（< 5s）。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | string | ✓ | 待终止任务 ID |

**返回示例：**

**① 任务被成功终止（pending / processing → stopped）：**

```json
{
  "content": [
    {
      "type": "text",
      "text": "任务 a8f3c2d1 已终止。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "stopped"
  }
}
```

**② 任务已是终态（completed / failed / stopped，无需终止）：**

```json
{
  "content": [
    {
      "type": "text",
      "text": "任务 a8f3c2d1 已经完成,无需终止。可以用「查询任务 a8f3c2d1」拿结果。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "completed"
  }
}
```

- 返回**当前终态**(completed / failed / stopped 任一)
- **不抛 isError**——这不是工具自身错误,是状态机不允许的正常分支,LLM 可基于此向用户解释

**③ task_id 不存在：**

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "未找到任务 a8f3c2d1,请确认 task_id 是否正确。"
    }
  ],
  "structuredContent": {
    "task_id": "a8f3c2d1",
    "status": "not_found"
  }
}
```

#### LLM 调用规范（写入 agent prompt）

- 调用业务工具拿到 `task_id` 后，**必须**在回复中显式告知用户 task_id，并提示稍后回来查询
- **绝不在 LLM 内部自动轮询** `get_task_result`：看到 pending/processing 状态不要立即重试或循环
- 仅当用户**显式**询问进度（"看看好了没"、"查询任务 xxx"）时才调 `get_task_result`
- 用户说"取消任务 / 不跑了 / 停掉 xxx"时调 `stop_task`
- 从对话历史中查找最近的 task_id（用户常省略 id 只说"刚才那个"）
- task_id 可同时出现在 `text` part 和 `structuredContent.task_id`，LLM 主要从 text 转述给用户，客户端 UI 可读 structuredContent 做状态展示

---

## 入参 / 出参契约

> 入参 / 出参的具体字段格式由 UXR 团队最终给到，并在另一轮对话中已对齐为通用形态（与具体工具名解耦）。本文档此处只描述**通用骨架**，详细字段以联调时 `GET /mcp` 返回的 schema 为准。

### 通用入参骨架

每个业务工具的**精确入参 schema**由 UXR 团队在 MCP tool 的 `inputSchema` + `description` 字段里自描述（通过 `GET /mcp` 能力发现下发），本文档**不预定义** per-tool 字段。

只约束以下共性：

- **业务工具**（除 search_reports）：入参为**已上传文件 URL** + 业务上下文字符串
  - 文件 URL 来源：[file-upload.md](../infra/file-upload.md)，由 InsightPage 上传后注入 session context
  - 具体形态因工具而异：单文件 / 多文件列表 / 多个角色分明的文件参数（如 `run_guide_analysis` 可能拆 `outline_doc_url` + `interview_doc_urls` 两个参数）—— 由每个工具自己声明
- **search_reports**：自然语言 query 字符串

> 不在本文档列具体字段名是为了避免漂移——MCP 协议天然让 tool 自描述，contract 文档强行复述等于双写。

### 通用出参骨架

- **长任务工具**：同步返回 task_id（< 5s），实际结果通过后续 `get_task_result` 查询获取，详见 [§任务管理](#任务管理长任务通用)
- **search_reports**：同步返回检索结果列表（标题 / 摘要 / 来源 URL）
- 客户端 `detectCard` 自动识别 Markdown / JSON 内容形态做渲染路由，无需 Octo 侧约束具体返回格式

---

## 文件上传（非 MCP）

上传不经过 MCP，是通用能力（各 agent 共用）。  
完整规格见 **[docs/specs/infra/file-upload.md](../infra/file-upload.md)**，决策见 [ADR-006](../../adr/006-upload-architecture.md)。

> 调试阶段可 hardcoded S3 URL 注入 context，跳过上传步骤验证 MCP 主流程。

---

## 提示词模板 → MCP 工具映射

> 提示词模板是客户端行为，完整定义见 [insight-analysis-mode.md](../ui/insight-analysis-mode.md)。  
> 此处仅列出 MCP 侧对应关系。

| 提示词模板 | MCP 工具 | 状态 |
|---|---|---|
| 观点解析 | `key_findings` | 已实现 |
| 按提纲聚类 | `run_guide_analysis` | 已实现 |
| 思维导图 | `mindmap` | 已实现 |
| 可用性测试分析 | `run_usability_analysis` | 已实现，UI 模板待产品 / 设计确认是否加入下拉 |
| 用研知识问答 | `search_reports` | 已实现 |

> 历史草案中的 `generate_persona` / `evaluation_summary` 在本轮内网定稿中未实现，待 UXR 团队后续支持。

---

## Tool 描述写法原则（给 UXR 团队参考）

工具 description 字段直接影响 LLM 调用准确性。每个 tool 的描述必须聚焦单一业务能力，写清楚：

- **何时调用该工具**（明确业务语义，避免和其他 tool 混淆）
- **入参来源说明**（如文件 URL 来自 InsightPage 上传，不是文件名）
- **必填项标注**（业务上下文 context 缺失会显著降低分析质量）
- **多文件角色不明时主动追问用户**：当工具入参含多个角色分明的文件参数（如"大纲 vs 访谈"、"基线 vs 对照"）、而用户上传的文件命名 / 顺序无法可靠区分角色时，**在 description 里明确指示 LLM 先向用户确认对应关系，再发起 tool 调用**，不要硬猜
- **返回为长任务还是同步**（长任务返回 task_id，详见 [§任务管理](#任务管理长任务通用)）

具体每个 tool 的 description 文案由 UXR 团队按上述原则撰写，本文档不约束。

---

## 验证检查清单

联调完成后双方确认：

**UXR 服务侧**
- [ ] `GET /mcp` 返回工具清单，至少包含业务工具 + `search_reports` + `get_task_result` + `stop_task`
- [ ] 业务工具（`key_findings` / `run_guide_analysis` / `mindmap` / `run_usability_analysis`）**5 秒内**同步返回 task_id，不阻塞到分析完成
- [ ] `search_reports` 同步返回检索结果
- [ ] `get_task_result` 五个 status 分支均能命中：`pending` / `processing` / `completed` / `failed` / `stopped`
- [ ] `get_task_result(completed)` 返回 `text` 摘要 part + 1~N 个 `resource_link` part；每个 `uri` 两小时后再次访问仍可达；多文件场景下每个 `mimeType` 准确
- [ ] `stop_task` 对进行中任务能成功终止，对已终态任务返回当前 status 不抛 isError
- [ ] 业务工具幂等性：相同入参短期重复提交返回同一 task_id
- [ ] 文件上传 HTTP API 可用，返回可用于 MCP 入参的 URL

**Octo 客户端侧**
- [ ] DevTools Console 出现 `[mcp] connected`
- [ ] Console 出现工具清单（含任务管理工具）
- [ ] InsightPage 上传文件后 URL 出现在 session context 中
- [ ] 发"观点解析"指令后，Console 出现业务工具调用，**5s 内**收到 task_id
- [ ] LLM 在 task_id 返回后向用户**显式提示** task_id 与"稍后回来查询"
- [ ] LLM **不在内部自动轮询** `get_task_result`（连续观察 2 分钟，无 LLM 主动发起的状态查询）
- [ ] 用户说"查询任务 xxx" → LLM 调 `get_task_result`，completed 时 OutputCard（按 resource_link 渲染）出现
- [ ] 用户说"取消任务 xxx" → LLM 调 `stop_task`，对话中确认终止
- [ ] 关闭 app 重开同一 session，对话历史里的 task_id 仍可通过"查询刚才那个"继续查

---

## 与 agent 配置的对应关系

`packages/agent/insight/agents/insight.md` frontmatter 的工具白名单需覆盖本文档列出的所有业务工具 + `search_reports`，详见该文件。

工具名称如与 MCP server 实际提供的不一致，需**同时**修改：

- 本文档工具清单
- `packages/agent/insight/agents/insight.md` frontmatter
- 涉及对外契约的文档（[intranet-handoff.md](../../intranet-handoff.md)）

其他文档（integration / learning / output-renderers / insight-analysis-mode 等）应通过引用本文档获取最新名称，不复述具体 tool 名。
