# `.env` 业务值反向盖过 `.env.prod` —— release 路径下 bun 自动加载 + loadEnv 优先级的坑

> 事故复盘 + 机制深挖。症状:内网用 `bun run release:win` 打 **prod** 包,产物却连 **beta** 的 MCP 地址(`7.192`),而手动分两步 `build:prod` + `package:prod` 打出来是对的(`7.185`)。
>
> 这与 [build-channel-injection.md](build-channel-injection.md) 的「坑 4:bun 自动加载 `.env` 污染渠道」是**同一机制的另一面**——那篇讲的是 `OCTO_CHANNEL` 被污染,本篇讲**业务地址变量**(`VITE_OCTO_*` / `OCTO_UXR_MCP_URL`)被污染,且新增了「`release.ts` 路径 vs 手动 `build:prod` 为何结果不同」这个关键分叉。配套速查见 [env-vars-and-build-modes.md](env-vars-and-build-modes.md)。

---

## 一句话

`bun` 直接执行文件(如 `release.ts`)时会**自动把 `.env` 灌进 `process.env`**;而 `loadEnv(mode, dir, "")` 的真实优先级是 **`process.env` > `.env.<mode>` > `.env`**。两者叠加 → `.env` 里的业务值经 `process.env` **反向盖过** `.env.prod`,prod 包连到了 `.env` 里的 beta 地址。**手动 `bun run build:prod` 不触发**这条污染,所以两种打法结果不同、极难定位。

---

## 症状

| 打法 | MCP 地址 | 对不对 |
|---|---|---|
| `bun --cwd packages/desktop run release:win` | `http://7.192…`(beta) | ✗ |
| 手动 `bun run build:prod` 然后 `bun run package:prod --win` | `http://7.185…`(prod) | ✓ |

更迷惑的是:同一次 release 产物里,**打点域名(`VITE_OCTO_REPORT_BASE_URL`)是对的(生产)**,只有 MCP / 上传(`OCTO_UXR_MCP_URL` / `VITE_OCTO_UPLOAD_ENDPOINT`)是 beta。一度怀疑「不同变量走不同注入路径」「`.env` 优先级莫名比 `.env.prod` 高」,其实都不是。

---

## 三条关键机制(缺一不可)

### 1. `loadEnv` 把 `process.env` 排在文件之上

`electron.vite.config.ts` 里:

```ts
const env = loadEnv(mode, process.cwd(), "")   // ← 空 prefix
```

vite 的 `loadEnv(mode, dir, prefixes)`:先读 `.env` / `.env.<mode>` 文件,**再把 `process.env` 里匹配 prefix 的变量合并进去并覆盖文件值**。空 prefix(`""`)= 匹配**所有** key,于是**整个 `process.env` 都凌驾于 `.env.<mode>` 文件之上**。

优先级实测(本机 vite 7.x):

```
process.env  >  .env.<mode>  >  .env
```

> ⚠ 这跟很多人记的「`.env.<mode>` > `.env`,文件说了算」不一样。一旦某个 key 在 `process.env` 里有值,文件里写什么都没用。

### 2. bun 直接执行文件时,自动加载 `.env` 进 `process.env`

`bun scripts/release.ts`(以及 `bun -e`、`bun <file>`)启动时,bun runtime 会**自动读 cwd 的 `.env` 灌进 `process.env`**(但**不**自动读 `.env.beta`/`.env.prod`,那是 vite `--mode` 的事)。

实测:在含 `.env`(`OCTO_UXR_MCP_URL=7.192`)的目录跑

```sh
bun -e 'console.log(process.env.OCTO_UXR_MCP_URL)'   # → http://7.192…
```

### 3. `release.ts` 用 Bun `$` 起子进程,继承被污染的 `process.env`

```ts
// scripts/release.ts(节选)
await $`bun run ${buildScript}`   // buildScript = "build:prod"
```

`release.ts` 进程的 `process.env` 已被机制 2 灌入 `.env` 的 `7.192`;Bun `$` 默认把父 `process.env` 传给子进程 → `build:prod` 的 electron-vite 进程也带着 `7.192` → 机制 1 让它盖过 `.env.prod` 的 `7.185`。

---

## 为什么手动 `build:prod` 不中招(关键分叉)

| 路径 | `.env` 是否进了最内层 electron-vite 的 `process.env` | 结果 |
|---|---|---|
| `bun scripts/release.ts`(`bun <file>`) | **是**——机制 2 灌入 release.ts,经 `$` 传子进程 | `.env` 盖过 `.env.prod` ✗ |
| `bun run build:prod`(`bun run <script>`) | **否**——`bun run` 执行 npm script 这条路径不把 `.env` 驻留到最内层进程 | 用 `.env.prod` ✓ |

> 同一台机器、同样 `electron-vite build --mode prod`、`mode` 都是 `prod`(可加日志确认)——唯一差别就是**外层是 `bun <file>` 还是 `bun run <script>`**。这是定位的最大难点:两种打法表现相反,而表面命令几乎一样。

## 为什么 REPORT 没暴露、MCP/UPLOAD 暴露

不是机制差异,是**值差异**:

- `.env` 和 `.env.prod` 里 `VITE_OCTO_REPORT_BASE_URL` **都是生产域名** → 盖不盖都对,问题被掩盖
- `.env` 里 `OCTO_UXR_MCP_URL` = beta(`7.192`)、`.env.prod` = prod(`7.185`)→ 反向覆盖暴露
- `VITE_OCTO_UPLOAD_ENDPOINT` 同 MCP

**只要 `.env` 和 `.env.<mode>` 某个 key 取值不同,这个坑就显形。** 取值恰好相同会一直潜伏。

---

## 实证(可复现)

```sh
# 临时目录,.env=beta、.env.prod=prod
printf 'OCTO_UXR_MCP_URL=http://7.192.beta/mcp\n'  > .env
printf 'OCTO_UXR_MCP_URL=http://7.185.prod/mcp\n'  > .env.prod

# C) bun 直接执行文件自动加载 .env
bun -e 'console.log(process.env.OCTO_UXR_MCP_URL)'
#   → http://7.192.beta/mcp        (机制 2)

# A) loadEnv("prod") 即使 env -i 清空,bun 又把 .env 灌回 process.env → 取 .env
env -i bun loadenv.mjs            # loadEnv("prod", cwd, "")
#   → http://7.192.beta/mcp        (机制 1+2:process.env 盖过 .env.prod)

# B) 显式 process.env 优先级最高(盖过所有文件)
OCTO_UXR_MCP_URL=http://7.192.x/mcp env -i bun loadenv.mjs
#   → http://7.192.x/mcp           (机制 1)

# D) 解药:.env 不含该 key → 正确回落 .env.prod
printf 'VITE_OCTO_REPORT_BASE_URL=https://prod\n' > .env   # .env 不放 MCP
env -i bun loadenv.mjs
#   → http://7.185.prod/mcp        ✓
```

---

## 解法

### 1. 约束:环境专属业务值只放 `.env.beta` / `.env.prod`

`.env`(无后缀)/ `.env.local` **只放「所有环境都相同」的通用项**,不放 beta/prod 会不同的业务地址(`VITE_OCTO_*` / `OCTO_UXR_MCP_URL` 等)。这样 `.env` 里压根没有这些 key,机制 2 自然灌不进 `process.env`,`.env.<mode>` 正常生效。

> 注意这跟 [build-channel-injection.md](build-channel-injection.md) 早期「`.env.*` 只留 `VITE_*`」的说法要一起修正:**业务值也不能依赖 `.env` 兜底**——凡是分环境的,一律进 `.env.<mode>`。已同步进 `packages/desktop/.env.example` 注释。

### 2. 可观测:`[octo:env]` 构建/启动日志

`electron.vite.config.ts` 的 `loadEnv` 之后打印**最终生效值**(以 `.env.example` 声明的业务 key 为清单,逐个打 `env[k]`,未配标 `(未设置)`):

```
[octo:env] ┌─ effective env  mode=prod  channel=prod  command=build  (5 keys)
[octo:env] │  OCTO_UXR_MCP_URL=http://7.185.124.41:8005/mcp
[octo:env] │  ...
[octo:env] └─ 值=process.env > .env.<mode> > .env 覆盖后的最终生效;清单来自 .env.example
```

要点:

- 打的是 `loadEnv` 结果(已含 `process.env` 覆盖)= **真正注入构建的值**,不必猜哪个文件赢。这次的 beta/prod 差异,有这行一眼可见。
- **build 直接打**;**dev 经 `configureServer` 在 dev server `listening` 后打**——否则 vite dev 启动的 clearScreen 会把早期 console 刷掉(这也是「dev 看不到日志」的原因)。
- 只筛 `OCTO_*`/`VITE_*`,不打整个 `process.env`(几百个系统变量 + 密钥会刷屏 / 泄漏)。
- 客户端 DevTools 看不到;它在 **electron-vite 进程的终端 / 构建日志**里。

### 3. (可选)根治方向

若要让 `.env` 能放分环境默认而不被污染,可在 `release.ts` 起 build 子进程前从 `env` 剔除会被文件覆盖的业务 key,或把 `loadEnv` 的空 prefix 收窄。本次未做(约束 1 + 日志 2 已够),留作后续。

---

## 排查清单(下次再遇到「打包连错环境」)

1. 先看构建终端的 `[octo:env]`——直接是不是想要的值?省去一切猜测。
2. 对比 `bun run build:prod`(手动)vs `release:*`——若手动对、release 错 → 几乎必是本坑(`bun <file>` 自动加载 `.env` 污染)。
3. 查 `packages/desktop/.env`(无后缀)有没有混进分环境的业务 key——有就是元凶,挪去 `.env.<mode>`。
4. 记住优先级:`process.env` > `.env.<mode>` > `.env`,且 `bun <file>` 会把 `.env` 抬进 `process.env`。

---

## 相关

- [build-channel-injection.md](build-channel-injection.md) — 同机制在 `OCTO_CHANNEL` 上的表现(坑 4/5)、四消费者 + cross-env 决策
- [env-vars-and-build-modes.md](env-vars-and-build-modes.md) — 命令/文件对应表、提交规则(速查)
- [mcp-proxy-and-connection.md](mcp-proxy-and-connection.md) — `uxr-tool` MCP 地址 / proxy
- 代码:`packages/desktop/electron.vite.config.ts`(`[octo:env]` + `loadEnv`)、`packages/desktop/scripts/release.ts`、`packages/desktop/.env.example`、`packages/opencode/src/config/builtin-mcp.ts`(MCP 默认值)
