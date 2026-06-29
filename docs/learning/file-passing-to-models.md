# 文件怎么传给模型 / 工具 —— FilePart 内幕、三种模式、insight 现状

> 面向"以为 FilePart 就是放本地路径、以为图片必须 base64"的读者(包括过去的我)。配真实代码行号。
> 配套:[plugin-hooks-url-injection.md](plugin-hooks-url-injection.md)(handle→url 插件细节)、[ADR-015](../adr/015-file-passing-architecture.md)(我们的分流决策)。

---

## 0. 一句话

**模型 API 收不到 `File`/`Blob` 对象,也收不到本地磁盘路径。** 前端的文件,最终一定被序列化成下面三种之一才进模型/工具:

| 模式 | 给模型的东西 | 谁来读文件内容 | 适用 |
|---|---|---|---|
| **A 文本内联** | 文件的**文本内容**(拼进 text part) | 系统/客户端读出来 | 任何模型(含纯文本模型) |
| **B 多媒体** | base64 / 公网 URL / Files API `file_id` | 模型 provider 的服务器 | **仅多模态模型** |
| **C 工具引用** | 一个**引用**(handle / url / 路径) | 某个**工具**(MCP / Read / extract) | RAG / agentic;模型本身不读 |

"本地路径"只是模式 C 的一种引用形态,且**前提是有个工具会去读它**。模型自己看不到磁盘。

---

## 1. opencode 的 `FilePart` 到底装什么

类型([message-v2.ts:185](../../packages/opencode/src/session/message-v2.ts#L185)):

```ts
FilePart = { type:"file", mime, url, filename?, source? }
```

**核心是 `url`,它是个多态定位符**,可以是:
- `file://<绝对路径>?start&end` —— 本地文件引用(@文件 / context 文件走这个,见 [build-request-parts.ts:100](../../packages/app/octoapp/components/prompt-input/build-request-parts.ts#L100))
- `data:<mime>;base64,...` —— 内联 base64(上游 chat 粘贴图片走这个,见 [prompt-input/attachments.ts:11](../../packages/app/octoapp/components/prompt-input/attachments.ts#L11))
- `https://...` —— 网络 URL
- MCP resource uri(`ResourceSource`)

### 关键:FilePart 在「组 prompt 时」被急切解析成模型真正要的内容

这是最反直觉的一点。`FilePart` 不是"丢给模型一个路径让它自己想办法",而是在发请求前就被 opencode 解析掉([prompt.ts:1103-1264](../../packages/opencode/src/session/prompt.ts#L1103)):

- `url` 是 **`file://` 且 mime=`text/plain`** → opencode **自己在服务端调 Read 工具**读出文件内容,作为 synthetic text part 内联("Called the Read tool…" + 文件正文)。⇒ 落到**模式 A**,任何模型可读。
- `url` 是 **`file://` 且是二进制(office/图片)** → opencode **读字节转 `data:<mime>;base64,...`**([prompt.ts:1257](../../packages/opencode/src/session/prompt.ts#L1257)),作为 media part 交 AI SDK。⇒ 落到**模式 B**。
- `url` 是 `data:` → 直接用。

**推论(踩过的坑)**:把一个 **office 文件**作为 `FilePart(file://)` 丢进去,**指望模型"看到路径后自己调 extract 工具"是错的**——opencode 在模型回合前就把它 base64 掉了,模型手里根本没有路径。要让模型按需调 extract,得**把路径作为 text 给它 + 提供工具**(模式 C),不能走 FilePart。纯文本/md 走 FilePart 反而正好(自动内联)。

### 非多模态模型怎么办

`toModelMessages` 里有 `stripMedia`:模型不支持图像时,media part 被换成 `[Attached image/png: file.png]` 文本占位([message-v2.ts:809](../../packages/opencode/src/session/message-v2.ts#L809))。所以**给纯文本模型传图 = 它只看到一行占位文字**,等于没传。

---

## 2. base64 vs S3 URL vs Files API(模式 B 的三选一)

厂商(Anthropic/OpenAI)图片都支持三种来源:inline base64 / 公网 URL(服务器去拉)/ Files API `file_id`。取舍:

| 方式 | 优点 | 坑 |
|---|---|---|
| base64 | 简单、单发、无需存储 | **体量爆炸**:一个 5MB 文件 base64 ≈ 670 万字符 ≈ ~170 万 token,**任何上下文窗口都装不下**;每轮重发 |
| URL | 不进 prompt 体积、可复用 | provider 服务器**必须够得到这个 URL**(公网 / 同内网) |
| Files API | 上传一次、id 复用、省带宽 | 依赖厂商有 Files API |

**结论**:base64 只对**小图**(截图几百 KB)勉强可接受;**文档类绝不 base64 给模型**(直接超窗)。有存储后端的产品基本走 URL —— 这正是 [ADR-015](../adr/015-file-passing-architecture.md) 决策 2 的依据。opencode 默认 base64,是因为它是无存储的本地工具。

---

## 3. insight 现状:三条路径(2026-06-29 核实)

insight **不复用**上游 chat 的附件逻辑,自己一套。当前实际跑的:

1. **源文件/附件(docx/xlsx/txt/md)→ MCP 分析**(模式 C):
   `addAttachments → doUpload`(选文件即 eager 传 S3,[lib/upload.ts](../../packages/app/octoapp/pages/insight/lib/upload.ts))→ 发送时 `formatUploadsForPrompt` 拼进 `[已上传文件]` synthetic 文本块(`handle→url`)→ 模型把 handle 填进 MCP 工具 args → `octo-upload-inject` 插件把 handle 换成 url([plugin-hooks-url-injection.md](plugin-hooks-url-injection.md))→ UXR 工具拉 S3。**文件不进模型上下文,只给工具。**

2. **图片(PR#235)→ 当前也走路径 1**:`handlePaste → addAttachments → doUpload(S3) → handle 块`。即图片现在也是"工具输入"形态,**多模态模型看不到图**(它只是文本里一个 handle)。✗ 这是 gap,[图片附件 spec](../specs/ui/insight-image-attachment.md) 要把它改成 vision `FilePart{url:S3}`(模式 B,只给模型看)。

3. **SPEC-INS-014 本地副本**:选文件时同时 `copyFileToWorktree` 拷进 `<projectDir>/insight/sources/`([SPEC-INS-014](../specs/infra/insight-worktree-layout.md))。这是给**下游本地能力线**(extract / @引用 / 二次生成)读的,与上面 S3 上传**解耦**。

> 对照上游 chat:@文件 = 模式 A(`FilePart file://` 自动内联);粘贴图片 = 模式 B(base64 `FilePart`)。两者都是原生 FilePart,insight 都没用。

---

## 4. 我们要去的终态([ADR-015](../adr/015-file-passing-architecture.md))

按「文件类 × 用途」分流,不强行统一:

- **文本/md → 模型读**:原生 `FilePart(file://sources)` 自动内联。
- **office → 模型读**:本地路径引用(text)+ `extract_document` tool(Spec B),模型按需调;没工具时 fallback 写脚本读。**不能走 FilePart(会被 base64)。**
- **图片 → 模型看**:`FilePart{url:S3}`(不 base64)。
- **任意文件 → MCP 工具**:handle 块 + 插件**按需上传**(模型真调工具时才传 S3,[SPEC-INS-015](../specs/infra/insight-mcp-lazy-upload.md))。

**`FilePart`(喂模型内容)与 `handle`(喂工具引用)是两套、不可混用**:用 FilePart 承载 MCP 的 S3 引用会让 opencode 把文件 base64 灌进 prompt,而模型手里还是没有能传给工具的 url。

---

## 5. 心智模型速记(别再踩)

- 模型 API 不收 File/Blob/磁盘路径,只收 {文本 / base64 / 公网url / file_id / 工具 args}。
- `FilePart.url` 是多态定位符,**会在组 prompt 时被解析成内容**(text/plain→内联、二进制→base64)。
- "给模型路径让它自己调工具"只有把路径当**文本**给 + 配工具才成立;走 FilePart 不成立。
- base64 只对小图;文档超窗,必须抽文本或交工具。
- 有存储就用 URL;前提是 provider 够得到那个 URL。
