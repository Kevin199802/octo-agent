# 外网跑构建产物：模型配置指南

> 拿到 Octo Agent 的桌面构建产物（`.dmg` / `.exe`，任意渠道），在**外网机器**上配一个能用的模型把它跑起来。
> 配置机制的设计理由见 [ADR-008 cascading 配置](adr/008-cascading-config.md)，字段归类与加载级联的完整描述见
> [specs/infra/agent-config-deploy.md](specs/infra/agent-config-deploy.md)——本篇只讲**外网怎么配**，不重复那两篇的机制推导。
>
> 真相源：UXAI 仓 `dev` 分支（2026-09-10 核对）。手上的构建产物早于该日期时，以产物内行为为准，差异处本文会标注。

---

## 0. 一句话结论

**改一个文件：`~/.config/octo/octo.json`**（Windows 是 `C:\Users\<你>\.config\octo\octo.json`）。
在里面声明 provider（baseURL + apiKey + 模型清单）和默认 `model`，**重启 app** 即可。构建产物本身不需要重打包，也不需要联网装任何依赖。

---

## 1. 配置文件到底在哪

### 1.1 正常情况（绝大多数机器）

| 平台 | 路径 |
|---|---|
| macOS / Linux | `~/.config/octo/octo.json` |
| Windows | `%USERPROFILE%\.config\octo\octo.json`（**不是** `%APPDATA%`） |

Windows 走的也是 `.config`：opencode 用 `xdg-basedir`，该库不特判 Windows，`XDG_CONFIG_HOME` 未设时一律回落 `<家目录>/.config`。

同一目录下这五个文件名都会被读，按此顺序后者覆盖前者：`config.json` → `octo.json` → `octo.jsonc` → `opencode.json` → `opencode.jsonc`。
另外 `~/.config/opencode/` 下的同名五个文件也会被读，且**优先级低于** `~/.config/octo/`。

> 常见困惑：`~/.config/opencode/config.json` 里写了 `model`，但实际生效的是 `~/.config/octo/octo.json` 里的 `model`——后者覆盖前者。排查时两个目录都要看一眼。

### 1.2 例外：数据目录不可写时，配置目录会被搬走

桌面壳启动时会探测数据目录 `~/.local/share/opencode` 是否可写。**不可写**（企业策略、目录被重定向到网盘、权限异常等）时会切到 `app-data-fallback` 模式，给 sidecar 注入 `XDG_CONFIG_HOME=<userData>/xdg-config`，此时配置文件变成：

```
<userData>/xdg-config/octo/octo.json
```

`<userData>` = macOS `~/Library/Application Support/<appId>`、Windows `%APPDATA%\<appId>`，`<appId>`：prod `ai.octo.desktop` · beta `ai.octo.desktop.beta` · dev `ai.octo.desktop.dev`。
这个模式一旦触发会被**记住**（写进 electron-store），后续启动一直用它。

判断自己是不是 fallback 模式（存在即是）：

```bash
# macOS
ls -d ~/Library/Application\ Support/ai.octo.desktop*/xdg-config 2>/dev/null
```

```powershell
# Windows
Get-ChildItem "$env:APPDATA\ai.octo.desktop*\xdg-config" -ErrorAction SilentlyContinue
```

实现见 UXAI `packages/desktop/src/main/storage.ts`。

---

## 2. 最小可用配置

新建 / 编辑 `~/.config/octo/octo.json`，一个 OpenAI 兼容的 provider 就够：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": {                                  // provider id，自己取，下面 model 字段要用它
      "npm": "@ai-sdk/openai-compatible",          // SDK 适配器，见 §3.2 内置清单
      "options": {
        "baseURL": "https://api.deepseek.com/v1",  // 必须能从这台机器直连
        "apiKey": "sk-xxxxxxxx"                    // 不想明文，见 §2.2
      },
      "models": {
        "deepseek-chat": {                         // key = 请求里发给服务端的真实 model id
          "name": "DeepSeek Chat",                 // UI 上显示的名字
          "tool_call": true,                       // 必须为 true，见 §2.1
          "attachment": true,
          "limit": { "context": 128000, "output": 16000 }
        }
      }
    }
  },
  "model": "deepseek/deepseek-chat"                // 默认模型：<provider id>/<models 的 key>
}
```

写完**重启 app**（opencode 配置不热重载）。

### 2.1 模型选型的硬要求

| 能力 | 要求 | 不满足会怎样 |
|---|---|---|
| `tool_call` | **必须**支持 | agent 全线不可用：读写文件、skill、MCP 全靠工具调用，模型不支持就只能纯聊天 |
| 上下文 | 建议 ≥ 128k | insight 要通读访谈材料，32k 级的模型很快就撑爆 |
| `attachment` | 需要发图时才要 | 为 false 时图片附件不会进模型 |
| `reasoning` | 可选 | 思维链模型另需在 model 里声明思维链字段（如 OpenAI 兼容接口常见的 `reasoning_content`） |

`models` 里的字段是**声明**，不是开关：写 `tool_call: true` 只是告诉客户端"这个模型支持工具调用"，服务端真不支持一样会失败。

### 2.2 不想把 API key 明文写进文件

配置文本支持两种变量替换（加载时展开）：

| 写法 | 含义 | 外网 GUI 场景建议 |
|---|---|---|
| `"apiKey": "{file:~/.config/octo/deepseek.key}"` | 读该文件内容（自动 trim），支持 `~/` 与相对路径 | ✅ **推荐** |
| `"apiKey": "{env:DEEPSEEK_API_KEY}"` | 读环境变量 | ⚠️ 见下 |

⚠️ **`{env:}` 在双击启动的桌面 app 里多半是空的**：macOS 从 Finder / Dock 启动的进程不继承你在 `.zshrc` 里 export 的变量。要用 `{env:}` 就得从终端启动 app（`open` 也不行，得直接跑
`"/Applications/Octo Agent.app/Contents/MacOS/Octo Agent"`），或用 `launchctl setenv` 设成用户级变量。**图省事就用 `{file:}`。**

变量取不到时：`{env:}` 展开成空串（表现为"没配 key"），`{file:}` 指向的文件不存在则**整份配置报错**（表现为所有 provider 都没了）。

---

## 3. 为什么外网**必须**手写 provider（两条机制）

### 3.1 模型目录不联网，内置快照只有内网 provider

fork 已经把 opencode 原生的 models.dev 拉取**整段关掉**（`packages/opencode/src/provider/models.ts`：磁盘缓存、网络获取、定时刷新全部注释，只留构建期快照兜底）。构建期快照由 `packages/opencode/api.json` 生成，里面**只有内网那个 provider**——外网既连不上它、也不会有 deepseek / openai / gemini 之类的条目。

前端另有一条"远程模型配置"通道（`VITE_OCTO_MODELS_API_URL` + `uiplusToken`），指向内网、且要登录态，外网同样拿不到，请求失败只会在控制台报错，不影响你在 `octo.json` 里声明的 provider。

**结论：外网机器上，模型清单只能来自你自己写的 `octo.json`。`models` 段不写，模型选择器就是空的。**

### 3.2 常用 provider SDK 已经打进产物，外网不用装 npm 包

`provider.<id>.npm` 命中下列**已内置**的包时，直接从产物里加载，不联网、不写 `node_modules`：

`@ai-sdk/openai-compatible` · `@ai-sdk/openai` · `@ai-sdk/anthropic` · `@ai-sdk/google` · `@ai-sdk/google-vertex` · `@ai-sdk/azure` · `@ai-sdk/amazon-bedrock` · `@ai-sdk/xai` · `@ai-sdk/mistral` · `@ai-sdk/groq` · `@ai-sdk/cohere` · `@ai-sdk/deepinfra` · `@ai-sdk/cerebras` · `@ai-sdk/togetherai` · `@ai-sdk/perplexity` · `@ai-sdk/vercel` · `@ai-sdk/gateway` · `@openrouter/ai-sdk-provider`

写这个清单之外的包（例如某些第三方 provider），才会现场 npm 安装到 `~/.cache/opencode/packages/`，那就要求这台机器能访问 npm registry。**没有特殊理由，一律用 `@ai-sdk/openai-compatible`。**

---

## 4. 也可以在 UI 里配（写的是同一个文件）

模型下拉 → 管理模型 → 添加自定义 provider，可以填 id / 名称 / baseURL / apiKey / 模型清单 / 自定义 headers，apiKey 支持直接填 `{env:XXX}`。

写盘目标是**第一个已存在**的全局配置文件，查找顺序：`~/.config/octo/` 下 `octo.json` → `octo.jsonc` → `opencode.json` → `opencode.jsonc` → `config.json`，都没有再看 `~/.config/opencode/`，还是没有就新建 `~/.config/octo/octo.json`。

所以 UI 配置和手写 JSON 是同一份文件的两个入口，可以混用。**但 UI 表单填不了 `limit`、思维链字段这类细项**，要精确控制就手写。

---

## 5. 外网能跑到什么程度（预期降级）

产物里的内网端点在外网一律连不上，影响范围：

| 能力 | 外网状态 | 说明 |
|---|---|---|
| 普通对话、读写本地文件、bash、skill | ✅ 可用 | 只依赖你配的模型 |
| `uxr-tool` MCP（用研分析主链路） | ❌ 不可用 | 内建默认指向内网 IP。**连不上不阻塞 server**，只是该组工具用不了 |
| 内网知识库检索 | ❌ 不可用 | 端点 + 工号登录态都在内网 |
| 附件上传服务（S3 直传链路） | ❌ 不可用 | 上传端点在内网；本地文件读取不受影响 |
| `pixso` MCP（本地 `127.0.0.1:3667`） | ⚠️ 装了才有 | 没装只是连接失败，同样不阻塞 |
| 自动更新 | ❌ 不可用 | 更新源在内网 |

嫌 MCP 连接失败的日志吵，可以在 `octo.json` 里关掉：

```jsonc
"mcp": {
  "uxr-tool": { "type": "remote", "url": "http://127.0.0.1:1/mcp", "enabled": false, "timeout": 30000 },
  "pixso":    { "type": "remote", "url": "http://127.0.0.1:3667/mcp", "enabled": false, "timeout": 30000 }
}
```

⚠️ **MCP 是按 server key 整块替换（shallow），不是深合并**：写了某个 key 就必须把 `type` / `url` / `timeout` 一起写全，只写 `enabled` 会把内建默认的 `url` 一起丢掉。这条与其他字段的合并行为不同，详见
[agent-config-deploy.md](specs/infra/agent-config-deploy.md) §4。

---

## 6. 验证

全部在外网本地即可完成，不依赖内网服务。

1. **JSON 语法**——解析失败会静默回落成空配置（表现为"一个 provider 都没有"）：
   ```bash
   python3 -m json.tool ~/.config/octo/octo.json > /dev/null && echo OK
   ```
2. **模型能直连**——先证明网络和 key 没问题，再怀疑客户端：
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://api.deepseek.com/v1/models \
     -H "Authorization: Bearer $(cat ~/.config/octo/deepseek.key)"
   ```
   期望 `200`；`401` = key 不对，超时 = 网络/代理问题。
3. **重启 app**，模型选择器里出现你写的 `name`，且默认选中 `model` 指定的那个。
4. **发一句"你好"**，能出回复 = provider 通了。
5. **发一句"列出当前目录的文件"**，模型真的调了工具并给出结果 = `tool_call` 链路通了（只有这步能证明 agent 可用）。
6. **看 sidecar 日志**确认配置被读到（日志文件定位见 [find-local-logs.md](find-local-logs.md)，前缀含义见
   [insight-debugging.md](insight-debugging.md)）：
   ```bash
   DIR=~/.local/share/opencode/log            # 成品包在 <userData>/xdg-data/opencode/log/
   grep -E "\[octo:mcp\]|provider|model" "$DIR/$(ls -t "$DIR" | head -1)" | head -30
   ```

---

## 7. 故障速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 模型选择器是空的 | `models` 段没写；或 JSON 解析失败整份配置被丢弃；或改错了目录（见 §1.2 fallback） | 按 §6.1 验语法，确认改的是生效的那个文件 |
| 回复里模型名是 `opencode/big-pickle` 之类的占位 | 配置完全没被读到 | 同上，重点查路径 |
| 改了配置没反应 | 配置不热重载 | 完全退出 app 再启动（不是关窗口） |
| 报认证失败 / 401 | key 没展开：`{env:}` 在 GUI 启动下取不到 | 改用 `{file:}`，见 §2.2 |
| 启动即报配置错误、所有 provider 消失 | `{file:}` 指向的文件不存在 | 建好该文件或改回明文 |
| 模型能聊天，但不会读文件 / 不触发 skill | 模型不支持工具调用，或 `tool_call` 没声明 | 换支持 function calling 的模型，见 §2.1 |
| 首次请求报连接超时 | 公司代理环境变量把外网请求劫持了 | 检查 `HTTP_PROXY` / `NO_PROXY`；内网侧的代理配置见 [intranet-proxy-setup.md](intranet-proxy-setup.md) |
| 日志刷 MCP 504 / 连接失败 | 内建 MCP 指向内网，外网连不上 | 预期行为，不阻塞；嫌吵按 §5 关掉 |

---

## 8. 相关文档

- [ADR-008 cascading 配置](adr/008-cascading-config.md) —— 为什么用户文件只放机密 + 偏好
- [specs/infra/agent-config-deploy.md](specs/infra/agent-config-deploy.md) —— A/B/C 字段归类、加载级联、MCP shallow 替换
- [ADR-003 OpenAI-Compatible Provider](adr/003-openai-compat-provider.md) —— 为什么统一走 openai-compatible
- [find-local-logs.md](find-local-logs.md) · [insight-debugging.md](insight-debugging.md) —— 日志定位与前缀字典
- [intranet-proxy-setup.md](intranet-proxy-setup.md) —— 内网机器访问外网的代理配置（与本篇方向相反）
