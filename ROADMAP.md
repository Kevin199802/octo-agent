# Roadmap

**规模标签**:`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天

**领域标签**:`infra` 工程基础设施　`ui` 前端视觉与交互　`agents` Agent 配置与业务

## Roadmap 维护规则

- **完成即移出**:验收通过后剪切整行到"已完成"区
- **单一状态源**:同一条目只存在一个区
- **合入边界**:每个 agent 负责人只向内网贡献 `src/<name>/` 和 `agents/` 两个目录，其余是本地脚手架，详见 [docs/integration.md](docs/integration.md)

---

## 当前 — 修流式重复 bug（数据层重构）

> 内网必现"任务仍在处理中仍在处理中"类 SSE 流式重复 bug（外网不复现）。根因：InsightPage 自建本地 dataStore + 自建 listener 与 globalSync 双写同一 part 对象。
> 修复方向：删自建数据层，全部复用 opencode 原生 globalSync。
> Spec：[insight-data-layer-reuse.md](docs/specs/ui/insight-data-layer-reuse.md)

| 规模 | 领域 | 任务 | 完成标准 |
|-----|------|------|------|
| `[S]` | ui | **PR1：数据层切到 sync.data** | 删 dataStore + 自建 listener + REST 调用；用 sync.session.sync(id)；DataProvider 改传 sync.data + 加 onNavigateToSession/onSessionHref；§5.1 checklist 全过；内网验证 bug 不复现 |
| `[M]` | ui | **PR2：promptAsync 链路改造** | session.prompt → session.promptAsync + sync.session.optimistic.add；sending() 信号改为监听 sessionStatus busy；§5.2 checklist 全过 |

---

## 内网联调中

> Phase 1 UI 已落地，正在对接内网 MCP / 上传服务。

| 规模 | 领域 | 任务 | 完成标准 | Spec |
|-----|------|------|------|------|
| `[M]` | infra | **MCP 主流程联调** | DevTools 出现 `[mcp] connected` + 工具；S3 URL 注入 context → LLM 调业务工具 → OutputCard 渲染 | [mcp-contract.md](docs/specs/agents/mcp-contract.md) |
| `[S]` | infra | **S3 文件直传** | 上传端点已 env 化（[9b90e8b](.)）+ 响应包装对齐内网（[b87cc72](.)）；待内网首次联调通过 | [file-upload.md](docs/specs/infra/file-upload.md) |

---

## P0 — 待新对话执行

| 任务 | 说明 |
|------|------|
| **insight 流程改版 + CLAUDE.md 过时约束清理** | 移除 PromptTemplateSelector，改输入框顶部预置提示词按钮；基于完整流程重评所有"自实现 vs 复用"边界；清理 CLAUDE.md 过时约束。详见 [insight-data-layer-reuse.md §7/§9](docs/specs/ui/insight-data-layer-reuse.md)。**待数据层修复完成后开新对话执行** |

---

## P1 — Phase 2（结果形态补全）

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[M]` | ui | **Insight 内网调试工具（debug-observer）** | 阶段 1 第一步已落地（`[octo:event]` + `window.octoDebug` + 文档字典）。待执行 → 阶段 1 增强：snapshot 参数化（时间窗/profile/around）+ `why()` 速诊 + 捕获层加强（未捕获异常/console 镜像）；阶段 2：IndexedDB 持久化（跨 reload/重启）；阶段 3：renderer console 全量落盘兜底（限改+登记） | [insight-debug-toolkit.md](docs/specs/ui/insight-debug-toolkit.md) |
| `[S]` | ui | **原始输出隐藏升级（路线 B）** | MCP 联调后，tool_call part 到达时立即切换 loading 占位，原始内容从不暴露（当前 CSS 过渡方案在流完后才隐藏） | [ADR-010](docs/adr/010-suppress-raw-output.md) |
| `[S]` | agents | **内网 skill 联调** | 同事完成 MCP server 后，本地验证 research agent 能通过 skill 调内网接口 | — |
| `[S]` | agents | **mock 脚本** | `packages/agent/research/mock/` 放本地测试脚本，无内网环境也能跑基础流程 | — |

---

## P2 — 其他 Agent 与基础设施

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[M]` | ui | Octo Make 页面（内网其他人） | `src/make/` 独立目录，结构同 insight/ |
| `[M]` | ui | 技能库 / 资产库页面 | `src/skills/` / `src/assets/` |
| `[M]` | infra | [构建与发布](docs/specs/infra/build-release.md) | macOS `.dmg` + Windows `.exe`；opencode 后端 Node.js bundle 内嵌验证 |
| `[M]` | infra | **Agent 配置 cascading 部署** | 主进程读 bundle 默认值 + 用户配置 → 合并写到 `~/.config/octo/.octo-runtime.json`；`OPENCODE_CONFIG` 指向 runtime 文件；用户文件仅含 B+C；改源文件重启即生效；删除手动副本 | [agent-config-deploy.md](docs/specs/infra/agent-config-deploy.md) |

---

## 挂起

| 任务 | 挂起原因 |
|------|---------|
| **Workspace 工作区面板** | Spec 已写（[insight-workspace.md](docs/specs/ui/insight-workspace.md)）；等 Phase 1 完成后再做 |
| **MermaidRenderer** | 当前结果渲染支持 MD 和 JSON 即可；mermaid 若有需求再规划 |
| Agent 编辑器 GUI | 功能超前，后期再议 |
| Skill 管理 UI | 用原生 opencode 配置（`octo.json`）即可，暂不做 UI |
| MCP 配置 UI | 同上，用原生配置 |

---

## 已完成

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
| `[S]` | infra | **Session.agent 字段化 + 修 task 子会话归属** | 上游 `Session` 加 `agent` 列;task spawn 继承父 agent;insight strict 过滤 + 补 agent;修 2026-06-04 内网三类侧栏 bug。同步 UXAI PR #26 | [session-agent-attribution.md](docs/specs/infra/session-agent-attribution.md) |
| `[L]` | infra | **M1 — Electron 渲染入口跑通** | `packages/octo-app/` 建立为启动入口，接入 opencode server，Electron 窗口跑通对话 |
| `[M]` | infra | **M1.5 — 工作目录策略确定** | 明确在 `packages/app/src/pages/insight/` 开发，与内网路径一致；精简脚手架；写 integration.md |
| `[M]` | infra | **OctoShell 框架层** | `pages/_shell/`（sidebar + topbar）；RouterRoot 路由分叉；Chat/Studio 占位页 |
| `[M]` | ui | **InsightPage 基础骨架** | DataStore + SSE 监听 + PromptInput + SessionTurn 渲染跑通 |
| `[M]` | docs | ADR-004 + 架构文档重构 | 切回 SolidJS、上游一行不动、四层降级策略 |
| `[S]` | infra | 配置文件路径隔离 | 主进程注入 `OPENCODE_CONFIG=~/.config/octo/octo.json` |
| `[S]` | infra | 防止读取用户 CLAUDE.md | 主进程注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` |
| `[S]` | infra | 动态端口修复 | preload 注入真实端口，不再写死 4096 |
| `[L]` | docs | 架构与学习文档体系 | architecture.md / learning/ 8 篇 / specs/ 若干 |
| `[L]` | ui | Vue 3 UI 重写（已废弃） | 被 ADR-004 取代，代码已删除 |
| `[M]` | ui | **InsightPage 布局重构（3栏）** | 对话面板 280px + ResultViewer flex-1 + 右栏占位；拖拽调宽；octo-tokens.css 设计系统隔离 | insight-overview |
| `[M]` | ui | **AttachmentBar — 文件附件上传** | chips 显示；文件选择器；× 删除；最多 5 个；DnD 拖拽 | insight-attachment.md |
| `[M]` | ui | **InsightTurn + OutputCard — 对话输出卡片** | detectCard 解析 table/mindmap/json/markdown；卡片含标题+类型+时间戳；点击联动 ResultViewer | insight-conversation.md |
| `[L]` | ui | **ResultViewer — Tab 结果查看器（表格）** | Tab 管理（新建/切换/关闭）；TableRenderer；ActionBar 复制/下载；MermaidPlaceholder/JsonRenderer | insight-result-viewer.md |
| `[S]` | ui | **OctoShell sidebar 精细化** | 侧栏宽度可拖拽（160–360px）；session 标题生成骨架动效；新建会话 + 按钮 | — |
| `[S]` | agents | **insight.md — tool 声明 + 工作流 prompt** | 声明 MCP 工具（analyze_interview、search_reports）；含 analysis_type 选择指南和工作流约束；文件位于 `packages/agent/insight/agents/insight.md` | [mcp-contract.md](docs/specs/agents/mcp-contract.md) |
| `[S]` | agents | **insight agent 注册到 octo.json** | `~/.config/octo/octo.json` 写入 insight agent 配置（prompt + tools）；`session.prompt()` 显式传 `agent: "insight"` |  |
| `[M]` | ui | **OutputCard 渲染器扩展** | detectCard 改造（mindmap JSON + HTML 检测）；MindmapRenderer（markmap-view + UXR JSON 适配层）；HtmlRenderer（iframe sandbox allow-scripts）；TableRenderer Excel 导出（write-excel-file）；共享 parseMarkdownTable helper；debug 日志埋点 | [output-renderers.md](docs/specs/ui/output-renderers.md) |
| `[M]` | ui | **提示词模板切换器** | 工具栏显示当前模板；下拉菜单 3 组 6 项；选中后发送的 prompt 带对应前缀；切换 session 后重置默认（[ce9611b](.)） | [insight-analysis-mode.md](docs/specs/ui/insight-analysis-mode.md) |
| `[M]` | ui | **任务卡片(对话流内长任务呈现)** | 识别 part 中 `structuredContent.task_id`；5 状态机渲染；刷新/终止/follow-up 按钮；3 分钟刷新防抖；completed 注入 OutputCard；跨 turn 状态聚合（[8c7cc47](.)） | [task-card.md](docs/specs/ui/task-card.md) |
| `[M]` | ui | **OutputCard resource_link 路由扩展** | source: inline\|uri；按 mimeType 路由到 4 renderer；session 内缓存；completed 支持 1~N 个 resource_link（[6c1603c](.)） | [output-renderers.md §2.5](docs/specs/ui/output-renderers.md) |
| `[S]` | agents | **insight agent prompt 落"显式触发查询"约束** | insight.md 工作流明确长任务返回 task_id 后告知用户，不自动轮询；ADR-013 落地 | [ADR-013](docs/adr/013-long-task-progress-strategy.md) |
