# SPEC-DES-008 — fastui 工程与会话目录解耦：兼容代码工作区

> 状态：v1 已实现待内网验证（2026-10-21；skill 改动在文档仓 `skills/`，UXAI 改动见 §6） · 优先级 P0（内网实撞：代码工作区下 verify 卡住、没有预览卡片） · 规模 [M] · 领域 infra/design
>
> 上游已实现：✗ —— 工作区分类（普通 / 代码）、`[Artifact Folder]` / `[Workspace]` 注入、fastui 预览宿主都是 Design 侧自建。用到的上游能力只有插件钩子 `shell.env` 与 `question` 工具
>
> 适用 skill：`fastui-vue-creator`、`chart-vue-creator`（两份 `scripts/` 除 `ensure-env.mjs` 外逐字相同，改动同步两边）
>
> **本 spec 生效后，以下章节中「工程在哪、状态文件在哪、宿主怎么找到工程」以本 spec 为准**：[SPEC-DES-001](fastui-vue-codegen-pipeline.md) §3.2 / §5.3 / §5.5 / §5.6、[SPEC-DES-003](fastui-uxai-integration.md) §8.6.1 文件契约 / §8.6.2、[SPEC-DES-004](fastui-preview-identity.md) §3.2 / §3.7 / §3.9、[SPEC-DES-007](fastui-design-capabilities.md) 中的工程路径示例。这些章节描述的布局仍然有效，作为本 spec 的「旧布局」继续兼容。

---

## 0. 现象与根因

**现象**（内网，2026-10-21）：新建的工作区里生成 fastui 页面，卡在 verify，最后没有预览卡片。

**起因**：UXAI PR #966 引入工作区分类，并把**新建工作区默认设为代码工作区**（分类选择弹窗已删除）。代码工作区下 make 页不再注入 `[Artifact Folder]: <W>/.octo/<sid>/outputs`，改为注入 `[Workspace]: <W>`，并告诉模型「产物目录即工作区目录本身，不要写入 .octo」（`pages/make/index.tsx` 的 `buildArtifactFolderPrefix`）。

**根因**：fastui 管道把「会话目录 = `<W>/.octo/<sid>`、工程 = `<会话目录>/outputs/<产物名>`」当成固定约定，skill 脚本、宿主主进程和前端都写死了这条推导。代码工作区下没有 `[Artifact Folder]`，模型只能猜：

1. 模型多半把 `--artifact-dir` 设成 `<W>`。`new-session` 会把 `dirname(W)` 当作会话根，状态文件 `.octo-fastui.json` 和日志都写到了**工作区外面**
2. 预热请求里的会话目录不含 `.octo` 段，被宿主的 `validRequest` **静默丢弃**：只记一行 warn，也不写错误记录
3. `verify` 再请求一次，又被丢弃。它先空等 60 秒（`HOST_WAIT_MS`），再自己起 dev server、冷编译 1–3 分钟
4. opencode shell 工具默认超时是 2 分钟，命令被中途掐断。没有 `RESULT:` 行，就没有 `PREVIEW_CARD`，也就没有卡片

即使 verify 跑通，后面也会断：前端 `sessionDirOf` 拼出的是 `<W>/.octo/<sid>`，宿主在那里找不到状态文件，点卡片会提示「未找到该对话的预览工程信息」，导出按钮也不会出现。

**确认现场是本问题**：模型跑的 `new-session` 命令里 `--artifact-dir` 是工作区本身；主进程 `main.log` 里有 `[fastui] 忽略无效的起服务请求`；工作区**父目录**下出现了 `octo-fastui.log`，其中有 `[host] 宿主未在时限内起好服务`。

## 1. 影响面

| 层 | 位置 | 依赖的旧假设 |
|---|---|---|
| 模型入参 | 两份 `SKILL.md` 第 ②④⑥ 步 | `--artifact-dir` 取 `[Artifact Folder]`；verify / export 取「它的上一级」 |
| skill 脚本 | `lib/paths.mjs` `sessionPaths` | 会话根 = `dirname(artifact-dir)` |
| | `new-session.mjs` | 删除护栏要求路径含 `.octo` 段（代码布局下 `--reset` 永远拒绝，`PROJECT_INCOMPLETE` 成死结）；默认产物名 `fastui-app` |
| | `verify.mjs` / `export-zip.mjs` | 写死 `<session-dir>/outputs`；`--project-dir` 兜底向上推两级 |
| | `doctor.mjs` | 日志位置文案指向 `.octo/<会话id>/` |
| 宿主主进程 | `fastui-devserver.ts` | `validRequest` 要求含 `.octo` 且 `projectDir === sessionDir/outputs/name`；`resolveProject` 用 `sessionDir/outputs/name` 拼路径，不用状态文件里的 `projectDir`；`runtimePaths` 在 `sessionDir/devservers` |
| | `fastui-export.ts` | 走同一个 `resolveProject`；skill 候选路径 `dirname(sessionDir)/skills/…` |
| 前端 | `utils/fastui-export.ts` `sessionDirOf` | 写死 `<W>/.octo/<sid>`；预览、导出按钮判定、旧卡片转换都依赖它 |

## 2. 方案对比

| 做法 | 业界例子 | 结论 |
|---|---|---|
| A. 脚本按路径形态推断布局（看有没有 `.octo` 段） | — | **否决**：启发式，而且出错的源头正是模型传入的路径 |
| B. 宿主把上下文注入环境变量 | CI 的 `$GITHUB_WORKSPACE`、VS Code 的 `${workspaceFolder}` | **采用一部分**：注入会话 ID 与工作区目录，二者 server 侧都确定可得。**不注入**「产物该放哪」：工作区分类只存在前端，server 不知道 |
| C. 工程用标记文件自描述 | git 的 `.git`、npm 向上找 `package.json` | **采用**：工程根放标记文件，建好之后所有环节只认工程目录，不再从它往上推会话目录 |

**选定 C + B**：C 让目录结构与脚本解耦；B 补上 C 自己拿不到的两样信息，一是「本对话是谁」（判断是不是同一对话在复用），二是「工作区在哪」（防止把工程建到工作区外）。工程建在哪仍由注入给模型的 `[Artifact Folder]` / `[Workspace]` 决定，脚本不关心。

## 3. 方案

### 3.1 两种工作区下的布局

**代码工作区**（新建工作区的默认值）：`--artifact-dir` 取 `[Workspace]` 原值，工程直接放在工作区下，名字由模型按需求起。

```
<W>/
├─ user-admin/                  ← 一个工程（产物名 = 目录名）
│   ├─ .octo-fastui.json        ← 工程标记（§3.2）
│   ├─ .octo-fastui/            ← 运行时文件（§3.7），不进交付包
│   ├─ node_modules ⇢ 共享依赖池
│   ├─ package.json  yarn.lock …
│   └─ packages/portal/src/views/<页面名>/index.vue
├─ order-center/                ← 另一个工程
└─ （设计师自己的其他文件）
```

**普通工作区**（存量工作区，没有分类字段的都按普通处理）：`--artifact-dir` 取 `[Artifact Folder]` 原值，工程在 `<W>/.octo/<sid>/outputs/<产物名>/`。新建工程同样写标记文件与运行时目录。

**旧布局**（本 spec 之前建的工程）：会话级状态文件 `<W>/.octo/<sid>/.octo-fastui.json`、运行时 `<W>/.octo/<sid>/devservers/`、工程 `<W>/.octo/<sid>/outputs/<产物名>/`，没有工程标记。保持可读；第一次被新版 `new-session` 复用时，在工程根补写标记（§3.4）。

**一个工程可以有多个页面**：模板本来就支持，每个页面是 `views/<页面名>/index.vue`，挂在聚合入口 `views/index.vue` 上。所以「做一个新页面」可能是在已有工程里加页面，也可能是新建工程，由 §3.6 的提问规则决定。

### 3.2 工程标记文件 `<工程目录>/.octo-fastui.json`

```json
{
  "schema": 1,
  "skill": "fastui-vue-creator",
  "name": "user-admin",
  "title": "用户管理后台",
  "sessions": ["ses_…"],
  "envDir": "…",
  "depsDir": "…",
  "nodeBin": "…",
  "skillDir": "…",
  "createdAt": "…",
  "updatedAt": "…"
}
```

- **不记 `projectDir`**：标记所在目录就是工程目录。记下来的绝对路径在目录被移动后会变成错的
- `sessions`：用过这个工程的会话 ID（根会话），用于判断「是不是本对话的工程」（§3.4）与 verify 的缺省定位（§3.5）
- `title`：模型建工程时用 `--title` 写入的一句话描述，供 `--list` 和提问时展示；没传时取 `name`
- `envDir` / `depsDir` / `nodeBin` / `skillDir` 的含义与旧状态文件相同（SPEC-DES-004 §3.9）

**这个文件是「这是我们的工程」的唯一判据**：复用、`--reset` 删除、宿主接受起服务请求，都要先确认它存在（旧布局以会话级状态文件代替，§3.7）。工作区是设计师随手选的目录，可能有同名的普通文件夹，没有标记的目录一律不碰。

### 3.3 会话上下文注入

在 opencode 加一个内置插件（与 `octo-session-workdir` 同类，放 `packages/opencode/src/agent/`，注册进 `plugin/index.ts` 的 `INTERNAL_PLUGINS`），实现 `shell.env` 钩子，给每次 shell 调用注入：

| 变量 | 取值 |
|---|---|
| `OCTO_SESSION_ID` | **根会话** ID：沿 `parentID` 上溯，做法同 `octo-session-workdir` 的 `metaOf`。skill 即使跑在子会话里，拿到的也是用户看到的那个对话 |
| `OCTO_WORKSPACE_DIR` | 根会话的 `directory`（即工作区 W） |

钩子入参自带 `sessionID`（`tool/shell.ts` `shellEnv`）。变量与布局无关，所以对所有 agent 注入也无害。

**拿不到时**（终端直接跑脚本、外网 V0）：脚本按「无会话上下文」处理，规则见 §3.4、§3.5 的对应行。

### 3.4 `new-session.mjs`

**参数**：

| 参数 | 必填 | 没传 / 不合法时 |
|---|---|---|
| `--artifact-dir` | 是 | 报 `BAD_USAGE`，HINT 写明「有 `[Artifact Folder]` 用它，没有就用 `[Workspace]`」。不给默认值：脚本不知道工作区类型，给什么都可能错 |
| | | 有 `OCTO_WORKSPACE_DIR` 时，`--artifact-dir` 必须在它之内，否则报 `OUTSIDE_WORKSPACE`。内网事故里状态文件就是写到了工作区外面 |
| `--name` | 是 | 报 `BAD_USAGE`。**去掉默认值 `fastui-app`**，否则没起名的对话都会撞到同一个目录。字符校验沿用现有正则 |
| `--title` | 否 | 用 `name` 顶上，打一条 WARN |
| `--reuse` | 否 | 见下表 |
| `--list` | 否 | 只列出、不创建，见下 |
| `--reset` | 否 | 只对带标记（或旧布局）、自检不完整的工程生效 |

**`<artifact-dir>/<name>` 已存在时**：

| 现状 | 行为 | 输出 |
|---|---|---|
| 不存在 | 新建（原子创建，见下），标记的 `sessions = [本会话]` | `MODE: created` |
| 有标记，`sessions` 含本会话 | 直接复用 | `MODE: reused` |
| 有标记，不含本会话，带了 `--reuse` | 复用，把本会话追加进 `sessions` | `MODE: reused`，`REUSED_FROM: other-session`，`TITLE: …` |
| 有标记，不含本会话，没带 `--reuse` | **报 `NAME_TAKEN`**，附工程列表 | `PROJECTS_BEGIN … PROJECTS_END` |
| 有标记，拿不到 `OCTO_SESSION_ID` | 复用（与现有行为一致） | `MODE: reused` |
| 有标记，但 `skill` 不是当前 skill（例如 chart 撞上 fastui 的工程） | **报 `NAME_TAKEN`**，`--reuse` 也不行：两个 skill 的模板不同，不能混用 | 同上 |
| 旧布局：`<artifact-dir>` 的父目录有会话级状态文件，且该目录含 `packages/portal` | 复用，并在工程根补写标记 | `MODE: reused` |
| 存在但既没有标记、也不是旧布局（设计师自己的文件夹） | **报 `NAME_TAKEN`**，`--reuse` 也不行，目录一个字节都不动 | 同上 |

`--reuse` 只是「模型确认了用户要接着改」的显式声明。不带参数时走的是安全路径：不会悄悄改到别的对话建的工程上。

**原子创建**：模板先复制到同级临时目录 `<artifact-dir>/.<name>.creating-<pid>/`，校验关键文件齐全、写好标记后再 `rename` 成 `<name>`，最后建 `node_modules` 链接。最终目录要么完整，要么不存在。复制失败只留下点开头的临时目录（文件面板本来就隐藏点开头的条目），下次运行时清理同前缀的残留。这样 `PROJECT_INCOMPLETE` 只会出现在「建好之后被人删了文件」这一种情况。

**删除护栏**（替换原来的「路径含 `.octo` 段」）：`--reset` 与清理残留时，目标必须同时满足：是 `<artifact-dir>` 的直接子目录；有 `OCTO_WORKSPACE_DIR` 时在它之内；带标记、是旧布局，或者是本脚本的 `.creating-` 临时目录。任何一条不满足就报 `UNSAFE_CLEANUP`，不删。

**`--list`**：列出 `<artifact-dir>` 下标记里 `skill` 与当前 skill 相同的直接子目录，外加旧布局工程（旧布局只在本会话目录内出现，不区分 skill），每行一个：

```
PROJECTS_BEGIN
user-admin | 用户管理后台 | updated 2026-10-20 15:02 | this-session: yes
order-center | 订单中心 | updated 2026-10-19 10:11 | this-session: no
PROJECTS_END
```

列表范围就是 `<artifact-dir>`：代码工作区下是整个工作区；普通工作区下只有本会话的 `outputs`，所以普通工作区永远只看到本对话的工程，不会触发提问，和现在的行为一致。

**宿主版本检查**：宿主心跳 `.octo-host.json` 新增 `layout: 2`。`new-session` 发现宿主在、但心跳里没有 `layout: 2` 时，报 `HOST_OUTDATED`（「请先升级 Octo」）。这是为了防止 skill 先于 App 更新到用户机器：那种组合下普通工作区也会坏，必须响亮失败，不能静默降级。

**其余不变**：预热请求、`WRITE_DIR` / `ENTRY_FILE` 输出、依赖链接方式。

### 3.5 `verify.mjs` / `export-zip.mjs`：定位工程

按以下顺序取工程目录，命中就停：

1. `--project-dir`（主参数，取 `new-session` 返回的 `PROJECT_DIR` 原值）：必须带标记或是旧布局，否则报 `NO_PROJECT`
2. `--session-dir`（**旧参数，保留**：老对话的历史里有这种命令，模型会照着跑）：先读 `<session-dir>/.octo-fastui.json` 里的 `projectDir`（旧布局）；没有就在 `<session-dir>/outputs/` 下找本 skill 的工程，**恰好一个**就用它；还没有就按第 3 条定位。用到旧参数时输出一条 `WARN`，提示改用 `--project-dir`
   - 第二步是内网 2026-10-21 实测补上的：普通工作区里新建的工程不写会话级状态文件，模型照旧习惯传「[Artifact Folder] 的上一级」时，只读状态文件必然 `NO_SESSION`。SKILL.md 也不再提 `--session-dir`（提了反而诱导模型去用），只写「`--project-dir` 取 `PROJECT_DIR` 原值」
3. 都没传：有 `OCTO_SESSION_ID` 和 `OCTO_WORKSPACE_DIR` 时，找 `sessions` 含本会话的工程，范围是 `<W>/*` 与 `<W>/.octo/<sid>/outputs/*`，再加本会话的旧布局工程。**恰好一个**就用它；零个或多个就报 `NO_PROJECT` 并列出候选。「恰好一个才用」与宿主对旧卡片的处理一致，结果是确定的，不靠猜

**有工作区上下文时，定位出来的工程必须在工作区内**：`--session-dir` 找到的工作区外候选直接跳过、继续往下找；`--project-dir` 指向工作区外报 `OUTSIDE_WORKSPACE`。来由：旧版 `new-session` 把状态文件写在 `--artifact-dir` 的上一级，代码工作区下就落在工作区**外面**（如 `Desktop\.octo-fastui.json`）。这些残留不会自己消失，`--session-dir` 指过去就可能把 verify 引到别的工程上（内网 2026-10-21 实测）。

运行时文件一律放在 `<工程目录>/.octo-fastui/`（§3.7），旧布局工程也一样。会话级 `devservers/` 从此不读。

**给宿主的请求**改为 `{ projectDir, name, at }`，不再带 `sessionDir`。

`export-zip` 的交付包排除 `node_modules` 链接、`.octo-fastui/`、`.octo-fastui.json`（后两者含本机路径，不该交给开发）；zip 写到 `<工程目录>/.octo-fastui/export/<name>.zip`，不再写在工程旁边，免得代码工作区根目录里多出一堆 zip。

`doctor.mjs` 的 `LOG_PER_SESSION` 改为 `LOG_PER_PROJECT: <工程目录>/.octo-fastui/`。

### 3.6 `SKILL.md`：参数取值与何时提问

**参数取值**写成确定的规则，模型不需要猜，也不需要推「上一级」：

- `--artifact-dir`：有 `[Artifact Folder]` 用它，没有就用 `[Workspace]`，两者都取原值
- `verify` / `export-zip`：`--project-dir="<PROJECT_DIR>"`，取 `new-session` 返回的值
- 每次建工程都传 `--name`（简短英文 / 拼音）和 `--title`（一句话中文描述）

**第 ② 步先跑 `--list`，再按下表决定**：

| 情况 | 做法 |
|---|---|
| 列表为空 | 不问，直接新建 |
| 本对话已经用过某个工程（`this-session: yes`） | 不问，沿用它。用户明确说「新做一个」才新建 |
| 用户明确指向已有工程（「接着改那个看板」「在审批系统里加个页面」） | 不问，用它的名字加 `--reuse`，回复里说明「正在修改已有工程 X」 |
| 用户明确要新建（「新建一个工程」「另做一个和之前无关的」） | 不问，起一个列表里没有的名字 |
| 其余（「做个新页面」「加个功能」这类模糊说法）且列表不为空 | **问一次** |
| 脚本返回 `NAME_TAKEN` | **必须问**，或者换一个名字 |

**拿不准就问**。两种判断错误的代价不一样：误判成新建只是多一个工程，用户能看出来，也能纠正；误判成复用会改动已有代码，而这些工程没有版本管理。所以复用别的对话建的工程，前提必须是用户明确提过，或者在提问里选了它。

**提问用 `question` 工具**，模板固定，让选项与脚本参数一一对应：

```
question({ questions: [{
  header: "选择工程",
  question: "当前工作区已有以下工程。这次的需求要基于哪个继续开发，还是新建一个？",
  multiple: false,
  options: [
    { label: "继续开发「用户管理后台」", description: "user-admin" },
    { label: "继续开发「订单中心」", description: "order-center" },
    { label: "新建工程", description: "单独建一个新工程" }
  ]
}]})
```

选「继续开发」就用对应 `description` 里的名字加 `--reuse`；选「新建工程」就起一个新名字；用户自己填的内容按字面理解。`question` 工具不可用时，改为在对话里列出同样的选项、结束本轮等用户回复。`octo_make` 的 `question` 权限已由 UXAI PR #998 放开，提示词把使用范围限定为「skill 明确要求时」。

**可能超过 2 分钟的命令要显式传 shell 超时**：安装环境（①）与 `verify`（④）调用 shell 工具时传 `timeout: 600000`。shell 工具默认 2 分钟，冷编译 1–3 分钟，再加宿主等待，必然超时（§0 第 4 条）。

**不变**：⑤ 原样输出 `PREVIEW_CARD`（`fastui://<产物名>`）；`WRITE_DIR` 是唯一可新建文件的目录；硬约束 0（不自行删除）。

### 3.7 宿主与前端：按（工作区, 会话, 产物名）找工程

前端不再自己拼会话目录，改为把 `{ workspaceDir, sessionId, name }` 交给主进程（`workspaceDir` 即 `sdk.directory`）。`sessionDirOf` 删除，它的调用点（预览请求、导出按钮判定、旧卡片转换）都改走主进程的同一个查找函数。

主进程按以下顺序查找，命中就停：

1. `<W>/.octo/<sid>/outputs/<name>`：带标记，或者是旧布局（`<W>/.octo/<sid>/.octo-fastui.json` 存在，且该目录含 `packages/portal`）。覆盖普通工作区、旧对话、升级前的数据
2. `<W>/<name>`：带标记。覆盖代码工作区
3. 都没有：报「未找到预览工程「name」」

- **先查会话范围**：第 1 步只属于这个对话，同名时不会串到别的工程
- **查找不需要知道工作区类型**：两种布局都是对确定文件的存在性判断
- **产物名为空**（旧版 `http://127.0.0.1:<port>` 卡片）：保持现有行为，只在第 1 步的会话 `outputs` 里找，恰好一个才用
- **起服务用的 `nodeBin` / `envDir`**：从标记读，旧布局从会话级状态文件读

**起服务请求的校验**（`validRequest`）：`projectDir` 是绝对路径、目录名合法、含 `packages/portal`，并且带标记**或**是旧布局。旧版 skill 发来的 `{ sessionDir, projectDir, name }` 照样接受，只是不再要求路径含 `.octo` 段。

**运行时文件**：宿主与 verify 都写 `<工程目录>/.octo-fastui/`：

| 文件 | 谁写 | 内容 |
|---|---|---|
| `devserver.json` | 宿主（非 Octo 环境下是 verify） | 同 SPEC-DES-004 §3.9 的 `devservers/<产物名>.json` |
| `devserver.log`（Windows 自起时另有 `.err`） | dev server 输出 | verify 的编译判定数据源 |
| `octo-fastui.log` | 各脚本的契约行落盘 | 排查用 |
| `export/<name>.zip` | `export-zip` | 交付包 |

运行时文件按工程分，不按会话分：多个对话共用一个工程时，共用的也是同一个服务。宿主的 `running` 本来就以工程目录为键。

**导出**：`fastui-export.ts` 用同一个查找函数得到工程目录，以 `--project-dir` 调 `export-zip.mjs`。skill 位置优先取标记里的 `skillDir`，候选路径中的 `dirname(sessionDir)/skills/…` 改为 `<W>/skills/…`。

**卡片格式不变**：`fastui://<产物名>`。代码工作区下多个对话的同名卡片指向同一个工程，与「代码工作区的对话不隔离产物」一致。

### 3.8 兜底：文件卡片指向工程内文件时，另补一张预览卡片

**问题**（内网 2026-10-21，C3）：代码工作区下，新对话里接着改已有工程时，模型即使加载了 skill，也可能跳过 `verify`，直接用 edit 改 `.vue`，然后按 octo_make 的 edit 规则只输出一张**指向被改文件**的 text/link 卡片，没有 `fastui://` 预览卡片。提示词里本来就写了「每一轮都要输出卡片」，模型照样跳过，靠提示词保证不了。

**做法**：文件卡片照旧（点开看源码），两张卡片各有用处，互不替代。对话里的链接卡片是磁盘路径时，前端渲染这一轮的卡片列表时问主进程「这个文件属于哪个 fastui 工程」（`fastuiProjectOf`）：

1. 从文件所在目录逐级往上找工程标记（§3.2，旧布局同样认），不出工作区
2. 找到后，按卡片的正常查找顺序（§3.7）用（工作区, 当前会话, 产物名）反查一次，**必须落回同一个目录**才算数。对不上（比如文件在另一个对话的 outputs 里）就不转
3. 算数就在这一轮的卡片列表里**另补一张** `fastui://<产物名>` 预览卡片（标题是工程名；这一轮已经有同名预览卡片就不补）；不算就什么都不补

补出来的卡片只用于展示，不进自动保存与产物打点；点开走 `fastui://` 的原有逻辑。

- **不会挂错、不会重复起服务**：沿用 SPEC-DES-004 的机制。卡片只带产物名，点开时主进程当场查工程、按工程目录复用正在运行的服务
- **模型没跑 verify 时**：预览面板显示的就是真实编译结果，编译失败会进错误态，并显示日志和「重新编译」按钮
- **影响范围**：只在「对话里的磁盘路径卡片，且文件位于带标记的工程内」时生效。文件面板、附件、外链、Design 原生的 HTML / SVG / 文档产物都不经过这里，其他 skill 的产物不会有这个标记
- **已知边界**：补卡片要等一次主进程查询，生成结束后才出现，会比文件卡片晚一点

## 4. 兼容性

| 场景 | 结果 | 靠什么 |
|---|---|---|
| ① 普通工作区里的老对话继续改 | 正常 | 每轮照常注入 `[Artifact Folder]`；`new-session` 认出旧布局并复用（§3.4）；`--session-dir` 继续可用（§3.5） |
| ② 老对话历史里的 `fastui://` 卡片 | 正常 | 查找第 1 步的旧布局分支（§3.7） |
| ③ 普通工作区里的新对话 | 正常 | 工程在 `.octo/<sid>/outputs/<name>`，带标记 |
| ④ 代码工作区里的新对话 | 本 spec 修复的场景 | §3 全部 |
| ⑤ 老工作区升级为代码工作区之后的老对话 | **不在本 spec 范围** | 升级迁移由 UXAI PR #995 负责，已向其负责人提出「fastui 工程整目录迁移，不拍平」。用户侧先告知不要对有 fastui 产物的工作区执行升级 |
| ⑥ 新 skill + 旧 App | 响亮失败 `HOST_OUTDATED` | §3.4 宿主版本检查 |
| ⑦ 旧 skill + 新 App | 普通工作区**能用但慢**：旧 verify 读会话级 `devservers/`，新宿主把服务记录写在工程内，旧 verify 看不到，会先空等 60 秒再自己起服务；代码工作区仍然坏（同现状） | 宿主接受旧格式请求、能读旧布局；**所以 skill 要在 App 之后尽快一起升级** |

**发布顺序**：先发 App（插件 + 宿主 + 前端），再上架 skill。⑥ 的检查保证顺序反了也不会出现静默的错误行为。

## 5. 边界与不做

- **两个对话同时改同一个工程**：A 对话跑 verify 时可能看到 B 对话改动后的编译结果。一个设计师一般不会同时这么做，不专门处理
- **跨 skill 复用**：图表 skill 不在 fastui 的工程上继续开发，反过来也一样（§3.4）。设计师想在 fastui 工程里加图表，由 fastui skill 自己完成
- **用户手工移动 / 改名工程目录**：标记不记绝对路径，移动后仍能识别。但旧卡片里的产物名对不上，就找不到了，需要重新生成预览
- **代码工作区文件树里的 `node_modules` 链接**（@ 面板递归、在文件树里删除工程时如何处理链接）：由工作区功能的负责人分析，不在本 spec 内
- **不做**：登记表（工程位置由 SKILL.md 约定，用不上）、自动加 `-2` 后缀去重（会把「想接着改」悄悄变成新建）、按目录形态推断布局（§2 A）

## 6. 改动清单

**skill**（文档仓 `skills/`，两份同步）：

| 文件 | 改动 |
|---|---|
| `scripts/lib/paths.mjs` | 新增 `projectPaths(projectDir)`（标记、运行时目录、日志、记录、zip）；读 `OCTO_SESSION_ID` / `OCTO_WORKSPACE_DIR`；`sessionPaths` 只留给旧布局读取 |
| `scripts/lib/project.mjs`（新） | 标记读写、`listProjects(artifactDir)`、旧布局识别、verify / export 的工程定位（§3.5）、删除护栏 |
| `scripts/new-session.mjs` | §3.4 全部 |
| `scripts/verify.mjs` | 工程定位、运行时路径、请求格式 |
| `scripts/export-zip.mjs` | 工程定位、排除项、输出位置 |
| `scripts/lib/host.mjs` | 请求格式；读心跳里的 `layout` |
| `scripts/doctor.mjs` | `LOG_PER_PROJECT` |
| `SKILL.md` | §3.6 全部 |
| `scripts/new-session.test.mjs`（新）、`scripts/verify.test.mjs` | §7.1 |
| 版本 | 上架时 `fastui-vue-creator` 1.0.0 → 1.1.0，`chart-vue-creator` 1.1.0 → 1.2.0。按「上架涨号、不按提交涨号」，实现提交不改 `SKILL.md` 的 `version`，改动先记在 `docs/releases/skills/` 的「未发布」 |

**UXAI**（一个 PR）：

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/agent/octo-shell-context.ts`（新）、`plugin/index.ts` | §3.3 插件与注册；测试放 `test/plugin/` |
| `packages/desktop/src/main/fastui-devserver.ts` | 查找函数（§3.7）、`validRequest`、运行时路径、心跳 `layout: 2` |
| `packages/desktop/src/main/fastui-export.ts` | 走查找函数、`--project-dir`、skill 候选路径 |
| `packages/desktop/src/main/ipc.ts`、`src/preload/*` | IPC 参数改为 `{ workspaceDir, sessionId, name }`，新增「查找工程」IPC，以及「文件属于哪个工程」IPC（`fastui-project-of`，§3.8） |
| `packages/app/octoapp/pages/make/lib/electron-api.ts` | `FastuiTarget` 类型；三个 fastui 接口改收目标对象，新增 `fastuiResolve` |
| `packages/app/octoapp/pages/make/utils/fastui-export.ts` | 删 `sessionDirOf` / `isFastuiSession` / `sessionHasFastuiState`，改为 `fastuiTargetOf` / `isFastuiProject` / `hasFastuiProject`（走 `fastuiResolve`） |
| `packages/app/octoapp/pages/make/utils/fastui-preview.ts` | 请求参数改为 `workspaceDir` + `sessionId` |
| `html-renderer.tsx`、`index.tsx`（旧卡片转换）、`subtype-handlers/fastui.tsx`（导出按钮） | 改用上面的新函数 |
| `components/insight-turn.tsx` 卡片列表、`utils/fastui-export.ts` `fastuiProjectOfFile` / `absoluteLinkPath` | 文件卡片指向工程内文件时另补一张预览卡片（§3.8） |

## 7. 验证

### 7.1 自动化（外网 Mac）

**skill**（`node scripts/new-session.test.mjs` / `node scripts/verify.test.mjs`，假共享池 + 假模板，两份 skill 各跑一遍）：

| # | 用例 | 期望 |
|---|---|---|
| A1 | 代码布局新建：`--artifact-dir=<W> --name=alpha`，带 `OCTO_SESSION_ID=s1` | 生成 `<W>/alpha/`，标记 `sessions=["s1"]`；`MODE: created`；`<W>` 的父目录下没有任何新文件 |
| A2 | 同会话重跑 A1 | `MODE: reused`，不报错 |
| A3 | `OCTO_SESSION_ID=s2` 跑 A1，不带 `--reuse` | `NAME_TAKEN`，列表里有 alpha；目录内容不变 |
| A4 | A3 加 `--reuse` | `MODE: reused`，`REUSED_FROM: other-session`；`sessions=["s1","s2"]` |
| A5 | `<W>/beta/` 是放了一张图片的普通文件夹，`--name=beta`，加或不加 `--reuse` | 都报 `NAME_TAKEN`；文件夹内容哈希不变 |
| A6 | 缺 `--name`、缺 `--artifact-dir`、`--artifact-dir` 在 `OCTO_WORKSPACE_DIR` 之外 | 分别报 `BAD_USAGE` / `BAD_USAGE` / `OUTSIDE_WORKSPACE` |
| A7 | 旧布局：`<W>/.octo/s1/.octo-fastui.json` + `outputs/alpha/packages/portal/`，`--artifact-dir=<W>/.octo/s1/outputs --name=alpha` | `MODE: reused`；工程根补写了标记 |
| A8 | 让模板复制中途失败（模板里删一个关键文件） | 不留下 `alpha` 目录；修复后重跑成功；残留的 `.alpha.creating-*` 被清理 |
| A9 | 带标记、删掉关键文件的工程加 `--reset`；没有标记的目录加 `--reset` | 前者重建；后者 `NAME_TAKEN` / `UNSAFE_CLEANUP`，不删 |
| A10 | `--list`，代码布局两个工程（一个属于本会话）+ 普通布局一个旧工程 | 各自范围内列全，`this-session` 标记正确 |
| A11 | 心跳文件存在、pid 活着、没有 `layout` 字段 | `HOST_OUTDATED` |
| A12 | 不设 `OCTO_SESSION_ID`，工程已有标记 | `MODE: reused`（终端行为与现在一致） |
| A13 | `<W>/alpha` 的标记 `skill` 为 `fastui-vue-creator`，用 chart 的 `new-session --name=alpha --reuse`；再跑 chart 的 `--list` | 前者 `NAME_TAKEN`，目录不变；后者不列出 alpha |
| V1 | `verify --project-dir=<W>/alpha`，非 Octo 环境 | 自起服务；运行时文件在 `<W>/alpha/.octo-fastui/`；`PREVIEW_CARD: fastui://alpha` |
| V2 | `verify --session-dir=<旧会话目录>`（旧布局） | 正常定位到旧工程 |
| V2b | 普通工作区的新工程（工程根有标记、会话目录没有状态文件），`verify --session-dir=<W>/.octo/s1` | 定位到 `outputs` 下的工程，并输出提示改用 `--project-dir` 的 WARN |
| V2c | 代码工作区，`--session-dir` 指向不存在的 `<W>/.octo/s1`，带会话上下文 | 按本会话恰好一个工程定位 |
| V2d | 工作区上一级残留旧版状态文件，指向工作区外一个仍认得出来的旧工程；`--session-dir=<上一级>`；另用 `--project-dir=<那个旧工程>` | 前者不被带偏，定位到工作区内本会话的工程；后者 `OUTSIDE_WORKSPACE` |
| V3 | 不传参，本会话恰好一个工程 / 两个工程 | 前者用它；后者 `NO_PROJECT` 并列出两个 |
| V4 | 宿主在：检查投递的请求文件 | 内容是 `{ projectDir, name, at }` |
| V5 | 现有 verify 用例（宿主换进程、宿主报错立即失败、旧错误记录不作数等） | 全部照旧通过 |
| E1 | `export-zip --project-dir=<W>/alpha` | zip 里没有 `node_modules`、`.octo-fastui/`、`.octo-fastui.json`；输出路径在 `.octo-fastui/export/` |

**UXAI**：

| 位置 | 命令 | 覆盖 |
|---|---|---|
| `packages/opencode` | `bun test test/plugin/octo-shell-context.test.ts` | 根会话直接调用、子会话调用时 `OCTO_SESSION_ID` 都是根会话 ID；`OCTO_WORKSPACE_DIR` 是根会话目录 |
| `packages/desktop` | `bun test src/main/fastui-devserver.test.ts src/main/fastui-export.test.ts` | 查找三步各命中一次；会话范围与工作区范围同名时取会话范围；都没有时报错；产物名为空的旧卡片；`validRequest` 接受新旧两种请求、拒绝无标记目录；心跳含 `layout: 2`；导出以 `--project-dir` 调脚本；`projectOfFile`：代码 / 普通工作区工程内文件命中，另一个对话 outputs 里的文件因反查对不上而不转，工程外 / 工作区外 / 相对路径不转；现有用例照旧通过 |
| `packages/app` | `bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-preview.test.ts ./octoapp/pages/make/utils/fastui-subtype.test.ts` | 请求参数改为 `{ workspaceDir, sessionId, name }` 后状态机用例照旧通过；导出按钮的判据改为 `fastuiResolve` |
| 三个包 | `bun run typecheck` | 通过 |

### 7.2 外网手工（Mac Electron，不需要内网）

真实模板只在内网有，外网只验「卡片 → 宿主查找 → 起服务」这一段。用 SPEC-DES-004 §6.1 的假共享池和假 dev server，`OCTO_FASTUI_ENV_DIR=<假共享池> bun run dev` 起桌面端：

1. **代码工作区**：新建一个空文件夹作为工作区，在里面手工放 `alpha/.octo-fastui.json`（含 `envDir` / `depsDir` / `nodeBin`）与 `alpha/packages/portal/`；新建 Design 对话，让模型原样回复 `<artifact type="text/link">fastui://alpha</artifact>`，点卡片 → 出页面。再开一个对话做同样的事 → 同一个服务
2. **旧布局**：在另一个工作区的 `.octo/<会话id>/` 下放旧格式的 `.octo-fastui.json` 与 `outputs/alpha/packages/portal/`（不放工程标记），在该会话里做同样的事 → 出页面
3. 两种情况下点「导出代码包」都能成功

### 7.3 内网验证（Windows / PowerShell，真实 Octo + 组件库）

**给测试同学**：按下面准备好环境，逐条执行，记录每条的结果。失败时按「失败时收集」把材料一起给我们。

#### 准备

1. **版本**：Octo 用 UXAI 分支 `feat/fastui-workspace-layout` 打包；skill 用文档仓同名分支，两个 skill 都只覆盖 `SKILL.md` 与 `scripts/`（内网组装的 `template/`、`vendor/`、`design/` 不动）。验证阶段版本号还没涨，**不能靠 `version` 判断装的是不是新版**
2. **换完 skill 必须重启 Octo**（或在技能库页面操作一次触发刷新）：server 把 `SKILL.md` 内容解析后缓存在内存里，手工覆盖文件不会刷新；脚本则是每次现读磁盘。不重启就会出现「脚本是新的、模型读到的 SKILL.md 还是旧的」—— 2026-10-21 内网首轮就是这样，模型照旧版写法传 `--session-dir="<上一级>"`。**确认方法**：在第一条测试对话里展开「调用技能 fastui-vue-creator」，内容里有「选定工程」「`--list`」才是新版；是「每个会话建一次工程(幂等)」就是旧版
3. **普通工作区（老数据）**：**升级 Octo 之前**，在旧版本上用一个工作区（例如 `D:\fastui-legacy`）完成：
   - 对话 L-A：生成一个页面，页面顶部写「这是 L-A」，留下能点开的预览卡片
   - 对话 L-B：同一个对话里先后生成两个不同的工程（页面分别写「这是 L-B1」「这是 L-B2」）

   升级后打开「设置 → 工作区升级」：这个工作区出现在列表里，说明它是普通工作区。**不要点升级**
4. **代码工作区**：升级后在 Octo 里新建两个工作区（新版本新建的默认就是代码工作区）：
   - `D:\fastui-code`（纯英文路径）
   - `D:\设计稿\fastui测试`（中文路径，只用于 C10）

   在 `D:\fastui-code` 里手工建一个普通文件夹 `dashboard`，里面放一张图片（用于 C7）
5. **每个生成的页面顶部都写一行自述文字**（「这是 A」「这是 B」…），用来判断卡片打开的是哪个工程，比看端口号可靠

#### 用例

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| **C1** | 代码工作区首次生成 | 在 `D:\fastui-code` 新建对话：「用 fastui 做一个用户列表页，页面顶部写『这是 A』」 | ① 没有弹出选择工程的问题（工作区里还没有工程）；② 工作区下出现一个新的工程文件夹，里面有 `.octo-fastui.json`；③ 回复里有预览卡片，点开显示「这是 A」；④ `D:\` 根目录下**没有**新出现 `.octo-fastui.json` 或 `octo-fastui.log`；⑤ 整个过程没有出现命令超时 |
| **C2** | 同一对话继续改 | 在 C1 的对话里：「把顶部文字改成『这是 A2』」 | 不弹问题；没有新建工程文件夹；卡片显示「这是 A2」 |
| **C3** | 新对话明确接着改 | 新建对话：「接着改刚才那个用户列表工程，加一个搜索框」 | 不弹问题；没有新建文件夹；本对话里**一定有一张标题为工程名的预览卡片**，点开是预览页面（带搜索框）；如果模型同时输出了文件卡片（如「index」），它照旧打开 `.vue` 源码；C1 和本对话的卡片打开是同一个页面 |
| **C3b** | 不重复起服务 | C3 之后在任务管理器 / 端口检查命令里看 dev server | 同一个工程只有一个 dev server 在监听 |
| **C4** | 新对话模糊需求 · 选新建 | 新建对话：「再做一个订单页，顶部写『这是 B』」 | 弹出选择：列出 C1 的工程和「新建工程」。选「新建工程」→ 出现新的工程文件夹，卡片显示「这是 B」；回到 C1 的对话点卡片，仍是「这是 A2」 |
| **C5** | 新对话模糊需求 · 选已有 | 新建对话：「再做一个设置页，顶部写『这是 A3』」，在弹出的选择里选 C1 的工程 | 没有新建工程文件夹；C1 工程的 `packages\portal\src\views\` 下多了一个页面目录；卡片里能看到设置页 |
| **C6** | 新对话明确新建 | 新建对话：「新建一个独立的工程，做一个审批页，顶部写『这是 C』」 | 不弹问题；新的工程文件夹；卡片显示「这是 C」 |
| **C7** | 名字被普通文件夹占用 | 新建对话：「新建一个工程做数据看板，工程名就叫 dashboard」 | `dashboard` 文件夹内容不变（只有那张图片）；助手提示名字被占用并换名或提问，最终生成在另一个名字的文件夹里 |
| **C8** | 导出 | 在 C1 的卡片上点「导出代码包」并保存 | zip 能解压；里面有 `package.json`、`packages\portal\src`；**没有** `node_modules`、`.octo-fastui` 文件夹和 `.octo-fastui.json` |
| **C9** | 重启后点卡片 | 完全退出 Octo 再打开，依次点 C1、C4 的卡片 | 先显示「编译中」，然后分别显示各自的页面 |
| **C10** | 中文路径 | 在 `D:\设计稿\fastui测试` 重复 C1 | 同 C1 |
| **C11** | 图表 skill | 在 `D:\fastui-code` 新建对话：「用 chart-vue-creator 做一个月度销量柱状图，顶部写『这是 D』」 | 期望同 C1：工作区里虽然已有 fastui 工程，但还没有图表工程，所以**不弹问题**；新建图表工程，卡片显示「这是 D」；C1、C4 的卡片不受影响。之后在同一工作区再新建对话「再做一个折线图」→ 弹出的选择里**只列出图表工程**，不列 fastui 工程 |
| **L1** | 老对话的老卡片 | 打开 L-A，点升级前留下的卡片 | 显示「这是 L-A」 |
| **L2** | 老对话继续改 | 在 L-A 里：「把顶部文字改成『这是 L-A2』」 | 不弹问题；工作区 `.octo\<会话id>\outputs\` 下没有新建工程文件夹，改的是原工程；卡片显示「这是 L-A2」 |
| **L3** | 老对话导出 | 在 L-A 的卡片上点「导出代码包」 | 导出成功，内容同 C8 的检查项 |
| **L4** | 老对话多产物 | 打开 L-B，交替点两张卡片 | 分别显示「这是 L-B1」「这是 L-B2」 |
| **L5** | 普通工作区新对话 | 在 `D:\fastui-legacy` 新建对话生成一个页面，顶部写「这是 L-C」 | 不弹问题；工程在 `.octo\<新会话id>\outputs\` 下；卡片显示「这是 L-C」 |
| **R1** | 回归 · 普通设计流程不弹问题 | 在两类工作区各新建一个对话，发一条不涉及 fastui 的模糊设计需求：「做一个登录页」 | 不出现问题表单，和升级前的行为一致 |
| **R2** | 回归 · 其他产物 | 两类工作区里的 html 产物卡片、外链卡片 | 行为不变 |
| **R3** | 回归 · 退出清理 | 预览过几个工程后正常退出 Octo，执行下面的端口检查命令 | 8081 往上没有残留的监听端口 |

#### 失败时收集

1. 对话截图，以及**展开后的工具调用**（要能看到助手实际执行的命令全文，尤其是 `new-session` / `verify` 后面的参数）
2. 执行下面的命令，把输出贴回来（把 `<工程名>` 换成实际的文件夹名）：

```powershell
# Windows / PowerShell
# 主进程日志里 fastui 相关的行（Beta 版把 ai.octo.desktop 换成 com.huawei.octoagent.beta；找不到时在 $env:APPDATA 下搜 main.log）
Get-Content "$env:APPDATA\ai.octo.desktop\logs\main.log" -Tail 300 | Select-String "\[fastui\]"
# 工程标记与运行时日志（代码工作区）
Get-Content "D:\fastui-code\<工程名>\.octo-fastui.json"
Get-ChildItem "D:\fastui-code\<工程名>\.octo-fastui" -Recurse | Select-Object FullName, Length, LastWriteTime
Get-Content "D:\fastui-code\<工程名>\.octo-fastui\octo-fastui.log" -Tail 100
Get-Content "D:\fastui-code\<工程名>\.octo-fastui\devserver.log" -Tail 100
# C1 第④条：工作区父目录不应出现这些文件
Get-ChildItem "D:\" -Force | Where-Object Name -like "*octo-fastui*"
# 宿主心跳（应含 layout: 2）
Get-Content "$env:LOCALAPPDATA\OctoAgent\fastui-env\.octo-host.json"
# R3：残留端口
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 8081 -and $_.LocalPort -le 8120 } |
  Select-Object LocalPort, OwningProcess
```

```bash
# macOS
grep "\[fastui\]" ~/Library/Logs/*/main.log | tail -100
cat "<工作区>/<工程名>/.octo-fastui.json"
tail -100 "<工作区>/<工程名>/.octo-fastui/octo-fastui.log"
cat ~/Library/Application\ Support/OctoAgent/fastui-env/.octo-host.json
lsof -nP -iTCP -sTCP:LISTEN | awk '$9 ~ /:(80[89][0-9]|81[0-2][0-9])$/'
```

## 8. 待确认

| # | 问题 | 影响 |
|---|---|---|
| Q1 | `question` 工具当初在 Design 里被屏蔽（UXAI `7c82effb2`）的原因，需与负责人对齐 | 有已知问题的话，§3.6 退回「对话里列选项、结束本轮等回复」 |
| Q2 | 内网真实模板下，往 `<工程目录>/.octo-fastui/` 追加日志会不会触发 webpack 重新编译（预期不会：编译上下文是 `packages/portal`） | 会的话把运行时目录挪出工程目录（例如放进共享池、按工程目录哈希分子目录）；C2 期间留意卡片是否反复刷新 |
