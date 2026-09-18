# SPEC-DES-005 — fastui 预览卡片独立 subtype，接上分辨率切换

> 状态：已实现待验证（2026-09-18） · 优先级 P2（设计师可用性） · 规模 [S] · 领域 infra/design
>
> 上游已实现：✗ —— 上游 opencode（`packages/ui`、`packages/app`）没有 artifact / subtype 注册机制，也没有视口预设；复用的是 octoapp Design 页自建的 `subtype-registry` + `SUBTYPE_CONFIG`
>
> 前置：[SPEC-DES-004](fastui-preview-identity.md)（预览卡片 `fastui://<产物名>`，点击时由主进程当场给地址）。**本 spec 不改 004 的任何预览身份逻辑**（卡片格式、取地址、起服务、清理）。

---

## 0. 问题

fastui 预览卡片打开的 tab 是 `{ type: "html", subtype: "url" }`，和所有 http(s) 外链共用一个 subtype，能力开关也跟着外链走。`url` 的能力表里分辨率切换是关的，于是设计师在 fastui 预览上**切不了分辨率**，看不了页面在 1440 / 平板 / 手机下的样子。

同时，fastui 专属的「导出代码包」按钮挂在通用外链的 handler（`url.tsx`）上，靠「是不是 fastui 卡片」的判断在运行时隐藏，通用外链 handler 因此不干净。

## 1. 方案

注册一个独立 subtype，名字就叫 **`fastui`**：

| 注册点 | 文件（`packages/app/octoapp/pages/make/`） | 内容 |
|---|---|---|
| 处理器 | `subtype-handlers/fastui.tsx`，在 `utils/subtype-registry.ts` 里 `registerSubtypeHandler` | `...defaultHandler` + 「导出代码包」按钮（从 `url.tsx` 原样搬来） |
| 能力表 | `utils/subtype-config.ts` 的 `SUBTYPE_CONFIG.fastui` | 见 §2 |
| 开 tab | `index.tsx` 里 fastui 卡片分支（004 §3.3 那段） | `subtype: "url"` → `subtype: "fastui"`，其余一字不动 |

两张表都是按 subtype 名字查的（`getSubtypeHandler(tab.subtype)` / `getSubtypeConfig(tab.subtype)`），查不到回落 `_default`。

**类型是开 tab 时显式写死的**，不经过「按文件名后缀推断 subtype」那条规则（`extractSubtypeFromTitle`，给 `登录页.shadcn.html` 这类文件卡片用的），与 dev server 地址、产物名都无关。

`url.tsx` 回归为纯粹的通用外链 handler（只剩 `...defaultHandler`），能力表不变。

## 2. 能力表：`url` 原样 + 打开分辨率切换

| 开关 | fastui | 理由 |
|---|---|---|
| refresh | ✅ | 004 已接好「刷新不闪」（再向主进程要一次地址） |
| modeToggle | ❌ | tab 的 `content` 是空串，没有单文件源码可看；源码视图只会是空编辑器。关掉后 `mode` 默认 `preview`，不影响分辨率切换的门禁 |
| **viewport** | ✅ | 本 spec 的目的 |
| localEdit / modelEdit / drawEdit / canvasEdit / comment | ❌ | 都依赖注入到 srcdoc 的 bridge + postMessage；跨域的 dev server 页面里没有 bridge |
| archive | ❌ | 不会静默产出空图：`html-renderer` 归档流程对 `shouldUseExternalUrl()`（004 起包含 `fastui://`）显式报「归档失败：外部 URL 不支持归档」。打开只会多一个每次必失败的按钮。真要归档需改走 Electron `webContents.capturePage`，不在本 spec |
| history | ❌ | `history-controller` 已排除 `fastui://`，没有磁盘文件可记 |
| download | ❌ | 没有单文件；fastui 的「下载」就是「导出代码包」（extraButtons） |
| fullscreen | ✅ | 同 url |

## 3. 分辨率切换的实际行为

- **是 CSS 尺寸 + 缩放，不改 src**：固定尺寸档位下 iframe 设成目标宽高（如 1440×1080）再 `transform: scale()` 缩进画布。页面内 media query 按 iframe 的 CSS 宽度生效。取地址的 effect 依赖里没有 viewport，切换**不会**重新向主进程要地址、不会重起服务。
- **已知行为（保留）**：`html-renderer` 按 `isResponsive()` 渲染两个不同的 iframe 分支。
  - 固定尺寸之间切换（1920 ↔ 1440 ↔ 平板 ↔ 手机）：同一个 iframe，**不重载**
  - 「桌面（自适应）」↔ 任一固定尺寸：iframe 重建，**同一地址重新加载一次**，页面内的路由 / 状态回到入口。004 状态机此时已是 `ready`，不会出现编译遮罩
  - 这是所有 subtype 共有的既有逻辑，不为 fastui 单独改（改它要动共用渲染器，影响全部 subtype）

## 4. 老卡片

004 之前生成的 `http://127.0.0.1:<port>` 卡片，在 fastui 会话里由 004 的逻辑转成 `fastui://`（产物名为空串）后开 tab，现在同样落到 `fastui` subtype，分辨率切换与导出按钮一并可用。

标题逻辑不变：`fastuiName || card.title`，老卡片取 `card.title`，即 `extractLinkTitle` 从 URL 退回的 host —— **显示 `127.0.0.1:<port>`**。按「产物名原样当标题、不美化」，老卡片没有产物名可取，不做处理。

## 5. 不做

- **手动 `/preview http://127.0.0.1:<port>` 不再显示导出按钮**。原 `url.tsx` 对「loopback 地址 + fastui 会话」也挂导出；搬到 `fastui` handler 后只认 `fastui://` 身份。fastui 只走卡片预览；裸端口认不出产物（004 的前提），不去猜。
- **全局 viewport 泄漏到外链 tab**（存量问题，暂不动）：`result-viewer/index.tsx` 的 `viewport` 是所有 tab 共用的一个 signal，且不看能力开关就传给 `HtmlRenderer`。在能切分辨率的 tab 上选了固定尺寸，再切到 `url` tab，外链也按那个尺寸缩放、却没有切换按钮可改回。fastui 自身有切换，不受影响；外链 tab 是存量行为、至今无人反馈，留待有需要时单独修（修法：能力关时给 `HtmlRenderer` 传 `"desktop"`）。
- **按文件名后缀推断 subtype 的误判**（存量机制）：磁盘上叫 `xxx.fastui.html` 的普通 HTML 会被推成 `fastui`（`.url.html` 现已同理）。与本 spec 引入无关，不动。

## 6. 改动清单

| 仓 | 文件（`packages/app/octoapp/pages/make/`） | 改动 |
|---|---|---|
| UXAI | `subtype-handlers/fastui.tsx` | 新增：fastui handler，导出按钮只认 `fastui://` |
| | `subtype-handlers/url.tsx` | 删掉 fastui 专属的导出按钮，回归 `...defaultHandler` |
| | `utils/subtype-registry.ts` | 注册 `fastui` |
| | `utils/subtype-config.ts` | 新增 `fastui` 能力表 |
| | `index.tsx` | fastui 卡片开 tab 时 `subtype: "fastui"` |
| | `utils/fastui-export.ts` | 仅注释（导出判据的说明不再以 url subtype 为前提） |
| | `utils/fastui-subtype.test.ts` | 新增单测，见 §7.1 |

## 7. 验证

全部可在外网 Mac 上完成，不需要内网。

### 7.1 单测（自动化）

`packages/app` 下：

```bash
bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-subtype.test.ts ./octoapp/pages/make/utils/fastui-preview.test.ts
```

- `fastui` 能力表 = `url` 能力表 + `viewport: true`，逐项相等
- `url` 能力表保持原样（钉死，防回归）
- `fastui` 有独立条目，不回落 `_default`；handler 注册在 `fastui` 名下
- `url` handler 不再挂任何 extraButtons
- 导出按钮：`fastui://<名>` 在 fastui 会话中显示；老卡片转来的 `fastui://`（空名）同样显示；非 fastui 会话不显示；裸 `http://127.0.0.1:<port>` 不显示且不触发会话探测
- 004 的状态机单测一并跑，确认未受影响

### 7.2 Electron 手工（Mac）

准备：沿用 004 §6.1 末条的假共享池做法，把假 `turbo-ui-cli-service.js` 换成下面这个**能看出有没有重载**的页面（显示加载时刻、视口宽高、hash 二级页，按宽度换底色）：

```js
// <假共享池>/deps/node_modules/@turboui/turbo-ui-cli-service/bin/turbo-ui-cli-service.js
const http = require("http")
const port = Number(process.env.OCTO_PORT)
const page = `<!doctype html><meta charset="utf-8"><title>fastui viewport check</title>
<style>body{font:16px sans-serif;margin:24px;background:#e8f0ff}
@media (max-width:900px){body{background:#fff3d6}}
@media (max-width:500px){body{background:#e6f7e6}}</style>
<h1 id="route"></h1><p>加载于 <b id="t"></b></p><p>视口 <b id="w"></b></p>
<p><a href="#/second">去第二页</a> · <a href="#/">回首页</a></p>
<script>
document.getElementById("t").textContent = new Date().toLocaleTimeString()
const w = () => document.getElementById("w").textContent = innerWidth + " × " + innerHeight
const r = () => document.getElementById("route").textContent = location.hash === "#/second" ? "第二页" : "首页"
addEventListener("resize", w); addEventListener("hashchange", r); w(); r()
</script>`
http.createServer((_q, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(page) })
  .listen(port, "127.0.0.1", () => console.log("Compiled successfully"))
```

`OCTO_FASTUI_ENV_DIR=<假共享池> bun run dev` 起桌面端，新建 Design 对话，按 004 §6.1 放好 `.octo-fastui.json` 与 `outputs/alpha/packages/portal/`，让模型原样回复 `<artifact type="text/link">fastui://alpha</artifact>`。

| # | 操作 | 期望 |
|---|---|---|
| **V1 按钮出现** | 点卡片，等页面出来 | action bar 有分辨率切换、刷新、全屏、「导出代码包」；**没有**预览/源码切换、编辑类、标注、归档、历史、下载 |
| **V2 固定尺寸生效** | 依次切到 1440、平板、手机 | 「视口」显示 1440 × 1080 / 820 × 1180 / 390 × 844；底色依次蓝 → 黄 → 绿；画面按比例缩进画布 |
| **V3 固定尺寸间不重载** | 在 1440 下点「去第二页」，再切 1920、平板、手机 | 标题一直是「第二页」，「加载于」时刻不变 |
| **V4 自适应↔固定会重载（已知行为）** | 在固定尺寸的第二页上切回「桌面」 | 回到「首页」、「加载于」更新；**不出现**「编译中」遮罩；主进程日志里没有新的起服务记录 |
| **V5 刷新** | 固定尺寸下点刷新 | 页面重载，尺寸档位保持；不闪编译遮罩 |
| **V6 导出** | 点「导出代码包」 | 行为同 004 N9（外网假工程下能走到导出流程即可） |
| **V7 老卡片** | 让模型回复 `<artifact type="text/link">http://127.0.0.1:8081</artifact>` 并点它 | tab 标题为 `127.0.0.1:8081`；能切分辨率、有导出按钮；页面由 004 逻辑取出 |
| **V8 回归·外链** | `/preview https://example.com` | 行为同改动前：无分辨率切换、无导出按钮 |
| **V9 回归·其他 Design** | 普通 html 产物、shadcn / prototype 产物 | action bar 与改动前一致 |

## 8. 边界

- V4 的重载是既有逻辑（§3），真实 fastui 工程（webpack dev server）重载比假页面慢，属预期
- 真实组件库页面的响应式表现取决于页面自身写法，本 spec 只保证 iframe 按档位给出正确的 CSS 视口
