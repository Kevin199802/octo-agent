# Roadmap

Spec 编号是写作顺序，**不代表优先级**。实现顺序以本文件为准。

**规模标签**：`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天　`[XL]` > 1 周

**领域标签**：`infra` 工程基础设施　`ui` 前端视觉与交互　`agents` Agent 架构与业务

**Spec 目录结构**：
```
docs/specs/
  infra/     构建、发布、开发环境
  ui/        前端架构与视觉
  agents/    Multi-Agent 架构与各 Agent 业务
  future/    方向明确但暂不实现
```

## Roadmap 维护规则

- **完成即移出**：spec 验收通过后，从当前优先级区剪切整行，粘贴到"已完成"区。
- **单一状态源**：同一条目只存在一个地方（P0 / 挂起 / 已完成之一）。
- **原子可交付**：每行必须有清晰的完成标准，长期工作须拆成具体 spec 后再入表。

---

## P0 — Phase 1 收尾

> 本地能跑、能打包、能对话。

| 规模 | 领域 | Spec | 说明 |
|-----|------|------|------|
| `[S]` | infra | [开发环境 — Mode B Electron 调试](docs/specs/infra/dev-environment.md) | Electron 窗口加载 octo-ui，流式对话正常；前置：手动执行 electron 二进制安装 |
| `[M]` | infra | [构建与发布](docs/specs/infra/build-release.md) | macOS `.dmg` + Windows `.exe` 产出；opencode 后端 Node.js bundle 内嵌验证 |

---

## P1 — Phase 2(可配置 + 多 Agent 体验)

> 顺序优先级:UI 刷新 → Provider 配置 → Multi-Agent 体验 → Skill 系统 → MCP 集成。

| 规模 | 领域 | Spec | 说明 |
|-----|------|------|------|
| `[L]` | ui | [任务面板](docs/specs/ui/task-panel.md) | 右侧时间线 + Artifact tab,实时显示 agent 工作过程 |
| `[M]` | ui | [Settings — Provider 配置](docs/specs/ui/provider-config.md) | UI 化 provider/model 增删改、连通性测试、激活模型切换;不再需手编 JSON |
| `[L]` | agents | [多 Agent 协作](docs/specs/agents/multi-agent.md) | 内置 4 个 primary agent;subagent 自动调度可视化;权限授权对话框 |
| `[L]` | agents | [Skill 系统](docs/specs/agents/skill-system.md) | 技能库页面、平台/项目级 skill、在线创建向导、文件编辑 |
| `[M]` | agents | [MCP 集成 — 内网数据访问](docs/specs/agents/mcp-integration.md) | UI 配置 MCP server、状态监控、OAuth 流程、tool 调试面板 |

---

## P2 — Phase 3(高阶能力)

| 规模 | 领域 | Spec | 说明 |
|-----|------|------|------|
| `[M]` | agents | Agent 编辑器(GUI 创建/编辑 agent) | multi-agent.md §5.6/5.7 |
| `[M]` | agents | Skill 关联 agent / 上传 zip / URL 拉取 | skill-system.md §5.4-5.6 |
| `[M]` | ui | 上下文压缩可视化 + 手动触发 | learning/context-and-memory.md §2.5 |
| `[S]` | ui | 浅色/深色主题切换 | redesign-brief 已铺路 |
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

| 规模 | 领域 | Spec | 说明 |
|-----|------|------|------|
| `[M]` | ui | [UI 风格刷新](docs/specs/ui/octo-ui-redesign-brief.md) | 浅色主题、Tailwind 4、Sidebar/ChatView/Settings 改造,Codex 完成 |
| `[S]` | ui | ChatView 错误渲染 | 修复 LLM 调用错误被静默丢弃,显示 AuthError/APIError 详情 |
| `[S]` | infra | 主进程注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | 防止读到用户 `~/.claude/CLAUDE.md` 污染 |
| `[S]` | ui | Electron 模式优先用 preload 注入的真实端口 | 修复 vite proxy 写死 4096 但 opencode 用动态端口的 500 |
| `[L]` | docs | 架构与学习文档体系 | architecture.md / learning/ 5 篇 / specs/ 6 篇 + brief |
| `[S]` | infra | 配置文件路径隔离 `~/.config/octo/octo.config.json` | 主进程注入 `OPENCODE_CONFIG` |
| `[M]` | infra | [开发环境 — Mode A 浏览器调试](docs/specs/infra/dev-environment.md) | Monorepo 脚手架、Electron 品牌重命名、octo-ui Vite 工程、opencode 后端连通 |
| `[L]` | ui | Vue 3 UI 重写(ChatView 复读修复 + Sidebar + tokens) | SSE+REST 双层、思维链折叠、删除废弃 view |
