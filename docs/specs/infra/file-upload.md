# Spec: 文件上传服务

> agent 项目自有的上传能力，各 agent 页面（insight、未来的 make 等）均可使用。  
> 决策背景见 [ADR-006](../../adr/006-upload-architecture.md)。
>
> **本 spec 只定义上传服务本身**（endpoint / multipart / 响应封装 / 校验 / 文件名清洗）。**insight 何时上传、注入什么、模型怎么引用**已改为按 [SPEC-INS-015 文件传参机制](insight-file-passing.md) 分流（`[附件]` 清单 + 按需上传，不再是 `[已上传文件]` handle 块）——下方「概述」链路图为 ADR-014 时期的旧流程，**以 SPEC-INS-015 为准**。

---

## ⚠️ 2026-07-03 合同修订提案 v2：文件名退出下载 URL（待与后台对齐，对齐后本节转正并改写下方相关章节）

### 动机

2026-07-03 测试暴露一类线上故障的**公共根因：原始文件名被拼进下载 URL**。内网上传服务把文件名（未编码）拼进返回 URL，MCP 端按 URL 取文件——文件名里的空格 / 括号 / 全角标点等任何白名单外字符都会让下载失败。客户端为此做过两代清洗（前端 `sanitizeFileName` 删除式清洗 → 插件 `sanitizeS3Name` 替换式清洗），全部是防御性补丁：只要文件名还在 URL 里，字符集问题就治不完（撞名后缀、历史脏文件名、清洗规则漂移都会复发）。

**为什么不选"percent-encoding 文件名进 URL"**：`%` 本身就可能在内网 S3 的禁字符集里；编码要求上传服务、S3、MCP 下载端三方对编解码行为完全一致，而已观测到 MCP 端解码不一致的故障。前端发送前编码更是错层——multipart filename 会被服务端当字面量存储，产生二次编码。编码是补丁不是修复。

### 合同变更点（服务端）

业界对标：Discord / GitHub / Notion 附件 URL 均为 **id 主导**；S3 官方最佳实践即「key 用受控字符集、原名存元数据」。

1. **S3 key 末段改为 `<uuid>.<ext>`**：`files/<agent>/<yyyy-mm-dd>/<uuid>.<ext>`（原始文件名**不再进 key**）。`<ext>` 来自扩展名白名单校验，天然 ASCII 安全 → 服务端 filename sanitize 职责整个取消。
   > 前三层（`files/<agent>/<yyyy-mm-dd>/`）**不变**。变的只有末两层：原 `<uuid>/<sanitized_filename>` 里 uuid 独立成层的唯一理由是「让 URL 末段是干净的原文件名」（见 §S3 路径策略层级表）——文件名退出 key 后该理由消失，留着就是每目录一个文件的空层，故与文件名层合一为 `<uuid>.<ext>`。后台若嫌改动大想保留四层结构（`<uuid>/<uuid>.<ext>`）也可，功能等价，沟通时定。
   >
   > **`<ext>` 不可省略**（2026-07-06 后台曾提议省略后缀名，评估后否决）：(a) 省略后缀名不省流量、不省安全性——白名单已经卡死扩展名集合，`.ext` 只是把校验通过的结果如实写进 key，没有额外信息泄露；(b) URL 路径末段的 `.ext` 是**不依赖任何响应头就能拿到的类型信号**，MCP 下载器 / 内网代理 / 用户直接把 URL 粘进浏览器地址栏等场景都可能只看 URL 不看头，去掉后这些路径全部退化为"纯靠 `Content-Type` 头"，头一旦被中间层（代理、CDN、老旧网关）吞掉或改写就彻底没法判断类型；(c) `Content-Type` 现在的来源是**内网 S3 服务在 `PUT` 时按 key 的扩展名自动推导**（见下方 [§MIME / Content-Type 策略](#mime--content-type-策略)）——key 里没有 `<ext>`，S3 服务连推导依据都没有，`Content-Type` 反而会退化错，这不是"省了一步"，是直接破坏了现在这条更简单的 MIME 方案；唯一的"收益"是让 URL 变丑且更脆——没有对应的成本收益，故保留 `<ext>`。
2. **原始文件名只进 DB**：§数据持久层的表已有 `filename` 字段，**零新增**——这张表就是「key ↔ 原名」映射。
3. **新增下载接口** `GET /octoAiServer/files/<uuid>.<ext>`（走上传服务自有域名，不再暴露 S3 host；`/octoAiServer` 是内网实际路由前缀）：查表 → 流式转发 S3 对象（QPS/体量小，代理即可；未来可换 302 预签名 URL 卸载数据面，视 IT 桶服务是否支持预签名）→ 响应头：
   - `Content-Type`：**PUT 时由内网 S3 服务自带的方法按扩展名推导并写入对象元数据，下载接口读取该值透传**（后台 2026-07-06 确认的实现方式，细节与验证要求见下方 [§MIME / Content-Type 策略](#mime--content-type-策略)）
   - `Content-Disposition`：**统一 `inline`**（含 `filename*=UTF-8''<percent-encoded 原始文件名>`，RFC 6266，保留"另存为"时的原始文件名提示）——理由见下方 [§MIME / Content-Type 策略](#mime--content-type-策略)
4. **上传响应 `content.url` 改为上述下载地址**；`fileId` / `fileName` 字段语义不变。**客户端合同零改动**（客户端只消费 `url`）。
5. **MCP 工具侧零改动**（仍是「拿 url 发 GET」）。需与 UXR 确认两点：(a) MCP 分析服务到上传服务域名**网络可达**（现在可达的是 S3 host）；(b) 文件类型识别依据——URL 路径末段保留 `.ext` 后缀，若其还依赖文件名，`Content-Disposition` 里有原名。

### MIME / Content-Type 策略

> **本服务不是 MCP 专用通道**：§概述已写明「agent 项目自有的上传能力，各 agent 页面均可使用」。实际消费方按文件类型分叉——图片：① 发出后消息卡片**改用 S3 url 渲染**（[insight-file-passing.md §1③](insight-file-passing.md)：「发出的消息卡片改用 S3 url 渲染」，`<img src>` 直连本服务，浏览器直接渲染；② 多模态模型 provider 拿 URL 做 vision GET（服务端到服务端）。非图片文档（txt/md/docx/xlsx/pdf）：MCP 分析服务按需 GET（服务端到服务端，[SPEC-INS-015](insight-file-passing.md)），当前无浏览器内联预览 UI。

**Content-Type：可以直接复用内网 S3 服务的设置**（2026-07-06 与后台核实，结论更正）。此前担心"PUT 时如果没显式传 `Content-Type`，对象会落 `application/octet-stream`"——现已确认后台走的是**内网 S3 服务自带的方法**在 `PUT` 时按扩展名推导并显式写入，不是裸传不设 header，所以下载接口直接读/透传该值是安全的，**不需要**我们自己维护一张扩展名→MIME 映射表、也不需要在 DB 里双写一份 mime 做兜底源。这比先前"应用层显式算 + DB 存一份"的方案更简单，本质是把 MIME 推导这件事交给一个更通用、经过验证的组件（内网 S3 服务自身），而不是我们另起一份大概率覆盖面更窄的自定义表。

> **仍需联调核实一项**：部分老旧 mime 库对较新的 OOXML 类型（`docx`/`xlsx`）识别不准，可能落回 `application/octet-stream` 或通用 `application/zip`（docx/xlsx 本质是 zip 容器）。请在联调时**实际下载一次 docx / xlsx 样例文件，检查响应头**，确认拿到的是标准 OOXML mime（`application/vnd.openxmlformats-officedocument.wordprocessingml.document` / `...spreadsheetml.sheet`）而非上述兜底值——如果对不上，MCP/浏览器不受影响（都靠扩展名判断），但后续如果有环节按 `Content-Type` 做校验会踩坑，提前发现成本最低。

**Content-Disposition：统一 `inline`（后台方案，采纳）**。原因站得住：浏览器对能原生渲染的类型（图片、`text/*`、`application/pdf`）才会真正 inline 展示；对渲染不了的类型（`docx`/`xlsx` 这类 OOXML 二进制），**无论 `Content-Disposition` 是 `inline` 还是 `attachment`，浏览器都会走"另存为"弹窗**——这是浏览器自身对不认识的二进制类型的兜底行为，不是由 `Content-Disposition` 决定的（`attachment` 才是"强制下载，即使类型本身可渲染"的唯一独占语义，例如图片配 `attachment` 会打断 `<img>` 渲染；`inline` 配不可渲染类型只是"退回默认行为"，不会有反效果）。所以对当前 10 个扩展名，统一 `inline` 和"图片 inline、文档 attachment"分流两种方案**观察结果一致**，前者更简单、和 AWS S3 静态站点默认行为（不强制 `Content-Disposition`，交给浏览器判断）路数一致，没有理由为了同样的效果多维护一条分支规则。

> **唯一实际差异点：PDF**。浏览器普遍内置 PDF 阅读器，`inline` 会让用户点开链接时在标签页里直接看 PDF，`attachment` 则强制下载。当前产品没有暴露"直接打开源文件 URL"的入口，这条差异现在不可观察；即便未来加了这类入口，inline 直接预览通常也是更好的体验（能不能看比强制下载更符合直觉），不算风险点。
>
> **别漏的一环——`filename*` 参数**：`Content-Disposition: attachment` 一开始是这份提案里唯一携带"原始文件名"的地方（v2 后 URL 本身不再含文件名）。改 `inline` 不等于放弃这个能力——`inline` 同样可以带 `filename*=UTF-8''<percent-encoded 原始文件名>`（RFC 6266），浏览器在用户主动"另存为"时会用它做默认文件名。**需要跟后台确认这个参数保留了**，否则用户点"保存"时默认文件名会退化成 URL 末段的 `<uuid>.<ext>`，丢失可读性——这个丢的不是功能，是纯 UX 体验，但修复成本几乎为零（响应头多带一个参数），值得现在就定下来。

**护栏（写给未来扩容用，当前不生效）**：`inline` 对纯数据格式（图片/文本/Office 二进制/PDF）是安全的——这些格式不会在浏览器里执行代码。**如果未来往 `ALLOWED_EXT` 白名单加入 `html` / `svg` / `xml` / `mhtml` 这类浏览器会解析并可能执行脚本的格式**，`inline` 就不能再统一沿用了：同源 `inline` 展示用户可控内容属于经典的存储型 XSS 入口（文件上传服务允许把上传的 HTML/SVG 当同源页面直接渲染，攻击者上传后诱导受害者打开链接即可执行任意脚本）。真到那一步，这几个格式必须强制 `attachment`（或换成不带 cookie 的独立下载域名隔离），不能和其余格式一起套统一规则。当前白名单的 10 个扩展名都是静态数据格式，不触发这条护栏，仅作为后续加类型时的检查项留档。

### 落地后客户端可回退项（杜绝后患清单）

| 改动 | 处置 |
|---|---|
| 插件 `sanitizeS3Name`（multipart 文件名清洗，2026-07-03 fix） | ✅ **已清除**（2026-07-03，决定不等 v2 落地）——v2 上线前，含白名单外字符的文件名在 MCP 下载链路仍会失败（已知窗口，服务端改造收口） |
| 前端 `sanitizeFileName`（删除式清洗，曾服务全部上传、后只剩图片） | ✅ **已清除**（同上） |
| sources 撞名后缀 `_n`（2026-07-03 fix，INS-014 §3.3） | ✅ **已回退**为 ` (n)`（2026-07-03 同日，与 OS 习惯一致）——v2 后文件名不进 URL，特殊后缀无存在理由；v2 前撞名文件走 MCP 失败属已知窗口 |
| 附件展示名/清单名对齐磁盘落地名（三名合一） | **保留**——修的是「模型引用与插件键表不匹配」，与 URL 无关 |
| 插件三键**精确**匹配 | **保留**——同上；未替换的裸文件名无论 URL 方案如何都必失败。（曾附加去空白归一化兜底，2026-07-03 当日复审回退：启发式修补有静默误配风险，确定性方案见 SPEC-INS-017 §2.1） |
| desktop `sanitizeWorktreeName`（落盘名清洗） | **保留**——本地文件系统安全 + `[附件]` 清单行格式安全（文件名含 `: ` 会破坏 parse），与 S3 无关 |

---

## 概述

文件上传**不经过 MCP**，由 agent 项目自有的上传服务承接（multipart/form-data binary，服务端代理 → 内网 S3）。

**现行链路（SPEC-INS-015 起）**——上传调用方分两处：

```
图片(前端 eager):选图即页面 POST 上传 → 拿 url → vision FilePart{url} 随消息发给多模态模型

非图片(server 端按需):选文件只拷本地 sources/ → 发送时注入 [附件] 清单(文件名+本地路径)
  → 模型调 MCP 工具、文件参数填文件名
  → octo-upload-inject 插件在工具执行前才 POST 上传 → 把文件名换成返回的精确 URL
```

<details>
<summary>⚠️ 已废弃的旧链路（ADR-014 时期，handle 机制，留档备查）</summary>

```
用户选文件 → 页面 POST /api/files (multipart, binary)
  → 上传服务接收 → 校验 → 服务端组路径 → PUT S3
  → 返回 { url, fileId, ... }
  → 注入 session 文本（[已上传文件] 区块，每文件带全局唯一 handle upload_<hex>）
  → LLM 调业务工具，文件参数填 handle（download_links / outline_file_path）
  → octo-upload-inject 插件在工具执行前把 handle 换成精确 URL（见 ADR-014）
```

</details>

**与 UXR 的关系**：UXR 团队仅负责 MCP 分析工具（[mcp-contract.md](../agents/mcp-contract.md)），与本上传服务**互不相关**。UXR 内部也有自己的 S3 上传（用于分析结果落盘），那是 UXR 自治范围，不在本 spec 覆盖范围内。详见 [ADR-006 §职责边界](../../adr/006-upload-architecture.md#职责边界)。

---

## 客户端接入（agent 侧极简）

### 端点

上传端点由**环境变量 `VITE_OCTO_UPLOAD_ENDPOINT`** 注入，源码不持有地址。

**配置方式**：

```bash
cd packages/app
cp .env.example .env.local
# 编辑 .env.local，把 VITE_OCTO_UPLOAD_ENDPOINT 改成实际地址
```

[`packages/app/.env.example`](../../../packages/app/.env.example) 是 commit 进 repo 的模板（含字段注释）。`.env.local` 被 vite/git 默认忽略，不会进 commit。重启 dev 生效。

**生产构建**：CI / 打包脚本通过环境变量注入相同 key 即可（无需 .env.local 文件）。

**类型声明**：在 [`packages/app/src/env.d.ts`](../../../packages/app/src/env.d.ts) 的 `ImportMetaEnv` 接口里直接加一行 `readonly VITE_OCTO_UPLOAD_ENDPOINT?: string`，与上游 `VITE_OPENCODE_SERVER_*` 并列。这是个非业务包改动，已登记 [architecture.md §5.4](../../architecture.md#54-上游接线壳改动清单)。

**dev/prod 是否分开**：当前不区分，所有 mode 都用 `.env.local`。未来若 prod 端点不同，可加 `.env.production.local` 或 CI 注入。

- **不进 `octo.json`**：部署细节，不是用户偏好
- **不在源码硬编码**：内网开发不需要改代码，复制模板填值即可
- **与上游 `VITE_OPENCODE_*` 的区别**：上游字段有源码 fallback（`?? "localhost"` 等），可以不配；我们的端点没有合理默认值，必须配

### 调用代码

```ts
// packages/app/src/pages/insight/lib/upload.ts
const UPLOAD_ENDPOINT = "..." // TODO 内网开发给定后填入
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024  // Insight: 100MB
// 非图片(MCP 消费)：txt/md/docx/xlsx/pdf；图片(vision + 气泡缩略图消费)：png/jpg/jpeg/gif/webp
// 两类走同一个上传端点/同一份服务端白名单，只是客户端按扩展名分支决定后续注入路径（见概述），
// 图片分支扩展名清单以 insight-image-attachment.md 为准，本文件不重复维护，此处合并展示
const ALLOWED_EXT = ["txt", "md", "docx", "xlsx", "pdf", "png", "jpg", "jpeg", "gif", "webp"]

export type UploadResult = {
  url: string
  fileId: string
  fileName: string
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

> ⚠️ **本节已整体废弃（2026-06，SPEC-INS-015）**：`[已上传文件]` handle 块不再存在。现行注入为 `[附件]` 清单（文件名 + 本地路径，**不含 URL/handle**，非图片文件发送时不上传），见 [insight-file-passing.md](insight-file-passing.md)。以下原文留档备查。

各 agent 页面上传完成后，URL 段落以**独立的 synthetic text part** 随消息发送（不再拼进用户可见文本），每行带一个稳定 handle `[upload_<hex>]`（token 由文件 URL 派生、**全局唯一**，见下），格式（保持一致，LLM 可识别）：

```
[已上传文件]
- filename-1.docx [upload_9b94d620]: https://obs.example.com/.../filename-1.docx
- filename-2.txt [upload_3a1c5f0e]:  https://obs.example.com/.../filename-2.txt
```

> handle 用 URL 派生的 token（`uploadHandle` = FNV-1a 8 位 hex），**不用顺序号** `upload_1/2`。顺序号是按 turn 编的，用户分多轮上传时每轮从 1 重排会跨 turn 撞号、令模型误判"文件被替换"。URL 派生 → 同一文件永远同一 handle、跨 turn 不撞、刷新不变。详见 [ADR-014 §演进](../../adr/014-url-injection-via-plugin.md)。

发送时拆成两个 text part：

| part | 内容 | synthetic | 模型可见 | 气泡显示 |
|---|---|---|---|---|
| 1 | 用户输入的干净文本 | 否 | ✓ | ✓ |
| 2 | 上述 `[已上传文件]` 段落 | **是** | ✓ | ✗ |

**为什么用 synthetic part**：server `toModelMessages` 对 user 消息只过滤 `ignored`、不过滤 `synthetic`，所以 synthetic part 照样喂给模型（LLM 拿得到 URL）；而上游 `UserMessageDisplay` 只渲染非 synthetic text part，气泡不会暴露 S3 长地址。文件本身在气泡里以**文件卡片**呈现（insight 页解析 synthetic 段落 `parseUploadedFiles` 渲染，optimistic / server 回传后都稳定存在）。

**为什么带 handle（`[upload_<hex>]`）**：弱模型会把 URL 的转码字符微调坏 → MCP 取不到文件。故约束模型「文件参数只填 handle、永不填 URL」，由 server 端 `octo-upload-inject` 插件在工具执行前把 handle 换成精确 URL（权威副本，模型从不改写）。决策与机制见 [ADR-014](../../adr/014-url-injection-via-plugin.md)。该块的行格式是「页面 `formatUploadsForPrompt` / `parseUploadedFiles`」与「插件 `parseUploadBlock`」的单一事实源，改格式需两处同步。

**多轮上传会累积**：用户可分多轮上传，会话里会出现**多个 `[已上传文件]` 区块**，合起来才是全部可用文件。插件**聚合整个 session 的所有区块**建 handle→url 总表，所以任何一轮上传的文件都能解析。每个 handle 全局唯一固定，后续上传不改变已有 handle。

不再走 `FilePartInput.url`——避免 opencode SDK 误将 URL 当本地文件 fetch（file part 会被当作媒体附件直传给模型，而非文本 URL）。

### 大小 / 扩展名常量

| 常量 | 默认值 | 说明 |
|---|---|---|
| `MAX_UPLOAD_SIZE` | 100MB | Insight 当前场景。其他 agent 接入时可在各自 lib 内调整 |
| `ALLOWED_EXT` | txt/md/docx/xlsx/pdf（MCP 消费）+ png/jpg/jpeg/gif/webp（vision + 气泡缩略图消费，PR#235，见 [insight-image-attachment.md](../ui/insight-image-attachment.md)） | 非图片格式由 MCP 工具 `analyze_interview` 决定可处理格式；图片格式由多模态模型 vision 输入的常见支持范围决定 |
| `MAX_ATTACHMENTS` | 10 | 单轮对话最多附件数（页面级常量，见 `insight/index.tsx`）。超出弹 toast「请保持上传文件不超过10个或分多轮对话处理」，单次批量超额截取前 N 个 |

**客户端 chip 交互**：附件 chip 渲染在**输入胶囊内部顶部**（不在胶囊外），单行横向滚动（类 Claude/Gemini），不随内容撑开胶囊；单 chip 文件名溢出省略，chip 数量溢出横向滚动；下方 textarea 自有纵向滚动区。

**文件选择器 accept**：`<input accept>` 由 `ALLOWED_EXT` 派生（`.txt,.md,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.gif,.webp`），让原生弹窗预过滤、减少误选。但 accept 仅是 UX 提示**不做强制**——拖拽完全绕过它，用户也可在弹窗切「所有文件」，故校验仍以 `validateFile`（扩展名 + 大小 0/上限）为唯一事实源。

**失败 chip 反馈**：error chip 用样式化 Tooltip（非原生 title）hover 显示失败原因；仅"通过校验、真正发起过上传"的失败 chip（`retriable=true`）显示 ↻ 重传，客户端校验失败的 chip 不显示重传、提示「请删除后重新选择文件」。

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

> ⚠️ **v2 修订提案（见顶部）**：末两层合一为 `<uuid>.<ext>`，原始文件名退出 key。以下为**现状**（v2 对齐前服务端的实际行为）。

```
<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>/<sanitized_filename>
```

具体示例：

```
<bucket>/files/insight/2026-05-20/a1b2c3d4e5f6/interview-zhang.docx
<bucket>/files/insight/2026-05-20/f7g8h9i0j1k2/outline.pdf
<bucket>/files/make/2026-06-01/m3n4o5p6q7r8/brief.docx
```

各层职责：

| 层级 | 作用 | 为什么不省略 |
|---|---|---|
| `files/` | agent 项目文件命名空间 | 与同 bucket 下其他用途（如 UXR 分析产物）prefix 隔离 |
| `<agent>/` | 按 agent 隔离 | 未来 make 加入直接挂；按 agent 配 IAM/lifecycle 方便 |
| `<yyyy-mm-dd>/` | 日期分区 | lifecycle rule 按 prefix 配 TTL 最简单；调试按时间窗口查 |
| `<uuid>/` | 防冲突隔离层 | UUID 防覆盖 + 防猜测。**独立一层而不是拼进文件名**，这样 URL 末段就是原文件名，下游（浏览器下载、LLM 截 URL basename、CDN 缓存 key、MCP 工具引用文件）天然拿到干净名字，无需"过滤 hash"这种脆弱适配。对标 Discord CDN（`/attachments/<channel>/<file_id>/<filename>`）、GitHub user-attachments（`/assets/<uuid>/<filename>`）、Notion（`/<uuid>/<filename>`）主流形态；AWS 官方建议 `/` 用作 hierarchy 分隔符，`_` 仅用作同层段内分隔 |
| `<filename>` | 末段 | sanitize 后的原文件名（保留可读性，便于控制台肉眼调试与浏览器下载） |

**不引入的维度**（避免空架子）：

- 不引入 `session_id`——session 是客户端概念，服务端无感；文件"一次性引用"为主，按日期清理够用
- 不引入 `user_id`/工号——MVP 不需要。如未来 S3 要求按工号 ACL，在最前面加一层 `<user_id>/files/<agent>/...`，不破坏既有 prefix
- 不引入 tenant——内网单租户，加了是空架子

### filename sanitize

> ⚠️ **v2 修订提案（见顶部）后本节整体取消**（文件名不进 key，无需清洗）。以下为现状要求——**2026-07-03 测试表明服务端未按本节实现**（原始文件名未清洗直接拼 URL，空格/括号致 MCP 下载失败），客户端防御性清洗也已于同日移除（见顶部处置清单），v2 落地前此为已知缺口。

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

服务端校验，与客户端 `ALLOWED_EXT` 保持一致：`txt, md, docx, xlsx, pdf, png, jpg, jpeg, gif, webp`（后 5 个是图片，走同一个上传端点/同一份服务端白名单，客户端按扩展名分流到不同的后续注入路径，见 §概述）。

不在白名单返回 415。**MIME 不采信客户端传值**（浏览器猜的、不可靠）——扩展名校验通过后，PUT 到内网 S3 时由其自带方法按扩展名推导 `Content-Type`，详见 [§MIME / Content-Type 策略](#mime--content-type-策略)。

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

**成功响应**（字段名按内网约定走驼峰）。

**v2 提案形态**（对齐后生效，`url` 换为自有域名下载地址、不含原始文件名；封装与字段集不变）：

```json
{
  "content": {
    "url": "https://<upload-service>/octoAiServer/files/9b94d620a1b2.txt",
    "fileId": "files/insight/2026-07-03/9b94d620a1b2.txt",
    "fileName": "访谈稿-张三 (2).txt",
    "size": 1004138,
    "mime": "text/plain"
  },
  "success": true,
  "errorCode": 200,
  "errorMessage": null
}
```

**现状形态**（v2 对齐前，`url` 为 S3 直链、末段是原始文件名）：

```json
{
  "content": {
    "url": "https://<obs-host>/<bucket>/files/insight/2026-05-21/<uuid>/iconGroup-1.txt",
    "fileId": "files/insight/2026-05-21/<uuid>/iconGroup-1.txt",
    "fileName": "iconGroup-1.txt",
    "size": 1004138,
    "mime": "text/plain"
  },
  "success": true,
  "errorCode": 200,
  "errorMessage": null
}
```

`content` 内字段说明：

| 字段 | 说明 |
|---|---|
| `url` | 完整可访问 URL，客户端直接注入 LLM context |
| `fileId` | S3 object key（含 prefix 完整路径），对应 DB 里 `file_key`；当前客户端只消费 `url`，预留给未来 MCP 合同切到 `fileId` 引用 |
| `fileName` | 原始文件名（不含 UUID 前缀） |
| `size` | 字节数 |
| `mime` | MIME 类型 |

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
| `file_key` | varchar(512) | S3 object key（API 响应里以 `fileId` 字段对外） |
| `deleted` | tinyint | 逻辑删除符（0=正常 1=已删除） |
| `created_at` | timestamp | 上传时间 |
| `user_key` | varchar(64) | 上传人工号；MVP 客户端不传，先冗余空字段，后续接入工号体系再回填 |
| `upload_status` | varchar(16) | 上传状态（如 `success` / `failed`） |

注：

- `file_key` 与 API 字段 `fileId` 物理上同源；DB 用 snake_case `file_key` 是 DB 命名习惯，API 用驼峰 `fileId` 对齐内网约定
- `agent` 字段标记为"看是否需要"——本 spec 建议保留（路径已分层，未来按 agent 审计/计费便利）；如内网开发评估冗余可去掉

### 未来扩展（不在 MVP 实现）

| 场景 | 触发条件 | 实现 |
|---|---|---|
| 大文件分片 | 单文件 > 100MB | 服务端内部转用 S3 multipart upload。**客户端始终是同一份 multipart POST**，无需切片代码 |
| 客户端切片上传 | 单文件 > 2GB | 参考 OpenAI Uploads API 形态另起接口。Insight 不涉及，agent 项目其他业务真有此需求再做 |
| 显式 TTL 字段 | 部分场景需要更短保留期 | 上传时 form 多传 `expires_after` 秒数，对标 OpenAI |

---

## 联调与验证

> ⚠️ 本节验证步骤中涉及 `[已上传文件]` / handle / eager 上传的条目为 SPEC-INS-015 之前的旧流程（现行：图片 eager 上传、非图片 `[附件]` 清单 + 插件按需上传）。上传服务本身的合规校验（响应封装 / 错误码 / 大小）仍有效。

### 服务端未就绪时（临时调试）

两种入口：

1. **设环境变量指向 mock 服务**（如 https://httpbin.org/post 这类响应 JSON 的端点），走真实上传链路
2. **完全跳过上传**：InsightPage 发送前 hardcoded URL 直接拼到 prompt 文本，绕过上传验证 MCP 主流程

```ts
// 临时调试，服务端就绪后删除
const debugUrls = ["https://obs.example.com/asset/aiInterview/test.txt"]
```

### 服务端就绪后（联调步骤）

#### 1. 客户端对接

只有一步：

```bash
cd packages/app
cp .env.example .env.local
# 把 .env.local 里 VITE_OCTO_UPLOAD_ENDPOINT 改为内网实际地址
bun run dev
```

不需要改任何源码——响应封装解析、errorCode 映射、UI 状态切换、调试日志都已就绪。

#### 2. 调试日志（隔空联调用）

客户端在每个关键节点都输出统一前缀 `[octo:upload]` 的日志，便于内外网隔空对线——内网同学看不到客户端 DevTools 时可让对方截图 Console 给你。

正常链路应依次看到 5 步：

| 步骤 | 日志 | 关键字段 |
|---|---|---|
| 1/5 | `[octo:upload] 1/5 start` | filename, size, mime |
| 2/5 | `[octo:upload] 2/5 request` | endpoint, filename, size, mime |
| 3/5 | `[octo:upload] 3/5 response` | httpStatus, httpOk, body（完整响应包含 success/errorCode/errorMessage/content） |
| (4/5 仅失败) | `[octo:upload] 4/5 business error` | errorCode, errorMessage, mappedCode |
| 5/5 | `[octo:upload] 5/5 success` | url, fileId |

异常分支（按发生先后）：

| 日志 | 触发原因 | 内网同学应排查 |
|---|---|---|
| `validate failed (client-side)` | 客户端校验拒绝（size/扩展名） | 与你无关，客户端配置问题 |
| `endpoint not configured` | env var 没生效 | 确认 .env.local 是否在 packages/app/ 下且 dev 已重启 |
| `network failed` | fetch 报错（DNS / 连接拒绝 / CORS preflight 失败） | 确认服务端是否监听；CORS 头是否正确（见 §6）|
| `http failed` | HTTP 4xx/5xx 但响应不是约定 JSON | 检查服务端是否被代理拦截，是否返回 HTML 错误页 |
| `bad response format` | HTTP 200 但 body 不符合 `{success, errorCode, ...}` 形态 | rawText 字段会打印前 500 字节，对比 spec §接口合同 校正 |
| `4/5 business error` | `success=false` | errorCode/errorMessage 都会打印；对照 §业务错误码 表 |
| `empty content` | `success=true` 但 `content` 为 null | 服务端落 S3 后忘了填 content |

每条日志都包含 `filename` / `size` / `mime` 三个文件元信息，便于多文件并发时区分。

#### 3. 正常链路验证

| # | 操作 | 期望结果 |
|---|---|---|
| 1 | Insight 页选一个 .docx / .pdf 文件（< 100MB） | 输入胶囊内部顶部出现 chip（⏳ uploading）；Console 出 `1/5 start` |
| 2 | 等待请求完成 | chip 变蓝色 done 状态；Console 依次出现 `2/5 request` → `3/5 response` → `5/5 success` |
| 3 | DevTools Network 看 POST 请求 | URL = env var 配置的地址；Content-Type 为 multipart/form-data；body 里**只有 file 一个字段** |
| 4 | 响应体形态 | `{ content: { url, fileId, fileName, size, mime }, success: true, errorCode: 200, errorMessage: null }` |
| 5 | 输入文字 → 点发送 | Console 出 `[octo:prompt] send`，含 `uploads: [{ name, url }]`；`optimistic added` 的 `partsCount=2` |
| 6 | 用户气泡渲染 | 气泡**只显示干净文本**（不暴露 S3 URL）；气泡上方右对齐出现**文件卡片**（文件名 + 扩展名徽标） |
| 7 | session 内消息 part | 含一个 `synthetic:true` 的 text part，内容为 `[已上传文件]\n- <filename> [upload_<hex>]: <url>` 段 |
| 8 | LLM 调业务工具时 | 模型在文件参数填 **handle**（`upload_<hex>`）；server 端 `octo-upload-inject` 插件在执行前把 handle 换成步骤 4 的 `content.url`，看 `[octo:inject] args rewritten` 日志的 before/after（见 [ADR-014](../../adr/014-url-injection-via-plugin.md)） |

#### 4. 边界 / 错误链路验证

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
| 超过 10 个 | 已有附件后再选，使总数 > 10 | 弹 toast「请保持上传文件不超过10个或分多轮对话处理」；只接受补满到 10 的前 N 个 |

#### 5. 服务端协议合规校验

由内网开发同学自查（spec 已固化的约定）：

- [ ] 响应体所有出口都符合 `{ content, success, errorCode, errorMessage }` 4 字段封装（成功/失败均如此）
- [ ] `errorCode` 是**整数**不是字符串
- [ ] 成功时 `content.url` 是**可直接访问的完整 URL**（注入 LLM 后能被 MCP 工具拿来发请求）
- [ ] S3 路径符合 `<bucket>/files/<agent>/<yyyy-mm-dd>/<uuid>/<filename>` 形态——UUID 独立一层而非拼进文件名（确保 URL basename 是干净的原文件名，避免下游引用文件时带 hash）
- [ ] DB 表写入：每次成功上传应在表里出现一行新记录（`upload_status=success`）
- [ ] 大文件（接近 500MB）能成功上传且 stream 不爆服务端内存
- [ ] lifecycle rule 已配置（`files/` prefix，365 天 expire）
- [ ] `docx` / `xlsx` 各下载一次实测响应头，`Content-Type` 是标准 OOXML mime（不是 `application/octet-stream` / `application/zip`）——见 [§MIME / Content-Type 策略](#mime--content-type-策略)
- [ ] `Content-Disposition: inline` 响应头带了 `filename*=UTF-8''<原始文件名>` 参数（不是裸 `inline` 不带文件名）

#### 6. CORS / 部署注意

如果服务端与客户端同源（内网相同 host），跳过 CORS 检查；如不同源，服务端需返回：

```
Access-Control-Allow-Origin: <octo desktop host>
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: Content-Type
```

否则 fetch 会被浏览器拦截，客户端会落到 `NETWORK` 错误。

---

## 待补充

- [ ] **2026-07-03 合同修订提案 v2（见顶部）与后台对齐**：uuid key + 下载走自有域名 + Content-Disposition；对齐后改写 §S3 路径策略 / §filename sanitize / §接口合同，并按「可回退项清单」还原客户端防御性改动。**2026-07-06 更新**：后台已在按 v2 方向实现，下载路径实际前缀确认为 `/octoAiServer/files/<uuid>.<ext>`（已同步进文档，`.ext` 是否可省略也已定论——见 §S3 路径策略 item 1），MIME/Content-Type 落地规则见 §MIME / Content-Type 策略；仍待：后台正式上线后逐条走一遍下方「联调与验证」清单
- [ ] `VITE_OCTO_UPLOAD_ENDPOINT` 实际地址（待内网开发给定后写入 `packages/app/.env.local`）
- [ ] 内网 S3 是否要求工号字段（access control 粒度）—— 若必填则在 form 里加 `user` 字段
- [x] ~~服务端响应体字段名最终确认~~ 已确认走驼峰：`url` / `fileId` / `fileName` / `size` / `mime`
