# 环境变量与多环境构建机制

## 包结构与构建关系

```
packages/app/       — UI 业务代码（SolidJS），可独立出 web 产物
packages/desktop/   — Electron 壳，renderer 层 import @opencode-ai/app
```

- `packages/app/src/` — 对外导出的库入口（`@opencode-ai/app`）
- `packages/app/octoapp/` — web 构建的页面入口（`vite.config.ts` 用）
- desktop renderer 走 `packages/app/src/`，与 `octoapp/` 无关

**结论：我们只发 Electron 产物，`.env` 文件只需维护 `packages/desktop/`。**

---

## 文件与命令对应关系

不依赖 Vite 默认的 `development`/`production` mode 名，改用显式自定义 mode，命令即文档：

| 命令 | 加载的文件 | OCTO_CHANNEL |
|------|-----------|-------------|
| `bun run dev` | `.env` + `.env.local` | dev（默认） |
| `bun run build` | `.env` + `.env.local` | dev（默认） |
| `bun run dev:beta` | `.env` + `.env.beta` + `.env.local` | beta |
| `bun run build:beta` | `.env` + `.env.beta` + `.env.local` | beta |
| `bun run dev:prod` | `.env` + `.env.prod` + `.env.local` | prod |
| `bun run build:prod` | `.env` + `.env.prod` + `.env.local` | prod |

优先级（高→低）：`.env.local` > `.env.beta/.env.prod` > `.env`

---

## 仓库提交规则

| 仓库 | 规则 |
|------|------|
| 外网仓库（GitHub） | 禁止提交任何 `.env*` 文件；只提交 `.env.example` 作为文档 |
| 内网仓库 | 提交 `.env`，配置公共域名，团队 clone 后直接可用 |

`.gitignore` 规则：`.env` 和 `.env.*` 全部忽略，`!.env.example` 白名单放行。

### 文件约定（`packages/desktop/`）

| 文件 | 外网 git | 内网 git | 说明 |
|------|---------|---------|------|
| `.env.example` | ✅ | ✅ | 文档模板，占位符 |
| `.env` | ❌ | ✅ | 公共域名，所有命令的基础值 |
| `.env.local` | ❌ | ❌ | 个人临时覆盖（可选） |
| `.env.beta` | ❌ | ❌ | beta 环境专属域名 |
| `.env.prod` | ❌ | ❌ | prod 环境专属域名 |

---

## 构建 / 打包命令

> ⚠️ 早期用 `OCTO_CHANNEL=x cmd` 的 shell 内联注入，在 Windows 上不生效（打出 dev 包）。现已统一改用 **cross-env** 跨平台注入。完整的方案对比、踩坑与决策见 [build-channel-injection.md](build-channel-injection.md)。

```json
"dev":        "electron-vite dev",
"dev:beta":   "cross-env OCTO_CHANNEL=beta bun run dev   --mode beta",
"dev:prod":   "cross-env OCTO_CHANNEL=prod bun run dev   --mode prod",
"build":      "electron-vite build",
"build:beta": "cross-env OCTO_CHANNEL=beta bun run build --mode beta",
"build:prod": "cross-env OCTO_CHANNEL=prod bun run build --mode prod",

"package:dev":  "cross-env OCTO_CHANNEL=dev  electron-builder --config electron-builder.config.ts",
"package:beta": "cross-env OCTO_CHANNEL=beta electron-builder --config electron-builder.config.ts",
"package:prod": "cross-env OCTO_CHANNEL=prod electron-builder --config electron-builder.config.ts",

"release:win":       "bun scripts/release.ts --win",
"release:mac-arm64": "bun scripts/release.ts --mac --arm64",
"release:mac-x64":   "bun scripts/release.ts --mac --x64"
```

- **build / package 两步**：构建产物（`build*`）与打成安装包（`package*`）分两步，一直如此；`release:*` 只是把两步串起来并锁定同一 channel（`scripts/release.ts`）。
- **平台/架构当尾部 flag 传**：`bun run package:prod --win` / `--mac --arm64`，避免「渠道 × 平台 × 架构」脚本数膨胀。

## channel 与 VITE_ 是两套机制

- **channel（`OCTO_CHANNEL`）**：由命令用 **cross-env 强制注入**（跨平台），被 prebuild/predev、electron-vite、electron-builder 四处共享。**不写进任何 `.env` 文件**，纯由命令决定。
- **`VITE_*` 业务域名**：由 `--mode` 触发 electron-vite 的 `loadEnv` 从 `.env.<mode>` 加载。

两条关键：`--mode` 只切 `.env.<mode>` 的加载，**不等于**设了 `OCTO_CHANNEL`；`build:prod` 套 `bun run build` 是为了触发 `prebuild` 钩子（钩子只认精确脚本名）。细节见 [build-channel-injection.md](build-channel-injection.md) 的踩坑实录。

---

## 各环境变量说明

| 变量 | 位置 | 说明 |
|------|------|------|
| `VITE_OCTO_BASE_URL` | renderer | 通用接口 base URL |
| `VITE_OCTO_REPORT_BASE_URL` | renderer | 打点/上报接口 base URL |
| `VITE_OCTO_UPLOAD_ENDPOINT` | renderer | Insight S3 上传端点（空则降级） |
| `VITE_SENTRY_DSN` | renderer | Sentry DSN |
| `OCTO_CHANNEL` | 构建配置 + main | 渠道，shell 注入 |
| `SENTRY_AUTH_TOKEN/ORG/PROJECT` | 构建配置 | sourcemap 上传，CI 用 |
