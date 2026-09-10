# SPEC-DES-002 — fastui 环境的内网托管（操作手册）

> 从 [SPEC-DES-001](fastui-vue-codegen-pipeline.md) §4.4 拆出，编号与小节号沿用原文（仍叫 4.4.1、4.4.2…），
> 方便与既有引用对得上。
>
> **读者：在内网做资源投放 / 运维的人。** 这份是**照着做就行**的清单，不需要先读主 spec 的架构部分 ——
> 那边讲的是"为什么这么设计"，这份只讲"要放什么、放哪、怎么自检"。
>
> 主 spec 的 §4.1 / §4.2 说明了为什么第一版只托管 node 包 + manifest（deps 整包不做）；
> 真要追根因时再回去翻。

## 4.4 内网托管：要准备什么、怎么放（离线操作手册）

> 本节是**可照着做的操作清单**，目标是把"内网侧要做的事"一次说完。

### 4.4.1 三样资产走三条链路 —— 先分清，不然会重复托管

| 资产 | 大小 | 分发链路 | 每平台一份？ | 变更频率 |
|---|---|---|---|---|
| **skill 包**（`SKILL.md` + `scripts/` + `references/` + **`template/`** + `vendor/`） | 几 MB | **技能库上架机制**（已有） | 否，通用 | 高 |
| **portable node** | ~50 MB | **nginx 托管** | **是** | 极低（版本锁死） |
| **deps 整包**（1GB） | 1 GB | nginx 托管 | 是 | 低 |

**`template/` 跟 skill 包走，不单独托管** —— 这是 v7 相对 v5/v6 的修正，理由：

1. `template/` 与 `scripts/`、`SKILL.md` **强耦合**：`turboui.config.js` 的三处环境变量注入（[§2.2](fastui-vue-codegen-pipeline.md#22-三处环境变量注入全部带回退)）、SKILL.md 里内联的 golden example、`HANDOFF.md` —— 它们必须同版本。拆到两条分发链路 = 人为制造一个版本对齐问题，而 skill 有现成的上架/版本机制
2. `template/` 与 `deps/` 的耦合（`yarn.lock` 决定依赖树）**不需要靠分发同步来保证** —— `lockfileHash` 校验 + 本机 `yarn install` 自愈就是 lockfile 存在的意义（[§5.2.2](fastui-vue-codegen-pipeline.md#522-升级机制lockfile-驱动的增量升级)）
3. 手工维护的托管条目越少越好。nginx 上只剩一个几乎永不变的 node

**`deps` 整包第一版不做**（[§4.2](fastui-vue-codegen-pipeline.md#42-v2-整包分发仅在-v1-实测出现规模化安装失败时才推进)：仅在 v1 实测出现规模化安装失败时才推进）。所以 **nginx 上第一版只有 node 包 + 一个 manifest.json**。

### 4.4.2 下载哪些 node 文件（精确文件名）

版本锁 **v22.19.0**（与内网现有环境一致）。官方目录 `https://nodejs.org/dist/v22.19.0/`，内网走已有 node 镜像同路径。**原样搬，不要解压重压**（重压会丢 Unix 权限位和 symlink）：

| 目标平台 | 文件名 | 说明 |
|---|---|---|
| Windows x64 | `node-v22.19.0-win-x64.zip` | 设计师机器主力 |
| macOS Apple Silicon | `node-v22.19.0-darwin-arm64.tar.gz` | M 系列 |
| macOS Intel | `node-v22.19.0-darwin-x64.tar.gz` | 若无 Intel 机器可省 |

> Windows ARM64 暂不列；确有此类机器再加 `node-v22.19.0-win-arm64.zip` 并在 manifest 里补一条。
> **必须用 `.zip` / `.tar.gz`，不要用 `.msi` / `.pkg`** —— 安装器会写注册表、改 PATH、要管理员权限，与 [§4.1](fastui-vue-codegen-pipeline.md#41-v1-路线分发-portable-node--模板本机安装依赖) 的前提冲突。

三个包解压后外层都有一级同名目录（如 `node-v22.19.0-win-x64/`），安装脚本按 manifest 的 `stripComponents: 1` 剥掉，最终落成 `<envDir>/node/node.exe`（Win）/ `<envDir>/node/bin/node`（Mac）。

### 4.4.3 sha256 从哪来

**node 包不用自己算** —— 官方每个版本目录下有 `SHASUMS256.txt`，直接从里面抄对应行（内网镜像通常也同步了这个文件）。

> ⚠️ **三个包的 sha256 各不相同**，一个文件一个值 —— sha256 是文件内容的指纹，Windows 包和 macOS 包内容完全不同。`SHASUMS256.txt` 里是**每行一个文件**（`<hash>  <文件名>`），按文件名找对应行，不要抄成同一个值。

自己算（校验搬运过程有没有损坏，或给自己压的包算）：

```powershell
# 内网 Windows / PowerShell
Get-FileHash -Algorithm SHA256 .\node-v22.19.0-win-x64.zip | Format-List
```
```bash
# 本地 macOS / bash
shasum -a 256 node-v22.19.0-darwin-arm64.tar.gz
```

**sha256 是必须的，不是可选项**：内网下载被网关截断、代理返回一个 HTML 错误页存成 `.zip`，这类事情的表现是"`yarn install` 报一堆看不懂的错"，不校验根本想不到是包坏了。

### 4.4.4 资源怎么放（内网已有 `/design` 目录，无需改 nginx）

内网现有一个可直接投放的静态目录，落地路径与访问地址：

```
https://octo.hdesign.huawei.com/design/fastui-env/
├─ manifest.json
└─ node/
    ├─ node-v22.19.0-win-x64.zip
    ├─ node-v22.19.0-darwin-arm64.tar.gz
    └─ node-v22.19.0-darwin-x64.tar.gz
```

**manifest.json 和资源本身放在同一目录**，manifest 里用**相对路径**引资源（见 §4.4.5）—— 将来换域名、换目录，manifest 一个字都不用改。

> 目录名用 `fastui-env`，与共享池同名。刻意如此：将来 [§4.2](fastui-vue-codegen-pipeline.md#42-v2-整包分发仅在-v1-实测出现规模化安装失败时才推进) 的 1GB `deps` 整包也放这里，届时这个目录的内容就是共享池的完整镜像。

**不需要动 nginx 配置**，但 manifest 的缓存问题仍在（升级后客户端可能读到旧的），由**客户端侧解决**，不依赖服务端配合：

- 请求 manifest 时带 `Cache-Control: no-cache` 请求头
- URL 追加 `?t=<毫秒时间戳>` 破缓存

资源包本身**允许被缓存**（内容不变、有 sha256 兜底），命中缓存反而是好事。

自检：

```powershell
# 内网 Windows / PowerShell
Invoke-RestMethod https://octo.hdesign.huawei.com/design/fastui-env/manifest.json
(Invoke-WebRequest -Uri https://octo.hdesign.huawei.com/design/fastui-env/node/node-v22.19.0-win-x64.zip -Method Head).Headers['Content-Length']
```
```bash
# 本地 macOS / bash（该 host 外网不可达，此处仅记录命令形态）
curl -s https://octo.hdesign.huawei.com/design/fastui-env/manifest.json | head -40
curl -sI https://octo.hdesign.huawei.com/design/fastui-env/node/node-v22.19.0-darwin-arm64.tar.gz | grep -i content-length
```

**投放后必须逐个核对 `Content-Length`**：内网投放走网页上传时，几十 MB 的包被截断或代理返回错误页存成 `.zip` 都发生过，表现只是"`yarn install` 报一堆看不懂的错"。sha256 会兜住，但先看一眼大小能省一轮排查。

**而且要 `manifest.node.platforms` 里的每一个平台都验一遍，不能只验当前这台机器的那个。**2026-09-09 就踩了：只验了跑命令那台的平台，`darwin-arm64` / `darwin-x64` 两个从没被 HEAD 过 —— 而设计师那台恰好是 arm64。**验的时候必须用 curl / `Invoke-WebRequest`，不能用浏览器**：同一个 URL 浏览器 200 而 curl 403 的情况真实发生过（见 [§0.0](fastui-vue-codegen-pipeline.md#00-当前进度与待办改动后随手更新这一节) 的阻塞项），而安装脚本用的正是后者。

### 4.4.5 `manifest.json` 示例（可直接改数值使用）

```json
{
  "manifestVersion": 1,
  "npmRegistry": "http://mirrors.tools.huawei.com/npm",
  "node": {
    "version": "v22.19.0",
    "platforms": {
      "win32-x64": {
        "file": "node/node-v22.19.0-win-x64.zip",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "stripComponents": 1
      },
      "darwin-arm64": {
        "file": "node/node-v22.19.0-darwin-arm64.tar.gz",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "stripComponents": 1
      },
      "darwin-x64": {
        "file": "node/node-v22.19.0-darwin-x64.tar.gz",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "stripComponents": 1
      }
    }
  },
  "depsBundle": null
}
```

| 字段 | 含义 |
|---|---|
| `npmRegistry` | 只用于 [§4.1](fastui-vue-codegen-pipeline.md#41-v1-路线分发-portable-node--模板本机安装依赖) ③ 装 yarn。**不传给 `yarn install`** |
| `file` | **相对 manifest 所在目录**解析 |
| `sha256` | 从 `SHASUMS256.txt` 抄，或按 §4.4.3 自算 |
| `stripComponents` | 解压时剥掉的外层目录级数，node 官方包固定为 `1` |
| `depsBundle` | [§4.2](fastui-vue-codegen-pipeline.md#42-v2-整包分发仅在-v1-实测出现规模化安装失败时才推进) 的 1GB 整包，第一版填 `null` |

### 4.4.6 manifest URL 写在哪

**直接写死在 skill 的 `references/env.manifest.json` 里**：

```json
{ "manifestUrl": "https://octo.hdesign.huawei.com/design/fastui-env/manifest.json" }
```

> 这是一次**显式取舍**，不是疏漏：原设计是由 `assemble.mjs --manifest-url=…` 注入一个 gitignore 的 `env.source.json`，好让外网仓不出现内网地址（[§8.4](fastui-vue-codegen-pipeline.md#84-内网同步单向)）。经确认现有代码仓已有多处内网地址，不值得为这一条单独引入一个"内网生成、外网看不到"的文件层次 —— 那会让外网仓的 skill 处于"缺一个文件所以跑不起来"的状态，调试成本高于它挡住的风险。
>
> 将来若要清理外网仓的内网地址，回到 `env.source.json` 方案即可，`ensure-env` 侧只需换一个读取来源，其余不变。

### 4.4.8 首装踩到的坑（内网实测，分两批：2026-09-07 / 09-08）

#### 第一批（2026-09-07，测试同学的 Windows 机器）

测试同学的 Windows 机器上跑通了，但过程磕了好几处。**根因链是一路连锁的**，记下来免得下次重演：

| 现象 | 根因 | 修法 |
|---|---|---|
| `install.ps1` 报一堆语法错误 | **PowerShell 5.1 读无 BOM 的 UTF-8 时按系统 ANSI（内网 GBK）解释**，脚本里 36 行中文注释被解成乱码字节，其中含引号/反引号，直接破坏语法 | 文件改存 **UTF-8 with BOM**，并在文件头写明这条约束，免得以后被"顺手清理" |
| `setup-env.mjs` 中途失败，`EINVAL` | **Node 18 起禁止直接 spawn `.cmd`/`.bat`**（命令注入防护 CVE-2024-27980），而共享池的 yarn 在 Windows 上就是 `yarn.cmd` | 改走 yarn 的 JS 入口：`<node> <node>/node_modules/yarn/bin/yarn.js`，两平台统一、不经 shell；找不到再回落 `shell: true` |
| 编译报 `Cannot find module '../../../package.json'`、`./src/index 找不到` | **模板复制中断**，根目录的 `package.json` 与 `src/` 下若干文件没复制过来。而复制失败后目录已存在，重跑会被当成"已有会话"跳过复制，**残缺状态被固化，永远修不好** | `new-session` 复制后自检 5 个关键文件；缺则**删掉半成品并响亮失败**，重跑即可自愈。已存在的目录同样过一遍自检 |

> **这三个坑的可怕之处在于表现形式全都离根因很远**：第 1 个报语法错误、第 2 个报 EINVAL、第 3 个报编译找不到模块 —— 没有一个指向"编码"、"cmd 不能 spawn"、"复制没做完"。所以修完之后更要紧的是**让失败发生在离根因近的地方**（自检、`doctor`），而不只是把这三处修好。

#### 第二批（2026-09-08，第一台真正没装过 node 的 macOS）

上一批修完之后，在**一台真正没装过 node 的 macOS** 上首装 —— 也就是 [§0.0](fastui-vue-codegen-pipeline.md#00-当前进度与待办改动后随手更新这一节)「验证覆盖缺口」里点名的那条路径 —— 又炸出四处。**这批的根因和上一批完全不同：上一批是编码与 API 限制，这批是「脚本跑在什么环境里」。**

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | agent 报 `manifest.json` **504**；同一地址浏览器能开，人在终端 `curl` 也是 200 | **agent 宿主进程注入了出外网的代理**（实测 `proxyhk.huawei.com:8080`）。`install.sh` 的 `curl` 裸跑、继承该环境 → 请求被送进 CONNECT 隧道 → 代理连不上内网上游 → **504 是代理自己发的**。⚠️ **`NO_PROXY` 里确实配了 `.huawei.com`，却没有生效** —— 那台机器的 curl 恰好是 **7.86.0**，高度可疑是它 noproxy 匹配重写引入的 tailmatch 回归（7.87.0 修回），**待验证**（下方命令）。另注：`~/.npmrc` 里那行 `noproxy=` 是 npm 的配置，管不到 curl，别把两者混为一谈 | 内网 host **强制直连**（sh 用 `--noproxy '*'`，ps1 换掉 `DefaultWebProxy`），逃生开关 `--proxy=<地址>` 并透传到 setup-env。**覆盖面不止 curl** —— npm / yarn 走的是另一条继承链，见下方坑 2b。**不做「失败自动回退走代理」** —— 那会用第二次的结果掩盖第一次失败的真实原因，日志里反而看不出发生了什么。而且代理是出外网用的、内网服务解析到 10.x 内网地址，「必须靠代理才能到内网」这种情况在本场景不成立 |
| 2a | agent 绕过脚本，改用**系统 npm** 全局装 yarn，撞 `/usr/local` 权限不足 | manifest 拉不到 → node 没进池子 → agent 自行发挥。**原设计（用池子 node 的 npm、prefix 落在池子里、不需要 sudo）是对的，它只是没被走到** | 修掉坑 1；SKILL.md 硬约束 0.1 明确禁止绕过脚本自行安装 |
| 2b | **另一次尝试里 node 已经在池子里**、`setup-env.mjs` 也跑到了，却卡在 `<池子>/node/bin/npm install -g yarn --registry=…` | **代理不只挡 curl。** npm / yarn 是 `run()` 拉起的子进程，`env: process.env` 把宿主注入的 `HTTP_PROXY` 原样传下去 —— 只堵 curl 的话，同一个 504 会在这一步原样复现，卡点只是从第 1 步挪到第 3 步 | `setup-env.mjs` 的 `childEnv()` 把代理变量整个摘掉（**不是设 `NO_PROXY=*`** —— 这次 504 的头号嫌疑正是 noproxy 没被正确解析，不该把修复建立在同一个假设上）；`--proxy` 透传给 setup-env |
| 3 | macOS 上 `POOL_YARN_JS: MISSING`，且**新版 `setup-env` 在 macOS 上首装必然失败** | 两个 bug 叠加：① `paths.mjs` 的 `yarnJs` 非 win32 分支猜的是 `node/lib/node_modules/…`，**实际在 `node/node_modules/…`**（win32 那条才对）→ 判断恒为 false → 必定走回落分支；② 回落分支是 `execFileSync(P.yarnBin, argv, { shell: true })`，而 `P.yarnBin` 必然含 `Application Support` 的空格，`shell: true` 时 Node 把 file 与 args 裸拼成命令字符串交给 shell、**不加引号**，路径在空格处被劈开 | 不再猜路径：`resolveYarnJs()` 先顺着 npm 自己建的 bin symlink 解析（并校验解出来的是 `.js` —— yarn 包里 `bin/` 下还躺着一个同名 shell 脚本），再挨个试已知布局；回落分支去掉 `shell: true`，Windows 上找不到 JS 入口改为响亮失败（`yarn.cmd` 本来就不能 spawn） |
| 4 | 同一台机器，`install.sh` 与 `install.sh --skip-node` 用**两个不同的 npm 源** | 读 manifest 的整块代码在 `if [ -n "$SKIP_NODE" ] … else` 的 else 分支里。走 skip 分支时 `REGISTRY` 一直是空，`--registry` 不传，于是落到机器 `~/.npmrc` 的默认源 —— **npm 源的取值挂在了"要不要下载 node"这个无关条件上** | `REGISTRY` 的读取提到 `if` 外面 |
| 5 | `-Proxy` 传了畸形地址时 `install.ps1` **裸崩**，打不出 `RESULT: FAIL` | `Fail` 函数定义在第 86 行，而 v14 第一版把 `-Proxy` 的错误处理加在了第 60 行 —— **PowerShell 的函数是执行到 `function` 语句时才注册的**（不像 C# 全文件预声明），定义在调用之后会抛 `CommandNotFoundException`，且在 `$ErrorActionPreference = "Stop"` 下直接裸崩。发生在人已经在排查代理、最需要清晰错误的时刻 | `Fail` 整块上移到 `$ProgressPreference` 之后，早于所有调用点；文件头写明这条约束。**零成本静态检查**：比较 `function Fail` 的行号与首次 `Fail "` 调用的行号 |
| 6 | 摘掉代理环境变量之后，`.npmrc` / `.yarnrc` 里的 `proxy=` 仍然生效，代理没被真正堵住 | **那一层优先级高于环境变量**，而 `npm_config_proxy=""`（v14 第一版的写法）**顶不掉** —— npm 10.9.4 实测：设成 `""` 后 `npm config get proxy` 仍返回 `.npmrc` 的值，设成 `"false"` 才生效。yarn 1 更麻烦：它根本不读 `npm_config_*`，CLI 传 `--proxy ""` 也会被当空参数忽略 | npm 那步用 `npm_config_proxy="false"`；yarn 那步往**共享池里那份 `deps/.yarnrc` 副本**末尾追加 `proxy ""` / `https-proxy ""`（`.yarnrc` 压得过 `.npmrc`）。只动我们自己的副本，不碰 template，更不碰用户的 `~/.yarnrc` |

**坑 1 的根因待验证一步**（内网那台 macOS 上跑，不需要真实代理凭据）：

```bash
# 用一个必定连不上的假代理，就能判断 curl 到底有没有"打算走代理"
U="https://octo.hdesign.huawei.com/design/fastui-env/manifest.json"
PX="http://127.0.0.1:9"
for NP in '.huawei.com' 'huawei.com' 'octo.hdesign.huawei.com' '*'; do
  printf '%-32s ' "NO_PROXY=$NP"
  env HTTPS_PROXY="$PX" https_proxy="$PX" NO_PROXY="$NP" no_proxy="$NP" \
    curl -k -s -o /dev/null -w 'http=%{http_code} exit=%{exitcode}\n' --max-time 20 "$U"
done
```

判读：`http=200` = `NO_PROXY` 生效、走了直连；`exit=7` = 没生效、curl 跑去连那个假代理了。
若只有 `.huawei.com` 一行是 `exit=7`，就坐实了 curl 7.86.0 的前导点 tailmatch 回归。

> **必须带上代理环境变量测。** `NO_PROXY` 只在存在代理时才起作用 —— 在一个没有 `HTTP_PROXY`
> 的终端里怎么设 `NO_PROXY` 都是直连、全 200，那种测法什么也证明不了（已经踩过一次）。

> **2a 与 2b 是两次不同尝试的两种失败形态，别当成一条。** 2026-09-07 的日志里两者都在：
> 06:32 / 06:55 的 `ensure-env` 报 `ENV_MISSING`（池子里没 node，对应 2a）；而 07:01 那条
> `YARN_INSTALL_FAILED: … <池子>/node/bin/npm install -g yarn` 用的是**池子里的 npm** ——
> 说明那次 node 已经装好了，失败发生在 npm 这一步（对应 2b）。写成「坑 1 导致 setup-env
> 根本没机会执行」是不对的，v14 第一版这么写过，被 review 抓出来。

> **坑 3 是上一批修坑 2 时引入的。** 旧版 `run(P.yarnBin, ["install"], …)` 直接 `execFileSync` 绝对路径、不经 shell，空格从来不是问题；换成"优先 JS 入口 + shell 回落"之后，macOS 因为路径猜错**必定**走进那个坏回落。修一个平台的问题时顺手加的回落分支，把另一个平台变成了必挂 —— **这类改动以后两个平台都要实测**。
>
> 这颗雷当时没响，是因为设计师那台跑的是修复前的旧版（skill 是手工下载到 `~/Downloads/` 的一份，不会自动更新）。

> **坑 1 给方法论的教训**：`doctor` 这次不但没帮上忙，还给出了误导性的 `MANIFEST_HTTP_STATUS: 200` —— 因为人是在**终端**跑的它，而问题只存在于 **agent 进程**。诊断工具跑错环境，比没有诊断工具更糟。订正见 §4.4.9。

### 4.4.9 `doctor.mjs` —— 装不上时先跑它

**必须由 agent 在它自己的进程里跑，不能让人去终端跑**（2026-09-08 订正）。

理由是上面第二批坑 1：代理这类问题**只存在于 agent 宿主进程的环境里**。人在终端跑 doctor 会得到一个看起来一切正常的假象 —— 实测拿到 `MANIFEST_HTTP_STATUS: 200`，而 agent 在同一台机器上同时报 504。doctor 的价值前提是"和失败发生在同一个环境"，**跑错环境比不跑更糟**：它把排查方向直接带偏了一轮。

```bash
# 由 agent 调用，不要转述给人去终端执行
node <skill>/scripts/doctor.mjs
```

必须打印（v14 补齐）：

| 组 | 字段 |
|---|---|
| **进程环境** | 平台 / node 版本；**本进程看到的** `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY`（含小写共六个）。一个都没有时也要显式打一行 `PROXY: (无)` —— 否则分不清"没有代理"和"没查代理" |
| **网络 ×4** | `manifest` 与 `node 包 HEAD`，各测**直连**与**走代理**两种走法。四种组合都打 HTTP 状态、耗时、响应体前 120 字节 |
| 共享池 | node / yarn / deps / lockfile / `env.lock.json`。⚠️ `POOL_YARN_JS` 的值域已从 `OK/MISSING` 改为**「解析出的绝对路径」/ MISSING** —— 只说 MISSING 而不说去哪找的、找到了什么，正是 2026-09-08 白花一轮才发现路径猜错的原因（§4.4.8 第二批坑 3） |
| 系统 | 系统 node / yarn / npm |

网络那四格是这次事故的直接产物：只测 manifest 一种走法，既分不出"网络不通"和"代理挡了"，也答不了"node 包（50MB）能不能下下来"——manifest 才 799 字节，它通不代表大文件通（§4.4.4 要求核对 `Content-Length`，一直没做过）。

现有两个洞，一并修：

- **504 时打不出响应体**：`MANIFEST_HEAD` 困在 `if (res.ok)` 分支里，而网关错误页恰恰只在非 2xx 时才有 —— body 预览要挪到 `res.ok` 外面
- **证书放行是无效的**：传的是 `agent: new Agent({ rejectUnauthorized: false })`，而 Node 的 `fetch`（undici）只认 `dispatcher`，`agent` 被静默忽略。**doctor 实际在严格校验证书**，与 `install.sh` 的 `curl -k` 并不等价 —— 要么改 `dispatcher`，要么显式打一行 `TLS_VERIFY: ON/OFF`。不能让读的人以为已放行

存在的理由：内网出问题时人只能截图（[§8.4](fastui-vue-codegen-pipeline.md#84-内网同步单向)），而"装不上"背后有十几种可能，挨个手工试要来回好几轮。输出每行自解释，**截图发出来就够定位**，不需要再补充上下文。

### 4.4.7 你在内网要做的事，按顺序

**首次搭建（一次性）**

1. 在 `/design` 下建目录 `fastui-env/node/`（无需改 nginx，见 §4.4.4）
2. 从内网 node 镜像下载 §4.4.2 的 2~3 个包，放进 `fastui-env/node/`
3. 抄/算 sha256（§4.4.3）
4. 按 §4.4.5 写 `manifest.json`，放进 `fastui-env/`
5. 按 §4.4.4 的自检命令确认 manifest 和资源都能拉到
6. 在内网跑 `assemble.mjs --template=<脚手架模板> --vendor=<三份组件 skill>`
7. 把 assemble 产出的 skill 包按技能库的上架流程上架
8. 在一台**干净的**设计师机器上调一次 skill，全程观察是否零人工介入（[§9.2](fastui-vue-codegen-pipeline.md#92-内网验证) 阶段 1）

**fastui 发新版后的升级（每次）**

1. 更新脚手架模板的 `package.json` → 在内网维护机上 `yarn install` → 得到新 `yarn.lock`
2. 产出新的 `env.lock.json`（新 `envVersion` + 新 `lockfileHash`），写 env CHANGELOG
3. 跑 `assemble.mjs`（带上新 template）→ 上架新版 skill 包
4. **服务器上什么都不用改**（node 没变、template 随 skill 包走）
5. 设计师端下次调 skill 时 `ensure-env` 检出 `lockfileHash` 不匹配 → agent 自动跑 `install --upgrade` → 共享池增量 `yarn install` → 校验 hash → 继续

**只有 node 版本要换时**，才动 nginx：换包、更新 sha256 与 `version`、改 manifest —— 这是数月一次的事。
