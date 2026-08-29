# SPEC-INS-033 — Insight 统一产物统计打点（`artifact-output`）

> 状态：**已实施（D3，2026-08-29：服务端上报形态）** · 优先级 P2 · 规模 [S] · 领域 infra/insight
>
> 上游已实现：✓ git snapshot / `summary.diffs` 全链路；✓ `artifact-output` / `artifact-output-outside` 服务端打点（opencode `tracking/report.ts` + `summary.ts` 挂钩）

---

## 0. 本文与 UXAI 侧打点文档的关系

打点文档在 UXAI 仓分两份（均在 `packages/app/octoapp/pages/insight/docs/`）：

- `tracking-plan.md`——「怎么定」：name / extend / 映射规则 / 命名约定
- `tracking.md`——「定了什么、落在哪」：已实现打点清单

**本 spec 只承载「统一产物统计」这一件事的设计论证与取舍**（方案对比、数据源选型、已知偏差），是设计层真相源。实施时按 UXAI 侧的维护闭环走：先把 name / extend 落进 `tracking-plan.md`（作为批次 6），实现后再记 `tracking.md` §十。**两边不复制论证，UXAI 侧引本文即可**——事实层重叠时剥离换引用，别粘贴。

代码路径全部相对 UXAI 仓根，本仓不再持有实现代码。

---

## 1. 背景与问题

UXAI `tracking.md` §十「统计产物」现有三个事件（`artifact-file-write` / `artifact-file-edit` / `artifact-mcp-return`）全部基于**客户端解析 tool part**（`insight-turn.tsx` 里遍历 `turnAssistantParts()` 找 `type:"tool"` + `status=completed`）。该口径有一个根本缺陷：

**覆盖不全**——只能识别 `write` / `edit` / MCP `resource_link` 三类工具产生的文件，`bash` 产生的文件**永远漏报**（无法从 tool part 可靠识别）。这个缺口是真实的：insight agent 的 `bash` 已于 2026-07 放开（`packages/opencode/src/agent/agent.ts:286`，供 interview-analysis skill 使用），只有 chip turn 由 `buildToolGate` 临时关死。

需要一个**覆盖所有文件变更方式**的统一口径，回答「这个 turn 一共产出/修改了多少文件」。

---

## 2. 方案对比

| 方案 | 做法 | 覆盖面 | 准确性风险 | 结论 |
|---|---|---|---|---|
| A. 客户端解析 tool part（现状） | 遍历 assistant parts 识别 write/edit/resource_link | ✗ 漏 bash / python / 任意脚本副作用 | 中：依赖组件生命周期 | 已实现，保留作分工具口径，但不能回答「一共产出多少」 |
| B. 服务端算 diff、前端上报（D2 前的选型） | 读 `UserMessage.summary.diffs`（服务端 git snapshot 算好），前端 effect 上报 | ✓ 所有文件变更方式 | 中：仍受组件生命周期影响，需 baseline + 守卫 + debounce | 曾采用；**D3 已升级为 C**（前端 effect 及三层补丁已删） |
| **C. 服务端直接上报（本 spec 现行，D3）** | `summary.ts` 的 `summarize` 落库后由 server 侧发送（`tracking/report.ts`） | ✓ 所有方式 | 低：一次性、无生命周期问题 | **业界标准形态，已实施**——「tracker SDK 是纯浏览器 SDK 发不出去」的前提经查证不成立（见 §6） |

业界对「产物 / 系统事实」类指标的通行做法是 C：在产生它的进程上报（后端事件流 / 审计表，或 OpenTelemetry GenAI 语义约定里的 tool span 属性）。产物统计本质是**系统事实**（谁写了哪个文件），不是用户交互；用前端 effect 推导系统事实，必然要打 baseline、去重、守卫这一整套补丁——B 方案的三层实现要点全部源于此。D3 落地后该成本归零。

---

## 3. 数据源：服务端 Git Snapshot Diff

系统已有完整实现（无需新增基础设施），代码位置相对 UXAI 仓根：

| 环节 | 代码位置 | 说明 |
|------|----------|------|
| step-start 打 snapshot | `packages/opencode/src/session/processor.ts:435-457` | LLM step 开始前记录 git hash |
| step-finish 打 snapshot | `packages/opencode/src/session/processor.ts:460-494` | LLM step 结束后记录 git hash |
| diff 计算 | `packages/opencode/src/session/summary.ts:83-101` | `snapshot.diffFull(from, to)` 算出 `FileDiff[]` |
| 写入 user message | `packages/opencode/src/session/summary.ts:122-129` | `userMessage.summary.diffs = msgDiffs` |
| 推到前端 | `packages/opencode/src/session/session.ts:607-611` | `updateMessage` → `MessageV2.Event.Updated` → store 实时更新 |

**`UserMessage.summary.diffs`**（`packages/opencode/src/session/message-v2.ts:385-391`）是最佳消费入口：

- **per-turn 粒度**：`summary.ts:123-129` 只取「该 user message + 其 assistant 子消息」算 diff，天然是本轮
- **服务端计算**：不依赖客户端解析，`bash` / `python` / 任意方式的文件变更全部捕获
- **不依赖组件生命周期**：即使 `InsightTurn` 已卸载，服务端照常算完存进 DB，下次挂载时 message 对象带着完整 diffs

---

## 4. 方案设计

**核心原则：`artifact-output` 与现有三个事件互补，不替代。**

| 事件 | 回答的问题 | 数据来源 | 覆盖范围 |
|------|-----------|---------|---------|
| `artifact-output`（新） | 这个 turn 一共**产出/修改**了多少文件？ | 服务端 git diff | 所有方式 |
| `artifact-file-write` | 多少是 write 工具产生的？ | 客户端 tool part | write only |
| `artifact-file-edit` | 多少是 edit 工具产生的？ | 客户端 tool part | edit only |
| `artifact-mcp-return` | 多少是 MCP 工具返回的？ | 客户端 resource_link | MCP only |

> **⚠️ 不要把「`artifact-output` 行数减去三个事件行数」当作 bash 产出量。** 两个口径既重叠又异步：MCP `resource_link` 的 eager 落盘写在会话 `outputs/` 内（SPEC-INS-014 v4），**同样会进 git diff**，与 `artifact-mcp-return` 重复计数；且客户端落盘时刻不保证早于最后一次 step-finish 的 snapshot。差值只能当**趋势性提示**（「diff 明显多于工具口径 → 大概率有 bash 产物」），不能作为精确分母。

### 4.1 事件定义（per-file 粒度，见 §9 决策 D2）

**四条 `artifact-` 事件全部 per-file：每个文件一条事件**。打点数据面板按事件行数统计、不解析 `extend` 里的 count 字段——turn 级聚合（一条事件带 `files:[{type,count}]`）会让「1 turn 产 3 个文件」在面板上只显示 1，文件量被系统性低估。per-file 后**行数即文件数**，turn 级视图由下游 `group by messageId` 还原。四条事件都未上 dev，无迁移成本。

| name | 功能（统计什么） | 打在哪 | extend |
|------|-----------------|--------|--------|
| `artifact-output` | 本 turn 产出/修改的一个文件（服务端 git diff 口径，覆盖所有文件变更方式） | `insight-turn.tsx` artifact-output effect | `{messageId, file, type, status}` |
| `artifact-output-outside`（新） | 本 turn 观测到的会话目录外变更总量（噪声桶，**turn 级一条**，仅 outside>0 时报） | 同上 | `{messageId, outside}` |
| `artifact-file-write` | write 工具产生的一个文件 | `insight-turn.tsx` artifact-file effect | `{messageId, file, type}` |
| `artifact-file-edit` | edit 工具产生的一个文件 | `insight-turn.tsx` artifact-file effect | `{messageId, file, type}` |
| `artifact-mcp-return` | MCP 工具返回的一个 resource_link 文件 | `insight-turn.tsx` artifact-mcp effect | `{messageId, file, type, tool}` |

extend 字段：

```jsonc
// artifact-output(每个文件一条)
{
  "messageId": "msg_xxx",       // 本 turn 的 user message id —— 下游幂等键组成部分,见 §4.4
  "file": ".octo/ses_1/outputs/报告.md",  // git diff 路径(相对仓库根,天然幂等键组成部分)
  "type": "markdown",           // resolveOutputType 六值枚举;.ts/.py/.txt 等一律归 code
  "status": "added"             // added / modified(含覆盖写)
}
// artifact-output-outside(turn 级一条)
{ "messageId": "msg_xxx", "outside": 2 }
// artifact-mcp-return(每个 link 一条)
{ "messageId": "msg_xxx", "file": "https://mcp.intra/artifacts/…/report.md", "type": "markdown", "tool": "key_findings" }
```

- **`type`** 复用 `resolveOutputType`（`pages/insight/utils/output-type.ts` 单一入口，SPEC-INS-026 §4.2），六值枚举 `markdown / html / json / code / file / image`，四条事件类型判定一致
- **`file`** 即幂等键的一部分：`artifact-output` 用 git diff 路径（相对仓库根）；`artifact-file-write/edit` 用写盘路径剥掉 projectDir 前缀后的相对路径；`artifact-mcp-return` 用 resource_link 的 uri
- **`deleted` 文件不报**（删除的文件不算「产出」）。行数级统计另有 `session.summary.additions/deletions`，本族事件只做文件级
- turn 级聚合字段（`total/added/modified`）**不再上报**：行数即 total，`status` 字段 group by 即 added/modified

### 4.2 路径过滤：只把会话目录内的算作产物

`diffFull` 跑在 **worktree（= git 仓库根）** 上，不是会话目录；而按 [SPEC-INS-014](insight-worktree-layout.md) §2，隔离的是 `.octo/<sessionId>/` **子目录**，worktree 是整个 projectDir 共享的。不过滤会把这些一并算成「本 turn 产物」：

- 同一 projectDir 下**另一个 insight 会话**并发产出的文件
- **Make / Design 模块**写的 `.octo/artifacts/make/<sessionId>/`
- 用户在**文件管理器 / md 编辑器**（`md-edit-open` 那条路径）于生成期间的保存

故按路径分桶：`.octo/<sessionId>/` 内的每个文件发一条 `artifact-output`（per-file，见 §4.1），其余只累计进 turn 级的 `artifact-output-outside`。判据是 `isSessionArtifactPath`，D3 起实现于**服务端** `packages/opencode/src/tracking/report.ts`（前端 `worktree-layout.ts` 的副本已随迁移删除，口径由服务端单测锁定）。**不要用 `startsWith(".octo/")`**——git diff 输出的路径相对仓库根，projectDir 可能是仓库子目录，按「最后一个 .octo 段的下一段是否等于本 sessionId」判：

```ts
/** 该 diff 路径是否属于本会话的产物区 `.octo/<sessionId>/`。 */
export function isSessionArtifactPath(filePath: string, sessionId: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(OCTO_ROOT)
  return i !== -1 && segs[i + 1] === sessionId
}
```

### 4.3 触发时机（D3 后：服务端逐 finish-step，at-least-once）

**D3 起由服务端在 `summarize` 落库 `summary.diffs` 之后直接发送**（`summary.ts` 挂钩，`forkIn(scope)` 异步不阻塞 turn），只对 `agent === "octo_insight"` 的会话报（summarize 对所有 agent 都跑，不守卫会把 make / studio 混进 `module:"insight"`）。

`summarize` 每个 `finish-step` 都跑一次并覆写 diffs，所以一个 turn 会发多轮（从部分产物逐步到全部）——这是**有意的 at-least-once**：每轮只发新增文件（`messageID:file` 已发集过滤），下游按幂等键去重取最新 status。**不存在「多步 turn 漏报最终产物」**：最后一轮 summarize 覆盖到全部 diffs。

~~（B 方案时代的前端触发时机——showGenerating 守卫 + 1500ms debounce——已随 D3 迁移删除，历史见 §9.1。）~~

### 4.4 去重策略（D3 后：at-least-once + 下游幂等键）

- **服务端已发集**（`tracking/report.ts` 模块级 `messageID:file` Set）：省流量层，同轮 summarize 重算不重发；进程内存、重启即空，**不承担正确性**
- **下游幂等键**：`(name, messageId, file)`（outside 事件按 `(name, messageId)`），服务端事件 extend 另带 `sessionId`。业界（Stripe / AWS 事件流）标准姿势，报重了也不算错
- ~~（B 方案时代的 baseline 快照 + 模块级 trackedArtifactKeys 两层——历史见 §9.1。）~~

### 4.5 其余实现要点

- **数据源**：`summarize` 内已算好的 `msgDiffs`（该 turn 的 `UserMessage.summary.diffs`），无需二次查询
- **协议**：`tracking/report.ts` 复刻前端 tracker（UXAI `octoapp/utils/tracker.ts`）的 `/record/logger/interaction` 契约——裸 JSON POST、字段同构；`account` 取自 sessionExtras（前端 promptAsync `extra.account` 透传，knowledge_search 同源）；`browserName` 固定 `"server"` 供分析侧区分来源；`os/platform` 按 `process.platform` 映射同值；`path` 合成 `http://localhost/insight/<sessionID>`（复刻前端路由形态，且 extend 已带 `sessionId`，归属不依赖 path 解析）
- **account 缺失容错**：未登录态 / 服务重启后 extra 为空 → 整批跳过并留 warn 日志（空 account 的行无法归属用户，只会制造脏数据）
- **类型判定**：`tracking/report.ts` 的 `outputTypeOf`，SPEC-INS-026 §4.2 六值枚举的服务端镜像（单测对齐前端口径）
- **write/edit/mcp 三条 tool part 口径事件仍在前端 effect**（UXAI 批次 3，per-file 粒度同 D2），不在本 spec 迁移范围

### 4.6 伪代码（服务端 `tracking/report.ts` 核心）

```ts
// summarize 挂钩(summary.ts):msgDiffs 落库后 fork 发送,不阻塞 turn
if (target.info.agent === "octo_insight" && msgDiffs.length > 0) {
  yield* Tracking.reportDiffs({ sessionID, messageID, diffs: msgDiffs }).pipe(Effect.forkIn(scope))
}

// reportDiffs(tracking/report.ts):分桶 + per-file 发送
export function reportDiffs(input: { sessionID: string; messageID: string; diffs: Snapshot.FileDiff[] }) {
  const account = SessionExtras.readExtraString(input.sessionID, "account")
  if (!account) return Effect.void // 未登录态/重启后 extra 空:整批跳过,不造脏数据

  let outside = 0
  const effects: Effect.Effect<void>[] = []
  for (const d of input.diffs) {
    if (d.status === "deleted") continue
    const key = `${input.messageID}:${d.file}`
    if (sentKeys.has(key)) continue // 已发集:省流量层(每 finish-step 一轮,只发新增)
    sentKeys.add(key)
    if (!isSessionArtifactPath(d.file, input.sessionID)) { outside++; continue }
    effects.push(sendOne({ account, name: "artifact-output", extend: {
      sessionID: input.sessionID, messageId: input.messageID, file: d.file,
      type: outputTypeOf(d.file), status: d.status ?? "modified",
    }}))
  }
  if (outside > 0) {
    effects.push(sendOne({ account, name: "artifact-output-outside",
      extend: { sessionID: input.sessionID, messageId: input.messageID, outside } }))
  }
  return Effect.all(effects, { concurrency: 4 }).pipe(Effect.asVoid)
}

// sendOne:协议复刻前端 tracker(/record/logger/interaction,裸 JSON POST);
// browserName:"server"、os/platform 按 process.platform 映射、path 合成 /insight/<sessionID>;
// OCTO_REPORT_BASE_URL 未配置(外网)→ console.log("[octo:tracker-server] mock", payload)
```

---

## 5. 已知偏差（分析侧必读）

- **口径静默依赖用户项目的 `.gitignore`**：snapshot 会按源仓 ignore 规则过滤（`packages/opencode/src/snapshot/index.ts:238-249`，`diffFull` 出口 `:694-698` 再滤一次）。若 projectDir 恰好是个 git 仓且 `.gitignore` 忽略了 `.octo/`（隐藏目录，很常见），**`artifact-output` 恒为 0，而 `artifact-file-write` 照常有数**——两个口径静默打架。排查任何「产物统计为 0」的反馈时先查这一条。（D3 迁服务端**不改变**此条：挪的只是发射器，数据源还是 git snapshot。）
- **account 缺失的 turn 整批跳过**（D3 新增）：未登录态、或 opencode 服务重启后用户尚未再发消息（sessionExtras 为进程内存）时，该 turn 的 artifact-output 静默跳过。偏差方向恒为偏低，日志有 `[octo:tracker-server] account missing` 可排查。
- **`artifact-output-outside` 是噪声桶不是产物**：它混着并发会话、Make 模块、用户手动保存三类来源，只用于观察污染量级，不要计入产物总量。
- **含 `"` / `\` 的文件名历史脏数据**：曾因 `summary.ts:128` 写入 `summary.diffs` 未走 `unquoteGitPath` 而判成 `code`；该修复已随 D3 同批合入（写入前归一化），存量历史 message 中的带引号路径不回填。

---

## 6. 为什么最终放服务端（D3）

§2 已述：C 方案（服务端直接上报）是业界标准形态。**初版 spec 曾断言「tracker SDK 是纯浏览器 SDK，server 侧发不出去」而选了 B（前端 effect）——2026-08-29 查证该前提不成立**：

1. "tracker SDK" 实为 UXAI 仓内 162 行的本地文件（`octoapp/utils/tracker.ts`），本质是**裸 `fetch` POST 到 `/record/logger/interaction`，无鉴权、无 cookie、无签名**——服务端用同构 JSON 即可发送；
2. 用户身份服务端可得：`account` 本就经 promptAsync `extra` 透传存于服务端 sessionExtras（knowledge_search 同源先例）；
3. 服务端读不到 `VITE_` 环境变量的门槛早有解法：desktop `createSidecarEnv` 已给 sidecar 桥接 `OCTO_KB_BASE_URL` / `OCTO_UXR_MCP_URL` / `OCTO_UPLOAD_ENDPOINT` 三个同款变量，加 `OCTO_REPORT_BASE_URL` 即可。

于是 D3 把发送器挪到 `summary.ts` 的 `summarize` 之后（`tracking/report.ts`）——一次性、准确、无生命周期问题；B 方案的 baseline / showGenerating 守卫 / 1500ms debounce 三层补丁全部删除，「切走会话漏报」类偏差连根消失。

遗留观察点（非阻塞）：`datas[].path` 服务端合成 `http://localhost/insight/<sessionID>`（复刻前端路由形态）、`browserName:"server"`——上线前与打点面板侧确认这两个字段不触发过滤/解析异常即可；已确认 extend 自带 `sessionId`，会话归属不依赖 path 解析。

## 7. 落地清单（D3 实施形态）

| 文件（相对 UXAI 仓根） | 改动 |
|------|------|
| `packages/opencode/src/tracking/report.ts` | **新增**：协议复刻（`/record/logger/interaction`）、`isSessionArtifactPath` 服务端判据、`outputTypeOf` 六值枚举镜像、`reportDiffs` 分桶 per-file 发送、未配 base URL 时 mock 日志 |
| `packages/opencode/src/session/summary.ts` | summarize 挂钩：`agent === "octo_insight"` 守卫 + `forkIn(scope)` 发送；另含 msgDiffs 落库前 `unquoteGitPath`（引号文件名修复） |
| `packages/opencode/src/session/extras.ts` | **新增**：sessionExtras 下放叶子模块（prompt.ts 与 tracking 都要读，避免与 summary.ts 成环） |
| `packages/opencode/test/tracking/report.test.ts` | **新增**：分桶 7 条断言（镜像原前端用例）+ outputTypeOf + payload 同构断言 |
| `packages/app/octoapp/pages/insight/components/insight-turn.tsx` | **删** artifact-output/outside 前端 effect（~75 行）及 imports，留迁移指引注释；write/edit/mcp 三条 per-file effect（D2）保留 |
| `packages/app/octoapp/pages/insight/utils/worktree-layout.ts` / `.test.ts` | **删** `isSessionArtifactPath` 前端副本及 7 条测试（判据随事件迁服务端） |
| `packages/desktop/electron.vite.config.ts` / `src/main/env.d.ts` / `src/main/server.ts` / `.env.example` | `OCTO_REPORT_BASE_URL` 桥接（照抄 `OCTO_UPLOAD_ENDPOINT` 模式：define + createSidecarEnv + 类型 + 文档） |
| `packages/app/octoapp/pages/insight/docs/tracking-plan.md` / `tracking.md` | 批次 6 / §十 落点改服务端，D3 决策记录 |

---

## 8. 验证

### 8.1 外网验证

**属服务端改动：验证前先重启 opencode server 进程**（渲染端 HMR 不覆盖 sidecar / server 代码）。

1. 服务端单测（`packages/opencode` 下）：
   ```bash
   cd packages/opencode && bun test test/tracking/report.test.ts
   ```
2. 仓库根 `bun run typecheck`
3. 仓库根 `bun run dev`，按下表逐个跑，**opencode server 终端**看 `[octo:tracker-server] mock` payload 核对 `name` / `extend`（注意：不再是前端终端的 `[octo:tracker-mock]`——事件由服务端发）

| # | 场景 | 操作 | 预期 `artifact-output`（per-file，服务端发） |
|---|------|------|----------------------|
| 1 | write 工具创建文件 | 「创建 test.md」 | **1 条**：`{sessionId, messageId, file, type:"markdown", status:"added"}` |
| 2 | bash 创建文件 | 「用 echo 创建一个 a.txt」 | **1 条**：`type:"code"`（tool part 口径**漏报**、diff 兜住） |
| 3 | **多步 turn** | 「先分析附件，再写一份 md 报告」（工具调用 → write 至少两步） | 每 finish-step 一轮、只发当轮新增；turn 结束时 write 产物的**几条全有** |
| 4 | **打开历史会话** | 切到一个有 5 条历史产物 turn 的会话 | **一条都不报**（服务端在生成时刻发，打开历史不触发任何东西） |
| 5 | F5 刷新 | 刷新已有产物的会话 | 同 #4，一条都不报 |
| 6 | **生成中切走会话（D3 核心验收）** | 发完消息**立刻**切到别的会话 / 关窗口 | **照常上报**——前端组件卸载与服务端发送无关；这是 D3 迁移的直接验收点（B 方案在此场景漏报，见 §9.1） |
| 7 | 纯 edit | 「修改 test.md 第 1 行」 | **1 条**：`status:"modified"` |
| 8 | 并发污染 | insight 生成期间用 Make 模块产出文件 | Make 的文件不进 `artifact-output`，报 **1 条** `artifact-output-outside:{outside:1}` |
| 9 | **gitignore 忽略** | projectDir 为 git 仓且 `.gitignore` 含 `.octo/` | `diffs` 为空 → 不上报；确认与 `artifact-file-write` 的口径差异可解释 |
| 10 | **per-file 粒度** | 「一次创建 3 个文件」（write×3 或 bash 批量） | **3 条** `artifact-output`，面板行数=文件数（旧的聚合口径只显示 1，见 §9.2 D2） |
| 11 | 同名覆盖写 | turn 内两次 write 同一文件 | 2 条（added + modified 各一），file 相同、status 不同——`group by messageId,file` 取最新即正确终态 |
| 12 | **未登录态** | 无 `userInfo.account`（隐身/清存储）时发消息 | 整批跳过 + server 终端 `[octo:tracker-server] account missing` warn（不造空 account 脏数据） |
| 13 | **make 不误报** | 用 Make 模块产文件 | **零条**（agent 守卫：只报 `octo_insight` 会话） |

以上 13 条均不依赖内网真实服务或数据（本地 worktree + mock 日志即可复现），**无内网验证节**；上线后在内网配 `OCTO_REPORT_BASE_URL`（.env.beta / .env.prod），Network / 服务端日志确认命中真实域名即可，属常规打点流程（见 [tracking.md](tracking.md)），不额外列。

---

## 9. 评审记录（2026-08-28）与决策记录（2026-08-29）

### 9.1 评审修订（2026-08-28）

本 spec 由 UXAI 侧「批次 6」初稿评审修订而来，修正的判断如下，避免后来者按初稿重做：

| 初稿结论 | 实际 | 依据 |
|---|---|---|
| 「`summary.diffs` 服务端一次性写入，数据到达即代表 turn 完成，不检查 `showGenerating()`」 | **错**：每个 `finish-step` 都跑 `summarize` 并覆写；不加守卫会在第一步就报部分 diff 并被永久去重 | `processor.ts:510-515` |
| 「不需要 baseline 快照」 | **错**：`trackedArtifactKeys` 是内存 Set，刷新即清空；历史 message 的 diffs 早已存在，打开历史会话会按 turn 数虚增 | `insight-turn.tsx:479-493` 现有三个 effect 的 baseline 注释 |
| 「insight 会话的 worktree 通常是隔离的，偏差极小」 | **错**：隔离的是 `.octo/<sessionId>/` 子目录，worktree 是整个 projectDir 共享；污染源是同一 app 的其他功能 | [SPEC-INS-014](insight-worktree-layout.md) §2 |
| 「`total` 减三个事件 count 之和 = bash 产出」 | **不成立**：与 `artifact-mcp-return` 重叠计数且落盘时序不定 | SPEC-INS-014 v4 eager 落盘 |
| 「PR #720 已修生命周期问题」 | **未合入**：UXAI PR #720 于 2026-08-27 closed，dev 上 `showGenerating` 守卫仍在 | UXAI PR #720 |
| extend 示例 `{"type":"typescript"}` | 非法值；`OutputCardType` 是六值枚举，`.ts` 归 `code` | `output-type.ts`（SPEC-INS-026 §4.2） |
| 引用「`tracking.md` §八 统计产物」 | 实为 **§十** | UXAI `tracking.md` |

### 9.2 决策记录

**D2（2026-08-29）粒度从 turn 级聚合改为 per-file，四条 `artifact-` 事件统一。**
起因：打点数据面板按**事件行数**统计、不解析 `extend` 里的 count——turn 级聚合会让「1 turn 产 3 个文件」面板只显示 1，文件量系统性低估；且该问题不止 `artifact-output`，`artifact-file-write/edit/mcp-return` 三条同族事件同样存在。四条均未上 dev，改口径零迁移成本，故一次统一。配套变化：

- 下游幂等键 `(name, messageId)` → `(name, messageId, file)`；去重键 `output:${messageID}` → `output:${messageID}:${file}`
- turn 级聚合字段 `total/added/modified` 不再上报（行数即 total，status 字段 group by 即 added/modified，turn 级视图 `group by messageId` 还原）
- 会话目录外变更从 `artifact-output` 的 `outside` 字段拆成独立 turn 级事件 `artifact-output-outside`（不污染 per-file 行数=文件数的语义）
- 验证用例从 9 条扩到 11 条（新增 #10 per-file 粒度、#11 同名覆盖写）

（D1 为 2026-08-28 评审确立的「选 B 折中」整体决策，见 §2 / §6，不在此重复。）

**D3（2026-08-29）发射器从前端 effect 迁服务端，B → C。**
起因：用户问「生成一个文件马上切走，原会话会打点吗」——B 方案答案是「不会，已知漏报」。复核「等内网打点服务开放 server 侧上报」这个前置时发现**它是个伪前提**：所谓「纯浏览器 SDK」实为仓内 162 行本地文件、裸 fetch 无鉴权（§6 三条查证）。遂直接落地 C 形态：

- 发送器：opencode `src/tracking/report.ts`（协议复刻 + 分桶 + `outputTypeOf` 镜像 + mock 日志），`summary.ts` summarize 挂钩（`octo_insight` 守卫 + `forkIn`）
- **删除**前端 artifact-output/outside effect 及 baseline / showGenerating 守卫 / 1500ms debounce 三层补丁；前端 `isSessionArtifactPath` 副本同步删除（口径由服务端单测锁定）
- at-least-once：每 finish-step 一轮、只发新增（`messageID:file` 已发集），下游按幂等键去重取最新——多步 turn 不再依赖「等终态」，因为每一轮都是离散的服务端事实
- account 从 sessionExtras 读（knowledge_search 同源），缺失整批跳过；`OCTO_REPORT_BASE_URL` 经 desktop `createSidecarEnv` 桥接（`OCTO_UPLOAD_ENDPOINT` 同款）
- 验收核心：**生成中切走会话 / 关窗口照样上报**（#6）；打开历史 / F5 零虚报（#4/#5）
- B 方案时代的 D2 per-file 粒度、幂等键设计**原样保留**（D3 只换发射器，不动口径）

未采纳但记录在案的建议：`artifact-` 前缀下 4 个事件口径互相重叠、需靠相减推断，分析侧难解释；更清爽的形态是**只留一个 turn 级事件、来源作维度进 extend**（`bySource: {write, edit, mcp, other}`）。改动面大，留待打点体系整体收敛时再议。
