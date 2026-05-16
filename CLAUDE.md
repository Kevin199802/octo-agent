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

**反例（曾发生的返工）**：base64 文件走 MCP 上传 / 让 LLM 把 JSON 转 mermaid / 设计 batch_xxx 工具替代 xxx(items[])。这些 spec 都是写完后才被打断质疑、然后大幅重写的。

---

## 工作目录

**我们在 `packages/app/` 里加页面**，与内网的 `packages/app/` 保持相同目录结构，便于按图索骥对接。

| 路径 | 说明 |
|---|---|
| `packages/app/src/pages/insight/` | 用研 Agent 页面（**合入物**，对应内网同路径） |
| `packages/agent/research/agents/` | opencode agent 配置文件（**合入物**，部署至 `~/.config/octo/agent/`） |
| `packages/app/src/pages/_shell/` | OctoShell 框架层：sidebar + topbar |
| `packages/app/src/app.tsx` | OctoShell 路由分叉（限改） |

其他 agent 各自在 `packages/app/src/pages/<name>/` 建立相同结构。

---

## 改动政策

| 范围 | 政策 |
|---|---|
| `packages/app/src/pages/insight/`、`packages/app/src/pages/_shell/`、`packages/agent/research/`、`docs/` | **自由改**（合入物） |
| `packages/app/src/app.tsx` | **限改**：仅 OctoShell 路由分叉所需，内网同步 |
| `packages/app/` 其他文件、`packages/ui/`、`packages/opencode/`、`packages/sdk/` | **不动**：改了跟上游 diff 会乱 |
| `packages/desktop-electron/src/main/`、`electron.vite.config.ts` 等接线文件 | **限改**：仅品牌、接线、调试 |
| 其他 `packages/*` | 不动也不删 |

---

## 非业务包变更登记（强制）

**除以上"自由改"范围外，任何文件改动（包括但不限于构建配置、根 package.json、bun.lock、接线文件等）必须立即在 `docs/architecture.md §5.4` 补充一条记录**，说明改了什么、为什么改。

**不允许**：改完就跑，让架构文档跟代码漂移。  
**目的**：AI 频繁操作时留下可追溯的变更日志，替代人工巡查。

---

## 内网集成手册维护

`docs/intranet-handoff.md` 是给内网集成者（人或 AI）的对外操作手册。

**不需要每次改动立即同步**。代码 / 依赖 / 新增文件等改动 rsync/diff 自然能带过去，handoff 不重复登记。

在两个时机 review + 更新即可：
- 准备通知内网"可以合入"的里程碑前
- 合入物**对外契约**明显变化时（如 `insight.md` frontmatter 字段约定调整、合入物目录结构变化）

**目的**：降低单次 commit 的文档维护负担，避免和 §5.4 形成双写。

---

## 设计素材清单（强制）

**UI 开发过程中，凡遇到以下情况，须立即在 [`docs/specs/ui/design-assets-needed.md`](docs/specs/ui/design-assets-needed.md) 对应区块追加记录**：

- 图标用自绘 SVG 占位（无设计师提供的精确切图）
- 插图、空状态图、品牌图形等用代码近似替代
- 头像、用户信息等需要真实数据或组件替换

**不允许**：开发完跳过不记，让清单与代码脱节。  
**目的**：给设计师一张完整的"待交付"清单，确保切图后能快速定位替换位置。

---

## 实施原则

- **复用零件**：思维链 / 工具流 / markdown / 各 dialog 等 import `@opencode-ai/ui` 的组件，**绝不重写**
- **页面自包含**：`insight/` 目录内的样式、组件、工具函数全部放在目录内，不往外散
- **可视化各自引库**：ECharts / mermaid 等在用到的页面目录内引入，不抽共享组件
- **Office 预览**：`window.api.openPath(filePath)` 唤起本地应用，不做浏览器内渲染
- **PromptInput 自己写**：上游 PromptInput 深耦合 packages/app context，在 `insight/` 内写简化版

---

## 架构决策(ADR)

- ADR-001 — Electron vs Tauri → [docs/adr/001-electron-vs-tauri.md](docs/adr/001-electron-vs-tauri.md)
- ADR-002 — Vue 3 替换 SolidJS → [docs/adr/002-vue3-ui-rewrite.md](docs/adr/002-vue3-ui-reuse.md) **(已弃用)**
- ADR-003 — LLM Provider 接入 → [docs/adr/003-openai-compat-provider.md](docs/adr/003-openai-compat-provider.md)
- ADR-004 — 切回 SolidJS → [docs/adr/004-solidjs-ui-reuse.md](docs/adr/004-solidjs-ui-reuse.md)
- ADR-005 — 提示词模板 vs Subagent → [docs/adr/005-prompt-template-vs-subagent.md](docs/adr/005-prompt-template-vs-subagent.md)
- ADR-006 — 文件上传走 InsightPage 直传，不经过 MCP → [docs/adr/006-upload-architecture.md](docs/adr/006-upload-architecture.md)
- ADR-007 — 提示词模板通过 session.prompt() 的 system 字段传递 → [docs/adr/007-prompt-template-via-system-field.md](docs/adr/007-prompt-template-via-system-field.md)
- ADR-008 — Agent 配置走 cascading 模式（A 类 bundle 内写死，B/C 类用户文件）→ [docs/adr/008-cascading-config.md](docs/adr/008-cascading-config.md)
- ADR-009 — 不在客户端预览 Office 文件（docx/pptx/xlsx）→ [docs/adr/009-no-office-preview.md](docs/adr/009-no-office-preview.md)
