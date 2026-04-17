# ADR-001: 桌面壳子选型 — Electron vs Tauri

## 状态
已采纳（2026-04-17）

## 背景

上游 opencode 仓库同时维护两套桌面壳子：
- `packages/desktop`：Tauri 2.9，Rust，opencode 以 **sidecar 独立进程**运行
- `packages/desktop-electron`：Electron 40，Node.js，opencode 以 **Node.js 模块内嵌**运行

两套都是可用的起点，需要选择一套作为 Octo Agent 基础。

---

## 关键技术差异

### opencode 运行方式（最重要的架构差异）

| | Tauri | Electron |
|---|---|---|
| 运行模型 | 独立 sidecar 二进制 | `import("virtual:opencode-server")` 内嵌 Node 模块 |
| 通信方式 | HTTP + WebSocket 跨进程 | 同进程，再由 HTTP 暴露给 renderer |
| 二进制产物 | 需为每个目标平台单独编译 | opencode 编译为 JS + WASM，跨平台通用 |
| 进程管理 | Rust 侧管理生命周期 | Electron 主进程直接管理 |

Electron 版中 `server.ts` 的关键代码：
```typescript
const { Log, Server } = await import("virtual:opencode-server")
const listener = await Server.listen({ port, hostname, ... })
```
这意味着 opencode 完全在 Node.js 运行时内，没有跨进程通信的额外复杂度。

### 技术栈范围

| | Tauri | Electron |
|---|---|---|
| 语言 | TypeScript + **Rust** | 纯 TypeScript |
| 系统能力（PTY、文件、通知等） | Tauri 插件（Rust 实现） | Node.js 原生 API + npm 生态 |
| native 模块 | Rust FFI | `@lydell/node-pty` 等（预编译 npm 包） |

### 生态与文档成熟度

| | Tauri | Electron |
|---|---|---|
| 发布年份 | 2021 | 2013 |
| GitHub Stars | ~90k | ~116k |
| npm 周下载 | ~100k | ~1.5M |
| Stack Overflow 答案密度 | 较少，冷门问题容易卡住 | 极丰富，几乎所有问题都有先例 |
| Vue3 生态结合 | 完全支持，但案例相对少 | `electron-vite` 官方维护，文档完善 |
| 调试工具 | 前端 Chrome DevTools；Rust 需单独工具链 | 全程 Chrome DevTools，统一体验 |

### 性能与包体积

| | Tauri | Electron |
|---|---|---|
| 安装包大小 | ~15 MB | ~150 MB |
| 内存基线 | ~30 MB | ~150 MB |
| 渲染一致性 | macOS WebKit / Windows WebView2 有细微差异 | Chromium 统一 |

对内网工具用户（开发/研究人员，16G+ 机器，内网分发）：包体积和内存差距在实际使用中感知不明显。

### 未来趋势

Tauri 增长很快，是**公开发行 C 端产品**（需要极小安装包）的热门选择。  
Electron 在**内部工具、企业软件**领域仍是主流，VS Code、Slack、Figma 桌面端均采用。  
对内网工具场景，两者都不会"死"，但 Electron 的存量知识更厚。

---

## 综合对比表

| 维度 | Tauri | Electron | 权重 |
|---|---|---|---|
| opencode 集成复杂度 | 高（sidecar 二进制，路径配置） | 低（in-process Node 模块） | ★★★★★ |
| 团队技术栈匹配 | 需要 Rust 储备 | 纯 TypeScript，开箱即用 | ★★★★★ |
| 遇到问题能否搞定 | 风险较高（文档少，社区小） | 风险低（资料极丰富） | ★★★★★ |
| Vue3 开发体验 | 支持，无特别优化 | electron-vite 原生支持，HMR 完善 | ★★★ |
| 包体积 / 内存 | 显著更优 | 较大 | ★（内网场景权重低）|
| UI 渲染一致性 | 有 WebView 差异 | Chromium 统一 | ★★ |

---

## 建议

**推荐 Electron。**

核心理由：
1. **opencode in-process 嵌入**：Electron 版直接把 opencode 作为 Node 模块加载，没有 sidecar 二进制的路径、权限、跨进程通信问题。Tauri 版的 sidecar 机制是该项目在集成阶段最容易踩坑的地方。
2. **零 Rust 依赖**：`packages/desktop-electron` 全部是 TypeScript，与 `packages/octo-ui` 的技术栈完全一致，团队不需要引入 Rust 能力。
3. **遇到问题能搞定**：Electron 的问题几乎全部有 Stack Overflow 答案或成熟 npm 包解法。Tauri 的冷门问题（尤其是 Windows WebView2 行为、Rust plugin 定制）容易在小团队项目中成为阻塞点。
4. **起步成本低**：`packages/desktop-electron` 的 main process（`server.ts`、`windows.ts`、`ipc.ts`）已经完整，只需替换 renderer 为 Vue3 即可。

Tauri 的主要优势（包体积、内存）在内网工具场景权重很低。

---

## 决策

**选择 Electron。**

理由：opencode 以 Node 模块内嵌主进程，无 sidecar 二进制复杂度；全 TypeScript 技术栈无需 Rust；社区资源充足不会成为阻塞点；`packages/desktop-electron` 已有完整实现起步成本最低。

## 后果

**若选 Electron（推荐路径）**：
- 基于 `packages/desktop-electron`，renderer 从 SolidJS 替换为 Vue3
- main process 代码可大部分复用
- 不涉及任何 Rust 代码
- `packages/desktop`（Tauri）保留在仓库中，不删除也不使用

**若选 Tauri**：
- 基于 `packages/desktop`，修改应用名 + 图标
- 需要了解 Tauri 插件机制和 Rust 构建工具链
- 遇到 WebView 或 Rust 相关问题时，社区资源有限
