# SPEC-INS-013 — Insight 会话列表服务端分页（insight 专用接口）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 ui/insight + infra/session · 类型：架构 + 实现 spec
>
> 上游已实现：✗ 无（新增 insight 专用 server 端点）；复用 ✓ `HttpApiGroup` 独立成组模式（见 `groups/studio.ts`）、✓ `SessionTable.agent` 一等字段（[SPEC session-agent-attribution](../infra/session-agent-attribution.md) D1）、✓ 前端「加载更多」分页范式（UXAI `packages/app/src/pages/layout/sidebar-workspace.tsx`）
>
> 前置：[SPEC session-agent-attribution](../infra/session-agent-attribution.md) §10 已预留本项——「`session.list` 服务端按 agent 过滤的 API（本期前端做过滤即足；未来如果 sessions 数量极大，再考虑服务端过滤减负）」。本 spec 即该后续，但**收敛为 insight 专用、不做通用 agent 参数**。
>
> 关联代码（UXAI 仓）：`packages/app/octoapp/pages/insight/components/session-list/index.tsx`（前端）、`packages/opencode/src/server/routes/instance/httpapi/**`、`packages/opencode/src/session/**`（服务端）。

---

## 1. 背景与问题

### 1.1 现状

全部 octo 模块（insight / make / studio / pattern）共用同一个 `GET /session`，**agent 过滤全在前端**：

| 模块 | 过滤 |
|---|---|
| insight | `s.agent === "octo_insight"`（`session-list/index.tsx`） |
| make | `s.agent === "octo_make"` |
| studio | `s.agent === "octo_studio"` |
| pattern | `s.agent === "proto_triage"` |

服务端查询统一走 `listByProjectWithCategory`（`session/session-category-query.ts`）：

```sql
WHERE project_id = ? AND directory = ?
ORDER BY time_updated DESC
LIMIT 100            -- input.limit ?? 100，默认 100
```

### 1.2 Bug：会话超 100 后最早的看不到

`limit` 与排序在**服务端**，agent 过滤在**前端**，顺序是「先 limit 100、再前端筛 agent」。后果：

1. 某目录会话总数（**跨所有 agent**）超过 100 时，按 `time_updated` 排在 100 名开外的最早会话**不再返回** → insight 侧栏看不到（**数据不丢，DB 行仍在**，只是不显示）。
2. 更隐蔽：因为 100 的天花板是**跨 agent**算的，即使 insight 会话本身不到 100 条，只要同目录有大量 chat/make 会话占满前 100，insight 较早的会话也会在「前端筛之前」被截断。

侧栏无分页 / 无加载更多，越过天花板的会话**永久不可见**。

### 1.3 为什么不能纯前端修

「前端把 limit 调大 / 加载更多重拉」方案有硬伤：若新拉回的一批全是别的 agent 的 session，insight 列表一条不增，用户反复点「加载更多」也可能长时间刷不出更早的 insight 会话——**先 limit 再筛 agent 的顺序错了**。必须**服务端先按 agent 过滤、再分页**。

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **新建 insight 专用端点**，不往共享 `session.list` 加通用 `agent` 参数 | 用户定调「各 agent 单独维护、新接口减少对其他模块影响」。共享端点虽可用可选参数（`category` 先例）零影响其他模块，但本期选物理隔离：新端点不碰 `session` 组源码，爆炸半径最小 |
| D2 | 端点**独立成组** `HttpApiGroup.make("insight")`，照 `groups/studio.ts` 样板，独立 `groups/insight.ts` + `handlers/insight.ts` | studio 已是 octo 专属模块独立成组的活先例；session 组一行不动 |
| D3 | 查询**硬编码** `agent = "octo_insight"`，不暴露 agent 入参 | insight 专用，非通用。`WHERE ... AND agent = 'octo_insight'` |
| D4 | 作用域 = `project_id`(取自 instance context) + `directory`(query 参数)，与现有 list 一致；**不加 `roots` 过滤** | 跟随所选目录（[SPEC-INS-012](insight-directory-scoping.md)）；不过滤 parent 以保留 task 子会话可见（attribution §B-1 修复成果） |
| D5 | 分页用 **limit-grow + total 计数**：返回 `{ items, total }`，前端持一个 `limit`、点加载更多 `limit += step` 重拉，`hasMore = items.length < total` | 镜像上游 `sortedRootSessions` + `sessionTotal` 范式，最简且健壮（列表中途变动不串页）；offset/cursor 游标留给性能期（§7） |
| D6 | 排序 `time_updated DESC`，与现状一致 | 行为不变 |
| D7 | **不做索引优化**（`(project_id, directory, agent, time_updated)` 复合索引）本期不加 | 用户明确性能优化归后续阶段；现量级走现有 `session_project_idx` 够用，见 §7 |

## 3. 接口契约

### 3.1 端点

```
GET /insight/sessions?directory=<dir>&limit=<n>&offset=<m>
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `directory` | string | 是 | 所选目录（= `useProjectDir()`）。缺省回退 instance context 的 cwd |
| `limit` | number | 否 | 本次返回上限。缺省 `100` |
| `offset` | number | 否 | 跳过条数。缺省 `0`。limit-grow 范式下前端可恒传 0、只增 limit；保留 offset 给后续追加式加载 |

### 3.2 响应

```jsonc
{
  "items": [ /* Session.Info[]，已按 time_updated DESC 排序、已限定 agent=octo_insight + directory */ ],
  "total": 137   // 该 (project + directory + agent=octo_insight) 下的会话总数（COUNT(*)，不受 limit 影响）
}
```

- `total` 用于前端精确判断 `hasMore`（`items.length < total`），替代「返回数 === limit 才可能还有」的猜测。
- `items` 元素 schema 完全复用 `Session.Info`（不另造类型）。

## 4. 服务端实现

### 4.1 查询函数（新文件，解耦 SQL）

`packages/opencode/src/session/session-insight-query.ts`（新建）：

```ts
import { and, desc, eq, sql } from "drizzle-orm"
import { Database } from "../storage/db"          // 按实际导出路径校准
import { SessionTable } from "./session.sql"
import { fromRow } from "./session"               // 复用现有 row→Info 映射；若未导出则在本文件内联同款映射
import type { ProjectID } from "../project/schema"

const INSIGHT_AGENT = "octo_insight"

export function listInsightSessions(input: {
  projectID: ProjectID
  directory: string
  limit: number
  offset: number
}): { items: ReturnType<typeof fromRow>[]; total: number } {
  const conditions = [
    eq(SessionTable.project_id, input.projectID),
    eq(SessionTable.directory, input.directory),
    eq(SessionTable.agent, INSIGHT_AGENT),
  ]

  return Database.use((db) => {
    const total = db
      .select({ n: sql<number>`count(*)` })
      .from(SessionTable)
      .where(and(...conditions))
      .get()?.n ?? 0

    const rows = db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated))
      .limit(input.limit)
      .offset(input.offset)
      .all()

    // 复用 session-category-query 的「坏行跳过」兜底：单行 schema 解码失败不整页崩
    const items: ReturnType<typeof fromRow>[] = []
    for (const row of rows) {
      try { items.push(fromRow(row)) } catch { /* skip bad row, log */ }
    }
    return { items, total }
  })
}
```

> 注：`Database.use` / `fromRow` 的确切导入路径以实现时源码为准（`session.ts` 内 `fromRow` 当前未导出 → 实现时择一：导出它，或在本文件内联同款映射，避免改 `session.ts` 公共面）。坏行跳过逻辑对齐 `session-category-query.ts:99-105`。

### 4.2 路由组（新文件）

`packages/opencode/src/server/routes/instance/httpapi/groups/insight.ts`（新建，照 `groups/studio.ts`）：

```ts
const root = "/insight"
export const InsightPaths = { sessions: `${root}/sessions` } as const

const InsightSessionListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

const InsightSessionListResult = Schema.Struct({
  items: Schema.Array(Session.Info),
  total: Schema.Number,
})

export const InsightApi = HttpApi.make("insight").add(
  HttpApiGroup.make("insight")
    .add(
      HttpApiEndpoint.get("listSessions", InsightPaths.sessions, {
        query: InsightSessionListQuery,
        success: described(InsightSessionListResult, "Insight sessions page"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(OpenApi.annotations({
        identifier: "insight.sessions.list",
        summary: "List insight sessions (paged)",
        description: "List octo_insight sessions for a directory, agent-filtered server-side, with total count for pagination.",
      })),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
```

### 4.3 Handler（新文件）

`packages/opencode/src/server/routes/instance/httpapi/handlers/insight.ts`（新建，照 `handlers/studio.ts`）：

```ts
export const insightHandlers = HttpApiBuilder.group(InstanceHttpApi, "insight", (handlers) =>
  Effect.gen(function* () {
    const listSessions = Effect.fn("InsightHttpApi.listSessions")(function* (ctx) {
      const instance = yield* InstanceState.context
      return listInsightSessions({
        projectID: instance.project.id,
        directory: ctx.query.directory ?? instance.directory,
        limit: ctx.query.limit ?? 100,
        offset: ctx.query.offset ?? 0,
      })
    })
    return handlers.handle("listSessions", listSessions)
  }),
)
```

### 4.4 注册（2 处既有文件，仅 +import +1 行，不改既有路由）

| 文件 | 改动 |
|---|---|
| `httpapi/api.ts` | `import { InsightApi } from "./groups/insight"` + `InstanceHttpApi` 链上 `.addHttpApi(InsightApi)` |
| `httpapi/server.ts` | `import { insightHandlers } from "./handlers/insight"` + 加入 handlers 数组（`studioHandlers` 旁，约 `server.ts:121-126`） |

### 4.5 SDK 重新生成

服务端 schema 变了，跑 `./packages/sdk/js/script/build.ts`（或 `bun run` 对应脚本），让前端拿到 `client.insight.listSessions({ directory, limit, offset })` 与 `{ items, total }` 类型。

## 5. 前端实现（UXAI `session-list/index.tsx`）

把 `createResource` 的取数从 `session.list({directory})` + 客户端 `.filter(agent)` 换成新端点：

1. source 改为 `() => ({ dir: projectDir(), limit: limit() })`；新增 `const [limit, setLimit] = createSignal(100)`。
2. 切目录重置：`createEffect(on(projectDir, () => setLimit(100), { defer: true }))`。
3. fetcher：`const { data } = await client.insight.listSessions({ directory: dir, limit })` → 存 `{ items: data.items, total: data.total }`；**删掉**前端 `.sort` + `.filter(s => s.agent === INSIGHT_AGENT)`（服务端已做）。失败兜底仍 `info.value ?? { items: [], total: 0 }`。
4. `reconcile` 仍按 `items` 喂 `sessionList`（行引用稳定逻辑不变）。
5. `hasMore = () => sessionList.length < (sessions()?.total ?? 0)`。
6. 列表底部加「加载更多」按钮：`onClick` → `setLimit(n => n + 100)` 触发重拉；`loading` 时显示「加载中…」。首屏骨架条件改 `!sessions.loading || sessionList.length > 0`，避免加载更多时整列表闪骨架。
7. `_shell/sidebar.tsx`（若仍在用的旧侧栏副本，`session.list`+`filter` 同款）一并同步或确认已废弃。

打点：新增 `interaction / insight / session-load-more`（extend `{ limit }`），并同步 UXAI `packages/app/octoapp/pages/insight/docs/tracking.md` 追加条目（项目 CLAUDE.md 强制）。

## 6. 治理与落地流程（重要）

服务端改动落在 `packages/opencode/**` + `packages/sdk/**`，属 UXAI CLAUDE.md「不动上游核心」区、且两仓 **rsync**（见 [intranet-handoff.md](../intranet-handoff.md) 与 attribution §6）。流程：

1. 本 spec 合入 octo-agent。
2. 服务端 + SDK 改动走 **intranet-handoff 非绿灯流程**（碰 opencode 核心），落到 opencode 规范源，**显式通知 UXAI 同步**——否则只有前端改动 rsync 过去、内网 server 没有 `/insight/sessions` 端点，前端调用 404。
3. 前端 `session-list` 改动随 UXAI 仓 PR。
4. **顺序**：后端端点必须**先于**前端切换到位（同 attribution §6「schema 先于前端」教训）。

## 7. 不在本期范围（→ 性能阶段 C）

- **复合索引** `(project_id, directory, agent, time_updated)`：会话量极大时 `ORDER BY time_updated DESC LIMIT/OFFSET` 的扫描代价。现走 `session_project_idx`，量级未到瓶颈再加。
- **游标分页**：offset 在列表中途插入新会话时有跳/重风险。本期 limit-grow + total 对侧栏够用；高频大列表再换 keyset（`time_updated` 游标）。
- **虚拟滚动**：纯前端渲染优化（DOM 行数），与本 spec 的「数据可见性」正交。当前几百行 DOM 非瓶颈，不做。
- **通用 `agent` 参数 / 其他模块复用**：本期 insight 专用。make/studio/pattern 同款 bug 若要修，另起（可届时再评估是否抽通用，D1 已记录权衡）。

## 8. 验收

1. 构造某目录下 insight 会话 > 100 条（或同目录混入大量其他 agent 会话把 insight 较早会话挤出旧的 100 窗口）：切到该目录，侧栏首屏显示最近 100 条 insight 会话，底部出现「加载更多」。
2. 点「加载更多」→ 追加显示更早的 insight 会话；点到底 `items.length === total` 后按钮消失。
3. 列表**只含** `agent=octo_insight`，不串入 chat/make/studio 会话；task 子会话（继承父 agent）仍可见。
4. 切换目录：`limit` 重置、从该目录重新拉第一页，不串台（[SPEC-INS-012](insight-directory-scoping.md)）。
5. 其他模块（make/studio/pattern/chat）侧栏行为**完全不变**（未碰 `session` 组）。
6. `bun typecheck` + `bun --filter packages/app run build` 双门禁通过；新端点有最小 server 测试（参考 `test/server/session-list.test.ts`）。

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 前端切到新端点但内网 server 未部署该端点 → 404 列表空 | §6 顺序约束（后端先行）；前端 fetcher 失败兜底保留上次列表、不崩页 |
| `count(*)` 与分页查询两次扫描的一致性（中途有写入） | 侧栏容忍轻微不一致；total 仅驱动「是否还有更多」，偏差不致命 |
| rsync 只带前端不带后端 | §6 PR description 标红 + 显式通知，复用 attribution 同款教训 |
| offset 翻页时列表插入新会话致跳/重 | 本期 limit-grow 恒 offset=0 只增 limit，规避；offset 仅为后续预留 |
