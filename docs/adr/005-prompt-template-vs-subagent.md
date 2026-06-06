# ADR-005: InsightPage 的两层架构——提示词模板 + Subagent

## 状态
已采纳（2026-05-13）

## 背景

InsightPage 输入区有两个维度的用户选择：
1. **分析类型**：6 种提示词模板（dropdown 选择）
2. **文档数量**：用户可能一次上传 1 份或多份访谈文档

需要决定这两个维度各自的架构实现方式。

## 决策

**两层架构，两个维度独立处理：**

| 维度 | 实现方式 | 理由 |
|---|---|---|
| 分析类型选择 | **提示词模板**（prompt template） | 6 种类型共用相同工具集，只是分析角度不同，不需要独立 agent |
| 多文档并行执行 | **`analyze_interview` 批量 doc_urls**（首选）或 **`interview-worker` subagent**（fallback） | 服务端原生支持批量时一次调用即可；不支持时 subagent 提供客户端并行 |

## 提示词模板的理由

6 种分析类型不需要独立 agent：
- 所有类型都使用同一套 MCP 工具集
- LLM 角色相同（用研分析师）
- 分析类型差异完全可以通过 prompt 前缀传达给 LLM

提示词模板只在 `session.prompt()` 发送时拼入 prompt 前缀，改变 LLM 的任务描述，不改变 agent 身份。

完整的 6 种模板定义见：[docs/specs/ui/insight-analysis-mode.md §2](../specs/ui/insight-analysis-mode.md)

## 多文档处理

**首选**：`analyze_interview(doc_urls=[], ...)` 支持传入多个 URL，服务端并行处理。

**Fallback（`interview-worker` subagent）** 在以下场景启用：
- 服务端 `analyze_interview` 不支持批量
- 不同文档需要不同 `analysis_type`
- 批量规模超过单次限制

并行收益：3 份文档串行约 90s，subagent 并行约 30s。

> **现状（2026-05-29）**：`interview-worker` 这一 fallback **从未落地**——首选的批量 `doc_urls` 路线服务端已原生支持，无需客户端并行。其 `default-config.json` 占位条目（无对应 prompt 文件、octo_insight.md 也从不分派）已于 commit `7230324`（cherry-pick 自 `92df27c`，PR [#1](https://github.com/Kevin199802/octo-agent/pull/1)）移除。若日后服务端不支持批量需启用，须重建 config block + 新增 `packages/agent/interview-worker/agents/interview-worker.md`。

## 思维导图的处理

思维导图是 `analyze_interview` 的一个 `analysis_type` 值（`"mindmap"`），服务端复用现有思维导图接口，**直接返回 JSON**，客户端渲染 JSON（不需要 LLM 做格式转换）。

Phase 1 阶段（`mindmap` 类型尚未上线）：提示词前缀引导 LLM 读文件内容直接生成思维导图描述，作为临时方案。

## MCP 工具覆盖 6 种模板的映射

> 接口参数详见 [docs/specs/agents/mcp-contract.md](../specs/agents/mcp-contract.md)。

| 提示词模板 | MCP 工具 | analysis_type | 状态 |
|---|---|---|---|
| 观点解析 | `analyze_interview` | `key_findings` | Phase 1 |
| 按提纲聚类 | `analyze_interview` | `cluster_by_outline` | Phase 2 |
| AI用户画像 | `analyze_interview` | `generate_persona` | Phase 2 |
| 思维导图 | `analyze_interview` | `mindmap` | Phase 2 |
| 评估问题整理 | `analyze_interview` | `evaluation_summary` | Phase 2 |
| 用研知识问答 | `search_reports` | — | Phase 1 |

## 文件上传架构

文件上传**不经过 MCP**，由 InsightPage 直接调用 UXR HTTP 上传接口，决策见 [ADR-006](006-upload-architecture.md)。

## 后果

- MCP 工具 2 个（`analyze_interview` + `search_reports`），覆盖全部场景
- 扩展 MCP 时只需增加 `analysis_type` 枚举值，不需要注册新工具或新 agent
- 思维导图 Phase 2 由服务端返回 JSON，客户端直接渲染
- 多文档并行效率显著优于串行
