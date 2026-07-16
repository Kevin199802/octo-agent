# Electron 主进程下载:undici `fetch` vs `net.fetch`(内网"浏览器能下、应用不能"根因)

**日期**:2026-07-16 · **现场**:内网验证,MCP 产物卡预览报 `Error invoking remote method 'download-resource-to-temp': TypeError: fetch failed`,但复制链接在浏览器能正常下载。

## 现象与定位过程

- 产物落盘(`download-resource-to-temp` / `download-resource`)在**主进程**用全局 `fetch`(Node/undici);报错 `TypeError: fetch failed` 是 undici 网络层失败的统一外壳,真实原因在 `error.cause`,**IPC 序列化只保留顶层 message**——渲染端/日志里只剩四个字母,无法定位。
- 同机同 URL,在 app 内 DevTools(F12)用渲染进程 `fetch` 直接请求 → **200 成功**。即:Chromium 栈通、undici 栈不通,且重启 app 无效(排除"睡眠后连接池失效"的一次性因素)。
- 干扰项:`[octo:resource] fetch ok`(渲染端预览)与 `eager-materialize-failed`(主进程落盘)同秒出现,给人"时好时坏"的错觉——实际是**两套网络栈一直一好一坏**。

## 机制

| | 渲染进程 / `net.fetch` | 主进程全局 `fetch`(undici) |
|---|---|---|
| 代理 | 系统代理 + **PAC 脚本**,运行时跟随系统变化 | 仅启动时 `setGlobalProxyFromEnv()` 读到的环境变量;GUI 启动的 app 通常没有 shell 的 env |
| DNS | 走代理时由**代理远端解析** | 本地 getaddrinfo,内网域名本地解析不了就 `fetch failed` |
| 证书 | Chromium/系统证书库 | Node 证书链(需 `setDefaultCACertificates` 显式桥接) |
| 挂起恢复 | 睡眠唤醒自动重连 | 连接池死 socket 无恢复语义 |

内网典型形态:目标 host(如 OBS ALB)**只有走系统代理/PAC 才可达**,Node 直连(或直连 DNS)死路——浏览器永远正常,undici 永远失败。

## 结论 / 规约

1. **主进程访问 http(s) 资源一律用 Electron `net.fetch`**,不用 Node 全局 fetch(仓内先例:pipelineRequest)。localhost 健康检查等回环地址不受影响,可不动。
2. **网络错误必须展开 `cause` 链再抛/再记**(见 `ipc.ts` `describeNetworkError`):IPC 只传 message,不展开就永远只有 "fetch failed"。
3. **主进程裸 `console.log` 不进 `main.log`**(electron-log 只收 `log.*`);需要内网远程排障的失败路径必须走 `log.error`。同理,渲染端 console 转发(`console-message`)只拿到格式化字符串,**对象参数落盘成 `[object Object]`**——要远程可读必须 `JSON.stringify`(待整改)。
4. 同类风险存量:sidecar 上传 `octo-upload-inject.ts` 也是 undici + env 代理,当前内网实测通(上传端点直连可达);若将来出现"上传失败但浏览器正常",优先怀疑此处(utilityProcess 亦可用 `net`)。

关联:[mcp-proxy-and-connection.md](./mcp-proxy-and-connection.md) · `docs/insight-debugging.md` §1.6.1
