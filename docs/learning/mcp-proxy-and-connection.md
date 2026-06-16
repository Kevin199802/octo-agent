# MCP 连接与代理 — 内置 uxr-tool 的连接链路与代理决策机制

> 前置阅读：[mcp-api-integration.md](mcp-api-integration.md)（对接概念）、[skill-and-mcp.md](skill-and-mcp.md)
> 本文只讲**连接链路 + 代理决策机制**（原理），不含具体 bug 的定位过程。

---

## 1. 配置在哪儿（链路全景）

内置 MCP 工具服务器是**写死在代码里**的，不在用户 config：

| 环节 | 位置 | 说明 |
|---|---|---|
| 工具服务器定义 | `packages/opencode/src/config/builtin-mcp.ts` | `uxr-tool` → `type:"remote"`, `url:"http://7.192.161.60:8005/mcp"`, `timeout:30000` |
| 合并进 config | `packages/opencode/src/config/config.ts:459-461` | `{ ...builtinMcp, ...userMcp }`，用户同名键可覆盖 |
| agent 可见性区分 | `packages/opencode/src/session/prompt.ts:462` | 内置 key vs 用户 key |
| 连接逻辑 | `packages/opencode/src/mcp/index.ts` `connectRemote`（~344） | 先 StreamableHTTP，失败再 SSE |
| **代理决策** | `mcp/index.ts` `mcpFetch`(~67) + `isPrivateUrl`(~54) | 决定走不走系统代理 |

改服务器地址/超时 → 只改 `builtin-mcp.ts` 一处。

---

## 2. 代理决策机制（核心）

```ts
function isPrivateUrl(url) {
  // 只认 localhost / 127.0.0.1 / ::1 / 10.x / 172.16-31.x / 192.168.x
}
function mcpFetch(proxy, url) {
  if (proxy === true)  return globalThis.fetch   // 显式：走代理
  if (proxy === false) return noProxyFetch       // 显式：连接期间临时删 HTTP(S)_PROXY，直连
  return isPrivateUrl(url) ? noProxyFetch : globalThis.fetch  // 未配置：按 IP 段自动判断
}
```

`noProxyFetch`：fetch 前临时 `delete process.env.HTTP_PROXY/HTTPS_PROXY/...`，结束后还原。

**关键前提**：opencode 跑在 **Bun**。Bun 的 `globalThis.fetch` 会**自动读取 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 环境变量**走代理（Node 原生 fetch 默认不会，别按 Node 直觉判断）。

---

## 3. uxr-tool 在这套机制下的实际走向

1. 内置 `uxr-tool` **没写 `proxy` 字段** → 进自动判断分支 `isPrivateUrl(url) ? noProxyFetch : globalThis.fetch`。
2. IP `7.192.161.60` 属于 `7.0.0.0/8`，而 `isPrivateUrl` **只认 10 / 172.16-31 / 192.168**，不认 7.x → 判为「公网」→ 用 `globalThis.fetch`。
3. 因此对**环境里设了代理变量的用户**，连接 uxr-tool 的请求会被发往代理；对没有代理变量的用户则直连。

⇒ 即：同一个内置服务器，连接是否经过代理，取决于「IP 是否被 `isPrivateUrl` 认成内网」与「用户环境是否有代理变量」两者的组合。

---

## 4. 控制代理行为的两个杠杆

- **`proxy: false`**（推荐内网固定 IP 用）：连接期间临时摘掉代理变量，强制直连，对所有用户一致，不受其本地代理影响。
  ```ts
  "uxr-tool": { type:"remote", url:"http://7.192.161.60:8005/mcp", enabled:true, timeout:30000, proxy:false }
  ```
- **扩展 `isPrivateUrl`**：把实际用到的内网段（如 `7.0.0.0/8`）补进去，让自动判断也覆盖。IP 写死时，`proxy:false` 更直白，优先它。

注意：能否连通最终还取决于网络层——用户得在能路由到该内网段的网络（VPN/内网）里，代码层的代理开关管不了这部分。
