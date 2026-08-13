# SPEC-INS-031 — Chat 历史会话迁移（设置里的一次性数据迁移）

> **上游已实现 ✗** —— octo 自加能力（chat 模块下线的收尾）。
>
> **前置**：[SPEC-INS-030 §6.1](../agents/insight-knowledge-search.md)（为什么不做读时合并、为什么改走显式迁移）。本 spec 只写「迁移功能怎么做」。
>
> **相关**：[SPEC-INS-013 会话列表服务端分页](../ui/insight-session-list-pagination.md)（迁移后要被它列出来）、[session-agent-attribution.md](session-agent-attribution.md)（`agent` 字段的归属语义）。
>
> **定位：临时功能。** 它服务于 chat → insight 的一次性搬家，**后续版本会整体下掉**。所有设计取舍都按「用完即弃」来做——不建新表、不加 schema、不做常驻的还原入口。

---

## 0. 结论锚点（2026-08-12）

- chat 会话在数据库里**本来就没有目录归属的语义**：chat 列表走 `session.list({ scope: "project" })`，服务端见到该 scope 就把 `directory` 条件整个丢掉、跨目录全展示。所以迁移不是「还原它原来的归属」，而是**给一批本来无家可归的会话安一个家**。
- 迁移动作 = 一条 UPDATE：`agent` → `octo_insight`、`directory` → 用户选的目录、**`project_id` → 该目录解析出的 project**（三个字段缺一不可，见 §3.1）。
- **不做「还原」按钮**；迁移前静默备份整个 db 文件，**备份文件本身就是迁移记录**，「重新迁移」直接从备份里读 `octo_ai` 的 id 集合（§5）。
- 入口：设置 → 通用设置 → **Proxy 栏目下方**，文件夹选择器 + 迁移按钮。

---

## 1. 背景与目标

chat 模块已下线（SPEC-INS-030 PR-C），其历史会话（`agent = 'octo_ai'`）留在库里，但 insight 列表按 `agent = 'octo_insight'` **且** `directory = 选中目录` 严格过滤，故一条都看不到。

**目标**：给用户一个显式动作，把这批历史搬进 insight，搬完就是正常的 insight 会话——列表能列出、能打开回看，列表侧不需要任何特例。

**非目标**：
- 不搬文件。chat 会话没有 insight 的 `.octo/<sessionId>/{uploads,outputs}` 布局，迁移后文件管理面板是空的——**这是本来就没有**，不是迁丢了。文件管理有现成空态，UI 上不额外提示。
- 不改写入口径：新建会话永远是 `octo_insight`。
- 不迁 `agent IS NULL` 的老数据（§3.2）。

---

## 2. 交互（已与设计师对齐）

位置：`settings-general.tsx` 的 `ProxySection` **下方**新增一节「Chat 历史会话迁移」。

```
Chat 历史会话迁移
┌─────────────────────────────────────────┬────────┐
│ /Users/xxx/Documents/用研项目            │ 选择…  │   ← 文件夹选择器
└─────────────────────────────────────────┴────────┘
                                        [ 开始迁移 ]
```

- **文件夹选择器**：默认填当前全局选中的目录（`useProjectDir()`），可二次修改。走现成的 `platform.openDirectoryPickerDialog`（同文件 line 348 已在用，无需新增 IPC）。
- **迁移按钮**：点击即执行，执行中禁用并显示进行态（对齐同页 `proxyConfiguring` 的写法）。
- **结果反馈全部走全局 toast**，不新增结果面板：
  - 成功：`已迁移 N 条 Chat 历史会话到 <目录名>`
  - 无可迁移数据：`没有需要迁移的 Chat 历史会话`
  - 失败：`迁移失败：<原因>`（事务已回滚，数据未变）
- **重新迁移**：备份存在且其中有 `octo_ai` 记录时，按钮文案变为「重新迁移」，语义见 §5.2。

> 文案按「这段话会被真实用户看到」来写，不用「脚本」「回填」「UPDATE」这类内部词。

---

## 3. 数据契约

### 3.1 三个字段缺一不可

| 字段 | 迁移后写什么 | 不写会怎样 |
|---|---|---|
| `agent` | `'octo_insight'` | 列表按 agent 过滤，查不到 |
| `directory` | 用户选中的目录（**服务端 resolve 后的绝对路径**，与建会话时同一套解析） | 列表按 directory 过滤，查不到 |
| `project_id` | **目标目录解析出的 project id** | **最隐蔽的坑**：列表是 `project_id` **和** `directory` 同时过滤的，只改 directory 会静默失败——提示「迁移成功 N 条」但列表里一条没有 |

**`project_id` 与目录不是一一对应，是多对一**（`project/project.ts` `fromDirectory`）：

- 目录（向上找）**没有 `.git`** → `id = ProjectID.global`、`worktree = "/"`。**所有非 git 目录共用同一个 `global`** —— 设计同学选的多半是普通文件夹，实际上大部分会话的 `project_id` 都是这个值。
- 有 `.git` → id 取自 git common dir 的缓存 id，**同一个仓库的多个子目录 / worktree 共用一个 project_id**。

所以迁移必须**走服务端的目录→project 解析**拿 id，不能凭客户端猜、也不能沿用原值。

**其余字段一律不动**，理由：

- `path` / `workspace_id`：`listInsightSessions` 不看这两列（它只过滤 `project_id` + `directory` + `agent`）。chat 会话这两列通常为 null，动它反而引入未知。
- `title` / `slug` / `time_*` / 消息与 parts：迁移只改归属，**不碰一个字的对话内容**。

### 3.2 迁移范围

```sql
WHERE agent = 'octo_ai'
```

- **只迁 `agent = 'octo_ai'`** —— 即 chat 当年明确会显示出来的那批（chat 侧栏正是 `data.filter(s => s.agent === "octo_ai")`）。
- **不迁 `agent IS NULL`**：那是更早的老数据，chat 自己也没显示过，迁进来等于凭空冒出一批用户不认识的会话。
- 不迁子会话？—— **迁**。`parent_id` 非空的 task 子会话跟着父会话走（insight 列表本就不加 roots 过滤，见 SPEC-INS-013）；但它们的 agent 通常不是 `octo_ai`，因此实际上不会被上面的条件选中，无需特殊处理。

### 3.3 事务与幂等

- 整个迁移（备份 → UPDATE）跑在**单个事务**里，任一步失败整体回滚，数据保持迁移前状态。
- 幂等：迁完再点，`WHERE agent = 'octo_ai'` 命中 0 条 → toast「没有需要迁移的 Chat 历史会话」，不报错。

---

## 4. 实现落点

### 4.1 服务端接口（⚠️ 先看这条再动手）

本仓开发/预览渠道**默认启用 `OPENCODE_EXPERIMENTAL_HTTPAPI`**，`server/routes/instance/*.ts` 那批「看起来是 Hono 路由」的模块在当前后端选择下**根本不被调用**。

- 接口加在**类型化 Effect HttpApi** 的 `insight` 分组：`server/routes/instance/httpapi/groups/insight.ts` + `handlers/insight.ts`（该分组已存在，扩展即可）。
- 症状预警：照抄 Hono 写法的话，现象是「新接口 404」，然后会一直怀疑是不是没重启——**重启多少次都救不了**。详见 learning [hono-vs-effect-httpapi-routing.md](../../learning/hono-vs-effect-httpapi-routing.md)。
- 新增服务端路由**必须重启 sidecar / opencode server 才生效**，本地验证前先重启。

建议接口形状（两个，都在 `insight` 分组）：

| 接口 | 入参 | 出参 | 用途 |
|---|---|---|---|
| `chatMigration.preview` | `{ directory }` | `{ pending, migratable }` | 进设置页时查一次：`pending` = 当前库里 `agent='octo_ai'` 的条数；`migratable` = 备份里可重迁的条数（§5.2）。驱动按钮文案与禁用态 |
| `chatMigration.run` | `{ directory }` | `{ migrated, backupPath }` | 执行迁移 |

### 4.2 前端

- `settings-general.tsx` 新增一节，复用同文件既有的 section 写法与 `platform.openDirectoryPickerDialog`。
- 迁移成功后要让 insight 列表看到新数据：现有列表已监听 `session.created/updated/deleted` 事件做 refetch。迁移走的是直接 UPDATE、不经过 session 服务，**不会自动发事件** —— 两个选择：迁移后由服务端 publish 一次 `session.updated`，或前端迁移成功后主动 refetch。**推荐前者**（权威侧发事件，和列表现有机制同源）。

### 4.3 日志

统一前缀 `[octo:chat-migrate]`（新增前缀要同步 [insight-debugging.md](../../insight-debugging.md) 的日志字典）：

- `preview`：`{ pending, migratable, directory }`
- `backup`：`{ from, to, bytes }`
- `run`：`{ directory, projectID, matched, migrated }`
- `failed`（error）：`{ stage, error }`，`stage ∈ backup | resolve-project | update`

---

## 5. 备份与「重新迁移」

### 5.1 为什么不做「还原」按钮

先说业界的普遍形态：**改本地数据的迁移，标配是「迁移前自动备份 + 迁移批次记录」，而不是在 UI 上放一个「还原」按钮**。还原按钮是低频高风险代码，平时没人测，它自己也会出 bug；备份文件加一份恢复说明，成本低一个量级。

更关键的是一个**陷阱**：**整库还原会把迁移之后新产生的会话一起抹掉**。用户如果过几天才想还原，代价远大于收益。所以整库备份只适合「迁移过程本身崩了」这种灾难恢复，**不适合**用来覆盖「用户后悔了」。

而这次迁移的语义损失本来就极小：只改归属三字段，对话内容一字不动，chat 又本来没有目录归属（§0）。用户唯一现实的后悔场景是**目录选错了**——而这个场景的正解不是「还原」，是**再迁一次**。

### 5.2 备份文件即迁移记录

- **迁移前把 db 文件整体复制一份**：`opencode.db` → `opencode.db.chat-migrate-bak-<时间戳>`（渠道库同理，文件名见 `storage/db.ts` 的 `getChannelPath`）。**静默执行、不暴露成 UI**，只作灾难恢复。
- **不新建表、不加 schema**：备份库里 `agent = 'octo_ai'` 的那批 id，天然就是「哪些会话是迁过来的」这份记录。
- **重新迁移** = 从备份库读出该 id 集合 → 在当前库里按这批 id 再写一次 `directory` + `project_id`（`agent` 已是 `octo_insight`，保持不变）。
- **确定性规则（避免二次备份把记录冲掉）**：
  - 备份文件名带时间戳，**不覆盖**；
  - 「可重迁的来源」固定取**最早的那份** `chat-migrate-bak-*`（它才含 `octo_ai` 记录；第二次迁移时当前库里已经没有 `octo_ai` 了，那时的备份是空记录）。
  - 实现上更稳的写法：**只在首次迁移时备份**（备份文件已存在就跳过），这样「最早一份」和「唯一一份」是同一个，规则无歧义。**推荐这条**。

### 5.3 磁盘代价（要在实现时确认）

`opencode.db` 含全部消息与 parts，重度用户可能不小。整库复制是 O(库大小) 的一次性磁盘占用。

- 迁移前先看一眼文件大小并记进 `[octo:chat-migrate] backup` 日志。
- 若实测普遍偏大（比如超过数百 MB），再评估是否改成「只备份 session 表的相关行到一个小 sqlite / json」——但那等于自建记录，与「不加 schema」的取舍冲突，**没有实测数据前不要提前优化**。

### 5.4 迁错了怎么办（给用户的答案）

- **目录选错** → 直接「重新迁移」，选对目录再点一次。
- **压根不想要这批历史** → 在 insight 列表里手动删除。本功能不提供批量撤销。

---

## 6. 验证

### 6.1 外网可复现

前置：`bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>`（**改了服务端路由必须重启**）。造数据：直接往 db 里插几条 `agent='octo_ai'` 的会话，`directory` 故意分散到 2~3 个不同目录（模拟 chat 跨目录的真实分布）。

| # | 场景 | 步骤 | 通过判据 |
|---|---|---|---|
| V1 | 迁移前不可见 | 造完数据，进 insight 列表 | 一条 chat 会话都看不到（SPEC-INS-030 §6.1 的现状） |
| V2 | 预览计数 | 打开设置 → 通用 → Chat 历史会话迁移 | 显示的待迁移条数 = 库里 `agent='octo_ai'` 的条数，**与 directory 无关**（跨目录的也算上） |
| V3 | 默认目录 | 打开该设置项 | 文件夹选择器默认填当前全局选中目录；点「选择…」能改 |
| V4 | **迁移生效** | 选一个目录 → 开始迁移 | toast 报出条数；切到该目录的 insight 列表，**全部** chat 会话可见、按更新时间倒序 |
| V5 | **`project_id` 有没有跟着改**（最容易静默失败的一条） | 选一个**与原会话不同 project** 的目录迁移（例如原来在非 git 目录、这次选一个 git 仓库） | 列表里能看到。若 toast 说成功但列表为空 = `project_id` 没写，回 §3.1 |
| V6 | 对话内容不丢 | 打开任一迁移过来的会话 | 原对话文本一字不丢；工具调用走兜底渲染（「调用了 xxx」）；**不报错、不白屏** |
| V7 | 文件面板空态 | 同 V6，看文件管理 | 空态，不报错（chat 本来就没有 `.octo` 布局） |
| V8 | 幂等 | 再点一次迁移 | toast「没有需要迁移的 Chat 历史会话」，不报错、数据不变 |
| V9 | **重新迁移** | 换一个目录点「重新迁移」 | 同一批会话出现在新目录；旧目录列表里不再有它们 |
| V10 | 备份存在且只备一次 | 看数据目录 | 有且仅有一个 `chat-migrate-bak-*` 文件（第二次迁移不再新增）；`[octo:chat-migrate] backup` 记录了大小 |
| V11 | 失败回滚 | 传一个不存在 / 无权限的目录 | toast 明确报错；库里 `agent='octo_ai'` 条数不变（事务回滚） |
| V12 | 不越界 | 迁移后检查 `agent IS NULL` 的老会话 | 未被改动（§3.2） |
| V13 | 列表自动刷新 | 迁移成功后不手动刷新页面 | insight 列表自己更新出新会话（§4.2 的事件/refetch） |

### 6.2 内网验证

| # | 场景 | 通过判据 |
|---|---|---|
| N1 | **真实历史底线验证**（承接 SPEC-INS-030 §6 那条必做项） | 迁移一批**真实 chat 会话**（含 bash/edit/write 调用、含 ```html fence 的回答）后逐条打开：不报错、不白屏、原文一字不丢。html fence 被嗅探成预览卡属**可接受降级**（不丢原文） |
| N2 | 真实分布 | 迁移前先跑 §6.3 那条 SQL 记下分布，迁移后核对条数一致（无遗漏、无重复） |
| N3 | 迁移后可继续对话 | 在迁移过来的会话里再发一条消息：正常回复，且此时 agent 已是 `octo_insight`，**knowledge_search 等 insight 能力可用** |
| N4 | 库规模 | 记录 `[octo:chat-migrate] backup` 的 `bytes`，作为 §5.3 是否需要优化的判据 |

### 6.3 先量数据（做之前先跑）

库文件：`opencode.db`（非 latest/beta/prod 渠道为 `opencode-<渠道>.db`）。

- **内网 Windows / PowerShell**：`sqlite3 "$env:LOCALAPPDATA\opencode\opencode.db" "<SQL>"`
- **本地 Mac**：`sqlite3 ~/.local/share/opencode/opencode.db "<SQL>"`

```sql
SELECT project_id, directory, COUNT(*) AS n, MAX(time_updated) AS latest
FROM session WHERE agent = 'octo_ai'
GROUP BY project_id, directory ORDER BY n DESC;
```

这条结果决定两件事：迁移功能值不值得做（历史量），以及 §5.3 的备份代价。

---

## 7. 退场

本功能是临时的。下线时机与做法：

- 内网用户完成迁移、确认无遗漏后的下一个版本，**整节 UI + 两个接口一起删**。
- 因为没有建表、没有加 schema，删代码即完事，不留迁移债。
- 备份文件不主动清理（用户可自行删除），但在退场那版的发布说明里提一句它在哪。
