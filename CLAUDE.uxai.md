# CLAUDE.md — Octo Insight 开发（UXAI 本地）

## 文档真相源

设计文档(架构 / spec / ADR / learning)在 octo-agent 仓:
`/Users/huowenkai/Desktop/projects/octo-agent`(远端 <https://github.com/Kevin199802/octo-agent>)

读设计去其 `docs/`;spec / ADR / learning 的变更写回该仓提 PR。insight 代码改动在本仓(UXAI)提 PR。

## 提交

未经用户明确确认,不 `git commit` / `git push`;完成列变更等确认。

## 写 spec / 代码前

- 做 UI / 功能先 grep 上游 opencode(`packages/ui`、`packages/app`)有没有,有就复用
- 架构决策类(协议 / 接口 / 数据流 / 上传)先列 2–3 种业界做法对比再选;spec 顶标「上游已实现 ✓/✗」

## 实施原则

- 复用 `@opencode-ai/ui` 组件;不动上游核心(`packages/ui` `packages/opencode` `packages/sdk`)
- insight 页面自包含(样式 / 组件 / 工具不外散);可视化各自在页面目录引库
- Office 预览走 `window.api.openPath()`
- PromptInput 自实现 · 预置提示词单 turn · 对话内容永不替代(卡片是附加预览)
  细节见 octo-agent `docs/specs/ui/`

## 工作流

- spec 完成 / 变更后,更新 octo-agent `ROADMAP.md`
- 查 bug 先看 octo-agent `docs/insight-debugging.md`(`[octo:*]` 日志字典);改日志前缀 / 字段 / `octoDebug` 命令时同步它
- UI 遇占位 / 缺数据,记 octo-agent `docs/specs/ui/design-assets-needed.md`
- 沉淀踩坑 / 机制理解,写成 learning 笔记放 octo-agent `docs/learning/`

## 工作目录（UXAI）

- `packages/app/octoapp/pages/insight/` · `packages/app/octoapp/pages/_shell/`
- `packages/opencode/src/agent/prompt/octo_insight.md`(agent 配置)

## 参考（用到时查）

- 对接契约(MCP / 上传 / 桌面壳 `window.api`):octo-agent `docs/intranet-handoff.md`
- PR 协议:octo-agent `docs/collab-pr-protocol.md`
- 旧实现快照:octo-agent `archive/insight-impl-2026-06` 分支
