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

### 1.1 ⚠️ 前置：dev 上还留着「路径 B 读时合并」，本 PR 要一并撤掉

[SPEC-INS-030 §6.1](../agents/insight-knowledge-search.md) 已定不做读时合并，但 **UXAI #634 实际合入的是撤销前的版本**（`a6b2581e5`，撤销版 `ba509cddf` 未被合入）。故 dev 当前仍是「chat 历史在当初创建它的那个目录下可见」的半可见状态。

**本 PR 的第一件事就是撤掉它**（四处，撤完与 `dev` 之前的行为一致）：

| 文件 | 撤什么 |
|---|---|
| `packages/opencode/src/session/session-insight-query.ts` | `LISTED_AGENTS` + `inArray(...)` → 恢复 `eq(SessionTable.agent, "octo_insight")`；保留说明「为什么不开这个口子」的注释 |
| `packages/app/octoapp/constants/agent.ts` | 删 `INSIGHT_LISTED_AGENTS` |
| `packages/app/octoapp/pages/_shell/sidebar.tsx` | 过滤恢复 `s.agent === INSIGHT_AGENT` |
| `packages/app/octoapp/pages/insight/components/session-list/index.tsx` | 同上 |

**不单独提 PR 撤**：先撤后做会有一段「chat 历史彻底不可见」的中间态，比现状更差；撤 B 与上迁移本就是同一件事的两面。

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
  - 成功：标题 `已迁移 N 条 Chat 历史会话到 <目录名>`，附带一行 `迁移前的数据已备份到 <备份路径>，确认无误后可自行删除`
  - 无可迁移数据：`没有需要迁移的 Chat 历史会话`
  - 失败：`迁移失败：<原因>`（事务已回滚，数据未变）

> **为什么成功提示里要报出备份路径**：备份是**整库副本**、体积等同当前数据库，且按 §5.2.2 永不自动清理。不告诉用户它在哪，「清理交给用户」（§5.4）就是一句空话——用户既不知道有这么个文件，也无从判断能不能删。放 description 不放 title：路径很长，标题要保持可读。
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

#### 3.2.1 `octo_ai` 仍是 TUI 默认 agent —— 但两边的库是分开的（2026-08-13 实证）

`octo_ai` 至今仍是 opencode TUI 的默认 agent（`agent/agent.ts`），所以「用命令行 opencode 建的会话会不会被一并扫走」是个合理担心。答案是**不会，因为库文件根本不是同一个**：

- 库文件名由 `InstallationChannel` 决定（`storage/db.ts` `getChannelPath`）：非 latest/beta/prod 渠道是 `opencode-<渠道>.db`。
- 而 `InstallationChannel` 读的是编译期常量 **`OPENCODE_CHANNEL`**（`core/src/installation/version.ts`），octo 的构建脚本注入的却是 **`OCTO_CHANNEL`**（`opencode/script/build.ts`）——两个名字**没有映射**，所以 octo 的渠道值恒为 `local` → 库是 `opencode-local.db`。
- 官方 opencode CLI 是正式渠道 → `opencode.db`。本机实测三个库文件并存（`opencode.db` / `opencode-dev.db` / `opencode-local.db`），octo 只动自己那个。

⚠️ 这层隔离是**名字对不上意外得来的，不是设计**。如果哪天把 `OCTO_CHANNEL` 接到 `OPENCODE_CHANNEL` 上（看起来像个"修 bug"的改动），beta/prod 包会立刻改用 `opencode.db`，与官方 CLI 同库 —— 那时本迁移的范围就会**扫到 TUI 建的会话**。真要动这个映射，先回来看这一节。

剩下的重叠只有一种：直接跑本仓源码（`bun run dev`）或把 sidecar 二进制当 CLI 用，那也是 `local` 渠道、同一个库。**不为此加排除条件**：TUI 建的 `octo_ai` 与 chat 建的 `octo_ai` 在库里完全一样，任何区分（比如按 directory 猜）都是启发式；后果也只是"多出几条不认识的会话"，在列表里删掉即可，不丢数据。

### 3.3 执行顺序、事务与幂等

**最高原则（用户明确要求）：对用户数据的操作务求稳妥，宁可中断也绝不造成不可逆的数据丢失。** 任何一步不确定就**中止并明确报错**，不静默继续、不"尽力而为"。

执行顺序（**备份不能与 UPDATE 同处一个事务**，见 §5.2：`VACUUM INTO` 不允许在事务内执行）：

1. **解析目标 project**（目录 → project_id）。失败 → 中止，未动任何数据。
2. **备份**（`VACUUM INTO`）→ **校验备份**（§5.2.1）。任一失败 → 中止，未动任何数据。
3. **开事务 → UPDATE → 提交**。失败 → 回滚，数据保持迁移前状态，备份文件留着无害。

**本迁移天然不具备"丢数据"的能力，这是最强的一层保障，实现时不要破坏它**：

- 只有 `UPDATE`，**没有任何 `DELETE` / `DROP`**；
- 只写 `agent` / `directory` / `project_id` 三列，**不碰 `title` / `time_*` / 消息表 / parts 表**；
- 即使三列全写错，对话内容仍完整躺在库里，最坏情况是"在列表里找不到"，可以再迁一次修正。

幂等：迁完再点，`WHERE agent = 'octo_ai'` 命中 0 条 → toast「没有需要迁移的 Chat 历史会话」，不报错、不写库。

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
- `backup`：`{ to, bytes, skipped }`（`skipped:true` = 备份已存在、按 §5.2.2 跳过）
- `backup-verified`：`{ to, octoAiCount, expected }`（§5.2.1 三条校验的结论，**这条没出现就不该有 `run`**）
- `run`：`{ directory, projectID, matched, migrated }`
- `failed`（error）：`{ stage, error }`，`stage ∈ resolve-project | backup | verify-backup | update`

> 排查口诀：**看到 `failed` 就一定没动过数据**（`update` 阶段失败已回滚）；`backup-verified` 与 `run` 必须成对出现，只有 `backup` 没有 `backup-verified` 却出现了 `run` = 实现把校验漏了，属严重缺陷。

---

## 5. 备份与「重新迁移」

### 5.1 为什么不做「还原」按钮

先说业界的普遍形态：**改本地数据的迁移，标配是「迁移前自动备份 + 迁移批次记录」，而不是在 UI 上放一个「还原」按钮**。还原按钮是低频高风险代码，平时没人测，它自己也会出 bug；备份文件加一份恢复说明，成本低一个量级。

更关键的是一个**陷阱**：**整库还原会把迁移之后新产生的会话一起抹掉**。用户如果过几天才想还原，代价远大于收益。所以整库备份只适合「迁移过程本身崩了」这种灾难恢复，**不适合**用来覆盖「用户后悔了」。

而这次迁移的语义损失本来就极小：只改归属三字段，对话内容一字不动，chat 又本来没有目录归属（§0）。用户唯一现实的后悔场景是**目录选错了**——而这个场景的正解不是「还原」，是**再迁一次**。

### 5.2 备份怎么做（⚠️ 不是 `copyFile`）

**库是 WAL 模式**（`storage/db.ts`：`PRAGMA journal_mode = WAL`），所以**裸复制 `opencode.db` 是错的**：最近的写入还在 `opencode.db-wal` 里，只复制主文件会得到一份缺最新数据的快照；复制期间若有写入，产出的文件还可能内部撕裂。

**用一条 SQL 即可**：

```sql
VACUUM INTO '<Global.Path.data>/opencode.db.chat-migrate-bak-<时间戳>'
```

它产出一个完整、一致、已整理的独立库文件，不必管 `-wal` / `-shm` 三件套，也不必先 checkpoint。
**注意：`VACUUM INTO` 不能在事务内执行**，故顺序按 §3.3 —— 先备份、校验通过，再开事务 UPDATE。

（渠道库文件名见 `storage/db.ts` 的 `getChannelPath`：非 latest/beta/prod 渠道是 `opencode-<渠道>.db`，备份名相应带上。）

#### 5.2.1 备份校验（通过才允许往下走）

「备份成功」不能只看命令没抛错。至少校验三条，任一不过就**中止迁移并明确报错**：

1. 目标文件存在且大小 > 0；
2. 能作为 SQLite 库打开；
3. 在备份库里查 `SELECT COUNT(*) FROM session WHERE agent = 'octo_ai'`，**条数等于迁移前在当前库里数到的条数**。

第 3 条同时兼作「这份备份确实含有我们要保护的那批数据」的证明。

#### 5.2.2 备份文件即迁移记录

- **不新建表、不加 schema**：备份库里 `agent = 'octo_ai'` 的那批 id，天然就是「哪些会话是迁过来的」这份记录。
- **只在首次迁移时备份**：备份文件已存在就跳过（不再新建、**永不覆盖**）。这样「唯一一份」就是「迁移前那份快照」，是唯一的原始数据源，规则无歧义。
- **永不自动删除**备份文件。清理交给用户 —— 因此**迁移成功的 toast 里必须报出备份路径**（§2），否则用户根本不知道有这个文件；退场版本的发布说明里再说一次（§7）。

#### 5.2.3 重新迁移的语义（写死，避免歧义）

**重迁 = 按备份里的 id 集合，`UPDATE` 当前库中的同一批行**（改 `directory` + `project_id`；`agent` 已是 `octo_insight`，不变）。

**不是**「从备份库把数据再导入一遍」—— 那会产生重复会话。两者结果差别很大，实现时别选错：

- 按本 spec 的做法，那批会话是**整批挪走**：新目录出现，旧目录随之干净，用户**不需要手动删任何东西**。
- 用户在错误目录下**新建的** insight 会话不在备份的 `octo_ai` 集合里，重迁**不会碰它们**（正确行为）。

### 5.3 磁盘代价（要在实现时确认）

`opencode.db` 含全部消息与 parts，重度用户可能不小。整库复制是 O(库大小) 的一次性磁盘占用。

- 迁移前先看一眼文件大小并记进 `[octo:chat-migrate] backup` 日志。
- 若实测普遍偏大（比如超过数百 MB），再评估是否改成「只备份 session 表的相关行到一个小 sqlite / json」——但那等于自建记录，与「不加 schema」的取舍冲突，**没有实测数据前不要提前优化**。

### 5.4 迁错了怎么办（给用户的答案）

- **目录选错** → 直接「重新迁移」，选对目录再点一次。按 §5.2.3 会话是整批挪走的，**旧目录不留残余，无需手动清理**。
- **压根不想要这批历史** → 在 insight 列表里自行删除。本功能不提供批量撤销（原始数据仍在备份库里）。
- **备份文件占地方想删** → 迁移成功的 toast 已报出路径（§2），确认迁移结果无误后可自行删除。删掉之后「重新迁移」就没有 id 集合可依据了（§5.2.3），要再挪目录只能在列表里逐个处理。

---

## 6. 验证

### 6.1 外网可复现

前置：`bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>`（**改了服务端路由必须重启**）。造数据：直接往 db 里插几条 `agent='octo_ai'` 的会话，`directory` 故意分散到 2~3 个不同目录（模拟 chat 跨目录的真实分布）。

| # | 场景 | 步骤 | 通过判据 |
|---|---|---|---|
| V0 | **路径 B 已撤干净**（§1.1） | 造几条 `agent='octo_ai'` 且 `directory` = 当前选中目录的会话 | insight 列表**一条都看不到**。撤之前这几条是会显示的 —— 这条专门守住撤销是否真的生效 |
| V1 | 迁移前不可见 | 造完数据（directory 分散到 2~3 个目录），进 insight 列表 | 一条 chat 会话都看不到（SPEC-INS-030 §6.1 的现状） |
| V2 | 预览计数 | 打开设置 → 通用 → Chat 历史会话迁移 | 显示的待迁移条数 = 库里 `agent='octo_ai'` 的条数，**与 directory 无关**（跨目录的也算上） |
| V3 | 默认目录 | 打开该设置项 | 文件夹选择器默认填当前全局选中目录；点「选择…」能改 |
| V4 | **迁移生效** | 选一个目录 → 开始迁移 | toast 报出条数；切到该目录的 insight 列表，**全部** chat 会话可见、按更新时间倒序 |
| V5 | **`project_id` 有没有跟着改**（最容易静默失败的一条） | 选一个**与原会话不同 project** 的目录迁移（例如原来在非 git 目录、这次选一个 git 仓库） | 列表里能看到。若 toast 说成功但列表为空 = `project_id` 没写，回 §3.1 |
| V6 | 对话内容不丢 | 打开任一迁移过来的会话 | 原对话文本一字不丢；工具调用走兜底渲染（「调用了 xxx」）；**不报错、不白屏** |
| V7 | 文件面板空态 | 同 V6，看文件管理 | 空态，不报错（chat 本来就没有 `.octo` 布局） |
| V8 | 幂等 | 再点一次迁移 | toast「没有需要迁移的 Chat 历史会话」，不报错、数据不变 |
| V9 | **重新迁移** | 换一个目录点「重新迁移」 | 同一批会话出现在新目录；旧目录列表里不再有它们 |
| V10 | 备份存在且只备一次 | 看数据目录 | 有且仅有一个 `chat-migrate-bak-*` 文件（第二次迁移不再新增、永不覆盖）；`[octo:chat-migrate] backup` 记录了大小 |
| V10.1 | **备份是完整快照**（WAL 陷阱，§5.2） | 用 `sqlite3 <备份文件> "SELECT COUNT(*) FROM session WHERE agent='octo_ai'"` | 条数 = 迁移前当前库里的条数。**若用 copyFile 而非 `VACUUM INTO`，这条会偶发对不上** |
| V10.2 | **备份校验挡得住**（§5.2.1） | 人为把备份路径指到一个不可写位置 | 迁移**中止**、明确报错；库里 `agent='octo_ai'` 条数不变（没有"备份失败但照样迁"） |
| V11 | 失败回滚 | 传一个不存在 / 无权限的目录 | toast 明确报错；库里 `agent='octo_ai'` 条数不变（事务回滚） |
| V11.1 | **对话内容零改动** | 迁移前后各导出一次某条会话的消息与 parts 计数 | 完全一致（本迁移只 UPDATE 三列，§3.3） |
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
