# Octo Insight — 开发、调试、打包指南

> insight 的实现代码在 UXAI 仓维护。本文记录在 **UXAI 仓**跑 / 调 / 打包 insight 的流程。
> 桌面壳是 UXAI 自有的 `packages/desktop/`(Electron),app 在 `packages/app/octoapp/`。
> 平台:macOS Apple Silicon 全通;Windows 11 x64 可跑;Linux 未验证。

架构与目录边界见 [architecture.md](architecture.md)。路径映射见 [intranet-handoff §0](intranet-handoff.md)。

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

### 1.1 镜像源检查(跨平台同事必读)

`bun install` 前确认 `~/.npmrc`(Windows:`C:\Users\<你>\.npmrc`)里**没有** `registry=https://registry.npmmirror.com/` 等第三方镜像。Bun 跟读 `.npmrc`;设了镜像会把所有依赖 tarball URL 解析成镜像 URL 写进 `bun.lock`,污染跨平台同事的锁文件。

```bash
# 检查(应输出空,或 registry=https://registry.npmjs.org/)
grep "^registry" ~/.npmrc
```

若已污染 `bun.lock`,**不要 commit 它**:`git checkout origin/dev -- bun.lock` 恢复。`//registry.npmjs.org/:_authToken=...`(鉴权行)保留,仅删 `registry=...` 行。

---

## 2. 首次准备

```bash
git clone https://github.com/MyHeavenDyf/UXAI.git
cd UXAI
bun install
```

### LLM Provider 配置

opencode(UXAI fork)**原生读取** `~/.config/octo/octo.json`(`packages/opencode/src/config/config.ts` 把 `octo.json` 列为优先配置名,从 `~/.config/octo/` 加载),与系统上可能装的 opencode CLI 隔离。第一次需手动建:

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

- schema 较严,**未知字段可能让 session 创建报 500**。常见错误:写成 `providers`(复数)、`apiKey` 放到 provider 顶层而非 `options` 下、字段名拼写错
- 若 UI 提示占位模型(如 `opencode/big-pickle`),说明配置没生效,先检查路径和 schema
- 切换 provider/model **需重启 dev**(opencode 不支持配置热重载)

完整字段说明、provider 协议差异详见 [learning/opencode-internals.md](learning/opencode-internals.md)。

---

## 3. 日常开发

### 3.1 完整应用(Electron) — 推荐主路径

一条命令拉起内嵌 opencode 后端 + renderer + Electron 窗口,改 renderer HMR,改 main 进程自动重启:

```bash
bun run dev:desktop          # = bun run --cwd packages/desktop dev = electron-vite dev
```

- renderer 用 `octoapp/` 的 `octo.tsx`(`@opencode-ai/app` 入口),含 `/insight`、`/make`、`/skills` 等 Octo 页面
- opencode server 由壳的 sidecar 内嵌拉起(本地动态端口),窗口自动连接
- channel 切换:`bun run dev:beta` / `dev:prod`(`OCTO_CHANNEL` 环境变量)

### 3.2 Web 沙箱(纯前端) — 组件 / 样式快迭代

不需要 Electron / `window.api` 时,用浏览器跑 `packages/app`:

```bash
bun run dev:web              # = bun --cwd packages/app dev = vite，端口 3000
```

浏览器开 `http://localhost:3000`,HMR 实时。web 入口是 `octoapp/entry.tsx → @/octo`,**不连壳能力**(IPC、文件对话框、`window.api` 相关按钮在此不可用,只能 3.1 验证)。

> **web 端和 Electron 端跑的是同一个 root**(§3.6,2026-07-29 归一),所以:
> **纯 UI / 样式 / 布局在这里验就够了,而且更快**;**碰到壳能力的功能仍然只能去 §3.1 Electron 验**。
> 唯一的其他差异是 Router 模式(这里是 history,Electron 是 Hash),只影响 URL 形态、不影响渲染。
>
> dev 预览沙箱页(`/insight/__dev/*`,见 §7)两端都能访问。

### 3.3 `predev` 钩子

`dev:desktop` 前自动跑 `packages/desktop/scripts/predev.ts`,两件事:

1. `copy-icons.ts <channel>` — 按 `OCTO_CHANNEL` 拷对应图标到 `resources/`
2. `cd ../opencode && bun script/build-node.ts` — 产出 opencode Node bundle 给 main 进程内嵌

opencode 源没改时第一次跑过即可(后续 dev 仍重复)。

### 3.4 调试

| 想干什么 | 怎么做 |
|---|---|
| 打开 renderer DevTools | Electron 窗口聚焦后 `Cmd + Option + I` |
| 看主进程 / 后端日志 | 启动 `dev:desktop` 的那个终端 stdout |
| 改前端立即生效 | 直接改 `packages/app/octoapp/**`,Vite HMR |
| 改 main 进程立即生效 | 改 `packages/desktop/src/main/**`,electron-vite 自动重启 |
| **改 opencode server 生效** | `packages/opencode/src/**`(含 agent 提示词 `.txt`)**不吃 HMR**——必须彻底重启 `dev:desktop`,见 [§3.5](#35-改动生效模型renderer--main--opencode-server-三层) |
| 强制刷新 renderer | DevTools `Cmd + R` |
| **找本地落盘日志在磁盘哪儿** | 见 [find-local-logs.md](find-local-logs.md)(main.log / insight-debug.log / sidecar,dev vs 成品包 / 各平台 / 怎么认 appId) |

> insight 自带运行时调试工具(`window.octoDebug` / `[octo:*]` 日志 / 错误信标),用法与日志字典见 [insight-debugging.md](insight-debugging.md)。

#### 日常 debug 工作流(内网→外网)

排查方(Claude / 外网同事)读不到你运行中 app 的 console——内网现场只能由你"递"出去,且通常**只能复制文本段落**。标准流程按省事程度,从上往下试:

1. **先看错误信标(首选,日常 90%)**:出错后敲 `octoDebug.lastError()` → 自动捕获的「HTTP 失败 + 响应体 / 未捕获异常 / 整页崩」精炼成一小段纯文本,自动复制到剪贴板。**整页崩**(白屏、console 够不着)时,页面 fallback 直接给「复制错误」按钮。信标同步落 `localStorage`、**跨刷新/重启/崩溃**,所以哪怕用户已经刷新也还在。
2. **要更全的 SSE 上下文再补**:`octoDebug.snapshot()`(缺省=最近一次发送→现在),顶部自带 `why()` 初判。怀疑某症状就带 `profile`(`no-feedback`/`stuck`/`errors`/`blank`/`upload`)。
3. **怀疑问题在埋点之外**:回查全量落盘 `insight-debug.log`(渲染崩溃前 / 偶现的也在,macOS 在 `~/Library/Logs/<显示名>/`;文件定位见 [find-local-logs.md](find-local-logs.md)),按时间或 `messageID` 搜。
4. **递给外网**:把上面任一步复制出的纯文本(剪贴板可外发)贴给 Claude → 对照 [insight-debugging.md](insight-debugging.md) 的日志字典 + 症状表定位。

> 工作流 SOT 在 [insight-debug-toolkit.md §3](specs/ui/insight-debug-toolkit.md)(取数流程)+ §9(错误信标);命令字典、`why()` 规则、症状对照表在 [insight-debugging.md](insight-debugging.md)。本节只给入口,不重复细节。

### 3.5 改动生效模型(renderer / main / opencode server 三层)

本地跑桌面 dev 时,三层各自独立生效。混淆哪层就会看到「改了没反应」或「一半生效」的假象——**排查前先确认改的是哪层、对应的生效方式对不对**。

| 改了哪层 | 路径 | 怎么生效 | 要不要重启 |
|---|---|---|---|
| renderer(前端) | `packages/app/octoapp/**` | Vite **HMR**,秒级热更 | 否 |
| main 进程 | `packages/desktop/src/main/**` | electron-vite 自动重启主进程 + 重新 fork sidecar(**用现有 dist**) | 自动 |
| **opencode server** | `packages/opencode/src/**`——插件 / 路由 / 工具 / **agent 提示词 `.txt`** | 编进独立 bundle `packages/opencode/dist/node`(由 `predev` 的 `bun script/build-node.ts` 构建);**只有全新 `dev:desktop` 才会重建 + 重新 fork sidecar** | **必须重启 `dev:desktop`** |

**为什么 server 层最容易踩**:桌面壳的 opencode server 不是从源码跑的,是**打包进 sidecar 的 dist 产物**([desktop/src/main/server.ts](../../UXAI/packages/desktop/src/main/server.ts) `spawnLocalServer` → `utilityProcess.fork(sidecar)`;[electron.vite.config.ts](../../UXAI/packages/desktop/electron.vite.config.ts) `virtual:opencode-server` → `../opencode/dist/node/node.js`)。renderer HMR 和 main 自动重启**都不会重建这份 dist**,fork 出去的旧 server 进程照跑老代码。

**混层陷阱(务必记住)**:一次 renderer HMR 可能让你以为「改动生效了」(前端行为变了),而 sidecar 还跑旧 server(后端行为没变)。两层陈旧度不一致,会看到自相矛盾的现象——**真实案例(2026-07)**:改前端触发 HMR、把已合并的「路径 C 退役」热替换进来 → 写产物卡片消失;但没重启 `dev:desktop`,sidecar 仍是旧 dist(无落点重定向)→ 文件仍落根目录、文件管理扫不到。看着像「卡片莫名消失 + 文件失踪」,实则是 renderer 走新逻辑、server 走旧逻辑。**判断法**:看启动终端 stdout 有没有对应 server 日志前缀(如 `[octo:outputs-redirect]`),没有就是 server 没重建。

**重启了还不生效,按序查**:
1. 你跑的是 **`dev:desktop`** 不是根 `dev`——根 `dev`(`bun run --cwd packages/opencode --conditions=browser src/index.ts`)只起**源码版独立 server**,不碰桌面壳的 sidecar,改壳的行为看不到。
2. **残留 sidecar 进程**:`utilityProcess.fork` 的子进程未必随窗口退出,旧进程还占着。彻底退出 Electron 后 `pkill -f sidecar`(或按服务名找)再重起 `dev:desktop`。
3. 只想快速验证 **server 逻辑本身**(不重启整壳):照 [learning/hono-vs-effect-httpapi-routing.md](learning/hono-vs-effect-httpapi-routing.md) 直接源码跑 server + curl,绕开 dist 构建/fork 这一整条链。

### 3.6 app root 已归一到 `octo.tsx`(别再新增第二个)

**唯一 root 是 `packages/app/octoapp/octo.tsx`**,浏览器 / Playwright / Electron 三边共用:

| 入口 | 链路 | Router |
|---|---|---|
| 浏览器 / Playwright | `packages/app/index.html` → `octoapp/entry.tsx` → `@/octo` | 默认 Router(history,有地址栏) |
| Electron 渲染进程 | `desktop/src/renderer/index.tsx` → `@opencode-ai/app` → `packages/app/src/index.ts` → `octoapp/index.ts` → `./octo` | **HashRouter**(显式传 `router` prop,无地址栏) |

平台差异全部走注入点,**不要为此再复制一个 root**:

- **路由模式**:`AppInterface` 的 `router` prop(不传 = history)
- **壳能力**(IPC / 文件对话框 / 存储 / 剪贴板):`PlatformProvider`

> **上游那份不在 `octoapp/` 里。** 真正的上游 root 是 `packages/app/src/app.tsx`(330 行,原封未动),
> 隔离上游靠的是 `src/` 与 `octoapp/` 的**目录分离**。所以改 `octoapp/` 下的东西碰不到上游 ——
> 「为了不动上游所以要留两份 root」这个说法不成立。

#### 历史:曾经有两份,漂移了两个多月

`octoapp/app.tsx`(浏览器)与 `octo.tsx`(Electron)同日创建(2026-05-09,`0ed6a080e`)后走岔,
到归一前 `app.tsx` 已落后 230 行,缺 `ForceLightScheme`、`OnboardingLayer`、`FocusModeResetHandler`、
`PatternPage` 路由、`InsightSidebarLayout` / `ResponsiveSidebarLayout`、侧栏宽度持久化,
insight 页还多套一层 `OctoSidebarLayout`。后果是**在浏览器里验 UI 看到的不是交付形态**,e2e 同理。

2026-07-29 归一(UXAI PR #474):`entry.tsx` 改指 `@/octo`,删除 `octoapp/app.tsx`。

留两条教训:

1. **判活结论只写"它不在 X 入口的图里"**,别写"死文件"。曾有文档断言 `octo.tsx` 是死副本并据此做决策,
   是错的 —— 它的引用发生在**跨 package 的 re-export 链**上,只在 `octoapp/` 里 grep `"./octo"` 搜不到。
   完整取证见 [learning/uxai-app-entry-routing.md](learning/uxai-app-entry-routing.md)。
2. **平台差异优先找现成注入点**,复制 root 是最贵的解法。

#### 归一带来的行为变更(仅 opencode CLI 内嵌 web UI)

Electron 端无变化(本就是 `octo.tsx`)。变的是 `packages/opencode/script/build.ts` 嵌进 CLI 二进制的那个 web UI:

- `/` 由 `HomeRoute` 改为重定向到 `/make`
- 新增 onboarding 弹窗、`ForceLightScheme` 强制浅色、`/pattern` 路由

即那个内嵌 UI 从旧版**跟上了**交付版。归一时完整跑过 `script/build.ts --single`(CI publish 用的同一条链)
并用 Playwright 打真实二进制的 web UI 验过三条路由,无 pageerror。

---

## 4. 构建与打包

```bash
# 编译 main + preload + renderer 到 packages/desktop/out/
bun run --cwd packages/desktop build

# 打包(按 channel,产物在 packages/desktop/dist/)
bun run --cwd packages/desktop package:dev      # 或 package:beta / package:prod
```

| 脚本 | 作用 |
|---|---|
| `build` / `build:beta` / `build:prod` | electron-vite 编译,产出 `out/` |
| `package:dev` / `package:beta` / `package:prod` | electron-builder 打当前平台,按 `OCTO_CHANNEL` 区分 appId / 产品名 |
| `release:mac-arm64` / `release:mac-x64` / `release:win` | 走 `scripts/release.ts` 的发布流程 |

品牌 / appId / 产品名在 `packages/desktop/electron-builder.config.ts` 按 channel 配置(prod:`ai.octo.desktop` / "Octo Agent")。

### macOS 签名

未配开发者证书时打包跳过签名,产物本地可用,**首次打开右键"打开"绕过 Gatekeeper**。正式签名在 `electron-builder.config.ts` 的 `mac.identity` 配。

---

## 5. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 创建会话报 500 | `octo.json` schema 错或路径不对 | 路径须 `~/.config/octo/octo.json`;`provider`(单数);`apiKey` 在 `options` 下 |
| AI 回复显示占位模型(`opencode/big-pickle`) | 配置没生效,后端用占位模型 | 同上,检查后端 stdout 有无 "loaded provider" |
| 改了 `octo.json` 没效果 | opencode 启动时读一次,不热重载 | 重启 `dev:desktop` |
| `Error: Electron uninstall`(dev 启动) | electron 包 postinstall 没跑 | `node packages/desktop/node_modules/.bun/electron@<ver>/node_modules/electron/install.js`,或仓库根重 `bun install` |
| `bun install` tree-sitter 编译失败 | macOS Xcode CLI Tools 未装 | `xcode-select --install`(Windows 一般不触发) |
| `bun.lock` 大面积 diff 成 `registry.npmmirror.com/...` | `~/.npmrc` 设了第三方镜像 | 见 [§1.1](#11-镜像源检查跨平台同事必读);污染的 `bun.lock` 别 commit |

---

## 6. Git 工作流

insight 代码改动在 **UXAI 仓**改 / 跑 / 提 PR,遵守 [collab-pr-protocol.md](collab-pr-protocol.md)(`main`=纯 opencode,`dev`=业务,PR → `dev`)。设计变化落 spec / ADR / learning 到 **octo-agent 文档仓**(直接 commit,无需 PR)。

---

## 7. 样式开发(dev-only 预览页)

### 背景

insight 的卡片(任务卡 / 文件结果卡等)依赖 MCP 工具调用才有真实数据,**本地不连内网 MCP 看不到卡片**。为了本地也能调样式,引入 `/insight/__dev/*` 预览路由作"样式沙箱":用 mock 数据渲染**真实组件**,不连 SDK / Sync。

> **重要**:dev 页与真实对话共用同一组件源文件(非副本),dev 页改好的样式内网流程自动生效。

### 7.1 现有 dev 预览页

路由集中在 `packages/app/octoapp/pages/insight/__dev/routes.tsx` 的 `PAGES` 数组,在**唯一 root `octo.tsx` 里挂载一次**(§3.6),浏览器与 Electron 两端都生效;生产构建摇树掉:

| 路由 | 内容 |
|---|---|
| `/insight/__dev` | 预览索引页(统一入口,互跳) |
| `/insight/__dev/insight-cards` | 任务卡 + 文件结果卡 + 产物落盘三态 |
| `/insight/__dev/typography` | 对话区正文 / 思维链排版样张 |
| `/insight/__dev/result-tabs` | ResultViewer Tab |
| `/insight/__dev/file-fallback` | FileFallback 按钮 |
| `/insight/__dev/attachment-bar` | 附件条 |
| `/insight/__dev/panel-header` | 面板头 |
| `/insight/__dev/attachment-parse` | 附件解析 |
| `/insight/__dev/permission-dock` | 权限确认停靠条 |
| `/insight/__dev/question-dock` | 追问停靠条 |

#### 怎么打开(具体步骤)

**Electron(§3.1,推荐)**:

```bash
bun run dev:desktop          # 根目录;electron-vite 起 vite + Electron
```

窗口没有地址栏,用 DevTools 跳。Electron 端的 router 是 **`HashRouter`**(`desktop/src/renderer/index.tsx` 显式传 `router={HashRouter}`),所以:

1. `F12`(或菜单 View → Toggle Developer Tools / `Cmd+Opt+I`)开 DevTools
2. Console 里执行:

   ```js
   location.hash = "#/insight/__dev"                  // 索引页,再点进各预览页
   location.hash = "#/insight/__dev/insight-cards"    // 或直达某页
   ```

   赋值 `location.hash` 会触发原生 `hashchange`,HashRouter 自己接管,**不需要手动 dispatch 事件**。

> **⚠️ 别用 pushState —— 本文档旧版给的就是这个,是错的,已实测无效。**
> ```js
> history.pushState({}, '', '/insight/__dev/insight-cards')   // ❌ 无效
> dispatchEvent(new PopStateEvent('popstate'))                // ❌ 无效
> ```
> 两个独立原因:①`HashRouter` 的路由源是 `window.location.hash.slice(1)`,`pushState` 改的是 pathname,它根本不读;
> ②`HashRouter` 监听的是 **`hashchange`** 而非 `popstate`,派发 `PopStateEvent` 叫不醒它。
> (`@solidjs/router` 源码 `dist/index.js` 的 `HashRouter`:`getSource` / `init` 两处。)
>
> `location.assign('/insight/__dev/…')` 同样别用 —— 那是整页重载,会回到应用首页。

**浏览器(§3.2)**:`bun run dev:web` 后直接在地址栏输 `http://localhost:3000/insight/__dev` 即可 —— 浏览器那份用的是默认 history Router,路径能正常命中。

改样式经 HMR 即时生效,不用重跳。

#### 隔离三层

| 层 | 机制 | 效果 |
|---|---|---|
| **构建隔离** | 调用点是模块级常量 `insightDevRoutesOrNone`,**且** `lazy()` 写在函数体内 | 生产构建折叠成 `() => null`,Rollup 摇掉整棵 `__dev/` 子树 |
| **壳复用** | `/insight/__dev` 命中 `octo.tsx` 的 `isInsightPage()`,裸渲染(insight 页本就不套侧栏) | dev 页 size-full 自包含;归一后两端天然同壳 |
| **路径隔离** | 显式静态段 `/insight/__dev` 优先于通配 `/insight/:id?` | 不会被当 session id 落进 InsightPage |

> **⚠️ 构建隔离这一层比看起来难,别照直觉写。**
> `{import.meta.env.DEV && insightDevRoutes()}` 这种写法**摇不掉** —— 本文档旧版声称它有效,是错的,
> 桌面生产包因此一直多带约 78KB 预览代码。
> 根因是 `vite-plugin-solid` 跑在 `vite:define` 之前,Solid 给 JSX 里的成员表达式多包了一层 memo。
> 守卫必须在 JSX 之外、`lazy()` 必须在函数体内,**两个条件缺一不可**(只满足一个产物毫无变化,极易误判)。
> 完整机制、五种做法实测对比、验证方法见
> [learning/solid-jsx-blocks-import-meta-env-treeshaking.md](learning/solid-jsx-blocks-import-meta-env-treeshaking.md)。

### 7.2 如何新增 dev 预览页

以"任务面板顶部 Tab 切换"为例(`panel-tabs` 为示例名,非已有路由):

**① 新建预览页**:`octoapp/pages/insight/__dev/panel-tabs-preview.tsx`

```tsx
import "../octo-tokens.css"
import { TaskPanelTabs } from "../components/task-panel-tabs"   // import 真实组件

export default function PanelTabsPreviewPage() {
  return (
    <div style={{ padding: "32px", background: "#f5f6f8", "min-height": "100vh" }}>
      <TaskPanelTabs activeTab="tasks" tabs={["tasks", "results"]} onChange={() => {}} />
    </div>
  )
}
```

规则(**强制**):
- **只 import 真实组件,绝不在 dev 页拷贝 / 重写组件代码**。一旦自绘副本,dev 看到的就不是线上的,调试结论失效,且两份代码会悄悄漂移。
- **设计样张例外 + 回收义务**:组件尚不存在(设计先行)时允许临时在 dev 页自绘,但这是带债务的临时态——组件一旦在 `components/` 落地,**必须立刻把 dev 页改成 `import` 真实组件、删临时副本**。文件顶部注释标"待落地后回收"。
- mock 数据写文件内,不引外部状态。
- 组件强依赖某容器/上下文时,dev 页只**模拟那层环境容器**(白底圆角等),里面塞真实组件。

**② 注册路由**(只改 `__dev/routes.tsx`,**不碰 `octo.tsx` / `app.tsx`**):在 `insightDevRoutes()` **函数体内**的 `PAGES` 数组加一条
`{ path: "/insight/__dev/panel-tabs", component: lazy(() => import("./panel-tabs-preview")) }`。

> ⚠️ `lazy()` 必须留在函数体内,**不要提到模块顶层** —— 顶层调用是 Rollup 眼里的副作用,会让预览 chunk 泄漏进生产包(见 §7.1「隔离三层」下的警告)。

**③ 登记索引**:在 `__dev/index-preview.tsx` 的 `DEV_PAGES` 数组加一条(`path` / `title` / `desc`)。

### 7.3 内网验证(不可跳过)

dev 页用 mock,**不能替代内网真实数据验证**。以下必须到内网真实流程确认:卡片在对话流中的位置 / 间距、滚动与虚拟列表裁切、任务卡状态流转动画、文件卡点击 ↔ ResultViewer 联动。流程:推代码 → 内网拉分支 → `dev:desktop` 启动 → 在 Insight 对话触发 MCP 工具 → 对照设计稿确认。

---

## 8. 浏览器自动化验证(Playwright)

用真实浏览器打开页面、点、截图、断言——把"我看着像对的"换成可复跑的检查。测的是 §3.2 的 **Web 沙箱**链路(Playwright 自己拉起 `packages/app` 的 vite),**不经 Electron**,`window.api` 相关能力测不到。

### 8.1 一次性准备:装浏览器二进制

`@playwright/test` 本身已是仓库依赖(根 `package.json` catalog 固定版本),`bun install` 就有。但 **npm 包不含浏览器二进制**,首次要单独下:

```bash
cd packages/app && bunx playwright install chromium
```

> `bunx` 没有 `--cwd`(会把路径当包名去 npm 找),必须先 `cd`。跑测试用的 `bun --cwd packages/app <script>` 则是另一回事,可以在仓库根跑。

| | |
|---|---|
| **装到哪** | **不进 `node_modules`**,进用户级共享缓存(见下表),所有用 Playwright 的项目共用 |
| **体积** | 约 530 MB(Chromium 完整版 + Chrome Headless Shell + FFmpeg 录像用) |
| **只装 chromium** | `playwright.config.ts` 的 `projects` 只有 chromium;不要跑不带参数的 `playwright install`(那会连 Firefox / WebKit 一起下) |
| **什么时候要重装** | catalog 里 `@playwright/test` 版本升了。二进制按版本号分目录(如 `chromium-1217`),版本不匹配跑测试会直接报错提示重装 |

缓存路径:

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Caches/ms-playwright/` |
| Windows | `%USERPROFILE%\AppData\Local\ms-playwright\` |
| Linux | `~/.cache/ms-playwright/` |

> Linux 还需系统库:`cd packages/app && bunx playwright install-deps chromium`。
> 想让二进制落到仓库内(CI 缓存常用)可设 `PLAYWRIGHT_BROWSERS_PATH`——CI 就是这么干的,见 `.github/workflows/test.yml` 的 `e2e` job。

### 8.2 怎么跑

用例在 `packages/app/e2e/*.spec.ts`,配置 `packages/app/playwright.config.ts`。**不用自己先起 dev server**——配置里的 `webServer` 会自动拉起 vite(端口 3000,已在跑则复用)。

```bash
bun --cwd packages/app test:e2e          # 无头跑全部(默认)
bun --cwd packages/app test:e2e:ui       # UI 模式:可视化跑,能回看每一步
bun --cwd packages/app test:e2e:report   # 打开上次的 HTML 报告
```

透传 Playwright 原生参数:

```bash
bun --cwd packages/app test:e2e -- e2e/question-dock.spec.ts   # 只跑一个文件
bun --cwd packages/app test:e2e -- --headed                    # 开真窗口,肉眼看着它跑
bun --cwd packages/app test:e2e -- --debug                     # Inspector 单步调试
```

### 8.3 人 / AI 分别怎么"看到"效果

默认 **headless(无头)**:后台开浏览器,不弹窗口,人什么也看不见,只看到终端的通过 / 失败。想看到画面靠这几种:

| 方式 | 谁能看 | 说明 |
|---|---|---|
| `--headed` | 人 | 真弹出浏览器窗口,实时看它自己点 |
| `--ui` | 人 | 最好用:左边用例树右边时间轴,每一步的 DOM 快照可回拨,改完代码点重跑 |
| `--debug` | 人 | Playwright Inspector,断点单步 + 选择器定位器 |
| 失败截图 / 录像 | 人 | 已配好(`screenshot: only-on-failure`、`video: retain-on-failure`),落 `packages/app/e2e/test-results/`(已 gitignore) |
| trace | 人 | `trace: "on-first-retry"`,失败重试时录完整操作轨迹,`test:e2e:report` 里点开可逐帧回放 |
| **`page.screenshot()`** | **AI** | 主动截图存文件,AI 读图即可判断渲染对不对——**这是 AI 能验证视觉的唯一途径**,无头模式下它看不到别的 |

让 AI 帮你核视觉时,用例里显式截图:

```ts
await page.screenshot({ path: "e2e/test-results/question-dock.png", fullPage: true })
```

不写用例、只想快速截一张图看看:

```bash
bun --cwd packages/app dev &          # 先起 vite
cd packages/app && bunx playwright screenshot \
  --viewport-size=1280,800 --wait-for-timeout=3000 \
  "http://127.0.0.1:3000/insight" /tmp/shot.png
```

### 8.4 现状与限制(动手前先读)

- **`e2e/` 目前只有 `todo.spec.ts` 占位**(`test.fixme()`,跑起来是 skipped)。insight 还没有自己的用例,要写是从零起。
- **dev 预览页(§7)Playwright 能直接访问**:`page.goto("/insight/__dev/question-dock")`。
- **Playwright 跑的就是交付的那个 root**(`octo.tsx`,见 §3.6 归一)。差异只剩 Router 模式(history vs Hash)和壳能力(`window.api` 在浏览器里没有),
  所以**纯 UI 断言可信**;涉及 IPC / 文件对话框 / 存储的功能仍然只能在 Electron 手验。
- `waitUntil: "networkidle"` 会超时 —— 应用常驻 SSE 事件流,网络永远不空闲。用 `domcontentloaded` + 显式等待。
- **e2e 会被 CI 跑**。`.github/workflows/test.yml` 的 `e2e` job 在 Linux / Windows 上跑 `packages/app/e2e` 全量,新增用例请确认不依赖本机环境(内网 / MCP / 特定 provider),否则会把 CI 跑红。

---

## 9. 进一步阅读

- [架构总览](architecture.md)
- [opencode 后端原理(深度)](learning/opencode-internals.md)
- [insight 运行时调试](insight-debugging.md)
- [如何快速找到本地日志](find-local-logs.md)
- [协作 PR 协议](collab-pr-protocol.md)
- [ADR-001 Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ROADMAP](../ROADMAP.md)
</content>
