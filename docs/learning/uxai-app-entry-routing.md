# UXAI 前端入口与路由组成 —— 两个入口都是活的,别再当"死副本"

> 面向:要在 UXAI 仓(octo-agent 的下游集成仓)改前端路由 / Provider / 壳的人。
> 一句话:**`app.tsx` 与 `octo.tsx` 是两个平行入口 —— 浏览器/Playwright 走 `app.tsx`,Electron 走 `octo.tsx`。改路由通常要改两份。**

> ⚠️ **本文 2026-07-29 大幅更正。** 旧版断言「`octo.tsx` 是历史重复副本、死文件、改它白改」,**这是错的**,并且直接导致了后续一系列误判(dev 路由被认为"注册在死文件里"、桌面端生产包多带 78KB 预览代码没人发现)。更正依据见 §2 的完整入口链取证。

UXAI 前端在 `packages/app/octoapp/`。本文把「两条入口链各自加载哪个文件 → dev sandbox 路由怎么注册 → 生产怎么摇干净」讲清楚,并复盘那次错误推论。

---

## 1. 两条入口链

```
【浏览器 / Playwright】
packages/app/index.html
  └─ <script src="/octoapp/entry.tsx">
        └─ entry.tsx: import { AppInterface } from "@/app"     ← @/ = octoapp/
              └─ app.tsx                     ★ 活
                    router = 默认 Router(history 模式,有地址栏)

【Electron 渲染进程】
packages/desktop/src/renderer/index.tsx
  └─ import { AppInterface } from "@opencode-ai/app"
        └─ packages/app/src/index.ts:  export * from "../octoapp"
              └─ packages/app/octoapp/index.ts:  export { AppInterface } from "./octo"
                    └─ octo.tsx                ★ 也是活的
                          router = HashRouter(显式传入,无地址栏)
```

两条链**互不相交**:`entry.tsx` 只碰 `app.tsx`,desktop renderer 只碰 `octo.tsx`。

Playwright 也走浏览器那条 —— `playwright.config.ts` 的 `webServer.command` 是 `bun run dev`(即 `packages/app` 的 vite dev,:3000),所以 e2e 看到的是 `app.tsx` 的路由表。

## 2. 取证:怎么确认哪个是活的

```bash
# 浏览器入口
grep -n 'from "@/app"' packages/app/octoapp/entry.tsx      # → @/app = app.tsx

# Electron 入口(关键:要顺着 package 边界一路查下去,别只在 octoapp/ 里 grep)
cat packages/app/octoapp/index.ts                          # → export ... from "./octo"
cat packages/app/src/index.ts                              # → export * from "../octoapp"
grep -n '@opencode-ai/app' packages/desktop/src/renderer/index.tsx
```

**旧版就是漏了后三条。** 只在 `packages/app/octoapp/` 内部 grep `"./octo"`,搜不到 → 误判死文件。真正的引用发生在**跨 package 的 re-export 链**上(`octoapp/index.ts` → `src/index.ts` → package `exports` 字段 → 另一个 package),单目录 grep 天然看不见。

### 两份不是等价副本

同一天(2026-05-09,commit `0ed6a080e`)一起创建,之后走岔了:

| | `app.tsx` | `octo.tsx` |
|---|---|---|
| 行数 | 437 | 667 |
| 近 3 个月提交 | 14 | **45** |
| 独有内容 | — | `ForceLightScheme`、`OnboardingLayer`、`FocusModeResetHandler`、`PatternPage` 路由、`InsightSidebarLayout` / `SkillsSidebarLayout`、`ResponsiveSidebarLayout`、侧栏宽度持久化 |

即 **`app.tsx` 是一份掉队的分叉**,不是死文件。后果:同一个页面在浏览器里和在 Electron 里壳可能不一样(主题、侧栏、onboarding),**拿浏览器验 UI 会被误导**,这正是"新 UI 验证不了"的根因之一。

> 技术债:理想是合并成单一 app root,平台差异走已有的注入点(`AppInterface` 收 `router` prop、`PlatformProvider` 注入平台能力)—— 这也是 Electron+Web 双端的业界标准形态(VS Code / Linear / Slack 都是单 root + 适配注入)。**本文只记录,合并需单独拍板。**

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

## 4. dev sandbox 路由的正确注册(两个入口都要挂)

dev 预览页集中在 `pages/insight/__dev/`,由 `routes.tsx` 聚合导出 `insightDevRoutes()`(返回一组 `<Route>`)。**`app.tsx` 和 `octo.tsx` 都要挂**,否则该端访问不到。

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
2. **路径/排序**:solid-router 按 score 选路由,**静态段 > 动态参数段**。两段静态的 `/insight/__dev` 分数高于 `/insight/:id?`,同前缀也能正确胜出 —— 前提是在**该入口**注册了。当初「输给」`:id?` 不是排序问题,是浏览器那份没注册。
3. **壳复用**:两端都让 dev 页裸渲染(dev 页本身是 `size-full` 自包含容器)。`octo.tsx` 对 insight 页本来就不套侧栏;`app.tsx` 会把 `/insight/*` 套进 `OctoSidebarLayout`,所以用模块级 `isInsightDevPath` 让 `/insight/__dev*` 跳过它 —— 否则浏览器里会多出一条旧侧栏,两端看到的壳不一致。

### Electron 端怎么进 dev 页

Electron 用 `HashRouter` 且没有地址栏,DevTools console 里:

```js
location.hash = "#/insight/__dev"
```

## 5. 与 octo-agent `_dev` 决策的关系

octo-agent 仓的 `pages/insight/_dev/`:走自带的 `LocalShell` + 顶级 `/_dev/*` 路由,且 **octo-sync 排除 `_dev`、明文不合入 UXAI**(`_dev/shell/index.tsx` 注释)。

UXAI 这套是**迁移副本**,按既定决策:

- **不搬 `LocalShell` / topbar** —— UXAI 用自己的壳。
- 路由收敛到 `/insight/__dev/*` 命名空间(而非顶级 `/_dev`)。
- `file-fallback-preview` 原本 `import multi-agent.md?raw` 做「另存为」内容,UXAI 无此文件 → 改为内联示例文本。

## 6. checklist:在 UXAI 改前端前

- [ ] 改路由 / Provider / 壳 → **两个入口都要看**(`app.tsx` 浏览器 · `octo.tsx` Electron),别默认只改一份。
- [ ] 判活结论只写"不在 X 入口的图里";要断言"死文件",先枚举全部入口 + 跨 package re-export 链。
- [ ] Electron 端判活/调试要在 Electron DevTools 里抓,浏览器 console 看不到。
- [ ] dev-only 代码 → 守卫写在 JSX 之外 + lazy 写在函数体内,**改完必须跑一次生产构建数 chunk**,别信"应该会摇掉"。
- [ ] insight 相关尽量自包含在 `pages/insight/`;只有路由注册这类必须落中心文件。
