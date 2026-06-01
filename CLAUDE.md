# CLAUDE.md — Octo Agent

## 提交规则（强制）

**未经用户明确确认，禁止执行任何 `git commit` 或 `git push`。**

完成任务后列出变更文件并等待确认，不得以任何理由自行提交。

---

## 规划 spec / 写代码前的强制检查（强制）

任何"做 UI / 做功能"的 spec 在动笔前**必须先排查上游 opencode 是否已实现**：

1. 在 `packages/ui/src/components/` 和 `packages/app/src/components/` `packages/app/src/pages/` 用 grep 搜关键词
2. 如果**已经有了**：spec 只规划"Octo 定制"部分，绝对不重复造轮子
3. spec 顶部必须有"上游已实现:✓/✗"标注

---

## 架构决策类 spec 的强制检查（强制）

涉及"协议选择 / 接口形态 / 数据流向 / 上传下载"等架构决策时，spec 落笔前必须：

1. **列 2-3 种业界常见做法做对比**（参考 AWS、阿里云、Stripe 等大型云服务），再选方案
2. 对"看起来能跑"的方案要警惕，多问"为什么没人这么做"
3. spec 写完后专门 review 一次，假设自己第一次看到这个方案

**反例（曾发生的返工）**：base64 文件走 MCP 上传 / 让 LLM 把 JSON 转 mermaid / 设计 batch_xxx 工具替代 xxx(items[])。

---

## 工作目录

**我们在 `packages/app/` 里加页面**。

| 路径 | 说明 |
|---|---|
| `packages/app/src/pages/insight/` | 用研 Agent 页面（合入物）|
| `packages/agent/insight/agents/` | opencode agent 配置文件（合入物）|
| `packages/app/src/pages/_shell/` | OctoShell 框架层 |
| `packages/app/src/app.tsx` | OctoShell 路由分叉（限改） |

其他 agent 各自在 `packages/app/src/pages/<name>/` 建立相同结构。

---

## 改动政策

| 范围 | 政策 |
|---|---|
| `packages/app/src/pages/insight/`、`packages/app/src/pages/_shell/`、`packages/agent/insight/`、`docs/` | **自由改**（合入物） |
| `packages/app/src/app.tsx` | **限改**：仅 OctoShell 路由分叉所需，内网同步 |
| `packages/app/` 其他文件、`packages/ui/`、`packages/opencode/`、`packages/sdk/` | **不动**：改了跟上游 diff 会乱 |
| `packages/desktop-electron/src/main/`、`electron.vite.config.ts` 等接线文件 | **限改**：仅品牌、接线、调试 |
| 其他 `packages/*` | 不动也不删 |

---

## 非业务包变更登记（强制）

**除以上"自由改"范围外，任何文件改动（构建配置、根 package.json、bun.lock、接线文件等）必须立即在 `docs/architecture.md §5.4` 补充一条记录**，说明改了什么、为什么改。

---

## 内网集成手册维护

`docs/intranet-handoff.md` 是给内网集成者的对外操作手册。**里程碑前或对外契约变化时** review + 更新，平时不需要每次改动同步（diff/rsync 自然带过去）。

**强制同步触发点**：改 `packages/app/src/pages/*/lib/electron-api.ts` 的 `DesktopApi` 类型（新增 / 删除 / 改签名 `window.api` 方法）时，**同步更新** [intranet-handoff.md §1.6](docs/intranet-handoff.md) 桌面壳 API 依赖清单——避免内网壳缺方法导致按钮失效。

---

## 设计素材清单（强制）

UI 开发中遇到 SVG 占位 / 插图近似替代 / 真实数据缺失等情况，立即在 [docs/specs/ui/design-assets-needed.md](docs/specs/ui/design-assets-needed.md) 追加记录。**目的**：给设计师一张可交付清单。

---

## 实施原则

- **复用零件**：`@opencode-ai/ui` 的组件 import，不重写
- **页面自包含**：`insight/` 内的样式/组件/工具不外散
- **可视化各自引库**：ECharts/mermaid 等在用到的页面目录内引入
- **Office 预览**：`window.api.openPath(filePath)` 唤起本地应用，不浏览器渲染
- **PromptInput 自实现**：见 [SPEC-INS-005 §7](docs/specs/ui/insight-data-layer-reuse.md#7-输入区评估保留自实现--理由更新)
- **预置提示词单 turn，不走 session system 字段**：见 [SPEC-INS-007](docs/specs/ui/insight-prompt-redesign.md)
- **对话内容永不替代，卡片是附加预览入口**：见 [output-renderers.md §0](docs/specs/ui/output-renderers.md#0-核心原则对话内容永不替代卡片是附加预览入口)

---

## 架构决策（ADR）

完整 ADR 列表见 [docs/adr/](docs/adr/)。
