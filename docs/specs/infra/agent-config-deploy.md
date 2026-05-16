# Spec: Agent 配置部署机制

> 决策见 [ADR-008](../../adr/008-cascading-config.md)，概念背景见 [agent-deploy.md](../../learning/agent-deploy.md)。  
> 本 spec 是实现的唯一真相来源。

---

## 0. 业界 agent frontmatter schema 对照（调研事实）

**调研时间**：2026-05-16

### 0.1 opencode 上游（我们 fork 自此）

源：[packages/opencode/src/config/agent.ts:16-50](../../../packages/opencode/src/config/agent.ts#L16-L50)，YAML frontmatter 用 `gray-matter` 解析。

| 字段 | 类型 | 备注 |
|---|---|---|
| `name` | string | 通常从文件名派生 |
| `description` | string | agent 用途说明 |
| `mode` | enum | `subagent` / `primary` / `all` |
| `prompt` | string | body 自动注入此字段 |
| `tools` | `Record<string, boolean>` | **⚠️ @deprecated，迁移到 permission** |
| `permission` | Ruleset | 工具权限规则（替代 tools） |
| `model` | `{providerID, modelID}` | 模型选择 |
| `variant` / `temperature` / `top_p` / `options` | — | 模型行为 |
| `color` / `hidden` | — | UI 元数据 |
| `steps` | int | 最大 agentic 步数 |
| `disable` | boolean | 禁用此 agent |

**关键事实**：
- ❌ **不支持 `mcp` 字段** — 上游不内置 per-agent MCP 绑定
- ❌ **不支持 `skills` 字段** — 上游无 skills 概念
- ⚠️ `tools` deprecated，应迁移到 `permission`

### 0.2 Claude Code agents（业界另一参照）

源：[Claude Code 官方文档 subagents](https://code.claude.com/docs/en/subagents.md#supported-frontmatter-fields)

支持字段：`name` `description` `tools` `disallowedTools` `model` `permissionMode` `mcpServers` `skills` `hooks` `maxTurns` `memory` `background` `effort` `isolation` `color` `initialPrompt`

**关键差异**：
- ✅ 支持 `mcpServers`（数组或内联定义）
- ✅ 支持 `skills`（列表）

### 0.3 内网 octoAI fork

agent 定义硬编码在 `packages/opencode/src/agent/agent.ts` 中（非 .md frontmatter），含 `mcp: ["uxr-tool"]` 和 `skills: ["interview-analysis"]` 字段 —— 这两个字段是**他们 fork 自加的扩展**，上游 opencode 没有。

### 0.4 结论

| 维度 | 业界基准（opencode 上游）| 我们应该 |
|---|---|---|
| Agent SOT | `.md` frontmatter + body | 跟上游一致 |
| `mcp` per-agent 字段 | 不支持 | **不加**——保持跨 fork 可移植 |
| `skills` per-agent 字段 | 不支持 | **不加**——同上 |
| `tools` vs `permission` | tools deprecated | **迁移到 permission** |
| 配置文件双写 agent 字段 | 可选，但 `.md` 已足够 | **default-config.json 不重复声明** |

**内网团队的 mcp/skills 字段是他们 fork 内部决定，由他们自家维护**（agent.ts 硬编码或加私有 frontmatter 扩展 + loader）。我方 frontmatter 保持上游对齐。

---

## 1. 设计目标

- **改一处源文件，重启 main 进程即生效**（dev 与 production 行为一致）
- **用户文件 (`~/.config/octo/octo.json`) 仅含用户机密 + 偏好**，我们永不写
- **产品升级**（改 prompt、加工具、改 MCP URL）不污染用户文件
- **零 CONFIG_VERSION 维护**

---

## 2. 字段归类（A / B / C）

| 字段路径 | 类别 | 写在哪 | 升级行为 |
|---|---|---|---|
| `default_agent` | A | `default-config.json` | 每次启动从 bundle 读 |
| `agent.<name>.mode` | A | `default-config.json` | 同上 |
| `agent.<name>.description` | A | `default-config.json` | 同上 |
| `agent.<name>.tools` | A | `default-config.json` | 同上 |
| `agent.<name>.prompt` | A | `agents/<name>.md`（启动时注入） | 同上 |
| `mcp.<name>.type` | A | `default-config.json` | 同上 |
| `mcp.<name>.url` | A | `default-config.json` | 同上 |
| `mcp.<name>.timeout` | A | `default-config.json` | 同上 |
| `mcp.<name>.headers.Authorization` | **B** | 用户文件 | 用户填，永不覆盖 |
| `provider.<name>.options.apiKey` | **B** | 用户文件 | 用户填，永不覆盖 |
| `model` | **C** | 用户文件（缺省时 fallback default-config.json 里的建议） | 用户改，永不覆盖 |
| `provider.<name>.options.baseURL` | **C** | 用户文件（缺省时使用 default-config.json 建议） | 用户改，永不覆盖 |

---

## 3. 文件布局

```
仓库内（合入物）
├── packages/agent/insight/agents/insight.md          ← A 源（系统提示词）
└── packages/desktop-electron/resources/
    └── default-config.json                            ← A 源（agent 结构 + MCP）

打包后（Octo Agent.app/Contents/Resources/）
├── agents/
│   └── insight.md                                     ← extraResources 自动复制
└── default-config.json                                ← resources/ 自带

用户机器（~/.config/octo/）
├── octo.json                                   ← B + C，用户拥有
└── .octo-runtime.json                                 ← 运行时合并产物（主进程生成）
```

**注意**：`packages/desktop-electron/resources/agents/insight.md` 这个手动副本**应删除**——源在 `packages/agent/insight/`，开发时直读源，打包时 extraResources 自动同步。

---

## 4. 主进程启动流程

```
app.whenReady()
  └→ initOctoConfig()
       ├─ 1. 读 bundled defaults  → defaultConfig (A 类完整)
       │     dev:  packages/desktop-electron/resources/default-config.json
       │     prod: process.resourcesPath/default-config.json
       │
       ├─ 2. 读 bundled agent prompts → 注入 defaultConfig.agent.<name>.prompt
       │     dev:  packages/agent/<agent>/agents/<name>.md
       │     prod: process.resourcesPath/agents/<name>.md
       │
       ├─ 3. 读用户文件（如不存在则创建 stub）
       │     ~/.config/octo/octo.json → userConfig (B + C)
       │
       ├─ 4. deepMerge(defaultConfig, userConfig)
       │     合并语义见 §5
       │
       ├─ 5. 写运行时文件
       │     ~/.config/octo/.octo-runtime.json
       │
       └─ 6. 设置 OPENCODE_CONFIG=~/.config/octo/.octo-runtime.json
            然后启动 opencode server
```

---

## 5. 合并语义

`deepMerge(defaults, user)` 规则：

```
对于每个键 k：
  if 用户文件里有 k:
    if 双方都是 object → 递归合并
    else → 用用户的值（覆盖）
  else:
    用 defaults 的值
```

**用户能 override 任何字段**（包括 A 类）——这是 Linux 哲学（用户最终为准）。但实际只期望 override B+C，文档里建议用户不动 A 类。

**关于 A 类 override**：用户如果手动 override 了 A 类（比如自己改 prompt），后续 app 升级时他的 override 仍然生效（runtime 仍以用户为准）。这是 feature 不是 bug——给资深用户留逃生通道。

---

## 6. 首次启动：用户文件创建 stub

如果 `~/.config/octo/octo.json` 不存在，创建一个最小 stub：

```jsonc
{
  "_note": "在这里填 API key、模型选择等个人设置。Agent 和 MCP 核心配置由 app 自带，不要写在这里。",
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "REPLACE_ME"
      },
      "models": {
        "deepseek-chat":     { "name": "DeepSeek V3" },
        "deepseek-reasoner": { "name": "DeepSeek R1 (思维链)" }
      }
    }
  },
  "model": "deepseek/deepseek-reasoner",
  "mcp": {
    "uxr-tool": {
      "headers": { "Authorization": "Bearer REPLACE_ME" }
    }
  }
}
```

特点：
- 只含 B + C，用户一眼能看懂自己该填什么
- `mcp.uxr-tool` 只覆盖 headers 字段，url/type/timeout 由 bundle 提供（合并后才完整）
- 用户改完 API key 重启就能用

---

## 7. 开发与生产模式

**核心原则**：dev 与 production 走完全相同的流程，只有文件路径不同。

```ts
// packages/desktop-electron/src/main/config.ts（新建）
function getDefaultConfigPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "default-config.json")
  }
  // dev: 直读源
  return path.resolve(__dirname, "../../resources/default-config.json")
}

function getAgentPromptPath(agentName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agents", `${agentName}.md`)
  }
  // dev: 直读 packages/agent 下的源
  return path.resolve(__dirname, "../../../../packages/agent", agentName, "agents", `${agentName}.md`)
}
```

**dev 调试**：
- 改 `packages/agent/insight/agents/insight.md` → 重启 main 进程（Cmd+R 或 vite reload）→ runtime 文件刷新
- 改 `packages/desktop-electron/resources/default-config.json` → 重启 main → runtime 刷新
- 改 `~/.config/octo/octo.json` → 重启 main → runtime 刷新

---

## 8. extraResources 配置

```ts
// packages/desktop-electron/electron-builder.config.ts
export default {
  // ... 现有配置
  extraResources: [
    {
      from: "../../packages/agent/insight/agents/insight.md",
      to: "agents/insight.md",
    },
    // 未来加 agent 时在此追加
  ],
}
```

`packages/desktop-electron/resources/default-config.json` 已被 `files: ["resources/**/*"]` 包含，无需额外配置。

---

## 9. 实现骨架

```ts
// packages/desktop-electron/src/main/config.ts
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { app } from "electron"

const USER_CONFIG_DIR  = path.join(os.homedir(), ".config", "octo")
const USER_CONFIG_PATH = path.join(USER_CONFIG_DIR, "octo.json")
const RUNTIME_PATH     = path.join(USER_CONFIG_DIR, ".octo-runtime.json")

const STUB_USER_CONFIG = { /* 见 §6 */ }

function deepMerge(target: any, source: any): any {
  // 标准深合并实现，object 递归，其他直接覆盖
}

export function initOctoConfig(): string {
  fs.mkdirSync(USER_CONFIG_DIR, { recursive: true })

  // 1. 读 bundled defaults
  const defaults = JSON.parse(fs.readFileSync(getDefaultConfigPath(), "utf8"))

  // 2. 注入 agent prompts
  for (const agentName of Object.keys(defaults.agent ?? {})) {
    const promptPath = getAgentPromptPath(agentName)
    if (fs.existsSync(promptPath)) {
      defaults.agent[agentName].prompt = fs.readFileSync(promptPath, "utf8")
    }
  }

  // 3. 读用户文件（不存在则创建 stub）
  let userConfig = STUB_USER_CONFIG
  if (fs.existsSync(USER_CONFIG_PATH)) {
    userConfig = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"))
  } else {
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(STUB_USER_CONFIG, null, 2), "utf8")
  }

  // 4. 合并
  const merged = deepMerge(defaults, userConfig)

  // 5. 写 runtime 文件
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(merged, null, 2), "utf8")

  return RUNTIME_PATH
}

// 在 src/main/index.ts 里：
// const runtimePath = initOctoConfig()
// process.env.OPENCODE_CONFIG = runtimePath
```

---

## 9.5 环境变量 override（调试期 escape hatch）

### 9.5.1 动机

内网调试时 MCP URL 可能频繁切换（test/staging/prod 环境）。如果只能改 `default-config.json` 重新打包，迭代慢；如果改用户文件污染 B+C 区，违反 ADR-008 约定。

引入 env var 作为**第三层 override**，专门给 dev/CI/调试场景：

```
优先级（高到低）：
1. process.env.OCTO_MCP_URL   ← 启动时临时 override，最高优先
2. 用户文件 octo.json   ← 长期偏好
3. bundled default-config.json ← 产品默认
```

这是 [12-factor app](https://12factor.net/config) 的标准做法：环境变量管理跨环境差异。

### 9.5.2 命名约定

跟现有 `OCTO_DEVTOOLS` 一致，全部以 `OCTO_` 前缀（不侵占上游 `OPENCODE_*` 命名空间）：

| 环境变量 | 覆盖字段 | 示例值 |
|---|---|---|
| `OCTO_MCP_URL` | `mcp.uxr-tool.url` | `http://7.192.161.60:8005/mcp` |

未来如有多个 MCP server 或其他需要切换的字段，按 `OCTO_<UPPER_SNAKE_CASE>` 扩展。**YAGNI**：当前只支持一个变量，扩展时再加。

### 9.5.3 实现位置

`config.ts` 中 `buildRuntimeConfig` 完成 deepMerge 之后、写 runtime 文件之前，加 env var override 阶段：

```ts
function applyEnvOverrides(merged: any): any {
  if (process.env.OCTO_MCP_URL) {
    merged.mcp ??= {}
    merged.mcp["uxr-tool"] ??= {}
    merged.mcp["uxr-tool"].url = process.env.OCTO_MCP_URL
  }
  return merged
}
```

### 9.5.4 使用示例

**Mac 终端启动**：
```bash
OCTO_MCP_URL=http://7.192.161.60:8005/mcp open -n /Applications/Octo\ Agent.app
```

**Windows PowerShell**：
```powershell
$env:OCTO_MCP_URL="http://7.192.161.60:8005/mcp"
& "C:\Program Files\Octo Agent\Octo Agent.exe"
```

**dev 模式**：
```bash
OCTO_MCP_URL=http://localhost:8005/mcp bun --cwd packages/desktop-electron dev
```

### 9.5.5 与文档原则的关系

虽然 ADR-008 强调"用户文件只放 B+C，A 类在 bundle"，但 env var 是**第三个独立维度**——不污染任何文件，只在进程内存里 override，进程退出即失效。这与"用户文件只放 B+C"约定不冲突，是补充。

---

## 10. 错误处理

| 场景 | 行为 |
|---|---|
| 用户文件 JSON 解析失败 | 弹窗提示路径 + 错误位置，启动中止（不静默 fallback，避免用户改坏后困惑） |
| bundled default-config.json 缺失 | 严重 bug，弹窗"安装包损坏请重装"，中止 |
| insight.md 缺失 | 警告日志，agent.prompt 字段空，opencode 仍能启动（fallback 内置 build agent） |
| 用户文件存在但缺 apiKey | 不阻止启动，opencode 在第一次调用时报错 |

---

## 11. 验证清单

> **规则**：能自动验证的都走自动验证；手动步骤仅限无法自动化的场景（启动 app、UI 观察）。

### 自动化验证（日常，秒级）

```bash
cd packages/desktop-electron
bun run test   # → src/main/config.test.ts，7 个用例
```

覆盖范围：

| 用例 | 对应验证点 |
|---|---|
| 首次启动：stub 自动创建，runtime 含真实 insight.md prompt | V-01 |
| 改 prompt 源文件后重跑，runtime 立即更新，用户文件不变 | V-02 |
| 用户手动 override A 类，runtime 以用户值为准 | V-04 |
| deepMerge：object 递归合并，array 整体覆盖 | 合并语义（§5） |
| 用户 model 不被 bundle 覆盖 | B/C 类字段隔离 |

### 打包产物验证（发版前，分钟级）

```bash
bun run package:mac
# 然后手动检查：
ls "dist/mac-arm64/Octo AI.app/Contents/Resources/agents/"
# 预期：insight.md 存在，内容与 packages/agent/insight/agents/insight.md 一致

diff "dist/mac-arm64/Octo AI.app/Contents/Resources/agents/insight.md" \
     packages/agent/insight/agents/insight.md
# 预期：无差异
```

或用脚本一键检查：

```bash
bun run check-bundle   # scripts/check-bundle.ts，对比 bundle 与源文件
```

### V-03 dev 模式（手动，无法完全自动化）
- [ ] `bun --cwd packages/desktop-electron dev` 启动
- [ ] 改 `packages/agent/insight/agents/insight.md` → 重启 main → 检查 `~/.config/octo/.octo-runtime.json` 中 prompt 字段已更新
- [ ] 全程不需要手动 cp 任何文件

---

## 12. Phase 与 ROADMAP

属于 ROADMAP P2 infra：[首次启动配置写入](../../../ROADMAP.md)。

实现完成后：
- 删除 `packages/desktop-electron/resources/agents/insight.md`（手动副本）
- 删除 `~/.config/octo/octo.json` 中的 A 类字段（精简到只含 B + C，配合 [docs/integration.md §6.2](../../integration.md) 更新示例）
- 更新 [agent-deploy.md](../../learning/agent-deploy.md) §2 引用本 spec
