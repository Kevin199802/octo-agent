# UXAI 前端入口与路由组成 —— 两条入口链,一个 root

> 面向:要在 UXAI 仓(octo-agent 的下游集成仓)改前端路由 / Provider / 壳的人。
> 一句话:**两条入口链(浏览器 / Electron)共用唯一 root `octo.tsx`,平台差异走 `router` prop 与 `PlatformProvider`。**

> ⚠️ **本文经历过两次实质变更,读旧引用时注意时间:**
> - 最初断言「`octo.tsx` 是历史重复副本、死文件、改它白改」——**错的**,直接导致后续一系列误判
>   (dev 路由被认为"注册在死文件里"、桌面生产包多带 78KB 预览代码没人发现)。取证见 §2。
> - 2026-07-29 **两份 root 已归一**(UXAI PR #474):删除 `octoapp/app.tsx`,`entry.tsx` 改指 `@/octo`。
>   §1 已按归一后重写;§3 的漂移复盘作为历史教训保留。

UXAI 前端在 `packages/app/octoapp/`。本文把「两条入口链怎么汇到同一个 root → dev sandbox 路由怎么注册 → 生产怎么摇干净」讲清楚,并复盘那次错误推论和随之而来的两个月漂移。

---

## 1. 两条入口链,同一个 root

```
【浏览器 / Playwright】
packages/app/index.html
  └─ <script src="/octoapp/entry.tsx">
        └─ entry.tsx: import { AppInterface } from "@/octo"    ← @/ = octoapp/
              └─ octo.tsx  ★ 唯一 root
                    router 不传 → 默认 Router(history 模式,有地址栏)

【Electron 渲染进程】
packages/desktop/src/renderer/index.tsx
  └─ import { AppInterface } from "@opencode-ai/app"
        └─ packages/app/src/index.ts:  export * from "../octoapp"
              └─ packages/app/octoapp/index.ts:  export { AppInterface } from "./octo"
                    └─ octo.tsx  ★ 同一个
                          router={HashRouter}(显式传入,无地址栏)
```

**平台差异只走两个注入点,不要为此复制 root**:

| 差异 | 注入点 |
|---|---|
| 路由模式(history / hash) | `AppInterface` 的 `router` prop |
| 壳能力(IPC、文件对话框、存储、剪贴板、标题栏) | `PlatformProvider`(`platform: "web" \| "desktop"`) |

> **上游那份 root 不在 `octoapp/` 里**,是 `packages/app/src/app.tsx`(330 行,原封未动)。
> 隔离上游靠 `src/` 与 `octoapp/` 的**目录分离**,跟 `octoapp/` 里有几个 root 无关 ——
> 「为了不动上游所以要留两份 root」这个理由不成立(归一时确认过)。

两条链**互不相交**:`entry.tsx` 只碰 `app.tsx`,desktop renderer 只碰 `octo.tsx`。

Playwright 也走浏览器那条 —— `playwright.config.ts` 的 `webServer.command` 是 `bun run dev`(即 `packages/app` 的 vite dev,:3000)。归一后 **e2e 看到的就是交付形态的路由表**。

## 2. 取证:怎么确认某个 root 是不是活的

归一后只剩一个 root,但这套取证方法要留着 —— 它是当初误判的解药,以后遇到同类问题还用得上。

```bash
# 浏览器入口
grep -n 'from "@/octo"' packages/app/octoapp/entry.tsx

# Electron 入口(关键:要顺着 package 边界一路查下去,别只在 octoapp/ 里 grep)
head packages/app/octoapp/index.ts                         # → export ... from "./octo"
head packages/app/src/index.ts                             # → export * from "../octoapp"
grep -n '@opencode-ai/app' packages/desktop/src/renderer/index.tsx
```

**当初就是漏了后三条。** 只在 `packages/app/octoapp/` 内部 grep `"./octo"`,搜不到 → 误判死文件。真正的引用发生在**跨 package 的 re-export 链**上(`octoapp/index.ts` → `src/index.ts` → package `exports` 字段 → 另一个 package),单目录 grep 天然看不见。

### 历史:两份 root 漂移了两个多月

`octoapp/app.tsx` 与 `octo.tsx` 同一天(2026-05-09,commit `0ed6a080e`)创建,之后走岔:

| | `app.tsx` | `octo.tsx` |
|---|---|---|
| 行数 | 437 | 667 |
| 近 3 个月提交 | 14 | **45** |
| 独有内容 | — | `ForceLightScheme`、`OnboardingLayer`、`FocusModeResetHandler`、`PatternPage` 路由、`InsightSidebarLayout` / `SkillsSidebarLayout`、`ResponsiveSidebarLayout`、侧栏宽度持久化 |

`app.tsx` 是一份**掉队的分叉**(不是死文件)。后果:同一个页面在浏览器和 Electron 里壳不一样(主题、侧栏、onboarding),**拿浏览器验 UI 会被误导** —— 这正是当时"新 UI 验证不了"的根因之一。

**2026-07-29 归一**(UXAI PR #474):`entry.tsx` 改指 `@/octo`,删除 `octoapp/app.tsx`。平台差异走已有注入点,这也是 Electron+Web 双端的业界标准形态(VS Code / Linear / Slack 都是单 root + 适配注入)。

归一唯一的行为变更落在 **opencode CLI 内嵌的那个 web UI** 上(`script/build.ts` 会 build `packages/app` 并把 `dist/**` 嵌进二进制):`/` 改为重定向到 `/make`,并多出 onboarding、强制浅色、`/pattern` 路由 —— 即它从旧版跟上了交付版。Electron 端无变化。

> **留下的教训:平台差异优先找现成注入点,复制 root 是最贵的解法。**
> 一旦复制,漂移是必然的(没有任何机制会提醒你"另一份也要改"),而漂移的代价会以
> 「验证结果不可信」这种很难归因的形式出现,拖很久才被发现。

## 3. 踩坑复盘:一个正确的观测 + 一个错误的推论

迁移 insight dev sandbox(`pages/insight/__dev/*`)时把路由只注册进了 `octo.tsx`。表现:浏览器访问 `/insight/__dev` 不是 dev 索引页,而是空白 InsightPage(被 `/insight/:id?` 兜底,`id="__dev"`,无会话 → 空态)。

当时用了「模块顶层探针」诊断:

```ts
console.log("[diag] DEV =", import.meta.env.DEV)   // 加在 octo.tsx 顶层
```

浏览器抓不到这行 → 结论「`octo.tsx` 是死文件」。

**观测没错,推论错了。** 顶层探针没打印,只能证明**该模块不在当前这个入口的依赖图里**;要证明它全局是死的,必须把**所有入口**都枚举一遍。这里恰好还有第二个入口(Electron),探针在那边是会打印的。

> 经验修正:「改了没效果」先判活没问题,但判活的结论要写成 **"它不在 X 入口的图里"**,不能直接写成 **"它是死文件"**。多入口项目里,这两句话差得很远。
>
> 判活探针要在**目标运行环境**里抓:Electron 端得开 DevTools 看渲染进程 console,不能只看浏览器。

## 4. dev sandbox 路由的注册(归一后只挂一处)

dev 预览页集中在 `pages/insight/__dev/`,由 `routes.tsx` 聚合导出 `insightDevRoutes()`(返回一组 `<Route>`)。归一后**只在 `octo.tsx` 挂一次**,浏览器与 Electron 两端都生效。

```tsx
import { insightDevRoutes } from "@/pages/insight/__dev/routes"

// 守卫必须写在 JSX 之外 —— 原因见 solid-jsx-blocks-import-meta-env-treeshaking.md
const insightDevRoutesOrNone = import.meta.env.DEV ? insightDevRoutes : () => null

// ...路由表内
<Route path="/cowork" component={() => <Navigate href="/insight" />} />
{insightDevRoutesOrNone()}
<Route path="/insight/:id?" component={InsightPage} />
```

三层隔离:

1. **构建隔离**:生产构建里 `insightDevRoutesOrNone` 折叠成 `() => null`,`routes.tsx` 及全部 lazy chunk 被 Rollup 摇掉。
   ⚠️ 这件事**比看起来难**,`{import.meta.env.DEV && insightDevRoutes()}` 这种直觉写法**不生效**(旧版本文断言它生效,是错的;实测桌面生产包一直带着 78KB 预览代码)。必须同时满足两个条件,机制见
   [solid-jsx-blocks-import-meta-env-treeshaking.md](solid-jsx-blocks-import-meta-env-treeshaking.md)。
2. **路径/排序**:solid-router 按 score 选路由,**静态段 > 动态参数段**。两段静态的 `/insight/__dev` 分数高于 `/insight/:id?`,同前缀也能正确胜出。当初「输给」`:id?` 不是排序问题,是浏览器那份 root 压根没注册。
3. **壳复用**:`/insight/__dev` 命中 `octo.tsx` 的 `isInsightPage()`,裸渲染(insight 页本就不套侧栏;dev 页本身是 `size-full` 自包含容器)。归一前浏览器那份会把 `/insight/*` 套进 `OctoSidebarLayout`、多出一条旧侧栏,需要额外判断跳过;归一后两端天然同壳,那段判断已随 `app.tsx` 一起删除。

### 怎么进 dev 页

**浏览器**(`bun run dev:web`):地址栏直接输 `http://localhost:3000/insight/__dev`。

**Electron**:用 `HashRouter` 且没有地址栏,DevTools console 里:

```js
location.hash = "#/insight/__dev"
```

⚠️ **别用 `history.pushState` + `dispatchEvent(new PopStateEvent(...))`** —— 两个独立原因都让它无效:
`HashRouter` 的路由源是 `window.location.hash.slice(1)`(不读 pathname),且它监听的是 `hashchange` 而非 `popstate`。
赋值 `location.hash` 会自动触发原生 `hashchange`,不需要手动派发。

## 5. 与 octo-agent `_dev` 决策的关系

octo-agent 仓的 `pages/insight/_dev/`:走自带的 `LocalShell` + 顶级 `/_dev/*` 路由,且 **octo-sync 排除 `_dev`、明文不合入 UXAI**(`_dev/shell/index.tsx` 注释)。

UXAI 这套是**迁移副本**,按既定决策:

- **不搬 `LocalShell` / topbar** —— UXAI 用自己的壳。
- 路由收敛到 `/insight/__dev/*` 命名空间(而非顶级 `/_dev`)。
- `file-fallback-preview` 原本 `import multi-agent.md?raw` 做「另存为」内容,UXAI 无此文件 → 改为内联示例文本。

## 6. checklist:在 UXAI 改前端前

- [ ] 改路由 / Provider / 壳 → 只有 `octo.tsx` 一个 root,改它;**不要为平台差异新建第二个 root**,走 `router` prop / `PlatformProvider`。
- [ ] 判活结论只写"不在 X 入口的图里";要断言"死文件",先枚举全部入口 + 跨 package re-export 链。
- [ ] Electron 端判活/调试要在 Electron DevTools 里抓,浏览器 console 看不到。
- [ ] 纯 UI / 样式改动在浏览器验即可(归一后与交付同壳);碰 `window.api` / IPC 的仍须 Electron 验。
- [ ] dev-only 代码 → 守卫写在 JSX 之外 + lazy 写在函数体内,**改完必须跑一次生产构建数 chunk**,别信"应该会摇掉"。
- [ ] insight 相关尽量自包含在 `pages/insight/`;只有路由注册这类必须落中心文件。
