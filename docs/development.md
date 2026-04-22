# Octo Agent — 开发环境配置与调试指南

## 技术栈与工具要求

Octo Agent 使用 **Electron**（非 Tauri），因此**不需要 Rust / rustc / Cargo**。

| 工具 | 版本要求 | 用途 |
|---|---|---|
| Bun | 1.3+ | 包管理器、脚本运行器 |
| Node.js | 20+ | Electron 主进程运行时 |
| Git | 任意 | 版本控制 |
| Xcode CLI Tools | 最新（macOS） | 原生模块编译（node-pty） |

---

## 一、安装 Bun 并配置 PATH

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.zshrc        # 让 PATH 立即生效
bun --version          # 应输出 1.3.x
```

如果 `bun: command not found`，检查 `~/.zshrc` 是否有 `BUN_INSTALL` 的 PATH 配置，没有则手动追加：

```bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.zshrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## 二、安装 Xcode CLI Tools（macOS）

node-pty 编译原生模块时需要：

```bash
xcode-select --install   # 弹出 GUI 安装向导，约 5 分钟
xcode-select --version   # 验证
```

---

## 三、LLM API Key 配置

开发阶段需要配置真实 LLM provider，否则后端会使用内部占位模型（`opencode/big-pickle`），无法正常对话。

**推荐方式：`~/.opencode/config.json`**（持久化，重启后仍有效）

```bash
mkdir -p ~/.opencode
cat > ~/.opencode/config.json <<'EOF'
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-xxxx"
    }
  },
  "model": "anthropic/claude-sonnet-4-6"
}
EOF
```

也可以用 DeepSeek 或 Google Gemini，详见 [docs/specs/infra/dev-environment.md](docs/specs/infra/dev-environment.md) 第 3 节。

> **注意**：`~/.opencode/` 是 opencode 后端读取 provider 配置的位置，和系统上可能已安装的 opencode CLI 共用同一目录，但不会冲突——provider 配置共享是预期行为，会话数据按目录隔离。

---

## 四、首次安装依赖

```bash
git clone https://github.com/Kevin199802/octo-agent.git
cd octo-agent
bun install
```

预期输出末尾：`N packages installed [Xs]`，无 error。

---

## 五、开发调试方式

### 模式 A：纯前端调试（推荐日常开发）

两个终端分别启动，修改 Vue 文件后浏览器自动热更新，无需重启后端：

```bash
# 终端 1：启动 opencode 后端（注意是 dev:serve，不是 dev）
bun run dev:serve
# 期望输出：opencode server listening on http://127.0.0.1:4096

# 终端 2：启动 octo-ui dev server
bun --cwd packages/octo-ui dev
# 期望输出：VITE ready, Local: http://localhost:5174/
```

浏览器打开 `http://localhost:5174`：
- Vue 文件保存后**自动热更新（HMR）**，无需刷新
- 用 Chrome DevTools（F12）调试，与普通前端开发完全一样
- Vite proxy 将 `/api/*` 请求去掉前缀后转发到 `http://127.0.0.1:4096`

### 模式 B：Electron 集成调试

验证 Electron 主进程 + renderer 集成时使用。

**首次运行前**，需要手动下载 Electron 二进制（Bun 不自动执行 postinstall）：

```bash
node packages/desktop-electron/node_modules/electron/install.js
```

完成后启动：

```bash
bun --cwd packages/desktop-electron dev
```

- Electron 窗口内使用 Vue3 UI，支持 HMR
- 打开 Chrome DevTools：`Cmd + Option + I`（macOS）或菜单 View → Toggle DevTools
- 主进程日志在**启动的终端**里输出
- Renderer 日志在 **Electron DevTools Console** 里

---

## 六、各里程碑人工验收步骤

### M1 — Monorepo 脚手架

```bash
bun pm ls --all | grep "@octo/"
# 预期：6 行 @octo/* workspace:packages/...

bun turbo typecheck --filter="@octo/*"
# 预期：6 successful, 0 errors
```

### M3 — octo-ui 工程搭建

```bash
bun --cwd packages/octo-ui dev
```

浏览器打开 `http://localhost:5174`：
- 页面能正常加载（不是空白或 404）
- 修改任意 `.vue` 文件保存后页面自动刷新

### M4 — SDK 后端连通

先启动后端（`bun run dev:serve`），再启动前端（`bun --cwd packages/octo-ui dev`）：

- 首页显示当前项目目录名（不是"连接后端中…"）
- DevTools Network 面板能看到 `/api/project/current` 返回 200

### M6 — 核心对话 UI

- 首页点"新建会话"跳转到 SessionView
- 发送消息后，AI 回复以流式方式逐字出现
- 刷新后历史消息保留

### M8 — Electron 集成

先执行 `node packages/desktop-electron/node_modules/electron/install.js`，再：

```bash
bun --cwd packages/desktop-electron dev
```

- Electron 窗口内能看到 octo-ui 首页
- DevTools Console 无红色错误
- 创建会话 → 发送消息 → 能收到 AI 回复

### M9 — 构建产物

```bash
cd packages/desktop-electron
bun run build && bun run package:mac
```

- `dist/` 目录出现 `.dmg` 文件
- 双击安装，启动后能完成一次对话

---

## 七、常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| `bun: command not found` | PATH 未更新 | `source ~/.zshrc` 或重开终端 |
| `bun install` 报 tree-sitter 编译失败 | 缺少 Xcode CLI Tools | `xcode-select --install` |
| 首页一直显示"连接后端中…" | 后端未启动，或 proxy 配置错误 | 确认 `bun run dev:serve` 正在运行；`lsof -i :4096` 检查端口 |
| 首页报错"后端连接失败：HTML" | Vite proxy 缺少 `rewrite` 配置 | 确认 `vite.config.ts` proxy 有 `rewrite: (path) => path.replace(/^\/api/, "")` |
| `Error: Electron uninstall` | Electron 二进制未下载 | `node packages/desktop-electron/node_modules/electron/install.js` |
| AI 回复为 `opencode/big-pickle` | 未配置真实 LLM provider | 配置 `~/.opencode/config.json`，见第三节 |
| opencode 后端 4096 端口被占 | 端口冲突 | `OPENCODE_PORT=4097 bun run dev:serve` |
| Vue HMR 不生效 | Vite proxy websocket 未开启 | 确认 `vite.config.ts` 中 proxy 有 `ws: true` |
| macOS 打包签名报错 | `CodeSign failed` | `electron-builder.config.ts` 加 `mac: { identity: null }` |
