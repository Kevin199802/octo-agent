# SPEC-DES-003 — fastui 管道要 UXAI 仓做的五件事

> 从 [SPEC-DES-001](fastui-vue-codegen-pipeline.md) §8.6 拆出，编号与小节号沿用原文（仍叫 8.6.1、8.6.2…），
> 方便与既有引用对得上。
>
> **读者：UXAI 仓 Design 模块的前端开发。** 这五件都落在 UXAI 仓、走
> [collab-pr-protocol](../../collab-pr-protocol.md)，与 skill 侧的实现是两条线。
>
> **五件均须增量式兼容改造，不得影响 Design 现有功能** —— 每件下面都写了落点、判据、
> 文件契约与改动清单，照着改即可；改不动或判据对不上时回主 spec 找上下文。

## 8.6 UXAI 仓要做的五件事（Design 模块，不是 skill）

skill 管不了常驻进程，也画不了按钮。这五件必须在 UXAI 侧做。

> **五件都必须是增量式兼容改造，不得影响 Design 现有功能。** 具体到每一项：② 只加 gate 不改 srcdoc 路径上的任何既有行为；③ 除了退出钩子里追加一行，其余全是新文件与新 handler；① 是 ActionBar 新增一个按钮；⑤ 只在 external 分支且 URL 指向 loopback 时生效；④ 是新增一个 message 监听。任何一项若发现必须改动既有代码路径才能做成，停下来先对齐，不要顺手改。
>
> **①③⑤ 实现后的实况**：③ 只碰了 `index.ts` 退出钩子一行；① 碰了 `action-bar.tsx` 两行（给自定义按钮的 ctx 补会话信息）；⑤ 碰了 `html-renderer.tsx` 的 `externalUrl()` 一处（加一个 loopback 门禁分支）。srcdoc 主路径与 `SUBTYPE_CONFIG` 能力表**一个字没动**。

| # | 事项 | 状态 |
|---|---|---|
| ③ | **dev server 由宿主起并持有** | ✅ **已实现并内网实测通过**（Windows + macOS arm64 各一遍过），方案见 §8.6.1；UXAI PR #801 |
| ① | **导出代码包按钮** | ✅ **已实现，待内网实测**（UXAI PR #812）；方案见 §8.6.2 —— v12 勘查的 `handleDownload` 路线走不通，已按实况订正 |
| ⑤ | **预览就绪前不要挂 iframe** | ✅ **已实现，待内网实测**（与 ① 同一个 PR）；方案见 §8.6.5 —— 改为门禁 `src`，未采用 v12 说的 bump `refreshKey` |
| ② | **external URL tab 的编辑类功能 gate** | ✅ **查明不用改**（2026-09-07），结论见 §8.6.3 |
| ④ | **运行时错误 bridge 的监听端** | 做 [§7.4](fastui-vue-codegen-pipeline.md#74-第三层--运行时错误捕获落在-模板内置-bridge--宿主监听) 第三层时补，协议见 §8.6.4。模板侧已内置并实测通过，宿主侧现在空转 |

**预览本身不需要新增 renderer**（[§7.5](fastui-vue-codegen-pipeline.md#75-预览容器现有-textlink-链路已支持预计零改动)）—— 现有 `text/link` → external URL iframe 链路直接可用，已内网实测。

---

### 8.6.1 dev server 由宿主起并持有（③ 的完整方案）

#### 为什么必须是宿主

内网实测（2026-09-06）：`verify.mjs` 用 `detached` 起的 dev server，**脚本一退出就没了**（`Get-Process -Id <pid>` 无返回）。根因在上游代码里 —— `packages/opencode/src/tool/shell.ts:296`：

```ts
if (process.platform === "win32" && Shell.ps(shell)) {
  return ChildProcess.make(shell, [...], { detached: false })   // ← Windows 下有意不脱离
}
return ChildProcess.make(command, [], { detached: process.platform !== "win32" })
```

整条链 `opencode → PowerShell → verify.mjs → dev server` 在同一个 Job Object 里，shell 工具收尾时整棵树被清掉。而 shell 工具的参数只有 `command / cwd / env / timeout / shell`，**没有 `background`**（不像 Claude Code 的 `run_in_background`）。

**主流 agent 的做法都是「让一个长命进程持有它」，不是「让子进程脱离」。** Octo 缺的正是这个能力，而 Electron 主进程正好是那个长命进程。

> **附带解决的体验问题**：现在每次起服务都弹一个空的 node 窗口。这不是配置问题，是父进程类型决定的 —— PowerShell 是 console 应用，子进程继承 console；**Electron 主进程是 GUI 应用，根本没有 console**，`spawn(..., { windowsHide: true })` 直接就没窗口。

#### 时序

```
new-session.mjs
  └─ 写 .octo/<sid>/.octo-fastui.json { projectDir, port, depsDir, envDir, … }
        │
        ▼
pages/make 侧监听到这个文件(或在建会话的同一处主动触发)
  └─ IPC → 主进程 spawn dev server(持有它)
        └─ 写 .octo/<sid>/.devserver.json { port, pid, projectDir, logPath, startedAt }
        └─ stdout/stderr → .octo/<sid>/devserver.log
        │
        ▼
[模型写代码]        ← 这段时间 webpack 已经在编译 _example 并进入 watch
        │
        ▼
verify.mjs --port=<port>
  └─ 只做编译判定:读 devserver.log,按 §5.5.1 的三条规则采信最后一轮
  └─ 顺带跑漏 import 静态检查(§7.2)
        │
        ▼
<artifact type="text/link">http://127.0.0.1:<port></artifact>
```

**免费的性能优化**：别等模型写完再起服务。`new-session` 一写出状态文件就起 —— 那时 `views/` 下只有 `_example`，编译很快；**模型写代码的几十秒里 webpack 已经编完在 watch 了**。等 `verify` 时只剩一次增量编译（几秒），而不是干等 1–3 分钟的首次编译。首次编译与模型写代码并行。

#### 文件契约（skill 侧已固定，宿主按这个读写）

| 文件 | 谁写 | 谁读 | 内容 |
|---|---|---|---|
| `.octo/<sid>/.octo-fastui.json` | `new-session` | **宿主** | `{name, projectDir, writeDir, port, envDir, depsDir, skillDir, createdAt, updatedAt}` |
| `.octo/<sid>/.devserver.json` | **宿主** | `verify`（回退路径） | `{port, pid, projectDir, logPath, startedAt}` |
| `.octo/<sid>/devserver.log` | **宿主**（子进程 stdio 重定向） | `verify` | dev server 原始输出 —— **编译判定的唯一数据源** |

> ⚠️ **日志路径必须是 `.octo/<sessionId>/devserver.log`**，不能换地方 —— `verify` 靠读它做编译判定，路径不对就只能超时。

#### 启动参数（照抄，四个点都不能少）

```ts
const portalDir = join(state.projectDir, "packages", "portal")
const cli = join(state.depsDir, "@turboui", "turbo-ui-cli-service", "bin", "turbo-ui-cli-service.js")
const nodeBin = process.platform === "win32"
  ? join(state.envDir, "node", "node.exe")
  : join(state.envDir, "node", "bin", "node")

const logFd = openSync(join(sessionDir, "devserver.log"), "a")
const child = spawn(nodeBin, [cli, "serve", "--replace-policy=dev", "--target=esnext"], {
  cwd: portalDir,
  env: { ...process.env, OCTO_DEPS: state.depsDir, OCTO_PORT: String(state.port) },  // ① 缺一不可
  windowsHide: true,                                                                  // ② 无窗口
  stdio: ["ignore", logFd, logFd],                                                    // ③ 日志落盘
})
```

| # | 点 | 不做会怎样 |
|---|---|---|
| ① | `OCTO_DEPS` + `OCTO_PORT` 两个都传 | 缺 `OCTO_DEPS` 则 copy-webpack-plugin 找不到拷贝源，`Failed to compile`（[§2.2](fastui-vue-codegen-pipeline.md#22-三处环境变量注入全部带回退)）；缺 `OCTO_PORT` 则回落 8081，多会话必撞 |
| ② | `windowsHide: true` | 弹空的 console 窗口 |
| ③ | stdio 重定向到那个固定路径 | `verify` 没有数据源，只能 `COMPILE_TIMEOUT` |
| ④ | `app.on("will-quit")` 里全 kill + 软上限 3 个 | webpack dev server 每实例数百 MB，设计师做几个页面就把机器拖垮 |

**不做精细的挂载/卸载回收** —— 设计师来回切 tab 时反复重启 webpack 体验很差（[§6.3](fastui-vue-codegen-pipeline.md#63-生命周期)）。

#### 改动清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/desktop/src/main/fastui-devserver.ts` | 新文件 ~120 行：`ensure` / `stop` / `stopAll` + 内存 `Map<sessionId, {pid, port}>` + 软上限 | **新增** |
| `packages/desktop/src/main/ipc.ts` | +2 个 `ipcMain.handle`（~12 行） | 追加，不动现有 handler |
| `packages/desktop/src/preload/{index,types}.ts` | +2 个方法与类型（~10 行） | 追加 |
| `packages/desktop/src/main/index.ts` | `will-quit` 回调里 **+1 行** `stopAll()` | ⚠️ **唯一碰既有代码处**（追加一句，不替换） |
| `packages/app/octoapp/context/platform.tsx` | 类型透传（~4 行） | 追加 |
| `packages/app/octoapp/pages/make/index.tsx` | 建会话处（约 `:1603` 写 `.octo/<id>/outputs/.gitkeep` 那一带）挂钩（~30 行） | 追加 |

约 180 行，6 个文件，**5 个是纯追加**。

> `sidecar.ts` 是主进程管长命子进程的现成参照，但它用 `worker_thread`（`parentPort`）而非 `spawn`，逻辑不能直接复用 —— 可借鉴的是它的形态：start / stop / 退出清理 / 错误上报。

#### skill 侧对应的降级

`verify` 的启动策略按可靠性排序：

1. **`--port=<n>` 接管** —— 显式指定用哪个端口上已有的服务
2. **读 `.devserver.json` 复用** —— 宿主起好的那个
3. **等宿主启动（最多 15 秒）** —— 宿主监听状态文件、异步 spawn，这里给它时间；**不等的话两边会各起一个 dev server 打架**
4. **自己 spawn（回退）** —— 输出 `[fallback]` 提示，说明这条路在 Windows 上活不过本次调用

第 4 条保留是为了脱离宿主也能调试（内网调脚本、外网 V0），它在 Windows 上失效属于**已知的模式差异，不是 bug**。

#### 平台差异：mac 同样需要宿主，理由不同

| | Windows | macOS |
|---|---|---|
| skill 自己 spawn 的进程 | **活不过本次调用**（Job Object 连坐） | 能活（`shell.ts` 在非 win32 下用 `detached: true`，Unix 也没有 Job 连坐） |
| 空的 node 窗口 | 有（PowerShell 是 console 应用，子进程继承 console） | 无 |
| 要不要宿主接管 | **必须** —— 否则起不来 | **同样要** —— 不是为了"活下来"，是为了**有人回收**：那些进程会活到没人管，设计师做几个页面就攒一堆常驻 webpack，每个数百 MB |

**宿主方案两个平台通用，不做平台分支。**

> ⚠️ `pages/make/` 与 `packages/desktop/` 属 Design 模块，改动需按 [collab-pr-protocol](../../collab-pr-protocol.md) 走。
> **若发现任何一项必须改动既有代码路径才能做成，停下来先对齐** —— 尤其 `index.tsx` 有 5600+ 行，在里面加东西要克制。

---

### 8.6.2 导出代码包按钮（① 的落点与契约）

> **已实现（2026-09-07，UXAI PR 见 §8.6 状态表）。下面是实现后的实况，不是设计稿。**
> **v13 订正**：v12 写的"注册 `handleDownload` 即可、`action-bar.tsx` 零改动"在实际代码上走不通，理由见下。

#### ✗ 不能走 `handleDownload` —— 那条路根本渲染不出按钮

`action-bar.tsx` 确实有 `getSubtypeHandler(...).handleDownload` 这个扩展点，但**它前面还有一道能力开关**：

```ts
// utils/subtype-config.ts —— url subtype 的能力表
url: { features: { …, download: false, … } }
```

```tsx
// action-bar.tsx —— 下载按钮的渲染条件
const showDownload = () => featureVisible(config().features.download)
<Show when={showDownload() && props.tab.type === "html"}>
  <DownloadButton options={downloadOptions()} onDownload={handleDownload} />
</Show>
```

`download: false` 时按钮压根不渲染，`handleDownload` 永远不会被调用。

而**把它翻成 `true` 是回归**：`subtype: "url"` 不是 fastui 专属，它是**所有 http(s) 链接 tab 的通用形态** —— 链接卡片（`index.tsx` 的 `card.type === "link"` 分支）和文件管理里打开外链（`handleOpenLocalFile`）都开这个 subtype。翻成 `true` 会让任意一个外链 tab 都长出一个必然失败的下载按钮。

#### ✓ 走同一个扩展点的另一条腿：`components.actionBar.extraButtons`

`SubtypeHandler` 除了 `handleDownload`，还有一套**自定义按钮**配置，位置可选、可见性可按 tab 判定：

```tsx
// subtype-handlers/url.tsx（新文件）
const urlHandler: SubtypeHandler = {
  ...defaultHandler,          // 行为整体沿用 _default，只做增量
  name: 'url',
  components: { actionBar: { extraButtons: [ { id: 'fastui-export-zip', position: 'after-download', … } ] } },
}
```

三个关键点：

| 点 | 为什么 |
|---|---|
| `{...defaultHandler}` 展开 | 注册前 `getSubtypeHandler("url")` 走的是 `_default` 兜底。展开后除 `name` / `components` 外全部是同一引用，所有消费点（`modelEditConfig` / `onHistoryTrigger` / `applyVersionFiles` / `buildArchiveSrc` …）拿到的东西与注册前完全一致 |
| 不设 `replaceDefaultButtons` | 只追加，不替换既有按钮 |
| `visible` 双重判据 | 见下 —— 不能只看 tab 形态 |

#### 判据：光看 tab 形态不够

因为 `url` 是通用形态，按钮的 `visible` 要能回答"这个 tab 到底是不是 fastui 预览"。两条**都是确定性判断**，不是模糊匹配：

1. `tab.filePath` 指向 `127.0.0.1` / `localhost`（dev server 一个会话一个端口）
2. 会话目录下**存在** `.octo-fastui.json` —— 只有 fastui 的 `new-session` 会写出这个文件，§8.6.1 里"怎么区分 fastui 会话和普通会话"用的也是它

第 2 条是异步的（走 `fileExists`），结果进一个 signal，`visible` 读它 —— action bar 的自定义按钮渲染本来就是响应式的（`prototype` / `components` 两个 subtype 的主题切换按钮就靠这个让 label 在"深色/浅色"之间变），signal 一更新按钮就出现。否定结果不永久缓存（3 秒后可重探），会话先建、稍后才跑 skill 的情况能自愈。

#### 会话目录怎么来 —— `action-bar.tsx` 的唯一改动

自定义按钮拿到的 `ctx` 里原本没有会话信息（`renderCustomButton` 构造的 ctx 只有 tab / toast / tracker / postMessageToIframe 那几项），而导出要定位 `<projectDir>/.octo/<sessionId>`。所以**给那个 ctx 补两个字段**，与同文件 `handleDownload` 的 ctx 取法一致：

```tsx
sessionId: props.sessionId ?? params.id,
sdkDirectory: props.sdkDirectory,
```

这是 `action-bar.tsx` 上的全部改动（2 行，纯追加）。已有的两处 `extraButtons`（`prototype` / `components` 的主题切换）只用 `ctx.postMessageToIframe`，不受影响。

> 会话目录的拼法与 `index.tsx` 建会话处一致：`[sdkDirectory, ".octo", sessionId].join(sep)`。`sdk.directory` 就是 `projectDir()` —— make 页的 `SDKProvider directory={() => dir}` 里那个 `dir` 即 `useProjectDir()` 的值。**不依赖 dev server 是否还活着**，被 LRU 淘汰过的会话照样能导出。

#### 前端不要自己打包

`export-zip.mjs` 已经处理了两件前端不容易做对的事：**用 `lstat` 跳过链接**（工程根的 `node_modules` 是指向共享池的链接，跟随就把 1GB 打进去）、**置 ZIP 的 UTF-8 flag**（不置的话中文产物名在 Windows 解压全是乱码，而内网中文命名概率很高）。

所以走 IPC 调脚本，与 §8.6.1 的 `fastui-devserver` 同一个模式（新文件 `main/fastui-export.ts`，约定「返回结果对象、永不 throw」）：

```ts
ipcMain.handle("fastui-export-zip", (_e, sessionDir: string) => FastuiExport.exportZip(sessionDir))
//   → spawn(<node>, [<skillDir>/scripts/export-zip.mjs, `--session-dir=${sessionDir}`])
//   → 解析 stdout 的 RESULT: / ZIP_PATH: / ZIP_BYTES: 契约行(§5.1.1)
//   → 返回 { ok, zipPath, bytes, fileCount } 给渲染进程
```

#### `skillDir` 怎么定位 —— **由 `new-session` 写进状态文件，不靠宿主猜**

v12 写的"由主进程按 `.octo/skills/fastui-vue-creator` 推导"**是错的**：skill 的实际扫描位置是 `<octoConfig>/skill/<name>/`（`packages/opencode/src/skill/index.ts` 的 `octoSkillDir`）。

但真正的问题不是"猜哪个路径"，而是**宿主根本没有可靠的推导依据**：

> ⚠️ **`XDG_CONFIG_HOME` 在主进程与 server 之间是分裂的。** `packages/desktop/src/main/storage.ts` 的 app-data-fallback 模式会把 `XDG_CONFIG_HOME` 指到 `<userData>/xdg-config`，而这份 env **只在 `sidecar.ts` 传给 server 子进程，没有写回主进程的 `process.env`**。于是那个模式下 server 把 skill 装在 `<userData>/xdg-config/octo/skill/`，主进程却会去 `~/.config/octo/skill/` 找。内网 Windows 域环境恰好是 fallback 模式最可能触发的地方。
>
> 这不是导出功能引入的（`main/ipc.ts` 里既有的 `getOctoConfigPath()` 是一模一样的表达式），但导出功能踩上去就是"技能可能未安装"。

**唯一确定知道 skill 装在哪的是脚本自己**（`paths.mjs` 用 `import.meta.url` 往上推）。所以 `new-session` 把它写进状态文件，宿主直接读：

```js
// new-session.mjs
const state = { …, skillDir: SKILL_DIR, … }
```

宿主侧保留候选链只为兼容**升级前建的老会话**（那些状态文件里没有这个字段），按顺序逐个 `existsSync`（"文件在不在"的确定判断，不是猜路径）：

| 顺序 | 候选 | 说明 |
|---|---|---|
| 1 | `state.skillDir` | **正路**，`new-session` 写的 |
| 2 | `~/.config/octo/skill/fastui-vue-creator` | 老会话兜底；`XDG_CONFIG_HOME` 分裂时会落空 |
| 3 | `<sessionDir>/../skills/fastui-vue-creator` | 老会话兜底 |

#### node 用哪个

共享池的 `<envDir>/node` 优先（与 §8.6.1 同一个 `nodeBinOf`）；**它不在时回退到 Electron 自带的 node 运行时**（`spawn(process.execPath, …, { env: { ELECTRON_RUN_AS_NODE: "1" } })`）。打包只是遍历目录 + `zlib`，不依赖那 1GB 依赖 —— 共享池被清过但产物还在磁盘上时，代码包依然导得出来。

#### 拿到 zip 之后

打包 → `saveFilePicker`（默认文件名取 zip 的 basename）→ `copyFileTo` 拷到用户选的位置 → toast 报文件名与大小。用户取消保存就只提示包已生成在产物目录里，不再打扰。

`action-bar.tsx` 里 `downloadBlob` / `DownloadCancelledError` 那套是给内容型 tab 用的，工程 zip 已经在磁盘上，不走 blob。

#### 改动清单（实际）

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/desktop/src/main/fastui-export.ts` | 新文件 ~160 行：`exportZip` + 契约行解析 + 脚本定位 + 超时 | **新增** |
| `packages/desktop/src/main/ipc.ts` | +1 个 `ipcMain.handle` | 追加 |
| `packages/desktop/src/preload/{index,types}.ts` | +1 个方法与类型 | 追加 |
| `packages/desktop/src/main/fastui-devserver.ts` | `nodeBinOf` 加 `export` | 无行为变化 |
| `packages/app/octoapp/pages/make/subtype-handlers/url.tsx` | 新文件：url handler | **新增** |
| `packages/app/octoapp/pages/make/utils/fastui-export.ts` | 新文件：判据 + 导出流程 | **新增** |
| `packages/app/octoapp/pages/make/utils/subtype-registry.ts` | 注册 url handler，+2 行 | 追加 |
| `packages/app/octoapp/pages/make/components/result-viewer/action-bar.tsx` | ctx 补 2 个字段 | 追加 |
| `packages/app/octoapp/pages/make/lib/electron-api.ts` | `DesktopApi` 加一个可选方法 | 追加 |

### 8.6.3 external URL tab 的编辑功能 gate（② 的判据）

> **已查明（2026-09-07）：不用改。** `utils/subtype-config.ts` 里 `url` 这个 subtype 的能力表已经把编辑类功能全部关掉：
>
> ```ts
> url: { features: { refresh: true, modeToggle: false, viewport: false,
>                    localEdit: false, modelEdit: false, drawEdit: false, canvasEdit: false,
>                    comment: false, archive: false, history: false, download: false, fullscreen: true } }
> ```
>
> `action-bar.tsx` 的 `showLocalEdit()` / `showDrawEdit()` / `showCanvasEdit()` / `showComment()` / `showArchive()` 全部由这张表驱动，按钮根本不渲染 —— 所以那些读 `iframe.contentDocument` 的代码在 external 分支下没有入口，跨源异常也就无从发生。这解释了内网实测"预览没崩"。**本项关闭，不需要额外的 gate 代码。**

（以下为查之前的判据，留作背景。）

**先查，可能不用改。** 内网实测预览没崩，说明要么已经 gate、要么那些功能在 external 分支下根本没被触发。

查法：`html-renderer.tsx` 里 `shouldUseExternalUrl()`（约 `:853`）为真的分支，看 `InspectPanel` / `ManualEditPanel` / `DrawOverlay` / comment 这几处是否已经被条件挡住。它们都读 `iframe.contentDocument`，而 `127.0.0.1:<port>` 与宿主**跨源**，直接访问会抛。

若确实没 gate：**只加条件、不改 srcdoc 路径上的任何既有行为**。srcdoc 是 Design 现有的主路径，任何回归都不可接受。

### 8.6.4 运行时错误 bridge 的监听端（④ 的协议）

模板侧已内置并**内网实测通过**（window 级与 promise 级都收到了消息），宿主侧现在不监听、空转。协议是固定的：

```js
window.parent.postMessage({
  channel: "octo:runtime-error",
  type: "vue" | "window" | "unhandledrejection",
  message, stack,
  component,      // type=vue 时有
  info,           // type=vue 时有,Vue 给的位置,如 "render function"
  source, line, col,   // type=window 时有
  at,             // Date.now()
}, "*")
```

宿主侧要做的是：`window.addEventListener("message")` 过滤 `channel === "octo:runtime-error"`，然后把错误喂回 agent。

**这条通道的价值已经被实测证明**：模型漏 import 组件时编译通过、页面白屏，浏览器 console 里是 `Failed to resolve component: el-table` —— `verify` 的静态检查能抓到大部分（[§7.2](fastui-vue-codegen-pipeline.md#72-第一层--生成前约束落在-fastui-组件-skill-正文)），但抓不到的那些正是要靠这条通道。

> ⚠️ 别忘了 iframe 是跨源的，`event.origin` 会是 `http://127.0.0.1:<port>`。过滤时按 `channel` 字段判断即可，不要按 origin 白名单（端口每个会话都不同）。

---

### 8.6.5 重启后预览白屏：iframe 早于 dev server 就绪（⑤）

> **已实现（2026-09-07）。v13 按实现订正了「修法」那一段。**

**现象**（2026-09-07 内网实测）：重启 agent 后点预览卡片是白屏，**但切到「文件管理」再切回该 tab 就正常渲染了**。

**这个"切走再切回就好"恰恰是判据** —— 它说明 dev server 本身是好的（否则切回来也不会好），问题只在**加载时机**：

```
重启 agent
  → params.id effect 触发 → arm → ensure → spawn dev server
  → webpack 开始首次编译（几秒到 1–3 分钟）
  → 与此同时用户点开预览卡片
  → iframe src = http://127.0.0.1:<port> → 此刻还没 listen → ERR_CONNECTION_REFUSED → 白屏
  → iframe **不会自己重试**，就一直白着
  → 切走再切回 = iframe 重新挂载 = 重新请求 → 这时通了 → 正常
```

#### 修法：端口没通就先别挂 `src`，**但门禁必须是"尽力而为"而不是"通不过就锁死"**

落在 `html-renderer.tsx` 的 external 分支。**v12 写的"bump `refreshKey` 让 iframe 加载"没有采用**，两个原因：`refreshKey` 是父组件传下来的 prop，`html-renderer` 手里没有 setter；而且**不需要** —— `src` 从 `undefined` 变成一个 URL，本身就是一次加载，不用靠 query 变化去触发。

> ⚠️ **这里有一个必须避开的坑：门禁恒不放行 = 比不修更糟。**
> 渲染进程的 origin 是自定义 scheme（`oc://renderer`），向 `127.0.0.1` 发跨源子资源请求要过 Chromium 的 **Private Network Access** 那一关，`mode: "no-cors"` 并不豁免它。万一探测在真机上根本不可用（而不是 dev server 没起），"没通就不挂 `src`"会把「白屏但切 tab 能恢复」变成「永远打不开」—— 切回来重新挂门禁、重新失败，没有出路。
> **所以超时后要降级为直接挂 `src`**，让 iframe 自己去撞 `ERR_CONNECTION_REFUSED`：最坏情况等价于改动前，怎么都不会是回归；而如果只是探测机制不可用、服务其实是通的，降级后反而正常渲染。

实际实现：

```tsx
const needsReadyGate = createMemo(() => shouldUseExternalUrl() && isLocalPreviewUrl(props.filePath))

const externalUrl = createMemo(() => {
  if (!shouldUseExternalUrl()) return undefined
  // 没通之前不挂 src;但超时之后一定要放行
  if (needsReadyGate() && !previewReady() && !previewTimedOut()) return undefined
  …既有逻辑原样保留…
})
```

| 点 | 取值 / 做法 | 为什么 |
|---|---|---|
| 探测方式 | `fetch(url, { mode: "no-cors", cache: "no-store", signal })` | 跨源 iframe 的加载失败未必触发 `onerror`，拿不到可靠信号；主动探测才是确定的判据。`no-cors` 拿到的是 opaque response，读不了内容，但"连上了"这件事已经确定 |
| 单次上限 | 5 秒 `AbortController` | 端口开着但不回应时 `fetch` 会一直挂，不设 abort 就再也不会重试。cleanup 里 `abort()` 在途请求 |
| 轮询间隔 / 总上限 | 1 秒 / 3 分钟 | 与首次编译同量级（§8.6.1） |
| **超时后** | **放行 `src` + 撤掉覆盖层**，日志留一行 | 见上面的坑。重试入口用 action bar 现成的刷新按钮 —— 它 bump `refreshKey`，`externalUrl` 重算出带新 `_octo_v` 的地址，iframe 重新加载 |
| 生效范围 | **只对 `127.0.0.1` / `localhost`** | 其他外链行为完全不变。普通外链探通只花一次往返，等于没有延迟；而对一个打不开的公网地址，不该把浏览器自己的错误页换成一个等待提示 |
| 覆盖层文案 | 「正在等待本地预览服务…／服务就绪后会自动加载，首次启动可能需要几分钟。」 | **保持中性**：门禁范围是任意 loopback URL（"等本地服务起来再挂 iframe"对任何本地预览都成立），文案不能写 fastui 专属的说法，否则用户打开别的本地服务时会看到一段与他无关的话 |
| 覆盖层条件 | 额外加 `props.mode === "preview"` | 该组件的非预览分支是源码 `textarea`，不该被盖住（`url` subtype 的 `modeToggle` 是 false，属防御） |

> 渲染进程 fetch 到 `http://127.0.0.1` 是这个 app 的日常路径（SDK 与本地 opencode server 就这么通信），`oc://renderer` 是 privileged + `supportFetchAPI` 的 scheme，loopback 在 Chromium 里算 potentially trustworthy，不触发混合内容拦截；全仓也没有 CSP 配置。剩下的不确定性就是上面说的 PNA，**降级路径就是为它准备的**。
