# UXAI 前端入口与路由组成 —— 哪个文件是「活」的,改路由别改错

> 面向:要在 UXAI 仓(octo-agent 的下游集成仓)改前端路由 / Provider / 壳的人。
> 一句话:**entry.tsx → `@/app` = `app.tsx` 才是活路由;同目录的 `octo.tsx` 是历史重复副本,死文件,改它白改。**

UXAI 前端在 `packages/app/octoapp/`。本文把「入口链 → 哪个文件被真正加载 → dev sandbox 路由怎么注册」讲清楚,并复盘一次「改错文件」的踩坑,给出快速诊断法。

---

## 1. 入口链:从 HTML 到路由表

```
index.html
  └─ <script> entry.tsx
        └─ render(<AppInterface defaultServer=... disableHealthCheck/>, #root)
              └─ AppInterface 内部:
                   ServerProvider → ConnectionGate → ServerKey → QueryProvider
                     → GlobalSDKProvider → GlobalSyncProvider
                       → <Dynamic component={Router} root={RouterRoot}>
                            <Route path="/" .../>
                            <Route path="/insight/:id?" .../>
                            ...路由表...
```

关键:`entry.tsx` 顶部

```ts
import { AppBaseProviders, AppInterface } from "@/app"
```

`@/` 别名指向 `packages/app/octoapp/`,所以 `@/app` 解析到 **`app.tsx`**。路由表(`<Route>` 列表)、`RouterRoot`、`AppInterface` 全在 `app.tsx`。

## 2. 陷阱:`octo.tsx` 是 `app.tsx` 的死副本

`packages/app/octoapp/` 下同时存在:

| 文件 | 状态 | 说明 |
|---|---|---|
| `app.tsx` | **活** | `entry.tsx` 实际导入的就是它,路由在这里生效 |
| `octo.tsx` | **死** | 与 `app.tsx` 高度重复的历史副本,**没有任何入口 import 它** |

两个文件都有 `export function AppInterface`、都有几乎一样的 `<Route path="/insight/:id?" ...>` 路由块,肉眼极易认错。改 `octo.tsx` 不会有任何运行时效果(连 HMR 都不会触发,因为模块根本没进依赖图)。

### 怎么确认哪个是活的

```bash
# 1) 看入口导入的是哪个
grep -n "from \"@/app\"" packages/app/octoapp/entry.tsx
#   → @/app === app.tsx

# 2) 反查谁 import 了 octo
grep -rn "pages\|octo" packages/app/octoapp/entry.tsx
grep -rn "@/octo\|\"./octo\"" packages/app/octoapp   # 一般搜不到 → 死文件
```

> 现状是技术债:理想是删掉 `octo.tsx`,但删除需单独确认(本文只记录,不擅自删)。

## 3. 踩坑复盘:dev 路由加进了死文件

迁移 insight dev sandbox(`pages/insight/__dev/*`)时,把路由注册写进了 `octo.tsx`。表现:

- `/insight/__dev` 不显示 dev 索引页,而是空白的 InsightPage(被 `/insight/:id?` 兜底匹配,`id="__dev"`,无会话 → 空态)。
- 改 `octo.tsx` 后刷新无变化。

### 决定性诊断法:模块顶层探针

在改动的模块顶层加一行:

```ts
console.log("[diag] DEV =", import.meta.env.DEV)
```

用 Playwright(或浏览器)抓 console。**这行没打印 = 该模块根本没被加载** → 说明改错了文件。果然:`octo.tsx` 的探针从不打印,而 app 正常工作 → 活的是别的文件(`app.tsx`)。

> 经验:遇到「改了代码却毫无效果」,先证明「我改的模块到底有没有被加载」,再去想逻辑对不对。顶层 `console.log` 是最快的判活探针。

## 4. dev sandbox 路由的正确注册(在 `app.tsx`)

dev 预览页集中在 `pages/insight/__dev/`,由 `routes.tsx` 聚合导出 `insightDevRoutes()`(返回一组 `<Route>`)。在 **`app.tsx`** 的 `<Router>` children 里挂载:

```tsx
import { insightDevRoutes } from "@/pages/insight/__dev/routes"
// ...
<Route path="/cowork" component={() => <Navigate href="/insight" />} />
{/* DEV-ONLY:静态段 /insight/__dev 优先于 :id?,且仅 dev 注册;生产为死代码 */}
{import.meta.env.DEV && insightDevRoutes()}
<Route path="/insight/:id?" component={InsightPage} />
```

三层隔离:

1. **构建隔离**:`import.meta.env.DEV` 在生产被静态替换为 `false` → 调用成死代码 → `routes.tsx` 及其 lazy chunk 被 Rollup 摇树掉,不进 bundle。
2. **路径/排序**:solid-router 按 score 选路由,**静态段 > 动态参数段**。两段静态的 `/insight/__dev` 分数高于 `/insight/:id?`(第二段是参数),所以同前缀也能正确胜出——**前提是注册在活文件里**。当初「输给」`:id?` 不是排序问题,纯粹是写进了死文件没注册。
3. **壳复用**:`app.tsx` 的 `RouterRoot.isOctoPage()` 命中 `/insight/__dev`(`startsWith("/insight/")`)→ dev 页带 `OctoSidebarLayout` 渲染在内容区,复用 UXAI 自己的壳。

## 5. 与 octo-agent `_dev` 决策的关系

octo-agent 仓的 `pages/insight/_dev/`:走自带的 `LocalShell` + 顶级 `/_dev/*` 路由,且 **octo-sync 排除 `_dev`、明文不合入 UXAI**(`_dev/shell/index.tsx` 注释)。

UXAI 这套是**迁移副本**,按既定决策:

- **不搬 `LocalShell` / topbar**——UXAI 用自己的壳(`app.tsx` 的 `RouterRoot` / `OctoSidebarLayout`)。
- 路由收敛到 `/insight/__dev/*` 命名空间(而非顶级 `/_dev`)。
- `file-fallback-preview` 原本 `import multi-agent.md?raw` 做「另存为」内容,UXAI 无此文件 → 改为内联示例文本。

## 6. checklist:在 UXAI 改前端前

- [ ] 改路由 / Provider / 壳 → 认准 **`app.tsx`**(不是 `octo.tsx`)。
- [ ] 「改了没效果」→ 先加顶层 `console.log` 判活,别急着 debug 逻辑。
- [ ] dev-only 代码 → `import.meta.env.DEV` 守卫 + 独立模块,确保生产摇树。
- [ ] insight 相关尽量自包含在 `pages/insight/`;只有路由注册这类必须落中心文件(`app.tsx`),与 octo-agent 在 `app.tsx` 注册 `devRoutes()` 的做法一致。
