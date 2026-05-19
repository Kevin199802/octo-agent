# Roadmap

**规模标签**:`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天

**领域标签**:`infra` 工程基础设施　`ui` 前端视觉与交互　`agents` Agent 配置与业务

## Roadmap 维护规则

- **完成即移出**:验收通过后剪切整行到"已完成"区
- **单一状态源**:同一条目只存在一个区
- **合入边界**:每个 agent 负责人只向内网贡献 `src/<name>/` 和 `agents/` 两个目录，其余是本地脚手架，详见 [docs/integration.md](docs/integration.md)

---

## 当前 — 提示词模板切换器 + MCP 联调

> Phase 1 UI 已落地，agent 已注册。下一步：实现提示词模板切换器，然后对接内网 MCP。
> Spec 总览：[docs/specs/ui/insight-overview.md](docs/specs/ui/insight-overview.md)

| 规模 | 领域 | 任务 | 完成标准 | Spec |
|-----|------|------|------|------|
| `[M]` | ui | **提示词模板切换器** | 工具栏显示当前模板；下拉菜单 3 组 6 项；选中后发送的 prompt 带对应前缀；切换 session 后重置默认 | [insight-analysis-mode.md](docs/specs/ui/insight-analysis-mode.md) |
| `[M]` | infra | **MCP 主流程联调** | DevTools 出现 `[mcp] connected` + 2 个工具；hardcoded S3 URL 注入 context → LLM 调 analyze_interview → OutputCard 渲染；验证 search_reports 调用 | [mcp-contract.md](docs/specs/agents/mcp-contract.md) |
| `[S]` | infra | **S3 文件直传（通用上传服务）** | InsightPage 上传文件到 UXR 接口成功；返回 S3 URL；URL 注入 context 后 MCP 流程正常；参数待 UXR 团队确认后更新 spec | [file-upload.md](docs/specs/infra/file-upload.md) |
| `[M]` | ui+infra | **MCP 长任务交付链路客户端落地** | 业务工具提交（< 5s 拿 task_id，UI 显示 task_id chip + 友好提示）；`get_task_result` 五状态分支（pending/processing/completed/failed/stopped）UI 表达；`stop_task` 触发与终止确认；OutputCard / ResultTab 加 `source: "inline" \| "uri"` + `uri`/`mimeType`/`fileName` 字段；detectCard 优先识别 resource_link part 并按 mimeType 路由；4 个 renderer 支持 fetch URI 渲染；session 内缓存 + 加载失败占位 + 跨 session 重新 fetch；agent prompt 落"不自动轮询、用户显式触发查询"约束；关闭 app 重开后历史 task_id 仍可继续查 | [ADR-011](docs/adr/011-tool-result-resource-uri.md) · [mcp-contract.md §任务管理](docs/specs/agents/mcp-contract.md) · [output-renderers.md §2.5](docs/specs/ui/output-renderers.md) |

---

## P1 — Phase 2（结果形态补全）

| 规模 | 领域 | 任务 | 说明 |
|-----|------|------|------|
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
