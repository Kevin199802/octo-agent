# Solid 的 JSX 编译挡住 `import.meta.env.DEV` 摇树 —— DEV-only 代码为何还在生产包里

> 面向:在 Solid + Vite 项目里写 dev-only 代码(调试面板、预览沙箱、mock 入口)并希望它**不进生产包**的人。
> 一句话:**`{import.meta.env.DEV && devStuff()}` 这种写法在 Solid 里摇不掉。守卫必须写在 JSX 之外,且 `lazy()` 必须写在函数体内 —— 两个条件缺一不可。**

锚点:UXAI insight dev 预览路由(`pages/insight/__dev/`)。2026-07-29 发现桌面生产包里一直躺着全部预览 chunk,合计 **78KB**(未压缩,不含 sourcemap),尽管代码里明明写了 `import.meta.env.DEV` 守卫。

---

## 1. 现象

```tsx
import { insightDevRoutes } from "@/pages/insight/__dev/routes"
// ...
{import.meta.env.DEV && insightDevRoutes()}     // 看起来天经地义
```

生产构建产物里:`attachment-bar-preview-*.js`、`typography-preview-*.js` …… 一个不少。

而把守卫换成**字面量** `false`,产物就是 0。于是很容易得出错误结论:「Vite 是在打包之后才替换 `import.meta.env.*`,tree-shaking 阶段守卫还不是常量」。

**这个结论是错的**,下面是实测。

## 2. 排除:Vite 的替换时机没问题

Vite 7 的 `vite:define` 插件(`node_modules/vite/dist/node/chunks/dep-*.js`,搜 `name: "vite:define"`)**只有 `transform` 钩子,没有 `renderChunk`**:

```js
return {
  name: "vite:define",
  transform: { async handler(code, id) {
    if (this.environment.config.consumer === "client" && !isBuild) return   // dev 才跳过
    ...
    const result = await replaceDefine(this.environment, code, id, define)  // esbuild define
  } }
}
```

也就是 build 时 `import.meta.env.DEV` **在 transform 阶段就被替换成 `false` 了**,远早于 Rollup 摇树。所以问题不在 Vite。

## 3. 真凶:Solid 给 JSX 里的成员表达式套了一层 memo

看编译产物(隔离复现,`minify: false`):

```js
// 源码: {import.meta.env.DEV && insightDevRoutes()}
memo(() => memo(() => false)() && insightDevRoutes())
//           ^^^^^^^^^^^^^^^^^^ 内层 memo 调用
```

替换**确实发生了**(里面是 `false`),但 `dom-expressions` 把 `import.meta.env.DEV` 当成「可能是响应式的表达式」,**额外包了一层内嵌 memo**。于是 Rollup 面对的是 `memo(() => false)() && insightDevRoutes()` —— 左边是个**运行时函数调用**,静态分析证明不了它是 falsy,右边就不是死代码,`insightDevRoutes` 连同整个 `__dev/` 子树全部保留。

字面量 `false` 之所以能摇掉,是因为 Solid 编译器识别字面量为静态、**不包 memo**,`false && f()` 才是真死代码。

### 为什么插件顺序注定如此

Vite 的 `resolvePlugins()` 里,`definePlugin` 排在 **`...normalPlugins` 之后**;`vite-plugin-solid` 是 normal 插件。所以 **Solid 的 babel 转换先跑**,它看到的永远是没被替换的 `import.meta.env.DEV`。调 `enforce` 也救不了 —— 除非自己写个 `enforce: "pre"` 的替换插件抢在 Solid 前面。

> 推论:**任何成员表达式守卫都会中招**,不只是 `import.meta.env.DEV`。

## 4. 第二个坑:模块顶层的 `lazy()` 是副作用

把守卫修好之后再构建,`/insight/__dev` 路径串消失了(PAGES 和 `insightDevRoutes` 确实被摇掉),**但 preview chunk 还在**。

因为 `routes.tsx` 长这样:

```tsx
const DevIndexPage = lazy(() => import("./index-preview"))     // 模块顶层调用
const CardsDevPage = lazy(() => import("./cards-preview"))
// ...
export function insightDevRoutes() { return PAGES.map(...) }
```

Rollup 把**模块顶层的函数调用**当成潜在副作用:即使 `insightDevRoutes` 整个被摇掉,这些 `lazy(...)` 调用仍被保留 → 里面的 `import()` 仍然成立 → 每个预览页照旧切出一个 chunk。

修法:`lazy()` 和 `PAGES` 一起挪进函数体。函数不可达 → 调用连同 `import()` 一起消失。

```tsx
export function insightDevRoutes(): JSX.Element {
  const PAGES = [
    { path: "/insight/__dev", component: lazy(() => import("./index-preview")) },
    // ...
  ] as const
  return PAGES.map((p) => <Route path={p.path} component={p.component} />)
}
```

## 5. ⚠️ 两个条件是「与」关系 —— 这是最容易白忙一场的地方

|  | 顶层 `lazy()` | 函数体内 `lazy()` |
|---|---|---|
| **JSX 内联守卫** | 泄漏(原始状态) | 泄漏 —— 函数可达,body 里的 import() 全部成立 |
| **JSX 外模块级守卫** | 泄漏 —— 顶层 lazy() 副作用照留 | ✅ **0 字节** |

单独做任何一个,产物都**没有可见变化**,极易得出「这个方向没用」而放弃。UXAI 这次就先后单独试过两边,两次都误判成"卡点不在这"。

**排查口诀:改完必须跑一次真实生产构建数 chunk,不要靠推理。**

## 6. 最终形态

```tsx
// 调用点(app.tsx / octo.tsx):守卫写在 JSX 之外
const insightDevRoutesOrNone = import.meta.env.DEV ? insightDevRoutes : () => null
// ...
{insightDevRoutesOrNone()}
```

模块级三元里的 `import.meta.env.DEV` 不经 Solid 的 JSX 表达式包装,esbuild 在 transform 阶段直接折成 `false`,Rollup 顺利摇掉整棵子树。

验证:

```bash
cd packages/app && rm -rf dist && bun run build
ls dist/assets | grep -ci preview          # → 0
grep -oh "/insight/__dev" dist/assets/*.js | wc -l   # → 0
```

> ⚠️ 别用 `grep 函数名` 验证 —— 生产构建会压缩混淆标识符,搜不到不代表被摇掉了。**数 chunk 文件 + 搜路径字符串(字符串字面量不会被改名)才是可靠证据。**

## 7. 其他做法(实测对比)

同一份隔离复现下都试过:

| 做法 | prod 产物 | 评价 |
|---|---|---|
| JSX 内联 `import.meta.env.DEV &&` | **泄漏** | 直觉写法,不可用 |
| **模块级三元(选用)** | 0 | 零配置,改动最小 |
| `vite.config` 的 `define` 常量 `__DEV_PREVIEW__` | 0 | 也有效 —— 因为**裸标识符**不触发 Solid 的嵌套 memo。但要改两处构建配置(web + electron-vite)且多一个全局标识符,没有额外收益 |
| 虚拟模块插件 | 0 | 隔离最强(生产构建下 `__dev/` 根本不被解析),适合"绝不能泄漏"的场景;这里是纯 UI 预览,过度 |
| 独立 dev 入口 html | 0 | 隔离最彻底,但要重建整个 provider 栈、推翻"复用 UXAI 自己的壳"的既定决策,代价不匹配 |

## 8. 关联

- [uxai-app-entry-routing.md](uxai-app-entry-routing.md) — 两个入口都要挂 dev 路由;那篇还更正了「`octo.tsx` 是死文件」的错误结论
