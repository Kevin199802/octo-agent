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

## 构建命令

```json
"dev":        "electron-vite dev",
"dev:beta":   "OCTO_CHANNEL=beta electron-vite dev --mode beta",
"dev:prod":   "OCTO_CHANNEL=prod electron-vite dev --mode prod",
"build":      "electron-vite build",
"build:beta": "OCTO_CHANNEL=beta electron-vite build --mode beta",
"build:prod": "OCTO_CHANNEL=prod electron-vite build --mode prod"
```

## 为什么 `OCTO_CHANNEL` 要走 shell 变量

`prebuild.ts` 读取 `Bun.env.OCTO_CHANNEL`，它在 Vite 启动前执行，感知不到 `--mode` 对应的 `.env` 文件。`electron.vite.config.ts` 同理（`process.env.OCTO_CHANNEL`）。

`OCTO_CHANNEL` 通过 shell 内联注入，`VITE_*` 渲染层变量通过 `.env.[mode]` 文件加载——两套机制并存，各司其职。

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
