# SPEC-INS-006 — insight/ 自建组件轻审计

> 状态:草案 · 优先级 P1 · 规模 [S] · 领域 ui/insight · 类型:**诊断报告(非实现 spec)**
>
> 上游已实现:**逐项标注**(见 §3 对照表)。本 spec 是排查工具,不直接产出代码。

---

## 1. 背景与目的

### 1.1 触发动机

PR1([SPEC-INS-005](insight-data-layer-reuse.md))修复了一个 P0 隐性 bug:InsightPage 自建 `dataStore` + SSE listener 与上游 globalSync 的 `event-reducer` **同时反应式持有 part 对象**,导致每个 SSE delta 被处理两次,文本流式输出"凭空翻倍"。

根因不是代码出错,而是**未评估上游已实现就自己写一份**——而上游早已写好且行为正确。

### 1.2 担忧

类似的"自建但其实上游能复用"的隐性 bug 可能在 [insight/](../../../packages/app/src/pages/insight/) 的其他组件里潜伏。**目的不是逼着换上游**,而是:

1. **逐项确认**每个自建组件的"是否真的需要自建"
2. **对照实现细节**,排查类似 PR1 那种"反应式共享 / 双订阅 / state 漂移"风险
3. **没坑就保留现状**,有坑就单开 issue 修

### 1.3 审计范围

- ✅ **包含**:[packages/app/src/pages/insight/](../../../packages/app/src/pages/insight/) 全部自建文件(组件 / hook / store / util / lib)
- ❌ **不包含**:[packages/app/src/pages/_shell/](../../../packages/app/src/pages/_shell/) —— 已由**内网团队**合并维护,octo 这边只是合入物,不重复审
- ❌ **不包含**:[packages/app/src/pages/insight/icons/](../../../packages/app/src/pages/insight/icons/) —— 纯 SVG 占位资产,无逻辑

---

## 2. 上游能力盘点(参考表)

审计前先建立上游清单,后续每条自建项对照查。

| 类别 | 路径 | 关键能力 |
|---|---|---|
| **原子 UI** | [packages/ui/src/components/](../../../packages/ui/src/components/) | button, tooltip, dropdown-menu, popover, dialog, tabs, toast, icon, markdown, scroll-view, spinner, tag, ...(129 个 tsx) |
| **业务组件** | [packages/app/src/components/](../../../packages/app/src/components/) | prompt-input/, dialog-*, file-tree, file-search, session/, settings-* |
| **会话核心** | [packages/ui/src/components/session-turn.tsx](../../../packages/ui/src/components/session-turn.tsx) | 单轮对话渲染(user msg + assistant parts + tool calls) |
| **PromptInput** | [packages/app/src/components/prompt-input/](../../../packages/app/src/components/prompt-input/) | contenteditable 编辑器 / @-mention / 斜杠命令 / 图片附件 dataUrl / 历史回溯 / 提交 / submit.ts(promptAsync+optimistic 标准实现) |
| **图片附件** | [prompt-input/image-attachments.tsx](../../../packages/app/src/components/prompt-input/image-attachments.tsx) | ImageAttachmentPart(dataUrl) chip,**仅图片** |
| **文件附件流水** | [prompt-input/attachments.ts](../../../packages/app/src/components/prompt-input/attachments.ts) | dataUrl 模式上传到 LLM context(无 S3) |
| **数据同步** | [context/global-sync/](../../../packages/app/src/context/global-sync/) + [context/sync.tsx](../../../packages/app/src/context/sync.tsx) | sync.session.sync / event-reducer / optimistic.add / remove |
| **通知** | [context/notification.tsx](../../../packages/app/src/context/notification.tsx) | session.error / session.idle → notification.list + platform.notify(**不弹 toast**) |

---

## 3. insight/ 自建项 × 上游对照表

每一项给三个判断:
- **上游已实现**:✓ / ✗ / △(部分)
- **复用决策**:保留 / 换上游 / 即将废弃(任务 4 覆盖)
- **风险等级**:🔴 高 / 🟡 中 / 🟢 低(指"类似 PR1 那种隐性 bug"的可能性)

### 3.1 组件 (`components/`)

| 文件 | 行数 | 职责 | 上游已实现 | 决策 | 风险 | 说明 |
|---|---|---|---|---|---|---|
| [attachment-bar.tsx](../../../packages/app/src/pages/insight/components/attachment-bar.tsx) | 111 | 上传文件 chip 列表,状态 = uploading/done/error/重传/删除 | ✗ | **保留** | 🟢 | **纯展示组件,无 state / SSE / store**。上游 `PromptImageAttachments` 业务模型完全不同(dataUrl 模式,只支持图片),不可复用。emoji 占位图(🖼📕📝)可以后续换 [packages/ui file-icon](../../../packages/ui/src/components/file-icon.tsx),无紧迫性。**无 PR1 类风险**。 |
| [insight-turn.tsx](../../../packages/app/src/pages/insight/components/insight-turn.tsx) | 250 | SessionTurn 薄封装,在 turn 下方挂 OutputCard / TaskCardView | △ 内层 `<SessionTurn>` 已复用上游 ✓ | **保留** | 🟢 | **数据来源走 `useData()` = sync.data**(PR1 后);不自建 store / SSE。挂卡片逻辑是业务专属,无上游对应。L92/L106 的 `as Record<string, ...>` 强转是因为 `data.store` 类型在 DataProvider 里宽泛 —— 可优化但不是 bug。**无 PR1 类风险**。 |
| [prompt-template-selector.tsx](../../../packages/app/src/pages/insight/components/prompt-template-selector.tsx) | 187 | 提示词模板下拉选择 | ✗ | **即将废弃**(任务 4 移除) | 🟢 | 任务 4 用"预置提示词按钮"替代,本组件整体删除。审计跳过。 |
| [result-viewer/index.tsx](../../../packages/app/src/pages/insight/components/result-viewer/index.tsx) | 251 | 中栏 tab 容器(0~N 个产物 tab),含 fetch / 缓存 / 空态 | ✗ | **保留** | 🟡 | 业务专属(MCP resource_link → tab 化展示);上游没有对应能力。**潜在 race**:tab 切换时 fetch URI 内容,如果切得快,旧 tab 的 fetch resolve 后是否会污染新 tab cache? 需后续单独跑一次"快速切 tab" 压测。**非阻塞**,留待 follow-up。 |
| [result-viewer/tab-store.ts](../../../packages/app/src/pages/insight/components/result-viewer/tab-store.ts) | 76 | tab 列表 + 活跃 tab + 内容 cache 的 createSignal store | ✗ | **保留** | 🟢 | 业务专属,无上游;state 全在组件 closure 内,无跨组件共享,无 PR1 类双订阅风险。 |
| [result-viewer/action-bar.tsx](../../../packages/app/src/pages/insight/components/result-viewer/action-bar.tsx) | 197 | tab 工具条:复制 / 下载 / 全屏 | ✗ | **保留** | 🟢 | UI 操作,无外部状态。 |
| [result-viewer/tab-bar.tsx](../../../packages/app/src/pages/insight/components/result-viewer/tab-bar.tsx) | 58 | tab 切换栏 | △ ui/tabs 存在,但接口不同 | **保留** | 🟢 | 简单 chip 列表,自建成本低于适配 [ui/tabs](../../../packages/ui/src/components/tabs.tsx)。 |
| [result-viewer/html-renderer.tsx](../../../packages/app/src/pages/insight/components/result-viewer/html-renderer.tsx) | 31 | iframe srcdoc 渲染 HTML | ✗ | **保留** | 🟢 | 极简,无 state。 |
| [result-viewer/mindmap-renderer.tsx](../../../packages/app/src/pages/insight/components/result-viewer/mindmap-renderer.tsx) | 39 | markmap 渲染 | ✗ | **保留** | 🟢 | 第三方库包装。 |
| [result-viewer/table-renderer.tsx](../../../packages/app/src/pages/insight/components/result-viewer/table-renderer.tsx) | 78 | 渲染 markdown 表格 | △ [ui/markdown](../../../packages/ui/src/components/markdown.tsx) 可渲染表格,但**不可单独复制表格行** | **保留** | 🟢 | 业务需求:单独复制/下载表格(已在 [commit 569c44d](../../../) 修过) |
| [task-card/index.tsx](../../../packages/app/src/pages/insight/components/task-card/index.tsx) | 345 | MCP 长任务进度卡片(状态 + 刷新冷却倒计时 + 操作按钮) | ✗ | **保留** | 🟢 | 业务专属(MCP task_id 进度展示);上游不存在。引用 [task-refresh](../../../packages/app/src/pages/insight/utils/task-refresh.ts) 反应式倒计时,见 §3.3。 |

### 3.2 主页面 (`index.tsx`)

| 文件 | 行数 | 状态 | 风险 |
|---|---|---|---|
| [index.tsx](../../../packages/app/src/pages/insight/index.tsx) | 730 | PR1 后数据层已对接 sync.data ✓;发送链路仍是同步 `session.prompt`(任务 4 改 promptAsync) | 🟡 sending() 信号待清理(任务 4 顺手做);textarea `disabled={inputDisabled()}` 行为待整改(任务 4 包含) |

### 3.3 store (`store/`)

| 文件 | 行数 | 状态 | 决策 | 风险 |
|---|---|---|---|---|
| [store/prompt-template.ts](../../../packages/app/src/pages/insight/store/prompt-template.ts) | 41 | 提示词模板静态常量 | **即将废弃**(任务 4 替换为预置提示词按钮配置) | 🟢 |

### 3.4 lib (`lib/`)

| 文件 | 行数 | 状态 | 决策 | 风险 | 说明 |
|---|---|---|---|---|---|
| [lib/upload.ts](../../../packages/app/src/pages/insight/lib/upload.ts) | 188 | 走内网 S3 endpoint,验证 / 错误码三层兜底 | **保留** | 🟢 | 完全自建因走自家上传服务,无上游可复用;错误处理细致(client validate + 业务码 + HTTP 兜底);无反应式 / SSE / store,**无 PR1 类风险**。ADR-006 已记录架构决策。 |

### 3.5 utils (`utils/`)

| 文件 | 行数 | 职责 | 决策 | 风险 | 说明 |
|---|---|---|---|---|---|
| [utils/detect.ts](../../../packages/app/src/pages/insight/utils/detect.ts) | 62 | 文本类型检测(markdown table / mindmap JSON / HTML / plain JSON) | **保留** | 🟢 | 纯函数,业务专属。 |
| [utils/markdown-table.ts](../../../packages/app/src/pages/insight/utils/markdown-table.ts) | 22 | 表格行提取 | **保留** | 🟢 | 纯函数。 |
| [utils/mindmap-adapter.ts](../../../packages/app/src/pages/insight/utils/mindmap-adapter.ts) | 38 | JSON → markmap 转换 | **保留** | 🟢 | 纯函数。 |
| [utils/resource-link.ts](../../../packages/app/src/pages/insight/utils/resource-link.ts) | 132 | MCP resource_link part 解析 + mime → outputType 映射 | **保留** | 🟢 | 纯函数。 |
| [utils/task-detect.ts](../../../packages/app/src/pages/insight/utils/task-detect.ts) | 203 | MCP 长任务 part 检测 + 聚合 | **保留** | 🟢 | 纯函数(只读 part);**注意:** 函数返回的对象**不能被外层用 `produce` 修改**,否则会污染 sync.data 里的反应式 part 对象 —— 类似 PR1 那种双写场景。当前调用方([index.tsx:93-123](../../../packages/app/src/pages/insight/index.tsx))只读,**安全**。后续如新增"在 task 卡片内编辑某字段"功能,需注意此约束。 |
| [utils/task-refresh.ts](../../../packages/app/src/pages/insight/utils/task-refresh.ts) | 72 | 任务刷新冷却倒计时,模块级 createSignal + setInterval | **保留** | 🟡 | 模块级 createSignal(无 SolidJS owner,作者注释已说明)。`setInterval` 用"tick 内自停"避免泄漏 ✓;切 session 调 `clearRefreshState()` ✓。**潜在风险**:模块级 Map 跨 InsightPage 实例(目前 octo 只一处挂载,实际无影响)。若未来 insight 路由多实例化,需改成 createContext。**非阻塞**。 |
| [utils/detect.test.ts](../../../packages/app/src/pages/insight/utils/detect.test.ts) | 130 | detect 单测 | **保留** | 🟢 | |

---

## 4. 结论与行动项

### 4.1 总判断

**没有发现类似 PR1 那种隐性 bug**。具体来说:

1. ✅ PR1 已修最严重的"双反应链 part 共享"问题
2. ✅ insight/ 下**所有反应式 state 都是组件 closure 局部** + 用 useData() 读 sync.data,不再自建 store + SSE
3. ✅ 唯一的模块级 createSignal(task-refresh.ts)有 owner 失效注释 + tick 自停,可控
4. ✅ 业务专属组件(task-card / result-viewer / lib/upload)上游无对应,自建合理

### 4.2 短期行动(本对话内)

| 序号 | 行动 | 归属任务 | 优先级 |
|---|---|---|---|
| 1 | `prompt-template-selector.tsx` + `store/prompt-template.ts` 移除 | 任务 4 | P0 |
| 2 | `index.tsx` `doSendPrompt` 改 promptAsync + optimistic | 任务 4(吞原 PR2) | P0 |
| 3 | `index.tsx` 移除 `sending()` 信号,sending/isBusy 统一 isBusy | 任务 4 | P0 |
| 4 | `index.tsx` textarea `disabled` 整改(允许 busy 期间键入) | 任务 4(吞原任务 2) | P0 |
| 5 | CLAUDE.md "PromptInput 自己写"理由更新([005 §7](insight-data-layer-reuse.md#7-输入区评估保留自实现--理由更新)) | 任务 5 | P1 |

### 4.3 中期 follow-up(本对话不做,留 backlog)

| 序号 | follow-up | 触发条件 |
|---|---|---|
| 1 | `result-viewer/index.tsx` tab 切换 race 压测 | 用户反馈"切 tab 内容串了"时 |
| 2 | `attachment-bar.tsx` emoji 占位换 [file-icon](../../../packages/ui/src/components/file-icon.tsx) | 设计师要切图时一起 |
| 3 | `utils/task-refresh.ts` 改 createContext | insight 路由多实例化时 |
| 4 | `insight-turn.tsx` 强转 `as Record<string, ...>` 优化为 DataProvider 类型收紧 | 重构 useData 类型时 |
| 5 | LLM 中途错误(`session.error` SSE)前台感知 | 内网用户反馈"出错没提示"时(005 §3.2 已记录) |

### 4.4 不做什么

- ❌ 不主动重写已"保留"标注的组件(避免无价值改动 + 引入新 bug)
- ❌ 不审 [_shell/](../../../packages/app/src/pages/_shell/)(内网团队维护边界)
- ❌ 不评估第三方库依赖质量(markmap / xlsx 等)
- ❌ 不做"自建 vs 上游"的代码风格 / 工程一致性审计(只关心 bug 风险)

---

## 5. 审计方法回顾

为后续类似审计建立可复用模板。

### 5.1 步骤

1. **列全自建文件清单**:`find packages/app/src/pages/<page>/ -type f`
2. **盘点上游能力**:`find packages/ui/src/components/`、`find packages/app/src/components/`
3. **逐项 grep 上游对应**:文件名关键词 + 业务关键词(attachment / turn / template / ...)
4. **细看高嫌疑项**:用户提示的 + 自建超 100 行的 + 涉及反应式 state / SSE / store 的
5. **PR1 类风险三问**:
   - 是否自建反应式 store 与上游 sync 重叠?
   - 是否独立 SSE 监听与上游 event-reducer 重叠?
   - 是否模块级可变状态跨组件共享?
6. **产出对照表 + 决策 + 行动项**

### 5.2 风险标注定义

- 🔴 **高**:已确认 bug 或与 PR1 同类机制,**必须改**
- 🟡 **中**:潜在 race / 边界场景 bug,**未触发**,需关注
- 🟢 **低**:逻辑独立,无共享反应式状态,**短期不需要动**

---

## 6. 修订记录

- 2026-05-25:初稿,基于 PR1 合入后的代码状态审计
