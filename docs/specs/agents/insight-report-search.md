# SPEC-INS-034 — 研究报告库检索工具 `insight_report_search`

> **上游已实现 ✗** —— octo 自加能力（insight 专属原生工具，直连内网「研究报告库」检索接口）。
>
> **与 [SPEC-INS-030](insight-knowledge-search.md) 的关系（务必先读）**
> - **同一套实现形态，不同的库、不同的工具**：本工具照 `knowledge_search` 的形态写（原生 in-process 工具 + `ctx.extra.account` + 扁平数组 parse + `metadata.sources` + registry 网关到 `octo_insight`），**不是**对 030 的修改。
> - **`knowledge_search` 一个字都不改**：它继续查内网 wiki 全量库（030 §4.2 / §7 定案）。本 spec 只**并列新增**一个工具查「研究报告库」。
> - 030 的这几节是本 spec 的实现依据，不重抄：§4.2（新接口 `queryKnowledge` 契约与扁平响应）、§5（account 走 `promptAsync.extra` 的通道与「缺工号显式拒答」姿态）、§7（**选库这类决策不交给模型**的定案理由）。
>
> **相关**：[SPEC-INS-016 `extract_document`](../infra/insight-extract-document.md)（第三个问答入口：读用户上传的材料）、[insight-debugging.md](../../insight-debugging.md)（`[octo:report]` 日志字典）。

---

## 0. 结论锚点

内网知识库那边新开了一个检索接口，查的是**单独的「研究报告库」**——用户研究报告的 MD 灌进去建的独立库，与 `knowledge_search` 查的 wiki 全量库**数据不重叠**（2026-09-24 后端确认）。

| # | 结论 | 章节 |
|---|---|---|
| 形态 | 并列新增原生工具 `insight_report_search`，**照抄** `knowledge_search` 的结构；`knowledge_search` 不动 | §2 |
| 接口 | 同 host（`OCTO_KB_BASE_URL`），仅 path 换成 `.../thirdParty/queryReportKnowledge`；body 仍是 `{question, account}`；**不传库名**（接口自身绑定报告库） | §3 |
| 库名 | **协议上就没有库名字段** —— 无从做成工具入参，030 §7「不让模型选库」的原则天然成立 | §3.2 |
| `downloadUrl` | 响应多这一个字段，**当前真实数据恒为 null**；本期**只解析、只存进 `metadata.sources`，UI 零改动** | §4 |
| account | 与 `knowledge_search` **完全一致**：取 `ctx.extra.account`，拿不到就**不发请求、显式拒答**。本期不要 `userId`（报告库一期不做按用户过滤） | §5 |
| 网关 | 只给 `octo_insight`；chip turn（「研究工具」那轮）的 `buildToolGate` 设 `false` | §6 |
| 引用 UI | **复用现成的** `knowledge-references.tsx`，只放宽它的工具名判断；**本期不加任何下载相关 UI** | §7 |

---

## 1. 背景与产品定位

`octo_insight` 下现在有**三个问答入口**，弱模型容易混，边界必须在工具 description 和系统提示词里都写死（§8）：

| 问什么 | 答案在哪 | 走哪条 |
|---|---|---|
| 用户本次给的访谈材料 / 逐字稿 | 用户上传或放进工作区的文件 | `extract_document` / `read` / `grep` / skill |
| 内网 wiki、产品、流程、规范、制度、研究方法 | 公司既有内网文档 | `knowledge_search`（SPEC-INS-030） |
| **既往的用户研究报告** | **独立的「研究报告库」** | **`insight_report_search`（本 spec）** |

「研究报告」指的是**已完成的研究交付物**（某次用户研究的结论、发现、洞察、结论页），不是研究方法论文档——后者在 wiki 全量库里，归 `knowledge_search`。

---

## 2. 形态：照 `knowledge_search` 写，不做抽象

**明确不做**「把两个工具抽成一个带库名参数的通用检索工具」，也不做「共享 parse / 共享 fetch 的公共模块」。理由：

- 两者的**差异点正在增长**（本期已多出 `downloadUrl`；后续项还有下载交互、按用户权限过滤，见 §10），抽公共层现在省下的几十行，会在下一次分叉时变成需要拆的耦合。
- 「一个带库名参数的工具」= 把选库交还给模型，与 030 §7 的定案正相反。
- 两份文件各自可读、各自可改，符合 insight「能力自包含」的既有取向。

代价（明确接受）：`parseDocs` / `readAccount` / 输出前缀这几段是**结构相同的两份代码**。接受它。

---

## 3. 接口契约

### 3.1 请求

- Method：`POST`
- URL：`{OCTO_KB_BASE_URL}/main/rest.root/ucdAgent/thirdParty/queryReportKnowledge`
  - **host 与 `knowledge_search` 同一个 `OCTO_KB_BASE_URL`**，不新加环境变量（2026-09-24 确认）。仅接口名不同：`queryKnowledge` → `queryReportKnowledge`。
  - 未配置 `OCTO_KB_BASE_URL` 时回落本地 mock `http://localhost:8787`（与 `knowledge_search` 同一个默认值、同一个 mock server）。
- Body（**只发这两个字段**）：
  ```json
  { "question": "去年做过哪些关于搜索功能的用户研究", "account": "c60050492" }
  ```
  - `question`：用户问题原文（对应旧接口的 `context`）。
  - `account`：调用者工号，**必传**（获取方式与 `knowledge_search` 完全一致，见 §5）。

### 3.2 库名：协议上就没有这个字段

后端确认（2026-09-24）：**接口本身绑定研究报告库，不需要也不接受库名参数**。

因此 030 §7「不把选库做成工具入参、不让模型选」在这里**不需要靠我方自律**——协议上就没得选。本 spec 仍记这一条，是为了让后续如果有人提「加个库名参数让模型挑库」时，有个明确的否决依据：选哪个库是模型在看到检索结果**之前**无从可靠判断的决策，不交给它；真要支持多个报告库，做法是再加一个工具，不是加一个参数。

### 3.3 响应

**扁平 chunk 数组**，结构与 `queryKnowledge` 一致，**额外多一个 `downloadUrl`**：

```json
[
  {
    "documentId": "202d640f973bb5ea92561e3cc4d8b8e1",
    "chunkTitle": "搜索功能可用性测试报告",
    "chunkContent": "本次可用性测试招募 12 名用户……",
    "documentUrl": "https://octo.hdesign.huawei.com/p/833223",
    "downloadUrl": null
  }
]
```

| 字段 | 用途 |
|---|---|
| `documentId` | 去重键（我方按它兜底去重，保留首次出现） |
| `chunkTitle` | 标题；缺失时取正文首个 markdown 标题兜底，再缺用 id |
| `chunkContent` | 正文，供模型作答 |
| `documentUrl` | 原文链接，行内 `[[n]](链接)` 与底部引用列表都用它 |
| `downloadUrl` | **原文档下载地址**，见 §4 |

- **返回顺序即相关性降序**、无 `_score`：parse 按序直接用，**不排序、不截断**（排序由服务端 rerank 承担，与 030 同）。
- 条数由后端固定，我方不传 topK、不做成工具入参（理由同 030 §4.2 / §7）。

### 3.4 待确认（拿到真实数据后回填）

| # | 待确认项 | 当前处理 |
|---|---|---|
| A1 | `downloadUrl` 无值时是 `null` 还是**整个键缺失**？后端目前没有约定，postman 跑出来全是 `null` | parse **两种都兼容**，一律归一成 `undefined`（§4） |
| A2 | 后端固定返回几条？是否已按 `documentId` 去重？ | 先按现状跑；召回不足走 N2，请后端调大固定值，**不在客户端补路由或重排** |
| A3 | 真实报告问题样例（用于路由准确率验证 V8） | 本期自拟，**待业务侧提供真实问题样例做路由准确率验证** |

---

## 4. `downloadUrl`：本期只解析、只存储、不展示

**现状**：后端接口已返回该字段，但**当前数据里全部是 null**（2026-09-24 postman 实测），没有任何真实地址可验。

**本期范围（刻意收窄）**：

- ✅ parse 解析它，`null` / 缺失 / 空串 **一律归一成 `undefined`**（不要写成空串——空串会让下游 `if (url)` 和 `url != null` 两种判断给出不同答案）。
- ✅ 带进 `metadata.sources` 的元素里（`downloadUrl?: string`），随会话一起存下来。
- ❌ **UI 零改动**：不加下载按钮、不加下载图标、不在引用列表里显示、不在输出文本里给模型看。

**为什么不顺手把 UI 一起做**：没有真实地址就没法验证「点了会怎样」——下载走 `window.api` 哪个通道、落到文件管理的哪个目录、同名如何处理、失败态文案，全都只能靠猜。按确定性优先的原则，**没有可验的数据就不做交互**，先把字段通到 `metadata` 里存着，等真实数据到位后按 §10 做完整的下载交互。

**如何确认它真的解析对了**（既然界面上看不见）：看 `[octo:report] parsed` 日志，它打印每条的 `downloadUrl`（见 §9）。mock fixture 里**同时准备了有值、null、键缺失三种条目**，外网就能验全三种分支（V6）。

---

## 5. account：与 `knowledge_search` 完全一致

沿用 SPEC-INS-030 §5 已建成的通道，**零新增基建**：

```
renderer localStorage.userInfo.account
  → pages/insight/utils/account.ts
  → promptAsync 的 extra.account（即时发送 + 排队 drain 两处已有）
  → session/prompt.ts 存 sessionExtras
  → 工具 ctx.extra.account
```

- 取不到工号 → **不发 HTTP 请求**，直接返回一段"未能获取当前登录账号，请如实告知用户需重新登录"的 output，并打 `[octo:report] account missing`。理由同 030 §5：接口按 account 限流，静默兜底成单一开发者工号会让全员挤一个限流桶。
- **本期不需要 `userId`**：报告库一期查全量、不做按用户权限过滤（二期才做，见 §10）。

---

## 6. 网关：只给 `octo_insight`，chip turn 关闭

1. **registry**（`packages/opencode/src/tool/registry.ts`）：照 `knowledge_search` 那段写，`input.agent.name === "octo_insight"` 才放出。硬隔离，不泄漏到 make / studio / pattern。
2. **chip turn**（`pages/insight/store/mcp-trigger.ts` 的 `buildToolGate`）：`gate["insight_report_search"] = false`。理由同 `knowledge_search`：「研究工具」那一轮的职责是**一次直接的 MCP 工具调用**，报告检索与之无关，却是弱模型在 MCP 工具缺失时用来模拟结果的又一条逃生口（拿报告片段编一份"解析结果"）。

---

## 7. 引用 UI：复用，不新写

底部「引用 N 篇资料作为参考」直接复用 `pages/insight/components/knowledge-references.tsx`（SPEC-INS-030 §2 建的那份）。

**唯一要改的地方**：它按**工具名**挑 part —— `part["tool"] !== "knowledge_search"` 就跳过。放宽成「两个检索工具都认」即可。

- 它对 source 元素的类型守卫只校验 `typeof n === "number" && typeof title === "string"`，是**白名单式校验字段、不是排他式过滤对象**，所以多一个 `downloadUrl` 字段**不会被过滤掉**（已核对，`knowledge-references.tsx` 约 37 行）。守卫不需要动。
- `KnowledgeSource` 类型加一个 `downloadUrl?: string`，**只为类型完整**，渲染层不读它。
- **本期不加任何下载相关 UI。**

行内 `[[n]](url)` 角标是模型直出的原生 markdown 链接，由上游 `SessionTurn` 渲染，零 UI 工作量。

---

## 8. 三个入口的边界要写死在两处

工具 description 和系统提示词**都要写**，且**都要正面说覆盖什么、反面说不覆盖什么**——只写"覆盖什么"时，弱模型会把三个入口都当成"可能有答案的地方"挨个试。

`insight_report_search` 的 description 要点：

- **正面**：检索公司内网的**用户研究报告库**（既往研究的报告、结论、发现、洞察）；用户问"以前做过哪些关于 X 的研究""某研究的结论是什么"时调用，传用户问题原文作 `query`。
- **反面**：**不**覆盖用户本次上传/放进工作区的访谈材料（那些用 `extract_document` / `read` / `grep` 读）；**不**覆盖内网 wiki 的流程 / 规范 / 制度 / 研究方法文档（那些用 `knowledge_search`）。
- **作答约束**：只依据返回片段作答、`[[n]](链接)` 行内引用、保持分段、不编造、空结果如实告知。

系统提示词（`agent/prompt/octo_insight.md`）把现有的「内网知识库问答」一节扩成**三条并列的分流**，措辞与 description 对齐。

---

## 9. 日志：新起前缀 `[octo:report]`

字段与 `[octo:kb]` 三条对齐，便于对照排查；新增 `downloadUrl` 的可观测（§4）：

| 日志 | 级别 | 字段 |
|---|---|---|
| `[octo:report] account missing` | error | `sessionID` / `query`（**出现即表示没发 HTTP 请求**） |
| `[octo:report] config` | log | `envBaseUrl` / `usingMockDefault` / `resolvedBase` / `url` / `account` / `query` |
| `[octo:report] response` | log | `url` / `status` / `ok` / `bodyHead` |
| `[octo:report] parsed` | log | `totalDocs` / `titles` / **`downloadUrls`**（与 titles 同序，未提供的位置为 `undefined`） |
| `[octo:report] 检索失败 url=…` | error | 网络层失败（连不上 / 超时 / abort），带完整 url |

同步写进 [insight-debugging.md](../../insight-debugging.md) 的日志字典。

---

## 10. 后续项（本期明确不做）

### 10.1 原文下载交互（等 `downloadUrl` 有真实数据）

数据到位后做完整链路：**询问用户是否下载 → 下载到文件管理 → 用户 `@` 该文件继续对话**。

要点（届时另起 spec 或在此扩章）：

- 「询问用户」用 `question` 工具（SPEC-INS-025）还是引用列表上的一个按钮，取决于交互密度，届时定；不要默认拿这个问用户。
- 落盘位置要与 SPEC-INS-028（会话工作目录声明）/ SPEC-INS-026（产物身份模型）对齐——下载来的报告是**输入材料**不是产物，归属要先想清楚。
- 落盘后要能被 `@` 引用面板（SPEC-INS-023）看见、被 `extract_document` 读得动（office 文档走 SPEC-INS-016 那条通道）。
- 同名 / 失败 / 超大文件的处理必须响亮失败，不静默。

### 10.2 报告库按用户权限过滤（二期）

一期**查全量**——报告库里所有报告对所有人可检索。二期要按当前用户的权限过滤（不是每个人都该看到每一份研究报告）。

**过滤必须在服务端做。** 客户端拿到全量结果再过滤等于没过滤（片段正文已经进了进程内存、进了模型上下文），是纸糊的权限。届时我方能提供的只有 `account`（以及必要时 `userId`，通道已由 SPEC-INS-033 建好），判定在后端。

### 10.3 两库重叠的复核

后端确认报告库与 wiki 全量库**数据不重叠**（报告 MD 只灌进了独立库）。这是**后端的口头确认，不是我方能保证的不变式**——若后续报告也被灌进全量库，`knowledge_search` 与本工具会返回重复内容、引用列表出现同一份报告两次。内网 N3 验一次，之后作为回归项。

---

## 11. 验证

### 11.1 外网（本地 mock，不需要内网）

准备：

```bash
# 1. 起 mock（新接口的 path 和 fixture 已加进同一个 mock server）
bun run packages/opencode/script/kb-mock-server.ts

# 2. 起 server —— 改了 registry 必须重启进程，否则新工具压根不在工具列表里
OCTO_KB_BASE_URL=http://localhost:8787 <启动 opencode server / Electron>
```

```js
// 3. DevTools 里灌工号（account 来源）
localStorage.setItem("userInfo", JSON.stringify({ account: "c60050492" }))
```

| # | 场景 | 通过判据 |
|---|---|---|
| V1 | 问一个研究报告相关的问题 | 出现 `[octo:report]` 的 config / response / parsed 三条日志；模型基于片段作答 |
| V2 | account 传出去了 | config 里的 `account` 等于 localStorage 里的工号，**不是空串** |
| V3 | 无工号显式拒答 | `localStorage.removeItem("userInfo")` 后重问：**mock 侧无新请求**；模型如实说需重新登录，不编造结果 |
| V4 | 行内引用可点 | 点 `[1]` 角标，系统浏览器打开来源链接 |
| V5 | 底部引用列表 | 出现「引用 N 篇资料作为参考」，条目与 parsed 日志里的标题一致 |
| V6 | **`downloadUrl` 正确解析** | parsed 日志里：有值的条目带上了 downloadUrl，`null` 的和**键缺失**的都是 `undefined`；**界面上没有任何下载相关的变化** |
| V7 | 空结果不编造 | 问 fixture 里必然没有的词：如实说未找到，无引用列表 |
| V8 | **三个入口不串** | ① 上传一份访谈 txt 问「我材料里提到什么」→ 无 `[octo:report]` 日志；② 问「内网怎么申请访谈酬金」→ 走 `[octo:kb]` 不走 `[octo:report]`；③ 问「以前做过哪些关于搜索的用户研究」→ 反之 |
| V9 | 网关未泄漏 | Design / Prototype / Studio 里问同样的问题，无 `[octo:report]` 日志 |
| V10 | chip turn 不放行 | 选「研究工具」那一轮问报告问题，无 `[octo:report]` 日志 |
| V11 | 单测 | 全部通过 |

> V8 的问题样例本期为自拟，**待业务侧提供真实问题样例做路由准确率验证**（§3.4 A3）。

### 11.1.1 实跑记录（2026-09-24，实现后）

| # | 结果 | 说明 |
|---|---|---|
| V11 单测 | ✅ 跑了，全过 | `insight-report-search.test.ts` 11 条（`bun test test/tool/...`，在 `packages/opencode` 下跑）；`knowledge-references.test.ts` 8 条（`bun test ./octoapp/...`，**要在 `packages/app` 下显式给路径**，根 `bun test` 扫不到）；`registry.test.ts` 8 条含新增网关用例 |
| V9 网关 | ✅ 以 registry 用例形式验了 | `insight_report_search is gated to octo_insight only`：`octo_insight` 拿得到、`octo_make` 拿不到。UI 里的 Design / Prototype / Studio 实测仍待走 |
| V6 解析 | ✅ 「HTTP → parse」实跑过 | 起 mock 后直连新 path：4 条 chunk → 3 篇文档（去重生效、返回序保持），`downloadUrls` = `[有值, undefined, undefined]`，对应 fixture 的**有值 / null / 键缺失**三态。**UI 内「界面无下载相关变化」那半条待 Electron 里走** |
| 接口连通 | ✅ | mock 在新 path 应答，日志 `[kb-mock] (report) question=… account="c60050492"`（account 确实发出去了，V2 的协议层部分） |
| V1–V5 / V7 / V8 / V10 | ⬜ **未跑** | 都需要 Electron + 真实模型（模型是否调工具、行内引用可点、引用列表、空结果不编造、三入口不串、chip turn），本地无法单独构造 |

> 同时确认：全仓 `bun turbo typecheck` 11/12 包绿，唯一失败是 `opencode` 包里既有的 `provider.ts` 找不到 `@ai-sdk/amazon-bedrock/mantle`，**与本项改动无关**。

### 11.2 内网（真实库，外网覆盖不了）

| # | 场景 | 通过判据 |
|---|---|---|
| N1 | 真实报告库通路 | `.env.<channel>` 配好 `OCTO_KB_BASE_URL` 后打包，`[octo:report] config` 里的 `url` 与能跑通的地址**逐字一致**，能基于真实片段作答 |
| N2 | 召回够不够 | 拿一批真实问题（**含跨模块**）验，该找到的报告落在返回结果里；反复找不到就**请后端调大返回条数**，不要在客户端补路由或重排 |
| N3 | 两个库不重叠 | 同一个问题分别触发两个工具，确认报告库的内容**没有**从 `knowledge_search` 里也查出来（§10.3） |
| N4 | `downloadUrl` 真实形态 | 抓一次真实响应，回填 §3.4 A1（null 还是键缺失）；若出现真实地址，`[octo:report] parsed` 里应原样带上 |

---

## 12. 落地清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/opencode/src/tool/insight_report_search.ts` | **新增**：工具本体（parse / account / 日志 / 输出前缀 / description） |
| 2 | `packages/opencode/src/tool/registry.ts` | 注册 + 网关到 `octo_insight` |
| 3 | `packages/app/octoapp/pages/insight/store/mcp-trigger.ts` | `gate["insight_report_search"] = false` |
| 4 | `packages/app/octoapp/pages/insight/components/knowledge-references.tsx` | 工具名判断放宽到两个工具；`KnowledgeSource` 加 `downloadUrl?`（**不加下载 UI**） |
| 5 | `packages/opencode/src/agent/prompt/octo_insight.md` | 「内网知识库问答」一节扩成三条并列分流（§8） |
| 6 | `packages/opencode/script/kb-mock-server.ts` | 加 `queryReportKnowledge` 路径 + fixture（**含 downloadUrl 有值 / null / 键缺失三种**） |
| 7 | `packages/opencode/test/tool/insight-report-search.test.ts` | **新增**：parse 单测（去重 / 保序 / downloadUrl 三态 / 空数组） |
| 8 | `packages/opencode/test/tool/registry.test.ts` | 补网关用例 |
| 9 | `packages/app/octoapp/pages/insight/components/knowledge-references.test.ts` | 补「认得 `insight_report_search`」与 downloadUrl 透传用例 |
| 10 | `docs/insight-debugging.md` | `[octo:report]` 日志字典（§9） |
| 11 | `ROADMAP.md` | 登记本项 |
