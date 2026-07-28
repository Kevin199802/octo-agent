# SPEC-INS-025 Insight question 工具答题 UI（对齐 Claude AskUserQuestion）

- **状态**：草案（待实现）
- **领域**：ui/insight
- **上游已实现**：✓（后端 question 子系统、session 页 dock、样式均在上游；insight 缺的只是**页面侧渲染**）
- **关联**：[SPEC-INS-021 insight 工具集收敛 + 权限交互](../infra/insight-toolset-convergence.md) §2 —— 同源病灶（阻塞询问无 UI → 会话卡死）与同款自包含落地模式

> 本 spec 只交付「insight 能答题」。**何时该调 question** 的提示词引导由知识库问答那条线另出，不在此范围。

---

## 背景 / 目标

### 现状取证（2026-07-27，UXAI `dev` @ `d7205a899`）

**① 三道闸门全部放行 —— 模型现在就能调 `question`**

| 闸门 | 代码坐标 | 结论 |
|---|---|---|
| 工具是否进 builtin | `packages/opencode/src/tool/registry.ts:207` | `questionEnabled` = `OPENCODE_CLIENT` 默认 `"cli"` ∈ `[app,cli,desktop]` → **进** |
| 是否按 agent 过滤 | `registry.ts:308` `tools()` | question **无** agent 过滤（对比 `extract_document` 硬限 `octo_insight`、`knowledge_search` 硬限 `octo_ai`） |
| 是否被权限 deny | `agent/agent.ts` `octo_insight.permission` | 只 deny 了 `bash` / `todowrite` / `jimeng_image_generate` / `internel_image_generate`，**未** deny question；`session/llm.ts:458` `resolveTools` 只隐藏被 deny 的 |

**② 前端数据已经到了，缺的只是 UI**

- `packages/app/octoapp/context/global-sync/event-reducer.ts:356`：`question.asked` → 写入 `store.question[sessionID]`
- `packages/app/octoapp/pages/insight/lib/debug-observer.ts:98`：`question.asked` 已被列入 `BLOCKING_TYPES`，`octoDebug.pending()` 会报「卡在等用户」
- insight 全目录 **零** question 渲染组件（`grep` 仅命中 debug-observer）

**③ 后果**

模型一旦调 `question` → 服务端 `Question.ask` 在 Deferred 上阻塞（`packages/opencode/src/question/index.ts:155`）→ insight 界面无任何答题入口 → **会话永久挂起**。与 SPEC-INS-021 §0.2 记录的「贴路径卡死」（permission 无 UI）**同源同病**，只是换成了 question。

之所以至今未撞上：`octo_insight` 提示词未提及 question，模型几乎不主动调用——属于**未引爆**，不是不存在。

### 目标

给 insight 补上答题 UI，交互对齐 Claude 客户端 AskUserQuestion：多问题分页、单选 / 多选、自定义答案、Skip。

---

## 范围

**做**：insight 页面的 question 答题 dock（含 DEV 预览页）。

**明确划走（不做）**：

| 不做的事 | 原因 |
|---|---|
| 不动 `registry.ts` agent 白名单 | question 保持对所有 agent 开放。design 已自行适配，其他页面同事已知会——各 agent 自建 UI 是既定分工 |
| 不动 `octo_insight` 提示词 | 调用引导由知识库问答那条线另出，本 spec 只保证「工具可用」 |
| 不动 `packages/ui` / `packages/opencode` / `packages/sdk` | 上游 schema 原样复用：**不加** `preview` 字段、**不改** `header` 30 字上限、**不改**每问独立 Skip |
| 不抽跨页面公共组件 | 见下「架构约定」 |

### 架构约定：上游一套 API，下游各 agent 自建 UI

仓内已形成既定模式，本 spec 遵循而非改变它：

- **共享的**：后端 question 子系统（工具 / 服务 / 路由 / schema）、`@opencode-ai/ui` 的 `DockPrompt`、`message-part.css` 样式、以及**纯逻辑函数** `sessionQuestionRequest`
- **各自一份的**：`session-question-dock.tsx`（568 行，chat 页在用）、`make-question-dock.tsx`（69 行薄适配器，映射到 make 自己的 `QuickBriefFormView`）、design 页（同事已适配）
- **insight 先例**：`components/permission-dock.tsx` 注释明写「参照 pages/session/composer 的 SessionPermissionDock，按 insight 页面自包含原则薄封装，**不跨页面 import**」

> ⚠️ `session-question-dock.tsx` **不是新增文件**，`packages/app/src` 与 `octoapp` 各有一份且都被各自 `session-composer-region.tsx` 引用（chat 页在用）。把它抽成公共组件 = 改一个在用模块 + 改上游镜像目录 → 同步上游必冲突。故**不抽**。

---

## 上游资产盘点（复用什么）

| 层 | 坐标 | 复用方式 |
|---|---|---|
| 工具 | `opencode/src/tool/question.ts` + `question.txt` | 原样，工具名 `question` |
| 服务 / schema | `opencode/src/question/index.ts`（`Prompt` / `Option` / `Answer` / `Reply` / bus 事件） | 原样 |
| 路由 | Hono + Effect HttpApi 双份俱全 | 原样（无需新增接口，不涉及 CLAUDE.md 的路由框架坑） |
| SDK | `sdk.client.question.reply` / `.reject` | 直接调 |
| 全局状态 | `event-reducer.ts` → `sync.data.question[sessionID]` | 直接读 |
| 选取逻辑 | `pages/session/composer/session-request-tree.ts:45` `sessionQuestionRequest` | **跨页 import**（纯函数，make 已有先例，非组件依赖） |
| 交互实现 | `pages/session/composer/session-question-dock.tsx` | **port 一份**到 insight 目录 |
| 样式 | `packages/ui/src/components/message-part.css:953` `[data-component="dock-prompt"][data-kind="question"]` | 用 `<DockPrompt kind="question">` **免费吃到全套**，经 `ui/styles/index.css` 全局加载，无需改 packages/ui |

---

## 方案

### 新增文件（均在 insight 自包含目录内）

- `packages/app/octoapp/pages/insight/components/question-dock.tsx` —— 主组件 `InsightQuestionDock`
- `packages/app/octoapp/pages/insight/components/question-dock.css` —— 局部覆盖，作用域收在 `.octo-question-dock`
- `packages/app/octoapp/pages/insight/__dev/question-dock-preview.tsx` —— DEV-ONLY 预览页

### 改动文件

- `pages/insight/index.tsx` —— 挂载，位置紧邻现有 `<InsightPermissionDock sessionID={params.id} />`（`index.tsx:2253`）
- `pages/insight/__dev/routes.tsx` —— `PAGES` 加 `/insight/__dev/question-dock`
- `pages/insight/__dev/index-preview.tsx` —— `DEV_PAGES` 加一条

### 交互（照 session dock port，即截图里 Claude 那版）

多问题分页（`1 of 2` + 进度点，可点击跳题）、单选 radio / 多选 checkbox、「输入自定义答案」行内 textarea、Skip（= `reject`）/ Back / Next / Submit、键盘导航（↑↓ / Home / End / Esc 取消 / ⌘+Enter 下一题）、module 级 `cache` 按 `request.id` 保住「填了一半的答案」。

### 输入框互斥

答题期间禁用输入框，与 make 页一致（`make/index.tsx:2835` `inputDisabled` 已把 `questionRequest()` 纳入）。

---

## 长答案渲染（硬约束）

**不做词组胶囊**。选项答案可能很长，胶囊布局会溢出/截断。

上游样式实测**本来就是整行铺开**，符合要求：

| 位置 | 属性 | 判定 |
|---|---|---|
| `question-options` | `flex-direction: column; gap: 6px` | 竖直堆叠 ✓ |
| `question-option` | `width: 100%; align-items: flex-start; text-align: left` | 整行、顶对齐 ✓ |
| `option-description` | `overflow-wrap: anywhere; white-space: normal` | 长文本换行 ✓ |
| `question-options` | `overflow-y: auto` + `--question-prompt-max-height` | 选项多可滚 ✓ |

**需要补的一处**：`option-label`（`message-part.css:1172`）**没有** `overflow-wrap`。中文与带空格文本能正常换行，但长不断词串（URL / 文件路径 / 长英文标识符）会溢出容器。

→ 在 `question-dock.css` 里补 `overflow-wrap: anywhere`，作用域收在 `.octo-question-dock`（照 `permission-dock.css` 同款做法，**不改 packages/ui**）。

---

## 验证（外网可复现）

### V1 组件层 —— 不依赖模型

1. `bun dev` 起 UXAI，浏览器开 `/insight/__dev/question-dock`
2. 预览页喂 mock `QuestionRequest`，覆盖：单问题单选 / 双问题（一单选一多选）/ 带 description 的选项 / `custom: false`
3. 断言：分页器显示 `1 of 2`、单选为圆点多选为方框、自定义答案行可展开输入

### V2 真实链路 —— 端到端

1. 起 opencode server 与 Electron（**新增路由/IPC 需重启**；本 spec 未新增服务端接口，重启前端即可）
2. `/insight` 新建会话，显式指令触发：`请用 question 工具问我两个问题：一个单选、一个多选`
3. 断言：dock 弹出 → 作答 → Submit → 模型收到 `User has answered your questions: ...` 并继续
4. `octoDebug.pending()` 在作答前应报 `question:1`，作答后归 0

### V3 长答案回归（对应硬约束）

mock 一条**超长 label**（≥120 字中文）+ 一条**长不断词串**（如 `https://example.com/a/very/long/path/...`），断言两者均换行、不溢出、不截断，选项区可滚。

### V4 路由切换不丢

作答到一半（选中第 1 题、第 2 题留空）→ 切到 `/make` → 切回 `/insight/:id`
断言：dock 重新渲染，已选答案仍在（服务端 pending 在 `Question` service 的 Map，前端在 app 级 global-sync store，均不随页面卸载丢失；半填状态由 module 级 `cache` 兜）

### V6 与 permission dock 共存

构造两者同时 pending（最简：`__dev` 预览页同时渲染两块 mock），断言纵向堆叠不重叠、选项区被压缩后仍可滚、输入区不被顶出视口。

### V5 Skip / 取消

点 Skip（或 Esc）→ 断言 `question.rejected` 发出、服务端 `RejectedError`、模型收到「用户已忽略」并继续，会话**不卡死**。

---

## 落位与共存

question dock 与 `InsightPermissionDock` 作为**同级兄弟节点**挂在输入区容器内（`index.tsx:2253` 邻位），正常纵向文档流排布——**不存在重叠/叠放**，两者同时出现时上下堆叠。上游 `session-composer-region.tsx:145,153` 也是这个结构（两个并列 `<Show>`）。

**两者会同时 pending 吗**：会，但罕见。两条路径——① 模型在同一条 assistant 消息里并行发出多个 tool call；② `task` 子代理触发 permission 而主会话正在问 question（insight 保留 `task`，且 `permission-dock.tsx` 明确遍历子会话把子代理的询问浮上来）。

因此**不做互斥或 z-index 处理**，纵向堆叠即正确行为。唯一需要注意的是两块同时出现时的**总高度**：question dock 的 `--question-prompt-max-height` 由 dock 底部反推，两块并存时可选项区会被压缩——验证时覆盖（见 V6）。

---

## 待确认事项

1. **Skip 语义**：按上游走「整体 dismiss（reject 整个 request）」，不做 Claude 截图那版「每问一个 Skip」（需改上游 schema）。**已拍板，后续有需要再改。**
2. **视觉**：本版按上游样式落地，直接找设计师看实机效果，不走 `design-assets-needed.md` 清单。
