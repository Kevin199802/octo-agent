# SPEC-DES-009 — 分享过来的对话：fastui / chart 产物在本机接手后预览

> 状态：已合入（2026-11-19；内网验证通过，UXAI PR #1163 / octo-agent PR #36 一起合入；skill 随 fastui-vue-creator 1.2.0 / chart-vue-creator 1.5.0 发布，须与含本改动的 Octo 一起上线） · 优先级 P1（会话分享上线后，带 fastui / chart 产物的对话在接收方打不开预览） · 规模 [M] · 领域 infra/design
>
> 上游已实现：✗ —— 会话导入导出 / 分享是 octoapp 自建（UXAI `packages/opencode/src/session/portable*.ts`），fastui 预览宿主是 Design 侧自建（SPEC-DES-003 / 004 / 008）
>
> 前置：[SPEC-DES-004](fastui-preview-identity.md)（卡片 `fastui://<产物名>`，点击时由宿主当场给地址）、[SPEC-DES-008](fastui-workspace-layout.md)（工程标记 `.octo-fastui.json`，宿主按（工作区, 会话, 产物名）查工程）。**本 spec 不改卡片格式、不改宿主查工程的顺序、不改起服务逻辑**，只在「起服务之前」补一步接手。
>
> 范围：`fastui-vue-creator` 与 `chart-vue-creator` 共用同一条管道（同一份标记、同一个宿主、同一种卡片，脚本只有 `ensure-env.mjs` 不同），本 spec 一套方案覆盖两个 skill。

---

## 0. 问题

同事做的会话分享（导出 ZIP / 分享链接 → 对方导入）把对话和产物文件带了过去，但对方点 fastui / chart 预览卡片打不开，也没法 @skill 接着改。

卡片本身不绑机器（只记产物名），绑机器的是工程「能在本机跑起来」所需的几样东西，分享过去后都对不上。

## 1. 断点（2026-11-13 读 UXAI dev `3d1e91e37` 代码确认，未实跑）

| # | 断点 | 出处 |
|---|---|---|
| ① | **代码工作区导出时丢了工程标记**。project 范围导出按 `isProjectFile` 过滤，点开头的文件一律不要，`.octo-fastui.json` 在其中；宿主与脚本只认带标记的目录（SPEC-DES-008 §3.2「唯一判据」） | `portable.ts` `isProjectFile` / `listFiles` |
| ② | **标记里是发送方的绝对路径**：`envDir / depsDir / nodeBin / skillDir`。宿主 `launch` 直接用它们起服务 → 「找不到用于启动预览服务的 node」或「共享依赖中缺少 turbo-ui-cli-service」 | `fastui-devserver.ts` `launch` |
| ③ | **`node_modules` 链接没了**。导出跳过链接（正确，否则把 1GB 共享池打进去）；接收方要重建，否则编译不过 | `portable.ts` `listFiles`（Dirent 不跟随链接） |
| ④ | **接收方可能没有环境**：从没用过这两个 skill 的机器上没有共享依赖池 | — |
| ⑤ | **会话 ID 变了**：导入生成新 sid，标记 `sessions` 里是旧 sid；@skill 接着改时 `new-session` 判成「别的对话的工程」报 `NAME_TAKEN` | `portable.ts` 导入 `sessionIDs` 映射；SPEC-DES-008 §3.4 |
| ⑥ | **普通工作区导出带上了运行时目录** `.octo-fastui/`（日志、带发送方 pid / port 的 `devserver.json`）。session 范围导出不过滤点开头的文件 | `portable.ts` `listFiles(project=false)` |
| ⑦ | **`packages/portal/node_modules/.bin` 被过滤**（project 范围按 `node_modules` 段过滤）。宿主起服务直连 cli，不受影响；只影响开发拿去 `yarn serve`（SPEC-DES-001 §2.3） | `portable.ts` `isProjectFile` |

**导入后工程落在哪**（决定宿主和 skill 各自去哪找）：

| 发送方工作区 | 接收方导入方式 | 工程位置 |
|---|---|---|
| 普通 | 分享链接 → 普通工作区（session 范围） / 手动导入 | `<W>/.octo/<新sid>/outputs/<产物名>` |
| 代码 | 分享链接 → 代码工作区（project 范围） / 手动导入 | `<W>/<产物名>` |
| 普通 | 分享链接 → 代码工作区（project 范围） | **两份**：`.octo/<新sid>/outputs/<产物名>` 与 `<W>/<产物名>`（导入把会话 `outputs/` 额外复制一份到工作区，`importFiles` 的 shared copy） |

最后一行是陷阱：宿主按「先会话范围」命中 `outputs` 那份，而 skill 在代码工作区用 `--artifact-dir=[Workspace]` 命中 `<W>` 那份 —— 模型改的和卡片显示的不是同一份。§3.3 处理。

## 2. 方案对比

| 做法 | 业界参照 | 结论 |
|---|---|---|
| A. 导入时立刻还原环境 | `npm postinstall`、git `post-checkout` hook | ✗ 导入变慢且可能卡几分钟；不用这两个 skill 的对话也要过一遍判断；导入流程要认识 fastui 布局 |
| **B. 打开时按需还原** | VS Code Dev Containers「Reopen in Container」、StackBlitz / CodeSandbox 打开分享链接时现装依赖 | ✅ **采纳**。只有点了卡片 / @skill 的人才付代价；导入流程不变；接手逻辑留在 skill 自己的脚本里 |
| C. 分享时附带静态构建产物 | Storybook / Chromatic 发布、Vercel Preview | ✗ 页面运行时的 `/env_config/env.js` 由 dev server 中间件提供，静态构建拿不到（SPEC-DES-004 §2）；对方要接着改仍得装环境 |
| D. 靠 SKILL.md 提示词，让用户 @skill 触发重装 | — | 作为**次入口**保留（§3.3），不作主路径：用户第一个动作是点卡片，此时 skill 正文不在上下文里；模型经 shell 跑装环境有 2 分钟默认超时的风险（SPEC-DES-008 §0） |

**为什么不在宿主里用 TypeScript 重写接手逻辑**：标记格式、链接方式、复用判定都在 skill 脚本里（`new-session.mjs` / `lib/link.mjs` / `lib/project.mjs`），两边各写一份必然漂移。宿主只负责编排：按顺序调用 skill 的脚本，读 `RESULT:` 行。与「导出代码包」同一模式（SPEC-DES-003 §8.6.2）。

## 3. 方案

### 3.1 一句话

**点卡片时宿主发现工程「在本机跑不起来」，先调 skill 脚本把环境补齐、把工程接手过来，再照常起服务；@skill 接着改时 `new-session` 自己认出导入的工程并接手。两个入口最终执行的是同一段脚本逻辑。**

接手 = 装好本机环境（需要时） + 把标记改写成本机路径 + 重建 `node_modules` 链接 + 把当前对话 ID 记进 `sessions` + 清掉过期的运行时目录。

### 3.2 判据：「未接手的导入工程」

**工程根没有 `node_modules`（`lstat` 不存在）** —— 这一条就够，且是确定的：

- 本机 `new-session` 建 / 复用工程时一定会建这个链接
- 分享导出一定不带它（链接被跳过、`node_modules` 被过滤）

宿主额外检查「标记里的 `depsDir` / `nodeBin` 在本机是否存在」，不存在也走接手（覆盖「共享池被删了」这类本机情况，接手流程对它同样适用）。

**已知取舍**：

- 用户手工删了本机工程的 `node_modules` 链接，会被当作未接手的工程。后果只是接手一次（重建链接、把当前对话记进 `sessions`），不改代码
- SPEC-DES-001 v12 之前建的旧布局工程，链接建在会话根而不是工程根，点卡片时也会走一次接手（在工程根补建链接）。旧布局工程只在本对话的会话目录里，不会被别的对话认领

### 3.3 skill 侧（`new-session.mjs` + `lib/project.mjs`，两个 skill 同步）

| 改动 | 内容 |
|---|---|
| **自动接手** | `<artifact-dir>/<name>` 已存在、带标记（或旧布局）、且符合 §3.2 判据时：视同本对话的工程（等价于带了 `--reuse`），追加当前 sid；输出 `MODE: reused`、`REUSED_FROM: imported`。其余照现有复用分支走 —— 标记里的 `envDir / depsDir / nodeBin / skillDir` 本来就按本机重写（现有代码），`ensureDirLink` 本来就会建链接 |
| **补 `.bin`** | 接手时若缺 `packages/portal/node_modules/`，从 skill 的 `template/` 复制（断点 ⑦，735 字节） |
| **清运行时目录** | 接手时删掉工程内的 `.octo-fastui/`（旧版本导出的包里可能带着；断点 ⑥）。删除目标固定为「已通过标记校验的工程目录」下的这一个子目录，路径由脚本拼出、不接受参数；`safeToRemove` 是工程级护栏，不适用于这里 |
| **与宿主同序找已有工程** | 有 `OCTO_SESSION_ID` / `OCTO_WORKSPACE_DIR` 时，若 `<W>/.octo/<sid>/outputs/<name>` 是工程，就用它，不论 `--artifact-dir` 给的是什么；`--list` 也把这个目录列进来。与宿主「先会话范围」一致（SPEC-DES-008 §3.7），消除 §1 末行的两份副本分叉。代码工作区下本机自建的工程不会出现在会话 `outputs` 里，所以只影响导入 / 旧布局工程 |
| **`--list`** | 未接手的导入工程显示 `this-session: yes`，按 SPEC-DES-008 §3.6 不提问、直接沿用 |
| **SKILL.md** | 第 ② 步加一句：「`MODE: reused` + `REUSED_FROM: imported` 表示这是分享导入的工程，已在本机接手，照常继续」。不新增步骤 —— 补环境由第 ① 步 `ensure-env` 照旧完成 |

**不改**：`verify` / `export-zip` 的工程定位（接手后 `sessions` 已含当前 sid，SPEC-DES-008 §3.5 第 3 条照常命中）。

### 3.4 宿主侧（UXAI `packages/desktop`）

**新文件 `main/fastui-prepare.ts`**，导出 `prepare(target)`，约定「返回结果对象、永不 throw」：

```
resolveProject(target)                       ← 现有，不改
  → 判据（§3.2 + depsDir / nodeBin 不存在）不成立 → 不需要接手，直接返回 ok
  → ① 定位 skill：标记里的 skill 名（旧布局缺省 fastui-vue-creator）
       → 复用 fastui-export.ts 的 resolveScript（按 name 向 server /skill 要本机 location）
       → 找不到：报「本机未安装 <skill 名>，无法预览该产物」
  → ② 选 node：读本机 <fastuiEnvDir()>/env.lock.json 的 nodePath，存在就用
       → 没有：先跑安装脚本（③），再读一次
  → ③ ensure-env.mjs
       → ENV_MISSING                     → 安装脚本
       → ENV_OUTDATED / ENV_NODE_MISMATCH → 安装脚本 + 升级开关
       → 装完重跑一次 ensure-env；仍失败或其他 FAIL → 返回该 RESULT 行原文
       → OK：拿 NODE_BIN
  → ④ NODE_BIN new-session.mjs --artifact-dir=<dirname(projectDir)> --name=<name> --reuse
       env: OCTO_SESSION_ID=<sid>, OCTO_WORKSPACE_DIR=<W>
       → RESULT: OK 即接手完成；FAIL 返回原文
```

| 约束 | 理由 |
|---|---|
| 安装脚本按平台拼，`execFile` 不经 shell：macOS `bash <skillDir>/scripts/install/install.sh [--upgrade]`，Windows `powershell -ExecutionPolicy Bypass -File <…>\install.ps1 [-Upgrade]` | 与 `ensure-env` 的 `installHint` / `upgradeHint` 逐字同构；不解析 HINT 字符串。`-Upgrade` 不能写成 `--upgrade`（ensure-env.mjs 注释，v14 踩过） |
| 宿主传 `--reuse` | 用户在这个对话里点的就是这个对话历史里的卡片，复用是明确意图 |
| **不用 Electron 自身当 node 跑脚本** | `resolveRuntime` 在共享池没有 node 时把 `process.execPath` 记进标记的 `nodeBin`；用 Electron 跑会把 Electron 可执行文件写进去，之后起 dev server 就是再拉起一个 App |
| 全局串行：同一时刻只跑一个 `prepare` | 安装脚本操作的是全机唯一的共享池 |
| 不计入起服务超时 | 首装几分钟，`FASTUI_OPEN_TIMEOUT_MS`（120 秒）会先把它判死 |
| 脚本输出落日志 | 与现有一致：脚本自己写 `octo-fastui.log`，主进程 `main.log` 记每一步的 RESULT 行 |

**`open()` 增加一种返回**：`{ ok: false, needsPrepare: true, error }`。`resolveProject` 之后、`openProject` 之前判一次（只做存在性判断，毫秒级）；`error` 给不认识这个字段的调用方兜底展示。`restart` 同样判，所以接手失败后点「重新编译」会重新进入接手，而不是拿发送方的路径去起服务。判定函数 `needsPrepare` 放在 `fastui-devserver.ts`（与 `launch` 用同一套 node 回落规则），`fastui-prepare.ts` 只编排。

**IPC**：新增 `fastui-preview-prepare`（preload 暴露 `fastuiPreviewPrepare`）。

### 3.5 前端（UXAI `packages/app/octoapp/pages/make`）

`utils/fastui-preview.ts` 状态机加一个 phase `preparing`：

```
resolving ──open 返回 needsPrepare──→ preparing ──prepare ok──→ 再 open → resolving → loading → ready
                                         └── prepare 失败 ──→ error（RESULT 原文）
```

| 项 | 取值 |
|---|---|
| 遮罩文案 | **「首次在本机打开，正在准备预览环境…」**（2026-11-13 定）。`html-renderer.tsx` 现有「正在编译预览…」那处按 phase 切换。接手阶段**只显示这一行**：编译阶段的副文案「首次打开需要启动本地服务，通常十几秒，请稍候。」不沿用（首装要几分钟，"十几秒"会误导），也不另加副文案 |
| 超时 | `FASTUI_PREPARE_TIMEOUT_MS = 15 分钟`，独立于 `FASTUI_OPEN_TIMEOUT_MS`。安装脚本自身对网络已有超时，这里只兜「卡死」 |
| 失败后重试 | 复用现有「重新编译」按钮（走 `restart` → 再次 `needsPrepare` → 再次 prepare），不新增按钮 |
| 并发 | 同一工程的多个 tab 共享主进程的同一次 prepare（主进程按工程目录去重，与 `opening` 同形） |

### 3.6 分享侧（UXAI `packages/opencode/src/session/portable.ts`）

**现状**：没有 include / exclude 配置清单。「点开头的文件、`node_modules` 一律不要」写死在 `isProjectFile`，被三处共用 —— 导出过滤（`listFiles` / `collectFiles`）、**导入校验**（`validateManifest`，不符合直接抛错，整个导入失败）、导入时会话文件映射到工作区（`importFiles`）。远程黑名单 `portable-exclusions.ts` 只能写扩展名，表达不了目录，且归运维配置。

**改法**：在 `isProjectFile` 旁边放两个常量，带注释写明来由并链到本 spec：

```ts
// fastui / chart skill 的工程标记：接收方靠它认出工程并在本机接手（SPEC-DES-009）。
// 精确到文件名，不放开其他点开头的文件。
const PORTABLE_ALLOWED_HIDDEN = new Set([".octo-fastui.json"])
// fastui / chart 的运行时目录：日志与带本机 pid / 端口的服务记录，换台机器没有意义（SPEC-DES-009）。
const PORTABLE_EXCLUDED_DIRS = new Set([".octo-fastui"])
```

- `isProjectFile`：点开头的段若在 `PORTABLE_ALLOWED_HIDDEN` 里则放行。导出与导入校验同时生效
- `listFiles`：两种范围都跳过名字在 `PORTABLE_EXCLUDED_DIRS` 里的目录

**对其他功能的影响**：`octo-fastui` 在 UXAI 里只出现在 fastui 宿主代码中；白名单是完整文件名，只有恰好叫 `.octo-fastui.json` 的文件受影响。

**兼容性（已接受）**：旧版客户端导入新版导出的包时，只要包里有 `.octo-fastui.json`（即发送方用过这两个 skill），会在导入校验处失败。触发面限于这批对话，处置是通知用户升级客户端。

### 3.7 不做

- **导入流程不改**：不在导入时改写标记、不装环境
- **不改宿主查工程的顺序**（SPEC-DES-008 §3.7）
- **跨工作区 / 新对话复用导入工程**：沿用 SPEC-DES-008 现有规则，不为分享特殊处理
- **静态构建快照**（§2 C）

## 4. 改动清单

| 仓 | 文件 | 改动 |
|---|---|---|
| 本仓 skill（两个同步） | `scripts/new-session.mjs` | §3.3 自动接手、补 `.bin`、清运行时目录、与宿主同序找工程 |
| | `scripts/lib/project.mjs` | 「未接手」判据；`listProjects` 加会话 `outputs` 范围与 `this-session` 判定 |
| | `scripts/new-session.test.mjs` | 用例见 §5.1 |
| | `SKILL.md` | 第 ② 步一句话 |
| 本仓 | `docs/fastui-debugging.md` | 新增日志前缀 `[locate]` / `[adopt]` 与契约值 `REUSED_FROM: imported` |
| UXAI | `packages/desktop/src/main/fastui-prepare.ts` | 新增：§3.4 编排 |
| | `packages/desktop/src/main/fastui-devserver.ts` | 新增 `needsPrepare`；`open` / `restart` 先判它 |
| | `packages/desktop/src/main/fastui-export.ts` | `resolveScript` 加脚本名参数（默认仍是 `export-zip.mjs`）、`parseContract` 导出，无行为变化 |
| | `packages/desktop/src/main/ipc.ts`、`src/preload/index.ts`、`src/preload/types.ts` | `fastui-preview-prepare`；`FastuiOpenResult` 类型 |
| | `packages/app/octoapp/pages/make/utils/fastui-preview.ts` | `preparing` phase、独立超时、接手后只再 open 一次 |
| | `packages/app/octoapp/pages/make/lib/electron-api.ts` | 渲染进程侧 API 类型 |
| | `packages/app/octoapp/pages/make/components/result-viewer/html-renderer.tsx` | 遮罩按 phase 切文案 |
| | `packages/opencode/src/session/portable.ts` | §3.6 两个常量 + 两处判断 |
| | 测试：`fastui-prepare.test.ts`（新增）、`fastui-preview.test.ts`、`portable.test.ts`；`fastui-devserver.test.ts` / `.b2-repro.test.ts` 夹具补依赖链接（本机工程一定有它，缺了会被判成未接手） | |

工作量：skill 侧约百行加测试；UXAI 宿主约 200 行、前端几十行、分享侧十行左右，各带单测。

## 5. 验证

> **验证前先重启 Octo**（主进程新增 IPC、`open` 返回值变化，热更新不生效）。

### 5.1 外网（本地开发环境）

2026-11-18 实跑结果（UXAI 基于 `origin/dev` `d503e6f1a`）：skill 两份各 16/16、verify 13/13；`fastui-prepare.test.ts` 8/8；desktop 全部 160/160；`fastui-preview` + `fastui-subtype` 36/36；`portable*` 97/97（其中两条 5 秒级的旧用例在 4 个文件并发跑时偶发超时，单独重跑通过，与本改动无关）；desktop / app / opencode 三包 typecheck 通过。新增的 `portable.test.ts` 两条用例在撤掉 `portable.ts` 改动后失败，确认测到了改动。

| 层 | 命令 | 覆盖 |
|---|---|---|
| skill | `node --test scripts/new-session.test.mjs`（两个 skill 各跑） | 带标记、无 `node_modules`、`sessions` 不含本会话 → `MODE: reused` + `REUSED_FROM: imported`、标记路径改为本机、链接建好；有链接、不含本会话 → 仍 `NAME_TAKEN`（不误伤）；会话 `outputs` 与 `<W>` 同名 → 用会话 `outputs` 那份；旧布局导入；接手后 `.octo-fastui/` 被删、`.bin` 被补回 |
| 分享 | `bun test` 覆盖 `portable.ts` | project 范围导出含 `.octo-fastui.json`、不含 `.octo-fastui/`；session 范围不含 `.octo-fastui/`；其他点开头文件仍被过滤；含标记的包导入校验通过 |
| 宿主 | `bun test packages/desktop/src/main/fastui-prepare.test.ts` | 照 `fastui-export.test.ts` 的做法：真起 HTTP server 扮演 `/skill`，临时目录放假脚本按序输出契约行。覆盖：不需要接手直接返回；ENV_MISSING → 跑安装 → 重跑 ensure-env；OUTDATED 带升级开关（按平台）；skill 未安装；new-session FAIL 原文透传；两次并发只跑一次 |
| 前端 | `bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-preview.test.ts` | `needsPrepare` → `preparing` → `resolving`；prepare 失败 → `error`；prepare 不受 120 秒超时影响 |

### 5.2 内网验证（依赖内网 skill 组装、共享池托管与真实分享服务）

| # | 场景 | 期望 |
|---|---|---|
| N1 | A（代码工作区）生成 fastui 页面 → 分享链接 → B（**从没用过 skill**，代码工作区）导入 → 点卡片 | 遮罩显示「首次在本机打开，正在准备预览环境…」，装完自动编译出页面 |
| N2 | 同 N1，B 已用过 skill | 接手几乎无等待，直接进入「正在编译预览…」 |
| N3 | A 普通工作区 → B 普通工作区 | 同 N2 |
| N4 | A 普通工作区 → B 代码工作区（两份副本） | 点卡片与 @skill 接着改作用于同一份（会话 `outputs`）；改完的新卡片显示改后的页面 |
| N5 | N1 / N3 之后，在导入的对话里 @skill 说「把按钮改成红色」 | 不提问，`REUSED_FROM: imported`，verify 通过，新卡片可预览 |
| N6 | 不点卡片，直接在导入的对话里 @skill 接着改 | 同 N5，环境由第 ① 步补齐 |
| N7 | Windows ↔ macOS 互相分享各一遍 | 同 N1 |
| N8 | chart-vue-creator 产物走一遍 N1 | 同 N1 |
| N9 | 旧版客户端导入含标记的包 | 导入失败（已接受），升级后成功 |

## 6. 发布顺序

skill 与 App 可各自先发，均不会让现有功能变坏：

- 只发 skill：@skill 路径可用；点卡片仍报原来的错
- 只发 App：宿主调旧版 `new-session --reuse` 也能完成接手（旧版复用分支同样会改写路径、建链接），但 §1 末行两份副本的分叉要等 skill 新版才消除

## 7. 与会话分享的配合（PR 描述同步此节）

给维护 `portable*.ts` 的同事：

1. **改了什么**：`portable.ts` 新增 `PORTABLE_ALLOWED_HIDDEN`（放行 `.octo-fastui.json`）与 `PORTABLE_EXCLUDED_DIRS`（排除 `.octo-fastui/`），分别接进 `isProjectFile` 与 `listFiles`。
2. **为什么**：`.octo-fastui.json` 是 fastui / chart skill 的工程标记，接收方靠它认出工程、在点卡片时于本机补环境并起服务；`.octo-fastui/` 是本机运行时文件（日志、pid、端口），带过去无用且可能误导。
3. **影响范围**：只有恰好叫这两个名字的文件 / 目录受影响；其他点开头文件、`node_modules` 的规则不变。导入流程不变。
4. **兼容性**：旧版客户端导入含 `.octo-fastui.json` 的包会在导入校验处失败，已与需求方确认接受，通过通知升级处理。
5. **以后再有类似需求**：往这两个常量里加，注释写明归属的模块与 spec。
