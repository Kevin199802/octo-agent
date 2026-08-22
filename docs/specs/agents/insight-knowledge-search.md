# SPEC-INS-030 — Insight 吸收内网知识库问答 + chat 模块下线（chat → insight 合并）

> **上游已实现 ✗** —— octo 自加能力（chat 侧原生工具 `knowledge_search` 迁入 insight）。
>
> **与旧 spec 的关系（务必先读）**
> - 本 spec **supersede** [chat-knowledge-search.md](chat-knowledge-search.md)：旧 spec 的产品定位「chat 通用助手顺带能力」随 chat 下线而作废。
> - 旧 spec **仍是实现细节参考**：`getKnowledgeVector` 旧接口契约（§3）、检索整形逻辑（§5 `parseDocs`）、account 跨进程注入分析（§6）、影响面（§12）等**实现级内容照旧有效**，本 spec 不重抄，用到时点链接回看。
> - 一句话分工：**旧 spec = 工具怎么实现；本 spec = 合并怎么做 + 新接口 + 迁移 + 归属 insight 后的定位**。
>
> **相关 spec**：[SPEC-INS-025 question 工具答题 UI](../ui/insight-question-dock.md)（合并后知识库/内外网路由若要「问用户选库」用它）、[SPEC-INS-013 会话列表服务端分页](../ui/insight-session-list-pagination.md)（迁移涉及 `agent` 过滤）、[session-agent-attribution.md](../infra/session-agent-attribution.md)（会话 agent 归属字段）。

---

## 0. 结论锚点（交接用 · 2026-07-27）

产品决策：**chat 模块与 insight 合并，chat 下线**。经排查，chat 相对 insight 的**唯一独有能力**是内网知识库问答（`knowledge_search` 工具 + 引用渲染），其余全是共享的 session 基建。故合并 = 把这一能力迁入 insight，然后下掉 chat。

五个已拍板结论（对应讨论 Q1/Q2/Q3/Q4 + 迁移）：

| # | 结论 | 章节 |
|---|---|---|
| 合并范围 | `knowledge_search` 网关 `octo_ai`→`octo_insight`；insight **已有 bash/edit/todowrite/question**，无能力差；净增量 = 工具网关 + 引用 UI（在 insight-turn 重建）+ 提示词一段；chat 页面/路由下线 | §2 |
| 系统提示词 | 丢弃 `octo_ai.txt`（那是套用的编码 agent 模板，与"通用助手"错位）；只在 `octo_insight` 提示词补 `knowledge_search` 使用段；说清「问访谈材料 vs 问内网 wiki」两种问答的边界 | §3 |
| Q3 检索方案（2026-08-22 定） | **只查「全量库」**：切新接口 `queryKnowledge`、**不传 `knowledgeName`**，由 IT 在合并 15 模块的单一索引上统一 rerank；**不做多库路由 / 库描述 / 注册表 / 客户端重排** | §7 / §4.2 |
| account（限流必修） | account **确有按账号限流** → 生产必须传真实工号；来源 `localStorage.userInfo.account`、**纯工号、不拼名字**；机制走 `promptAsync` 的 `extra`（2026-08-12 定，非旧 spec 的 synthetic part） | §5 |
| 历史迁移 | 底线是**不报错 + 不丢原对话内容**；2026-08-12 定案：**不做读时合并，改由用户在设置里显式触发一次性迁移** | §6.1 → [SPEC-INS-031](../infra/insight-chat-session-migration.md) |

> **落地后的修订**（读上表时注意）：account 通道改 `extra`（§5，2026-08-12）；历史迁移推翻读时合并、改显式迁移（§6.1，2026-08-12）；旧接口不传库名的检索质量代价被核实为「顺序遍历、明显更差」（§4.1，2026-08-12）；**Q3 定案（2026-08-22）：IT 建出「全量库」后只查全量库、多库路由整套不做，推翻本 spec 早先「多库只能选定一库查一次」的结论（§4.3 / §7 / §10）**。

**执行拆分**：§3（提示词）、§5（account）**不依赖 Q3**，可拆独立小 PR 先落；合并主体（网关 + 引用 UI + 下线 chat）落地时新老接口都在（§4），先用旧接口跑通、Q3 定案后切新接口只查全量库（PR-D，§7 / §8）。

---

## 1. 背景：chat 到底有什么独有的

[chat.tsx](../../../UXAI/packages/app/octoapp/pages/chat.tsx) 本质是 `SessionPage` 的一层薄壳，session UI / 侧边栏 / 输入框全与其它模块共用。chat 独有的只有两块：

1. **`knowledge_search` 工具** —— [tool/knowledge_search.ts](../../../UXAI/packages/opencode/src/tool/knowledge_search.ts)，网关只给 `octo_ai`（[registry.ts](../../../UXAI/packages/opencode/src/tool/registry.ts) `input.agent.name === "octo_ai"`）。**注意：工具本身与 agent 无关，不是"chat 代码"，网关只是 registry 里一行。**
2. **引用渲染** —— [session/knowledge-references.tsx](../../../UXAI/packages/app/octoapp/pages/session/knowledge-references.tsx)（底部「引用 N 篇」折叠列表）+ 注入 `message-timeline`；行内 `[[n]](url)` 是 markdown 链接。

**关键差异（决定迁移成本）**：chat 走上游共享渲染器 `message-timeline`，insight 走**自己的 `insight-turn`**（不经过 message-timeline）。所以引用 UI 要在 insight-turn 侧**重建**，这是合并的主要工作量。

---

## 2. Q1：合并范围

**agent 能力已对齐，无需搬能力。** 排查 [agent.ts](../../../UXAI/packages/opencode/src/agent/agent.ts) 确认 `octo_insight` 现状：`bash: "allow"`（interview-analysis skill）、edit（2026-07-30 放开，编辑 md 交付物）、todowrite、`question: "allow"`（SPEC-INS-025）。故 octo_ai 的编码能力**无差可补**。

合并净增量（三项）：

1. **工具网关**：registry 里 `knowledge_search` 的网关从 `octo_ai` 改为 `octo_insight`（或并列）。硬隔离仍在，不泄漏到 make/studio/pattern。
2. **引用 UI**：在 insight-turn 重建「行内 `[n]` + 底部引用列表」；行内链接是原生 markdown、零 UI，底部列表要按 insight-turn 的 part 结构重接（数据仍来自工具 `metadata.sources`）。
3. **提示词**：见 §3。

下线项：chat 页面与路由（[chat.tsx](../../../UXAI/packages/app/octoapp/pages/chat.tsx) 及其入口/导航）；`octo_ai` agent 与 `octo_ai.txt` 的去留见 §3。

> **不做**：把 insight 对话区改造成原生 opencode 渲染器。insight 的核心价值 UI（卡片/artifact 嗅探、MCP 业务工具渲染、skill 用量、output renderers）都在 insight-turn 定制器里，换原生要么重叠一遍要么丢掉——是独立战略重构，不耦合进本次合并。仅记 TODO。

---

## 3. Q2：系统提示词

- **`octo_ai.txt` 是套用的 opencode/Claude Code 编码 agent 模板**（讲 bash/lint/typecheck/命令行渲染/NEVER commit），与"通用助手"定位错位。合并后知识库问答落在 `octo_insight`，**直接丢弃 `octo_ai.txt`，不搬**。
- 在 `octo_insight` 提示词补一段 `knowledge_search` 使用说明即可——现成的，从 [octo_ai.txt:10-19](../../../UXAI/packages/opencode/src/agent/prompt/octo_ai.txt#L10-L19) 搬：调用时机、只依据片段作答、`[[n]](链接)` 引用格式、保持分段、空结果如实告知。
- **不新写"你是通用助手"这种空话**：通用聊天是模型自带能力，不在 prompt 里声明（宁缺毋滥）。
- **歧义要说清**：`octo_insight` 的 description 里已列"知识问答"维度，但提示词里**没有对应内容**——那个"知识问答"目前指的是「问访谈材料」。补 `knowledge_search` 段时要把**「问访谈材料」（insight 本职）** vs **「问内网 wiki」（本工具）** 两种问答的边界说清，别让模型/用户混。

---

## 4. 接口契约：新老两套并存

后端确认**新老接口都活着**（2026-07-27）。合并可先落旧接口跑通，Q3 定案后切新接口。

### 4.1 旧接口（现工具代码在用）

见旧 spec [chat-knowledge-search.md §3](chat-knowledge-search.md)。要点：

- `POST {BASE_URL}/main/rest.root/ucdAgent/ucdAgent/getKnowledgeVector`
- Body：`{ "account": "<工号>", "context": "<用户问题>" }`（**无 knowledgeName**）
- 响应：嵌套 `data[].data[].chunk_list[]`，字段 `TOPIC_CONTENT` / `_score`(chunk 级数字) / `projectModuleName` / `url` / `unique_id`。解析逻辑见旧 spec §5（`parseDocs`：按 `unique_id` 去重 + chunk 数字 `_score` 降序 + top-k）。

> **⚠️ 检索质量代价（2026-08-12 与后端核实，修正此前"遍历全库"的表述）**：不传库名时后端**按顺序依次遍历**知识库，**效果明显更差**；且旧接口本身**不支持跨库合并重排**，实际只会命中其中一个库。
>
> 所以 PR-C 落地的这版（旧接口 + 不传库名）价值是**把链路跑通**（工具可见 / account 生效 / 引用可点 / UI 正确），**不等于"知识库问答可用"**。内网验证若出现"答非所问、该找到的没找到"，优先归因于此，不要当渲染或提示词的 bug 查。真正可用要等 PR-D 切新接口、走全量库（§4.2 / §7）。
>
> **别把两个"不传库名"混为一谈**：旧接口 `getKnowledgeVector` 不传库名 = 顺序遍历 + 拼接截断（就是本告警说的差行为）；新接口 `queryKnowledge` 不传库名 = 走 IT 的**全量库**（15 模块并成的单一索引 + 统一 rerank，2026-08-22 定案，§4.2）。二者同名不同物，PR-D 走的是后者。

### 4.2 新接口（切换目标；截图确认 2026-07-27，全量库定案 2026-08-22）

- Method：`POST`
- URL：`{OCTO_KB_BASE_URL}/main/rest.root/ucdAgent/thirdParty/queryKnowledge`（host 与旧接口同一个 `OCTO_KB_BASE_URL`，仅 path 不同：旧 `.../ucdAgent/ucdAgent/getKnowledgeVector` → 新 `.../ucdAgent/thirdParty/queryKnowledge`）
- Body（**我方实际只发两个字段**）：
  ```json
  { "question": "浅色模式", "account": "c60050492" }
  ```
  - `question`：用户问题（= 旧接口的 `context`）。
  - `account`：调用者工号（见 §5）。
  - `knowledgeName`（**可选，我方永不传**）：单个知识库名。**不传 = 走「全量库」**——IT 把一期 15 个模块库的数据并进的单一合并索引，在这一个索引上统一 rerank（后端已对"不传"做兼容，2026-08-22 确认）。Q3 定案只查全量库（§7），我方也没有库名可传，故**永远省略此字段**。
- 响应：**扁平 chunk 数组**（不再是旧接口的 `data[].data[].chunk_list[]` 嵌套）：
  ```json
  [
    {
      "documentId": "202d640f973bb5ea92561e3cc4d8b8e1",
      "chunkTitle": "移动端的高亮色的色值是什么？",
      "chunkContent": "移动端的高亮色分浅色和深色两个模式，浅色模式下的高亮色色值为#0A59F7；深色模式下的高亮色色值为#…",
      "documentUrl": "https://octo.hdesign.huawei.com/p/833223"
    }
  ]
  ```
  - **返回顺序即相关性降序**、无 `_score`（parse 直接按序用，不必自己排——排序已由服务端 rerank 承担）。
  - **条数**：当前后端固定返回 **5 条，且已按文档去重**（5 = 5 篇不同文档，2026-08-22 确认）。**topK 不做成请求参数、更不加进工具入参让模型定**——它是个该由数据决定的固定值，放后端即可；先用现状 5 验，若真实（尤其跨模块）问题验出「该找到的没落在这 5 篇里」，再请后台把固定值调高（约 8）重验。理由（模型无从可靠判断要几条 / 不加运维旋钮）见 §7。

### 4.3 新老接口差异（影响实现，切接口时必读）

| 维度 | 旧接口 | 新接口 |
|---|---|---|
| 库选择 | 可不传库名，但后端**按顺序依次遍历**、效果明显更差 | **不传 `knowledgeName` = 全量库**（IT 合并 15 模块的单一索引 + 统一 rerank）；我方永远省略此字段（§4.2 / §7） |
| 请求字段 | `{account, context}` | `{question, account}`（**不发 `knowledgeName`**） |
| 响应结构 | 嵌套 `data[].data[].chunk_list[]` | 扁平 `[{documentId, chunkTitle, chunkContent, documentUrl}]` |
| 打分 / 排序 | chunk 级数字 `_score`（同库内可排序，无绝对阈值） | **响应无 `_score`**；**返回顺序即相关性降序**（2026-08-12 确认） |
| 结果合并 / rerank | 客户端按 `_score` 排序取 top-k（`parseDocs`） | **服务端已做**（全量库统一 rerank）；客户端不再排序、不做跨库合并 |
| 条数 | 客户端 slice（旧 `TOP_K`） | 后端固定返回 5 条、**已按文档去重**（§4.2） |
| 标题 | `projectModuleName`（干净）；`TOPIC_TITLE` 不可用 | `chunkTitle` 看起来是干净标题（如「移动端的高亮色的色值是什么？」），可直接用 |
| 去重键 | `unique_id` | `documentId`（后端已去重；我方 parse 仍按 `documentId` 去重兜底） |

**实现提示**：切新接口 = 新写一套 parse（扁平数组、按 `documentId` 去重兜底、**按返回序直接用全部**、`chunkTitle` 作标题、`documentUrl` 作链接），不复用旧 `parseDocs`；旧 `TOP_K` / `_score` 排序一并弃用（排序已由服务端 rerank 承担）。`metadata.sources` 结构（`{n, id, title, url, ...}`）可沿用，只是字段来源变。

> **Q3 定案（2026-08-22）改写了这张表的结论**：早先此处写「两套接口都拿不到可跨库比较的分数 → 多库只能选定一库查一次、选择动作压在 agent 侧」，那是**没有全量库时**的判断。IT 建出全量库后，检索退化成「不传库名、查单一合并索引、服务端 rerank」，**多库路由整套不做**，agent 侧也不再承担选库。详见 §7。

---

## 5. Q4：account（限流必修）

**定性：生产必修。** account **确有按账号限流**。现状工具里 `ACCOUNT = ""` 常量、不传，后端兜底成开发者单一工号（截图里 `c60050492`）—— 规模化后**全体用户共用一个限流桶，一个人用满全员被限**，是真 bug。"现在能用"只是兜底的恰好是自己工号的开发态假象。

- **取值来源**：`localStorage.userInfo.account`，**纯工号、不拼名字**（后端只要工号；旧 spec §3.1 的"姓名 工号"格式作废）。
- **机制（2026-08-12 落地时定，与旧 spec 的设想不同）**：走 **`promptAsync` 的 `extra` 字段**，不注入 synthetic part。
  - 旧 spec §6 设计 synthetic part，是因为当时 `submit.ts` 不传 `extra`、`ctx.extra` 只是内部袋子；**SPEC-INS-029 之后这条管道已经通了**：`session/prompt.ts` 把 `input.extra` 按 sessionID 存进 `sessionExtras`，再原样铺进工具的 `ctx.extra`。
  - 相比 synthetic part：工号**不进模型上下文**、不污染会话、不必改 parts 组装（只在即时发送与排队 drain 两处各加一个字段）。
  - 落点：renderer [utils/account.ts](../../../UXAI/packages/app/octoapp/pages/insight/utils/account.ts) 读工号 → `extra.account` → 工具 `readAccount(ctx)`。
- **不接受后端静默兜底**（那是"启发式修补"）—— 拿不到工号要么显式失败要么明确降级，不靠隐式默认掩盖。
  - 已实现的行为：拿不到工号时**不发请求**，工具直接返回"未能获取当前登录账号，本次检索已取消，请如实告知用户重新登录"，并打 `[octo:kb] account missing`（renderer warn + server error 各一条）。
  - **外网自测**：外网无登录态 → 每次都会走这条拒答分支。要跑通链路，在 DevTools 执行 `localStorage.setItem("userInfo", JSON.stringify({ account: "c60050492" }))` 后重发。**不为此加 env 兜底旋钮**（env 只有 `OCTO_KB_BASE_URL` 一个）。
- **独立性**：account 注入动的是 insight 自己的发送路径（agent 无关的共享层只多带一个 extra 字段），**不依赖 Q3**，可拆独立小 PR；但与合并捆一起做省二次测试。

---

## 6. 历史迁移

**机制**：session 靠 `agent` 字段区分（chat = `octo_ai`，insight = `octo_insight`）。insight 列表走 [SPEC-INS-013](../ui/insight-session-list-pagination.md) 的 `/insight/sessions` 端点，**服务端按 `agent=octo_insight` 严格过滤再分页**（连 `agent IS NULL` 老数据都被过滤隐藏）。故 chat 历史（`octo_ai`）默认**不会**出现在 insight。

**目标（用户拍板）**：降级兼容即可，底线是 **不报错 + 不丢原对话内容**。

**渲染兼容评估**：insight-turn（[insight-turn.tsx](../../../UXAI/packages/app/octoapp/pages/insight/components/insight-turn.tsx)）非通用渲染器，会嗅探自由文本生成卡片，但对未知工具有 GenericTool 兜底（"调用了 `<tool>`"）。评估结论：
- 纯文本、bash/edit/read 工具调用 → 走 GenericTool 兜底渲染，**不丢内容**。
- 引用 `[[n]](url)` → 原生 markdown 链接，正常。底部「引用 N 篇」列表丢失（那是 message-timeline 注入），可接受降级。
- 残留：```html fence 仍被自由文本嗅探（路径 B，指 output-renderers 的嗅探路径，与本节的迁移路径 B 无关）做成预览卡（md 表格嗅探 2026-06 已移除）——但**渲成卡片不丢原文**，按底线可接受，**不加"外来会话朴素模式"特殊闸**。
- **底线验证（迁移功能落地前必做）**：拿一条真实 chat 会话在 insight-turn 下跑一遍，确认 GenericTool 兜底对 `octo_ai` 的 bash/edit part **不抛错**。该验证随 [SPEC-INS-031](../infra/insight-chat-session-migration.md) 一起做（迁移前 chat 历史在 insight 里根本打不开，无从验起）。
- **图片附件：本评估当年漏了这一类，2026-08-18 内网实测暴露并修复。** 现象是迁移过来的对话里每张图画两遍（2 张图显示成 4 个缩略图）。成因是**两层都在渲染同一批 FilePart**：insight-turn 自己那层不看 url 形态、两种都画；上游 `Message` 则只渲染 `attached()` 的 part，判据是 `url.startsWith("data:")`（`ui/components/message-file.ts`）。insight 自己发的图走 S3（`https`）命不中上游那条，两层长期相安无事；而 **chat 时代的图是内联 base64**（`data:` URL），迁进来后两层同时命中。
  修法：由 insight-turn 统一接管，并接上与上游同一个 `ImagePreview` 弹窗（点击可放大，交互与上游等价）；`octo-tokens.css` 压掉上游的 `[data-slot="user-message-attachment"][data-type="image"]`。**只压 image 这一支** —— `data-type="file"` 的非图片附件仍归上游渲染，因为 chat 数据里没有 insight 的 `[附件]` synthetic 清单，压过头会让那些文档附件彻底消失。验证条目见 [SPEC-INS-031 §6.1 V6.1](../infra/insight-chat-session-migration.md)。
- **教训**：这份评估当年只过了正文与工具调用，没有逐类 part 过一遍。判断「外来会话在 insight 下渲染是否兼容」，要按 part 类型逐个走（text / tool / file / resource_link），而不是只看正文能不能渲染出来 —— 附件类恰恰是两套实现最容易各写一遍的地方。

### 6.1 结论（2026-08-12 定案）：走显式迁移，不做读时合并

曾选「路径 B 读时合并」（列表过滤放宽为 `agent IN (octo_insight, octo_ai)`）并已实现，**落地后推翻**。原因是它**只解了一半**：

- chat 列表当年走的是 `session.list({ scope: "project" })`，服务端见到该 scope 就**把 `directory` 条件整个丢掉**（`session-category-query.ts`：`else if (input.scope !== "project")` 才加 directory），**跨目录全展示** —— 对产品和用户来说，chat 会话从来就是一堆放在一起的，「按目录分」这个概念在 chat 里不存在。
- 而 `listInsightSessions` 按 `directory` 严格过滤。放宽 agent 之后，chat 历史仍只在「当初创建它的那个目录」被选中时才可见 —— 半可见状态，比不可见更难解释。

**最终方案**：由用户在设置里**显式触发一次性迁移**（回填 `agent` + `directory` + `project_id`），迁完即为正常的 insight 会话，列表侧不需要任何特例。即路径 A 的加强版（多回填 directory / project_id，且由用户选目标目录、而非脚本静默改）。详见 **[SPEC-INS-031 chat 历史会话迁移](../infra/insight-chat-session-migration.md)**。

**目标态**：chat 历史在 insight 列表里不可见，要等迁移功能落地。当前处于测试阶段、未面向真实用户，**不设过渡态**（用户明确要求：功能齐了才给真实用户）。

> ⚠️ **实际状态（2026-08-13）**：[UXAI #634](https://github.com/MyHeavenDyf/UXAI/pull/634) 合入的是**撤销前**的版本（`a6b2581e5`；撤销版 `ba509cddf` 未被合入），故 **dev 上路径 B 仍在**，表现为「chat 历史在当初创建它的那个目录下可见」的半可见状态。撤销动作并入 [SPEC-INS-031](../infra/insight-chat-session-migration.md) §1.1 一起做（先撤后做会有一段"历史彻底不可见"的中间态，比现状更差）。

保留下来的一处兼容：`/:dir/chat/:id` 与 `/:dir/session/:id` 路由改为重定向到 `/insight/:id`（站内通知深链、fork、文件搜索跳转都还在生成 chat 链接，留重定向比删路由安全）。迁移完成后这些旧链接会自然落到正确的会话上。

> **新建会话永远是 `octo_insight`**：迁移只改存量，不改写入口径。

---

## 7. Q3 定案（2026-08-22）：只查全量库，不做多库路由

**结论：多库路由不做。所有问题只查「全量库」——不传 `knowledgeName`，由 IT 在合并索引上统一 rerank。** 之前设想的「按模块把问题路由到 15 个库之一」整套（库描述、意图识别、库注册表、粗路由 + 客户端重排）**全部不做**。

**为什么能这么定（前提变了）**：

- IT 侧已把一期 15 个模块库的数据**并进一个「全量库」**、在这一个索引上统一 rerank（2026-08-22 确认）。新接口 `queryKnowledge` **不传 `knowledgeName` 即默认走全量库**（后端已做兼容）。
- 这直接**推翻**了本 spec 早先（§4.3 / §10）「跨库无可比分 → 多库只能选定一库查一次、路由准确性全压在 agent 侧」的结论——那是**在没有全量库的前提下**写的。全量库存在后，检索退化成「一次调用、单一索引、服务端全局 rerank」：没有跨库比分、没有截断拼接、没有路由。
- 与**确定性原则**一致：排序 / rerank 交给有该能力的一方（IT），我方不碰跨库分数这类启发式；模型也不参与「选哪个库 / 要几条」这类它在看到结果前无从可靠判断的决策。

**明确不做**（连带关闭之前列的候选方向）：

- 不做 LLM 库路由 / 意图识别；不写 15 段库描述、不建库注册表 / `.example.md` 模板（这些都是「多库路由」的配套，路由不做即不需要）。
- 不做「粗路由选 1~3 库 + 客户端全局重排」（本就被"接口无跨库可比分"否掉，见 §4.3 历史；全量库出现后更无必要）。
- 不在客户端拼"总库"（IT 已在服务端并库 + rerank，我方无需重建、也不双维护）。
- 不把 topK 做成请求参数、不加进工具入参让模型定（§4.2）。

**内外网路由（内网库 vs 外网 web）不在本次范围**：本 spec 只处理内网知识库问答的迁入。若未来要加"内网 vs 外网"的取舍，另开题，此处不定；沿用"不默认拿这个问用户"的倾向即可。

> **实现落点**：见 §4.2（新接口契约）、§8 PR-D（工具改造）。工具 body 只发 `{ account, question }`、不发 `knowledgeName`；parse 按返回序直接用全部（服务端已去重 + rerank），旧 `parseDocs` / `TOP_K` / `_score` 排序弃用。

---

## 8. 执行拆分建议

| 批次 | 内容 | 依赖 Q3 | 状态 |
|---|---|---|---|
| PR-A | `octo_ai.txt` 弃用 + `octo_insight` 提示词补 `knowledge_search` 段（§3） | 否 | **已实现 2026-08-12**（`octo_ai` agent 保留、去掉 prompt 字段回落上游 provider 默认；`.txt`/`.md` 两份镜像同步） |
| PR-B | account 走 `extra` 传纯工号（§5） | 否 | **已实现 2026-08-12**（即时发送 + 排队 drain 两条路径；无工号显式拒答） |
| PR-C（合并主体） | 工具网关 `octo_ai`→`octo_insight` + insight-turn 引用 UI 重建 + chat 页面/路由下线（§2） | 否（先落旧接口） | **已实现 2026-08-12，待内网验证**（[UXAI #634](https://github.com/MyHeavenDyf/UXAI/pull/634)；历史迁移已从本批次移出，见下） |
| PR-E（历史迁移） | 设置里的「Chat 历史会话迁移」功能（§6.1） | 否 | 未开始 → **[SPEC-INS-031](../infra/insight-chat-session-migration.md)** |
| PR-D（Q3 后） | 切新接口 `queryKnowledge`（**不传 `knowledgeName` = 全量库**）+ 新写扁平数组 parse（`documentId` 去重兜底 / 按返回序用全部 / `chunkTitle`·`documentUrl` 映射）+ mock 同步新响应形态；弃用旧 `parseDocs`·`TOP_K`·`_score` 排序；**不做多库路由**（§4.2 / §7） | 是（Q3 已定 2026-08-22） | 未开始（additive） |

> PR-A/B 合并提了一个 PR（[UXAI #633](https://github.com/MyHeavenDyf/UXAI/pull/633)），PR-C 一个（#634），**两者必须一起合入**：#633 的提示词让模型知道何时调知识库，#634 才让 `octo_insight` 真正拿得到这个工具。

**PR-C 实际改动落点**（超出原列举的两处，记此备查）：
- chip turn 的 `buildToolGate` 追加 `knowledge_search: false` —— 与既有 `bash`/`webfetch` 同理：研究工具那轮只该直调所选 MCP 工具，知识库检索是弱模型在 MCP 缺失时的又一个"模拟通道"。
- chat 下线连带删除其渲染主体 `pages/session.tsx`（chat.tsx 只是它的薄壳）、`pages/chat/` 的 followup 排队 runner、以及 chat 侧引用 UI `pages/session/knowledge-references.tsx` 与 message-timeline 里的注入（insight 侧已重建，避免两份漂移）。`pages/session/**` 其余模块仍被 insight 引用，保留。
- 首屏 Welcome 页移除 Chat 介绍卡；顶栏 Tab 移除 Chat（`TabType` 仍保留 `"chat"` 字面量，兜住重定向落地前的路径判定）。

---

## 9. 验收标准

- [ ] insight（octo_insight）下提内网相关问题，模型能调 `knowledge_search` 并基于片段作答。
- [ ] 引用 `[[n]](url)` 在 insight-turn 下可点；底部引用列表（若重建）数据来自 `metadata.sources`。
- [ ] account 传真实登录工号（`localStorage.userInfo.account`，纯工号），非开发者兜底；拿不到时行为明确（失败或降级，非静默）。
- [ ] chat 页面/路由已下线，入口不可达。
- [ ] chat 历史在 insight 下打开：不报错、原对话内容不丢（底线验证通过）。
- [ ] `knowledge_search` 网关仅 `octo_insight`，未泄漏到 make/studio/pattern。
- [ ] （切新接口后）请求 body 只含 `{account, question}`、**不含 `knowledgeName`**（走全量库，§4.2 / §7）。
- [ ] （切新接口后）新 parse 正确处理扁平数组、按 `documentId` 去重兜底、按返回序用全部、`chunkTitle`/`documentUrl` 正确映射。

---

## 9.1 验证

> PR-A/B/C 一起验（三者拆 PR 只为评审粒度，**合入与打包验证是同一次**）。`[octo:kb]` 日志释义见 [insight-debugging.md](../../insight-debugging.md)。

### 9.1.1 外网可复现（本地 mock，不需要内网）

前置：
1. 起 KB mock：`bun run packages/opencode/script/kb-mock-server.ts`（默认 `:8787`，fixture 结构对齐真实返回）。
2. 起 server：`OCTO_KB_BASE_URL=http://localhost:8787 bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>`。
   （**改了 prompt / registry / 路由必须重起进程**，否则看到的是旧行为。）
3. 前端起 insight 会话；DevTools 执行 `localStorage.setItem("userInfo", JSON.stringify({ account: "c60050492" }))` 模拟登录态。

| # | 场景 | 步骤 | 通过判据 |
|---|---|---|---|
| V1 | 工具可见且会被调用 | insight 里问「内网怎么申请访谈酬金」 | server 日志出现 `[octo:kb] config` + `response` + `parsed`；模型基于片段作答 |
| V2 | account 真的传出去了 | 同 V1，看 `[octo:kb] config` 的 `account` 字段 | 等于 localStorage 里那个工号，**不是空串** |
| V3 | **无工号显式拒答**（§5 底线） | DevTools 执行 `localStorage.removeItem("userInfo")` 后重发 V1 的问题 | 客户端一条 `[octo:kb] account missing`（每次加载只打一次）；server 一条同名 error；**不发出 HTTP 请求**（mock 侧无新请求）；模型如实说需重新登录，不编答案 |
| V4 | 行内引用可点 | V1 的回答里点 `[1]` 角标 | 系统浏览器打开该来源 URL（不在 Electron 内导航） |
| V5 | 底部引用列表 | 看回答下方 | 出现「引用 N 篇资料作为参考」，展开后条目数/标题/顺序与 `[octo:kb] parsed` 的 `titles` 一致，点击外跳 |
| V6 | 空结果不编造 | 问一个 fixture 里必然没有的词 | 回复「内网知识库未找到相关内容」，无引用列表 |
| V7 | **边界不混**（§3 歧义） | 上传一份访谈 txt，问「我这份材料里用户提到了什么问题」 | 走 `extract_document`/读材料，**不出现** `[octo:kb]` 日志 |
| V8 | 网关未泄漏 | 在 Design / Prototype / Studio 各问一次内网问题 | 无 `[octo:kb]` 日志；模型不声称有知识库工具 |
| V9 | chip turn 不放行 | 输入框选「研究工具」，那一轮问内网问题 | 无 `[octo:kb]` 日志（`buildToolGate` 关掉了它） |
| V10 | chat 入口不可达 | 顶栏、Welcome 首屏 | 无 Chat tab、无 Chat 介绍卡 |
| V11 | 旧链接优雅落地 | 地址栏依次访问 `/<dir>/chat`、`/<dir>/chat/<某会话id>`、`/<dir>/session/<某会话id>`、`/<dir>` | 分别跳到 `/insight`、`/insight/<id>`、`/insight/<id>`、`/insight`；不出 404、不白屏 |
| V12 | 排队发送同样带工号 | 会话 busy 时再发一条（进排队），等它 drain 后问内网问题 | 该轮 `[octo:kb] config` 的 `account` 仍是真实工号（覆盖 `queue-drain` 那条路径） |
| V13 | 单测 | `bun test ./octoapp/pages/insight/components/knowledge-references.test.ts`（cwd=`packages/app`） | 全过。注：`packages/app` 的 `bunfig.toml` 限定 `root=./src`，octoapp 用例**默认 `bun test` 跑不到**，须显式给路径 |

### 9.1.2 内网验证（真实 KB，外网无法覆盖）

| # | 场景 | 通过判据 |
|---|---|---|
| N1 | 真实 KB 通路 | `.env.<channel>` 设对 `OCTO_KB_BASE_URL` 后打包；`[octo:kb] config` 的 `url` 与 Insomnia 能跑通的地址逐字一致，`usingMockDefault:false`；能基于真实片段作答 |
| N2 | **限流按人头分桶**（§5 的目的） | `[octo:kb] config` 的 `account` = 当前登录者工号；换一个账号登录后该字段随之变化（不再是开发者那个兜底工号） |
| N3 | chat 历史不可见（**预期**） | insight 列表里查不到 chat 老会话 —— §6.1 已定不做读时合并。**测试同学不要当缺陷报**；chat 历史的可见性与「底线验证」（真实 chat 会话在 insight-turn 下不报错、不丢内容）一并挪到 [SPEC-INS-031](../infra/insight-chat-session-migration.md) 验 |
| N5 | 弱模型引用格式 | 内网模型（GLM 等）连问 5 个内网问题，统计 `[[n]](url)` 格式正确率与排版是否被挤成一段；明显跑偏则回 §3 调提示词，不改渲染 |
| N6 | **全量库召回充分性**（§4.2 / §7） | 拿一批真实问题（**含跨模块**）在全量库上问；该找到的文档落在返回的 5 篇内 → 充分。反复出现「该找到的没落在这 5 篇」→ 请后台把固定条数调高（约 8）重验，不在客户端补路由/重排 |

---

## 10. 待确认清单

1. ~~新接口 URL path~~ **已确认（2026-07-27）**：`{OCTO_KB_BASE_URL}/main/rest.root/ucdAgent/thirdParty/queryKnowledge`，host 与旧接口同源（§4.2）。
2. ~~新接口响应排序 / 跨库分数 / 多库路由~~ **已确认并定案（排序 2026-08-12 → 全量库 2026-08-22）**：新接口**返回顺序即相关性降序**（parse 直接按序用，不必自己排）。早先「跨库无可比分 → 多库只能选定一库查一次」的结论**已被全量库推翻**：IT 已把 15 模块库并成单一合并索引 + 统一 rerank，**不传 `knowledgeName` 即走全量库**；Q3 定案只查全量库、不做多库路由（§7 / §4.2）。**「库清单从哪来」这个曾经的剩余确认项随之作废**（不做路由即不需要库清单/描述）。返回条数当前固定 5、已按文档去重；是否够用走 N6 验（§9.1.2）。
3. ~~历史迁移路径 A/B~~ **已定（2026-08-12）**：**推翻 B（读时合并），改走用户显式触发的一次性迁移**（路径 A 加强版），理由与落点见 §6.1，方案见 [SPEC-INS-031](../infra/insight-chat-session-migration.md)。
4. ~~`octo_ai` agent 去留~~ **已定（2026-08-12）**：**保留 agent 注册，只丢 prompt**。理由：它同时是 `build` 的向后兼容目标（agent.ts 两处映射）、TUI 默认 agent、`plan.ts` 的退出目标，且上游 `packages/ui/message-part.tsx` 有两处 `agent === 'octo_ai'` 判断（本仓约定不动上游）。去掉 `prompt` 字段后由 `session/llm.ts` 回落 `SystemPrompt.provider`，正是上游 build agent 的原始行为。
