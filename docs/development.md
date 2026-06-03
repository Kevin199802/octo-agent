# Octo Agent — 开发、调试、打包指南

> 上次同步:2026-05-29。
> - 主路径在 **macOS, Apple Silicon** 上验证（dev / build / package 全通）。
> - **Windows 11 x64** 已端到端验证（dev 启动 + chat 流式回话），需要按 [§1.1](#11-windows-开发者补充) 做的小量适配已在仓库内打好 patch，开发者无需手工改源码。
> - Linux 未验证；理论上跟 Windows 等价，遇到差异请补到本文档。

里程碑跟踪与验收清单见仓库根 [ROADMAP.md](../ROADMAP.md)。架构与目录边界见 [docs/architecture.md](architecture.md)。

---

## 1. 环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Bun | 1.3+ | 包管理器、脚本运行器 |
| Node.js | 20+ | Electron 主进程、native 模块编译 |
| Xcode CLI Tools | 最新 | **macOS only**:node-pty 等 native 模块编译 |
| Git | 任意 | — |

```bash
bun --version          # 1.3.x
node --version         # v20+
xcode-select -p        # macOS 上应输出路径,无输出则: xcode-select --install
```

### 1.1 Windows 开发者补充

| 项 | macOS | Windows |
|---|---|---|
| 原生编译工具链 | Xcode CLI Tools | Bun 自带 Bun shell + Node 20 已够;**目前仓库内未触发任何 Windows 上必须本地编译的 native 模块**(`@lydell/node-pty` 走预编译 binary) |
| Electron GUI 启动 | `bun run dev:ui` 即可 | 同左 |
| `predev` 中的 `plutil` / `codesign` / `lsregister` / `killall Dock` 调用 | 跑 | 自动跳过(见 §3 `predev` 钩子) |
| Bun bundle 子资源拷贝(`jsonc-parser/lib/umd/impl/*`、`opencode/migration/`) | 自动 | 自动 — `electron.vite.config.ts` 的 `opencode:copy-server-assets` 插件已统一处理,见 [architecture.md §5.4](architecture.md#54-上游接线壳改动清单) |

**首次 `bun install` 前必做的一项配置检查**:

确认 `C:\Users\<你>\.npmrc` 里**没有** `registry=https://registry.npmmirror.com/` 或其他第三方镜像设置。Bun 兼容 npm 配置,会跟读 `.npmrc`;若设了镜像,所有依赖的 tarball URL 会被解析成镜像 URL 并写进 `bun.lock`,造成跨平台同事拉到本不该走的源。

```powershell
# 检查
Get-Content $env:USERPROFILE\.npmrc | Select-String "^registry"
# 应当输出空,或输出 registry=https://registry.npmjs.org/
```

若已经污染 `bun.lock`,**不要 commit 那个 lockfile**,先从干净分支恢复:`git checkout origin/dev -- bun.lock`。**`//registry.npmjs.org/:_authToken=...` 这行(npm 鉴权)保留**,仅删 `registry=...` 那行即可。

---

## 2. 首次准备

```bash
git clone https://github.com/Kevin199802/octo-agent.git
cd octo-agent
bun install
```

### LLM Provider 配置

Octo Agent 主进程会**强制注入** `OPENCODE_CONFIG=~/.config/octo/octo.json`,因此 opencode 后端**只读这个文件**(跟系统上可能装的 opencode CLI 完全隔离)。第一次需要手动建:

```bash
mkdir -p ~/.config/octo
```

最小配置示例(以百炼 Anthropic 兼容网关 + Qwen 为例):

```jsonc
// ~/.config/octo/octo.json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {                                        // 注意是单数
    "bailian": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
        "apiKey": "sk-xxx"
      },
      "models": {
        "qwen3-coder-plus": {
          "name": "Qwen3 Coder Plus",
          "limit": { "context": 1000000, "output": 65536 }
        }
      }
    }
  },
  "model": "bailian/qwen3-coder-plus"
}
```

**踩坑提示**:

- schema 用 Zod `.strict()`,**任何未知字段都会让 session 创建报 500**。常见错误:写成 `providers`(复数)、`apiKey` 写到 provider 顶层而不是 `options` 下、字段名拼写错误
- 若 UI 提示 `opencode/big-pickle`,说明配置没生效(后端在用占位模型),先检查路径和 schema
- 切换 provider/model **需要重启 dev**(opencode 不支持配置热重载)

完整字段说明、provider 协议差异、常见网关写法详见 [learning/opencode-internals.md](learning/opencode-internals.md)。

---

## 3. 日常开发(Mode B:Electron 集成)

**推荐主路径**。一条命令同时拉起 opencode 后端 + Vite renderer + Electron 窗口,改 Vue 文件 HMR,改 main 进程自动重启。

```bash
bun run --cwd packages/desktop-electron dev
```

期望:

- 终端打印 `opencode server listening on http://127.0.0.1:4096`
- Vite 在端口 **5175** 启动(strictPort,被占用会直接报错)
- 弹出 Electron 窗口,显示 octo-ui 首页

### 调试

| 想干什么 | 怎么做 |
|---|---|
| 打开 renderer DevTools | Electron 窗口聚焦后按 `Cmd + Option + I` |
| 看主进程日志 | 启动 `dev` 的那个终端 |
| 看后端 (opencode) 日志 | 同上,主进程 stdout 包含 |
| 改前端立即生效 | 直接改 `packages/octo-ui/src/**/*`,Vite HMR |
| 改 main 进程立即生效 | 改 `packages/desktop-electron/src/main/**`,electron-vite 自动重启 |
| 强制刷新 renderer | DevTools 里 `Cmd + R` 或菜单 View → Reload |
| 仅重启后端 | 目前不支持单独重启,只能整个 dev 重跑 |

### `predev` 钩子

`bun run dev` 之前会跑 `scripts/predev.ts`,做三件事(macOS 上;Windows 自动跳过 2):

1. 拷贝应用图标
2. **macOS only**:`plutil` patch Electron binary 的 `Info.plist`(给 dev 模式菜单栏显示 "Octo AI")、`codesign --force --deep` 重签名、`lsregister -f` 重注册、`touch` + `killall Dock` 刷新。**这段被 `if (process.platform === "darwin")` 包裹**,Windows / Linux 上整段不执行
3. 在 `packages/opencode` 跑一次 `bun script/build-node.ts`,产出 Node bundle 给 main 进程 import

opencode 源码没改时第一次跑过就够了,后续 dev 仍会重复。如果想跳过:`cd packages/desktop-electron && bunx electron-vite dev`(注:跳过会同时跳过 macOS plist 补丁和 opencode bundle 构建,opencode 源没动过才安全)。

### 应用名称的配置位置

"Octo AI" 这个名称在以下四处维护，改名时需同步修改：

| 文件 | 字段 | 作用 |
|---|---|---|
| [`packages/desktop-electron/package.json`](../packages/desktop-electron/package.json) | `productName` | Electron 启动前的默认名（`app.getName()` 初始值） |
| [`packages/desktop-electron/src/main/index.ts`](../packages/desktop-electron/src/main/index.ts) | `APP_NAMES` + `app.setName()` | 运行时名称（macOS 菜单栏左上角；三个 channel 分别配） |
| [`packages/desktop-electron/electron-builder.config.ts`](../packages/desktop-electron/electron-builder.config.ts) | `productName`（各 channel） | 打包产物 `.app` 名称（Dock tooltip 在打包版中的来源） |
| [`packages/desktop-electron/scripts/predev.ts`](../packages/desktop-electron/scripts/predev.ts) | `plutil -replace CFBundleDisplayName/CFBundleName` | dev 模式下 plist 补丁（修正 Electron binary 的 bundle 元数据） |

> dev 模式下 Dock tooltip 仍显示 "Electron"（electron-vite 直接 spawn 二进制，macOS 用二进制文件名作为进程名），属已知限制，打包产物不受影响。

---

## 4. 仅前端调试(Mode A:可选)

只调样式 / 组件结构、不需要后端连通时用。两个终端:

```bash
# 终端 1:opencode 后端
bun run dev:serve
# 期望: opencode server listening on http://127.0.0.1:4096

# 终端 2:octo-ui Vite
bun --cwd packages/octo-ui dev
# 期望: VITE ready, Local: http://localhost:5173/
```

浏览器开 `http://localhost:5173`,Chrome DevTools 调试。

> Vite proxy 把 `/api/*` 去前缀转发到 `127.0.0.1:4096`。如果首页报"后端连接失败:HTML",检查 `packages/octo-ui/vite.config.ts` 的 proxy 是否配了 `rewrite: (path) => path.replace(/^\/api/, "")` 和 `ws: true`。

Mode A 走的是浏览器,**不会触发 Electron 主进程逻辑**(IPC、native 模块、文件对话框),那些功能只能 Mode B 验证。

---

## 5. 构建与打包

```bash
# 1) 编译 main + preload + renderer 到 packages/desktop-electron/out/
bun run --cwd packages/desktop-electron build

# 2) 打 macOS 包(DMG + zip,产物在 packages/desktop-electron/dist/)
bun run --cwd packages/desktop-electron package:mac
```

可用脚本(见 [packages/desktop-electron/package.json](../packages/desktop-electron/package.json)):

| 脚本 | 作用 |
|---|---|
| `build` | electron-vite 编译,产出 `out/` |
| `package` | electron-builder 打当前平台 |
| `package:mac` / `package:win` / `package:linux` | 指定平台 |

**没有 `build:mac` 这个脚本**,直接用 `build && package:mac`。

### 打包后白屏 / 启动失败排查

1. 在 [packages/desktop-electron/src/main/windows.ts](../packages/desktop-electron/src/main/windows.ts) 临时加 `mainWindow.webContents.openDevTools()`,重打看 Console 报错
2. 看 `out/renderer/index.html` 是否引用了正确的 `assets/*.js`(路径错会白屏)
3. 看主进程日志(macOS 上 `~/Library/Logs/<AppName>/main.log`)
4. 确认 `electron.vite.config.ts` 中 renderer 的 `root` 与 `build.rollupOptions.input` 都指向 `packages/octo-ui`

### macOS 签名

未配置开发者证书时打包会跳过签名,产物可以本地用,**首次打开右键"打开"绕过 Gatekeeper**。如需正式签名,在 `packages/desktop-electron/electron-builder.config.ts` 配 `mac.identity`。

---

## 6. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `Error: Electron uninstall` (dev 启动时) | electron 包 postinstall 没跑 | `node packages/desktop-electron/node_modules/electron/install.js`,或仓库根重 `bun install` |
| 创建会话报 500 | config.json schema 错误或路径不对 | 路径必须是 `~/.config/octo/octo.json`,`provider`(单数),`apiKey` 在 `options` 下 |
| AI 回复显示 `opencode/big-pickle` | 配置没生效,后端用占位模型 | 同上,检查后端 stdout 里有没有"loaded provider"日志 |
| 5175 端口冲突 | Vite strictPort 被占 | `lsof -i :5175` 找到占用进程 kill,或改 [electron.vite.config.ts](../packages/desktop-electron/electron.vite.config.ts) 的 `server.port` |
| 4096 端口冲突 | 已在跑 opencode CLI / 上次 dev 没退干净 | `lsof -i :4096` 杀掉,或 `OPENCODE_PORT=4097 bun run dev:serve` |
| `bun install` tree-sitter 编译失败 | macOS Xcode CLI Tools 未装 | `xcode-select --install`(Windows 上一般不触发,Bun 自带工具链够用) |
| Vue HMR 不生效 | proxy ws 没开 | 确认 vite proxy 配了 `ws: true` |
| 改了 config.json 没效果 | 后端在内存里缓存了配置 | 重启后端(整个 dev 重跑) |
| 切了模型仍是旧回复 | 同上 | 同上 |
| **Windows**:`predev` 报 `bun: command not found: plutil` 或类似 | 用了未带平台 guard 的旧 `predev.ts` | 拉一下最新 dev 分支,见 [architecture.md §5.4](architecture.md#54-上游接线壳改动清单) `predev.ts` 行 |
| **Windows**:`bun run dev` 起来后 Electron 窗口空白 / DevTools Network 里 `/provider` `/global/config` `/path` `/project` 全 500 | opencode bundle 内含的 jsonc-parser 子模块 / SQLite migration 子目录在 electron-vite 重定位后路径错 | 已由 `electron.vite.config.ts` 的 `opencode:copy-server-assets` 插件统一拷贝处理,无需手工干预;若仍出现见 [architecture.md §5.4](architecture.md#54-上游接线壳改动清单) 三条 `electron.vite.config.ts` 登记复核 |
| **Windows**:`bun install` 把所有依赖 URL 写成 `registry.npmmirror.com/...` 导致 `bun.lock` 大面积 diff | `~/.npmrc` 里设了第三方镜像源 | 见 [§1.1](#11-windows-开发者补充);**已污染的 `bun.lock` 千万别 commit**,`git checkout origin/dev -- bun.lock` 恢复 |
| 打包后白屏 | renderer 资源路径问题 | 见第 5 节排查清单 |

---

## 7. Git 工作流

- 当前主分支:`main`,日常分支:`dev`
- **未经明确确认禁止 commit / push**(见 [CLAUDE.md](../CLAUDE.md))
- commit message 用中文
- 禁改的目录见 [architecture.md §3](architecture.md#3-修改边界与上游改动清单)

---

## 8. 样式开发指南（dev-only 调试页）

### 背景

Octo Insight 的页面依赖 MCP 工具调用才能产生真实数据（任务卡片、文件结果卡片等）。  
**本地开发时 MCP 不通，所以看不到任何卡片**；代码要部署到内网后才能跑完整流程。

为了让样式在本地也能调试，我们引入 `/_dev/*` 路由作为"样式沙箱"：用 mock 数据渲染真实组件，纯本地，不连 SDK / Sync。

> **重要**：dev-only 页与真实对话共用同一组件源文件（不是副本），所以 dev 页上改好的样式，内网流程中自动生效。

---

### 8.1 启动本地样式调试服务器

```bash
bun --cwd packages/app dev
# 期望: VITE ready, Local: http://localhost:3000/
```

用浏览器打开即可，无需 Electron 环境，HMR 实时生效。

> 注意区别：
> | 服务 | 端口 | 依赖 | 用途 |
> |---|---|---|---|
> | `packages/app` web dev | **3000** | 无（纯前端） | 样式 / 组件开发 |
> | Electron renderer (vite) | **5175** | Electron 主进程 + `window.api` | 完整 Electron 调试 |
>
> `localhost:5175` 在浏览器直接开会黑屏（缺少 Electron 预注入的 `window.api`），样式调试务必用 3000。

---

### 8.2 现有 dev-only 页

| 路由 | 内容 | 源文件 |
|---|---|---|
| `/_dev` | **预览索引页**（所有 dev 沙箱的统一入口，互相跳转） | `packages/app/src/pages/insight/_dev/index-preview.tsx` |
| `/_dev/insight-cards` | 任务卡片（5 态）+ 文件结果卡片（6 类） | `packages/app/src/pages/insight/_dev/cards-preview.tsx` |
| `/_dev/typography` | 对话区正文 / 思维链排版样张（取证用，含思维链容器提案粗 UI） | `packages/app/src/pages/insight/_dev/typography-preview.tsx` |

> 各 dev 页保持**独立路由 + 独立 chunk**（懒加载、故障隔离、可深链截图）；`/_dev` 索引页只做导航，不揉内容。每个子页顶部有「← Dev 索引」回链。

#### 与原生路由的隔离（三层）

`/_dev` 系列与 opencode 原生路由**完全隔离**，互不影响（见 [app.tsx](../packages/app/src/app.tsx) 路由注释）：

| 层 | 机制 | 效果 |
|---|---|---|
| **构建隔离** | 每条 `/_dev*` 路由用 `import.meta.env.DEV` 守卫 | 生产包里整段不存在，永远不会与原生路由共存或被用户访问 |
| **Shell 隔离** | `RouterRoot.isOctoPage()` 命中 `/_dev` → 走 `OctoShell`（无侧边栏） | 绕开原生 `AppShellProviders` / `Layout` / Session providers；dev 页报错只崩自己，不波及原生页 |
| **路径隔离** | 显式 `/_dev` 路由优先于通配 `/:dir`（session 那套） | `/_dev` 不会被当成目录名落进 `DirectoryLayout` |

> ⚠️ 新增 `/_dev` 下的**精确路径**（如索引页 `/_dev` 本身，不带尾斜杠）时，注意 `isOctoPage()` 需同时覆盖 `p === "/_dev"` 与 `p.startsWith("/_dev/")`，否则精确路径会掉进原生 shell。

---

### 8.3 如何为新 UI 增加 dev-only 预览

以"明天要做任务面板顶部 Tab 切换"为例，步骤如下。

> **注意**：下面的 `panel-tabs` / `panel-tabs-preview.tsx` 均为**示例名称**，不是已存在的路由。
> 现有真实 dev 页见 §8.2。

#### 第一步：新建预览页文件

```
packages/app/src/pages/insight/_dev/panel-tabs-preview.tsx   ← 示例文件名，按实际组件命名
```

```tsx
import "../octo-tokens.css"
// 直接 import 要调试的真实组件
import { TaskPanelTabs } from "../components/task-panel-tabs"

export default function PanelTabsPreviewPage() {
  return (
    <div style={{ padding: "32px", background: "#f5f6f8", "min-height": "100vh" }}>
      <h2 style={{ "font-size": "16px", "margin-bottom": "16px" }}>任务面板 Tab — dev preview</h2>
      {/* mock 不同 tab 状态 */}
      <TaskPanelTabs activeTab="tasks" tabs={["tasks", "results"]} onChange={() => {}} />
      <TaskPanelTabs activeTab="results" tabs={["tasks", "results"]} onChange={() => {}} />
    </div>
  )
}
```

规则：
- **只 import 真实组件**，不另起新组件写样式
- mock 数据写在文件内，不引外部状态
- 用 `Frame` / `Section` 等 `_dev/cards-preview.tsx` 里已有的布局辅助组件（直接 copy 或抽共用）

#### 第二步：在 `_dev/dev-routes.tsx` 注册路由（**不碰 app.tsx**）

所有 `/_dev` 路由声明与隔离判断都集中在 `packages/app/src/pages/insight/_dev/dev-routes.tsx`，
app.tsx 只 `import { devRoutes, isDevPath }` 引用一次。新增页**只改 dev-routes.tsx**：

```tsx
// dev-routes.tsx —— 加 lazy import + 在 PAGES 数组加一条
const PanelTabsPreviewPage = lazy(() => import("./panel-tabs-preview"))

const PAGES = [
  // …已有项…
  { path: "/_dev/panel-tabs", component: PanelTabsPreviewPage },
] as const
```

> app.tsx 已通过 `{import.meta.env.DEV && devRoutes()}` 挂载全部 dev 路由、`isOctoPage()` 已调 `isDevPath()`，新增页无需改动它。

#### 第三步：登记到索引页

在 `packages/app/src/pages/insight/_dev/index-preview.tsx` 的 `DEV_PAGES` 数组加一条（`path` / `title` / `desc`），让新页出现在 `/_dev` 索引里。

#### 第四步：本地看效果

浏览器打开 `http://localhost:3000/_dev`（索引页）或 `http://localhost:3000/_dev/panel-tabs`（示例路径，按实际替换），直接对照设计稿调样式，HMR 实时刷新。

---

### 8.4 内网验证（不可跳过）

dev-only 页用 mock 数据，**不能替代内网的真实数据验证**。以下场景必须到内网走真实流程确认：

| 验证点 | 原因 |
|---|---|
| 卡片在对话流中的位置 / 间距 | mock 页没有消息气泡上下文 |
| 滚动行为 / 虚拟列表裁切 | mock 数量少，真实场景可能有几十条 |
| 任务卡片状态流转动画 | mock 状态是静态的，真实流程有 pending → processing → completed 切换 |
| 文件卡点击后 ResultViewer 联动 | dev 页点击只 `console.log`，右侧面板不打开 |

内网验证流程：

1. 推代码 → 内网拉分支
2. `bun run --cwd packages/desktop-electron dev` 启动完整 Electron
3. 在 Insight 对话里触发对应 MCP 工具（如 `key_findings`、`run_guide_analysis`）
4. 对照设计稿确认真实卡片渲染

---

## 9. 进一步阅读

- [架构总览](architecture.md)
- [opencode 后端原理(深度)](learning/opencode-internals.md)
- [ROADMAP](../ROADMAP.md)
- [ADR-001 Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ADR-002 Vue 3 替换 SolidJS](adr/002-vue3-ui-rewrite.md)
- [ADR-003 LLM Provider 接入](adr/003-openai-compat-provider.md)
- [Spec — 开发环境](specs/infra/dev-environment.md)
- [Spec — 构建与发布](specs/infra/build-release.md)
