# Octo Agent — 开发、调试、打包指南

> 上次同步:2026-04-27。环境:macOS,Apple Silicon。Linux/Windows 需调整。

里程碑跟踪与验收清单见仓库根 [ROADMAP.md](../ROADMAP.md)。架构与目录边界见 [docs/architecture.md](architecture.md)。

---

## 1. 环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Bun | 1.3+ | 包管理器、脚本运行器 |
| Node.js | 20+ | Electron 主进程、native 模块编译 |
| Xcode CLI Tools | 最新 | macOS 上 node-pty 等 native 模块编译 |
| Git | 任意 | — |

```bash
bun --version          # 1.3.x
node --version         # v20+
xcode-select -p        # 应输出路径,无输出则: xcode-select --install
```

---

## 2. 首次准备

```bash
git clone https://github.com/Kevin199802/octo-agent.git
cd octo-agent
bun install
```

### LLM Provider 配置

Octo Agent 主进程会**强制注入** `OPENCODE_CONFIG=~/.config/octo/octo.config.json`,因此 opencode 后端**只读这个文件**(跟系统上可能装的 opencode CLI 完全隔离)。第一次需要手动建:

```bash
mkdir -p ~/.config/octo
```

最小配置示例(以百炼 Anthropic 兼容网关 + Qwen 为例):

```jsonc
// ~/.config/octo/octo.config.json
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

`bun run dev` 之前会跑 `scripts/predev.ts`,做两件事:

1. 拷贝应用图标
2. 在 `packages/opencode` 跑一次 `bun script/build-node.ts`,产出 Node bundle 给 main 进程 import

opencode 源码没改时第一次跑过就够了,后续 dev 仍会重复。如果想跳过:`cd packages/desktop-electron && bunx electron-vite dev`。

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
| 创建会话报 500 | config.json schema 错误或路径不对 | 路径必须是 `~/.config/octo/octo.config.json`,`provider`(单数),`apiKey` 在 `options` 下 |
| AI 回复显示 `opencode/big-pickle` | 配置没生效,后端用占位模型 | 同上,检查后端 stdout 里有没有"loaded provider"日志 |
| 5175 端口冲突 | Vite strictPort 被占 | `lsof -i :5175` 找到占用进程 kill,或改 [electron.vite.config.ts](../packages/desktop-electron/electron.vite.config.ts) 的 `server.port` |
| 4096 端口冲突 | 已在跑 opencode CLI / 上次 dev 没退干净 | `lsof -i :4096` 杀掉,或 `OPENCODE_PORT=4097 bun run dev:serve` |
| `bun install` tree-sitter 编译失败 | Xcode CLI Tools 未装 | `xcode-select --install` |
| Vue HMR 不生效 | proxy ws 没开 | 确认 vite proxy 配了 `ws: true` |
| 改了 config.json 没效果 | 后端在内存里缓存了配置 | 重启后端(整个 dev 重跑) |
| 切了模型仍是旧回复 | 同上 | 同上 |
| 打包后白屏 | renderer 资源路径问题 | 见第 5 节排查清单 |

---

## 7. Git 工作流

- 当前主分支:`main`,日常分支:`dev`
- **未经明确确认禁止 commit / push**(见 [CLAUDE.md](../CLAUDE.md))
- commit message 用中文
- 禁改的目录见 [architecture.md §3](architecture.md#3-修改边界与上游改动清单)

---

## 8. 进一步阅读

- [架构总览](architecture.md)
- [opencode 后端原理(深度)](learning/opencode-internals.md)
- [ROADMAP](../ROADMAP.md)
- [ADR-001 Electron vs Tauri](adr/001-electron-vs-tauri.md)
- [ADR-002 Vue 3 替换 SolidJS](adr/002-vue3-ui-rewrite.md)
- [ADR-003 LLM Provider 接入](adr/003-openai-compat-provider.md)
- [Spec — 开发环境](specs/infra/dev-environment.md)
- [Spec — 构建与发布](specs/infra/build-release.md)
