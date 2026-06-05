# SPEC-INS-011 — Insight 内网调试可观测工具(debug-observer)

> 状态:草案 · 优先级 P1 · 规模 [M] · 领域 ui/insight · 类型:实现 spec
>
> **上游已实现**:
> - ✓ SSE 事件总线 + 旁路订阅点(`globalSDK.event.listen()`,[global-sdk.tsx](../../../packages/app/src/context/global-sdk.tsx))——本 spec 在其上做**只读旁路观测**,不改 GlobalSync / event-reducer
> - ✓ 主进程日志基建(electron-log + `tail()`,[logging.ts](../../../packages/desktop-electron/src/main/logging.ts),5MB/文件 + 7 天滚动清理)——阶段 3 复用,不自建
> - ✗ 业务侧「SSE 事件观测 + console 取数 API + 现场快照」(本 spec 新增,自包含于 `insight/lib/debug-observer.ts`)

---

## 1. 背景与目的

### 1.1 约束

- bug 多发生在**内网**,排查方在外网,**只能靠 console**(抓不到 Network/SSE,不方便起服务跑命令)。
- 现场外发只能**复制文本段落**(文件发不出去),所以"导出的东西必须短到能整段复制、又不漏关键线索"。
- 有相当比例是**偶现 / 不可复现**:测试可约束不关页面,但真实用户报错后会关软件——**等知道时现场可能已不在**。

### 1.2 目标

把"出 bug → 定位"压成一条顺滑链路:**敲一行 `octoDebug.snapshot(...)` → 得到一段「带初判结论 + 按需过滤」的紧凑现场 → 对照 [insight-debugging.md](../../insight-debugging.md) 定位**。并保证现场**不因 reload/重启/过滤而丢失关键线索**。

### 1.3 核心设计原则

1. **捕获要全,展示才过滤**:环形缓冲按"全字段 + 全来源"捕获;`snapshot()` 的参数只控制**展示/导出**的子集。过滤是导出时的事,不是捕获时的事——避免"预先决定要留什么"导致漏。
2. **两层防漏**:结构化层(好取、可粘贴)负责日常 90%;全量层(原始 console 落盘)负责"绝对不漏"的兜底。两层职责不同,不互相替代。
3. **存储与目录解耦**:debug 留存位置固定(IndexedDB per-origin / electron-log app 目录),**不跟随用户选的工作目录**;只在每条记录里标注当时的 `directory` + `sessionID`。

---

## 2. 已落地(阶段 1 第一步,已完成)

- `[octo:event]` SSE 事件旁路日志([debug-observer.ts](../../../packages/app/src/pages/insight/lib/debug-observer.ts)),默认 compact、delta 聚合。
- `window.octoDebug`:`help / state / dump / events / sends / lastSend / pending / snapshot / mode / verbose`。
- 事件 + 发送**内存**环形缓冲(200 / 30)。
- 文档:[insight-debugging.md](../../insight-debugging.md) §0.5 数据流全貌、§1.0 事件字典、§2 症状表接入 event 维度、§3 octoDebug 命令、§4 Network 速查。

---

## 3. 设计

### 3.1 两层防漏架构

| 层 | 载体 | 角色 | 抗丢失 |
|---|---|---|---|
| 结构化层 | 内存环形缓冲 →(阶段 2)IndexedDB | 好取、可粘贴、带初判 | 阶段 2 起跨 reload/重启 |
| 全量层 |(阶段 3)electron-log 文件 | 原始 console 兜底,防"过滤漏掉" | 跨一切(含渲染崩溃前) |

> 结构化层再怎么加强都是有损的;真正"零漏"只有全量原始 console(阶段 3)。两层并存,日常用结构化、诡异偶现回查全量。

### 3.2 `snapshot(opts?)` 参数化(全部可选,只控制导出)

| 参数 | 含义 | 例 |
|---|---|---|
| `last` | 只导出最近一段时间(字符串好输) | `{ last: "2m" }` |
| `since` / `until` | 时间窗边界(绝对 `"14:30"` 或相对) | `{ since: "14:30", until: "14:35" }` |
| `around` / `window` | 锚到某 messageID 前后 | `{ around: "msg_x", window: "30s" }` |
| `profile` | 预设场景过滤(见 §3.3) | `{ profile: "no-feedback" }` |
| `types` | 直接按事件类别/前缀过滤 | `{ types: ["error","status"] }` |
| `full` | 附带当前 session 的 message/part 原始 dump | `{ full: true }` |
| `events` | 导出条数上限 | `{ events: 80 }` |

**默认(不传参)= 最近一次发送(`lastSend.ts`)到现在** —— 正好"刚才那轮",最贴排查直觉。

### 3.3 `profile` 预设(与症状表对齐)

让排查方一句话拿到精准子集,不必记 event.type:

| profile | 含哪些 | 对应症状 |
|---|---|---|
| `no-feedback` | prompt send/sent + session.status + message.* + permission/question.asked + `[global-sdk]` error + 未捕获异常 | §2.2 发消息无反应 |
| `stuck` | permission/question.asked + pending + status | §2.2-D 卡在等用户 |
| `errors` | 所有 error/warn + 未捕获异常 + `[global-sdk]` | 任意报错 |
| `blank` | session.sync + status + message 加载 + 未捕获异常 | §2.1 白屏 |
| `upload` | `[octo:upload]` 链路 + 相关 error | §2.4 上传失败 |

> 工作流:用户给现象 → 排查方判断方向 → 让用户 `snapshot({ profile: "xxx" })` 只拷该子集 → 不够再换 profile。`snapshot` 输出尾部附"可用 profile 提示"。

### 3.4 `octoDebug.why()` 速诊(把 §2 症状表内置成规则)

跑一组规则,输出"最可能方向 + 看哪几条 + 下一步",`snapshot` 顶部自动附带其结论摘要(1–2 行给方向)。规则示例:

- `lastSend` 后无任何 event → "疑似 SSE 断 / 未启动该轮;查 `[global-sdk]` error"
- 有 `permission/question.asked` 未 reply → "卡在等用户;`octoDebug.pending()`"
- `lastSend.modelResolved === false` → "发送时模型未解析(§2.3)"
- `status` 持续 busy 超阈值且无新 part → "疑似生成卡死"
- 在会话页但 `message[session]` 空 → "疑似白屏/未加载(§2.1)"

> 规则要保守、可解释,只给"方向 + 看哪条",不下死结论,避免误导。

### 3.5 捕获层加强(降低漏,阶段 1–2)

让结构化层尽量不漏:

1. 环形缓冲**存全字段**(原始 properties),展示时才精简 —— 捕获无损、显示才过滤。
2. 挂 `window.onerror` / `unhandledrejection` → 进缓冲(**未捕获异常**是偶现 bug 头号线索,现在完全没抓)。
3. 镜像 `console.error` / `console.warn` → 进缓冲(把 `[global-sdk]` 等其他模块/上游日志也录进来),insight 挂载期间生效、dispose 还原。
4. delta 仍聚合(否则缓冲被冲爆)。

### 3.6 输出格式

紧凑文本(非 pretty JSON,省行数),复制到剪贴板:

```
== snapshot @ 14:32:10 | session=ses_x status=idle | 窗口=最近一次发送→现在 | 12 事件 ==
why: ⚠️ 发送后无服务器事件,疑似 SSE 断/未启动该轮 → 查 [global-sdk] error
14:32:01 +0ms     prompt.sent       msg=msg_x model=… ep=…/prompt_async
14:32:01 +0ms     (此后无 [octo:event])
...
可用 profile: no-feedback / stuck / errors / blank / upload
```

每行带**绝对时刻**(对时间段)+ **相对 Δ**(看节奏)。

### 3.7 存储位置与目录解耦(回应"得有地方存")

- **IndexedDB**(阶段 2):per-origin,与用户选的工作目录无关,全局一份;库内按 `sessionID` 分组。
- **electron-log**(阶段 3):写 `userData/logs` 固定 app 目录,与工作目录无关。
- 每条事件/快照记录里带 `directory` + `sessionID`,以便区分是哪个目录/会话出的 bug。
- **结论**:目录选择怎么变,都不影响 debug 留存与读取。

---

## 4. 三阶段实施

| 阶段 | 内容 | 载体 | 触及边界 |
|---|---|---|---|
| **阶段 1**(本 spec 主体) | snapshot 参数化(§3.2/3.3)+ `why()`(§3.4)+ 捕获层加强(§3.5)+ 紧凑输出(§3.6) | 内存 | 纯 insight 自包含,不碰壳 |
| **阶段 2** | 环形缓冲持久化到 **IndexedDB**,启动读回,snapshot 带出"重启前"段 | IndexedDB | 纯前端,不碰壳 |
| **阶段 3** | renderer console **全量转发落盘**(electron-log),+ 按时间窗/messageID 过滤读取 | 文件 | **限改** desktop-electron/main + 变更登记(architecture.md §5.4) |

> 阶段 1 即可大幅提升"现场敲"的顺畅度;阶段 2 解决 reload/重启丢失;阶段 3 作"绝对不漏"兜底,按真实需求再上。

---

## 5. 验收

- 阶段 1:`snapshot({last/profile/around/full})` 各参数正确裁剪;`why()` 对 §2 各症状给出正确方向;未捕获异常 / `console.error` 进得了缓冲;输出可整段复制。
- 阶段 2:reload / 重启后 `snapshot()` 仍带得出之前的事件;IndexedDB 容量有上限不膨胀。
- 阶段 3:渲染崩溃前的日志能在落盘文件里找到;文件不膨胀(沿用 5MB/7 天)。

---

## 6. 对文档 / 约束的影响

- 每完成一阶段,同步更新 [insight-debugging.md](../../insight-debugging.md)(命令表、参数说明、`why()` 方向、阶段能力)。
- **console 字典可靠性约束**(本 spec 触发):任何 `[octo:*]` 日志前缀 / 字段的新增、修改、删除,必须同步 insight-debugging.md 日志字典——人读 / AI 读都依赖它。已写入 [CLAUDE.md](../../../CLAUDE.md)。
