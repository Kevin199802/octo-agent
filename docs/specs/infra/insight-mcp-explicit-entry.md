# SPEC-INS-017 — MCP 显式入口(输入框 chip 触发,MCP 工具退出模型工具集)

> 状态:✅ 已实现(外网 2026-07-06,分支 `feat/mcp-explicit-entry`;§3 采用方案 A,实现记录见 §8)· 优先级 P1 · 规模 [M] · 领域 infra/ui/insight
>
> 上游已实现:✗(PromptInput 为 insight 自实现;「预置提示词单 turn」机制已有,复用 —— 见 [SPEC-INS-007](../ui/insight-prompt-redesign.md))
>
> 总纲:[ADR-015 修订](../../adr/015-file-passing-architecture.md)(分支 ④ 触发方:模型隐式 → 用户显式)。
> 依赖:[SPEC-INS-015](insight-file-passing.md)(`[附件]` 清单 + octo-upload-inject 按需上传,机制不变)。
> 姊妹 spec:[SPEC-INS-018 本地解析 v1](insight-local-analysis-v1.md)(本地成为默认主路,本 spec 让 MCP 成为显式可选路)。

---

## 0. 背景与动机

MCP 解析(另一团队维护)在内网排队严重;insight「标准 Agent 化」方向下,MCP 应是**可选场景**而非默认通道。现状 MCP 由**模型隐式触发**(系统提示词引导弱模型选工具),带来三个问题:

1. **命中率押在弱模型上**:ROADMAP「弱模型工具意图识别评测」整项就是为这个失败面立的(按钮命中率 ≥95% 目标);
2. **系统提示词被 MCP 仪式占据**:长任务规则、`get_task_result` 强制重调、文件引用铁律等段落**常驻每一轮**,喂给与 MCP 无关的对话;
3. **用户不知情排队**:隐式触发时用户不知道自己进了慢队列。

改为**输入框 chip 显式触发**后:路由从「模型猜」变成「用户说」,上述三个失败面整类消失;本地线(SPEC-INS-018)可安心成为默认主路 —— MCP 永远一键可达。

## 1. 入口形态(设计点 ①,业界对比)

| 方案 | 业界先例 | 结论 |
|---|---|---|
| **A. 输入框模式 chip** | Gemini / GPT 生图入口、DeepThink 开关:输入框内常驻可见的模式选择 | **✓ 选用**:入口不可能看不到;「本条消息走 MCP」语义清晰 |
| B. 隐式模型路由(现状) | 通用 agent 工具自选 | ✗ 弱模型命中率风险,即本 spec 要消除的东西 |
| C. 附件卡片动作 / 斜杠命令 | Slack / Discord | ✗ 入口藏得深,学习成本;附件卡片动作到发送还有距离 |

**chip 交互**(2026-07-06 二次修订,**语义 = 范围限制,非强制指令**):「研究工具」chip 点开菜单选功能(见 §3 功能清单)→ 选中后 chip 高亮显示所选功能、输入框 placeholder 切为该功能的材料提示 → 选中期间每次发送都注入解析模式指令 + tools gate → **纯常驻**:只有手动 × 才取消,无任何自动清除副作用(与 GPT/Gemini 工具模式一致)。
> **选中的含义**:"如果本会话要做 MCP 解析,只能是这一个工具"(gate 保证,模型看不到其他业务工具;查询/终止工具通用常驻)——**要不要调用由模型按用户消息判断**(模板强倾向:选中通常即希望解析,材料齐且无其他明确意图就直接调,不反复确认)。演进记录:初版为"发送即强制触发 + 单 turn 复位",后为解决"缺材料需模型询问、用户补件"改为"常驻直到兑现"(自动清除防重复提交);再评审发现**重复提交陷阱本身是"强制触发"造出来的**——判断权还给模型后,查询 turn 走 get_task_result 仪式、不会重复提交,纯常驻即安全,自动清除状态机整个拆除。用户不需要操心"选中着会不会有副作用":它只是范围开关。

## 2. 触发链路(设计点 ②,业界对比)

先记清**现状的模型接触面**(常被误记为「传参不经过模型」):模型负责 (a) 选工具、(b) 在 args 里写**文件名**;插件([octo-upload-inject](../../../UXAI/packages/opencode/src/agent/octo-upload-inject.ts))在 `tool.execute.before` 把文件名换成 S3 URL。**URL 确实全程不经模型**(ADR-014 演进后),但 (a)(b) 都是模型行为 —— 插件甚至专门为「弱模型照抄完整路径」做了「文件名 / 完整路径 / 磁盘 basename」三键精确匹配容错(2026-07-03 fix;曾附加去空白归一化、同日复审回退——启发式修补有静默误配风险且追不完模型变异,确定性钉死走 §2.1)。

| 方案 | 机制 | 确定性 | 结论 |
|---|---|---|---|
| **A. 单 turn 预置提示词** | chip 选择 → 客户端把**解析模式指令**填进模板注入(文件以 `[附件]` 清单为准,模型填文件名;2026-07-06 起不再由客户端写死文件集)→ 模型判断是否发起调用 → 插件校验+换 URL | 工具**范围**:gate 钉死(若调用,100% 是所选工具);是否调用:模型判断(模板强倾向);文件名:模型照抄清单,§2.1 字段级校验——抄错即响亮失败回灌(三键精确匹配,零静默) | **✓ v1**:复用预置提示词机制与异步任务卡片渲染链路,零新增管线 |
| B. API 级 `tool_choice` 强制 | OpenAI-compat forced function:请求级钉死工具选择 | 工具选择 100%;args 仍模型生成 | 作为 A 的加固项,**待验证内网网关是否支持**;支持则叠加 |
| C. 客户端直调(模型出环) | 客户端直接构造 MCP 调用,合成工具调用 part 入会话 | 100% | ✗ v1 不做:文件卡片渲染依赖当前 turn 的 tool-call part([learning](../../learning/file-card-depends-on-current-turn-tool-call.md)),合成 part 或另起渲染路径改动深。**Phase 2**:若 v1 埋点显示 args 改写错误率不可忽略,再立项 |

### 2.1 加固项:chip 声明 + 插件字段级校验/注入(2026-07-03 增补;**2026-07-06 修订:确定性边界收敛**)

> **2026-07-06 修订**:原设计让客户端在声明里写死**文件参数映射**(哪些文件进 download_links、哪个是 outline)并强制覆盖——评审否决:①这迫使 UI 设文件门槛(没上传不能触发)、多角色分桶交给用户点选,把 Agent 做成了 web 表单;②文件"怎么来"本该是对话的一部分(缺材料 → 模型向用户索取)。**确定性收敛为两条,其余归模型对话**:
>
> 1. **触发范围固定**(2026-07-06 二次修订,从"触发固定"放宽):chip 选中期间 tools gate 只放行所选工具——**若**模型发起 MCP 业务调用,100% 只会是这一个;**是否**调用由模型按用户消息判断(模板强倾向调用,见 §1)。"调哪个"是机制问题归客户端钉死,"要不要调"是意图问题归模型——判断错在对话里可见可纠,不是静默数据损坏;
> 2. **URL 传递固定**:模型只写文件名,插件精确替换成 URL;写错 → 响亮失败回灌(错误信息附可用文件清单),绝不静默、绝不模糊匹配。
>
> 文件获取(没上传 → 模板指示模型**不调用、先向用户要材料**)与多角色分桶(哪个是大纲 → 模型判断,**拿不准先向用户确认**)是模型职责。

机制:

- **chip 注入模板附带机器可读声明段**(独立 synthetic text part,用户不可见,与 `[附件]` 清单同类机制):声明本 turn 的**目标工具**、**是否要求 outline 字段**(`outline_required`,多角色工具)与**用户当轮原文**(`user_prompt`),由客户端生成。
- **octo-upload-inject 插件在 `tool.execute.before` 读取本 turn 的 chip 声明**:若 `input.tool` 与声明匹配 →
  - **校验**:`download_links` 必须是非空文件名数组、`outline_required` 时 `outline_file_path` 必填;每个引用必须**精确命中**清单(三键之一)。任何 miss / 缺字段 / 空列表 → 抛错,错误信息带可用文件清单,回灌模型重填或转而向用户索取材料;
  - **替换与注入**:命中的引用按需上传、换成 URL;确定性注入 `download_file_names` / `outline_file_name`(= 命中文件的磁盘落地名,与 URL 数组下标对齐;mcp-contract 2026-07-03 提案字段,可选、UXR 未消费前无害)与 `user_prompt`(声明原文,模型转述一律矫正)。
- **与 ADR-014 handle 机制的本质区别**(handle 曾因「不想让用户看到」被 SPEC-INS-015 撤掉):handle 要**经模型复述**、且可能漏进用户可见对话;chip 声明是 synthetic part,模型只携带不复述,用户不可见,插件直接读。
- 非 chip turn 无声明,插件行为不变(按 §3,非 chip turn 本不应出现 MCP 调用)。

**度量**:`[octo:inject] chip-declaration enforced` 打 `files / userPromptCorrected / correctionHits / before / after`;校验失败(引用 miss / 空列表 / 缺 outline)即插件抛错,greppable。模型抄错文件名在 chip turn 表现为**调用失败重试**而非坏值直通 MCP——失败率作为「发起调用+抄文件名」环节可靠性与 Phase 2(客户端直调)的立项依据。(2026-07-03 曾用去空白归一化 + `fuzzyRefs` 做兜底与度量,同日复审回退:归一化有静默误配风险——换错文件比失败更糟,且"模型改写引用"是无界类,启发式追不完。)

**「抄文件名」失败率过高时的备选(2026-07-08 记录,暂不做,按 miss 率数据触发)**——弱模型(如内网 flash 档)对下划线/空格混排的长文件名可能"每抄必变异",响亮失败会退化为反复重试不可用。备选按确定性排序:
1. **短引用编号**:`[附件]` 清单给每个文件一个确定性编号,模型填编号或文件名均可、插件精确解析(仍是精确匹配 + 响亮失败,抄写面从 ~40 字符缩到 1–2 字符)。与被撤的 handle 本质不同:handle 是不透明 hex、承载 URL 语义、会漏进可见对话;编号人类可读、只在 synthetic 清单与工具参数里出现。成本:清单格式契约三处同步(formatUploadsForPrompt / parseUploadedFiles / 插件 parseManifest)+ InsightTurn 渲染。
2. **回 §2.1 原案**(客户端声明文件映射 + 插件覆盖):抄写能力彻底无关,但代价是 UI 承担文件集/分桶语义(文件门槛 + 选大纲,表单化,已被否);且"单桶吃全部附件"在跨轮会话会把旧大纲静默喂进逐字稿桶——静默错文件比响亮失败更糟。**注意它与触发语义正交**:文件参数谁生成,不影响"范围限制、调不调归模型"的 chip 语义。
3. Phase 2 客户端直调(§2-C,模型全出环,渲染链路改造大)。

## 3. MCP 工具退出模型工具集(设计点 ③)

摘除清单(octo_insight.md frontmatter `tools` 白名单):`key_findings` / `run_guide_analysis` / `run_usability_analysis` / `mindmap` / **`search_reports`(尚未对接,一并摘除)**。摘除后 insight 模型常驻工具 = `task` + `extract_document`(SPEC-INS-018 再补 read/grep/write)。

「摘除后 chip turn 怎么还能调」的机制选型:

| 方案 | 机制 | 结论 |
|---|---|---|
| **A. turn 级动态 gate** | 工具白名单保留 MCP 工具,但组请求时按「本 turn 是否 chip 注入」动态决定是否下发给模型 | **✓ 已落地(2026-07-06)**:非 chip turn 模型根本看不到 MCP 工具,误触发为 0。**实现落点(调研结论)**:opencode **上游原生**支持 per-message `tools: Record<string, boolean>` —— promptAsync 入参存到 user message(`lastUser.tools`),每 turn 组工具集时 [session/llm.ts resolveTools](../../../packages/opencode/src/session/llm.ts) 按 `user.tools[key] !== false` 过滤(octo_studio 的图像模式已用同机制),**零上游改动**。客户端每次发送都带 gate(`buildToolGate`):非 chip turn 5 个业务工具全 `false`,chip turn 只放行选中那一个;`get_task_result`/`stop_task` 不在 gate 内(查询/终止发生在后续非 chip turn,须常驻)。chip turn 另关 `task`/`bash`/`webfetch`(§8-8 逃生口)与 `extract_document`(§8-9:MCP 只收文件名、服务端自解析,本地正文零贡献纯占上下文)。副作用即兜底:服务端 `prompt()` 会把 tools 转成 session.permission 持久化,某 turn 漏传时上一轮的 deny 仍隐藏工具 |
| B. 提示词层禁用 | 白名单保留,常驻提示词删除 MCP 引导、chip 模板内授权 | 不需要:A 已落地(常驻提示词删 MCP 段落 + chip 引导句照做,作为 A 的配套而非替代) |

## 4. 系统提示词删减

- **整段迁出**常驻提示词、迁入 chip 注入模板(仅 chip turn 生效):长任务规则(task_id / 立即结束 turn)、`get_task_result` 仪式、异步任务结果回复格式、文件引用铁律(只填文件名不碰 URL)。
- 常驻提示词仅保留一句引导:「需要 MCP 解析(观点解析 / 访谈提纲 / 可用性 / 思维导图)时,请用户点输入框的 MCP 按钮」—— 模型可以**建议**,不能**代调**。
- 提示词每改一版,跑 SPEC-INS-007 §11 意图评测;MCP 工具退出隐式选择后,评测范围收窄到本地工具,负担变小。
- `extract_document` 失败 / 空文本文案中「请改用 MCP 分析工具(文件参数填文件名)」改为指向 chip:「可点输入框的 MCP 按钮转交内网解析」。

## 5. 埋点(数据决策的输入)

| 事件 | 字段 | 决策用途 |
|---|---|---|
| chip 点击 | 功能、所选文件 token 估算(取 `[octo:extract]` 或客户端估算) | **chip 点击中「因文件超阈值」占比 → 拆分合并是否立项**(SPEC-INS-018 §6) |
| chip turn 工具调用结果 | 成功 / 失败原因、args 是否被插件改写命中 | args 错误率 → Phase 2(客户端直调)是否立项 |
| 本地解析失败 | not-found / unsupported / parse-error / 空文本 / 超阈值 | 本地线缺口分布 |
| chip 点击率趋势 | 周维度 | **本地线成熟度仪表盘**:趋近 0 之日即 MCP 退役决策依据 |

上线 2–4 周后按上表做一轮数据决策(拆分合并 / Phase 2 / MCP 退役路线),结论回写本 spec 与 ROADMAP。

## 6. 不在范围

- 块级拆分合并(由 §5 数据决策,见 SPEC-INS-018 §6)
- 客户端直调(Phase 2,见 §2-C)
- 二次生成(ROADMAP D)、偏好 / 方法论 skill(依赖 skill-system)
- MCP 产物下载落盘机制(SPEC-INS-014 已有,不动)

## 7. 对齐清单(落地时逐项过)

- [x] octo_insight.md:frontmatter 摘工具 + 常驻提示词删 MCP 段落 + 加一句 chip 引导(`.txt` 加载变体同步)
- [x] chip 注入模板:功能指令 + 文件名(客户端填)+ 迁入的 MCP 仪式段落 + **机器可读声明段**(§2.1)
- [x] octo-upload-inject:解析 chip 声明、按声明强制对齐文件参数(§2.1;既有按需上传机制不变)
- [x] PromptInput(insight 自实现):chip UI + 菜单 + 单 turn 复位
- [x] extract_document 失败文案改指向 chip
- [x] 埋点接入(§5;打点基建见 [tracking.md](tracking.md))
- [x] ROADMAP 状态更新;`[octo:*]` 日志字典([insight-debugging.md](../../insight-debugging.md))同步(`[octo:mcp]` 新增、`[octo:inject]` 新日志、`[octo:preset]` 下线)

## 8. 实现记录(2026-07-06,外网 `feat/mcp-explicit-entry`)

**落点**:

| 项 | 文件(UXAI) | 说明 |
|---|---|---|
| chip UI + 菜单 | `pages/insight/components/mcp-chip.tsx` + `octo-tokens.css` | 「研究工具」胶囊(样式与模型选择器触发钮一致,位于其右侧);菜单选功能(Portal 挂 body);激活态高亮 + × 取消;纯常驻 |
| 模板 / 声明 / gate 构建器 | `pages/insight/store/mcp-trigger.ts` | `buildChipTemplate` / `buildChipDeclaration` / `buildToolGate`;声明格式 `[MCP声明]\n<JSON>`,与插件解析同源契约 |
| 功能定义 | `pages/insight/store/preset-prompts.ts` | 原 4 个预置提示词转为 chip 菜单项;新增 `outlineRole` 字段标记多角色工具;胶囊行组件 `preset-prompts.tsx` 删除 |
| 发送链路 | `pages/insight/index.tsx` | chip 选中期间每次发送注入模板/声明 synthetic parts + `tools` gate 随 promptAsync 下发;busy 时照常入队,flush 时按当时 chip 状态携带(队列只存文本,模式在发出那一刻取值) |
| 声明强制对齐 | `packages/opencode/src/agent/octo-upload-inject.ts` | 见 §2.1 实现要点 |
| 提示词 | `agent/prompt/octo_insight.md`(`.txt` 同步) | frontmatter 摘 5 工具;正文删 MCP 全部段落(仪式迁入模板);加 chip 引导段;`agent.ts` 的 `mcp: ["uxr-tool"]` 绑定保留(chip turn 需要工具在册,可见性由 gate 控) |

**实现决策(spec 未尽处;含 2026-07-06 评审修订)**:

1. **不设文件门槛**(2026-07-06 修订):chip 菜单四项常可选,不校验附件;缺材料时模板指示模型**不调用、向用户索取**,用户补件后发送即再次注入指令(靠 §1 的纯常驻)。~~初版"文件不足禁用菜单项 + 用户点选大纲"~~ 被否:那是把 Agent 做成 web 表单。
2. **多角色分桶归模型**(2026-07-06 修订):模板要求按文件名判断哪个是大纲/任务书,**拿不准先向用户确认再调用**;声明只带 `outline_required` 供插件校验必填。
2b. **生命周期 = 纯常驻、是否调用归模型**(2026-07-06 二次修订,见 §1 演进记录):模板从"本轮必须调用"改为四条判断规则(选中即强倾向调用 / 其他意图正常回应 / 已提交不重复提交 / 缺材料先索取);"兑现即自动清除"状态机拆除;busy 时 chip 发送不再特殊拦截——照常入队,flush 时按当时 chip 状态携带。
3. **`user_prompt` 钉死**:声明携带用户当轮键入原文,插件强制覆盖(mcp-contract 承诺"原样透传不改写",模型转述也被矫正);未键入时缺省不动。
4. **空输入不可发送,气泡恒为用户原话**(2026-07-07 修订):chip 选中不豁免空输入门槛(与 ChatGPT/Gemini 一致);~~初版"空输入回落预置文案"~~ 被否——回落文案冒充用户发言且被误认为旧模板残留。`user_prompt` 因此恒有值;`preset.text` 降级为菜单 tooltip;选中期间输入框 placeholder 切为该功能的材料提示(占位文案,正式版待设计师,见 design-assets-needed)。模板/声明均为 synthetic part(气泡不显示、模型可见,与 [附件] 清单同机制);模板注入后随会话历史常驻,后续「查询任务 X」的非 chip turn 仍能看到查询仪式与回复格式(§4 迁出常驻提示词的段落靠这个继续生效)。
5. **插件声明路径细节**:仅对 `uxr-tool_*` 前缀调用查声明(非 MCP 工具保持 `hasFileRef` 零开销早退,MCP 工具不能靠 args 早退——模型漏填文件参数正是校验要接管的情况);声明只认**当前 turn**(最后一条 user 消息);声明格式坏 / 引用清单外文件 / 空列表 / 缺 outline / args 非对象 → 抛错响亮失败(错误信息附可用文件清单),不静默降级;声明工具与实际调用不匹配(如 chip turn 模型违规调 get_task_result)→ 回落通用路径。日志:`[octo:inject] chip-declaration enforced`(`files` / `userPromptCorrected` / 进程内 `correctionHits`)。
6. **chip UI**(对齐设计稿):触发钮「研究工具 ▾」位于模型选择器右侧,激活后替换为高亮胶囊「<功能> ×」;菜单经 Portal 挂 body + fixed 定位——chip 在输入卡片内,卡片 `overflow-hidden` 会裁掉就地渲染的菜单(初版 bug)。
7. **埋点命名**(§5 对应):`mcp-chip-open` / `mcp-chip-select`(功能 + fileCount + 待发送附件字节估算 tokens;历史轮文件客户端拿不到大小,精确值以 `[octo:extract]` 为准)/ `mcp-chip-clear` / `message-send.extend.mcpFunction` / `mcp-chip-result`(turn 完成后对账是否调用、成败;`not-called` **不必然是失败**——调用与否归模型判断,命中率结论交内网评测结合用户复述行为看)/ `extract-failure`(reason 分布)。原 `preset-click` 事件随胶囊行下线。
8. **chip turn 关闭即兴逃生口 + 调用纪律**(2026-07-07,内网验证教训):MCP 连接故障(见下方验证记录)导致被钉死的工具缺失时,弱模型即兴发挥——委托 task 子代理、用 shell 裸调 MCP HTTP、**编造 task_id**。硬约束:chip turn 的 gate 顺手下发 `task: false`、`bash: false`(该 turn 职责就是一次直接调用,这俩没有正当用途;非 chip turn 保留);软约束:模板增设"调用纪律"四条(必须直接调用,禁止任何模拟途径 / 工具不可用时如实告知用户、**不要再让用户点按钮** / task_id 只能来自工具真实返回,绝不编造 / [MCP声明] 是机器段落不得向用户复述)。同时改写常驻提示词 MCP 段落为「工具按需出现、出现时由你调用」——原措辞"由用户点击按钮触发、你不能代调"会让模型在工具缺失时把已经点过按钮的用户再往按钮上引。

9. **chip turn 关掉 `extract_document`**(2026-08-19,内网上下文超限):内网反馈「做观点提取时还会同时触发 `extract_document`,多文件直接超限」。**MCP 调用根本不需要正文**——模型只填文件名,octo-upload-inject 在 `tool.execute.before` 换成 S3 URL,解析由内网服务端自己做;本地抽出来的正文对这次调用**零贡献**,纯上下文负担,且随会话历史累积。而常驻提示词「解析材料统一入口 = `extract_document`」「office 一律用它」的引导正把模型往这条路上推,chip turn 遂出现「先逐个抽文档、再调 MCP」。体量对得上:[SPEC-INS-016](insight-extract-document.md) §4.1 的内联分支(≤~49KB ≈ 1.6 万汉字,**一份普通访谈稿正好落在这档**)是全文回灌,10 份 ≈17 万 token 超 128K 窗口即 overflow。
   - **落点**:`buildToolGate` 的 chip 分支加 `gate["extract_document"] = false`,与 bash/webfetch 同处(turn 级 gate 机制不变,零服务端改动)。
   - **只关 chip turn**:MCP 是异步长任务,提交完即结束本轮;后续轮次用户问「稿子里 XX 怎么说的」、或走本地线(SPEC-INS-018)分析时,`extract_document` 仍是 office 文件的**唯一**读取入口(`read` 对二进制直接报错),全局摘等于砍掉本地解析线。单测两条都断言了(chip turn 关、非 chip turn **不下发**)。
   - **配套模板纪律**(必须,有先例):工具从列表里消失而提示词仍在引导它,正是第 8 条那次事故的形态(MCP 工具缺失 → 弱模型委托 task / shell 裸调 / 编造 task_id)。故「调用纪律」补一条:**不要先去读文件正文**——工具只需要文件名、材料由内网服务端自行解析,读正文对调用无帮助只挤占上下文(`extract_document` 本轮已禁用);需要分桶时按文件名判断或问用户,不要靠读内容判断(与 §2.1「分桶归模型」一致,不新增约束)。
   - **顺带影响**:该 gate 也消掉了 chip turn 里 txt/md 被重复抽取的那一份;但**非 chip turn 的 txt/md 双份问题不在此列**,见 [SPEC-INS-021 §3.1](insight-toolset-convergence.md)(提示词判据订正)及其中记录的死角——txt/md 的 FilePart 内联不是工具调用,gate 够不着。
   - **验证**见 §9。

## 9. 验证(§8-9 chip turn 关闭 extract_document)

> 判据统一看 `[octo:extract]` 日志(裸 console.log,跟随 sidecar stdout;落点见 [insight-debugging.md](../../insight-debugging.md) 及其 §「注意上传在 sidecar」一段:**成品包在 `main.log`**、`run dev` 打在外部 server 终端)。**改的是服务端提示词与客户端 gate,验证前必须重启 opencode server / Electron 进程**,否则模型拿的是旧提示词、客户端是旧 bundle。

**自动化(已通过)**:`mcp-trigger.test.ts` 两条——chip turn 断言 `extract_document === false`;非 chip turn 断言 **`"extract_document" in gate === false`**(不下发,后者是真正的防回归点:挪出 `if` 就会让 office 全局读不了)。insight 单测 268 pass,两包 `tsgo` 干净;`octo_insight.md` / `.txt` 已 diff 核对一致。

**外网端到端**(不依赖内网 MCP 可用——外网 MCP 连不上是预期,本项要看的是**调用之前**的行为):

1. 新建 insight 会话 → 上传一份 docx → 选「研究工具 · 观点解析」→ 发送。
   - **期望:全程不出现任何 `[octo:extract]`**。模型应直接尝试调 MCP 工具,失败后按调用纪律回「内网 MCP 连接暂不可用…」。
   - **失败形态**:出现 `[octo:extract] ok` = gate 没生效(先查是否重启、bundle 是否更新)。
2. **对照组(防误伤本地线,必做)**:同一会话取消 chip → 让模型分析那份 docx → `[octo:extract] ok` 正常出现、模型读到正文。证明只关了 chip 那一轮。
3. **模板纪律生效**:第 1 步里模型不应说「我先读一下文档内容」或试图用 read/glob 绕道取正文。

**内网验证**(真依赖内网 MCP 与弱模型):

1. **超限回归(本次的直接目标)**:传一叠真实逐字稿(复现原问题的那个量级)→ 选研究工具 → 发送。期望:无 `[octo:extract]`、模型一次直接调用拿到 task_id、**不再触发上下文超限 / auto compaction**。
2. **只关那一轮**:上一步拿到 task_id 后,在后续非 chip turn 让模型读其中某份 docx → `extract_document` 正常可用。这条不过 = 关过头了,本地解析线被误伤。
3. **弱模型遵从度**:第 1 步重点观察模型有没有绕道(read/glob 取正文、编造已读到的内容)。若出现,是模板纪律措辞问题,回本条记录。
4. 日志速查(内网 Windows / PowerShell):`Select-String -Path <main.log> -Pattern 'octo:extract'`;本地 Mac:`grep 'octo:extract' <main.log>`。

**验证**:两包 typecheck 通过;insight 既有单测 100 通过;插件冒烟 11 例通过(字段校验各失败路径 / 声明工具不匹配回落 / 非 chip 路径不变 / mock 上传服务正向全链路,含 user_prompt 矫正、file_names 注入、模型抄完整路径的三键命中)。

**内网联调记录(2026-07-07)**:测试/开发同学设备 chip 全链路正常(gate 放行 + MCP 调用成功),**gate 机制实证可用**。一台设备"永远拿不到 MCP 工具",sidecar 日志定位为**传输层代理问题、与本 spec 无关**:`[octo:mcp] transport-failed … Proxy response (407) !== 200 when HTTP Tunneling` 且 `toolsForAgent allToolCount=0`(工具没进系统,gate 未上场)——`proxyMode=bypass(forced)` 仍走了代理隧道,说明 `noProxyFetch`(临时删代理环境变量再 fetch 的实现)覆盖不住 SSE 长连接/内部重连路径,**该结论移交 MCP 连接负责线**;同时运维打包的 `OCTO_UXR_MCP_URL` 仍是 `http://7.192.…` IP,应改 https 域名。该设备上由此诱发的弱模型即兴行为(task 委托 / shell 裸调 / 编造 task_id)已由上表第 8 条钉死。待验:命中率评测、§5 数据入库。

**2026-07-08 回归事故(自伤,当日修复)**:第 8 条新增的调用纪律在模板正文里**提及了字面量 `[MCP声明]`**,而插件定位声明/清单区块用的是 `includes` → 定位命中模板、从模板中段开始 JSON.parse → 所有 chip 调用响亮失败(`[MCP声明] JSON 解析失败:Unexpected token '段'…`)。同类隐患:模板提及 `[附件]` 也会让清单聚合把模板行解析成垃圾引用键。**修复**:两个标记的定位改为 `startsWith` 锚定(区块 part 由客户端构造,头恒在第 0 位)——模板可以自由提及标记名。教训:**给模型解释机器标记的文案,和机器扫描标记的逻辑,共享同一命名空间**;扫描必须锚定结构位置(part 开头),不能全文搜。冒烟新增两例回归(真实模板排在声明前 / 模板不污染可用文件提示)。
