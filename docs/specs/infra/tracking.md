# 打点接入规范（Tracker SDK + Mock Server）

**状态：** 设计中  
**适用仓库：** UXAI（外网）/ 内网同步  
**上游已实现：** 打点接口 ✓（内网）

---

## 背景

需要在 octoAgent 各 Agent / 页面中接入 PV/UV 打点和交互打点。要求：

- 外网开发用本地 mock server 调试，内网 beta/prod 打真实接口
- 各调用方无需感知环境、系统信息采集、用户信息读取等细节
- mock server 可扩展，后续各 agent 自行添加不影响主入口

---

## 打点接口（内网）

```
POST /record/logger/page
```

**请求体：**

```ts
{
  account: string          // 必填，从 localStorage userInfo 读取
  uid?: string             // 从 localStorage userInfo 读取
  browserName?: string     // 自动采集
  browserVersion?: string  // 自动采集
  module?: string          // 调用时传入
  os?: string              // 自动采集
  platform?: 3             // 固定值
  project: "octo-agent"   // 固定值
  userAgent?: string       // 自动采集
  datas: {
    from?: string          // 可选，调用时传入
    name?: string          // 必填，调用时传入
    path?: string          // 自动采集
    screenWidth?: number   // 自动采集
    screenHeight?: number  // 自动采集
    type?: "page" | "interaction" | "duration"  // 由方法名推断
    extend?: string        // 可选，调用时传入（JSON 字符串）
  }
}
```

**响应：** 成功返回 void（204），失败返回原生 HTTP 错误码。

---

## Tracker SDK 设计

### 文件位置

```
packages/app/octoapp/utils/tracker.ts
```

app 级工具，各模块共用。

### 对外 API

```ts
// module：来源模块（必填）
// name：事件名（必填）
// from / extend：可选

tracker.page({ module: 'insight', name: 'chat-page' })
tracker.interaction({ module: 'insight', name: 'send-message', extend?: '...' })
tracker.duration({ module: 'insight', name: 'session', extend?: '3600' })
```

`type` 由方法名自动推断，调用方不传。

### 自动封装字段

| 字段 | 来源 | 方式 |
|------|------|------|
| `account` / `uid` | `localStorage.getItem('userInfo')` | JSON.parse 解构 |
| `browserName` / `browserVersion` | `navigator.userAgent` | 正则解析 |
| `os` | `navigator.userAgent` | 正则解析 |
| `userAgent` | `navigator.userAgent` | 直接取 |
| `platform` | — | 固定 `3` |
| `project` | — | 固定 `'octo-agent'` |
| `datas.path` | `window.location.href` | 直接取 |
| `datas.screenWidth/Height` | `window.screen` | 直接取 |
| `datas.type` | 方法名 | 推断 |

### 环境路由

```ts
const baseUrl = import.meta.env.VITE_OCTO_REPORT_BASE_URL

// 外网 dev：baseUrl 为空 → 相对路径 → Vite mock server 拦截
// 内网 beta/prod：baseUrl 有值 → 打真实接口
const endpoint = baseUrl
  ? `${baseUrl}/record/logger/page`
  : `/record/logger/page`
```

`VITE_OCTO_REPORT_BASE_URL` 在内网 `.env.beta` / `.env.prod` 中配置，外网不填。

---

## Mock Server 设计

### 目录结构

```
packages/app/mock/
  index.ts               ← 单一插件入口，组合所有 handler
  handlers/
    pipeline/
      index.ts           ← pipeline 路由逻辑（现有 vite-mock-plugin.ts 迁入）
      data.ts            ← pipeline mock 数据（现有 octo-pipeline-mock.ts 迁入）
    tracker/
      index.ts           ← 打点 mock（新增）
    chat/                ← 未来 chat agent 自行添加
      index.ts
      data.ts
```

**删除：**
- `mock/vite-mock-plugin.ts` / `vite-mock-plugin.js`
- `mock/octo-pipeline-mock.ts`

### Handler 接口约定

```ts
export interface MockHandler {
  prefix: string
  handle: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
}
```

### index.ts 结构

```ts
import { pipelineHandler } from "./handlers/pipeline"
import { trackerHandler } from "./handlers/tracker"

const handlers: MockHandler[] = [pipelineHandler, trackerHandler]

export function octoMockPlugin(): Plugin {
  return {
    name: "octo:mock",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const matched = handlers.find(h => req.url?.startsWith(h.prefix))
        matched ? matched.handle(req, res, next) : next()
      })
    },
  }
}
```

### vite.js 变更

```ts
// 改前
import { viteMockPlugin } from "./mock/vite-mock-plugin.js"
viteMockPlugin()

// 改后
import { octoMockPlugin } from "./mock/index.js"
octoMockPlugin()
```

### tracker handler 行为

- 路径：`POST /record/logger/page`
- 响应：`204 No Content`（模拟 void）
- 副作用：将完整 payload 打印到 terminal（便于调试验证字段）
- 错误模拟：无需，正常情况下接口不返回业务数据

---

## 扩展方式（新 Agent 接入 mock）

1. 在 `mock/handlers/` 下新建文件夹（如 `chat/`）
2. `index.ts` 导出 `MockHandler`，`data.ts` 存放 fixtures
3. 在 `mock/index.ts` import 并加入 `handlers` 数组
4. `vite.js` 不需要改动

---

## 验证方式

### 外网 dev（mock server）

1. 启动 `bun run dev`（`VITE_OCTO_REPORT_BASE_URL` 为空）
2. 触发任意打点调用（页面跳转 / 交互操作）
3. 在 **terminal** 中确认 payload 打印，检查以下字段：
   - `account` / `uid` 从 localStorage 正确读取
   - `browserName` / `browserVersion` / `os` 解析正确
   - `datas.type` 与调用方法匹配（page / interaction / duration）
   - `datas.name` / `module` 为调用方传入值
   - `datas.path` / `datas.screenWidth` / `datas.screenHeight` 自动填充
4. 在浏览器 **Network 面板** 确认请求命中 `/record/logger/page`，响应 204

### 内网 beta

1. 启动 `bun run dev:beta`（`.env.beta` 中 `VITE_OCTO_REPORT_BASE_URL` 有真实域名）
2. 触发打点调用
3. 在浏览器 **Network 面板** 确认请求打到真实域名，响应 200/204
4. 联系后端确认打点数据已入库（或查看打点平台）

---

## 待办

- [ ] 实现 tracker SDK（`packages/app/octoapp/utils/tracker.ts`）
- [ ] 实现 mock server 重构 + tracker handler
- [ ] 外网验证（terminal + Network 面板）
- [ ] 内网 beta 验证（Network 面板 + 数据入库确认）
- [ ] 所有功能完成后，在 UXAI 仓写《打点接入文档》，供各 agent 一键接入
