# Agent 工具配置全景:七层控制点、各自粒度与选型

> 背景:SPEC-INS-017 落地过程中,"某个工具为什么在/不在模型的工具列表里"这个问题反复出现——chip turn 要只放行一个 MCP 工具、非 chip turn 要藏起全部业务工具、内网验证又遇到"工具凭空消失"(实为 MCP 连接故障)与"弱模型用 task/shell 模拟被禁工具"。排查中把 fork 里**所有**能影响工具集的控制点走了一遍,值得系统沉淀:下次再问"这个工具怎么控制/为什么不见了",按本文分层查。
>
> 相邻文档:[tools-and-permissions.md](tools-and-permissions.md)(内置工具清单与权限规则语法)、[turn-level-tool-gating.md](turn-level-tool-gating.md)(第 5 层 per-message gate 的机制细节)、[plugin-hooks-url-injection.md](plugin-hooks-url-injection.md)(第 7 层执行钩子)。

## 0. 一张总表:从"工具存在"到"这一次调用"

模型某一轮看到的工具列表,是下面七层**依次过滤**的结果。上层管"存在性",下层管"这一次":

| 层 | 控制点 | 粒度 | 代码落点 | 改动成本 |
|---|---|---|---|---|
| 1 | 工具注册 | 全局 | `tool/registry.ts` `all()` | 加/删工具本体 |
| 2 | registry 硬编码 gate | agent × 工具 | `registry.tools()` 内 if 分支 | 改上游文件,一行 |
| 3 | agent 定义 | agent | `agent/agent.ts` 注册块(`permission` / `mcp` / `skills`) | 改 fork 注册块 |
| 4 | config 覆盖 | 安装/项目 | 用户 `opencode.json`、agent `.md` frontmatter | 用户侧,零代码 |
| 5 | session 级 permission | 会话(持久化) | `prompt()` 把请求的 `tools` 转成 `session.permission` | 随第 6 层自动发生 |
| 6 | per-message `tools` | **单条消息 / turn** | promptAsync 入参 → `user.tools` → `llm.ts resolveTools` | 客户端传参,零服务端改动 |
| 7 | 执行钩子 + 审批 | 单次调用 | plugin `tool.execute.before` / `ctx.ask` | 插件 |

下面逐层展开,末尾用 insight chip 做完整案例。

## 1. 工具注册(存在性的源头)

`ToolRegistry.all()` 返回 fork 里全部工具定义(上游内置 + fork 自加的 `extract_document` / `knowledge_search` 等)。工具不在这里注册,后面六层都无从谈起。MCP 工具**不走**这里——它们在第 3 层由 `mcp` 绑定动态并入(见 §3)。

## 2. registry 硬编码 gate(agent × 工具的静态白名单)

`registry.tools(input)` 组装时按 `input.agent.name` 直接 if 掉不该出现的工具:

```ts
// tool/registry.ts(节选)
if (tool.id === KnowledgeSearchTool.id) return input.agent.name === "octo_ai"      // 知识库只给 chat
if (tool.id === ExtractDocumentTool.id) return input.agent.name === "octo_insight" // office 抽取只给 insight
```

- 粒度:agent 级、编译期写死,**不区分 turn**。
- 适用:"这工具永远只属于某个 agent"这类不变量。SPEC-INS-017 调研时曾考虑在这里做 chip gate,否决原因:这里拿不到"本条消息是否 chip"的 turn 级信息。

## 3. agent 定义(fork 注册块:permission / mcp / skills)

`agent/agent.ts` 内置 agent 表是每个 agent 的能力骨架,三个字段管工具:

- **`permission`**(Ruleset):`allow / ask / deny` 规则,`Wildcard.match` 匹配工具名。**`deny` + `pattern:"*"` 的效果是"从模型工具列表里删掉"**(`Permission.disabled`,llm.ts 组请求时过滤),不是"能看到但拒绝执行";`ask` 是执行时弹审批(第 7 层)。octo_make 的注册块是最完整的参考(write allow / edit ask / apply_patch deny…)。
- **`mcp: ["uxr-tool"]`**(fork 私有字段,上游没有):声明该 agent 能看到哪些**内置 MCP server** 的工具。组装时 `mcp.toolsForAgent(agent.mcp, …)` 按 `<sanitize(server)>_` 前缀过滤——octo_insight 绑 `uxr-tool`,工具键即 `uxr-tool_key_findings` 等。**没有 `mcp` 字段的 agent 看不到任何内置 MCP 工具**(general 子代理拿不到 uxr 工具就是这个原因)。
- **`skills`**:控制 skill 工具能加载哪些技能包,与本文主线关系不大。

⚠️ **MCP 工具的"存在"还有个运行时前提:server 连接成功**。`toolsForAgent` 只是过滤器,MCP client 没连上(oauth 待授权 / 代理 407 / 重连 give-up)时 `allToolCount=0`,什么绑定都救不了。排查"MCP 工具不见了"永远先看 sidecar 日志三连:`[octo:mcp]`(连接/配置,含 `userOverridesUxr`)→ `toolsForAgent`(`filteredToolCount`)→ `mcp tools assembled`(`toolCount`)。**2026-07-07 内网实例**:`transport-failed … Proxy response (407)` + `allToolCount=0` —— 工具消失的根因在传输层代理,与任何 gate/配置无关。

## 4. config 覆盖(用户/项目侧,零代码)

用户 `opencode.json` 与 agent `.md`(gray-matter frontmatter)可以覆盖 agent 定义与 MCP server 配置。两个坑:

- frontmatter 的 `tools: Record<string,boolean>` 在上游已 **@deprecated**,应写 `permission`;
- **用户级 agent 覆盖会整体替换内建定义**,而 `mcp` / `skills` 是 fork 私有字段、不在标准 frontmatter schema 里——本地放一份 octo_insight 覆盖配置,`mcp` 绑定就丢了,MCP 工具全部消失(排查 §3 日志时 `agentMcp: undefined` 即此症)。同理用户 `opencode.json` 里配了 `uxr-tool` 会覆盖内建 server 配置(`userOverridesUxr: true`),URL/oauth 配错即断连。
- 另注:octo_insight 的 `prompt/octo_insight.md` frontmatter **不参与运行时**(agent 定义硬编码在 agent.ts,`.txt` 才是 import 的正文变体)——改那份 frontmatter 的 `tools` 列表只是文档同步。

## 5. session 级 permission(per-message gate 的持久化副产品)

`prompt()` 收到请求里的 `tools` 记录时,会**顺手**把它转成 session.permission 并落库:

```ts
// session/prompt.ts prompt()
for (const [t, enabled] of Object.entries(input.tools ?? {}))
  permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
if (permissions.length > 0) session.permission = permissions   // 覆盖式写入 + 持久化
```

- 效果与第 3 层 permission 相同(deny=隐藏、allow=免审批),但作用域是**这个会话**,且**跨重启、跨客户端版本存续**,直到下一次带非空 `tools` 的请求整体覆盖。
- 这是把双刃剑:insight 每次发送都带 gate → 逐 turn 覆盖、无残留,漏传时上一轮 deny 兜底(失败方向是"多藏"不是"多露",安全);但**用旧版客户端(不发 tools)打开新版用过的会话,会继承残留规则**——"回退版本后工具行为怪异"时,先怀疑这层,换个新会话即可排除。

## 6. per-message `tools`(turn 级,SPEC-INS-017 的主控点)

`promptAsync({ tools: { "<toolKey>": boolean } })` → 存进 user 消息 → 每个 loop step 由 `session/llm.ts` 的模块级 `resolveTools` 过滤:

```ts
Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
```

- **只有显式 `false` 才隐藏**,缺省/true 都可见;作用于发给模型的工具列表本身(模型的 request 里没有这个工具定义)。
- **键 = 工具注册键**,对 MCP 是 `uxr-tool_key_findings`,对原生工具就是注册 id——`task`、`bash`(shell 工具的注册键,显示名 Shell,含 pwsh/cmd 变体,见 `tool/shell/id.ts`)。**原生工具照样能 gate**,chip turn 关 task/bash 就是这么做的。
- 机制细节、调研弯路(两个重名 `resolveTools`)见 [turn-level-tool-gating.md](turn-level-tool-gating.md)。

## 7. 执行钩子与审批(单次调用粒度)

工具已经可见、模型已经发起调用之后,还有两道:

- **plugin `tool.execute.before`**:就地改写 `output.args`(octo-upload-inject 的文件名→URL 替换、chip 声明校验/注入都在这层),抛错 = 调用失败、错误回灌模型;
- **`ctx.ask`**:按合并后的 permission(agent + session)决定 allow 直过 / ask 弹审批 / deny 拒绝。

这层管不了"模型看不看得到工具",只管"这一次调用发生什么"。

## 8. 案例:insight chip 的完整工具面(SPEC-INS-017)

| 轮次 | 模型可见的工具 | 由哪层实现 |
|---|---|---|
| 非 chip turn | task、extract_document、skill 等原生工具;**无任何 MCP 业务工具**;get_task_result / stop_task 可见 | 第 6 层:gate 五个业务工具全 `false`(第 5 层持久化兜底漏传) |
| chip turn(选了观点解析) | 上述原生工具**减去 task、bash**;uxr-tool_key_findings;get_task_result / stop_task | 第 6 层:`{uxr-tool_key_findings: true, 其余业务工具: false, task: false, bash: false}` |
| general 子代理(任何时候) | 无任何 uxr 工具 | 第 3 层:general 没有 `mcp` 绑定 |

chip turn 关 task/bash 的教训(2026-07-07 内网验证):MCP 连接故障导致被钉死的工具缺失时,弱模型会**即兴发挥**——委托 task 子代理(子代理更没有该工具)、用 shell 裸调 MCP 的 HTTP 接口(被内网代理挡)、最后**编造 task_id**。提示词纪律("严禁模拟调用/不得编造")是软约束,把逃生口从工具集里删掉才是硬约束——恰好第 6 层的 gate 对原生工具同样适用,一行配置。

## 9. 选型口诀

- 永久性的"工具×agent"归属 → 第 2/3 层(registry gate / agent 定义);
- 用户/环境差异 → 第 4 层(config),小心 fork 私有字段覆盖丢失;
- **随单条消息变化的可见性(模式开关、场景收窄)→ 第 6 层 per-message `tools`**,这是唯一的 turn 级控制点,且上游原生;
- 参数矫正/校验/审批 → 第 7 层;
- 第 5 层不要主动用——它是第 6 层的自动副产品,记住它的存在是为了排查,不是为了依赖。
