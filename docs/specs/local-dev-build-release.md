# Spec: 本地开发调试 · UI 换肤 · 构建发布

## 状态
草稿（2026-04-17）

## 目标

1. 任意成员克隆仓库后，能在 **30 分钟内**启动本地开发环境并看到 UI 热更新
2. UI 支持品牌换肤（主色、字体、Logo），通过 CSS 变量切换，无需修改组件代码
3. 在 Mac 上执行一条命令产出 **macOS `.dmg`** 安装包
4. 在 Windows 上执行一条命令产出 **Windows `.exe`（NSIS）** 安装包
5. 发布流程文档化，版本号管理、产物命名、分发方式明确

本 spec 不涉及具体业务功能（会话、Agent），只覆盖工程基础设施。

---

## 1. 环境依赖

### 1.1 macOS 开发机

按顺序安装，每步后验证。

#### Step 1 — Xcode Command Line Tools

```bash
xcode-select --install
# 弹出 GUI 安装向导，完成后验证：
xcode-select -p
# 期望输出：/Library/Developer/CommandLineTools
```

> 注意：如果已安装完整 Xcode，此步可跳过。但 Xcode 和 CLI Tools 同时存在时注意 `xcode-select -s` 指向正确路径。

#### Step 2 — Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Apple Silicon 需额外执行：
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
# 验证：
brew --version
# 期望：Homebrew 4.x.x
```

#### Step 3 — Bun

```bash
brew install oven-sh/bun/bun
# 或者用官方脚本（二选一）：
curl -fsSL https://bun.sh/install | bash

# 验证：
bun --version
# 期望：1.3.11 或更高
```

> **为什么用 Bun 而不是 npm/pnpm**：本仓库 `package.json` 指定了 `"packageManager": "bun@1.3.11"`，混用其他包管理器会导致 workspace 链接失败。

#### Step 4 — Node.js（部分脚本依赖）

```bash
brew install node
# 验证：
node --version
# 期望：v20.x 或更高
```

#### Step 5 — Rust 工具链

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# 安装时选择 "1) Proceed with standard installation"
# 安装完成后激活：
source "$HOME/.cargo/env"

# 验证：
rustc --version   # 期望：rustc 1.8x.x (stable)
cargo --version   # 期望：cargo 1.8x.x (stable)
```

> Rust 在 **Electron 路线中不需要**（见 ADR-001）。若最终选择 Tauri，则此步必须完成。

#### Step 6 — （仅 Tauri 路线）Tauri CLI

```bash
cargo install tauri-cli --version "^2" --locked
# 安装时间约 5-10 分钟（首次编译）
# 验证：
cargo tauri --version
# 期望：tauri-cli 2.x.x
```

#### Step 7 — Git & 仓库克隆

```bash
# 确认 git 版本
git --version  # 期望：git 2.x

# 克隆仓库
git clone <repo-url> octo-agent
cd octo-agent
```

---

### 1.2 Windows 开发机

#### Step 1 — Visual Studio Build Tools 2022

下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/

安装时勾选以下工作负载：
- **Desktop development with C++**（必选）
- 右侧组件确认包含：MSVC v143、Windows 11 SDK、CMake tools

> 这是 native npm 模块（如 node-pty）在 Windows 上编译的依赖。即使使用预编译包，Electron-builder 打包时仍需要 MSVC 工具链。

#### Step 2 — Node.js

下载 LTS 版（v20+）：https://nodejs.org  
安装时勾选 **"Automatically install the necessary tools"**（会自动安装 Chocolatey + Python）。

```powershell
# 验证：
node --version   # v20.x 或更高
npm --version
```

#### Step 3 — Bun

```powershell
# PowerShell（以管理员身份运行）
irm bun.sh/install.ps1 | iex

# 验证：
bun --version
```

#### Step 4 — WebView2 Runtime（仅 Tauri 路线）

Windows 10/11 通常已预装。若不存在：
下载地址：https://developer.microsoft.com/microsoft-edge/webview2/

#### Step 5 — Rust（仅 Tauri 路线）

下载 `rustup-init.exe`：https://rustup.rs  
安装时选择 `x86_64-pc-windows-msvc` toolchain（**必须是 MSVC，不是 GNU**）。

```powershell
rustc --version
cargo --version
cargo install tauri-cli --version "^2" --locked
```

---

### 1.3 环境检查脚本

项目根目录提供快速检查命令（待实现）：

```bash
bun run check-env
# 输出各依赖的版本状态，标记 ✅ / ❌
```

---

## 2. 首次初始化

```bash
# 在仓库根目录执行
bun install

# 期望输出（无报错）：
# bun install v1.x.x
# + 300+ packages installed
# Checked N installs across M packages (no issues)
```

**常见报错处理**：

| 报错 | 原因 | 解决 |
|---|---|---|
| `workspace:* not found` | 某个新包 package.json 中 name 与引用不匹配 | 检查各新包 `name` 字段 |
| `EACCES: permission denied` | Homebrew Bun 路径权限问题 | `sudo chown -R $(whoami) ~/.bun` |
| `Cannot find module 'bun:sqlite'` | 使用了 npm/pnpm 而非 Bun 执行 | 确认用 `bun install` 而非 `npm install` |

---

## 3. 本地开发调试

### 3.1 启动方式 A：分离模式（推荐调试 UI 时）

分离启动可以快速重启 UI 而不重启后端。

**终端 1 — 启动 opencode 后端**：

```bash
cd packages/opencode
bun run dev
# 期望：HTTP server listening on http://127.0.0.1:4096
# 日志会持续输出，保持此终端运行
```

**终端 2 — 启动 octo-ui 开发服务器**：

```bash
cd packages/octo-ui
bun run dev
# 期望：
#   VITE v6.x  ready in xxx ms
#   ➜  Local:   http://localhost:5173/
#   ➜  Network: use --host to expose
```

浏览器访问 `http://localhost:5173`，UI 支持热更新（HMR）。

**Vite Proxy 配置**（`packages/octo-ui/vite.config.ts` 中）：

```typescript
// 设计意图：所有 /api 请求代理到 opencode 后端
// WebSocket 连接也需要代理（流式输出依赖 ws）
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:4096',
      rewrite: (path) => path.replace(/^\/api/, ''),
      ws: true,           // ← WebSocket 流式输出必须开启
      changeOrigin: true,
    }
  }
}
```

> **为什么需要 ws: true**：opencode 的流式 AI 响应通过 WebSocket 推送，不开启 WebSocket 代理会导致流式输出静默失败。

### 3.2 启动方式 B：桌面应用模式（Electron，端到端验证）

```bash
# 在 packages/desktop-electron 目录
bun run dev
# 内部执行：electron-vite dev
# 会自动启动 Electron 窗口 + 内嵌 opencode 服务
```

> Electron dev 模式下，修改 renderer（Vue3 UI）会触发 HMR。修改 main process 代码需要手动重启。

**开发时环境变量**（在终端中设置，或写入 `.env.local`）：

```bash
# 选择 LLM provider（至少设置一个）
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"
export GOOGLE_GENERATIVE_AI_API_KEY="AIzaSy-xxxxxxxx"

# 可选：开启 opencode 详细日志
export OPENCODE_LOG_LEVEL="DEBUG"
```

> `.env.local` 已在 `.gitignore` 中，不会提交。不要将 API Key 写入 `.env`（会被 git 追踪）。

### 3.3 调试工具

**浏览器模式（方式 A）**：直接使用 Chrome/Safari DevTools。

**Electron 模式（方式 B）**：
- renderer 调试：`Ctrl+Shift+I`（Windows/Linux）或 `Cmd+Option+I`（macOS）打开 DevTools
- main process 调试：VS Code 配置 launch.json，或在 `electron-vite dev` 启动后 attach 到 Node.js 进程

**opencode 后端日志**：
```bash
# 实时查看 opencode 日志（分离模式）
tail -f ~/.opencode/logs/opencode.log
```

---

## 4. UI 换肤（主题系统）

### 4.1 设计原则

换肤通过 **CSS 自定义属性（Custom Properties）** 实现，组件内部只引用变量名，不硬编码颜色值。  
品牌切换只需替换根节点的变量赋值，组件代码零修改。

### 4.2 设计 Token 分层

```
Layer 1 — Primitive tokens（原始值）
  --color-blue-500: #3B82F6
  --color-gray-900: #111827

Layer 2 — Semantic tokens（语义映射，组件引用这一层）
  --color-primary:        var(--color-blue-500)
  --color-bg-base:        var(--color-gray-950)
  --color-text-primary:   var(--color-gray-50)
  --color-border:         var(--color-gray-800)
  --color-surface:        var(--color-gray-900)

Layer 3 — Component tokens（可选，复杂组件局部覆盖）
  --chat-bubble-user-bg:  var(--color-primary)
  --chat-bubble-ai-bg:    var(--color-surface)
```

### 4.3 主题文件结构

```
packages/octo-ui/src/styles/
├── tokens/
│   ├── primitives.css     # 所有原始色值定义
│   ├── default.css        # 默认主题（深色，品牌主色）
│   └── light.css          # 可选：浅色主题
├── base.css               # reset + 全局基础样式
└── index.css              # 入口，按顺序 @import 以上文件
```

**`primitives.css` 示例结构**：
```css
:root {
  /* 品牌色 */
  --color-brand-50:  #eff6ff;
  --color-brand-500: #3b82f6;
  --color-brand-900: #1e3a5f;

  /* 中性色 */
  --color-gray-50:   #f9fafb;
  --color-gray-950:  #030712;

  /* 功能色 */
  --color-success:   #22c55e;
  --color-warning:   #f59e0b;
  --color-error:     #ef4444;
}
```

**`default.css`（默认深色主题）**：
```css
:root {
  --color-primary:       var(--color-brand-500);
  --color-bg-base:       var(--color-gray-950);
  --color-text-primary:  var(--color-gray-50);
  --color-text-muted:    var(--color-gray-400);
  --color-border:        var(--color-gray-800);
  --color-surface:       var(--color-gray-900);
  --color-surface-raised:var(--color-gray-800);

  /* 字体 */
  --font-sans:  "Inter", system-ui, sans-serif;
  --font-mono:  "JetBrains Mono", "Fira Code", monospace;
  --font-size-base: 14px;
  --line-height-base: 1.6;

  /* 圆角 */
  --radius-sm:  4px;
  --radius-md:  8px;
  --radius-lg:  12px;

  /* 间距基准 */
  --space-1: 4px;
  --space-2: 8px;
  --space-4: 16px;
  --space-8: 32px;
}
```

### 4.4 换肤操作方式

**修改品牌主色**（以替换为公司品牌色为例）：

只需在 `default.css` 中修改：
```css
--color-primary: #YOUR_BRAND_COLOR;
```

或在 `primitives.css` 中修改 `--color-brand-500` 的值。

**运行时切换主题**（浅色/深色）：

```typescript
// 在 Pinia store 中管理主题
// 切换时修改 <html> 的 data-theme 属性
document.documentElement.setAttribute('data-theme', 'light')
```

对应 CSS：
```css
[data-theme="light"] {
  --color-bg-base:      var(--color-gray-50);
  --color-text-primary: var(--color-gray-900);
  /* 其余覆盖... */
}
```

### 4.5 Logo 和图标资源

```
packages/octo-ui/public/
├── logo.svg          # 主 Logo（SVG，可缩放）
├── logo-mark.svg     # 仅图标部分（用于小尺寸）
└── favicon.ico

packages/desktop-electron/icons/
├── icon.png          # 1024x1024 源图（用于生成所有尺寸）
├── icon.icns         # macOS（由 electron-builder 自动生成）
└── icon.ico          # Windows
```

**生成桌面图标**（需要准备 1024x1024 PNG）：

Electron 路线使用 `electron-builder` 内置图标生成：
```bash
# electron-builder 在打包时自动从 icon.png 生成所需格式
# 确保 electron-builder.config.ts 中 icon 路径正确：
# mac.icon: "icons/icon.icns"
# win.icon: "icons/icon.ico"
```

也可手动使用 `iconutil`（macOS）生成 `.icns`：
```bash
# 准备不同尺寸 PNG 后
mkdir icon.iconset
# 放入 icon_16x16.png, icon_32x32.png, ... icon_1024x1024.png
iconutil -c icns icon.iconset
```

---

## 5. 本地构建产物

### 5.1 构建前检查清单

```bash
# 1. 确认版本号正确（见第 6 节）
cat packages/desktop-electron/package.json | grep '"version"'

# 2. 确认 API Key 不在代码中（只通过环境变量或 resources/ 配置注入）
git grep -r "sk-" -- "*.ts" "*.json"  # 应无输出

# 3. 确认 opencode 后端已构建
ls packages/opencode/dist/node/node.js  # 文件应存在

# 4. 确认 octo-ui 可以构建
cd packages/octo-ui && bun run build && cd ../..
```

### 5.2 macOS 构建

```bash
cd packages/desktop-electron

# 构建 renderer（octo-ui）+ 打包 Electron
bun run build      # electron-vite build
bun run package:mac  # electron-builder --mac

# 产物位置：
# dist/mac-arm64/Octo Agent.app          （Apple Silicon）
# dist/mac/Octo Agent.app                （Intel Mac）
# dist/Octo Agent-x.y.z-arm64.dmg
# dist/Octo Agent-x.y.z.dmg
```

**Apple Silicon + Intel 通用包**（Universal Binary）：
```bash
# electron-builder.config.ts 中设置：
# mac.target: [{ target: "dmg", arch: ["universal"] }]
bun run package:mac
# 会先分别构建 arm64 和 x64，再 lipo 合并
# 构建时间约 10-15 分钟，产物约 200MB
```

**macOS 代码签名**（内网分发可先跳过）：
```bash
# 设置环境变量（从 Apple Developer 账户获取）
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="your-password"
export APPLE_ID="your@apple.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

bun run package:mac
# electron-builder 自动签名 + Notarize
```

> 未签名的 .dmg 在 macOS 上打开时会提示"来自身份不明的开发者"，内网分发时用户需要在"系统设置 → 隐私与安全性"中手动允许，或通过 `xattr -cr "/Applications/Octo Agent.app"` 移除隔离标记。

### 5.3 Windows 构建

```bash
# 在 Windows 机器上执行
cd packages/desktop-electron
bun run build
bun run package:win   # electron-builder --win

# 产物位置：
# dist/Octo Agent Setup x.y.z.exe    （NSIS 安装包）
# dist/Octo Agent-x.y.z-win.zip      （免安装 zip）
```

**Windows 代码签名**（内网分发可先跳过）：
```bash
# 现有 packages/desktop-electron 暂未配置签名脚本
# 内网分发时未签名 exe 会触发 SmartScreen 警告
# 用户点击"仍要运行"可继续安装
# 生产环境建议购买代码签名证书（EV 证书约 300-500 USD/年）
```

### 5.4 构建产物命名规范

```
Octo Agent-{version}-{platform}-{arch}.{ext}

示例：
  Octo Agent-1.0.0-arm64.dmg         macOS Apple Silicon
  Octo Agent-1.0.0.dmg               macOS Intel
  Octo Agent Setup 1.0.0.exe         Windows NSIS 安装包
  Octo Agent-1.0.0-win.zip           Windows 免安装
```

版本号格式：`MAJOR.MINOR.PATCH`（Semantic Versioning）

---

## 6. 版本管理与发布流程

### 6.1 版本号位置

版本号由 `packages/desktop-electron/package.json` 的 `version` 字段控制，`electron-builder` 自动读取。

```bash
# 查看当前版本
cat packages/desktop-electron/package.json | grep '"version"'
```

### 6.2 发布前操作

```bash
# 1. 确认所有变更已合并到 main
git checkout main && git pull

# 2. 更新版本号（手动编辑 packages/desktop-electron/package.json）
#    或使用 bun 脚本（待实现）：
#    bun run version:bump patch  # 1.0.0 → 1.0.1
#    bun run version:bump minor  # 1.0.0 → 1.1.0
#    bun run version:bump major  # 1.0.0 → 2.0.0

# 3. 打 git tag
git tag v1.0.0
git push origin v1.0.0
```

### 6.3 发布渠道（第一阶段：手动内网分发）

第一阶段不配置自动更新，采用手动分发：

```
1. Mac 机器构建 → 产出 .dmg → 上传至内网共享目录 / 企业网盘
2. Windows 机器构建 → 产出 .exe → 同上
3. 通知用户下载新版本安装包，覆盖安装即可
```

**内网分发目录结构建议**：
```
//fileserver/octo-agent/
├── latest/
│   ├── Octo Agent-1.0.0-arm64.dmg
│   ├── Octo Agent-1.0.0.dmg
│   └── Octo Agent Setup 1.0.0.exe
└── archive/
    └── v0.9.0/
        └── ...
```

### 6.4 GitHub Actions 自动构建（可选，第二阶段）

在 `.github/workflows/release.yml` 中配置：

```yaml
# 设计意图（非实现代码）
# trigger: push tag v*
# jobs:
#   build-mac:
#     runs-on: macos-latest
#     steps: checkout → bun install → bun run build → bun run package:mac → upload artifact
#   build-windows:
#     runs-on: windows-latest
#     steps: checkout → bun install → bun run build → bun run package:win → upload artifact
# 两个 job 并行运行，完成后汇总 artifacts 到 GitHub Release
```

---

## 7. 常见问题排查

### 开发环境问题

| 问题 | 现象 | 排查步骤 |
|---|---|---|
| 后端未启动 | UI 加载后显示"无法连接"或空白 | 确认 `bun run dev`（opencode）在运行；检查 `:4096` 端口 `lsof -i :4096` |
| WebSocket 连接失败 | 发送消息后无流式输出，或控制台报 WebSocket 错误 | 确认 vite.config.ts 中 `proxy['/api'].ws: true` 已设置 |
| API Key 无效 | 创建会话成功但 AI 无回复，或报 401 错误 | `echo $DEEPSEEK_API_KEY` 确认环境变量已设置；检查 Key 是否过期 |
| Electron 启动黑屏 | 桌面应用打开后窗口全黑 | 检查 renderer 构建是否成功：`packages/octo-ui/dist/` 目录是否存在 |
| bun install 卡住 | 长时间无响应 | 检查网络代理设置；尝试 `bun install --no-cache` |

### 构建问题

| 问题 | 现象 | 排查步骤 |
|---|---|---|
| `opencode/dist/node/node.js` 不存在 | 打包时报找不到 `virtual:opencode-server` | 先执行 `cd packages/opencode && bun run build:node` |
| macOS 打包报签名错误 | `CodeSign failed` | 内网分发时在 `electron-builder.config.ts` 中设置 `mac.identity: null` 跳过签名 |
| Windows 安装包被 SmartScreen 拦截 | 提示"Windows 已保护你的电脑" | 点击"更多信息 → 仍要运行"；生产环境需代码签名证书 |
| 安装包内 API Key 泄露 | `strings` 扫描安装包发现 Key | 检查 API Key 是否通过环境变量注入而非硬编码；审查 `resources/opencode-config.json` |

---

## 8. 验收条件

- [ ] 新成员按本 spec 操作，30 分钟内看到 UI 在浏览器中运行
- [ ] 修改 `--color-primary` 变量，UI 主色立即变更，无需修改任何组件
- [ ] `bun run package:mac` 产出 `.dmg`，在全新 Mac 上双击安装后应用正常启动
- [ ] Windows 机器 `bun run package:win` 产出 `.exe`，在 Windows 10/11 上安装后应用正常启动
- [ ] 安装包内无明文 API Key
- [ ] 应用名称和图标显示为 Octo Agent 品牌
