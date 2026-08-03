# 打点接入规范（Tracker SDK + Mock Server）

**状态：** 已落地（P1 完成）
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

两个独立接口，响应均为 HTTP 200 无响应体。

### 页面打点

```
POST /record/logger/page
```

### 交互打点

```
POST /record/logger/interaction
```

### 公共请求结构

```ts
{
  project: "octo-agent"     // 固定值
  module: string            // 调用时传入
  account: string           // 从 localStorage userInfo 读取
  uid?: string              // 从 localStorage userInfo.userId 读取(上报字段名是 uid,来源字段名是 userId)
  userAgent: string         // navigator.userAgent
  platform: number          // 动态映射：1=Windows 2=macOS 3=Linux 4=iOS 5=Android
  os: string                // 解析自 userAgent
  browserName: string       // 小写，如 "chrome"
  browserVersion: string    // 完整版本，如 "147.0.0.0"
  datas: DataItem[]         // 数组，当前每次发送 1 条；设计支持批量（见 P2）
}
```

### datas 子字段

**页面打点（`/page`）**

```ts
{
  type: "page"                               // 固定，由 SDK 写死
  subType?: "enter" | "leave" | "switch"     // 调用时传入，默认 "enter"
  name?: string                              // 页面名称，调用时传入
  path: string                               // window.location.href，自动采集
  from?: string                              // 来源路径，调用时传入，默认 ""
  screenWidth: number                        // window.screen.width，自动采集
  screenHeight: number                       // window.screen.height，自动采集
  extend?: string                            // 扩展 JSON 字符串；SDK 自动并入 version（见下）
}
```

**交互打点（`/interaction`）**

```ts
{
  type: "interaction"                                   // 固定，由 SDK 写死
  subType?: "click" | "input" | "scroll" | "hover"     // 调用时传入，默认 "click"
  name: string                                          // 事件名，必填，调用时传入
  path: string                                          // window.location.href，自动采集
  extend?: string                                       // 扩展 JSON 字符串；SDK 自动并入 version（见下）
}
```

### 应用版本号（version）

契约无独立 app 版本字段（`browserVersion` 是浏览器版本），故应用版本并入 `datas[].extend`：

- 来源：`localStorage.appInfo.version`，容错读取，**不存在则不注入**
- 所有类型打点（page / interaction）一致携带
- SDK 自动合并：调用方 extend 为 JSON 时并入 `version` 键；非 JSON 时保底放入 `{ value, version }`，不丢原数据

```jsonc
// 调用方 extend='{"from":"preset"}' + version=1.14.41
{ "from": "preset", "version": "1.14.41" }
```

---

## Tracker SDK 设计

### 文件位置

```
packages/app/octoapp/utils/tracker.ts
```

app 级工具，各模块共用。

### 对外 API

```ts
// PV 打点 —— 页面挂载时调用
tracker.page({ module: "insight", name: "insight-page" })
tracker.page({ module: "insight", name: "insight-page", subType: "leave" })

// 交互打点 —— 用户操作完成后调用
tracker.interaction({ module: "insight", name: "new-session" })
tracker.interaction({ module: "insight", name: "send-message", subType: "click", extend: '{"from":"preset"}' })
```

- `type` 由方法名推断，调用方不传
- `subType` 可选，page 默认 `"enter"`，interaction 默认 `"click"`
- 所有方法返回 `void`，失败静默（`console.warn`），不影响主流程

### 自动封装字段

| 字段 | 来源 |
|------|------|
| `account` | `localStorage.userInfo.account` |
| `uid` | `localStorage.userInfo.userId`（注意：**不是** `userInfo.uid`，来源字段名与上报字段名不一致，现状如此） |
| `browserName` | 解析 `navigator.userAgent`，小写 |
| `browserVersion` | 解析 `navigator.userAgent`，完整版本 |
| `os` | 解析 `navigator.userAgent` |
| `platform` | 动态映射（1–5） |
| `project` | 固定 `"octo-agent"` |
| `userAgent` | `navigator.userAgent` 原值 |
| `datas[].path` | `window.location.href` |
| `datas[].screenWidth/Height` | `window.screen`（仅页面打点） |

### 环境路由

```
外网 dev（VITE_OCTO_REPORT_BASE_URL 为空）：
  → /record/logger/page 或 /record/logger/interaction
  → Vite mock server 拦截，terminal 打印 payload，返回 200

内网 beta/prod（VITE_OCTO_REPORT_BASE_URL 有值）：
  → ${baseUrl}/record/logger/page 或 ${baseUrl}/record/logger/interaction
  → 打真实接口
```

---

## Mock Server 设计

### 目录结构

```
packages/app/mock/
  index.ts
  handlers/
    pipeline/
      index.ts
      data.ts
    tracker/
      index.ts      ← 前缀 /record/logger，覆盖 page + interaction 两个路径
```

### tracker handler 行为

- 前缀：`/record/logger`，匹配 `/record/logger/page` 和 `/record/logger/interaction`
- 响应：`200 OK`（与真实接口一致）
- 副作用：terminal 打印 tag + payload，tag 区分接口类型
  - `[octo:tracker-mock:page]`
  - `[octo:tracker-mock:interaction]`

### 注册方式

mock 插件注册在两个 TypeScript config 入口，不在 `vite.js`（Node.js ESM）中，避免 `.ts` 解析问题：

- `packages/app/vite.config.ts` → `import { octoMockPlugin } from "./mock/index.ts"`
- `packages/desktop/electron.vite.config.ts` → `import { octoMockPlugin } from "../app/mock/index.ts"`

---

## 扩展方式（新 Agent 接入 mock）

1. 在 `mock/handlers/` 下新建文件夹
2. `index.ts` 导出 `prefix` 和 `handle`
3. 在 `mock/index.ts` import 并加入 `handlers` 数组
4. `vite.js` / `electron.vite.config.ts` 不需要改动

---

## 验证方式

### 外网 dev（mock server）

1. `bun run dev` 启动，进入 insight 页面
2. Terminal 出现 `[octo:tracker-mock:page]` 日志，确认字段：
   - `platform` 为动态整数（macOS=2，Windows=1）
   - `browserName` 小写、`browserVersion` 完整版本（如 `"148.0.0.0"`）
   - `datas[0].subType` 默认 `"enter"`
3. 点击新建对话，terminal 出现 `[octo:tracker-mock:interaction]` 日志
4. Network 面板两个请求均响应 200

### 内网 beta

1. `bun run dev:beta`（`.env.beta` 中 `VITE_OCTO_REPORT_BASE_URL` 有真实域名）
2. Network 面板确认请求打到真实域名，响应 200
3. 联系后端确认数据入库

---

## 命名约定：用户操作 vs 服务端真实使用

同一套 `tracker.interaction` 接口承载两类语义不同的打点，靠 **name 前缀**区分，分析侧按前缀切分：

| 类别 | 语义 | name 约定 | 触发方 |
|------|------|-----------|--------|
| 用户操作（常规） | 用户点击 / 发送 / 切换等主动行为 | 裸 kebab（`message-send`、`preset-click`…） | 前端 handler |
| 服务端真实使用 | 模型 / 服务端真的调起某能力并把内容回显到会话 | `server-` 前缀（`server-mcp-used`、`server-skill-used`） | 前端从会话 parts 派生 |

**服务端使用类的落点规范（避免虚增计数）：**

- **只统计真的回显到会话中的调用**：从本轮 assistant parts / 任务卡片派生，而非监听全局事件——`skill.used` 一类全局事件不带 sessionID/agent，无法区分是哪个 agent（insight 与 make/studio 都绑了 skill），会误标 `module`。
- **baseline 快照 + 去重 set 两层配合**：render 派生的打点在页面刷新 / 切回会话重挂时会把历史调用重新扫到；必须在组件首次观测时把已存在的调用记为「历史」不上报（baseline），并用模块级 set 保证同一 usage 跨重挂只报一次。
- insight 首批已落地 `server-mcp-used`（业务 MCP 工具提交长任务，每 `task_id` 一次）、`server-skill-used`（skill 被调用，每 part 一次），实现清单见 UXAI 仓 `packages/app/octoapp/pages/insight/docs/tracking.md`。

---

## 待办

- [x] 实现 tracker SDK
- [x] 实现 mock server 重构 + tracker handler
- [x] insight 接入首批打点（PV + 新建对话）
- [x] 外网验证
- [ ] 内网 beta 验证（数据入库确认）
- [ ] 所有功能完成后，在 UXAI 仓写《打点接入文档》，供各 agent 一键接入
- [ ] **[P2]** datas 批处理：短时间内多条事件攒批后统一发送，减少请求数；需处理页面卸载前强制 flush 及异常补发
