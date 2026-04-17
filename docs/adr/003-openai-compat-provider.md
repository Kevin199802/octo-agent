# ADR-003: LLM 接入方案 — OpenAI-Compatible Provider

## 状态
已采纳（2026-04-17）

## 背景

Octo Agent 需要接入内网大模型，同时开发阶段使用外网 API（DeepSeek、Google Gemini）。  
opencode 后端内置 30+ provider，需要选择接入路径。

## 决策

- **内网 LLM** 和 **DeepSeek**：均通过 `@ai-sdk/openai-compatible` provider 接入（两者都支持 OpenAI API 格式 + SSE 流式）
- **Google Gemini**：通过 opencode 内置的 `@ai-sdk/google` provider 接入（无需额外配置 npm 包）
- 配置通过 `~/.opencode/config.json` 管理；生产安装包通过 `resources/opencode-config.json` 内置默认配置

## 理由

- opencode 后端不动，provider 扩展通过配置文件而非代码实现
- `@ai-sdk/openai-compatible` 已在 opencode 中注册，内网 LLM 只需填 baseURL 即可接入
- 开发阶段 DeepSeek / Gemini 提供快速验证通道，无需内网环境

## 后果

- 需在本地设置 `DEEPSEEK_API_KEY` 或 `GOOGLE_GENERATIVE_AI_API_KEY` 环境变量
- 内网 LLM 的 `baseURL` 在打包前写入 `resources/opencode-config.json`
- 切换 provider 只需修改配置，不涉及代码改动
