# Spec: 文件直传服务

> 通用能力，各 agent（insight、未来的 make 等）均可使用。  
> 决策背景见 [ADR-006](../../adr/006-upload-architecture.md)。

---

## 概述

文件上传**不经过 MCP**，由各 agent 页面直接调用 UXR HTTP 上传接口（multipart/form-data binary）。上传完成后，S3 URL 由页面注入 LLM 的 session context，LLM 拿到 URL 后调用 MCP 分析工具。

```
用户选文件 → 页面直接 POST /api/upload（binary）
  → 返回 S3 URL
  → 注入 session.prompt() context
  → LLM 调 analyze_interview(doc_urls=[...])
```

---

## API 合同

> ⚠️ 以下参数待 S3 上传工作完成后由 UXR 团队确认并更新。

**接口地址**：`POST <uxr.upload_url>`（来自 `octo.config.json` 的 `uxr.upload_url` 字段，待填写）

**请求格式**：`multipart/form-data`

| 字段 | 类型 | 说明 |
|---|---|---|
| `file` | binary | 文件内容 |
| `path` | string | OBS 存储路径，待确认格式 |
| `prefix_dir` | string | 目录前缀，待确认 |

**响应**：待确认（预期返回 S3 URL 字符串或 JSON 对象）

**支持格式**：txt、md、docx、xlsx、pdf（由 UXR 服务端解析，客户端直接上传原始文件）

---

## 客户端接入

### 配置

```jsonc
// ~/.config/octo/octo.config.json
{
  "uxr": {
    "upload_url": "https://uxr-service.intranet.com/api/upload"  // 待填写
  }
}
```

### 接入代码（InsightPage 示例）

```ts
async function uploadFiles(files: File[], uploadUrl: string): Promise<string[]> {
  const urls: string[] = []
  for (const file of files) {
    const form = new FormData()
    form.append("file", file)
    // path / prefix_dir 参数待 UXR 团队确认后补充
    const res = await fetch(uploadUrl, { method: "POST", body: form })
    const data = await res.json()
    urls.push(data.url)  // 字段名待确认
  }
  return urls
}
```

### 调试阶段（S3 上传未就绪时）

在 InsightPage 发送前，直接将 hardcoded S3 URL 注入 context，跳过上传步骤：

```ts
// 临时调试用，上传就绪后删除
const debugUrls = ["https://obs.example.com/asset/aiInterview/test.txt"]
injectUrlsToContext(debugUrls)
```

---

## 通用注入格式

各 agent 页面上传完成后，统一以以下格式注入 session context（保持一致，LLM prompt 可识别）：

```
[已上传文件]
- filename-1.docx: https://obs.example.com/.../filename-1.docx
- filename-2.txt:  https://obs.example.com/.../filename-2.txt
```

---

## 待补充

- [ ] 上传接口路径（`/api/upload` 待确认）
- [ ] 请求字段 `path`、`prefix_dir` 的实际值
- [ ] OBS 响应体结构（URL 字段名）
- [ ] 最大文件大小限制
- [ ] 并发上传策略（当前串行，是否需要并行）
