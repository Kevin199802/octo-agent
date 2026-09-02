# `task` 子代理 — skill 作者须知

- **面向**：写 skill（SKILL.md）和写 agent 提示词的人
- **一句话**：`task` 让模型把一件活派给一个**空白上下文的子代理**去做、只拿回一段文本。skill 里用自然语言指示模型去派活即可；但在 insight 里**能派的子代理只有一个**（`insight_reader`），且它拿不到你的 skill。
- **相关**：[`question` 工具 — skill 作者须知](question-tool-for-skills.md)（同类对外文档，§0 的论证同样适用）、[产物落盘 — skill 作者须知](artifact-output-for-skills.md)、[文档解析结果 — skill 作者须知](extracted-documents-for-skills.md)、[SPEC-INS-032](../infra/insight-subagent-dispatch.md)（宿主侧机制）

---

## 0. 这份文档是什么 / 不是什么

**不是** `task` 的出入参契约，不列参数表。理由与 [`question` 那份 §0](question-tool-for-skills.md) 完全相同：schema 由 `Tool.define` 自动转成 JSON Schema 进模型上下文，**skill 作者不调用工具、模型才调用**，手抄一份只会漂移。

> **真相源**：参数看 [task.ts:21-31](../../../packages/opencode/src/tool/task.ts#L21-L31)，工具说明看 [task.txt](../../../packages/opencode/src/tool/task.txt)，候选清单与权限看 [agent.ts](../../../packages/opencode/src/agent/agent.ts)。

本文档只写 **schema 表达不了、但写错就会静默失败的东西**——主要是三件：能派谁、子代理拿不到什么、结论怎么回来。

---

## 1. 头号事实：insight 里能派的子代理只有一个

`octo_insight` 的权限里写着（[agent.ts:312](../../../packages/opencode/src/agent/agent.ts#L312)）：

```ts
task: { "*": "deny", insight_reader: "allow" },
```

含义是 **task 工具本身可用，但候选被收敛到 `insight_reader` 一个**。这不是笔误，是 SPEC-INS-032 §13.1-3 评审时特意补的：`general` 的工具面是 bash / write / webfetch 全开、prompt 是通用助理导向，让弱模型拿它去读用研材料是实打实的风险。

| 你在 skill 里让模型派 | 结果 |
|---|---|
| `insight_reader` | ✓ 正常执行 |
| `general` / `explore` / `Plan` 等内置 subagent | ✗ 既不出现在模型看到的候选清单里（[registry.ts:293 `describeTask`](../../../packages/opencode/src/tool/registry.ts#L293) 按 `evaluate("task", <名>)` 过滤），硬派也会被 [permission](../../../packages/opencode/src/permission/index.ts#L187) 拒成 `DeniedError` |
| 你自己写的 agent md | 默认 ✗（被 `"*": "deny"` 兜住），但**在用户配置里加一行就能放开，不需要我们改代码发版**——见 §1.1 |
| 名字拼错 / 不存在 | ✗ `Unknown agent type: X is not a valid agent type`（[task.ts:59](../../../packages/opencode/src/tool/task.ts#L59)） |

> ⚠️ **注意白名单在哪一侧。** 「工具可见性」是自己声明的（agent md 里 `tools: { extract_document: true }` 就够，SPEC-INS-032 §7 契约 3）；但「能不能被 insight 派出去」由 **`octo_insight` 的 permission** 说了算，**你在自己的 agent md 里写什么都翻不开它**。翻它的办法不是找我们发版，是在用户配置里覆盖一行——见下。

### 1.1 想让 insight 派你自带的子代理：加一行配置，不用我们发版

**权限是可覆盖的**：agent 级配置里的 permission 会 append 在内置规则**之后**（[agent.ts:661](../../../packages/opencode/src/agent/agent.ts#L661)），而判定用 `findLast` ——所以用户配置能翻开 `"*": "deny"`。两步：

**① agent md 放对地方**：`~/.config/octo/agent/<skill名>_<角色>.md`（Mac / Windows 同路径，`xdg-basedir` 都解析到用户目录下的 `.config`）。加载的是 config 目录下的 `{agent,agents}/**/*.md`（[config/agent.ts:118](../../../packages/opencode/src/config/agent.ts#L118)），文件名即 agent 名。
**skill 包目录（`~/.config/octo/skill/<skill名>/`）里放 agent md 不会被扫到**，两套扫描互不相干。

```markdown
---
description: 一句话说清它干什么、什么时候派它——这是模型选 subagent 的唯一依据，也是 UI 卡片标题
mode: subagent
tools:
  extract_document: true
---
（正文就是它的系统提示词）
```

**② 在用户配置 `~/.config/octo/octo.json` 里给 `octo_insight` 追加一条 allow**：

```json
{
  "permission": { "task": { "skilldemo_writer": "deny" } },
  "agent": {
    "octo_insight": {
      "permission": { "task": { "skilldemo_writer": "allow" } }
    }
  }
}
```

外层那条全局 `deny` 是**可选的「不外溢」写法**：不写的话，你的子代理会同时出现在 chat / make / studio 的候选清单里（它们的 defaults 是 `"*": "allow"`）。写了则只有 insight 能派。

实测（2026-08-24，源码 server + `OPENCODE_CONFIG_DIR` 指向临时 config，`curl /agent` 核对规则集）：

| agent | 派 `skilldemo_writer` | 派 `general` | 自身 task 工具 |
|---|---|---|---|
| `octo_insight` | **allow** ✓ | deny（兜底仍在）✓ | 可用（最后一条匹配的 pattern 不是 `*`，不触发隐藏）✓ |
| `octo_make` / `octo_studio` / `general` | deny ✓ | allow（不受影响）✓ | 可用 ✓ |

命名按 SPEC-INS-032 §4.2：`<skill名>_<角色>`，snake_case。**别用 `reader.md` / `helper.md` 这类通名**——「文件名即 agent 名」，撞上内置 agent 会静默改掉它的 prompt 与权限。

#### 两个必须知道的副作用

1. **别用同名 md 去改内置 agent。** 放一个 `agent/octo_insight.md` 确实能追加 permission，但同一段合并逻辑里 `item.prompt = value.prompt ?? item.prompt` ——**md 的正文会整个顶掉 insight 的系统提示词**。改候选一律走 JSON 的 `agent.octo_insight.permission`。
2. **自带 agent 默认是全权限，不是白纸。** defaults 是 `"*": "allow"`，`tools: { extract_document: true }` 只是**加**一项，不是收敛。实测那个只写了一行 `tools:` 的演示 agent，bash / write / skill 全是 allow。要做成 `insight_reader` 那样的只读子代理，得**逐项显式 deny**：

```yaml
tools:
  extract_document: true
  bash: false
  edit: false        # 这一个键同时关掉 edit / write / apply_patch
  task: false        # 防套娃
  todowrite: false
  webfetch: false
  websearch: false
  skill: false
```

> 这条也解释了 §1 那个 `"*": "deny"` 兜底为什么留着：**没写全 deny 的第三方子代理就是一个全权限 agent**，误派代价不小。兜底挡的是「模型自己挑错人」，不是挡你——你显式报备（配置里 allow）之后它就放行。

**配置文件归属**：`~/.config/octo/octo.json` 是**用户文件，产品永不写**（见 [agent-config-deploy.md](../infra/agent-config-deploy.md) §3）。所以第 ② 步是**部署侧动作**，skill 包自己带不进来——要和内网部署方对齐由谁写、随什么流程写。配置改完**要重启进程**（opencode 配置不热重载）。

### 1.2 自查：模型手上到底有哪些候选

```bash
# 本地开发机（Mac / zsh），在 UXAI 仓根执行
bun run --cwd packages/opencode --conditions=browser src/index.ts debug agent octo_insight
```

看输出里 `task` 是否为 true（工具本身可用），候选清单则以 `describeTask` 的过滤结果为准。

内网（Windows，装的是打包版，没有源码和 bun）没有等价命令，**直接在对话里问**：「列出你可用的 subagent 类型」。只列出 `insight_reader` 才是对的；如果它列出 `general` / `explore`，说明装的是旧包。

---

## 2. `task` 是模型的工具，skill 的脚本调不了它

SKILL.md 里的 bash / python 脚本**没有任何办法发起子代理**——`task` 只存在于模型的工具列表里。你能做的只有用自然语言指示模型去派活：

```markdown
## 通读多份材料时

材料超过 1 份时，**每份单独用 `task` 派一个 `insight_reader` 子代理**：
prompt 里给出这份材料的本地绝对路径，并说明要提炼什么。
派完一份、收到结论、写一句小结，再派下一份。
不要自己一份份读——正文会撑爆上下文。
```

要点与 `question` 那份一致：

- **点名工具名 `task` 和 `subagent_type` 的取值 `insight_reader`**——别写「让子代理去处理」，弱模型（内网 GLM）不一定映射得到工具调用
- **给明确触发条件**（「材料超过 1 份时」），别写「必要时可以」
- 别在 SKILL.md 里写 `task({subagent_type: ...})` 这种伪调用，模型读 schema 就够了

---

## 3. 子代理是一张白纸：它拿不到你的 skill

**这是第二大坑。** 子代理跑在一个全新的子会话里，[起手只有你在 `prompt` 里写的那段字](../../../packages/opencode/src/tool/task.ts#L143)。它**不继承**的东西：

| 它拿不到 | 依据 |
|---|---|
| **你的 SKILL.md**（一个字都没有） | `insight_reader` 的 `skill: "deny"`（[agent.ts:346](../../../packages/opencode/src/agent/agent.ts#L346)）。**自带子代理同样拿不到**：skill 对 agent 的可见性还要过 `skill_config.json` 的 `agent` 映射（[skill/index.ts:369](../../../packages/opencode/src/skill/index.ts#L370)），没在那里登记的 agent 一个 skill 都看不到——哪怕它权限全开 |
| 父会话的对话历史、用户上传的附件清单、之前的工具结果 | 子会话是新建的（[task.ts:70](../../../packages/opencode/src/tool/task.ts#L70)） |
| MCP 业务工具（研究工具那套） | 不绑 mcp；且父会话的 deny 规则会被复制进子会话（[task.ts:77-78](../../../packages/opencode/src/tool/task.ts#L77-L78)） |
| `knowledge_search`（内网知识库） | registry 里按 agent 名只给 `octo_insight` |
| `question`（向用户提问） | 全局 defaults 里 deny，`insight_reader` 没放开——**子代理无法与用户交互** |
| `write` / `edit` / `bash`（落盘、跑脚本） | 一律 deny（[agent.ts:340-341](../../../packages/opencode/src/agent/agent.ts#L340-L341)）——产物由父代理写，避免并发写同名文件互相覆盖 |
| `task`（再派下一层） | deny，防套娃 |

它有的只有：`extract_document` / `read` / `grep` / `glob`。

### 由此而来的写法约束

**派活的 prompt 必须自包含。** 在 skill 里要求模型写清三件事：

1. **本地绝对路径**（子代理不知道「刚才那份材料」是哪份）
2. **要提炼什么 + 输出格式**（口径对每份保持一致，否则汇总时对不齐）
3. **判据**（比如「这份共 5230 行，你必须读到第 5230 行」——比「读完为止」硬）

反过来说：**别在 SKILL.md 里写「让子代理按第 3 步的规范执行」**。子代理看不到第 3 步。要么把那段规范原样抄进派活的 prompt 里，要么这活别派出去。

---

## 4. 结论怎么回来：一段文本，仅此而已

父代理拿到的字符串（[task.ts:167-171](../../../packages/opencode/src/tool/task.ts#L167-L171)）：

```
task_id: ses_xxx (for resuming to continue this task if needed)

<task_result>
子代理最后一段文本
</task_result>
```

四个性质：

1. **只取最后一段 text**——子代理中间读了什么、想了什么，一概不回传
2. **用户看不到它**。UI 上只有一张单行 task 卡片（agent 名 + 一句话描述），点不开；子会话也不出现在左侧列表里（insight 按 `agent = octo_insight` 过滤会话）
3. **是纯文本，不是结构化数据**。要「结构化」只能靠约定小标题格式，且模型可能不照做——**别把需要精确解析的流程挂在上面**
4. `task_id` 可以回传给 `task` 续跑同一个子会话（`task_id` 参数），上下文接着走

由 2 推出一条 skill 必须写的话：**要求父代理每收到一份结论就写一行小结给用户看**。否则用户面对的就是几张不能点的卡片，中间几分钟毫无进展感。

由 1、3 推出另一条：**父代理手上只有结论，没有原文**。用户追问细节而结论里没有时，正确做法是 `grep` 回落盘的解析件、或就那一份重新派一次，**不许凭结论推测原文怎么写**。这句建议在 skill 里显式写死。

---

## 5. 串行还是并发：默认串行，别照抄工具说明

`task` 自己的说明里写着 "Launch multiple agents concurrently whenever possible"（[task.txt:16](../../../packages/opencode/src/tool/task.txt#L16)）。**通读类任务上我们明确压过了这句**（`octo_insight` 提示词里点名了它），原因不是并发不好：

- 分治的价值是**上下文隔离**，不是并发——串行同样能把父上下文从十几万 token 压到几千
- 串行才有「派第 3 份 → 小结 → 派第 4 份」的可见过程
- 一次甩出去一堆，结论回来挤在一起，弱模型反而对不齐

所以：**SKILL.md 里不要写「并发派 N 个」**。确有并发理由（彼此完全独立、且用户不需要过程）时，写清理由，别只写「尽快」。

---

## 6. 子代理写的文件落在哪

**不用你管，也管不了。** 一个会话树 = 一个工作区：子代理的相对路径写入、bash cwd、glob/grep 默认范围，一律解析到**根会话**（用户看到的那个会话）的产物目录（[octo-session-workdir.ts](../../../packages/opencode/src/agent/octo-session-workdir.ts)）。这也意味着**多个子代理写同名文件会互相覆盖**——自带子代理若要写文件，自己保证文件名唯一。

`insight_reader` 干脆不给写权限，产物一律由父代理落盘。落盘规则见[产物落盘须知](artifact-output-for-skills.md)：只写相对路径，不点名任何目录。

---

## 7. 降级：task 不是永远可用的

至少三种情况下模型手上没有 task，或不该用：

| 情况 | 现象 |
|---|---|
| **研究工具那轮（chip turn）** | 前端 gate 显式关掉 task（[mcp-trigger.ts:80](../../../packages/app/octoapp/pages/insight/store/mcp-trigger.ts#L80)）——那轮的职责是一次直接的 MCP 调用，2026-07-07 内网事故里「委托 task 子代理」正是被观测到的逃生口之一 |
| 用户在授权弹窗里拒绝 | 该次调用被拒，模型收到错误 |
| 换了个没放开 task 的 agent / 旧版本包 | 模型回「我没有这个工具」 |

所以 **SKILL.md 必须写降级语义**，而且要写死：

```markdown
如果 task 工具不可用，就按顺序自己逐份读，并在回答里如实说明这一轮没有分治、
材料较多时可能有遗漏。**不允许**在没有真正派出子代理的情况下声称已分治。
```

最后一句不是客套——弱模型在工具不可用时编造「已派 3 个子代理分析完毕」是实际发生过的类型。

---

## 8. 什么时候别用 task

- **单份文档**、或只是在材料里找某个具体信息 → `grep` / `read` 就够，派子代理更慢
- **需要问用户** → 子代理没有 `question`，问不了；这一步留在父代理
- **需要写文件、跑脚本、调 MCP** → 子代理都没有
- **需要精确解析子代理的返回** → 回来的只是一段文本，属于[确定性边界](question-tool-for-skills.md#3-模型拿得到答案吗拿得到但形态要注意)那类场景，别把关键流程挂上去
- **只是想「让它更认真一点」** → 换个上下文不会让模型变强；分治解决的是「读不到」，不是「读不准」

---

## 9. 自查清单

发布 skill 前逐条过：

- [ ] 全文搜 `subagent_type`：出现的取值只有 `insight_reader`（或已与我们对齐并放开的自带 agent 名）
- [ ] 没有指望脚本去发起子代理
- [ ] 派活的指令里要求模型给出**绝对路径 + 提炼要求 + 输出格式**，不出现「按上面那步做」「按 skill 的规范」这类子代理看不见的指代
- [ ] 没有让子代理写文件、问用户、调 MCP 或再派子代理
- [ ] 要求父代理逐份写小结（用户可见性）
- [ ] 写明「结论里没有的细节要回原文查，不许编」
- [ ] 通读类任务是串行派发，没有写「并发」
- [ ] 有 task 不可用时的降级路径，且禁止谎称已分治
- [ ] 自带 agent 的名字带 `<skill名>_` 前缀，工具面**逐项 deny 收敛过**（默认全开！），且部署侧已在 `octo.json` 里放开候选
