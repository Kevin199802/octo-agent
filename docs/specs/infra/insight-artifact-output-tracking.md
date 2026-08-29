# SPEC-INS-033 — Insight 统一产物统计打点（`artifact-output`）

> 状态：草案（待实现；本文是对 UXAI 侧「批次 6」初稿的评审修订版，2026-08-29 起粒度改 per-file，见 §9 决策 D2） · 优先级 P2 · 规模 [S] · 领域 infra/insight
>
> 上游已实现：✓ git snapshot / `summary.diffs` 全链路（opencode 原生，无需新增基础设施）；✗ `artifact-output` 打点本身

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
| **B. 服务端算 diff、前端上报（本 spec 选型）** | 读 `UserMessage.summary.diffs`（服务端 git snapshot 算好），前端 effect 上报 | ✓ 所有文件变更方式 | 中：仍受组件生命周期影响，需 baseline + 守卫 + debounce | **采用**（受 SDK 形态所限的折中，见 §6） |
| C. 服务端直接上报 | 在 `summary.ts` 的 `summarize` 之后由 server 侧发事件 | ✓ 所有方式 | 低：一次性、无生命周期问题 | **业界标准形态，但当前做不到**——tracker SDK 是纯浏览器 SDK，见 §6 |

业界对「产物 / 系统事实」类指标的通行做法是 C：在产生它的进程上报（后端事件流 / 审计表，或 OpenTelemetry GenAI 语义约定里的 tool span 属性）。产物统计本质是**系统事实**（谁写了哪个文件），不是用户交互；用前端 effect 推导系统事实，必然要打 baseline、去重、守卫这一整套补丁——§4 三条实现要点全部源于此，是选 B 的固有成本，不是实现没写好。

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

故按路径分桶：`.octo/<sessionId>/` 内的每个文件发一条 `artifact-output`（per-file，见 §4.1），其余只累计进 turn 级的 `artifact-output-outside`。判据加在 `pages/insight/utils/worktree-layout.ts`（渲染端布局知识唯一入口，与 `isPendingUploadPath` 同款分段写法），**不要用 `startsWith(".octo/")`**——git diff 输出的路径相对仓库根，projectDir 可能是仓库子目录：

```ts
/** 该 diff 路径是否属于本会话的产物区 `.octo/<sessionId>/`。 */
export function isSessionArtifactPath(filePath: string, sessionId: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(OCTO_ROOT)
  return i !== -1 && segs[i + 1] === sessionId
}
```

### 4.3 触发时机：必须等 turn 终态，且要 debounce

`summarize` 是**每个 `finish-step` 都跑一次**（`processor.ts:510-515`，`forkIn(scope)` 异步），每次重算并**覆写** `summary.diffs`。所以一个多步 turn（分析 → 调工具 → write，insight 的常态）里 `diffs` 会从「第一步的部分产物」逐步长到「全部产物」。

⚠️ **不能「数据到达即上报」**——那会在第一步结束时报出部分 diff，再被 messageID 去重永久锁死，后续 write 的交付物全丢，且多步 turn 越复杂漏得越多（系统性低估）。

正确做法两层：

1. `if (showGenerating()) return`——与 `tracking.md` §十现有三个 effect 同一守卫，只在 turn 不再是「活跃最新轮」后上报
2. **再 debounce ~1500ms**——最后一次 `summarize` 是 fork 出去的异步（git diff 在大 worktree 上可到秒级），可能晚于 `active` 翻假才落地；不 debounce 会读到倒数第二版。debounce 期间 diffs 再变则重置定时器，天然取最终值

### 4.4 去重策略：baseline 快照 + 模块级 set + 下游幂等键，三层

- **baseline 快照**（`artifactOutputBaselineTaken`，与现有三个 effect 同规则）：首次观测本 turn 实例时，若 `diffs` 已存在则逐文件记入去重集、不上报。**没有这层，打开一个有 N 条历史 turn 的会话就会瞬间报 N 条**——历史 message 的 `summary.diffs` 早已写好，effect 一挂载就命中
- **模块级 `trackedArtifactKeys`**：key = `output:${messageID}:${file}`（per-file），防 memo 重算 / turn 重挂重复报。注意它是**内存 Set，页面刷新即清空**，不能单独承担「刷新后不重报」，那是 baseline 的职责。per-file 键的附带收益：debounce 报完之后若 summarize 再覆写出**新文件**（超长 turn 的极端情况），新 key 不在 set 里、可自愈补报——turn 级键会永久锁死
- **下游幂等键**：`extend` 带 `messageId` + `file`，让分析侧按 `(name, messageId, file)` 去重（`artifact-output-outside` 无 file，按 `(name, messageId)`）。前端两层是「尽量只报一次」，这一层才是「报重了也不算错」的兜底——业界（Stripe / AWS 事件流）的标准姿势是 at-least-once + 幂等键，不靠客户端内存状态保证唯一性

### 4.5 其余实现要点

- **数据读取**：从 `data.store.message[props.sessionID]` 找 `id === props.messageID` 的 user message，读 `(userMsg as UserMessage).summary?.diffs`
- **类型判定**：复用 `resolveOutputType(d.file)`（`resolveOutputType` 需从 `type-only` import 改为 value import）
- **write/edit/mcp 三条同步改 per-file**：三条现有 effect 去重键本就 per-file（`write:${messageID}:${filePath}` 等），只改发射粒度——每个新增文件单独发一条，删除聚合上报与 `aggregateByFileType` / `aggregateByFileTypeWithTool`；触发时序维持现状（tool 完成即报，不加守卫 / debounce，那三条的设计如此）

### 4.6 伪代码

```ts
import type { UserMessage } from "@opencode-ai/sdk/v2/client"
import { resolveOutputType } from "../utils/output-type"
import { isSessionArtifactPath } from "../utils/worktree-layout"

// baseline：首次观测即视为历史，不报（避免打开历史会话 / 刷新时按历史 turn 数虚增）
let artifactOutputBaselineTaken = false
let outputTimer: ReturnType<typeof setTimeout> | undefined
onCleanup(() => clearTimeout(outputTimer))

const outputKey = (file: string) => `output:${props.messageID}:${file}`

createEffect(() => {
  const messages = (data.store.message as Record<string, Message[]>)?.[props.sessionID] ?? []
  const userMsg = messages.find((m) => m.id === props.messageID)
  if (!userMsg || userMsg.role !== "user") return
  const diffs = (userMsg as UserMessage).summary?.diffs

  if (!artifactOutputBaselineTaken) {
    artifactOutputBaselineTaken = true
    for (const d of diffs ?? []) trackedArtifactKeys.add(outputKey(d.file))
    return
  }
  if (!diffs?.length) return
  if (showGenerating()) return                 // 多步 turn：等本轮不再活跃
  const fresh = diffs.filter((d) => !trackedArtifactKeys.has(outputKey(d.file)))
  if (fresh.length === 0) return

  // debounce：末次 summarize 是 forkIn(scope) 异步，可能晚于 active 翻假才落地
  clearTimeout(outputTimer)
  outputTimer = setTimeout(() => {
    let outside = 0
    const newFiles: Array<{ file: string; type: string; status: string }> = []
    for (const d of diffs) {
      if (d.status === "deleted") continue
      if (trackedArtifactKeys.has(outputKey(d.file))) continue
      trackedArtifactKeys.add(outputKey(d.file))
      if (!isSessionArtifactPath(d.file, props.sessionID)) { outside++; continue }
      newFiles.push({ file: d.file, type: resolveOutputType(d.file), status: d.status ?? "modified" })
    }
    if (newFiles.length === 0 && outside === 0) return

    // per-file：每个会话目录内文件一条(行数即文件数,面板可直接数)
    for (const f of newFiles) {
      tracker.interaction({
        module: "insight",
        name: "artifact-output",
        extend: JSON.stringify({ messageId: props.messageID, ...f }),
      })
    }
    // outside 噪声桶：turn 级一条,只计数(会话目录外的不算产物,不逐条发)
    if (outside > 0) {
      tracker.interaction({
        module: "insight",
        name: "artifact-output-outside",
        extend: JSON.stringify({ messageId: props.messageID, outside }),
      })
    }
  }, 1500)
})
```

---

## 5. 已知偏差（分析侧必读）

- **口径静默依赖用户项目的 `.gitignore`**：snapshot 会按源仓 ignore 规则过滤（`packages/opencode/src/snapshot/index.ts:238-249`，`diffFull` 出口 `:694-698` 再滤一次）。若 projectDir 恰好是个 git 仓且 `.gitignore` 忽略了 `.octo/`（隐藏目录，很常见），**`artifact-output` 恒为 0，而 `artifact-file-write` 照常有数**——两个口径静默打架。排查任何「产物统计为 0」的反馈时先查这一条。
- **1.5s debounce 内切走会话会漏报**：debounce 定时器随组件卸载清掉，且 baseline 保证切回来时不补报。与 `server-mcp-result`（UXAI 打点批次 4）同调——「宁可少报、不虚增」，偏差方向恒为偏低。
- **`artifact-output-outside` 是噪声桶不是产物**：它混着并发会话、Make 模块、用户手动保存三类来源，只用于观察污染量级，不要计入产物总量。
- **含 `"` / `\` 的文件名会判成 `code`**：`summary.ts:128` 写入 `summary.diffs` 时没走 `unquoteGitPath`（只有 `:137` 的 `diff()` 走了），这类路径会带首尾引号，`resolveOutputType` 取到 `md"` 匹配不上扩展名表。非 ASCII 文件名不受影响（`diffFull` 用的 `quote` 配置带 `core.quotepath=false`）。低频，服务端补一行归一化即可根治（可选项，见 §7）。

---

## 6. 为什么放前端（而不是服务端）

§2 已述：C 方案（服务端直接上报）才是业界标准形态。**当前放前端是被 SDK 形态所迫的折中，不是设计选择**——tracker SDK 是纯浏览器 SDK（读 `localStorage.userInfo` / `navigator.userAgent` / `window.location.href`，见 UXAI `docs/tracker.md` 与本仓 [tracking.md](tracking.md)），opencode server 侧发不出去。

**中长期正解**：若内网打点服务开放 server 侧上报（Node HTTP），把本事件挪到 `summary.ts` 的 `summarize` 之后发——一次性、准确、无生命周期问题、无需 debounce 与 baseline。届时 §4.3 / §4.4 的三层去重全部可删。

---

## 7. 落地清单

| 文件（相对 UXAI 仓根） | 改动 |
|------|------|
| `packages/app/octoapp/pages/insight/components/insight-turn.tsx` | +2 import（`UserMessage` / `isSessionArtifactPath`）、`resolveOutputType` 从 `type-only` 改 value import、+artifact-output / artifact-output-outside 两个 effect（~50 行）；**artifact-file-write / artifact-file-edit / artifact-mcp-return 三条现有 effect 同步改 per-file 发射**（去重键不变），删 `aggregateByFileType` / `aggregateByFileTypeWithTool`（改后无调用方） |
| `packages/app/octoapp/pages/insight/utils/worktree-layout.ts` | +1 导出 `isSessionArtifactPath` + 单测 |
| `packages/app/octoapp/pages/insight/docs/tracking-plan.md` | 加「批次 6」一节，只记 name / extend / 落点与 per-file 粒度约定，论证引本 spec |
| `packages/app/octoapp/pages/insight/docs/tracking.md` | §十 四行 extend 描述更新 + 新增 `artifact-output-outside` 行 |
| （可选）`packages/opencode/src/session/summary.ts` | `:128` 写入 diffs 前走一次 `unquoteGitPath`，根治 §5 第四条 |

---

## 8. 验证

### 8.1 外网验证

纯渲染端改动走 HMR，**无需重启**；若同时做 §7 的可选项（改 `summary.ts`），属服务端改动，**验证前先重启 opencode server 进程**，否则改动不生效。

1. `isSessionArtifactPath` 单测：会话内路径 / 仓库子目录下的 `.octo/` / 别的 sessionId / `.octo/artifacts/make/` 四类断言。追加进现有 `worktree-layout.test.ts`（当前 5 pass），在 `packages/app` 下跑——**根目录跑不了测试**（根 `test` 脚本是 `exit 1`），且 `test:unit` 只扫 `./src`、不含 `octoapp/`，须显式给相对路径：
   ```bash
   cd packages/app && bun test --preload ./happydom.ts ./octoapp/pages/insight/utils/worktree-layout.test.ts
   ```
2. 仓库根 `bun run typecheck`
3. 仓库根 `bun run dev`，按下表逐个跑，terminal 看 `[octo:tracker-mock]` payload 核对 `name` / `extend`

| # | 场景 | 操作 | 预期 `artifact-output`（per-file） |
|---|------|------|----------------------|
| 1 | write 工具创建文件 | 「创建 test.md」 | **1 条**：`{messageId, file, type:"markdown", status:"added"}` |
| 2 | bash 创建文件 | 「用 echo 创建一个 a.txt」 | **1 条**：`type:"code"`（tool part 口径**漏报**、diff 兜住） |
| 3 | **多步 turn** | 「先分析附件，再写一份 md 报告」（工具调用 → write 至少两步） | write 产物的那**几条都有**；若只有第一步的部分 diff 即为触发时机写错 |
| 4 | **打开历史会话** | 切到一个有 5 条历史产物 turn 的会话 | **一条都不报**（baseline 生效）；报了即为缺 baseline |
| 5 | F5 刷新 | 刷新已有产物的会话 | 同 #4，一条都不报 |
| 6 | 快速切会话 | write 完成后 2s 以上再切走 | 正常上报（<1.5s 切走属已知漏报） |
| 7 | 纯 edit | 「修改 test.md 第 1 行」 | **1 条**：`status:"modified"` |
| 8 | 并发污染 | insight 生成期间用 Make 模块产出文件 | Make 的文件不进 `artifact-output`，报 **1 条** `artifact-output-outside:{outside:1}` |
| 9 | **gitignore 忽略** | projectDir 为 git 仓且 `.gitignore` 含 `.octo/` | `diffs` 为空 → 不上报；确认与 `artifact-file-write` 的口径差异可解释 |
| 10 | **per-file 粒度** | 「一次创建 3 个文件」（write×3 或 bash 批量） | **3 条** `artifact-output`，面板行数=文件数（旧的聚合口径只显示 1，见 §9 决策 D2） |
| 11 | 同名覆盖写 | turn 内两次 write 同一文件 | 2 条（added + modified 各一），file 相同、status 不同——`group by messageId,file` 取最新即正确终态 |

以上 11 条均不依赖内网真实服务或数据（本地 worktree + mock tracker 即可复现），**无内网验证节**；上线后在内网按 `bun run dev:beta` 确认命中真实域名即可，属常规打点流程（见 [tracking.md](tracking.md)），不额外列。

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

未采纳但记录在案的建议：`artifact-` 前缀下 4 个事件口径互相重叠、需靠相减推断，分析侧难解释；更清爽的形态是**只留一个 turn 级事件、来源作维度进 extend**（`bySource: {write, edit, mcp, other}`）。改动面大，留待打点体系整体收敛时再议。
