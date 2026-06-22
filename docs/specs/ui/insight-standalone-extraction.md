# SPEC-INS-010 — Insight 独立化:放弃 cowork 接线层,自包含可挂载模块

> 状态:✅ 主体已落地(PR1/PR2 + D10/D11)· 优先级 P0 · 规模 [L] · 领域 ui/insight · 类型:架构 + 实现 spec
>
> 代码在 UXAI 仓 `packages/app/octoapp/pages/insight/`(含 `components/session-list/`)。文中"外网 octo-agent 本地壳 / 内网 UXAI"的双 fork 对照属当时背景;现 octo-agent 已 docs-only、代码主线在 UXAI,行号为实现时快照。
>
> **上游已实现**:
> - ✓ 会话 CRUD(`session.list/update/delete`)走 SDK,当前 [_shell/sidebar.tsx:54-122](../../../packages/app/octoapp/pages/_shell/sidebar.tsx#L54-L122) 已在用
> - ✓ 模型选择回退链(会话级→agent 默认→全局兜底)在 [context/local.tsx:224-232](../../../packages/app/octoapp/context/local.tsx#L224-L232) `useLocal().model.current()`
> - ✓ 会话页 / 对话 UI 数据层复用上游 globalSync / sync.session(SPEC-INS-005)
> - ✓ 懒创建会话(发首条消息才建)我方 [insight/index.tsx:562-566](../../../packages/app/octoapp/pages/insight/index.tsx#L562-L566) 已实现
> - △ 上游 [components/sidebar](../../../packages/app/octoapp/components/sidebar.tsx) 是目录/文件取向(opencode 工程视角),不适配 insight 的 agent 会话列表 → **不复用**,保留我方 octo 风格会话列表
> - ✗ "每 Agent 自带会话列表 + 共享 chrome 组合"的侧栏形态:上游无对应物,本 spec 设计

---

## 1. 背景与目的

### 1.1 触发动机

insight 第一版的路由 / shell 层被 UX AI 项目直接参考,拆分(insight/make 分家、改名 cowork)后内网多人魔改,出现两类 bug:

1. **聊天区白屏**:切回会话中间区空白(已在 [971d9ed](#) 从渲染层堵死)
2. **全局样式污染**:studio 气泡样式串到全局

根因不在 insight 自身代码,而在**会话逻辑焊死在共享 shell 里**——任何人改 shell 都可能波及对话。结论:让 insight 成为**"给一个路由 + 挂载点就能跑"的自包含模块**,宿主 shell 退化为纯壳;与 UX AI 的唯一联系是"分配一个路由 + 目录挂载",其余公共改动按 [intranet-handoff.md](../../intranet-handoff.md) 合入。

### 1.2 目标(本期锁定)

| # | 决策 | 状态 |
|---|---|---|
| D1 | 仅 insight 归我方,make / chat / studio 不在本期范围 | 锁定 |
| D2 | 模型选择切到全局 `useLocal().model`,放弃 insight 隔离 store(业务无 per-agent 隔离需求) | 锁定 |
| D3 | 落地页 = 聊天框,和标准 Agent 一致(被废弃的"首页"是 cowork 专属项目落地页,我方 insight 本就直接进空会话态,**无需改动**) | 锁定 |
| D4 | 新建对话 = 跳空会话页,发首条消息才创建记录(保持我方现状) | 锁定 |
| D5 | 项目/产品选择器(PYPTO / ICT-CANN)**本期忽略**:由同事拆为 `components/` 共享组件 + 全局 Store,需要时再引用 | 锁定 |
| D6 | cowork fork 整体废弃,`/insight` 路由回指我方维护的 insight 模块 | 锁定 |
| D7 | 底部导航(技能库/资产库/设置)同 D5:由另一同事拆为共享组件,**本期不归我方**,需要时引用 | 锁定 |
| D8 | ~~会话列表按 `agent === "octo_insight"` 过滤;建会话补 `agent` 配套~~ **本期降级:不过滤,列目录下全部会话**。原因:v2 `session.create` 不收 `agent`、v2 `Session` 类型不暴露 `agent`;外网 opencode 为 Zod schema、`Session.Info` 无 `agent` 字段([session.ts:118](../../../packages/opencode/src/session/session.ts#L118)),写了也是 no-op。agent 过滤推迟为**单独工作项**(参考 UXAI [sidebar.tsx:147](../../../packages/app/octoapp/pages/_shell/sidebar.tsx#L147) 已实现),见 §10 | 调整 |
| D9 | 其余 UI 细节参考 UX AI | 锁定 |
| D10 | 两仓 agent 名统一为 `octo_insight`(详见 §11.2);取代 §10.4 "无需改名" | 锁定 |
| D11 | InsightSessionList 与 UX AI 会话列表 **1:1**(移植完整版状态点,经同源 opencode 子系统驱动,详见 §11.3);取代 §3"简版自包含" + D8"不过滤" | 锁定 |

---

## 2. 抽取边界:从 `_shell/sidebar.tsx` 拆什么

当前 [_shell/sidebar.tsx](../../../packages/app/octoapp/pages/_shell/sidebar.tsx)(469 行)混了三类东西:

| 区块 | 行号 | 归属 | 处置 |
|---|---|---|---|
| Insight 会话段(列表 / 新建 / 重命名 / 删除 / 右键菜单 / 折叠 / active 高亮) | 54-122, 142-282 | **insight 专属** | **搬进 insight 模块** |
| Octo Make 段(占位"即将上线") | 284-315 | make | 删(非我方范围;由 make 模块自带) |
| 底部 技能库 / 资产库 / 设置 | 318-379 | 产品级 chrome | **不归我方**:由同事拆共享组件(D7),本期保留现状不动 |
| 右键上下文菜单实现 | 381-465 | 跟随 Insight 会话段 | 随会话段搬进 insight |

**我方本期实际只抽一件事:Insight 会话段。** 抽完后 **`_shell` 内不应再出现任何 `/insight` 字面量或 `octo_insight` agent 逻辑**——这是"shell 退化为纯壳"的验收红线。

---

## 3. 侧栏组合形态

布局 `[侧栏: 项目选择器(顶, D5) + 会话列表(中, agent 级) + 底部导航(底, D7)] + [主区]`。除"会话列表"外,侧栏其余部分(选择器、底部导航、框架/拖拽)都是**产品级共享 chrome,由同事拆为 `components/` 组件**(D5 / D7),不归我方本期。

**组合方式:共享 chrome 组件以 children 接收 agent 会话段**(组合,而非 slot/Portal 机制):

```
<SharedSidebar>          {/* 同事的共享组件:选择器(顶) + {children}(中) + 底部导航(底) + 框架拖拽 */}
  <InsightSessionList /> {/* 我方:从 _shell/sidebar.tsx 抽出的会话段 */}
</SharedSidebar>
```

业界类比:就是"共享 Layout 组件 + 页面传 children"的常规组合(类 shadcn slot / 各页 import 共享 Header),不引入中心化注册表(VS Code activity bar 那种重机制,本场景不需要)。

**我方本期产出**:`pages/insight/components/session-list/`——把 [_shell/sidebar.tsx](../../../packages/app/octoapp/pages/_shell/sidebar.tsx) 的 Insight 会话段(列表 / 新建 / 重命名 / 删除 / 右键 / 折叠 / active 高亮)抽成自包含组件,对外零参数即可渲染(内部自取 `globalSDK / globalSync`,这俩在 `AppBaseProviders` 全局层,搬出后照样拿得到)。

**共享 chrome 未就绪前的过渡**:`_shell/sidebar.tsx` 暂保留为框架(底部导航现状不动),但把 Insight 会话段替换为 `import { InsightSessionList }`——即 shell 只负责"摆位置",不再持有 insight 逻辑(满足 §2 验收红线)。待同事的 `SharedSidebar` 落地,再把框架换成它,`_shell/sidebar.tsx` 退场。

> 对 UX AI 同理:他们的 shell 也只是 `import` 我方(随同步带过去的)`InsightSessionList` 摆进侧栏,不再在自己 sidebar 里写 insight 会话逻辑。

---

## 4. 模型选择切 useLocal(D2)

**现状**:[insight/index.tsx:68-77](../../../packages/app/octoapp/pages/insight/index.tsx#L68-L77) 自挂 `ModelsProvider + LocalProvider + InsightModelSelectionProvider`,主流程读 [store/model-selection.tsx](../../../packages/app/octoapp/pages/insight/store/model-selection.tsx) 的隔离 store。该 store 的 `current()` 只认 `saved.model`、**无回退链**,是"初次用户显示未选却已可发送"偶现 bug 的根因。

**改法**(对齐 UX AI make 的 [a9cf53f](#) 做法)—— ✅ **PR1 已完成**:
- 删除 `store/model-selection.tsx` 及 `InsightModelSelectionProvider`
- 主流程改用 `useLocal().model`(已有 `LocalProvider`);`current()` 自带 会话级→agent 默认→全局兜底 回退链,初次进入不再空
- 标签处直接 `useLocal().model.current()?.name`;[971d9ed](#) 临时加的 `label()` / 持久化 name 随隔离 store 一并删除(它本就是过渡补丁)
- 发送链路同步改读 `useLocal().model.current()`

> **"默认取模型清单第一项"已自动满足**:`current()` 兜底链末级 `defaultModel()`([local.tsx:156](../../../packages/app/octoapp/context/local.tsx#L156))= "provider 配置的默认 → 否则该 provider 第一个模型",切到 useLocal 即免费获得"什么都没选时落到第一个可用模型",无需额外代码。
>
> 残留:冷刷新、providers 未连接的那一帧两种方案都可能短暂空 → 属于 provider 连接窗口,非本 bug,不在本期处理。

---

## 5. 落地页 = 聊天框(D3,无需改动)

被废弃的"首页"是 cowork 专属的项目落地页;我方 insight 无 session 时本就直接进空会话态([index.tsx:929-1058](../../../packages/app/octoapp/pages/insight/index.tsx#L929-L1058):插画 + 标题 + 预置提示词 + 大输入框),已与标准 Agent 行为一致。**本期不动 insight 空态。**

---

## 6. 新建对话懒创建(D4)

我方 [handleSubmit:562-566](../../../packages/app/octoapp/pages/insight/index.tsx#L562-L566) 已是懒创建。搬进 insight 的会话段"新建"按钮保持 `navigate("/insight")`(跳空页),**不 eager `session.create`**。UX AI cowork sidebar 当前点新建即建记录,合入我方独立模块后该 bug 自动修复。验收:点新建 → 空会话页 → 无 session 记录 → 发首条消息后才出现记录。

---

## 7. shell 对外契约(给 UX AI / 任意宿主)

宿主 shell 挂载 insight 只需:

1. **路由**:`/insight/:id?` → insight 模块入口
2. **顶部 tab**(可选):指向 `/insight`
3. **全局 context**:`globalSDK / globalSync`(上游已有)、`LocalProvider`(模型选择)
4. **桌面壳 API**:见 [intranet-handoff.md §1.6](../../intranet-handoff.md)
5. **共享 chrome 组件**:底部导航 / 项目选择器由 `components/` 提供(D5 选择器待同事改造)

宿主**不需要**:在自己的 sidebar 里写任何 insight 会话逻辑(这是与现状最大的差别,也是去耦合的关键)。

---

## 8. 同步影响(intranet-handoff)

- `/insight` 路由回指我方 insight 模块,UX AI 侧 **cowork fork 废弃**(`octoapp/pages/cowork/` 停用;其中 project-info / project-product-select 由同事迁 `components/`,不随 insight 同步)
- `InsightSessionList` 在 `pages/insight/` 目录内,随 insight 模块演进
- `_shell/sidebar.tsx`(改为 import 会话段组件)是 insight 自研壳层代码;UXAI 用自己的 shell,本节为本地壳设计参考

---

## 9. 实施步骤(建议 PR 拆分)

1. **PR1 模型切 useLocal** ✅ **已完成**:删隔离 store + `InsightModelSelectionProvider`,主流程/标签/发送改 `useLocal().model`(初次进入不空靠兜底链 `defaultModel()` 取第一个可用模型,见 §4)。~~`createAndNavigate` 建会话补 `agent`~~ **已取消**:v2 `session.create` 不收 `agent` 且对模型回退无收益(octo_insight.md frontmatter 无 `model` 字段,agent 默认层本就为空)。typecheck(tsgo)+ build(vite)双门禁通过
2. **PR2 抽会话段** ✅ **已完成(简版)**:Insight 会话段 → `pages/insight/components/session-list/`(自包含、零参数);`_shell/sidebar.tsx` 改为 `import` 该组件摆位;验收 `_shell` 无 `/insight` 字面量。⚠️ **D11 要把它升级为与 UX AI 1:1(完整状态点 + agent 过滤),见 §11.3**
3. **PR3(待依赖)** 接入同事的 `SharedSidebar` / 选择器共享组件,`_shell/sidebar.tsx` 退场——等共享组件就绪再做
4. 各 PR 自动验证(typecheck + build)后合入 dev,里程碑级再触发 octo-sync

---

## 10. 遗留 / 依赖项(非阻塞,本期不解决)

> §1.2 的开放问题已全部拍定(落地页不动、底部导航与选择器都归同事、会话按 agent 过滤)。以下是依赖外部产出、本期无法闭环的项:

1. **项目/产品选择器组件**(D5):依赖同事拆出的 `components/` 共享组件 + 全局 Store,就绪后引入
2. **底部导航 / SharedSidebar 框架组件**(D7):依赖另一同事拆出,就绪后 PR3 接入,`_shell/sidebar.tsx` 退场
3. 两者的对外接口(props / children 约定)定形后,回填本 spec §3 与 §7
4. **会话按 agent 过滤**(D8 降级项):**单独工作项,本期不做**。背景:外网 octo-agent 与内网 UXAI 的 opencode 是**两套架构**——外网为上游 Zod schema、`Session` 无 `agent` 字段;内网为 fork 后的 Effect `Schema` + SQLite + category 系统,`Session.agent` 为一等字段,UXAI 已实现 `create({ agent })` + `filter(s => s.agent === "octo_insight")`([sidebar.tsx](../../../packages/app/octoapp/pages/_shell/sidebar.tsx))。
   - **不为此升级 opencode**:该能力是内网 fork 定制,非上游;搬进外网会破坏 `main = 纯 opencode` 治理前提与 `packages/opencode/ 不动` 政策,且当前无功能在等它。
   - **实现建议(将来做时)**:写成对版本差异**优雅降级**的过滤,同一份源码 rsync 两边都正确——
     ```ts
     // 外网老版 server 不返回 agent → s.agent 为 undefined → 不被过滤掉(列全部)
     // 内网新版 server 带 agent → 精确匹配
     sessions.filter((s) => !s.agent || s.agent === "octo_insight")
     ```
   - **agent 命名**:~~因本期不写 agent 过滤,无需改名~~ → **已改:见 §11.2(D10 决定统一为 `octo_insight`)**。

---

## 11. 本轮 review 修订(覆盖上文相关条目)

> review PR1/PR2 后与作者确认的调整。**与上文冲突处,以本节为准。**

### 11.1 壳清理(已做)
topbar tab `Cowork`→`Insight`([topbar.tsx](../../../packages/app/octoapp/pages/_shell/topbar.tsx));删 sidebar `Octo Make` 段及其专用 `PlusIcon`([sidebar.tsx](../../../packages/app/octoapp/pages/_shell/sidebar.tsx))。
**关键认识**:`_shell`(topbar/sidebar 框架)是**本地开发壳,不同步给 UXAI**——UXAI 用自己的 shell,我方仅 `pages/insight/**` 同步。故壳子改动只为本地 dev 观感,非合入物。

### 11.2 D10 — agent 名两仓统一 `octo_insight`(取代 §10.4 末"无需改名")
- 改 2 处:[octo_insight.md](../../../packages/opencode/src/agent/prompt/octo_insight.md) frontmatter `name: insight`→`octo_insight`;[index.tsx:475](../../../packages/app/octoapp/pages/insight/index.tsx#L475) `const agent = "insight"`→`"octo_insight"`。(`[data-page="insight"]` CSS 属性与 agent 无关,**不动**。)
- 本地 opencode **按 frontmatter `name` 注册**([agent.ts:269](../../../packages/opencode/src/agent/agent.ts#L269)),改即生效。
- **不写 octo-sync transform**(改写源码字符串脆弱);统一字面量后 rsync 天然一致。消除"发的 agent 名 ≠ server 注册名 → server 不起轮 → 发送无反馈"的合入隐患。

### 11.3 D11 — InsightSessionList 与 UX AI 会话列表 1:1(取代 §3"简版" + PR2 现状)
目标:本地调试即内网形态。移植 UX AI 完整会话列表——新建行、状态点(工作中 `Spinner` / 未读 / 权限 / 错误)。
- **依赖全部已在我方仓库(同源 opencode,非 fork 专属)**:[notification.tsx](../../../packages/app/octoapp/context/notification.tsx)(`session.unseenCount/unseenHasError`)、[permission.tsx](../../../packages/app/octoapp/context/permission.tsx)、[global-sync.tsx](../../../packages/app/octoapp/context/global-sync.tsx)(`children.child()`)、[ui Spinner](../../../packages/ui/src/components/spinner.tsx)、[sessionTitle](../../../packages/app/octoapp/utils/session-title.ts)。
- **1:1 同步的前提 = 两 fork 的 context/SDK API 表面一致**(否则"逐字 rsync 两边都对"不成立)。差异两类:① 数据层 `Session.agent`(下面优雅降级吸收,真 1:1);② context API 可能不同名(例 UX AI `permission.autoResponds(...)` ↔ 我方 [`autoRespondsPermission(...)`](../../../packages/app/octoapp/context/permission.tsx))。**实施第一步:逐个 context 调用核对两仓是否同名同签**——同名→真 1:1 同步;不同名→对齐 API,或把该调用收进 `pages/insight/lib/` 薄适配层。目标是「1:1 源码 + 极小受控适配面」,**不是天真逐字拷贝**(会在另一仓跑不起来)。
- **agent 过滤(取代 D8"不过滤")**:用 §10.4 的优雅降级 `sessions.filter(s => !s.agent || s.agent === "octo_insight")`——统一名后两边都正确。
- **UI 素材**:缺 `/insightIcon.svg`,补任意占位图标即可(设计师后改),不阻塞。

### 11.4 执行
D10 + D11 改动集中在 `pages/insight/`,**新开对话实施**(本 review 对话不动业务码,避免与实现线冲突)。新对话入口:"实施 SPEC-INS-010 §11:agent 改名 octo_insight + InsightSessionList 升级到与 UXAI 1:1"。
