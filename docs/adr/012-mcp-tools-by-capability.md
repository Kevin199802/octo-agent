# ADR-012: MCP 工具按业务能力铺开（N tools），而非单 tool + enum 参数

## 状态

已采纳（2026-05-19）

## 背景

早期 [mcp-contract.md](../specs/agents/mcp-contract.md) 草案把所有访谈分析能力收成一个 `analyze_interview` 工具，通过 `analysis_type` 枚举（key_findings / cluster_by_outline / generate_persona / evaluation_summary / mindmap）切换具体行为。

UXR 服务团队最终落地时按业务能力拆开成多个独立工具，需要把这个设计选择固化为决策记录。

## 方案对比

### 方案 A：单 tool + enum 参数（早期草案）

```
analyze_interview(doc_urls, analysis_type: enum, context)
  ├─ analysis_type="key_findings"
  ├─ analysis_type="cluster_by_outline"
  ├─ analysis_type="generate_persona"
  └─ ...
```

优势：
- MCP 工具清单短，服务端实现简单（一个 dispatch handler）
- 协议层 schema 维护一份

劣势：
- LLM tool selection 依赖 description 内枚举差异，自由输入场景下容易选错
- 每个枚举值的语义独立（"提取观点" vs "生成思维导图"），塞进一个 description 不够聚焦
- 加专属参数（如 mindmap 深度、persona 角色数量）需要 union schema，演化困难
- 某个 type 实现异常会影响整个 tool 的可用性判断

### 方案 B：按业务能力铺开 N tools（已采纳）

```
run_usability_analysis(...)     ← 可用性测试分析
run_guide_analysis(...)         ← 大纲聚类
key_findings(...)               ← 自由解析（观点提取）
mindmap(...)                    ← 思维导图
search_reports(query)           ← RAG 检索
```

优势：
- **LLM tool selection 准确性更高**：每个 tool 的 description 聚焦单一业务，业界（Anthropic / OpenAI 官方 cookbook、AWS Textract、Stripe API）均推荐
- **不锁死产品方向**：未来若放开"自由输入触发分析"，N tools 是必须；当前 UI 模板驱动也能用
- **演化友好**：单个能力加专属参数 / 改返回结构不影响其他
- **错误隔离**：某个工具实现挂了不污染其他
- **服务端实现成本几乎不变**：N 个 `@mcp.tool()` 装饰器内部 dispatch 同一个核心 handler

劣势：
- 工具清单变长（5-10 个），但这本来就是 LLM tool 设计推荐形态

## 决策

采纳方案 B。最终落地的工具清单和详细契约以 [mcp-contract.md](../specs/agents/mcp-contract.md) 为**单一真相来源**，本 ADR 不复述具体 tool 名称、参数或返回格式。

### 与早期草案的范围变化

- 早期草案的 5 个 `analysis_type` 中，`generate_persona` 和 `evaluation_summary` 在本轮内网定稿中**未实现**，后续 UXR 团队按需补充
- 新增 `run_usability_analysis`（可用性测试分析），早期草案未覆盖
- 长任务管理（status / cancel）的具体形态另行决策，本 ADR 不展开

## 后果

- [mcp-contract.md](../specs/agents/mcp-contract.md) 工具部分按本 ADR 重写
- [packages/agent/insight/agents/insight.md](../../packages/agent/insight/agents/insight.md) frontmatter `tools` 白名单同步更新
- [docs/specs/ui/insight-analysis-mode.md](../specs/ui/insight-analysis-mode.md) 模板列表收缩到内网已实现的范围
- 其他文档（integration / intranet-handoff / learning / output-renderers）中涉及 MCP 工具名称的地方一律改为引用 mcp-contract.md，**不重复定义**，避免后续多处漂移
- 早期 ADR（005/006/007/009/010/011）中出现的 `analyze_interview` / `analysis_type` 字样保留为历史快照，不改
