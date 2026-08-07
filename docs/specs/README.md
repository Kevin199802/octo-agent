# Specs 登记表

> 本表是 spec 编号 → 文件的**唯一登记处**：找一个 `SPEC-INS-NNN` 对应哪个文件、或者反过来查一个文件有没有编号，查这里，不用全文检索。
> 参考业界惯例（Rust RFC 索引 / Python PEP 0 / K8s KEP 索引）：编号旁路维护一张登记表，不塞进 [ROADMAP.md](../../ROADMAP.md)（那张表只面向未来待办）。

**新建 spec 编号规则**：`SPEC-INS-NNN` 只用于 insight 专属 spec；下一个号 = 本表当前最大编号 + 1（**先查本表，不要凭记忆猜**）；新建 / 编号变更后随手把这张表更新掉。编号一旦发布视为永久 ID，不因为"后来发现顺序不对"就整体重排（历史撞车修法见下方脚注）。

---

## 已编号（SPEC-INS-001 ~ 029）

| 编号 | 标题 | 状态 | 领域 | 文件 |
|---|---|---|---|---|
| 001 | 文件附件上传交互（AttachmentBar） | 草案 | ui/insight | [insight-attachment.md](ui/insight-attachment.md) |
| 002 | 对话流与输出卡片（Conversation & OutputCard） | 草案 | ui/insight | [insight-conversation.md](ui/insight-conversation.md) |
| 003 | 中间面板结果查看器（ResultViewer） | 框架已实现 | ui/insight | [insight-result-viewer.md](ui/insight-result-viewer.md) |
| 004 | 右侧 Workspace 工作区面板 | 草案（部分被取代，见 014 §10） | ui/insight | [insight-workspace.md](ui/insight-workspace.md) |
| 005 | 对接 opencode 原生数据层（Data Layer Reuse） | ✅ 已落地（保留设计记录） | ui/insight | [insight-data-layer-reuse.md](ui/insight-data-layer-reuse.md) |
| 006 | insight/ 自建组件轻审计 | 草案（诊断报告，非实现 spec） | ui/insight | [insight-component-audit.md](ui/insight-component-audit.md) |
| 007 | 产品流程改版：预置提示词 + promptAsync + 输入区整改 | ✅ 主体已落地 | ui/insight | [insight-prompt-redesign.md](ui/insight-prompt-redesign.md) |
| 008 | 引用型 MCP 工具的设计 | 草案 | ui + agent contract | [insight-references.md](ui/insight-references.md) |
| 009 | 任务面板按需弹出（ResultViewer reveal） | 草案 | ui/insight | [insight-result-panel-reveal.md](ui/insight-result-panel-reveal.md) |
| 010 | Insight 独立化：放弃 cowork 接线层，自包含可挂载模块 | ✅ 主体已落地（PR1/PR2 + D10/D11） | ui/insight | [insight-standalone-extraction.md](ui/insight-standalone-extraction.md) |
| 011 | Insight 内网调试可观测工具（debug-observer） | 草案 | ui/insight | [insight-debug-toolkit.md](ui/insight-debug-toolkit.md) |
| 012 | Insight 对话目录归属（跟随所选目录） | 已落地 | ui/insight | [insight-directory-scoping.md](ui/insight-directory-scoping.md) |
| 013 | Insight 会话列表服务端分页 | 草案 | ui/insight + infra/session | [insight-session-list-pagination.md](ui/insight-session-list-pagination.md) |
| 014 | Insight 本地工作目录布局（worktree 文档本地化） | 草案（v3，UI 打磨对齐 Design） | infra/insight | [insight-worktree-layout.md](infra/insight-worktree-layout.md) |
| 015 | Insight Agent 文件传参机制（上传 / 路由） | 草案 | infra/insight/agent | [insight-file-passing.md](infra/insight-file-passing.md) |
| 016 | `extract_document` 工具（office → 文本） | 已实现，内网验证中（UXAI PR #272） | infra/insight/tool | [insight-extract-document.md](infra/insight-extract-document.md) |
| 017 | MCP 显式入口（输入框 chip 触发） | ✅ 已实现（外网，分支 `feat/mcp-explicit-entry`） | infra/ui/insight | [insight-mcp-explicit-entry.md](infra/insight-mcp-explicit-entry.md) |
| 018 | 本地解析 v1（长上下文直喂，观点解析先行） | 草案（2026-07-11 修订：工具面拆出至 021、锚点+校验器、能力形态定案） | infra/insight | [insight-local-analysis-v1.md](infra/insight-local-analysis-v1.md) |
| 019 | Insight 对话面板顶部标题栏 | 上游已实现 ✓ | ui/insight | [insight-conversation-header.md](ui/insight-conversation-header.md) |
| 020 | 聊天区排版产品化 — 现状取证 + 设计对接 | 现状取证阶段 | ui/insight | [reasoning-content-typography.md](ui/reasoning-content-typography.md) |
| 021 | insight 工具集收敛 + 权限交互 + extract_document 入口修正 | 已实现（外网，分支 `feat/insight-toolset-convergence`；人工验证清单见 spec §8） | infra/insight | [insight-toolset-convergence.md](infra/insight-toolset-convergence.md) |
| 022 | Insight 响应式布局适配（窄屏三栏 / 抽屉） | 草案（v2 已实现，外网，PR #369；未真机验证，待设计确认） | ui/insight | [insight-responsive-layout.md](ui/insight-responsive-layout.md) |
| 023 | Insight 输入框 `@` 引用面板 | 已实现（外网），待内网验证 | ui/insight | [insight-mention-at.md](ui/insight-mention-at.md) |
| 024 | 输入区草稿保留（per 会话分桶 · 跨模块通用） | v1 已实现（外网，UXAI 分支 `feat/composer-draft-per-session`；insight 已接入，make / pattern / studio 待接） | ui（跨模块） | [composer-draft.md](ui/composer-draft.md) |
| 025 | Insight question 工具答题 UI（对齐 Claude AskUserQuestion） | 草案（待实现） | ui/insight | [insight-question-dock.md](ui/insight-question-dock.md) |
| 026 | Insight 产物身份模型（身份 = 磁盘路径 · 命名/类型/去重单一来源） | 草案（入口卡三态已落地 UXAI PR #467，其余待实现） | infra/insight | [insight-artifact-identity.md](infra/insight-artifact-identity.md) |
| 027 | 会话排队 drain 运行器（UI 无关 · 跨模块通用） | 草案（待实现） | ui（跨模块） | [session-queue-runner.md](ui/session-queue-runner.md) |
| 028 | 会话工作目录声明对齐 — 修「skill 产物散落在选中目录根」：把模型看到的 `Working directory` 从选中目录改成会话产物目录，bash / read / write 三个通道的相对基准一并对齐；含产物子目录放开 | 草案（待实现） | infra/insight | [insight-workdir-declaration.md](infra/insight-workdir-declaration.md) |
| 029 | @技能激活的服务端事件上报（`extra.skills` → `skill.used`）— 补 023 §2.2 明确接受的「不发 SkillUsed 事件」那项代价 | 草案（待实现） | infra/insight | [insight-skill-activation-event.md](infra/insight-skill-activation-event.md) |

> **025 编号说明（2026-07-28）**：question 工具答题 UI 起草时取号 023，但同期 `@` 引用面板已用 023 落地并推送、`composer-draft` 已占 024。按下方 019 / 020 确立的"孤儿号改分配新号，不动已发布号"原则，未推送的这份改分配为 025。

> **019 / 020 编号说明（2026-07-11）**：这两份历史上分别误标成 009 / 010，与 [009](ui/insight-result-panel-reveal.md) / [010](ui/insight-standalone-extraction.md) 撞号。撞号排查发现后者才是被外部引用坐实的真号（前者零外部引用），按"孤儿号改分配新号，不动已发布号"处理，改分配为当时的下一个空闲号 019 / 020。001–018 未受影响。

---

## 未编号（历史遗留，非 insight 专属或早于编号习惯）

不属于 `SPEC-INS-NNN` 序列——要么不是 insight 专属（provider-config / task-card / multi-agent 等更早期的通用 octo-agent spec），要么是 insight 相关但建立于编号习惯之前，暂未回填。是否回填见 [ROADMAP.md](../../ROADMAP.md) 待办「ADR 体系梳理」项。

| 标题 | 状态 | 领域 | 文件 |
|---|---|---|---|
| chat 内网知识库检索工具（knowledge_search） | 上游已实现 ✗，自加原生工具 | agents | [chat-knowledge-search.md](agents/chat-knowledge-search.md) |
| MCP 接口合同 — UXR 服务团队交付物 | 唯一接口真相源 | agents | [mcp-contract.md](agents/mcp-contract.md) |
| `question` 工具 — skill 作者须知 | 对外交付（发给 skill 开发者；刻意不写 schema，理由见 §0） | agents | [question-tool-for-skills.md](agents/question-tool-for-skills.md) |
| 产物落盘 — skill 作者须知 | 对外交付（发给 skill 开发者；三条规则 + 自查清单，宿主侧机制见 SPEC-INS-028） | agents | [artifact-output-for-skills.md](agents/artifact-output-for-skills.md) |
| 文档解析结果 — skill 作者须知 | 对外交付（发给 skill 开发者；不自己解析 / 路径当参数接 / 别把行当段 / 容错，宿主侧机制见 SPEC-INS-016） | agents | [extracted-documents-for-skills.md](agents/extracted-documents-for-skills.md) |
| MCP 集成（重点：内网数据访问） | 草案 | agents | [mcp-integration.md](agents/mcp-integration.md) |
| 多 Agent 协作 | 草案 | agents | [multi-agent.md](agents/multi-agent.md) |
| Skill 系统 | 草案 | agents | [skill-system.md](agents/skill-system.md) |
| Agent 配置部署机制 | 实现真相源 | infra | [agent-config-deploy.md](infra/agent-config-deploy.md) |
| 构建与发布 | 待验收 | infra | [build-release.md](infra/build-release.md) |
| 开发环境搭建 | 已完成（Mode A ✅ / Mode B 🚧 待验收） | infra | [dev-environment.md](infra/dev-environment.md) |
| 文档视角迁移到 UXAI | 草案 | infra/docs | [docs-uxai-perspective-rewrite.md](infra/docs-uxai-perspective-rewrite.md) |
| 文件上传服务 | agent 项目自有上传能力 | infra | [file-upload.md](infra/file-upload.md) |
| 仓库结构改造 — 转为文档主线 + 实现归档 | 草案 | infra/repo | [repo-restructure-to-docs-only.md](infra/repo-restructure-to-docs-only.md) |
| 会话 agent 归属字段化 | 草案 | infra/session | [session-agent-attribution.md](infra/session-agent-attribution.md) |
| 打点接入规范（Tracker SDK + Mock Server） | 已落地（P1 完成） | infra | [tracking.md](infra/tracking.md) |
| 设计素材替换清单 | 持续维护清单 | ui | [design-assets-needed.md](ui/design-assets-needed.md) |
| InsightPage 提示词模板选择器 | 依据 ADR-007 / ADR-012 | ui/insight | [insight-analysis-mode.md](ui/insight-analysis-mode.md) |
| insight 图片附件（粘贴 / 剪贴板交互补充） | 已实现（随 SPEC-INS-015 A1） | ui/insight | [insight-image-attachment.md](ui/insight-image-attachment.md) |
| Markdown 卡全文编辑器（Vditor 全屏分屏） | 已立，P1 已落 UXAI | ui/insight | [insight-markdown-editor.md](ui/insight-markdown-editor.md) |
| InsightPage v2 — Spec 总览 | v2 总览 | ui/insight | [insight-overview.md](ui/insight-overview.md) |
| UI 风格刷新与基础组件落地 | 可执行 brief | ui | [octo-ui-redesign-brief.md](ui/octo-ui-redesign-brief.md) |
| OutputCard 渲染器与分发 | 渲染器实现唯一真相源 | ui | [output-renderers.md](ui/output-renderers.md) |
| 设置页：Provider 配置 | 草案 | ui | [provider-config.md](ui/provider-config.md) |
| 长任务卡片（对话流内） | 草案 | ui | [task-card.md](ui/task-card.md) |
| 任务面板（右侧产出过程区） | 历史草案，部分落地为 ResultViewer，方向不再推进 | ui | [task-panel.md](ui/task-panel.md) |
