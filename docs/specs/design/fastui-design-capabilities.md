# SPEC-DES-007 — fastui 产物对齐 Design 通用能力（局部修改 / 历史 / 标注 / 归档）

> 状态：草案 v3（2026-10-21：§3 局部修改按内网 `__file` 实测结果重写并展开；§7 归档改为复用选目录弹窗、只上传源码 zip；§2.4 热更新本次不修）。v2（2026-10-20）：归档纳入、画布编辑延后、新增热更新不通的发现 · 优先级 P1（设计师可用性） · 规模 [M~L] · 领域 infra/design
>
> 上游已实现：✗ —— 上游 opencode（`packages/ui`、`packages/app`）没有 artifact 编辑面板；本 spec 复用的是 octoapp Design 页自建的 subtype 体系（`SUBTYPE_CONFIG` + subtype handler + bridge 脚本），以及仓内两份开发指南 `subtype-handlers/ModelEdit.md`、`subtype-handlers/history.md`
>
> 前置：[SPEC-DES-004](fastui-preview-identity.md)（`fastui://<产物名>` 预览身份，点击时由主进程当场给地址）、[SPEC-DES-005](fastui-subtype.md)（独立 subtype `fastui`）。**本 spec 不改 004 的预览身份逻辑和 005 的分辨率切换。**
>
> 路径：本 spec 中 `.octo/<sid>/outputs/<产物名>` 形式的工程路径（§3.6 示例、§11 验证步骤）是普通工作区的布局；代码工作区下工程在 `<工作区>/<产物名>`，导出接口改为按（工作区, 会话, 产物名）定位，见 [SPEC-DES-008](fastui-workspace-layout.md)。

---

## 0. 问题与目标

HTML 类产物（`_default` / `components`（HUI）/ `gts` / `page` 等）在 Design 结果面板上有局部修改、历史版本、标注、画布编辑等一组通用能力。fastui 产物（SPEC-DES-001，真实脚手架 + webpack dev server 预览）目前只有刷新、分辨率、全屏和「导出代码包」。

目标：在 fastui 的工程形态下（没有单个 HTML，页面来自跨域 dev server，源码是一组 `.vue`），**尽可能接上与 HTML 产物一致的能力**，做不到的写清原因。

## 1. 结果面板功能清单与本次范围

能力由两层决定：`utils/subtype-config.ts` 的能力开关决定显示什么，subtype handler 决定怎么做。

| 按钮 | 开关 | 做什么 | 依赖 | 本次 |
|---|---|---|---|---|
| 刷新 | `refresh` | 重载预览 | — | 已有 |
| 预览/源码 | `modeToggle` | 切到单文件源码编辑器 | tab 内有单文件内容 | **不做**：没有单文件 |
| 分辨率 | `viewport` | CSS 缩放到各档位 | — | 已有（005） |
| 局部修改（新） | `modelEdit` | 点选元素 → 属性面板（文本 / 字体 / 颜色 / 尺寸 / 布局 / 边距 / 边框 / 效果 / 背景图）+「AI 修改」自由输入；面板改值即时预览，保存交给模型 | model-edit bridge | **做**（§3） |
| ↳ 图标替换 / 资产替换 | `iconConfig` / `assetConfig` | 选图标或资产目录替换元素 | 同上 | **不做**：fastui 图标已进开发组件库，替换方式与 HTML 产物不同 |
| 局部修改（旧） | `localEdit` | 按 HTML 源码打补丁 | 单文件 HTML | **不做**：已被 modelEdit 取代，仅 shadcn / prototype 在用 |
| 框选编辑 | `drawEdit` | 画框截图交给模型 | — | **不做**：2026-09-10 全局下线（UXAI `c7332ced6`），仅 `demo` / `demoedit` 测试 subtype 保留 |
| 画布编辑 | `canvasEdit` | 打包传 Pixso | HTML + 同目录资源 | **延后**：调研结论留在 §6 |
| 标注 | `comment` | 页面上打点评论 | comment bridge | **做**（§5） |
| 归档 | `archive` | 选目录后上传交付件 | HTML 交付件需截图 + 磁盘 HTML | **做**：只归档源码 zip（§7） |
| 历史 | `history` | 版本快照与切换 | 磁盘文件路径 | **做**（§4） |
| 下载 | `download` | — | — | 不做：已有「导出代码包」 |
| 全屏 | `fullscreen` | — | — | 已有 |

**保存方式只用 Prompt 模式。** modelEdit 保存有两种：Direct（取 iframe DOM 快照直接写回 HTML，不经模型）和 Prompt（把「哪个元素、改了什么」拼成提示词交给模型改源码）。fastui 没有可写回的 HTML，只能用 Prompt。HUI（`components`）用的也是 Prompt —— 它「改完热更新」指的是构建产物更新后预览自动刷新，不是 Direct 写回。

## 2. 核心卡点：bridge 进不了 fastui 页面

### 2.1 现状

局部修改、即时预览、标注都靠 iframe 内的 bridge 脚本与宿主 `postMessage` 通信：

```
点击元素 → bridge 发 od:model-edit-selected → 宿主弹属性面板
面板改值 → 宿主发 od:edit-preview-style   → bridge 改 DOM（即时预览）
```

HTML 产物的 bridge 是在 Electron 主进程的 `local://` 协议处理器里注入的（UXAI `packages/desktop/src/main/windows.ts` `registerLocalProtocol`）：读文件 → 按文件名认 subtype → 在 `</body>` 前插入 `<script>` → 返回给 iframe。

fastui 的 iframe 地址是 `http://127.0.0.1:<端口>`，请求直达 webpack dev server，不经过这个处理器，**页面里没有 bridge**。005 因此把编辑类开关全关了。

**跨域本身不是障碍**：已核对 `html-renderer.tsx`、`model-edit-panel.tsx` 在 modelEdit / comment 链路上没有任何 `contentDocument` 访问，全部是 `postMessage(…, '*')`。只要 bridge 能在页面里跑起来，宿主侧逻辑不用改。

### 2.2 方案对比

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. 主进程注入子 frame** | iframe `load` 后，主进程在窗口的 frame 树里找到该 frame，`webFrameMain.executeJavaScript(bridge 脚本)` | **选定**。不碰脚手架和交付代码；同一份 bridge 脚本 |
| B. 反向代理 dev server | 预览走本地代理，代理改写 HTML 插入 `<script>` | 否决：004 已否决代理（身份与端口问题）；HMR 的 websocket 也得代理，链路变长 |
| C. 脚手架内 dev-only 注入 | `turboui.config.js` 加插件或中间件注入 | 否决：001 §1.5 明确排斥对 `turboui.config.js` 的代码层污染，且会跟随交付给开发 |

### 2.3 方案 A 设计

**触发**：html-renderer 已有 fastui 的 iframe `load` 接线点（`fastuiPreview.frameLoaded(...)`）。在同一处、iframe 已挂上地址时，调用新 IPC：

```ts
fastuiInjectBridges?: (frameUrl: string) => Promise<{ ok: true } | { ok: false; error: string }>
```

**主进程**：

1. **校验**：`frameUrl` 的 host 必须是 `127.0.0.1`，端口必须在 `fastui-devserver.ts` 的 `running` 表里（本进程起的 fastui 服务）。不满足就返回 `ok: false`，不注入任意页面。
2. **找 frame**：`event.sender.mainFrame.framesInSubtree` 中按 `origin` 匹配。找不到时返回 `ok: false` 并记日志（响亮失败，不重试猜测）。
3. **注入**：对该 frame `executeJavaScript(脚本正文)`。脚本集合由桌面端 `bridge-config.ts` 新增的 `fastui` 条目经 `getBridgeConfigForSubtype('fastui')` 决定，与 `local://` 共用同一份判定。只取「运行时可用」的部分（见下表），`<script>` 标签剥掉、只执行正文。
4. **防重复**：脚本前加 `if (window.__odFastuiBridges) return; window.__odFastuiBridges = 1`。同一文档重复调用无副作用。

| bridge | 注入 | 理由 |
|---|---|---|
| model-edit（`MODEL_EDIT_BRIDGE_SCRIPT`） | ✅ | 局部修改与即时预览 |
| edit / edit-style | ✅ | `getBridgeConfigForSubtype` 在 modelEdit 开启时一并注入，保持一致（spike 时确认是否必需） |
| comment | ✅ | 标注 |
| `fastui-vue-source`（新增，§3.5.3） | ✅ | 元素归属判定 |
| annotate（`annotateElementsWithIds`） | ❌ | 是对 HTML 字符串的预处理，运行时注入无意义；comment 与 model-edit bridge 都会在 live DOM 上按需补 `data-od-id` |
| sandbox shim / picker / inspect / snapshot / resource-collector | ❌ | 本次没有对应功能（归档只传源码 zip，不截图，§7） |

**时序**：

- 已核对：model-edit 和 comment bridge 都不依赖 `DOMContentLoaded`；元素 id 在点击时才分配（`model-edit-bridge.ts` 选中时 `setAttribute('data-od-id')`），适合 SPA。
- model-edit bridge 自带嵌套 iframe 注入（`me_injectNestedIframes` + `MutationObserver`），微前端基座如套 iframe 也能覆盖。
- 整页重载（webpack live reload、刷新按钮、自适应↔固定分辨率切换）会让 iframe 重新 `load`，自动重新注入。HMR 不重载文档，bridge 一直在。
- 注入完成前用户点「局部修改」：宿主发出的 `od:model-edit-mode` 无人接收。注入在 `load` 后立即进行，窗口极短。宿主在 IPC 返回 `ok` 后补发一次当前模式状态（编辑中 / 标注中）即可。

### 2.4 相关发现：Octo 预览里 dev server 的热更新客户端连不上

2026-10-20 内网截图（预览 `127.0.0.1:<端口>`）的 iframe console 中有：

```
[WDS] Disconnected!
Access to XMLHttpRequest at 'http://localhost.huawei.com:<端口>/sockjs-node/info?t=…' from origin 'http://127.0.0.1:<端口>'
has been blocked by CORS policy: … credentials mode of requests initiated by the XMLHttpRequest is controlled by the withCredentials attribute.
```

**原因**：001 §6.4「host 用 `127.0.0.1`」记录过，脚手架默认 `host: 'localhost.huawei.com'`（UAC cookie 绑在 `.huawei.com` 上），我们改用 `127.0.0.1` 访问页面。但 webpack-dev-server v3 的浏览器端客户端仍按 devServer 配置里的主机名连 sockjs。从 `127.0.0.1` 发出的带凭据跨域请求被 CORS 拦下，**live reload 和 HMR 都没有生效**。

**影响**：

- 模型改完 `.vue` 后预览不会自动更新，要手动点刷新。这是 fastui 预览的现状，不是本 spec 引入的。
- 本 spec 中受影响的只有局部修改保存后的回显（§3.1 第 6 步）：设计师需手动点刷新。历史切换走 `switchVersion` 自带的 iframe 刷新（`history.md` §3.4），不依赖 HMR。

**决定（2026-10-21）：本次不修**，先靠刷新按钮把流程跑通，有需求再改。可选修法留档：

| 方案 | 做法 | 评价 |
|---|---|---|
| a. 让客户端连页面自己的主机 | `turboui.config.js` 的 devServer 再加一处带回退的环境变量注入（如 `public` / `sockHost` 读 `OCTO_*`），宿主启动时传 `127.0.0.1:<端口>` | 根因修复，HMR 不丢路由状态；沿用 001 §2.2 环境变量注入带回退的先例。需要先看内网 `turboui.config.js` 的 devServer 段与 webpack-dev-server 版本 |
| b. 宿主兜底刷新 | 模型一轮结束（`session.idle`）后宿主刷新 fastui 预览 | 不碰模板；但整页重载会让 SPA 回到入口路由 |

## 3. 局部修改（modelEdit）

### 3.1 设计师看到的完整流程

1. 打开 fastui 预览，点 action bar 的「局部修改」，进入编辑模式。
2. 在预览里点一个元素（比如页面标题）。元素出现选中框，旁边弹出属性面板，面板按元素类型给出控件：文字类给字体 / 字号 / 颜色 / 对齐，容器类给尺寸 / 布局 / 边距 / 边框 / 背景等（`ModelEdit.md` §3.2.2 的默认组合，不为 fastui 定制）。
3. 在面板里改值，比如把颜色改成红色。**预览里的元素立刻变红**（即时预览，只改了浏览器里的 DOM，还没动源码）。
4. 点「保存」。宿主把「哪个文件里的哪个元素、哪些属性从什么改成什么」拼成一段提示词，作为一条用户消息发给模型。面板等模型回复完自动关闭。
5. 模型打开对应的 `.vue` 改源码，跑 `verify` 确认编译通过。
6. 设计师点「刷新」看到最终效果（热更新暂未修，见 §2.4）。

面板上另有两个入口：

- **删除**：发「删除这个元素」的提示词，同样由模型改源码。
- **AI 修改**：设计师自己写一句话（比如「改成两列布局」），宿主在前面加上元素位置信息再发给模型。

### 3.2 一次操作里各方做了什么

```
设计师          宿主（html-renderer / 面板）        iframe 内 bridge                      模型
  │ 点「局部修改」     │                                  │                                     │
  │──────────────────▶│ postMessage od:model-edit-mode ─▶│ model-edit：开启点选                 │
  │                   │                                  │ fastui-vue-source：开始监听点击      │
  │ 点「标题」         │                                  │                                     │
  │───────────────────┼─────────────────────────────────▶│ ① fastui-vue-source 先拿到点击：      │
  │                   │                                  │    查 Vue 组件链，在元素上写           │
  │                   │                                  │    data-od-vue-file="src/views/…"     │
  │                   │                                  │ ② model-edit 再拿到点击：收集元素信息 │
  │                   │◀── od:model-edit-selected ───────│    （含 data-od-vue-file 属性）        │
  │                   │ 弹出属性面板                     │                                     │
  │ 改颜色             │                                  │                                     │
  │──────────────────▶│ onChange → od:edit-preview-style▶│ 改元素 inline style（即时预览）       │
  │ 点「保存」         │                                  │                                     │
  │──────────────────▶│ saveCallback 拼提示词 ───────────┼────────────────────────────────────▶│ 改 .vue + verify
  │ 点「刷新」         │ iframe 重载 → 重新注入 bridge    │                                     │
```

### 3.3 哪些现成、哪些要新写

| 环节 | 现状 | 本次 |
|---|---|---|
| 进入编辑模式、点选、选中框、面板、控件 | model-edit bridge + `model-edit-panel`，所有 HTML 产物共用 | **复用**，只要 bridge 进得去（§2） |
| 即时预览 | `directModelEditConfig.onChange`（只发 postMessage 改 DOM，不写盘） | **复用**，挂到 fastui 的 config 上 |
| 提示词主体（标签 / 类名 / 选择器 / 当前 HTML / 修改项） | `defaultModelEditConfig` 的 `buildModelEditPrompt` / `buildModelDeletePrompt` | **复用**，外面包一层 fastui 指引（参照 `components.tsx` 的 `wrapComponentsPrompt`） |
| 工程路径 | 无 | **新增**：§3.4 |
| 元素 → `.vue` 文件 | 无（其他 subtype 只给选择器，让模型自己找） | **新增**：§3.5 的 `fastui-vue-source` bridge |
| 「AI 修改」拿元素信息 | `promptCallback(filePath, selector)` 只有两个参数 | **小改共享层**：加可选第三个参数 `element?: ModelEditElement`（`model-edit-area-dialog.tsx` 调用处传入），已有实现忽略它，行为不变 |
| 图标 / 资产替换 | `iconConfig` / `assetConfig` | 不配置（§1） |

fastui handler 最终的 `modelEditConfig`：

```ts
const fastuiModelEditConfig: ModelEditConfig = {
  htmlFlag: 'data-od-vue-file',                    // 让 model-edit bridge 上报这个属性（§3.5.3）
  onChange: directModelEditConfig.onChange,        // 即时预览
  saveCallback: (args) => withFastuiContext(args, defaultModelEditConfig.saveCallback(args)),
  deleteCallback: (args) => withFastuiContext(args, defaultModelEditConfig.deleteCallback(args)),
  promptCallback: (filePath, selector, element) => fastuiPromptPrefix(element),
  onBridgeMessage: (data) => { /* 处理 od:fastui-framework-element，见 §3.5.4 */ },
}
```

`withFastuiContext` 读元素上的 `data-od-vue-file`，按 §3.5.4 的三种情况决定提示词怎么包。

### 3.4 工程目录

提示词要给模型真实的磁盘路径，而 `tab.filePath` 是 `fastui://<产物名>`。老卡片的产物名为空串，只有主进程的 `resolveProject` 能确定是哪个工程。所以**扩展 `fastuiPreviewOpen` / `fastuiPreviewRestart` 的成功返回值，带上 `projectDir`**（主进程本来就已解析出来，只是没往回传）。html-renderer 存进 fastui 预览状态，handler 从上下文读。路径只有这一个来源，渲染端不重复拼。

webpack context 是 `<projectDir>/packages/portal`（001 §2.2），`__file` 的相对路径以它为基准。模型唯一可写的目录是其下的 `src/views/`（001 的 `WRITE_DIR`）。

### 3.5 元素归属：从 DOM 元素找到它的 `.vue` 文件

#### 3.5.1 原理

Vue 3 开发构建下，每个 DOM 元素上挂着 `__vueParentComponent`，指向渲染它的组件实例；实例的 `.parent` 一路指到根组件，构成「组件链」。vue-loader 编译 `.vue` 时，会在组件定义上写 `__file`（文件路径）。所以从元素出发沿组件链往上走，就能**确定地**读出它属于哪个文件，不用让模型按选择器去猜。

#### 3.5.2 内网实测（2026-10-20，组件市场详情页）

在预览 frame（`http://127.0.0.1:8084/?_octo_v=6#/uiView`）里扫描整页所有元素的组件链，结果（节选）：

| `__file` | 组件名 | 说明 |
|---|---|---|
| `src/main.vue` / `src/app.vue` / `src/index.vue` | main / app / index | 工程自己的文件：**相对 webpack context 的路径**，以 `src/` 开头 |
| `src/widgets/locales/turbo-locales.vue` | turbo-locales | 脚手架自带文件，也以 `src/` 开头，但不在 `src/views/` 下 |
| `divider.vue` / `trigger.vue` / `popper.vue` / `tooltip.vue` / `dropdown.vue` / `input.vue` | ElDivider / ElPopperTrigger / ElPopper / ElTooltip / ElDropdown / ElInput | **element-plus 预编译包也带 `__file`，但只有文件名**，没有目录 |
| （无） | ElConfigProvider / LakeLayout / Header / LakeTooltip / LakeInput / ElMenu … | lake 组件和部分 element-plus 组件没有 `__file` |
| （无） | （匿名） | 渲染函数 / 函数式组件 |

结论：

- `__file` **可用**，工程文件给的是以 `src/` 开头的相对路径。
- 首版设想的规则「取第一个不含 `node_modules` 的 `__file`」**不成立**：element-plus 的 `input.vue` 这类只有文件名，会被误认成工程文件。
- 生成页面（`src/views/<页面>/index.vue`）的行在截图范围外，尚未亲眼确认，见 §11.3 N1。

#### 3.5.3 判定规则与实现

**规则**：从元素的 `__vueParentComponent` 沿 `.parent` 往上，取第一个 `type.__file` 以 `src/views/` 开头的组件。

- 只认 `src/views/`，因为这是模型唯一可写的目录，也是生成页面所在的地方。element-plus（只有文件名）、lake（没有 `__file`）、脚手架自带的 `src/widgets/…` 都会被跳过。
- 点在 element-plus 按钮内部，会落到使用这个按钮的生成页面文件。这是对的：要改的是页面里的 `<el-button>` 写法，不是组件库。

**新增 bridge `fastui-vue-source`**（随 §2.3 一起注入），逻辑：

```js
(function () {
  var editing = false
  addEventListener('message', function (e) {
    var d = e.data
    if (d && d.type === 'od:model-edit-mode') editing = !!d.enabled
  })
  function ownerFile(el) {
    var sawVue = false
    for (var i = el && el.__vueParentComponent; i; i = i.parent) {
      sawVue = true
      var f = i.type && i.type.__file
      if (f && f.indexOf('src/views/') === 0) return f
    }
    return sawVue ? '@framework' : null      // null：页面没有 Vue 组件信息
  }
  function onPointer(e) {
    if (!editing) return
    var file = ownerFile(e.target)
    if (file === '@framework') {             // 情况 ②：脚手架框架里的元素
      e.preventDefault(); e.stopImmediatePropagation()
      if (e.type === 'click') parent.postMessage({ type: 'od:fastui-framework-element' }, '*')
      return
    }
    if (file) e.target.setAttribute('data-od-vue-file', file)
  }
  // 挂在 document 的捕获阶段：比 model-edit bridge 挂在 body 上的捕获监听更早执行
  document.addEventListener('mousedown', onPointer, true)
  document.addEventListener('click', onPointer, true)
})()
```

**属性怎么传回宿主**：model-edit bridge 上报元素时，只收集一组固定属性（`class` / `id` / `href` 等），外加 config 里 `htmlFlag` 指定的那一个（`model-edit-bridge.ts` 的 `attrNames`）。所以 fastui config 配 `htmlFlag: 'data-od-vue-file'`，这个属性就会出现在 `dom.attributes` 里。`htmlFlag` 的另一个作用是查 `htmlConfig[值]` 换面板，fastui 不配 `htmlConfig`，所以面板仍走默认组合，不受影响。

`当前HTML`（`htmlHint`，元素 outerHTML 截断）里会带上这个属性。拼提示词时用正则去掉 ` data-od-vue-file="…"`，属性是我们自己写的，格式固定。

实现时需确认：model-edit bridge 选中的元素就是 `e.target`（未配 `componentFlag` 时不向上冒泡找组件根）。若不是，改为对事件路径上每个元素按各自的组件链写属性。

#### 3.5.4 三种情况

| 情况 | 判定 | 处理 |
|---|---|---|
| ① 元素在生成页面里 | `data-od-vue-file` 是 `src/views/…` | 正常：提示词带上「元素所属源文件」，模型直接改这个文件 |
| ② 元素在脚手架框架里（顶部导航、侧边菜单、布局壳） | 组件链里有 Vue 组件，但没有 `src/views/` 下的 | **不让选中**：bridge 拦下点击，宿主 `onBridgeMessage` 提示「该区域属于页面框架，不在本次生成的内容中，不支持修改」。这些文件模型本来就不能改（001 的可写目录约束），放它进面板只会让设计师改完才发现无效 |
| ③ 页面没有组件信息 | 元素上没有 `__vueParentComponent`（例如将来脚手架改成生产构建预览） | 退回其他 subtype 的基线做法：提示词不写源文件，给选择器 + 类名 + HTML 片段，要求模型在 `src/views/` 下定位 |

已知小缺陷：情况 ② 的元素在编辑模式下仍会有悬停高亮（model-edit bridge 的 hover 逻辑不经过点击），只是点不进去。

### 3.6 提示词

保存时发给模型的完整示例（情况 ①，把标题改红）：

```
预览工程目录：D:/work/.octo/ses_xxx/outputs/组件市场详情页/packages/portal
元素所属源文件：D:/work/.octo/ses_xxx/outputs/组件市场详情页/packages/portal/src/views/detail/index.vue
本页面由 fastui 脚手架的 webpack dev server 实时编译，修改源码后不需要手动编译或重启服务。

请修改以下元素:
标签: <h2>
类名: detail-title
选择器: div.detail-header > h2.detail-title（该元素可能是动态生成的）
当前HTML: <h2 class="detail-title">数据预处理组件</h2>

修改内容:
  color: #191919 → #E5484D

操作要求：
1. 只修改「元素所属源文件」；不要改 src/views/ 以外的文件，不要改 node_modules
2. 样式改该文件 <style> 中对应的规则；组件库组件优先改属性，不要覆盖其内部样式
3. 元素若由 v-for 生成，修改会作用于同类的所有项；如只想改其中一项，先向用户确认
4. 改完运行 skill 的 verify，确认编译通过
```

- 中间一段（`请修改以下元素` 到 `修改内容`）是 `buildModelEditPrompt` 原样输出，与其他 subtype 一致。
- 情况 ③ 去掉「元素所属源文件」一行，第 1 条改为「按类名与文本在 src/views/ 下定位对应代码」。
- 「AI 修改」的前缀只有前三行，后面接设计师自己写的话。
- 措辞落地时与 fastui skill 的 `SKILL.md` 对齐（`verify` 的调用方式等以 skill 为准）。

### 3.7 即时预览的边界

即时预览是往元素上写 inline style，属于「看个样子」，不是最终结果：

- 页面里如果有响应式数据更新导致这一块重新渲染，inline style 会丢。
- 刷新后显示的是模型改完源码的真实结果。两者不一致时，以刷新后的为准。

## 4. 历史版本

### 4.1 为什么现在接不上

历史能力是通用的（`history.md`）：controller 负责触发、去重、hash 检测、串行化；subtype 只实现 `onHistoryTrigger`（记录哪些文件）和 `applyVersionFiles`（怎么恢复）。

但 `history-store` 从 `tab.filePath` 推出 `.history/` 的位置（同目录）、版本名（baseName）和相对路径基准（`getHistoryDir` / `resolveRelativePath`）。fastui 的 `tab.filePath` 是 `fastui://…`，不是磁盘路径，所以 `history-controller.ts` 的 `isEligible` 直接排除了它。

### 4.2 方案：锚点文件

| # | 改动 | 说明 |
|---|---|---|
| ① | `SubtypeHandler` 新增可选钩子 `resolveHistoryAnchor?(ctx): Promise<string \| null>` | fastui 返回 `<projectDir>/packages/portal/package.json`（真实存在的文件）。`projectDir` 来自 §3.2 |
| ② | controller 在 `isEligible` / `trigger` / `switchVersion` 入口处：handler 有锚点钩子时，以 `{ ...tab, filePath: 锚点 }` 交给 store | store 不改。`fastui://` 的排除改为「有锚点钩子则放行」。这是唯一碰通用层的改动 |
| ③ | `onHistoryTrigger`：`listDirectory(portal)` 后过滤 `^src/.+\.(vue\|js\|ts\|scss\|less\|css\|json)$` | 参照 `gts` 的动态发现（`history.md` §4.2）。`src/assets` 下的二进制不记 |
| ④ | `applyVersionFiles`：逐个 `copyFileTo(vf.filePath, vf.originalPath)` | `switchVersion` 之后会刷新 iframe（fastui 预览随 `refreshKey` 重新取地址并重载），dev server 的 watch 会重新编译，不依赖 HMR，也不需要 `updateTabContent`。**竞态**：复制完立即刷新可能早于 watch 触发（`aggregateTimeout` 默认 300ms），拿到旧 bundle。实现时刷新前等 `devserver.log` 出现新的编译完成标志（复用 001 `lib/compile.mjs` 的 `MARKERS` 判定），S7 专门验证 |
| ⑤ | `SUBTYPE_CONFIG.fastui.history = { files: ['./src'], agentTurnRecord: 'turn' }` | 模型一轮改多个 `.vue` 只记一条 |
| ⑥ | fastui 卡片开 tab 的分支（`make/index.tsx`）补 `historyController.onTabOpen` | `history.md` §8.3：新入口漏接会导致永远没有 init 版本 |
| ⑦ | `.history/` 落在 `packages/portal/.history/`：导出代码包排除它 | 改 skill 的 `export-zip.mjs` 的排除表；归档复用同一脚本（§7.2），自动一致 |

**文件集里的新文件 / 删除的文件**：版本按「记录时的文件集」存。恢复时只把版本里有的文件复制回去；模型在之后新增的文件不会被删。这与 `gts` 现有行为一致，在 §10「已知限制」中写明，不在本 spec 处理。

## 5. 标注

- `SUBTYPE_CONFIG.fastui.features.comment = { enabled: true, editOnly: true }`
- comment bridge 随 §2.3 注入
- html-renderer 加载标注处有 `if (shouldUseExternalUrl()) return`，对 fastui 放开（只放 fastui，外链仍挡）
- 标注的存储 key：`commentKeyFor(filePath)` 对 `fastui://<产物名>` 要给出稳定 key。实现时确认 `extractCommentFilePath` 对该格式的输出；不稳定就改用 `fastui/<产物名>`
- **已知风险**：comment bridge 用 live DOM 上的 `el-<n>` 顺序编号做锚点。SPA 重新渲染、HMR 改了 DOM 结构后，已有标注可能漂移到别的元素；没有锚点时会退化为自由打点（现有机制）。所有 SPA 形态的产物都有这个问题，不为 fastui 单独处理

## 6. 画布编辑（本次不做，保留调研结论）

2026-10-20 决定延后。以下结论供后续重启时使用。

### 6.1 现有打包格式（不是单个 HTML）

`utils/canvas-to-design.ts` 的 `createC2DZip` 产出：

```
octo-c2d.json            manifest：{ name, version, frames: [{ name, filePath: "./data/html.zip" }] }
data/html.zip
  ├─ index.html
  └─ HTML 所在目录内被引用的资源（静态解析 HTML 引用 + iframe 实际加载过的 local:// 资源）
```

跨出 HTML 所在目录的 `..` 引用会被丢弃。资源追踪（`resource-tracker`）只对 `local://` 有效。

### 6.2 对脚手架 HTML 产物的要求

脚手架开发已确认可以打出 HTML 产物。要求如下：

1. 输出一个自包含目录：`index.html` 与 js / css / 图片 / 字体全部在其中
2. 资源引用用相对路径（`publicPath: './'`），不用 `/static/...` 这类绝对路径，不走 CDN
3. 不依赖后端接口和微前端基座，静态服务打开即可渲染

fastui handler 届时实现自己的 `handleCanvasEdit`，把产物目录整目录打进 `data/html.zip`，不依赖引用解析。

### 6.3 重启前要先确认的

Vue 构建出的 `index.html` 本身基本只有 `<div id="app">`，内容由 JS 运行时渲染。C2D（Pixso 导入）是否执行页面 JS 决定 §6.2 是否成立；不执行则需要改传运行时 DOM 快照。

## 7. 归档：只归档源码 zip

### 7.1 现有流程与可复用的部分

已与归档功能的同事对齐（2026-10-20）：流程是「点归档 → 弹窗选目录 → 点确定 → 调接口发到 web 端」。拆开看是两段：

| 段 | 谁负责 | 内容 |
|---|---|---|
| 选目录 | 共享组件 `octoapp/components/dialog-archive.tsx` 的 `ArchiveDialog` | 拉产品树 / 团队 / 目录，记住上次选择，判断同名交付件。点确定后**只调用 `onConfirm(data: ArchiveConfirmData)` 并关闭弹窗，不上传任何东西** |
| 上传 | 调用方在 `onConfirm` 里自己做 | Design 是 `html-renderer.tsx` 的 `handleArchiveConfirm`：截图 + HTML zip → `createDeliverable` / `uploadCover` / `uploadVersion` |

`ArchiveConfirmData` 里有上传需要的全部目标信息：`teamId`、`folderId` / `folderName`、`spaceType`、产品与版本、是否覆盖等。所以思路就是：**复用选目录的弹窗，在确认回调里写 fastui 自己的上传逻辑**。

上传有两类接口，已有先例：

| 类型 | 接口 | 用在哪 |
|---|---|---|
| HTML 交付件 | `createDeliverable` + `uploadCover` + `uploadVersion`（上传固定结构的 zip：`data/` 截图与标注、`src/`、`preview/index.html`） | Design 所有 HTML 产物；Insight 的 HTML 归档 |
| **普通文件交付件** | `EdmUtil.upload`（上传文件，有进度）→ `getActivityByTeam(teamId)` 取交付件类型 → `uploadDeliverable` | Insight 的非 HTML 归档（`pages/insight/components/archive-flow.tsx` 的 `runArchiveFileTask`） |

fastui 只归档源码 zip，**走第二类**：zip 本身就是交付件，不需要 HTML 交付件那套截图 / `preview/` 结构。

### 7.2 方案

**共享层的改动（只加不改）**：`SubtypeHandler` 新增一个可选字段，html-renderer 在挂 `ArchiveDialog` 时检查它：

```ts
/** 自定义归档上传。实现后，ArchiveDialog 确认时调用它，代替默认的「截图 + HTML zip」上传 */
archiveUpload?: {
  /** 是否显示已有交付件并做同名覆盖判断（HTML 交付件才有覆盖语义，普通文件交付件为 false） */
  showDeliverables: boolean
  /** 返回成功弹窗要显示的路径与查看链接；返回 null 表示失败或取消（已自行提示） */
  onConfirm: (ctx: SubtypeHandlerContext, data: ArchiveConfirmData) => Promise<{ path: string; viewUrl?: string } | null>
}
```

| html-renderer 中的位置 | 改动 |
|---|---|
| `<ArchiveDialog onConfirm=…>` | handler 有 `archiveUpload` 时传 `archiveUpload.onConfirm`（包一层补上 ctx），否则仍是 `handleArchiveConfirm` |
| `<ArchiveDialog showDeliverables=…>` | 有 `archiveUpload` 时传 `archiveUpload.showDeliverables`，否则不传（默认 true） |
| 成功弹窗 | `onConfirm` 返回非 null 时，用返回的 `path` / `viewUrl` 打开现有的成功弹窗 |

`handleArchiveConfirm` 本身一行不动，其中的「外部 URL 不支持归档」门禁也保留：fastui 不再走到那里。没有实现 `archiveUpload` 的 subtype 行为完全不变。

**fastui 的 `archiveUpload`**：`showDeliverables: false`，`onConfirm` 依次：

1. 调用现有的 `fastuiExportZip(sessionDir, 产物名)`。它与「导出代码包」是同一个 `export-zip.mjs`：跳过依赖链接、排除 `.history/`，返回 `zipPath`。
2. `readFileBuffer(zipPath)`，包成 `File`，文件名 `<产物名>.zip`。老卡片产物名为空串时，用 `projectDir` 的末段（§3.4）。
3. 检查大小在 EDM 允许区间（1B ~ 4GiB）内，否则提示「归档失败：文件大小超出限制」。
4. `getActivityByTeam(data.teamId)` → `EdmUtil.upload`（登记 TaskStore 上传任务，有进度、可取消）→ 完成后 `uploadDeliverable({ typeId, files, teamId })`。
5. 成功：返回 `{ path, viewUrl }`，路径用 `buildArchivePath(data)`，查看链接按交付件 id 拼（与 Insight 的 `buildDeliverableViewUrl` 一致）。

**为什么不直接 import Insight 的 `runArchiveFileTask`**：它在 `pages/insight` 下，带 Insight 专属的埋点（`beginInsightOperation`）。按「insight 页面自包含」的约定，Design 不反向依赖 Insight 页面代码。fastui 用同一组共享底层（`@/utils/edmUtil`、`@/network/pipelineRequest`、`@/context/task`）写一份，约 80 行。将来如有第三处需要，再把它提到 `@/utils` 下统一。

**其他**：

- 未登录（无 `uiplusToken`）：与 Insight 文件归档的处理保持一致（实现时核对其行为）。
- 能力表：`archive = { enabled: true, editOnly: true }`。
- 截图、标注不进归档：交付件只有源码 zip。

## 8. 不做

| 项 | 理由 |
|---|---|
| Direct 写回 | 没有单个可写回的 HTML |
| 图标 / 资产替换 | fastui 图标已进开发组件库，替换方式不同；需要时另起 spec |
| 框选编辑 | 全局已下线 |
| 画布编辑 | 本次延后，调研结论见 §6 |
| 源码切换 / 旧版 localEdit / 下载 | 见 §1 |

## 9. 能力表终态

| 开关 | 005 | 本 spec |
|---|---|---|
| refresh / viewport / fullscreen | ✅ | ✅ |
| modelEdit | ❌ | ✅ `editOnly` |
| comment | ❌ | ✅ `editOnly` |
| history | ❌ | ✅ `editOnly` |
| archive | ❌ | ✅ `editOnly` |
| canvasEdit | ❌ | ❌（延后，§6） |
| modeToggle / localEdit / drawEdit / download | ❌ | ❌ |

005 §2 的能力表理由（编辑类「没有 bridge」、history「没有磁盘文件」）由本 spec 的 §2、§4 取代。005 §7.1 的单测「`fastui` = `url` + viewport」需同步更新。

## 10. 实施顺序与改动清单

按顺序推进，每步可单独提 PR（遵守 `collab-pr-protocol.md`）。P5 与主线无依赖，可穿插：

| 步 | 内容 | 仓 / 文件 |
|---|---|---|
| P0 spike | §2.3 注入链路（外网 §11.2 S1–S3） | 先在分支上验证，不合入 |
| P1 注入 | `fastuiInjectBridges` IPC + 校验 + 防重复；桌面端 `bridge-config.ts` 加 `fastui` 条目；html-renderer 在 `load` 后调用并补发模式状态 | UXAI `desktop/src/main/{ipc,fastui-devserver,bridge-config}.ts`、`preload/{index,types}.ts`、`make/lib/electron-api.ts`、`result-viewer/html-renderer.tsx` |
| P2 局部修改 | `fastuiPreviewOpen` / `fastuiPreviewRestart` 返回 `projectDir`；`fastui-vue-source` bridge；`promptCallback` 加可选 `element` 参数；fastui `modelEditConfig`；开 `modelEdit` | UXAI `desktop/src/main/fastui-devserver.ts`、`make/subtype-handlers/fastui.tsx`、`make/utils/subtype-config.ts`、`components/model-edit-items/types.ts`、`result-viewer/model-edit-area-dialog.tsx`、自定义 bridge 注册处 |
| P3 历史 | §4.2 ①–⑦ | UXAI `subtype-handlers/{types,history-controller,fastui}.ts(x)`、`make/index.tsx`；skill 仓 `export-zip.mjs` |
| P4 标注 | §5 | UXAI `result-viewer/html-renderer.tsx`、`subtype-config.ts` |
| P5 归档 | §7。**不依赖注入，可与 P0 并行** | UXAI `subtype-handlers/{types,fastui}.ts(x)`、`result-viewer/html-renderer.tsx` |

**已知限制**：

- 历史恢复不删除之后新增的文件（§4.2）
- 标注锚点在 SPA 重渲染后可能漂移（§5）
- 局部修改保存后需手动刷新才能看到结果（§2.4）
- 框架区域元素在编辑模式下仍有悬停高亮，但点不进去（§3.5.4）

## 11. 验证

### 11.1 单测（自动化）

`packages/app` 下：

```bash
bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-subtype.test.ts
```

- 能力表等于 §9 终态（逐项钉死）
- fastui `modelEditConfig`：`saveCallback` 在 `dom.attributes['data-od-vue-file']` 为 `src/views/…` 时，输出包含工程目录与「元素所属源文件」行，`当前HTML` 中不含 `data-od-vue-file`；属性不存在时没有该行、操作要求第 1 条换成定位说明；中间段与 `defaultModelEditConfig` 输出逐字相同
- `fastui-vue-source` 的 `ownerFile`：构造组件链 `[ElInput(__file='input.vue'), index(__file='src/views/a/index.vue'), app(__file='src/app.vue')]` → `src/views/a/index.vue`；`[LakeLayout(无), app('src/app.vue')]` → `@framework`；无 `__vueParentComponent` → `null`
- `onHistoryTrigger` 过滤规则：给定一组相对路径，只保留 `src/` 下的源码文件
- `resolveHistoryAnchor`：产物名 + `projectDir` → `<projectDir>/packages/portal/package.json`
- 归档：fastui handler 有 `archiveUpload` 且 `showDeliverables === false`；其他已注册 subtype 都没有 `archiveUpload`（钉死，保证默认归档不受影响）

`packages/desktop` 下：

- `fastuiInjectBridges` 的校验：非 127.0.0.1、端口不在 `running` 表 → `ok: false`，不调用 `executeJavaScript`

### 11.2 外网 Electron 手工（Mac）

准备：沿用 005 §7.2 的假共享池与假 `turbo-ui-cli-service.js`，页面换成下面这个带按钮和文字的版本：

```js
// <假共享池>/deps/node_modules/@turboui/turbo-ui-cli-service/bin/turbo-ui-cli-service.js
const http = require("http")
const port = Number(process.env.OCTO_PORT)
const page = `<!doctype html><meta charset="utf-8"><title>fastui bridge check</title>
<style>body{font:16px sans-serif;margin:24px} .card{padding:16px;border:1px solid #ccc;border-radius:8px}</style>
<div id="app"></div>
<script>
// 模拟 SPA：内容由 JS 运行时渲染,并模拟 Vue 3 dev 的 __vueParentComponent / __file
const app = document.getElementById("app")
app.innerHTML = '<div class="card"><h2 class="title">卡片标题</h2><button class="btn">按钮</button></div>'
const inst = { type: { __file: "src/views/Demo.vue" }, parent: { type: { __file: "src/app.vue" }, parent: null } }
app.querySelectorAll("*").forEach(el => { el.__vueParentComponent = inst })
</script>`
http.createServer((_q, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(page) })
  .listen(port, "127.0.0.1", () => console.log("Compiled successfully"))
```

`OCTO_FASTUI_ENV_DIR=<假共享池> bun run dev` 起桌面端，按 004 §6.1 放好 `.octo-fastui.json` 与 `outputs/alpha/packages/portal/`（其中放 `package.json` 与 `src/views/Demo.vue`），让模型原样回复 `<artifact type="text/link">fastui://alpha</artifact>`，点开卡片。

| # | 操作 | 期望 |
|---|---|---|
| **S1 注入**（P0） | 打开 DevTools，Console 上下文切到 `127.0.0.1:<端口>` frame，执行 `window.__odFastuiBridges` | 返回 `1`；主进程日志有注入成功记录 |
| **S2 选中与即时预览**（P0） | 点「局部修改」，点击「卡片标题」；在面板改颜色、字号 | 弹出属性面板；标题即时变色变大 |
| **S3 重载后仍生效**（P0） | 点刷新；再切「桌面」↔「1440」（会重建 iframe） | 两种情况下 S1、S2 都成立 |
| S4 源文件 | S2 中点保存 | 发给模型的提示词包含 `预览工程目录：…/outputs/alpha/packages/portal` 与 `元素所属源文件：…/src/views/Demo.vue`；`当前HTML` 里没有 `data-od-vue-file` |
| S5 框架元素 | 假页面里把按钮的 `__vueParentComponent` 改成 `{ type: { __file: 'src/app.vue' }, parent: null }`，编辑模式下点按钮 | 不弹面板，提示「该区域属于页面框架，不在本次生成的内容中，不支持修改」 |
| S5b 无组件信息 | 删掉假页面里模拟 `__vueParentComponent` 的两行，重做 S4 | 提示词没有「元素所属源文件」行，操作要求第 1 条为定位说明 |
| S6 校验 | 在宿主页面（非 iframe）的 Console 执行 `await window.api.fastuiInjectBridges("https://example.com")` | 返回 `ok: false` |
| S7 历史 | 打开后看历史面板；手动改 `src/views/Demo.vue` 内容模拟模型编辑，发一轮对话结束 | 有「原始版本」；之后出现「模型编辑」；切回原始版本后 `Demo.vue` 内容恢复 |
| S8 导出排除 | 有历史后点「导出代码包」 | zip 内没有 `.history/` |
| S9 标注 | 点「标注」，在按钮上打点并保存；关闭再打开 tab | 打点可见、重开后仍在 |
| S10 归档 | 登录状态下点「归档」，选目录后确定 | 弹窗不显示已有交付件列表；任务中心出现 `alpha.zip` 上传任务；完成后弹成功弹窗；web 端该目录下出现 `alpha.zip`，下载后与「导出代码包」的 zip 逐文件一致。外网无归档服务时只验到弹窗与 `onConfirm` 被调用，上传留给 N5 |
| S11 回归 | 外链 `/preview https://example.com`；普通 html、components、gts 产物各做一次归档与局部修改 | 行为与改动前一致；外链归档仍报「外部 URL 不支持归档」 |

### 11.3 内网验证

需要真实 fastui 脚手架与组件库，外网无法替代。

**N1 生成页面能否命中 `src/views/`**（P2 的前提）：

2026-10-20 已确认 `__file` 可用（§3.5.2），但表格截图没有覆盖到生成页面的行。在预览 frame 里（Console 左上角执行上下文选 `127.0.0.1` 那一项，不是 `top`）执行：

```js
(() => {
  console.log('当前上下文:', location.href)
  const files = new Map()
  for (const e of document.querySelectorAll('body *'))
    for (let i = e.__vueParentComponent; i; i = i.parent) {
      const f = i.type.__file
      if (f && f.startsWith('src/')) files.set(f, (files.get(f) || 0) + 1)
    }
  console.table([...files].map(([文件, 出现次数]) => ({ 文件, 出现次数 })))
  const who = (text) => {
    const el = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && e.textContent.trim() === text)
    if (!el) return console.log('没找到文字为「' + text + '」的元素')
    const chain = []
    for (let i = el.__vueParentComponent; i; i = i.parent) chain.push(i.type.__file || i.type.name || i.type.__name || '(匿名)')
    console.log('「' + text + '」的组件链:', chain.join('  →  '))
  }
  who('数据预处理组件')   // 换成页面上生成内容里的一段文字
  who('添加到我的组件')   // 换成页面上的一个 element-plus 按钮文字
})()
```

| 输出 | 结论 |
|---|---|
| 表里有 `src/views/…` 行，两条组件链里都有 `src/views/…/index.vue` | ✅ §3.5.3 规则成立 |
| 表里没有 `src/views/` 开头的行 | 生成页面的 `__file` 前缀与 001 的目录约定不一致；把表贴回来，修订规则 |
| 组件链里只有框架组件 | 生成内容可能作为异步组件或独立应用挂载，组件链断开；需要另找归属依据，修订 §3.5 |

**N2 真实工程局部修改**：在 element-plus 按钮、lake 组件、普通文本上各做一次属性修改并保存，确认模型改的是正确的 `.vue`、手动刷新后预览更新、`verify` 通过；再点一次顶部导航，确认被拦下（§3.5.4 ②）。

**N3 真实工程历史**：多轮对话后切换版本，确认刷新后看到的是**重新编译后**的页面（§4.2 ④ 的竞态），且编译通过。

**N4 标注**：真实页面上打点；HMR 后检查锚点漂移的实际程度，作为 §5 风险的依据。

**N5 归档上传**：登录状态下归档到真实团队目录，确认 web 端出现源码 zip、可下载、内容与导出代码包一致；同名再归档一次，确认行为与 Insight 文件归档一致。

## 12. 待确认

| # | 问题 | 找谁 | 影响 |
|---|---|---|---|
| Q1 | 生成页面元素的组件链能否命中 `src/views/`（§11.3 N1） | 本人内网验证 | §3.5 规则 |

已关闭：

- `__file` 是否可用：可用，工程文件为以 `src/` 开头的相对路径；element-plus 只有文件名（2026-10-20 内网实测，§3.5.2）
- 归档纳入本次范围，只归档源码 zip，复用选目录弹窗（2026-10-20 与归档同事对齐）
- 热更新本次不修，先用刷新按钮（2026-10-21）
- 画布编辑延后（2026-10-20）；C2D 是否执行页面 JS、脚手架 HTML 产物能否满足 §6.2，留到重启时确认
