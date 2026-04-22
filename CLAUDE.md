# CLAUDE.md — Octo Agent

## 提交规则（强制）

**未经用户明确确认，禁止执行任何 `git commit` 或 `git push`。**

完成任务后列出变更文件并等待确认，不得以任何理由自行提交。

---

## 禁止修改的包

以下目录**一行不动**：

- `packages/opencode/` — 上游后端
- `packages/app/`、`packages/ui/` — 上游 SolidJS UI
- `packages/desktop/` — 上游 Tauri 壳

---

## Octo 包位置

| 包 | 路径 | 说明 |
|---|---|---|
| `@octo/ui` | `packages/octo-ui/` | Vue3 前端 |
| `@octo/shell` | `packages/shell/` | Agent 宿主 |
| `@octo/agent-research` | `packages/agent/research/` | 用研 Agent |
| `@octo/agent-synthesis` | `packages/agent/synthesis/` | 综合 Agent（存根） |
| `@octo/agent-report` | `packages/agent/report/` | 报告 Agent（存根） |
| `@octo/agent-coding` | `packages/agent/coding/` | 编码 Agent（存根） |

---

## 代码规范

- Vue 组件：`<script setup lang="ts">` + Composition API，不用 Options API
- CSS：三层 token 体系（primitives → semantic → component），禁止硬编码颜色值
- 新包默认 `"type": "module"`，tsconfig extends `@tsconfig/bun/tsconfig.json`（octo-ui 除外）

---

## 架构决策

- Electron vs Tauri → [docs/adr/001-electron-vs-tauri.md](docs/adr/001-electron-vs-tauri.md)
- Vue3 替换 SolidJS → [docs/adr/002-vue3-ui-rewrite.md](docs/adr/002-vue3-ui-rewrite.md)
- LLM Provider 接入 → [docs/adr/003-openai-compat-provider.md](docs/adr/003-openai-compat-provider.md)
