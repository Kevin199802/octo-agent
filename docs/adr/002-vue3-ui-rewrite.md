# ADR-002: UI 框架选型 — Vue3 重写（替换 SolidJS）

## 状态

已弃用（2026-04-30）。被 [ADR-004](004-solidjs-ui-reuse.md) 取代。

弃用理由概述:本 ADR 隐含前提为 "UI = 聊天框 + 几个表单",1-2 周可重写。Phase 1 推进后发现 UI 真实边界是 IDE 级界面（思维链流式 / 工具结果流 / 各类 dialog / 文件树 / 权限授权…），自做并打磨到产品级需 20-30 个工作日 + 持续无限期投入,而上游 SolidJS 组件已成品。继续 Vue 自研性价比过低,改回 SolidJS 并复用上游 UI。详见 ADR-004。

---

> 以下为原决策记录,保留作为历史。

## 原状态
已采纳（2026-04-17）

## 背景

上游 opencode 的 UI（`packages/app`、`packages/ui`）使用 SolidJS。  
Octo Agent 需要完全重写 UI 以支持用研业务流程，并由多人并行开发多个 agent 子包的 UI 模块。

## 决策

使用 **Vue3 + TypeScript + Vite + Pinia + Vue Router** 新建 `packages/octo-ui`，完全放弃 SolidJS。

## 理由

- 团队已有 Vue3 经验，SolidJS 学习成本不值得投入
- Vue3 + Vite + electron-vite 工具链成熟，文档完善
- Pinia 状态管理与多 agent 架构的异步流模型契合
- 不引用 `packages/app` 或 `packages/ui` 中任何 SolidJS 组件

## 后果

- `packages/app`、`packages/ui` 保留在仓库中（上游代码），Octo 项目不引用
- Octo UI 组件库从零开始，不存在 SolidJS 到 Vue3 的迁移负担
