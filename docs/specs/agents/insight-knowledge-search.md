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

四个已拍板结论（对应讨论 Q1/Q2/Q4 + 迁移，Q3 见 §7）：

| # | 结论 | 章节 |
|---|---|---|
| 合并范围 | `knowledge_search` 网关 `octo_ai`→`octo_insight`；insight **已有 bash/edit/todowrite/question**，无能力差；净增量 = 工具网关 + 引用 UI（在 insight-turn 重建）+ 提示词一段；chat 页面/路由下线 | §2 |
| 系统提示词 | 丢弃 `octo_ai.txt`（那是套用的编码 agent 模板，与"通用助手"错位）；只在 `octo_insight` 提示词补 `knowledge_search` 使用段；说清「问访谈材料 vs 问内网 wiki」两种问答的边界 | §3 |
| account（限流必修） | account **确有按账号限流** → 生产必须传真实工号；来源 `localStorage.userInfo.account`、**纯工号、不拼名字**；机制走请求/session 注入（旧 spec §6） | §5 |
| 历史迁移 | 降级兼容即可：**不报错 + 不丢原对话内容**为底线；insight-turn 的卡片嗅探非破坏性（不丢原文），不加特殊闸 | §6 |

**执行拆分**：§3（提示词）、§5（account）**不依赖 Q3**，可拆独立小 PR 先落；合并主体（网关 + 引用 UI + 下线 chat）落地时新老接口都在（§4），可先用旧接口跑通、Q3 定案后再切多库路由。

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
- Body：`{ "account": "<工号>", "context": "<用户问题>" }`（**无 knowledgeName**，后端遍历全库、受上下文截断）
- 响应：嵌套 `data[].data[].chunk_list[]`，字段 `TOPIC_CONTENT` / `_score`(chunk 级数字) / `projectModuleName` / `url` / `unique_id`。解析逻辑见旧 spec §5（`parseDocs`：按 `unique_id` 去重 + chunk 数字 `_score` 降序 + top-k）。

### 4.2 新接口（多库，Q3 路由用；截图确认 2026-07-27）

- Method：`POST`
- URL：`{OCTO_KB_BASE_URL}/main/rest.root/ucdAgent/thirdParty/queryKnowledge`（host 与旧接口同一个 `OCTO_KB_BASE_URL`，仅 path 不同：旧 `.../ucdAgent/ucdAgent/getKnowledgeVector` → 新 `.../ucdAgent/thirdParty/queryKnowledge`）
- Body：
  ```json
  { "knowledgeName": "HDESIGN", "question": "浅色模式", "account": "c60050492" }
  ```
  - `knowledgeName`：**单个知识库名**（必传；一次调用只查一个库）。一期共 1 套知识源、按 15 个模块拆成 15 个库。
  - `question`：用户问题（= 旧接口的 `context`）。
  - `account`：调用者工号（见 §5）。
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

### 4.3 新老接口差异（影响实现，切接口时必读）

| 维度 | 旧接口 | 新接口 |
|---|---|---|
| 库选择 | 不传库名，后端遍历全库（**有截断风险**：每库 top-k 拼接超上下文后截断，靠后的库可能没查到） | 必传 `knowledgeName`，**单库/次** |
| 请求字段 | `{account, context}` | `{knowledgeName, question, account}` |
| 响应结构 | 嵌套 `data[].data[].chunk_list[]` | 扁平 `[{documentId, chunkTitle, chunkContent, documentUrl}]` |
| 打分 | chunk 级数字 `_score`（可排序，无绝对阈值） | **响应无 `_score`** → 目前只能信后端返回顺序（相关性降序假设，**待确认**）；跨库合并重排需要分数，**是 Q3 要跟后端确认的点** |
| 标题 | `projectModuleName`（干净）；`TOPIC_TITLE` 不可用 | `chunkTitle` 看起来是干净标题（如「移动端的高亮色的色值是什么？」），可直接用 |
| 去重键 | `unique_id` | `documentId`（同一文档可能多 chunk，仍需去重） |

**实现提示**：切新接口 = 新写一套 parse（扁平数组、按 `documentId` 去重、无分数则按返回序 slice top-k、`chunkTitle` 作标题、`documentUrl` 作链接），不复用旧 `parseDocs`。`metadata.sources` 结构（`{n, id, title, url, ...}`）可沿用，只是字段来源变。

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
- 残留：```html fence 仍被路径 B 嗅探成预览卡（md 表格嗅探 2026-06 已移除）——但**渲成卡片不丢原文**，按底线可接受，**不加"外来会话朴素模式"特殊闸**。
- **底线验证（落地前必做）**：拿一条真实 chat 会话在 insight-turn 下跑一遍，确认 GenericTool 兜底对 `octo_ai` 的 bash/edit part **不抛错**。

**两条实现路径（二选一，落地时定）**：

| 路径 | 做法 | 取舍 |
|---|---|---|
| A 数据迁移 | 回填 chat 会话 `agent` 字段 `octo_ai`→`octo_insight` | 终态干净；偏不可逆 |
| **B 读时合并（已选，2026-08-12）** | insight 列表过滤放宽为 `agent IN (octo_insight, octo_ai)` | 不写数据、可回退；把两个 agent 身份带进未来 |

> 决策因子：chat 真实历史量 + 是否需回看。两路的**渲染兼容工作量相同**（都靠上面的底线验证）。

**B 的落地点（三处同源）**：
- 权威过滤：`session/session-insight-query.ts` 的 `LISTED_AGENTS`（改回单值即回退）。
- 前端回退分支（端点未部署时才走）：`constants/agent.ts` 的 `INSIGHT_LISTED_AGENTS`，被 `_shell/sidebar.tsx` 与 `insight/components/session-list` 共用。
- 旧链接落地：`/:dir/chat/:id` 与 `/:dir/session/:id` 路由改为重定向到 `/insight/:id`（站内通知深链、fork、文件搜索跳转都还在生成 chat 链接，留重定向比删路由安全）。

> **新建会话仍一律 `octo_insight`**：B 只放宽"看得见什么"，不放宽"写成什么"。

---

## 7. Q3 边界（本 spec 不定，另开对话/spec）

**多库路由与内外网路由属 Q3，已在独立对话推进，本 spec 不下结论。** 仅在此标清边界，避免与合并混：

- **两条路由轴**：① 内网 15 个库里选哪个（多库路由）；② 内网库 vs 外网 web（内外网路由）。两者都倾向「让 agent 判 / 确定性回退」，**不默认问用户**。
- **不做**：不把「内网 vs 外网」默认做成 question 问用户（用户往往正因不知答案在哪才来问）；不拼"总库"（双维护、且没真正解决截断）。
- **候选方向（待 Q3 定）**：agentic 工具选择（both tools + 强描述）/ 内网优先+回退 / 粗路由选 1~3 库 + 我方全局重排。依赖后端能力确认（能否多 knowledgeName、库清单是否走数据接口、跨库 `_score` 可比性）。
- **知识库描述**：作为数据（`.example.md` 模板 / 库注册表），不焊进 prompt 散文；结构模板草稿已在 Q3 对话，含"不包含/边界"+"典型问题示例"两栏（路由信号最强）。
- **合并不被 Q3 卡住**：新老接口都在，合并先用旧接口（或单默认库）跑通链路，Q3 定案后叠加多库路由（additive）。

---

## 8. 执行拆分建议

| 批次 | 内容 | 依赖 Q3 | 状态 |
|---|---|---|---|
| PR-A | `octo_ai.txt` 弃用 + `octo_insight` 提示词补 `knowledge_search` 段（§3） | 否 | **已实现 2026-08-12**（`octo_ai` agent 保留、去掉 prompt 字段回落上游 provider 默认；`.txt`/`.md` 两份镜像同步） |
| PR-B | account 走 `extra` 传纯工号（§5） | 否 | **已实现 2026-08-12**（即时发送 + 排队 drain 两条路径；无工号显式拒答） |
| PR-C（合并主体） | 工具网关 `octo_ai`→`octo_insight` + insight-turn 引用 UI 重建 + chat 页面/路由下线（§2）+ 历史迁移（§6） | 否（先落旧接口） | **已实现 2026-08-12，待内网验证**（底线验证见 §6，须在内网拿真实 chat 会话跑一遍） |
| PR-D（Q3 后） | 切新接口 + 多库路由 + 内外网路由（§4.2 / §7） | 是 | 未开始（additive） |

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
- [ ] （切新接口后）新 parse 正确处理扁平数组、按 `documentId` 去重、`chunkTitle`/`documentUrl` 正确映射。

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

### 9.1.2 内网验证（真实 KB + 真实历史，外网无法覆盖）

| # | 场景 | 通过判据 |
|---|---|---|
| N1 | 真实 KB 通路 | `.env.<channel>` 设对 `OCTO_KB_BASE_URL` 后打包；`[octo:kb] config` 的 `url` 与 Insomnia 能跑通的地址逐字一致，`usingMockDefault:false`；能基于真实片段作答 |
| N2 | **限流按人头分桶**（§5 的目的） | `[octo:kb] config` 的 `account` = 当前登录者工号；换一个账号登录后该字段随之变化（不再是开发者那个兜底工号） |
| N3 | **底线验证**（§6，必做） | 找一条**真实 chat 历史会话**（agent=`octo_ai`，含 bash/edit/write 调用）在 insight 侧列表里打开：不报错、不白屏、原对话文本一字不丢；工具调用走兜底渲染（"调用了 xxx"）。底部引用列表丢失属可接受降级 |
| N3.1 | 外来会话可继续对话 | 在 N3 那条会话里再发一条消息：正常回复（该会话 agent 仍是 `octo_ai`，故**不会**有 knowledge_search——这是预期，不是 bug；新对话请在新建会话里验） |
| N4 | 列表口径 | insight 会话列表同时出现历史 chat 会话与 insight 会话，按更新时间倒序；「加载更多」计数正确；**新建的会话 agent 仍是 `octo_insight`** |
| N5 | 弱模型引用格式 | 内网模型（GLM 等）连问 5 个内网问题，统计 `[[n]](url)` 格式正确率与排版是否被挤成一段；明显跑偏则回 §3 调提示词，不改渲染 |

---

## 10. 待确认清单

1. ~~新接口 URL path~~ **已确认（2026-07-27）**：`{OCTO_KB_BASE_URL}/main/rest.root/ucdAgent/thirdParty/queryKnowledge`，host 与旧接口同源（§4.2）。
2. **新接口响应排序**：无 `_score`，返回顺序是否已按相关性降序？跨库合并重排是否有分数可用？（Q3 依赖项，**仍待确认**）
3. ~~历史迁移路径 A/B~~ **已定（2026-08-12）**：走 **B 读时合并**，落地点见 §6。
4. ~~`octo_ai` agent 去留~~ **已定（2026-08-12）**：**保留 agent 注册，只丢 prompt**。理由：它同时是 `build` 的向后兼容目标（agent.ts 两处映射）、TUI 默认 agent、`plan.ts` 的退出目标，且上游 `packages/ui/message-part.tsx` 有两处 `agent === 'octo_ai'` 判断（本仓约定不动上游）。去掉 `prompt` 字段后由 `session/llm.ts` 回落 `SystemPrompt.provider`，正是上游 build agent 的原始行为。
