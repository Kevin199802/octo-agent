# ADR-006: 文件上传走 InsightPage 直传，不经过 MCP

## 状态
已采纳（2026-05-14）

## 背景

InsightPage 需要将用户上传的访谈文件（docx、pdf、txt 等）传到 UXR 内网 OBS 存储，获取 S3 URL 后供 `analyze_interview` 使用。

需要决定上传这一步放在哪一层。

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
- 符合 UXR 团队现有上传接口形态（直接复用，无需改造）

## 决策

选择方案 B。

## 后果

- `upload_document` **不作为 MCP 工具**，insight agent 工具白名单不包含它
- 上传是通用服务，各 agent 页面均可复用，接口规格见 [docs/specs/infra/file-upload.md](../specs/infra/file-upload.md)
- InsightPage 需持有上传 API 地址（来自 `octo.config.json` 的 `uxr.upload_url` 字段）
- 调试阶段可 hardcoded S3 URL 跳过上传，直接验证 MCP 分析流程（见 file-upload.md §调试阶段）
