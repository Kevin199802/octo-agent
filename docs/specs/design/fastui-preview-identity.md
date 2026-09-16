# SPEC-DES-004 — fastui 预览服务身份与端口治理

> 状态：草案（v1） · 优先级 P0（正确性缺陷，已在内网被用户撞到） · 规模 [M] · 领域 infra/design
>
> 上游已实现：✗ —— 预览卡片（`text/link`）与 dev server 宿主化都是 Design 侧自建
>
> 从 [SPEC-DES-001](fastui-vue-codegen-pipeline.md) §6（端口分配与生命周期）与 [SPEC-DES-003](fastui-uxai-integration.md) §8.6.1（dev server 宿主化）拆出。那两节描述的机制**本身没错**，错在它们各自成立、但**合起来没有一个端口所有权的单一真相源** —— 这正是要单独立一份 spec 的原因：问题不在任何一个模块内部。

---

## 0. 现象

用户（设计师）报告，2026-09-14：

> 有时候会出现服务卡片（127.0.0.1:8081 等）点击后，共用一个服务的情况；比如前一个对话起了一个服务，然后后一个对话也起了一个，这时候改后一个对话的页面，服务更新后，发现第一个对话起的服务卡片点进去也变成第二个的效果了。同时多个对话执行会偶现。

用一句话概括这个缺陷：**预览卡片的唯一身份是端口号，而端口是会被回收复用的全机资源，卡片却是历史消息里永不失效、也从不校验对面是谁的静态文本。**

---

## 1. 根因：端口所有权在三处各记一份，三份从不同步

| # | 记在哪 | 作用域 | 何时写 | 何时失效 |
|---|---|---|---|---|
| ① | `.ports/<port>` 占位标记 | **单个工作目录**（`<用户所选目录>/.octo/.ports/`） | `new-session.mjs` 分配端口时 | 会话目录被删 **且** 标记超 60 秒无人接手才回收；**dev server 停掉不释放** |
| ② | `.octo-fastui.json` 的 `port` | 单个会话 | `new-session.mjs` 写一次 | **永不失效** |
| ③ | 真实 TCP 监听 | **全机** | 宿主 `ensure()` spawn 时 | LRU 淘汰 / 进程退出即释放 |

三处的失配是全部故障的源头：

- **① 的作用域比 ③ 小一级**。`.ports` 建在 `path.dirname(S.sessionRoot)`，即 `<instance.directory>/.octo/`，而 `instance.directory` 是**用户所选目录**、每个会话树可以不同（`octo-session-workdir.ts` 取根会话的 `directory`）。两个对话挂在不同目录 = **两张互不可见的登记表，都从 8081 开始扫**，§6.2.1 那套原子占位在跨目录时完全不参与。
- **② 永不失效，③ 却会被主动回收**。宿主 `MAX_SERVERS = 3` + LRU「关最旧的」是设计内的常规行为（`fastui-devserver.ts:23`）—— 设计师开第 4 个对话，第 1 个的 dev server 就被关掉、端口还给系统，但它的 `.octo-fastui.json` 里 `port: 8081` 和 `.ports/8081` 标记都还在。
- **宿主是 ② 的消费者，不是 ③ 的仲裁者**。`ensure()` 直接 `env: { OCTO_PORT: String(state.port) }` 就 spawn，不 probe、不检测冲突、不处理 `EADDRINUSE`。代码注释本身就写着「OCTO_PORT 缺了会回落 8081，多会话必撞」—— 但它没有防住「`state.port` 本身已经被别人占了」这一种。

---

## 2. 污染路径与实测判定

实测环境见 §7.1（外网 Mac，用假 dev server 替换 `turbo-ui-cli-service`，`new-session.mjs` / `verify.mjs` / `port.mjs` 一行未改）。

| # | 路径 | 需要并发 | 判定 |
|---|---|---|---|
| P1 | **跨工作目录**的两个会话并发 `new-session` → 两张 `.ports` 表互不可见 → **都拿到 8081** | 是 | ❌ **实测必现**（E2） |
| P2 | LRU 关掉最旧的 A → 8081 释放 → 新对话 B 扫到空闲捡走 → **A 的历史卡片指向 B 的服务** | 否 | ❌ **实测必现**（E5）；与用户描述逐字吻合 |
| P3 | A 被 LRU 淘汰后用户切回 A → 宿主拿 `state.port`（仍是 8081）重新 spawn → 该端口已属 B → A 的进程 `EADDRINUSE` 秒退、`.devserver.json` 被 `exit` 钩子删掉，**而 A 的卡片正指着 B 的服务**，全程无任何用户可见报错（只进 electron-log） | 否 | ⚠️ **代码路径确证，未在假 server 上跑**；需内网复验 |
| P4 | `new-session` 报的 `PORT` 与 `verify` 报的 `PREVIEW_URL` 不是同一个端口，而 SKILL.md ② 说「记住 `PORT`，后面都要用」、⑤ 说「用 `verify` 给的 `PREVIEW_URL`」—— 同一个量两个来源 | 否 | ❌ **实测复现**（E3：`new-session` 说 8081，实际起在 8082，8081 上是另一个对话） |
| P5 | `verify.mjs` 的 `findFreePort(port)` **不传 `claim`**，重试路径完全不占位；`EADDRINUSE` 靠 spawn 后 `sleep(1500)` grep 日志判定，窗口偏紧 | 是 | ⚠️ 在宿主接管的正常链路上**不会走到**（verify 等宿主 15 秒后复用）；仅在宿主未接管的降级路径有效。**降一档处理** |
| P6 | 同一工作目录内并发 `new-session` | 是 | ✅ **未复现，占位有效**（E1：6 进程 → 8081–8086 零重复；E6：A 的服务死后新会话拿 8082，A 的旧卡片是「打不开」而非「串台」） |

**P6 是重要的阴性结论**：§6.2.1 那套原子占位是好的，不要推翻重做，要做的是**把它的作用域从「一个工作目录」提到「一台机器」**。

---

## 3. 方案选型

预览服务的身份校验，业界有三种做法：

| 方案 | 业界对应 | 判断 |
|---|---|---|
| **A. 端口即身份 + 全局锁** | PID 文件、`lsof` 式登记 | ✅ **采纳为 P0-2**。只能保证「活着的会话之间不撞」，管不住「会话删除后端口合法复用，旧卡片改嫁」，所以**单独不够** |
| **B. 服务自证身份** | Vite `/__vite_ping`、webpack-dev-server `/__webpack_dev_server__`、CRA `/dev-server-info` | ⚠️ 思路对，但**落地形态要换**：校验方是 Design 页面，与 `127.0.0.1:<port>` 跨源，fetch 会被 CORS 挡；要么改内网模板加中间件（`turbo-ui-cli-service` 封装的 dev-server 版本未知，`setupMiddlewares` 是否可用没底），要么给 dev server 加 CORS 头。**都不必要** —— 见下 |
| **C. 宿主反向代理** | Next.js dev、Storybook | ✗ 第一版不做。卡片 URL 天然带 sid、永不改嫁，是正解；但要透传 HMR 的 WebSocket，坑深，成本与收益不匹配 |

**采纳 B 的目标，但用宿主内部判据实现，不让服务自证。**

依据：**dev server 现在全部由 Electron 主进程 spawn 并持有**（SPEC-DES-003 §8.6.1 已落地），`running` Map 里就有 `sessionDir → { port, pid, child }` 的权威记录。要回答「8081 上跑的是不是本会话的服务」，主进程查自己的 Map 就够了 —— **零网络、零 CORS、零模板改动**。B 方案里需要服务自证的那个前提（校验方不知道是谁起的）在我们这里不成立。

> 这条依赖「**所有** dev server 都经宿主起」。skill 自管的降级路径（`verify.mjs` 的 fallback、`--port` 接管）不在 Map 里 —— 处理见 §4.1 的「未知来源」一档，**按「无法证明是你的」处理，不按「是你的」处理**。

---

## 4. 方案

### 4.1 P0-1 预览挂载前校验归属（宿主 + 前端）

**落点**：`packages/desktop/src/main/fastui-devserver.ts` 新增导出 + IPC；前端挂在 SPEC-DES-003 §8.6.5 **已有的**「端口没通就先别挂 `src`」那个门禁上 —— 不新增时序，只是把判据从「端口通了吗」升级成「端口通了、而且是你的」。

```ts
export type PreviewOwnership =
  | { owner: "self"; port: number }                      // 就是本会话的，正常挂载
  | { owner: "other"; port: number; actualPort?: number } // 端口属于别的会话 —— 绝不能挂
  | { owner: "none"; port: number }                       // 没人在跑
  | { owner: "unknown"; port: number }                    // 有人在听，但不是宿主起的（降级路径）

export function ownerOf(sessionDir: string, port: number): PreviewOwnership
```

判据（**全部在主进程内，不发任何请求**）：

1. `running` 里有 `sessionDir` 且 `entry.port === port` 且进程活着 → `self`
2. `running` 里**别的** `sessionDir` 占着这个 `port` → `other`（若本会话另有在跑的端口，一并回 `actualPort`，让前端能自愈）
3. 谁都没占，且端口无人监听 → `none`
4. 谁都没占，但端口有人在听 → `unknown`

前端行为（§8.6.5 的门禁必须「尽力而为」而非「通不过就锁死」，这一条延续）：

| 归属 | 行为 |
|---|---|
| `self` | 正常挂 iframe（与今天一致） |
| `other` | **不挂**。显示「该预览端口已被其他对话的服务占用」，给一个「重新启动本对话的预览」按钮 |
| `none` | 带 `actualPort`（本会话其实在跑，只是换了端口）→ **直接切到 `actualPort`**，这一步没有歧义，不切就是干等到探测超时再挂一个必然连不上的地址；不带 `actualPort` → 走既有的「等就绪」逻辑 |
| `unknown` | **挂，但提示不可校验**。理由：降级路径（用户手工 `yarn serve` + `--port` 接管）是 SKILL.md 明确教过的用法，不能因为校验不了就把人锁死 |

> **这一条单独就能消灭用户看到的全部串台现象**（P2 / P3 都会在挂载前被拦下）。P0-2 及以后是让冲突本身更少发生，不是替代它。

### 4.2 P0-2 端口登记表提到「一台机器一张」（skill）

**落点**：`scripts/lib/port.mjs` + `scripts/new-session.mjs`

- 登记表目录从 `<instance.directory>/.octo/.ports/` 改为 **`envDir()/.ports/`**（共享池，一台机器一份，与端口的真实作用域对齐）
- 标记内容加 `projectDir` 与 `pid`（原来只有 `sessionRoot` + `at`）
- 陈旧判据维持「两条同时成立」的结构不变（§6.2.1 的实测依据仍然有效），只把第二条从「会话状态文件不存在」扩成「会话状态文件不存在 **或** 标记里的端口既无人监听、也不在宿主的运行表里」

> **不推翻 §6.2.1**：`O_EXCL` 原子占位 + 60 秒接手窗口这套是实测有效的（本次 E1 复验：6 进程零重复），只改它的作用域。

**迁移**：旧的 `<项目>/.octo/.ports/` 不读、不迁、不删 —— 它记的是上一个版本的状态，跨版本没有意义。留在磁盘上是无害的孤儿目录。

### 4.3 P0-3 宿主起服务前确认端口可用（宿主）

**落点**：`fastui-devserver.ts` 的 `ensure()`

spawn 前先探一次 `state.port`：

- 空闲 → 照用
- 被占，且占用者是本会话在 `running` 里的条目 → 直接复用（等价于今天的幂等分支）
- **被占，且不是本会话的** → 顺序上扫一个新端口，spawn 用新端口，并**回写 `.octo-fastui.json` 的 `port`**（宿主就此成为端口分配的一方，`verify` 与 export 读到的都是它）

没有这一条，P3 就永远修不好：A 被 LRU 淘汰后，它的 `state.port` 会一直指向一个已经改姓的端口，每次切回 A 都是一次 `EADDRINUSE` 秒退。

> 回写状态文件后，**卡片上的端口号会与历史消息里的不一致** —— 这正是 P0-1 存在的理由：卡片不再被信任，挂载前一律以宿主的判定为准。

### 4.4 P0-4 卡片端口只留一个来源（skill）

**落点**：`scripts/verify.mjs` 的 `ok()` 输出 + `SKILL.md` ②⑤

`verify` 成功时多输出一行，**把整个标签拼好**：

```
PREVIEW_CARD: <artifact type="text/link" title="<产物名>">http://127.0.0.1:<port></artifact>
```

- SKILL.md ⑤ 改成：**把 `PREVIEW_CARD:` 后面那一整行原样输出**，不要自己拼端口、不要自己起标题
- SKILL.md ② 的 `PORT` 改标注为「仅供排查，**不要**用于输出卡片」

依据：端口与标题都来自同一次、同一个脚本的同一行输出，模型只做复制。这消灭 P4，也让 §4.5 的标题不依赖模型自觉。

### 4.5 P1 卡片标题用产物文件夹名（前端）

**现状**：[insight-turn.tsx:304-311](../../../UXAI/packages/app/octoapp/pages/make/components/insight-turn.tsx) 对 `link` 类型**无条件**用 `extractLinkTitle(content)` 覆盖模型给的 `title`，注释写明理由是「content 是路径，标题应为文件名；模型声明的 title 不可靠」。对 `http://127.0.0.1:8081` 这种没有 path 的 URL，派生只能回退到 host，于是标题就是 `127.0.0.1:8081`。

**改法是收窄，不是推翻**：那条「标题应为文件名」的依据，在 content 根本没有文件名可取时本就不成立。

```
能从 content 的 pathname 派生出文件名 → 用派生的（维持现状，磁盘路径 / 带路径的 URL 都不受影响）
派生不出来、只剩 host        → 用模型给的 title；title 也没有才回退到 host
```

实现上给 `extractLinkTitle` 加一个「这个标题是不是 host 兜底来的」的出参，调用点据此决定要不要覆盖。

**这一条是可读性改善，不是修复**，必须和 §4.1 分开看：

- 它不阻止串台 —— 点进去仍是那个 URL
- 两个对话的产物名还可能撞（模型都总结成 `user-profile-page`）
- 它的价值是：卡片在列表里能被认出来，以及串台发生时用户更容易看出不对

---

## 5. 改动清单（按 PR 拆）

| PR | 仓 | 内容 | 依赖 |
|---|---|---|---|
| **A** | octo-agent | §4.2 登记表提到共享池；§4.4 `PREVIEW_CARD` 输出 + SKILL.md ②⑤；§7.1 复现脚本入仓 | — |
| **B** | UXAI | §4.1 `ownerOf()` + IPC + 前端门禁升级；§4.3 `ensure()` 起前探端口 + 回写状态文件 | 与 A 无编译期依赖，可并行 |
| **C** | UXAI | §4.5 卡片标题 | 依赖 A（`title` 属性要有人写） |

三个 PR 都**必须增量式兼容改造，不得影响 Design 现有功能**（沿用 SPEC-DES-003 的硬约束）。

---

## 6. 不做

- **反向代理**（§3 的 C）。第一版不做，理由见选型表。若将来端口号要对用户完全不可见，再提。
- **给 dev server 加自证接口**（§3 的 B 的原形态）。宿主已经是权威，加了是冗余；真要加也得等内网确认 `turbo-ui-cli-service` 的中间件形态。
- **修 `verify.mjs` 的 `EADDRINUSE` 1500ms 窗口**（P5）。宿主接管后正常链路走不到那里，现在动它是在死代码上花预算。**留作已知缺口**，等哪天降级路径变成主路径再说。
- **端口号稳定性**。§4.3 起，一个会话的端口**可能在生命周期内变化**。这是刻意的：与其守着一个已经改姓的端口号，不如换一个能用的 —— 前提是 §4.1 保证了卡片不会指错人。

---

## 7. 验证

### 7.1 外网自动化复现（可在 Mac / Windows 跑，**不需要内网组件库、不需要 skill 运行环境**）

**这一节是给测试同学和我们自己做前后版本对照的主路径。** 已在 2026-09-14 于 macOS 跑通并复现出 §2 的 P1 / P2 / P4。

构成：

- **假 dev server** 替换 `@turboui/turbo-ui-cli-service` —— 一个 40 行的 `http.createServer`，读 `OCTO_PORT` 监听 `127.0.0.1`，**响应体直接回 `SERVED_BY=<projectDir>` 和当前 `views/index.vue` 的内容**（于是「这个端口上跑的是谁的服务」可以被 `curl` 一句话判定）；日志按 webpack 的形态打 `Compiling...` / `Compiled successfully`，`EADDRINUSE` 时打真实错误码后退出
- **假模板** —— 只需 `new-session.mjs` 自检要求的那 5 个文件
- **skill 脚本原样复制**，`new-session.mjs` / `verify.mjs` / `lib/port.mjs` **一行不改**

可调参数：`FAKE_LISTEN_DELAY_MS` 模拟「webpack 先编译、后 listen」的时间窗（真实首次编译 1–3 分钟）。

落点：`skills/fastui-vue-creator/scripts/repro/`（随 PR-A 入仓），`node scripts/repro/run.mjs` 一把跑完下表。

| 用例 | 步骤 | 改之前（当前 dev） | 改之后（期望） |
|---|---|---|---|
| **E1** 同目录并发 | 同一工作目录下 6 个会话并发 `new-session` | ✅ 8081–8086 零重复 | ✅ 不变（不得回归） |
| **E2** **跨目录并发** | 两个**不同**工作目录各一个会话，并发 `new-session` | ❌ **两边都是 8081** | ✅ 8081 / 8082 |
| **E3** 并发起服务 | E2 之后两边并发 `verify`（`FAKE_LISTEN_DELAY_MS=8000`） | ❌ 一个赢，另一个的 dev server 被 `EADDRINUSE` 打死 | ✅ 两个都起得来 |
| **E4** 端口来源一致 | 单会话跑完 `new-session` → `verify` | ❌ 两者的端口可能不同，且 `PREVIEW_CARD` 不存在 | ✅ `PREVIEW_CARD` 那行的端口 = 实际监听端口 |
| **E5** **端口回收改嫁** | A 起服务（记下卡片 URL）→ 杀掉 A 的服务 → 另一目录的新会话 B 起服务 → `curl` A 的旧卡片 URL | ❌ **返回 `SERVED_BY=<B 的目录>`** | ✅ B 不再捡走该端口（P0-2）；即便捡走，宿主判定为 `other`（P0-1，需在 UXAI 侧验，见 §7.2） |
| **E6** 同目录端口回收 | 同 E5 但两会话在同一目录 | ✅ B 拿 8082，A 的旧 URL 无响应 | ✅ 不变（不得回归） |

> `curl` 在 Windows PowerShell 里是 `Invoke-WebRequest` 的别名、参数不同，复现脚本内部统一用 node 发请求，不依赖 `curl`。

### 7.2 内网手工验证（**Windows / PowerShell**，走真实 Octo + 真实组件库）

前置：装好 fastui 环境（`ensure-env` 通过），准备两个**不同**的工作目录，例如 `D:\fastui-a` 与 `D:\fastui-b`。

| 用例 | 操作 | 改之前 | 改之后（期望） |
|---|---|---|---|
| **N1 跨目录串台** | ① 在 `D:\fastui-a` 开对话 A，让它生成一个页面（内容写明「这是 A」），记下卡片端口<br>② 切到 `D:\fastui-b` 开对话 B，同样生成（内容写明「这是 B」）<br>③ 回到对话 A，点它的卡片 | ❌ 偶现看到「这是 B」 | ✅ 要么正常显示「这是 A」，要么显示「该预览端口已被其他对话的服务占用」+ 重启按钮 —— **绝不能显示 B 的内容** |
| **N2 LRU 淘汰后回切** | ① 连开 4 个对话各生成一次页面（触发 `MAX_SERVERS=3` 关掉最旧的）<br>② 回到第 1 个对话，点它的卡片 | ❌ 白屏 / 偶现显示别的对话的页面，且无任何提示 | ✅ 显示明确状态并能一键重启；重启后端口可能变，但显示的必须是本对话的页面 |
| **N3 卡片标题** | 生成一次页面，看卡片标题 | ❌ `127.0.0.1:8081` | ✅ 产物文件夹名（模型总结的 kebab 名） |
| **N4 回归·单对话** | 单个对话正常走完生成 → 预览 → 改一版 → 预览 | ✅ 正常 | ✅ 不变 |
| **N5 回归·导出** | 点「导出代码包」 | ✅ 正常 | ✅ 不变（§4.3 回写 `port` 不影响 `skillDir` / `projectDir`） |
| **N6 回归·其他 Design 用法** | 普通 Design 对话（不用 fastui skill）生成 html / 磁盘路径 link 卡片 | ✅ 正常 | ✅ 不变 —— 尤其 §4.5 只改「派生不出文件名」那一支，磁盘路径卡片标题必须一字不变 |

**怎么判断「显示的是谁的页面」**：让两个对话生成的页面各带一行显眼的自述文字（「这是 A」/「这是 B」），比看端口号可靠 —— 端口号在 §4.3 之后本来就允许变。

**出问题时抓什么**：

```powershell
# Electron 主进程日志（宿主的 dev server 生命周期都在这里）
Get-Content "$env:APPDATA\<app>\logs\main.log" -Tail 200 | Select-String "\[fastui\]"

# 当前谁在听哪个端口
Get-NetTCPConnection -State Listen -LocalPort 8081,8082,8083,8084 |
  Select-Object LocalPort,OwningProcess |
  ForEach-Object { $_ | Add-Member -NotePropertyName Exe -NotePropertyValue (Get-Process -Id $_.OwningProcess).Path -PassThru }

# 各会话自己记的端口
Get-ChildItem -Recurse -Filter ".octo-fastui.json" D:\fastui-a\.octo, D:\fastui-b\.octo |
  ForEach-Object { "$($_.FullName): $((Get-Content $_.FullName | ConvertFrom-Json).port)" }
```

对应的 macOS 命令：

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':808[0-9]'
find ~/…/.octo -name .octo-fastui.json -exec sh -c 'echo "$1: $(node -p "require(\"$1\").port")"' _ {} \;
```

### 7.3 回归底线

§5 三个 PR 合入后，SPEC-DES-001 §9.1 的 V0 全套 + SPEC-DES-003 已落地的三件（③ dev server 宿主化 / ① 导出按钮 / ⑤ 预览就绪时序）必须仍然通过。**§4.1 改的是既有门禁的判据，不是新增一道门禁** —— 若它把本该能看的预览挡住了，按「尽力而为」原则一律放行并记日志，不锁死。

---

## 8. 诚实的边界

- **P3 只有代码路径证据**，没有在假 dev server 上跑通（它要求宿主参与，而复现环境跑的是 skill 自管路径）。内网 N2 就是为验它设计的。
- **§7.1 的假 dev server 不是 webpack**。它能验端口分配、占位、回收、改嫁这一层，**验不了** 真实 `turbo-ui-cli-service` 从启动到 listen 的时间窗（P5 的严重性取决于这个数），也验不了 HMR 的真实行为。
- **P0-1 依赖「所有 dev server 都经宿主起」**。降级路径（`verify` 自管 fallback、`--port` 接管）落在 `unknown` 一档，按「无法证明是你的」处理 —— 这一档**仍然可能显示别人的页面**，是本方案刻意保留的口子，代价换的是不把用户锁死。
- **产物名撞车不解决**。两个对话都生成 `user-profile-page` 时，§4.5 的标题一样分不出来；身份判定一律以 §4.1 为准，不以标题为准。
