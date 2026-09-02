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

> **⚠️ 「自动内联」≠「全文进上下文」(2026-08-21 补,SPEC-INS-032 v2)**
>
> 上一条说的「调 Read 工具读出文件内容」是**字面**的:它调的就是那个 `read` 工具,因此**照吃 `read` 的硬上限**——[read.ts:15-18](../../packages/opencode/src/tool/read.ts#L15-L18) 2000 行 / **50KB**,超了截断并追加 `(Output capped at 50 KB. … Use offset=N to continue.)`。
>
> 后果:一份**两三万字的中文 md**(UTF-8 3 字节/字 ≈ 60–90KB)作为附件发出去,模型拿到的是**前 ~1.7 万字 + 一句续读提示**,而弱模型多半不会续读。**不报错、不可见**,直接基于半份材料作答。
>
> 所以「纯文本/md 走 FilePart 正好」这句只在**小文件**下成立。上游这个设计本身就是粗粒度的渐进式披露(一份 50KB),不是「全文进上下文」——业界(claude.ai / ChatGPT)同样是**按体量分层**,没有产品在做「永远全文内联」。insight 侧按总字节分层转子代理分治的定案见 [SPEC-INS-032 §2.3](../specs/infra/insight-subagent-dispatch.md)。

**推论(踩过的坑)**:把一个 **office 文件**作为 `FilePart(file://)` 丢进去,**指望模型"看到路径后自己调 extract 工具"是错的**——opencode 在模型回合前就把它 base64 掉了,模型手里根本没有路径。要让模型按需调 extract,得**把路径作为 text 给它 + 提供工具**(模式 C),不能走 FilePart。纯文本/md 走 FilePart 反而正好(自动内联)。

### 非多模态模型怎么办

`toModelMessages` 里有 `stripMedia`:模型不支持图像时,media part 被换成 `[Attached image/png: file.png]` 文本占位([message-v2.ts:809](../../packages/opencode/src/session/message-v2.ts#L809))。所以**给纯文本模型传图 = 它只看到一行占位文字**,等于没传。

---

## 2. base64 vs S3 URL vs Files API(模式 B 的三选一)

厂商(Anthropic/OpenAI)图片都支持三种来源:inline base64 / 公网 URL(服务器去拉)/ Files API `file_id`。取舍:

| 方式 | 优点 | 坑 |
|---|---|---|
| base64(data URI) | 简单、单发、无需存储、请求自包含 | 请求体 ×1.33、发送方内存峰值 ≈ 原图 ×4~5、请求体日志留不下 |
| URL | 请求体小、发送方零内存、可留档复查 | provider 服务器**必须够得到这个 URL**(公网 / 同内网);多一跳不可控;图必须在拉取那刻仍存活 |
| Files API | 上传一次、id 复用、省带宽 | 依赖厂商有 Files API |

### ⚠️ 关键澄清:图片的 base64 **不进 token、不占上下文窗口**

**这里曾经写错过,并且错误结论被 [ADR-015](../adr/015-file-passing-architecture.md) 决策 2 引用为依据(2026-08-14 一并修正)。** 原文写「5MB 文件 base64 ≈ 670 万字符 ≈ 170 万 token,任何上下文窗口都装不下」——这个算术只在 base64 字符串被当作**文本**时成立,而图片走的根本不是文本通道。

必须分清两件事:

| 载体 | 处理路径 | 是否 tokenize |
|---|---|---|
| **media part 的 data URI**(`{type:"image_url", image_url:{url:"data:image/png;base64,..."}}`) | HTTP 层 decode 回图片字节 → vision encoder 切 patch → **固定数量的 image token** | **否**。base64 字符串在进 tokenizer 之前就已经被消费掉了 |
| **text part 里的 base64 字符串**(把 base64 当正文拼进提示词) | 和普通文本一样进 tokenizer | 是 → 这才是「170 万 token」的场景 |

**推论(反直觉但重要)**:同一张图,用 URL 传和用 base64 传,**进模型的 token 数完全相同**——image token 数只由**图片分辨率**决定,与传输形态无关(Anthropic 口径 ≈ `w×h/750`,1024×1024 约 1400 token;OpenAI 按 512×512 分块计)。所以:

- 「几十 KB 的图 base64 后有十几万字符,模型吃不下」——**不成立**。那十几万字符不进上下文。
- 「用 base64 会让本来 URL 能跑出来的结果跑不出来」——**不成立**。两条路最终喂给 vision encoder 的是同一份字节。
- base64 的代价全部在**传输与发送方工程**(请求体、内存、body 上限、日志留痕),**不在模型侧**。

**文档类不能 base64 给模型的真实原因也不是「超窗」**,而是多模态通道**只解码图片**(部分厂商额外支持 PDF):docx/xlsx 的 base64 传过去,模型侧没有对应的解码器,要么直接报错要么当成无意义二进制——跟体积多大毫无关系。所以文档必须走「抽文本」(模式 A)或「交工具」(模式 C)。

**结论**:图片选 base64 还是 URL 是一道**工程题**,不是模型能力题。有存储后端、且 provider 够得到 URL 时优先 URL(省内存、可留档);够不到就用 base64,模型侧无任何损失。opencode 默认 base64,正是因为它是无存储的本地工具——而不是因为它「将就」。

### 判据别只看两端,要数中间有几跳

「有存储后端就走 URL」这条经验法则本身没错,但它默认了一个隐含前提:**字节从产生它的进程到 provider 之间是一整跳**。真实链路常常不止一跳,而每一跳的边界性质可能完全不同。

insight 2026-09 那次改动就是反例([ADR-017](../adr/017-insight-image-local-path-base64.md)):图片在 Electron 渲染进程手里,provider 在远端,中间还夹着一个 **opencode server**。原方案(ADR-015 决策 2)按「跨进程边界 → 字节要搬到 provider 够得到的地方」推出「走 S3」,但把两跳当成了一跳:

| 跳 | 边界性质 | 是否需要第三方存储 |
|---|---|---|
| 渲染进程 → opencode server | **同机 sidecar,共享文件系统** | **否**——server 直接 `readFile` 就行 |
| opencode server → provider | 真正的跨网络边界 | 是,发 base64 或发一个 provider 够得到的 URL |

第一跳根本不是「跨进程边界」意义上的搬运问题——文件已经在磁盘上,而 server 就在同一块磁盘上。识别出这一点之后,S3 在第一跳上是纯粹的绕路(还引入了对上传服务可用性的硬依赖)。

**可迁移的判据**:遇到「文件怎么送到模型」的设计,先把链路上的每一跳列出来,逐跳问「这一跳的两端共享什么」(同一进程内存 / 同一文件系统 / 同一内网 / 公网),再决定每一跳的载体。只看「客户端」和「模型」两端,很容易把一条本地读盘的路径当成跨网络传输来设计。

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
- **任意文件 → MCP 工具**:`[附件]` 清单(文件名→本地路径)+ 插件**按需上传**(模型真调工具时才传 S3,[SPEC-INS-015](../specs/infra/insight-file-passing.md))。模型填文件名/路径、**从不碰 URL**;插件在工具执行前换成精确 url(不再用占位 handle,弱模型抄坏 URL 的根因已消失)。

**`FilePart`(喂模型内容)与「工具引用」(喂 MCP)是两套、不可混用**:用 FilePart 承载 MCP 的 S3 引用会让 opencode 把文件 base64 灌进 prompt,而模型手里还是没有能传给工具的 url。

---

## 5. 心智模型速记(别再踩)

- 模型 API 不收 File/Blob/磁盘路径,只收 {文本 / base64 / 公网url / file_id / 工具 args}。
- `FilePart.url` 是多态定位符,**会在组 prompt 时被解析成内容**(text/plain→内联、二进制→base64)。
- "给模型路径让它自己调工具"只有把路径当**文本**给 + 配工具才成立;走 FilePart 不成立。
- text/plain 的「内联」**是真的走 `read` 工具**,所以**有 2000 行 / 50KB 上限**;大 md 会被静默截断,别把「自动内联」读成「全文进上下文」(§1 的警示框)。
- **图片的 base64 不进 token**(走 vision 解码通道),同一张图 URL 传和 base64 传的 token 数完全一样;base64 的代价在请求体/内存/日志,不在模型侧。只有把 base64 拼进 **text part** 才会 tokenize 爆炸。
- 文档不能 base64 给模型,原因是**多模态通道不解码 docx/xlsx**(与体积无关),必须抽文本或交工具。
- 有存储就优先 URL(省内存、可留档);前提是 provider 够得到那个 URL,够不到就用 base64,模型侧无损失。
