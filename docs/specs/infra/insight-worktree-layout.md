# SPEC-INS-014 — Insight 本地工作目录布局（worktree 文档本地化）

> 状态：草案（v3，UI 打磨对齐 Design；v2 会话隔离） · 优先级 P1 · 规模 [M] · 领域 infra/insight
>
> 上游已实现：✓ projectDir 目录绑定（[SPEC-INS-012](../ui/insight-directory-scoping.md)）、✓ v1 已上线 `dev`（PR #238，`insight/sources`+`insight/outputs` 扁平布局）；✗ 按会话隔离、✗ `sources`→`uploads` 改名、✗ 文件管理 UI
>
> **本 spec 是"本地新能力线"的地基**，是 extract / @引用 / 二次生成 / 本地解析的共同前置。独立分支、独立上线，不阻塞也不被阻塞于下游能力。

---

> ## 修订记录
>
> **2026-07-30：v8（去掉预览面板第四栏，回归 §10 原始决定「点击以 tab 打开」）**——本条**不是反转决定，而是清掉一次未登记的实现漂移**。§10（v2）原文就写着「只读列表 + **点击以 tab 打开**」且「**不做 `/content`**（复用现有 `source:"path"` tab 机制读文件）」；2026-07-18 `dc02357d8` 引入 `PreviewPane`（单击文件行 → 右侧第四栏，内容走 `/artifact/content` + base64 data URL 自渲染），该改动未登记进本 spec（§10.1 对照表与落地文件清单里都没有它），系统里因此并存了两套预览实现。症状：md 产物从文件管理打开白屏、office/PDF 在面板里全空白（详见新增 §10.2）。**决定：删 PreviewPane，单击文件行直接开 tab，打开后的分流交给 [SPEC-INS-026](insight-artifact-identity.md) §4.2 的唯一入口 `resolveOutputType`** —— 不是新增白名单，是删掉一套重复实现。音视频预览（用研素材大头）拆为独立第二步，且**明确不沿用 Design 的 base64 方案**，理由与正确做法见 §10.2。

> **2026-07-29：v7.3（命名规则收窄为「只做必要清洗」，§3.1 旧规则废除）**——旧规则把服务端**上传**的 sanitize（空格/括号 → `_`、主名截 100）也用在了**下载落盘**上，导致同一份产物「卡片叫 `林(2).json`、磁盘叫 `林_2_.json`」，用户以为是两份文件（UXAI PR #445 的其中一条根因）。该规则的原始动因是「文件名随 basename 进 S3 URL、特殊字符致 MCP 下载失败」，而**文件名已退出 URL**（上传合同 v2 已落地），约束消失。新规则见 §3.1：只拒绝路径穿越（全平台）+ Windows 非法字符/保留名 + 超长截断，其余逐字保留。上传方向同步废除。本条属 [SPEC-INS-026 产物身份模型](insight-artifact-identity.md) 的一部分，命名规则真相源移至 026 §4.1。
>
> **2026-07-24：v7.2（搬迁判据健壮性 —— 布局知识收敛 + refresh 解耦，UXAI PR #424 的后续）**——本条不改布局本身,收敛「布局知识散落导致 v7 迁移漏改」这个类别的脆弱。背景:v7 把预会话落地区 `insight/uploads`→`.octo/tmps`,主进程落盘(ipc.ts)改了、**渲染端搬迁判据 `isPendingUploadPath` 漏改**(只改注释、函数体仍找 `insight`)→ 判据恒假 → 附件搬不进 `.octo/<sessionId>/uploads/`、文件管理面板为空(PR #424 止血)。两处根因收敛:① 判据从 2000+ 行页面组件抽到 [worktree-layout.ts](../../../packages/app/octoapp/pages/insight/utils/worktree-layout.ts)(渲染端布局唯一入口、可单测),布局字面量集中为常量;主进程 [ipc.ts](../../../packages/desktop/src/main/ipc.ts) 落点处加交叉引用注释——两处受进程边界隔离**无法共享常量**(desktop 主进程不 import 渲染端包),故跨进程真相源仍是本 spec §2,改布局须同步三处(见 [§2.1 实现映射](#21-实现映射改布局要同步哪几处))。② 文件管理刷新 `setFilesRefreshKey` 的 gate 从 `movedPaths.size > 0` 解耦为 `localFiles.length > 0`——刷新只依赖「本次有无本地附件」这个可靠事实,不再耦合到搬迁判据是否为真;否则判据一旦再脱节,附件进不去(已是 bug)会连带把可见性刷新也哑掉、放大故障。完整复盘见 learning [stale-path-predicate-after-layout-refactor.md](../../learning/stale-path-predicate-after-layout-refactor.md)。UXAI PR #424(判据止血)+ 后续 refactor PR(本条收敛)。
>
> **2026-07-22：v7.1（outputs materialize 幂等**持久化到磁盘清单**，消除重装/重启后同名产物重复 #90）**——旧 `downloadResourceToTemp` 靠桌面主进程**内存表**（`namespace` = 资源 URI → 本地路径）记幂等，落盘走 `collisionFreePath` 撞名加后缀；内存表跨重启/重装清空，重开旧会话再触发 eager 落盘 → 查不到 → 撞名重落 `xxx (2)`，**每装一次多一份**（#90）。**修法：幂等键(仍是资源 URI)从内存表搬到磁盘持久清单** `.octo/<sessionId>/outputs/.materialized.json`（`URI → {file, fetchedAt}`；dotfile，`listFiles` 已过滤不进文件管理；随会话目录生命周期，天然活过重启/重装）。命中且落地文件仍在 → 复用那份（含用户改动）、绝不 re-fetch/覆盖；未命中才 `collisionFreePath` 落盘 + 写回清单。内存表保留为进程内快路径（键加 `outputsDir` 前缀，避免同一 URI 跨会话串场）。**为什么按 URI 记而非按文件名**：文件名 ≠ 身份，两个不同 URI 同名不能 alias 成同一份（故撞名仍 `collisionFreePath` 各留一份）——起草时曾考虑「确定性按名复用」（对齐 Design [artifact-auto-save.ts](../../../packages/app/octoapp/pages/make/utils/artifact-auto-save.ts)），评审指出 filename≠identity 后否掉，改回「按 URI + 持久清单」（业界同款：npm cacache / pip / MCP 缓存代理都用「跨重启存活的 逻辑键→已落地条目 清单」）。**已知边界**：① 首次升级、老会话尚无清单 → 那一次仍可能出一份 `(2)`，之后稳定；② 用户手动改名 → 清单指向的旧名失效 → 再落一份原名副本。UXAI PR #418。
>
> **2026-07-22：v7（本地落点根迁 `.octo/` + 去掉 agent 命名层 + 预会话区 `uploads`→`tmps`）**——按 PM 全局约定,所有模块的本地磁盘落点统一收进 `.octo/` 根。对 insight 有三处结构变更:① 根从 `<projectDir>/insight/` 迁到 `<projectDir>/.octo/`;② **去掉 agent 命名层**——原 `insight/<sessionId>/` 改为 `.octo/<sessionId>/`,会话归属哪个 agent 由 `sessionId` 反查即可,不必用目录段表达;③ 预会话落地区 `insight/uploads/` 改名 `.octo/tmps/`(会话内 `uploads`/`outputs` 不变)。**本条反转 §2 旧决策**（v1/v2 曾坚持"不藏 `.octo/`、放显性 `insight/` 下",理由见旧 §2；v7 认定"跨模块目录约定一致"优先，可见性由 §10 文件管理 UI 承接——详见 §2 新论证）。会话段 `<sessionId>` 即平台 `session.id`(形如 `ses_ab12…`)，与 make 的 `.octo/artifacts/make/<sessionId>/` 同源；make 上层命名空间(`artifacts/make`)由 design 侧独立整改,不在本次。**存量本地文件不迁移**（新旧路径不冲突，旧文件留原处、不主动清理，延续既有 orphan 立场；迁移方式的业界做法——前向不迁移 / 惰性迁移 / 启动期批量——留待需要时另议，倾向前向不迁移）。八处落点 + write-file 白名单(改按 `.octo` 分段)已改，UXAI PR #411。
>
> **2026-07-20：v6（write 产物出卡——路径 C 收窄为 md/html 白名单）**——承接 v5:v5 让 write 产物确定性落 outputs（→ 文件管理必然可见），本条在此之上恢复 md/html 的**对话流预览卡**。#384 曾整条退役路径 C（无法确定性区分「交付物 vs 脚本/scratch」）；v6 改按**扩展名白名单**出卡（`type ∈ {markdown, html}`）——判的是「该类型有无应用内预览价值」（md→编辑器 / html→iframe），**不猜意图**，故 `.ps1`/`.docx`/`.py` 仍不出卡（#384 收益保住）、md/html 恢复就地预览。md/html 经 v5 落 outputs → **既出卡、又必然在文件管理**（与路径 A 一致，非冗余）；「write 完成→文件管理刷新」仍覆盖全部 write 产物。SOT 与验证清单在 [output-renderers §0.1 / §2.6](../ui/output-renderers.md#26-write-工具产物来源路径-c--本地文件出卡收窄为-mdhtml-白名单-2026-07)；实现 `insight-turn.tsx` 组件层过滤。UXAI 待提 PR。
>
> **2026-07-18：v5（路径 C write 产物落点——从「提示词约定」改为「服务端确定性重定向」）**——取代 v4 §②的做法。v4 靠提示词让模型自己把 write 产物写进 `outputs/`（从 `[附件]` 路径推导绝对路径）；因绝对路径是运行时值、静态提示词写不了，客户端改成**每轮消息注入一条 `[输出目录] <绝对路径>` synthetic 指令**去纠偏。副作用:内网弱模型把这条常驻指令当成「当前要回应的事」复述出来——发个「你好」都回一段带 outputs 绝对路径的话，把内部路径暴露给用户（[反模式沉淀见 learning](../../learning/standing-instruction-echoed-by-weak-model.md)）。
> - **改法**:回到业界标准——agent 的相对写入解析到其工作目录，不靠提示词喂绝对路径。新增 server 插件 [octo-outputs-redirect.ts](../../../packages/opencode/src/agent/octo-outputs-redirect.ts)，在 `tool.execute.before` 把 `write` 的**相对 `filePath`** 重定向到 `<会话directory>/insight/<sessionId>/outputs/`。
> - **两道确定性闸门隔离影响面**（不动上游 write 本体，Chat/Design/Studio 的 write 走原生行为）:`input.tool === "write"` 且 `session.agent === "octo_insight"`（会话级 agent 字段，见 [session-agent-attribution](session-agent-attribution.md)）。**绝对路径原样尊重**——用户显式指定的位置、以及过渡期模型仍产出的绝对 outputs 路径都不改写。
> - **随之删除**客户端每轮注入的 `[输出目录]` synthetic 指令（暴露问题的根因）；提示词「落文件产物」改为「只给文件名、系统自动存、别拼绝对路径、也别在回复里描述路径」，`.txt`/`.md` 镜像同步。
> - **为什么不再顾虑 scratch 污染**（v4 §②的顾虑）:实证 insight agent 的 `write` 只用于交付产物——超长抽取的「全文落盘」走的是专门的 `TRUNCATION_DIR`（[truncate.ts](../../../packages/opencode/src/tool/truncate.ts)），不经模型 write；故「相对写入一律进 outputs」没有中间文件污染。
> - UXAI PR #368。
>
> **2026-07-14：v4（产物落盘机制修订——确立「文件管理 = 会话真产物库」）**——把 §10 文件管理的定义收敛为「只收真·文件产物」，据此反转 §4.2 两处既有决定：
> - ① MCP `resource_link` 产物从「点开卡才 materialize」的**懒落地**改为**出卡即落**（eager）。文件管理列的是 `outputs` 磁盘上的真实文件（§10 服务端 `listFiles`），懒落地导致「生成了但用户没点开的产物，在文件管理里查无此文件」——这正是本次要修的现象（起因：思维导图卡产物不在文件管理）。
> - ② `write` 产物（路径 C）**由「不强制」升为「提示词约定写 outputs」**——[octo_insight.md](../../../packages/opencode/src/agent/prompt/octo_insight.md) 新增「落文件产物」小节：生成**交付型文件产物**时写入本会话 `insight/<sessionId>/outputs/`（从 `[附件]` 路径 `uploads`→`outputs` 同级推得），仅供自身回读的中间/暂存文件不写此处。**依据**：`write` 是 insight agent 的常驻工具（[agent.ts](../../../packages/opencode/src/agent/agent.ts) `write: allow`、`bash: deny`），产物写到任意路径会导致「对话里看得到 agent 写文件、常驻的文件管理里却查无此文件」（易被当 bug）；且这正是 **Claude Cowork 的既有做法**（同款 per-session `uploads`(只读)+`outputs`(可读写/持久) 结构，其 agent「输出文件写入 outputs/」）。**前端无需改动**——文件管理已列真实 `outputs/`，写入即可见。（起草 v4 初稿时曾一度改为「不落」，理由是顾虑 scratch 污染产物库；后据 Claude Cowork 实证 + `write:allow` + 常驻文件管理的一致性诉求，改回「约定写 outputs」，scratch 由 agent 自行写别处规避。）
> - **排除 inline 嗅探卡**（路径 B：从对话正文嗅探出的 mindmap/html 预览，见 [output-renderers §2.1](../ui/output-renderers.md)）——它是「对话内容的**附加预览**」而非文件产物（无天然文件名、无差别落盘会用对话碎片淹没产物库、且它在对话流内已可见可复制），维持不物化落盘，靠用户手动「下载/另存」沉淀（§7 新增排除项）。
> - **为什么不做「下载即双写」**（讨论过、否掉）：曾考虑让 action-bar 下载按钮在浏览器下载的同时回写一份进 outputs。否掉——「下载/另存」是用户**手动选路径**的动作，与「产物默认落盘」是两条正交的线；双写会让 outputs 混入用户本想存到别处的副本（含转换派生格式如「Octo 白板」）。落盘只对「真产物生成」这条线负责。
>
> **2026-07-09：v3（§10.1 文件管理 UI 对齐 Design 模块）**——把 §10 的两段平铺列表升级为表格视图（多选/表头排序/按类型或修改时间分组/类型筛选/真上传+拖拽落区）；kind 分类改走**客户端派生、未动服务端**（订正 sonnet 原草案的"服务端分类"）；错误处理从 `createResource` 双 resource 改为手动 `refresh()` + `try/catch` 收口；连带修 viewMode 引入后"点对话产物卡片打开 tab 却不聚焦（停在文件管理）"的 §10 回归。详见 §10.1 + §8 #10。
>
> **2026-07-08：v1（projectDir 扁平共享）→ v2（按会话隔离）**——v1 已上线 `dev`，把 `insight/sources`+`insight/outputs` 做成**按 projectDir 键控、跨 session 共享**（v1 §2 原文："为什么不按 id 分桶"：故意不分桶，为了免费拿到跨会话共享，把"按会话分桶"列为"以后如果觉得乱再做"的备选项）。
>
> 这次把这条决定反过来，**改为按会话隔离**，不再是备选项而是本次直接落地：
> - 对齐 Claude / 站内 **Make 模块**（`pages/make`，`design-files-panel.tsx` + `.octo/artifacts/make/<sessionId>/`）已经上线的会话隔离约定——两个同类产品内部已经不一致，没必要再犹豫
> - `sources` 改名 `uploads`（对齐 Claude / Make 用词）
> - **不跟 Make 的一点**：Make 把 artifacts 藏进 `.octo/`；本 spec **继续坚持 v1 "用户工作资产必须显性、可在 Finder 打开"的原则**，新布局仍在可见的 `insight/` 下
> - 新增"预会话落地区"机制（v1 没有这个问题，因为 v1 不分会话）：非图片附件在"选中"时还没有真实 session id，本 spec 采用 `insight/uploads/`（扁平、不属于任何会话）承接，发送时 `rename` 进 `insight/<sessionId>/uploads/`——原则参考 OpenAI/Anthropic Files API 的公开设计（upload 早于、独立于 conversation，发送时才关联），而非新发明
> - 旧 v1 数据（`insight/sources`、`insight/outputs` 扁平文件）**不做迁移**，新 write-file 白名单也不再放行旧路径；orphan 数据不主动清理（与"移除附件不删磁盘文件"的既有行为一致）
> - 配套新增"文件管理"UI（本 spec §10），实现上采用 Make 模块已验证的 `viewMode: "tabs"|"files"` 切换模式，**不是** [SPEC-INS-004](../ui/insight-workspace.md) 原草案设想的 260px 常驻侧栏——SPEC-INS-004 需要同步标记为被本 spec §10 取代，见该文档顶部的交叉引用

---

## 0. 这份 spec 解决什么

把 insight 在所选项目目录（projectDir）下的本地文件，从"隐藏的工具缓存（`.octo/downloads`）+ 只在 S3 的源文件"，规整成一套**显性、可管理、按会话隔离的工作目录**：

```
<projectDir>/.octo/
├── tmps/                     ← 预会话落地区(§4.1.2):会话不存在时,非图片附件先落这里;扁平,不属于任何会话
└── <sessionId>/              ← 会话命名空间(形如 ses_ab12…,即平台 session.id;v2 新增替代 v1 扁平共享;v7 去掉 agent 命名层直接挂 .octo)
    ├── uploads/               ← 发送时把这次要发的附件从 .octo/tmps/ rename 进来
    └── outputs/                ← 产物:MCP materialize 落地 + 本地能力 write 输出(从一开始就要求 sessionId)
```

做完之后：
- **源文件在本地** → 下游 extract / @引用 / 二次生成有了读取对象（[output-renderers §2.6 路径 C](../ui/output-renderers.md) 的本地读盘即可用）
- **产物显性可见** → 兑现"显性存储、管理上下文中的文件"诉求；本 spec §10 的文件管理 UI 直接列这两个目录
- **按会话隔离** → 匹配 Claude / Make 的用户心智模型："这是我这次对话上传/生成的文件"，不会看到别的会话混进来

**与 MCP 的边界（团队解耦）**：本 spec **不改 MCP 工具契约 / 服务**，模型侧 handle/url 契约与 `octo-upload-inject` 插件也**不变**。我们这侧有两处动作、都不碰他们：① 把结果 `resource_link` 下载到本地（消费他们的输出）；② 源文件上传 S3（我们自己的上传服务）——**上传时机的改造已移出本 spec**，见 [SPEC-INS-015 按需上传](insight-file-passing.md)；本 spec 保持今天的 eager。详见 [§5](#5-与-mcp-的边界纯消费不改其流程)。

---

## 1. 现状

| 能力 | 状态 | 位置 |
|---|---|---|
| projectDir 目录绑定（会话 / 事件 / SDK 同源） | ✓ | `useProjectDir()` / `sdk.directory`，[index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx)，[SPEC-INS-012](../ui/insight-directory-scoping.md) |
| v1：显性 `insight/sources` `insight/outputs`（projectDir 扁平共享） | ✓（已上线 dev，PR #238） | 本 spec v1 |
| v2：按会话隔离 `insight/<sessionId>/{uploads,outputs}` | ✗ | 本 spec v2 |
| v2：`sources` → `uploads` 改名 | ✗ | 本 spec v2 |
| v2：预会话落地区（`insight/uploads/` + 发送时 rename） | ✗ | 本 spec v2 |
| 文件管理 UI（列出 uploads/outputs） | ✗ | 本 spec §10（取代 [SPEC-INS-004](../ui/insight-workspace.md) 原草案） |
| v7：落点根迁 `.octo/` + 去 agent 命名层 + 预会话区 `uploads`→`tmps` | ✓（PR #411） | 本 spec v7（§2、顶部修订记录） |

---

## 2. 目录布局（SOT，v7）

```
<projectDir>/.octo/
├── tmps/
│   └── <sanitized-filename>            （预会话落地区；扁平；同名按 §3.3 去重 / 加后缀）
└── <sessionId>/                        （形如 ses_ab12…，即平台 session.id）
    ├── uploads/
    │   └── <sanitized-filename>        （该会话的附件；扁平；撞名按 §3.3 加后缀）
    └── outputs/
        └── <sanitized-filename>        （该会话的产物；扁平；materialize 按 URI 幂等,落地映射记入 .materialized.json,§3.3）
```

| 层 | 作用 | 备注 |
|---|---|---|
| `.octo/` | 全局本地根（v7） | insight / make 等所有模块的本地落点统一收进这里；不存在则**自动创建**（首次写入时 `mkdir -p`） |
| `.octo/tmps/` | 预会话落地区 | 非图片附件在没有真实 sessionId 时的临时落点，见 [§4.1.2](#412-预会话落地区与发送时归属) |
| `.octo/<sessionId>/uploads/` | 该会话的附件 | `<sessionId>` 即平台 `session.id`（形如 `ses_ab12…`），与 make 的 `.octo/artifacts/make/<sessionId>/` 同源；发送时从 `.octo/tmps/` rename 进来 |
| `.octo/<sessionId>/outputs/` | 该会话的产物 | MCP materialize（§4.2）+ 本地能力 write 输出（路径 C）；扁平；materialize 按 URI 幂等 + 持久清单 `.materialized.json`（§3.3，v7.1） |

**为什么统一收进 `.octo/`、且去掉 agent 命名层（v7 决定，反转 v2 的"显性放 `insight/` 下"）**：v1/v2 曾坚持"用户工作资产要显性、可在 Finder 直接找到"，据此把落点放在可见的 `insight/` 下、并刻意**不跟** Make 把产物藏进 `.octo/` 的做法（旧论证：`.octo/` 只留给纯工具缓存）。v7 按 PM 全局约定推翻这条：**所有模块的本地落点统一收进 `.octo/` 根**，理由是"跨模块目录约定一致"这条产品级诉求压过了单模块的"显性优先"——两个同类模块各自为政（insight 显性、make 隐藏）本身就是需要收敛的不一致。同时**去掉 agent 命名层**（原 `insight/` 这一段）：会话归属哪个 agent 可由 `sessionId` 反查得到，不必再用目录段表达，`.octo/<sessionId>/` 直接挂在根下即可。可见性诉求由**文件管理 UI**（§10，列 `.octo/<sessionId>/{uploads,outputs}`）承接，不再依赖"落点是否在 Finder 显眼处"。

**为什么改成按会话隔离（v1→v2 的核心决定，见顶部修订记录）**：v1 的"projectDir 键控、不分桶"是为了免费拿到跨会话共享，且把分桶列为"以后再说"的选项。这次直接改成分桶，放弃跨会话共享，换来跟 Claude / Make 一致的用户心智模型（"这是这次对话的文件"）。**不做跨会话聚合视图**（本 spec 明确排除，见 §9）；未来若要看"整个项目下所有会话的文件"，需要新增聚合能力，属独立 spec，本次的目录结构（`sessionId` 作为已知的必填维度）不阻碍那件事。

**为什么 outputs 不需要预会话处理**：MCP 产物只可能发生在模型已经在真实会话里运行时——不存在"会话还没创建就有产物"的场景，因此 `outputs` 从一开始就要求真实 `sessionId`，没有 `uploads` 那样的预会话落地区问题。

### 2.1 实现映射（改布局要同步哪几处）

本 §2 是布局的**唯一真相源（SOT）**。落点的字面量（`.octo` / `tmps` / `uploads` / `outputs`）在代码里分落两处，且**受进程边界隔离、无法共享同一常量**（Electron 主进程不 import 渲染端 `@opencode-ai/app` 包，无先例、有构建风险），因此靠本 spec + 交叉引用注释保持一致，而非编译期约束：

| 处 | 位置 | 角色 |
|---|---|---|
| 主进程落盘 | [ipc.ts](../../../packages/desktop/src/main/ipc.ts) `copy-file-to-worktree` / `move-pending-upload-to-session` | **权威实现**——真正 `mkdir`/`copyFile`/`rename` 的地方 |
| 渲染端判据 | [worktree-layout.ts](../../../packages/app/octoapp/pages/insight/utils/worktree-layout.ts) `isPendingUploadPath` + 布局常量 | 发送时「要不要搬迁」的**镜像判据**，渲染端布局唯一入口、带单测 |

**改布局（如再迁一次落点根 / 改目录段名）必须三处同步改**：① 本 §2 ② ipc.ts 落点构造 ③ worktree-layout.ts 常量。v7 迁移只改了 ①②、漏了 ③，判据恒假半程失效（顶部 v7.2 + learning [stale-path-predicate-after-layout-refactor.md](../../learning/stale-path-predicate-after-layout-refactor.md)）——这张表就是为不再漏而立。

---

## 3. 文件命名与冲突

### 3.1 sanitize

> **2026-07-29 修订（SPEC-INS-026）**：旧规则「空格 → `_`；其他 → `_`；主名截 100 字符」**已废除**，改为「只做必要清洗」。真相源移至 [insight-artifact-identity.md](insight-artifact-identity.md) §4.1，本节留摘要。

**必要 = 不清洗就落不了盘、或不安全。** 其余一律保持 MCP 文件名与磁盘名逐字一致（含空格、括号、中文）：

- **全平台拒绝**（不改写，响亮报错）：含 `/`、`\`、`NUL` 的名字，以及名字为 `.` / `..` —— 这不是"清洗文件名"，是拒绝把外部输入当路径用（`resource_link.name` 来自服务端）。
- **仅 Windows 替换**：`<>:"|?*`、保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`）、尾部 `.` 与空格 —— 不处理 `fs.writeFile` 直接抛 `EINVAL`，产物丢失。macOS/Linux 这些字符合法，**不动**。
- **全平台**：超过文件系统上限时按字节截断、保住扩展名。

**为什么废除旧规则**：它源自「文件名随 basename 进 S3 URL、特殊字符致 MCP 下载失败」（见 §3.3 末尾 2026-07-03 注记），而**文件名已退出 URL**（上传合同 v2 已落地），约束消失。旧规则正是 `林(2).json` 在文件管理里显示成 `林_2_.json` 的原因——同一份文件两个名字，用户以为是两份。上传方向（`copy-file-to-worktree`）同步废除。

会话目录名（`sessionId` 作为路径分段）**保持** allow-list 清洗（`[A-Za-z0-9_-]`，非法字符替换为 `_`）——渲染进程不是安全边界，防御性拒绝路径穿越。这条与上面「拒绝路径分隔符」同源，不受本次修订影响。

### 3.2 outputs 命名
文件名取 `resource_link.name`（uri 源）或 `basename(filePath)`（path 源），按 §3.1 处理后落 `.octo/<sessionId>/outputs/`，**幂等键=资源 URI、落地映射记入持久清单 `.materialized.json`；命中即复用，撞名走 `collisionFreePath` 加后缀（§3.3，v7.1 修订）**。不做 `<id>` 分桶（只按 `sessionId` 分桶，桶内扁平）。

> **磁盘名即身份、即展示名**（SPEC-INS-026 §4.3）：对话入口卡、tab 标签、文件管理三处显示的都是磁盘 basename，单一来源。**不得**在渲染进程复刻主进程清洗规则去"预测落盘名"——那种做法假设所有产物走同一条落盘路径（write 产物不走），反而制造新的名字分叉；§3.1 消灭转换后预测也不再需要。

### 3.3 撞名处理

**uploads / tmps（用户手动导入）——撞名加后缀**：撞名（目标已存在）就**加后缀** `name (2).docx`（操作系统下载器习惯），不覆盖。`.octo/tmps/` → `.octo/<sessionId>/uploads/` 的 rename 步骤同样应用这条规则（目标目录里撞名就加后缀，不覆盖）。

**outputs（MCP materialize 产物）——按 URI 幂等 + 磁盘持久清单（v7.1 修订，#90 / UXAI PR #418）**：幂等键 = **资源 URI**（不是文件名），落地映射记入 `.octo/<sessionId>/outputs/.materialized.json`（`URI → {file, fetchedAt}`；dotfile，`listFiles` 已过滤不进文件管理）。判定顺序：内存 Map 快路径（键 `${outputsDir}::${URI}`）→ 磁盘清单命中且落地文件仍在 → **复用那一份**（含用户改动），绝不 re-fetch / 覆盖；都未命中才 `collisionFreePath` 落盘（**撞名仍加后缀**：两个不同 URI 同名各留一份、不 alias）+ 写回清单。
> 为什么要持久清单：旧实现只有进程内内存表，跨重启/重装即清空 → 重开旧会话查不到 → 撞名重落 `xxx (2)`，每装一次多一份（#90）。清单落 `.octo/` 随会话目录活过重装（业界同款：npm cacache / pip / MCP 缓存代理都用「跨重启存活的 逻辑键→已落地条目 清单」）。**为什么按 URI 不按文件名**：文件名 ≠ 身份，两个不同 URI 同名不能被 alias 成同一份。**已知边界**：① 首次升级、老会话尚无清单 → 那次仍可能一份 `(2)`，之后稳定；② 用户手动改名 → 清单旧名失效 → 再落一份原名副本。

> 2026-07-03 曾把落地文件名改为 `name_2.docx`（防空格/括号随 basename 进 S3 URL 致 MCP 下载失败），同日随上传合同 v2 提案（[file-upload.md](file-upload.md) 顶部：文件名退出 URL）回退，统一 ` (n)`。v2 落地前撞名文件走 MCP 会因 URL 特殊字符失败，与其他特殊字符文件名同属已知窗口，服务端改造收口。

> 不做内容 hash 去重：handle（`upload_<hex>`）是 **URL 派生**（每次上传的 S3 路径 uuid 不同 → handle 也不同），不是内容 hash，拿它判重对不上；另算内容 hash 不值当。重复导入同一文件最多多一份副本，可接受。

---

## 4. 落地机制

### 4.1 源文件导入 worktree（本质是拷贝）

对本地路径而言这不是"上传"，是**把用户的文件拷贝进 worktree**。S3 上传是另一件只为 MCP 服务的事（保持今天 eager；时机改造见 [SPEC-INS-015](insight-file-passing.md)）。

```
用户选文件 / 拖拽
  → （本地）fs.copyFile(原始路径, <projectDir>/.octo/tmps/<sanitized>)   ← 总是做,落预会话区
  → （MCP 用）POST S3 → 拿 url + handle → 注入 session                       ← 见 §4.1.1
```

- **拷贝实现**：文件选择器 / 拖拽能拿到**真实本地路径**（Electron `File.path`），主进程 `fs.copyFile(srcPath, dest)` 即可——**磁盘上流式拷贝、不占渲染进程内存**（100MB 也无压力），`copyFileToWorktree(srcPath, baseDir, filename)` IPC（v1 已有，v2 目的地从 `insight/sources` 改 `.octo/tmps`，签名不变）。
- **格式不变**：原样拷贝，**docx 还是 docx**，绝不转格式（office→文本是 Spec B 的事，且只另存派生文本、不动原件）。
- **不在本期处理**：粘贴的内存 blob（无真实路径，如剪贴板二进制）——少见，留作后续独立 spec（届时再加"写字节"API）。
- **无 projectDir / 非桌面端**：跳过本地拷贝，本地能力线在该会话不可用——降级而非报错。
- **失败处理**：拷贝失败**不阻断** MCP 主流程；记 `[octo:worktree] upload-copy failed`，本地能力线对该文件不可用。

#### 4.1.1 S3 上传时机 —— 移出本 spec，见 SPEC-INS-015（按需上传）

> **范围收敛（2026-06-29，已与用户对齐）**:S3 上传时机的改造**不在本 spec**。
>
> 探讨过两版且都**作废**:① 原草案「绑预置发送」(隐含 MCP 只经预置触达,行为回退);② 中途「绑任意发送」(自由消息发本地模型也上传——无意义、且上传服务不可用时阻断发送)。
>
> 想清楚后(见 [ADR-015](../../adr/015-file-passing-architecture.md)):S3 上传只为 MCP/UXR 工具服务,正确时机是「**模型真正调 MCP 工具时**」由插件按需上传,与「发送」无关。这是独立改造,拆到 **[SPEC-INS-015 MCP 文件按需上传](insight-file-passing.md)**(动 [ADR-014](../../adr/014-url-injection-via-plugin.md))。
>
> **本 spec(INS-014)不改上传时机**:保持今天的 eager(选文件即传 + `[已上传文件]` 块),MCP 照常工作。
>
> 另:图片附件改走 S3 URL(而非 base64)也独立,见 [图片附件 spec](../ui/insight-image-attachment.md)。

#### 4.1.2 预会话落地区与发送时归属（v2 新增）

**问题**：非图片附件"选中即拷贝"（§4.1）发生在用户点发送之前——欢迎页/还没发第一条消息时 `sessionId` 不存在（`session.create` 的服务端 API 不接受客户端指定 id，无法提前拿到真实 id）。v1 没有这个问题（不分桶，拷进哪都一样）；v2 按会话分桶后，必须回答"没 session 时拷去哪"。

**为什么继续"选中即拷贝"而不是"发送时才拷贝"**（讨论过、有意识选的，不是路径依赖）：
1. **Fail-fast**——本地磁盘拷贝的失败模式（权限、磁盘满、源文件在拷贝间隙被移动/U 盘拔出）比远程上传更容易发生在"选中"到"发送"之间；选中即拷贝能在发送前就暴露，不把这类失败塞进发送这条关键路径。
2. **和可验证的行业行为同构**：ChatGPT / Claude.ai 网页版选中附件后立刻显示上传中/失败重试，不等发送；这正是 OpenAI / Anthropic 公开的 Files API 设计模式——upload 早于、独立于 conversation，发送时才关联（`file_id` 引用）。"预会话落地区 + 发送时关联进真会话"是这个模式在本地磁盘拷贝场景下的对应实现，不是自造概念。

**机制**：
```
选中/拖拽非图片文件（无论有无 sessionId）
  → fs.copyFile → <projectDir>/.octo/tmps/<sanitized>          ← §4.1，不变
  → 用户点发送，createAndNavigate() resolve 出真实 sessionId
  → fs.rename(.octo/tmps/<file>, .octo/<sessionId>/uploads/<file>)   ← 新增，本 spec
  → 更新附件状态里的本地 path，供 [附件] 清单 / MCP 按需上传使用
```
- `rename` 是同一文件系统内的原子操作，单文件通常 < 5ms，多附件可并行，不显著拖慢发送。
- **失败处理**：`rename` 失败（极少见）不阻断发送，该附件的 `[附件]` 清单路径退化为指向预会话区，仍可读；记 `[octo:worktree] upload-move failed`。
- **未发送的附件怎么办**：用户撤销附件（`removeAttachment`）不删除磁盘副本——这是 v1 就有的既有行为（附件被撤销后，v1 的 `insight/sources/` 里也会留孤儿文件），v2 沿用同一行为：留在 `.octo/tmps/` 里不清理。**不做**发送失败/用户中途关闭 App 时的自动清理（跟 v1 一致的"孤儿数据不主动清理"立场）。

### 4.2 产物落点（`.octo/<sessionId>/outputs`）

**落地时机 = 出卡即落（eager，v4 修订）**：MCP `resource_link` 产物在**对话流出卡时**就触发 materialize 落进 outputs，不等用户点开卡片。

> **为什么改 eager（v4）**：文件管理「生成文件」段列的是 outputs 目录里的**真实文件**（§10 `listFiles`），而非「对话里出过的卡」。v3 及以前是**懒落地**——`downloadResourceToTemp` 只在用户点开产物卡（result-viewer 渲染 / 编辑 / 定位）时才被调用，导致「生成了、卡也在，但没点开过 → 文件管理查无此文件」。eager 让「文件管理 = 会话真产物库」的定义自洽。
>
> **eager vs lazy 权衡**：懒落地省一次网络+磁盘（没看的产物不下载），但代价是文件管理与「产物是否被查看」耦合，违反「产物库 = 已生成的全部产物」的心智；eager 反过来。选 eager，与「显性存储、可管理」的 spec 立场（§0）一致。**实现注意**：① 一次 `completed` 可能返回 N 个 `resource_link`，eager 落地要控制并发、单个失败不阻断其余（记 `[octo:worktree] result-materialize` 带 `reason`）；② 幂等由按 URI 的持久清单保证（§3.3，v7.1：幂等键 = 资源 URI，落地映射记入 `.materialized.json`），已落地/用户改过的那份不被 eager 覆盖。

- `downloadResourceToTemp` 的落点为 `<baseDir>/.octo/<sessionId>/outputs/<file>`（扁平，撞名加后缀），新增必填 `sessionId` 参数；`baseDir` 或 `sessionId` 缺一 → 走 OS 临时目录降级（不持久，无本地能力线）。
- **同步更新调用点**（否则预览读 A、编辑写 B 会漂移）：
  - [local-resource.ts `ensureLocalMarkdownFile`](../../../packages/app/octoapp/pages/insight/utils/local-resource.ts) — 新增 `sessionId` 参数
  - [result-viewer/index.tsx `UriMarkdownTabBody`/`FileFallback`](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx)、[action-bar.tsx](../../../packages/app/octoapp/pages/insight/components/result-viewer/action-bar.tsx)、[markdown-editor/index.tsx](../../../packages/app/octoapp/pages/insight/components/markdown-editor/index.tsx) — 各自本地 `useParams()` 取 `sessionId`（路由 `/insight/:id?`，Solid context 不受 `Portal` 影响，不需要逐层 prop 传递）
  - 桌面 IPC 内 `reuse-existing` 幂等逻辑：**幂等键 = 资源 URI**，落地映射持久化到 `.octo/<sessionId>/outputs/.materialized.json`（v7.1 修订 §3.3 / #90）——内存 Map 仅作进程内快路径，跨重启/重装靠磁盘清单存活
- **幂等性保持**：路径多了一层 sessionId，"已落地复用用户改过的那份"行为不变（v7.1 起幂等键=URI、由磁盘持久清单保证跨重启，见 §3.3）。
- **路径 C（write 产物）——服务端确定性重定向到 outputs（v5，取代 v4 的提示词约定）**：insight 会话里 `write` 的**相对 `filePath`** 由 server 插件 [octo-outputs-redirect.ts](../../../packages/opencode/src/agent/octo-outputs-redirect.ts) 在 `tool.execute.before` 重定向到 `<会话directory>/.octo/<sessionId>/outputs/`，模型只需给文件名、无需知道绝对路径。两道确定性闸门（`tool==="write"` 且 `session.agent==="octo_insight"`）把影响面夹死，绝对路径原样尊重。**不改上游 write 本体**（[write.ts](../../../packages/opencode/src/tool/write.ts)，相对路径原生 join 到 `instance.directory`=项目根）。
  - **为什么不再走「提示词约定」（v4 §②）**：绝对路径是运行时值、静态提示词写不了，v4 改成客户端每轮注入 `[输出目录] <绝对路径>` synthetic 指令纠偏——弱模型把这条常驻指令当当前任务复述、把路径暴露给用户（[learning](../../learning/standing-instruction-echoed-by-weak-model.md)）。重定向让绝对路径彻底退出对话上下文，暴露问题从根上消失。
  - **为什么不用启发式（前端事后搬运）**：write 意图无法从 tool part 可靠区分，一律 copy 是启发式误判（违反确定性原则）；改用「相对→outputs」这条确定性规则替代。实证 scratch 顾虑不成立——超长抽取全文落盘走专门的 `TRUNCATION_DIR`（[truncate.ts](../../../packages/opencode/src/tool/truncate.ts)），不经模型 write，故 outputs 不会被 scratch 污染。
  - 白名单天然可用：v2 白名单 [ipc.ts](../../../packages/desktop/src/main/ipc.ts) 已按分段放行 `.octo/<sessionId>/{uploads,outputs}`。

> 旧 v1 扁平数据（`insight/sources`、`insight/outputs`）：**不做迁移**。桌面 IPC 的 write-file 白名单改为只放行新的会话分桶路径，旧路径不再放行——Insight 的 tab 是纯内存 signal、不跨重启持久化，不存在"存活的 tab 引用旧路径"的场景，因此不会有半迁移状态。

---

## 5. 与 MCP 的边界（纯消费，不改其流程）

| 动作 | 归属 | 是否动 MCP |
|---|---|---|
| handle 注入格式 + `octo-upload-inject` 插件替换 | 现有胶水（我们侧）+ MCP 工具（他们侧） | **一行不改**（block 仍 `handle:真实url`）|
| S3 上传**时机**改造（→ 模型调 MCP 时按需上传）| 我们侧（自有上传服务）| 否——移至 [SPEC-INS-015](insight-file-passing.md)；本 spec 不动上传时机 |
| 提交 MCP 任务 / 查询 / resource_link 形态 | MCP 团队 | **一行不改** |
| 把 resource_link 结果**下载到 `.octo/<sessionId>/outputs`** | 我们侧新增 | 否——通过现有 `resource_link` 接口**读他们的输出**，不改他们的行为 |
| 源文件拷贝进 `.octo/tmps` → `.octo/<sessionId>/uploads` | 我们侧新增 | 否，与 MCP 无关 |

**责任交接点 = resource_link / 那份产物文件**：之前（原始分析质量）= MCP；之后（本地怎么存、怎么读、怎么二次改）= 我们。materialize 是纯消费动作，UXR 那份 S3 原件不动，随时可重新拉取对比"原版 vs 本地改过的"。

---

## 6. console 埋点（接入 [insight-debugging.md](../../insight-debugging.md) 日志字典）

| tag | 触发点 | 字段 |
|---|---|---|
| `[octo:worktree] ensure-dir` | 首次创建 `.octo/tmps`、`.octo/<sessionId>/uploads` 或 `.../outputs` | dir / created(bool) |
| `[octo:worktree] upload-copy ok/failed` | 源文件拷贝进 `.octo/tmps`（预会话区） | srcPath / dest / reason |
| `[octo:worktree] upload-move ok/failed`（v2 新增） | 发送时把附件从 `.octo/tmps` rename 进 `.octo/<sessionId>/uploads` | srcPath / dest / sessionId / reason |
| `[octo:worktree] result-materialize` | 产物落地 | filename / path / sessionId / reused(bool) |
| `[octo:insight-files] list-ok/list-failed`（v2 新增，客户端） | 文件管理 UI 拉取当前会话文件列表 | sessionId / category / count |

> 新增前缀需同步登记 [insight-debugging.md](../../insight-debugging.md)。

---

## 7. 不做（scope out）

| 项 | 去向 |
|---|---|
| `extract_document`（office→文本） | Spec B（独立分支）|
| `@` 引用所有文档类型的前端联想交互 | Spec C |
| 二次生成（读 uploads + outputs → edit） | 独立 spec |
| 本地解析能力 + 测量/护栏策略 | 能力线，逐个 spec（最后） |
| S3 上传时机改造（按需上传）| [SPEC-INS-015](insight-file-passing.md) —— 模型调 MCP 工具时由插件按需上传；本 spec 保持今天 eager |
| 图片附件改走 S3 URL（而非 base64）| [图片附件 spec](../ui/insight-image-attachment.md) |
| **跨会话聚合视图**（"整个项目下所有会话的文件"）（v2 新增排除项） | 未来独立 spec；本次目录结构不阻碍，`sessionId` 已是必填维度 |
| **会话删除后清理磁盘目录**（v2 新增排除项） | 不做，磁盘文件是用户资产，删会话不等于用户想删文件 |
| **inline 嗅探卡物化落盘**（v4 新增排除项） | 不做。路径 B（对话正文嗅探出的 mindmap/html 预览，[output-renderers §2.1](../ui/output-renderers.md)）是「对话内容的附加预览」而非文件产物，维持只在对话流内可见、靠用户手动「下载/另存」沉淀，不写 outputs。这是「文件管理 = 会话真产物库」定义的直接推论，见 v4 修订记录 |
| **下载/另存即回写 outputs（双写）**（v4 新增排除项） | 不做。action-bar 下载按钮（含转换派生格式如「Octo 白板」）维持纯手动另存到用户选定路径，不回写 outputs——落盘只对「真产物生成」负责，见 v4 修订记录 |
| 文件管理面板的删除/重命名/归档/批量操作（v2 排除项；v3 已补真上传+拖拽+多选选中态，见 §10.1） | 删除/重命名/归档/批量下载仍未做，后续按需扩 |
| 跨设备 / 云端同步 | 不做（单机本地盘已够；同步成本大收益弱）|

---

## 8. 验证步骤

> **验证前提**：本 spec 新增了服务端接口 `/insight/files`（§10，类型化 HttpApi，不是普通 Hono 路由）和主进程 IPC handler（`move-pending-upload-to-session`、改过签名的 `copy-file-to-worktree`/`download-resource-to-temp`）——这类改动需要重启本地 opencode server 进程（桌面端连带 Electron 主进程）才会生效，验证前先确认已重启。**若重启后仍 404，不要默认归因于"没重启"**——本 spec 开发过程中就真实踩过：新接口错写成普通 Hono 路由，怎么重启都没用，因为本仓开发/预览渠道默认的后端根本不跑那份代码（见 §10 踩坑记录 + learning 笔记 [hono-vs-effect-httpapi-routing.md](../../learning/hono-vs-effect-httpapi-routing.md)）。排查顺序：① 确认改的是类型化 HttpApi（`httpapi/groups/*.ts` + `httpapi/handlers/*.ts`）而不是普通 Hono 路由；② 用 `bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>` 直接跑源码 + `curl` 验证接口本身通不通，绕开 Electron 打包/进程重启这些变量；③ 都排除了再看是不是真的没重启。
>
> 下表「环境」列：**外网** = 桌面端本地随便一个项目目录就能复现，不依赖内网服务；**内网** = 依赖 MCP / UXR 工具等只在内网可用的服务。

| # | 操作 | 期望 | 环境 |
|---|---|---|---|
| 1 | 选项目目录，欢迎页（无 session）拖一个 .docx | 立刻 `<projectDir>/.octo/tmps/<name>.docx`（原样拷贝、格式不变）；`[octo:worktree] upload-copy ok` | 外网 |
| 2 | 发送第一条消息（带上一步的附件） | 文件被 rename 进 `<projectDir>/.octo/<新sessionId>/uploads/<name>.docx`；`.octo/tmps/` 下不再有它；`[octo:worktree] upload-move ok`；`[附件]` 清单路径是新路径 | 外网 |
| 3 | 走预置 → 触发 MCP | 与今天一致（eager 上传 + `[octo:inject] args rewritten`）；本 spec 未改此链路 | 内网（依赖 MCP） |
| 4 | 同名不同内容再导入（同一会话内） | 加后缀 `<name> (2).docx`，不覆盖；输入框 chip 与 `[附件]` 清单显示**带后缀的落地名** | 外网 |
| 5 | 触发 MCP 任务 → 完成、**卡片出现即刻（不点开）** | 产物**当场**落 `<projectDir>/.octo/<sessionId>/outputs/<file>`（v4 eager，不再需要点开）；文件管理「生成文件」段立刻能看到；`[octo:worktree] result-materialize` 带 `sessionId` | 内网（依赖 MCP 产出真实产物；本地也可用 write 工具产物代替验证落点） |
| 5b | 对话回复里含 ```mindmap / html fence（inline 嗅探出卡）| 卡片可预览，但 outputs 目录**不新增**文件、文件管理也不出现它（v4：inline 不物化落盘）；点该卡的「下载」另存到别处，outputs 仍不变 | 外网（本地构造含 fenced mindmap 的回复即可复现）|
| 6 | markdown 卡编辑 → 保存 → 关卡重开 | 回显改动（幂等工作副本仍生效，落点在 `.octo/<sessionId>/outputs`）| 外网 |
| 7 | 关 app 重开同一目录、同一会话 | `.octo/<sessionId>/uploads` `outputs` 里该会话的文件仍在 | 外网 |
| 8 | 新建第二个会话 | 文件管理 UI 只看到这个新会话自己的文件，看不到第一个会话的（**不再**跨会话共享，v1→v2 的核心行为变化）| 外网 |
| 9 | 不选目录 / 浏览器 __dev | 跳过本地拷贝；MCP 主流程不受影响（降级不报错）| 外网 |
| 10 | 文件管理面板拉取失败（如 `/insight/files` 404 或其他网络错误）| 只在文件管理面板内显示"加载文件列表失败 + 重试"，**不整页崩溃**（`FileManagerInner` 用 `try/catch` 收口 uploads/outputs 两段 `Promise.all` fetch，失败置 `store.error` → 面板内渲染重试按钮，不 `throw` 到 ErrorBoundary。注:v3 已从 v2 的 `createResource` 双 resource 改为手动 `refresh()` + store 收口,以对齐 Design 的取数形态）| 外网 |

---

## 9. 与下游 spec 的依赖

```
SPEC-INS-014（本 spec，地基）
  ├─→ Spec B  extract_document（office→文本，顺带返回字数）   依赖 uploads 在本地
  │     └─→ Spec C  @ 引用所有文档类型
  ├─→ 二次生成（读 uploads + outputs → edit）                  依赖两目录在本地（现按 sessionId 分桶）
  └─→ 能力线（本地解析 + 护栏，逐个）                          依赖 uploads + extract
```

每份 spec **独立分支、独立上线**，互不阻塞——本 spec 单独合入即兑现"源文件本地化 + 产物显性化 + 按会话隔离"，下游能力未就绪也有独立价值。

---

## 10. 文件管理 UI（v2 新增，取代 SPEC-INS-004 原草案）

[SPEC-INS-004](../ui/insight-workspace.md) 原草案设想的是一个 260px 常驻侧栏、四个 section（工作文件/上下文/记忆/上传文件）。本次实际选择了**站内 Make 模块已验证的模式**：`viewMode: "tabs" | "files"` 页面级切换（不是常驻侧栏，也不是 `tabStore` 里的一个不可关闭假 tab）——`ResultViewer` 顶部 TabBar 里一个"文件管理"pill，点击整块替换 tab 内容区；`viewMode` 默认 `"files"`，配合"面板常驻可见"（不再要求 `tabs.length > 0` 才显示）实现"进入会话就能看到文件"。

**打开产物 tab 时必须切回 `"tabs"` 视图**（v3 订正/补充）：`viewMode` 默认 `"files"`，若"打开+激活 tab"只 `openTab` 不切 `viewMode`，tab 虽加入却停在文件管理不显示（用户点对话产物卡片后看不到内容）。故凡"打开+激活 tab"的入口统一走 `focusResultTabs()`（`setResultViewMode("tabs")` + 展开面板）；关掉最后一个 tab 时落回 `"files"`。见 §10.1 末"连带修的一个 §10 回归"。

与 Make 的关键差异：Insight 的 worktree 是**扁平**的（无子文件夹），文件管理面板不需要 Make 那套文件夹导航（breadcrumb/navigateToFolder）。v2 直接是"已上传 / 已生成"两段平铺列表；**v3（§10.1）已升级为表格视图**（多选/表头排序/分组/类型筛选），两段作为可折叠顶层分区保留。

**服务端接口（重要：不是普通 Hono 路由）**：`GET /insight/files?sessionId&category=uploads|outputs`，列 `.octo/<sessionId>/<category>/`；不做 `/content`（复用现有 `source:"path"` tab 机制读文件）、不做 kind/mime 分类（复用客户端已有的 `resolveOutputType()`/`fileTypeIconUrl()`；v8 前此处写的是 `extToOutputType()`，该函数已随 SPEC-INS-026 §4.2 收敛进 `resolveOutputType`）。

> **「不做 `/content`」这条 v2 决定在 v8 重新生效**：7-18 引入的预览面板曾用 `/artifact/content` 读内容，v8 删掉它之后，产物内容的读取重回单一路径 —— IPC `readFileBuffer` 读原字节（[SPEC-INS-026](insight-artifact-identity.md) §5）。这不只是洁癖：该端点底层是 `File.read`，会对文本 `.trim()`，实测原文 `内容A\n` 经它返回成 `内容A`，**文件尾部换行被静默吃掉**。

> **实现踩坑记录**：本仓开发/预览渠道默认启用 `OPENCODE_EXPERIMENTAL_HTTPAPI`（`packages/opencode/src/core/flag/flag.ts`），启用后请求走的是**另一套基于 Effect 的类型化 HttpApi 系统**（`server/routes/instance/httpapi/groups/*.ts` 定义 endpoint schema + `handlers/*.ts` 实现），普通 Hono 路由文件（`server/routes/instance/*.ts`，如 `artifact.ts`）在这个后端模式下**完全不会被调用**——首版实现照抄 `artifact.ts` 的写法新写了一个 Hono 文件，排查了很久才发现整条代码路径是死的。正确做法：接口应加进已有的类型化 `insight` 分组（`httpapi/groups/insight.ts` 定义 `InsightFileListQuery`/`InsightFileListResult`/`listFiles` endpoint + `httpapi/handlers/insight.ts` 实现 `listFiles` handler，用 `InstanceState.context` 拿 `instance.directory`，不是普通 Hono 里的 `Instance.directory` 静态导入）。这个机制的详细说明见 learning 笔记 [hono-vs-effect-httpapi-routing.md](../../learning/hono-vs-effect-httpapi-routing.md)。

v2 本期范围：只读列表 + 点击以 tab 打开 + 本地打开/显示文件夹；不做删除/重命名/归档/批量操作/拖拽上传（见 §7）。**v3（§10.1）已补：真上传（文件选择器 + 拖拽落区，复用附件那条 copy→move 链路）+ 多选选中态**；删除/重命名/归档/批量下载仍未做。

> SPEC-INS-004 需要在文档顶部加交叉引用，标记"文件管理 UI 部分被本 spec §10 取代，实现细节以此为准"。

### §10.1 UI 打磨对齐 Design 模块（v3，已实施）

> 2026-07-09 落地。参照站内 **Design 模块**已上线的"文件管理"（`pages/make/components/design-files/` + `make/utils/artifact-file-store.ts`，用户内网实测"还原度高"），把 §10 的两段平铺列表升级为表格视图，**不抄它的存储层**（Design 存 `.octo/artifacts/make/`，Insight 按 §2 走 `.octo/<sessionId>/`——v7 后两者同在 `.octo/` 根下、各自命名空间）。Insight 自包含，未 import 任何 make 目录下的组件。

下表为已落地的对照结果（"Insight 实际做法"列即本次实现；与 sonnet 原草案不一致处已就地订正）：

| 缺口 | Design 模块参照实现 | Insight 实际做法（已落地） |
|---|---|---|
| 顶部工具栏：刷新 / 分组切换(类型⇄修改时间) / 类型筛选 / 上传 | `make/components/design-files/design-files-toolbar.tsx` | 新写 `file-manager/toolbar.tsx`；图标用 `@opencode-ai/ui/icon`（`upload`/`sliders`/`chevron-down`/`ellipsis`/`arrow-up`/`arrow-down`）+ Insight 自己新增的 `IconRefresh`（ui Icon 无 refresh）。**未** import make 的 `design-files-icons.tsx` |
| 分组：按修改时间分桶（今天/昨天/最近7天/最近30天/更早，各带 count，可折叠）+ 按类型分组两种模式 | `make/utils/artifact-file-store.ts` 的 `groupMode`/`modifiedGroups`/`kindGroups`/`createFileListComputed` | 新写 `utils/insight-file-store.ts`，照抄这套计算逻辑（与后端存储形态无关），换成读 `InsightFile[]`；砍掉 worktree 用不到的文件夹导航（`currentPath`/`navigateToFolder`/`upload-files` 前缀）。**视图状态（sort/filter/group/折叠）不持久化**，每次进面板回默认值——初版曾按 sessionId 写 localStorage（非设计决策，实现时自行追加，本表原为照代码回填），2026-07-28 移除：key 随会话数只增不减、无 TTL 无淘汰，而这类视图状态本不值得跨会话记忆，被对齐的 Design 模块自身也没有持久化 |
| 排序：点表头（名称/类型/修改时间）切换升降序 | `artifact-file-store.ts` 的 `sortKey`/`sortDir` + 表头点击 | 同上，在 `insight-file-store.ts` 里照抄 |
| 类型筛选：popover + 各类型 count | `artifact-file-store.ts` 的 `kindFilter`/`availableKinds`/`kindCounts` | **kind 在客户端派生，未动服务端**（订正 sonnet 原草案的"服务端 listFiles handler 里分类"——`listFiles` 已把 `name` 回给客户端,分类是纯展示逻辑,信息够;且 `extToOutputType()` 在 app 包、opencode 服务端 import 不到,照字面做等于服务端重写分类器 + 改一次类型化 HttpApi schema,按 [hono-vs-effect-httpapi 笔记](../../learning/hono-vs-effect-httpapi-routing.md) 能不碰服务端就不碰）。实现见 `insight-file-api.ts` 的 `fileKind()`/`kindLabel()`/`kindSortPriority()`,口径与 `fileTypeIconUrl()` 同源,枚举比 Design 的 12 类精简 |
| 多选：checkbox 列 + 全选 | `artifact-file-store.ts` 的 `selected`/`allPageSelected`/`somePageSelected` | 照抄为 `selected`/`allSelected`/`someSelected`；**只做选中态**，批量操作（下载/删除）未做 |
| 真上传：点"上传"接文件选择器 + 拖拽 | `design-files-toolbar.tsx` 的上传入口 + Design 自己的 `/artifact/upload` | **未新造上传通道**：`local-file-ops.ts` 新增 `copyFilesToSessionUploads()`,复用输入框附件那条既有链路——`copyFileToWorktree`（拷进预会话区 `.octo/tmps/`）→ `movePendingUploadToSession`（rename 进 `.octo/<sessionId>/uploads/`）。文件管理面板一定在真实会话里,故拷完直接归属本会话。支持文件选择器 + 拖拽落区 |
| 视图空态 / loading 态细节 | `design-files-panel.tsx` 的 loading/error/empty 三态 | 三态齐备：初次加载 Spinner、空态（插画 + 上传按钮，按钮色值/尺寸对齐 Design 的 `#0a59F7`/108×32）、错误态（面板内"加载失败 + 重试"）。错误处理见 §8 #10 订正 |

**没做（与 Design 有意不同）**：Design 的文件夹导航（`navigateToFolder`/breadcrumb）——insight worktree 扁平，没有子文件夹；`upload-files/` 前缀剥离逻辑同理不需要。批量下载/删除也未做（只做多选选中态）。

**落地文件清单**：
- `utils/insight-file-api.ts` — 加 `InsightFileKind` + `fileKind()`/`kindLabel()`/`kindSortPriority()`/`toInsightFile()`（客户端分类）
- `utils/insight-file-store.ts` — 新增，视图状态 store（Design `artifact-file-store.ts` 的精简端口）
- `components/file-manager/toolbar.tsx` — 新增，顶部工具栏
- `components/file-manager/index.tsx` — 改写为表格视图（按 sessionId `keyed` 重建以隔离会话状态）
- `utils/local-file-ops.ts` — 加 `copyFilesToSessionUploads()`
- `icons/index.tsx` — 加 `IconRefresh`

**连带修的一个 §10 回归**（viewMode 引入后暴露）：点对话里的产物卡片会 `openTab` 但不切 viewMode，`viewMode` 停在 `"files"`（文件管理）时 tab 虽已加入却不显示（用户停在文件管理空态、看不到内容）。修法：index.tsx 抽 `focusResultTabs()`（= `setResultViewMode("tabs")` + 展开面板），凡"打开+激活 tab"的入口（`handleOpenResult` / `handleTaskOpenResult` / pendingOpen effect / auto-open effect / `openFileFromManager`）统一走它。见 §10 viewMode 机制补充。

---

### §10.2 去掉预览面板第四栏，回归「点击以 tab 打开」（v8，已实施）

#### 起因：一次未登记的实现漂移

§10（v2）的原始决定是「只读列表 + **点击以 tab 打开** + 本地打开/显示文件夹」，并明确「**不做 `/content`**」。2026-07-18 `dc02357d8`「文件管理预览面板 + image 类型渲染支持」引入 `components/file-manager/preview-pane.tsx`：单击文件行不再开 tab，而是打开右侧第四栏，面板内容自己走 `/artifact/content` + base64 data URL 渲染。这一改动**没进 §10.1 的对照表，也没进落地文件清单**，于是同一个「预览产物」的需求在系统里有了两套实现。

产品侧已确认回归原始逻辑（2026-07-30）。

#### 症状与根因（内网实测 + 本地取证）

| 现象 | 根因 |
|---|---|
| md 产物从文件管理打开白屏，**再点一次才正常** | 单击 = 开预览面板（不是 tab）。面板 md 分支只把 markdown **源文本**塞进 `<div class="prose prose-sm max-w-none">`，而仓库**未装 `@tailwindcss/typography`**（`prose` 是空 class）、该 div 也**未设 `color`**（紧邻的 code 分支显式设了 `color: var(--octo-text-primary)`）。面板顶上还盖着一层 `absolute inset-0 z-10` 的透明蒙层（`cursor:pointer`，onClick = `onOpen`）——所谓「点击后就正常预览了」，是点中蒙层触发了 `openTab`，用户看到的是 **tab 的**渲染结果，面板始终是白的 |
| pdf / docx / pptx / xlsx / csv / zip / psd 在面板里**全空白** | 面板的 `Switch` 只覆盖 image/video/audio/html/markdown/code，**没有 default 分支**。实测枚举各扩展名的落点，上述七类均「无 Match」→ 渲染空 |
| 「聚焦项还在文件管理上、没聚焦到新 tab」 | 单击只开面板、`viewMode` 仍是 `files` —— **属既有设计，不是 bug** |
| 下载文本文件后尾部换行丢失 | `handleDownload` 直接走 `/artifact/content`（没走 IPC），底层 `File.read` 会 `.trim()` |

> 已排除的两个假设，避免下一个人重走：① **不是文件名的问题** —— 起源码 server curl 实测 `/artifact/content`，普通名与 `我的 报告(2).md`（v7.3 放开空格括号后的新形态）都返回 HTTP 200 + 完整内容；② **不是 SPEC-INS-026 那批改动引入的** —— `components/file-manager/` 在那四个 PR 里零改动，且 `fileKind("a.md")` 前后都是 `markdown`、稳定落 markdown 分支。

#### 决定

**删掉 `PreviewPane`（第四栏），单击文件行直接 `openTab` + `focusResultTabs()`。** 打开后的分流交给已有的唯一入口 `resolveOutputType`（[SPEC-INS-026](insight-artifact-identity.md) §4.2）：

| `resolveOutputType` | 打开后 | 说明 |
|---|---|---|
| `markdown` / `html` / `json` / `code` | 应用内渲染 | 代码类与纯文本类，即产品所说的「支持本地预览」 |
| `image` | 应用内 `ImageRenderer` | 已有能力，`local://` 协议读盘 |
| `file` | **FileFallback 中间页** | office / PDF / 压缩包 / 设计源文件 / **音视频**：本地打开 · 文件夹打开 · 下载 |

**这不是新增白名单，是删掉一套重复实现。** 收益是两个缺陷同时消失：md 从「白屏」变成与对话卡片同源的渲染；office/PDF 从「空白」变成「可用本地应用打开」——后者比改造前更好，不是妥协。

配套动作：

- 删 `components/file-manager/preview-pane.tsx`；删 `utils/insight-file-store.ts` 里的 `previewFile`/`setPreviewFile` 及其联动（删文件时清预览目标）。
- 行尾 `…` 菜单的「在标签页中打开」**保留**（产品确认）：单击已是该行为，菜单项冗余但不冲突，熟悉旧交互的用户仍能从菜单走。
- `handleDownload` 改为 **IPC `readFileBuffer` 优先、`/artifact/content` 兜底**，与旁边归档那处已有的写法对齐 —— 顺带修掉上表最后一行的 trim。
- `fetchInsightContent` 保留（归档与下载的非桌面端兜底仍要用），但产物**内容读取**不再经它。

**落地文件清单**（2026-07-30 实施，UXAI 分支 `refactor/insight-drop-preview-pane`）：

- 删 `components/file-manager/preview-pane.tsx`（204 行，含它自带的那套无 default 的 `Switch`）
- `components/file-manager/index.tsx` — 删 `PreviewPane` import 与第四栏渲染块；删 `handlePreview` 及埋点 `files-preview-file`；`onPreview` prop 从 `FileTable`/`GroupedRows`/`FileRow` 三处签名与 5 处透传清掉；`FileRow.handleClick` 的文件分支改走 `onOpen`（文件夹分支不变）；抽 `readFileBlob()`（IPC `readFileBuffer` 优先、`fetchInsightContent` 兜底）供 `handleDownload` 用；连带合并只为容纳第四栏而存在的横向 flex 外层容器
- `utils/insight-file-store.ts` — 删 `previewFile`/`setPreviewFile` 信号、返回对象里的两处导出、`deleteFile()` 与切路径 effect 里的「清预览目标」联动
- `components/file-manager/open-in-tab.test.ts` — 新增，W1–W3 共 27 个用例
- `pages/insight/docs/tracking.md` · `tracking-plan.md` — 删 `files-preview-file` 条目；`files-open-in-tab` 的触发时机补注「单击文件行 / 行尾菜单」

> **实施时与本节字面的一处出入**：本次基于 `dev` 落地，而 `dev` 上的分类入口当时仍叫 `extToOutputType()`（在 `utils/write-output.ts`）—— 它就是 [SPEC-INS-026](insight-artifact-identity.md) §4.2 收敛后 `resolveOutputType()`（`utils/output-type.ts`）的前身，同一个函数体、同一份扩展名白名单。页面级 `openFileFromManager` 本来就在调它，**本次未改分类逻辑一行**，只是把单击事件接到了这条既有链路上；026 那条链进 dev 后该调用点随改名一起变。W1–W3 用例起初断言 `extToOutputType`，随改名迁移。
>
> **为什么 026 当时不在 dev 上**（值得记一笔，属实施期发现的仓库状态问题）：026 的四个 PR 串行叠加在底座分支 `fix/insight-landing-name` 上，合并时顺序反了 —— 底座 #482 于 12:37:49 先合进 `dev`，#483/#484/#485 在 12:38–12:39 才合进那个底座分支。四个 PR 在 GitHub 上都显示 MERGED、界面全绿，**但后三个（`resolveOutputType` 单一入口收敛、table 退役、产物身份改磁盘路径）的内容从未进入主干**。核对方式：`git grep -l resolveOutputType origin/dev -- packages/app` 零命中、`git rev-list --left-right --count origin/dev...origin/fix/insight-landing-name` = `103 6`。补救见 UXAI PR #505（把那 6 个 commit 带进 dev；文本零冲突，仅一处语义冲突——dev 侧新增的归档链路 `action-bar.tsx` 还留着已退役的 `case "mindmap"`/`case "table"`）。**教训**：串行叠加的 PR 链，底座合进主干那一刻上层若还没落到底座上，上层就会静默留在原地，而 PR 状态不会提示这一点。

#### 音视频预览：第二步，且不沿用 base64

用研素材里音视频占比很高，要做。但**不复用 Design 那套 base64 data URL**：内容要先过 `/artifact/content`（会 `.trim()`、二进制走 base64）再在渲染端拼成 data URL，体积膨胀 33%、整份进内存，一段几百 MB 的访谈录像直接不可行。

正确做法是走 `local://` 协议（`ImageRenderer` / `HtmlRenderer` 已在用），但**当前实现还不够**，第二步要先补：

1. **`local://` 支持 Range 请求**。现状 [windows.ts](../../../packages/desktop/src/main/windows.ts) 的 handler 是 `await readFile(absolutePath)` —— 一次性读全文件、返回完整 Response，不解析 `Range`、不回 `Accept-Ranges`/206。后果是大文件全量进内存，且拖进度条体验差。改法：解析 `Range` 头，用 `createReadStream(path, { start, end })` 返回 206 + `Content-Range`（`protocol.handle` 支持返回 `ReadableStream`）。
2. **补 mime 表**。现状只有 `mp4/webm/mp3/wav`，**`.mov` 不在其中**（iPhone/相机录像最常见），会落到 `application/octet-stream`、`<video>` 直接播不了。至少补 `mov/m4v/mkv/m4a/aac/flac/ogg`。
3. **类型集扩展**。SPEC-INS-026 §4.2 刚把 `OutputCardType` 收敛为 6 个并写明「收敛后不再增减」，加音视频需要在 026 里显式修订那句话并给出理由，不能默默加第 7 个。倾向新增单一 `media` 类型（渲染层按 mime 决定 `<video>` 还是 `<audio>`），而不是 `video` + `audio` 两个。
4. **验证面**：几百 MB 大文件的内存占用、seek 是否可用、`.mov`/`.m4a` 能否解码（Electron 的 Chromium 不含全部专利编解码器，**H.265/HEVC 很可能播不了** —— 这条要先验，若不支持则该格式仍回落中间页）。

在第二步落地之前，音视频走中间页用系统播放器打开 —— 这也不算纯粹的降级：研究员看录像本来就要拖进度条、变速、看波形，系统播放器在这些事上比应用内 `<video>` 强。

> **Design 侧同款问题**（`pages/make/components/design-files/preview-pane.tsx` 有一模一样的 `prose` + base64 写法）**不在本 spec 范围**，此处仅作事实记录，不代表 insight 侧要去改 make。

#### 验证（全部可在外网本地复现，无需内网数据）

自动化：

| # | 断言 |
|---|---|
| W1 | 全仓 `grep -rn "PreviewPane\|previewFile" pages/insight` 无残留（`preview-pane.tsx` 已删、store 字段已清） |
| W2 | 表驱动断言「文件管理单击 → 打开后走哪条渲染」：`.md/.html/.json/.txt/.py` → 应用内渲染；`.png/.svg` → `image`；`.pdf/.docx/.pptx/.xlsx/.csv/.zip/.mp4/.mp3/.mov` → `file`（中间页）。**没有任何扩展名落到「无分支」** —— 这条正是原面板 Switch 缺 default 的回归防线 |
| W3 | `resolveOutputType` 是唯一分类依据：文件管理入口与对话卡片入口对同一文件名得出相同结论 |

W1–W3 已实现于 `components/file-manager/open-in-tab.test.ts`（27 用例全过）。实测基线：`cd packages/app/octoapp/pages/insight && bun test` → 149 pass / 36 fail，失败数与改动前持平（36 个既有失败是 `debug-observer`/`error-beacon` 缺 happydom preload 报 `window is not defined`，与本次无关），无 `error:` 开头的模块加载失败。另：仓库根 `bun run typecheck` 12/12 过、`packages/app` 的 `vite build` 过。W4–W11 需在真实会话的文件管理面板里点击，**尚未跑**。

手工（`bun run dev:desktop`，打开步骤见 [development.md](../../development.md) §7.1）：

| # | 步骤 | 期望 |
|---|---|---|
| W4 | 上传一个 md，在文件管理**单击文件行** | **一次点击**直接开 tab 并聚焦（不再是「白屏 + 再点一次」）；内容与从对话卡片打开时**完全一致**（同一个渲染器） |
| W5 | 单击一个 docx / pdf / xlsx | 开 tab 进中间页，「本地打开 / 文件夹打开 / 下载」三按钮可用（改造前这里是空白面板） |
| W6 | 单击一个 mp4 / mp3 | 开 tab 进中间页，「本地打开」能唤起系统播放器 |
| W7 | 单击一个 png | 应用内直接显示图片 |
| W8 | 单击文件夹 | 仍是进入下一层（不受本次影响） |
| W9 | 行尾 `…` → 「在标签页中打开」 | 与单击同效，且不会开出第二个 tab（走 SPEC-INS-026 §6.1 的路径去重） |
| W10 | 一个末尾带空行的 md，用行尾 `…` → 「下载」，`tail -c 4 <file> \| xxd` | **尾部换行仍在**（下载改走 IPC 后不再被 `File.read` 的 `.trim()` 吃掉） |
| W11 | 同一个文件先单击打开、关掉 tab、再单击打开 | 每次都正常显示内容，不出现白屏 |
