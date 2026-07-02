# ADR-014: S3 URL 无损传递 MCP — handle + 插件注入

## 状态

已采纳（2026-06-09）· **已被 SPEC-INS-015 取代（2026-07，见下方「更新」）**

> 上游已实现：✗（opencode 无此能力；本 ADR 在 opencode 插件层自建，不改核心）

> **更新（2026-07）— handle 间接层已取消，机制以 spec 为准**
> 本 ADR 的核心洞见仍成立:**URL 只要经模型复述,弱模型就会抄坏 → 让模型永不碰 URL,代码层在工具执行前注入**。但**落地机制已演进、以 [SPEC-INS-015 文件传参机制](../specs/infra/insight-file-passing.md) 为唯一真相源**:
> - 上传时机:选文件即传 → **模型真调 MCP 工具时才按需上传**（自由消息零上传）。
> - 注入映射:不再用占位 `handle`——模型改完后**自始至终不接触 URL**（清单 `[附件]` 只给文件名/本地路径,URL 全程由插件生成注入),弱模型抄坏 URL 的根因直接消失。插件按**文件名或路径**匹配、换成 url。
> - 于是 ADR-014 的"`handle` token"这一层**不再需要、已删**。
>
> 下文为原始(送审时)handle 设计,**保留作决策历史**,具体规则以 spec 为准。

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

## 设计（纯 handle→URL 解析器）

插件**只做一件事**:把工具参数里出现的 handle 就地换成精确 URL。不按工具名分支、不碰字段名、不自作主张注入文件。

### 1. handle：从 URL 派生、全局唯一稳定

页面注入的 `[已上传文件]` 区块每行带一个 handle，token 由**文件 URL 派生**（`upload_` + FNV-1a 8 位 hex）：

```
[已上传文件]
- 任务书.docx [upload_9b94d620]: https://obs.../任务书.docx
- 逐字稿-张三.docx [upload_3a1c5f0e]: https://obs.../逐字稿-张三.docx
```

**为什么不用顺序号 `upload_1/2/…`**：顺序号是"按 turn"编的，用户分多轮上传时每个 turn 都从 1 重排 → 跨 turn 撞号（turn1 的 `upload_1`=任务书、turn2 的 `upload_1`=逐字稿），模型会误判"`upload_1` 被替换成别的文件"，对话层就崩（[实测 bug](#演进2026-06-10多轮上传修复)）。URL 派生 token：同一文件永远同一 handle，**跨 turn 不撞、刷新不变**（URL 含全局唯一的 S3 UUID 段）。

Prompt（[octo_insight](../../../UXAI/packages/opencode/src/agent/prompt/octo_insight.txt)）约束模型「文件参数只填 handle，**永不填 URL**」，并告知「多次上传会累积成多个区块、合起来才是全部文件，handle 固定不会被替换」。

### 2. 插件：聚合 session + 替换 handle（`octo-upload-inject`）

```
tool.execute.before(input, output):
  if output.args 里没有任何 handle 形态的串: return        # 非文件工具零开销放行
  # 聚合整个 session 所有 user 消息的 [已上传文件] 区块 → handle→url 总表
  map = {}; for 每条 user 消息的每个区块: map.update(parse(区块))
  if map 空: return
  replaceHandles(output.args, map)                          # 递归就地替换 args 里的 handle
```

两个输入源（关键）：

| 数据 | 来源 | 说明 |
|---|---|---|
| 权威 URL 总表（全部文件 handle→url） | **session 消息的 `[已上传文件]` 区块** | 字节级精确，**模型从不经手** |
| 要替换哪些 handle | **工具参数 args** | 只有模型挑中的那几个 handle |

url 原文的唯一来源是 session 注入文本，**不经过参数、更不经过模型生成** —— 这是"无损"的根。

### 工具分类只决定「模型怎么填参数」，不决定插件行为

入参见 [mcp-contract.md §工具入参](../specs/agents/mcp-contract.md)（UXR 2026-06-09 确认）。**插件对两类工具行为完全一致**（都只是 handle→url 替换）；分类只是给 prompt 指导模型往哪个参数填 handle：

| 类别 | 工具 | 模型怎么填 handle |
|---|---|---|
| 单桶 | `key_findings`、`mindmap` | 所有访谈稿 handle 进 `download_links` 列表 |
| 多角色 | `run_guide_analysis`、`run_usability_analysis` | 逐字稿 handle 进 `download_links`；大纲/任务书的单个 handle 进 `outline_file_path`（按文件名判断角色） |

### 为什么必须靠模型选文件（不能纯代码注入）

- **多角色工具**的「哪个是任务书 / 哪个是逐字稿」是语义判断，只有模型能从文件名做（否决了 UI 打标签，避免加用户负担）。
- **「这次调用用哪些文件」**也没法在代码里安全推断：多轮上传 / 一个 session 多次分析时，"全部已上传文件" ≠ "这次要用的文件"。早期版本的"单桶全量覆盖 download_links"正因此出过 bug（见下方演进）。

所以模型的显式选择是事实源；插件只把它要传的从"易碎 URL"换成"安全 handle"。模型本就在 loop 里（要调工具、挑文件），handle 没增加它的职责。

### 为什么不依赖字段名 / 工具名

纯 handle 替换递归遍历 args、**只认 handle 不认字段名**，所以 UXR 改字段名、或 MCP 工具 id 带 server 前缀（实测 `uxr-tool_key_findings`）都不影响。早期版本曾按工具名匹配 + 按字段名覆盖，踩过 server 前缀坑、又有字段名依赖；纯解析器把这两类依赖一并消除。

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

看 server 进程 console 的 `[octo:inject] args rewritten` 日志(字段:`changed` / `knownHandles` / `before` / `after`):

1. **单文件**:模型填 handle → `after` 里是精确 URL、`changed:true`。
2. **多文件单桶**(`key_findings` 多逐字稿):`download_links` 里每个 handle 都被换成 URL。
3. **多角色**(`run_usability_analysis`):`outline_file_path` 与 `download_links` 各自 handle 被换、角色未串。
4. **多轮上传**(任务书 turn1 + 逐字稿 turn2 → 工具 turn3):`knownHandles` ≥ 2、两 turn 的 handle 都解析成功(验证 session 聚合)。
5. **非文件工具**(`get_task_result`):无 `[octo:inject]` 日志(`hasHandle` 早退,不拉消息)。

---

## 演进（2026-06-10，多轮上传修复）

首版(2026-06-09)用「按工具名匹配 + 单桶全量覆盖 + 顺序号 handle + 只读最近一条区块」,内网验证暴露两类问题:

1. **顺序号 handle 跨 turn 撞号** → 用户分多轮上传(任务书一轮、逐字稿一轮)时 `upload_1` 被复用,模型误判文件被替换,对话层就崩。
2. **单桶全量覆盖**在多轮 / 多次分析场景会错注他轮文件。

改为本 ADR 现描述的设计:**URL 派生的全局唯一 handle + 插件聚合整个 session + 纯 handle 替换(去掉工具名匹配与字段覆盖)**。顺带消除了首版踩的 `uxr-tool_` 前缀坑与 `download_links` 字段名依赖。详见 learning [plugin-hooks-url-injection.md](../learning/plugin-hooks-url-injection.md)。
