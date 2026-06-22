# Mock Server 两种模式与选型

在同一个项目里，mock server 可以共存两种完全不同的实现方式，选型依据只有一条：**HTTP 请求从哪个进程发出**。

---

## 模式一：Vite 插件 middleware mock

**拦截点：** Vite dev server 的 connect middleware 链，在渲染进程（浏览器）发出请求后、转发到真实后端之前拦截。

**实现方式：**

```ts
// vite.config.ts
export function octoMockPlugin(): Plugin {
  return {
    name: "octo:mock",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/record/logger")) {
          // 拦截、响应、打 log
        } else {
          next()
        }
      })
    },
  }
}
```

**环境路由方式：**

```
VITE_OCTO_REPORT_BASE_URL 为空 → 发相对路径 /record/logger/page
                                → Vite middleware 自动拦截 → 返回 200
VITE_OCTO_REPORT_BASE_URL 有值 → 发绝对路径 → 打真实接口
```

**核心特点：自动降级，无需手动启动任何额外进程。** `bun run dev` 起来就生效。

**适合场景：**
- 打点、鉴权、业务 CRUD 等所有从 **renderer（浏览器）** 发出的接口
- 需要在 Network 面板可见真实 HTTP 请求的场景
- 团队成员无需关心 mock 是否启动

---

## 模式二：独立 mock server 进程

**拦截点：** 独立 HTTP 进程，监听指定端口，靠环境变量将调用方指向它。

**实现方式：**

```ts
// scripts/kb-mock-server.ts
const PORT = Number(process.env.PORT) || 8787

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/api/knowledge") {
      return Response.json({ data: MOCK_DATA })
    }
    return new Response("Not Found", { status: 404 })
  },
})
```

**环境路由方式：**

```
手动启动: bun run scripts/kb-mock-server.ts
设置环境变量: OCTO_KB_BASE_URL=http://localhost:8787
调用方读取该变量拼接请求 URL → 命中 mock server
```

**核心特点：显式配置，需主动启动。** 不启动、不设环境变量就不生效。

**适合场景：**
- 工具调用、知识库检索等从 **Node.js server 进程（sidecar）** 发出的接口
- Vite middleware 对这类请求完全不可见，必须有独立进程
- 需要模拟延迟、错误码、fixture 集合的复杂场景

---

## 两种模式对比

| | Vite 插件 mock | 独立 mock server |
|---|---|---|
| 请求来源 | renderer（浏览器） | Node.js 进程 / sidecar |
| 启动方式 | `bun run dev` 自动生效 | 手动启动 + 设环境变量 |
| 降级方式 | env 为空自动降级 | 显式配置 |
| Network 面板可见 | ✓ | ✓（独立端口） |
| 维护成本 | 低（fixture 集中在 handlers/） | 稍高（需维护启动流程） |
| 行业代表工具 | Vite proxy / MSW（Service Worker） | json-server、WireMock、自建 Bun/Express server |

---

## 为什么同一项目会同时存在两种

以 UXAI 为例：

```
renderer（浏览器）
  → 打点接口 /record/logger/*
  → Vite middleware 拦截（octoMockPlugin）

opencode server sidecar（Node.js 进程）
  → 知识库接口 /ucdAgent/getKnowledgeVector
  → kb-mock-server.ts 拦截（独立进程）
```

两类请求的发起进程不同，Vite middleware 只能拦截经过 dev server 的流量，sidecar 进程的请求根本不经过 Vite，所以必须各用各的方案，并不矛盾。

---

## MSW（Mock Service Worker）补充说明

MSW 是另一种主流方案，原理是在浏览器注册 Service Worker 拦截 fetch，不依赖 Vite。

- **优点：** 与框架无关，生产环境也可复用 handler 做集成测试
- **缺点：** 需要在项目里注册 SW 文件（`public/mockServiceWorker.js`），有一定侵入性；同样只能拦截浏览器侧请求，server 侧调用依然需要独立 mock server

对于以 Electron + Vite 为基础的项目，Vite middleware mock 方案更轻量，无需引入额外依赖。
