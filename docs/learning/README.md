# learning/ — 深度学习文档

跟 architecture / development / specs / adr 的区别:

| 目录 | 回答的问题 | 风格 |
|---|---|---|
| `architecture.md` | 我们的系统**长什么样** | 精炼、当前事实、给同事快速对齐 |
| `development.md` | 我**怎么操作**(命令、调试、打包) | 操作手册,粘命令就用 |
| `specs/` | 某个功能**要做成什么样**(验收标准) | 一项一规格,可勾选 |
| `adr/` | 某个决策**为什么这么选** | 一项一记录,不可变 |
| **`learning/`** | **某个事物内部到底怎么运作的** | **深度解释,允许长,带例子,允许冗余** |

learning 文档面向"对该领域不熟悉、想完整理解原理"的读者。可以反复读、可以跳读,内容做到足够详尽。

## 目录

- [opencode-internals.md](opencode-internals.md) — opencode 后端工作原理:HTTP 路由、SSE 事件、Part 类型、SQLite 表、Provider 接入

> 后续待写(随实际开发推进):
>
> - `agent-mental-model.md` — Agent 是什么、跟 LLM 调用的区别、为什么需要 shell
> - `provider-protocols.md` — Anthropic vs OpenAI 兼容协议差异、thinking/reasoning 怎么传
> - `electron-vite-build.md` — electron-vite 的 main/preload/renderer 三段构建模型
