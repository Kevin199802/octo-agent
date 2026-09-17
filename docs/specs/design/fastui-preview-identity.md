# SPEC-DES-004 — fastui 预览：卡片不记端口，点击时当场取服务

> 状态：已实现待内网验证（v2，2026-09-17 整体改写，推翻 v1 的「端口治理」方案） · 优先级 P0（正确性缺陷，内网用户实撞） · 规模 [M] · 领域 infra/design
>
> 上游已实现：✗ —— 预览卡片（`text/link`）与 dev server 宿主化都是 Design 侧自建
>
> 从 [SPEC-DES-001](fastui-vue-codegen-pipeline.md) §6（端口分配与生命周期）与 [SPEC-DES-003](fastui-uxai-integration.md) §8.6.1（dev server 宿主化）拆出。**本 spec 生效后，001 §6 的端口分配与 003 §8.6.1 的文件契约以本 spec 为准。**

---

## 0. 现象

设计师报告（2026-09-14）：

> 有时候会出现服务卡片（127.0.0.1:8081 等）点击后，共用一个服务的情况；比如前一个对话起了一个服务，然后后一个对话也起了一个，这时候改后一个对话的页面，服务更新后，发现第一个对话起的服务卡片点进去也变成第二个的效果了。同时多个对话执行会偶现。

同一批排查中还确认了两件相关的事：

- **同一个对话可能有多个产物工程**（`new-session --name` 换个值就是另一个工程），而会话状态文件 `.octo-fastui.json` 只有一份，后建的会覆盖前一个的记录
- **关掉 Octo 后端口仍被占用**：`verify.mjs` 在宿主没接管时会自己 `detached` 起 dev server，宿主不知道这个进程，退出时收不到

---

## 1. 根因

**端口被写死进了卡片。** 卡片 `<artifact type="text/link">http://127.0.0.1:8081</artifact>` 是历史消息里的静态文本，生成之后永远不变；而端口是全机共享、会被回收复用的资源。宿主 `MAX_SERVERS = 3` 的 LRU 会主动关掉最旧的服务、把端口还给系统，下一个对话捡到这个端口后，旧卡片就指到了别人的服务上。

端口还分别记在三个地方，而且三处从不同步：各工作目录各自一份的 `.ports` 占位表、永不失效的 `.octo-fastui.json` 里的 `port`、真实的 TCP 监听。另外，端口在模型写代码**之前**就由多个 `new-session` 进程各自分好，离真正监听还隔着好几分钟，跨工作目录时互相看不见。

---

## 2. 方案演进（避免重复推演）

| 方案 | 结论 | 理由 |
|---|---|---|
| **v1：端口治理**（登记表提到全机一张 + 宿主归属判定 + 切端口自愈 + 回写端口） | ✗ **已废弃**（UXAI #866、octo-agent #29 已关闭，未合入） | 前提仍是「端口写在卡片上」，只能不断补漏。review 发现补丁本身会制造新的错误显示：同对话多产物时，自愈逻辑会把卡片 A 切到工程 B 的端口。多产物、孤儿进程也都没解决 |
| **反向代理**（卡片写 `127.0.0.1:<固定端口>/p/<id>/`） | ✗ 否决 | 要处理 HMR WebSocket 与 `publicPath`，引入一个新的常驻组件。卡片不记端口已经能解决问题，不需要这一层 |
| **升级 webpack-dev-server 到 v4，用 `port: 'auto'`** | ✗ 否决 | ① 内网实测装上的是 **3.11.3**（手改 lock 后仍被解析回 3.x）；② 模板 `turboui.config.js` 用的 `disableHostCheck`、`before(app, server)` 在 v4 已移除（改为 `allowedHosts`、`setupMiddlewares`），照原样升级，这两项要么报错、要么静默失效——`before` 里提供 `/env_config/env.js` 的中间件一旦不执行，页面运行时的全局变量就是空的；③ dev server 从共享依赖池加载，升级要改池子的 lock，会触发所有机器重装；④ **没有必要**：见 §3，端口由宿主在 spawn 时挑，v3 下就能做 |
| **每次点卡片都重启服务** | ✗ 否决 | 编译约 10 秒，时间可以接受，但会引入两类故障：① 模型跑 `verify` 时依赖同一个服务和它的日志，用户这时点一下卡片，服务被杀掉重起，`verify` 会误报失败，模型转而去改本来没问题的代码；② 连点或切卡片时反复杀起，Windows 上 `taskkill` 是异步的，旧进程没退干净新进程就起来，端口或目录还被占着 |
| **v2：卡片只记产物，点击时由宿主当场取服务（活着就复用，否则当场起）** | ✅ **采纳** | 见 §3 |

---

## 3. 方案

### 3.1 一句话

**卡片上记的是"哪个产物"，不是"去哪个地址"。地址在点击那一刻由宿主当场给出。**

### 3.2 流程

决定一个产物只需要两样东西，而且都不会过期：

- **哪个对话**：点卡片时就在这个对话里，前端本来就知道 sessionId，也就知道会话目录 `.octo/<sid>`
- **哪个产物**：卡片上的产物名。工程目录 `.octo/<sid>/outputs/<产物名>` 是磁盘上的固定路径

```
前端：(会话目录, 产物名) ──IPC──▶ 宿主
宿主：内存里有这个工程的服务，进程活着，端口也能应答？
       ├─ 是 → 直接返回它的端口
       └─ 否 → 挑一个空闲端口 → 起服务 → 等端口可连 → 返回端口
前端：拿到端口，拼出 http://127.0.0.1:<端口>，挂 iframe
```

"应答探测"探的是宿主**这一刻**手里的端口，不是卡片上记的。Octo 关闭再打开后，宿主内存是空的，一定走"否"分支：当场起服务、当场挑端口，编译十来秒后出页面。**不存在"拿一个旧地址去唤起"的情况。**

### 3.3 卡片格式

```
<artifact type="text/link">fastui://<产物名></artifact>
```

- 由 `verify.mjs` 成功时在 `PREVIEW_CARD:` 行里拼好，模型原样输出，不自己拼
- 卡片标题直接取 `<产物名>`
- `fastui://` 不是能在浏览器里打开的地址，只在 Octo 内被识别。这是有意的：它不带端口，也就不会过期

**老卡片**（`http://127.0.0.1:<port>`，本方案之前生成的）：只要所在对话是 fastui 会话（会话目录下有 `.octo-fastui.json`），就按"产物名未知"处理。该对话 `outputs/` 下只有一个工程时用它；有多个时**明确报错**，提示重新生成预览，不去猜。

### 3.4 端口怎么挑

所有正常路径下的 dev server 都由 Electron 主进程这**一个进程**来起，所以端口由它在 spawn 那一刻挑：

1. 从 8081 往上找：跳过内存里已分给活着的服务的端口，再确认空闲——试绑 `127.0.0.1`，**并对 `127.0.0.1` 与 `::1` 各做一次连接探测**。只试绑 `127.0.0.1` 看不到监听在 `0.0.0.0` / `::` 上的进程（macOS 上 Node 给监听设了 `SO_REUSEADDR`，别人占着 `0.0.0.0` 时照样能绑上 `127.0.0.1`）。**不改成去试绑 `0.0.0.0`**：Windows 上监听非环回地址会弹防火墙确认框（SPEC-DES-001 §6.4）
2. **先在内存里占住再去探测**，两个工程同时起服务时不会挑到同一个端口（JS 单线程，同步占位没有竞态）
3. 通过 `OCTO_PORT` 传给 dev server（模板本来就读这个变量，不改脚手架）
4. 进程因 `EADDRINUSE` 退出，就换下一个端口重试，最多 5 次

端口**不写进卡片、不写进 `.octo-fastui.json`、不需要登记表**。宿主只在 `devservers/<产物名>.json` 里记一份运行时记录，供 `verify` 找到服务（§3.7），进程退出即删除。

### 3.5 复用还是重起

| 宿主内存里这个工程的服务 | 处理 |
|---|---|
| 不存在 / 进程已退出 | 当场起 |
| 正在启动 | 不重复起，等同一次启动的结果 |
| 已就绪，端口能应答 | 直接复用 |
| 已就绪，端口不应答（卡死） | 杀掉，当场重起 |

"进程活着"的判断依据是宿主手里的子进程对象，纯内存状态，Octo 重启就清空，不存在过期。

**去掉 `MAX_SERVERS` 上限。** LRU 淘汰可能正好杀掉用户正在看、或者另一个对话的 `verify` 正在等的服务，这本身就是"点了不出东西"的来源。代价是开的对话多了会占内存（每个服务数百 MB），靠退出时清理兜底（§3.8）。

> **未决：是否改为按空闲时间回收**（2026-09-17 review 意见）。review 指出：卡片不记端口之后，服务被回收不再影响正确性（下次点击会当场重起），而设计师用一整天、十几个产物，内存可能到几个 GB。建议「既不在预览里显示、也没有 `verify` 在用」的服务空闲 N 分钟后回收。
>
> 本轮未实现，理由：要判断「在预览里显示」需要前端持续上报，要判断「`verify` 在用」需要脚本持续打点，两者任一漏报都会杀掉正在用的服务——这正是本方案要消除的故障类型；而需求方明确过「可用性优先，退出时清理干净即可」。**以内网 N2 实测的内存占用为准再定**：若确有压力，按上述两个信号实现，并为每条信号配漏报测试。

### 3.6 硬性判据（每条对应 §6 的验证用例）

1. **点卡片只有两种结局**：出页面，或出明确的错误（附日志末尾和「重新编译」按钮）。不允许无限转圈，不允许白屏
   - 宿主起服务上限 **90 秒**，超时杀掉并返回错误
   - iframe 挂上后等它的 `load` 事件，**90 秒**没到就显示错误
2. **端口冲突自动换端口**，最多 5 次，用完报错
   - 宿主换进程（起步撞端口、「重新编译」、卡死重起）时，正在等编译结果的 `verify` 跟到新进程接着等，**不误报失败**
3. **不会显示别的工程的页面**：地址只来自宿主内存里「这个会话目录 + 这个产物名」对应的服务
4. **没有 LRU 淘汰**：不会有别的对话把你正在看、或 `verify` 正在等的服务杀掉
5. **退出时清理干净**：正常退出杀掉整棵进程树；崩溃或强杀后，下次启动时清理残留进程

### 3.7 与 `verify` 的协作

`verify` 需要 dev server 在跑才能判断编译结果。在 Octo 里，服务一律由宿主起，`verify` **不自己起**：

1. 读 `devservers/<产物名>.json`，pid 活着 → 直接用（宿主在起服务的**起步阶段**就写这份记录，所以正在起的服务也能被找到，不会重复起）
2. 否则看宿主在不在（共享池里的心跳文件 `.octo-host.json`，其中的 pid 还活着）：
   - 在 → 往共享池的**全局请求目录** `.devserver-requests/` 投一个请求，等宿主起好（最多 60 秒）
   - 不在（外网 V0、终端里直接跑）→ 不等，直接自己起
3. 自己起时端口同样在 spawn 那一刻探测，并登记 pid 供清理（§3.8）

几个细节：

- **宿主起服务失败时写 `status: "error"` 记录**（含错误信息与日志末尾）。`verify` 读到比本次请求更新的错误记录，立即以 `HOST_START_FAILED` 失败——不白等 60 秒，也不在 Octo 里自己起（自己起的进程宿主收不到，用户点卡片看到的也不是它）。更早留下的错误记录不作数
- **等编译期间服务进程没了，先跟记录**：宿主会合法地换进程。10 秒内记录里出现新进程就切过去接着等；记录没了且宿主在就重新请求；都不行才报 `DEVSERVER_EXITED`
- **日志启动标记**：宿主与 `verify` 每次起服务前往日志写一行 `[octo-devserver] start port=<端口>`。日志按产物追加，换过进程后 `verify` 只解析最后一个标记之后的输出，旧进程那几轮编译结果不作数
- **记录里的 pid 活着但端口不应答**（宿主崩溃后 pid 被复用）不算可用服务；「正在起」的记录宽限 120 秒
- **Windows 下只有 `verify` 自起的服务才读 `<log>.err`**，宿主起的服务不读，避免拼进以前残留的旧编译错误

`new-session` 建完工程后，宿主在的话也投一个请求，让服务在模型写代码期间就起好，等到 `verify` 时只剩一次增量编译。

**请求为什么放在共享池、而不是会话目录**：后台跑着的对话用户未必点开过，宿主没法提前知道要去监听哪个会话目录；共享池一台机器只有一份，宿主轮询这一个目录就够了。宿主处理请求时会校验工程目录确实在会话目录的 `outputs/` 下。

模型写代码、`verify` 判定、用户点卡片，用的都是**同一个工程的同一个服务**，谁都不会去杀别人在用的服务。

### 3.8 进程清理

| 场景 | 处理 |
|---|---|
| 正常退出（`will-quit`） | Windows：`taskkill /PID /T /F` 杀整棵树；macOS：服务以独立进程组启动，退出时向整个进程组发 `SIGKILL`（原来的 `child.kill()` 只杀直接子进程） |
| 崩溃 / 任务管理器结束 / `kill -9` | 退出钩子不会执行，任何方案都没法在那一刻清理。改为**下次启动时清理**：每起一个服务就在共享池 `.devserver-pids/<pid>.json` 登记；宿主启动时逐个检查，进程还活着**且命令行里含 `turbo-ui-cli-service`**（防止 pid 被别的程序复用后误杀）就杀掉，然后删掉登记 |
| `verify` 自己起的服务（非 Octo 环境） | 同样登记，由下一次 Octo 启动时清理 |

卡片不记端口之后，残留进程**不会再造成串台**，只是白占内存，所以清理是为了干净，不是为了正确性。

### 3.9 文件契约

所有路径相对会话目录 `.octo/<sid>/`：

| 文件 | 谁写 | 内容 / 用途 |
|---|---|---|
| `.octo-fastui.json` | `new-session` | 工程与环境信息；**删除 `port` 字段**，新增 `nodeBin`（跑 `new-session` 的那个 node，宿主按它起服务——共享池里未必有 node） |
| `devservers/<产物名>.json` | 宿主（或非 Octo 环境下的 `verify`） | `{ port, pid, projectDir, logPath, status, startedAt, owner }`，`status` 为 `starting` / `ready`；起服务失败时为 `{ projectDir, status: "error", error, logTail, at }`。进程退出时**核对 pid 后**删除（新旧进程写同一个路径，旧进程退得慢时不能删掉新记录）；宿主复用服务时记录不在会补写 |
| `devservers/<产物名>.log` | dev server stdout/stderr | `verify` 靠它判定编译结果；替代原来会话级的 `devserver.log` |

共享池（`envDir`）下：

| 文件 | 内容 |
|---|---|
| `.devserver-pids/<pid>.json` | `{ pid, projectDir, startedAt, owner }`，供启动时清理 |
| `.devserver-requests/<id>.json` | `{ sessionDir, projectDir, name, at }`，`new-session` / `verify` 投递，宿主读取后删除 |
| `.octo-host.json` | `{ pid, startedAt }`，宿主心跳，脚本据此判断要不要等宿主 |

**废弃**：`.octo/.ports/`、共享池 `.ports/`、会话级 `.devserver.json` 与 `devserver.log`。旧文件不读、不迁、不删，留在磁盘上无害。

---

## 4. 不做

- **编译失败时在预览上叠加错误横幅**。编译失败时页面上显示什么，由 dev server 自己决定（错误浮层或空白），本方案只保证"不会卡在 loading"。而且卡片是 `verify` 通过之后才输出的，点击时遇到编译失败，只可能是之后又被改坏了
- **同一对话多产物时导出指定工程以外的东西**：导出按钮按卡片上的产物名传 `--project-dir`；老卡片不带产物名，仍按 `.octo-fastui.json` 里的工程导出（与现状一致）

---

## 5. 改动清单

| 仓 | 文件 | 改动 |
|---|---|---|
| octo-agent | `scripts/new-session.mjs` | 删端口分配；状态文件删 `port`、加 `nodeBin`；输出删 `PORT`；宿主在则投预热请求 |
| | `scripts/lib/port.mjs` | 删 `claimPort`，保留探测函数 |
| | `scripts/lib/paths.mjs` | 新增按产物名取运行时文件路径的函数 |
| | `scripts/lib/host.mjs` | 新增：心跳判定、请求投递、pid 登记、结束整棵进程树 |
| | `scripts/verify.mjs` | 按产物名找服务；宿主在则投请求等宿主，不在则自起并登记 pid；服务中途退出立即失败；输出 `PREVIEW_CARD` |
| | `scripts/doctor.mjs` | 日志位置说明改成 `devservers/` |
| | `SKILL.md` | ② 删 `PORT`；⑤ 改为原样输出 `PREVIEW_CARD` |
| UXAI | `desktop/src/main/fastui-devserver.ts` | 按工程管理服务；`open` / `restart`；spawn 时挑端口；去掉上限；轮询共享池请求目录并写心跳；进程组清理；启动清理 |
| | `app/.../make/utils/fastui-preview.ts` | 预览面板状态机（不依赖 Solid，可单测）：取地址 → 等加载，超时进错误态，已出页面后的刷新静默确认不闪 |
| | `desktop/src/main/ipc.ts`、`preload/*` | 新增 `fastui-preview-open` / `fastui-preview-restart`；删除无人调用的 `fastui-devserver-ensure` / `-stop`；导出接口加产物名 |
| | `desktop/src/main/index.ts` | 启动时调用残留进程清理 |
| | `desktop/src/main/fastui-export.ts` | 有产物名时传 `--project-dir` |
| | `app/.../make/index.tsx` | 链接卡片识别 `fastui://`；fastui 会话里的老 loopback 卡片转成"产物名未知"；去掉进会话时预挂服务 |
| | `app/.../result-viewer/html-renderer.tsx` | fastui 卡片走「IPC 取地址 → 挂 iframe → 等 load」，编译中 / 错误两种覆盖层，「重新编译」按钮；其他本地 URL 仍走原门禁 |
| | `app/.../insight-turn.tsx` | `fastui://` 卡片标题取产物名 |
| | `app/.../subtype-handlers/url.tsx`、`history-controller.ts`、`utils/fastui-export.ts` | 识别 `fastui://` |

---

## 6. 验证

### 6.1 外网自动化（Mac）

- **预览面板状态机**（`packages/app` 下 `bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-preview.test.ts`）：正常路径、主进程失败、取地址超时、加载超时、`about:blank` 的 load 不算出页面、刷新不闪、换端口直接加载、重新编译、换目标、晚到的旧结果被丢弃、非 Electron、旧版卡片、卡片解析
- **宿主**（`packages/desktop`，`bun test`）：用假 dev server（读 `OCTO_PORT` 监听、响应体回工程目录）替换 `turbo-ui-cli-service`，覆盖：起服务并返回端口；同工程重复打开复用同一进程；两工程并发打开拿到不同端口；端口被外部占用时自动换端口；已就绪但不应答时重起；启动超时返回错误；`stopAll` 后进程全部退出；登记文件在启动清理时被处理；`0.0.0.0` 上被占用的端口被跳过；卡死时并发打开只起一个；失败写错误记录；复用时补写记录；旧进程慢退不删新记录（review 的 B2 复现）
- **skill**（假共享池 + 假模板，脚本原样调用）：非 Octo 环境下 `verify` 自起、`PREVIEW_CARD` 格式正确；`devservers/<产物名>.json` 已存在且活着时复用；同一会话两个产物互不影响；`node scripts/verify.test.mjs`：宿主换进程时跟随（review 的 B1）、宿主报错立即失败、旧错误记录不作数、pid 复用不干等、`0.0.0.0` 占用
- **预览面板真点一次（Mac，不需要内网）**：自动化到不了"真的点卡片"这一步——需要一条带卡片的对话。手工步骤：① 按上面的方式准备假共享池，用 `OCTO_FASTUI_ENV_DIR=<假共享池> bun run dev` 起桌面端；② 新建 Design 对话，在 `<工作目录>/.octo/<会话id>/` 下手工放 `.octo-fastui.json`（含 `envDir` / `depsDir` / `nodeBin`）与 `outputs/alpha/packages/portal/`；③ 让模型原样回复一行 `<artifact type="text/link">fastui://alpha</artifact>`；④ 点卡片看「编译中」→ 出页面；在 portal 下放 `CRASH` 标记文件后点「重新编译」看错误态与日志；删掉 `alpha` 目录后点卡片看明确报错

### 6.2 内网手工（Windows / PowerShell，真实 Octo + 组件库）

让每个产物的页面带一行显眼的自述文字（「这是 A」「这是 B」），比看端口号可靠。

| # | 操作 | 期望 |
|---|---|---|
| **N1 跨对话** | ① 对话 A 生成页面 ② 另一个工作目录下对话 B 生成页面 ③ 回到 A 点卡片 | 显示「这是 A」 |
| **N2 多对话不淘汰** | 连开 4 个以上对话各生成一次，再逐个回去点卡片 | 每个都显示自己的页面，没有被关掉的 |
| **N3 同对话多产物** | 同一对话让助手先后生成两个产物（不同产物名），交替点两张卡片 | 各显示各的，可以同时预览 |
| **N4 重启 Octo** | 生成后完全退出 Octo，重新打开，点卡片 | 显示「编译中」，十几秒后出页面 |
| **N5 退出清理** | 开几个对话都预览过，正常退出 Octo，在任务管理器 / 下面命令里查 | 没有残留的 node 进程占着 8081 往上的端口 |
| **N6 崩溃清理** | 预览过后在任务管理器里直接结束 Octo 进程，重新打开 Octo | 启动后残留 dev server 被清掉。**特别确认进程树**：结束 Octo 前后各执行一次下面的 `Get-CimInstance` 命令，看真实 `turbo-ui-cli-service` 底下还有没有子进程；启动清理只杀登记过的根进程，根进程先没了、子进程还在监听的情况会漏清 |
| **N7 预览中跑 verify** | 让助手修改页面（会跑 verify），期间反复点卡片 | verify 正常通过；预览不报错 |
| **N8 老卡片** | 打开本方案之前生成过预览的对话，点旧卡片 | 只有一个产物时正常出页面；多个产物时明确提示重新生成 |
| **N9 回归·导出** | 点「导出代码包」；同对话多产物时分别在两张卡片上导出 | 导出的是卡片对应的工程 |
| **N10 回归·其他 Design 用法** | 普通 Design 对话的 html、磁盘路径链接、外链 | 行为不变 |
| **N11 出错不卡住** | 让助手把页面改出编译错误后（不跑 verify）点卡片；或删掉产物目录后点卡片 | 不会一直转圈：出页面，或出明确错误和「重新编译」按钮 |

排查命令：

```powershell
# Windows / PowerShell
Get-Content "$env:APPDATA\<app>\logs\main.log" -Tail 200 | Select-String "\[fastui\]"
Get-NetTCPConnection -State Listen | Where-Object LocalPort -ge 8081 | Where-Object LocalPort -le 8120 |
  Select-Object LocalPort, OwningProcess
Get-ChildItem "<工作目录>\.octo\<会话id>\devservers"
# N6:dev server 的进程树(父子关系)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, ParentProcessId, @{n='Cmd';e={$_.CommandLine.Substring(0,[Math]::Min(160,$_.CommandLine.Length))}}
# 端口探测盲区:确认模板 devServer.host 实际监听在哪个地址(期望 127.0.0.1)
netstat -ano | Select-String ":808[0-9] .*LISTENING"
```

```bash
# macOS
lsof -nP -iTCP -sTCP:LISTEN | awk '$9 ~ /:(80[89][0-9]|81[0-2][0-9])$/'
ls "<工作目录>/.octo/<会话id>/devservers"
```

---

## 7. 边界

- 假 dev server 验不了真实 `turbo-ui-cli-service` 的启动时长和它对 `EADDRINUSE` 的实际表现（是退出还是挂住）。后者如果是"挂住不退"，靠 90 秒启动超时兜底，但会比换端口慢；N1–N3 要留意
- 崩溃后的残留进程要等**下次启动**才清理，这期间只占内存，不影响正确性
- 启动清理只杀登记过的根进程。真实 `turbo-ui-cli-service` 若还有子进程、且根进程先于子进程消失，子进程会漏清（假 dev server 是单进程，测不出来），见 N6
- 预览面板"真点一次"没有自动化，见 §6.1 末条的手工步骤
- 同一台机器同时开两个 Octo 实例不在考虑范围内：两个宿主各自挑端口时会撞，靠 `EADDRINUSE` 重试兜住，但启动清理会误伤另一个实例的服务
