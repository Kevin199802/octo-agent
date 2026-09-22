# SPEC-INS-033 — 会话身份工具 `get_session_identity`（供 skill 读取当前用户与会话标识）

> **上游已实现 ✗** —— octo 自加的原生工具，上游 opencode 没有对应能力。
>
> **相关 spec**：[SPEC-INS-030 §5](insight-knowledge-search.md#5-q4account限流必修)（`account` 经 `promptAsync.extra` 透传到工具 `ctx.extra` 的先例，本 spec 复用同一条管道）、[SPEC-INS-029](../infra/insight-skill-activation-event.md)（`extra` 管道的来历）、[`task` 子代理 — skill 作者须知](task-tool-for-skills.md)（同类对外约定）。
>
> **状态**：已合入 dev（UXAI [#909](https://github.com/MyHeavenDyf/UXAI/pull/909)），外网验证见 §8，内网 N1 待验。

---

## 0. 结论锚点

| 项 | 结论 |
|---|---|
| 要解决的问题 | 同事的 skill 在 insight 本地 agent 里调内网接口时，需要当前用户的 `userId`、`account` 和当前会话的 `sessionId`。skill 是文档 + 脚本，**访问不到工具的 `ctx.extra`** |
| 做法 | 新增原生工具 `get_session_identity`：无入参、不发网络请求，从 `ctx.extra` / `ctx.sessionID` 读出三个值、原样输出进模型上下文；skill 指示模型先调它、再原样使用返回值 |
| 工具命名 | `get_session_identity`：动宾结构（读取类动作一眼可辨）；**不带 `insight` 前缀**——可见范围由 registry 网关控制，名字不重复表达，日后开放给其他 agent 也不必改名（skill 里会写死这个名字，稳定优先）；用 `identity` 而非 `info`/`context`，范围收窄到「身份值」，暗示需逐字使用 |
| 可见范围 | 只开放给 `octo_insight`；chip turn（研究工具那一轮）由 `buildToolGate` 关闭 |
| 缺失处理 | 缺 `userId` → **显式失败**（不输出空串、不兜底）；缺 `account` → 不阻断，只省略该行 |
| 已否决（不再讨论） | 环境变量注入、占位符替换、skill 直接读 localStorage |

---

## 1. 数据流

```
renderer  localStorage.userInfo ──► currentAccount() / currentUserId()   (pages/insight/utils/account.ts)
             │
             ▼  promptAsync({ extra: { skills?, account?, userId? } })
          即时发送 pages/insight/index.tsx  ·  排队发送 pages/insight/utils/queue-drain.ts
             │
server    session/prompt.ts：按 sessionID 存进 sessionExtras，原样铺进工具 ctx.extra
             │
             ▼
          get_session_identity：读 ctx.extra.userId / ctx.extra.account / ctx.sessionID → 文本输出
             │
             ▼
          模型上下文 ──► skill 指示模型把这些值原样填进接口调用（bash 参数等）
```

- `userId` 与 `account` 同源（同一个 `localStorage.userInfo`），取值规则一致：字符串、trim、空即 `undefined`，**不做兜底**。
- `sessionId` 取 server 端的 `ctx.sessionID`，不经 renderer，天然可信。
- 两个发送入口必须**同构**地带上 `userId`，否则「会话忙碌时排队发出的那条」会缺字段（§7 V4 专门覆盖）。
- **insight 每轮都必须带 `extra`（字段都没有时传 `{}`）**。server 端 `session/prompt.ts` 是 `if (input.extra) sessionExtras.set(...)`——**某轮不传 `extra`，就沿用上一轮存下的值**。原先 renderer 在 skills / account 都没有时整个 `extra` 不传，于是「同一会话里登录态丢失后再发」工具仍会拿到上一轮的旧身份，而不是显式失败（2026-09-22 实测复现，见 §8）。修在 renderer 的两个发送入口（改为总是传），**不改 server**：`sessionExtras` 是 make / studio 共用的路径，它们可能依赖「沿用」语义。这个修复也顺带修了 `knowledge_search` 的同类问题（登录态丢失后仍用旧 account）。

---

## 2. 工具契约

- **id**：`get_session_identity`
- **入参**：无（空 Struct）
- **网络**：不访问
- **description**（进模型上下文）：读取当前登录用户与当前会话的标识；需要以当前用户或当前会话的身份调用内部接口时使用；返回值须逐字原样使用。**不引用任何 UI 概念**。

### 2.1 正常输出

身份值与说明文字分行隔开、每行一个值，便于模型逐字转抄：

```
当前会话身份(系统提供,调用接口时逐字原样使用,不要改写、补全或推测):
userId: <值>
account: <值>
sessionId: <值>
```

`account` 缺失时**只省略 `account:` 这一行**，其余照常输出（缺 account 不影响需要 userId 的接口）。

### 2.2 缺 `userId`：显式失败

```
未获取到当前登录身份,请如实告知用户需要重新登录,不要编造或推测身份信息。
```

不输出任何身份值（包括 sessionId），避免模型拿着半套身份继续调接口。

### 2.3 日志

server 端，前缀 `[octo:ctx]`，**只记缺了哪些字段，不打身份值本身**：

| 消息 | 级别 | 字段 | 含义 |
|---|---|---|---|
| `identity missing` | error | `sessionID` / `missing` | 缺 `userId`，工具已返回显式失败 |
| `identity partial` | warn | `sessionID` / `missing: ["account"]` | 缺 `account`，已省略该行、正常返回 |

renderer 侧不另加日志：`userInfo` 整体缺失时 `[octo:kb] account missing` 已会在 DevTools 出现；日志字典见 [insight-debugging.md](../../insight-debugging.md)。

---

## 3. 网关

| 位置 | 规则 |
|---|---|
| `packages/opencode/src/tool/registry.ts` `tools()` | 仿 `knowledge_search`：`tool.id === GetSessionIdentityTool.id` 时只对 `octo_insight` 返回 true。其他 agent 的 `extra` 里没有 `userId`，放出去只会得到一次必然的失败 |
| `pages/insight/store/mcp-trigger.ts` `buildToolGate` | chip turn 置 `false`，与 `knowledge_search` 一致；普通轮次不下发（常驻可用） |
| agent 权限层 | 不动：`defaults` 为 `"*": "allow"`，`octo_insight` 未 deny 它 |

---

## 4. 给 skill 作者的约定

1. **skill 第一步先调 `get_session_identity`**，在 SKILL.md 里用自然语言写明，例如「开始前先调用 get_session_identity 获取当前会话身份」。
2. **之后调接口时原样使用返回的值**：`userId` / `account` / `sessionId` 逐字填入，不要让模型改写、补全、转大小写或推测。建议在 SKILL.md 里明确写「逐字使用 get_session_identity 返回的值」。
3. **不要在 skill 里写死这些值**（包括示例里的真实工号 / userId）——写死的值会被模型当成当前用户使用。
4. **工具返回「未获取到当前登录身份」时停止调用接口**，按返回文案如实告知用户重新登录；不要让模型换个办法凑出身份。
5. `account` 可能缺失（返回里没有 `account:` 行）：接口若必须带 account，skill 应视同缺身份处理，不要编造。
6. 本工具只在 insight 的主 agent（`octo_insight`）普通轮次可用；子代理（`insight_reader`）和「研究工具」那一轮拿不到它。

---

## 5. 实现落点（UXAI）

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/tool/get_session_identity.ts` | 新增工具；导出 `formatIdentity` / `MISSING_USER_OUTPUT` 供单测 |
| `packages/opencode/src/tool/registry.ts` | 注册 + `octo_insight` 网关 |
| `packages/app/octoapp/pages/insight/utils/account.ts` | 新增 `currentUserId()`，与 `readAccount` 共用 `readUserInfoField` |
| `packages/app/octoapp/pages/insight/index.tsx` | 即时发送的 `extra` 加 `userId`；`extra` 改为每轮都传（§1） |
| `packages/app/octoapp/pages/insight/utils/queue-drain.ts` | 排队发送的 `extra` 加 `userId`；同样每轮都传 |
| `packages/app/octoapp/pages/insight/store/mcp-trigger.ts` | chip turn 关闭该工具 |
| 单测 | `packages/opencode/test/tool/get-session-identity.test.ts`（三种输出）、`registry.test.ts`（网关正反面）、`pages/insight/utils/account.test.ts`（取值规则）、`store/mcp-trigger.test.ts`（chip gate） |

---

## 6. 已知局限与后续项

- **模型转抄可能改错**：身份值经模型上下文中转，模型在拼 bash 参数时可能改动字符（尤其是 `uuid~` 这类不常见的串被"纠正"、截断或混入相似值）。本期靠输出格式隔离 + 文案约束降低概率，**无法保证**。
- **后续项（二期上权限过滤后做，本期不做）**：补一个执行前校验——bash 参数里出现以 `uuid~` 开头的串、但与当前会话真实 `userId` 不一致时，**拒绝执行**并告知模型。这是「响亮失败」而非模糊纠正：不替模型改值，只拦截。
- `sessionId` 是本地 opencode 会话 id（`ses_…`），不是内网服务端概念；内网接口若需要别的会话标识，需另议。

---

## 7. 验证

> **改了 registry 必须重启 server 进程**，否则看到的是旧工具集。`[octo:ctx]` 出在 server 进程（sidecar stdout / run dev 的外部 server 终端），不在 DevTools。

### 7.1 外网验证（本地可复现）

前置：
1. 起 server（重启进程）；前端打开 insight 会话。
2. DevTools 执行 `localStorage.setItem("userInfo", JSON.stringify({ account: "c60050492", userId: "uuid~bDYwMDYyNjUw" }))`。

| # | 场景 | 通过判据 |
|---|---|---|
| V1 | 在 insight 里让模型「调用 get_session_identity 并原样输出结果」 | `userId`、`account` 与 localStorage 里的值**逐字一致**；`sessionId` 等于地址栏 `/insight/<id>` 里的 id |
| V2 | `localStorage.removeItem("userInfo")` 后重复 V1 | 工具返回显式失败文案；server 出现 `[octo:ctx] identity missing`；模型不编造身份 |
| V3 | 只设 `account`、不设 `userId` | 同 V2，显式失败 |
| V4 | 会话忙碌时再发一条（进入排队），排到后执行 V1 | 值依然正确（覆盖 `queue-drain` 排队发送路径） |
| V5 | 在 Design / Prototype / Studio 里问同样的话 | 模型没有这个工具可用 |
| V6 | 单测 | 全部通过，命令见下 |

V6 命令：

```bash
# server 侧(cwd = UXAI/packages/opencode)
bun test test/tool/get-session-identity.test.ts test/tool/registry.test.ts
# renderer 侧(cwd = UXAI/packages/app):octoapp 用例默认 bun test 跑不到,须显式给路径
bun test ./octoapp/pages/insight/utils/account.test.ts ./octoapp/pages/insight/store/mcp-trigger.test.ts
```

### 7.2 内网验证（只有这一条依赖真实登录）

| # | 场景 | 通过判据 |
|---|---|---|
| N1 | 内网登录后执行 V1 | `userInfo.userId` 字段真实存在，值的形态与接口文档一致（`uuid~...`） |

---

## 8. 验证记录

**2026-09-22，外网，Mac 本地**。端到端用的是 API 层等价路径：从源码起 server（`bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4199`），用 curl 调 `POST /session/:id/prompt_async`，请求体里的 `agent` / `extra` 与 renderer 发出的逐字段一致，模型 `deepseek/deepseek-v4-flash`。**没有经过 Electron UI**。

| # | 结果 | 说明 |
|---|---|---|
| V1 | ✅（API 层） | 工具输出 `userId: uuid~bDYwMDYyNjUw` / `account: c60050492` 逐字一致；`sessionId` 等于会话 id；模型原样复述 |
| V2 | ✅（API 层） | 新会话不带 `extra`：返回显式失败文案，server 出现 `[octo:ctx] identity missing`，模型如实告知需重新登录。**同一会话**里前一轮带过身份、这一轮不带 `extra` 时**失败**（沿用了旧身份）→ 已按 §1 修复；修复后（这一轮带 `extra: {}`）显式失败，模型也没有复用前几轮的值 |
| V3 | ✅（API 层） | `extra` 只含 account：显式失败 + `identity missing` |
| V4 | ⏳ 未跑 | 排队路径需在 UI 里制造会话忙碌，本次未起 Electron。代码上 `queue-drain.ts` 与 `index.tsx` 的 `extra` 构造同构 |
| V5 | ✅（API 层，Design / Studio） | `octo_make`、`octo_studio` 带完整 `extra` 提问，模型均回答没有该工具；Prototype 与 Design 同属 `octo_make`。另由 `registry.test.ts` 在 `octo_make` / `octo_make_plan` / `octo_studio` / `octo_pattern_intent` / `build` 上断言工具不可见 |
| V6 | ✅ | server 侧 `get-session-identity.test.ts`（3）+ `registry.test.ts` 全过；renderer 侧 insight 全部用例（27 文件 374 例）全过；双包 typecheck 干净 |
| N1 | ⏳ 未跑 | 依赖内网真实登录 |

**待补**：在 Electron UI 里跑一遍 V1–V5（重点 V2 同会话场景与 V4 排队路径）。
