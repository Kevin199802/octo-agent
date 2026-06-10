# learning/ — 深度学习文档

跟 architecture / development / specs / adr 的区别:

| 目录 | 回答的问题 | 风格 |
|---|---|---|
| `architecture.md` | 我们的系统**长什么样** | 精炼、当前事实、给同事快速对齐 |
| `development.md` | 我**怎么操作**(命令、调试、打包) | 操作手册,粘命令就用 |
| `specs/` | 某个功能**要做成什么样**(验收标准) | 一项一规格,可勾选 |
| `adr/` | 某个决策**为什么这么选** | 一项一记录,不可变 |
| **`learning/`** | **某个事物内部到底怎么运作的** | **深度解释,允许长,带例子,允许冗余** |

learning 文档面向"对该领域不熟悉、想完整理解原理"的读者。可以反复读、可以跳读,内容做到足够详尽。

## 目录

按从基础到进阶顺序读:

1. [opencode-internals.md](opencode-internals.md) — opencode 后端工作原理:HTTP 路由、SSE 事件、Part 类型、SQLite 表、Provider 接入
2. [agent-mental-model.md](agent-mental-model.md) — Agent 是什么、agent loop、primary vs subagent、多 agent 三种模式
3. [skill-and-mcp.md](skill-and-mcp.md) — Skill 与 MCP 区别与联系、MCP 三种传输、Skill 包结构、安全模型
4. [provider-protocols.md](provider-protocols.md) — Anthropic / OpenAI / Google 协议差异、thinking/reasoning 怎么传、国内网关兼容性
5. [context-and-memory.md](context-and-memory.md) — 上下文压缩、`AGENTS.md` 项目记忆、共享记忆设计
6. [opencode-agent-system.md](opencode-agent-system.md) — Agent 配置 schema、加载流程、Tools/Skills/MCP 关系、前端切换机制 **(M2 必读)**
7. [opencode-ui-composition.md](opencode-ui-composition.md) — `@opencode-ai/ui` vs `@opencode-ai/app` 角色、Provider 体系、形态 B 实施细节 **(M2 必读)**
8. [tools-and-permissions.md](tools-and-permissions.md) — 内置工具清单（11 个）、MCP 工具接入、agent 工具白名单配置、权限规则（allow/ask/deny）
9. [agent-deploy.md](agent-deploy.md) — 注册 vs 不注册的区别、config 版本化写入机制、Electron 打包后用户侧如何自带配置
10. [mcp-api-integration.md](mcp-api-integration.md) — 内网 API 对接 MCP 的完整方案（路径 C）：UXR 服务加 /mcp 路由的实现、联调验证流程
11. [opencode-db-and-storage.md](opencode-db-and-storage.md) — opencode 数据持久化全貌:SQLite 事务 / WAL / Drizzle schema-as-code / migration journal + snapshot.json / channel-aware DB / JsonMigration / storage + snapshot + tool-output 三兄弟,与 Rails/Prisma/Django/Flyway 对比
12. [client-event-routing-by-directory.md](client-event-routing-by-directory.md) — 前端按目录分发实时事件:globalSync + per-directory child store / directory·worktree·project 三层模型 / `event.directory` = worktree 根 /「页面数据层目录 vs 事件投递目录」错位导致白屏(Insight 锚点案例)/ 排查方法论 + octoapp 自有 context 大坑
13. [plugin-hooks-url-injection.md](plugin-hooks-url-injection.md) — opencode 插件系统:`Plugin` 函数 / `INTERNAL_PLUGINS` vs config 插件 / `tool.execute.before` 钩子在哪触发(MCP 也触发)/「就地改写 output.args」契约 / 用插件把精确 S3 URL 注入 MCP 工具(handle 机制)/ 踩坑:MCP 工具名带 `uxr-tool_` 前缀、字段名 `download_links`、插件日志在 server 进程

> 后续可能补:
>
> - `electron-vite-build.md` — main/preload/renderer 三段构建模型(暂不重要)
> - `effect-ts-primer.md` — opencode 用 Effect.js,看源码会遇到
