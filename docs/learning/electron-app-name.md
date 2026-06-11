# Electron 应用名与 channel —— 同一份代码,多个"名字"

> 背景:SPEC-INS-011 阶段3 落盘日志后,在 `~/Library/Logs/` 下看到 `Octo AI Dev` / `Octo Dev` /
> `OctoAI` 多个目录,厘清 Electron app 的"名字"到底由哪些决定、在哪改、为什么会有多个。

---

## 1. 一个 Electron app 有四种"名字",别混

| 名字 | 是什么 | 在哪定(UXAI) | 例 |
|---|---|---|---|
| **运行时名 `app.getName()`** | electron-log 等据此定 `userData`/`logs` 目录;窗口标题默认值 | [main/index.ts:36](../../../UXAI/packages/desktop/src/main/index.ts) `app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "Octo AI Dev")` | dev 运行时 = **`Octo AI Dev`** |
| **打包产物名 `productName`** | 安装后的 `.app`/`.exe` 显示名、安装目录名 | [electron-builder.config.ts](../../../UXAI/packages/desktop/electron-builder.config.ts) 的 `productName`(按 channel) | `Octo Agent Dev` / `Octo Agent Beta` / `Octo Agent` |
| **`appId`(bundle id)** | 系统唯一标识,**不是显示名**;单实例、协议注册、系统识别用 | `index.ts:34` + electron-builder `appId` | `ai.octo.desktop` / `com.huawei.octoagent.beta` … |
| **npm 包名 `name`** | monorepo 里的包名,与显示无关 | `packages/desktop/package.json` `name` | `@octo-agent-ai/desktop` |

**关键**:决定"日志/数据目录"的是**运行时名 `app.getName()`**,不是 productName 也不是 appId。

## 2. channel 机制:一份代码三套名

- `CHANNEL`([constants.ts:5](../../../UXAI/packages/desktop/src/main/constants.ts),env `OCTO_CHANNEL`,默认 `dev`)取值 `dev` / `beta` / `prod`。
- 它同时决定**运行时名 `APP_NAMES[CHANNEL]`、`productName`、`appId`** 三套值。
- 所以同一份代码、不同 channel 构建 → 不同名字/id,**可并存安装**、各自独立数据目录。
- **未打包(dev 跑)** 时运行时名被硬编码成 `"Octo AI Dev"`(`app.isPackaged` 为 false 分支)。

## 3. 为什么 `~/Library/Logs/` 有多个目录

`app.getName()` 历史上改过名(`OctoAI` → `Octo Dev` → `Octo AI Dev` …)。**每换一个运行时名,electron-log 就新建一个 logs 目录**,旧目录留作历史残留——可手动删。当前 dev 用的是 `Octo AI Dev`。

## 4. 怎么确认"当前日志在哪"

1. 看运行时名:dev = `Octo AI Dev`(index.ts:36);打包 = `APP_NAMES[CHANNEL]`。
2. 日志目录(electron-log 默认):
   - macOS:`~/Library/Logs/{运行时名}/`
   - Windows:`%USERPROFILE%\AppData\Roaming\{运行时名}\logs\`
   - Linux:`~/.config/{运行时名}/logs/`
3. 或代码里直接取:`log.transports.file.getFile().path`([logging.ts](../../../UXAI/packages/desktop/src/main/logging.ts) 的 `tail()` 就这么拿)。

> insight debug 的全量 console 落在该目录的 **`insight-debug.log`**(SPEC-INS-011 阶段3 用独立 logger,不混进 `main.log`)。
