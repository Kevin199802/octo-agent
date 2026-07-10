# 思考链输出格式:业界规范与我们的消费链路

> 背景:2026-07 内网 MaaS 公告调整思考格式——取消 `X-Reasoning-Format` 请求头协商,统一为"思考内容置于 `reasoning` 字段、正文置于 `content`,不再输出 `<think>` 标签"。本文讲清楚:思考链输出在业界有哪几种格式、各自谁在用、多轮回传怎么处理、我们(opencode/insight)这条消费链路是怎么解析的,以及这次内网变更算"更正规"还是"魔改"。
>
> 协议家族总览(请求格式 / 工具调用 / 流式)见 [provider-protocols.md](provider-protocols.md),本文只深挖"思考文本放哪"这一件事。

---

## 1. 问题的本质:思考文本放在响应的哪里

Reasoning 模型(DeepSeek-R1、Qwen3-thinking、GLM-4.5+、o-series、Claude extended thinking……)在给出正式回答前会生成一段"思考过程"文本。OpenAI Chat Completions 协议诞生时没有这个概念,`choices[].message` 里只有 `content` 和 `tool_calls`。于是"思考文本放哪"成了各家自行发挥的空白地带,演化出四类做法。

## 2. 四类业界格式

### 格式 A:`<think>` 标签内联在 content 里(最原始)

```jsonc
{
  "choices": [{
    "message": {
      "content": "<think>用户问的是天气,先查工具…</think>今天北京 18°C"
    }
  }]
}
```

这是**模型原始输出的直接透传**:开源 reasoning 模型(DeepSeek-R1、Qwen3 thinking 模式)的 chat template 本来就是让模型生成 `<think>…</think>` 再接正文,如果 serving 层不做任何解析,API 消费者拿到的就是这样。

对 API 消费者这是**最差的格式**:

- 客户端必须自己写正则拆分,流式场景还得处理"标签跨 chunk 被截断"的状态机;
- 有些模型偶尔漏输出起始 `<think>` 或漏闭合,拆分逻辑必然出 badcase;
- 思考文本混进 `content`,任何下游按 `content` 做的解析(取标题、抽 JSON、算摘要)全部被污染。

它只该出现在"自己拉原始权重自己 serve、且没配 reasoning parser"的场景。**一个托管 MaaS 平台把这个当默认口径,是不合格的**——而内网 MaaS 改动前的默认(不传参时思考和正文用 `</think>` 分隔全放 content)正是这种。

### 格式 B:`reasoning_content` 字段(国内事实标准)

```jsonc
// 流式:思考阶段
{ "choices": [{ "delta": { "reasoning_content": "用户问的是…", "content": null } }] }
// 思考结束,切到正文流
{ "choices": [{ "delta": { "reasoning_content": null, "content": "今天北京 18°C" } }] }
```

2025 年初 DeepSeek 官方 API 发布 R1 时首创,随后被生态广泛跟进,成为 OpenAI 兼容协议上**最主流的事实标准**:

- **模型原厂官方 API**:DeepSeek、智谱 BigModel(GLM 系)、Moonshot Kimi、阿里 DashScope(Qwen 系)全部用 `reasoning_content`;
- **开源 serving 框架**:vLLM、SGLang 的 reasoning parser 输出也是 `reasoning_content`。

也就是说,这次内网清单里的 GLM / DeepSeek / Qwen 三家,**它们各自的原厂 API 口径都是 `reasoning_content`**。

### 格式 C:`reasoning` 字段(OpenRouter / gpt-oss 生态)

```jsonc
{ "choices": [{ "delta": { "reasoning": "用户问的是…" } }] }
```

字段名不同,语义与格式 B 完全相同。两个来源:

- **OpenRouter** 作为聚合网关,把各家思考输出归一化成顶层 `reasoning` 字段(附带结构化的 `reasoning_details`,见格式 D);
- **gpt-oss**(OpenAI 2025-08 开源的模型)的部分 serving 栈把 harmony 格式里的 analysis channel 映射成 `reasoning` 字段输出,一批兼容网关跟着采用了这个名字。

注意:**这不是 OpenAI 官方协议**。OpenAI 自己的 API(无论 Chat Completions 还是 Responses)从来不在 `reasoning` 字段里返回思考正文(见格式 D)。"`reasoning` 字段 = OpenAI 协议"是个常见误传,准确说它是"OpenRouter/gpt-oss 生态的事实约定"。

### 格式 D:结构化思考块(闭源大厂,和上面不是一个量级的东西)

- **Anthropic**:响应 `content` 数组里出现 `{ "type": "thinking", "thinking": "…", "signature": "…" }` 块,带密码学签名,多轮时要求**原样回传**(防篡改)。
- **OpenAI o-series / GPT-5**:Chat Completions 里**完全不暴露思考正文**,只给 `reasoning_tokens` 计数;Responses API 里思考是加密的 reasoning item,最多给摘要(`reasoning.summary`)。
- **OpenRouter `reasoning_details`**:结构化数组,能承载 Anthropic 签名块 / OpenAI 加密块,为的是跨模型多轮时能无损回传。

这一类的共同点是**把思考当一等公民的结构化对象**(可签名、可加密、可回传),而不是一个裸文本字段。OpenAI 兼容生态里的 B/C 都只是裸文本,是它的简化版。

### 小结表

| 格式 | 载体 | 谁在用 | 消费难度 |
|---|---|---|---|
| A `<think>` 内联 | content 里的文本标签 | 未配 parser 的自建 serving | 最差,客户端拆标签 |
| B `reasoning_content` | 兼容协议扩展字段 | DeepSeek/智谱/Kimi/DashScope 原厂、vLLM、SGLang | 低,读字段即可 |
| C `reasoning` | 兼容协议扩展字段 | OpenRouter、部分 gpt-oss serving、一些网关 | 低,读字段即可 |
| D 结构化块 | thinking block / reasoning item | Anthropic、OpenAI 官方 | 中,但语义最完整 |

## 3. 请求头协商为什么该被取消

内网 MaaS 旧口径支持 `X-Reasoning-Format` 请求头,让调用方选择"标签内联 / `reasoning` / `reasoning_content`"三种输出。看起来灵活,实际是反模式:

1. **业界没有先例**——没有任何主流 provider 用请求头协商响应体 schema,标准 SDK(openai-python、AI SDK、LangChain)也没有注入自定义头再按头切换解析逻辑的机制,等于强迫每个接入方写内网特供代码;
2. **同一个 API 的响应 schema 不再确定**,网关、日志、回放、评估工具全都要多带一个维度;
3. 默认值还是最差的格式 A,不传头的"天真接入方"体验最糟。

取消协商、固定单一 schema,是正确方向——接口行为不该依赖调用方记得传一个非标准头。

## 4. 多轮回传:思考要不要送回去

思考文本除了"怎么吐出来",还有第二个问题:**下一轮请求要不要把上一轮的思考带回去**。业界口径分三种:

- **不回传**(主流):DeepSeek 明确说 `reasoning_content` 不算上下文,客户端应剥离后再发;大多数 B/C 格式的模型同理。
- **必须回传**:Anthropic 的 thinking 块带签名要原样回传;Kimi k2-thinking 这类 interleaved thinking(工具调用轮之间也思考)要求把 `reasoning_content` 回填,否则推理链断裂。
- **回传加密块**:OpenAI Responses API / OpenRouter `reasoning_details`,回传的是加密对象而非明文。

opencode 对此有个专门开关:模型配置里的 `capabilities.interleaved.field`(取值只有 `"reasoning_content" | "reasoning_details"`,`packages/opencode/src/provider/provider.ts:1299`);配了才会在发历史消息时把 reasoning part 拼回该字段(`packages/opencode/src/provider/transform.ts:338-370`),不配则历史里的 reasoning part 被直接过滤掉(= 不回传,主流做法)。

## 5. 我们的消费链路(逐层)

内网模型是以 `@ai-sdk/openai-compatible` provider 接入的,消息处理**完全沿用 opencode 原生机制**,insight 没有自己的解析层:

```
MaaS 响应
  → @ai-sdk/openai-compatible 2.0.41
      流式:  delta.reasoning_content ?? delta.reasoning   (dist/index.js:725)
      非流式: message.reasoning_content ?? message.reasoning (dist/index.js:591)
      → 归一化为 AI SDK 的 reasoning part
  → opencode 存成 MessageV2 的 ReasoningPart(type: "reasoning")
  → @opencode-ai/ui message-part.tsx:1519 渲染成「已深度思考」折叠块
  → insight 自己的页面(make/insight-turn.tsx 等)同样按 part.type === "reasoning" 消费
```

关键事实:**AI SDK 从 2.0.x 起对 B、C 两种字段名都认**(`reasoning_content` 优先,fallback 到 `reasoning`,就是为兼容 gpt-oss 生态加的,见 SDK 源码注释引用的 #7866)。所以字段叫哪个名字对我们无所谓。

反过来,**格式 A(`<think>` 内联)opencode 主链路不处理**:全仓唯一一处剥标签在会话标题生成(`packages/opencode/src/session/prompt.ts:236`),聊天正文渲染不剥。旧口径下如果不传头,`<think>…</think>` 会原样出现在气泡正文里。我们的客户端从未注入过 `X-Reasoning-Format` 头(全仓 grep 无此字符串),吃的一直是平台默认口径。

## 6. 这次内网变更的评估

**结论:方向是更正规,不是魔改;但字段选型偏了生态的小众分支,且"基于 OpenAI 协议"的说法不准确。**

- ✅ 取消请求头协商 → 单一确定 schema,正确(见 §3);
- ✅ 默认不再输出 `<think>` 标签、思考进独立字段 → 从最差的格式 A 升级到 B/C 一档,正确;
- ⚠️ 字段选了 `reasoning`(格式 C)而不是 `reasoning_content`(格式 B)——清单里 GLM/DeepSeek/Qwen 的**原厂 API 全是 `reasoning_content`**,国内生态主流也是它;选 `reasoning` 意味着内网口径和模型原厂口径不一致,直连原厂调试过的代码搬到内网要注意字段名。不过 `reasoning` 本身是 OpenRouter/gpt-oss 生态的既有约定,算"选了另一个事实标准",不算私造;
- ⚠️ 公告称"基于 openAI 协议的调整"——OpenAI 官方协议里没有返回思考正文的 `reasoning` 字段(见格式 D),这个表述有误导,真实对齐对象是 gpt-oss/OpenRouter 生态。

**对我们的具体影响:**

1. **零代码改动兼容**。AI SDK 两个字段名都认,变更生效后思考会以 ReasoningPart 正常进入消息流,UI 的「已深度思考」折叠块正常渲染。
2. **体验净改善**:旧默认口径下 `<think>` 标签混在正文;新口径正文 `content` 干净了,一切按 content 做的下游处理(标题生成、文本解析)不再被思考文本污染。
3. **一个观察点**:opencode 对 openai-compatible 且模型 id 含 `deepseek`(小写匹配)的模型会默认开 `interleaved: { field: "reasoning_content" }`(`packages/opencode/src/provider/provider.ts:1682`),即多轮时把思考回填进请求的 `reasoning_content` 字段。若内网 DeepSeek 模型以小写 id 配置命中该默认,需确认 MaaS 对请求消息里的未知字段 `reasoning_content` 是忽略还是报错——建议变更生效后(各模型按公告时间点)对 DeepSeek 多轮会话做一次冒烟。
4. 各模型切换时间不同(7.10 / 7.14 / 7.15 / 8.7),过渡期内不同模型的响应格式不一致属预期,不要误判为 bug。

## 7. 排查提示

变更生效后若发现"思考不显示了"或"正文出现奇怪前缀",先用 curl 直接打 MaaS 看原始响应体,确认思考到底在 `reasoning`、`reasoning_content` 还是 content 内联,再对照 §5 的链路定位是哪层没接住——不要先怀疑 opencode 渲染层。

## 相关阅读

- [provider-protocols.md](provider-protocols.md) §4 —— 各协议家族思考链对比(总览视角)
- AI SDK `@ai-sdk/openai-compatible` 源码:`packages/opencode/node_modules/@ai-sdk/openai-compatible/dist/index.js`(搜 `reasoning_content`)
- opencode ReasoningPart 定义:`packages/opencode/src/session/message-v2.ts`
