# MCP 接口合同 — UXR 服务团队交付物

> 本文档是 Octo Insight 与 UXR 服务团队的**唯一接口真相来源**。  
> 其他文档（learning、integration、ADR 等）均引用本文档，不重复定义接口。

---

## 接入方式

| 项目 | 值 |
|---|---|
| 传输协议 | Streamable HTTP（`POST /mcp`，`GET /mcp` 用于能力发现） |
| 鉴权 | 暂无（内网部署，依赖网络隔离） |
| 超时建议 | 30 秒（分析类请求耗时较长） |

---

## MCP 工具（共 2 个）

### 1. `analyze_interview`

对访谈逐字稿进行结构化分析。接受 1 或多个文档 URL，服务端处理后返回结果。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `doc_urls` | `string[]` | ✓ | S3/OBS 文件地址列表（由 InsightPage 上传后注入，见下方 §Client HTTP API） |
| `analysis_type` | enum | ✓ | 见下方枚举值 |
| `context` | string | ✓ | 业务背景，如"算子开发工具用研"，影响分析角度 |

**`analysis_type` 枚举值：**

| 值 | 含义 | 状态 |
|---|---|---|
| `key_findings` | 关键发现 / 核心观点 | Phase 1 优先 |
| `user_journey` | 用户旅程 / 使用流程 | Phase 1 |
| `pain_points` | 痛点聚类 | Phase 1 |
| `opportunity_map` | 机会点 / 改进方向 | Phase 1 |
| `cluster_by_outline` | 按提纲聚类 | Phase 2 |
| `generate_persona` | AI 用户画像 | Phase 2 |
| `evaluation_summary` | 评估问题整理 | Phase 2 |
| `mindmap` | 思维导图结构 | Phase 2 |

**返回格式**：Markdown 或 JSON，由 UXR 服务端决定。客户端 `detectCard` 自动识别格式，无需 Octo 侧约束。多文档时须在结果中注明来源文件。

---

### 2. `search_reports`

基于内网用研知识库进行 RAG 检索。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | ✓ | 自然语言检索词，经 embedding 后做向量检索（非 LLM prompt） |

**返回（JSON）：**

```json
[
  {
    "title": "算子开发工具用研报告 2025-Q1",
    "excerpt": "受访者普遍反映调试流程复杂，主要集中在...",
    "source": "https://intranet/reports/xxx"
  }
]
```

---

## 文件上传（非 MCP）

上传不经过 MCP，是通用能力（各 agent 共用）。  
完整规格见 **[docs/specs/infra/file-upload.md](../infra/file-upload.md)**，决策见 [ADR-006](../../adr/006-upload-architecture.md)。

> 调试阶段可 hardcoded S3 URL 注入 context，跳过上传步骤验证 MCP 主流程。

---

## 6 种提示词模板 → MCP 工具映射

> 提示词模板是客户端行为，完整定义见 [insight-analysis-mode.md §2](../ui/insight-analysis-mode.md)。  
> 此处仅列出 MCP 侧对应关系，以 spec 文件为准。

| 提示词模板 | MCP 工具 | analysis_type | 状态 |
|---|---|---|---|
| 观点解析 | `analyze_interview` | `key_findings` | Phase 1 |
| 按提纲聚类 | `analyze_interview` | `cluster_by_outline` | Phase 2 |
| AI用户画像 | `analyze_interview` | `generate_persona` | Phase 2 |
| 思维导图 | `analyze_interview` | `mindmap` | Phase 2 |
| 评估问题整理 | `analyze_interview` | `evaluation_summary` | Phase 2 |
| 用研知识问答 | `search_reports` | — | Phase 1 |

---

## Tool 描述写法原则

工具 description 字段直接影响 LLM 调用准确性：

```python
# Python MCP SDK 示例
@mcp.tool()
async def analyze_interview(doc_urls: list[str], analysis_type: str, context: str) -> str:
    """
    对访谈逐字稿进行结构化分析。
    前置条件：doc_urls 必须是有效的 S3/OBS 文件地址（由 InsightPage 上传后提供）。
    context 为必填项，填写业务背景可显著提升分析质量。
    除 mindmap 类型返回 JSON 外，其余类型均返回 Markdown 表格，可直接展示给用户。
    """
```

必须写明：
- **doc_urls 来源**："来自客户端上传后的 S3 URL，不是文件名"
- **context 必填**
- **枚举含义**：每个 analysis_type 值的中文含义
- **返回格式**区别（Markdown vs JSON）

---

## 验证检查清单

联调完成后双方确认：

**UXR 服务侧**
- [ ] `GET /mcp` 返回工具清单，包含 2 个工具：`analyze_interview`、`search_reports`
- [ ] `POST /mcp` 处理 `analyze_interview(analysis_type: "key_findings")`，返回 Markdown 表格
- [ ] `POST /mcp` 处理 `search_reports(query: "...")`，返回 RAG 结果 JSON
- [ ] 文件上传 HTTP API 可用，返回 S3 URL

**Octo 客户端侧**
- [ ] DevTools Console 出现 `[mcp] connected`
- [ ] Console 出现 2 个工具名称：`analyze_interview`、`search_reports`
- [ ] InsightPage 上传文件后 URL 出现在 session context 中
- [ ] 发"观点解析"指令后，Console 出现 `analyze_interview` 调用
- [ ] 对话区出现 OutputCard（表格类型）

---

## 与 agent 配置的对应关系

`~/.config/octo/octo.config.json` 中 insight agent 的工具白名单：

```jsonc
"tools": {
  "analyze_interview": true,   // ← MCP 工具 §1
  "search_reports":    true    // ← MCP 工具 §2
  // upload_document 不在此处：上传由 InsightPage 直接 HTTP 调用
}
```

工具名称若与 MCP server 实际提供的不一致，需同步修改白名单和 `packages/agent/insight/agents/insight.md` frontmatter。
