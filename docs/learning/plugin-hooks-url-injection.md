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

## 3. 本案例:URL 注入插件(纯 handle→URL 解析器)

完整代码:`packages/opencode/src/agent/octo-upload-inject.ts`。

### 3.1 两个输入源(最关键的认知)

插件有**两个不同来源的输入**,别混:

| 数据 | 来源 | 内容 |
|---|---|---|
| **权威 URL 总表**(全部文件 handle→url) | **session 消息里的 `[已上传文件]` 区块** | 字节级精确的 url 原文,**模型从不经手** |
| **要替换哪些 handle** | **工具调用参数 args** | 只有模型挑中的那几个 handle |

页面上传后,URL 以 synthetic text part 注入 session(`- <文件名> [upload_<8hex>]: <url>`,见 [file-upload.md §注入格式](../specs/infra/file-upload.md))。这份文本进 message store、**模型只读不写**,是权威副本。插件用 `client` 把它读回来、**聚合整个 session 的所有区块**建表:

```ts
const res = await client.session.messages({ path: { id: input.sessionID } })
// 遍历所有 user 消息的所有 [已上传文件] 区块, parse 后 map.set(handle, url)
```

> 为什么聚合"所有"区块而非"最近一条":用户可以**分多轮上传**(任务书一轮、逐字稿一轮),每轮一个区块,合起来才是全部文件。只读最近一条会漏掉前几轮的文件。

### 3.2 一步替换(纯解析器)

```ts
if (!hasHandle(output.args)) return            // 早退:args 没 handle 形态串就不拉消息(非文件工具零开销)
const map = /* 聚合 session 所有区块 */
replaceHandles(output.args, map)               // 递归就地把 args 里的 handle 换成 url
```

`replaceHandles` 递归遍历 args,凡是值 `map.has(v)` 的字符串就换成对应 url。**只替换模型明确引用的 handle,不自作主张注入"全部文件"**——谁是哪类文件的角色归属完全由模型按文件名决定,插件不越权。

- **不按工具名分支**:不管 MCP 把工具叫 `key_findings` 还是 `uxr-tool_key_findings`,插件都一样处理。
- **不碰字段名**:不管文件参数叫 `download_links` 还是别的,只要值是已知 handle 就换。
- **不做"全量覆盖"**:早期版本对单桶工具会把全量 url 覆盖进 `download_links`,在多轮 / 一个 session 多次分析时会错注他轮文件(见 §4),已废弃。

### 3.3 handle 必须全局唯一稳定

handle 由**文件 URL 派生**(`upload_` + FNV-1a 8 位 hex,在 `upload.ts` 的 `uploadHandle`),不是按 turn 的顺序号。原因见 §4.1——顺序号跨 turn 会撞。URL 派生 → 同一文件永远同一 handle、跨 turn 不撞、刷新不变。插件对 token 形态不挑,只按 session 区块建的表来认(`map.has`)。

### 3.4 为什么不直接让模型传 URL / 不改 MCP 合同

- **不靠 prompt 让模型"原样复制 URL"**:会改转码字符的弱模型,同样不会可靠遵守"逐字复制"。治标。
- **不改 MCP 合同收 `file_ref`**:跨 UXR 团队、破坏协议。插件方案让 MCP **仍收 `url`**,UXR 零改动。
- **为什么"只能"靠模型选文件**:多角色工具的角色映射(任务书 vs 逐字稿)是语义判断只有模型能做;"这次用哪些文件"也没法在代码里安全推断(多轮/多分析场景"全部上传"≠"这次要用")。模型本就在 loop 里要挑文件,handle 只是把它要传的从易碎 URL 换成安全 token。

详见 [ADR-014](../adr/014-url-injection-via-plugin.md)。

---

## 4. 踩过的坑(实测内网才暴露)

> 这套设计是迭代出来的:首版有更多"聪明"逻辑(按工具名匹配、单桶全量覆盖、顺序号 handle),内网验证逐一暴露问题,最后收敛成 §3 的"纯解析器"。下面按踩坑顺序记。

### 4.1 顺序号 handle 跨 turn 撞号 ⚠️ 驱动重设计的头号坑

首版 handle 是**按 turn 的顺序号** `upload_1/2/…`,`formatUploadsForPrompt` 每次发送只处理本 turn 附件、从 1 重排。于是用户**分多轮上传**时:

- turn1 传任务书 → `upload_1 = 任务书`
- turn2 传逐字稿 → `upload_1 = 逐字稿`(又从 1 开始!)

模型看到两个区块里 `upload_1` 指向不同文件 → 判定「之前的 upload_1 已被替换为逐字稿」→ 以为任务书丢了,**对话层就崩,还没到工具调用**。

**修法:handle 从文件 URL 派生(`upload_<8hex>`)、全局唯一稳定**——同一文件永远同一 handle,跨 turn 不撞、刷新不变。配套:插件**聚合整个 session 的所有区块**(首版只读最近一条,也会漏掉前几轮文件)。

**通用教训:任何"占位符 ↔ 真实值"的映射,占位符必须在它的可见范围内全局唯一稳定**;按局部序号编号,一旦范围扩大(多 turn)就撞。

### 4.2 单桶"全量覆盖"在多分析场景错注

首版对单桶工具做过"把全部已上传 url 覆盖进 `download_links`"的完整性保险。但一个 session 里可能**先传 A 跑一次、再传 B 跑一次**,"全部已上传"≠"这次要用",覆盖会把 A 的文件错塞进 B 的调用。

**修法:去掉覆盖,插件只替换模型明确引用的 handle**(§3.2)。哪些文件属于这次调用,是模型的判断,代码别越权。

### 4.3 MCP 工具名带 server 前缀(首版按工具名匹配才会踩)

钩子入参的 `input.tool` **不是裸工具名**:MCP 工具在 opencode 里的 id 是 `<mcp-server-key>_<tool>`,内网实测 = **`uxr-tool_key_findings`**,不是 `key_findings`。首版用裸名精确匹配 → 匹配不上 → 放行不注入 → MCP 收到字面量 handle 取不到文件。

当时的修法是按 bare 名"后缀+分隔符"匹配。但**纯解析器(§3.2)根本不按工具名分支,这个坑直接消失**。

**通用教训保留:任何按工具名分支的插件逻辑,都要考虑 MCP 的 server 前缀**,别假设 `input.tool` 是裸名;能不按工具名分支就别分支。

### 4.4 字段名 `download_links`(首版按字段覆盖才会依赖)

早期 ADR(005/006/012)的 `doc_urls` 是工具拆分前旧名;真实入参 2026-06-09 确认为 `download_links` / `outline_file_path`(见 [mcp-contract.md §工具入参](../specs/agents/mcp-contract.md))。首版"全量覆盖"依赖这个字段名;纯解析器只认 handle 不认字段名,**也不再依赖**。

### 4.5 插件日志在 server 进程,不在客户端 DevTools

`[octo:inject]` 是插件打的,**出在 opencode 服务进程的 console**,不在 Electron 客户端 DevTools。内网联调看不到客户端日志时别困惑——要看注入是否发生,得看 server 端日志(`changed` / `knownHandles` / `before` / `after` 字段)。已登记进 [insight-debugging.md 前缀总览](../insight-debugging.md)。

---

## 5. 自己写一个 opencode 内置插件:操作清单

1. **建文件** `packages/opencode/src/<area>/xxx.ts`,导出 `export const XxxPlugin: Plugin = async (input) => ({ "<hook>": async (i, o) => {...} })`。
2. **注册**:在 `packages/opencode/src/plugin/index.ts` import 它、加进 `INTERNAL_PLUGINS`。
3. **改 args 用就地改写**(见 §2.2),别整体重赋值。
4. **能不按工具名分支就别分支**(见 §4.3);非要分支时按 bare 名后缀匹配、兼容 MCP `<server>_<tool>` 前缀。
5. **要读 opencode 状态**(消息 / session / 文件)用 `input.client.*`;先用便宜的本地判断早退(如本插件 `hasHandle(args)`),别每次工具调用都拉消息。
6. **打日志**记住是 server 端,前缀登记进调试手册。
7. `bun run typecheck` 过;真值要内网/真实 MCP 才能验,日志里 dump `before`/`after` 便于隔空定位。

可用钩子不止 `tool.execute.before/after`,还有 `chat.params`、`permission.ask`、`command.execute.before`、`experimental.chat.messages.transform` 等,签名都在 `packages/plugin/src/index.ts`,模式统一是 `(input, output) => Promise<void>`、**改 output 生效**。

---

## 6. 一句话总览图

```
用户上传(可分多轮) → 页面注入 [已上传文件](每文件一个全局唯一 handle, 权威URL 存 message store)
         → 模型只填 handle(upload_<hex>), 不碰 URL; 自己按文件名分角色/挑文件
         → 任意工具调用前: tool.execute.before 钩子
              ├ hasHandle(args)? 否 → 早退(非文件工具零开销)
              ├ client.session.messages 聚合整个 session 所有区块 → handle→url 总表
              └ replaceHandles: args 里出现的 handle → 精确URL(不认工具名/字段名)
         → MCP 收到精确 URL, 取文件成功
```

模型永远碰不到 URL 字符串 → 弱模型再怎么手抖也改不坏它。插件只做"已知 handle → url"的机械替换,不猜工具、不猜字段、不猜该用哪些文件。
