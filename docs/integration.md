# 内外网对接说明

> 外网（本仓库）与内网 `packages/app/` 保持相同目录结构，按图索骥对接。

---

## 1. 合入边界

| 外网路径 | 内网操作 | 说明 |
|---|---|---|
| `packages/app/src/pages/insight/` | 直接同步目录 | 路径与内网完全一致 |
| `packages/app/src/app.tsx`（一行） | 手动加路由注册行 | 见 §2 |
| `packages/app/src/pages/layout/sidebar-workspace.tsx`（一行） | 手动改跳转目标 | 见 §3 |
| `packages/agent/research/agents/research.md` | 部署到 `~/.config/octo/agent/` | 见 §4 |

**不合入**：`packages/desktop-electron/` 的 Electron 接线改动（内网有自己的启动方式）。

---

## 2. 路由注册（app.tsx）

```tsx
// packages/app/src/app.tsx — 在现有路由列表中加这一行
const InsightPage = lazy(() => import("@/pages/insight"))

// Router 里加：
<Route path="/insight/:id?" component={InsightPage} />
```

---

## 3. Agent 配置部署

```bash
cp packages/agent/research/agents/research.md ~/.config/octo/agent/research.md
```

---

## 5. 本地调试流程（外网 Electron 开发时）

启动 Electron：
```bash
bun --cwd packages/desktop-electron dev
```

进入 InsightPage：
1. 左侧 sidebar 里 **hover 任意一个工作区**
2. 出现 **"+"** 按钮（新建对话）→ 点击
3. 页面跳转到 `/insight`，InsightPage 渲染

Session 在 InsightPage 里自己创建（PromptInput 提交时调 `session.create()`），不依赖上游 session 页面。

---

## 6. 内网 LLM / MCP 配置

`~/.config/octo/octo.config.json`：

```jsonc
{
  "provider": {
    "intranet": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://your-llm/v1", "apiKey": "..." },
      "models": { "your-model": { "name": "内网模型" } }
    }
  },
  "model": "intranet/your-model",
  "mcp": {
    "uxr-tool": {
      "type": "local",
      "command": ["node", "/path/to/uxr-mcp-server.js"],
      "enabled": true
    }
  }
}
```

---

## 7. 本仓库接线改动（供参考，不合入）

内网 Electron 接线由内网基础 UI 负责人维护，以下仅供参考。

| 文件 | 改动 | 目的 |
|---|---|---|
| `desktop-electron/src/main/index.ts` | 注入 `OPENCODE_CONFIG=~/.config/octo/octo.config.json` | 隔离 Octo 配置，不污染用户的 opencode 配置 |
| `desktop-electron/src/main/index.ts` | 注入 `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | 防止读取用户 `~/.claude/CLAUDE.md` 污染 agent 行为 |
