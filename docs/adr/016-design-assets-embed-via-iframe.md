# ADR-016: Design 页资产库以 iframe 嵌入 + 主进程网络层注入凭证

## 状态

已采纳（2026-07-10）

## 背景

Design 页要内嵌「平台资产」「项目资产」两个 web 项目（同团队、两个独立仓库，差异大不合并）。需要决定：

1. Electron 里用什么方式嵌入这两个页面；
2. 内网 SSO 登录在嵌入上下文里 redirect 失败（IT 登录页拒绝被 frame，且 IT 侧配合改造可能性低），鉴权怎么打通。

关键前提：Electron 层自行完成登录，产出的 cookie / token 资产站后端**直接认**（后端同团队）——凭证信任已解决，待解决的只是凭证如何送达 iframe 内页面发出的请求。

原理与备选的完整展开见 [learning/electron-embed-web-and-sso.md](../learning/electron-embed-web-and-sso.md)。

## 备选

**嵌入方式**：`<iframe>` / `<webview>` 标签 / `WebContentsView`。
**鉴权**：主进程 `webRequest` 网络层注入 / 宿主 postMessage 中转 Bearer token（Teams tab SSO 模式）/ Electron 子窗口顶级登录 + `SameSite=None` cookie / 系统浏览器 + 回调（RFC 8252，需 IT 白名单）。

## 决策

1. **嵌入用两个 `<iframe>`**（tab 切换 `display:none` 保活、懒挂载）。理由：页面嵌在应用布局里（周围有 chrome / tab / 全局弹层），iframe 是官方推荐且唯一随 DOM 布局走的方式；`WebContentsView` 永远盖在 DOM 之上且要手动同步 bounds，适合全屏独占场景不适合本案；`<webview>` 官方明确不推荐，不用。
2. **鉴权走主进程网络层注入**：`webRequest.onBeforeSendHeaders` 按域名白名单命中资产站请求，统一附加 `Cookie` / `Authorization` 头。理由：改头发生在 Chromium cookie 策略计算之后，SameSite / Secure / 三方 cookie 治理全部绕过；资产站前端零改造（同一份代码，浏览器里走正常 SSO、iframe 里由主进程透明补凭证）；iframe 内顶级 SSO 重定向结构性不可行；系统浏览器回调需 IT 白名单（前提排除）；cookie store 路线（`cookies.set`）绕不开发送时策略，不用。
3. **凭证过期由主进程接管**：`onHeadersReceived` 识别"302 → IT 登录域"或 401 指纹，触发重新登录后重试；仍失败则显式报错态（响亮失败出口在主进程）。
4. **postMessage 只承担原生能力调用**（打开文件、跳转宿主页面），不承担凭证；双向校验精确 origin、协议版本化。资产站设 `frame-ancestors` 只允许宿主 origin。

## 后果

- 资产站两仓前端零改造；后端零改造（凭证本来就认）。实现集中在宿主主进程。
- webRequest 每 session 每事件**只能挂一个监听器**（后注册静默顶掉先注册），本仓 `packages/desktop/src/main/windows.ts` 已有 CORS 改写占用两个事件——注入必须合并进同一 handler。
- 现有 handler 把所有响应 `Access-Control-Allow-Origin` 改成 `*`，与凭证注入叠加会把"带凭证读内网接口"送给 session 内所有代码——实现时必须做其一：ACAO 改写对资产域名豁免，或注入按 `webContentsId` / frame 来源收窄到那两个 iframe。
- 资产站若用 WebSocket，联调时验证握手请求被注入覆盖。
- 本功能由协作同事实施，本仓仅维护此决策与 learning 文档。