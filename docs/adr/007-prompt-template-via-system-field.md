# ADR-007: 提示词模板通过 session.prompt() 的 system 字段传递

## 状态
已采纳（2026-05-14）

## 背景

InsightPage 有 6 个提示词模板（观点解析、按提纲聚类、AI用户画像、思维导图、评估问题整理、用研知识问答），用户在 dropdown 里选择后，需要让 LLM 知道当前用什么模板（对应不同的 `analysis_type`、不同的输出格式约束）。

需要决定**模板信息如何传给 LLM**。

完整的模板定义和实现规格见 [docs/specs/ui/insight-analysis-mode.md](../specs/ui/insight-analysis-mode.md)。

## 方案对比

### 方案 A：用户消息前拼标签

```
用户输入：帮我分析这份访谈
实际发送：[模板:key_findings] 帮我分析这份访谈
```

system prompt 里加一段"识别 [模板:xxx] 标签"的规则。

### 方案 B：首条消息插入完整前缀

第一条消息拼 200+ 字详细前缀，后续消息靠对话历史维持。

### 方案 C：session.prompt() 的 system 字段（已采纳）

```ts
session.prompt({
  agent: "insight",
  system: "本轮请使用 analysis_type=key_findings",
  parts: [{ type: "text", text: 用户输入 }]
})
```

模板指令通过 system role 传递，用户消息保持原样。

### 方案 D：现状（每条消息拼完整 200+ 字前缀）

## 决策

**采用方案 C。**

## 理由

| 维度 | A | B | **C** | D |
|---|---|---|---|---|
| 用户消息历史是否干净 | ❌ 残留 [tag] | ✅ | ✅ | ❌ |
| 语义角色是否正确 | ❌ 模板指令混在 user role | ✅ | ✅ system role | ❌ |
| 中途切换模板 | ✅ | ❌ 漂移风险 | ✅ | ✅ |
| 与 agent system prompt 是否重复 | ❌ 需补识别规则 | ❌ 重复 | ✅ 不重复 | ❌ 重复 |
| 业界对应 | 自定义 hack | 不常见 | 标准做法 | 不常见 |

业界对照：
- Anthropic Messages API：`system` 字段直传
- OpenAI Assistants API：`additional_instructions` 每次 run 时追加
- LangChain：`RunnableConfig` metadata

opencode 原生支持：`session.prompt()` 接受 `system` 字段，服务端把 `agent.prompt + input.system + user.system` 拼成一条 system 消息发给 LLM（实现见 [packages/opencode/src/session/llm.ts:100-112](../../packages/opencode/src/session/llm.ts#L100-L112)）。

## 模型兼容性

| 模型 | 兼容性 |
|---|---|
| DeepSeek（chat/reasoner） | ✅ OpenAI 兼容标准 |
| Qwen（通义） | ✅ OpenAI 兼容标准 |
| GLM（智谱） | ✅ 多 system 消息拼接 |
| MiniMax | ✅ abab 系列标准支持 |

技术上协议层无差异，所有支持 OpenAI Chat Completions 的国产模型都能正确处理。**真实风险点**在于小模型对细粒度系统指令的遵循能力（与方案选择无关，是模型本身的能力差异），需联调时验证。

prompt cache 影响：DeepSeek 有 prompt cache，模板不变时多轮命中；用户切模板时少量缓存失效，可接受。

## 后果

- spec 数据模型从 `promptPrefix` 改为 `systemHint`，内容大幅精简（不写工具调用细节）
- `handleSend` 用 `session.prompt({ system, parts })`，不再拼用户消息字符串
- insight.md system prompt 不需要加"模板识别"段
- 详细机制说明：[docs/learning/per-call-system-prompt.md](../learning/per-call-system-prompt.md)
- 实现规格：[docs/specs/ui/insight-analysis-mode.md](../specs/ui/insight-analysis-mode.md)
