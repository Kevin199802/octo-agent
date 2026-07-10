# LLM Provider 协议差异

> 上次同步:2026-04-27。读完这篇,你应该理解为什么"换个 provider 就报错",以及 thinking/tool 等高级功能在不同协议下怎么传。

前置阅读:[opencode-internals.md §8 Provider 接入](opencode-internals.md#8-provider-接入)。

---

## 1. 三大协议家族

LLM 的 HTTP API 主要有三个协议家族,opencode 通过 [Vercel AI SDK](https://sdk.vercel.ai/) 的不同 provider 包适配:

| 协议家族 | 代表模型 | opencode 用的包 |
|---|---|---|
| **OpenAI Chat Completions** | OpenAI GPT、DeepSeek、Moonshot、几乎所有内网网关 | `@ai-sdk/openai` / `@ai-sdk/openai-compatible` |
| **Anthropic Messages** | Claude、百炼 Anthropic 兼容网关 | `@ai-sdk/anthropic` |
| **Google Generative AI** | Gemini | `@ai-sdk/google` |

实际还有 Azure、Bedrock、Cohere、Mistral 等,但**国内绝大多数模型都走 OpenAI 兼容协议**(包括 Qwen、GLM、DeepSeek、MiniMax)。

---

## 2. 请求格式对比

同样发"你好"+ 一个 web_search 工具,三个协议的请求体差别:

### 2.1 OpenAI Chat Completions

```jsonc
POST /v1/chat/completions
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "你是助手" },
    { "role": "user",   "content": "今天天气?" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "搜索网页",
        "parameters": { "type": "object", "properties": { ... } }
      }
    }
  ],
  "stream": true
}
```

### 2.2 Anthropic Messages

```jsonc
POST /v1/messages
{
  "model": "claude-sonnet-4-6",
  "system": "你是助手",                 // 单独字段,不在 messages 里
  "messages": [
    { "role": "user", "content": "今天天气?" }
  ],
  "tools": [
    {
      "name": "web_search",            // 没有 type/function 包装
      "description": "搜索网页",
      "input_schema": { "type": "object", "properties": { ... } }   // input_schema 不是 parameters
    }
  ],
  "stream": true,
  "max_tokens": 4096                   // 必填!
}
```

### 2.3 Google Generative AI

```jsonc
POST /v1beta/models/gemini-2.5-pro:streamGenerateContent
{
  "contents": [                        // 不叫 messages,叫 contents
    { "role": "user", "parts": [{ "text": "今天天气?" }] }
  ],
  "systemInstruction": { "parts": [{ "text": "你是助手" }] },
  "tools": [
    {
      "functionDeclarations": [        // 又是另一种包装
        {
          "name": "web_search",
          "description": "搜索网页",
          "parameters": { ... }
        }
      ]
    }
  ]
}
```

**结论**:三个协议字段名、嵌套结构、必填项各不相同。Vercel AI SDK 帮你把这些差异抹平,opencode 直接 `streamText({ model, tools, messages })` 就行。

---

## 3. 工具调用响应格式对比

LLM 决定调工具时,三个协议返回:

### OpenAI

```jsonc
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc",
        "type": "function",
        "function": {
          "name": "web_search",
          "arguments": "{\"query\":\"北京天气\"}"   // 字符串,要 JSON.parse
        }
      }]
    }
  }]
}
```

### Anthropic

```jsonc
{
  "content": [
    { "type": "text", "text": "我来查天气" },        // 可以混合
    {
      "type": "tool_use",
      "id": "toolu_abc",
      "name": "web_search",
      "input": { "query": "北京天气" }              // 直接 object
    }
  ]
}
```

### Google

```jsonc
{
  "candidates": [{
    "content": {
      "parts": [{
        "functionCall": {
          "name": "web_search",
          "args": { "query": "北京天气" }
        }
      }]
    }
  }]
}
```

opencode/Vercel AI SDK 把这些都归一化成统一的 `tool_use` Part(见 [opencode-internals.md §4](opencode-internals.md#4-part-类型清单))。

---

## 4. 思考链(Reasoning / Thinking)

支持思考链的模型在协议层各不相同。本节是总览;各格式的深入对比、多轮回传口径、我们的消费链路见 [reasoning-output-formats.md](reasoning-output-formats.md)。

### 4.1 Anthropic — `thinking` 块

请求时启用:

```jsonc
{
  "thinking": { "type": "enabled", "budget_tokens": 8192 },
  "messages": [...]
}
```

响应里多一种 content 类型:

```jsonc
{
  "content": [
    { "type": "thinking", "thinking": "用户在问天气,我先调工具..." },
    { "type": "text", "text": "今天北京 18°C" }
  ]
}
```

### 4.2 OpenAI o-series — 不暴露思考正文

OpenAI 官方 API 的 reasoning 模型(o1/o3/GPT-5)**不返回思考正文**:Chat Completions 只给 `reasoning_tokens` 计数,Responses API 里思考是加密的 reasoning item(最多给摘要)。注意:兼容生态里常见的 `reasoning_content` / `reasoning` 字段都**不是** OpenAI 官方协议,前者是 DeepSeek 首创的事实标准,后者是 OpenRouter/gpt-oss 生态约定,详见 [reasoning-output-formats.md](reasoning-output-formats.md)。

### 4.3 DeepSeek-R1 / Qwen3 thinking — `reasoning_content`

DeepSeek-R1 和 Qwen3 thinking 模型在 OpenAI 兼容协议上**自定义扩展**了 `reasoning_content`:

```jsonc
{
  "choices": [{
    "delta": {
      "reasoning_content": "用户问的是...",   // 思考流
      "content": null                        // 还在思考时正文为空
    }
  }]
}
// 思考完后:
{
  "choices": [{
    "delta": {
      "reasoning_content": null,
      "content": "今天北京 18°C"             // 切到正文流
    }
  }]
}
```

### 4.4 Google Gemini — 内置 thinking,不暴露

Gemini 2.5 Pro 默认开 thinking,但**不返回思考过程**给客户端,只用于内部推理。

### 4.5 转译到 opencode 的 ReasoningPart

opencode 把上述全部归一化成 [ReasoningPart](../../packages/opencode/src/session/message-v2.ts)(`type: "reasoning"`),UI 统一渲染。**但归一化是 SDK 层做的,不同 provider 包对 thinking 的支持成熟度不同**:

| Provider | thinking 支持成熟度 |
|---|---|
| `@ai-sdk/anthropic` 直连 Anthropic | ✅ 成熟 |
| `@ai-sdk/anthropic` 接百炼/其他兼容网关 | ⚠️ 看网关是否原样转发 `thinking` 块 |
| `@ai-sdk/openai-compatible` 接 DeepSeek/Qwen | ⚠️ 需要 SDK 识别 `reasoning_content` 字段(部分版本支持) |
| `@ai-sdk/google` | ❌ Gemini 不暴露 |

实测时:**百炼 + Qwen3 thinking 模型不一定能拿到 reasoning part**,需要看百炼网关怎么转发。

---

## 5. 流式协议差异

三个协议的流式响应格式也不同,但都是 SSE(Server-Sent Events):

### OpenAI

每个 chunk 是 `data: {...}\n\n`,字段是 `choices[0].delta`:

```
data: {"choices":[{"delta":{"content":"你"}}]}
data: {"choices":[{"delta":{"content":"好"}}]}
data: [DONE]
```

### Anthropic

事件类型化,每个 chunk 是 `event: <type>\ndata: {...}\n\n`:

```
event: message_start
data: {"type":"message_start",...}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}

event: message_stop
data: {"type":"message_stop"}
```

### Google

类似 OpenAI 但字段嵌套不同。

---

## 6. 国内常见网关的兼容性观察

### 阿里百炼(DashScope)

提供两种 endpoint:

| Endpoint | 协议 | 适合 |
|---|---|---|
| `/api/v1/services/aigc/text-generation/generation` | DashScope 自有协议 | 不推荐 |
| `/compatible-mode/v1/chat/completions` | OpenAI 兼容 | 大多数 Qwen 模型 |
| `/apps/anthropic/v1/messages` | Anthropic 兼容 | 适合 Claude/Qwen3-coder/GLM 等 |

**思考链转发**:Anthropic 兼容路径**部分支持 thinking 块**,但具体看哪个模型 + 哪个时间点的网关版本。建议实测。

### DeepSeek

走 OpenAI 兼容协议,DeepSeek-R1 用 `reasoning_content` 自定义字段。

### Moonshot Kimi

走 OpenAI 兼容,kimi-k2 thinking 用 `reasoning_content`。

### 智谱 GLM

走 OpenAI 兼容,GLM-4.7+ thinking 用 `reasoning_content`。

### 内网常见 OneAPI / OpenAI-Forward

中转代理,统一暴露 OpenAI 兼容协议。**注意**:它们对 `tools` / `tool_choice` / `stream_options` / `reasoning_content` 等扩展字段的转发完整度参差不齐,**实测最重要**。

---

## 7. 配置示例汇总

下面给 5 个常见 provider 的完整配置例,放进 `~/.config/octo/octo.json` 即可。

### 7.1 Anthropic 直连

```jsonc
{
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "options": { "apiKey": "sk-ant-xxx" },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6",
          "options": {
            "thinking": { "type": "enabled", "budgetTokens": 8192 }
          },
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  },
  "model": "anthropic/claude-sonnet-4-6"
}
```

### 7.2 DeepSeek

```jsonc
{
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "sk-xxx"
      },
      "models": {
        "deepseek-chat":     { "name": "DeepSeek V3",   "limit": { "context": 64000, "output": 8000 } },
        "deepseek-reasoner": { "name": "DeepSeek R1",   "limit": { "context": 64000, "output": 8000 } }
      }
    }
  },
  "model": "deepseek/deepseek-chat"
}
```

### 7.3 百炼 — Anthropic 兼容路径

```jsonc
{
  "provider": {
    "bailian": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
        "apiKey": "sk-xxx"
      },
      "models": {
        "qwen3-coder-plus": {
          "name": "Qwen3 Coder Plus",
          "limit": { "context": 1000000, "output": 65536 }
        },
        "glm-5": {
          "name": "GLM-5",
          "options": { "thinking": { "type": "enabled", "budgetTokens": 8192 } },
          "limit": { "context": 202752, "output": 16384 }
        }
      }
    }
  },
  "model": "bailian/qwen3-coder-plus"
}
```

### 7.4 Google Gemini

```jsonc
{
  "provider": {
    "google": {
      "npm": "@ai-sdk/google",
      "options": { "apiKey": "AIzaSyXXX" },
      "models": {
        "gemini-2.5-pro":    { "name": "Gemini 2.5 Pro" },
        "gemini-2.5-flash":  { "name": "Gemini 2.5 Flash" }
      }
    }
  },
  "model": "google/gemini-2.5-pro"
}
```

### 7.5 内网 OpenAI 兼容网关

```jsonc
{
  "provider": {
    "intranet": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://your-intranet-host/v1",
        "apiKey": "your-key",
        "headers": { "X-Department": "research" }   // 可加自定义 header
      },
      "models": {
        "your-model-id": { "name": "内网模型", "limit": { "context": 128000, "output": 4096 } }
      }
    }
  },
  "model": "intranet/your-model-id"
}
```

---

## 8. 排查 Provider 问题的步骤

遇到"添加 provider 后会话报错"时,按这个顺序查:

1. **Schema 错误** → 看 dev 主进程 stdout,有 Zod 错会打印字段路径
   - 常见:`providers`(复数)、`apiKey` 写错位置、不必要的字段
2. **认证错误** → 401/403 通常是 `apiKey` 错或没传
   - `curl -H "Authorization: Bearer $KEY" $BASE_URL/chat/completions ...` 直接验证
3. **404 / endpoint 错** → `baseURL` 写错。常见:漏 `/v1`、写成 `/v1/chat/completions`(应该只到 `/v1`)
4. **422 / 参数错** → 模型不支持某个字段(比如 OpenAI 兼容网关不支持 `tools`),网关日志能看到
5. **流式无响应** → SSE 协议不兼容,看网关是否支持 `stream: true`
6. **思考链没出现** → 看 §4,可能模型本身不支持或网关没转发

---

## 9. 进一步阅读

- Anthropic 文档:https://docs.anthropic.com/en/api/messages
- OpenAI 文档:https://platform.openai.com/docs/api-reference/chat
- Vercel AI SDK:https://sdk.vercel.ai/providers/ai-sdk-providers
- opencode 配置加载:[opencode-internals.md §配置加载](opencode-internals.md#5-配置加载)
- 落地交互:[specs/ui/provider-config.md](../specs/ui/provider-config.md)
