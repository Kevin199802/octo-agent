# CLAUDE.md — Octo Agent

## 提交规则（强制）

**未经用户明确确认，禁止执行任何 `git commit` 或 `git push`。**

完成任务后列出变更文件并等待确认，不得以任何理由自行提交。

---

## 规划 spec / 写代码前的强制检查（强制）

任何"做 UI / 做功能"的 spec 在动笔前**必须先排查上游 opencode 是否已实现**：

1. 在 `packages/ui/src/components/` 和 `packages/app/src/components/` `packages/app/src/pages/` 用 grep 搜关键词
2. 如果**已经有了**：spec 只规划"Octo 定制"部分，绝对不重复造轮子
3. spec 顶部必须有"上游已实现:✓/✗"标注

---

## 工作目录

**我们在 `packages/app/` 里加页面**，与内网的 `packages/app/` 保持相同目录结构，便于按图索骥对接。

| 路径 | 说明 |
|---|---|
| `packages/app/src/pages/insight/` | 用研 Agent 页面（**合入物**，对应内网同路径） |
| `packages/agent/research/agents/` | opencode agent 配置文件（**合入物**，部署至 `~/.config/octo/agent/`） |
| `packages/app/src/app.tsx` | 加一行 Route，内网同样操作 |
| `packages/octo-app/src/main.tsx` | Electron 启动入口，本地脚手架，不合入 |

其他 agent 各自在 `packages/app/src/pages/<name>/` 建立相同结构。

---

## 改动政策

| 范围 | 政策 |
|---|---|
| `packages/app/src/pages/insight/`、`packages/agent/research/`、`docs/` | **自由改**（合入物） |
| `packages/app/src/app.tsx` | **限改**：只加路由注册那一行，内网同步 |
| `packages/app/` 其他文件、`packages/ui/`、`packages/opencode/`、`packages/sdk/` | **不动**：改了跟上游 diff 会乱 |
| `packages/desktop-electron/src/main/`、`electron.vite.config.ts` 等接线文件 | **限改**：仅品牌、接线、调试，改动登记到 [docs/integration.md](docs/integration.md) |
| `packages/octo-app/` | 本地 Electron 启动脚手架，不合入内网 |
| 其他 `packages/*` | 不动也不删 |

---

## 实施原则

- **复用零件**：思维链 / 工具流 / markdown / 各 dialog 等 import `@opencode-ai/ui` 的组件，**绝不重写**
- **页面自包含**：`insight/` 目录内的样式、组件、工具函数全部放在目录内，不往外散
- **可视化各自引库**：ECharts / mermaid 等在用到的页面目录内引入，不抽共享组件
- **Office 预览**：`window.api.openPath(filePath)` 唤起本地应用，不做浏览器内渲染
- **PromptInput 自己写**：上游 PromptInput 深耦合 packages/app context，在 `insight/` 内写简化版

---

## 架构决策(ADR)

- ADR-001 — Electron vs Tauri → [docs/adr/001-electron-vs-tauri.md](docs/adr/001-electron-vs-tauri.md)
- ADR-002 — Vue 3 替换 SolidJS → [docs/adr/002-vue3-ui-rewrite.md](docs/adr/002-vue3-ui-reuse.md) **(已弃用)**
- ADR-003 — LLM Provider 接入 → [docs/adr/003-openai-compat-provider.md](docs/adr/003-openai-compat-provider.md)
- ADR-004 — 切回 SolidJS → [docs/adr/004-solidjs-ui-reuse.md](docs/adr/004-solidjs-ui-reuse.md)
