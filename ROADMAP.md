# Roadmap

**规模标签**:`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天

**领域标签**:`infra` 工程基础设施　`ui` 前端视觉与交互　`agents` Agent 配置与业务

## Roadmap 维护规则

- **完成即移出**:验收通过后剪切整行到"已完成"区
- **单一状态源**:同一条目只存在一个区
- **合入边界**:每个 agent 负责人只向内网贡献 `src/<name>/` 和 `agents/` 两个目录，其余是本地脚手架，详见 [docs/integration.md](docs/integration.md)

---

## 当前 — 用研 Agent 第一版

> 目标：用研 Agent 的 InsightPage 跑通，能新建对话、发送消息、看到回复。

| 规模 | 领域 | 任务 | 完成标准 |
|-----|------|------|------|
| `[M]` | ui | **InsightPage 基础骨架** | `packages/app/src/pages/insight/index.tsx` 路由跑通；包含任务面板（文件上传 + PromptInput）和主内容区（SessionTurn 渲染对话） |
| `[S]` | agents | **research.md 第一稿** | `packages/agent/research/agents/research.md` 写好 system prompt 和权限配置；本地 `octo.config.json` 接内网 LLM，能跑一轮用研对话 |
| `[S]` | ui | **表格输出渲染** | agent 输出 markdown 表格时（观点解析等），InsightPage 正常展示 |

---

## P1 — 完善

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[M]` | ui | **InsightPage 任务面板完善** | 历史任务列表、任务类型切换（观点解析 / 用户旅程等）、文件附件管理 |
| `[S]` | agents | **内网 skill 联调** | 同事完成 MCP server 后，本地验证 research agent 能通过 skill 调内网接口 |
| `[S]` | agents | **mock 脚本** | `packages/agent/research/mock/` 放本地测试脚本，无内网环境也能跑基础流程 |
| `[M]` | infra | [构建与发布](docs/specs/infra/build-release.md) | macOS `.dmg` + Windows `.exe`；opencode 后端 Node.js bundle 内嵌验证 |

---

## P2 — 其他 Agent 页面

> 各 agent 负责人在内网各自建 `src/<name>/` 目录，与用研 Agent 结构相同。

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[M]` | ui | Octo Make 页面（内网其他人） | `src/make/` 独立目录 |
| `[M]` | ui | 技能库 / 资产库页面 | `src/skills/` / `src/assets/`，M4 阶段 |
| `[S]` | ui | 思维导图渲染 | 在需要的 agent 页面内引入 mermaid / ECharts，不抽共享组件 |

---

## 挂起

| 任务 | 挂起原因 |
|------|---------|
| Agent 编辑器 GUI | 功能超前，后期再议 |
| Skill 管理 UI | 用原生 opencode 配置（`octo.config.json`）即可，暂不做 UI |
| MCP 配置 UI | 同上，用原生配置 |

---

## 已完成

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[L]` | infra | **M1 — Electron 渲染入口跑通** | `packages/octo-app/` 建立为启动入口，接入 opencode server，Electron 窗口跑通对话 |
| `[M]` | infra | **M1.5 — 工作目录策略确定** | 明确在 `packages/app/src/pages/insight/` 开发，与内网路径一致；精简脚手架；写 integration.md |
| `[M]` | docs | ADR-004 + 架构文档重构 | 切回 SolidJS、上游一行不动、四层降级策略 |
| `[S]` | infra | 配置文件路径隔离 | 主进程注入 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` |
| `[S]` | infra | 防止读取用户 CLAUDE.md | 主进程注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` |
| `[S]` | infra | 动态端口修复 | preload 注入真实端口，不再写死 4096 |
| `[L]` | docs | 架构与学习文档体系 | architecture.md / learning/ 8 篇 / specs/ 若干 |
| `[L]` | ui | Vue 3 UI 重写（已废弃） | 被 ADR-004 取代，代码已删除 |
