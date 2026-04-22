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

## P1 — Phase 2（用研 Agent 功能）

> 待设计稿确认后拆分 spec，新建 `docs/specs/agents/agent-research.md`。

---

## P2 — Phase 3（多 Agent 协作）

> 待 Phase 2 验证后规划。

---

## 挂起

_暂无_

---

## 已完成

| 规模 | 领域 | Spec | 说明 |
|-----|------|------|------|
| `[M]` | infra | [开发环境 — Mode A 浏览器调试](docs/specs/infra/dev-environment.md) | Monorepo 脚手架、Electron 品牌重命名、octo-ui Vite 工程、opencode 后端连通 |
| `[L]` | ui | [octo-ui 前端架构](docs/specs/ui/octo-ui.md) | Vue3 + Pinia + Vue Router；SDK 集成；HomeView + SessionView 流式对话 |
| `[M]` | agents | [Multi-Agent Shell 骨架](docs/specs/agents/multi-agent-shell.md) | shell 注册表、Agent 接口、ResearchAgent 占位、3 个存根 Agent |
