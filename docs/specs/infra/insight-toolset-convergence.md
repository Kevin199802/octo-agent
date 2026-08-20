# SPEC-INS-021 — insight 工具集收敛 + 权限交互 + extract_document 入口修正

> 状态:已实现,外网自动化验证通过(2026-07-11,UXAI 分支 `feat/insight-toolset-convergence`),人工验证见 §8 · 优先级 P1 · 规模 [S~M] · 领域 infra/insight
>
> 上游已实现:大部分 ✓ —— 权限机制(Permission deny 即隐藏工具 + 阻断执行)、权限 Dock UI(`@opencode-ai/ui` DockPrompt + `SessionPermissionDock` 参照实现)、per-message tools gate 上游俱全;本 spec 主体是**配置收敛 + UI 接线**,新代码量小。
>
> 从 [SPEC-INS-018](insight-local-analysis-v1.md) 拆出(2026-07-11):工具面 / 权限面独立成篇,018 专注解析能力本体。018 依赖本 spec。

---

## 0. 背景:三个现状事实(2026-07-11 代码核查)

### 0.1 octo_insight 没有工具白名单,是"全家桶"

`octo_insight.md` frontmatter 里的 `tools: [task, extract_document]` **不被任何代码消费**——agent.ts 导入的是无 frontmatter 的 `octo_insight.txt` 镜像,.md 是文档虚构。(**2026-08-18 归因订正**,见 [SPEC-INS-032](insight-subagent-dispatch.md) §3.2:结论成立,但只对**内置 agent** 成立——`octo_insight` 定义硬编码在 agent.ts,那份 .md 不在 config 扫描路径里。**config 目录下的 agent md,`tools:` 是生效的**:上游 [config/agent.ts `normalize()`](../../../packages/opencode/src/config/agent.ts) 把这个已废弃字段翻译成 `permission` 再往下传。别把本句读成「该字段全局失效」。)工具对模型的实际可见性由三层叠加决定:

| 层 | 位置 | 对 insight 的实际裁剪 |
|---|---|---|
| 注册表条件 gate | `tool/registry.ts` tools()(~L308–330;builtin 全集 ~L236–258) | 仅两条:extract_document 只给 insight、knowledge_search 只给 octo_ai |
| agent 权限 | `agent/agent.ts` octo_insight(~L239–250);defaults(~L109–127)为 `"*": allow` | **零裁剪**(对比 octo_ai 显式 deny 了 task/webfetch/生图等) |
| per-message tools gate | app 端 `buildToolGate()`(mcp-trigger.ts)→ session.permission(session/prompt.ts ~L1406)→ `llm.ts` resolveTools(~L448) | 仅 5 个 MCP 业务工具 + task 恒关(chip turn 另关 bash/webfetch/extract_document,见 SPEC-INS-017 §8-8·§8-9) |

所以 insight 模型现在实际看得到:**shell、read、glob、grep、edit、write、task、webfetch、todowrite、skill、两个生图工具、extract_document** + MCP get_task_result/stop_task。

实证危害:2026-07-07 内网验证中,弱模型在 MCP 断连时用 shell 裸调 MCP HTTP、编造 task_id(SPEC-INS-017 chip turn 补关 bash/task 就是这个教训)——**非 chip turn 这些逃生口至今全开**。此外工具定义本身占上下文,无关工具稀释弱模型的选择注意力(业界共识:面向单一场景的 agent 用精编工具集,不用全集)。

### 0.2 「贴路径卡死」= 权限询问无 UI,不是 read 读不动

用户贴会话目录外的绝对路径(桌面 / 下载目录)→ 模型调 read → `assertExternalDirectoryEffect` → `external_directory` 默认 `"*": "ask"` → `ctx.ask` 阻塞等答复 → **insight 聊天界面(insight-turn.tsx)没有任何权限弹窗渲染** → 永远等不到回答,UI 停在「正在探索 · N 次读取」。debug-observer 已把它列为已知 stuck 模式(「⚠️ 卡在等用户 (permission…)」),只是没和用户反馈对上号。本地难复现的原因:测试路径在实例目录 / 白名单内,或桌面端 auto-accept 开着,ask 根本没触发。

(read 对 docx 二进制会直接报 `Cannot read binary file`(read.ts ~L243),那只是让模型换路子,不构成卡死。)

### 0.3 extract_document 的「仅上传文件」是措辞造成的假限制

extract_document 代码上**从不限制路径**(只做 access 存在性检查),但工具描述与常驻提示词都写「参数填 [附件] 清单里该文件的本地路径」——用户贴任意路径时模型据此认为工具不适用,转调 read,进而踩中 0.2。

## 1. 工具白名单(实现位:agent.ts 权限层)

octo_insight 常驻可见集收敛为(2026-07-11 修订:webfetch/websearch 自 deny 撤回;2026-07-30 修订:bash/edit/todowrite 自 deny 撤回——供 interview-analysis skill 对接与编辑 md 交付物,见下):

- **保留**:`extract_document` / `read` / `grep` / `glob` / `write` / `edit` / `task` / `skill` / `webfetch` / `websearch` / `bash`(shell)/ `todowrite`(+ MCP `get_task_result` / `stop_task`,+ `invalid` 基础设施)
- **deny**:`apply_patch` / `jimeng_image_generate` / `internel_image_generate`
- 已被 defaults deny 的不动:question / plan_enter / plan_exit / load_components_docs

理由对照:
- `write` 保留给 018 产物落盘;`edit` **2026-07-30 放开**(原归 ROADMAP D 二次生成、v1 不放):用户要编辑已生成的 md 交付物。edit 与 write 同用 `filePath`,outputs 重定向插件(`agent/octo-outputs-redirect.ts`)已同步把 edit 的相对文件名解析进会话 outputs——判据是「以 filePath 落盘产物」,write/edit 归同一集合。
- `task` 权限层保留 allow(018 多文档分治的编排原语),但 **turn 级默认关**(2026-07-13 追加,与用户对齐):task 是内部编排原语、不是用户能力入口——用户 turn 里模型自发起子代理对用研场景零收益(token/时延/弱模型跑偏),子会话还会被点成「侧栏没有记录的对话」的观感 bug。buildToolGate 对**所有**用户 turn 下发 `task=false`;018 那类**我们编排的 turn** 由构造方显式放行。配套 UI 面:insight 内**子会话导航全拦截**(task 卡片点击 / href / 刷新保路由恢复,均校验 parentID),过程仍由 turn 内联 task 卡片透明展示(§4),不 fork 第二个对话入口——业界同类(Claude Code subagent / Manus 执行流)子任务均为内联过程块,不开独立对话;上游"点进子会话"是开发者调试入口,不该漏给研究员。
  - ⚠️ **2026-08-18 撤销「turn 级默认关」**(见 [SPEC-INS-032](insight-subagent-dispatch.md) §5):`buildToolGate` 里那行 `task = false` 删除,task 常驻可见。本条当初的两个理由各自已有解——「弱模型跑偏」由候选收敛解决(defaults `task: { insight_reader: deny }` + octo_insight 显式 allow,模型的 task 描述里只剩一个只读文档子代理);「侧栏幽灵对话」由子代理独立 agent 名解决(侧栏按 `agent = octo_insight` 过滤,子会话天然不出现)。**本条的子会话导航全拦截保留不动**(点击 / href / 刷新恢复),作双保险。
- `bash`(shell)**2026-07-30 放开**:interview-analysis skill 的执行步骤需要 shell。原为 2026-07-07 事故(弱模型 MCP 断连时用 shell 裸调 MCP HTTP、编造 task_id,见 §0.1)后常驻 deny;权衡后为 skill 放开**普通轮次**的 bash,接受「非 chip 轮次那条逃生口在弱模型上重新暴露」的代价(不收窄到「仅 skill 轮次」)。产物落盘错位单独靠提示词「只给文件名」硬规则收敛,不靠关 bash。
- chip turn 的 gate 另**在关 bash 基础上增关 webfetch**(与 shell 同属 chip 轮模拟 MCP 调用的通道;webfetch 非 chip turn 不受影响)。gate 与本白名单双保险、互不替代(gate 管 turn 级动态,白名单管常驻底线)。**注**:bash 2026-07-30 放开后,chip turn 关 bash 已从「权限层已 deny 之上的冗余」升为**唯一守卫**——删 buildToolGate 那行会让研究工具轮次重新暴露 shell(mcp-trigger.ts 注释已同步)。
- `webfetch` / `websearch` 保留(2026-07-11 与用户对齐):竞品分析是能力线既定方向,工具面按能力本体划、不按 v1 单一场景裁。可用性实测(2026-07-11 用户验证):webfetch 内网代理配置后已验证可通(setGlobalProxyFromEnv 链路);websearch 亦实测可用(注册表 gate——registry.ts ~L310 仅 opencode provider 或 `OPENCODE_ENABLE_EXA` flag——在其环境已满足)。遗留约束:内网网关对部分域名 TLS 层掐断,覆盖面问题在竞品检索正式立项时再评估数据源。
- `skill` 保留:octo_insight 绑定 interview-analysis skill,且 ROADMAP E 体裁 skill 依赖它。
- `todowrite` **2026-07-30 放开**(原 deny 理由:v1 编排走提示词模板,弱模型场景 todo 是噪音):作 interview-analysis skill 多步执行的进度载体;权限层无耦合。若实测弱模型 todo 噪音明显,一行可撤回。
- 生图两件(`jimeng_image_generate`=即梦 / `internel_image_generate`=内网生图)deny:octo_studio 的创作类工具,用研场景无用途;思维导图类可视化产物走文本渲染,不是文生图。
- ⚠️ 已知取舍:registry 对 gpt 系模型用 apply_patch 替代 edit/write(registry.ts ~L324)。deny apply_patch 后 gpt 系模型在 insight 无落盘通道——当前内网 GLM / 外网 Claude 均不受影响,若将来接 gpt 系再单独处理。

**实现方式**:agent.ts octo_insight 的 permission 增加 `Permission.fromConfig({ … deny … })`(与 octo_ai 同款写法,merge 顺序 defaults → 本 deny → user,用户配置仍可覆盖)。**不做** frontmatter 白名单机制(那要新造一层配置消费,收益为零)。(**2026-08-18 部分翻案**,[SPEC-INS-032](insight-subagent-dispatch.md) §3:`extract_document` 的工具面改走**权限层声明**——defaults deny + 需要的 agent 显式 allow。这不是新造一层:`permission` 就是上游的声明式机制;而收益也不再为零——第三方 skill 团队自带 agent md 时可自助声明,不必我们改代码。`apply_patch` 因上游 `EDIT_TOOLS` 共键仍留在 registry 层,见 032 §3.4。)

Permission deny 的语义(llm.ts resolveTools + Permission.disabled):**既从模型工具列表隐藏,也阻断执行**,一处配置两层效果。

**落地记录(2026-07-11,实施中发现的上游耦合;2026-07-30 随 bash/edit/todowrite 放开更新)**:编辑类工具的裁剪**不能**走权限层——上游 `Permission.disabled` 把 edit/write/apply_patch 三个工具都映射到同一个 `edit` 权限键(permission/index.ts `EDIT_TOOLS`),且三者执行时也都以 `edit` 键问权限;在权限层动 edit 会**连带隐藏并阻断要保留的 write**。故实际落地为两层分工:
- 权限层(agent.ts)deny:`jimeng_image_generate` / `internel_image_generate`(权限键与工具 id 一一对应的部分;`bash` / `todowrite` 2026-07-30 已从此处撤回 deny,改为 allow);
- registry 层(registry.ts tools())按 agent 裁剪:octo_insight 不给 `apply_patch`(`edit` 2026-07-30 放开;与「extract_document 只给 insight」同款既有模式;不在模型工具列表即无从调用,无需再阻断)。

回归锁定:`test/agent/agent.test.ts`(deny/保留集 + external_directory=ask)+ `test/tool/registry.test.ts`(edit/apply_patch 摘除、write/extract 保留)。

## 2. 权限交互:复用原生 Dock,insight 页面接线

- `external_directory` **保持 `ask` 不放宽**:比起静默 allow,标准化的权限询问让用户对"读了我磁盘上什么"有知情权(2026-07-11 与用户对齐:宁可多一次点击,不要静默扩权)。
- insight 聊天面板接入权限询问 UI:参照 `pages/session/composer/session-permission-dock.tsx`(DockPrompt kind="permission" + 拒绝/仅本次/总是允许三键 + usePermission context 的 respond),按 insight 页面自包含原则做薄封装放 `pages/insight/components/`,不跨页面 import session 目录的组件。
- question 工具对 insight 是 deny 的,本次只接 permission,不接 question dock。
- 文案走 i18n 现有键(`ui.permission.*` / `settings.permissions.tool.*.description`),`external_directory` 的描述文案按「生产可见文案专业措辞」原则校对(用户是研究员,不是开发者——避免"外部目录"这类工程黑话,写成"读取工作区以外的本地文件"级别的人话)。

**落地记录(2026-07-11)**:组件落在 `pages/insight/components/permission-dock.tsx`(自包含:含子会话树遍历 + auto-accept 过滤 + respond,复制自 session/composer 同构逻辑,不跨页面 import);`external_directory` 的人话描述在**该组件内覆盖**(「AI 需要读取工作区以外的本地文件(路径见下方),经您允许后才会读取。」),未改全局 settings i18n(那份描述还服务设置页,改动波及 chat/make 的评审面)。新增 console 前缀 `[octo:permission]`(pending/respond),已同步 [insight-debugging.md](../../insight-debugging.md)。

## 3. extract_document 入口修正

- **解除"仅附件"措辞**:工具描述与常驻提示词改为「参数填文件的本地绝对路径;[附件] 清单是常见来源,用户在消息里直接给出的本地路径同样有效」。
- **office 禁走 read**:常驻提示词补一条硬规则「docx/xlsx/pdf/pptx 一律用 extract_document,绝不要用 read 读它们(二进制不可读)」。
- **扩展支持 txt/md**:extract_document 增加 txt/md 直读(readFile 即得,~15 行),使"解析源文件"有统一入口——收益:① 测量头(字数/token 估算)对所有解析源一致生效(018 §6 护栏的信号源);② 018 若落段落锚点,全格式统一;③ 提示词规则从三条(office→extract / 上传 txt→已内联 / 贴路径 txt→read)简化为两条(解析材料→extract_document;回读产物/Truncate 落盘→read)。上传 txt/md 的 FilePart 内联路(ADR-015 路由①)**不动**——已在上下文里的不需要工具。
- read 的定位收窄为:产物回读、Truncate 落盘文件回读、按行定点检查(它有行号/offset/limit,extract 没有)。

### 3.1 订正(2026-08-19):txt/md「已内联禁抽」要写成硬规则,不能留给模型自判

**现象**(内网):上传多个 txt 逐字稿后模型逐个调 `extract_document`,直接撑爆上下文。

**根因是上一条自己埋的**。§3 把提示词「简化为两条规则」时,原本三条里的「上传 txt→已内联、不用调」那条边界消失了,落到提示词里变成一句软句子:

> 上传的 txt / md 正文已自动内联进上下文,直接读即可、无需调工具;**若正文不在上下文里**(如用户只贴了路径),同样用 `extract_document`。

这要求模型自问「这份正文在不在我的上下文里」——**它答不了这道题**:路由 ① 的 FilePart 内联正文进上下文后没有文件名边界标记,多文件时更认不出哪段正文对应 `[附件]` 清单里哪一条。而它眼前是清单里的路径 + 「解析材料统一入口 = extract_document」+ 「支持 …/txt/md」,保险起见调工具是它能做的最合理选择。

**后果比 office 更糟**:office 只有工具回灌那一份,txt/md 是**内联一份 + 工具回灌一份**,同一份正文在上下文里存在两份(小文件走内联分支是完整正文),N 个文件即 2N 份。

**订正**:判据从「正文在不在我上下文里」(模型无从判断)换成「**这个文件在不在 `[附件]` 区块里**」(模型看得见的确定性事实)。常驻提示词改为两条硬规则:

- `[附件]` 区块里列出的 txt / md → **禁止**调 `extract_document`(正文已内联,再抽即双份);
- txt / md 只有一种情况要用它:用户在消息里直接给出路径、且该文件**不在**任何 `[附件]` 区块里。

**能力本身不撤**:§3 加 txt/md 直读是为「用户只贴了路径」的场景,那个场景依然成立且无替代;要挡的只是「已经内联了还抽一遍」。

**本次只做提示词层(软约束),不做机制层**。评审时提过在 [octo-upload-inject](../../../UXAI/packages/opencode/src/agent/octo-upload-inject.ts) 的 `tool.execute.before` 硬拦(该插件已在拦所有工具、已会解析 `[附件]` 清单,加一条「txt/md 且命中当前清单 → 响亮失败回灌『正文已在你的上下文中』」即可),**决定先不做**:软约束失效的后果只是回到现状,不会静默错文件、不丢数据,方向安全;先看一轮数据再定是否加机制。

**观测手段(判断软约束够不够的依据)**:server 日志 `[octo:extract] ok` 带 `format` 字段——**出现 `format: "txt"` / `"md"` 且该文件在 `[附件]` 区块里,即为软约束漏了**。内网跑一轮 grep 即可,零成本。漏的比例不可忽略时再上插件硬拦。

**已知死角(本订正与 SPEC-INS-017 的 gate 都够不着)**:txt/md 的内联是 FilePart、**不是工具调用**。用户传一叠 txt 逐字稿走 MCP 解析时,正文**必然**全份进上下文,而 MCP 根本不需要正文(服务端自解析)。若内网逐字稿多为 txt,MCP 场景的超限有一部分来自这里,提示词与 tools gate 均无从干预——需要动客户端的 FilePart 组装策略,不在本次范围,待数据。

#### 3.1.1 验证

> 本条是**纯提示词改动**,没有机制兜底 —— 所以验证的重点不是"能不能工作",而是**模型遵从度**,且必须在内网那档模型上看(强模型遵从不代表弱模型遵从,§8 已有同款教训)。判据看 `[octo:extract]` 的 `format` 字段。**改的是服务端提示词,验证前必须重启 opencode server / Electron 进程。**

**自动化**:无新增可测逻辑(提示词文本不进单测);`octo_insight.md` / `.txt` 已 diff 核对一致(除 .md 顶部注释)。

**外网端到端**:

1. **禁抽生效**:新建会话 → 上传 2–3 个 txt(每个几千字)→ 让模型总结。期望:**不出现 `format:"txt"` 的 `[octo:extract]`**,模型直接基于已内联正文作答。md 同样抽一个跑。
   - 失败形态:出现了 → 软约束漏(本条的核心风险,预期会有一定漏网率)。
2. **贴路径场景没被误杀(必做,防改过头)**:准备一个**不上传**的 txt(放会话目录外)→ 在消息里贴它的绝对路径 → 期望 `extract_document` 正常调用并读到正文。这条不过 = 把 §3 加 txt/md 直读的初衷一起废了。
3. **边界**:同一文件既在 `[附件]` 又被用户在消息里贴了路径 → 按硬规则应**不抽**(判据是"在不在 `[附件]`",与用户是否贴了路径无关)。

**内网验证**(弱模型遵从度 —— 本条的真正验收):

1. 复现原问题的场景:传多个 txt 逐字稿 → 让模型做分析。期望不再逐个抽取、不再超限。
2. **漏网率统计(决定要不要上插件硬拦)**:跑若干轮后统计日志里 `format:"txt"`/`"md"` 且该文件在 `[附件]` 区块内的 `[octo:extract]` 条数。
   - 内网 Windows / PowerShell:`Select-String -Path <main.log> -Pattern 'octo:extract' | Select-String -Pattern '"txt"|"md"'`
   - 本地 Mac:`grep 'octo:extract' <main.log> | grep -E '"txt"|"md"'`
   - **漏网率不可忽略 → 按 §3.1 的方案上插件硬拦**;接近 0 → 软约束够,维持现状。这是本条唯一的立项依据,不靠感觉判断。

## 4. 过程展示人话化(能力 vs 工具的"过程"层)

对用户暴露的**入口**按能力组织(017 chip 已是;018 本地能力入口同理),但执行**过程**的工具调用展示不隐藏——透明度是诊断和信任的基础,要改的只是显示名:

- extract_document 是自研工具,title 直接改中文:`extract_document: 张三.docx` → `提取文档正文:张三.docx`。
- 上游工具(read/grep/write/task)不动上游实现,在 insight-turn.tsx 做显示名映射(读取文件 / 检索内容 / 写入产物 / 子任务分析)。

**落地记录(2026-07-11)**:映射实现为 insight-turn.tsx 内用 `I18nProvider` 薄包一层 `SessionTurn`(只覆盖工具标题 i18n 键,其余键透传外层;仅本页子树生效,不动上游、不影响 chat/make)。两点补充:
- glob 顺带映射为「查找文件」(与 read/grep 同在"探索"聚合组,留英文名突兀);
- extract_document 在上游走 GenericTool 的「调用了 \`<tool>\`」模板(工具自身 title 字段不在该渲染路径展示),按模板参数特例映射;工具侧 title 仍一并改中文(落盘日志 / 其他消费方受益)。
- ⚠️ 已知限制:task 卡片标题优先取 **subagent 名**(上游渲染器读数据字段,非 i18n 键),带 `subagent_type` 的调用仍显示 agent 名(如 general);「子任务分析」只在无类型兜底时显示。不动上游渲染器的前提下无干净手段,暂按现状。

## 5. octo_insight.md frontmatter 清理

- 删除 `.md` 里不被消费的 frontmatter(`tools:` 伪配置是本次一切误解的源头),文件顶部加一行注释说明「本文件是 octo_insight.txt 的文档镜像,实际配置在 agent.ts,工具面见 SPEC-INS-021」;或直接让 .md 与 .txt 内容严格一致 + README 指路。两者选一,落地时定。
- `octoapp/constants/agent.ts` 里指向 .md frontmatter 的注释同步修正。

## 6. 不在范围

- 解析能力本体、方法论提示词、子代理、产物契约(SPEC-INS-018;子代理分治后独立立项为 [SPEC-INS-032](insight-subagent-dispatch.md))
- 引用锚点 / 引用校验器(018 §2,消费本 spec 的 txt/md 统一入口)
- edit / 二次生成(ROADMAP D)
- question dock、insight 之外其他 agent 的工具面

## 7. 对齐清单(落地时逐项过)

- agent.ts octo_insight permission deny 清单落地;chip turn gate 增关 webfetch(mcp-trigger.ts buildToolGate),非 chip turn 回归不受影响
- insight 权限 Dock 接线;内网复现「贴外部路径」场景:从卡死变为弹权限询问
- extract_document:描述/提示词措辞、txt/md 支持、中文 title
- octo_insight.md frontmatter 清理 + .txt 镜像同步 + constants 注释
- insight-turn 工具显示名映射
- `docs/insight-debugging.md`:若日志/展示有变同步
- specs/README.md 登记表、ROADMAP 行状态更新

## 8. 人工验证步骤

> 自动化已覆盖:agent 权限清单 / registry 工具面 / extract txt·md 直读与中文 title(单测),`curl /agent` 配置核对(源码 server)。本章是**真机人工验证**——权限 Dock 交互与模型行为(工具选择/措辞遵从)只能人肉过。
>
> 通用准备:构建含分支 `feat/insight-toolset-convergence` 的桌面包(或 dev 起 app);**先重启 opencode sidecar / Electron 进程**(agent 配置、工具描述、提示词都是进程启动时加载);打开 DevTools Console 备查 `[octo:permission]` / `[octo:chip]` / `[octo:prompt]`。

### 8.1 外网(开发机,Claude 等强模型)

**A. 权限 Dock(本 spec 核心场景,§0.2 的修复)**

1. 进 insight 新会话,**确认桌面端 auto-accept 处于关闭**(开着 ask 不会浮出,§0.2 讲过这是"本地难复现"主因;默认即关)。开关入口在 **Chat 侧**、insight 页面没有:切到 Chat 页 → 设置 → 通用 → 「自动接受权限」开关(注意:从 insight 侧栏打开设置时该开关因路由无 `:dir` 参数是灰的,必须从 Chat 路由进);或 Chat 会话内 `Cmd+Shift+A`。auto-accept 按**项目目录**持久化,对同目录下的 insight 会话同样生效。确认后在 insight 消息里贴一个**会话目录外**的文本文件绝对路径(如 `~/Desktop/试一下.txt`)让它分析。
   - 期望:输入区上方浮出权限 Dock——标题「需要权限」、描述为人话文案(「AI 需要读取工作区以外的本地文件…」,不是「外部目录」)、下方列出请求路径;Console 有 `[octo:permission] pending`。
   - 反例基线(修复前):无任何弹窗,界面停在「正在探索 · N 次读取」。
2. 点「允许一次」→ 该轮继续、正常回答;**同会话再贴另一个外部路径** → 再次询问(once 不扩权)。
3. 点「拒绝」→ 模型收到拒绝、正常收尾回复(不卡死、不无限重试)。
4. 点「始终允许」→ 同会话后续同类请求不再询问。
5. 回归:auto-accept 开启时贴外部路径**不弹 Dock**、直接读(自动应答仍工作)。

**B. 工具面收敛**

1. 问模型「列出你当前可用的工具」→ 期望:extract_document / read / grep / glob / write / edit / skill / webfetch / websearch / bash / todowrite(+ get_task_result / stop_task);**没有** apply_patch、生图两件,**也没有 task**(权限层 allow 但 turn 级 gate 默认关,见 §1)。（bash/edit/todowrite 2026-07-30 放开,见 §1。）
2. 让它「用 shell 执行 ls」→ **普通轮次可执行**(bash 已放开供 skill);**chip turn(研究工具那轮)不可用**(见 D:toolGate 里 bash=false)。
3. 让它「编辑刚生成的某个 md 产物的某行」→ edit 成功,且改动落在**会话 outputs 里的那份**(outputs 重定向插件已覆盖 edit;若落到别处即回归失败)。

**C. extract_document 入口 + 过程展示**

1. 上传 docx 让分析 → 过程条显示「**提取文档正文**:xx.docx」(不再是 `extract_document: …` 或「调用了 extract_document」)。
2. 贴一个**未上传**的本地 docx 绝对路径 → 模型直接调 extract_document(外部路径会先弹权限询问,允许后成功;修复前模型会按「仅附件」措辞拒用或转 read 踩卡死)。
3. 贴本地 txt/md 路径 → 走 extract_document 直读(不再用 read),输出首行有字数/token 测量头。
4. 让它读 docx 时观察:**不出现对 office 文件的 read 调用**(提示词硬规则生效)。
5. 一轮含 read/grep/write 的回答 → 过程条显示 读取文件 / 检索内容 / 写入产物(中文);已知限制:task 卡片带 subagent 类型时仍显示 agent 名(§4 落地记录)。

**D. chip turn 回归(不需要真 MCP)**

选「研究工具」发送一条 → Console `[octo:chip] chip-send` 的 `toolGate` 里 task/bash/**webfetch** 均为 false、所选业务工具为 true;取消 chip 后正常发送不受影响(非 chip turn 的 toolGate 也应有 `task: false`,可在 `[octo:prompt] send` 附近核对)。

**E. task 静默化(2026-07-13 追加)**

1. 明确诱导:「开一个子任务/子代理帮我分析这个文件」→ 模型**不发起 task**(工具对本 turn 不可见),正常自答或说明能力;侧栏**不出现**新的无标题对话。
2. 历史会话回归:找一条**旧会话里已有 task 卡片**的记录,点击卡片 → **不再跳转**(Console 出现 `[octo:task] child-session navigation blocked`);cmd/中键点击也不开新页。
3. 刷新兜底:若此前曾停留在子会话路由(或手工把子会话 id 写进 `octo:insight:last-session`),整页刷新 → 落回首页空态,**不恢复**进子会话。

### 8.2 内网(桌面包,GLM + 真 MCP)

1. **复现原始 bug 场景对上号**:贴桌面/下载目录的绝对路径 → 从「卡在正在探索」变为弹权限询问(§8.1-A 全套在弱模型 + 内网包上重过一遍;这是 debug-observer 里那个 stuck 模式的关单条件)。
2. **弱模型逃生口关死**(§0.1 的 2026-07-07 事故场景):断开/污染 MCP 连接,选 chip 发送 → 模型**无法**用 shell/task/webfetch 模拟调用(工具不可见),按模板如实回复「内网 MCP 连接暂不可用…」;**不出现编造 task_id**。
2b. **task 静默化**(§8.1-E 在弱模型上重过):GLM 更容易被"帮我分析"类话术带出子代理,重点验证非 chip 普通 turn 模型不发起 task、侧栏无幽灵对话。
3. **extract_document 全格式**:docx/xlsx/pdf/pptx/txt/md 各过一个(上传路 + 贴路径路),测量头首行齐全;GLM 对「office 禁走 read」「贴路径也可用 extract」的措辞遵从度重点观察(强模型遵从不代表弱模型遵从,提示词条款以内网实测为准)。
4. **017 chip 全链路回归**:选功能 → 直接调用 → task_id → 转述 → 「好了吗」查询仪式 → 文件卡片;白名单收敛不应影响任何一环。
5. **webfetch/websearch 可用性**:代理链路下让模型抓一个内网可达 URL,确认保留决定在真机成立(TLS 掐断域名属已知遗留,见 §1)。
