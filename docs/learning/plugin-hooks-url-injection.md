# opencode 插件钩子 × URL 无损注入

> 回答:opencode 的**插件系统**到底怎么运作?`tool.execute.before` 这类钩子在哪触发、能改什么?
> 我们怎么用一个插件、在不碰上游核心的前提下,把上传文件的精确 S3 URL 注入 MCP 工具调用?
>
> 代码在 UXAI 仓(`packages/...`);决策记录见 [ADR-014](../adr/014-url-injection-via-plugin.md),契约见 [mcp-contract.md](../specs/agents/mcp-contract.md)、[file-upload.md](../specs/infra/file-upload.md)。

---

## 0. 一句话

insight 把上传文件的 S3 URL 以 `[已上传文件]` 区块注入 session,但**让 LLM 把 URL 抄进 MCP 工具参数**这一步,内网弱模型会把转码字符改坏(`%E4%B8%AD` 的 hex 被微调、插入多余字符),MCP 拿到坏 URL 取不到文件。

解法:**模型只填 handle(`upload_1`)、绝不写 URL**;一个 opencode 插件在 `tool.execute.before` 钩子里、把工具参数交给 MCP server 之前,把 handle 换成精确 URL。URL 字符串一个字都不经过模型生成 → 腐蚀面归零。

---

## 1. opencode 插件系统总览

### 1.1 插件是什么

一个插件就是一个**函数**,接收 `PluginInput`、返回一组 **Hooks**:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (input) => {
  // input 里有 client / project / directory / $ 等
  return {
    "tool.execute.before": async (input, output) => { /* ... */ },
    "tool.execute.after":  async (input, output) => { /* ... */ },
    // ...其它钩子
  }
}
```

`Plugin` 的类型签名(`packages/plugin/src/index.ts`):

```ts
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>
```

`PluginInput` 关键字段:

| 字段 | 是什么 | 我们用到的 |
|---|---|---|
| `client` | 完整的 opencode SDK client(`createOpencodeClient` 实例) | ✅ 读 session 消息 `client.session.messages(...)` |
| `project` / `directory` / `worktree` | 当前项目 / 目录上下文 | — |
| `$` | Bun shell(跑子进程) | — |
| `serverUrl` | 本地 server URL | — |

**重点:插件能拿到 `client`**,所以它能反过来查 opencode 自己的状态(消息、session、文件等)。我们就是靠 `client.session.messages` 在钩子里读出权威 URL。

### 1.2 插件怎么被加载:两条路

opencode 加载插件有两个来源(`packages/opencode/src/plugin/index.ts`):

**A. 内置插件 `INTERNAL_PLUGINS`** — 直接 import 进数组,随 opencode 一起编译:

```ts
const INTERNAL_PLUGINS: PluginInstance[] = [
  CodexAuthPlugin,
  CopilotAuthPlugin,
  // ...
  OctoUploadInjectPlugin,   // ← 我们的插件加在这里
]
```

**B. 外部插件 `config.plugin: []`** — 在 opencode 配置里写 npm 包名或本地路径,运行时 install + 动态 import(`PluginLoader.loadExternal`)。

**我们选 A**。原因:

- 我们的插件是 octo 自有逻辑、要随 app 一起分发,没必要走 npm 安装。
- 加进 `INTERNAL_PLUGINS` 只是**一行 import + 一行数组项**,属"上游接线壳改动",不碰 opencode 的核心运行逻辑(符合"不动上游核心"约束)。
- 插件文件本身放 `packages/opencode/src/agent/octo-upload-inject.ts`,与 `octo_insight.md` 等 octo 自有资产同区。

### 1.3 所有插件共享一个 PluginInput

`packages/opencode/src/plugin/index.ts` 的 `layer` 里,集中构造一个 `PluginInput`(含 `client`),然后**对每个 `INTERNAL_PLUGINS` 调一次** `plugin(input)` 拿到它的 Hooks,push 进 `hooks` 数组。外部插件同理。所以你的插件初始化时,`client` 已经是连上本地 server 的可用实例。

---

## 2. 钩子是怎么触发的:`tool.execute.before`

### 2.1 触发点

工具执行的封装在 `packages/opencode/src/session/prompt.ts`。**内置工具**和 **MCP 工具**各有一段 `execute` 包装,两段都会触发钩子:

```ts
// MCP 工具(对每个 MCP tool 包一层)
item.execute = (args, opts) =>
  run.promise(Effect.gen(function* () {
    const ctx = context(args, opts)
    yield* plugin.trigger(
      "tool.execute.before",
      { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
      { args },                         // ← output 对象,钩子能改它
    )
    const result = yield* Effect.promise(() => execute(args, opts))  // ← 真正调 MCP,用的还是 args
    yield* plugin.trigger("tool.execute.after", { /*...*/ }, result)
    // ...
  }))
```

要点:

- **MCP 工具一样触发 `tool.execute.before`**,且是在 `execute(args, opts)`(真正发给 MCP server)**之前**。这是我们能拦下来改参数的根本前提。
- 钩子入参 `{ tool, sessionID, callID }`、出参 `{ args }`。

### 2.2 「就地改写」契约(最容易踩的点)

`plugin.trigger` 的实现(`packages/opencode/src/plugin/index.ts`)把**同一个 `output` 对象**依次传给每个钩子,**不克隆**:

```ts
const trigger = Effect.fn(function* (name, input, output) {
  for (const hook of s.hooks) {
    const fn = hook[name]
    if (fn) yield* Effect.promise(async () => fn(input, output))  // 同一 output 引用
  }
  return output
})
```

而触发点传的是 `{ args }`(一个新对象,其 `.args` 属性指向原始 `args`),之后用的是**原始 `args` 变量**。所以:

- ✅ **就地改属性** `output.args.download_links = [...]` / 改 `output.args` 内部嵌套 → 原始 `args` 看得到 → 生效。
- ❌ **整体重新赋值** `output.args = {...}` → 只换了 `output.args` 指针,原始 `args` 变量没变 → **不生效**。

记法:**只改 `output.args` 的"里面",别换 `output.args` 本身。**

---

## 3. 本案例:URL 注入插件

完整代码:`packages/opencode/src/agent/octo-upload-inject.ts`。逻辑分三步。

### 3.1 权威 URL 从哪来

页面上传后,URL 以 synthetic text part 注入 session,格式(见 [file-upload.md §注入格式](../specs/infra/file-upload.md)):

```
[已上传文件]
- 林瑞钦.docx [upload_1]: http://s3-kp-kwe.../林瑞钦.docx
```

这份文本进了 server 的 message store,**模型只读不写**,所以是**字节级精确**的权威副本。插件在钩子里用 `client` 把它读回来:

```ts
const res = await client.session.messages({ path: { id: input.sessionID } })
// 从最近一条带 [已上传文件] 区块的 user 消息,解析出 [{handle, filename, url}]
```

> 关键认知:插件**不依赖模型传来的 URL**,而是自己回查 session 拿权威 URL。模型只负责"选哪个文件"(handle),URL 的搬运完全交给代码。

### 3.2 两步改写

```ts
const map = new Map(uploads.map(u => [u.handle, u.url]))   // upload_1 -> 精确URL

// ① 与字段名无关:递归遍历 args,把任意 upload_N 就地换成 URL
replaceHandles(output.args, map)

// ② 单桶工具完整性保险:把全量 URL 覆盖进规范字段(防漏列)
if (urlField) output.args[urlField] = uploads.map(u => u.url)
```

- **① handle 替换**是主路径,**对字段名不敏感**——不管 MCP 把文件参数叫 `download_links` 还是别的,只要值是 `upload_N` 就被换掉。多角色工具(`download_links` + `outline_file_path`)的"谁是大纲/谁是逐字稿"角色映射,由模型决定、插件只换串。
- **② 字段覆盖**只对**单桶工具**(`key_findings` / `mindmap`,全部文件都是访谈稿)加,防弱模型漏列某个 handle。多角色工具不能这么覆盖(其中一个文件属 `outline_file_path`,谁是哪个得靠模型判断)。

### 3.3 为什么不直接让模型传 URL / 不改 MCP 合同

- **不靠 prompt 让模型"原样复制 URL"**:会改转码字符的弱模型,同样不会可靠遵守"逐字复制"。治标。
- **不改 MCP 合同收 `file_ref`**:跨 UXR 团队、破坏协议。插件方案让 MCP **仍收 `url`**,UXR 零改动。

详见 [ADR-014 §方案对照](../adr/014-url-injection-via-plugin.md)。

---

## 4. 踩过的坑(实测内网才暴露)

### 4.1 MCP 工具名带 server 前缀 ⚠️ 头号坑

钩子入参的 `input.tool` **不是裸工具名**。MCP 工具在 opencode 里的 id 是 `<mcp-server-key>_<tool>`,内网实测 = **`uxr-tool_key_findings`**,不是 `key_findings`。

插件最初用裸名精确匹配 → 匹配不上 → 早早 return 放行 → 没注入 → MCP 收到字面量 `upload_1` 取不到文件 → 模型回退去自己 Webfetch URL(又撞限流)。

**修法:按 bare 名"后缀 + 分隔符"匹配**:

```ts
function matchBareTool(toolId: string, bareNames: Iterable<string>): string | undefined {
  for (const name of bareNames) {
    if (toolId === name) return name
    if (toolId.endsWith(name)) {
      const prefixChar = toolId[toolId.length - name.length - 1]
      if (prefixChar && /[_.\-/:]/.test(prefixChar)) return name  // 要求前一个字符是分隔符
    }
  }
  return undefined
}
```

- 命中 `uxr-tool_key_findings` → `key_findings`;
- 校验 bare 名前一个字符是分隔符(`_./-:`),避免 `mindmap` 误中假想的 `xmindmap`。

**通用教训:任何按工具名分支的插件逻辑,都要考虑 MCP 的 server 前缀**,别假设 `input.tool` 是裸名。

### 4.2 字段名是 `download_links`,不是 `doc_urls`

早期 ADR(005/006/012)里写的 `analyze_interview(doc_urls=...)` 是工具拆分前的旧名。per-capability 工具的真实入参由 UXR 的 MCP server 自描述,2026-06-09 确认为 `download_links` / `outline_file_path`(见 [mcp-contract.md §工具入参](../specs/agents/mcp-contract.md))。

正因为入参名可能漂移,插件的**主路径(handle 替换)才刻意做成不依赖字段名**;字段名只在"单桶完整性保险"那一处用到,错了改一个常量即可。

### 4.3 插件日志在 server 进程,不在客户端 DevTools

`[octo:inject]` 是插件打的,**出在 opencode 服务进程的 console**,不在 Electron 客户端 DevTools。内网联调看不到客户端日志时别困惑——要看注入是否发生,得看 server 端日志(`bareTool` / `urlField` / `before` / `after` 字段)。已登记进 [insight-debugging.md 前缀总览](../insight-debugging.md)。

---

## 5. 自己写一个 opencode 内置插件:操作清单

1. **建文件** `packages/opencode/src/<area>/xxx.ts`,导出 `export const XxxPlugin: Plugin = async (input) => ({ "<hook>": async (i, o) => {...} })`。
2. **注册**:在 `packages/opencode/src/plugin/index.ts` import 它、加进 `INTERNAL_PLUGINS`。
3. **改 args 用就地改写**(见 §2.2),别整体重赋值。
4. **按工具名分支时**用 bare 名后缀匹配(见 §4.1),兼容 MCP 前缀。
5. **要读 opencode 状态**(消息 / session / 文件)用 `input.client.*`。
6. **打日志**记住是 server 端,前缀登记进调试手册。
7. `bun run typecheck` 过;真值要内网/真实 MCP 才能验,日志里 dump `before`/`after` 便于隔空定位。

可用钩子不止 `tool.execute.before/after`,还有 `chat.params`、`permission.ask`、`command.execute.before`、`experimental.chat.messages.transform` 等,签名都在 `packages/plugin/src/index.ts`,模式统一是 `(input, output) => Promise<void>`、**改 output 生效**。

---

## 6. 一句话总览图

```
用户上传 → 页面注入 [已上传文件](含 handle, 权威URL 存 message store)
         → 模型只填 handle(upload_N), 不碰 URL
         → MCP 工具调用前: tool.execute.before 钩子
              ├ client.session.messages 回查权威 URL
              ├ replaceHandles: args 里 upload_N → 精确URL(与字段名无关)
              └ 单桶工具: 覆盖 download_links 全量URL(完整性保险)
         → MCP 收到精确 URL, 取文件成功
```

模型永远碰不到 URL 字符串 → 弱模型再怎么手抖也改不坏它。
