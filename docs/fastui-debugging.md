# fastui skill — 日志 × Bug 排查对照手册

> **用途**：内网出问题时，照着这份把日志读成结论。与 [insight-debugging.md](insight-debugging.md) 同体例，那份管 Insight 的 console 日志，这份管 `fastui-vue-creator` 这个 skill 的脚本日志。
>
> **范围**：`skills/fastui-vue-creator/` 的六个脚本（`install.sh` / `install.ps1` / `setup-env` / `ensure-env` / `new-session` / `verify` / `export-zip`）打出来的一切。**这是只读排查文档，不改任何代码。**
>
> **怎么用**：内网取日志（§0）→ 外网按错误码查 §2 或按症状查 §4 → 落到「下一步」。
>
> **内外网约定**：日志在内网、分析在外网。把这份文档连同日志片段一起交给外网的 AI 即可 —— §1 专门写了日志长什么样，§5 给了可直接粘的提示词模板和「最小信息集」。**不要只发一句"装不上"**，那等于什么都没发。

---

## 0. 先取什么（内网侧，照抄即可）

### 0.1 两条诊断命令 —— 都要跑，各答一个问题

```bash
# ① 环境快照:这台机器上有什么、本进程看到的代理变量是什么
node <skillDir>/scripts/doctor.mjs

# ② 网络:内网资源到底拉不拉得到(macOS)
bash "<skillDir>/scripts/install/install.sh" --check
```
```powershell
# ② 网络(Windows)
powershell -ExecutionPolicy Bypass -File "<skillDir>\scripts\install\install.ps1" -Check
```

> ⚠️ **必须由 agent 在它自己的进程里跑，不能让人到终端里手敲。** 代理这类问题只存在于 agent 宿主进程的环境里：2026-09-08 实测，人在终端跑得到"一切正常"，agent 在同一台机器上同时报 504。**诊断跑错环境，比不跑更糟。**
>
> `doctor` 的输出里有一行 `NET_CHECK_CMD:`，就是②那条命令、路径已展开好，照抄就能跑。

### 0.2 日志文件在哪

| 文件 | 装不上那类问题 | 跑起来之后的问题 |
|---|---|---|
| `octo-fastui.log`（脚本输出，**含 npm / yarn 原文与网关响应体**） | Windows `%LOCALAPPDATA%\OctoAgent\fastui-env\`<br>macOS `~/Library/Application Support/OctoAgent/fastui-env/` | `<项目>/.octo/<会话id>/` |
| `devserver.log`（webpack dev server 原始输出，**编译判定的数据源**） | — | `<项目>/.octo/<会话id>/`（Windows 另有 `.err`） |

超过 8MB 会轮转成 `octo-fastui.log.old`，**只留一代** —— 要发旧的就连 `.old` 一起发。

> 按平台展开的绝对路径、可直接粘贴的查看命令，在 [find-local-logs.md](find-local-logs.md) 的 ⑤⑥ 两类里，那份是全 app 通用的「日志在磁盘哪儿」指南。

### 0.3 只能截图时，至少要框住哪几行

日志可能很长，截图必然只能截一段。**按这个优先级截**：

1. `RESULT: FAIL | <CODE>: …` 连同它下面的 `DETAIL:` / `HINT:` / `LOG:` —— 这四行是一个整体，缺一行就少一半信息
2. 往上找最近的 `===== <时间> <完整命令行>` —— 它说明这次是哪个脚本、带什么参数跑的
3. 失败那一步的子进程原文：`--- npm stderr ---` 或 `--- yarn stderr ---` 之后的**最后 20 行**
4. 有 `[body]` 开头的段落就一定要带上 —— 那是网关/WAF 的错误页正文，通常是唯一能说清"被谁拦了"的东西

> 错误码是 ASCII，中文在 GBK 终端里可能是乱码 —— **乱码不影响定位，照发**，码本身就够查 §2。

---

## 1. 日志长什么样（分析方 / AI 先读这节）

### 1.1 契约块：脚本对外说话的唯一格式

```
RESULT: OK
<KEY>: <value>                  # 大写 SNAKE,单行
WARN: <诊断>                     # 0..n 行,不阻塞

RESULT: FAIL | <CODE>: <中文一句话原因>
DETAIL: <补充,可能是响应体前 200 字节>
HINT: <可直接执行的下一步>
LOG: <日志绝对路径>
```

退出码：`0` = OK，`1` = 业务失败，`2` = **用法错误**（参数传错了，不是环境问题）。

多行内容用显式块，不混进 key-value：`ERRORS_BEGIN … ERRORS_END`（webpack 编译错误原文）、`LOG_TAIL_BEGIN … LOG_TAIL_END`（dev server 日志尾部）。

### 1.2 日志文件里的分节标记

```
===== 2026-09-10T08:58:25.123Z /…/setup-env.mjs --env-dir=… --registry=…   ← 一次运行开始:UTC 时间 + 完整命令行
12:10:47 $ /…/node/bin/npm install -g yarn                                  ← 过程行,带 hh:mm:ss;`$ ` 开头的是实际执行的命令
--- npm stdout ---                                                          ← 子进程原文开始
npm notice …
--- npm stderr ---                                                          ← npm/yarn 的话基本都在 stderr 里
npm ERR! 504 Gateway Time-out - GET http://…
12:10:49 [exit] npm status=1 1750ms                                         ← 子进程退出码与耗时
RESULT: FAIL | YARN_INSTALL_FAILED: …                                       ← 契约块
```

几条判读规则：

- **一次运行 = 一个 `=====` 段。** 排查只看最后一段；上面的是历史，别把上一次的错当成这一次的。
- `(共 264030 字节,只留尾部 64KB)` —— 子进程输出超长时只留尾部。**看不到开头是正常的**，失败原因在尾部。
- `[exit] <cmd> status=<码> <耗时>ms` —— `status` 是子进程的真实退出码。
- `[http] <url> -> code=<HTTP 码> exit=<curl 退出码> time=<秒>s` —— **两个码要一起看**，见 §3.3。
- `[body] <标签> (N 字节),前 2KB:` —— 之后是**原样的响应体**。超过 64KB 或像二进制只记大小。
- `代理凭据会被打码`（`http://user:***@host`），日志里看到 `***` 是脱敏，不是配错了。

### 1.3 过程行前缀

| 前缀 | 出自 | 含义 |
|---|---|---|
| `[skip]` | install / setup-env | 这一步跳过了（复用已有 node / yarn 已存在 / **不需要下载 node 因此没读 manifest**） |
| `[node] 来源: …` | install | **v16 起最该先看的一行**：这次用的是哪个 node（`pool` = 共享池里的 portable node、`system` = 机器上原有的、`download(…)` = 要下载，括号里是原因）。看到 `system` 时整个安装不发一次网络请求，**没有 `[http]` 行是正常的** |
| `[download]` `[node]` | install | 开始下载 / node 解压完成 |
| `[node]` `[yarn]` | setup-env | 用的是池子还是系统 node / yarn 装到哪、用的哪个 registry |
| `[http]` `[curl]` | install | 一次 HTTP 请求的结果 / curl 自己的报错 |
| `[body]` | install | 非 2xx 响应体原文 |
| `[handoff]` | install | 引导脚本交棒给 `setup-env.mjs`，**之后的日志由它自己写** |
| `[deps]` | setup-env | 复制 workspace 成员、写 `.yarnrc` 直连标记块 |
| `[exit]` | setup-env | 子进程退出码 |
| `[warn]` | 各处 | 不阻塞，但常是根因的前兆（例：`找不到 yarn 的 JS 入口`） |
| `[stage]` `[wait]` | verify | 编译进行到哪一阶段 / 正在等 dev server |

---

## 2. 错误码字典

> 用法：拿到 `RESULT: FAIL | <CODE>` 直接查这里。**"下一步"分两列**：内网那栏是你在机器上做的动作，外网那栏是分析时还需要哪段日志。

### 2.1 装环境阶段 —— `install.sh` / `install.ps1`

| CODE | 含义 | 最可能的原因 | 内网下一步 | 外网还需要什么 |
|---|---|---|---|---|
| `NO_PYTHON` | macOS 上没有 python3（只用来解析 manifest，与 node 无关）。**v16 起只在真要下载 node 或跑 `--check` 时才报** —— 机器上已有 node 且大版本命中白名单时这条根本不会出现 | 干净的 macOS，且这台机器没有可复用的 node | `xcode-select --install`；或先确认 `[node] 来源` 那行为什么判成了要下载 | 无 |
| `NO_MANIFEST` | 没有 manifest 地址，或离线目录里没有 `manifest.json` | 参数传错 / 离线包不完整 | 看 `HINT` 给的两个开关 | 完整命令行（`=====` 那行） |
| `SKILL_MANIFEST_BROKEN` | 读不了 skill 自带的 `references/env.manifest.json`（**仅 ps1**） | skill 包没组装好 / 文件被编辑坏 | 重新上架 skill | `DETAIL` 里的异常原文 |
| `MANIFEST_UNREACHABLE` | manifest 请求失败（`--check` 模式下的码） | **代理 / 网络 / 证书**，见 §3.3 | 跑一次 `--check` 全量 | `[http]` 行的两个码 + `[body]` |
| `DOWNLOAD_FAILED` | 拉 manifest 或 node 包失败（安装模式下的码） | 同上 | 同上 | 同上；若是 node 包，还要 `ASSET_*` 行 |
| `MANIFEST_NOT_JSON` | HTTP 200 了，但返回的不是 JSON | **十有八九是代理 / 网关 / SSO 的登录页** | 把 `[body]` 那段发出来 | `[body]` 原文（这就是答案本身） |
| `MANIFEST_PARSE_FAILED` | JSON 合法，但取不到本平台的包信息（**仅 sh**） | manifest 里缺 `node.platforms.<平台>` | 核对 manifest | manifest 全文 |
| `NO_PLATFORM_PKG` | `node.platforms` 里没有这台机器的平台键 | 投放时漏了 `darwin-arm64` / `darwin-x64` | 补 manifest 条目 | `PLATFORM_HERE:` 那行 |
| `ASSET_UNREACHABLE` | `--check` 判定：有平台的包拉不到 | 见 §3.2 的四种组合 | 把整段 `--check` 输出发出来 | 全部 `ASSET_*` 行 + `[body]` |
| `NO_LOCAL_PKG` | 离线目录里没有对应的包文件 | 离线包不完整 | 核对目录 | 无 |
| `SHA256_MISMATCH` | 包下下来了但校验不过 | **下载被截断，或被代理改写过** | 重下；确认 `Content-Length` | `DETAIL` 里的 expected/actual/size |
| `EXTRACT_FAILED` | 解压失败，或解压后找不到 `node` | 包损坏 / `stripComponents` 配错 / Win 缺 `tar.exe` | 先看是不是 SHA 就已经不对 | `DETAIL` 的 tar 退出码 |
| `BAD_PROXY` | `-Proxy` 地址解析不了（**仅 ps1**） | 参数写错 | 形如 `http://host:port` | 无 |
| `NODE_MISSING` | 传了 `--skip-node` / `-SkipNode`，但池子里和系统里都没有可用的 node | 调用方的问题 | 去掉这个开关重跑 | `[node] 来源` 那行 |
| `UNEXPECTED` | **兜底**：没有专门处理的路径崩了 | 脚本自身的问题居多 | 把这一整段 `=====` 发出来 | **整段日志**，这条必须看上下文 |
| `BAD_USAGE`（退出码 2） | 参数传错了 | 调用方的问题，不是环境问题 | 看 `HINT` | 完整命令行 |

### 2.2 装依赖阶段 —— `setup-env.mjs`

| CODE | 含义 | 最可能的原因 | 内网下一步 | 外网还需要什么 |
|---|---|---|---|---|
| `NODE_MISSING` | 手上一个能用的 node 都没有（v16 起**不再等于"共享池里没有"** —— 复用系统 node 是正常状态） | 引导脚本那步没跑完 | 重跑 install 脚本 | 上一段 `=====`（install 的） |
| `NPM_NOT_FOUND` | 找到了 node，但找不到它自带的 npm | node 是精简发行版 / 被裁剪过（企业镜像里见过） | 用不带 `--skip-node` 的 install 让它下 portable node | `[node] 系统 node: …` 那行的路径 |
| `SKILL_NOT_ASSEMBLED` | `template/` 缺 `package.json` 或 `yarn.lock` | **skill 没在内网组装**，不是用户能解决的 | 走 skill 上架流程 | 无 |
| `YARN_INSTALL_FAILED` | 装 yarn 或装依赖失败 | **首选怀疑代理**（历史上就是它）。另一种形态是 `npm 报成功,但 <池子>/node/bin/yarn 不存在` —— 那是机器上的 `~/.npmrc` 里有 `prefix=` 抢走了落点 | 把 `--- npm stderr ---` 整段发出来；后一种情形发 `npm config list` | 子进程原文尾部 20 行 |
| `YARN_NOT_FOUND` | yarn 装上了却找不到 JS 入口（Windows 上响亮失败） | npm 全局落点与预期不符 | 把 `<池子>/node` 的目录树发出来 | `POOL_YARN_JS:`（doctor 那行） |
| `LOCKFILE_DRIFT` | 装完 `deps/yarn.lock` 与 template 的不一致 | **template 的 package.json 与 yarn.lock 本身不匹配** | 在维护机上重新生成 lockfile | `EXPECTED_LOCK` / `ACTUAL_LOCK` |

### 2.3 每个会话开头 —— `ensure-env.mjs`

| CODE | 含义 | 下一步 |
|---|---|---|
| `SKILL_NOT_ASSEMBLED` | 同上，占位文件还在 | 停下，这不是用户能解决的问题 |
| `ENV_MISSING` | 依赖池 / 环境清单缺失。**v16 起不再包含"共享池没有 node"** —— 复用系统 node 的机器上 `<envDir>/node/` 下只有 yarn，那是正常状态 | 直接执行 `HINT` 里那条安装命令 |
| `ENV_OUTDATED` | 共享池的依赖树与当前 skill 的 template 不一致 | 执行 `HINT` 里的 `--upgrade` |
| `ENV_NODE_BROKEN` | 当前要用的那个 node 跑不起来（池子里的，或系统的） | 重装 |
| `ENV_NODE_MISMATCH` | node **大版本**与装依赖时用的那个对不上（v16：小版本不同只出 `WARN:`，不阻塞） | `--upgrade` |
| `WARN:` 开头 | 抽查发现某个关键包版本对不上 | **不阻塞**，但装完还报别的错时回头看它 |

### 2.4 建会话工程 —— `new-session.mjs`

| CODE | 含义 | 下一步 |
|---|---|---|
| `ENV_MISSING` | 共享依赖池不存在 | 先把环境装上 |
| `PROJECT_INCOMPLETE` | 产物目录已存在但缺关键文件 | **跑 `new-session --reset`** —— 删除动作只能由脚本做，[硬约束 0](../skills/fastui-vue-creator/SKILL.md) 禁止 agent 自己删 |
| `COPY_FAILED` / `TEMPLATE_INCOMPLETE` | 模板复制失败或复制不全 | 磁盘空间 / 权限 / 中文路径；重跑可自愈 |
| `LINK_FAILED` | 依赖链接建不起来 | Windows 看是不是 junction 建不了；**产物目录里手工跑过 `yarn install` 也会撞这条** |
| `UNSAFE_CLEANUP` | 路径断言没过，脚本拒绝删除 | **这是护栏生效，不是 bug** —— 把 `--artifact-dir` 传了什么发出来 |
| `NO_FREE_PORT` | 连续 50 个端口都被占 | 关掉别的 dev server |

### 2.5 编译与预览 —— `verify.mjs`

| CODE | 含义 | 下一步 |
|---|---|---|
| `COMPILE_ERROR` | webpack 编译没过 | **`ERRORS_BEGIN … ERRORS_END` 里就是原文**，直接看它改代码 |
| `COMPILE_TIMEOUT` | 等编译结果超时 | 看 `LOG_TAIL` 块；若日志已稳定却识别不出编译轮次，是 `lib/compile.mjs` 的 MARKERS 与 cli-service 输出对不上 |
| `DEVSERVER_EXITED` | dev server 起来就退了 | 看 `devserver.log` 尾部 |
| `SPAWN_FAILED` | 起不来（Windows `Start-Process`） | **中文路径**曾是根因（已改 `-EncodedCommand`）；看 `DETAIL` |
| `CLI_SERVICE_NOT_FOUND` | 共享池里找不到 `@turboui/turbo-ui-cli-service` | 依赖池没装全，回到 `ensure-env` |
| `NO_SESSION` / `NO_PROJECT` | 会话状态或工程目录不存在 | 先跑 `new-session` |
| `PORT_RACE` | 连续 3 次端口被抢 | 并发起太多会话 |
| `ATTACH_FAILED` | 指定端口上没有在跑的服务 | 参数用法问题 |

### 2.6 导出 —— `export-zip.mjs`

| CODE | 含义 | 下一步 |
|---|---|---|
| `NO_SESSION` | 找不到会话状态 | 先跑 `new-session` |
| `EMPTY_PROJECT` | 目录里没有可打包的文件 | 工程根本没建起来 |
| `READ_FAILED` | 读不到目录 | 权限 / 路径 |
| `EXPORT_CONTAMINATED` | 打包结果里混进了 `node_modules` | **正确性护栏**，交付包必须干净；把 `DETAIL` 里那个名字发出来 |

---

## 3. `--check` 的输出怎么读

它只探测、**不下载整包、不装任何东西**，走的是与真实安装完全相同的代码路径（同一套代理开关、同一个 HTTP 客户端、同一条 URL 拼法）。

### 3.1 字段

| 字段 | 怎么用 |
|---|---|
| `PLATFORM_HERE` | 跑命令这台机器的平台键 |
| `PROXY_MODE` | `direct(…)` = 强制直连（默认）；`via …` = 显式走了代理 |
| `PROXY_ENV_*` / `PROXY_ENV: (无)` | **本进程看到的**代理变量。`(无)` 是"查了，没有"，不是"没查" |
| `SYSTEM_PROXY_FOR_HTTPS`（仅 Windows） | 系统代理设置 —— Windows 上 .NET 读的是**它**，不是环境变量 |
| `TLS_VERIFY` | 默认 `OFF`（内网自签名证书），完整性靠 sha256 |
| `MANIFEST_HTTP` / `_BYTES` / `_MS` | manifest 这一跳的结果 |
| `ASSET_<平台>` | **每个平台一行**，见下 |
| `CHECKED_PLATFORMS` | 一共验了几个平台 |

### 3.2 `ASSET_*` 行的判读

```
ASSET_DARWIN_ARM64: HEAD=403 GET=403 len=97 type=text/html
                    └── HEAD 请求      └── 1 字节 Range GET   └── 大小与类型
```

| HEAD | GET | 判读 |
|---|---|---|
| 2xx | 200 / 206 | ✅ 这个平台没问题。`206` = 服务端支持 Range；`200(服务端忽略 Range…)` 也正常，脚本已中止未下载 |
| 2xx | **非 2xx** | ⚠️ **最需要警惕的一格**：HEAD 放行、GET 被拦。2026-09-09 的阻塞就是这个形态（浏览器/HEAD 能拿、`curl` GET 403）。**只验 HEAD 会给出假的全绿** |
| 非 2xx | 非 2xx | 整个 URL 被拦或不存在 —— 看 `type=`：`text/html` 基本可断定是网关/WAF 错误页，正文在 `[body]` 里 |
| 非 2xx | 2xx | 服务端不接受 HEAD（405 之类），不影响真实安装 |

`type=` 和 `len=` 也要看：`.tar.gz` 却返回 `text/html`、`len` 只有几百字节 —— 那多半是错误页伪装成 200。

### 3.3 两个码一起看：`code=` 与 `exit=`

`[http] … -> code=<HTTP 码> exit=<curl 退出码>`。**`code=000` 说明请求根本没建立起来，这时只有 `exit=` 有意义**：

| curl exit | 含义 | 指向 |
|---|---|---|
| `0` | 传输本身成功（HTTP 码可能仍是 4xx/5xx） | 看 `code=` |
| `6` | 域名解析不了 | DNS / 不在内网 |
| `7` | 连不上主机 | 端口不通 / 防火墙 / **代理地址填错** |
| `28` | 超时 | 网络慢或被静默丢包 |
| `35` | TLS 握手失败 | 证书 / 协议版本 |
| `52` | 服务端没回任何东西 | 被中间设备掐断 |
| `56` | 接收数据失败 | 连接中途断 |
| `60` | 证书验证不过 | 正常情况下不该出现（默认 `-k`） |
| `63` | 超过 `--max-filesize` 主动中止 | **正常路径**：服务端不支持 Range，脚本主动放弃下载 |

HTTP 码这边：`504` / `502` 基本可断定是**代理或网关自己发的**（内网直连不该出现）；`403` 看 `[body]` 里有没有 WAF 字样；`401` / `302` 到登录页 = 需要登录态。

---

## 4. 症状 → 判据 → 下一步

### 4.1 首装完全起不来，agent 说"没有 node"

裸机上工作流第一步 `node scripts/ensure-env.mjs` 本身就需要 node。**这种情况只能从两个安装脚本起步**（它们是 bash / PowerShell 原生的，机器上真没有 node 时会自己把 portable node 下下来；有 node 的话直接复用，见 §4.6）。

判据：`command not found` / `不是内部或外部命令`。
下一步：直接跑 `install.sh` / `install.ps1`。agent 若转而让用户去 nodejs.org 下载，是它违反了 SKILL.md 的硬约束 0.2 —— 把这一段对话发出来。

### 4.2 装到一半失败，怀疑代理

**一条判据就够**：`doctor` 的 `PROXY_*` 行有值，或 `[http]` 里出现 `504` / `exit=7`。

- 两个平台堵的不是同一样东西：macOS 堵**环境变量**（`curl --noproxy '*'`），Windows 堵**系统代理设置**（换掉 `DefaultWebProxy`）；而 npm / yarn 走的是第三条继承链（`setup-env` 的 `childEnv()` 把代理变量整个摘掉）。
- **代理有三层，缺一层等于没堵**：① 环境变量 ② `.npmrc` 的 `proxy=` ③ `.yarnrc` 的 `proxy`。日志里 `[deps] 已在 …/.yarnrc 写入空 proxy` 那行就是第三层生效的证据。
- 确实必须走代理时传 `--proxy=<地址>` / `-Proxy <地址>`，**它同样会堵满三层**。

### 4.3 `doctor` 一片正常，但就是装不上

看 `NETWORK:` 那行 —— 它永远是 `UNKNOWN`。**doctor 不做网络探测**（它与安装用的不是同一个 HTTP 客户端，自己探会给出另一个问题的答案）。**必须再跑一次 `--check`**，那条才有网络结论。

### 4.4 预览白屏 / 编译报找不到模块

先分清是**编译没过**还是**编译过了但页面白**：

- `verify` 报 `COMPILE_ERROR` → `ERRORS` 块里有原文，是代码问题
- `verify` 报 `RESULT: OK` 但页面白 → 看 `WARN:` 有没有"用了 X 但没有 import"；再看宿主有没有在 dev server 就绪前就挂了 iframe
- 报找不到模块且**刚装过环境** → 先怀疑依赖链接：`LINK_FAILED` 或产物目录里被手工跑过 `yarn install`

### 4.5 同一台机器，两次跑结果不一样

八成是**跑的环境不同**：人在终端跑 vs agent 在宿主进程里跑，代理变量不一样。判据：两次的 `PROXY_*` 行不同。**以 agent 那次为准** —— 失败发生在哪个环境，就信哪个环境的诊断。

另一种来源（v16 起）：**换了 node**。判据是 `env.lock.json` 的 `nodeVersion` / `nodePath` 与现在 `doctor` 的 `EFFECTIVE_NODE` 不是同一个 —— 比如装依赖时用的是系统 node，之后有人升级了它。大版本一变，`ensure-env` 会直接报 `ENV_NODE_MISMATCH`；大版本没变只会出一条 `WARN:`，那时行为差异要往这个方向看。

### 4.6 装完了，但日志里既没有下载也没有 `[http]` 行 —— 是不是没装?

**这是正常的**（v16 起）。机器上已有 node 且大版本命中白名单时，安装脚本直接复用它：不读 manifest、不下 node 包，**整个安装一次网络请求都不发**。

判据，三行对上就是装好了：

| 看哪里 | 正常长什么样 |
|---|---|
| install 日志 | `[node] 来源: system -> /usr/local/bin/node;系统 node v22.x.x` |
| `doctor` | `POOL_NODE: MISSING(不一定是问题,见 EFFECTIVE_NODE)` + `EFFECTIVE_NODE: …(系统)` + `SYSTEM_NODE_REUSABLE: YES(…)` |
| `ensure-env` | `RESULT: OK` + `NODE_SOURCE: system` |

**`POOL_NODE: MISSING` 在这种机器上不是故障** —— 共享池里的 `node/` 目录此时只放 yarn（`node/bin/yarn`）。真正不可替代的是 `deps/node_modules`（那 1GB 内网组件库），它缺了才是 `ENV_MISSING`。

反过来，`SYSTEM_NODE_REUSABLE: NO(major xx 不在白名单里…)` 说明这台机器会走下载分支 —— 那条链路要网络，§4.2 / §4.3 才适用。白名单在 skill 的 `references/env.manifest.json`（`systemNodeMajors`），要放开一个新大版本得先在那个版本上验过，不是随手加。

---

## 5. 把现场递给外网 AI

### 5.1 最小信息集

一次能定位的请求，至少要包含：

1. **`RESULT: FAIL` 那四行**（含 `DETAIL` / `HINT` / `LOG`）
2. **最近一个 `=====` 行**（哪个脚本、什么参数）
3. 失败那步的**子进程原文尾部**或 `[body]` 段
4. `doctor` 整段（尤其 `PROXY*` / `POOL_*` / `SKILL_ASSEMBLED`）
5. 若与网络有关：`--check` 整段

### 5.2 可直接粘的提示词模板

```
这是内网 fastui skill 的报错。排查手册见 docs/fastui-debugging.md,
按 §2 的错误码字典和 §3 的判读规则分析,给我:
① 最可能的原因(排序,说明判据来自日志哪一行)
② 还需要我补哪一段日志或跑哪条命令才能确认
③ 如果原因确定,下一步该做什么(区分"我在内网能做的"和"要改代码的")

—— 环境：Windows / macOS,agent 进程内跑的 / 人在终端跑的
—— 日志：
<粘贴>
```

### 5.3 分析方要遵守的两条

- **不要把 `HINT:` 当成结论**。`HINT` 是脚本预设的下一步，它不知道现场；真正的判据在 `[http]` / `[body]` / 子进程原文里。
- **`RESULT: FAIL | UNEXPECTED` 不要单独下结论**。它是兜底，意味着"这条路径没人专门处理过"，必须连上下文整段看。

---

## 6. 这份日志答不了什么

诚实列出来，免得在错误的地方反复挖：

| 答不了 | 为什么 | 该去哪 |
|---|---|---|
| 宿主（Electron）有没有把 dev server 起起来 | 那是主进程的事 | electron-log，搜 `[fastui]` 前缀（[find-local-logs.md](find-local-logs.md) ①②） |
| 模型生成的 `.vue` 内容为什么不对 | 脚本只管编译门禁，不看语义 | 会话记录 + `ERRORS` 块 |
| 浏览器里能打开、脚本却拉不到 | **这正是要靠 `--check` 收敛的**，日志本身只能给出 `HEAD=/GET=` 两列事实 | §3.2；UA / 登录态两条假设需要人另外试 |
| Windows 上 PowerShell 自身的行为异常 | `install.ps1` 的运行时行为**至今没有在 PS 5.1 上实跑验证过** | 首跑要盯着看，见 SPEC-DES-001 §0.0「验证覆盖缺口」 |

---

## 相关

- [SPEC-DES-001 §5.1.1](specs/design/fastui-vue-codegen-pipeline.md#511-统一输出契约所有脚本) —— 输出契约与「日志里必须有什么」的规范来源
- [SPEC-DES-002 §4.4.9](specs/design/fastui-env-hosting.md#449-装不上时跑什么) —— 两条诊断命令的设计理由（为什么 doctor 不做网络探测）
- [SPEC-DES-002 §4.4.8](specs/design/fastui-env-hosting.md#448-首装踩到的坑内网实测分两批2026-09-07--09-08) —— 首装两批实测坑的完整根因链
- [find-local-logs.md](find-local-logs.md) ⑤⑥ —— 日志文件的平台绝对路径与查看命令
- [insight-debugging.md](insight-debugging.md) —— Insight 侧的同类手册
- [learning/bash-err-trap-and-set-e.md](learning/bash-err-trap-and-set-e.md) —— `install.sh` 的兜底为什么长这样
