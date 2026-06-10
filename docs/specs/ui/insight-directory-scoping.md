# SPEC-INS-012 — Insight 对话目录归属（跟随所选目录）

> 状态：已落地 · 优先级 P0 · 规模 [S] · 领域 ui/insight
>
> 上游已实现：✓ scoped `SDKProvider` / `useSDK()` 注入 directory；✓ `useProjectDir()` 全栈目录抽象；✗ 无新增上游能力
>
> 配套订正：[learning/client-event-routing-by-directory.md](../../learning/client-event-routing-by-directory.md)（旧结论"event.directory=worktree、数据层改用 home"已证伪，按本 spec 重写）。
> 关联代码（UXAI 仓）：`packages/app/octoapp/pages/insight/index.tsx`、`.../components/session-list/index.tsx`、`.../components/result-viewer/index.tsx`。

---

## 1. 需求

Octo Insight 的对话要**跟随用户所选目录**：在所选目录新建对话、该目录的侧栏列表显示这些对话、切目录互不串台，且不白屏。

## 2. 服务端事实（理解方案的前提，已核对源码）

1. **`event.directory = AppFileSystem.resolve(客户端请求传入的 directory)`**，与 VCS worktree **无关**。
   - 链路：`server/routes/instance/httpapi/middleware/instance-context.ts`（`store.provide({ directory: route.directory })`）→ `workspace-routing.ts`（`?directory` / `x-opencode-directory` header，缺省 `process.cwd()`）→ `project/instance-store.ts` `boot`：`ctx.directory = input.directory`（worktree 另存 `ctx.worktree = result.sandbox`，但事件用的是 `ctx.directory`）。
   - `bus/index.ts` 发事件时带 `directory: InstanceState.directory`（= `ctx.directory`）。
2. 客户端按 `pathKey(event.directory)` 把事件路由到对应目录的 child store（`context/global-sync.tsx`），**命中不了就静默丢弃**。
3. `session.list` 默认（非 workspace）按 **`project_id` + `directory` 精确匹配** 过滤（`session/session.ts` `listByProject`）。会话还存 `path` 字段（相对 worktree 的相对路径）可做前缀过滤，insight 走默认 `directory` 过滤。
4. **对话 db 是全局单一 SQLite**：`Global.Path.data/opencode.db`（按发布 channel 分库，`storage/db.ts`）。**所选目录不改变 db 文件位置**，只决定会话行的 `project_id` / `directory` / `path` 字段。

## 3. 核心约束

要"跟随所选目录"，**三处目录必须用同一个值（= 所选目录 D）**，否则白屏或列表空：

| 触点 | 取值 |
| --- | --- |
| 数据/事件层（`SDKProvider` keyed dir + `DataProvider` directory） | `D` |
| 会话操作（create / promptAsync / abort / get） | `D` |
| 侧栏列表（`session-list` 的 `session.list({directory})`） | `D` |

`D` = `useProjectDir()`：insight 路由无 `:dir` → 取 `server.projects.last()`，回退 `home`。三处同源即一致。

## 4. 实现

1. **统一走 scoped `sdk.client`**：所有会话操作用 `useSDK().client`，目录用 `SDKProvider` 注入的 `sdk.directory`（= keyed 的所选目录）。
   - ⚠️ **关键坑**：不能用 `globalSDK.client` —— 它创建时**不带 directory**（`context/global-sdk.tsx`）。`promptAsync({sessionID})` 不带 directory 会让该轮跑在 `cwd`(= sidecar 启动目录 = home)实例，回复事件 `event.directory=home` 落到 home 的 store 而非所选目录 store → 聊天区收不到 → **白屏**。`home` 之前"能用"纯属 `cwd=home` 巧合。make/chat 无此 bug 正因其发送走 scoped sdk。
2. **数据层 keyed 在所选目录**：`<Show when={projectDir()} keyed>`，目录变化时整体重挂 SDK/Sync providers，状态干净。
3. **切目录跳新建空态**：用户切换项目目录时 `navigate("/insight")`，避免 url 停在上个目录的对话导致加载空/串台。
   - 切换信号用 `server.projects.last()`（**不含 home 兜底**）：启动期 `undefined→首个值` 因 `defer + prev 判空` 被跳过，不会冲掉"刷新保路由"的 boot-restore；仅真实切换（`D→E`）才跳。

## 5. 落点归属（"db 和文件放哪"）

- **对话记录（db）**：物理在**全局单库** `opencode.db`；逻辑上归属所选目录（`project_id` / `directory` / `path` 字段），据此决定出现在哪个目录的列表。
- **生成文件（MCP 产物 / 下载）**：物理落在 **`<所选目录>/.octo/downloads/`**（没选目录则 OS 临时目录，见 `result-viewer/index.tsx`）。

## 6. 历史坑（避免重蹈）

- ❌ 把白屏归因于 worktree、按 worktree 对齐数据层 → 仍白屏（`event.directory` 是请求传入的 directory，不是 worktree）。
- ❌ 数据层/建会话改回 `home` 修白屏（UXAI commit `e6131d184`）→ 白屏没了，但记录落到根目录（home），所选目录列表查不到。
- ✅ 真正根因是发送错用了不带 directory 的 `globalSDK.client`；改用 scoped `sdk.client` 后三处目录一致即彻底解决（UXAI commit `0adaae99f` / PR #45）。
