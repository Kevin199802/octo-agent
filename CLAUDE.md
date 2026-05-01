# CLAUDE.md — Octo Agent

## 提交规则（强制）

**未经用户明确确认，禁止执行任何 `git commit` 或 `git push`。**

完成任务后列出变更文件并等待确认，不得以任何理由自行提交。

---

## 规划 spec / 写代码前的强制检查（强制）

任何"做 UI / 做功能"的 spec 在动笔前**必须先排查上游 opencode 是否已实现**：

1. 先读 [docs/architecture.md](docs/architecture.md) §2(包归属)、§3(四层降级策略)
2. 必读 [docs/learning/opencode-agent-system.md](docs/learning/opencode-agent-system.md) 和 [docs/learning/opencode-ui-composition.md](docs/learning/opencode-ui-composition.md) 两份事实地基
3. 在 `packages/ui/src/components/` 和 `packages/app/src/components/` `packages/app/src/pages/` 用 grep 搜关键词
4. 如果**已经有了**:spec 只规划"Octo 品牌覆盖 / 业务定制"部分,绝对不重复造轮子
5. spec 顶部必须有"上游已实现:✓/✗"标注;若 ✓,列出复用的上游组件/对话框/API

**Why:** Phase 1 已经踩过两次坑(自写思维链、自写 3 分栏),都因没先查上游浪费数天工作量。`@opencode-ai/ui` 是真正的零件库,几乎所有 UI 组件都能直接 import;`@opencode-ai/app` 是装配厂,IDE 形态。Octo 形态 B = 自写工作台壳 + 复用 ui 零件,详见 ADR-004。

## 形态 B 实施原则(M2+)

- **复用零件**:思维链 / 工具流 / markdown / 各 dialog 等 import `@opencode-ai/ui` 的组件,**绝不重写**
- **自写顶层**:Octo Workbench 路由 / Sidebar / 业务页面是 Octo 写的
- **数据层桥**:Octo 写 `OctoDataProvider`,把 OpencodeClient 的 REST + SSE 数据塞进 `@opencode-ai/ui` 的 `DataProvider` store
- **PromptInput 自写简化版**:`@opencode-ai/app` 的 PromptInput 深耦合 packages/app context,不复用

---

## 改动政策（必读）

详细规则见 [docs/architecture.md](docs/architecture.md) §2。一句话版:

| 范围 | 政策 |
|---|---|
| `packages/octo-app/`、`packages/shell/`、`packages/agent/*`、`docs/` | **自由改** |
| `packages/opencode/`、`packages/ui/`、`packages/app/`、`packages/sdk/`、`packages/desktop-electron/src/renderer/`、`packages/desktop-electron/src/preload/` | **一行不动**(上游,合入冲突源头) |
| `packages/desktop-electron/src/main/`、`packages/desktop-electron/electron.vite.config.ts`、`packages/desktop-electron/electron-builder.config.ts`、`packages/desktop-electron/package.json`、仓库根 `package.json` / `turbo.json` | **限改**:仅品牌、接线、调试。改动必须同步登记到 architecture.md §4.4 |
| 其他 `packages/*`(desktop / web / console / enterprise / extensions / containers / function / identity / plugin / script / shared / slack / storybook、`sdks/vscode/`) | **不动也不删**(历史遗留) |

> ⚠️ ADR-004 修订后:`packages/ui/` 和 `packages/app/` 重新归入"一行不动"。原因是合入内网时多团队并行开发,直接改上游会冲突。所有 Octo 定制集中到 `packages/octo-app/`。

---

## Octo 自研包位置

| 包 | 路径 | 说明 |
|---|---|---|
| `@octo/app` | `packages/octo-app/` | **渲染入口**(SolidJS)。boot 代码 `src/main.tsx` 复用上游 platform 抽象,组合 `@opencode-ai/app` 的 `AppInterface` 挂完整 UI;Octo 业务页面以后加在这里 |
| `@octo/shell` | `packages/shell/` | Agent 任务调度(Phase 2 启用) |
| `@octo/agent-research` | `packages/agent/research/` | 用研 Agent(Phase 2 起接入) |

> Phase 2 的 synthesis / report / coding 子 agent 放在 `packages/agent/<name>/`。

---

## 代码规范

### `octo-app`(SolidJS)

- 组件:JSX + `createSignal` / `createMemo` / `createEffect`
- **优先 import** `@opencode-ai/app` 和 `@opencode-ai/ui` 的现成组件 / 对话框,严禁重新实现已有功能
- 改 UI 行为优先级:CSS 变量覆盖 → 组合 wrapper → 都不行才考虑 Octo 端 fork(单文件复制到 octo-app/src/forks/,标注源版本)
- 与 opencode 通信通过 `OpencodeClient`(来自 `@opencode-ai/sdk/client`),preload 注入真实 url + Basic auth

### 后端 / Agent 包

- 默认 `"type": "module"`
- `tsconfig` extends `@tsconfig/bun/tsconfig.json`

---

## 架构决策(ADR)

- ADR-001 — Electron vs Tauri → [docs/adr/001-electron-vs-tauri.md](docs/adr/001-electron-vs-tauri.md)
- ADR-002 — Vue 3 替换 SolidJS → [docs/adr/002-vue3-ui-rewrite.md](docs/adr/002-vue3-ui-rewrite.md) **(已弃用)**
- ADR-003 — LLM Provider 接入 → [docs/adr/003-openai-compat-provider.md](docs/adr/003-openai-compat-provider.md)
- ADR-004 — 切回 SolidJS,octo-app 复用上游 UI → [docs/adr/004-solidjs-ui-reuse.md](docs/adr/004-solidjs-ui-reuse.md) **(当前生效)**
