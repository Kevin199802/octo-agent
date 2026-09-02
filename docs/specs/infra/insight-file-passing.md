# SPEC-INS-015 — Insight Agent 文件传参机制（上传 / 路由）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 infra/insight/agent
>
> **本 spec 是 insight 文件传参的实现层唯一真相源**：具体规则、格式、时机只在此处定义。[ADR-015](../../adr/015-file-passing-architecture.md)（为何按「文件类 × 用途」分流）、[ADR-014](../../adr/014-url-injection-via-plugin.md)（为何用占位替换、不让模型碰 URL）只保留**决策与理由**，引用本 spec，不复述规则。learning 笔记同理只引用。
>
> 依赖：[SPEC-INS-014](insight-worktree-layout.md)（源文件拷进 `insight/sources`，已实现）。
> 取代：原「MCP 文件按需上传 / lazy-upload」草案——那只是本 spec ④ 一支的时机细节，框窄了。
>
> **2026-09-02 修订（③ 图片去 S3）**：图片改走本地路径 + 服务端读盘转 base64，与 ①② 同链路导入 worktree（§1 路由表 ③ 行、§4、§6 已更新）。决策与理由见 [ADR-017](../../adr/017-insight-image-local-path-base64.md)（推翻 [ADR-015](../../adr/015-file-passing-architecture.md) 决策 2 在 insight 场景的适用，因 opencode server 是本机 sidecar）。实现 UXAI [PR #754](https://github.com/MyHeavenDyf/UXAI/pull/754) **已合入 dev**（`993e64bae`，2026-09-02），内网验证待做。

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
| ③ | 图片 | 模型**看** | `FilePart{ type:file, mime:image/*, url:file://… }` 走 vision，**服务端读盘转 base64 落库**（2026-09 去 S3，见 §4 / [ADR-017](../../adr/017-insight-image-local-path-base64.md)） | **否** | — （与 ①② 同链路导入 worktree） |
| ④ | 任意 | 喂 **MCP 工具** | 模型在工具参数里填**文件名** → 插件按需上传换 url（§3） | 是 | **调 MCP 工具那一刻** |

要点：

- **① 的判定是反向排除，不是正向白名单**（2026-08-20 修订）：上游 `read` 支持的是「任何非二进制文本」（[tool/read.ts](../../../packages/opencode/src/tool/read.ts) `isBinaryFile` = 二进制扩展名黑名单 + 内容嗅探），不是固定清单。客户端 `isTextInlineFile` 因此只排掉**有专门通道的**格式（②的 office/pdf、③的图片），其余一律交给服务端 `read` 判定。**好处**：上传格式放开（如 json / csv 进 `ALLOWED_EXT`）时无需再同步一次内联清单，判定口径与 opencode 原生一致。排除集之外若真是二进制（如 `@` 一个 .zip 产物），`read` 返回 `Cannot read binary file` 进上下文——响亮失败，不做客户端预判（嗅探要读文件字节，是服务端的活）。
  - ~~原 `TEXT_INLINE_EXT = {txt, md}`~~：正向白名单，恰好等于当时 `ALLOWED_EXT` 里的全部文本类，于是把「模型能读什么」和「附件栏允许传什么」两件无关的事耦合在了一起。
- **① 的来源含附件栏文件 + `@` 引用的会话文件**（2026-08-20，SPEC-INS-023 §7.2）：两个入口合并后传入同一入参，按 path 去重（同一文件既是本轮附件又被 `@` 引用时只内联一次）。`@` 的**图片**目前仍不走 ③，只在 `[引用文件]` 清单里给路径。**2026-09 注**：当初不走的理由是「vision 需要 S3 url，而 `@` 的本地图片没有」——③ 去 S3 后这条理由**已不成立**（新链路要的正是本地路径，`@` 的会话文件天然有）。接上去只是把 `@` 图片并进 `imageFiles` 分流，成本很低，**待办**（同时要一并适用 §4 的图片大小上限）。
- **载体各自独立、可叠加**：一个 docx 可同时被 ②（extract_document 读）和 ④（MCP 分析）使用，两条互不排斥。
- **图片只走 ③**：不进附件清单、不进 ④、不占内联预算。图片对"本地读正文 / 喂 MCP"无意义，模型只能"看"。**2026-09 修订**：图片的**导入链路**与 ①② 合流（同样导入 worktree 拿本地路径），但**载体仍然独立**——③ 产出 vision `FilePart{url:file://…}` 由服务端转 base64，不进 `[附件]` 清单，也不参与 SPEC-INS-032 的内联字节预算（否则一张照片就能触发整批文档的子代理分治）。
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

> **2026-09 改版（去 S3）**：决策与理由见 [ADR-017](../../adr/017-insight-image-local-path-base64.md)（推翻 ADR-015 决策 2 在 insight 场景的适用）。实现 UXAI [PR #754](https://github.com/MyHeavenDyf/UXAI/pull/754)。改版前的形态（change 即传 S3 → `FilePart{url:S3}`）保留在 ADR-015 决策 2 里作为回退方案。

- **导入而非上传**：选取 / 拖拽 / 粘贴当下与非图片附件**同链路**导入 worktree（`.octo/tmps/`，发送时 rename 进 `.octo/<sessionId>/uploads/`），拿本地绝对路径。无网络依赖，失败可重试。剪贴板粘贴的内存 blob（截图）拿不到源路径，走字节版 IPC（`write-file-to-worktree`）写进同一落点，落名清洗 / 撞名规则与 `copy-file-to-worktree` 同源。
- **缩略图**：`URL.createObjectURL(file)` 立刻渲染 `<img>`，本地秒显。发出后的气泡缩略图由服务端 part 事件（SSE）到达后渲染（本地 sidecar，延迟 <1s）——**不做 optimistic 镜像**：服务端落库的是 `data:` URL，与本地 `file://` 形态不同，按 url 去重会失效而画两张图。
- **发送**：产出 `FilePart{ type:"file", mime, url:"file://"+encodeFilePath(path), filename }`（编码与 ① txt/md 内联同源）。服务端 `prompt.ts` 的 `resolvePart` 走 `file:` 分支：非 `text/plain`、非目录 → **读盘转 `data:<mime>;base64,…` 落库**，这是 opencode 原生行为，**服务端零改动**。历史轮用落库的 `data:` URL，不依赖本地文件存活。非多模态模型由 `stripMedia` 自动换占位，不影响。
- **前提（必须显式记住）**：**opencode server 与客户端同机**（本机 sidecar，共享文件系统），服务端才读得到客户端写的路径。insight 的 ①②④ 本来就吃这个假设，故一致；但若 server 出现远程 / 多机部署形态，③ 会静默断（读不到文件）——届时按 ADR-015 决策 2 回退到 S3，不动本骨架。
- **图片大小上限 `INSIGHT_IMAGE_MAX = 5MB`**：base64 会落进 message part 存储、每轮历史带着走、前端还要拿 data: URL 当 `img src`，且多数 provider 单图 base64 有 ~5MB 量级硬上限——超限图**发送必失败且消息已落库**，之后每轮重发都撞墙。原 S3 链路存的是一个 url，没有这个约束，新链路下它是**必需的**。
  - **加在两个附件入口的调用点**（`addAttachments` / `addInsightFileToSession`），**不能加在 `validateFile` / `uploadFile` 这类与 make 页共用的函数里**——make 走 S3 无此约束，共用会误伤。判据：这个约束属于**载体**（base64 链路），不属于通用文件校验。
  - 超限的 UI 与各自入口的既有失败模式一致：附件栏入口走 error chip（`retriable:false`，重试同错）、文件管理「添加至会话区」走 toast + 不进附件栏；`UPLOAD_HINT` tooltip 一并标注。
  - **待内网确认的口径**：5MB 拦的是**原始文件字节**，送到 provider 的是 base64 后数据（×1.33）。若 provider 上限按 base64 后大小算（Anthropic 即此口径），4.9MB 的图仍会被拒；届时阈值降到 ≈3.7MB。
- **mime 必须按扩展名精确兜底**（`imageMimeFor` 查表）：粘贴 / 部分拖拽源的 `File.type` 为空，笼统给 `image/png` 会把 jpg/gif/webp 错标，落库成 `data:image/png;base64,<jpeg 字节>`——media_type 与实际字节不符，provider 侧可能解析失败或拒绝。
- **已知回退**：非桌面（web）形态无 Electron IPC → 图片附件不可用，标 error 且 `retriable:false`（环境性条件，重试必然同错）。判定可接受：insight 的产品形态是桌面端，web 仅 `__dev` 调试场景。
- **副作用**：服务端每张图会在 base64 part 之前插一条 synthetic text `Called the Read tool with the following input: {"filePath":"…"}`，把本地绝对路径带进模型上下文（UI 不渲染 synthetic）。原 S3 链路没有这条。

---

## 5. 与 MCP 的边界（纯消费，不改其契约）

| 动作 | 归属 | 是否动 MCP |
|---|---|---|
| 提交 / 查询 / resource_link 形态、工具入参契约 | MCP 团队 | **一行不改** |
| 何时上传、附件清单格式、文件名→url 替换 | 我们侧（自有上传服务 + 插件） | 否 |
| 图片改走 vision FilePart（2026-09 起 `file://` + 服务端 base64） | 我们侧 | 否（`DOC_EXT_RE` 本就不含图片扩展名，④ 行为不变） |

---

## 6. 降级（无 projectDir / 非桌面 / 内存 blob）

- **非图片**：拿不到真实本地路径 → `done` 但无 path → 不进附件清单 → 该文件 ②④ 均不可用（本地读 + MCP 都摸不到）。不报错（不破坏 `__dev`），打点 `localized:false`。生产桌面端 projectDir 恒在（INS-012），不出现；`__dev` 仅 UI 调试，忽略。
- **图片（2026-09 改版后）**：无 path = 发送时必然静默丢，故**响亮失败**——标 `error` + `retriable:false`（无 projectDir / 非桌面 / preload 未暴露 IPC 都是环境性条件，重试必然同错），文案引导改走文件选择器。改版前是「凭内存 File 直接上传 S3、不依赖本地路径」，故当时无此降级。
- **内存 blob 不再是降级路径**：剪贴板粘贴走字节版 IPC 落盘（§4），与本地选择的文件收敛到同一落点、同一套规则。

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
| 5 | 选 / 拖图片 | **无 S3 上传**；导入 `.octo/tmps/` 拿本地 path；缩略图本地秒显；发送后多模态模型能"看"到图 |
| 5b | **粘贴截图**（剪贴板内存 blob） | 走字节版 IPC 落 `.octo/tmps/`（与 #5 同落点同规则）；不再报「无法获取本地路径」 |
| 5c | **发送后历史轮回看** | 图片仍在（落库的是 `data:` URL）；**手工删掉 `.octo/<sid>/uploads/` 里那张图后重开会话，历史轮图片照常显示**（不依赖本地文件存活） |
| 5d | **上传服务不可用 + 只发图片** | 图片链路完全不受影响（无网络依赖）——这是 2026-09 改版的主要收益 |
| 5e | **超上限的大图** | 在附件栏就被拦下（error chip），**不进发送链路**；make 页上传同尺寸图片不受影响 |
| 6 | 上传服务不可用 + 调 MCP | 工具失败、错误回灌模型；不影响纯本地 ①②③ 对话 |

---

## 9. 不做 / 依赖

- `extract_document`（office → 文本）本体 = [SPEC-INS-016](insight-extract-document.md)，独立实现（已落地）。本 spec 只负责接线（tool 注册 + gate 到 octo_insight + 提示词路由）。
- `@` 引用、二次生成、本地解析护栏 = 各自 spec。
- 图片接公网模型的 base64 回退 = provider 够不到 S3 时再做。
