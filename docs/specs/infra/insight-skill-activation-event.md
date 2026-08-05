# SPEC-INS-029：@技能激活的服务端事件上报（`extra.skills` → `skill.used`）

> **状态**：草案（待实现）
> **上游已实现**：✗（上游只有两条发 `skill.used` 的路——模型自主调 `skill` 工具、用户走 `session.command`；insight 的「前端注入式技能激活」不经这两条，没有对应上报口。但 `PromptInput.extra` 与 instance bus → GlobalBus 转发均为上游现成物，本 spec 不新增概念）
> **领域**：infra/insight（事件上报层）
> **关系**：补 [SPEC-INS-023 §2.2](../ui/insight-mention-at.md) 明确接受的那项代价（「不发 `SkillUsed` 事件」）；不改 023 的 synthetic 注入机制本身
> **起因**：内网同事的全局 `skill.used` 监听器统计不到 insight 的技能调用。首个修法 [UXAI #578](https://github.com/MyHeavenDyf/UXAI/pull/578)（`/skill` 走 `session.command`）已关闭，理由见 §2.1

---

## 1. 问题陈述

insight 的技能激活走 SPEC-INS-023 §2.2 的 **3b 路线**：前端读 `SKILL.md` → 作 synthetic text part 注入 `promptAsync`。这条路**完全不经服务端的技能概念**——服务端只看到一段普通的 synthetic 文本，不知道「有技能被激活了」。

于是 `skill.used` 事件的两个发布点都不会触发：

| 发布点 | 触发条件 | insight @技能是否触发 |
|---|---|---|
| `tool/skill.ts:39-42` | 模型自主调 `skill` 工具 | ✗（技能内容已在上下文里，模型无需调工具） |
| `session/prompt.ts:1814-1816` | 走 `session.command` 且 `cmd.source === "skill"` | ✗（insight 不走 command） |

**这是 023 §2.2 写明并接受的代价**，不是实现缺陷。本 spec 是在需求出现后把这项代价补上，**不推翻 3b**。

### 1.1 范围

- **做**：让 insight 的 @技能激活在服务端产出 `skill.used` 事件
- **不做**：改 `SkillUsed` 事件体（加 `sessionID` / `source`）——见 §6 已知缺陷
- **不做**：改用户气泡渲染、改 turn 级 tools gate、改 synthetic 注入机制
- **不做**：为 insight 恢复 slash 命令入口（023 §1.2 已明确移除）

---

## 2. 架构决策：谁产出业务事件

核心问题不是「怎么发一个事件」，而是**「用户显式激活技能」这个事实由客户端产出还是服务端产出**。

### 2.0 业界做法对比

| 做法 | 代表 | 事件产出方 | 适用前提 |
|---|---|---|---|
| **A. 客户端直接产出业务事件** | Segment / GA4 前端 SDK、Mixpanel | 客户端 | 事件只用于分析，容忍丢失与口径漂移 |
| **B. 服务端在权威侧产出** | Stripe `events` / GitHub webhooks / AWS EventBridge | 服务端 | 事件要被其他系统消费、要做对账，需单一事实源 |
| **C. 客户端声明意图，服务端产出事件** | Stripe `metadata` + 服务端 event、AWS API `ClientToken` 类字段 | 服务端（依据客户端传入的结构化意图） | 权威侧不掌握该意图，但事件仍需服务端统一产出 |

需求是「全局 bus 上有 `skill.used`，供跨模块监听器消费」——这是 **B 的场景**（事件要被别的系统消费）。但 insight 这条链路里，**服务端不掌握「技能被激活」这个意图**（技能内容是前端读的、以无标记 synthetic 文本送进来的）。所以落到 **C**：客户端只声明意图，事件仍由服务端发。

这也解释了为什么不能简单「让前端 tracker 多打一条」：前端打点进不了服务端事件流，同事的全局监听器（订阅 SSE `/event`）根本收不到。

### 2.1 候选方案

| | 方案 | 结论 |
|---|---|---|
| **3a** | `/skill` 文本走 `session.command`（[UXAI #578](https://github.com/MyHeavenDyf/UXAI/pull/578)） | ✗ 已否 |
| **3b′** | 前端 tracker 多打一条 | ✗ 不满足需求 |
| **3c** | `promptAsync` 带 `extra.skills` → 服务端 publish | ✓ **选中** |

**3a 被否的四条理由**（对应 #578 的 review，逐条可复核）：

1. **覆盖面错位**：insight 技能入口是 `@` 面板，胶囊序列化成 `@技能名`（`prosemirror-editor/schema.ts:104`），不是 `/技能名`；编辑器移植时已去掉 slash 触发（023 §1.2）。只拦 `/` 等于没修主路径。排队 drain（`utils/queue-drain.ts:136`）也未同步。
2. **气泡污染（必现）**：command 分支的 `resolvePromptParts(template)` 产出**非 synthetic** text part（`session/prompt.ts:143`），且排在 `input.parts` 之前（`prompt.ts:1772`）。insight 用户气泡是上游 `SessionTurn`（`insight-turn.tsx:524`），取第一个非 synthetic text part（`packages/ui/src/components/message-part.tsx:1131`）→ 整篇 SKILL.md 进气泡。**这正是 023 §2.2 选 3b 的唯一理由**。make 能走 command 是因为它有自己的 turn 渲染器读 `metadata.displayText`（`make/index.tsx:1990`），insight 没有。
3. **丢 turn 级 tools gate**：`CommandInput`（`prompt.ts:1909`）无 `tools` 字段。而 `tools` 被服务端转成 **session 级 permission 持久化**、靠每轮覆盖（`prompt.ts:1411-1418`）→ 新会话首条 `/skill` 会让全部 MCP 业务工具 + `task` 可见（违反 SPEC-INS-021）；上一轮是 chip turn 时则继承 chip 的 `bash: false`，卡死 interview-analysis 这类需要 bash 的技能。
4. **阻塞语义变了**：`promptAsync` 立即返回，`session.command` 走同步 `prompt()` → `loop()`，HTTP 挂到整轮结束 → `armNoFeedbackWatchdog` 失效；中途超时会删掉 optimistic 消息并弹「发送失败」，而服务端其实在跑。

**3b′ 被否**：insight 已有 `mention-select{type:skill}`（用户侧）和 `server-skill-used`（`insight-turn.tsx:479`，从 assistant parts 识别）两条前端打点。但它们只进埋点系统，不进服务端事件流，跨模块监听器收不到。属于做法 A，与需求场景（B）不匹配。

### 2.2 选定：3c

前端把「本轮激活了哪些技能」作为**结构化字段**随 `promptAsync` 传给服务端，服务端在权威侧发 `skill.used`。

链路全部是上游现成物，已逐段核实：

- `PromptInput.extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))`（`prompt.ts:1909` 附近）已存在，SDK 类型已生成，studio 已在用（`studio-page.tsx:2244`）→ **前端无需改 schema**
- `prompt()` 开头即处理 `input.extra`（`prompt.ts:1405`）
- `promptAsync` 路由调的是同一个 `svc.prompt`（`server/routes/instance/session.ts:941`，只是不 await）→ **同步 / 异步两条路都覆盖**
- instance bus 的 `publish` 会转发到 `GlobalBus`（`bus/index.ts:87-107`），前端 SSE 收得到 —— 与现有 command 分支同一条路，已被验证

**落点在 service 层（`prompt()`）而非路由层**，因此不受 CLAUDE.md 记录的「Hono 路由 vs Effect HttpApi 两套后端」影响——两套路由最终都调 `svc.prompt`。

---

## 3. 数据流

```
用户 @ 选技能
  └─ handleSubmit → splitMentions → mentions.skills: string[]
       └─ doSendPrompt
            ├─ getSkillContent(name) 逐个读 SKILL.md
            │    ├─ 成功 → mentionBlocks.push(<skill_content>)  ┐
            │    └─ 失败 → failedSkills.push(name) + toast      │
            └─ promptAsync({ ..., extra: { skills: 成功的那批 } }) ┘
                 └─ 服务端 prompt()：读 input.extra.skills
                      └─ bus.publish(SkillUsed, { skillName })
                           └─ GlobalBus → SSE /event → 全局监听器
```

**只上报注入成功的技能**：`failedSkills` 里的技能内容没进上下文（023 §7.2 降级分支），上报它们会让统计虚高，且与用户看到的「技能未生效」toast 自相矛盾。

---

## 4. 实现清单

### 4.1 服务端 `packages/opencode/`

**`src/session/prompt.ts`** — `prompt()` 内，紧邻现有 `if (input.extra) sessionExtras.set(...)`：

- 从 `input.extra?.skills` 取 `string[]`（防御性校验：非数组 / 非字符串元素直接忽略，不抛错——上报失败不该阻断发送）
- 逐个 `yield* bus.publish(SkillUsed, { skillName })`
- 落点：`sessions.touch(input.sessionID)` 之后。即在 `createUserMessage` **之后**（用户消息已落库，监听器要反查会话时有据）、`if (input.noReply === true) return message` **之前**（`noReply` 只建消息不跑模型，但技能确实已进上下文，同样该发）

`SkillUsed` 已在文件顶部 import（`prompt.ts:32`），无需新增依赖。

### 4.2 前端 `packages/app/octoapp/pages/insight/`

**`index.tsx`（`doSendPrompt`）**：`promptAsync` 调用补 `extra`。技能名取「成功注入」那批——现有代码只把成功的 push 进 `mentionBlocks`，需同时收集一个 `injectedSkills: string[]`（与 `failedSkills` 对偶）。无技能时不传 `extra`（保持 payload 干净）。

**`utils/queue-drain.ts`（`sendQueuedItem`）**：同一份逻辑。该文件已自带 skill 注入分支（读 `item.skills`），同样只报注入成功的。

> 两处必须同步：SPEC-INS-027 立 `assembleInsightParts` 公共骨架就是为了防这类双路径漂移，本次新增字段不进骨架（骨架只管 parts 组装），故靠 spec 与 review 保证一致。

### 4.3 影响面核查（`prompt()` 是全模块公共入口，须逐条证明）

改动落在 `session/prompt.ts` 的 `prompt()` 里，chat / make / studio / pattern / insight 的**每一次发送**都流经这段。三个可能的外溢通道逐一核过：

**① 会不会误读别的模块的 `extra`？** 不会——`extra.skills` 这个键全仓唯一。走 `session.prompt` / `promptAsync` 的调用点共 9 处：

| 调用点 | 是否传 `extra` | 键 |
|---|---|---|
| `components/prompt-input/submit.ts`（chat 共享 composer） | ✗ | — |
| `pages/chat/utils/followup-drain.ts` | ✗ | — |
| `pages/make/index.tsx`（2 处） | ✗ | — |
| `pages/pattern/utils/rename.ts`、`modules/sidebar/sidebar.tsx` | ✗ | — |
| `pages/pattern/agents/run-child-session.ts` | ✓ | `designSystem` / `patterns` / `pagePattern` |
| `pages/insight/index.tsx`、`utils/queue-drain.ts` | ✓ | **`skills`（本 spec 新增）** |

studio 那一批 `extra`（`skipPromptRefine` / `generationExtra` / `firstFrame` / `mode` …）走的是 studio 生成接口（`fetch` → `studio-service`），**不经 `session.prompt`**。`agent.ts` 里的 `skills: ["interview-analysis"]` 是 agent 配置的技能白名单，与 `PromptInput.extra` 无关。

**② 事件多发会不会影响现有前端？** 不会——全仓订阅 `skill.used` 的只有 `global-sync/event-reducer.ts:401`，`case "skill.used"` 是空 `break`（no-op，注释写明「由前端 hook 消费」）。现有模块无任何行为绑定在该事件上；新增的事件对它们是静默的。

**③ 上报失败会不会拖垮发送？** 加双保险堵死：

- `readActivatedSkills` 对脏输入静默返回空数组（不抛错）
- `bus.publish(...).pipe(Effect.catchDefect(() => Effect.void))` —— `publish` 类型上错误为 `never`，但它内部 `GlobalBus.emit` 是**同步 EventEmitter**，某个 SSE 订阅者抛错会顺栈冒上来变成 defect。不兜底就可能让一次正常发送失败。**宁可丢事件，不能丢消息。**

无 `extra.skills` 时的增量开销 = 一次属性读取 + 一次 `Array.isArray`，循环不进入。

### 4.4 不改动

- `SkillUsed` 事件体（`skill/events.ts`）
- `CommandInput` / command 分支
- 用户气泡渲染、tools gate、synthetic 注入内容

---

## 5. 验证（外网）

> **验证前先重启 opencode server**：本 spec 改 `session/prompt.ts`（服务端 service 层），不重启不生效。

### 5.1 服务端事件（自动化，不依赖 UI / 模型）

事件断言走 Effect 集成测试而非手工 curl：`prompt({ noReply: true })` 只建用户消息不跑模型，既省掉 provider 依赖，又正好锁住「publish 落在 `noReply` 提前返回之前」这个落点。

1. `packages/opencode/test/session/prompt.test.ts` 加用例 `prompt publishes skill.used from extra.skills`：订阅 `bus.subscribeCallback(Skill.SkillUsed, …)`，逐个断言
   - 一轮多技能 → 逐条发、不合并、保序
   - 不带 `extra` → 不发
   - `extra` 只有其他字段（如 studio 的 `skipPromptRefine`）→ 不误发
   - 脏输入（`skills: "not-an-array"` / `[123, null, ""]`）→ 不发事件且不抛错
   跑：`bun test test/session/prompt.test.ts -t "SPEC-INS-029"`
2. `packages/opencode/test/session/skill-activation.test.ts`（新增）：`readActivatedSkills` 纯函数的边界表，6 条
3. **回归**：`bun test test/session/prompt.test.ts` 全量，与 `origin/dev` 基线逐条对比

（可选的手工链路验证：起本地 server → `curl -N http://127.0.0.1:<port>/event` 订阅 → 打 `prompt_async` 带 `extra.skills` → 看事件流。集成测试已覆盖同一条 publish 路径，此步只在怀疑 SSE 转发环节时才需要。）

### 5.2 前端字段（不依赖内网技能）

4. `packages/app` typecheck（`tsgo -b`）+ `packages/opencode` typecheck（`tsgo --noEmit`）
5. insight 单测全绿：`bun test --preload ./happydom.ts ./octoapp/pages/insight`
6. **手动**：insight 页选一个本地可读的技能发送 → devtools Network 看 `prompt_async` 请求体含 `extra.skills`，且与气泡里的 `@名` 一致
7. **手动 · 降级路径**：mock `getSkillContent` 返回 `{success:false}` → toast「技能未生效」出现，且请求体**不含**该技能名（无成功注入时整个 `extra` 缺席）
8. **手动 · 排队路径**：busy 时带技能发送 → idle drain 后，drain 那条请求同样带 `extra.skills`

### 5.3 回归（确认零副作用）

9. 气泡仍只显示用户原话 + `@名`，不显示 SKILL.md
10. `prompt_async` 请求体仍带 `tools`（turn 级 gate 未丢）
11. 现有 `utils/mention.test.ts` / `store/mcp-trigger.test.ts` 全绿

> 全部可在外网完成。技能内容读取走 Electron IPC，非桌面渠道降级为不注入——第 7 条即覆盖该分支，不需要内网真实技能库。

---

## 6. 已知缺陷 / 风险（本次不修，记录在案）

- **事件无法归因到 module**：`SkillUsed` 事件体只有 `skillName`（`skill/events.ts`）。GlobalBus 转发时外层带 `directory` / `project` / `workspace`，但**没有 `sessionID` / `agent`** → 全局监听器分不清 insight / make / studio。`insight-turn.tsx:424` 已记录过同一问题（这正是 insight 当初把 `server-skill-used` 做成 turn 内识别、而非消费全局事件的原因）。
  **影响**：本 spec 让事件发得出来，但同事若要按 module 维度统计，仍需另行解决。修法是给事件加 `sessionID`（+ 可选 `source`），三个 publish 点都拿得到；代价是改上游事件 schema + 重新生成 SDK 类型，需先与监听方对齐字段口径。
- **语义混同**：`tool` / `command` / 本 spec 新增的注入式激活三条路发的是同一个事件，无法区分「模型自主加载技能」与「用户主动使用技能」。同上，靠 `source` 字段解决。
- **技能进上下文 ≠ 技能生效**：3b 注入只保证 SKILL.md 进上下文，模型是否照做无从确认。本事件的语义应理解为「用户显式激活了技能」，不是「技能产生了效果」。
- **一轮多技能**：023 §11 允许多选，事件按技能逐条发（N 个技能 → N 条事件），不合并。

---

## 7. 落地记录

- **2026-08-05 实现（外网，UXAI 分支 `feat/insight-skill-activation-event`）**，验证结果：
  - `prompt.test.ts -t "SPEC-INS-029"` 1 pass（连跑 5 次稳定）；`skill-activation.test.ts` 6 pass
  - `prompt.test.ts` 全量 **48 pass / 2 fail**，连跑 3 次稳定。这 2 个失败（`running task tool preserves metadata after tool-call transition`、`unknown agent error includes available agent names`）**在干净 `origin/dev` 上同样失败**（基线 47 pass / 2 fail），与本改动无关
  - `packages/opencode` + `packages/app` typecheck 全绿
  - insight 单测 261 pass / 0 fail；`packages/app` `test:unit` 328 pass / 0 fail
- **待**：提 PR（base `dev`）；§5.2 第 6–8 条手动项 + 内网真实技能库下的端到端确认
