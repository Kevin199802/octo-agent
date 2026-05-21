# Spec: 文件上传服务

> agent 项目自有的上传能力，各 agent 页面（insight、未来的 make 等）均可使用。  
> 决策背景见 [ADR-006](../../adr/006-upload-architecture.md)。

---

## 概述

文件上传**不经过 MCP**，由各 agent 页面直接调用 agent 项目自有的上传服务（multipart/form-data binary，服务端代理 → 内网 S3）。上传完成后，URL 由页面注入 LLM 的 session context，LLM 拿到 URL 后调用 MCP 分析工具。

```
用户选文件 → 页面 POST /api/files (multipart, binary)
  → 上传服务接收 → 校验 → 服务端组路径 → PUT S3
  → 返回 { url, file_id, ... }
  → 注入 session.prompt() 文本
  → LLM 调 analyze_interview(doc_urls=[...])
```

**与 UXR 的关系**：UXR 团队仅负责 MCP 分析工具（[mcp-contract.md](../agents/mcp-contract.md)），与本上传服务**互不相关**。UXR 内部也有自己的 S3 上传（用于分析结果落盘），那是 UXR 自治范围，不在本 spec 覆盖范围内。详见 [ADR-006 §职责边界](../../adr/006-upload-architecture.md#职责边界)。

---

## 客户端接入（agent 侧极简）

### 端点

上传端点写在源码里：[`packages/app/src/pages/insight/lib/upload.ts`](../../../packages/app/src/pages/insight/lib/upload.ts) 顶部的 `UPLOAD_ENDPOINT` 常量。

- **不进 `octo.json`**：是部署细节，不是用户偏好
- **不引 `.env`**：项目暂无 .env 配置约定，沿用上游 `VITE_OPENCODE_SERVER_HOST` 等"硬编码 + 待覆盖" 的风格
- **要换地址**直接改这个常量；待内网开发对接后由打包版本注入实际值

### 调用代码

```ts
// packages/app/src/pages/insight/lib/upload.ts
const UPLOAD_ENDPOINT = "..." // TODO 内网开发给定后填入
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024  // Insight: 100MB
const ALLOWED_EXT = ["txt", "md", "docx", "xlsx", "pdf"]

export type UploadResult = {
  url: string
  file_id: string
  filename: string
  size: number
  mime: string
}

export async function uploadFile(file: File): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_SIZE) throw new UploadError("FILE_TOO_LARGE")
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (!ALLOWED_EXT.includes(ext)) throw new UploadError("EXT_NOT_ALLOWED")

  const form = new FormData()
  form.append("file", file)
  const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: form })
  if (!res.ok) throw await mapHttpError(res)
  return res.json()
}
```

客户端只发 `file` 一个字段，**不组 S3 路径**——路径策略是服务端职责。

### 错误处理

| HTTP 状态码 | 客户端语义 | UI 行为 |
|---|---|---|
| 200 | 成功 | 用响应 url 注入 prompt |
| 400 | 字段错 / 文件无效 | 显示"文件无效"，不重试 |
| 413 | 服务端 size 上限 | 显示"超出大小上限"，不重试 |
| 415 | 扩展名不支持 | 显示"格式不支持" |
| 429 | 限流 | 显示"上传繁忙"，提供重传按钮 |
| 5xx / 网络异常 | 服务端 / 网络问题 | 显示"上传失败"，提供重传按钮 |

### 注入格式

各 agent 页面上传完成后，统一以以下格式注入到 prompt 文本末尾（保持一致，LLM 可识别）：

```
[已上传文件]
- filename-1.docx: https://obs.example.com/.../filename-1.docx
- filename-2.txt:  https://obs.example.com/.../filename-2.txt
```

不再走 `FilePartInput.url`——避免 opencode SDK 误将 URL 当本地文件 fetch。

### 大小 / 扩展名常量

| 常量 | 默认值 | 说明 |
|---|---|---|
| `MAX_UPLOAD_SIZE` | 100MB | Insight 当前场景。其他 agent 接入时可在各自 lib 内调整 |
| `ALLOWED_EXT` | txt/md/docx/xlsx/pdf | 由 MCP 工具 `analyze_interview` 决定可处理格式 |

---

## 服务端实现（给内网开发团队）

> 内网 S3 SDK / API 内外网不一致，本节只约束**对外接口形态、路径策略和行为约定**，不约束服务端用什么语言或 S3 SDK 实现。

### 形态：服务端代理 multipart

```
客户端 POST multipart
  → 服务端接收 file stream
  → 服务端校验（size / mime / 扩展名）
  → 服务端组装 S3 key
  → 服务端 PUT 到 S3
  → 返回 JSON
```

**为什么选这个形态**：
- Anthropic Files API（单文件 500MB）、OpenAI Files API（单文件 512MB）等业界 agent 平台都是这种形态
- 客户端逻辑极简（form 里只有 file，一次 POST 拿结果）
- 服务端可统一做校验、扫描、转码
- 单进程 stream 在 100~500MB 文件下完全顶得住

**不选预签名 URL 直传 S3 的理由**：客户端要走两步（拿 token → PUT → 通知服务端），CORS 配置 + 过期管理复杂；agent 场景文件 < 50MB 居多，单进程代理更划算。

### S3 路径策略

```
<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>_<sanitized_filename>
```

具体示例：

```
<bucket>/files/insight/2026-05-20/a1b2c3d4e5f6_interview-zhang.docx
<bucket>/files/insight/2026-05-20/f7g8h9i0j1k2_outline.pdf
<bucket>/files/make/2026-06-01/m3n4o5p6q7r8_brief.docx
```

各层职责：

| 层级 | 作用 | 为什么不省略 |
|---|---|---|
| `files/` | agent 项目文件命名空间 | 与同 bucket 下其他用途（如 UXR 分析产物）prefix 隔离 |
| `<agent>/` | 按 agent 隔离 | 未来 make 加入直接挂；按 agent 配 IAM/lifecycle 方便 |
| `<yyyy-mm-dd>/` | 日期分区 | lifecycle rule 按 prefix 配 TTL 最简单；调试按时间窗口查 |
| `<uuid>_<filename>` | 防冲突 + 可读 | UUID 防覆盖 + 防猜测；保留 filename 便于控制台肉眼调试与浏览器下载 |

**不引入的维度**（避免空架子）：

- 不引入 `session_id`——session 是客户端概念，服务端无感；文件"一次性引用"为主，按日期清理够用
- 不引入 `user_id`/工号——MVP 不需要。如未来 S3 要求按工号 ACL，在最前面加一层 `<user_id>/files/<agent>/...`，不破坏既有 prefix
- 不引入 tenant——内网单租户，加了是空架子

### filename sanitize

服务端对原 filename 做清洗后再写入路径：

- 保留：字母、数字、`-`、`_`、`.`、中文
- 替换：空格 → `_`；其他特殊字符（含 `/`、`\`、空控制符、emoji 等）→ `_`
- 主名长度截断：保留扩展名，主名截到 100 字符
- 空文件名兜底：用 `unnamed` 代替

### 生命周期

| 项 | 值 |
|---|---|
| TTL | 1 年 |
| 实现方式 | S3 lifecycle rule，匹配 prefix `files/`，创建后 365 天 expire |
| 显式删除接口 | MVP 不提供 |

agent 项目层不需要"清理某个 session 的文件"这种业务接口，靠 lifecycle rule 自动过期。

### 大小上限

| 角色 | 上限 | 说明 |
|---|---|---|
| Insight 客户端 | 100MB | 实际访谈文档场景足够 |
| 服务端硬上限 | **500MB**（建议） | 对齐 Anthropic / OpenAI Files API；防客户端绕过 + 给未来其他 agent 余地 |

超限返回 413 + 错误体。

### 扩展名 / MIME 白名单

服务端校验，与客户端 `ALLOWED_EXT` 保持一致：`txt, md, docx, xlsx, pdf`。

不在白名单返回 415。MIME 头与扩展名不一致时以扩展名为准（防止伪造 MIME）。

### 接口合同

**请求：**

```
POST /api/files
Content-Type: multipart/form-data

Body:
  file: binary  (唯一字段)
```

响应统一封装（内网约定）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | object \| null | 业务数据；失败时为 null |
| `success` | bool | 业务是否成功 |
| `errorCode` | int | 业务错误码；成功为 200 |
| `errorMessage` | string \| null | 错误信息；成功为 null |

**成功响应：**

```json
{
  "content": {
    "url": "https://<obs-host>/files/insight/2026-05-20/a1b2c3_interview.docx",
    "file_id": "file_a1b2c3d4e5f6",
    "filename": "interview-zhang.docx",
    "size": 1234567,
    "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  "success": true,
  "errorCode": 200,
  "errorMessage": null
}
```

`content` 内字段说明：

| 字段 | 说明 |
|---|---|
| `url` | 完整 URL，客户端直接注入 LLM context |
| `file_id` | 稳定标识（对应 DB 里 `file_key`，见下方 §数据持久层）；当前客户端只消费 `url`，预留给未来 MCP 合同切到 `file_id` 引用 |
| `filename` / `size` / `mime` | 文件元信息回显 |

**错误响应：**

```json
{
  "content": null,
  "success": false,
  "errorCode": 413,
  "errorMessage": "文件超过 500MB 上限"
}
```

**业务错误码（`errorCode` 整数）：**

客户端**优先以 `success` / `errorCode` 判断**，HTTP 状态码作兜底（HTTP 层被代理直接拒时才看 HTTP 状态码）。

| errorCode | 客户端语义 | 含义 |
|---|---|---|
| `200` | 成功 | 业务成功 |
| `305` | FILE_INVALID | 文件无效（form 缺 file / 读取失败 / 0 字节） |
| `413` | FILE_TOO_LARGE | 超过服务端硬上限 |
| `415` | EXT_NOT_ALLOWED | 扩展名不在白名单 |
| `429` | RATE_LIMITED | 限流 |
| `>= 500` | INTERNAL | 服务端 / S3 异常 |

### 数据持久层（DB 表设计）

上传操作配套的 DB 表，给内网开发参考（字段类型为建议，最终以内网 DBA 规范为准）：

| 字段 | 类型建议 | 说明 |
|---|---|---|
| `id` | bigint PK auto | 主键（下标） |
| `filename` | varchar(255) | 原始文件名 |
| `size` | bigint | 字节数 |
| `agent` | varchar(32) | agent 名称（如 `insight` / `make`）。路径策略里已分层，DB 冗余一份方便按 agent 检索/审计；服务端根据上传端点路径或 referrer 推断填入 |
| `bucket` | varchar(64) | S3 桶名称 |
| `file_key` | varchar(512) | S3 object key（API 响应里以 `file_id` 字段对外） |
| `deleted` | tinyint | 逻辑删除符（0=正常 1=已删除） |
| `created_at` | timestamp | 上传时间 |
| `user_key` | varchar(64) | 上传人工号；MVP 客户端不传，先冗余空字段，后续接入工号体系再回填 |
| `upload_status` | varchar(16) | 上传状态（如 `success` / `failed`） |

注：

- `file_key` 与 API 字段 `file_id` 物理上同源；DB 用 `file_key` 强调"S3 object key"含义，API 用 `file_id` 对齐业界 Files API 习惯
- `agent` 字段标记为"看是否需要"——本 spec 建议保留（路径已分层，未来按 agent 审计/计费便利）；如内网开发评估冗余可去掉

### 未来扩展（不在 MVP 实现）

| 场景 | 触发条件 | 实现 |
|---|---|---|
| 大文件分片 | 单文件 > 100MB | 服务端内部转用 S3 multipart upload。**客户端始终是同一份 multipart POST**，无需切片代码 |
| 客户端切片上传 | 单文件 > 2GB | 参考 OpenAI Uploads API 形态另起接口。Insight 不涉及，agent 项目其他业务真有此需求再做 |
| 显式 TTL 字段 | 部分场景需要更短保留期 | 上传时 form 多传 `expires_after` 秒数，对标 OpenAI |

---

## 联调与验证

### 服务端未就绪时（临时调试）

两种入口：

1. **改 `UPLOAD_ENDPOINT` 常量**指向 mock 服务（如 https://httpbin.org/post 这类响应 JSON 的端点），走真实上传链路
2. **完全跳过上传**：InsightPage 发送前 hardcoded URL 直接拼到 prompt 文本，绕过上传验证 MCP 主流程

```ts
// 临时调试，服务端就绪后删除
const debugUrls = ["https://obs.example.com/asset/aiInterview/test.txt"]
```

### 服务端就绪后（联调步骤）

#### 1. 客户端对接

只有一步：改 [`packages/app/src/pages/insight/lib/upload.ts`](../../../packages/app/src/pages/insight/lib/upload.ts) 顶部的 `UPLOAD_ENDPOINT` 常量为内网实际地址，重启 dev 即可。

```ts
const UPLOAD_ENDPOINT = "https://<内网开发给定的实际地址>"
```

不需要改其他文件——响应封装解析、errorCode 映射、UI 状态切换都已就绪。

#### 2. 正常链路验证

| # | 操作 | 期望结果 |
|---|---|---|
| 1 | Insight 页选一个 .docx / .pdf 文件（< 100MB） | chip 立即出现 ⏳ uploading 状态 |
| 2 | 等待请求完成 | chip 变蓝色 done 状态 |
| 3 | DevTools Network 看 POST 请求 | URL = `UPLOAD_ENDPOINT`；Content-Type 为 multipart/form-data；body 里**只有 file 一个字段** |
| 4 | 响应体形态 | `{ content: { url, file_id, filename, size, mime }, success: true, errorCode: 200, errorMessage: null }` |
| 5 | 输入文字 → 点发送 | DevTools Console 出 `[octo:prompt] send`，含 `uploads: [{ name, url }]` |
| 6 | session 内 prompt 文本末尾 | 含 `[已上传文件]\n- <filename>: <url>` 段 |
| 7 | LLM 调 `analyze_interview` 时 | `doc_urls` 参数能填入步骤 4 里的 `content.url` |

#### 3. 边界 / 错误链路验证

| 场景 | 操作 | 期望 chip 表现 |
|---|---|---|
| 客户端 size 拒绝 | 选 > 100MB 文件 | 直接 ⚠️ "超过 100MB 上限"，**不发请求**（Network 应无该 POST） |
| 客户端扩展名拒绝 | 选 `.exe` 文件 | 直接 ⚠️ "不支持的格式 .exe" |
| 网络异常 | 选文件时停掉服务端 | ⚠️ "网络异常"，可点 ↻ 重传 |
| 服务端业务错（413） | 选 200MB 文件 触发服务端 size 兜底 | ⚠️ 显示 `errorMessage` 文本，可重传 |
| 服务端业务错（415） | 客户端绕过校验上传 .xyz | ⚠️ 显示服务端 errorMessage |
| 服务端业务错（305） | 上传空文件 | ⚠️ "文件无效" |
| 服务端 5xx | 服务端进程崩溃 / S3 失败 | ⚠️ "服务端错误 (errorCode=500)" |
| 重传 | 任一 error chip 点 ↻ | chip 重新进入 ⏳ uploading 状态 |
| 等待中禁发 | uploading 状态时点发送按钮 | 按钮 disabled，hover 提示"等待附件上传完成" |

#### 4. 服务端协议合规校验

由内网开发同学自查（spec 已固化的约定）：

- [ ] 响应体所有出口都符合 `{ content, success, errorCode, errorMessage }` 4 字段封装（成功/失败均如此）
- [ ] `errorCode` 是**整数**不是字符串
- [ ] 成功时 `content.url` 是**可直接访问的完整 URL**（注入 LLM 后能被 MCP 工具拿来发请求）
- [ ] S3 路径符合 `<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>_<filename>` 形态
- [ ] DB 表写入：每次成功上传应在表里出现一行新记录（`upload_status=success`）
- [ ] 大文件（接近 500MB）能成功上传且 stream 不爆服务端内存
- [ ] lifecycle rule 已配置（`files/` prefix，365 天 expire）

#### 5. CORS / 部署注意

如果服务端与客户端同源（内网相同 host），跳过 CORS 检查；如不同源，服务端需返回：

```
Access-Control-Allow-Origin: <octo desktop host>
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: Content-Type
```

否则 fetch 会被浏览器拦截，客户端会落到 `NETWORK` 错误。

---

## 待补充

- [ ] `UPLOAD_ENDPOINT` 实际地址（待内网开发给定）
- [ ] 内网 S3 是否要求工号字段（access control 粒度）—— 若必填则在 form 里加 `user` 字段
- [ ] 服务端响应体字段名最终确认（`url` / `file_id` 这两个名字是否内网 S3 通用命名习惯）
