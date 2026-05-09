# Agent 注册的作用与配置分发

> 前置阅读：[agent-mental-model.md](agent-mental-model.md)  
> 解答两个问题：①不注册也能对话，注册到底有什么用？②配置文件在本机，发布后用户侧怎么自带？

---

## 1. 不注册 agent 也能对话，注册的意义是什么？

### 现在发生了什么

opencode 有几个**内置 agent**，默认使用的是 `build`：

```ts
// packages/opencode/src/agent/agent.ts（简化）
const agents = {
  build: {
    description: "The default agent. Executes tools based on configured permissions.",
    mode: "primary",
    permission: { "*": "allow" },   // 允许所有工具
  },
  plan: { ... },
  general: { mode: "subagent", ... },   // subagent，不是主对话用的
  explore: { mode: "subagent", ... },
}
```

我们现在没有注册任何自定义 agent，所有对话都跑在 `build` 上。能出结果，因为 `build` 已经是个完整的 agent，权限开放，工具都能用。

### 注册自定义 agent 解决的三个问题

**① System prompt — LLM 不知道自己是谁**

`build` 没有业务相关的 system prompt，LLM 接到"分析这份访谈稿"时，只能靠对话上下文猜测该怎么做：
- 不知道应该调 `upload_document` 还是自己读文件内容
- 不知道 `analysis_type` 有哪些选项
- 不知道输出应该是 Markdown 表格格式

注册 `insight` agent 后，system prompt 写明了工作流程和 analysis_type 选择指南，LLM 每次对话都从这个上下文出发，行为可预期。

**② 工具白名单 — LLM 看到的工具太多**

`build` agent 的权限是 `"*": allow`，MCP 配置好之后，LLM 同时能看到：
- opencode 内置工具（bash、write_file、edit、web_search…）
- 我们的 MCP 工具（upload_document、analyze_interview…）

工具太多会让 LLM 困惑，更容易选错（比如直接用 bash 处理文件而不走 upload_document）。注册 `insight` agent 后，`tools` 字段只开放用研相关的 MCP 工具，LLM 的选择空间大幅缩小，调用准确率更高。

```markdown
---
tools:
  - upload_document
  - analyze_interview
  # 没有 bash、write_file、edit 等
---
```

**③ default_agent — 每次新建对话要手动选**

不设 `default_agent` 时，opencode 启动选第一个可见 primary agent（通常是 `build`）。如果未来加了多个 agent（insight、make、chat…），用户每次新建对话可能需要手动选择。

设置 `"default_agent": "insight"` 后，进入 InsightPage 新建的对话自动使用 insight agent，无需用户操作。

### 有无注册的对比

| | 无注册（用 build） | 注册 insight |
|---|---|---|
| LLM 行为 | 靠对话上下文猜 | 由 system prompt 明确指导 |
| 可用工具 | 全部（含 bash、edit 等） | 仅 UXR 相关 MCP 工具 |
| 工具选择准确率 | 较低 | 较高 |
| 默认 agent | build | insight（自动） |
| 误操作风险 | 高（LLM 可能随意写文件） | 低（只能调指定工具） |

---

## 2. 配置文件在本机，发布后用户侧怎么自带？

### 问题的本质

我们通过 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` 告诉 opencode 读哪个配置文件。这个路径是用户机器上的，**全新安装的用户没有这个文件**，所以：
- 用户首次启动 → 文件不存在 → opencode 用内置默认配置 → 没有 insight agent、没有 MCP
- 这不是我们想要的

### 解决方案：主进程首次启动写入

Electron 主进程在启动时有机会**先于 opencode server 运行**，我们在这里做一次性初始化：

```ts
// packages/desktop-electron/src/main/index.ts
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

const CONFIG_VERSION = 1   // 每次需要更新配置时递增

function initOctoConfig() {
  const configDir  = path.join(os.homedir(), ".config", "octo")
  const configPath = path.join(configDir, "octo.config.json")
  const metaPath   = path.join(configDir, ".octo-version")

  // 读取已有版本号（没有则视为 0）
  const installedVersion = fs.existsSync(metaPath)
    ? parseInt(fs.readFileSync(metaPath, "utf8"), 10)
    : 0

  if (installedVersion >= CONFIG_VERSION) return  // 已是最新，跳过

  // 读取用户已有配置（如有），保留用户自定义字段（API key、model 等）
  let userConfig: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    try { userConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) }
    catch { /* 解析失败则重写 */ }
  }

  // 合并：app 默认值 + 用户已有配置（用户配置优先）
  const defaultConfig = {
    default_agent: "insight",
    agent: {
      insight: {
        mode: "primary",
        description: "用研 Agent，从访谈材料中提取结构化洞察",
        prompt: fs.readFileSync(
          path.join(process.resourcesPath, "agents", "insight.md"),
          "utf8"
        ),
        tools: {
          upload_document:   true,
          analyze_interview: true,
          batch_analyze:     true,
          search_reports:    true,
        },
      },
    },
    mcp: {
      "uxr-tool": {
        type: "remote",
        url: "https://uxr-service.company-intranet.com/mcp",
        headers: { Authorization: "Bearer REPLACE_ME" },
        enabled: true,
        timeout: 30000,
      },
    },
  }

  const merged = { ...defaultConfig, ...userConfig }

  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8")
  fs.writeFileSync(metaPath, String(CONFIG_VERSION), "utf8")
}

// 在 app ready 之后、opencode server 启动之前调用
app.whenReady().then(() => {
  initOctoConfig()
  // ...然后启动 opencode server、创建窗口
})
```

### `insight.md` 打包进安装包

`process.resourcesPath` 是 Electron 打包后可访问的资源目录。需要在 `electron-builder.config.ts` 里声明把 `insight.md` 打包进去：

```ts
// packages/desktop-electron/electron-builder.config.ts
export default {
  extraResources: [
    {
      from: "../../packages/agent/insight/agents/insight.md",
      to: "agents/insight.md",
    },
  ],
}
```

打包后目录结构：
```
Octo AI.app/
└── Contents/
    └── Resources/
        ├── app.asar          ← JS bundle
        └── agents/
            └── insight.md    ← process.resourcesPath + "/agents/insight.md"
```

### 版本化升级机制

`CONFIG_VERSION` 常量控制配置版本。每次 app 更新需要更改 agent 配置时，递增这个常量：

```ts
const CONFIG_VERSION = 2   // 升级：修改了 insight agent 的 system prompt
```

用户更新 app 后首次启动，`installedVersion(1) < CONFIG_VERSION(2)`，主进程重新写入配置。

**合并策略**：`{ ...defaultConfig, ...userConfig }` 确保用户自定义的字段（API key、自选的 model）不被覆盖。如果需要强制更新某个字段（比如 agent prompt），需要额外处理：

```ts
// 强制更新 agent 配置，但保留用户的 model / provider 设置
const merged = {
  ...userConfig,                          // 用户配置打底
  default_agent: "insight",              // 强制覆盖
  agent: defaultConfig.agent,            // 强制覆盖 agent 定义
  mcp: userConfig.mcp ?? defaultConfig.mcp,  // 用户有 mcp 配置则保留
}
```

### 内网部署的特殊情况

内网场景下，MCP URL 和 API Key 可能因部门不同而不同。两种处理方式：

**方式 A：统一 URL，个人 Token**
- `octo.config.json` 预填 MCP URL，`Authorization` 写 `"Bearer REPLACE_ME"`
- 首次启动时弹引导页，让用户粘贴自己的 Token（P2 Settings UI）
- 在此之前：用户手动编辑 `~/.config/octo/octo.config.json` 替换 Token

**方式 B：全量推送**
- 通过内网 MDM（如 Jamf / 企业微信 IT 自动化）在用户机器上写好完整 `octo.config.json`
- App 首次启动时检测到文件已存在且版本够新，跳过初始化
- 适合有 IT 运维能力的团队

### 开发阶段（当前）的简化方案

P1 阶段不用做完整的首次启动写入逻辑，直接手动操作：

```bash
# 把 insight agent 定义写入本地 config
cat >> ~/.config/octo/octo.config.json << 'EOF'
（手动合并 insight agent 和 MCP 配置）
EOF
```

完整的首次启动初始化留到发布前（P2 infra 阶段）再做。
