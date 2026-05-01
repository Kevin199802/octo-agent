# opencode UI 复用与组合策略

> 来源:阅读 `packages/app/src/app.tsx`、`packages/ui/src/components/session-turn.tsx`、`packages/ui/src/context/data.tsx` 等源码后总结。事实截止 2026-05-01。

## 1. 两个上游包的真实角色

| 包 | 角色 | 是否能"零件式"复用 |
|---|---|---|
| `@opencode-ai/ui` | **真正的零件库**。组件依赖只有它内部的 `context/{data, file, dialog, i18n, marked}` 等几个轻量 context | ✓ 可以单独挂载,只要喂数据 |
| `@opencode-ai/app` | **完整 IDE 装配厂**。内部组件深度依赖 packages/app 的全局状态(useSync / useSDK / useLayout / usePermission / useTerminal / 等 30+ context) | ✗ 高层组件难以脱离 packages/app context 单独使用;`AppBaseProviders` 和 `AppInterface` 是导出的可整体挂载 |

**核心结论**:形态 B(组件级零件 + Octo 自写顶层壳)**真的可行**,但**主要复用 `@opencode-ai/ui`**;`@opencode-ai/app` 的高层组件(PromptInput / Layout / Sidebar 等)不参与复用——Octo 自己写或用 `@opencode-ai/ui` 的更基础组件替代。

## 2. `@opencode-ai/ui` 暴露什么

```
exports:
  ./<name>: ./src/components/<name>.tsx     # 所有组件单独可 import
  ./context: ./src/context/index.ts          # DataProvider / I18nProvider / FileComponentProvider / MarkedProvider / DialogProvider / WorkerPoolProvider
  ./theme/context: ./src/theme/context.tsx   # ThemeProvider + useTheme
  ./hooks: ./src/hooks/index.ts              # createAutoScroll 等
  ./styles: ./src/styles/index.css           # 必须 import 才有视觉
  ./styles/tailwind: tailwind 入口
```

**关键组件清单**(M2 主要复用对象):

| 组件 | 用途 | 数据来源 |
|---|---|---|
| `SessionTurn` | 单轮消息(用户消息 + assistant 回复 + 工具流 + 思维链) | `useData()`(从 DataProvider) |
| `MessagePart` 系列(`AssistantParts`、`Message`、`PART_MAPPING`) | 渲染单个消息 part(text/reasoning/tool/edit/...) | 同上 |
| `Markdown` | markdown 渲染 | 通过 MarkedProvider 注入 marked 实例 |
| `TextShimmer` | "Thinking..."流光效果 | 无数据依赖 |
| `Card`、`Button`、`Icon`、`Tooltip`、`DropdownMenu`、`Dialog`、`Tabs`、`Accordion`、`Splash`、`Toast` 等基础元件 | UI 基础 | 无数据依赖 |
| `dock-prompt`、`inline-input` | 简单输入(可作为 PromptInput 的零件起点) | 无数据依赖,自己组装 |

## 3. `DataProvider` 是关键

`packages/ui/src/context/data.tsx` 的 `Data` 类型(简化):
```typescript
{
  agent?: { name; color }[]
  provider?: ProviderListResponse
  session: Session[]
  session_status: { [sessionID]: SessionStatus }
  session_diff: { [sessionID]: SnapshotFileDiff[] }
  message: { [sessionID]: Message[] }
  part: { [messageID]: Part[] }
}
```

**这是一个简单的 store**——Octo 只要从 OpencodeClient 拉数据填进去,组件就能渲染。

**喂数据的方法**:
1. REST 拉初始:`client.session.list()` / `client.session.messages({ path: { id } })`
2. SSE 订阅增量:`client.event.subscribe()` 监听 `message.part.updated` / `message.part.delta` / `session.idle` / `session.error`
3. 用 `solid-js/store` 的 `createStore` 实现增量合并(参考 packages/app/src/context/sync.tsx 但只取数据流逻辑)
4. 组件自动响应(Solid 细粒度 reactive)

## 4. `AppBaseProviders` 是不是足够

**短答**:对于 Octo 的"业务工作台"形态,`AppBaseProviders` 直接复用即可。它包了:
- `MetaProvider`(Solid Meta)
- `<Font />` + `ThemeProvider`(主题切换 + 颜色)
- `LanguageProvider` + `UiI18nBridge`(i18n,桥接到 ui 包的 I18nProvider)
- `ErrorBoundary`
- `QueryClientProvider`(TanStack Query)
- `DialogProvider` + `MarkedProvider` + `FileComponentProvider`(ui 包需要的 context)

**Octo 端在 AppBaseProviders 里再挂自己的**:
- `DataProvider`(ui 包需要,数据从 SDK 灌)
- 一个简化的 `OpencodeSyncProvider`(自写,实现"REST 权威 + SSE 体验"逻辑,把数据塞进 DataProvider 的 store)
- Octo 的路由 / 布局壳

**不要复用** `AppShellProviders`(packages/app/src/app.tsx 里的 SettingsProvider / PermissionProvider / LayoutProvider / ModelsProvider / CommandProvider / HighlightsProvider) ——它们是 packages/app IDE 形态专用,Octo 工作台用不上,而且和 packages/app 内部 sync 状态绑定。

## 5. 最小可行 Octo 顶层

```tsx
// packages/octo-app/src/main.tsx (改写后,基于现有 boot 代码)

render(() => {
  const platform = createPlatform()
  // ...platform / locale / sidecar 等 wiring 跟现状一致

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show when={!sidecar.loading && !locale.loading}>
          <OctoDataProvider>             {/* 自写,内部 DataProvider + sync 逻辑 */}
            <OctoWorkbench />            {/* 自写,顶层路由 + sidebar + 业务页 */}
          </OctoDataProvider>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
```

`<OctoWorkbench>` 内部:
- `<OctoSidebar>`(自写,基于设计稿:agent 列表 / 项目卡 / 历史 / 设置)
- `<Routes>`:
  - `/agent/:id` → `<AgentSession>`(组合 `<SessionTurn>` 等)
  - `/skills` → `<OctoSkillsPage>`(自写)
  - `/assets` → `<OctoAssetsPage>`(自写)
  - `/settings` → 复用上游 `dialog-manage-models` 等(也是单独可挂的)

`<AgentSession>` 内部:
```tsx
<div class="flex h-full">
  <div class="flex-1 overflow-auto">
    <For each={messages()}>
      {(msg) => <SessionTurn ... />}
    </For>
  </div>
  <OctoPromptInput onSubmit={...} />  {/* 自写,简单 textarea + 文件 + 提交 */}
</div>
```

## 6. PromptInput 怎么办

上游 `packages/app/src/components/prompt-input.tsx` 极复杂(上千行,处理 @ 提示、文件附件、slash 命令、image attachment、history 等),且深耦合 packages/app context。**不复用**。

Octo 自写 `<OctoPromptInput>`(P0 简化版):
- textarea(自动高度)
- 文件附件按钮(用 `platform.openFilePickerDialog` 选文件)
- 提交按钮 → 调 `client.session.message.send({ session_id, parts: [...] })`
- agent 选择(下拉,从 `data.agent` 列表)

工作量约 1 天。后续根据需要逐步加 @ 提示、slash 等,**或者**等吃透 packages/app/PromptInput 的 wiring,做"瘦身复制"放进 octo-app/forks/。

## 7. 工作量估算(M2)

| 任务 | 工作量 |
|---|---|
| 改写 main.tsx 顶层(挂 OctoDataProvider + OctoWorkbench) | 0.5 天 |
| `<OctoDataProvider>`(REST 初始 + SSE 增量,store 维护) | 1-2 天 |
| `<OctoWorkbench>` 路由 + 布局 | 0.5 天 |
| `<OctoSidebar>`(基于设计稿,visual 细节) | 1-2 天 |
| `<AgentSession>` + 组合 `<SessionTurn>` | 0.5 天 |
| `<OctoPromptInput>` 简化版 | 1 天 |
| 业务页面占位(skills / assets) | 0.5 天 |
| Octo 主题色 CSS 覆盖,接近设计稿 | 0.5 天 |

合计 **5-7 天**做出 M2 第一版可演示。

## 8. 待 M2 实施时按需进一步查证

- `SessionTurn` 的完整 props 签名(去 `packages/ui/src/components/session-turn.tsx` line 100+)
- `useSync` / `usePrompt` 等 packages/app context 是否有可借鉴的最小实现(参考 sync.tsx 的数据合并逻辑)
- `MessagePart` 系列的 PART_MAPPING 注册机制(我们想加自定义 part 类型时怎么扩展)
- `ThemeProvider` 接受哪些 prop / token 名清单(用于主题覆盖)

这些不预先穷尽,M2 写代码踩到再读。
