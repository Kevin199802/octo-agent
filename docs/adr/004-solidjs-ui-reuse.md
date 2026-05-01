# ADR-004: 形态 B — Octo 自写工作台壳 + 复用 `@opencode-ai/ui` 零件

## 状态

已采纳并生效(2026-04-30 决策、2026-05-01 多次修订定型)。取代 [ADR-002](002-vue3-ui-rewrite.md)。

## 背景

ADR-002(Vue 3 重写)的隐含前提是 "UI = 聊天框 + 几个表单",1-2 周可重写。Phase 1 推进后两件事改变了前提:

1. **UI 真实边界 ≈ IDE 级**:聊天 + 思维链流式 + 工具结果流(read/edit/write/bash/diff/glob/grep/patch) + Provider 配置对话框 + Model 选择 + MCP 配置 + Permission 授权 + Agent 切换 + 文件树 + Session 压缩可视化 + i18n。每个细节都需"反复打磨"才不粗糙(Vue 自写思维链已踩过一下午折腾的坑)
2. **代码要合入内网**:多团队并行开发上游目录,Octo 端直接改上游会产生 git merge 冲突,review 时无法分辨"哪行是 Octo 的、哪行是上游的"

ADR-004 经历了两次方向调整:
- **第一版**(已废弃):Octo 自写组合 `@opencode-ai/ui` primitives,工作量数周
- **第二版**(已废弃):octo-app 挂载 `@opencode-ai/app` 的 `<AppInterface>` 整体复用 IDE。问题:用户驳回——"用户都要用高级模式了为什么不直接装 opencode";Octo 必须有自己独立产品价值
- **第三版(本版)**:形态 B,Octo 自写工作台顶层壳 + 复用 `@opencode-ai/ui` 零件

## 决策

### 1. 产品定位:Octo = 企业内部 AI 工作台,不是 opencode 换皮

类比:**Octo : opencode = Cursor : VSCode**。

Octo 独立价值:
| 维度 | Octo 提供 | 直接装 opencode 没有 |
|---|---|---|
| 预配置 agent 集 | 用研 / 综合 / 报告 / 编码 4 个 agent 开箱即用 | 用户要自己写 agent 配置 |
| 内网集成 | 内网 LLM provider 预配置、内网 MCP 预连、企业元数据 | 用户要自己接 |
| 业务沉淀 | 技能库 / 资产库 / 历史报告作为公司知识资产 | 个人工具,无组织维度 |
| 企业品牌 + 部署 | 应用名 / 图标 / 主题 / 内网安装包 / 统一登录 | 社区版 |
| 业务专属交互 | sidebar 直接列 "用研助手 / 综合助手 / ..." 一点即用 | 默认 sidebar 是 session 列表,业务用户难懂 |

**面向用户**:不懂 opencode 的业务用户(用研、产品、综合等),不是开发者。

### 2. 渲染入口归 `packages/octo-app/`(SolidJS)

替代弃用的 `packages/octo-ui/`(Vue,已删除)。electron-vite 的 `renderer.root` 指向它。

### 3. UI 复用边界

经过对上游源码的事实考察(详见 [docs/learning/opencode-ui-composition.md](../learning/opencode-ui-composition.md)):

| 上游包 | 复用方式 |
|---|---|
| `@opencode-ai/ui` | **零件库,大量复用**。`SessionTurn` / `MessagePart` / `Markdown` / `TextShimmer` / 各基础元件直接 import,只依赖它内部 5 个轻量 context |
| `@opencode-ai/app` | **少量复用**。`AppBaseProviders`(基础 provider 栈) + `dialog-manage-models` 等独立 dialog 可挂;`PromptInput` / `Layout` / `Sidebar` / IDE 路由壳**不复用**,因为深度耦合 packages/app 全局 context |
| `@opencode-ai/sdk` | **必复用**。OpencodeClient |
| `packages/opencode/` | **后端引擎,必复用** |

### 4. Octo 自己写的部分

- `<OctoWorkbench>` 顶层路由 + 布局壳
- `<OctoSidebar>` 设计稿移植(agent 列表 / 项目 / 历史 / 设置)
- `<OctoDataProvider>` 把 OpencodeClient 数据塞进 `@opencode-ai/ui` 的 `DataProvider`(REST 权威 + SSE 体验)
- `<OctoPromptInput>` 简化版(textarea + 文件附件 + 提交)
- `<AgentSession>` 业务页面(组合 SessionTurn 等)
- Octo 业务页面(技能库 / 资产库 / 项目设置)
- `octo-theme.css` Octo 品牌色 / 字体 / 间距 token 覆盖

### 5. 上游核心包 — **一行不动**

完整冻结:
- `packages/opencode/` `packages/sdk/`(后端 + SDK)
- `packages/ui/` `packages/app/`(SolidJS UI)
- `packages/desktop-electron/src/renderer/` `packages/desktop-electron/src/preload/`(上游 renderer 与 IPC 桥)

任何对上游目录的改动都是合并冲突源头。需要改 UI 行为时按"四层降级"走:CSS 覆盖 → wrapper 组合 → 单文件 fork(放 `packages/octo-app/src/forks/`) → Layer 4 改上游(需 ADR 决议)。

## 实施落地状态

### M1 已达成(2026-05-01)

| 文件 | 状态 |
|---|---|
| `packages/octo-app/src/main.tsx` | ✓ 复制自 desktop-electron renderer,改路径,挂 AppInterface(M2 改成 OctoWorkbench) |
| `packages/octo-app/src/i18n/` `styles.css` `updater.ts` `webview-zoom.ts` `env.d.ts` | ✓ |
| `packages/octo-app/{vite.config.ts, tsconfig.json, package.json, index.html}` | ✓ |
| `packages/desktop-electron/electron.vite.config.ts` | ✓ renderer.root 指 octo-app + plugins 用 `@opencode-ai/app/vite` |
| `packages/desktop-electron/package.json` | ✓ 加 `@octo/app`、`@tailwindcss/vite`、`vite-plugin-solid` |
| 仓库根 `package.json` | ✓ workspaces + `dev:ui` 指向 octo-app |
| `packages/octo-ui/`(Vue) | ✓ 已删除 |

**当前可见**:启动 dev = 看到原生 opencode 完整 UI(挂 AppInterface)。

### M2 待执行(下一对话起步)

把 main.tsx 顶层从 `<AppInterface>` 切成 `<OctoWorkbench>`,实施细节见 [docs/learning/opencode-ui-composition.md §5-7](../learning/opencode-ui-composition.md)。约 5-7 天。

## 后果

### 立即生效

- **上游全部一行不动**,合入内网零冲突
- Octo 业务工作台形态明确,多 agent 平台扩展性原生支持
- 复用上游所有 UI 零件(思维链 / 工具流 / markdown / dialog 等不重写)

### 撤回保证

`rm -rf packages/octo-app/` + 回滚 [architecture.md §5.4](../architecture.md#54-上游接线壳已有改动清单) 列出的 6 处接线壳改动 → 仓库回纯上游可跑通。

### 不变

- 后端架构(opencode 内嵌 Node 模块)、ADR-001(Electron)、ADR-003(provider 接入)继续有效
- 配置隔离(`OPENCODE_CONFIG=~/.config/octo/octo.config.json`)、SQLite 持久化、SSE 协议不变
- `@octo/shell` 和 `@octo/agent-*` 包结构不变

## 备选方案(已否决)

- **改上游 `packages/ui` `packages/app`**:被合入冲突约束否决
- **整体挂 `<AppInterface>`**:产品上无独立价值——"用户都要用高级模式为什么不装 opencode";UI 形态被锁死,无法做业务工作台
- **业务工作台 + opencode IDE 作为"高级模式"入口**(形态 C):同上,逻辑死循环
- **Web Component 桥** / **iframe 嵌入**:技术开销大,长期踩坑
