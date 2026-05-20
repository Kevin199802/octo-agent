# ADR-006: 文件上传走 InsightPage 直传，不经过 MCP

## 状态
已采纳（2026-05-14）

## 背景

InsightPage 需要将用户上传的访谈文件（docx、pdf、txt、xlsx、md 等）落到内网 S3，获取 URL 后供 MCP 工具 `analyze_interview` 使用。

需要决定上传这一步放在哪一层。

## 职责边界

上传场景在 octo-agent 项目内有两类，本 ADR 只覆盖第一类：

| 场景 | 触发方 | 实现方 | 是否走 MCP |
|---|---|---|---|
| **agent 侧文件上传** | 用户在 InsightPage 选文件 | agent 项目（客户端） + 内网开发团队（服务端） | 不走 |
| **MCP 工具产物上传** | UXR 服务端生成分析结果时落盘 | UXR 团队（内部） | 不涉及客户端，UXR 自治 |

两条链路在物理 S3 上可能落在不同 bucket / 不同 prefix，互不感知。

## 方案对比

### 方案 A：MCP 工具 `upload_document`（已排除）

```
InsightPage → base64 编码文件 → POST /mcp
  → MCP server decode → POST OBS
  → 返回 doc_id / S3 URL
```

问题：
- MCP 协议基于 JSON-RPC，文件必须 base64，10MB 文件 = 13MB JSON 参数
- JSON body 在内存里以字符串持有，大文件压力大
- 服务端需显式放大 body size limit（nginx 默认 1MB）
- 业界标准云服务（AWS S3、阿里云 OSS）均不通过 RPC 上传——都是直接 HTTP 上传
- 上传进度无法在 UI 中实时显示

### 方案 B：InsightPage 直传（已采纳）

```
用户选文件
→ InsightPage POST /upload（multipart/form-data, binary）
→ UXR HTTP 上传接口 → OBS
→ 返回 S3 URL 列表
→ InsightPage 将 URL 注入 session.prompt() context
→ LLM 调 analyze_interview(doc_urls=[...])
```

优势：
- 文件走 binary，无 base64，无 body 限制
- 上传进度可以在 UI 实时展示
- LLM 只接触 URL，不参与文件传输
- 与 Anthropic Files API / OpenAI Files API 等业界 agent 平台的上传形态一致（multipart POST，服务端代理落盘，返回 URL/ID）

## 决策

选择方案 B。

## 后果

- `upload_document` **不作为 MCP 工具**，insight agent 工具白名单不包含它
- 上传是 agent 项目的通用服务，各 agent 页面均可复用，接口规格见 [docs/specs/infra/file-upload.md](../specs/infra/file-upload.md)
- 服务端由 agent 项目 + 内网开发团队协作落地（不走 UXR）
- 客户端上传端点是部署期常量（写在源码里），不进 `octo.json` 用户配置
- 调试阶段可 hardcoded URL 跳过上传，直接验证 MCP 分析流程（见 file-upload.md §调试阶段）
