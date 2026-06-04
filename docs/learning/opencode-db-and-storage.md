# opencode 数据持久化:SQLite + Drizzle + 文件系统全貌

> 面向"对该项目数据流向 / 后端机制不熟、想搞清楚 DB / migration / channel / 文件去哪了"的读者。
> 包含通用后端概念(SQLite 事务、WAL、ORM schema-as-code、migration journal)、opencode 特有抽象(channel-aware DB、JsonMigration、storage/ 目录)、以及与业界主流方案的对比。

---

## 0. 一图看懂:用户机器上数据躺在哪里

```
~/.local/share/opencode/                  ← XDG_DATA_HOME/opencode,跨 channel 共享路径
├── opencode.db                           ← latest/beta/prod 通道的 SQLite 主库
├── opencode-dev.db                       ← dev 通道的主库(独立文件)
├── opencode-local.db                     ← local 通道(bun dev / 未设 channel)的主库
├── opencode-<channel>.db-wal             ← Write-Ahead Log,WAL 模式下事务的中间缓冲
├── opencode-<channel>.db-shm             ← 共享内存索引(WAL 协同用)
├── storage/                              ← 旧版 JSON 持久化目录(逐步淘汰中)
│   ├── migration                         ← 内部小版本号文件,记 storage 目录自己的 schema 演进
│   ├── session_diff/                     ← 还在用:会话 diff 摘要(SPEC-INS-005)
│   └── (session/ message/ part/ todo/ ...)  ← 老版本残留,JsonMigration 看到就搬进 SQLite
├── snapshot/                             ← Git 物理快照,支撑 session.revert(回滚消息)
└── tool-output/                          ← 工具长输出的二进制/文本,通过 ID 索引

~/Library/Application Support/ai.octoagent.desktop.dev/   ← Electron userData(每应用独立)
├── (electron-store 的 .json 配置 / log / cache)            ← 与 DB 无关,仅 Electron 自用
```

**关键区分**:**DB 在 XDG(全局)** + **Electron userData 在 OS 标准位置(应用私有)**。两套路径互不重叠。Electron 不接管 DB 数据,DB 走 XDG 全机器统一。

---

## 1. 为什么选 SQLite

opencode 后端虽然跑在 user 本机(没有"服务器"),但需要事务、关系查询、并发读写——这是 SQLite 的甜区。

### 1.1 SQLite 的特殊定位

| 维度 | SQLite | Postgres / MySQL |
|---|---|---|
| 部署形态 | **嵌入式**,单文件,跟随应用进程 | **C/S**,独立服务进程 |
| 并发模型 | 单写多读(WAL 模式下) | 多写多读(MVCC) |
| 适合场景 | 单用户 / 嵌入式应用 / 移动端 / 浏览器 | 多用户 / 服务器 / 共享系统 |
| 事务 | ACID 完整 | ACID 完整 |
| 文件结构 | 1 个主 `.db` + 可选 `-wal` / `-shm` | 复杂数据目录 + 多文件 |
| 业界用例 | Firefox / Chrome bookmarks、iMessage、WhatsApp、Notion 本地缓存、**所有大厂的桌面 / 移动客户端** | Web 后端、数据仓库 |

opencode 是"AI agent 跑在你本机"的产品,**1 用户 1 进程**,SQLite 完美。同类产品 Cursor / Windsurf / Claude Code 也用 SQLite。

### 1.2 SQLite 的"内嵌"性质决定了很多设计

- **DB 文件就是 app 数据**:用户拷走 `opencode-dev.db` 就拷走了全部历史
- **进程必须独占写**:同一时刻只有一个 writer(SQLite 自己的锁机制保证)
- **崩溃恢复靠 WAL**:wal 文件存"未 commit 的事务",崩溃后下次启动 SQLite 自动 recover

---

## 2. 事务、WAL、并发——SQLite 后端必懂

### 2.1 事务(Transaction)

事务 = "一组数据库操作,要么全成,要么全败"。ACID 四性:

| 字母 | 含义 | SQLite 怎么做到 |
|---|---|---|
| **A**tomicity | 原子性 | 全成或全败,中间状态不暴露 | 通过 journal 文件(rollback journal 或 WAL),失败时反向 replay |
| **C**onsistency | 一致性 | 提交后数据符合所有约束(外键、unique、check) | DDL + 运行时检查 |
| **I**solation | 隔离性 | 并发事务之间互不干扰 | SQLite 用文件锁(SHARED / RESERVED / PENDING / EXCLUSIVE)或 WAL 的 snapshot 隔离 |
| **D**urability | 持久性 | 提交后即使断电也不丢 | 提交时强制 `fsync`(刷盘);WAL 模式下可调档 |

opencode 用事务的典型场景见 [storage/db.ts:86-115](../../packages/opencode/src/storage/db.ts#L86-L115) — Drizzle 暴露 `db.transaction(trx => {...})` 包装,内部封装 SQLite 的 `BEGIN; ... COMMIT;`。任意一步抛错,Effect 错误传播 → 触发 `ROLLBACK`,DB 状态回到事务前。

**JsonMigration**([storage/json-migration.ts:150](../../packages/opencode/src/storage/json-migration.ts#L150))整段是一个超大事务:几千条 INSERT 包在 `BEGIN TRANSACTION ... COMMIT`,任一条失败全回滚——保证迁移要么完整、要么不动 DB。

### 2.2 WAL(Write-Ahead Logging)

[db.ts:91](../../packages/opencode/src/storage/db.ts#L91) `db.run("PRAGMA journal_mode = WAL")` — opencode 启动就把 SQLite 切到 WAL 模式。

WAL 之前的默认模式(rollback journal):每次写,先把"修改前的页"复制到一个临时 journal 文件,再原地改 DB 文件。崩溃了就 replay journal 反向恢复。**问题**:写过程中,读必须等待(EXCLUSIVE 锁)。

WAL 反过来:**写到 .wal 文件,不动主 .db**。后续读直接从主 .db 读,加上 .wal 里的"新写"——这样**读和写可以并发**,大幅提升性能。

```
opencode-dev.db        ← 旧数据(快照)
opencode-dev.db-wal    ← 新写的事务(尚未合并回主库)
opencode-dev.db-shm    ← 共享内存,告诉所有连接 "wal 里第几页是最新的"
```

定期触发 **checkpoint**:把 .wal 里的修改合并回主 .db,清空 wal。手动也可:`PRAGMA wal_checkpoint(PASSIVE)`([db.ts:96](../../packages/opencode/src/storage/db.ts#L96))。

> WAL 模式下文件**多出 -wal / -shm 两个文件**——这就是为什么你 `ls ~/.local/share/opencode/` 看到那一坨。直接复制 `.db` 而不带 `-wal` 可能丢失最近未 checkpoint 的事务。

### 2.3 并发:SQLite "单写多读"

WAL 模式下:**N 个 reader + 1 个 writer** 同时跑没问题。第 2 个 writer 必须等。

opencode 是单进程的(server 也在同进程),不存在多 writer 竞争。但**两个 channel 同时跑(比如同时开 dev 包和 local CLI)是分别写不同的 .db 文件**,天然隔离,SQLite 锁机制不参与。

唯一会冲突的场景:同 channel 起两个实例(两个 dev 包同时开)→ 都写 `opencode-dev.db`,SQLite 会用 `busy_timeout`([db.ts:93](../../packages/opencode/src/storage/db.ts#L93) `PRAGMA busy_timeout = 5000`)让后到的 writer 等 5 秒。超时就报 `SQLITE_BUSY`。

---

## 3. channel-aware DB 路径:opencode 的关键设计

### 3.1 为什么按 channel 分文件

```ts
// packages/opencode/src/storage/db.ts:28-33
export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "opencode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `opencode-${safe}.db`)
}
```

- `latest` / `beta` / `prod` → `opencode.db`(共用,认为正式版本兼容)
- `dev` → `opencode-dev.db`
- `local` → `opencode-local.db`(`bun dev` / 未注入 channel)
- 自定义 channel → `opencode-<安全字符版>.db`

**动机**:dev / 测试通道 schema 经常在变,如果共用 `opencode.db`,一个 dev 包改坏 schema 会污染你的正式版数据库。channel 隔离 = 跑哪个版本只动哪个文件,**生产数据稳如山**。

### 3.2 channel 来源

[packages/core/src/installation/version.ts:7](../../packages/core/src/installation/version.ts#L7):

```ts
declare global { const OPENCODE_CHANNEL: string }  // 构建时注入
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
```

`OPENCODE_CHANNEL` 是**构建时由 Bun.build / Vite define 注入的全局常量**(不是运行时 env var)。打包 dev channel 包时,build 脚本传 `define: { OPENCODE_CHANNEL: "'dev'" }`,代码里 `typeof OPENCODE_CHANNEL` 就会 === "string"。`bun dev` 不打包不注入,fallback `"local"`。

### 3.3 几个常见踩坑

1. **构建注入名和源码读名要对齐**。曾经一次 rename 把构建侧改成 `OCTO_CHANNEL` 注入,但源码还读 `OPENCODE_CHANNEL` → 运行时永远是 `"local"`,所有用户 dev 包数据落到本地通道。生产事故级 bug
2. **marker 检查文件名要 channel-aware**。`if (!exists("opencode.db")) runMigration()` 在 dev channel 用户机器永远失败(因为他们落 `opencode-dev.db`),migration 每次启动跑一遍——曾经导致 JsonMigration 把老 JSON 反复灌进 DB(并最终被 strict 过滤拦下来,但浪费时间)
3. **opencode CLI 与 desktop 共用 channel 同名 DB**,因为都按 channel 名走。但 desktop 的 `userData` 是 Electron 私有(应用名 ID),DB 走 XDG——两个独立维度。**Electron 改 userData 改不动 DB**

---

## 4. Drizzle ORM:schema-as-code 范式

opencode 用 [Drizzle](https://orm.drizzle.team/) 做 ORM + migration。

### 4.1 什么是 schema-as-code

schema-as-code = "数据库表结构在代码里声明,migration 由工具帮你生成"。对比另一类:

| 范式 | 例子 | 你怎么改表 |
|---|---|---|
| **schema-as-code** | Drizzle / Prisma / Rails(`schema.rb` 自动派生) | 改 TS / Ruby 文件 → 跑工具生成 migration → review SQL → 应用 |
| **SQL-first** | Flyway / Liquibase / sqlx / 裸写 .sql | 直接写 `ALTER TABLE ...` SQL 文件,编号 / 时间戳排序 |
| **schema-from-migration**(Django/Rails 传统) | Django migrations / 早期 Rails | 写 migration 文件,DB 状态由"所有 migration 顺次应用"还原 |

opencode 走 (1):你看 [session.sql.ts](../../packages/opencode/src/session/session.sql.ts):

```ts
export const SessionTable = sqliteTable("session", {
  id: text().$type<SessionID>().primaryKey(),
  project_id: text().notNull().references(() => ProjectTable.id),
  agent: text(),           // ← 你想加列,改这里
  // ...
}, (table) => [
  index("session_project_idx").on(table.project_id),
])
```

加一列 = 改 TS。然后跑 `bun run db generate --name add_agent_to_session` → Drizzle 自动产出 `ALTER TABLE session ADD COLUMN agent text;` migration SQL。

### 4.2 Drizzle 比 Prisma 轻在哪

Drizzle 没有自定义 DSL(Prisma 有 `schema.prisma`),它就用 TS 模板字符串/工厂函数描述表。优势:**类型推导原生 TS,无需 codegen 中间层**:

```ts
import { sql, eq } from "drizzle-orm"
const session = await db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
// session 的类型自动是 { id: SessionID; project_id: ProjectID; ... agent: string | null; ... }
```

代价:语法没 Prisma 直观(Prisma 的 `.prisma` 文件可读性更高)。但 Drizzle 与 Effect / TypeScript 集成原生顺畅,这是 opencode 选它的原因。

---

## 5. Migration 机制三件套:migration.sql / snapshot.json / journal

每次 `bun run db generate --name <slug>` 在 `packages/opencode/migration/<timestamp>_<slug>/` 产出**两个文件**:

```
migration/
├── 20260501142318_next_venus/
│   ├── migration.sql           ← 实际要跑的 ALTER / CREATE
│   └── snapshot.json           ← 应用完这条后,schema "完整状态"的快照
├── 20260604121801_add_agent_to_session/
│   ├── migration.sql
│   └── snapshot.json
└── meta/_journal.json          ← (有时在 meta/)所有 migration 的索引列表
```

### 5.1 migration.sql — 增量指令

```sql
-- 20260604121801_add_agent_to_session/migration.sql
ALTER TABLE `session` ADD `agent` text;
```

纯 SQL,可读。这就是启动时 Drizzle migrator 真正会执行的 DDL。

### 5.2 snapshot.json — schema 完整状态(关键!)

```json
{
  "version": "7",
  "dialect": "sqlite",
  "tables": {
    "session": {
      "name": "session",
      "columns": {
        "id": { "name": "id", "type": "text", "primaryKey": true, ... },
        "agent": { "name": "agent", "type": "text", "primaryKey": false, "notNull": false, ... },
        ...
      },
      "indexes": { ... },
      "foreignKeys": { ... }
    },
    ...
  }
}
```

这个文件**不是给运行时跑的**,而是给 Drizzle CLI 用的。

下次你改 schema 跑 `bun run db generate` 时,Drizzle 的 diff 算法:

1. 读 TS schema 文件 → 求出"目标状态"
2. 读**最新一个 migration 的 snapshot.json** → 求出"当前状态"
3. 两者 diff → 生成新 migration.sql
4. 同时把"目标状态"写入新的 snapshot.json,留给下次用

**所以 snapshot.json 必须 commit**。删了它下次 generate 会以"无任何已知状态"算 diff → 输出"从零创建所有表"的疯狂 migration,跑下去 DB 会爆。

### 5.3 _journal.json(或 meta 目录)

类似 git index,告诉 Drizzle 哪些 migration 已经存在、顺序如何:

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    { "idx": 0, "tag": "20260312043431_session_message_cursor", ... },
    { "idx": 1, "tag": "20260323234822_events", ... },
    ...
    { "idx": 17, "tag": "20260604121801_add_agent_to_session", ... }
  ]
}
```

Drizzle 启动时按 entries 顺序跑没跑过的 migration。

### 5.4 哪些 migration 已经跑过了:`__drizzle_migrations` 表

DB 里 Drizzle 自动建一张表 `__drizzle_migrations`,每条已应用的 migration 记一行(hash + timestamp)。下次启动比对:journal 有的 + 表里没的 = 待应用。

查你本机:

```bash
sqlite3 ~/.local/share/opencode/opencode-dev.db \
  "SELECT hash, datetime(created_at/1000,'unixepoch','localtime') FROM __drizzle_migrations ORDER BY created_at;"
```

跑过的 migration 一目了然。

### 5.5 加列(ALTER ADD COLUMN)为什么"安全"

SQLite 的 `ALTER TABLE ADD COLUMN`:

- 物理上**不重写整张表**,只在系统表里登记"现在有这一列",老行的新列值约定为 NULL(或 default)
- 对老数据**0 risk**(老查询不会读它,新读以 NULL 返回)
- O(1) 时间,瞬完

对比 `ALTER TABLE DROP COLUMN`(SQLite < 3.35 不支持,要 COPY-RENAME)、`ALTER TABLE RENAME COLUMN`(慢)、改列类型(必须 COPY-RENAME)。

**所以加列(本期改动)是最安全的 schema 演进操作**。

### 5.6 与业界对比

| 工具 | 增量 SQL | 完整 schema 快照 | journal/index | DB 内追踪表 |
|---|---|---|---|---|
| **Drizzle** | `migration.sql` | `snapshot.json` ✅ | `_journal.json` ✅ | `__drizzle_migrations` |
| **Rails ActiveRecord** | `db/migrate/*.rb`(Ruby DSL,跑时翻成 SQL) | `db/schema.rb`(Ruby dump,自动生成) ✅ | 文件名时间戳 | `schema_migrations` 表 |
| **Prisma** | `migrations/<ts>_<name>/migration.sql` | `schema.prisma`(源)+`migration_lock.toml` | 文件名时间戳 | `_prisma_migrations` 表 |
| **Django** | `<app>/migrations/<n>_*.py`(Python 描述) | ❌ 无单文件 snapshot,需要"全部 migration replay" | 数字序号 | `django_migrations` 表 |
| **Flyway** | `V<n>__<name>.sql`(纯 SQL) | ❌ | 版本号 | `flyway_schema_history` 表 |
| **TypeORM** | `<n>-<name>.ts`(TS up/down) | ❌ | 文件名 | `migrations` 表 |
| **Sequelize** | `<ts>-<name>.js` | ❌ | 文件名 | `SequelizeMeta` 表 |
| **Alembic (SQLAlchemy)** | `versions/<rev>_<name>.py` | ❌ | DAG(parent revision) | `alembic_version` 表 |

**snapshot.json 这种"schema 快照文件"是 schema-as-code 范式特有的副产物**:

- Drizzle / Prisma / Rails 都是 schema-as-code → 都有快照机制(只是叫法不一,Rails 用 `.rb` dump,Prisma 用 `.prisma` 源文件,Drizzle 用 `.json`)
- 老派 migration-only(Django / Flyway / Liquibase / Alembic / TypeORM)没有这一层,因为它们的 schema 状态**由 migration 全集决定**,不存在"绕过 migration 直接对齐 schema"的需求

**所以 snapshot.json 不是噱头,是范式必需品**。看到陌生的 migration 目录里有这种文件,不要奇怪,也不要手贱删。

---

## 6. JsonMigration:从 JSON 文件夹到 SQLite 的一次性搬家

opencode 早期版本(SQLite 化之前)把 session/message/part 存成 JSON 文件:

```
~/.local/share/opencode/storage/
├── project/<id>.json
├── session/<projectID>/<sessionID>.json
├── message/<sessionID>/<messageID>.json
├── part/<sessionID>/<messageID>/<partID>.json
├── todo/<sessionID>.json
├── permission/<projectID>.json
└── session_share/<sessionID>.json
```

后来引入 SQLite,需要把存量数据搬过来 — 这就是 [storage/json-migration.ts](../../packages/opencode/src/storage/json-migration.ts)。

### 6.1 触发逻辑

[packages/opencode/src/index.ts:118-129](../../packages/opencode/src/index.ts#L118-L129):

```ts
const marker = path.join(Global.Path.data, getChannelPath())  // ← 应该用 channel 路径
if (!(await Filesystem.exists(marker))) {
  // 首次启动该 channel:跑 JsonMigration 一次
  await JsonMigration.run(...)
}
```

> 实战教训:这个 marker 检查曾经写死 `"opencode.db"`(无 channel 后缀),导致 dev channel 用户的 marker 永远不存在 → 每次启动都尝试跑 migration。JsonMigration 内部 `existsSync(storageDir)` 早返回保护 → 没造成数据污染,但白跑。

### 6.2 内部做什么

[json-migration.ts:25-119](../../packages/opencode/src/storage/json-migration.ts#L25-L119) 扫七类 JSON 文件,批量 INSERT 到对应表:

```
project/*.json        → ProjectTable
session/*/*.json      → SessionTable
message/*/*.json      → MessageTable
part/*/*.json         → PartTable
todo/*.json           → TodoTable
permission/*.json     → PermissionTable
session_share/*.json  → SessionShareTable
```

`onConflictDoNothing()` 写入:**已存在的 ID 跳过**,所以重跑幂等。

### 6.3 为什么要保留这段代码

- 老用户机器上 `storage/` 目录可能还有数据,迁过来才不丢
- 新用户机器上 `storage/` 不存在,函数早返回,无副作用
- 业务侧已经全部读 SQLite,storage/ 是只读历史

**长期看 storage/ 可能整体废弃**,但只要还有用户从老版本升上来就得留着。这是所有"曾经换过存储后端"的产品都会有的兼容尾巴。

---

## 7. storage/、snapshot/、tool-output/——XDG 目录里其他三兄弟

### 7.1 `storage/`(部分仍在用)

虽然 session/message 已经搬到 SQLite,但**两类数据仍走 storage/ JSON**(见 [storage/storage.ts](../../packages/opencode/src/storage/storage.ts)):

| 路径 | 谁在写 | 为什么不进 SQLite |
|---|---|---|
| `storage/session_diff/<sessionID>.json` | [session/summary.ts:119](../../packages/opencode/src/session/summary.ts#L119) | diff 数据可能巨大(几 MB 文本),塞进 SQLite 行不优雅;且只读写一次,不需要索引 |
| `storage/migration`(单文件) | storage.ts 内部 | 记 storage.ts **自己的格式迁移**版本号(跟 Drizzle migration 是两套系统,管的是不同抽象层) |

`Storage` service 暴露 `read/write/update/remove/list` 通用 KV 接口,key 用数组形式("路径段"),底层翻译成 `path.join(dir, ...key) + ".json"`。是个轻量本地 JSON 存储,**不要拿它存频繁更新的东西**。

### 7.2 `snapshot/`

支撑 session.revert 功能:用户消息 N 之后,可以"回退到消息 N 之前的工作目录状态"。实现:每条消息发送前,opencode 自动跑 `git commit` 一次(在一个隐藏的内部 git 仓里),snapshot/ 就是那个 git 仓的数据目录。

回滚 = `git checkout <sha-of-message-N>`。所以你看 `snapshot/` 里就是 `.git/objects/`、`.git/refs/` 那一套。**不要手贱删,删了所有 session 的回滚能力就没了**。

### 7.3 `tool-output/`

工具长输出(比如 bash 跑了一个 5MB 文本输出)如果直接塞进 message.part.data,SQLite 行会变巨大,影响查询。所以超过阈值的输出落地到 tool-output/,DB 里只存路径引用。

---

## 8. opencode 的特色:Effect 服务化 + Bun/Node 双适配

最后讲两个 opencode 后端的"opencode-isms"(非通用,但你看代码会撞上)。

### 8.1 Effect 服务化的 DB 访问

[storage/db.ts:115](../../packages/opencode/src/storage/db.ts#L115) 暴露的不是裸 Drizzle 客户端,而是 Effect Service:

```ts
export class Service extends Context.Service<Service, Interface>()("@opencode/Database") {}

// 用法
const db = yield* Database.Service
const rows = yield* db.use(d => d.select().from(SessionTable).all())
```

`db.use(fn)` 把 callback 跑在事务里(或自动嵌套到外层事务)。结合 Effect 的错误传播,**事务回滚天然 = Effect 失败传播**——你不用手写 `try/catch` 包 `BEGIN ... ROLLBACK`。

### 8.2 Bun / Node 双适配

```
src/storage/db.bun.ts    ← 用 bun:sqlite + drizzle-orm/bun-sqlite
src/storage/db.node.ts   ← 用 node:sqlite + drizzle-orm/node-sqlite
src/storage/db.ts        ← 公共逻辑,通过 #db 条件导入选实现
```

[package.json `imports` 字段](../../packages/opencode/package.json) 里的 `#db` key 在 bun runtime 解析到 `db.bun.ts`,在 node runtime(Electron)解析到 `db.node.ts`。

**Bun 有原生 sqlite 绑定**(`bun:sqlite`),Node 24+ 才有(`node:sqlite`)。两边 API 几乎一致,Drizzle 都支持。

这是因为 opencode CLI 走 Bun runtime(更快),但 Electron 内嵌的是 Node runtime,不能强行 Bun。**双实现 + 条件导入** = 一份业务代码两边跑。

---

## 9. 实战速查

### 9.1 我想加一列

```bash
# 1. 改 src/<domain>/<table>.sql.ts,加列声明
# 2. 生成 migration
cd packages/opencode
bun run db generate --name <kebab_case_slug>

# 3. 检查 migration/<timestamp>_<slug>/migration.sql 是不是预期的 ALTER
cat migration/<latest>/migration.sql

# 4. plumb 业务侧:Info zod、CreateInput zod、Interface、fromRow/toRow
# 5. 启动应用,migration 自动跑
# 6. git add migration/ + 业务侧改动一起 commit
#    snapshot.json 也要 add!删了下次 generate 会出错
```

### 9.2 我的本地 DB 坏了想从零开始

```bash
# 备份再删
mv ~/.local/share/opencode/opencode-dev.db ~/.local/share/opencode/opencode-dev.db.bak
mv ~/.local/share/opencode/opencode-dev.db-wal ~/.local/share/opencode/opencode-dev.db-wal.bak
mv ~/.local/share/opencode/opencode-dev.db-shm ~/.local/share/opencode/opencode-dev.db-shm.bak

# 重启应用 → Drizzle 从零跑所有 migration → 干净空库
```

### 9.3 我怀疑 migration 没跑

```bash
sqlite3 ~/.local/share/opencode/opencode-<channel>.db \
  "SELECT tag, datetime(created_at/1000,'unixepoch','localtime') 
   FROM __drizzle_migrations ORDER BY created_at;"
```

最后一条 tag 跟 `packages/opencode/migration/` 目录里最新文件夹名对得上 = 都跑过了。

### 9.4 我要查"为什么这条 session 有问题"

```bash
sqlite3 ~/.local/share/opencode/opencode-<channel>.db \
  "SELECT * FROM session WHERE id = 'ses_xxxxx';"
```

或者按目录、agent、时间筛:

```sql
SELECT id, agent, title, datetime(time_created/1000,'unixepoch','localtime') AS t
FROM session
WHERE directory = '/Users/me'
  AND parent_id IS NULL
ORDER BY time_created DESC
LIMIT 20;
```

---

## 10. 延伸阅读

- SQLite 官方:[When To Use](https://www.sqlite.org/whentouse.html)、[WAL mode](https://www.sqlite.org/wal.html)、[Atomic Commit](https://www.sqlite.org/atomiccommit.html)
- Drizzle 官方:[Migrations](https://orm.drizzle.team/docs/migrations)、[Schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration)
- 业界 schema 演进对比:[Prisma vs Rails vs Django](https://www.prisma.io/dataguide/types/relational/database-migrations) (任选一篇 dataguide)
- 本仓相关:[SPEC infra/session-agent-attribution](../specs/infra/session-agent-attribution.md)(本文档的来源 spec)、[architecture.md §5.3 持久化](../architecture.md)
