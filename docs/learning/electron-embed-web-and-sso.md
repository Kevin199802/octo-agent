# Electron 内嵌 web 页面与 SSO 鉴权 — iframe / webview / WebContentsView 怎么选，登录怎么打通

> 锚点场景：Design 页要内嵌「平台资产」「项目资产」两个独立仓库的 web 项目（同团队维护，前后端均可改；登录依赖 IT 统一 SSO，IT 侧不可改）。
> 决策记录见 [ADR-016](../adr/016-design-assets-embed-via-iframe.md)，本文是原理与备选展开。

---

## 1. 三种嵌入方式的本质区别

Electron 里让"另一个 web 页面"出现在窗口里，只有三条路。它们的本质区别是**谁负责定位与渲染宿主关系**：

| | `<iframe>` | `<webview>` 标签 | `WebContentsView` |
|---|---|---|---|
| 是什么 | 标准 web 元素，DOM 流内 | Electron 私有标签，DOM 定位、独立 guest 进程 | 主进程对象，独立 webContents，**不在 DOM 里** |
| 官方态度 | **推荐**（官方 embedding 文档首选） | 文档原话 "we do not recommend you to use it"——架构遗留自已废弃的 Chrome Apps `<webview>` | 推荐（Electron 30 起替代已废弃的 `BrowserView`） |
| 布局 | 随 CSS 布局 / 滚动 / z-index / transform，全部正常 | 大体正常，但历史 bug 多（尺寸抖动、焦点丢失、resize 白屏） | 主进程手动 `setBounds`；窗口 resize、侧栏开合、tab 切换都要自己同步 |
| 覆盖层 | 正常参与 z-index | 正常 | **永远盖在 DOM 之上**——宿主的下拉菜单、弹窗、toast、全局搜索会被它挡住 |
| 进程隔离 | 跨站 iframe 在现代 Chromium 走 OOPIF，有独立渲染进程；"iframe 隔离差"是老观念 | 独立 guest 进程 | 独立 webContents |
| Node/preload 能力 | iframe 内**天然拿不到** preload / `window.api`（安全优点） | 可配 per-guest preload | 可配独立 preload |
| 额外开关 | 无 | 需 `webviewTag: true`（本仓未开） | 无，但全部逻辑在主进程 |

### 选型口诀

- **页面嵌在应用布局里**（周围有 chrome、有 tab、有全局弹层）→ `iframe`。
- **页面是全屏独占的"内嵌浏览器"**（如 IM 侧边栏应用、内置文档站）→ `WebContentsView`。
- `<webview>` 标签**任何新代码都不要用**——官方不推荐 + 需要额外开洞 + VS Code 都已从 `<webview>` 整体迁移到 iframe（配自定义协议托管内容）。

### 为什么本案不选 WebContentsView

Design 页的资产库嵌在 tab 布局里，四周全是 app chrome，且应用有全局搜索、弹窗等覆盖层。`WebContentsView` 意味着：

1. 每次布局变化（侧栏开合、窗口 resize、tab 切换）主进程都要重算 `setBounds`——**持续交的税**；
2. z-order 问题无解：它浮在所有 DOM 之上，宿主任何想盖住该区域的 UI（弹窗、下拉、引导层）都会被它挡住，只能靠"临时隐藏 view"这类补丁。

而 iframe 的限制（被嵌方需允许 framing、拿不到原生能力）在本案都不构成问题：两个资产项目是自家仓库，可以配合设响应头；原生能力本来就应该经宿主中转。

---

## 2. iframe 落地的配套清单

### 2.1 被嵌方响应头

资产站需要设 `Content-Security-Policy: frame-ancestors <宿主 origin>`（精确列出，不用 `*`），并且**不要**用老的 `X-Frame-Options: DENY/SAMEORIGIN`（它无法表达"只允许某个第三方 origin"）。这是唯一需要被嵌方配合的点——同团队，可控。

宿主侧如果 renderer 有 CSP，要放行 `frame-src` 那两个域。

### 2.2 两个 iframe 还是一个

两个页面 = 两个 iframe，理由只有一个：**tab 切换保活**（滚动位置、筛选状态不丢）。做法是 `display: none` 藏而不卸载；页面重的话首次访问才挂载（懒挂载 + 保活）。如果不需要保活，一个 iframe 切 `src` 也成立——本案选两个。

### 2.3 宿主 ↔ iframe 通信

标准 `window.postMessage`，**只承担原生能力调用**（打开本地文件、跳转宿主页面等——iframe 里拿不到 `window.api`，preload 只注入顶层 frame），**不承担凭证传递**（凭证走 §3 的网络层注入）。两条铁律：

- **双向都校验精确 origin**：宿主 `iframe.contentWindow.postMessage(msg, "https://asset.example.intranet")`（不用 `"*"`）；接收方校验 `event.origin` 精确匹配后才处理。
- **协议要版本化**：消息带 `{ v: 1, type: "...", payload }`，两个仓独立发版，协议就是它们之间的 API。

原生能力面由此被显式枚举——这是特性不是缺陷。

---

## 3. 鉴权：为什么 iframe 里 SSO 必死，以及四条业界解法

### 3.1 失败机理

内网资产站的登录依赖 IT 统一 SSO：访问资产站 → 302 到 IT 登录页 → 登录 → 302 回资产站。这条链在普通浏览器里没问题，在 iframe 里**结构性地死**：

1. IT 登录页几乎必然设了 `X-Frame-Options: DENY` 或 `frame-ancestors 'self'`（所有正经 SSO 都这么配，防点击劫持）。资产页在 iframe 里被 302 到登录页的那一刻，浏览器直接拒绝渲染。
2. 就算能渲染，SSO 的 redirect / origin 校验在嵌入上下文里也对不上（宿主是本地 origin，不在白名单）。

结论：**顶级 SSO 重定向不能发生在 iframe 里**。这不是配置问题，别在这个方向找修法；要求 IT 改 frame-ancestors / 白名单也基本不可行（等于要 SSO 为单个应用开放点击劫持面）。

### 3.2 四条业界解法对比

| 方案 | 机制 | IT 配合 | 资产仓改造 | 确定性 | 业界参照 |
|---|---|---|---|---|---|
| **A. 主进程网络层注入** ★ | 主进程 `webRequest.onBeforeSendHeaders` 拦截 session 内所有请求，命中自家域名统一附加 `Cookie` / `Authorization` 头 | **零** | **前端零改造**；后端若认注入的凭证则也零改造 | 高：改头发生在 Chromium 算完 cookie 策略之后，SameSite / Secure / 三方 cookie 治理**全部绕过** | oauth2-proxy 式"网关统一附凭证"搬进客户端主进程；企业壳应用常用 |
| B. 宿主中转 token（postMessage） | iframe 页面检测嵌入态，向宿主 postMessage 要 token，接口走 `Authorization: Bearer` | 零 | 两仓前端都加嵌入态分支 + fetch 带 Bearer；后端加 Bearer 平行鉴权 | 高 | Microsoft Teams tab SSO、VS Code webview 鉴权 |
| C. Electron 子窗口顶级登录 + cookie store | 弹 `BrowserWindow` 顶级导航走完整 SSO（redirect 链与普通浏览器一致，零 IT 配合）；登录后 cookie 进 session，iframe 复用 | 零 | 资产站 cookie 须 `SameSite=None; Secure` | 中：要求资产站 HTTPS + 悬着 Chromium 三方 cookie 治理政策风险 | 大量 Electron 应用的 SSO 登录窗模式 |
| D. 系统浏览器 + 回调（RFC 8252） | 唤起默认浏览器登录，经 `octoagent://callback` 或 loopback 端口把 auth code 传回 app | **需要**：IT 要在 redirect_uri 白名单加回调地址 | 中 | 高（若 IT 配合） | OAuth 2.0 for Native Apps；VS Code 登录 GitHub 即此 |

**两个常见误解点名：**

- **"系统浏览器登录后把 cookie 传回来"不存在**。系统浏览器的 cookie 读不出来（浏览器安全模型底线），方案 D 能传回的只有回调 URL 里的 auth code / ticket——而回调地址需要 IT 白名单。
- **"手动加 cookie"有两种，只有一种绕开策略**。`session.cookies.set()` 写的是 cookie 存储，发送时 SameSite / Secure 策略照常生效（跨站 iframe 要求 `SameSite=None; Secure`，即资产站必须 HTTPS）；而 `onBeforeSendHeaders` 直接改写发出去的请求头，策略已经算完、不再适用。要绕策略就用后者。

### 3.3 本案的选择：A（网络层注入）

前提盘点：IT 配合可能性低（D 出局）；Electron 层自己做登录，产出的 cookie / token 资产后端**直接认**（后端同团队）——凭证的**信任**已解决，剩下的只是**投递**，这正是 A 唯一负责的事。

A 对 B 的碾压点在改造量：B 要求两个资产仓前端都写嵌入态分支，A 让资产站**一行不改**——在浏览器里跑走正常 SSO，在 iframe 里跑由主进程透明补凭证，同一份代码两种环境。C 的 cookie 路线依赖 HTTPS 现状 + Chromium 政策等外部变量，与本仓"确定性优先"的价值观不合，整条不碰。

**主进程侧的完整职责：**

1. **注入**：`onBeforeSendHeaders` 按域名白名单命中资产站请求，附加 / 改写 `Cookie` 与 `Authorization` 头（含 iframe 的文档加载、fetch、子资源）。
2. **过期接管**：凭证过期后资产后端会 302 到 IT 登录页，iframe 里照样死。主进程在 `onHeadersReceived` 盯"302 且 Location 指向 IT 登录域"（或 401 指纹），触发重新登录，成功后让页面重试；重试仍失败则**显式报错态**（响亮失败的出口在主进程，不在页面）。

### 3.4 实现注意点（必读）

1. **单监听器限制 + 本仓已有占用**：每个 session 每种 webRequest 事件**只能挂一个监听器，后注册的静默顶掉先注册的**。UXAI 主进程已在 `packages/desktop/src/main/windows.ts`（`createMainWindow` 内）挂了 `onBeforeSendHeaders` / `onHeadersReceived` 做 CORS 改写——凭证注入必须**合并进同一个 handler**，不能另起炉灶。
2. **与现有 `Access-Control-Allow-Origin: *` 改写的危险组合**：现 handler 把所有响应 ACAO 改成 `*`。叠加凭证注入后，session 里渲染的任何内容向内网域名发请求都会被自动附凭证、而 CORS 又被拆掉——等于把"带凭证读内网接口响应"的能力送给 session 里所有代码。至少做其一：ACAO 改写对资产域名豁免；或注入按来源收窄（见下条）。
3. **注入范围收窄**：URL 精确域名白名单是底线；更稳的是同时校验 `details.webContentsId` / frame 来源，只对"那两个资产 iframe 发起的请求"注入，避免凭证被 session 里其他内容蹭走（CSRF 放大面）。
4. **WebSocket 验证项**：资产站若用 WebSocket，联调时确认握手请求被 `onBeforeSendHeaders` 覆盖到。

---

## 4. 决策树速查

```
要嵌一个 web 页面到 Electron？
├─ 页面嵌在应用布局里（有 chrome/tab/弹层）？
│   ├─ 是 → iframe（被嵌方设 frame-ancestors）
│   └─ 否，全屏独占内嵌浏览器 → WebContentsView
├─ <webview> 标签 → 永远不用
└─ 被嵌页面要登录？
    ├─ 它的 SSO 能在 iframe 里跑？ → 不能，结构性的，别试
    ├─ 宿主已持有被嵌站后端认的凭证？
    │   └─ 是 → 主进程 webRequest 网络层注入 ★ 本案
    ├─ IT 愿意加 redirect_uri 白名单？ → 是 → 系统浏览器 + 回调（RFC 8252）
    ├─ 后端自家可改？ → 宿主中转 Bearer token（Teams tab SSO 模式）
    └─ 都不行 → Electron 子窗口顶级登录 + SameSite=None cookie（要 HTTPS，有政策风险）
```

---

## 5. 本仓现状备忘

- 壳：Electron 42，单 `BrowserWindow`（`packages/desktop/src/main/windows.ts`），`contextIsolation: true` + `sandbox: true`，`webviewTag` 未开——iframe 方案无需动主进程窗口配置。
- webRequest 两个事件已被 CORS 改写占用（同文件 `createMainWindow` 内），注入实现要合并进去（§3.4-1/2）。
- iframe 页面走 Chromium 网络栈（非 Node），内网网关对 UA / TLS 的拦截行为（见 [terminal-proxy-and-corporate-gateway.md](terminal-proxy-and-corporate-gateway.md)）理论上不影响，但首次联调值得留一个验证项。
