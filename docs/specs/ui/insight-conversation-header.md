# SPEC-INS-019: Insight 对话面板顶部标题栏

> **编号变更记录（2026-07-11）**：原误标 SPEC-INS-009（与 [insight-result-panel-reveal.md](insight-result-panel-reveal.md) 撞号，后者外部引用坐实为真 009），改分配 019，不影响正文。

**上游已实现：✓**（参照 `packages/app/src/pages/session/message-timeline.tsx` 原生标题 header）

---

## 0. 背景

Cowork-tab（`/insight`）的对话面板此前直接从消息列表开始，缺乏会话标题，无法快速识别当前对话内容，也无法直接重命名或删除。

UXAI-tab（`D:\project2026\UXAI`，dev 分支，chat 页）已将同类标题 header 落在 `message-timeline.tsx` 里。Octo-agent 的原生 opencode 也有相同实现。本 spec 记录 Insight 定制版的设计决策。

---

## 1. 落点

| 位置 | 决策 |
|---|---|
| Insight 左栏对话面板顶部 | `<ConversationHeader />` 作为有会话态分支的第一个 `shrink-0` 元素，消息列表 `flex-1` 在下方 |
| titlebar 槽位 | **不用** —— cowork-tab 走 OctoShell/OctoTopbar，无原生 titlebar-center/right 槽位 |

---

## 2. 功能

### 2.1 标题显示

- 从 `sync.session.get(id)?.title` 取值，经 `sessionTitle()` 规范化（去除 opencode 默认占位后缀 `New session - <iso>`）
- 占位标题未生成时显示「新会话」（文字方式，不做骨架屏 —— 视觉更简单，且 busy spinner 已表达加载中语义）
- 标题生成完成后 SolidJS 响应式自动更新，无需轮询

### 2.2 忙碌指示

- 当前会话 `session_status.type === "busy"` 时，标题左侧显示蓝色 Spinner（`var(--octo-brand)`）
- 回到 idle 时 Spinner 自动消失（响应式）

### 2.3 双击改名

- 双击标题 `<h1>` → 进入 `InlineInput` 编辑态
- `Enter` / `onBlur` → `session.update({ sessionID, title })` → 乐观更新 `sync.set(produce(...))`
- `Escape` → 取消，恢复原标题
- 改名中途切换 session（`params.id` 变化） → 清空 title 状态（`createEffect on sessionKey`）

### 2.4 ellipsis 菜单（右侧 IconButton，竖向三点）

| 菜单项 | 行为 |
|---|---|
| 重命名 | 菜单关闭动画结束后聚焦 InlineInput（`onCloseAutoFocus` + `pendingRename`） |
| 删除 | `useDialog().show(<DialogDeleteSession>)` → 确认 → `session.delete` → 跳 `/insight` |

**精简（与 UXAI chat 的差异）：**
- **分享** —— Insight 不对外发布，隐藏
- **归档** —— 暂不支持，隐藏
- **父/子会话面包屑** —— Insight 是单层用研会话，无 subagent，隐藏

---

## 3. 技术细节

### 3.1 零件复用

全部来自本仓，不引入新库：

| 零件 | 来源 |
|---|---|
| `InlineInput` | `@opencode-ai/ui/inline-input` |
| `DropdownMenu` | `@opencode-ai/ui/dropdown-menu` |
| `Spinner` | `@opencode-ai/ui/spinner` |
| `Dialog` / `Button` | `@opencode-ai/ui/dialog`, `@opencode-ai/ui/button` |
| `useDialog` | `@opencode-ai/ui/context/dialog`（`AppBaseProviders` 顶层已挂 `DialogProvider`，insight 路由可用） |
| `sessionTitle()` | `@/utils/session-title`（过滤 opencode 占位标题） |
| `useSync()` / `useSDK()` | insight 页本身已在 `SDKProvider + SyncProvider` 下 |

### 3.2 数据流

```
sync.session.get(id) → titleValue → sessionTitle() → realTitle
                                                     ↓
                                              displayTitle（fallback「新会话」）
```

改名写回：
```
InlineInput.onBlur / Enter
  → sdk.client.session.update({ sessionID, title })
  → sync.set(produce(draft => draft.session[i].title = next))  // 乐观更新
  → SolidJS 响应式 → 标题自动刷新
```

### 3.3 删除后导航

删除当前会话 → `navigate("/insight")`。Sidebar 的 `globalSDK.event.listen` 监听 `session.deleted` 事件，自动从会话列表中移除该项，无需手动处理。

---

## 4. 视觉规格

| 属性 | 值 |
|---|---|
| 高度 | 48px（`h-12`） |
| 字体 | 14px medium，`--octo-text-primary` |
| 底部分隔线 | `1px solid var(--octo-border-default, #E5E7EB)` |
| Spinner 颜色 | `var(--octo-brand, #0067D1)` |
| 左右内边距 | `px-4` |

---

## 5. 文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/app/src/pages/insight/components/conversation-header.tsx` | 新增 | 标题栏组件 |
| `packages/app/src/pages/insight/index.tsx` | 改（2 处） | import + 插入 `<ConversationHeader />` |
