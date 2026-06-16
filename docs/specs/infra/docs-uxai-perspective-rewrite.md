# 文档视角迁移到 UXAI — 按实际代码重写贴代码文档

> 状态:草案 · 优先级 P1 · 规模 [L] · 领域 infra/docs · 类型:文档重写
> 创建:2026-06-08 · 清单细化:2026-06-13
>
> **背景**:octo-agent 已转为 docs-only(代码归档,见 [repo-restructure spec](repo-restructure-to-docs-only.md))。
> architecture / development / insight-debugging 等贴代码文档**仍是 octo-agent 本仓视角**(本仓路径、
> 本地壳台账、改动政策),与"服务 UXAI 开发"的定位错位。本 spec:**按 UXAI 实际代码,把这些文档
> 重写成 UXAI 视角 + 清理 docs-only 后失效的表述**。

---

## 1. 为什么必须读 UXAI 代码

准确的架构 / 开发流程 / 日志字典必须对照 UXAI 实际代码(目录、壳组织、配置注入、日志埋点)。
凭空写会编造不存在的结构。

**执行建议:在 UXAI workspace 做**(`/Users/huowenkai/projects/UXAI`)——代码在手边,
`CLAUDE.uxai.md` 已就位,读 UXAI 代码 + 写回 octo-agent docs(docs 改完直接 commit dev,无需 PR)。

## 2. UXAI 实际结构(已验证 2026-06-08)

| 维度 | UXAI 路径 |
|---|---|
| insight 页面 | `packages/app/octoapp/pages/insight/` |
| OctoShell | `packages/app/octoapp/pages/_shell/` |
| agent 配置 | `packages/opencode/src/agent/prompt/octo_insight.md`(+ `.txt`、`skills/octo_insight/` 私有扩展) |

## 2.1 路径区分原则（关键 — 决定哪些要改）

**只 UXAI 化「octo 自研路径」,opencode 上游路径两个 fork 完全相同,不动:**

| 类别 | 路径 | 处理 |
|---|---|---|
| octo 自研(页面 / 壳框架) | `packages/app/src/pages/insight\|_shell/` → `packages/app/octoapp/pages/…` | ✅ 改 |
| octo 自研(agent 配置) | `packages/agent/octo_insight/agents/octo_insight.md` → `packages/opencode/src/agent/prompt/octo_insight.md` | ✅ 改 |
| octo 本地壳 | `packages/desktop-electron/src/main/`(品牌/接线) | ⚠️ UXAI 壳自行组织,作参考(见 §3 architecture §5.4) |
| **opencode 上游** | `packages/opencode/src`、`packages/ui`、`desktop-electron/src/renderer\|preload` | ❌ **不改**(两 fork 相同) |

> 很多 learning 命中本仓路径数高,是因为讲 opencode **上游机制**(路径上游相同)——这些**不动**。

## 3. 文档清单（扫描量化 2026-06-13,数字=本仓路径引用数)

### 🔴 P0 — 读 UXAI 代码重写

| 文档 | 引用数 | 诉求 |
|---|---|---|
| `insight-debugging.md` | 70 | **最重**:`[octo:*]` 日志字典逐条对照 UXAI `octoapp/pages/insight/` 实际埋点(哪个文件、什么字段、正常 vs 异常)校准 |
| `architecture.md` | 49 | 全文 UXAI 化(§1 图、§2 包总览、§4 代码地图自研路径);**§2 改动政策表**本仓已无代码 → 改为"UXAI 自研边界"或剥离;**§2.4 上游同步 / §6 上游同步策略**删或重述;**§5.4 本地壳台账**剥离归档(或抽通用踩坑成 learning);清理"可运行 / 上次同步以代码为准"等失效表述 |
| `development.md` | 24 | UXAI 怎么跑 / 调 / 打包 insight(UXAI 壳),替换 octo-agent 本地壳流程 |

### 🟡 P1 — 路径 UXAI 化 + 内容核对

| 文档 | 引用数 | 诉求 |
|---|---|---|
| `specs/ui/insight-component-audit.md` | 31 | 组件审计,大量自研路径 → UXAI 化 + 对照现状核对 |
| `specs/ui/insight-data-layer-reuse.md` | 20 | 数据层路径 UXAI 化;对照 UXAI 现状(白屏修复后)核对 |
| `specs/infra/agent-config-deploy.md` | 20 | agent 部署路径 UXAI 化(`octo_insight` 源路径) |
| `specs/ui/*`(standalone-extraction 13 / result-panel-reveal 12 / task-card 9 / prompt-redesign 9 / design-assets-needed 9 / output-renderers 8 / 其余) | — | 自研路径 UXAI 化;描述实现处对照 UXAI 核对;**设计意图层保留** |
| `intranet-handoff.md` | 2 | **存废评估**:window.api 清单 / MCP / 上传——核对与 architecture(壳)/ mcp-contract / file-upload 的重叠;有价值内容迁到 SOT 后,handoff 瘦身成"对接索引"或直接删 |
| `integration.md` | 8 | **存废评估**:服务端 FastAPI 示例 + 联调步骤迁到 mcp-contract / file-upload 后删;sync 部分(§1/§2)直接去。被 [mcp-api-integration](../../learning/mcp-api-integration.md) 引用,删前改引用 |

> **仓库精简原则**:借此轮逐文档判断现役价值——sync 时代产物 / 已被 SOT 覆盖的冗余文档,迁移有价值内容后**删**(归档已在 tag + 分支,dev 只留现役要用的)。

### 🟢 P2 — 顺手 / 基本不动

| 文档 | 处理 |
|---|---|
| `learning/opencode-internals\|db-and-storage\|agent-mental-model\|provider-protocols\|tools-and-permissions\|skill-and-mcp\|opencode-ui-composition` | 讲 opencode **上游机制**,路径=上游 → **不改** |
| `learning/agent-deploy.md`(11)、`per-call-system-prompt.md`(6) | 含 octo 自研部署路径 → 顺手 UXAI 化 |
| `learning/uxai-*`、`client-event-routing-by-directory`、`plugin-hooks-url-injection`、`rag-chat-integration`、`session-category-*` | 多为近期 UXAI debug 写回,大概率已 UXAI 视角 → 核对即可 |
| `adr/*` | 决策理由仓库无关,主体不动;个别代码路径引用(004/008/007/001/002)顺手 UXAI 化 |
| `collab-pr-protocol.md` | 已是 docs 仓 PR 协议;若全面落实"无需 PR",可顺手精简 PR 流程相关段 |

## 4. 失效表述清理（docs-only 后过时,小改)

扫描命中,随重写顺手清理:
- `architecture.md`:可运行 / 上游同步策略 / 改动政策(本仓无代码)
- `adr/004-solidjs-ui-reuse.md`:"合入内网零冲突 / 上游一行不动"
- `specs/ui/insight-standalone-extraction.md`、`specs/infra/session-agent-attribution.md`、`learning/uxai-app-entry-routing.md`:"合入内网 / reference impl / 外网→"
- `specs/ui/reasoning-content-typography.md`、`insight-result-panel-reveal.md`:"不动上游 / 自由改"表述

> `repo-restructure-to-docs-only.md` 是**历史决策记录**(讲的就是这个转型过程),**不动**。

## 5. 不在本 spec 范围

- 改 UXAI 代码(本 spec 只读 UXAI、写 octo-agent docs)
- octo-agent 已归档的实现历史(§5.4 等)——剥离即可,不必逐条搬

## 6. 执行提示

- **一篇一篇来**(P0 三篇各可单独一轮;insight-debugging 最重,architecture 次之)。每篇:通读对应 UXAI 代码 → 列重写要点 → 重写 → review 路径/事实
- 改完直接 commit dev(无需 PR);更新 [ROADMAP.md](../../../ROADMAP.md) 把对应项移出待办
- 路径映射见 [intranet-handoff.md §0](../../intranet-handoff.md)
