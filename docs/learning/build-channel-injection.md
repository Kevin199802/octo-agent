# 多渠道桌面应用：构建/打包的「渠道」注入

> 起因：内网 Windows 机打 prod 包，渠道却是 dev。排查后发现这不是一个 bug，而是「如何把一个构建维度（channel）一致地贯穿到 build + package 全链路」这一类问题。本文梳理业界标准做法、对比取舍、记录我们的决策与一路踩的坑。
>
> 相关：[env-vars-and-build-modes.md](env-vars-and-build-modes.md)（命令/文件对应表）、[electron-app-name.md](electron-app-name.md)（appId/productName/channel 的四种"名字"）。

---

## 0. 先认清：渠道被谁消费

理解一切的前提——`OCTO_CHANNEL`（dev/beta/prod）在我们这里**不是一个消费者，而是四个**，分散在 build 和 package 两个阶段：

| 消费者 | 阶段 | 怎么读 channel | 用途 |
|---|---|---|---|
| `scripts/predev.ts` → `copy-icons.ts` | dev 前置钩子 | `process.env.OCTO_CHANNEL ?? "dev"` | 拷 `icons/<channel>` 到 resources |
| `scripts/prebuild.ts` → `copy-icons.ts` | build 前置钩子 | 同上 | 同上 + 重建 opencode sidecar |
| `electron.vite.config.ts` | build | `loadEnv(mode).OCTO_CHANNEL ?? process.env.OCTO_CHANNEL` | 注入 `import.meta.env`，分支 publish 配置 |
| `electron-builder.config.ts` | package | `process.env.OCTO_CHANNEL` | 决定 `appId` / `productName` / `publish` |

**关键洞察**：这四处唯一的公共入口是 `OCTO_CHANNEL` 这个**环境变量**。任何"只喂其中一个消费者"的方案（比如只传 `--mode` 给 electron-vite）都会让另外三处拿不到正确 channel —— 这正是大多数坑的根源。

另一条独立的维度是 **`VITE_*` 业务域名**（base URL 等），它只被 renderer 消费，走 vite 的 `loadEnv(mode)` 从 `.env.<mode>` 文件加载。**channel 和 VITE_ 域名是两套机制**，别混为一谈。

---

## 1. 业界标准做法综述

把一个"维度"注入构建管线，业界就这么几类做法：

### A. 环境变量注入

最通用，因为环境变量是所有工具（node/bun/vite/electron-builder）的最大公约数。区别只在**怎么设这个环境变量**：

#### A1. Shell 内联 `VAR=value cmd`
```jsonc
"build:prod": "OCTO_CHANNEL=prod electron-vite build --mode prod"
```
- ✅ 零依赖，Unix（bash/zsh）原生
- ❌ **Windows 不支持这种语法**（cmd.exe / PowerShell 都不认）→ 变量没设上，回退默认
- 这就是我们最初在内网 Windows 上「prod 包变 dev」的根因

#### A2. cross-env（跨平台 shim）
```jsonc
"build:prod": "cross-env OCTO_CHANNEL=prod electron-vite build --mode prod"
```
- `cross-env` 是一个 ~10 行的小包，把 `VAR=value` 解析后用 Node 的 `spawn` 带 `env` 启动子进程，屏蔽 OS 差异
- ✅ 一份脚本 mac/win/linux 通吃；业界事实标准（React、Vue 等脚手架默认带）
- ❌ 多一个 devDependency（零运行时、零传递依赖）

#### A3. 从文件加载（dotenv-cli / `bun --env-file` / node `--env-file`）
```jsonc
"build:prod": "bun --env-file=.env.prod electron-vite build"
```
- ✅ 把环境配置集中到 `.env.prod` 文件，命令里不重复写
- ❌ 依赖文件存在（内网没建就静默失败）；嵌套调用容易出坑（我们遇到过 `bun --env-file .env.prod run package:win` 在某些版本下不执行、只打印脚本列表）
- 适合"一堆变量一起加载"，不适合"就一个 channel"

#### A4. CI 平台注入（**opencode 原生做法**）
```yaml
# .github/workflows/publish.yml
- run: bun run build              # 不带任何 channel 参数
  env:
    OCTO_CHANNEL: ${{ matrix.channel }}
- run: npx electron-builder ${{ matrix.settings.platform_flag }} --config electron-builder.config.ts
  env:
    OCTO_CHANNEL: ${{ matrix.channel }}
```
- CI runner 通过 YAML 的 `env:` 块设进程环境变量，**跨平台天然一致**（GitHub Actions 在 ubuntu/macos/windows runner 上统一处理）
- 脚本本身（`bun run build`）保持"干净"，不内联任何 channel —— 因为 channel 由外层 CI 矩阵决定
- ✅ 多平台 × 多渠道用 matrix 笛卡尔积一把梭，是发布流水线的标准姿势
- ❌ **本地复刻不了**：本地没有 Actions 的 `env:` 机制，开发者在终端手敲时回到了 A1/A2 的问题。这就是为什么"照搬 opencode 原生"在本地行不通——它依赖 CI 平台能力。

### B. 命令行选项 / mode

不走环境变量，把维度做成命令的**显式参数**：
```jsonc
"build:prod": "electron-vite build --mode prod"
```
- vite/electron-vite 的 `--mode` 会让 `loadEnv(mode)` 去读 `.env.<mode>`
- ✅ 跨平台（参数解析与 OS 无关）；命令即文档
- ❌ **只有读 `loadEnv` 的消费者吃得到**。`--mode` 不设 `process.env.OCTO_CHANNEL`，所以 prebuild / electron-builder 这两个不走 loadEnv 的消费者拿不到 → 渠道只对了一半
- 适合"vite 内部的配置切换"，不适合"贯穿 build+package 全链路的维度"

### C. 按维度拆 config 文件

零环境变量，把维度编码进"指向哪个配置"：
```jsonc
"package:prod": "electron-builder --config electron-builder.prod.config.ts"
```
```ts
// electron-builder.prod.config.ts
import { makeConfig } from "./electron-builder.config"
export default makeConfig("prod")
```
- ✅ 完全跨平台、零依赖、零隐式状态
- ❌ 每个维度值要一个文件；而且只解决了 package 这一处消费者，build 阶段的 prebuild/electron-vite 仍需另想办法。在"四处共享一个 channel"的场景下，拆 config 只覆盖了 1/4，不划算

### D. 构建产物写 marker，打包读取

build 阶段把 channel 写进 `out/` 的一个标记文件，package 阶段读它：
- ✅ 能从机制上**杜绝 build/package 渠道错配**（package 永远跟随上次 build）
- ❌ 隐式、有"上次构建残留"心智负担；需要约定 marker 文件路径
- 适合对"错配"零容忍、且 build→package 严格串行的场景

---

## 2. 横向对比

| 方案 | 跨平台 | 新依赖 | 覆盖多消费者 | 防渠道错配 | 本地可用 | 适用 |
|---|---|---|---|---|---|---|
| A1 shell 内联 | ❌ win 挂 | 0 | ✅ | ✗ | ✅ | 纯 Unix 项目 |
| **A2 cross-env** | ✅ | 1（极小） | ✅ | ✗ | ✅ | **共享脚本要跨平台**（我们） |
| A3 env-file | ✅ | 0~1 | ✅ | ✗ | ✅ | 一次加载一堆变量 |
| A4 CI env | ✅ | 0 | ✅ | matrix 保证 | ❌ | 发布流水线（opencode） |
| B --mode | ✅ | 0 | ✗ 仅 loadEnv | ✗ | ✅ | vite 内部配置 |
| C 拆 config | ✅ | 0 | ✗ 仅该工具 | ✗ | ✅ | 单一消费者 |
| D 产物 marker | ✅ | 0 | ✅ | ✅ | ✅ | 严格串行、零容忍错配 |

没有银弹。选型取决于：**消费者有几个、是否要本地可用、能否接受一个小依赖、对错配的容忍度。**

---

## 3. 我们的最终决策

四消费者 + 既要 CI 又要本地（mac/win）+ 不想拆一堆文件 → **以 cross-env 强制注入 `OCTO_CHANNEL` 为主轴，`--mode` 仅负责 VITE_ 域名，`bun run` 负责触发前置钩子，`release.ts` 负责串联两步并锁定同一 channel。**

```jsonc
// packages/desktop/package.json
"dev:beta":    "cross-env OCTO_CHANNEL=beta bun run dev   --mode beta",
"build:beta":  "cross-env OCTO_CHANNEL=beta bun run build --mode beta",
"build:prod":  "cross-env OCTO_CHANNEL=prod bun run build --mode prod",
"package:beta":"cross-env OCTO_CHANNEL=beta electron-builder --config electron-builder.config.ts",
"package:prod":"cross-env OCTO_CHANNEL=prod electron-builder --config electron-builder.config.ts",
"release:win":       "bun scripts/release.ts --win",
"release:mac-arm64": "bun scripts/release.ts --mac --arm64",
"release:mac-x64":   "bun scripts/release.ts --mac --x64",
```

四条设计原则：

1. **channel = cross-env 内联**（A2）。一份 `package:prod` 脚本，mac 上跑 `--mac`、win 上跑 `--win`，**同一行必须两个 OS 都能跑**，所以单靠 shell 内联（A1）不行。cross-env 是让共享脚本跨平台的最小代价。
2. **`--mode` 只喂 VITE_ 域名**（B）。channel 不靠它（靠 cross-env），它单纯让 electron-vite 的 `loadEnv` 读对 `.env.<mode>`。
3. **经 `bun run dev|build` 触发前置钩子**。`prebuild`/`predev` 是生命周期钩子，只在精确脚本名（`build`/`dev`）时触发；所以 `build:prod` 不能直接 `electron-vite build`，必须 `bun run build` 套一层（详见坑 3）。
4. **channel 不写进任何 `.env`**。完全由命令决定，避免 `.env` 自动加载污染（详见坑 4）。`.env.*` 只留 `VITE_*`。

**release = build + package 的一键串联**，无新逻辑：
```ts
// scripts/release.ts（节选）
const buildScript = channel === "dev" ? "build" : `build:${channel}`
await $`bun run ${buildScript}`
await $`bun run package:${channel} ${platform}`   // platform = --win | --mac --arm64 | ...
```
平台/架构当作**调用时的尾部 flag**（electron-builder 原生认 `--win`/`--mac`/`--arm64`），避免"渠道 × 平台 × 架构"的脚本数笛卡尔积膨胀（3×3=9 收敛成 3 channel 脚本 + 3 release 入口）。

CI 仍走 opencode 原生的 A4（`npx electron-builder` + Actions `env:`），**不经过我们这些本地脚本**，互不影响。

---

## 4. 踩坑实录

### 坑 1：Windows shell 内联失效
`OCTO_CHANNEL=prod electron-vite build` 在内网 Windows 上变量没设上 → 回退 dev。**根因是 OS shell 语法差异，不是配置 bug。** 解药：cross-env。

### 坑 2：`bun --env-file` 嵌套调用不执行
`bun --env-file .env.prod run package:win` 在某些 bun 版本 / 嵌套 `bun run` 下，不执行目标脚本、只打印可用脚本列表。教训：env-file 适合一次加载一堆变量，"就一个 channel"用它属于杀鸡用牛刀，还引入新失败模式。

### 坑 3：生命周期钩子只认精确脚本名（隐蔽且危险）
`prebuild` 是 `build` 的 pre-hook，**只在 `bun run build` 触发，`bun run build:prod` 不触发**（钩子名要精确匹配，没有 `prebuild:prod`）。后果：
- `build:prod` = `electron-vite build --mode prod` 直接跳过 prebuild → 不重拷 icon、不重建 sidecar；
- 即便钩子跑了，`copy-icons` 的 channel 来自 `OCTO_CHANNEL` 环境变量，`--mode` 又设不了它 → 拷的还是 dev 图标。

**结果：prod 包可能带 dev 图标**，而且静默，肉眼难发现。解药：`build:prod` 改成 `cross-env OCTO_CHANNEL=prod bun run build --mode prod` —— `bun run build` 必过 prebuild，cross-env 锁定 channel。

### 坑 4：bun 自动加载 `.env` 污染非默认渠道
bun 启动会自动把 `.env` 读进 `process.env`（但**不**自动读 `.env.beta`/`.env.prod`）。内网 `.env` 里写了 `OCTO_CHANNEL=prod`，于是：
- prod 构建恰好"蒙对"（prebuild 从自动加载的 `.env` 读到 prod）；
- 但 **beta 构建被污染**——bun 不自动读 `.env.beta`，prebuild 又不走 loadEnv，channel 仍是 `.env` 的 prod。

这种"恰好对了"最坑，因为它掩盖了机制缺陷。解药：channel 一律 cross-env 强制（真实环境变量优先级高于 `.env` 自动加载），并把 `OCTO_CHANNEL` 从所有 `.env` 文件里删掉。

> 同机制还会咬**业务地址变量**:`.env` 里的 `VITE_OCTO_*` / `OCTO_UXR_MCP_URL` 经自动加载进 `process.env` 后,会**反向盖过** `.env.prod`(因为 `loadEnv` 优先级 `process.env > .env.<mode>`),导致 prod 包连到 `.env` 里的 beta 地址。完整复盘见 [env-dotenv-override-trap.md](env-dotenv-override-trap.md)。结论一致:分环境的值别放 `.env`,只放 `.env.<mode>`。

### 坑 5：三层 channel 优先级要心里有数
同一个 `OCTO_CHANNEL` 可能来自三个地方，优先级高→低：
1. **真实环境变量**（cross-env 设的 / CI Actions `env:` / shell 手敲）——最高，会盖过下面
2. **bun 自动加载的 `.env`**
3. **代码兜底默认**（`?? "dev"`）

设计时让"命令显式指定"永远在最高优先级，就不会被 `.env` 之类的隐式来源坑到。

---

## 5. 给后来者的速查

- 要在**本地**跨平台设构建变量 → **cross-env**，别用 `VAR=x cmd`（win 挂）。
- 要在 **CI** 设 → 用平台的 `env:`（GitHub Actions），脚本保持干净。
- `--mode` 只切 vite 的 `.env.<mode>` 加载，**不等于**设了同名环境变量。
- 改了渠道却没生效，先查：是不是某个消费者（prebuild / electron-builder）走的是 `process.env` 而你只传了 `--mode`？
- 加了 `build:xxx` 变体却发现前置钩子没跑 → 钩子只认精确名，套 `bun run build` 一层。
- 别在 `.env` 里放 channel —— 让它纯粹由命令决定，省掉一整类"自动加载污染"的坑。

---

## 参考代码位置（UXAI 仓）

- `packages/desktop/package.json` — dev/build/package/release 脚本
- `packages/desktop/scripts/release.ts` — build+package 串联
- `packages/desktop/scripts/{prebuild,predev,copy-icons,utils}.ts` — 前置钩子与 `resolveChannel()`
- `packages/desktop/electron.vite.config.ts` — build 阶段 channel + VITE_ 注入
- `packages/desktop/electron-builder.config.ts` — package 阶段 channel → appId/productName
- `.github/workflows/publish.yml` — CI 的 A4 做法（`env:` + matrix）
