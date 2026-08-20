# SPEC-INS-032 — Insight 子代理分治(多文档通读)+ 工具面声明化

> 状态:已实现(外网,UXAI 分支 `feat/insight-subagent-dispatch`)—— 单测 + typecheck 通过,**待人工验证**(清单见 §10.2 / §10.3)· 优先级 P1 · 规模 [M] · 领域 infra/insight/agent
>
> **上游已实现:✓/✗ 混合**
>
> - ✓ `task` 工具与子会话机制:[tool/task.ts](../../../packages/opencode/src/tool/task.ts) 建 `parentID` 子 session、跑完把末段文本包 `<task_result>` 回传,父子关系与数据完整
> - ✓ 声明式工具面:agent 的 `permission` 就是上游的既定机制(`tools:` 字段已被上游废弃并翻译成 permission,见 §3.2)
> - ✓ subagent 候选清单:`describeTask` 按 `Permission.evaluate("task", <agent 名>, …)` 过滤,pattern 级白/黑名单是现成能力
> - ✗ `insight_reader` 子代理定义(Octo 自写)
> - ✗ 会话树工作区归属(现状按「本会话 agent 名」判,需改成「根会话」)
> - ✗ task 的 turn 级放行(insight 前端 `buildToolGate` 现在恒关)
>
> 依赖:[SPEC-INS-016 v2](insight-extract-document.md)(全量落盘)、[SPEC-INS-021](insight-toolset-convergence.md)(工具面 / 权限 / task 静默化)、[SPEC-INS-014](insight-worktree-layout.md)(会话工作目录布局)、[SPEC-INS-028](insight-workdir-declaration.md)(工作目录声明对齐 —— §6 把它的判据从「本会话」推广到「会话树根会话」,机制不变)。
> 取代:016 §8「子代理分治读文档 —— 独立立项」那条待办;021 §1 的 task「turn 级默认关」在本 spec 撤销(见 §5)。
> 被依赖:[SPEC-INS-018](insight-local-analysis-v1.md) B2 的「多文档 task 子代理分治」。

---

## 1. 背景:016 v2 之后剩下的那半个问题

016 v2 把工具的职责钉死为「**把全文完整交付出来**」:正文一律落 `.octo/<sessionID>/extracted/<名>.md`,大文件只回元信息 + 路径 + 2000 字预览。它明确写了自己不解决什么:

> 落盘解决的是「工具不许擅自丢数据」,**不解决「全文塞不塞得下」**。……10 份文档同时通读照样撞窗口。

本 spec 解决的就是这后半句。手段是**上下文隔离**:一份文档交给一个子代理,子代理在自己的上下文窗口里读完、只把结论回传给父。

**价值是隔离,不是并发**(016 §8 已定调):内网模型并发能力一般,串行跑子代理同样能把父上下文从十几万 token 压到几千,而且串行天然产生「读完一份 → 一段小结 → 下一份」的可见过程(§8)。

---

## 2. 形态定案:一份文档 = 一个子代理,子代理自己抽取

```
父(octo_insight):读 [附件] 清单 → 逐份 task(源文件绝对路径 + 分析要求)→ 收结论 → 写报告
子(insight_reader):extract_document(源路径) → 全文落盘 → read 通读 → 只回传结论文本
```

### 2.1 被否掉的备选:父抽取 + 子只 read

起草时先提的是「父代理调 `extract_document` 拿路径,子代理用原生 `read` 读落盘的 `.md`」——好处是一行 gate 都不用改(`read` 人人都有)。**评审否掉**,因为预览是一笔按份数线性增长的税:

| 20 份 3 万字访谈稿 | 父上下文开销 |
|---|---|
| 父抽取 + 子只 read | 20 × 预览 2000 汉字 ≈ **4.2 万 token**,再加派发 + 结论 ≈ 1.6 万 → **约 6 万** |
| **子代理自己抽取(选定)** | 20 × (派发 ~100 + 结论 ~800) ≈ **1.8 万** |

那 4.2 万买不到任何东西:父代理不需要看正文,它只负责派活和收结论。10 份勉强,20–30 份就回到「父上下文也吃不住」的原点——而多文件正是本 spec 的场景。

还有一层不是 token 的:父抽取意味着父的 loop 里要串行走 N 次工具调用,时延叠加,且弱模型走到第 15 次时容易丢失最初的指令。

> 顺带:「给 `extract_document` 加一个不回预览的静默模式」也评估过——能把父抽取的税降到 ~50 token/份,但它要求弱模型正确区分两种模式,且与 016 §4.4「只给路径不给内容,弱模型容易编」的取向冲突。子代理自己抽取不需要新模式,更简单。

### 2.2 子代理不写产物

子代理**只回传结论文本,不落任何文件**。理由:并发/多个子代理写同名文件会互相覆盖,而产物命名与版本策略归 018/026,不该由临时子会话承担。报告一律由父代理写。(工作区归属见 §6——即便子代理写了,也会落在父会话目录,但这是兜底不是许可。)

---

## 3. 工具面:从 registry 的名字 gate 改为权限层声明

`extract_document` 现在硬 gate 在 [registry.ts](../../../packages/opencode/src/tool/registry.ts) 的 `input.agent.name === "octo_insight"`,子代理换个 agent 名就拿不到。**要解开它,但不是靠加一个名字。**

### 3.1 业界做法对比

| | 做法 | 代表 | 结论 |
|---|---|---|---|
| A | **消费方按 agent 名硬编码**(现状) | —— | ✗ 依赖倒置:工具注册表反过来认识每个 agent 的名字,新增 agent 就要回头改注册表,第三方无法自助 |
| B | **agent 声明自己要什么工具** | Claude Code `.claude/agents/*.md` 的 `tools:` 白名单;opencode 自己的 `permission` | ✓ **选定**——业界通行,且**上游本来就是这么设计的** |
| C | 名字前缀匹配(`insight_*` 自动获得) | k8s 标签前缀一类的约定 | ✗ 隐式扩权:任何人起个名就拿到工具。前缀留作命名约定,不作权限判据(§4.2) |

### 3.2 上游事实核查(起草时两次纠错,记下来免得再走一遍)

1. **`tools:` 字段不是本仓魔改丢的,是上游主动废弃的。** [config/agent.ts:84](../../../packages/opencode/src/config/agent.ts#L84) 的 `normalize()` 注释写明「Translate the **deprecated** `tools: { name: boolean }` map into the new `permission` shape」,并在 L93–101 把它翻译成 `permission` 再往下传。所以 `Agent.Info` 里没有 `tools` 字段是**有意为之**——声明式机制就是 `permission`,`tools` 只是老配置的兼容别名。
   - SPEC-INS-021 §0.1 那句「frontmatter `tools:` 不被任何代码消费」在它的语境里成立(`octo_insight` 是内置 agent,定义硬编码在 agent.ts,`src/agent/prompt/octo_insight.md` 只是 `.txt` 的文档镜像、不在 config 扫描路径),但别读成「这个字段全局失效」——**config 目录里的 agent md,`tools:` 是生效的**。
   - 由此:021 §1「不做 frontmatter 白名单机制(那要新造一层配置消费,收益为零)」的判断,在本 spec **翻案**:不需要新造任何一层,用上游既有的 `permission` 即可;而收益也不再为零(第三方 skill 团队要自带 agent,见 §7)。
2. **agent 级的 deny 不会被 `task` 复制进子会话。** [task.ts:70](../../../packages/opencode/src/tool/task.ts#L70) 复制的是 `sessions.get(ctx.sessionID).permission`,那是 **session 级** ruleset(由 [prompt.ts:1449](../../../packages/opencode/src/session/prompt.ts#L1449) 把 `promptAsync` 的 `tools` 写入,以及用户点「总是允许」时写入),**不是 agent 的 defaults**。起草时曾据此误判「权限层走不通」,不成立。

### 3.3 落地

```
defaults(agent.ts):      extract_document: "deny"      // 默认所有 agent 都看不到
octo_insight:            extract_document: "allow"
insight_reader:          extract_document: "allow"
```

链路(逐段核过,落地时用单测锁住):

- `Permission.disabled` 用 `findLast` 取最后一条匹配规则([permission/index.ts:311](../../../packages/opencode/src/permission/index.ts#L311))→ 其他 agent 命中 defaults 的 `deny`(pattern `*`)→ **既从模型工具列表隐藏,也阻断执行**;insight 系命中自己的 `allow` → 可见。
- merge 顺序 defaults → agent → user,**用户配置仍可覆盖**(上游既定语义)。可接受:016 §2 已论证这个 gate 不是安全边界(工具不限制路径,`read`/`grep` 本就可读全盘),它的唯一目的是「别污染无关 agent 的工具列表」——「不声明就看不到」完全满足这个目的。
- 子会话:insight 的 session.permission 内容是 `buildToolGate` 下发的那几个 MCP 业务工具,不含 `extract_document` → 不污染(依据 §3.2-2)。

**净行为变化为零**:这个工具本来就被 registry gate 挡在 insight 之外的所有 agent 外,只是换了实现层。**不动 `Agent.Info` schema,因而没有 SDK 类型变化。**

### 3.4 `apply_patch` 那条留在 registry(不是遗漏)

021 §1 落地记录已踩过:`Permission.disabled` 把 edit/write/apply_patch 都映射到同一个 `edit` 权限键([permission/index.ts:309](../../../packages/opencode/src/permission/index.ts#L309) `EDIT_TOOLS`),在权限层 deny `apply_patch` 会**连带隐藏要保留的 `write`**。故这条继续按 agent 名在 registry 裁剪,代码注释里写清原因。

### 3.5 `knowledge_search` 本次不动

registry 里还有一条同款的名字 gate:`KnowledgeSearchTool` → `input.agent.name === "octo_insight"`([SPEC-INS-030](../agents/insight-knowledge-search.md) 把这个能力从 chat 迁进 insight 后改的)。它属于同一类依赖倒置,但归 030 那条线、且刚动过归属,顺手改风险大于收益。**留作后续**(§11),本 spec 只动 `extract_document`。

> 附带效果:`insight_reader` 是独立 agent,因此**不会**拿到 `knowledge_search` —— 子代理只读派给它的那份材料,不查知识库,与 §4.1 的工具面一致。

---

## 4. 子代理定义:`insight_reader`

### 4.1 配置

| 项 | 值 |
|---|---|
| name | `insight_reader` |
| mode | `subagent` |
| description | 面向**模型**的选择依据,写清「读一份用研材料并回传结论,不写文件」——它同时是 task 卡片上给研究员看的标题来源 |
| 工具面 | `extract_document` / `read` / `grep` / `glob`;**不给** write / edit / bash / task / MCP |
| prompt | 新增 `src/agent/prompt/insight_reader.txt`:读材料 → 按父代理给的要求提炼 → **只输出结论文本**;不写文件、不发起子任务;路径一律当绝对路径用 |

不复用现成的两个:`general` 是全权限(bash/write/webfetch 全开),`explore` 的 prompt 是 codebase 导向,喂用研素材不对路。

### 4.2 命名约定(只进文档,不进代码)

- 形态:`<归属>_<角色>`,snake_case。我们的 = `insight_*`;第三方 skill 自带的 = `<skill名>_<角色>`。
- **不叫 `insight_subagent`**:`mode` 字段和会话 category 已经表达了「它是子代理」,这个词零信息量;而名字是模型的选择依据、也直接显示在 task 卡片上(021 §4 已知限制:卡片标题取 subagent 名,上游读 data 字段不是 i18n 键)。
- **前缀不作为任何 `if` 的判据**(§3.1-C)。它存在的唯一硬理由是**防撞名**:[config/agent.ts:145](../../../packages/opencode/src/config/agent.ts#L145) 是「文件名即 agent 名」,而 [agent.ts](../../../packages/opencode/src/agent/agent.ts) 的 config 合并循环命中同名就**改内置 agent**——谁往 `.octo/agent/` 放一个 `explore.md`,就静默改掉内置 explore 的 prompt 与权限;放 `octo_insight.md` 改的就是我们的主 agent。这是既有隐患,本 spec 只在对外契约里点明(§7),不改上游合并逻辑。

---

## 5. task 门禁:常驻放开,且不外溢到其他 agent

### 5.1 现状与撤销

021 §1 让 insight 前端 [`buildToolGate`](../../../packages/app/octoapp/pages/insight/store/mcp-trigger.ts) 对**所有**用户 turn 恒定下发 `task: false`(agent 权限层一直是 allow)。其理由两条:① 弱模型自发起子代理零收益;② 子会话被点开是「侧栏没有记录的对话」。

本 spec **撤销这一行**,两条理由各自已有解:

- ② 由 §4 解决:子代理用独立 agent 名,而侧栏列表按 `agent = octo_insight` 过滤([session-insight-query.ts:26](../../../packages/opencode/src/session/session-insight-query.ts#L26)),子会话**天然不出现**,零改动。021 的导航拦截保留不动(双保险)。
- ① 由 §5.2 的候选收敛 + 子代理描述收敛:模型能看到 task,但候选只有一个只读的文档子代理,派错了也干不了坏事。残余代价(单文档场景也起子代理,多花 token/时延)靠提示词收,实测不行**删一行即回退**。

**chip turn 例外:仍关 task**(落地时发现,spec 起草时漏了)。2026-07-07 内网事故里被观测到的逃生口**就包括「委托 task 子代理」**(见 `buildToolGate` 里 bash 那条注释)——研究工具那轮的职责是一次直接的 MCP 调用,分治在那里没有任何用途。故 `gate["task"] = false` 从「无条件」改为「只在 chip turn」,与 bash / webfetch / extract_document 同处一个分支。多文档分治发生在普通轮次,两者不冲突。

**不采用「按技能激活轮放开」**:一次发送 = 一个 turn,模型可以在同一轮里连发 N 次 task;但只要它把动作拖到下一轮(比如先回一句「要我分治吗」),下一轮没激活技能就会中途失去工具。常驻放开没有这个 turn 边界坑。

### 5.2 不影响其他 agent(硬要求)

`buildToolGate` 只在 insight 页面发送时调用([insight/index.tsx:1332](../../../packages/app/octoapp/pages/insight/index.tsx#L1332) 与 `utils/queue-drain.ts`),产物写成**该 session** 的 permission;chat / make / studio 各有自己的发送路径。agent 权限层不动(全仓仅 `octo_ai`、`make_component` 显式 deny task,不受影响)。

**唯一外溢**:`describeTask` 会把所有 `mode !== "primary"` 且 task 未被 deny 的 agent 列进**每个** agent 的 task 工具描述,即 octo_make / octo_design / octo_studio / proto_* 的描述里会多一行 `insight_reader`。用同一套声明式写法堵掉,**不逐个 agent 加判断**:

```
defaults:       task: { insight_reader: "deny" }     // 对所有 agent 默认不可见
octo_insight:   task: { insight_reader: "allow" }
```

为什么这不会把 task 工具本身关掉(两个函数语义不同,落地时用单测锁住):

| 函数 | 判据 | 对其他 agent 的结果 |
|---|---|---|
| `Permission.disabled(["task"], …)` | findLast 匹配 `task` 的规则,**仅当 `pattern === "*" && deny`** 才隐藏 | 命中的是 `pattern: "insight_reader"` 的 deny → **不隐藏**,task 工具照常可用 ✓ |
| `Permission.evaluate("task", "insight_reader", …)`([evaluate.ts](../../../packages/opencode/src/permission/evaluate.ts)) | findLast 同时匹配 permission 与 pattern | → `deny` → `describeTask` 过滤掉它 ✓ |
| `Permission.evaluate("task", "general", …)` | 同上,`insight_reader` 那条 pattern 不匹配 | → 落回 defaults 的 `"*": allow` → `general` 仍列出 ✓ |
| `octo_ai` / `make_component`(自身 `task: "deny"` pattern `*`) | findLast → 自己那条 | → 仍整体禁用 task ✓ 不受影响 |

---

## 6. 工作区归属:一个会话树 = 一个工作区

**业界隔离的是上下文,不是文件系统**:Claude Code 的 subagent 是「独立上下文窗口 + 同一个工作目录」,LangGraph / Agents SDK 同理,没有「子代理专属产物目录」这种设计。

[SPEC-INS-028](insight-workdir-declaration.md) 落地的 [octo-session-workdir.ts](../../../packages/opencode/src/agent/octo-session-workdir.ts) 现在判的是「**本会话**的 agent 是不是 `octo_insight`」+ 用 `input.sessionID` 算目录,于是子会话两头不着:换了 agent 名 → 插件整个不生效(write 落裸路径);沿用 `octo_insight` → 生效但锚在子会话 ID,指向空的 `.octo/<childID>/`。

**改为:判据 = 「这个会话树的**根会话**是不是 insight 会话」,工作区 = 根会话目录。** 一次覆盖四个通道:

| 通道 | 改后落点 |
|---|---|
| `write` / `edit` 的 `filePath`(相对路径) | **根会话** `outputs/` |
| `bash` 的 cwd | **根会话** `outputs/` |
| `glob` / `grep` 的默认目录 | **根会话**会话根(材料在 `uploads/`) |
| `extract_document` 落盘目录 | **根会话** `extracted/`(否则 N 份解析件散在 N 个子会话目录,父代理事后想跨文档 grep 原话就找不着) |

实现要点:`metaOf` 已按 sessionID 缓存 `session.get`,加一步沿 `parentID` 上溯到根(结果一并缓存),`isInsight` 改判根会话的 agent。**这条顺手解掉了「skill 起的子代理我们不认识」**——判据不再是 agent 名,insight 会话树下的任何子代理(我们的 / `general` / 第三方自带的)都自动落进同一个工作区,不需要为它们列白名单。

附带好处:文件管理面板读 `.octo/<sessionID>/outputs`,根会话 ID 就是用户看到的那个会话 → 子代理的产物直接出现在用户的产物库里,无需搬运。

边界(逐条认下来):

- 根会话不是 insight(chat/make 的子代理)→ 插件不生效,行为不变。
- 多个子代理并发写同名文件会互相覆盖 → 我们的 `insight_reader` 由提示词约束成不写文件(§2.2);第三方的写进契约(§7)。
- 上溯**防环 + 限深度**(如 ≤8 层),异常时**响亮失败**(console.error + 保持原值),绝不静默退回子会话目录——那会把小故障变成「产物散落」这种难查的现象。

---

## 7. 对第三方 skill 团队的契约

背景:另有团队在写 skill,也要用 `task` 起子代理,用途我们不掌握。**他们不需要我们改代码**——[config/agent.ts:118](../../../packages/opencode/src/config/agent.ts#L118) 会扫 config 目录下的 `{agent,agents}/**/*.md`,文件名即 agent 名,frontmatter 可声明 mode / model / prompt / `tools:` / `permission`(`tools:` 由上游 normalize 翻译成 permission,§3.2)。

三条契约(建议另出一份「子代理 — skill 作者须知」,与 [产物落盘须知](../agents/artifact-output-for-skills.md)、[文档解析结果须知](../agents/extracted-documents-for-skills.md) 同类):

| # | 契约项 | 他们要做什么 |
|---|---|---|
| 1 | **命名空间** | 自带 agent 用 `<skill名>_<角色>` 前缀。别用 `reader.md` / `helper.md` 这类通名——会覆盖内置 agent 或被别的 skill 覆盖(§4.2) |
| 2 | **工作区** | 什么都不用做:子代理产物自动落根会话 `outputs/`(§6)。若要写文件,**自己保证文件名唯一** |
| 3 | **工具面** | 在自己的 agent md 里声明。需要 `extract_document` 就写 `tools: { extract_document: true }`(§3.3 的 defaults deny + 显式 allow),**不需要报备、不需要我们发版** |

外加一条要在 SKILL.md 层面提醒的机制事实:**`task` 是模型的工具,skill 里的 bash 脚本调不了它**,只能用自然语言指示模型去派活;并且 SKILL.md 应写明降级语义——task 不可用时顺序自读并**如实说明**,不许谎称已分治。

> 待你方与该团队对齐后回填:他们的命名空间前缀、是否需要 `extract_document`、用 `general` 还是自带 agent。**未对齐不阻塞本 spec 落地**——§3.3 和 §6 都不依赖他们的具体命名。

---

## 8. UI 呈现:P0 靠对话,P1 再动卡片

**业界形态一致**:子代理过程是主对话里的一个可折叠内联块(Claude Code 的 Task 块显示 agent 名 + 一句话任务 + 状态/步数,可展开看过程摘要;Manus、Cursor 执行流同理),**不开第二个对话入口**。

我们的现状:上游 task 卡片是 `hideDetails` 单行卡([message-part.tsx:1926](../../../packages/ui/src/components/message-part.tsx#L1926)),显示 agent 名 + description + 一个跳转箭头(箭头已被 021 拦掉)。即「能看出调了子代理」已达标,缺的是结果与步数。

- **P0(本 spec)**:维持单行卡片,过程可见性交给**父代理的文字回执**——提示词要求父代理每收到一个子任务结论就写一行小结再派下一个。串行分治天然产生「派第 3 份 → 小结 → 派第 4 份」的流式过程,而用户真正想读的东西在对话里(符合 insight「对话内容永不替代,卡片是附加预览」)。
- **P1(实测后再定)**:若仍觉黑箱,再补「步数 / 耗时 / 展开看 `<task_result>`」。`<task_result>` 就在 part 里,不需额外请求。实现上 `ToolRegistry` 是模块级全局 map(覆盖 `task` 会影响 chat/make),可行路径是在 insight 页面注册前先取走上游原渲染器、注册一个按 `useLocation().pathname` 分支的版本,其他路由原样回落;**成本中等、要注意加载顺序**,故不放进 P0。

**明确否掉**:design 侧「把子会话塞进名为 subAgent 的侧栏列表、不能跳转」。列出来点不开是纯困惑源;能点开就是第二个对话入口,与 021「子会话不是用户级对话」冲突——两边的代价都付了,业界也无此做法。021 的导航拦截(点击 / href / 刷新恢复)全部保留。

---

## 9. console 埋点(接入 [insight-debugging.md](../../insight-debugging.md))

| tag | 触发 | 字段 |
|---|---|---|
| `[octo:session-workdir] 根会话解析` | 工作区上溯命中根会话(只在当前会话不是根时打,即 task 子代理那种情形) | sessionID / rootSessionID / depth |
| `[octo:session-workdir] 根会话解析失败,退化为按当前会话取工作区` | 上溯超深 / 成环(**响亮失败,退化为 032 之前的行为**) | sessionID / depth / err |
| `[octo:extract] root-session-unresolved` | 落盘目录未能归到根会话(同上,已退化为按当前会话落盘) | sessionID |

前端的 `[octo:subagent] dispatch/result`(逐份派发 / 结论回传)**本次不做**:P0 的过程可见性走父代理的文字回执(§8),
子会话过程本身有上游 task 卡片 + `[octo:task]` 既有日志;真需要逐份计时再随 §8 的 P1 卡片增强一起加。

## 10. 验证

### 10.1 自动化(外网可复现,不依赖内网)

- `test/agent/agent.test.ts`:
  - `octo_insight` / `insight_reader` 的可见工具集含 `extract_document`;`octo_make` / `octo_studio` / `general` **不含**;
  - `Permission.disabled(["task"], <octo_make ruleset>)` 为空(§5.2 的关键断言:`insight_reader` 那条 deny **不得**把 task 工具整体关掉);
  - `evaluate("task","insight_reader", octo_make)` = deny、`= octo_insight` 为 allow、`evaluate("task","general", octo_make)` 为 allow;
  - `octo_ai` / `make_component` 的 task 仍整体 deny(回归)。
- `test/tool/registry.test.ts`:`extract_document` 的断言从注册表层移除(改由 agent 层覆盖),`apply_patch` 对 insight 摘除的断言保留。
- `test/tool/extract_document.test.ts` 增:在带 `parentID` 的子会话上下文里抽取 → 落盘路径指向**根会话** `extracted/`;上溯成环时**降级为当前会话目录并打 `root-resolve-failed`**,不抛错。
- `bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>` 起源码 server + `curl /agent` 核对 `insight_reader` 存在、mode=subagent、权限清单符合预期。
- `tsgo --noEmit` 干净。

### 10.2 外网人工(开发机 + Claude)

1. **分治主路径**:上传 6–10 份 docx,让它「把每份的关键发现汇总成一份报告」→ 观察:父代理**逐份发起 task**、每份返回后写一行小结;对话不中断、不撞窗口;最终报告落 `outputs/`。
2. **工作区归属**:上一步跑完后查磁盘——`.octo/<父会话ID>/extracted/` 下有 N 份解析件(**不是**散在各子会话目录);`outputs/` 里只有父代理写的报告(子代理没写文件)。
3. **侧栏干净**:分治期间与结束后,左侧会话列表**不出现**任何新条目;点 task 卡片不跳转(Console `[octo:task] child-session navigation blocked`);刷新不落进子会话。
4. **不外溢**(本轮硬要求):切到 make / studio,问模型「列出你可用的 subagent 类型」→ 有 `general` / `explore`,**没有** `insight_reader`;同时确认这些页面的 task 工具**本身仍可用**(§5.2 的两个函数语义差别,人工侧就看这一条)。
5. **工具面**:在 make / studio 问「你有 extract_document 吗」→ 没有;insight 里有。
6. **回归**:chip turn(研究工具那轮)行为不变——`[octo:chip] chip-send` 的 `toolGate` 里 bash / webfetch 仍为 false,业务工具只放行所选那个;**`task` 不再恒为 false**(这是本 spec 的预期变化,核对时别当回归失败)。

### 10.3 内网(桌面包 + GLM + 真 MCP)

1. **原始边界对上号**:016 v2 遗留的「一轮 10 个文件做通读类任务撞窗口」场景重跑 → 分治后不再撞窗口。
2. **弱模型遵从度**(重点,强模型通过不代表弱模型通过):① 父代理是否真的逐份派活、还是自己硬读;② 子代理是否只回结论、有没有擅自写文件;③ 单文档场景是否滥发 task(§5.1 残余代价的实测口)。
3. MCP chip 全链路回归(017):选功能 → 直接调用 → task_id → 转述 → 「好了吗」查询 → 文件卡片,不受工具面改动影响。

---

## 11. 不做 / 后续

- **`knowledge_search` 的 registry 名字 gate 同款改造**——同属依赖倒置,但归 SPEC-INS-030 那条线且刚动过归属,单独评估(§3.5)。
- **`apply_patch` 的 registry 裁剪**——上游 `EDIT_TOOLS` 共键所迫,除非上游改映射,否则维持(§3.4)。
- **task 卡片增强(步数/耗时/展开结论)**——P1,见 §8。
- **并发分治**——本 spec 只做串行(价值是隔离不是并发,且串行才有流式可见过程)。若内网模型并发能力改善且时延成为瓶颈再议。
- **子代理的解析件复用 / 缓存**——016 §8 已记「不做」,分治后重复抽取的面积变大,若成为瓶颈按那条立项。
- **上游 agent 合并循环的撞名保护**(config agent md 静默覆盖内置 agent)——本 spec 只在契约里点明(§4.2),不改上游。

## 12. 对齐清单(落地时逐项过)

- [x] `agent.ts`:defaults 加 `extract_document: "deny"` + `task: { insight_reader: "deny" }`;`octo_insight` 加两条 allow;新增 `insight_reader` 定义 + prompt txt
- [x] `registry.ts`:摘掉 `extract_document` 的 agent 名 gate;`apply_patch` 那条补注释说明为什么留
- [x] `octo-session-workdir.ts`:判据改根会话 + 四通道落点 + 防环/限深 + 新增两条 `[octo:session-workdir]` 日志
- [x] `extract_document.ts`:落盘目录改根会话
- [x] `mcp-trigger.ts`:`gate["task"] = false` 从无条件改为**只在 chip turn**(§5.2 例外),注释与用例同步
- [x] `octo_insight` 提示词:多文档通读时逐份派 `insight_reader`、每份回一行小结、报告由自己写
- [x] 单测:`agent.test.ts` / `registry.test.ts` / `extract_document.test.ts`(§10.1)
- [x] `docs/insight-debugging.md`:`[octo:session-workdir]` 补两条新消息 + 判据订正为「根会话非 insight」;`[octo:extract]` 行补 `root-session-unresolved` 并订正 gate 说明(可见性已移交权限层)
- [x] `docs/specs/README.md` 登记表、`ROADMAP.md` 行状态
- [x] SPEC-INS-016 §8 子代理那条改为指向本 spec;SPEC-INS-021 §1 的 task「turn 级默认关」追加撤销说明
- [ ] (待对齐)「子代理 — skill 作者须知」对外文档
