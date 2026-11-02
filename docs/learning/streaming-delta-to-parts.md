# 流式响应怎么变成消息块:帧与块、块边界推断,以及「是上游还是 agent」怎么判定

> 前置阅读:[provider-protocols.md](provider-protocols.md)(三大协议家族的**请求**格式)、[reasoning-output-formats.md](reasoning-output-formats.md)(思考文本**放在哪个字段**)。本文讲这两篇都没覆盖的一层:**流式推过来的一小段一小段数据,是怎么被拼成一个个消息块的**,以及块拼错时怎么判定问题出在哪一方。

---

## 1. 背景与结论

**现象**(2026-10):内网新接入的 `maas-glm-5.3` 在 insight 里把一段连续的思考渲染成几十个「已深度思考」折叠块,每块只有几个词;重新进入这类会话明显卡顿。同一页面上外网 DeepSeek 和内网其他模型都正常。

**对照数据**(`octoDebug.dump()`):

| | 一条 assistant 消息的 parts |
|---|---|
| 外网 DeepSeek | 2 个:1 个 `reasoning` + 1 个 `text` |
| 内网 `maas-glm-5.3` | **989 个**,几乎全是 `reasoning`,每个 `text` 只有几个字(`'用的网页'`、`'登录页，还是'`、`' Harmony'` …) |

**原始流**(绕过 agent 直接请求网关):每一帧都是这个形状——

```json
"delta": {"content": null, "reasoning_content": " user is asking in", "role": "assistant", "tool_calls": []}
```

**结论**:两方各占一半。

- **上游**:该模型服务端在每个思考帧里都带了 `"tool_calls": []`。这偏离了 OpenAI 和 DeepSeek 的通行做法(它们不调工具时不带这个字段),但空数组在协议 schema 上合法,不算违反协议。
- **agent 侧**:我们锁定的 `@ai-sdk/openai-compatible` 2.0.41 把空数组也当成「工具调用开始」,于是每帧都结束一次思考块。上游 SDK 已经承认这是自己的 bug,在 **2.0.75** 修复(changelog `f3c1980: keep reasoning streams contiguous when deltas include empty tool call arrays`)。

**处理**:升级到 2.0.75(UXAI PR #1049),内网打包后实测恢复正常。升级只作用于新生成的内容,已经落库的碎片会话不会被合并,让用户删除即可。

> 排查中途走过一次弯路:网页搜索没有找到上游结论,就先按「模型不规范、我们不做适配」来推。后来直接翻 SDK 的 changelog,才发现上游早已修复。教训写进了 §6 的第 5 步。

---

## 2. 解析发生在哪一层

insight 不解析模型返回,opencode 也不直接解析。整条链路是:

```
模型网关 HTTP 响应(SSE 字节流)
  → Vercel AI SDK 的 provider 包                 ← 真正「解析协议」的地方
      @ai-sdk/openai-compatible / @ai-sdk/anthropic / …
      按 provider 配置里的 npm 字段选用哪个包
  → AI SDK 统一事件流
      reasoning-start / reasoning-delta / reasoning-end
      text-start / text-delta / text-end
      tool-input-start / tool-input-delta / tool-call …
  → opencode session/processor.ts:事件 → MessageV2 Part(存 SQLite + 推 SSE 给前端)
  → @opencode-ai/ui:一个 ReasoningPart 渲染成一个「已深度思考」块
```

三个推论:

1. 「按业界标准结构适配」说的是 **provider 包**按协议适配,而且用哪个包由**配置**决定,不是模型自己声明的;
2. 同一个 provider 包下,一个模型异常、其他模型正常,问题一定出在**这个模型的输出**和**这个包的处理规则**的交集上,和 insight 的页面代码无关;
3. provider 包是第三方依赖,它的行为由**版本**决定。所以「agent 侧有没有问题」里包含一个常被忽略的子问题:**我们用的版本是不是太旧了**。

---

## 3. 帧与块:流式不等于碎片

这是这次最容易想岔的地方:「模型本来就是一个字一个字流式输出的,那内网模型这种一段一个块,是不是才是对的?外网 DeepSeek 显示成完整的块,是不是其实是一次性输出完的?」

不是。两个模型**都是流式的**。区别不在「是不是流式」,而在「流式推过来的片段被装进了几个块」。这里有两个不同层次的东西:

| | 帧(delta) | 块(part) |
|---|---|---|
| 是什么 | 网络上一次推过来的一小段,如 `"想要一个通"` | 界面上的一个「已深度思考」或一段正文 |
| 属于哪一层 | **传输**单位 | **内容**单位 |
| 数量由什么决定 | 模型生成速度、网关攒批策略 | 内容的语义段数:一段思考、一段正文、一次工具调用 |

正常情况是**很多帧往同一个块里追加**。server 推给前端的事件是 `message.part.delta { partID: X, delta: "想要一个通" }`,意思是「往块 X 后面接上这几个字」,而不是「新建一个块」。

```
DeepSeek(正常)
帧1  reasoning "用户要"       → 新建块 R1,写入
帧2  reasoning "一个登录页"   → 追加到 R1
…    (几百帧)               → 都追加到 R1
帧N  content  "好的,"        → R1 结束,新建块 T1
最终:2 个块

maas-glm-5.3 + SDK 2.0.41(异常)
帧1  reasoning "想要一个通" + tool_calls: [] → 新建 R1,写入,随即被结束
帧2  reasoning "用的网页"   + tool_calls: [] → R1 已结束,只能新建 R2
…
最终:989 个块,每块内容正好是一帧
```

类比:在 Word 里一个字一个字地打一段话,文档里还是**一个段落**。异常情况相当于每打几个字就按一次回车——每个字确实是实时打出来的,但段落全碎了。

**判断标准:块的数量应该等于内容的语义段数,和帧的数量无关。** 协议本身也是这么定义的:Anthropic 流式协议用 `content_block_start` 开一个块,中间连续推很多个 `delta`,最后 `content_block_stop` 收尾(见 §4)。

### 为什么 dump 让人误以为 DeepSeek 是一次性输出的

`octoDebug.dump()` 是**生成结束后的快照**,只能看到最后装成了几个块,看不到块是怎么长大的。要看「过程」,有三种办法:

1. **肉眼**:生成过程中思考块里的文字是逐渐长出来的,不是突然整段出现;
2. **Console 事件日志**:默认模式下持续打印 `[octo:event] message.part.delta ×聚合`,`entries` 里有 `partID` 和 `count`。正常模型从头到尾只有少数几个 partID 反复出现、`count` 不断累加;异常时会冒出几百个不同的 partID,每个 `count` 只有 1 左右;
3. **块的持续时间**:

   ```js
   const ps = [...octoDebug.dump().parts["<msgID>"]]
   ps.filter(p => p.type === "reasoning").map(p => p.time.end - p.time.start)
   ```

   正常模型只有一个数,在几十秒量级;异常时是几百个毫秒级的小数。

> Console 小坑:一次粘贴多行代码,Console 只回显**最后一个表达式**的结果。想同时看多个值,把它们包进一个对象再输出:`({ count: c, texts: ... })`。

---

## 4. 业界流式协议:块边界是显式的还是推断的

非流式响应里,思考、正文、工具调用各在各的字段里,不存在「边界」问题。流式才有问题:客户端要判断「这一片属于哪一块、这一块什么时候结束」。各协议的根本差别就在这里。

### 4.1 OpenAI Chat Completions(`/v1/chat/completions`)——推断

国内绝大多数模型和网关都走它。每帧一个 `data:` 行,内容是 `choices[0].delta`,**delta 里有什么字段就代表这一帧推了什么**:

```
data: {"choices":[{"delta":{"role":"assistant"}}]}
data: {"choices":[{"delta":{"reasoning_content":"用户要一个"}}]}
data: {"choices":[{"delta":{"reasoning_content":"登录页"}}]}
data: {"choices":[{"delta":{"content":"好的,"}}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

**协议里没有「块开始 / 块结束」帧**。客户端只能看「这一帧出现了什么字段」来推断:一直在推 `reasoning_content`,突然出现 `content`,就推断思考结束、正文开始。OpenAI 官方的行为是**这一帧没有的东西就不带这个字段**(或者给 `null`)。

> `reasoning_content` / `reasoning` 本身不是 OpenAI 官方字段,是 DeepSeek / OpenRouter 生态的扩展,见 [reasoning-output-formats.md](reasoning-output-formats.md)。

### 4.2 Anthropic Messages(`/v1/messages`)——显式

```
event: content_block_start   data: {"index":0,"content_block":{"type":"thinking"}}
event: content_block_delta   data: {"index":0,"delta":{"type":"thinking_delta","thinking":"用户要一个"}}
event: content_block_delta   data: {"index":0,"delta":{"type":"thinking_delta","thinking":"登录页"}}
event: content_block_stop    data: {"index":0}
event: content_block_start   data: {"index":1,"content_block":{"type":"text"}}
…
```

服务端**明确告诉**客户端「第 0 块是思考,现在结束了」。

### 4.3 OpenAI Responses(`/v1/responses`)——显式

`response.output_item.added` / `response.output_item.done` 包住每个 output item(reasoning / message / function_call)。国内兼容网关很少实现。

### 4.4 Google Gemini(`streamGenerateContent`)——推断

每帧是 `candidates[0].content.parts[]`,思考 part 带 `thought: true`,没有显式的 start/stop。

### 小结

| 协议 | 块边界 | 服务端多带一个字段的后果 |
|---|---|---|
| OpenAI Chat Completions | **推断** | 可能被误判成块切换 |
| Anthropic Messages | 显式 | 只有服务端真的多开了块才会多出块 |
| OpenAI Responses | 显式 | 同上 |
| Gemini | **推断** | 可能被误判 |

**推断式协议对多余字段很敏感**:服务端在不该出现某个字段的帧里塞了它(哪怕是空数组、空白字符串),客户端的推断规则就可能被触发。所以「客户端对边缘写法有多宽容」直接决定了兼容性,而这正是 SDK 版本之间会变化的东西。

---

## 5. AI SDK 怎么推断边界

### 5.1 openai-compatible:哪些字段会结束当前思考块

流式 transform 的核心逻辑(简化):

```js
const reasoningContent = delta.reasoning_content ?? delta.reasoning
if (reasoningContent) {                    // 非空字符串才算
  if (!isActiveReasoning) { emit("reasoning-start", "reasoning-0"); isActiveReasoning = true }
  emit("reasoning-delta", "reasoning-0", reasoningContent)
}
if (delta.content) {                       // 非空字符串才算——" " 和 "\n" 也算
  if (isActiveReasoning) { emit("reasoning-end", "reasoning-0"); isActiveReasoning = false }
  …text-start / text-delta
}
if (delta.tool_calls != null) {            // ≤2.0.74:空数组 [] 也算
//  delta.tool_calls != null && delta.tool_calls.length > 0   ← 2.0.75 起
  if (isActiveReasoning) { emit("reasoning-end", "reasoning-0"); isActiveReasoning = false }
  …tool-input-start / …
}
// 流结束(flush)时:还开着的 reasoning / text 各补一个 end
```

| delta 里的字段 | 2.0.41 结束思考块? | 2.0.75+ 结束思考块? |
|---|---|---|
| `content: "正文"` | ✅ 正常的思考 → 正文切换 | ✅ |
| `content: " "` / `"\n"`(纯空白) | ✅ 空白也是真值 | ✅ **至今仍会** |
| `content: ""` / `null` / 不出现 | ❌ | ❌ |
| `tool_calls: [{…}]` | ✅ 正常的思考 → 工具调用切换 | ✅ |
| `tool_calls: []` | ✅ **本次的 bug** | ❌ 已修复 |
| `tool_calls: null` / 不出现 | ❌ | ❌ |

注意「纯空白 content」这一行:新版 SDK 仍会把它当成正文开始。如果以后遇到某个模型在思考帧里带 `"content": "\n"`,会出现同样的碎块症状,而且 dump 里会多出一个内容全是空白的 text 块。这种情况上游 SDK 没有兼容,属于真正的「上游输出问题」。

另外,思考块的 id 永远是固定字符串 `"reasoning-0"`。结束之后再来 `reasoning_content`,SDK 会**用同一个 id 再发一次 `reasoning-start`**。

### 5.2 opencode processor:一对 start/end 就是一个 part

`packages/opencode/src/session/processor.ts` 中 `reasoning-start` / `reasoning-delta` / `reasoning-end` 三个分支:

- `reasoning-start`:id 已在 `reasoningMap` 里就忽略,否则**新建一个 ReasoningPart**(新的 PartID);
- `reasoning-delta`:把文本追加到这个 id 对应的 part;
- `reasoning-end`:打上结束时间、落库,然后**把这个 id 从 map 里删掉**。

所以「结束之后同一个 id 再 start」得到的是一个**全新的 part**。这本身是正确的语义:Kimi k2-thinking 这类 interleaved thinking 模型会「思考 → 调工具 → 再思考」,每段思考就该是独立的块。processor 没有错,错在上游给了它一个错误的 end。

### 5.3 Anthropic 路径对照

`@ai-sdk/anthropic` 直接把 `content_block_start(type: thinking)` 映射成 `reasoning-start`,id 用块的 `index`。这条路径下要出现同样的碎块,只能是网关给每片思考都单独包了一对 start/stop——那就是服务端真的在多开块,SDK 照单全收是对的。

---

## 6. 方法:怎么判定是上游的问题还是 agent 的问题

### 6.1 判定思路

agent 链路(SDK + processor + UI)是**确定性**的:同样的字节流,永远拼出同样的块。所以判定可以拆成三个独立的问题:

1. 原始字节流里有什么?(只看上游,不经过 agent)
2. 我们这个版本的 SDK 拿到这样的输入会怎么处理?(只看 SDK,不经过网关)
3. 上游 SDK 怎么看待这种输入?(是我们版本落后,还是上游也不兼容)

前两步回答「为什么会这样」,第三步决定「该谁修」。

### 6.2 五步排查

#### 第 1 步 · 前端现场:数 part(1 分钟)

```js
const ps = [...octoDebug.dump().parts["<msgID>"]]
const c = {}; ps.forEach(p => c[p.type] = (c[p.type] || 0) + 1)
;({ count: c, texts: ps.filter(p => p.type === "text").map(p => JSON.stringify(p.text.slice(0, 200))) })
```

- reasoning 块有几十上百个 → 确认是「part 被切碎」,而不是 UI 把一个 part 渲染错了。这一步排除了渲染层;
- 有一个 text 块,开头是一长串空白 → 指向「思考帧带空白 content」;
- text 块正常,或者没有 text 块 → 指向「思考帧带 `tool_calls`」。

#### 第 2 步 · server 日志:看第一帧原文(5 分钟)

provider 里的临时诊断块 `fetch-debug`(`packages/opencode/src/provider/provider.ts`)会在 sidecar 日志里写 `fetch #N body first chunk`,带**第一个网络包的前 512 字节原文**(`preview` 字段)。之后的包只记大小和时间,**没有内容**。日志位置见 [insight-debugging.md §0.3](../insight-debugging.md)。

512 字节通常能装下前 2–4 帧。opencode 不记录完整的模型原始返回;AI SDK 支持用 `includeRawChunks` 透出每帧原文,但 opencode 没开。

#### 第 3 步 · 绕过 agent 直接请求网关(15 分钟,决定性)

用和 insight 相同的 baseURL / key / model 直接请求,存下完整 SSE。用 curl、Insomnia 或 Postman 都行。**请求里要带 `tools`**:insight 的请求总是带工具,有些网关只在请求带了 tools 时才往每帧塞 `tool_calls`。

Mac:

```bash
cat > body.json <<'EOF'
{
  "model": "<模型 id>",
  "stream": true,
  "messages": [{ "role": "user", "content": "生成一个登录页 HTML" }],
  "tools": [{ "type": "function", "function": {
    "name": "noop", "description": "占位工具,不要调用",
    "parameters": { "type": "object", "properties": {} } } }]
}
EOF
curl -sN "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  --data-binary @body.json -o raw.sse
```

Windows PowerShell(把请求体写成**无 BOM 的 UTF-8** 文件再交给 `curl.exe`,避免 PowerShell 的引号转义和 BOM 干扰):

```powershell
$body = @'
{ "model": "<模型 id>", "stream": true,
  "messages": [{ "role": "user", "content": "生成一个登录页 HTML" }],
  "tools": [{ "type": "function", "function": { "name": "noop", "description": "占位工具,不要调用",
    "parameters": { "type": "object", "properties": {} } } }] }
'@
[IO.File]::WriteAllText("$PWD\body.json", $body, (New-Object Text.UTF8Encoding $false))
curl.exe -sN "$env:BASE_URL/chat/completions" `
  -H "Authorization: Bearer $env:API_KEY" -H "Content-Type: application/json" `
  --data-binary "@body.json" -o raw.sse
```

统计**每一帧 delta 的字段形状**(只看形状、不看内容,长文本也能一眼看清):

Mac(需要 `jq`):

```bash
grep '^data: {' raw.sse | sed 's/^data: //' | jq -c '
  (.choices[0].delta // {}) | with_entries(.value |=
    if type == "string" then (if . == "" then "EMPTY" elif test("^\\s+$") then "WS" else "TEXT" end)
    elif type == "array" then "array[\(length)]"
    else type end)' | sort | uniq -c | sort -rn
```

Windows PowerShell:

```powershell
Get-Content raw.sse -Encoding UTF8 | Where-Object { $_ -like 'data: {*' } | ForEach-Object {
  $d = ($_.Substring(6) | ConvertFrom-Json).choices[0].delta
  if ($null -eq $d) { return '(no delta)' }
  ($d.PSObject.Properties | ForEach-Object {
    $v = $_.Value
    $t = if ($null -eq $v) { 'null' }
         elseif ($v -is [string]) { if ($v -eq '') { 'EMPTY' } elseif ($v.Trim() -eq '') { 'WS' } else { 'TEXT' } }
         elseif ($v -is [array]) { "array[$($v.Count)]" }
         else { $v.GetType().Name }
    "$($_.Name)=$t"
  }) -join ','
} | Group-Object | Sort-Object Count -Descending | Format-Table Count, Name -AutoSize
```

判读:

```text
# 健康——思考帧里只有 reasoning_content
  412 {"reasoning_content":"TEXT"}
  230 {"content":"TEXT"}

# 本次(maas-glm-5.3)——每个思考帧都带空 tool_calls
  412 {"content":"null","reasoning_content":"TEXT","role":"TEXT","tool_calls":"array[0]"}

# 另一种常见异常——每个思考帧都带空白 content
  412 {"content":"WS","reasoning_content":"TEXT"}
```

**再用同一份 body.json 请求一个正常模型当对照组**,两份统计摆在一起,就是「同一个请求,只换了模型,原始输出形状不同」的直接证据。

#### 第 4 步 · 回放:把输入喂给我们的 SDK(10 分钟,外网可做)

照着第 3 步看到的帧形状构造一段 SSE,用自定义 `fetch` 直接喂给 provider 包,数 `reasoning-start` 出现了几次。不需要启动整个应用,也不需要内网:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

const frame = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: finish, delta }] })}\n\n`
const extra = { tool_calls: [] }   // 删掉这一项再跑一次做对照
let body = ""
for (const w of ["The", " user is asking", " in Chinese"]) body += frame({ content: null, reasoning_content: w, ...extra })
body += frame({ content: "好的", ...extra }) + frame({}, "stop") + "data: [DONE]\n\n"

const provider = createOpenAICompatible({
  name: "replay", baseURL: "http://replay.local/v1",
  fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
})
const { stream } = await provider.chatModel("x").doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as any)
let starts = 0
for await (const e of stream as any) if (e.type === "reasoning-start") starts++
console.log("reasoning-start ×", starts)
```

本次的实测结果:

| 输入 | 2.0.41 | 2.0.75 |
|---|---|---|
| 每帧带 `tool_calls: []` | **每帧一个块** | 1 个块 |
| 删掉 `tool_calls` | 1 个块 | 1 个块 |

两次输入只差一个字段,现象一有一无,因果就闭环了。

#### 第 5 步 · 查上游:新版 SDK 怎么处理这种输入(10 分钟,决定该谁修)

**在把问题定性为「上游不规范」之前,必须做这一步。** 网页搜索经常搜不到,要直接看包本身:

```bash
npm view @ai-sdk/openai-compatible version              # 最新版本
npm pack @ai-sdk/openai-compatible@<版本> && tar -xzf *.tgz
grep -n -i "empty tool\|tool_calls" package/CHANGELOG.md    # 关键词搜 changelog
grep -n "delta.tool_calls" package/dist/index.js           # 对比判断逻辑
```

然后把第 4 步的回放脚本对新版本再跑一次。三种结果:

- **新版已兼容** → agent 侧的问题是依赖落后,升级依赖。这不是「为非标准输出写适配」,而是采用上游已经确认的修复;
- **新版仍不兼容,且输出确实偏离通行约定** → 上游输出问题,反馈给网关方;
- **新版仍不兼容,但输出是合理写法** → 给上游 SDK 提 issue。

本次是第一种。

### 6.3 证据强度一览

| 步骤 | 能证明什么 | 不能证明什么 |
|---|---|---|
| 1. 数 part | 数据层被切碎,不是渲染问题 | 是谁切的 |
| 2. 首帧原文 | 网关输出里有可疑字段(如果 512 字节里看得到) | 是否每帧都有 |
| 3. 直连录流 | 上游输出的确切形状,并有对照组 | 我们的处理是否合理 |
| 4. 回放 | 该字段就是触发原因(因果) | 该谁修 |
| 5. 查上游 SDK | 上游怎么看这种输入,该谁修 | — |

---

## 7. 定性与处理原则

**措辞要准确。** 给网关方或团队写结论时注意三点:

1. **偏离通行约定 ≠ 违反协议**。delta 的字段都是可选的,`tool_calls: []` 在 schema 上合法。说「与 OpenAI、DeepSeek 等主流实现不一致」,不说「没按业界标准协议输出」——后者会被直接反驳,因为 SDK 能正常解析出 reasoning 和正文,说明整体就是标准协议;
2. **主语是服务端,不是模型**。JSON 里带哪些字段由推理服务或网关序列化时决定,模型权重管不到。对外说「该模型的服务端」,这也决定了该找谁修;
3. **先查自己的依赖,再定性对方**。客户端对边缘写法的宽容度是会随版本变化的(§4 小结)。

**处理优先级:**

1. **上游 SDK 已兼容** → 升级依赖。选**包含修复的最低版本**,避免把无关的行为变更混进同一个 PR(本次选 2.0.75 而不是 2.0.87,因为 2.0.86 改了非流式响应里 reasoning 和 text 的顺序);
2. **上游 SDK 不兼容** → 推网关方修(多数框架是一个 `exclude_none` / `omitempty` 开关),同时可以给 SDK 提 issue;
3. **不在本仓写特供补丁**:不在 fetch 包装里剥字段,不在 UI 里合并相邻的 reasoning 块。剥字段会在网关某天真的在思考帧里开始工具调用时吞掉信号;合并相邻块会错误地合并 interleaved thinking 模型本该分开的块,而且只改显示不改数据。

**升级依赖时要做的验证:**

- 回放脚本对新版本跑一次,确认修复生效;
- typecheck;
- 相关测试**和基线对比失败集合**,不只看「有没有失败」。本地环境常有既有失败,逐条一致才能说明与本次改动无关;
- `bun.lock` 看清楚连带变化(本次:openai-compatible 下面嵌套了一份新版 provider / provider-utils,其余 `@ai-sdk/*` 包不变);
- 打包环境合入后要重新 `bun install`,否则包里还是旧版本。

**存量数据不追溯修复。** 升级只影响新生成的内容,已经落库的碎块会话让用户删除即可。写脚本合并历史数据等于在存储层做启发式修补,受影响范围又小,不值得。

---

## 8. 速查

| 现象 | 先看 | 指向 |
|---|---|---|
| 思考被切成很多小块,每块几个词 | `octoDebug.dump()` 数 reasoning part | 数据层被切碎(排除渲染层) |
| …还有一个内容全是空白的 text 块 | 同上 | 思考帧带空白 `content`(新版 SDK 也不兼容) |
| …没有异常的 text 块 | 同上 | 思考帧带 `tool_calls`(空数组的情况 2.0.75 已兼容,先查 SDK 版本) |
| 想看模型原文 | sidecar 日志 `fetch-debug … body first chunk` | 前 512 字节原始 SSE |
| 要拿决定性证据 | 第 3 步直连录流 + 字段形状统计 + 对照组 | 上游输出形状 |
| 要证明因果、决定该谁修 | 第 4 步回放 + 第 5 步查上游 SDK changelog | 依赖落后 / 上游问题 |
| 思考整段没显示 / 正文里出现 `<think>` | [reasoning-output-formats.md §7](reasoning-output-formats.md) | 字段名或内联标签问题,不是本文的问题 |

## 相关阅读

- [provider-protocols.md](provider-protocols.md):三大协议家族的请求 / 工具调用 / 流式格式总览
- [reasoning-output-formats.md](reasoning-output-formats.md):思考文本放在哪个字段(`reasoning_content` / `reasoning` / `<think>` / 结构化块)
- [insight-debugging.md](../insight-debugging.md) §0.3 / §3:sidecar 日志位置、`octoDebug` 命令
- UXAI PR #1049:`@ai-sdk/openai-compatible` 2.0.41 → 2.0.75
- 上游 changelog:`@ai-sdk/openai-compatible` 2.0.75,`f3c1980`
- 源码:`packages/opencode/src/session/processor.ts`(事件 → part)· `packages/opencode/node_modules/@ai-sdk/openai-compatible/dist/index.js`(流式块推断,搜 `isActiveReasoning`)· `packages/opencode/node_modules/@ai-sdk/anthropic/dist/index.js`(搜 `content_block_start`)
