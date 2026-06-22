# Spec: Agent 配置部署机制

> 决策理由见 [ADR-008](../../adr/008-cascading-config.md)，概念背景见 [agent-deploy.md](../../learning/agent-deploy.md)。
> 本 spec 描述 **UXAI 仓**里 octo_insight agent 与配置的实际部署机制（实现真相源）。
>
> > 历史注:归档的 octo-agent 本地 Electron 壳用的是另一套——`packages/agent/<name>/agents/<name>.md` 源 +
> > `default-config.json` + electron-builder `extraResources` 打包 + 主进程 `initOctoConfig()` deepMerge →
> > `~/.config/octo/.octo-runtime.json` → 注入 `OPENCODE_CONFIG`。**UXAI 不用这套**(无 default-config.json /
> > 无 .octo-runtime.json / 无 extraResources / 无壳注入),改由 opencode fork 源码内置 + 原生配置加载实现,见 §3 起。

---

## 0. 业界 agent frontmatter schema 对照（调研事实）

**调研时间**：2026-05-16

### 0.1 opencode 上游（我们 fork 自此）

源：[packages/opencode/src/config/agent.ts](../../../packages/opencode/src/config/agent.ts)，YAML frontmatter 用 `gray-matter` 解析。

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

### 0.3 UXAI fork（本仓现状）

octo_insight 的 agent 定义**硬编码在** [`packages/opencode/src/agent/agent.ts`](../../../packages/opencode/src/agent/agent.ts) 中（非 `.md` frontmatter 派生），含 `mcp: ["uxr-tool"]` 和 `skills: ["interview-analysis"]` 字段 —— 这两个字段是 **fork 自加的扩展**，上游 opencode 没有。详见 §3。

### 0.4 结论

| 维度 | 业界基准（opencode 上游）| UXAI fork |
|---|---|---|
| Agent prompt SOT | `.md` frontmatter + body | `.md`（编辑源）→ `.txt`（agent.ts import 变体） |
| `mcp` per-agent 字段 | 不支持 | 在 `agent.ts` 注册块声明（fork 扩展） |
| `skills` per-agent 字段 | 不支持 | 同上 |
| `tools` vs `permission` | tools deprecated | 用 `permission`（`Permission.merge`） |

**`mcp`/`skills` 是 fork 内部决定**：不污染上游 frontmatter schema（保持 `.md` 跨 fork 可移植），扩展字段直接写在 `agent.ts` 注册块。跨 fork 对接边界见 [intranet-handoff §6](../../intranet-handoff.md)。

---

## 1. 设计目标（ADR-008）

- **改一处源 → 重启 server 即生效**（dev 与 production 行为一致）
- **用户文件 (`~/.config/octo/octo.json`) 仅含用户机密 + 偏好**，产品永不写
- **产品升级**（改 prompt、加工具、改 MCP 默认）不污染用户文件
- **零 CONFIG_VERSION 维护**

UXAI 的实现把"产品默认"(A 类)从"打包进 JSON"升级为"**内置进 opencode fork 源码**"，目标不变、机制更直接（见 §2/§3）。

---

## 2. 字段归类（A / B / C）

| 字段 | 类别 | 在 UXAI 写在哪 | 升级行为 |
|---|---|---|---|
| agent 结构（`name`/`description`/`mode`/`permission`/`skills`/`mcp`） | A | [`agent.ts`](../../../packages/opencode/src/agent/agent.ts) 注册块 | 随 opencode 构建发布 |
| agent prompt 正文 | A | [`prompt/octo_insight.txt`](../../../packages/opencode/src/agent/prompt/octo_insight.txt)（编辑源 `.md`） | 同上 |
| MCP server 默认（`type`/`url`/`timeout`/`proxy`） | A | [`builtin-mcp.ts`](../../../packages/opencode/src/config/builtin-mcp.ts) `BUILTIN_MCP_SERVERS` | 同上 |
| `mcp.<name>.headers.Authorization` | **B** | 用户文件 `octo.json` | 用户填，产品不覆盖 |
| `provider.<name>.options.apiKey` | **B** | 用户文件 `octo.json` | 用户填，产品不覆盖 |
| `model` | **C** | 用户文件 `octo.json` | 用户改，产品不覆盖 |
| `provider.<name>.options.baseURL` | **C** | 用户文件 `octo.json` | 用户改，产品不覆盖 |

> A 类不再是"打包的 default-config.json"，而是 opencode fork 的源码常量（agent.ts + builtin-mcp.ts）。升级 = 发新 opencode 构建,不涉及用户机器上任何文件。

---

## 3. UXAI 实际机制

### 3.1 Agent 注册（硬编码）

octo_insight 在 [`agent.ts`](../../../packages/opencode/src/agent/agent.ts) 内置 agent 表里直接声明：

```ts
import PROMPT_OCTO_INSIGHT from "./prompt/octo_insight.txt"
// ...
octo_insight: {
  name: "octo_insight",
  description: "用研 Agent，从访谈材料中提取结构化洞察……",
  prompt: PROMPT_OCTO_INSIGHT,
  permission: Permission.merge(defaults, user),
  mode: "primary",
  native: false,
  skills: ["interview-analysis"],   // fork 扩展
  mcp: ["uxr-tool"],                // fork 扩展
},
```

- **不读 `.md` frontmatter 派生** `mode`/`description` 等——全在此块写死
- `prompt` 由 `import` 注入：源是 `prompt/octo_insight.txt`（`octo_insight.md` 是带 frontmatter 的人工编辑版，`.txt` 为加载用的纯文本变体）
- `skills` / `mcp` 是 fork 私有扩展字段，opencode 上游 agent schema 无

### 3.2 MCP 默认（内置兜底）

[`builtin-mcp.ts`](../../../packages/opencode/src/config/builtin-mcp.ts) 把 `uxr-tool` 作为**最低优先级默认**：

```ts
export const BUILTIN_MCP_SERVERS = {
  "uxr-tool": { type: "remote", url: "http://7.192.161.60:8005/mcp", enabled: true, timeout: 30000, proxy: false },
}
```

> `proxy: false`：内网 `7.x` 私有 IP 不被 `isPrivateUrl` 识别，默认会走系统代理触发 504，显式绕过。

### 3.3 用户配置（B + C）

opencode fork **原生读** `~/.config/octo/octo.json`（无壳注入 `OPENCODE_CONFIG`，无 `.octo-runtime.json` 中间产物）。用户在此填机密 + 偏好：

```jsonc
// ~/.config/octo/octo.json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.deepseek.com/v1", "apiKey": "REPLACE_ME" },
      "models": { "deepseek-chat": { "name": "DeepSeek V3" } }
    }
  },
  "model": "deepseek/deepseek-chat"
}
```

---

## 4. 配置加载级联（opencode 原生）

[`config.ts`](../../../packages/opencode/src/config/config.ts) `loadGlobal()` 按低→高合并，后者覆盖前者：

1. `~/.config/opencode/` 下：`config.json` → `octo.json` → `octo.jsonc` → `opencode.json` → `opencode.jsonc`
2. `~/.config/octo/` 下：同名五个文件（**更高优先级，覆盖第 1 组**）
3. MCP 单独合并:`result.mcp = { ...BUILTIN_MCP_SERVERS, ...userMcp }`

目录优先级 `~/.config/octo/` > `~/.config/opencode/` 定义在 [`paths.ts`](../../../packages/opencode/src/config/paths.ts)。`octo.json` 列在配置名首位（见 [config.ts](../../../packages/opencode/src/config/config.ts) 的 `names` 列表）。

> ⚠️ **MCP 合并是 shallow（按 server key 整块替换），不是 deepMerge**：用户 `octo.json` 里写了 `mcp["uxr-tool"]`，会**整体替换** builtin 默认那一项。所以要给 `uxr-tool` 加 `headers.Authorization`，必须**连 `url`/`type`/`timeout` 一起写全**，只写 `headers` 会丢掉默认的 url：
>
> ```jsonc
> "mcp": {
>   "uxr-tool": {
>     "type": "remote",
>     "url": "http://7.192.161.60:8005/mcp",
>     "timeout": 30000,
>     "headers": { "Authorization": "Bearer xxx" }
>   }
> }
> ```
>
> 这与归档 octo-agent 壳的 deepMerge（可只写 delta）行为不同,迁移对接时务必注意。

---

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| `octo.json` JSON 解析失败 | opencode 加载报错;`loadGlobal` 失败时 `orElseSucceed({})` 兜底为空配置 → 表现为缺 provider，第一次调用报错 |
| 缺 apiKey | 不阻止启动，第一次 LLM 调用时报错 |
| AI 回复显示占位模型(`opencode/big-pickle`) | 配置没生效(没读到 provider/model)，检查 `octo.json` 路径与 schema |
| MCP 启动失败 | **不阻塞 server**(MCP 默认 enabled，失败仅该工具不可用) |

---

## 6. dev 调试

opencode 源就是 SOT，改完重启 server 生效（桌面壳 `dev:desktop` 会经 predev 重新 `build-node` opencode，见 [development.md §3.3](../../development.md)）：

- 改 [`agent.ts`](../../../packages/opencode/src/agent/agent.ts) 注册块 / [`octo_insight.txt`](../../../packages/opencode/src/agent/prompt/octo_insight.txt) prompt → 重启
- 改 [`builtin-mcp.ts`](../../../packages/opencode/src/config/builtin-mcp.ts) MCP 默认 → 重启
- 改 `~/.config/octo/octo.json` → 重启（opencode 配置不热重载）

MCP 端点临时切换:直接改 `octo.json` 的 `mcp.uxr-tool`(注意 §4 的 shallow 替换,要写全块),或改 `builtin-mcp.ts` 默认值重启。

---

## 7. 与归档 octo-agent 机制的差异速查

| 维度 | 归档 octo-agent 本地壳 | UXAI fork（现役） |
|---|---|---|
| agent 结构来源 | `default-config.json`（extraResources 打包） | `agent.ts` 源码常量 |
| agent prompt 来源 | `packages/agent/<name>/agents/<name>.md`（extraResources） | `agent.ts` import `prompt/octo_insight.txt` |
| MCP 默认来源 | `default-config.json` | `builtin-mcp.ts` `BUILTIN_MCP_SERVERS` |
| 配置合并 | 主进程 `initOctoConfig()` deepMerge → `.octo-runtime.json` | opencode `config.ts` 原生级联（目录优先级 + builtin 兜底） |
| opencode 读哪个 | 壳注入 `OPENCODE_CONFIG=.octo-runtime.json` | 原生读 `~/.config/octo/octo.json` |
| MCP 用户覆盖 | deepMerge（可只写 delta） | shallow（按 key 整块替换，见 §4 ⚠️） |

---

## 8. Phase 与 ROADMAP

ADR-008 cascading 配置目标已在 UXAI 落地（机制如上）。相关:
- [agent-deploy.md](../../learning/agent-deploy.md) 概念背景
- [intranet-handoff.md](../../intranet-handoff.md) 对接契约
</content>
