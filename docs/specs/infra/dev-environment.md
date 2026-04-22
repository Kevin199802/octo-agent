# Spec: 开发环境搭建

## 状态
已完成（Mode A 浏览器调试 ✅，Mode B Electron 调试 🚧 待验收）

## 目标

任意成员克隆仓库后，能在 **30 分钟内**启动本地开发环境并看到 UI 热更新。

---

## 1. 环境依赖

> 本项目使用 **Electron**，不需要 Rust / Cargo / Tauri。

### 1.1 macOS 开发机

#### Xcode Command Line Tools

```bash
xcode-select --install
xcode-select -p   # 期望：/Library/Developer/CommandLineTools
```

#### Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Apple Silicon 额外执行：
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

#### Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.zshrc
bun --version   # 期望：1.3.x 或更高
```

#### Node.js

```bash
brew install node
node --version   # 期望：v20.x 或更高
```

### 1.2 Windows 开发机

1. 安装 [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **Desktop development with C++**（MSVC v143 + Windows 11 SDK）
2. 安装 [Node.js LTS v20+](https://nodejs.org)，勾选 "Automatically install the necessary tools"
3. PowerShell（管理员）安装 Bun：`irm bun.sh/install.ps1 | iex`

---

## 2. 首次初始化

```bash
git clone <repo-url> octo-agent
cd octo-agent
bun install
```

期望输出末尾：`N packages installed`，无 error。

| 报错 | 原因 | 解决 |
|---|---|---|
| `workspace:* not found` | 新包 name 与引用不匹配 | 检查各新包 `name` 字段 |
| `EACCES: permission denied` | Bun 路径权限 | `sudo chown -R $(whoami) ~/.bun` |
| `Cannot find module 'bun:sqlite'` | 用了 npm/pnpm | 改用 `bun install` |
| tree-sitter 编译失败 | 缺少 Xcode CLI Tools | `xcode-select --install` |

---

## 3. LLM Provider 配置

未配置时后端使用内部占位模型（`opencode/big-pickle`），无法真实对话。

**主要方式：`~/.opencode/config.json`**

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

也可通过环境变量（opencode 优先读取）：

```bash
# 写入 ~/.zshrc 持久化
export ANTHROPIC_API_KEY="sk-ant-xxxx"
export DEEPSEEK_API_KEY="sk-xxxx"
export GOOGLE_GENERATIVE_AI_API_KEY="AIzaxxxx"
source ~/.zshrc
```

> **关于 `~/.opencode` 目录**：opencode 后端的全局配置目录。若机器上同时安装了 opencode CLI，两者共用——provider 配置共享是预期行为，会话数据按工作目录隔离，互不干扰。

| Provider | 配置字段 | 常用模型 |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-6` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek/deepseek-chat` |
| Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | `google/gemini-2.0-flash` |
| 内网 LLM | `providers.custom.baseURL` + `apiKey` | 由内网服务决定 |

验证：

```bash
curl http://127.0.0.1:4096/provider   # 应返回非空 provider 列表
```

---

## 4. 本地开发调试

### Mode A — 浏览器调试（日常 UI 开发，推荐）

```bash
# 终端 1：opencode 后端（注意是 dev:serve，不是 dev）
bun run dev:serve
# 期望：opencode server listening on http://127.0.0.1:4096

# 终端 2：octo-ui 前端
bun --cwd packages/octo-ui dev
# 期望：VITE ready, Local: http://localhost:5174/
```

浏览器打开 `http://localhost:5174`，修改 `.vue` 文件保存后页面自动刷新。

**Vite Proxy**（`packages/octo-ui/vite.config.ts`）：

```typescript
'/api': {
  target: 'http://127.0.0.1:4096',
  changeOrigin: true,
  ws: true,                                        // 流式输出必须开启
  rewrite: (path) => path.replace(/^\/api/, ''),  // 去掉 /api 前缀再转发
}
```

> `rewrite` 是关键：opencode 路由没有 `/api` 前缀，缺少 rewrite 会导致所有 API 请求返回 HTML。

### Mode B — Electron 调试（端到端验证）

Mode A 和 Mode B **不要同时运行**（都会占用 :4096 端口）。

**首次运行前**，需手动安装 Electron 二进制（Bun 不执行其 postinstall）：

```bash
node packages/desktop-electron/node_modules/electron/install.js
```

启动：

```bash
bun --cwd packages/desktop-electron dev
# Electron 窗口内运行 octo-ui，renderer 端口固定 5175
```

打开 DevTools：`Cmd+Option+I`（macOS）/ `Ctrl+Shift+I`（Windows）。

---

## 5. 常见问题

| 问题 | 排查 |
|---|---|
| 首页一直"连接后端中…" | 确认 `bun run dev:serve` 正在运行；`lsof -i :4096` 检查端口 |
| API 返回 HTML 而非 JSON | 确认 `vite.config.ts` proxy 有 `rewrite` 配置 |
| `Error: Electron uninstall` | `node packages/desktop-electron/node_modules/electron/install.js` |
| AI 回复显示 `opencode/big-pickle` | 配置 `~/.opencode/config.json`，见第 3 节 |
| `bun: command not found` | `source ~/.zshrc` 或重开终端 |

---

## 验收条件

- [ ] 新成员按本 spec 操作，30 分钟内在浏览器看到 octo-ui 运行
- [ ] 修改任意 `.vue` 文件，浏览器自动热更新
- [ ] 完成一次多轮 AI 对话，流式输出正常
- [ ] Electron 窗口内加载 octo-ui，DevTools Console 无红色错误
