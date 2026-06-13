# Roadmap — octo-insight 文档维护

> 本仓是 insight 设计文档库,本 ROADMAP 跟踪**文档维护**任务。
> insight 的功能 / 代码开发计划在 UXAI 仓。

**规模标签**:`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天

---

## 待办

| 规模 | 任务 | 说明 |
|---|---|---|
| `[M]` | **chat 接内网知识库 RAG** | spec [chat-knowledge-search](docs/specs/agents/chat-knowledge-search.md) + learning [rag-chat-integration](docs/learning/rag-chat-integration.md)/[rag-mental-model](docs/learning/rag-mental-model.md)。**V1 代码已落 UXAI**(knowledge_search 工具 + registry 网关 octo_ai + octo_ai prompt + base_url 桥 + mock,typecheck 通过、未 commit)。**待**:真机 chat 验证、引用角标/参考卡片 UI(后续迭代)、真实 account 的 session 注入(后续) |
| `[L]` | **文档视角迁移到 UXAI** | architecture / development / 各 spec / ADR 里的代码路径、开发流程逐篇调成 UXAI 视角(路径映射见 [handoff §0](docs/intranet-handoff.md)),让文档直接服务 UXAI 开发,而非要求读者心算映射。执行清单见 [spec docs-uxai-perspective-rewrite](docs/specs/infra/docs-uxai-perspective-rewrite.md)。**进度**:✅ architecture.md(全文 UXAI 化 + 删本地壳台账 §5.4);⬜ insight-debugging / development / 各 spec / ADR |
| `[M]` | **learning 笔记补全** | SQLite / Drizzle / Effect / Solid 响应式 / IPC / SDK 生成机制等,沉淀给未来 |
| `[S]` | **ADR 体系梳理** | 已落地但未立 ADR 的决策补全(session.agent 字段化、useProjectDir 全栈抽象等);交叉引用清理 |
| `[S]` | **specs 现役 / 历史分层** | 运行一段时间后看是否需要按"现役 / 历史"分子目录 |

---

## 设计演进(归档前在 octo-agent 落地的实现里程碑)

> insight 从 0 到 1 的实现历程,代码在 `archive/insight-impl-2026-06`,保留作设计参考。

- **架构基座**:Electron 渲染入口、OctoShell 框架层(sidebar + topbar)、SolidJS 复用上游 UI([ADR-004](docs/adr/004-solidjs-ui-reuse.md))、cascading 配置([ADR-008](docs/adr/008-cascading-config.md))
- **insight 页面**:InsightPage 骨架(DataStore + SSE + PromptInput)、3 栏布局、AttachmentBar 附件上传、InsightTurn + OutputCard 卡片、ResultViewer Tab 结果查看器
- **渲染器**:detectCard、Mindmap(markmap)、Html(iframe sandbox)、Table(Excel 导出)、resource_link 路由
- **agent / 数据**:octo_insight agent 配置 + 注册、Session.agent 字段化(修侧栏归属,见 [spec](docs/specs/infra/session-agent-attribution.md))、提示词模板、任务卡片(长任务状态机,[ADR-013](docs/adr/013-long-task-progress-strategy.md))、debug-observer(`[octo:event]` + `window.octoDebug`)、S3 URL 无损传 MCP(handle + `octo-upload-inject` 插件,[ADR-014](docs/adr/014-url-injection-via-plugin.md))
