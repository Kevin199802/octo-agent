# SPEC-INS-009 — 任务面板按需弹出（ResultViewer reveal）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 ui/insight
>
> 上游已实现：✗ 按需弹出逻辑（需自写）；✓ ResultViewer 框架 / Markdown·table·mindmap·html 渲染（[insight-result-viewer.md](insight-result-viewer.md) + [output-renderers.md](output-renderers.md)）
>
> 前置阅读：[insight-result-viewer.md](insight-result-viewer.md)、[output-renderers.md §0](output-renderers.md#0-核心原则对话内容永不替代卡片是附加预览入口)、[mcp-contract.md §任务管理](../agents/mcp-contract.md)
>
> 历史草案 [task-panel.md](task-panel.md) 是本面板的原始设计起点（时间线方向已废弃），本 spec 只规划**面板显隐规则**，不碰 tab 内容渲染。

---

## 1. 背景与问题

当前 InsightPage 是「左·对话栏（固定 `chatWidth`，约半屏）+ 中·ResultViewer（`flex-1` **常驻**）+ 右·Workspace 占位 `<div/>`」三段布局（[index.tsx:746-1071](../../../packages/app/octoapp/pages/insight/index.tsx#L746-L1071)）。

问题：**ResultViewer 容器从进页面起就常驻占掉约半屏**，即使一个产物都没有，只显示空态「对话产出将在这里展示」。这与本项目自定原则 [output-renderers.md §0](output-renderers.md#0-核心原则对话内容永不替代卡片是附加预览入口)「卡片是**附加**预览入口」相悖——一个附加入口不应默认吃掉半屏。

> **注**：合入 dev 的 UI 刷新 PR 只重做了空态视觉（大 logo + 居中输入，max-w 800，见 [index.tsx:761-885](../../../packages/app/octoapp/pages/insight/index.tsx#L761-L885)），**未改布局占位**。本 spec 针对的就是占位问题。

### 业界对照

| 产品 | 默认 | 产出时 | 关闭 |
|---|---|---|---|
| Claude.ai artifacts | 单栏对话居中，无侧栏 | 对话内落卡片 + 右侧面板**自动滑入** split | × 关闭回居中全宽 |
| ChatGPT Canvas | 同上 | 同上 | 同上 |

共性：**面板的存在 = 当前有没有要看的产出**，不是常驻工位。本 spec 把这条落到 ResultViewer 容器层。

### 与 Claude 的关键差异（影响触发设计）

Claude 是**流式**写 artifact，边写边滑入。我们的产物走 [mcp-contract.md](../agents/mcp-contract.md) 的**异步 + URL** 模型：业务工具秒回 `task_id`（仅"进行中"，无产物），用户隔后显式查询 `get_task_result`，completed 时**一次性原子返回 N 个 `resource_link` 文件 URL**。

→ **不做流式滑入**（无流式内容可滑）；产物到达是一个干净的离散时刻，且**永远紧跟用户显式查询**（LLM 不自动轮询），因此自动弹出不构成打扰。

---

## 2. 核心规则

**面板显隐绑定「是否有已打开的产物 tab」**，而非常驻。

`tab` = ResultViewer 里被打开的产物条目，来自 completed 任务的 `resource_link`（一个 link = 一个 OutputCard = 一个 tab；mindmap 例外，1 link 拆双 tab）。当前由 [`buildOutputCardsFromTask` → `tabStore.openTab`](../../../packages/app/octoapp/pages/insight/index.tsx#L626-L675) 生成。

### 2.1 状态机

| 状态 | 条件 | 布局 |
|---|---|---|
| **收起态（默认）** | `tabs.length === 0` 或用户手动收起 | 聊天**居中 reading-width**铺满，无右面板、无分隔线 |
| **展开态** | `tabs.length > 0` 且未手动收起 | 左聊天（`chatWidth`）+ 右任务面板 split，分隔线可拖拽 |

需要一个独立于 `tabs` 的 `panelCollapsed` 信号，区分「无产物」与「有产物但用户手动收起」两种收起来源。

```
面板可见 = tabs().length > 0 && !panelCollapsed()
```

### 2.2 触发表

| 时机 | 行为 |
|---|---|
| 工具秒回 task_id（进行中） | ❌ 不弹（无产物，对话内任务卡承担进度） |
| 用户点对话内产物卡 / task 卡「打开结果」 | ✅ 建 tab + `panelCollapsed=false` → 滑入并聚焦该 tab |
| `get_task_result` completed（面板当前为空） | ✅ **全部**产物建 tab、`panelCollapsed=false`、**聚焦第一项**（沿用 [index.tsx:677-696](../../../packages/app/octoapp/pages/insight/index.tsx#L677-L696) auto-open effect，扩展为同时清 collapsed） |
| 用户点面板「收起」 | `panelCollapsed=true`，**保留 tab**，聊天回居中全宽，浮「产出 (N)」唤回标 |
| 用户点浮标「产出 (N)」 | `panelCollapsed=false` → 重新滑入 |
| 用户 × 关掉最后一个 tab | `tabs.length` 归 0 → 面板消失（自然收起）；同时 `panelCollapsed=false` 复位 |
| 切 session | `tabStore.reset()`（tabs 清空）+ `panelCollapsed=false` 复位 → 收起态 |

**多产物**：completed 返回 N 个文件 → 全部建 tab，TabBar 列全部，**聚焦第一项**。这已是现有 tab 层行为（[index.tsx:673-675](../../../packages/app/octoapp/pages/insight/index.tsx#L673-L675) / [692-694](../../../packages/app/octoapp/pages/insight/index.tsx#L692-L694) 的 `for…openTab` + `activate(ocs[0].id)`），本 spec 只把它接到容器显隐。

### 2.3 不做开关

completed 自动弹**不加配置开关**。理由：自动弹只发生在用户刚显式查询任务之后，不打扰；关闭仅一次点击。为"没人要求关"的行为先建设置 UI + 持久化是过度设计。真有反馈再加（届时归宿为「设置」页）。

---

## 3. 布局

### 3.1 收起态

参考设计稿（用户提供图一）：聊天内容在「侧栏右侧的整个区域」内**居中**，限定 reading-width，无右面板。

- 左聊天列：`flex: 1`（不再固定 `chatWidth`）。
- 内层内容（消息列表 / 空态 / 输入区）套**居中 max-width 包裹**，复用空态现有的 `max-width: 800px`（[index.tsx:787](../../../packages/app/octoapp/pages/insight/index.tsx#L787)）保持一致。
- 不渲染分隔线、不渲染 ResultViewer。

> 注意：当前对话态消息列表是 `chatWidth` 全宽，没有 max-width 约束。改 `flex:1` 后必须补居中 max-width 包裹，否则宽屏下气泡会拉伸过宽。

### 3.2 展开态

维持现状 split：

- 左聊天列：`width: chatWidth, flex: 0 0 auto`（[index.tsx:749-760](../../../packages/app/octoapp/pages/insight/index.tsx#L749-L760)）。
- 分隔线：拖拽改 `chatWidth`（[index.tsx:1038-1059](../../../packages/app/octoapp/pages/insight/index.tsx#L1038-L1059)，复用 `handleDividerPointerDown`）。
- ResultViewer：`flex: 1`（[index.tsx:1062-1068](../../../packages/app/octoapp/pages/insight/index.tsx#L1062-L1068)）。

收起态 ↔ 展开态切换加 transition（宽度 / 透明度），避免硬跳。

### 3.3 收起按钮 + 唤回浮标

- **收起按钮**：放 ResultViewer 顶部 TabBar 右侧（`»` 收起图标），点击 `panelCollapsed=true`。
- **唤回浮标**：收起态且 `tabs.length>0` 时，聊天区右上角浮「产出 (N)」胶囊按钮，N = `tabs().length`，点击 `panelCollapsed=false`。

---

## 4. 实现要点

集中在 [index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx)（insight 自研代码），tab-store / ResultViewer renderer 不动其内容逻辑。

1. **新增信号**：`const [panelCollapsed, setPanelCollapsed] = createSignal(false)`。
2. **派生**：`const panelVisible = createMemo(() => tabStore.tabs().length > 0 && !panelCollapsed())`。
3. **openTab 时清 collapsed**：在 `handleOpenResult` / `handleTaskOpenResult` / auto-open effect 三处 `openTab` 后 `setPanelCollapsed(false)`（或包一层 `revealTab()` 统一处理）。
4. **切 session 复位**：在已有的 `createEffect(on(() => params.id, …))`（[index.tsx:292-299](../../../packages/app/octoapp/pages/insight/index.tsx#L292-L299)）里补 `setPanelCollapsed(false)`。
5. **关最后一个 tab 复位**：closeTab 后若 `tabs().length===0` 则 `setPanelCollapsed(false)`（可在 index 层包装 `onClose`）。
6. **布局条件化**：
   - 左列 style：`panelVisible() ? { width: chatWidth()px, flex: "0 0 auto" } : { flex: "1" }`。
   - 左列内容补居中 max-width 包裹（收起态生效；展开态可保持当前撑满或同样居中，二选一，建议两态都居中 reading-width 以减少跳动）。
   - 分隔线 + ResultViewer：`<Show when={panelVisible()}>`。
7. **收起按钮**：TabBar 加 prop / slot（[tab-bar.tsx](../../../packages/app/octoapp/pages/insight/components/result-viewer/tab-bar.tsx)），或在 ResultViewer 容器顶部叠一个按钮，回调 `setPanelCollapsed(true)`。
8. **唤回浮标**：左列内 `<Show when={tabStore.tabs().length>0 && panelCollapsed()}>` 渲染浮标。

---

## 5. 验收标准

| # | 标准 |
|---|---|
| 1 | 新会话（无产物）：聊天居中 reading-width 铺满，**无右面板、无分隔线**（对齐图一） |
| 2 | 发指令拿到 task_id（进行中）：面板**不弹**，对话内出现任务进度卡 |
| 3 | 用户「查询任务」→ completed 单产物：面板滑入，显示该产物 |
| 4 | completed 多产物：面板滑入，TabBar 列出全部 tab，**聚焦第一个** |
| 5 | mindmap：1 link → 双 tab（JSON + 思维导图），聚焦第一个 |
| 6 | 点对话内产物卡：面板滑入并聚焦对应 tab；重复点已开产物不新建（沿用 tab-store 去重） |
| 7 | 点「收起」：面板隐藏、聊天回居中全宽、tab 保留、右上出现「产出 (N)」浮标 |
| 8 | 点「产出 (N)」浮标：面板重新滑入，tab 与聚焦项不变 |
| 9 | × 关掉最后一个 tab：面板消失，聊天回居中全宽，浮标不出现（因 N=0） |
| 10 | 切 session：面板收起，新 session 按其是否有已打开产物决定（reset 后为收起态） |
| 11 | 收起 ↔ 展开有过渡动画，不硬跳；拖拽分隔线仍可调 `chatWidth`（展开态） |

---

## 6. 不做

- ✗ 流式滑入（产物 URL 原子返回，无流式内容，见 §1）
- ✗ completed 自动弹的配置开关（§2.3）
- ✗ 窄屏 Drawer 浮层覆盖退化 → P2（第一版桌面宽屏只做 split + 收起）
- ✗ Workspace 右栏（仍 `<div/>` 占位，P2，见 [insight-workspace.md](insight-workspace.md)）
- ✗ tab 内容渲染逻辑变更（归 [output-renderers.md](output-renderers.md)）
