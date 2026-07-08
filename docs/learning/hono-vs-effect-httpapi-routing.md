# 后端路由入门 + 这个仓库的坑:同时有两套后端(Hono vs Effect HttpApi)

> 面向"只熟悉前端路由(React Router / Solid Router 那种)、没写过后端路由"的读者，从概念对应关系讲起，
> 再讲这个仓库特有的一个大坑:**新加一个服务端接口，代码全对、类型检查全过，请求却 404**，
> 排查了很久才定位到——不是没重启，是**代码根本没写在会被执行的地方**。
>
> 锚点案例:SPEC-INS-014 §10 加"文件管理"面板时，照抄站内 Make 模块 `/artifact` 接口的写法新增了
> 一个 Hono 路由文件，本地怎么重启都 404；最后发现这个仓库的开发/预览渠道默认根本不跑那份代码。

---

## 0. 一句话结论(先看这个)

**前端路由决定"URL 对应哪个页面组件"；后端路由决定"URL + 方法(GET/POST/...) 对应哪个处理函数"——
思路是同一件事(用路径做分发的表)，只是前端分发到组件，后端分发到函数。**

这个仓库的坑在于:后端路由**不止一套**。`packages/opencode` 里同时存在:
1. **普通 Hono 路由**(`server/routes/instance/*.ts`，比如 `artifact.ts`)——传统写法，函数式链式调用。
2. **类型化 Effect HttpApi**(`server/routes/instance/httpapi/groups/*.ts` + `handlers/*.ts`)——新写法，schema 先行。

**开发/预览渠道（`dev`/`beta`/`local`）默认只用第 2 套**，第 1 套整个是死代码（`prod`/`latest` 稳定版才用它）。
照着第 1 套的现成文件抄一个新接口，本地测的时候永远 404——不是构建没生效、不是没重启，是那条代码路径压根不会被调用。

---

## 1. 先接上你已经懂的东西:前端路由 vs 后端路由

你熟悉的前端路由(以 Solid Router / React Router 为例):

```tsx
<Route path="/insight/:id" component={InsightPage} />
<Route path="/make/:id" component={MakePage} />
```

浏览器 URL 变化 → 路由库拿 URL 去匹配这张表 → 命中哪条就渲染哪个组件。**匹配的对象是 URL 路径。**

后端路由是同一个模式，只是：
- 匹配的对象是 **HTTP 方法 + URL 路径**(`GET /insight/files` 和 `POST /insight/files` 是两条不同的路由)。
- 命中之后不是"渲染组件"，是"跑一个函数、返回一个 HTTP 响应"(通常是 JSON)。

```ts
// 概念上等价于前端的 <Route path="/insight/files" component={...} />
app.get("/insight/files", (c) => {
  // 这里对应"组件"的位置，读参数、查数据、拼返回值
  return c.json({ files: [...] })
})
```

前端"访问一个不存在的路由"通常表现为 404 页面或空白；后端"访问一个没注册的路由"表现为服务器返回 404 状态码——**你今天在浏览器 DevTools Network 面板看到的那个 `404 Not Found`，就是这回事，只是发生在 HTTP 请求这一层，不是页面渲染这一层。**

---

## 2. Hono 是什么

[Hono](https://hono.dev/) 是一个轻量级的后端 HTTP 框架(类似 Express / Koa，但更现代、类型更好)。这个仓库用它来定义后端的路由表。基本写法:

```ts
import { Hono } from "hono"

const app = new Hono()
  .get("/list", (c) => c.json({ files: [] }))     // GET /list
  .post("/upload", (c) => { ... })                  // POST /upload
```

`.route(prefix, subApp)` 用来"挂载"一个子路由表到某个前缀下，类似前端路由的嵌套路由:

```ts
const app = new Hono()
  .route("/artifact", ArtifactRoutes())   // ArtifactRoutes() 内部的 "/list" 会变成 "/artifact/list"
  .route("/project", ProjectRoutes())
```

这个仓库的 `packages/opencode/src/server/routes/instance/*.ts` 目录下，每个文件（`artifact.ts`、`project.ts`……）都是这样一个"子路由表"，最后在 `routes/instance/index.ts` 里统一 `.route()` 挂载起来。**这是最直觉、最像"传统后端框架"的写法，也是这个仓库里"看起来最容易照抄"的样板。**

---

## 3. 但这个仓库还有第二套:Effect HttpApi

`packages/opencode/src/server/routes/instance/httpapi/` 目录下是另一套完全独立的路由系统，基于 [Effect](https://effect.website/)（一个函数式编程/副作用管理库，这个仓库到处在用）的 `HttpApi` 模块。写法长这样，拆成两个文件:

**Schema 定义**(接口"长什么样"——路径、参数、返回值类型，纯声明，不含实现):

```ts
// groups/insight.ts
export const InsightApi = HttpApi.make("insight")
  .add(
    HttpApiGroup.make("insight")
      .add(
        HttpApiEndpoint.get("listFiles", "/insight/files", {
          query: InsightFileListQuery,        // 请求参数的 schema
          success: InsightFileListResult,     // 返回值的 schema
        }),
      ),
  )
```

**实现**(接口"怎么跑"——真正的业务逻辑，用 Effect 的 generator 语法写):

```ts
// handlers/insight.ts
export const insightHandlers = HttpApiBuilder.group(InstanceHttpApi, "insight", (handlers) =>
  Effect.gen(function* () {
    const listFiles = Effect.fn("InsightHttpApi.listFiles")(function* (ctx) {
      const instance = yield* InstanceState.context   // 拿到当前请求的"实例"上下文(比如项目目录)
      // ... 真正的文件列表逻辑
      return { files: [...] }
    })
    return handlers.handle("listFiles", listFiles)
  }),
)
```

**为什么要有这一套**:
- **Schema 先行**能自动生成 OpenAPI 文档、自动做请求/响应的类型校验，不用像 Hono 那样手写 `validator("query", zodSchema)` 各管各的。
- **类型贯穿服务端到客户端**:Effect 生态下可以从这套 schema 直接派生出类型安全的客户端 SDK，Hono 那套做不到这么彻底。
- 这是这个项目**在往这个方向迁移**的信号——`server/backend.ts` 的注释写得很直白:"Defaults to true on dev/beta/local channels so internal users exercise the new effect-httpapi server backend. Stable installs stay on the legacy hono backend until the rollout is complete."（新后端先在内部渠道跑起来，稳定版还没切完全）。

**行业里这不是孤例**——"新写法先在内部/预发布环境验证，稳定版保留旧实现直到迁移完成"是常见的后端框架切换策略（类似 feature flag 灰度，只是这次灰度的是"整套路由框架"而不是某个业务开关）。

---

## 4. 两套后端到底谁在跑，谁是死代码?

关键代码在 `packages/opencode/src/server/server.ts`:

```ts
function create(opts: ListenOptions) {
  const selected = select()   // 读 Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
  return selected.backend === "effect-httpapi"
    ? withBackend(selected, createHttpApi(opts))   // ← 纯 Effect HttpApi，不碰 Hono
    : withBackend(selected, createHono(opts, selected))  // ← 传统 Hono 路由（含 instance/index.ts 那一大坨 .route() 链）
}
```

`Flag.OPENCODE_EXPERIMENTAL_HTTPAPI` 的默认值(`packages/core/src/flag/flag.ts`):

```ts
const HTTPAPI_DEFAULT_ON_CHANNELS = new Set(["dev", "beta", "local"])

OPENCODE_EXPERIMENTAL_HTTPAPI:
  truthy(env) || (!falsy(env) && HTTPAPI_DEFAULT_ON_CHANNELS.has(InstallationChannel))
```

翻译成人话:**`dev`/`beta`/`local` 渠道（也就是日常本地开发、内部测试用的构建）默认走 `effect-httpapi`；只有 `prod`/`latest`(稳定发布版) 默认走 `hono`。** 显式设置环境变量可以覆盖这个默认值（两个方向都行）。

**后果**:当 `effect-httpapi` 被选中时，`createHono()` 整个函数——包括你在 `routes/instance/index.ts` 里加的任何 `.route(...)` 调用——**从来不会被执行**。这不是"路由没匹配到"，是"这坨代码根本没在处理这个请求的调用栈里"。

---

## 5. 那为什么 `/artifact/list` 能通，是不是"混用"了两套?

不是混用。`/artifact/list` 之所以能通，是因为**它在 Effect HttpApi 那套里也有一份真正的实现**
(`httpapi/groups/artifact.ts` 定义 schema + `httpapi/handlers/artifact.ts` 实现)。`routes/instance/artifact.ts`
那个 Hono 版本，在 `effect-httpapi` 模式下就是纯粹的死代码——**两份实现同时存在于代码库里，只是只有一份真正在跑**，这正是最容易踩坑的地方:你复制粘贴的那份"看起来能跑的参照代码"，本身可能就是遗留物。

`routes/instance/index.ts` 里那一大段 `if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) { app.get("/artifact/list", (c) => handler(...)) ... }`，
你可能会以为这是"桥接"到 Hono 路由的关键——**不是**。那些是 Hono 版服务器(`createHono`)自己内部的兼容层，
用来在**选用 Hono 后端时**也能把请求转发给 Effect HttpApi 的 `handler`。但当 `effect-httpapi` 后端被整体选中时，
`createHono()` 连带这层兼容代码全部不会执行——Effect HttpApi 有自己独立的入口(`createHttpApi`)，直接按
`groups/*.ts` 里声明的路径分发，不需要任何 Hono 层面的转发。

---

## 6. 新加一个后端接口，该写在哪?

**判断口诀**：先看要扩展的功能有没有已经存在的 `httpapi/groups/*.ts`（比如 insight 相关已经有
`groups/insight.ts`），有就往里加一个 `HttpApiEndpoint`；没有就新建一对 `groups/xxx.ts` + `handlers/xxx.ts`，
照 `groups/insight.ts` + `handlers/insight.ts` 的样板抄（这两个文件本身就是最小的独立分组示例）。
**不要**照抄 `routes/instance/*.ts`(Hono 版) 的写法，除非你明确知道要维护的是仅供 `prod` 稳定版的兼容路径。

新建分组三步:
1. `groups/xxx.ts`：`HttpApiEndpoint.get("name", path, { query, success, error })` 定义接口形状。
2. `handlers/xxx.ts`：`HttpApiBuilder.group(InstanceHttpApi, "xxx", (handlers) => Effect.gen(...))` 写实现，
   `yield* InstanceState.context` 拿当前请求的项目目录等上下文(**不要**用 Hono 版里的 `Instance.directory`
   静态导入，那是给 Hono 版用的，两套的上下文获取方式不通用)。
3. `httpapi/api.ts`：`.addHttpApi(XxxApi)` 把新分组挂进 `InstanceHttpApi`。

具体写法参照本仓 `httpapi/AGENTS.md`（就放在这套系统的目录里，专门写给 AI/新人看的模式说明，动这块代码前建议先读）。

---

## 7. 排查方法论:新路由 404，怎么在 5 分钟内定位是哪层问题

按代价从低到高排查，不要一上来就怀疑"是不是没重启"（这是最常见但往往不是真因的猜测）：

1. **确认改的是活的那套**：先看你加的接口是普通 Hono 路由还是 Effect HttpApi。如果是照抄 `routes/instance/*.ts`
   风格写的，先怀疑它本身是否在当前后端选择下是死代码。
2. **绕开 Electron/桌面端，直接跑源码验证接口本身**：
   ```bash
   cd packages/opencode
   bun run --conditions=browser src/index.ts serve --port 41999
   curl "http://127.0.0.1:41999/你的路径?参数"
   ```
   这一步排除了 Electron 打包、`predev` 构建缓存、进程重启时机这些变量——如果源码直跑都 404，
   那就是路由本身的问题，不是环境/构建问题。
3. **同时测一个"确定活着"的兄弟接口做对照**：比如同样发一个 `/insight/sessions`(已知在跑)，
   如果它通、你的新接口不通，说明是接口本身没被正确注册进"活的那套"，不是后端整体挂了。
4. **看响应体，不要只看状态码**：这个仓库里 404 的响应体能区分"真的没匹配到路由"(`{"error":"Not Found"}`，
   来自 `routes/ui.ts` 的 SPA 兜底逻辑，意味着请求一路穿透到了"找不到任何路由，当成前端页面请求处理"）
   和"匹配到路由但业务逻辑判定资源不存在"(比如 `{"name":"NotFoundError","data":{"message":"Session not found"}}`，
   这种反而说明路由是通的，只是资源真的不存在)。
5. **只有排除了以上几层，再怀疑"没重启"**：改了服务端代码，桌面端要重启 Electron app 才会生效
   （见 [build-channel-injection.md](build-channel-injection.md) 讲的构建产物链路）；但"重启不管用"往往是
   因为压根没跑对代码路径，不是重启本身失效。

---

## 8. 速查

- 后端入口/选型：`packages/opencode/src/server/server.ts` `create()`，读 `Flag.OPENCODE_EXPERIMENTAL_HTTPAPI`
- 默认值与渠道名单：`packages/core/src/flag/flag.ts`，`HTTPAPI_DEFAULT_ON_CHANNELS = ["dev","beta","local"]`
- Hono 版路由（`prod`/`latest` 稳定版专用，dev 环境是死代码）：`packages/opencode/src/server/routes/instance/*.ts`
- Effect HttpApi 版路由（`dev`/`beta`/`local` 默认在跑）：
  `packages/opencode/src/server/routes/instance/httpapi/groups/*.ts`(schema) +
  `packages/opencode/src/server/routes/instance/httpapi/handlers/*.ts`(实现) +
  `httpapi/api.ts`(聚合进 `InstanceHttpApi`)
- 写法样板/规范：`httpapi/AGENTS.md`
- 请求上下文（项目目录等）：Effect 版用 `yield* InstanceState.context`；Hono 版用 `Instance.directory` 静态导入——两者不通用
- SPA 兜底 404 来源（判断"真没匹配到路由"的指纹）：`packages/opencode/src/server/routes/ui.ts` `serveUI`
- 本案 anchor：[SPEC-INS-014 §10](../specs/infra/insight-worktree-layout.md#10-文件管理-ui-v2-新增取代-spec-ins-004-原草案) 文件管理面板接口
