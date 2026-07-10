# turn 级工具 gate:opencode 原生的 per-message `tools` 参数

> 背景:SPEC-INS-017 §3 方案 A 要求「非 chip turn 模型根本看不到 MCP 业务工具」。实现落点调研时预设了三个候选(registry gate / plugin 钩子 / 预置提示词元数据),结果发现**上游本来就有现成机制**,零改动可用。本文记录该机制的完整链路与副作用,以及调研时差点走弯路的地方。

## 机制:`tools: Record<string, boolean>` 随消息走

`session.prompt` / `session.promptAsync` 的请求体里有一个可选字段:

```ts
tools?: { [toolKey: string]: boolean }
```

它的生命周期:

1. **随请求进来**:`PromptInput` schema 定义(`session/prompt.ts`),SDK v2 client 的 `promptAsync` 参数原生暴露;`promptAsync` 的 handler 直接 `promptSvc.prompt({ ...payload })`,与同步 prompt 同路。
2. **存到 user 消息上**:`createUserMessage` 把它写进 `MessageV2.User.tools` —— 也就是说这是**消息属性**,不是请求瞬态。
3. **每个 loop step 生效**:`runLoop` 每步组工具集时把 `lastUser.tools` 传给 `resolveTools`;最终在 `session/llm.ts` 的模块级 `resolveTools` 里过滤:

```ts
// session/llm.ts
return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
```

语义要点:

- **只有显式 `false` 才隐藏**;`true` / 缺省都可见。所以「gate 掉 5 个业务工具」= 每次发送带 `{ "uxr-tool_key_findings": false, … }`。
- 过滤发生在**发给模型的工具列表**层面 —— 模型的 request payload 里根本没有这个 tool 定义,不是"能看到但被拒绝执行",误触发为 0。
- 作用域天然是 **turn 级**:下一条 user 消息有自己的 `tools`(或没有),互不残留……但有一个例外,见下。
- 上游自己就在用:`octo_studio` 的图像生成模式(`STUDIO_IMAGE_TOOLS`)靠同一个 `lastUser.tools` 做工具集切换 —— 这是"该机制可长期依赖"的最好证据。

MCP 工具的 key 带 server 前缀:`<sanitize(server)>_<tool>`(`mcp/index.ts`),uxr 即 `uxr-tool_key_findings` 等。`sanitize` 保留连字符。

## 副作用(也是兜底):`tools` 会被转成 session.permission 持久化

`prompt()` 里有一段容易被忽略的逻辑:

```ts
// session/prompt.ts prompt()
for (const [t, enabled] of Object.entries(input.tools ?? {})) {
  permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
}
if (permissions.length > 0) {
  session.permission = permissions   // 覆盖式写入,并持久化到 DB
}
```

也就是说 `tools` 有**双重效果**:

1. `user.tools[k] !== false` —— 本消息的工具可见性(上面讲的主机制);
2. 转成 session 级 permission 规则 —— `deny` 同样会让 `Permission.disabled` 把工具从模型工具集里滤掉,且**跨 turn 存续,直到下一次带非空 `tools` 的请求整体覆盖它**。

对 insight 的含义:

- 客户端**每次发送都带 gate**(chip turn 放行选中工具、非 chip turn 全 `false`),session.permission 逐 turn 被覆盖,无残留问题;
- 万一某条路径漏传 `tools`(比如未来新增的发送入口),上一轮的 deny 还在 —— **漏传的失败模式是"工具仍被隐藏"而不是"工具意外暴露"**,方向安全;
- chip turn 的 `allow` 规则顺带让该 MCP 工具的执行审批(`ctx.ask`)自动通过,少一次弹窗,是白捡的。

注意这个持久化也意味着:**用别的客户端(或裸 API)往同一 session 发消息,看到的工具集受上一轮 gate 影响**。调试时如果发现"MCP 工具怎么不见了",先查 session.permission 是不是上一轮写进去的 deny。

## 调研时的弯路提醒

1. **别去 `ToolRegistry.tools` 找 gate 点**:registry 层的过滤(如 `extract_document` 只给 octo_insight)是 **agent 级**、不区分 turn;turn 级信息(本条消息是否 chip)在那里拿不到。
2. **别被 `resolveTools` 重名骗了**:`session/prompt.ts` 里有个 `resolveTools`(组装工具 + 挂 execute 钩子),`session/llm.ts` 里另有一个模块级 `resolveTools`(按 permission + user.tools 过滤)。真正的 turn 级过滤在**后者**;前者接收了 `input.tools` 但并不消费它。
3. **agent 定义里没有 turn 级开关**:`agent.ts` 的 `mcp: ["uxr-tool"]` 绑定决定"工具在不在册"(server 前缀过滤,`mcp.toolsForAgent`),必须保留,否则 chip turn 也无工具可放行;可见性收窄交给 per-message `tools`。
4. `.md` frontmatter 的 `tools:` 列表(octo_insight.md)**不参与运行时**——octo_insight 的 agent 定义硬编码在 `agent.ts`,`.md` 是人工编辑源、`.txt` 是 import 变体(见 [agent-deploy.md](agent-deploy.md) / specs/infra/agent-config-deploy.md)。摘工具改 frontmatter 只是文档层面的同步,真正的摘除靠 gate。

## 关联

- [SPEC-INS-017](../specs/infra/insight-mcp-explicit-entry.md) §3(方案 A 采用记录)、§8(实现记录)
- [tools-and-permissions.md](tools-and-permissions.md)(agent 工具白名单与权限规则总览)
- [plugin-hooks-url-injection.md](plugin-hooks-url-injection.md)(同一条工具调用链上的 `tool.execute.before` 注入层)
