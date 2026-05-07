# Spec — 设置页:Provider 配置

> 状态:草案 · 优先级 P0 · 规模 [M] · 领域 ui
>
> 前置阅读:[learning/provider-protocols.md](../../learning/provider-protocols.md)

> **上游已实现:✓(核心 dialog 全部成品)**
>
> 复用组件(来自 `@opencode-ai/app`):
> - `dialog-manage-models.tsx` — provider 列表 + model 列表 + 新增/编辑/删除
> - `dialog-custom-provider.tsx` + `dialog-custom-provider-form.ts` — 自定义 provider 表单(模板选择 + baseURL + apiKey)
> - `dialog-connect-provider.tsx` — 连接/测试连通性
> - `dialog-select-provider.tsx` — provider 选择
> - `settings-providers.tsx` — 设置页 provider 分类内容
> - `dialog-select-model.tsx` — 模型切换
>
> **Octo 端只做**:在 `OctoSidebar` / Settings 路由页加入口按钮,点击打开上述 dialog。
> **已被覆盖**:§5(UI 结构)、§9(模板数据)所描述的表单/步骤/卡片已在上游 dialog 中全部实现。§12 实施步骤 Step 2-9 不再需要自行开发——改为一行 import + 挂入口即可。
> §7(写文件机制)也由上游 opencode 配置写入流程处理,无需 Octo 自写 IPC handler。

---

## 1. 背景与目标

当前 `~/.config/octo/octo.config.json` 需要用户**手动编辑 JSON**配置 provider 和 model。痛点:

- 字段名容易拼错(`providers` vs `provider`、`apikey` vs `apiKey`)
- 不知道某个 provider 支持哪些字段
- 不知道当前配的 model 能不能连通
- 切换激活模型要改文件 + 重启

本 spec 提供 UI 化的 provider 管理,**目标是让用户不用打开 JSON 文件就能完成所有 provider 配置**。

---

## 2. 不在范围

- 多端配置同步(P3)
- API key 加密存储(P2,先用文件系统权限保护)
- 模型用量/成本统计(P3)
- Skill / MCP 的配置(其他 spec)

---

## 3. 用户故事

| ID | 故事 |
|---|---|
| U1 | 作为新用户,我打开设置页能看到"还没配置 provider,请添加一个"的清晰引导 |
| U2 | 作为新用户,我能从模板列表(Anthropic / DeepSeek / 百炼 / Gemini / 自定义)选一个,填 API key 就能用 |
| U3 | 作为已用户,我能看到已配的 provider 列表和每个 provider 下的 model 清单 |
| U4 | 作为已用户,我能修改 provider 的 baseURL / apiKey,改完按"测试连通性"验证 |
| U5 | 作为已用户,我能切换当前激活的 model(下拉选 `provider/model`),切完立即生效(可能需要重启 dev) |
| U6 | 作为已用户,我能给某个 model 加 `thinking` 选项 |
| U7 | 作为已用户,某个 provider 出错时能看到清晰的错误信息(连接失败 / 认证失败 / schema 错) |

---

## 4. 设计参考

### 业界竞品配置 provider 的方式

| 产品 | 做法 | 借鉴点 |
|---|---|---|
| Cursor | 设置页 → Models → 列出 provider 卡片,每个卡片有开关 + Edit | **卡片式 + 模板列表** |
| Continue.dev | `config.json` + UI 编辑器并存,UI 是结构化表单 | **表单 + 同步到 JSON** |
| Cherry Studio | 左栏 provider 列表 + 右栏当前 provider 详情 + model 列表 | **左右分栏** |
| Open WebUI | 设置 → Connections → 多个 OpenAI / Ollama 端点 | **测试连通性按钮** |
| Anthropic Claude Desktop | 没有 UI,纯 JSON | (反例,我们要做更好) |

**Octo 选用**:**左右分栏**(参考 Cherry Studio)+ **模板列表**(参考 Cursor)+ **测试连通性**(参考 Open WebUI)。

---

## 5. UI 结构

### 5.1 设置页整体导航

设置页本身是一个分栏布局,左侧分类导航:

```
┌─ 设置 ──────────────────────────────────────────────┐
│  ┌─ 导航 ─┐  ┌─ 内容区 ──────────────────────────┐  │
│  │ 模型   │  │                                  │  │
│  │ 技能   │  │      (当前选中分类的内容)         │  │
│  │ MCP    │  │                                  │  │
│  │ 外观   │  │                                  │  │
│  │ 关于   │  │                                  │  │
│  └────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

本 spec 关注的是"模型"分类。

### 5.2 模型分类内 — 左右分栏

```
┌─ 模型 ─────────────────────────────────────────────────┐
│  当前激活:[ bailian / qwen3-coder-plus ▾ ]            │  ← 顶部 model 切换
│                                                        │
│  ┌─ Provider 列表 ──┐  ┌─ Provider 详情 ────────────┐  │
│  │ + 添加 provider  │  │  Provider ID: bailian      │  │
│  │                  │  │  npm: @ai-sdk/anthropic    │  │
│  │ ● bailian        │  │  Base URL: [           ]   │  │
│  │   anthropic 兼容 │  │  API Key:  [********] 显示 │  │
│  │                  │  │                            │  │
│  │ ○ deepseek       │  │  [ 测试连通 ]  [ 删除 ]    │  │
│  │   openai 兼容    │  │                            │  │
│  │                  │  │  ─── Models ───────────── │  │
│  │ ○ anthropic      │  │  + 添加 model              │  │
│  │   anthropic 直连 │  │                            │  │
│  └──────────────────┘  │  ▸ qwen3-coder-plus       │  │
│                        │  ▸ glm-5  thinking ✓      │  │
│                        └────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 5.3 添加 provider 流程

点 `+ 添加 provider` 弹模态:

**Step 1 — 选模板**

```
┌─ 添加 Provider ─────────────────────┐
│  从模板创建:                        │
│  ○ Anthropic                        │
│  ○ OpenAI                           │
│  ○ DeepSeek                         │
│  ○ Google Gemini                    │
│  ○ 阿里百炼 (Anthropic 兼容)        │
│  ○ 阿里百炼 (OpenAI 兼容)           │
│  ○ Moonshot                         │
│  ○ 智谱 GLM                         │
│  ○ 自定义 OpenAI 兼容                │
│  ○ 自定义 Anthropic 兼容             │
│                                     │
│         [ 取消 ]  [ 下一步 ]        │
└─────────────────────────────────────┘
```

**Step 2 — 填字段**(根据模板预填 baseURL 和 npm)

```
┌─ 添加 Provider — DeepSeek ──────────┐
│  Provider ID:  [ deepseek          ]│  自动生成,可改
│  Base URL:     [ https://api.deep..]│  模板预填,可改
│  API Key:      [                   ]│  必填
│                                     │
│  [ 取消 ]  [ 上一步 ]  [ 添加 ]    │
└─────────────────────────────────────┘
```

填完点添加,**先做连通性测试**(GET `${baseURL}/models` 或同等端点),通过才落盘 + 关闭模态。

### 5.4 添加 model 流程

每个 provider 详情下点 `+ 添加 model` 弹小模态:

```
┌─ 添加 Model — bailian ──────────────┐
│  Model ID:        [               ]│  必填,如 qwen3-coder-plus
│  显示名:          [               ]│  必填,如 Qwen3 Coder Plus
│  上下文窗口:      [ 1000000       ]│  数字,token
│  最大输出:        [ 65536         ]│
│                                     │
│  ☐ 启用思考链 (thinking)            │  勾上展开 budget tokens 输入
│      Budget tokens: [ 8192        ]│
│                                     │
│  [ 取消 ]  [ 添加 ]                │
└─────────────────────────────────────┘
```

### 5.5 切换激活模型

页顶部下拉:

```
当前激活:[ bailian / qwen3-coder-plus ▾ ]
         ┌──────────────────────────────┐
         │ bailian                      │
         │   ✓ qwen3-coder-plus         │
         │     glm-5                    │
         │ deepseek                     │
         │     deepseek-chat            │
         │     deepseek-reasoner        │
         └──────────────────────────────┘
```

切换后立即写入 `config.json` 的 `model` 字段,弹 toast 提示"已切换,可能需要重启对话生效"。

---

## 6. 连通性测试逻辑

点"测试连通"按钮:

1. UI loading 状态
2. 后端走 opencode 的 `/provider` 路由(GET 当前 provider 信息) 或 直接构造一个 1 token 的最小请求
3. 成功 → 绿色 ✓ + "连接正常"
4. 失败 → 红色 ✗ + 具体错误:
   - `401/403` → "认证失败,检查 API Key"
   - `404` → "endpoint 错误,检查 Base URL(常见:多写或漏写 /v1)"
   - `5xx` → "服务端错误,稍后重试"
   - 网络超时 → "无法连接,检查网络或代理"
   - 其他 → 展示原始错误消息

---

## 7. 写文件机制

### 7.1 写盘策略

- 任何"添加 / 编辑 / 删除"操作 → **立即写盘** `~/.config/octo/octo.config.json`
- 写之前**保留备份** `octo.config.json.bak`(覆盖,只留最近一份)
- 写盘失败(权限/磁盘满)→ 弹错误对话框,不修改内存状态

### 7.2 文件读取入口

- 设置页打开时,通过 IPC 让 main 进程 `readFile` 配置文件
- main 进程 expose 两个 IPC handler:
  - `octo:config:read` → 返回 `{ raw: string, parsed: object }`
  - `octo:config:write` → 写盘 + 备份 + 返回 `{ ok: boolean, error?: string }`

### 7.3 跟 opencode 后端的同步

opencode 后端读配置是启动时一次性读,**不支持热重载**(见 [learning/opencode-internals.md §9](../../learning/opencode-internals.md#9-切换-provider-不会热重载))。

UI 写完配置后:

- toast 提示"配置已保存。新会话将使用新配置"
- 下次创建 session 时使用新配置(opencode 内部会重新读 model 字段)
- 如果是改了 provider 本身(baseURL/apiKey)而不是 model,**真的需要重启 dev** —— UI 给"重启"按钮(走 main 进程 `app.relaunch()`)

---

## 8. 数据模型

UI 内部状态结构(用 `ref` 即可,不用 Pinia):

```typescript
interface ProviderConfig {
  id: string                              // bailian
  npm: string                             // @ai-sdk/anthropic
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  models: Record<string, ModelConfig>
}

interface ModelConfig {
  id: string                              // qwen3-coder-plus
  name: string                            // 显示名
  contextLimit?: number
  outputLimit?: number
  thinking?: { enabled: boolean; budgetTokens: number }
  // 其他扩展 options
}

interface OctoConfig {
  $schema: string
  provider: Record<string, ProviderConfig>
  model: string                           // bailian/qwen3-coder-plus
  // skill / mcp / agent 字段在其他 spec
}
```

---

## 9. 模板数据

模板列表硬编码在前端代码里(`packages/octo-ui/src/data/provider-templates.ts`):

```typescript
export const PROVIDER_TEMPLATES = [
  {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    defaultBaseURL: undefined,            // 用 SDK 默认
    docsURL: "https://console.anthropic.com/",
    apiKeyHint: "sk-ant-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseURL: "https://api.deepseek.com/v1",
    docsURL: "https://platform.deepseek.com/",
    apiKeyHint: "sk-...",
  },
  {
    id: "bailian-anthropic",
    name: "阿里百炼 (Anthropic 兼容)",
    npm: "@ai-sdk/anthropic",
    defaultBaseURL: "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
    docsURL: "https://help.aliyun.com/zh/model-studio/",
    apiKeyHint: "sk-...",
  },
  // ... 其他模板
]
```

每个模板给"添加 provider"流程预填 npm 和 baseURL。

---

## 10. 设计 Token 风格(预告,详细在 octo-ui-redesign spec)

本 spec 不重复定义颜色/间距/字体。所有视觉细节用 `tokens.css` 的 semantic 层变量:

- 背景:`--bg-app`、`--bg-elevated`(provider 卡片)、`--bg-input`
- 文字:`--text-primary`(标题)、`--text-secondary`(描述)、`--text-muted`(hint)
- 边框:`--border`(常态)、`--border-input`(focus)、`--border-error`(校验失败)
- 强调色:`--accent`(按钮、active 项)、`--accent-hover`、`--success`、`--danger`

参考设计师包(`/Users/huowenkai/Desktop/projects/Octo-AI-UI/octo-client-shell`)的浅色主题。

---

## 11. 验收标准

| # | 标准 |
|---|------|
| 1 | 全新机器(无 `~/.config/octo/`)打开设置页,看到"添加你的第一个 provider"引导,点击进入模板列表 |
| 2 | 从 5 个模板中任选一个,填 API key,"添加"后按钮变 loading,2 秒内反馈成功/失败 |
| 3 | 添加成功后 provider 出现在左栏,自动选中,右侧详情可见已填字段 |
| 4 | 在 provider 详情下添加 model,model 出现在 model 列表 |
| 5 | 切换激活模型,`config.json` 的 `model` 字段立即变化 |
| 6 | 编辑 provider 的 baseURL/apiKey,点"测试连通"反馈结果 |
| 7 | 删除 provider 弹确认对话框,确认后从列表消失,`config.json` 中对应字段被移除 |
| 8 | 启用 thinking 选项,`config.json` 中该 model 的 `options.thinking` 字段正确生成 |
| 9 | 关闭 octo 重开,设置页能正确加载之前的所有配置 |
| 10 | `~/.config/octo/octo.config.json.bak` 文件存在,内容是上一次写盘前的状态 |

---

## 12. 实现步骤建议

1. **Step 1**:main 进程加 IPC handler `octo:config:read` / `octo:config:write` / `octo:config:test-connection`(后两个先做最简实现)
2. **Step 2**:`packages/octo-ui/src/data/provider-templates.ts` 落地模板数据
3. **Step 3**:重写 `SettingsView.vue` 改为分栏(左导航 + 右内容)
4. **Step 4**:实现 model 分类页:provider 列表组件 + provider 详情组件
5. **Step 5**:实现"添加 provider"模态(2 步表单)
6. **Step 6**:实现"添加 model"模态
7. **Step 7**:实现"测试连通"按钮(初版可以发个 1-token 请求看 200/4xx)
8. **Step 8**:激活 model 切换器(顶部下拉)
9. **Step 9**:错误处理 + toast 提示
10. **Step 10**:验收

---

## 13. 风险与待定

| 项 | 风险 | 缓解 |
|---|---|---|
| API Key 明文存储 | 配置文件有 chmod 600 但仍是明文 | P2 用 keytar / electron-safe-storage 加密 |
| 测试连通的最小请求 | 不同 provider 端点不同(Anthropic 没 `/models` 列表) | 用各 provider 各自的最小 endpoint;失败时 fallback 一个 1-token 实际请求 |
| 备份文件被覆盖 | 用户改错多次后 .bak 也是错的 | P2 加多版本备份(.bak.1, .bak.2) |
| 写文件失败回滚 | 写一半挂了,文件被破坏 | 先写到临时文件 + 原子 rename |
