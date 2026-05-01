# Roadmap

Spec 编号是写作顺序,**不代表优先级**。实现顺序以本文件为准。

**规模标签**:`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天　`[XL]` > 1 周

**领域标签**:`infra` 工程基础设施　`ui` 前端视觉与交互　`agents` Agent 架构与业务

**Spec 目录结构**:
```
docs/specs/
  infra/     构建、发布、开发环境
  ui/        前端视觉与品牌
  agents/    Multi-Agent 架构与各 Agent 业务
  future/    方向明确但暂不实现
```

## Roadmap 维护规则

- **完成即移出**:spec / milestone 验收通过后,从当前优先级区剪切整行,粘贴到"已完成"区
- **单一状态源**:同一条目只存在一个地方(P0 / P1 / 挂起 / 已完成之一)
- **原子可交付**:每行必须有清晰的完成标准,长期工作须拆成具体 spec / milestone 后再入表
- **重要前置**(强制):任何"做 UI / 做功能"的 spec 在动笔前必须先排查上游 opencode 是否已实现(详见 [CLAUDE.md](CLAUDE.md))。已有的只规划"Octo 品牌覆盖 / 业务定制"

---

## P0 — 当前

> M1 已达成。剩余:打包发布。

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[M]` | infra | [构建与发布](docs/specs/infra/build-release.md) | macOS `.dmg` + Windows `.exe` 产出;opencode 后端 Node.js bundle 内嵌验证 |

---

## P1 — Octo 业务工作台

> ADR-004 形态 B:Octo 自写工作台壳 + 复用 `@opencode-ai/ui` 零件。`AppInterface` 整体挂载方案已废弃。

| 规模 | 领域 | Milestone / Spec | 说明 |
|-----|------|------|------|
| `[L]` | ui | **M2 — 形态 B 拼装出可演示工作台**(5-7 天) | main.tsx 顶层从 `<AppInterface>` 改为 `<OctoWorkbench>`;实现 `OctoDataProvider` / `OctoSidebar` / `AgentSession` / `OctoPromptInput` 简化版;接近设计稿。详细任务清单见 [docs/learning/opencode-ui-composition.md §7](docs/learning/opencode-ui-composition.md) |
| `[M]` | agents | **M3 — 第一份用研 agent + 内网 LLM 接入** | 写 `~/.config/octo/agent/research.md`(用研 agent 配置);内网 LLM provider 接入 `octo.config.json`;音视频多模态可行性 demo(领导决策内网模型支持后启动) |
| `[M]` | ui | **M4 — Octo 业务页面定型** | 技能库 / 资产库 / 历史报告页面;通过 OctoWorkbench 路由直接 Octo 自写,无注入机制问题 |
| `[S]` | ui | [Settings — Provider 配置](docs/specs/ui/provider-config.md) | **上游已实现:✓** `dialog-manage-models` + `dialog-custom-provider` 已成品。Octo 端只在 OctoSidebar / Settings 页面挂入口 |
| `[S]` | agents | [MCP 集成](docs/specs/agents/mcp-integration.md) | **上游已实现:✓** `dialog-select-mcp` + OAuth 已成品。Octo 端只挂入口 |
| `[L]` | agents | [Skill 系统](docs/specs/agents/skill-system.md) | M4 的子任务,Octo 业务页面之一 |
| `[M]` | agents | [多 Agent 协作](docs/specs/agents/multi-agent.md) | M2 的 `OctoSidebar` 已天然支持(列表式 agent 选择);本 spec 规划 subagent 调度可视化等高级特性 |

> **强制行动项**:M2 启动前的第一件事——逐条打开 `docs/specs/ui/{task-panel,provider-config}.md`、`docs/specs/agents/{multi-agent,skill-system,mcp-integration}.md`,顶部加"上游已实现:✓/✗"标注,删除已被上游覆盖的子项。**否则会再次踩重复造轮子的坑**。

> **M2 必读**:[docs/learning/opencode-agent-system.md](docs/learning/opencode-agent-system.md) + [docs/learning/opencode-ui-composition.md](docs/learning/opencode-ui-composition.md),这两份是事实地基。

---

## P2 — 高阶能力

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[M]` | agents | Agent 编辑器(GUI 创建/编辑 agent) | multi-agent.md §5.6/5.7 |
| `[M]` | agents | Skill 关联 agent / 上传 zip / URL 拉取 | skill-system.md §5.4-5.6 |
| `[S]` | ui | 浅色/深色主题切换 | 上游已支持,Octo 端把 toggle 加到 Sidebar |
| `[M]` | infra | API Key 加密存储(electron-safe-storage) | provider-config.md §13 |

---

## P3 — Phase 4(规划中)

- 项目级"主 session"长期记忆机制(类似 Claude Project)
- Skill marketplace / 团队分享
- 显式 Agent 工作流编排(模式 C)
- 多端配置同步、用量统计

---

## 挂起

_暂无_

---

## 已完成

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[L]` | infra | **M1 — octo-app 渲染入口跑通(ADR-004)** | 新建 `packages/octo-app/`(SolidJS),boot 代码搬迁自上游 desktop renderer,挂载 `@opencode-ai/app` `AppInterface`,Octo Electron 窗口里跑出原生 opencode 完整 UI(文件上传 / agent 切换 / 全套 dialog / i18n 中文)。`octo-ui`(Vue)删除 |
| `[M]` | docs | ADR-004 + 架构文档重构 | 切回 SolidJS、上游一行不动、四层降级策略、模块清单一表清 |
| `[S]` | infra | [开发环境 — Mode B Electron 调试](docs/specs/infra/dev-environment.md) | Electron 窗口加载渲染层,流式对话正常 |
| `[M]` | ui | [UI 风格刷新](docs/specs/ui/octo-ui-redesign-brief.md) | 浅色主题、Tailwind 4、Sidebar/ChatView/Settings 改造,Codex 完成(资产已废弃,M2 重做) |
| `[S]` | ui | ChatView 错误渲染 | 修复 LLM 调用错误被静默丢弃(Vue 版,已废弃) |
| `[S]` | infra | 主进程注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | 防止读到用户 `~/.claude/CLAUDE.md` 污染 |
| `[S]` | ui | Electron 模式优先用 preload 注入的真实端口 | 修复 vite proxy 写死 4096 但 opencode 用动态端口的 500 |
| `[L]` | docs | 架构与学习文档体系 | architecture.md / learning/ 5 篇 / specs/ 6 篇 + brief |
| `[S]` | infra | 配置文件路径隔离 `~/.config/octo/octo.config.json` | 主进程注入 `OPENCODE_CONFIG` |
| `[M]` | infra | [开发环境 — Mode A 浏览器调试](docs/specs/infra/dev-environment.md) | Monorepo 脚手架、Electron 品牌重命名、opencode 后端连通 |
| `[L]` | ui | Vue 3 UI 重写(已废弃,被 ADR-004 取代) | SSE+REST 双层、思维链折叠、Sidebar 设计稿移植。代码已删除 |
