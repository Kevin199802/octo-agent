# Roadmap — octo-insight 文档维护

> 本仓是 insight 设计文档库,本 ROADMAP 跟踪**文档维护**任务。
> insight 的功能 / 代码开发计划在 UXAI 仓。

**规模标签**:`[S]` < 半天　`[M]` 1–2 天　`[L]` 3–5 天

---

## 待办

| 规模 | 任务 | 说明 |
|---|---|---|
| `[S]` | **弱模型工具意图识别评测** | 预置文案 2026-06-15 去掉明示工具名后(SPEC-INS-007 §3.1.2),"选对 tool"压在弱模型 + 提示词上。按 [SPEC-INS-007 §11](docs/specs/ui/insight-prompt-redesign.md) 做 `expectedTool` 对账评测(按钮命中率 ≥95%、自由输入 ≥85%),不达标按 §11.3 升级阶梯回退。区分"选错工具"与"文件拆桶错"两类错误。**待**:内网真机评测数据 |
| `[M]` | **chat 接内网知识库 RAG** | spec [chat-knowledge-search](docs/specs/agents/chat-knowledge-search.md) + learning [rag-chat-integration](docs/learning/rag-chat-integration.md)/[rag-mental-model](docs/learning/rag-mental-model.md)。**V1 代码已落 UXAI**(knowledge_search 工具 + registry 网关 octo_ai + octo_ai prompt + base_url 桥 + mock,typecheck 通过、未 commit)。**待**:真机 chat 验证、引用角标/参考卡片 UI(后续迭代)、真实 account 的 session 注入(后续) |
| `[L]` | **文档视角迁移到 UXAI** | architecture / development / 各 spec / ADR 里的代码路径、开发流程逐篇调成 UXAI 视角(路径映射见 [handoff §0](docs/intranet-handoff.md)),让文档直接服务 UXAI 开发,而非要求读者心算映射。执行清单见 [spec docs-uxai-perspective-rewrite](docs/specs/infra/docs-uxai-perspective-rewrite.md)。**进度**:✅ architecture.md(全文 UXAI 化 + 删本地壳台账 §5.4);⬜ insight-debugging / development / 各 spec / ADR |
| ✅ `[S]` | **markdown 卡编辑 spec(已落)** | [insight-markdown-editor.md](docs/specs/ui/insight-markdown-editor.md) 已立:**Vditor**(Arya 同款) `sv` 全屏左右分屏、自动保存(防抖)落盘本地 projectdir 文件(跟随 useProjectDir,不走 MCP;云端回写后续走 API)、新增 `writeFile` IPC、Vditor 资源本地化。**P1 实现已落 UXAI**(分支 `feat/insight-markdown-editor`:writeFile IPC + Vditor 接入/资源本地化 + 全屏 overlay + 自动保存/还原 + 主题跟随;typecheck/build/单测过,**断网资源验证 §8E 待内网真机**)。P2(模式偏好持久化 / Cmd+S flush 已附带)。背景:[output-renderers §2.5.2](docs/specs/ui/output-renderers.md) markdown 卡 + docx→md([mcp-contract](docs/specs/agents/mcp-contract.md)) |
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
