# SPEC-INS-032 — Insight 子代理分治(多文档通读)+ 工具面声明化

> 状态:**v1 已实现并合入**(UXAI #683,2026-08-20);**v2 增补(2026-08-21)** —— §2.3 入口覆盖面、§4.3 读取契约;
> **v3(2026-08-27,UXAI 分支 `feat/insight-dispatch-office-and-guards`)** —— 内网实测回补:§2.6 office 分治判据、
> §2.4 单份上界改确定性切段、§5.3 子代理会话 id 守卫、§5.4 串行闸。单测 + 双包 typecheck 通过,**待内网人工验证**。
> 优先级 P1 · 规模 [M] · 领域 infra/insight/agent
>
> **上游已实现:✓/✗ 混合**
>
> - ✓ `task` 工具与子会话机制:[tool/task.ts](../../../packages/opencode/src/tool/task.ts) 建 `parentID` 子 session、跑完把末段文本包 `<task_result>` 回传,父子关系与数据完整
> - ✓ 声明式工具面:agent 的 `permission` 就是上游的既定机制(`tools:` 字段已被上游废弃并翻译成 permission,见 §3.2)
> - ✓ subagent 候选清单:`describeTask` 按 `Permission.evaluate("task", <agent 名>, …)` 过滤,pattern 级白/黑名单是现成能力
> - ✗ `insight_reader` 子代理定义(Octo 自写)
> - ✗ 会话树工作区归属(现状按「本会话 agent 名」判,需改成「根会话」)
> - ✗ task 的 turn 级放行(insight 前端 `buildToolGate` 现在恒关)
> - ✓ 文本附件的渐进式披露:上游把 `text/plain` 附件表达成**一次受限的 `read`**(2000 行 / 50KB 截断),粒度粗但机制在(§2.3)
> - ✗ 按总体量决定内联还是转分治(v2:`INLINE_BUDGET` / `SINGLE_DOC_LIMIT`,Octo 自写)
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

**v2 补的是入口覆盖面**(2026-08-21):v1 默认「多文档 = 走 `extract_document` 的二进制类」,于是只覆盖了 docx / pdf 那条路。md / txt 是原生可读格式,走的是完全不同的一条链路(附件 → 合成 `read`),它同样撞窗口、而且还多一个静默截断的正确性问题——10 份两三万字的 md,第一轮就超限。见 §2.3。

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

### 2.3 入口覆盖面:md / txt 也要能进这条路径(v2 增补,2026-08-21)

v1 只解决了 `extract_document` 那条路,也就是**二进制类**(docx / pdf / xlsx / pptx)。md / txt 走的是完全不同的一条路,而它**同样撞窗口**——v1 漏了这半边。

事实链(核对过代码,别再凭「附件就是全文进上下文」的印象推):

1. insight 前端把可内联文本文件发成 `file://` + `text/plain` 的 FilePart([build-prompt-parts.ts:53](../../../packages/app/octoapp/pages/insight/utils/build-prompt-parts.ts#L53))
2. 服务端 [prompt.ts:1129](../../../packages/opencode/src/session/prompt.ts#L1129) 把这种 part 翻译成**一次合成的 `read` 调用**——注入的文本字面就是 `Called the Read tool with the following input: {…}`,后面跟 read 的 output
3. `read` 有硬上限:[read.ts:15-18](../../../packages/opencode/src/tool/read.ts#L15-L18) 2000 行 / **50KB**,超了截断并追加 `(Output capped at 50 KB. Showing lines X-Y. Use offset=N to continue.)`

由此,现状有两个问题,而**容量问题反而是次要的那个**:

| | 现象 | 性质 |
|---|---|---|
| A | 单份两三万字中文(UTF-8 3 字节/字 ≈ 60–90KB)**已经被静默截到前 ~1.7 万字**,模型拿到残缺正文 + 一句 offset 提示,弱模型多半不会续读 | **正确性**:不报错、不可见,基于半份材料作答 |
| B | 10 份 × 50KB(截断后) ≈ 12–17 万 token,内网 ~10 万窗口第一轮就爆 | 容量:会报错,至少是响亮的 |

**A 比 B 危险**:B 撞窗口会报错,A 不会。截断并没有救 B,只是让爆之前先丢了数据。

#### 2.3.1 业界做法对比

| | 做法 | 代表 | 结论 |
|---|---|---|---|
| A | 永远全文内联 | —— | ✗ 事实上不存在这种产品。**上游 opencode 自己就不是这样**——附件被表达成一次受限的 read,截断即粗粒度的渐进式披露(一份 50KB) |
| B | 永远按需,模型自己决定读不读 | Claude Code / Codex 对本地文件;`@file` 同样只是触发一次有上限的 Read | ✗ 单独用不行:一份随手贴的小材料若不内联,弱模型可能压根不调 read 就作答。这是把「要不要读全」的确定性交给模型 |
| C | **按体量分层**:小的内联,超阈值切机制 | claude.ai / ChatGPT 的文件上传 | ✓ **选定**——业界主流就是分层,不是一刀切 |
| D | 超阈值转向量检索(RAG) | ChatGPT `file_search`、claude.ai Projects 知识库 | ✗ **本场景不选**:检索适合「从材料里找某句话」,而本 spec 要解的是「通读全部材料产出报告」——检索会漏,漏了还不自知 |

D 那条顺带印证了 §2 的选型:**分治不是因为模型弱才做的降级方案**,map-reduce 就是通读型任务的业界正解。

> **别把 D 读成「insight 永不用检索」**(2026-08-21 评审修正):否掉的是「拿检索**替代**通读」,不是检索本身。按任务分路才是完整图景 ——
>
> | 用户任务 | 路径 |
> |---|---|
> | 小材料直接提问 | 预算内全文内联(§2.3.2) |
> | 在材料里找事实 / 回答局部问题 | `grep` 定位(现状已够);材料规模再上一个量级才谈向量检索 |
> | 通读全部材料、逐份总结、全量比较 | 子代理分治(本 spec) |
> | 核验报告里的原话 | 按 §4.3 #2 的锚点回读 `extracted/` |
>
> 第二行现在用 `grep` 就能覆盖,**上向量库是另一个量级的工程,本 spec 不立项**;真要做时它是「新增一条路径」,不是「替换分治」。

#### 2.3.2 定案:发送前按总字节分层

**判定在发送前由前端确定性完成,不交给模型判断。**

在 [build-prompt-parts.ts](../../../packages/app/octoapp/pages/insight/utils/build-prompt-parts.ts) 统计本轮可内联文本文件的总字节:

- `总字节 ≤ INLINE_BUDGET` → 维持现状全部内联,**行为零变化**
- `总字节 > INLINE_BUDGET` → **整批不内联**,`[附件]` 清单照旧给绝对路径,另附一段体量说明,由父代理按 §2 逐份派 `insight_reader`

体量说明是一个**独立 synthetic 块** `[材料体量]`(`formatDispatchNote`),排在 syntheticTexts 末尾,两条落地理由:

> ① **`[附件]` 的行格式 `- <名>: <路径>` 不许动**——它有三个消费方:`parseUploadedFiles`(InsightTurn 渲染文件卡片)、服务端 `octo-upload-inject` 插件的 `parseManifest`(MCP 按需上传)、`[引用文件]` 块复用同一解析。
> ② 起初想把说明附在 `[附件]` 块尾,**落地时否掉**:内联判定覆盖 `[附件]` 与 `[引用文件]` 两条来源(023 §7.2 起两者一致),而 `formatUploadsForPrompt` 在无附件时返回空串——只 `@` 引用大文件的那轮说明就丢了。独立块两条来源都覆盖。
>
> 排末尾是因为文案说的是「本轮共 N 份材料(含 [附件] 与 [引用文件])」,两个清单都出现过之后再给总述才对得上;`[附件]` 仍是第一块,位置契约不变。正常发送与 drain **两条路径顺序一致**(防两套漂移)。

三条口径(2026-08-21 拍板):

| 问题 | 定 | 理由 |
|---|---|---|
| 阈值口径 | **字节**(UTF-8),不是字数 | 与 `read` 的 50KB 同口径,不必猜 tokenizer 的中文比率 |
| 超预算时 | **整批**转分治,不做「大的分治 + 小的仍内联」 | 混合模式下父代理要同时维护「哪几份我已经看过、哪几份还要派活」,弱模型容易漏派或重复派 |
| 单份就超 | **也走分治**,不让父代理自己 offset 续读 | 逻辑统一;且续读发生在子代理的干净窗口里,父上下文不被正文污染 |

`INLINE_BUDGET` 取 **32KB**(≈ 1 万汉字)。取值依据是**用途**而不是「尽量多塞」:内联的全部价值是「一份随手贴的小材料,一轮直接答」;超过 1 万汉字的东西已经是研究材料,本来就该走通读流程。

这一改之后,**md/txt 与 office 的差异被抹平**:两边都是「父代理只见路径、子代理在自己窗口里读完回结论」,§2 的机制一行不用改。子代理侧 md/txt **同样先走 `extract_document`**(021 起支持文本类直读):不是绕远路——`read` 会砍掉超过 2000 字符的单行且没有续读手段,而 `extract_document` 的 `wrapLongLines` 先把长行折好再落盘,顺带产出可 grep、可引用的解析件。详见 §13.1-1。

### 2.4 单份体量的上界:分治不扩容

**分治不让单份变大。** 子代理与父代理跑的是同一个模型、同一个窗口——它省下的是「父代理不必把正文吃进去」,不是「正文可以更大」。这条边界 v1 没写,补上:

| | 量级(内网 ~10 万 token 窗口) |
|---|---|
| `read` 单次上限 | 50KB ≈ 1.7 万汉字 |
| 子代理扣掉系统提示 / 工具定义 / 任务描述后,留给正文 | 保守 ~5 万汉字 ≈ **150KB**(= 3 次 read) |
| 典型场景:单份两三万字(60–90KB) | 2 次 read,**在能力内** ✓ |
| 单份 > 150KB | 子代理自己也爆,**分治救不了** |

> **v3 改版(2026-08-27):`SINGLE_DOC_LIMIT` 从「拒绝阈值」改成「切段阈值」。**
>
> v2 的 P0 是「前端拦下 + 告知用户拆分后重传」。评审否掉(用户原话:「用户都传文件上来了,你让他拆什么?
> 而且 150K 在文档里也太常见」)——**这是把工程问题甩给用户**,而这件事本地完全兜得住:
> `extract_document` 精确知道字数、落盘正文又是折行的(≤500 字符/行),**按行切段是纯算术**。
> 同时确认:导到 MCP 也不是等价兜底 —— MCP 那几个业务工具做的是特定分析(观点解析 / 按提纲聚类 /
> 可用性问题 / 思维导图),不是「通读多份材料写汇总报告」,导过去是**换了交付物**而不是换了实现路径。
> (016 §5「解析失败 / 扫描件无文本 → 建议走 MCP」仍然成立,那是本地**解析不了**;「文档太大」我们解析得了。)

**P0 处理:确定性切段,本地兜住,不拦截、不让用户拆文件。**

| 谁 | 干什么 |
|---|---|
| `extract_document` | 抽取后正文字节 > 单次通读量时,在返回里附一份**切段清单**:`第 N/M 段:read offset=… limit=…`。段落边界由工具按行算(`planSegments`),`metadata.segments` 记段数 |
| `insight_reader` | 任务里**指派了段落** → 只读那段、只就那段作结论;**没指派** → 把清单原样回传给发起方,不许只读开头就下结论 |
| `octo_insight` | 收到清单 → 按段派活(每段一个 task,prompt 里写清 offset/limit)→ 收齐同一份的各段结论 → 先合成这份材料的小结 → 再进总报告 |

⚠️ **落盘件前两行不是正文**(`persist()` 写的是 `<!-- source… -->` + 空行 + 正文),段落 offset 必须
加上这个偏移(`PERSIST_HEADER_LINES = 2`)。差这 2 行的后果是每段都往前偏、**最后一段读不到结尾**
——静默丢尾巴,正是本节要消灭的那类 bug。已有单测锁死「各段 offset/limit 连续、无缝、收在最后一行正文上」。

三个被否掉的替代:

- **照读前 150KB** ✗ —— 那正是 §2.3 表里 A 那个要消除的静默半读,换了个地方重新引入。
- **读完但如实声明覆盖范围** ✗ —— 把诚实性交回给模型自觉,与本 spec「确定性在代码侧」的取向冲突。
- **拦下并让用户拆分文件** ✗(v2 曾采用)—— 见上方改版说明。前端 toast 与 `[材料体量]` 里那段
  「请用户拆分后重新上传」均已删除,并有回归用例锁住(文案里不许再出现「拆分 / 重新上传」)。

**为什么工具可以「越过读取、指导编排」**:段落边界是算术,交给模型估必然出错;而不给清单的话,
它只剩两条路——半读硬答(静默丢数据)或把问题甩回用户。这是本工具唯一一处输出编排指令,理由记在此。

**每段多大**:`SEGMENT_BYTES = 100KB`,不贴着上界取。子代理读完还要产出结论,要留余量;
且 `read` 单次上限 50KB,一段 = 2 次 read,段数不会被切得太碎(段越多,父代理二次汇总的损失越大)。

⚠️ **同一个数在两处**:前端 `SINGLE_DOC_LIMIT`(按**源文件**字节预判,决定 `[材料体量]` 文案怎么写)
与服务端 `SINGLE_READTHROUGH_BYTES`(按**抽取后**的真实字节判,决定切不切段)是同一个量的两次表达。
跨包无法共享常量,改一处必须同步另一处。

### 2.6 分治判定规则总表(as-built,查这一节就够)

> 2026-08-27 增补。内网实测暴露的 gap:v2 只把 **md / txt** 那条路做成了确定性的,而 **office / pdf**
> ——恰恰是 v1 的本行——分治与否至今仍是模型自由判断。实测现象:9 份 docx 一份都没进内联预算,
> 于是永远不产 `[材料体量]`,模型顺着「`[材料体量]` 出现与否是唯一判断依据」那句推出「不用派」,
> 改为自己连抽 9 份,正文全灌进父上下文。这违背 §2.3.1 否掉方向 B 的立场,故补齐。

#### 2.6.1 一句话原则

> **能精确量的用量,不能量的用数。**

文本类的字节就是进上下文的量(`Attachment.size` 拿得到、内联即全文);office / pdf 是压缩容器,
发送前只有二进制大小,反推正文量要引入一个不准的估算——那还不如不估。

#### 2.6.2 判定表

判定在**发送前由前端确定性完成**([`decideInlineStrategy`](../../../packages/app/octoapp/pages/insight/utils/build-prompt-parts.ts)),不交给模型。

| 材料 | 谁参与 | 判据 | 命中记为 |
|---|---|---|---|
| **文本类**(md / txt / csv / json / html / log / 无扩展名…) | `isTextInlineFile`(反向排除 office / pdf / 图片) | 本轮**总字节** > `INLINE_BUDGET`(32KB) | `text-budget` |
| **文档类**(docx / xlsx / pptx / doc / xls / ppt / pdf) | `isExtractableDocFile` | **份数** ≥ `DOC_COUNT_THRESHOLD`(3) | `doc-count` |
| 同上 | 同上 | **单份二进制** > `DOC_SINGLE_BYTES`(2MB) | `doc-size` |
| **图片** | —— | 走 vision,两个口径都不参与 | —— |

- 三条**取或**:命中任一条 → `mode: "dispatch"`,**整批**不内联(文本 + 文档一起交给子代理)。
  「整批」与 §2.3.2 同口径:不做「大的分治 + 小的仍内联」,否则父代理要记「哪几份我看过、哪几份还要派活」。
- 去重按 path:同一份既是本轮附件又被 `@` 引用,只算一次。
- 字节拿不到时(如 `@` 引用读不到文件)按 0 计并记 `unknownCount` —— 读不到的文件本来也内联不进上下文,
  不该因为它把整批拖进分治。
- `reasons` 字段记录命中了哪几条,进 `[octo:attach]` 日志 —— 排查「这轮为什么分治 / 为什么没分治」看它。

#### 2.6.3 两个阈值的依据

**`DOC_COUNT_THRESHOLD = 3`** —— 份数不是"体量的降级代理",它和 `INLINE_BUDGET` 是**同一种判断**:
后者的立论本来就不是「父代理还能塞多少」而是**用途**(见其注释:超过 1 万汉字的东西已经是研究材料,
本来就该走通读流程,哪怕窗口变大也一样)。同理,用户一次给 ≥3 份文档,他嘴里说的就是「这批材料」。
取 3 的边界感:1 份 = 单篇分析,2 份 = 两篇对比,父代理自己读都在能力内且更快;3 份起才值回子代理的往返成本。

**`DOC_SINGLE_BYTES = 2MB`** —— **单向**门槛:大 ⇒ 一定分治;小 ⇏ 不用分治(份数那条仍可能命中)。
所以它不需要准。2MB 的 docx 若是纯文本,解压后是数百万字;若整份是嵌图,正文可能很少——**后者会被
误判成要分治,而这个代价可以接受**,依据是两类误判的不对称:

| 误判 | 代价 |
|---|---|
| 该内联的判成要分治 | 慢一点、多花点 token,**结果照样对** |
| 该分治的判成不用分治 | 父上下文爆 → 静默丢材料 → 报告基于半份材料,**且不报错** |

正因如此,**不为「大文件但实际全是截图」做例外**:做例外就要引入压缩比估算,拿一个不准的数去换一个
代价本来就小的误判,不划算。

#### 2.6.4 这一改顺带修好的事

office 现在也会产 `[材料体量]`,于是提示词里「**看到 `[材料体量]` 就必须派子代理**」那条对两类材料**一致成立**
——不需要为 office 另写一条规则,也消除了原先那句「`[材料体量]` 出现与否是唯一的判断依据」对 office 的反向误导。

---

### 2.5 阈值定在哪、怎么算、换模型后怎么刷新

**三个数字都不是魔法值,写成带推导的常量,换模型只改一个输入。**

#### 2.5.1 位置

| 常量 | 定义处 | 值 | 归谁 |
|---|---|---|---|
| `MODEL_CTX_TOKENS` | [build-prompt-parts.ts](../../../packages/app/octoapp/pages/insight/utils/build-prompt-parts.ts) 顶部 | 100_000 | **唯一需要手改的输入**(内网当前模型窗口) |
| `INLINE_BUDGET` | 同上,由用途定 | 32 * 1024(32KB) | Octo |
| `SINGLE_DOC_LIMIT` | 同上,由 `MODEL_CTX_TOKENS` 推导 | 150 * 1024(150KB) | Octo |
| `DEFAULT_READ_LIMIT` / `MAX_BYTES` | [read.ts:15-18](../../../packages/opencode/src/tool/read.ts#L15-L18) 2000 行 / 50KB | 上游 | **不改**——改它影响 chat / make / studio 所有 agent,不是 insight 能单方面动的 |

常量与推导注释**集中在 `build-prompt-parts.ts` 一处**,不散到调用方(`index.tsx` / `queue-drain.ts` 只调 `assembleInsightParts`)。

#### 2.5.2 换算口径(中文,保守取值)

| 量 | 取值 | 说明 |
|---|---|---|
| 中文字符 → 字节 | **3 字节/字**(UTF-8) | 确定值 |
| 中文字符 → token | **1 token/字**(保守) | 实测常见区间 0.6–1.5,取 1 是往「更容易超」的方向保守 |
| 合成 | **1KB ≈ 341 token**,50KB ≈ 1.7 万 token | 由上两行推出 |

#### 2.5.3 两个阈值的推导(性质不同,别一起调)

**`SINGLE_DOC_LIMIT` —— 跟模型窗口线性缩放。**

```
子代理正文预算 = (MODEL_CTX_TOKENS - 固定开销 - 产出预留) × 安全系数
               = (100_000 - 5_000 - 10_000) × 0.6 ≈ 51_000 token
               ≈ 51_000 汉字 ≈ 153KB   → 取整 150KB(恰好 3 次 read)
```

- 固定开销 5_000:`insight_reader` 系统提示 + 工具定义 + 任务描述
- 产出预留 10_000:结论输出 + §4.3 #3「边读边记」的中间要点
- 安全系数 0.6:**不用满窗口**——长上下文尾部召回质量下降,且父代理派活时无法精确预知正文体量

**`INLINE_BUDGET` —— 由用途定,不跟窗口线性缩放。**

它不是「父代理还能塞多少」,而是「**多小算随手贴的片段**」:内联的全部价值是「一份小材料,一轮直接答,省掉一整轮子代理往返」。1 万汉字(32KB)以上的东西已经是研究材料,本来就该走通读流程,**哪怕窗口变大也一样**。

它只有一条来自窗口的**上界约束**(要满足,不是要取满):

```
INLINE_BUDGET ≤ MODEL_CTX_TOKENS × 0.15
32KB ≈ 11_000 token ≤ 100_000 × 0.15 = 15_000  ✓
```

#### 2.5.4 模型换代后的刷新步骤

1. 改 `MODEL_CTX_TOKENS` 为新窗口。
2. 按 §2.5.3 第一条公式重算 `SINGLE_DOC_LIMIT`,**向下取到 50KB 的整数倍**(对齐 read 分页,让「几次 read 读完」是整数)。
3. `INLINE_BUDGET` **默认不动**;只在校验 §2.5.3 那条上界不再满足时才调小。若产品上希望「更大的材料也能一轮直答」,那是**体验决策**,要显式讨论,不是跟着窗口自动放大。
4. 重跑 §10.1 的边界用例(它们断言的是「相对预算」的行为,不写死字节数,故改常量不需改用例)与 §10.2-8 的埋点实测(新窗口下单份多段的召回率会变)。

> 若换代后窗口大到 `SINGLE_DOC_LIMIT` 超过绝大多数真实材料(比如 100 万 token 窗口 → 单份上界 ~1.5MB),§2.4 的响亮失败与 §11 的份内切段就自然失效,可整条摘掉;但 `INLINE_BUDGET` 与分治本身**不该跟着摘** —— 分治的价值是上下文隔离与注意力,不是窗口不够(§1)。

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

### 4.3 读取契约:让「读完」和「读准」有硬判据(v2 增补,2026-08-21)

先说清楚**分治不做什么**:它不提升准确性,只把「本来读不到」变成「读得到」。读得到之后,准确性的天花板仍是模型本身。

但有三个具体失真源,前两个可以确定性收紧。[insight_reader.txt](../../../packages/opencode/src/agent/prompt/insight_reader.txt) 与 `octo_insight` 派活的提示词按此修订:

| # | 失真源 | 现状 | 收紧 |
|---|---|---|---|
| 1 | **「读完」没有硬判据** | 提示词写「读到提示还有剩余就继续」——靠模型自觉的启发式,正是要避免的那类 | 派活时把**总行数**写进任务描述:「这份文档共 5230 行,你必须读到第 5230 行」。模型能拿最后一次 read 返回的行号自查,比「读到 End of file」硬。总行数**不需要前端算**:读落盘件时 `read` 第一次返回就带 `(Showing lines 1-2000 of 5230. …)`,`of N` 就是总行数——子代理拿它当终点自查即可。提示词要写明这一点(否则模型会以为要靠猜)。office 类同理由 `extract_document` 返回带出 |
| 2 | **结论回传有损,且不可逆** | 已要求「保留出处 + 引语原文」 | 再拧一档:每条结论带**可 grep 回原文的锚点**(说话人 + 原话片段)。这样报告里的引用是真的,用户追问细节时父代理能 grep 回根会话 `extracted/` 定位(§6 把落盘归到根会话,正是为此),不必盲目重派子代理 |
| 3 | 多段 read 之间的**注意力衰减** | 无 | **边读边记**:每读完一段先落一小段要点再读下一段,不要全读完再回头总结。这是长上下文的固有问题、非分治引入,只能缓解不能消除 |

**不可消除的代价要在提示词里写明**:父代理拿不到原文,手上只有结论。用户追问「第三份里那人原话怎么说的」时,父代理要么用 #2 的锚点 grep 回落盘件,要么重派子代理去读——**不能凭结论编**。这条进 `octo_insight` 提示词。

#### 4.3.1 代价:锚点让结论变大,§2.1 的 token 账要上调

#2 的原话锚点不是免费的——结论从「纯要点」变成「要点 + 引语」,每份从 ~800 token 涨到 ~1500。§2.1 那张对比表是按旧口径算的,按新口径重算父上下文:

| 份数 × 3 万字 | 父上下文(派发 + 结论 + 系统提示 + 报告输出) | 结论 |
|---|---|---|
| 10 份 | ~2.5 万 token | 安全 ✓(这是当前主场景) |
| 20 份 | ~4 万 token | 仍安全 ✓ |
| 30 份以上 | ~6 万 + 报告输出 | **开始紧张**,需二级汇总(分批汇总再汇总) |

**份数安全线约 20–25 份**,超了要分批。这条与 §2.4 的单份上界是两个独立维度:§2.4 管「一份多大」,这里管「多少份」。二级汇总同样列 §11 后续,触发条件写清:实测中父代理在 25 份以上出现漏派 / 报告丢材料时再立项。

另一个必须写明的残余风险:**父上下文是跨轮累积的**。第一轮 2.5 万 token 安全,但结论留在上下文里,用户追问 → 再派子代理 → 再收结论,第 4–5 轮可能到 6–8 万。P0 依赖上游既有的 summarize / compact 兜底,不自建;内网实测(§10.3)要专门跑一轮**多轮追问**看它撑到第几轮。

> 这三条收紧之后,剩下的准确性风险就是模型本身的,推理没法再往下确认,只能实测(§10.2 埋点验证)。

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

### 5.3 别把子代理会话 id 当成 MCP 任务号(2026-08-27 增补)

**两套「异步结果」共用了 `task_id` 这个参数名**,分治一放开,普通轮次就同时存在这两种:

| | 来源 | 形态 | 语义 |
|---|---|---|---|
| 子代理 | [task.ts:167](../../../packages/opencode/src/tool/task.ts#L167) 返回文本里字面写着 `task_id: ses_xxx (for resuming…)` | `ses_` 开头(会话 id,[id.ts:6](../../../packages/opencode/src/id/id.ts#L6)) | **同步**,结论已在 `<task_result>` 里 |
| 内网 MCP | `key_findings` 等业务工具返回 | 内网哈希编码 | **异步**,要轮询 |

**内网实测(2026-08-27)的完整因果链**——它比「模型乱调工具」要具体得多:

```
模型并发派了 3 个 insight_reader → 撞模型网关的分钟级限流 → 整轮中断
→ 用户点「继续」→ 子任务结果已丢,父代理手上只剩 3 个 ses_ id
→ 拿去 get_task_result → not_found → 判定「子代理任务失败」→ 放弃分治,退回自己逐份读
```

**模型的直觉是对的**(「我有 id,该把结果取回来」),它只是选错了工具:正确的恢复路径本来就存在——
`task` 工具的 `task_id` 参数就是「续用同一个子会话接着跑」([task.ts:25-27](../../../packages/opencode/src/tool/task.ts#L25-L27))。

三层原因叠加,这个误用几乎是必然的:

1. `get_task_result` / `stop_task` **常驻可见**(SPEC-INS-021 §1),不管本会话有没有提交过 MCP 长任务
2. mcp-contract 的「**绝不在 LLM 内部自动轮询**」标着「写入 agent prompt」,但它**只在 chip 模板里**
   (`buildChipTemplate`),普通轮次模型看不到 —— 严格讲这条规则从没进过它的上下文
3. 插件对 `get_task_result` 的入参**零校验**

**定案(按确定性优先排):**

| # | 手段 | 状态 |
|---|---|---|
| 1 | **工具边界确定性拦截**:`get_task_result` / `stop_task` 的 `task_id` 命中 `ses_` 前缀 → 抛错。判据是 session id 的固定前缀,精确匹配非模糊判断。落在 [octo-upload-inject.ts](../../../packages/opencode/src/agent/octo-upload-inject.ts) 已有的 `tool.execute.before`(它本就在按 `uxr-tool_` 前缀分流、并以抛错回灌模型),不新建机制 | ✅ 已实现 |
| 2 | **常驻提示词补契约**:task 是同步的、`<task_result>` 即结果、`ses_` 开头的绝不传给 MCP 工具;被中断用 `task(task_id=…)` 续跑 | ✅ 已实现 |
| 3 | **有状态 gate**:本会话没有任何业务长任务返回过 task_id 时,压根不把 `get_task_result`/`stop_task` 暴露给模型(前端 `task-detect.ts` 已能从历史 parts 读出真实 task_id,`buildToolGate` 加个 `hasMcpTask` 参数即可) | 后续(§11) |

**错误文案必须指回活路**,不能只说「你错了」:文案里明确给出「接着跑用 `task` 并把 `task_id` 设为这个
`ses_` 开头的 id」。否则模型只会换个姿势继续乱试 —— 这一条有单测锁住。

### 5.4 子代理串行闸(2026-08-27 增补)

分治要求「一份回来了再派下一份」,但此前**只有提示词在劝**,三层都没有闸:

| 层 | 现状 |
|---|---|
| [llm.ts:97](../../../packages/opencode/src/session/llm.ts#L97) | 工具调用 `concurrency: "unbounded"` —— 一条 assistant 消息里的多个 task 全部并发跑 |
| [task.ts](../../../packages/opencode/src/tool/task.ts) | 工具本体没有任何 in-flight 检查 |
| [task.txt:16](../../../packages/opencode/src/tool/task.txt#L16) | 上游工具描述原文:**「Launch multiple agents concurrently whenever possible」** |
| octo_insight 提示词 | 「一份一个,串行派」 |

提示词和工具描述**直接打架**,弱模型听离它更近的那个 —— 实测就是一次并发派 3 个。

**决定性的理由不是限流本身,是容量分配**:内网模型**全量用户的并发只有几十个**,一个用户开 3–5 路子代理
就吃掉全站可观的比例。这不是「偶发限流」,是多用户公平性问题。限流本身归网关,**撞不撞得上归编排**。

**实现:排队,不是拒绝**([octo-task-serialize.ts](../../../packages/opencode/src/agent/octo-task-serialize.ts))

- 拒绝 → 对话里挂失败卡片,并把「要不要重派」交回模型(实测它的选择是**放弃分治**)
- **排队** → 并发调用被透明地串成串行,没有失败卡片、不依赖模型自觉。父代理本来就在等工具返回,排队不额外占模型并发

两条自愈约束(`tool.execute.after` 在工具**抛错时不触发**,所以不能只靠它解锁):

- `MAX_HOLD_MS`(10 min):单次持锁超时自动释放,防止一次异常把后续全堵死
- `MAX_WAIT_MS`(10 min):排队者到点即放行 —— 宁可退化成并发,也不要把一轮永久卡住

**只作用于 insight 会话**(按调用方 session 的 agent 判):chat / make / studio 的 task 用法不在本 spec 范围,不改它们的行为。

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

> **契约 3 的补充(2026-08-24,对外文档落地时实测)**:「不需要报备、不需要我们发版」对**工具可见性**成立(自己的 agent md 里 `tools:` 声明即可);但**能不能被 `octo_insight` 派出去**由 `octo_insight` 侧的 `task: { "*": "deny", insight_reader: "allow" }` 决定,第三方在自己的 agent md 里翻不开 —— 要在**用户配置** `~/.config/octo/octo.json` 里覆盖:`agent.octo_insight.permission.task.<名>: "allow"`(agent 级配置 append 在内置规则之后,`findLast` 命中)。实测确认:insight 能派该 agent、仍不能派 `general`、其他 agent 的 task 不受影响;配 一条全局 `permission.task.<名>: "deny"` 可防外溢到 chat/make。**仍不需要我们发版**,但这是**部署侧动作**(用户文件,产品不写),需与部署方对齐由谁写。另两条实测副作用:① 同名 `agent/octo_insight.md` 会用正文顶掉内置提示词(`item.prompt = value.prompt ?? item.prompt`),改候选只能走 JSON;② 自带 agent 默认继承 defaults `"*": "allow"`,**是全权限**,`tools: { x: true }` 只是加项不是收敛。详见 [task-tool-for-skills.md §1.1](../agents/task-tool-for-skills.md)。

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
| `[octo:attach] 内联预算超限,转子代理分治` | 本轮文本附件总字节 > `INLINE_BUDGET`(§2.3.2) | count / totalBytes / budget |
| `[octo:attach] 单份超出通读容量,已拦下` | 某份 > `SINGLE_DOC_LIMIT`(§2.4),发送前拦截 | filename / bytes / limit |

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
- `packages/app/octoapp/pages/insight/utils/build-prompt-parts.test.ts` 增(§2.3.2 / §2.4 的分层判定,**纯函数、无需起服务**):
  - 总字节 ≤ `INLINE_BUDGET` → 仍产出 `text/plain` FilePart(现状行为不变,回归锁);
  - 总字节 > `INLINE_BUDGET` → **一个 FilePart 都不产出**,改为 `[附件]` 清单文本含每份的绝对路径 + 字节数 + 行数;
  - 边界:恰好等于预算走内联;单份 > `SINGLE_DOC_LIMIT` → 该份被拦下并给出可读原因;
  - 图片 / office 不受影响(仍各走 vision / `extract_document`)。
- `tsgo --noEmit` 干净。

### 10.2 外网人工(开发机 + Claude)

1. **分治主路径**:上传 6–10 份 docx,让它「把每份的关键发现汇总成一份报告」→ 观察:父代理**逐份发起 task**、每份返回后写一行小结;对话不中断、不撞窗口;最终报告落 `outputs/`。
2. **工作区归属**:上一步跑完后查磁盘——`.octo/<父会话ID>/extracted/` 下有 N 份解析件(**不是**散在各子会话目录);`outputs/` 里只有父代理写的报告(子代理没写文件)。
3. **侧栏干净**:分治期间与结束后,左侧会话列表**不出现**任何新条目;task 卡片右上角无 ↗、点不动(**整页刷新后再点一遍**);刷新不落进子会话。
4. **不外溢**(本轮硬要求):切到 make / studio,问模型「列出你可用的 subagent 类型」→ 有 `general` / `explore`,**没有** `insight_reader`;同时确认这些页面的 task 工具**本身仍可用**(§5.2 的两个函数语义差别,人工侧就看这一条)。
5. **工具面**:在 make / studio 问「你有 extract_document 吗」→ 没有;insight 里有。
6. **回归**:chip turn(研究工具那轮)行为不变——`[octo:chip] chip-send` 的 `toolGate` 里 bash / webfetch 仍为 false,业务工具只放行所选那个;**`task` 不再恒为 false**(这是本 spec 的预期变化,核对时别当回归失败)。
7. **md/txt 分层**(v2 主路径):上传 10 份两三万字的 **md**,问「把每份的关键发现汇总成一份报告」→ Console 出现 `[octo:attach] 内联预算超限,转子代理分治`;父代理逐份派 `insight_reader`;**第一轮不再撞窗口**。对照组:只传 1 份 3000 字的 md → 不出现该日志、模型一轮直接答(内联行为未变)。
8. **埋点验证读得准不准**(§4.3 的实测口,推理确认不了,必须跑):取一份 3 万字真实访谈稿,在 **80% 位置**埋一个全文只出现一次的具体事实(某受访者提的一个具体数字),派给子代理 → 看结论里捞不捞得出来。捞不出来说明是续读没走完或注意力衰减(对应 §4.3 的 #1 / #3),还有得修;捞得出来这条路就是通的。**单份多段(> 100KB)也跑一次**,结果决定 §11「份内切段分治」立不立项。

### 10.3 内网(桌面包 + GLM + 真 MCP)

1. **原始边界对上号**:016 v2 遗留的「一轮 10 个文件做通读类任务撞窗口」场景重跑 → 分治后不再撞窗口。
2. **弱模型遵从度**(重点,强模型通过不代表弱模型通过):① 父代理是否真的逐份派活、还是自己硬读;② 子代理是否只回结论、有没有擅自写文件;③ 单文档场景是否滥发 task(§5.1 残余代价的实测口)。
3. **多轮累积**(§4.3.1):10 份分治跑完后连续追问 4–5 轮(每轮都问需要重看材料的细节)→ 看父上下文第几轮撑不住、上游 summarize 有没有接住。
4. MCP chip 全链路回归(017):选功能 → 直接调用 → task_id → 转述 → 「好了吗」查询 → 文件卡片,不受工具面改动影响。
5. **v3-A 分治触发(本次 gap 的关单条件)**:上传 **3 份以上 docx**、问「读一下文件并汇总主题写成报告」→
   Console `[octo:attach]` 出现 `reasons: ["doc-count"]`、消息里有 `[材料体量]` 块,模型**逐份派 insight_reader**
   而不是自己连抽。反例基线(修复前):9 份 docx 一个 `[材料体量]` 都不产,模型连抽 9 次 `提取文档正文`。
6. **v3-B 串行**:同一轮里 task 卡片**逐个出现**(不是三张一起冒出来);Console 有 `[octo:task-queue] 已有子任务在跑,本次排队`;
   全程不再出现「超出分钟限制」。
7. **v3-C 会话 id 守卫**:诱导模型去查子任务结果(如中途打断后点「继续」)→ 它若调 `get_task_result(ses_…)`,
   应立刻收到指向 `task(task_id=…)` 的错误并**据此续跑**,而不是判定「子代理失败」退回自读。
8. **v3-D 超大单份**:传一份 > 150KB 的 txt/md → **不再弹「建议拆分后重新上传」**;子代理拿到切段清单、
   父代理按段派活;核对报告里覆盖到了文末内容(抽查最后一段的原话)。

---

## 11. 不做 / 后续

- **`knowledge_search` 的 registry 名字 gate 同款改造**——同属依赖倒置,但归 SPEC-INS-030 那条线且刚动过归属,单独评估(§3.5)。
- **`apply_patch` 的 registry 裁剪**——上游 `EDIT_TOOLS` 共键所迫,除非上游改映射,否则维持(§3.4)。
- **task 卡片增强(步数/耗时/展开结论)**——P1,见 §8。
- **`get_task_result` / `stop_task` 的有状态 gate**(本会话没提交过业务长任务就不暴露这两个工具)——§5.3 的第 3 层,
  前端 `task-detect.ts` 已具备判据,`buildToolGate` 加参数即可。等 §5.3 的 1+2 在内网跑一轮,看还漏不漏再决定。
- **串行闸推广到 chat / make / studio**——§5.4 目前只作用于 insight。全站并发只有几十个,其他模块的
  并发子代理同样吃配额,但改它们的行为超出本 spec 范围,需各自评估。
- **份内切段分治**(§2.4)——单份 > `SINGLE_DOC_LIMIT` 时把一份切 M 段、每段派一个子代理、父代理二次汇总。P0 先响亮失败,因为二次汇总的质量损失没有实测数据、定不了口径;等 §10.2 的埋点验证跑出单份多段的召回率再立项。
- **office 的单份上界**(§13.2)——`SINGLE_DOC_LIMIT` 现在只作用于文本类;office 用 `extract_document` 已有的 `tokenEstimate` 判,判定点在子代理侧。
- **二级汇总**(§4.3.1)——份数超安全线(约 20–25 份)时分批汇总再汇总。触发条件:实测中父代理在 25 份以上出现漏派 / 报告丢材料。
- **并发分治**——本 spec 只做串行(价值是隔离不是并发,且串行才有流式可见过程)。若内网模型并发能力改善且时延成为瓶颈再议。
- **子代理的解析件复用 / 缓存**——016 §8 已记「不做」,分治后重复抽取的面积变大,若成为瓶颈按那条立项。
- **第三方自带子代理的放开路径要不要产品化**(2026-08-24 记)——机制上已可自助(用户配置覆盖 `agent.octo_insight.permission.task`,§7 补充),缺的是**分发**:`octo.json` 是用户文件、产品不写,内网谁来写这一行没定;且第三方 agent md 默认全权限,靠对方自觉逐项 deny。**触发条件**:真有 skill 要自带子代理时,再定「随 skill 安装写入」还是「部署清单里手工配」,以及要不要给一个收敛过的模板 agent md。
- **上游 agent 合并循环的撞名保护**(config agent md 静默覆盖内置 agent)——本 spec 只在契约里点明(§4.2),不改上游。

## 12. 对齐清单(落地时逐项过)

### 12.1 v1(已落地)

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
- [x] 「`task` 子代理 — skill 作者须知」对外文档 → [task-tool-for-skills.md](../agents/task-tool-for-skills.md)（2026-08-24;其 §1.1 实测补全了下方 §7 契约 3 的放开路径）

### 12.2 v2 增补(2026-08-21,待落地)

- [x] `build-prompt-parts.ts`:新增 `MODEL_CTX_TOKENS` / `INLINE_BUDGET` / `SINGLE_DOC_LIMIT` 三个常量(**带 §2.5.3 的推导注释**,集中一处不散到调用方)与分层判定;超预算时不产 FilePart,改产「`[附件]` 清单(行格式不变)+ 一段体量说明」;字节数取 `Attachment.size`,`@` 引用的文件用 `api.readFileBuffer` 补
- [x] 前端:单份超 `SINGLE_DOC_LIMIT` 的响亮失败提示(专业措辞,给出「拆分后重传」这个可执行动作)
- [x] `insight_reader.txt`:补 §4.3 三条 —— 按任务里给的**总行数**自查读完、结论带**可 grep 的原话锚点**、**边读边记**(每段先落要点再读下一段)
- [x] `octo_insight` 提示词:派活时把总行数写进 task prompt;写明「父代理手上只有结论,追问细节要 grep `extracted/` 或重派子代理,**不许凭结论编**」
- [x] `build-prompt-parts.test.ts`:§10.1 的分层判定用例(含「等于预算」「单份超限」边界)
- [x] `docs/insight-debugging.md`:补 `[octo:attach]` 两条日志
- [ ] §10.2 第 7、8 项人工验证(尤其 **8 的埋点实测** —— 它的结果决定 §11「份内切段分治」立不立项)
- [x] `docs/specs/README.md` 登记表描述、`ROADMAP.md` 行状态同步为「v1 已实现 / v2 待实现」
- [x] 评审修正三条(§13.1):`insight_reader.txt` 撤回 md/txt 直读;`removeQueued` 回填 `u.bytes`;`agent.ts` 候选收敛 `{ "*": deny, insight_reader: allow }` + `agent.test.ts` 两条新断言(`evalPermPattern(insight,"task","general"/"explore") === "deny"`)与 `evalPerm(insight,"task")` 断言订正
- [x] `octo_insight` 提示词点名压过 `task.txt` 的「尽量并发」(§13.1 末)

---

## 13. 外部评审的处理(2026-08-21,codex)

评审对象是 v2 定稿。**它抓到三个真问题(已改)**,另有一批建议基于「支持 100 份文件」这个我们没有的目标(不采纳,记触发条件)。

### 13.1 已改

| # | 问题 | 处置 |
|---|---|---|
| 1 | **md/txt 让子代理直接 `read` 会静默丢数据** | 撤回。[extract_document.ts:90](../../../packages/opencode/src/tool/extract_document.ts#L90) 的注释早写明:`read` 的 `MAX_LINE_LENGTH=2000` 砍掉超长行尾巴且**没有续读手段**,而 md 里长段落不换行很常见。`extract_document` 的 `wrapLongLines` 正是为此存在,且 021 起本就支持 txt/md 直读 —— 改回「所有格式一律先 `extract_document`」,零成本。**§4.3 #1 里「md/txt 直读」那句同步删掉。** |
| 2 | **排队取消后附件 `size` 退化成 0** | [index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx) `removeQueued` 还原附件时硬编码 `size: 0`。链路:排队 10 份大 md → 取消 → 附件栏还原但字节归零 → 重发算出 `totalBytes=0` → 误判可内联 → 全塞进上下文,**静默**。改为回填 `u.bytes`(入队时已快照)。这是 §2.3.2 元数据链路的漏口,不补则分层判定在这条路径上整个失效。 |
| 3 | **task 候选并没有真收敛** | §5.1 原话「候选只有一个只读的文档子代理,派错了也干不了坏事」**与代码不符**:`describeTask` 列的是「所有未被 deny 的 subagent」,而 `octo_insight` 只写了 `{ insight_reader: "allow" }`,于是 `general`(bash / write / webfetch 全开)与 `explore` 照样在候选里。改为 `task: { "*": "deny", insight_reader: "allow" }`。 |

第 3 条的两个落地要点(单测锁住):

- **顺序有意义**:`fromConfig` 按 `Object.entries` 顺序生成规则,`Permission.disabled` 用 `findLast` 取最后一条匹配 `task` 的规则、仅当它 `pattern === "*" && deny` 才隐藏工具。`insight_reader: "allow"` 必须排在 `"*": "deny"` 之后,写反了就把 insight 的 task 整个关掉。
- **一处预期副作用,方向是对的**:`evaluate("task", "*", …)` 现在对 insight 返回 deny,于是 [truncate.ts](../../../packages/opencode/src/tool/truncate.ts) 的 `hasTaskTool` 为 false,工具输出截断时的提示从「派 explore agent 处理」换成「用 Grep / Read offset」。**这正是我们要的** —— explore 已经不在 insight 的候选里,原提示会让模型去派一个它根本没有的 subagent。

顺带:`task` 工具自身的说明([task.txt:16](../../../packages/opencode/src/tool/task.txt#L16))写着 "Launch multiple agents concurrently whenever possible",与本 spec 的串行派发**直接冲突**。`octo_insight` 提示词里显式压过它(点名这条、说明为什么通读不照做),不改上游。

### 13.2 结论对但范围要收窄:office 的单份上界

评审指出「不能用源文件字节数推导文档 token」(docx 是压缩包,100KB 可能抽出数十万字)——**判断对,但对本实现的描述不成立**:`decideInlineStrategy` 只对 `isTextInlineFile` 的文件算字节,office 被反向排除、压根不进预算(单测有此条)。

真正的缺口是另一个:**office 完全没有单份上界拦截**。§2.4 的 `SINGLE_DOC_LIMIT` 只作用于文本类,一个 100KB 的 docx 抽出 30 万字,子代理照样爆,而我们没有任何判据。

判据现成:`extract_document` 的 metadata 已有 `tokenEstimate`([extract_document.ts:85](../../../packages/opencode/src/tool/extract_document.ts#L85))。**但它属于新增能力、且判定点在子代理侧而不是前端**,不塞进 v2,列 §11 后续。

### 13.3 不采纳:面向 100 份文件的那套

评审的核心前提是「支持 100 个文件」,据此把批处理调度工具(`analyze_document_batch`)、二级汇总、coverage 校验器全部提为 P0。**这个前提不是我们的目标**:

- 本 spec 从头到尾的场景是 10–20 份(§4.3.1 已给出份数安全线);
- `MAX_ATTACHMENTS = 10`([index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx)),产品形态上一次就进不来 100 份。

具体不采纳的理由:

| 建议 | 不采纳的理由 |
|---|---|
| `analyze_document_batch` 代码级批处理工具 | 等于自建一套调度层,与「复用上游 `task` 机制、不动上游核心」的取向冲突。10–20 份下,提示词编排 + §10.2-8 的实测足以判断是否需要 |
| 二级汇总提 P0 | §4.3.1 已算过:10 份 ~2.5 万、20 份 ~4 万 token,安全。触发条件已写明(25 份以上出现漏派 / 报告丢材料),到了再立项 |
| coverage 代码校验器 | 方向对(§4.3 自己也承认提示词不是硬保证),但要改 `task` 工具、记录每份的 offset 覆盖区间,是独立工程。**先用 §10.2-8 的埋点实测拿数据**:10 份场景下提示词收紧够不够,实测说了算,不靠推演 |
| `MODEL_CTX_TOKENS` 动态化 | 内网当前只有一个模型,动态化收益为零、复杂度实打实。§2.5.4 的手工刷新步骤够用 |

> 这些不是「否掉」,是**排期**:100 份文件真成为产品需求时,评审 §六那套架构(manifest + 分组 Reduce + 覆盖率)是对的起点,连同它 §七的验收用例一起用。届时另立 spec,不在 032 里滚。
