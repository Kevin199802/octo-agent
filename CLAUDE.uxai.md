# CLAUDE.md — Octo Insight 开发（UXAI 本地）

## 文档仓

设计文档(architecture / spec / ADR / learning / handoff)的真相源在 **octo-agent 仓**:
`/Users/huowenkai/Desktop/projects/octo-agent`(下文 `docs/…`、`ROADMAP.md` 等均指此仓)。

- 读 / 写文档都在文档仓;改完**直接 commit,无需开 PR**;**不在 UXAI 提交设计文档(.md)**
- UXAI 仓只提交 insight 代码

## 提交

未经用户确认,不 `git commit` / `git push` / 提 PR;完成后列变更等确认。

## 写 spec / 代码前

- 做 UI / 功能先 grep 上游 opencode(`packages/ui`、`packages/app`)有没有,有就复用
- 架构决策类(协议 / 接口 / 数据流 / 上传)先列 2–3 种业界做法对比再选;spec 顶标「上游已实现 ✓/✗」

## 实施原则

- 复用 `@opencode-ai/ui` 组件;不动上游核心(`packages/ui` `packages/opencode` `packages/sdk`)
- insight 页面自包含(样式 / 组件 / 工具不外散);可视化各自在页面目录引库
- Office 预览走 `window.api.openPath()`
- PromptInput 自实现 · 预置提示词单 turn · 对话内容永不替代(卡片是附加预览),细节见 `docs/specs/ui/`

## 工作流

- spec 完成 / 变更后,更新 `ROADMAP.md`
- 查 bug 先看 `docs/insight-debugging.md`(`[octo:*]` 日志字典);改日志前缀 / 字段 / `octoDebug` 命令时同步它
- UI 遇占位 / 缺数据,记 `docs/specs/ui/design-assets-needed.md`
- 沉淀踩坑 / 机制理解,写 learning 笔记放 `docs/learning/`

## 工作目录（UXAI 代码）

- `packages/app/octoapp/pages/insight/` · `packages/app/octoapp/pages/_shell/`
- `packages/opencode/src/agent/prompt/octo_insight.md`(agent 配置)

## 参考（用到时查）

- 对接契约(MCP / 上传 / `window.api`):`docs/intranet-handoff.md`
- PR 协议:`docs/collab-pr-protocol.md`
- 旧实现快照:`archive/insight-impl-2026-06` 分支
