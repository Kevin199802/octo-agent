# SPEC-INS-015 — Insight Agent 文件传参机制（上传 / 路由）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 infra/insight/agent
>
> **本 spec 是 insight 文件传参的实现层唯一真相源**：具体规则、格式、时机只在此处定义。[ADR-015](../../adr/015-file-passing-architecture.md)（为何按「文件类 × 用途」分流）、[ADR-014](../../adr/014-url-injection-via-plugin.md)（为何用占位替换、不让模型碰 URL）只保留**决策与理由**，引用本 spec，不复述规则。learning 笔记同理只引用。
>
> 依赖：[SPEC-INS-014](insight-worktree-layout.md)（源文件拷进 `insight/sources`，已实现）。
> 取代：原「MCP 文件按需上传 / lazy-upload」草案——那只是本 spec ④ 一支的时机细节，框窄了。

---

## 0. 目标：把 Insight Agent 正常化

此前 insight **完全依赖 MCP**：选文件即 S3 上传 → `[已上传文件]` handle 块 → 调 MCP 时插件把 handle 换成真实 url → 渲染 MCP 返回的 url。后果：文件**只能**经 MCP 流转，**不调 MCP 时本地模型读不到任何文件、什么都做不了**。

本 spec 让 insight 回到**标准 Agent**：文件按「文件类 × 用途」分流，直接给模型读 / 看；**MCP 退化为其中一条「按需」分支**——

- 不调 MCP → **零上传**，文件照样本地可读、可对话；
- 调 MCP → 原流程（S3 上传 → 换 url → 调用工具）**一行不少**，只是挪到「调用那一刻」才触发，MCP 该怎么触发还怎么触发。

---

## 1. 路由总表（SOT）

| # | 文件类 | 用途 | 载体 | 传 S3 | 上传时机 |
|---|---|---|---|---|---|
| ① | **非 ②③ 的一切文本类**（md / txt / csv / json / log / html / 无扩展名…） | 模型**读** | `FilePart(file://…, text/plain)`；opencode 组 prompt 时自动调 Read 把正文内联（2000 行 / 50KB 上限，超出附 `offset` 续读提示） | 否 | — |
| ② | docx / xlsx / pdf / pptx | 模型**读** | 附件清单给本地路径（§2）+ 模型调 `extract_document(path)` 读出文本 | 否 | — |
| ③ | 图片 | 模型**看** | `FilePart{ type:file, mime:image/*, url:S3 }` 走 vision | **是** | **change 即传**（选/拖/粘当下） |
| ④ | 任意 | 喂 **MCP 工具** | 模型在工具参数里填**文件名** → 插件按需上传换 url（§3） | 是 | **调 MCP 工具那一刻** |

要点：

- **① 的判定是反向排除，不是正向白名单**（2026-08-20 修订）：上游 `read` 支持的是「任何非二进制文本」（[tool/read.ts](../../../packages/opencode/src/tool/read.ts) `isBinaryFile` = 二进制扩展名黑名单 + 内容嗅探），不是固定清单。客户端 `isTextInlineFile` 因此只排掉**有专门通道的**格式（②的 office/pdf、③的图片），其余一律交给服务端 `read` 判定。**好处**：上传格式放开（如 json / csv 进 `ALLOWED_EXT`）时无需再同步一次内联清单，判定口径与 opencode 原生一致。排除集之外若真是二进制（如 `@` 一个 .zip 产物），`read` 返回 `Cannot read binary file` 进上下文——响亮失败，不做客户端预判（嗅探要读文件字节，是服务端的活）。
  - ~~原 `TEXT_INLINE_EXT = {txt, md}`~~：正向白名单，恰好等于当时 `ALLOWED_EXT` 里的全部文本类，于是把「模型能读什么」和「附件栏允许传什么」两件无关的事耦合在了一起。
- **① 的来源含附件栏文件 + `@` 引用的会话文件**（2026-08-20，SPEC-INS-023 §7.2）：两个入口合并后传入同一入参，按 path 去重（同一文件既是本轮附件又被 `@` 引用时只内联一次）。`@` 的**图片**仍不走 ③——vision 需要 S3 url，而 `@` 的本地图片没有；目前只在 `[引用文件]` 清单里给路径，需要时另议。
- **载体各自独立、可叠加**：一个 docx 可同时被 ②（extract_document 读）和 ④（MCP 分析）使用，两条互不排斥。
- **图片只走 ③**：不进附件清单、不进 ④。图片对"本地读正文 / 喂 MCP"无意义，模型只能"看"——给它本地路径或 handle 它理解不了，必须是它能 vision 的 url。
- ②的 `extract_document` 工具**本体见 [SPEC-INS-016](insight-extract-document.md)**（已实现：docx=mammoth / pdf=unpdf / xlsx=exceljs）；本 spec 只负责接线（agent 工具表登记 + 提示词路由 office 走它）。

---

## 2. 附件清单（本地路径清单）

非图片文件在**发送时**注入**一个 synthetic text part**：

```
[附件]
- 访谈稿-张三.docx: /Users/…/insight/sources/访谈稿-张三.docx
- 调研大纲.md: /Users/…/insight/sources/调研大纲.md
```

- **用户照样看得到文件**：这段 synthetic 文本不作为**裸文字**渲染进气泡（否则气泡里是一长串本地路径，丑且无意义）——`UserMessageDisplay` 过滤 synthetic text；但 **InsightTurn 解析这段、渲染成文件卡片**，用户在对话里看到的就是那些卡片（与今天一致）。`toModelMessages` 不过滤 synthetic → 模型也拿得到清单。
- **定性**：这是「当前可用文件 + 本地绝对路径」的清单，服务 ②（extract_document 拿路径读）与 ④（MCP 引用）。**它不是"MCP 块"；注入它不触发任何上传。**
- 文本类另走 ①（FilePart 内联正文给模型读）；清单里仍列它们，供模型在 ④ 里按文件名引用。
- **清单区块有两个头，对 ④ 完全等价**（2026-08-20）：`[附件]`（附件栏上传）与 `[引用文件]`（SPEC-INS-023 的 `@` 引用，含 agent 自己生成的产物）。插件 `MANIFEST_HEADERS` 两个都收——曾只认 `[附件]`，导致 `@` 来的文件无法喂 MCP（见 SPEC-INS-023 §8）。不合并成单一头的理由：session 消息持久化，旧会话里永远是 `[附件]`，双头解析注定要永久保留。
- 图片**不进**本清单（走 ③，卡片由图片 FilePart 渲染缩略图）。
- 格式契约与 §3 插件解析**同源**（两处独立实现，改格式需同步）。

---

## 3. ④ MCP 按需上传（插件 octo-upload-inject）

- 提示词铁律：调 MCP 工具时，文件参数填**文件名**（清单里那个，人类可读），**绝不填 URL**。
- 插件在 `tool.execute.before` 钩子：
  1. **本地文件工具**（`extract_document` / `write` / `edit` / `apply_patch` / `read` / `glob` / `grep`）→ **直接放行**（它们的 path/filePath 是**本地磁盘目标**，绝不能被换成 url——S3 URL 替换只服务 MCP 工具 `uxr-tool_*`）。⚠️ 2026-07-22 修复：此前排除集只有 `extract_document`，漏了 `write` 等 —— 模型对上传文件做 `write`（如「在末尾追加一段」）时 `filePath` 命中清单键被换成 S3 URL，`octo-outputs-redirect` 再把非绝对的 `https://` 串 join 进 `outputs/`，建目录时因路径含 URL 成分崩溃（`makeDirectory .../outputs/https:/octo-beta.../...`）；
  2. args 里无「以文档扩展名结尾」的串 → 零开销放行（非文件工具一律不动）；
  3. 聚合整个 session 所有 `[附件]` 清单 → `引用 → 本地路径` 总表：**引用键收录文件名 / 完整路径 / 磁盘 basename 三种**（分多轮添加的文件都在表里）；匹配**只做精确命中**——不做去空白等启发式归一化（2026-07-03 加过、同日复审回退：可能把引用静默误配到"仅空白不同"的另一文件，且"模型改写引用"是无界类追不完；模型抄错 → 不替换 → 工具失败错误回灌，根治见 [SPEC-INS-017 §2.1](insight-mcp-explicit-entry.md) chip 声明钉死）；
  4. 对 args 里引用到的每个键：读本地文件 → POST `OCTO_UPLOAD_ENDPOINT` 拿 url（**进程内缓存 `路径→url`**，同文件多轮多次只上传一次；multipart 文件名 = 原样 basename——客户端不做清洗，字符集安全由上传服务合同 v2 保证，见 [file-upload.md 顶部提案](file-upload.md)；v2 落地前特殊字符文件名在 MCP 下载链路仍可能失败，已知窗口）→ 就地把该串换成 url；
  5. 上传失败 / 端点未配置 → **抛错**，工具调用失败、错误回灌模型（让其重试），不把本地路径喂给 MCP（必 404）。

**为什么按文件名/路径替换、不再需要占位 handle**：改完后**模型自始至终不接触 S3 URL**——清单只给文件名/路径，URL 全程由插件在调用时生成并注入。ADR-014 当初的"弱模型抄坏 %xx 转码 URL"根因（URL 要由模型复述）已消失。提示词让模型填文件名（短、人类可读）；但**兼容它照抄完整路径或磁盘 basename**（撞名后缀名，可能与清单文件名不同）——三种键都认（精确匹配），避免"引用了文件却没上传、把裸文件名/本地路径丢给 MCP"。

> **不引入对用户可见的不透明 id**（`upload_xxx` / `f1` 之类）：它大概率漏进模型对话、用户读不懂；文件名/路径既人类可读又足够稳。重名极少见——`insight/sources` 撞名加后缀（INS-014 §3.3）已保证落地路径唯一。
>
> **实现约束（易踩坑）**：插件与 `extract_document` 跑在 opencode **sidecar**，桌面端由 Electron `utilityProcess.fork` 起 = **Node 运行时，非 Bun**。读文件用 `node:fs`（`readFile` / `access`）+ 全局 `Blob/FormData/fetch`（Node 18+ 均有），**不要用 `Bun.*`**（会抛 `Bun is not defined` 让工具调用崩）。

---

## 4. ③ 图片细则

- **change 即传**：选取 / 拖拽 / 粘贴当下就异步上传 S3（业界通行做法；图片必然要上传，不存在"是否调 MCP"的不确定，无须等发送）。
- **缩略图**：`URL.createObjectURL(file)` 立刻渲染 `<img>`，本地秒显、不等上传；上传后台并行。发出的消息卡片改用 S3 url 渲染。
- **发送**：产出 `FilePart{ type:"file", mime, url:S3, filename }` 进 user 消息 → 交多模态模型 vision 通道。非多模态模型由 opencode `stripMedia` 自动换占位，不影响。
- **前提**：provider 能 GET 到该 S3 url（内网模型 ↔ 内网 S3 通即可）；将来若接公网模型够不到内网 S3，那条 case 退回 base64 / Files API（[ADR-015 决策 2]），不动本骨架。

---

## 5. 与 MCP 的边界（纯消费，不改其契约）

| 动作 | 归属 | 是否动 MCP |
|---|---|---|
| 提交 / 查询 / resource_link 形态、工具入参契约 | MCP 团队 | **一行不改** |
| 何时上传、附件清单格式、文件名→url 替换 | 我们侧（自有上传服务 + 插件） | 否 |
| 图片改走 vision FilePart | 我们侧 | 否 |

---

## 6. 降级（无 projectDir / 非桌面 / 内存 blob）

- **非图片**：拿不到真实本地路径 → 不进附件清单 → 该文件 ②④ 均不可用（本地读 + MCP 都摸不到）。生产桌面端 projectDir 恒在（INS-012），不出现；`__dev` 仅 UI 调试，忽略。
- **图片**：凭内存 File 直接上传 S3（不依赖本地路径）→ ③ 正常。

---

## 7. console 埋点（接入 [insight-debugging.md](../../insight-debugging.md)）

| tag | 触发 | 字段 |
|---|---|---|
| `[octo:upload] image-upload failed` | 图片 change 即传失败（前端） | id / filename / err |
| `[octo:inject] lazy-upload ok` | ④ 插件按需上传成功（**server sidecar 落盘日志，非渲染 DevTools**） | localPath / url / ms / cacheSize |
| `[octo:inject] args rewritten` | ④ 文件名/路径→url 替换（server） | tool / knownRefs / uploaded / changed / before / after |

> 上传发生在 **sidecar（Node 进程）**，渲染进程 DevTools 的 Network **看不到**这个请求；查 sidecar 落盘日志（dev 模式为固定 `dev.log`）搜 `[octo:inject]`。

---

## 8. 验证

| # | 操作 | 期望 |
|---|---|---|
| 1 | 选 txt/md + 发自由消息（不调 MCP） | 无任何 S3 上传；模型能读到正文（① 内联）并作答 |
| 2 | 选 docx + 让模型读（不调 MCP） | 无 S3 上传；模型正确调 `extract_document(path)` 拿到正文（工具本体见 [SPEC-INS-016](insight-extract-document.md)） |
| 3 | 选 docx + 走预置 → 调 MCP | 工具执行前才上传（`dev.log` 见 `[octo:inject] lazy-upload ok`）；MCP 拿 url 正常出结果 |
| 4 | 同会话多次调同一文件 | 只上传一次（插件缓存命中） |
| 5 | 粘贴 / 选图片 | change 即传 S3；缩略图本地秒显；发送后多模态模型能"看"到图 |
| 6 | 上传服务不可用 + 调 MCP | 工具失败、错误回灌模型；不影响纯本地 ①②ad对话 |

---

## 9. 不做 / 依赖

- `extract_document`（office → 文本）本体 = [SPEC-INS-016](insight-extract-document.md)，独立实现（已落地）。本 spec 只负责接线（tool 注册 + gate 到 octo_insight + 提示词路由）。
- `@` 引用、二次生成、本地解析护栏 = 各自 spec。
- 图片接公网模型的 base64 回退 = provider 够不到 S3 时再做。
