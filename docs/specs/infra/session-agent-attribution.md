# 会话 agent 归属字段化 — 修复幽灵对话与工具子会话不可见

> 状态:草案 · 优先级 P0 · 规模 [S] · 领域 infra/session · 类型:架构 + 实现 spec
>
> 触发:2026-06-04 内网用户机器 insight 侧栏出现两类异常对话;复盘后定位为 `Session` 缺 `agent` 字段 + `task` 工具未传 agent 的复合 bug。本期一并修复,**对所有 agent(insight / make / studio / 未来的 chat)统一生效**,不仅限 insight。

---

## 1. 背景 — 三类被合并修复的现象

| 类别 | 现象 | 根因 |
|---|---|---|
| **A. 幽灵对话** | 侧栏出现用户从未创建的对话(legacy / CLI / 其他 agent 跑出来的) | `session` 表无 `agent` 列;sidebar 走"无 agent 字段就放行"的降级过滤,导致**所有 agent=null 的存量数据无差别外泄** |
| **B-1. 工具子会话不可见** | 用户在对话中点击 task 卡片跳到新对话,但侧栏永远找不到 | [`tool/task.ts:69`](../../../packages/opencode/src/tool/task.ts#L69) `sessions.create({ parentID, ... })` **不传 agent**,虽然 line 138 `ops.prompt({ agent: next.name })` 已知 agent 名 |
| **B-2. 新建对话不出现** | 用户新建 insight 对话能聊,但侧栏不出现 | [`pages/insight/index.tsx:441`](../../../packages/app/src/pages/insight/index.tsx#L441) `createAndNavigate` 调 `session.create({ directory })` 漏传 agent |

三者**同源**:`Session` 没把 agent 作为一等字段,所有"归属 agent"的语义全靠下游 client 在过滤时猜。降级过滤+漏传组合在一起,2026-06-04 集中爆发。

## 2. 决策

| # | 决策 | 状态 |
|---|---|---|
| D1 | `Session` 加 `agent` 列(SQLite `agent TEXT`,可空),plumb 到 `CreateInput` / `Info` / `fromRow` / `toRow` / event payload | 锁定 |
| D2 | `task` 工具 spawn 子会话时**继承父会话 agent**(查 `ctx.sessionID` 的 agent 透传),不传子 agent 的 `name`——理由见 §5 | 锁定 |
| D3 | `session.fork` 继承原会话 agent | 锁定 |
| D4 | 业务侧 sidebar **strict 过滤** `s.agent === AGENT`;create 路径必须传 agent | 锁定 |
| D5 | 老数据 `agent IS NULL` 不做自动 backfill。strict 过滤后自然隐藏;影响仅限"上线前创建的没有 agent 的对话从侧栏消失",可接受。本地开发者可手动 SQL backfill | 锁定 |
| D6 | 取代 [SPEC-INS-010 §10.4](../ui/insight-standalone-extraction.md) 的"降级过滤"决策 — schema 上线后 octo-agent 与 UXAI 两仓**真·共用一份代码**,无需 fork-only 分叉 | 锁定 |
| D7 | 不动 v2 `Session.CreateInput` / `Session.Info`(v2 是后续重构线,暂不涉入);本期所有修复落在 v1 `session/session.ts` + 直接消费它的 `task.ts` / 业务侧 | 锁定 |
| D8 | 对所有 agent 生效(insight 立即受益;make 已正确传 agent,无需改动;未来 chat / studio 接入时直接享有) | 锁定 |

## 3. Schema 变更

### 3.1 加列

[`packages/opencode/src/session/session.sql.ts`](../../../packages/opencode/src/session/session.sql.ts) `SessionTable` 在 `permission` 之后追加:

```ts
agent: text(),
```

### 3.2 迁移

```bash
cd packages/opencode
bun run db generate --name add_agent_to_session
```

生成 `ALTER TABLE session ADD COLUMN agent TEXT;` 迁移。老数据 `agent IS NULL`。

## 4. 代码改动清单(精确 diff 位置)

| # | 文件 | 行 | 改动 |
|---|---|---|---|
| **a** | `session/session.sql.ts:17-30` | +1 | `agent: text(),` |
| **b** | `session/session.ts:50` `fromRow` | +1 | `agent: row.agent ?? undefined,` |
| **c** | `session/session.ts:84` `toRow` | +1 | `agent: info.agent,` |
| **d** | `session/session.ts:118` `Info` zod | +1 | `agent: z.string().optional(),` |
| **e** | `session/session.ts:180` `CreateInput` zod | +1 | `agent: z.string().optional(),` |
| **f** | `session/session.ts:332` `Interface.create` 入参类型 | +1 | `agent?: string` |
| **g** | `session/session.ts:391` `createNext` 入参类型 | +1 | `agent?: string` |
| **h** | `session/session.ts:400` 构造 `result: Info` | +1 | `agent: input.agent,` |
| **i** | `session/session.ts:515` `create` 透传到 `createNext` | +1 | `agent: input?.agent,` |
| **j** | `session/session.ts:532` `fork` createNext 调用 | +1 | `agent: original.agent,` |
| **k** | `tool/task.ts:69` `sessions.create({...})` | +2 | 先 `const parent = yield* sessions.get(ctx.sessionID)`,再加 `agent: parent.agent,` |
| **l** | `app/src/pages/insight/index.tsx:441` `createAndNavigate` | +1 | `agent: "octo_insight"` 加入 `session.create` 入参 |
| **m** | `app/src/pages/insight/components/session-list/index.tsx:64` | -1/+1 | `data.filter((s) => s.agent === AGENT)`(去掉 `!s.agent ||` 降级分支) |

**SDK 重新生成**:服务端 schema 变了,跑 `./packages/sdk/js/script/build.ts` 让前端类型同步。

**总计:13 处小改 + 1 个 migration + SDK 重生成**。

## 5. §D2 取舍 — task 子会话为什么继承父 agent

[`tool/task.ts:69`](../../../packages/opencode/src/tool/task.ts#L69) spawn 子会话时知道两个 agent 名:

- `next.name` = 子会话**类型**(`explore` / `general` / 用户自定义 subagent type)
- `ctx.sessionID` 所属会话的 agent = **父 agent**(`octo_insight` / `octo_make` / ...)

两种选择:

| 方案 | 子会话 `agent` 值 | 用户体感 |
|---|---|---|
| X1. 传 `next.name` | `"explore"` / `"general"` | 子会话归 subagent 自己的虚拟 sidebar(实际无 UI),**测试同学反馈的"找不到"问题不解决** |
| **X2. 传父 agent**(本期采纳) | 继承父会话(如 `"octo_insight"`) | 子会话归属父 agent sidebar,点击 task 卡片跳过去也能在侧栏找到,**真正解决** B-1 |

子会话类型(`explore` 等)是工具实现细节,不该作为用户分类语义。**X2 是用户语义,X1 是工程语义,本场景用户语义优先**。

将来若有强需求区分(例如 task subagent 列表),可加单独 `subagent_type` 列,与 `agent` 并存,不冲突本期决定。

## 6. 与上游 / fork 关系

- 给老 `session.ts` 加 `agent` 字段**不是 fork-only 私货**:agent 是 Claude Code / Cursor / opencode 共有的一等概念,只是上游 v1 当年没字段化。这次补全是对 `agent` 概念的去除欠债,**符合"reference implementation"定位**
- v2 `Session.CreateInput` / `Session.Info` 也缺 agent,但 v2 是独立重构线([D7](#2-决策)),本期不动。后续 v2 落地时同步补上,**不在本期范围**
- **UXAI 同步**:本期改动落在 `packages/opencode/src/**` 与 `packages/app/src/pages/insight/**`,前者属"非绿灯"区(碰 opencode 核心),走 [intranet-handoff.md](../../intranet-handoff.md) **非绿灯流程**;后者随 §1.1 自动 rsync。建议:本仓本 spec 合入后,**显式通知 UXAI 同步,把 schema 改动一并合入** — 否则只有 UI 改动到了内网而 schema 不带过去,内网 server 仍没 agent 列,strict 过滤会让内网侧栏全空

## 7. SPEC-INS-010 关联修订

本期上线后,**回写** [SPEC-INS-010](../ui/insight-standalone-extraction.md):

- §9 PR1 "已取消补 agent" → 改回"已实施(本 spec D4 锁定)"
- §10.4 / §11.3 D11 "降级过滤"取消,改为 strict 过滤,引用本 spec D6
- §D8 状态从"调整"改回"锁定"

## 8. 验收

1. **A 类**:本机 `~/.local/share/opencode/opencode-*.db` 里 `UPDATE session SET agent='octo_insight' WHERE agent IS NULL AND directory=<home> AND parent_id IS NULL`(开发者本地;不下发用户),侧栏只剩 insight 真数据,无幽灵
2. **B-1**:insight 中调 `task` 工具(让 AI 写 "请用 task 子代理调研 xxx"),子会话**在 insight 侧栏可见**;点 task 卡片跳过去能看到新条目
3. **B-2**:点"新建"→ 跳空页 → 发首条消息 → 侧栏出现该条
4. typecheck (`bun typecheck`) + build (`bun --filter packages/app run build`) 双门禁通过
5. 内网 UXAI 同步合入后,用户机器幽灵对话从侧栏消失(后端 schema 必须先于前端到位,见 §6)

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 上线后老 session 全部从侧栏消失,用户感觉"对话没了" | D5 已声明可接受;**消失 ≠ 删除**,DB 行还在,SQL backfill 1 行可救回任意子集 |
| migration 在用户机器上失败 | `ALTER TABLE ADD COLUMN` 是 SQLite 兼容操作,几乎不会失败;Drizzle migrator 失败会回滚事务,DB 仍可用 |
| UXAI 只合 UI 不合 schema | §6 已警告;PR description 显式标红 |
| v2 路径用户(若有)看不到此 agent 字段 | v2 当前未上 (`Session.create` 仍 `throw new Error("Not implemented")`,见 [v2/session.ts:44](../../../packages/opencode/src/v2/session.ts#L44)),无实际影响 |

## 10. 不在本期范围

- v2 模块的 schema 改动(D7)
- JsonMigration / channel DB 的 marker 文件 bug(由其他同学的工单处理,与本 spec 独立;本 spec 的 strict 过滤是兜底机制,他们修不修都不影响本期效果)
- `session.list` 服务端按 agent 过滤的 API(本期前端做过滤即足;未来如果 sessions 数量极大,再考虑服务端过滤减负)
- subagent 类型(`subagent_type`)独立字段(§5 末)
