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
| `run_usability_analysis` | 可用性测试分析 | 上传的访谈 / 测试材料 | 长任务，异步返回 task_id |
| `run_guide_analysis` | 大纲聚类分析（按提纲整理） | 上传的访谈材料 + 提纲 | 长任务，异步返回 task_id |
| `key_findings` | 自由解析 — 提取用户观点、场景主体、痛点需求等 | 上传的访谈材料 | 长任务，异步返回 task_id |
| `mindmap` | 思维导图生成 | 上传的访谈材料 | 长任务，异步返回 task_id；返回结构化 JSON |
| `search_reports` | 基于内网用研知识库的 RAG 检索 | 自然语言 query | 同步返回 |

### 任务管理（长任务通用）

- 任务状态查询和取消由统一的任务管理工具承担，具体工具名和形态待定，**本文档此处占位**，定稿后补回。

---

## 入参 / 出参契约

> 入参 / 出参的具体字段格式由 UXR 团队最终给到，并在另一轮对话中已对齐为通用形态（与具体工具名解耦）。本文档此处只描述**通用骨架**，详细字段以联调时 `GET /mcp` 返回的 schema 为准。

### 通用入参骨架

- **业务工具**（除 search_reports）：接受**已上传的文件 URL 列表** + 业务上下文字符串
  - 文件 URL 来源：[file-upload.md](../infra/file-upload.md)，由 InsightPage 上传后注入 session context
- **search_reports**：自然语言 query 字符串

### 通用出参骨架

- **长任务工具**：异步返回 task_id + 预估完成时间
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
- **返回格式特点**（Markdown 表格 vs JSON vs 检索结果列表）

具体每个 tool 的 description 文案由 UXR 团队按上述原则撰写，本文档不约束。

---

## 验证检查清单

联调完成后双方确认：

**UXR 服务侧**
- [ ] `GET /mcp` 返回工具清单，至少包含上文列出的业务工具 + `search_reports`
- [ ] `POST /mcp` 处理 `key_findings`、`run_guide_analysis`、`mindmap`、`run_usability_analysis`，长任务返回 task_id
- [ ] `POST /mcp` 处理 `search_reports`，同步返回检索结果
- [ ] 文件上传 HTTP API 可用，返回可用于 MCP 入参的 URL

**Octo 客户端侧**
- [ ] DevTools Console 出现 `[mcp] connected`
- [ ] Console 出现工具清单
- [ ] InsightPage 上传文件后 URL 出现在 session context 中
- [ ] 发"观点解析"指令后，Console 出现对应 tool 调用
- [ ] 对话区出现 OutputCard（表格 / JSON / 文本）

---

## 与 agent 配置的对应关系

`packages/agent/insight/agents/insight.md` frontmatter 的工具白名单需覆盖本文档列出的所有业务工具 + `search_reports`，详见该文件。

工具名称如与 MCP server 实际提供的不一致，需**同时**修改：

- 本文档工具清单
- `packages/agent/insight/agents/insight.md` frontmatter
- 涉及对外契约的文档（[intranet-handoff.md](../../intranet-handoff.md)）

其他文档（integration / learning / output-renderers / insight-analysis-mode 等）应通过引用本文档获取最新名称，不复述具体 tool 名。
