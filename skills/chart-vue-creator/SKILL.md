---
name: chart-vue-creator
description: 面向 B 端数据分析的图表设计与实现。用 ECharts 生成 Vue 页面,在真实脚手架里编译渲染并交付可运行的工程。当用户要做图表、看板、数据可视化,或要改图表、看效果、拿代码时使用。
version: 1.2.0
---

# chart-vue-creator

把设计师的分析需求变成图表方案,再变成 `.vue` 页面,**在真实脚手架里编译**,把预览地址交给 Design 渲染。

交付物是开发能直接 `yarn install && yarn serve` 跑起来的标准工程,不是任何中间产物。

**本文件分两段**:上半段是图表设计方法(选方法、选规范、数据语义),下半段是工程流程与硬约束(环境、编译、预览、导出)。
**两段冲突时以下半段为准** —— 它是门禁,不是建议。

---

# 上半段 · 图表设计

## 核心规则

- 按用户目标选择方法和载体,再应用适用规范。已有定义沿用;未定义部分作为本次设计建议,不因规范缺口停止生成或换图。实际冲突先核对适用范围,再说明取舍,不假称全部合规。
- Method 05 在任务适配时首选平行坐标;用户指定其他载体或实际不适配时按任务调整,不将个案改成默认方法。
- 保留原值、单位、时间、对象身份及缺失语义;不自行建立业务评分、权重、阈值或已确认根因。案例参数只在其来源场景适用。
- 用户指定领域优先;领域不明用中性、明确标记的示例数据,不从方法案例推断行业。内部组件/API 未提供时不声称已接入。

## 设计流程

1. 确定分析目标、对象/指标、数据与输出媒介;仅缺少关键业务信息时澄清。单指标排序、明确图表请求和规范咨询可直接处理。
2. 需要方法匹配时读取[路由表](design/01-router/route-map.md),选一个主方法,必要时最多两个辅助方法;状态以[方法索引](design/02-methods/index.md)为准。读取选中的短卡及其按需引用;待实现方法按路由表回退。相邻任务难区分再读[路由详解](design/01-router/method-router.md),旧编号请求读[编号迁移](design/01-router/id-migration.md)。
3. 按下表加载实现所需资料,完成方案或原型。使用 ECharts 时先核对所需能力;无法实现或需要其他技术配合的部分,按能力边界规则主动告知用户。只检查本次需要及已承诺的能力,分别记录实际验证与未验证部分。
4. 先说明"要判断什么 → 推荐方案 → 关键交互";**要出原型就走下半段的工程流程**,交付以 `verify` 通过的工程为准,并简述示例数据、处理口径和适用边界。内部路由、规范清单不默认放进产品界面。

## 原型交付硬门槛

- **本 skill 的承载环境固定是既有 Vue 工程**(下半段那套脚手架 + 管道),遵从它的目录、依赖、编译门禁、预览和导出机制。上游规则里"无承载工程时默认 Vite"那条分支在这里**永远不适用** —— 不要另建第二个 Vite 工程。`index.html` 只是工程入口,单独一个 `.html` 不能当成完成产物;用户明确要求单文件/离线 HTML 时才走那条路。
- 接入既有工程的通用原则见[承载工程规则](design/03-references/prototype/hosted-project.md);**本环境的具体命令、路径与失败码全部在下半段**,两处冲突时以下半段为准。
- 「半导体四箱体、640→420px、散点/密度短线、截图窗口」这一匹配案例可从[四箱体骨架](design/04-assets/semiconductor-four-box-vue/)取逻辑与组件,**但只取适用部分**:它是独立 Vite 工程,`echarts/core` 按需注册的写法、`vite.config.ts`、测试依赖、目录结构**一概不要照搬**(本环境要求全量引入,见硬约束 3)。其他任务不要套用这个案例。
- [产物门槛](design/03-references/prototype/delivery-gates.md)里"新建独立默认工程"那节及其 `check_prototype.py` **不适用本环境**,不要执行;既有工程那节的验收要求(目标尺寸、交互、图片导出分别记录实际证据)照常适用。

> ⚠️ **不要执行 `design/` 下的任何脚本。** 那些是上游包自用的检查工具(维护期跑的),在本环境里既不适用、也不是验证手段;本环境唯一的门禁是下半段的 `verify.mjs`。

## 按需读取

| 任务 | 入口 |
| --- | --- |
| 生成任何图表原型 | 先按[规范索引](design/03-references/chart-spec/index.md)选择规范:用户指定优先,明确半导体项目用半导体,其余默认 HD;仅加载所选规范及适用专项;[生成与验收](design/03-references/prototype/generation-review.md) |
| 交互网页原型 | **走下半段的工程流程** —— 技术栈固定 Vue 3 + TypeScript + ECharts,在真实脚手架里编译,不另起 Vite 工程;通用原则见[承载工程规则](design/03-references/prototype/hosted-project.md) |
| 目标尺寸 / 交互 / 图片导出的验收要求 | [产物门槛](design/03-references/prototype/delivery-gates.md)的「目标尺寸和交互」与「最终状态」两节(跳过"新建独立默认工程") |
| 工程交接说明 | [Handoff 交付](design/03-references/prototype/handoff.md):内容要求照它写,但文件落在 `<WRITE_DIR>/<页面名>/HANDOFF.md`,"验证与限制"按硬约束 2 的分层写法记录 |
| 桌面端图表有 Hover 提示 | [通用 Tooltip 组件](design/03-references/chart-spec/components/tooltip.md):按任务/数据结构选择触发与布局 |
| 使用 ECharts 实现 | [能力边界与告知](design/03-references/prototype/echarts-capabilities.md) |
| 明确要求单文件或离线 HTML | [HTML 交付](design/03-references/prototype/html-prototype.md) |
| 平滑、聚合、拟合、采样、归一化、排名或评分 | [数据语义](design/03-references/data-semantics.md)中与处理相符的部分 |
| 单项规范咨询 / 整理新增规范 | 分别通过[规范索引](design/03-references/chart-spec/index.md)读取相关文件 / [规范结构](design/03-references/chart-spec/schema.md) |
方法分支、案例和历史兼容由对应短卡维护。仅半导体快照参考复现或复用其算法时按 Method 03 读取源 HTML;普通概览不加载该资产。版本历史不参与当前规则裁决。

---

# 下半段 · 工程流程

```
⓪ 确认 node  →  ① ensure-env  →  ② new-session  →  ③ 写代码  →  ④ verify  →  ⑤ 输出预览
  (没有就装)                                          ↑             │
                                                      └── 验证未过 ──┘  循环至通过

⑥ export-zip   ← 用户说"导出代码/打个包/给我代码"时才跑
```

**③④⑤ 是一整轮,用户每提一次修改就完整走一轮。** ⑤ 不是"第一次生成时做一遍"就完事的收尾步骤 ——
改一次代码、verify 通过一次,就要重新输出一次预览卡片。理由见 ⑤。

脚本都在本 skill 的 `scripts/` 下,**除 ⓪ 的安装脚本外都要 node 才能跑**。
环境就绪后直接 `node scripts/xxx.mjs`;共享池 node 的路径由 `ensure-env` 的 `ENV_DIR` 给出。

**会超过 2 分钟的命令要显式给 shell 工具传 `timeout: 600000`**:⓪ 的安装脚本、① 里 `HINT:` 给出的安装 / 升级命令、④ 的 `verify`。
shell 工具默认 2 分钟就掐断,而装环境要几分钟、首次编译要 1–3 分钟 —— 被掐断就拿不到 `RESULT:` 那一行。

所有脚本的输出都是固定格式,**先读 `RESULT:` 那一行再决定下一步**:

```
RESULT: OK
KEY: value …

RESULT: FAIL | <CODE>: <原因>
HINT: <可直接执行的下一步>
```

### ⓪ 确认 node —— 机器上没有 node 时,**装它是你的活,不是用户的**

先跑 `node -v`:

| 结果 | 怎么办 |
|---|---|
| 有版本号输出 | 直接进 ① |
| `command not found` / `不是内部或外部命令` | **机器上没有 node。这不是"环境缺失、如实告知"就完事的情况** —— 装环境本来就在这个 skill 的职责范围里(设计师全程不该接触任何安装命令)。直接跑下面的安装脚本 |

```bash
# macOS
bash "<skillDir>/scripts/install/install.sh"
```
```powershell
# Windows
powershell -ExecutionPolicy Bypass -File "<skillDir>\scripts\install\install.ps1"
```

`<skillDir>` 就是**本文件(SKILL.md)所在的目录**,照着拼绝对路径,不要去猜 `.octo/skills/` 之类的位置
—— 这一步跑不了 `ensure-env`,拿不到它 `HINT:` 里那个已经展开好的路径,只能靠这条。

**这两个脚本是 bash / PowerShell 原生的,不需要机器上先有 node** —— 没有 node 它们会自己下载
portable node 到共享池。这是整套流程里唯一能在裸机上跑起来的东西,所以没有 node 时**只能从它开始**,
不要试图先跑任何 `.mjs`。

> **机器上已经有能跑的 node 时它们会直接复用**(任意大版本,不设门禁),于是**不读 manifest、
> 也不下载那 50MB 的 node 包**。日志里 `[node] 来源: system` 就是走了这条路,
> **不要因为"没看到下载"就以为它没装**。
>
> ⚠️ 跳过的只有"弄到一个 node"这一段。**后面装 yarn、装那 1GB 依赖照样要连内网 npm 源** ——
> 首装该花的几分钟一分不少。

> macOS 上 `install.sh` **不需要 `python3`,也不需要 Xcode 命令行工具**(JSON 用系统自带的 `osascript` 解析)。
> **不要让用户跑 `xcode-select --install`,也不要自己调 `python3` 排查** —— 没装命令行工具的 Mac 上
> `python3` 只是个占位程序,一运行就给用户弹安装窗,而且内网多半装不上。安装失败按 `RESULT:` / `HINT:` 原文走 0.2 表。

装环境要几分钟,告诉用户正在装。装完回到 ①。

### ① `ensure-env.mjs` —— 每个对话开头跑一次

```bash
node scripts/ensure-env.mjs
```

| `RESULT: FAIL` 的 CODE | 怎么办 |
|---|---|
| `ENV_MISSING` / `ENV_OUTDATED` / `ENV_NODE_MISMATCH` | **直接执行 `HINT:` 里那条命令**(安装/升级脚本),完成后重跑 `ensure-env`。这一步可能要几分钟,告诉用户在装环境 |
| `SKILL_NOT_ASSEMBLED` | 停下。这是 skill 没在内网组装好,**不是用户能解决的问题**,如实说明并给出 `HINT` 里的路径 |
| `WARN:` 开头的行 | 不阻塞,不用管,更不要转述给用户(**仅限 `ensure-env` 的 WARN**:那些讲的是环境,不是你的代码。`verify` 的 WARN 讲的是你写的页面,必须处理,见 ④) |

**装不上时先跑这两条,再报给用户** —— 别让用户自己去猜是网络、代理还是证书。
两条各答一个问题,**都要跑**:

```bash
# ① 环境快照:这台机器上有什么、本进程看到的代理变量是什么
node scripts/doctor.mjs

# ② 网络:内网资源到底拉不拉得到(macOS)
bash "<skillDir>/scripts/install/install.sh" --check
```
```powershell
# ② 网络(Windows)
powershell -ExecutionPolicy Bypass -File "<skillDir>\scripts\install\install.ps1" -Check
```

**把 `OCTO_FASTUI_DOCTOR` 那整段、以及 `--check` 的整段输出原样贴给用户**,并指出异常的那几行
(比如 `PROXY_HTTP_PROXY` 有值、`ASSET_DARWIN_ARM64: HEAD=403`、`SKILL_ASSEMBLED: NO`)。
这些是环境问题,该由人处理,你绕不过去 —— 见硬约束 0.1。

> **两条命令必须由你(agent)在自己的进程里跑,不能转述给人去终端执行。** 代理这类问题
> 只存在于 agent 宿主进程的环境里:2026-09-08 内网实测,人在终端跑得到"一切正常",
> 而 agent 在同一台机器上同时报 504。**诊断跑错环境,比不跑更糟。**

### ② `new-session.mjs` —— 选定工程:新建,或者接着改已有的

**`--artifact-dir` 的取值只有两条规则,都取原值,不要自己拼、不要取上一级:**

- 上下文里有 **[Artifact Folder]** → 用它
- 没有 [Artifact Folder]、有 **[Workspace]** → 用它

**先列出已有工程:**

```bash
node scripts/new-session.mjs --artifact-dir="<按上面规则取值>" --list
```

`PROJECTS_BEGIN`…`PROJECTS_END` 之间每行一个工程:`产物名 | 标题 | 最后修改时间 | this-session: yes/no`。
`this-session: yes` 是本对话用过的工程。

**再决定用哪个:**

| 情况 | 做法 |
|---|---|
| 列表为空 | 直接新建,不问 |
| 本对话已经用过某个工程(`this-session: yes`) | 沿用它,不问。用户明确说「新做一个」才新建 |
| 用户明确指向已有工程(「接着改那个看板」「在审批系统里加个页面」) | 用它的产物名加 `--reuse`,不问 |
| 用户明确要新建(「新建一个工程」「另做一个和之前无关的」) | 起一个列表里没有的产物名,不问 |
| 其余情况(「做个新页面」「加个功能」这类说法)且列表不为空 | **用 question 工具问一次** |

**拿不准就问。** 两种判断错误的代价不一样:误判成新建只是多一个工程,用户看得出来、说一句就能纠正;
误判成接着改会改动已有的代码,而这些工程没有版本管理,改坏了很难恢复。
**接着改别的对话建的工程,前提必须是用户明确提过,或者在提问里选了它。**

提问固定用这个格式,每个已有工程一个选项,最后加「新建工程」:

```
question({ questions: [{
  header: "选择工程",
  question: "当前工作区已有以下工程。这次的需求要基于哪个继续开发,还是新建一个?",
  multiple: false,
  options: [
    { label: "继续开发「月度销量看板」", description: "sales-monthly" },
    { label: "新建工程", description: "单独建一个新工程" }
  ]
}]})
```

- 选了「继续开发」→ 用对应 `description` 里的产物名,加 `--reuse`
- 选了「新建工程」→ 起一个列表里没有的产物名
- 用户自己填了内容 → 按字面意思理解
- 没有 question 工具时 → 在对话里列出同样的选项,然后**结束本轮**,等用户回复再继续

**除了这里,不要因为别的事用 question 工具问用户。**

**然后建工程,或者打开已有工程:**

```bash
# 新建,或者打开本对话的工程
node scripts/new-session.mjs --artifact-dir="<同上>" --name="<产物名>" --title="<一句话中文描述>"
# 接着改别的对话建的工程
node scripts/new-session.mjs --artifact-dir="<同上>" --name="<已有产物名>" --reuse
```

- `--name`:简短的英文/拼音工程名,新建时不能和列表里已有的重名
- `--title`:一句话中文描述(如「月度销量看板」),会显示在列表和提问里

记住返回的三个值,后面都要用:

- `PROJECT_DIR` —— 工程目录,④ `verify` 和 ⑥ `export-zip` 都传它
- `WRITE_DIR` —— **你唯一可以新建文件的目录**
- `ENTRY_FILE` —— 聚合入口,**唯一允许你修改的既有文件**

返回里有 `REUSED_FROM: other-session` 时,在回复里告诉用户「正在修改已有工程 <TITLE>」。

| `RESULT: FAIL` 的 CODE | 怎么办 |
|---|---|
| `NAME_TAKEN` | 这个产物名被占用了(别的对话的工程、别的 skill 的工程,或者用户自己的文件夹)。按上表判断:该问就问,要新建就换一个名字。**那个目录不要动** |
| `OUTSIDE_WORKSPACE` | `--artifact-dir` 取错了,按上面两条规则重新取值 |
| `HOST_OUTDATED` | 环境问题,不是你的问题。把 `RESULT:` 与 `HINT:` 原样告诉用户(需要先升级 Octo),不要自己绕 |
| `PROJECT_INCOMPLETE` | 见硬约束 0 末尾 |

这一步**不分配端口**。预览地址由 Octo 在用户点开预览时当场给出,你不需要、也不应该记任何端口号。

### ③ 写代码 —— 边界见下面「硬约束」

### ④ `verify.mjs` —— 编译门禁

```bash
node scripts/verify.mjs --project-dir="<new-session 返回的 PROJECT_DIR>"
```

记得给 shell 工具传 `timeout: 600000`(见「工作流」开头)。`--project-dir` **取 ② 里 `new-session` 返回的 `PROJECT_DIR` 原值**,不要从 [Artifact Folder] 或 [Workspace] 自己推路径。

dev server 起不来时(比如宿主环境不允许后台进程存活),可以让用户手工起一个,再用 `--port` 接管:

```bash
# 用户在 <PROJECT_DIR>/packages/portal 下跑 yarn serve,记下端口
node scripts/verify.mjs --project-dir="<PROJECT_DIR>" --port=8081
```

- `RESULT: OK` → 拿 `PREVIEW_CARD` 走第 ⑤ 步
- `RESULT: FAIL | COMPILE_ERROR` → **读 `ERRORS_BEGIN`…`ERRORS_END` 之间的原文**,里面有 `file:line`,
  按它改代码,然后**再跑一次 verify**。改完必须重新验证,不要凭感觉判断
- `RESULT: FAIL | MISSING_VUE_IMPORT` → 你用了 `ref` / `computed` / `onMounted` 这类 vue 的 API 却没 import。
  **编译能过,但运行时 `ReferenceError`、页面整片白**。读 `MISSING_IMPORTS_BEGIN`…`MISSING_IMPORTS_END`,
  里面直接给出了要补的那行 `import { … } from 'vue'`,补到块里点名的那个文件顶部,**再跑一次 verify**
- `WARN: … 用了 X 但没有 import`(组件,不阻塞)→ **照样必须回去补**,别因为 `RESULT: OK` 就当作做完了
- `RESULT: FAIL | HOST_START_FAILED` → Octo 启动预览服务失败,**这是环境问题,不是你的代码问题**。
  不要改 `.vue` 重试,也不要自己去起服务;把 `RESULT:` 与 `HINT:` 两行原样告诉用户
- 首次编译要 1–3 分钟,属正常
- 等待期间 verify 每 30 秒往 stderr 打一行 `[wait] STAGE: … | WAITED: … | LOG_VS_EDIT: …`,**看到它就说明脚本还在等,不是卡死**
- **整条命令被超时掐断(没看到 `RESULT:` 那行)时**:不要去翻 dev server 日志、拿里面的 `Compiled successfully` 判定"编译已通过、是脚本的问题"
  —— 那条很可能是更早一轮编译留下的。把最后一行 `[wait]` 原样报给用户;其中 `LOG_VS_EDIT` 是负数 = 你改完文件后 dev server 一个字都没输出
  (它没收到这次改动),属环境问题,改 `.vue` 重试没有用

> ⚠️ **上面这几条都是你自己的代码问题,按提示改完重跑就是了 —— 不要当成"脚本报错"转述给用户。**
> §0.1 那条"把 `RESULT:` / `HINT:` 原样告诉用户"针对的是环境类失败(装不上、拉不到、起不来),
> 不是编译错误和漏 import。

**唯一的例外:`COMPILE_ERROR` 里还带着一行 `NODE_SUSPECT:`。**

这一行只在命中已知的**运行时不兼容指纹**时才出现(node 大版本与老构建链不兼容、原生模块 ABI 不匹配)。
出现时把 `NODE_SUSPECT:` 和 `HINT:` 两行**原样转达给用户**并照 `HINT:` 给出绕法,
**不要去改 `.vue`** —— 错误不在你的代码里。没有这一行就按上面那几条处理。

> ⚠️ **`verify` 验的是"编译通过",不是"图画对了"。** 它不会打开浏览器看。
> 图表尤其容易"编译全绿、页面一片空白"(容器高度塌成 0、option 结构不对、数据没进去),
> 这类只能靠设计师在预览里看。所以 ⑤ 不能省。

### ⑤ 输出预览 —— 每一轮都要做,不能省

`verify` 返回 `RESULT: OK` 之后,**必须把 `PREVIEW_CARD:` 后面那一整行原样输出**,例如:

```
<artifact type="text/link">fastui://yield-dashboard</artifact>
```

**不要自己拼这一行,不要改成 `http://127.0.0.1:<端口>`,更不要把 `fastui://` 换成别的协议名** ——
宿主只认这一个 scheme(它是预览卡片的注册标识,与本 skill 叫什么名字无关)。卡片只记产物名、不记端口:
端口会过期,记着端口的卡片点进去会显示别人的页面;产物名不会过期,Octo 在用户点开卡片时当场找到或启动对应的服务。

Design 靠这个标签渲染预览面板。**只有这个标签会被识别** —— 用别的形式给链接(纯文本 URL、markdown 链接、
代码块)都不会出卡片,用户就只能自己开浏览器,等于白做。

**这一步没做,整件事就不算完成**,和编译不通过是同等级别的未完成。

#### 每一轮都要输出,和上一轮一模一样也要输出

改页面、修 bug、调样式 —— 只要这一轮跑了 `verify` 且拿到 `RESULT: OK`,就要重新输出一次这一行,
**哪怕它和上一轮逐字相同**。

这不是冗余。设计师经常同时开好几个对话,**切走再切回来时预览面板会被清空**,
他回到预览的唯一入口就是对话里**最近的那张卡片**。你这一轮省掉,他就得往上翻找几轮前那张 ——
页面已经改过好几版了,卡片却停在旧位置。

重复输出没有任何代价:卡片只记产物名,点进去是同一个工程的同一个服务(Octo 按产物名复用),
不会多起服务、不会多占端口、不会多开预览面板。

### ⑥ `export-zip.mjs` —— 用户要代码包时

```bash
node scripts/export-zip.mjs --project-dir="<new-session 返回的 PROJECT_DIR>"
```

用户说「导出代码」「打个包」「把代码给我」之类的话时跑,产出 `<PROJECT_DIR>/.octo-fastui/export/<产物名>.zip`,
把 `ZIP_PATH` 告诉用户。

**只有这个脚本产出的包是干净的。** 产物目录里的 `node_modules` 是指向共享池的链接,
直接压缩整个目录会跟随链接把 1GB 依赖打进去;这个脚本会跳过链接并排除构建产物。

---

## 硬约束

### 0. 绝不删除用户磁盘上的任何东西 —— 这条没有例外

**禁止执行任何删除命令**:`Remove-Item` / `rm` / `rmdir` / `del` / `git clean`,不论加什么参数、
不论那个目录看起来多像垃圾残留。清理由 skill 脚本在共享池和工程目录内自己做,那是脚本的职责,不是你的。

2026-09-07 内网真实发生过:Windows 上中文路径建链接失败,PowerShell 把中文目录名显示成乱码,
agent 把用户的正常目录当成"失败操作留下的残留",执行 `Remove-Item -Recurse -Force` 永久删除 ——
绕过回收站,不可恢复,用户的资料没了。

**你在终端里看到的乱码目录名,极可能是完全正常的中文目录。** 编码显示问题从来不是删除的理由。

| 情况 | 正确动作 |
|---|---|
| 建链接 / 复制失败,目录看起来是残留 | 原样报告失败,让用户自己看那个目录 |
| 装不上,怀疑共享池坏了 | 跑 `doctor`,把输出给用户;要不要重装由用户决定 |
| 目录名是乱码,不确定那是什么 | **什么都别做**,把路径原样贴给用户 |

同理禁止:用 `sudo`(agent 没有交互通道,会静默挂住等密码)、改用户机器的**全局配置**
(`~/.npmrc`、shell profile、系统代理设置)。那些不是你能替用户决定的。
—— 脚本自己的开关(如 `--env-dir` / `--proxy` / `OCTO_FASTUI_ENV_DIR`)不在此列,该传就传。

**需要清理时,脚本会给你合法出口。** 目前只有一处:`new-session.mjs` 报 `PROJECT_INCOMPLETE`
时,按 `HINT:` 加 `--reset` 重跑,由脚本自己删掉残骸并重建(它会先校验目标是本 skill 建的工程)。
除此之外,任何"清理"都是报给用户、由人决定。

### 0.1 不要绕过脚本

脚本失败时,**唯一正确的动作是按 `HINT:` 处理或如实报告失败**。以下这些"看起来能绕过去"的做法一律禁止:

| ❌ 禁止 | 为什么 |
|---|---|
| 自己跑 `yarn serve` / `yarn dev` 代替 `verify` | 绕过 verify 就没有编译门禁,你会开始"我觉得应该好了";而且在 Octo 里预览服务由宿主统一起停,自己起的进程宿主收不到,关掉 Octo 后会一直占着端口 |
| 修改、调试 `scripts/` 下的任何文件 | 那是 skill 的一部分,不是本次任务的产物。脚本有 bug 应该报告,不是就地改 |
| 环境装不上就换个方式硬凑一个能跑的 | 装不上是环境问题,该由人处理。你绕过去之后跑起来的东西,和设计师机器上的不是同一个。**但注意:「机器上没装过 node」不算装不上,那是你该去装的,见 0.2** |

**脚本报错不是让你想办法绕开的障碍,是让你转达的信息。** 把 `RESULT:` / `DETAIL:` / `HINT:` 原样告诉用户,
说明卡在哪一步。

> **这条说的是环境类失败**(装不上、拉不到、起不来)。`verify` 的 `COMPILE_ERROR` 与
> `MISSING_VUE_IMPORT` 不在此列 —— 那是**你自己写的代码**的问题,按提示改完重跑即可,
> 不要转述给用户,更不要就此停下。

### 0.2 「装环境」是你的活,「装不上」才是人的活 —— 别把两者混成一件

| 情况 | 谁的活 |
|---|---|
| 机器上没有 node / 没有共享池 / 依赖树过期 | **你的活。** 跑 ⓪ 的安装脚本或 `HINT:` 给的命令,自动装完继续。设计师全程不该接触任何安装命令 |
| 装的过程中失败了(拉不到 manifest、包下不动、权限不足) | **人的活。** 跑 `doctor` 与安装脚本的 `--check`,把两段输出原样给用户,说明卡在哪一步 |

装不上时,以下"兜底"一律禁止:

| ❌ | 为什么 |
|---|---|
| 让用户自己去 nodejs.org 或任何外网站点下载 node | **内网机器上不去外网**;而且下载 node 本来就是安装脚本的活 |
| 改用纯 HTML / 静态图 / 手写 SVG,生成一个"看起来像"的预览 | 交付物是**能 `yarn install && yarn serve` 跑起来的工程**。给开发一个 HTML 文件等于没交付 —— 用户明确要求单文件 HTML 时除外,那是另一条路径 |
| 自己另起一套 node / 包管理器去凑合把依赖装上 | 依赖树必须与 `lockfileHash` 一致,凑合装出来的和设计师机器上的不是同一棵 |

**说"装不上、卡在这一步"是诚实;换个东西糊弄过去是不诚实。**

### 1. 编译不通过就不算做完

**这是最重要的一条。** 不允许在 `verify` 没有返回 `RESULT: OK` 的情况下告诉用户"做好了"。
编译失败就读错误、改代码、重跑 verify,直到通过。

### 2. 只碰这两个地方

| 允许 | 路径 |
|---|---|
| ✅ 新建 | `<WRITE_DIR>/<页面名>/` 下的任何文件 —— 一个页面一个目录,主文件叫 `index.vue`,拆出来的图表组件、数据处理、样式、`HANDOFF.md` 都放同目录 |
| ✅ 修改 | `<ENTRY_FILE>`(即 `views/index.vue`)—— 加一行 import、加一个标签,把新页面挂上去 |
| ❌ 不动 | `src/` 下的 `app.vue`、`index.vue`、`main.vue`、`i18n/`、`interfaces/`、`utils/`,以及**工程根的所有文件**(含根目录那份 `HANDOFF.md`、`package.json`、`README.md`) |

那些是脚手架的壳,改了会让整个工程起不来,而且它们和交付给开发的结构强相关。

**工程根已经有一份 `HANDOFF.md`**,讲的是这个工程怎么跑(`OCTO_DEPS` / `OCTO_PORT` 那些),**不要动它**。
设计交接写成 `<WRITE_DIR>/<页面名>/HANDOFF.md`,内容按[上半段的 Handoff 交付](design/03-references/prototype/handoff.md)来。

"验证与限制"一节**分层记录,不要把编译通过扩写成别的验证也通过**:

| 哪一类 | 怎么记 |
|---|---|
| 编译门禁 | 以 `verify` 的实际输出为依据,它返回 `RESULT: OK` 才算过 |
| 视觉与交互 | 设计师在预览里看过什么、在什么尺寸下看的,照实写;没看过就写未验证 |
| 导出 | 工程代码包跑过 `export-zip` 才算;图表的**图片导出**(PNG)另记一项,实际导出并确认文件能打开才算 |
| 业务图表组件接入 | 本管道直接用 ECharts、不接内部封装组件,一律记为待接入 |

⚠️ **不要写"已执行类型检查 / 生产构建"** —— `verify` 跑的是 webpack dev 编译,既不是 `tsc --noEmit`
也不是 `yarn build`,**ECharts option 的类型错它抓不到**。没跑过的检查不许出现在交接文档里。

多个页面时,在 `<ENTRY_FILE>` 里怎么组织(tab 切换、纵向排列)按用户的实际要求来,不必预设。

### 3. 技术栈:ECharts + element-plus,**不要用 lake 组件**

| 用什么 | 怎么引 |
|---|---|
| 图表 | `import * as echarts from 'echarts'` —— **全量引入**,不要用 `echarts/core` + `echarts/charts` 的按需引入 |
| 外围控件(按钮、下拉、日期、tab、表格、卡片) | element-plus,走正常包名 `import { ElSelect } from 'element-plus'` |
| 布局 | 普通 `div` + CSS |

**按需引入在这个脚手架上不要用。** 底下是老 webpack,按需那条路要解析 `.mjs` / 条件导出,
是已知容易出事的地方;体积问题等跑通了再说。

> **element-plus 是承载工程已有的依赖**(在脚手架的 `devDependencies` 里),用它属于遵从工程既有约定,
> 不是上半段规范里说的"自行引入外部 UI 库"。但**用了 element-plus 不等于视觉合规** ——
> 字体、间距、颜色仍要按上半段选中的规范逐项核对,该覆盖的样式要覆盖。

⚠️ **不要写 `import { X } from '$/lake-xxx'`。** `$` 是这个脚手架的 webpack alias,
脚手架的壳(`main.vue`)确实用 `LakeLayout` 做布局 —— **那是壳的事,与你写的页面无关**。
本 skill 里**没有 lake 组件的 API 文档**,照着壳里的写法引 lake 组件,只能靠猜组件名和参数,
结果是编译过、运行时 `Failed to resolve component`、页面白屏。需要什么控件就用 element-plus。

**模板里用到的每一个组件,都必须在 `<script setup>` 里 import。** 这个脚手架**没有全局注册**
element-plus 的组件,而且**模板里的组件标签一律写 PascalCase**(`<ElSelect>` 而不是 `<el-select>`):

```vue
<script lang="ts" setup>
// 用了 ElSelect / ElOption / ElDatePicker,三个都得 import
import { ElSelect, ElOption, ElDatePicker } from 'element-plus'
</script>
```

> **为什么强调大小写形式**:kebab-case 的 `<el-select>` 看起来像原生 HTML 标签,很容易被当成"不需要 import"
> ——内网真实踩过(`ElButton` 记得 import,`el-table` 忘了)。统一写 PascalCase,标签本身就在提醒你"这是个组件"。
>
> ⚠️ **漏 import 编译不会报错,页面会白屏。** `verify` 会做一次静态检查并输出
> `WARN: … 用了 X 但没有 import`,**看到这个警告必须回去补**。

### 3.1 vue 的 API 也要 import —— **每个文件各自 import**

`ref` / `reactive` / `computed` / `watch` / `nextTick` / `onMounted` / `onBeforeUnmount` …
这些不是"到处都能用的全局函数",是 `vue` 这个包的导出。

**一个文件 import 过,不代表另一个文件也能用。** 模块作用域是按文件算的 ——
父组件里 `import { ref }`,子组件里直接写 `ref(0)`,子组件照样炸。**每个文件各写各的**,
抽出去的 `useXxx.ts` 也一样(门禁连它一起查)。

> ⚠️ 这一类和组件漏 import 一样:**webpack 编译照过,浏览器里 `ReferenceError: ref is not defined`,
> setup 抛错、整页白屏。** 它没有任何豁免可能,所以 `verify` 对它是
> **`RESULT: FAIL | MISSING_VUE_IMPORT`,直接阻断**,不是警告。
>
> **例外:编译宏不用 import** —— `defineProps` / `defineEmits` / `defineExpose` / `defineOptions` /
> `defineModel` / `withDefaults` 由编译器处理。
>
> **`verify` 只查得出 `vue` 这一批。** `echarts` 和 element-plus 的命令式 API
> (`ElMessage` / `ElMessageBox` / `ElNotification` / `ElLoading`)同样得 import,但**门禁查不到**
> —— 漏了 `echarts` 就是 `echarts is not defined`、整页白屏。写的时候就把 import 补全,别指望门禁。

### 3.2 样式写法:Tailwind 优先,其次 Less + `mixin.less`

本条只管**页面上的 CSS 怎么写**(`<style>` 与 class)。ECharts option 里的颜色、字号、间距按上半段选中的图表规范取值,不受本条约束 —— option 里也引用不了 Less 变量。

按顺序选,**不许越级**:

1. **先用 Tailwind 原子类** —— 布局、宽高、间距、对齐、背景等。工程里的 `tailwind.config.js` 有项目自定义的类(如 `mr-4x`、`flex-center`、`bg-container-secondary`),**用自定义类之前先去里面确认有这个名字**
2. **Tailwind 表达不了,才写 `<style lang="less">`**,先 `@import url('~@/assets/styles/mixin.less');`,颜色、间距、阴影用它里面的变量和方法(如 `@margin-2x`、`.shadow-level2-style('bottom')`),**不要写死值**
3. **`mixin.less` 里没有的值,行尾标 `// 待整改:<现状与来源>`** —— 取自上半段图表规范的值同样要标,例如 `color: #777777; // 待整改:图表规范轴单位色,mixin.less 无对应变量`。**不允许不加标注直接写死**

> ⚠️ **Tailwind 类名写错或不存在,编译不报错、`verify` 也查不出,样式静默失效。** 这和漏 import 白屏是同一类
> "门禁全绿但页面不对"的坑。反过来,`mixin.less` 里的变量名写错是 Less 编译错误,`verify` 会拦下来。

### 4. golden example —— 写第一个图表前先读

`<WRITE_DIR>/_example/index.vue` 是一个**真实编译通过**的最小图表,内容与下面这份一致:

```vue
<script lang="ts" setup>
// Octo golden example —— 示范本脚手架里 ECharts 的正确接法。
// 三件必须照做的事:① 容器有确定高度 ② 接 resize ③ 卸载时 dispose。
// 生成页面时替换掉 views/index.vue 里对它的引用即可,本文件不必保留。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts'

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

// 示例数据 —— 明确标记为示例,不是真实业务数据
const option: echarts.EChartsOption = {
  tooltip: { trigger: 'axis' },
  grid: { left: 56, right: 24, top: 32, bottom: 32 },
  xAxis: { type: 'category', data: ['W01', 'W02', 'W03', 'W04', 'W05', 'W06'] },
  yAxis: { type: 'value', name: '示例值' },
  series: [{ type: 'line', data: [92.1, 93.4, 91.8, 94.2, 93.9, 95.1] }],
}

onMounted(() => {
  if (!chartEl.value) return
  chart = echarts.init(chartEl.value)
  chart.setOption(option)
  // 容器尺寸变了要重算 —— 预览面板切分辨率、侧栏收起都会触发
  ro = new ResizeObserver(() => chart?.resize())
  ro.observe(chartEl.value)
})

onBeforeUnmount(() => {
  // 不 dispose 的话,热更新会把 ECharts 实例越堆越多
  ro?.disconnect()
  ro = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <!-- 样式写法见硬约束 3.2:能用 Tailwind 原子类的先用它 -->
  <div class="w-full">
    <div ref="chartEl" class="chart-canvas w-full" />
  </div>
</template>

<style scoped lang="less">
@import url('~@/assets/styles/mixin.less');

// ⚠️ 容器必须有确定高度。高度塌成 0 时 echarts.init 不报错、编译也全绿,
//    画出来是一片空白 —— 和"没做"长得一模一样,最难排查的一种。
.chart-canvas {
  height: 360px; // 待整改:图表画布高度按任务取值,mixin.less 无对应变量
}
</style>
```

**照它示范的接法写,但不要照抄它的形态** —— 它只是示范约定,不是图表模板。
具体画什么图、怎么配色、交互怎么设计,按上半段选中的方法短卡和规范来。

---

## 交给用户的话怎么说

- 装环境时:说在准备环境、需要几分钟,不要贴命令和路径
- 编译失败自己修时:**不要每轮都汇报**,修好了一起说
- 做完时:说页面已生成、可以在预览里看;产物目录路径可以给
- `SKILL_NOT_ASSEMBLED` 这类用户解决不了的问题:如实说明是环境配置问题,不要试图绕过

## 已知边界

- 产物是**标准工程结构**,`yarn install && yarn serve` 在里面直接可用。工程根的 `node_modules`
  是指向共享池的链接,要交付包就跑 `export-zip`(第 ⑥ 步),别让用户自己压缩目录
- 预览是 `http://127.0.0.1:<port>`,与 Design 页面**跨源** —— 选中元素、手动编辑这类功能在预览里不可用
- **编译通过 ≠ 图画对了。** 容器高度、option 结构、数据口径这些机器判断不了,要设计师自己在预览里看
- `verify` 不跑 `tsc --noEmit`,**ECharts option 的类型错不会被拦下来**;不要在交接说明里写"类型检查已通过"
