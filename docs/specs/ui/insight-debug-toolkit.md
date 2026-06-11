# SPEC-INS-011 — Insight 内网调试可观测工具(debug-observer)

> 状态:草案 · 优先级 P1 · 规模 [M] · 领域 ui/insight · 类型:实现 spec
>
> **上游已实现**:
> - ✓ SSE 事件总线 + 旁路订阅点(`globalSDK.event.listen()`)——本 spec 在其上做**只读旁路观测**,不改 GlobalSync / event-reducer
> - ✓ 主进程日志基建(electron-log + `tail()`,UXAI `packages/desktop/src/main/logging.ts`,5MB/文件)——阶段 3 复用,不自建
> - ✗ 业务侧「SSE 事件观测 + console 取数 API + 现场快照」(本 spec 新增,自包含于 insight `lib/debug-observer.ts`)

---

## 0. 给实现者的执行须知(UXAI 落地,先读)

**分工(CLAUDE.uxai 硬规则)**:本 spec 等文档**只在 octo-agent 提交**;insight **代码只在 UXAI 提交**。octo-agent 的同名实现(归档分支/tag)仅作**蓝本参考**,不是同步源。

**路径映射**(本 spec 行文用 octo-agent 视角示意,UXAI 实际落点如下):

| 角色 | octo-agent(蓝本) | UXAI(实际落点) |
|---|---|---|
| insight 页面 | `packages/app/src/pages/insight/` | `packages/app/octoapp/pages/insight/` |
| debug-observer | `…/insight/lib/debug-observer.ts` | `packages/app/octoapp/pages/insight/lib/debug-observer.ts` |
| 接线 | `…/insight/index.tsx` | `packages/app/octoapp/pages/insight/index.tsx` |
| 桌面壳主进程(阶段 3) | `packages/desktop-electron/src/main/` | `packages/desktop/src/main/`(`windows.ts` / `logging.ts`) |

**落地前必须核对的上游漂移点**(UXAI 是 opencode fork,已发现与蓝本不一致):

1. **SDK hook**:UXAI insight 用 `useSDK()`(蓝本用 `useGlobalSDK()`)——确认 `event.listen()` / `url` 从哪个 hook 取,以及 `event.listen` 回调形状(蓝本是 `{ name, details }`)。
2. **事件订阅入口**:核对 UXAI `octoapp/context` 下 global-sdk 的 `event.listen` 签名是否一致。
3. **sync.data 形状**:UXAI `event-reducer` 已确认有 `permission` / `question` / `session_status`,但额外有 `trimSessions` / `store.limit` 缓存裁剪——读 `message[id]` / `part[id]` 时注意可能被裁剪(空不等于"没发生过")。

**自包含边界**:全部落在 `insight/lib/` + `index.tsx` 接线;**不改** `packages/ui` / `packages/opencode` / `packages/sdk` / GlobalSync / event-reducer(阶段 3 例外:仅 `packages/desktop/src/main`,且按 §8 登记)。

**不要做什么(防过度发挥)**:
- ❌ 不做自动上报 / 不向任何服务器发送 debug 数据——**只本地留存,只经 console 命令由用户主动导出**。
- ❌ 不加 UI 入口 / 按钮 / 弹窗——只走 `window.octoDebug` 控制台。
- ❌ 不改上游事件流 / reducer / 渲染逻辑——只读旁路。
- ❌ 不引第三方日志库——阶段 3 复用已有 electron-log。

**字典同步**:任何 `[octo:*]` 前缀 / 字段 / `octoDebug` 命令的增删改,同步 [insight-debugging.md](../../insight-debugging.md)(CLAUDE.uxai 已有此约束)。

---

## 1. 背景与目的

### 1.1 约束
- bug 多发生在**内网**,排查方在外网,**只能靠 console**(抓不到 Network/SSE,不便起服务跑命令)。
- 现场外发只能**复制文本段落**,所以导出物必须**短到能整段复制、又不漏关键线索**。
- 有相当比例**偶现 / 不可复现**:测试可约束不关页面,真实用户报错后会关软件——**等知道时现场可能已不在**。

### 1.2 目标
把"出 bug → 定位"压成:**敲一行 `octoDebug.snapshot(...)` → 得到一段「带初判 + 按需过滤」的紧凑现场 → 对照 [insight-debugging.md](../../insight-debugging.md) 定位**,并保证现场**不因 reload/重启/过滤而丢失关键线索**。

### 1.3 核心设计原则
1. **捕获要全,展示才过滤**:环形缓冲按"全字段 + 全来源"捕获;`snapshot()` 参数只控制**导出**子集。过滤是导出时的事,不在捕获时丢东西。
2. **两层防漏**:结构化层(好取、可粘贴)负责日常 90%;全量层(原始 console 落盘)负责"绝对不漏"兜底。两层职责不同,不互相替代。
3. **存储与目录解耦**:留存位置固定(IndexedDB per-origin / electron-log app 目录),**不跟随用户选的工作目录**;每条记录标当时的 `directory` + `sessionID`。

---

## 2. 已落地(蓝本,UXAI 待实现)

octo-agent 蓝本已验证可行的部分(UXAI 需照 §0 平移 + §4–5 增强):
- `[octo:event]` SSE 事件旁路日志(compact + delta 聚合)。
- `window.octoDebug`:`help / state / dump / events / sends / lastSend / pending / snapshot / mode / verbose`。
- 事件 / 发送 / 日志环形缓冲(500 / 50 / 200);阶段 2 起持久化到 IndexedDB。
- 文档:[insight-debugging.md](../../insight-debugging.md) §0.5 数据流全貌、§1.0 事件字典、§2 症状表、§3 octoDebug、§4 Network 速查。

---

## 3. 使用场景与工作流(回答"怎么取数 / 各层干嘛")

### 3.1 两层职责

| 层 | 载体 | 角色 | 抗丢失 | 取数方式 |
|---|---|---|---|---|
| 结构化层 | 内存 →(阶段 2)IndexedDB | 好取、可粘贴、带初判 | 阶段 2 起跨 reload/重启 | `octoDebug.snapshot()` |
| 全量层 |(阶段 3)electron-log 文件 | 原始 console 兜底,防"过滤漏掉" | 跨一切(含渲染崩溃前) | 打开文件 / 阶段 3 过滤命令 |

### 3.2 取数工作流(标准流程)

1. **现场可敲**:出 bug → `octoDebug.snapshot()`(或带 profile/时间窗)→ 紧凑现场已在剪贴板 → 交排查方对照字典定位。
   - IndexedDB(阶段 2)对用户**透明**:snapshot **自动合并**"内存 + 重启前持久化",用户不必知道来源,也不必"提前开 DevTools"。
2. **现场敲不出**(渲染崩溃 / 白到 console 开不了 / 怀疑结构化漏线索):回查**全量落盘**(阶段 3)——按时间窗 / messageID 过滤读取那一段。
3. **交互式收敛**:排查方看完第一份,指明"再要 upload / errors 子集" → 用户 `snapshot({ profile })` 补一份。

> 关键:两层都不是"上报",是**本地留存 + 用户主动 console 导出**。

---

## 4. 设计

### 4.1 两层防漏架构
结构化层再怎么加强都有损;真正"零漏"只有全量原始 console(阶段 3)。两层并存,日常用结构化、诡异偶现回查全量。

### 4.2 `snapshot(opts?)` 参数化(全部可选,只控制导出)

| 参数 | 含义 | 例 |
|---|---|---|
| `last` | 只导出最近一段时间 | `{ last: "2m" }` |
| `since` / `until` | 时间窗边界(绝对 `"14:30"` 或相对) | `{ since: "14:30" }` |
| `around` / `window` | 锚到某 messageID 前后 | `{ around: "msg_x", window: "30s" }` |
| `profile` | 预设场景过滤(§4.3) | `{ profile: "no-feedback" }` |
| `types` | 按类别/前缀过滤 | `{ types: ["error","status"] }` |
| `full` | 附带当前 session 的 message/part dump | `{ full: true }` |
| `events` | 导出条数上限 | `{ events: 80 }` |

**默认(不传参)= 最近一次发送(`lastSend.ts`)到现在** —— 正好"刚才那轮"。

### 4.3 `profile` 预设(与症状表对齐)
让排查方一句话拿精准子集,不必记 event.type。精确映射见 §5.2。

| profile | 对应症状 |
|---|---|
| `no-feedback` | §2.2 发消息无反应 |
| `stuck` | §2.2-D 卡在等用户 |
| `errors` | 任意报错 |
| `blank` | §2.1 白屏 |
| `upload` | §2.4 上传失败 |

### 4.4 `octoDebug.why()` 速诊
跑规则给"最可能方向 + 看哪条 + 下一步";`snapshot` 顶部自动附其结论摘要(1–2 行)。规则见 §5.3。

### 4.5 默认智能窗
不传参 = `lastSend.ts` → now(见 §4.2)。

### 4.6 捕获层加强(降低漏)
1. 环形缓冲**存全字段**(原始 properties),展示时才精简。
2. 挂 `window.onerror` / `unhandledrejection` → 进缓冲(**未捕获异常**是偶现 bug 头号线索)。
3. 镜像 `console.error` / `console.warn` → 进缓冲(把 `[global-sdk]` 等其他模块/上游日志录进来);insight 挂载期生效、dispose 还原。
4. 镜像 **`[octo:*` 前缀的 `console.log`**(白名单,排除 observer 自身的 `[octo:event]`)→ 进缓冲。让 snapshot 含 `[octo:prompt]`/`[octo:upload]`/`[octo:task]` 等**埋点链路日志**(这些链路本是 `console.log`,不录就拿不到——这是 `upload` profile 能工作的前提)。量可控(只录我们埋的前缀)。
5. delta 仍聚合(否则缓冲被冲爆)。

### 4.7 输出格式
紧凑文本(非 pretty JSON,省行数),复制到剪贴板;每行带**绝对时刻** + **相对 Δ**。样例见 §5.4。

### 4.8 存储位置与目录解耦
- IndexedDB per-origin、electron-log 写 `userData/logs` 固定 app 目录,**均与工作目录无关**。
- 每条记录带 `directory` + `sessionID` 区分来源。**目录选择怎么变都不影响留存与读取。**

---

## 5. 接口契约(实现照此,勿自由发挥)

### 5.1 `snapshot` 签名
```ts
octoDebug.snapshot(opts?: {
  last?: string                  // "30s" | "2m"(相对时长)
  since?: string; until?: string // "14:30"(绝对) | "2m"(相对)
  around?: string; window?: string // messageID + 前后时长
  profile?: "no-feedback" | "stuck" | "errors" | "blank" | "upload"
  types?: string[]               // 直接按 event.type / 来源标签过滤
  full?: boolean                 // 附 message/part dump(默认 false)
  events?: number                // 导出上限(默认按窗口,不截断)
}): string                       // 返回紧凑文本,并尝试写入剪贴板
```
缺省 = 窗口取 `lastSend.ts → now`。

### 5.2 `profile` → 来源/类型 精确映射
缓冲有三类来源:`event`(SSE 事件)、`send`(发送记录)、`log`(console 镜像 + 未捕获异常)。

| profile | 选取 |
|---|---|
| `no-feedback` | send(全部)+ event:`session.status`/`message.updated`/`message.part.updated`/`permission.asked`/`question.asked` + log:`console.error`(含 `[global-sdk]`)、`window.error`、`unhandledrejection` |
| `stuck` | event:`permission.asked`/`question.asked`/`permission.replied`/`question.replied`/`question.rejected`/`session.status` |
| `errors` | log:全部(`console.error`/`console.warn`/`window.error`/`unhandledrejection`)+ event:`global.disposed`/`server.instance.disposed` |
| `blank` | event:`session.status`/`message.updated` + log:`window.error`/`unhandledrejection`（并依赖 §5.3 白屏规则;常配 `full:true` 看 `message[session]` 是否空）|
| `upload` | log:含 `[octo:upload]` 前缀的全部来源(`console.log` 链路 + `console.error/warn`) |

### 5.3 `why()` 规则(条件 → 结论 → 下一步)
| # | 条件 | 结论 / 下一步 |
|---|---|---|
| 1 | 有 send,且其后无实质 event(`server.heartbeat` 等保活事件不入 ring) | 有心跳→"无实质事件但 SSE 心跳仍在 → server 未启动该轮";无心跳→"无事件且无心跳 → 疑似 SSE 断 → 查 log 里 `[global-sdk]`" |
| 2 | `pending`(未 reply 的 permission/question)> 0 | ⚠️ 卡在等用户 → `octoDebug.pending()` |
| 3 | 最近 `send.modelResolved === false` | ⚠️ 发送时模型未解析 → §2.3 |
| 4 | `session.status` 持续 `busy` 超 60s 且无新 `message.part` | ⚠️ 疑似生成卡死 |
| 5 | 在会话(currentSessionID 有值)但 `message[session]` 空 | ⚠️ 疑似白屏 / 未加载 → §2.1 |
| 6 | 有 `window.error` / `unhandledrejection` | ⚠️ 存在未捕获异常 → `snapshot({profile:"errors"})` |

> 规则保守、可解释,只给方向不下死结论。

### 5.4 输出格式样例
```
== snapshot @ 14:32:10 | session=ses_x status=idle | 窗口=最近一次发送→现在 | 12 条 ==
why: ⚠️ 发送后无服务器事件,疑似 SSE 断/未启动该轮 → 查 log 里 [global-sdk]
14:32:01 +0ms     send         msg=msg_x modelResolved=true status@send=idle ep=…/prompt_async
14:32:01 +0ms     (此后无 event)
14:32:09 +8s      log.error    [global-sdk] event stream failed {…}
可用 profile: no-feedback / stuck / errors / blank / upload
```

### 5.5 IndexedDB schema(阶段 2,建议值,可微调)
- DB `octo-insight-debug` v1;object store `ring`,key `current`,value `{ events[], sends[], logs[], updatedAt }`。
- 容量上限:`events ≤ 500`、`sends ≤ 50`、`logs ≤ 200`(超出丢最旧)。节流写(flush 时 / 每 ~2s)。
- 启动异步读回 → merge 进内存缓冲(标记 `persisted:true`)。per-origin,与工作目录无关。

---

## 6. 三阶段实施

| 阶段 | 内容 | 载体 | 触及边界 |
|---|---|---|---|
| 阶段 | 内容 | 载体 | 触及边界 | 状态 |
|---|---|---|---|---|
| **阶段 1** | 平移蓝本基础 + snapshot 参数化(§5.1/5.2)+ `why()`(§5.3)+ 捕获加强(§4.6)+ 紧凑输出(§5.4) | 内存 | 纯 insight 自包含,不碰壳 | ✅ 已落地 |
| **阶段 2** | 缓冲持久化到 **IndexedDB**(§5.5),启动读回,snapshot 带出"重启前"段 | IndexedDB | 纯前端,不碰壳 | ✅ 已落地 |
| **阶段 3** | renderer console **全量转发落盘**(兜底防漏) | 文件 | **限改** UXAI `packages/desktop` | ✅ 已落地(精简版) |

**阶段 3 落地实况**(2026-06-11):
- 落点:`packages/desktop/src/main/windows.ts` 的 `createMainWindow()` 加 `win.webContents.on("console-message", …)`,**全量**转发。**写独立 logger**(`logging.ts` 的 `insightDebugLog = log.create({logId:"insight-debug"})`,`fileName = "insight-debug.log"`)——**不混进主进程 `main.log`**,各自独立 5MB 滚动。
- 日志路径:`{logs目录}/insight-debug.log`(`logs目录` = `~/Library/Logs/{app.getName()}/`,dev = `Octo AI Dev`;各平台见 [insight-debugging §4](../../insight-debugging.md) / [App Name learning](../../learning/electron-app-name.md))。**精简版只做落盘**,「按时间窗/messageID 过滤读取」**未做**——排查方直接打开文件搜(或后续按需加 ipc 读取命令)。

> 阶段 1 提升"现场敲"顺畅度;阶段 2 解决 reload/重启丢失;阶段 3 作"绝对不漏"兜底(结构化没捕获到的、渲染崩溃前的全量 console 都落盘)。

---

## 7. 验收

### 7.1 自动验证
- 阶段 1:`snapshot({last/profile/around/full})` 各参数正确裁剪;`why()` 对 §2 各症状给正确方向;未捕获异常 / `console.error` / `[octo:*` console.log 进得了缓冲;`upload` profile 能抓到 `[octo:upload]` 链路;输出可整段复制;`bun run typecheck` + 单测过。
- 阶段 2:**降级路径**(无 IndexedDB → 纯内存,install/push/dispose 不抛)由现有单测覆盖;持久化 round-trip 因测试环境(happy-dom)无 IndexedDB 无法单测,走 §7.2 人工验证。
- 阶段 3:渲染崩溃前日志能在落盘文件里找到;文件不膨胀(沿用 5MB)。

### 7.2 人工验证(外网即可,阶段 1 不依赖内网)
阶段 1 纯前端、不依赖内网 MCP/上传/server 业务——**外网起 app、发普通消息就能验证**。以下几点单测覆盖不到,必须人工过一遍:

1. **真实 SSE 下的事件流**:进 insight 发一条普通消息 → Console 应依次见 `[octo:event] session.status{busy}` → `message.updated`/`message.part.updated`/`delta ×聚合` → `session.status{idle}`。
2. **snapshot 可用性**:`octoDebug.snapshot()` → 返回紧凑文本、**顶部 `why:` 给出方向**、**已写入剪贴板**(粘贴验证);`snapshot({profile:'no-feedback'})` 等各档只含对应子集。
3. **why 准确性**:制造各症状(发消息后断网 / 触发 permission)→ `octoDebug.why()` 给的方向对得上 §2。
4. **noise 控制**:`octoDebug.verbose(true)` 后 delta 逐条、信息全;`compact`(默认)不刷屏;`quiet` 完全静默但 `events()` 仍可回放。
5. **镜像无副作用**:开着 observer 正常使用 insight,`console.*` 输出正常、页面无异常;离开 insight(dispose)后 `window.octoDebug` 消失、`console` 还原。
6. **阶段2 持久化(reload/重启)**:发几条消息 → 整页刷新(或重启 app)→ 重新进 insight → `octoDebug.snapshot()` 顶部应出现「含 N 条重启前」、`events()` 能看到刷新前的事件;`server.heartbeat` 不应出现在 ring 里。

---

## 8. 与文档 / 约束的关系
- 每完成一阶段,同步更新 [insight-debugging.md](../../insight-debugging.md)(命令、参数、`why()` 方向、阶段能力)与 [ROADMAP.md](../../../ROADMAP.md)。
- **debug 工作流 SOT = 本 spec §3**。[docs-uxai-perspective-rewrite](../infra/docs-uxai-perspective-rewrite.md) 重写 `development.md` 时,其"调试 / 排查"章节**引用本 spec §3 工作流**,不重复另写。
- **console 字典可靠性约束**(本 spec 触发,已写入 [CLAUDE.md](../../../CLAUDE.md) / CLAUDE.uxai):`[octo:*]` 前缀 / 字段 / `octoDebug` 命令增删改,必须同步 insight-debugging.md。
- 阶段 3 改 `packages/desktop` 属非业务包变更,按 architecture.md §5.4 登记 + 视情况同步 [intranet-handoff.md](../../intranet-handoff.md)。
