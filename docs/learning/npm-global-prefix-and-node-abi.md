# npm 全局安装落点 与 node 大版本兼容性 —— 两个被当成架构约束的误解

> 起因：SPEC-DES-001（fastui skill）从 v1 起写着一句话 ——
> 「`npm i -g yarn` 在 portable node 下不需要 sudo，**这是必须用 portable node 而非系统 node 的核心原因之一**」。
> 于是内网每台机器首装都得先下 50MB 的 portable node，而那条链路已经 504 过（代理）、403 过（WAF），
> 首装卡死在第一步的事故记了两批。
>
> 2026-09-11 实测后推翻：**决定要不要 sudo 的是 global prefix 落在哪，跟 node 是不是 portable 无关。**
> 一个 `--prefix` 参数就能定的事，被写成了架构约束。这份笔记记两件底层机制（全局落点、ABI），
> 以及这类"把绕开某问题的手段固化成前提"的识别方法。

---

## 一句话

`npm -g` 装到哪、要不要 sudo，由 **prefix** 单独决定（`--prefix` 可以现场改）；
一个包换 node 大版本会不会挂，由它有没有 **原生 ABI 绑定** 决定（N-API 的不绑）。
这两件事都跟"node 是官方安装包还是解压出来的 portable 包"**毫无关系** —— 那只是个默认值差异。

---

## 1. `npm -g` 的落点：prefix 决定一切

```bash
npm config get prefix           # 当前 prefix
npm i -g <pkg> --prefix=<dir>   # 本次改掉,不动任何配置
```

`sudo` 的来源只有一个：**prefix 指向了当前用户写不了的目录**。

| node 从哪来 | 默认 prefix | 要不要 sudo |
|---|---|---|
| macOS 官方 pkg / Linux 包管理器 | `/usr/local` | **要** —— 这就是"装全局包要 sudo"这个印象的来源 |
| homebrew / nvm / fnm / volta | 各自在用户目录下的前缀 | 不要 |
| 解压出来的 portable 包 | 它自己那个目录 | 不要（除非解压到了系统目录） |
| **任意 node + `--prefix=<用户目录>`** | 你给的那个 | **不要** ← 本篇的结论 |

所以"portable node 不需要 sudo"是对的，但它是**默认 prefix 恰好落在用户目录**的副产品，
不是 portable 这个形态的性质。要的是"prefix 在用户目录"，那是可以直接要的。

> **为什么这件事在 agent 里特别重要**：agent 进程里执行 `sudo` 会静默挂住等密码 ——
> 没有 tty、没有交互通道，表现是"卡住不动"，日志里什么都没有。所以「绝不触发 sudo」是硬约束，
> 只不过实现它的手段不止一种。

### 1.1 落点的目录结构：**两种布局，不要猜**

装完之后包体和可执行入口各在哪，**随平台与 npm 版本变**：

```
Unix 常见:   <prefix>/bin/yarn          → 符号链接
             <prefix>/lib/node_modules/yarn/bin/yarn.js
Windows:     <prefix>\yarn.cmd          → 批处理 shim
             <prefix>\node_modules\yarn\bin\yarn.js
```

两条实测记录，正好互相打脸，说明为什么不能按惯例硬编码：

- 2026-09-11（本地 macOS，fnm 的 node 22 + `--prefix=<自定义目录>`）：落 `<prefix>/lib/node_modules/`
- 2026-09-08（内网 macOS，portable node 包，prefix = node 自己的目录）：落 `<prefix>/node_modules/`，**没有 `lib/`**

当时的代码按 Unix 惯例只猜了 `lib/node_modules`，判断恒为 false → 走进一条带 `shell: true` 的回落分支
→ 路径里的 `Application Support` 在空格处被劈成两半 → **macOS 首装必挂**。两个 bug 叠在一起，
离根因极远（SPEC-DES-001 §4.4.8 第二批坑 3）。

**正确做法是问真相、不是猜布局**：先顺着 npm 自己建的 bin 链接 `readlink` 走过去（唯一不依赖布局假设的路径），
再挨个试已知布局。实现见 `skills/fastui-vue-creator/scripts/lib/paths.mjs` 的 `resolveYarnJs` / `resolveNpmJs`。

两个配套坑：

- **链接目标要校验是 `.js`**：yarn 1.x 的包里 `bin/` 下同时躺着 `yarn.js` 和一个同名 shell 脚本 `yarn`，
  指到后者时 `node <shell 脚本>` 会以语法错误的形态炸，离根因极远。
- **Windows 上不能直接 spawn `.cmd` / `.bat`**：Node 18 起出于命令注入防护（CVE-2024-27980）禁止，报 `EINVAL`。
  所以一律 `node <那个 .js 入口>`，两平台统一。npm 自己也一样 —— 要跑 npm 就跑 `node <npm-cli.js>`。

### 1.2 一个会静默抢走落点的东西：`~/.npmrc` 的 `prefix=`

CLI 的 `--prefix` 优先级最高，但机器上若有 `prefix=` 之类的全局配置，行为差异会以
「npm 退出码 0，可是东西不在你以为的地方」这种形态出现。**判据是装完立刻断言落点存在**，
不对就响亮失败（`npm config list` 是下一步要的东西），别让它拖到后面变成"找不到 yarn 的入口"。

---

## 2. node 大版本：什么会挂，什么不会

换 node 大版本会真的炸的东西，只有三类：

| 类别 | 为什么 | 怎么查 |
|---|---|---|
| **绑 ABI 的原生模块**（用 NAN / 直接用 V8 API 编的 `.node`） | node 每个大版本 `NODE_MODULE_VERSION` 都变，加载时直接报 `was compiled against a different Node.js version` | `find . -name '*.node'`，再看它是不是 N-API |
| 依赖 node 内部行为的老构建工具 | 典型：webpack 4 的 md4 哈希在 node 17+（OpenSSL 3）直接抛 `ERR_OSSL_EVP_UNSUPPORTED` | 只能在那个大版本上真跑一次 |
| 用到被删除 API 的老包 | 大版本才会删 API | 同上 |

**N-API（node-api）是例外**：它是稳定的 C ABI，编一次跨大版本可用 —— 这是它存在的全部意义。
所以"有 `.node` 文件"不等于"绑 node 版本"，还要看是哪种。

fastui 这棵依赖树的实测结论：绑 ABI 的原生模块**只有 `fsevents` 一个**（内网 `find` 只有它），
而它是 macOS 专有的 optional dependency + N-API，**加载失败时 chokidar 自己回落到轮询**，
只是文件监听变慢，不会炸。于是这棵树对 node 小版本完全不敏感，判据放宽到"大版本相同"是有依据的，
不是"差不多应该行"。

### 2.1 但放宽**不等于不设限**：用白名单，别用「≥ 某个下限」

上面第 2、3 类风险都只在**没验过的新大版本**上出现，而 `>=` 写法会把"未来所有版本"一并放行。
所以判据写成**白名单**（fastui 的 `references/env.manifest.json` → `systemNodeMajors`，当前 `[18,20,22]`）：
命中就复用，命不中就退回下载我们自己定版的那个 node —— **那条路永远是对的，只是慢**。
放开一个新大版本的成本是"在那个版本上真跑一次编译"，不是改一个比较符号。

### 2.2 版本别拿来当依赖树一致性的代理指标

顺带钉一句，这两件事常被混：

| 要保证什么 | 靠什么 | 不靠什么 |
|---|---|---|
| 依赖树跟设计师机器上是同一棵 | `yarn.lock` 的 hash 比对（跨 skill 与共享池边界比） | **不靠 node 版本** |
| 运行时能跑起来 | node 大版本命中白名单 | 不靠 lockfile |

所以放宽 node 判据的同时，`lockfileHash` 那道门禁一个字都不能动 —— 它们管的根本不是一件事。

---

## 3. 方法论：怎么认出"被固化成前提的手段"

这次被推翻的那句话，结构是：

```
要躲 A（agent 里不能触发 sudo）  ← 真的,今天依然成立
手段 B（用 portable node）恰好能躲开 A
→ 写进 spec 时变成「必须 B」     ← 这一跳是错的
```

B 的成本（每台机器 50MB 下载 + 一条会被代理和 WAF 拦的链路）比 A 本身大得多，
而 A 还有更便宜的手段（传 `--prefix`）。识别办法是对着结论问一句：

> **"到底是什么**迫使**必须这样？"** —— 答案必须是一个机制，而不是"我们现在就是这么做的"。

答不出机制、只能答出"这样确实能避开某个问题"，那它就是**手段**，应该写在"为什么这么实现"里，
不该写成架构约束。约束会被后来的人当成不可动的地基，在上面继续加东西（这里加的是整条 manifest +
nginx 托管 + sha256 校验链路，都还在，只是降级成兜底了）。

两条顺带的经验：

- **"已经有用户在违反这条约束的情况下跑通过"是很强的信号。** 这次就是 —— 有人在 node 版本
  与清单不一致的机器上跑完了全流程，那句"必须精确相等"其实早就被现实否掉了，只是没人回头看 spec。
- **取消一个依赖，要取消干净才有收益。** 这次除了不下载 node，还必须**不去读 manifest**
  （registry 改从本机 template 的 `.npmrc` 回落取）—— 否则"绕开曾经 504 的那条链路"只绕开了一半，
  仍然会在同一个网关上卡住。顺带 `python3` 也从 macOS 的硬门槛降为"只有要解析 manifest 时才需要"
  （本地 JSON 有 node 就用 node 解析）。

---

## 相关

- [bash-err-trap-and-set-e.md](bash-err-trap-and-set-e.md) —— 同一批脚本的另一组静默失效规则
- SPEC-DES-001 §4.1（`docs/specs/design/fastui-vue-codegen-pipeline.md`）—— 本篇结论的落点与 v16 修订记录
- `docs/fastui-debugging.md` §4.6 —— "装完了但日志里没有下载记录"该怎么判
