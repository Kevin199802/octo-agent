# octoAI / octo-agent

> 本仓是 **octo-insight 的设计文档库**,服务于在内网 UXAI 仓
> (<https://github.com/MyHeavenDyf/UXAI>)开发 insight。架构、specs、ADR、learning、
> 集成手册都在 `docs/`——这里是 insight 的设计真相源。

## 文档入口

- [架构](docs/architecture.md) · [Specs 登记表](docs/specs/README.md) · [ADR](docs/adr/) · [Learning 笔记](docs/learning/)
- [内网集成手册](docs/intranet-handoff.md) · [PR 协作协议](docs/collab-pr-protocol.md) · [工作规则](CLAUDE.md) · [ROADMAP](ROADMAP.md)

## 参考旧实现

需要查 2026-06-06 之前 octo-agent 作为独立实现仓的代码时,checkout `archive/insight-impl-2026-06`
分支(亦有 `v1-insight-impl-archive` tag)。本仓从代码仓转为文档库的背景见
[repo-restructure spec](docs/specs/infra/repo-restructure-to-docs-only.md)。

insight 从 0 到 1 的实现里程碑(设计参考,代码即上述归档分支):

- **架构基座**:Electron 渲染入口、OctoShell 框架层(sidebar + topbar)、SolidJS 复用上游 UI([ADR-004](docs/adr/004-solidjs-ui-reuse.md))、cascading 配置([ADR-008](docs/adr/008-cascading-config.md))
- **insight 页面**:InsightPage 骨架(DataStore + SSE + PromptInput)、3 栏布局、AttachmentBar 附件上传、InsightTurn + OutputCard 卡片、ResultViewer Tab 结果查看器
- **渲染器**:detectCard、Mindmap(markmap)、Html(iframe sandbox)、Table(Excel 导出)、resource_link 路由
- **agent / 数据**:octo_insight agent 配置 + 注册、Session.agent 字段化(修侧栏归属,见 [spec](docs/specs/infra/session-agent-attribution.md))、提示词模板、任务卡片(长任务状态机,[ADR-013](docs/adr/013-long-task-progress-strategy.md))、debug-observer(`[octo:event]` + `window.octoDebug`)、S3 URL 无损传 MCP(handle + `octo-upload-inject` 插件,[ADR-014](docs/adr/014-url-injection-via-plugin.md))

UXAI 侧持续的版本改动记录(0.6.0 起)在 [docs/releases/](docs/releases/),与上面的一次性里程碑史料是两回事:那边按版本号追踪 ongoing commit,这里是 archive 前的一次性建成记录。

## License

[MIT](LICENSE)
