# ADR-014: S3 URL 无损传递 MCP — handle + 插件注入

## 状态

已采纳（2026-06-09）

> 上游已实现：✗（opencode 无此能力；本 ADR 在 opencode 插件层自建，不改核心）

---

## 背景

insight 当前链路（[file-upload.md](../specs/infra/file-upload.md)）：页面上传文件拿到明文 S3 URL → 以 `[已上传文件]` synthetic text part 注入 session → LLM 从该区块读出 URL → 调 MCP 业务工具（`key_findings` 等）时把 URL 填进文件参数。

**问题**：URL 经过模型**两次**——一次作为输入（context），一次作为**输出**（模型把 URL 字符串重新生成进 tool-call 参数）。内网弱模型在复刻 `%E4%B8%AD` 这类转码字符 / 特殊符号时会"微调"，导致 MCP 收到的 URL 失真、404 取不到文件。

根因：**只要 URL 字符串要由模型生成，弱模型就有概率改坏它。**

---

## 方案对照

网页端讨论给出三个方向：

| 方案 | 本质 | 评价 |
|---|---|---|
| **A 工具链直传** | URL 存 tool_context，模型只见 `{file_ref}`，下游解析回 URL | 方向对，但需要某处做 ref→URL 解析（MCP 改合同 or opencode 介入） |
| **B Prompt 锁定** | system prompt 要求"原样传递" + regex 校验 | ❌ 治标：会改转码字符的弱模型同样不会可靠遵守"逐字复制"；regex 只能拒绝→重试，不产生正确值 |
| **C 代码层注入** | 模型只输出占位符，代码层把真 URL 填进 tool_call 参数 | ✅ 架构最干净，模型彻底不碰 URL 字符串 |

**采纳 C 的变体（用 A 的 handle 思路落在插件钩子上）。**

---

## 关键落点：`tool.execute.before` 插件钩子

opencode 在工具执行前触发 `tool.execute.before` 钩子（[`packages/plugin/src/index.ts`](../../../UXAI/packages/plugin/src/index.ts) 定义；MCP 工具路径在 [`packages/opencode/src/session/prompt.ts`](../../../UXAI/packages/opencode/src/session/prompt.ts) 触发，**就在交给 MCP server 之前**）。该钩子：

- 入参 `{ tool, sessionID, callID }`，出参 `{ args }`，**插件可就地改写 args**（trigger 传同一对象引用、不克隆；改写后的 args 即被传给 MCP `execute`）。
- 插件初始化时拿到完整 SDK `client`，可 `client.session.messages` 读 session 消息。

这是个**插件**，不是改 opencode 核心 tool 管道。注册方式：加进 `packages/opencode/src/plugin/index.ts` 的 `INTERNAL_PLUGINS`（与 Codex/Copilot 等内置插件同级）。

---

## 设计

### 1. handle 取代 URL，模型只搬 handle

页面注入的 `[已上传文件]` 区块每行带稳定 handle（按序，从 1 起）：

```
[已上传文件]
- 任务书.docx [upload_1]: https://obs.../任务书.docx
- 逐字稿-张三.docx [upload_2]: https://obs.../逐字稿-张三.docx
```

Prompt（[octo_insight](../../../UXAI/packages/opencode/src/agent/prompt/octo_insight.txt)）约束模型「文件参数只填 handle（`upload_N`），**永不填 URL**」。`upload_1` 这种短串弱模型几乎不会改错，即便改错也只影响角色映射、不会产出坏 URL。

### 2. 插件做两件事（`octo-upload-inject`）

钩子里，从最近一条带 `[已上传文件]` 区块的 user 消息解析出权威 `{handle, filename, url}`（这份 URL 存在 server message store、**模型从不改写 → 字节级精确**），然后：

1. **handle 替换（与字段名无关）**：递归遍历 args，把任意 `upload_N` 就地换成精确 URL。多角色工具（`run_guide_analysis` / `run_usability_analysis`，`download_links` 列表 + `outline_file_path` 单值分属不同字段）的角色映射靠这条——角色归属由模型按文件名判断，插件只换串。
2. **单桶工具完整性保险**：把全量 URL 覆盖进 `download_links`，防弱模型漏列某个 handle。**仅对单桶工具**（`key_findings` / `mindmap`，全部上传都是访谈稿）；多角色工具不做覆盖（因为其中一个文件属 `outline_file_path`，谁是大纲/任务书要靠模型判断）。

### 工具分类（入参见 [mcp-contract.md §工具入参](../specs/agents/mcp-contract.md)，UXR 2026-06-09 确认）

| 类别 | 工具 | 文件参数 | 插件行为 |
|---|---|---|---|
| 单桶 | `key_findings`、`mindmap` | `download_links: List[str]` | handle 替换 + 全量覆盖 `download_links` |
| 多角色 | `run_guide_analysis`、`run_usability_analysis` | `download_links: List[str]` + `outline_file_path: str` | 仅 handle 替换（角色映射归模型） |

### 为什么 handle 替换是主路径（不依赖字段名）

ADR-012 把 `analyze_interview` 拆成 per-capability 工具后，**新工具的输入参数名定义在 UXR 的 MCP server 里**（现确认为 `download_links` / `outline_file_path`，早期 `doc_urls` 已废）。递归 handle 替换对字段名不敏感，UXR 改名也不受影响，是主路径；单桶的字段名覆盖只是附加完整性保险，字段名错了改一处常量即可（看 `[octo:inject]` 日志 + MCP 报错核对）。

---

## 取舍

- **不选纯 B（prompt-only）**：弱模型不可靠，治标。
- **不选改 MCP 合同收 `file_ref`**：跨 UXR 团队，协议破坏；插件方案让 MCP 仍收 `url` 字段，UXR 零改动。
- **不选 UI 角色标（让用户上传时标"任务书/逐字稿"）**：对用户有额外交互成本；多角色工具的角色映射交给模型出 handle 即可，模型不碰 URL 仍达成无损。后续若多角色场景增多再评估。
- **不改 opencode 核心 tool 管道**：用既有 `tool.execute.before` 插件钩子，符合"不动上游核心"约束。

---

## 影响面

| 改动 | 文件 |
|---|---|
| 新增插件 | `packages/opencode/src/agent/octo-upload-inject.ts` |
| 注册插件（接线） | `packages/opencode/src/plugin/index.ts`（`INTERNAL_PLUGINS` +1） |
| 注入格式加 handle | `packages/app/octoapp/pages/insight/lib/upload.ts`（`formatUploadsForPrompt` / `parseUploadedFiles`） |
| Prompt 改用 handle | `packages/opencode/src/agent/prompt/octo_insight.{txt,md}` |

> `octo-upload-inject.ts` 与 `plugin/index.ts` 的一行 import 属上游接线壳改动，登记 [architecture.md §5.4]。

---

## 联调验证

1. 内网弱模型复现"URL 被微调"的 case，确认 MCP 收到的是插件注入的精确 URL。
2. 看 `[octo:inject] args rewritten` 日志的 `before` / `after`：`before` 是模型填的（含 handle 或被改坏的 URL），`after` 应是精确 URL；`urlField` 核对是否命中 MCP 真实字段名。
3. 单桶工具（`key_findings`）传多文件，确认 `after` 的 URL 字段含全部文件、无遗漏。
4. 多角色工具（`run_usability_analysis`）确认任务书 / 逐字稿各自字段的 handle 被正确替换、角色未串。
