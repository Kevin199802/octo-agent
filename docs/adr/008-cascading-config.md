# ADR-008: Agent 配置走 cascading 模式（A 类 bundle 内写死，B/C 类用户文件）

## 状态
已采纳（2026-05-14）

## 背景

Octo 的 `octo.json` 同时混合了两类信息：
1. **产品决策**：agent 定义、系统提示词、MCP endpoint URL
2. **用户机密 + 偏好**：API key、Token、模型选择

混在同一个文件里有 4 个问题：
- 我们升级 agent prompt 时担心覆盖用户改动（需要 CONFIG_VERSION + 复杂合并逻辑）
- 用户编辑文件时分不清哪些字段能改、哪些不能改
- 用户文件 diff 看不懂（默认值占据大量行）
- "改一处 spec 即生效"做不到（需要手动同步到 ~/.config）

需要清晰的分层架构。

## 三类配置

| 类别 | 拥有方 | 用户能改吗 | 升级是否变化 | 字段示例 |
|---|---|---|---|---|
| **A 产品决策** | 我们 | 不应该 | 是 | `default_agent` / `agent.*` / `mcp.uxr-tool.url` |
| **B 用户机密** | 用户 | 必须 | 否 | `provider.*.options.apiKey` / `mcp.*.headers.Authorization` |
| **C 用户偏好** | 用户（我们给默认） | 是 | 否 | `model` / `provider.*.options.baseURL` |

具体字段归类与实现见 [docs/specs/infra/agent-config-deploy.md](../specs/infra/agent-config-deploy.md)。

## 方案对比

### 方案 1：单文件混合（旧 agent-deploy.md 思路）

主进程首次启动写入完整默认配置到 `octo.json`，靠 `CONFIG_VERSION` 决定是否重写。

❌ 问题：
- 用户文件有 100+ 行默认值，不直观
- CONFIG_VERSION 需手动维护，易遗漏
- 升级时合并策略复杂（哪些字段强制覆盖、哪些保留用户）
- 用户改了 A 类字段后再升级，要么破坏用户配置，要么破坏产品行为

### 方案 2：cascading 分层（已采纳）

```
bundle 内（A 类，我们维护，每次启动从 bundle 读最新）
  ├─ packages/agent/insight/agents/insight.md         ← 系统提示词
  └─ packages/desktop-electron/resources/default-config.json  ← agent 结构 + MCP 配置

用户文件（B + C 类，用户拥有，我们永不写）
  └─ ~/.config/octo/octo.json

运行时合并产物（主进程生成，opencode 读）
  └─ ~/.config/octo/.octo-runtime.json
```

主进程启动流程：
1. 读 bundled defaults + insight.md → 拼成 A 类完整配置
2. 读用户的 octo.json → B + C 类
3. deepMerge(A, B+C) → 写到 .octo-runtime.json
4. `OPENCODE_CONFIG=.octo-runtime.json` 启动 opencode

✅ 优势：
- 用户文件保持极简，只含 B + C
- 产品升级（改 prompt / 加工具）不影响用户文件
- 不需要 CONFIG_VERSION（每次启动都从 bundle 读最新 A 类）
- "改一处即生效"：改源文件 → 重启 main → 自动同步

## 业界对照

| 工具 | 做法 | 与方案 2 对应 |
|---|---|---|
| VS Code | 用户 settings.json 只存 override，默认值在 binary 内，运行时 in-memory merge | ✅ 完全一致 |
| Claude Desktop | `claude_desktop_config.json` 用户拥有，部分 MCP 默认在 bundle | 接近 |
| Git | system / global / local 三层 cascading override | 同思想 |
| 多数 Electron app | electron-store 提供 defaults 参数 + user store | 同思想 |

方案 2 是业界标准做法，没有走偏路。

## 决策

采用方案 2。

## 后果

- A 类升级走 app 升级通道（用户更新 app → 自动生效），不污染用户文件
- 用户文件保持简洁（典型情况 < 30 行）
- `packages/desktop-electron/resources/agents/insight.md` 这个手动副本可以**删除**：源是 `packages/agent/insight/agents/insight.md`，开发时主进程直读源文件，打包时通过 `extraResources` 自动同步进 bundle
- 实现细节见 [docs/specs/infra/agent-config-deploy.md](../specs/infra/agent-config-deploy.md)
- 概念背景见 [docs/learning/agent-deploy.md](../learning/agent-deploy.md)
