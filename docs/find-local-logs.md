# 如何快速找到本地日志(桌面 app 全类别)

> 用途:出 bug 要看落盘日志时,先在这里定位「日志文件到底在磁盘哪儿」。整个桌面 app 通用的**文件定位指南**,不限 insight。
>
> 按前缀读日志**内容** → 去 [insight-debugging.md](./insight-debugging.md);本篇只解决「找到文件」。
>
> 只读排查文档,不改任何代码。真相源:`packages/desktop/src/main/`(UXAI 仓)。标 ✅ 的路径为本机(macOS · run dev)**实测确认**,标 📄 的为**代码推导**(成品包/Win/Linux 手上没环境实测)。

## 为什么总找不到目录(先读这段)

同一个 app 有**多套名字**,磁盘上不同日志用的还不是同一套——这是找错目录的根因:

| 名字 | dev | beta | prod | 出处 |
|---|---|---|---|---|
| **appId**(app 数据 / sidecar 目录名) | `ai.octo.desktop.dev` | `ai.octo.desktop.beta` | `ai.octo.desktop` | [index.ts](../packages/desktop/src/main/index.ts) `APP_IDS` |
| **显示名 appName**(electron-log 目录名) | `Octo AI Dev` | `Octo AI Beta` | `Octo AI` | index.ts `APP_NAMES`(`app.setName`) |
| 安装包 productName | Octo Agent Dev | Octo Agent Beta | Octo Agent | [electron-builder.config.ts](../packages/desktop/electron-builder.config.ts) |

**记住两条**:
- app 数据/sidecar 目录名 = **appId**(`ai.octo.desktop*`),因为 [index.ts](../packages/desktop/src/main/index.ts) 显式 `app.setPath("userData", join(appData, appId))`。
- **electron-log(①②)在 macOS 用的是显示名 `appName`**,落在 `~/Library/Logs/<appName>/`,**不在 userData**——这就是"Mac 上找不到"的坑。

### 那一堆"名称很相似的文件夹"

不是签名改多次,是**历次改名的遗留空壳**。本机实际就散着这些(都是旧显示名):`Octo AI` / `OctoAI` / `Octo Dev`(在 `~/Library/Logs/` 和 `~/Library/Application Support/` 里都有)。现役只有 `Octo AI Dev` / `ai.octo.desktop.dev`。

**认准真身:按修改时间(mtime)排序,最新的那个就是当前在跑的。** 别按名字猜。

## 日志清单(4 类)

| # | 日志 | 内容 | macOS 位置 | Windows / Linux 位置 |
|---|---|---|---|---|
| ① | **主进程** `main.log` | Electron 主进程(启动/sidecar/自动更新,`[server]` 等),electron-log,5MB 滚动 | ✅ `~/Library/Logs/<appName>/main.log` | 📄 `<userData>/logs/main.log` |
| ② | **renderer 转发** `insight-debug.log` | **渲染进程 console 全量转发**(SPEC-INS-011 阶段3)。5MB 滚动、7 天清。**成品包没 DevTools 时,renderer 日志就落在这**。对象参数:新版生产构建已 JSON 序列化落盘;旧版本是 `[object Object]`(见 [insight-debugging.md](./insight-debugging.md) §「全量兜底」) | ✅ `~/Library/Logs/<appName>/insight-debug.log` | 📄 `<userData>/logs/insight-debug.log` |
| ③ | **opencode sidecar** | server 端**结构化日志**(elog,行内有 `service=` 字段:`[octo:mcp]` 连接、`toolsForAgent` 等)。每次启动新建**时间戳** `.log`,自动清旧。⚠️ **`[octo:inject]` / `[octo:extract]` 不在这里**——它们是插件/工具里的裸 `console.log`,跟随 sidecar **stdout**:成品包被主进程 pipe 进 ①`main.log`(2026-07-08 内网实证),run dev 打在外部 server 终端 | 见下「③ 落点分两种」 | 同左 |
| ④ | crash dump(可能有) | 崩溃转储 | 📄 `<userData>/Crashpad/` | 📄 `<userData>/Crashpad/` |

- `<appName>` = 显示名(dev=`Octo AI Dev`);electron-log 在 macOS 固定用 `~/Library/Logs/<appName>/`,Win/Linux 才用 `<userData>/logs/`。
- `<userData>` = `<appData>/<appId>`。`<appData>`:macOS `~/Library/Application Support` · Windows `%APPDATA%`(`…\AppData\Roaming`)· Linux `~/.config`。

### ③ sidecar 落点分两种(别找错 —— 这就是"run dev 和成品包日志不在一起")

| 怎么跑的 | sidecar 日志目录 |
|---|---|
| **run dev / 裸 `opencode` CLI** | ✅ macOS/Linux `~/.local/share/opencode/log/` · Windows `%LOCALAPPDATA%\opencode\log\` |
| **桌面成品包**(beta/prod) | 📄 `<userData>/xdg-data/opencode/log/` |

原因:成品包由 [sidecar.ts](../packages/desktop/src/main/sidecar.ts) 把内置 sidecar 的 `XDG_DATA_HOME` 关进 `<userData>/xdg-data`;而 **run dev 时桌面 app 连的是外部另跑的 opencode server**(userData 里**不会**出现 `xdg-data/`,本机已确认),日志回落 opencode 默认的 `~/.local/share/opencode/log/`。**最新 mtime 那个 `.log` = 当前 session。**

## 一眼定位(macOS,实测可用)

```bash
# ①② electron-log(主进程 + renderer 转发)——按 mtime 挑最新的 Octo* 目录
ls -t ~/Library/Logs/Octo*/main.log ~/Library/Logs/Octo*/insight-debug.log 2>/dev/null | head

# ③ sidecar(run dev)——捞最新一个里的 server 端前缀
DIR=~/.local/share/opencode/log
grep -E "\[octo:(mcp|kb|inject|extract)\]" "$DIR/$(ls -t "$DIR" | head -1)"
```

## 怎么确认「当前这个 app 是哪个 channel / appId」

**macOS**(读 bundle id = appId,连签名一起看):
```bash
defaults read "/Applications/Octo Agent Beta.app/Contents/Info" CFBundleIdentifier
# → ai.octo.desktop.beta
codesign -dvvv "/Applications/Octo Agent Beta.app" 2>&1 | grep -E "Identifier|TeamIdentifier|Authority"
```

**Windows**:nsis 装到用户目录。去 `%APPDATA%` 按 mtime 找 `ai.octo.desktop*`;要看签名对 exe 右键 → 属性 → 数字签名,或 `Get-AuthenticodeSignature "<exe>"`。

**从代码核对**:appId ↔ appName ↔ productName ↔ channel 的对应在 [electron-builder.config.ts](../packages/desktop/electron-builder.config.ts)(`getConfig()`)和 [index.ts](../packages/desktop/src/main/index.ts)(`APP_IDS` / `APP_NAMES`)。

## 实现出处

- appId/userData override:[index.ts](../packages/desktop/src/main/index.ts)(`app.setPath("userData", …appId)`、`APP_IDS`、`APP_NAMES`)
- ①② electron-log 配置:[logging.ts](../packages/desktop/src/main/logging.ts);renderer 转发挂钩:[windows.ts](../packages/desktop/src/main/windows.ts)(`console-message` → `insightDebugLog`)。macOS 落 `~/Library/Logs/<appName>/` 是 electron-log 默认行为
- ③ 成品包 sidecar XDG 隔离:[sidecar.ts](../packages/desktop/src/main/sidecar.ts)(`XDG_DATA_HOME=<userData>/xdg-data`);opencode 侧落点:`packages/core/src/util/log.ts` `file()` + `packages/core/src/global.ts` `Global.Path.log`
- 历史目录/迁移:[migrate.ts](../packages/desktop/src/main/migrate.ts)
