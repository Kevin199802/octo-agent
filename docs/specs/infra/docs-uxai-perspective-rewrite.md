# 文档视角迁移到 UXAI — 按实际代码重写贴代码文档

> 状态:草案 · 优先级 P1 · 规模 [L] · 领域 infra/docs · 类型:文档重写
> 创建:2026-06-08
>
> **背景**:octo-agent 已转为 docs-only(代码归档,见 [repo-restructure spec](repo-restructure-to-docs-only.md))。
> 但 architecture / development / insight-debugging / handoff 等贴代码文档**仍是 octo-agent 本仓视角**
> (本仓路径、本地壳 §5.4 台账),与"服务 UXAI 开发"的定位错位。本 spec 规划:**按 UXAI 实际代码,
> 把这些文档重写成 UXAI 视角**。

---

## 1. 为什么必须读 UXAI 代码

准确的 UXAI 架构 / 开发流程 / 日志字典,必须对照 UXAI 实际代码(目录结构、壳组织、配置注入、
日志埋点)。在 octo-agent 仓没有 UXAI 代码,凭空写会编造不存在的结构。

**执行建议:在 UXAI workspace 做**(`/Users/huowenkai/Desktop/projects/UXAI`)——代码在手边,
`CLAUDE.uxai.md` 已就位(指向 octo-agent docs),读 UXAI 代码 + 写回 octo-agent docs。

## 2. UXAI 实际结构(已验证 2026-06-08)

| 维度 | UXAI 路径 |
|---|---|
| insight 页面 | `packages/app/octoapp/pages/insight/` |
| OctoShell | `packages/app/octoapp/pages/_shell/` |
| agent 配置 | `packages/opencode/src/agent/prompt/octo_insight.md`(+ `.txt`、`skills/octo_insight/` 私有扩展) |

> 注意:UXAI 有 `skills/octo_insight/` 等 octo-agent 没有的 fork 私有扩展,重写时以 UXAI 为准。

## 3. 范围(按优先级)

| 优先 | 文档 | 要做的 |
|---|---|---|
| 🔴 | `architecture.md` | 通读 UXAI insight 全栈,按 UXAI 路径 / 结构 / 数据流重写;§5.4 octo-agent 本地壳台账剥离(归档,或抽通用踩坑成 learning) |
| 🔴 | `development.md` | 写 UXAI 怎么跑 / 调 / 打包 insight(UXAI 壳),替换 octo-agent 本地壳流程 |
| 🔴 | `insight-debugging.md` | `[octo:*]` 日志字典逐条对照 UXAI 代码埋点(文件 / 字段)校准 |
| 🟡 | `intranet-handoff.md` | `window.api` 清单 / MCP / 上传接口对照 UXAI 实际壳与服务校准 |
| 🟡 | `integration.md` | 去掉失效的 §1/§2 代码合入 sync;与 handoff 去重(handoff=前端对接,integration=服务端实现);保留服务端 / 联调价值 |
| 🟡 | `specs/*` | 引用的代码路径 UXAI 化(`packages/app/src/pages/insight/` → `octoapp/pages/insight/`) |
| 🟢 | `adr/*`、`learning/*`、`collab-pr-protocol.md` | 基本仓库无关,不动(个别 adr 路径引用顺手修) |

## 4. 不在本 spec 范围

- 改 UXAI 代码(本 spec 只读 UXAI、写 octo-agent docs)
- octo-agent 已归档的实现历史(§5.4 等)——剥离即可,不必逐条搬

---

## 5. 执行提示

- 一篇一篇来(architecture 最大,可单独一轮),每篇:先通读对应 UXAI 代码 → 列重写要点 → 重写 → review 路径/事实
- 重写后更新 [ROADMAP.md](../../../ROADMAP.md):把对应项从"待办"移走
- octo-agent 路径 ↔ UXAI 路径映射见 [intranet-handoff.md §0](../../intranet-handoff.md)
