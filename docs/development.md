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

浏览器开 `http://localhost:3000`,HMR 实时。web 入口是 `octoapp/entry.tsx → app.tsx`,**不连壳能力**(IPC、文件对话框、`window.api` 相关按钮在此不可用,只能 3.1 验证)。

> 注:dev 预览沙箱页(`/insight/__dev/*`,见 §8)注册在桌面入口 `octo.tsx`,经 §3.1 的 `dev:desktop` 访问。

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

路由集中在 `packages/app/octoapp/pages/insight/__dev/routes.tsx` 的 `PAGES` 数组,经 `octo.tsx` 的 `import.meta.env.DEV && insightDevRoutes()` 挂载(生产构建摇树掉):

| 路由 | 内容 |
|---|---|
| `/insight/__dev` | 预览索引页(统一入口,互跳) |
| `/insight/__dev/insight-cards` | 任务卡 + 文件结果卡 |
| `/insight/__dev/typography` | 对话区正文 / 思维链排版样张 |
| `/insight/__dev/result-tabs` | ResultViewer Tab |
| `/insight/__dev/file-fallback` | FileFallback 按钮 |
| `/insight/__dev/attachment-bar` | 附件条 |
| `/insight/__dev/panel-header` | 面板头 |
| `/insight/__dev/attachment-parse` | 附件解析 |

在 `dev:desktop`(§3.1)运行的窗口里访问 `/insight/__dev` 即可。

#### 隔离三层

| 层 | 机制 | 效果 |
|---|---|---|
| **构建隔离** | `insightDevRoutes()` 仅在 `import.meta.env.DEV` 分支调用 | 生产构建是死代码,Rollup 摇树掉,不进 bundle |
| **壳复用** | `/insight/__dev` 命中 `octo.tsx` 的 `isInsightPage()` | 复用 insight 自带壳(无侧栏);dev 页 size-full 自包含 |
| **路径隔离** | 显式静态段 `/insight/__dev` 优先于通配 `/insight/:id?` | 不会被当 session id 落进 InsightPage |

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

**② 注册路由**(改 `__dev/routes.tsx`,**不碰 octo.tsx**):在 `routes.tsx` 加 `lazy` import + 在 `PAGES` 数组加一条 `{ path: "/insight/__dev/panel-tabs", component: ... }`。

**③ 登记索引**:在 `__dev/index-preview.tsx` 的 `DEV_PAGES` 数组加一条(`path` / `title` / `desc`)。

### 7.3 内网验证(不可跳过)

dev 页用 mock,**不能替代内网真实数据验证**。以下必须到内网真实流程确认:卡片在对话流中的位置 / 间距、滚动与虚拟列表裁切、任务卡状态流转动画、文件卡点击 ↔ ResultViewer 联动。流程:推代码 → 内网拉分支 → `dev:desktop` 启动 → 在 Insight 对话触发 MCP 工具 → 对照设计稿确认。

---

## 8. 进一步阅读

- [架构总览](architecture.md)
- [opencode 后端原理(深度)](learning/opencode-internals.md)
- [insight 运行时调试](insight-debugging.md)
- [如何快速找到本地日志](find-local-logs.md)
- [协作 PR 协议](collab-pr-protocol.md)
- [ADR-001 Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ROADMAP](../ROADMAP.md)
</content>
