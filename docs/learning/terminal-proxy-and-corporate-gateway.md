# 终端代理与公司网关行为 — 为什么浏览器能上网、终端和 Agent 不行

> 配套操作手册：[../intranet-proxy-setup.md](../intranet-proxy-setup.md)（只有步骤）。本篇解释背后机制与一次完整实机排查（2026-07，Windows + macOS）沉淀的结论。

## 1. 两套互不相通的代理体系

浏览器和终端工具走的是**两套完全独立的代理机制**：

| | 浏览器 | 终端工具（curl / git / npm / Node / Agent） |
|---|---|---|
| 代理来源 | 系统代理 / PAC 脚本（Windows WinINET、macOS 网络偏好设置），公司统一下发 | `http_proxy` / `https_proxy` / `no_proxy` 环境变量 |
| 是否自动生效 | 是 | 否，必须手动配环境变量 |

所以"浏览器能上网、终端不行"不是故障，是默认状态。环境变量要大小写各配一份——历史原因各工具认的名字不统一（curl 对 HTTP 流量甚至**只认小写** `http_proxy`，这是 CGI 时代 `HTTP_PROXY` 头注入漏洞留下的安全规矩）。

## 2. Octo Agent 桌面端怎么拿到代理

打包产物已内置完整链路，配好环境变量即可，无需任何产品侧配置：

1. **sidecar 启用环境变量代理**：`packages/desktop/src/main/sidecar.ts` 启动时调 Node 的 `http.setGlobalProxyFromEnv()`，整个 agent 进程的 fetch/http（含 webfetch 工具）都遵循 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`。注意它包在 try/catch 里——若哪天 Electron 降级到不带该 API 的 Node 版本，会**静默降级为不走代理**，只在日志留一行 `failed to load proxy environment`，排查时记得搜。
2. **macOS 上环境变量怎么进 GUI 应用**：macOS 从 Dock/Spotlight 启动的 GUI 应用不读 `~/.zshrc`。我们的解法在 `shell-env.ts`：主进程启动时跑一次 `$SHELL -il -c env` 把用户 shell 环境（含 `.zshrc` 里的代理变量）抓进来再传给 sidecar。推论：**改了 `.zshrc` 必须完全重启 app**（⌘Q，非关窗口）；`.zshrc` 里若有交互式卡住的配置，探测会超时并回退（日志搜 `shell-env`）。
3. **Windows 上**：不做 shell 探测，直接继承注册表里的用户级环境变量（`[Environment]::SetEnvironmentVariable(..., 'User')` 写入的那份）。推论：变量要**先设、后启动 app**；老进程永远拿不到新变量，极端情况注销重登。
4. **内网流量保护**：sidecar 自动把 `localhost` 等 loopback 追加进 `NO_PROXY`（`ensureLoopbackNoProxy`），`util/network.ts` 再追加 `.huawei.com` 等内网域名。所以配代理**不会**把内网 LLM 网关 / MCP / 上传流量带偏。
5. **中间人证书**：sidecar 启动时把系统证书（含公司根证书）加载进 Node（`useSystemCertificates`），所以网关对 HTTPS 做中间人重签时 app 也能正常校验——终端 curl 会报证书错，app 不会（见 §4）。

### 2.1 两个反直觉点（2026-07-15 实证补充）

- **终端 `env` 有代理 ≠ sidecar 有**。sidecar 拿到的是主进程启动那一瞬间 `$SHELL -il` 探测出的**快照**（超时 5 秒放弃），不是实时环境。另外 Shell 工具以 `zsh -l -c` 起进程，**不 source `.zshrc`**——所以"我在终端 echo 得出来"不能证明 app 里也有。
- **来路不明的 `all_proxy` 会让 webfetch / MCP 全线 Transport error**。实证过一次：用户机器上存在一个指向失效端口的 `all_proxy`，删掉即恢复（重启因素已排除——该 app 关窗即完全退出，程序坞小黑点消失）。排查手法：让 agent webfetch 抓 **`http://ifconfig.me/ip`（明文 http）**，能通就说明是 TLS/证书问题，还不通才是代理链路本身没生效。

## 3. 公司网关（netentsec）的实测行为

出口网关不是透明管道，会按策略干预，这些行为容易被误判成"代理没配好"：

- **HTTPS 中间人重签**：`curl -v` 里 `Proxy-agent: netentsec` 可证。网关解密流量后用公司根证书重签,浏览器和 app（加载了系统证书）信任它，Mac 自带 curl（只认 `/etc/ssl/cert.pem`，不读钥匙串）不信任 → 报 `self signed certificate in certificate chain`（exit 60）。
- **按流量特征/UA 拦截**：同一 URL，浏览器能开、裸 curl 拿到网关伪造的 `503 Service Temporarily Unavailable` HTML 页。给 curl 加浏览器 UA（`-A "Mozilla/5.0..."`）即放行。webfetch 工具自带 Chrome UA（`webfetch.ts`），所以 app 里反而通。
- **按域名在 TLS 层掐断**：部分域名（实测 example.com）CONNECT 建立后直接断连，表现为 `Transport error`，不是 HTTP 错误码。配置层面无解，换源。
- **判断"封站还是自己配错"的裁决法**：用浏览器开同一 URL。浏览器也打不开 → 网关封站；浏览器能开而终端/app 不行 → 才是配置或客户端问题。

## 4. 各平台 curl 的坑（都不影响 app，只影响终端验证）

| 现象 | 根因 | 处理 |
|---|---|---|
| Windows 报 `CRYPT_E_NO_REVOCATION_CHECK (0x80092012)` | Windows curl 用 schannel，默认联网查证书吊销（CRL/OCSP），该请求在内网出不去 | 加 `--ssl-no-revoke`。Mac/Linux curl 和 Node 默认不做在线吊销检查，故只有 Windows 中招 |
| Mac 报 `self signed certificate in certificate chain` (exit 60) | 网关中间人重签 + Mac curl 不读系统钥匙串 | 验证时加 `-k`；app 因加载系统证书不受影响 |
| 命令秒退、零输出 | `-s` 静默模式把报错也吞了 | 去掉 `-s` 加 `-v`；`curl -v` 输出里 `CONNECT ... 200 Connection established` = 代理认证与隧道 OK，之后的错都是 TLS/目标站层面 |
| PowerShell 里 `curl` 行为怪异 | 裸 `curl` 是 `Invoke-WebRequest` 别名 | 写全 `curl.exe` |

## 5. 排查方法论与结论速记

一次典型的"配了代理还是不行"，按信号强弱排查：

1. **超时 / 连不上** → 环境变量根本没进当前进程。查 `env | grep -i proxy`（Win: `$env:HTTP_PROXY`）；空 → source/重开窗口/重启 app 的问题。app 内的决定性检查：让 agent 用命令行工具打印 proxy 环境变量——它和 webfetch 同环境，输出即真相。
2. **407** → 密码错 / 已轮换 / 特殊字符没 URL 编码。"之前好好的突然全不行"九成是密码轮换。若响应头是 `Proxy-Authenticate: NTLM/Negotiate` 则环境变量方案彻底不可行，需本地转换代理（Px/Cntlm）——本次实测网关收 Basic，未踩到。
3. **拿到 HTTP 响应（含 503）** → 请求已出去，剩下的是网关策略或目标站问题，用 §3 裁决法。**httpbin.org 自身极不稳定、常年 503，别拿它当验证基准**；统一用 `https://ifconfig.me/ip`（返回出口公网 IP，一眼判通断）。
4. 全通后的反向检查：app 里随便发句话确认模型正常回复 = `NO_PROXY` 内网豁免也正常。

另注：浏览器和终端的出口 IP 可能不同（实测 `14.x` vs `119.x`）——PAC 可能按目标分流到不同出口，属正常现象，不是配置错。
