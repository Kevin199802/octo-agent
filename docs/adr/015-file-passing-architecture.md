# ADR-015: insight 文件传参架构 — 按「文件类 × 用途」分流

## 状态

已采纳（2026-06-29）· 已落地（SPEC-INS-015，UXAI PR #251）

> ⚠️ **2026-09-02：决策 2（图片走 S3 URL、不走 base64）已被 [ADR-017](017-insight-image-local-path-base64.md) 推翻**（限 insight 场景）。insight 图片改走本地路径 + 服务端读盘转 base64——因为 opencode server 是**本机 sidecar**，决策 2 列的主因「跨进程边界」在此形态下不成立。**本 ADR 的分流骨架（决策 1、决策 3）与 MCP 按需上传不变**，make 页图片仍走 S3。下方决策 2 全文保留作为决策依据与回退方案。

**2026-07-03 修订**：分支 ④（任意文件 → MCP 工具）的**触发方由模型隐式改为用户显式**（输入框 chip，见 [SPEC-INS-017](../specs/infra/insight-mcp-explicit-entry.md)）；MCP 工具（含未对接的 `search_reports`）退出模型常驻工具集。理由：弱模型隐式选工具的命中率风险整类消除、MCP 仪式段落退出常驻提示词、用户对排队知情。插件按需上传机制（文件名→URL 注入）**不变**。

> **本 ADR 只记「为什么这样分流」的决策与理由。具体规则 / 载体 / 时机 / 实现以 [SPEC-INS-015 文件传参机制](../specs/infra/insight-file-passing.md) 为唯一真相源**（避免两处漂移）。下方分流骨架保留作决策依据。
>
> 上游基线：opencode 原生 `FilePart`（`text/plain` 内联 / 二进制 base64，见 [prompt.ts:1103-1264](../../packages/opencode/src/session/prompt.ts#L1103)）。四分支落地情况见 spec。

---

## 背景

insight 让用户附带文件（docx/xlsx/pdf/图片/纯文本…），文件要么**给模型读**、要么**给工具用**。此前实现把所有文件一律「选文件即 S3 上传 → `[已上传文件]` handle 块」（见 [ADR-014](014-url-injection-via-plugin.md)、[file-upload.md](../specs/infra/file-upload.md)），这套只为 MCP/UXR 工具服务，却被当成唯一通道，导致：

- 发给本地模型的自由消息也触发 S3 上传（无意义、且上传服务不可用时阻断发送）；
- 把文件「喂模型」和「喂工具」两种本质不同的需求混为一谈。

调研 opencode 实际行为后（关键证据）：opencode 在**组 prompt 时就急切解析 `FilePart`**——
- `text/plain` 文件：服务端自动调 Read 工具读出内容、内联成 text（任何模型可读）；
- 二进制文件（office/图片）：**直接读字节转 `data:<mime>;base64,...`**（`prompt.ts:1257`），交 AI SDK；非多模态模型再被 `stripMedia` 换成 `[Attached …]` 占位符。

**推论**：原生 `FilePart` 是「把内容塞进模型上下文」的载体（模式 A/B），**不是**「给工具的引用」（模式 C）。三者必须分开设计。

---

## 业界基线（把文件喂给模型只有三种）

| 模式 | 做法 | 适用 |
|---|---|---|
| A 文本内联 | 读出文本拼成 text part | 任何模型 |
| B 多媒体 | base64 / 公网 URL / Files API `file_id` → 厂商 vision/document API | 仅多模态模型 |
| C 工具引用 | 文件放到工具够得着处，只给模型一个引用让它转交工具，模型不读内容 | RAG / MCP / agentic |

厂商均支持图片走 **URL**（服务器去拉）或 base64；**有存储后端的产品基本走 URL**，base64 是 opencode 这类无存储本地工具的默认。

---

## 决策

### 1. 按「文件类 × 用途」分流（核心）

| 文件类 / 用途 | 机制 | 是否上传 S3 | 时点 |
|---|---|---|---|
| 纯文本 / md / 代码 → 模型读 | 原生 `FilePart(file://sources/…, text/plain)` → 自动内联文本 | 否 | — |
| office（docx/xlsx/pdf）→ 模型读 | **本地路径引用（text）+ `extract_document` tool**（[Spec B]），模型按系统提示词在遇到支持格式时调该 tool；tool 未就绪时模型 fallback 写脚本读 | 否（本地） | — |
| 图片 → 多模态模型看 | `FilePart(url = S3 url)`（**不 base64**） | 是 | 发送时（图片是模型上下文，回合内必须就位） |
| 任意文件 → MCP/UXR 工具分析 | `handle` 块（[ADR-014]）→ 插件**按需上传**：模型调工具时才传 S3、path→url 换进 args。**2026-07-03 修订**：触发方改为用户显式（chip 单 turn 注入，[SPEC-INS-017]） | 是 | **工具调用时** |

### 2. 有存储后端 → 图片走 S3 URL，不走 base64

> **本条已被 [ADR-017](017-insight-image-local-path-base64.md) 推翻（2026-09-02，限 insight）**：下方「跨进程边界（主因）」在 insight 的实际形态下不成立——opencode server 是与客户端同机的本地 sidecar，客户端到 server 这一跳不需要第三方存储。全文保留：make 页仍照此执行，且它是 ADR-017 的回退方案。

我们有 S3 上传服务，图片用 `FilePart{url: S3 url}`，与 MCP 文件共用同一 S3。

**依据（2026-08-14 修正）**：本条原先的理由写的是「base64 会让 token 暴涨、任何上下文窗口都装不下」——**该理由是错的，已作废**。图片的 base64 走 vision 解码通道，在进 tokenizer 之前就被 decode 回字节，**不占上下文窗口**；同一张图用 URL 传和用 base64 传，进模型的 image token 数完全相同（只由分辨率决定）。详见 [learning/file-passing-to-models.md §2 关键澄清](../learning/file-passing-to-models.md)。

**结论不变**，但真实理由是工程侧的：

- **跨进程边界**（主因）：图片在 Electron 客户端手里，provider 在服务端，字节无论如何都要先搬到 provider 够得到的地方；
- 请求体不膨胀（×1.33）、发送方零内存占用（base64 峰值 ≈ 原图 ×4~5）；
- 请求体可留档复查，base64 的请求体日志现实中只能关掉。

**前提**：模型 provider 能访问该 S3 URL（内网模型↔内网 S3 通即可）。若将来接公网云模型够不到内网 S3，那条 case 退回 base64 / Files API——届时按 provider 能力分支，不改本分流骨架。**该退路在模型效果上无任何损失**，只是发送方要按 base64 重算内存与 body 上限。

> 「文档类绝不 base64 给模型」这条仍然成立，但原因同样不是超窗，而是**多模态通道不解码 docx/xlsx**（与体积无关），必须走抽文本（模式 A）或交工具（模式 C）。

> **落地（SPEC-INS-015）**：图片走 S3 URL（不 base64）已从「塞进 handle 块、模型看不到图」纠正为**vision `FilePart{url}`**——change 即传 S3、发送时作为图像随消息发给多模态模型。base64 仅存在于上游 chat（[prompt-input/attachments.ts](../../packages/app/octoapp/components/prompt-input/attachments.ts)），insight 不复用。细则见 [SPEC-INS-015 §4](../specs/infra/insight-file-passing.md)。

### 3. `FilePart` 与 `handle` 占位互相独立、各司其职

- `FilePart` = 模式 A/B（喂模型内容）。
- `handle` 块 = 模式 C（喂 MCP 工具的引用，防弱模型改坏 URL，见 [ADR-014]）。
- **不可用 `FilePart` 承载 MCP 的 S3 引用**：那会让 opencode 把文件 base64 灌进 prompt，而模型手里依然没有能传给工具的 URL。

---

## 后果

- **正面**：自由消息发本地模型不再无谓上传 / 阻断；文本文件零成本可读；图片省 base64 膨胀；MCP 上传下沉到真正需要的时刻。
- **代价 / 依赖**：
  - office「模型读」硬依赖 [Spec B] 的 `extract_document`（opencode 会先 base64，模型摸不到路径，故不能走 FilePart）；纯文本无此依赖。
  - MCP 按需上传需改 `octo-upload-inject` 插件（见 [ADR-014] 更新 + [MCP 按需上传 spec](../specs/infra/insight-file-passing.md)）。
  - 图片 S3 上传依赖 provider↔S3 可达。

---

## 关联

- [ADR-014](014-url-injection-via-plugin.md)（注入语义演进：handle→path→按需上传）
- [ADR-006](006-upload-architecture.md)（上传架构）、[ADR-009](009-no-office-preview.md)
- [SPEC-INS-014](../specs/infra/insight-worktree-layout.md)（本地工作目录地基 = sources/outputs）
- [MCP 文件按需上传 spec](../specs/infra/insight-file-passing.md)、[图片附件处理 spec](../specs/ui/insight-image-attachment.md)
- [SPEC-INS-016](../specs/infra/insight-extract-document.md)（Spec B：office→文本抽取，`extract_document` 工具本体）
- [SPEC-INS-017](../specs/infra/insight-mcp-explicit-entry.md)（分支 ④ 触发方修订：MCP 显式入口）
- [SPEC-INS-018](../specs/infra/insight-local-analysis-v1.md)（本地解析 v1：长上下文直喂，本地成为默认主路）
