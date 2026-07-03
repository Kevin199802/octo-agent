# SPEC-INS-017 — MCP 显式入口(输入框 chip 触发,MCP 工具退出模型工具集)

> 状态:草案(2026-07-03)· 优先级 P1 · 规模 [M] · 领域 infra/ui/insight
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

**chip 交互**:chip 点开小菜单选功能(见 §3 功能清单)→ 选中后 chip 高亮显示所选功能 → 本条消息发送时走 §2 触发链路 → 发送后 chip 复位(单 turn 语义,与预置提示词一致)。可再次点击取消选择。

## 2. 触发链路(设计点 ②,业界对比)

先记清**现状的模型接触面**(常被误记为「传参不经过模型」):模型负责 (a) 选工具、(b) 在 args 里写**文件名**;插件([octo-upload-inject](../../../UXAI/packages/opencode/src/agent/octo-upload-inject.ts))在 `tool.execute.before` 把文件名换成 S3 URL。**URL 确实全程不经模型**(ADR-014 演进后),但 (a)(b) 都是模型行为 —— 插件甚至专门为「弱模型照抄完整路径」做了「文件名 / 完整路径 / 磁盘 basename」三键精确匹配容错(2026-07-03 fix;曾附加去空白归一化、同日复审回退——启发式修补有静默误配风险且追不完模型变异,确定性钉死走 §2.1)。

| 方案 | 机制 | 确定性 | 结论 |
|---|---|---|---|
| **A. 单 turn 预置提示词** | chip 选择 → 客户端把**功能指令 + 所选文件名**填进模板,作为单 turn 指令注入 → 模型照抄发工具调用 → 插件换 URL | 工具选择:模板唯一指定;文件名:客户端注入、模型照抄(残余抄错风险由 §2.1 强制覆盖钉死;插件三键精确匹配 + 失败回灌兜底) | **✓ v1**:复用预置提示词机制与异步任务卡片渲染链路,零新增管线 |
| B. API 级 `tool_choice` 强制 | OpenAI-compat forced function:请求级钉死工具选择 | 工具选择 100%;args 仍模型生成 | 作为 A 的加固项,**待验证内网网关是否支持**;支持则叠加 |
| C. 客户端直调(模型出环) | 客户端直接构造 MCP 调用,合成工具调用 part 入会话 | 100% | ✗ v1 不做:文件卡片渲染依赖当前 turn 的 tool-call part([learning](../../learning/file-card-depends-on-current-turn-tool-call.md)),合成 part 或另起渲染路径改动深。**Phase 2**:若 v1 埋点显示 args 改写错误率不可忽略,再立项 |

### 2.1 加固项:chip 声明 + 插件强制对齐文件参数(2026-07-03 增补,随本 spec 实现)

方案 A 的残余风险是「文件名仍要经模型照抄进 args」。把这一段也工程化钉死:

- **chip 注入模板附带机器可读声明段**(独立 synthetic text part,用户不可见,与 `[附件]` 清单同类机制):声明本 turn 的**目标工具**与**文件参数映射**(如 `outline_file_path: <文件名>` / `download_links: [<文件名>…]`),由客户端按用户 chip 选择生成。
- **octo-upload-inject 插件在 `tool.execute.before` 读取本 turn 的 chip 声明**:若 `input.tool` 与声明匹配,文件参数**以声明为准强制覆盖**(模型抄错 / 加空格 / 漏文件一律矫正),之后照旧走按需上传、把文件名换成 URL。
- **与 ADR-014 handle 机制的本质区别**(handle 曾因「不想让用户看到」被 SPEC-INS-015 撤掉):handle 要**经模型复述**、且可能漏进用户可见对话;chip 声明是 synthetic part,模型只携带不复述,用户不可见,插件直接读。
- **效果**:chip turn 的文件参数确定性与方案 C(客户端直调)等同,模型职责收缩到「发起那次调用」一项(后续可再叠方案 B 的 `tool_choice` 钉死它);§2 表中 A 的「残余抄错风险」对 chip turn 归零。非 chip turn 无声明,插件行为不变(按 §3,非 chip turn 本不应出现 MCP 调用)。

**残余风险的度量**:`[octo:inject]` 已打 `changed / before / after` 日志(模型抄错文件名 → 精确 miss → `changed:false` 或部分未替换,可直接分类统计)。§2.1 加固上线后,再加「强制覆盖矫正命中」计数——模型原本抄错、被声明矫正的次数,作为「发起调用」环节可靠性与 Phase 2 的立项依据。(2026-07-03 曾用去空白归一化 + `fuzzyRefs` 做兜底与度量,同日复审回退:归一化有静默误配风险——换错文件比失败更糟,且"模型改写引用"是无界类,启发式追不完;钉死只能靠本节 §2.1。)

## 3. MCP 工具退出模型工具集(设计点 ③)

摘除清单(octo_insight.md frontmatter `tools` 白名单):`key_findings` / `run_guide_analysis` / `run_usability_analysis` / `mindmap` / **`search_reports`(尚未对接,一并摘除)**。摘除后 insight 模型常驻工具 = `task` + `extract_document`(SPEC-INS-018 再补 read/grep/write)。

「摘除后 chip turn 怎么还能调」的机制选型:

| 方案 | 机制 | 结论 |
|---|---|---|
| **A. turn 级动态 gate** | 工具白名单保留 MCP 工具,但组请求时按「本 turn 是否 chip 注入」动态决定是否下发给模型(实现落点待调研:registry gate / plugin 钩子 / 预置提示词元数据) | **✓ 目标态**:非 chip turn 模型根本看不到 MCP 工具,误触发为 0 |
| B. 提示词层禁用 | 白名单保留,常驻提示词删除 MCP 引导、chip 模板内授权 | 兜底:若 A 的实现落点调研受阻,先上 B(误触发风险降但非 0,靠埋点观察) |

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

- octo_insight.md:frontmatter 摘工具 + 常驻提示词删 MCP 段落 + 加一句 chip 引导
- chip 注入模板:功能指令 + 文件名(客户端填)+ 迁入的 MCP 仪式段落 + **机器可读声明段**(§2.1)
- octo-upload-inject:解析 chip 声明、按声明强制对齐文件参数(§2.1;既有按需上传机制不变)
- PromptInput(insight 自实现):chip UI + 菜单 + 单 turn 复位
- extract_document 失败文案改指向 chip
- 埋点接入(§5;打点基建见 [tracking.md](tracking.md))
- ROADMAP 状态更新;`[octo:*]` 日志字典([insight-debugging.md](../../insight-debugging.md))若新增前缀需同步
