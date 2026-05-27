# ADR-010 — 机器可读卡片的原始输出隐藏策略

**状态**：🚫 **已作废(2026-05-26)** — 整个 ADR 的前提("原始 JSON / HTML 源码对用户无价值,应隐藏")被否决,业界(Claude / ChatGPT / Cursor)对话区**永不抹除**,仅追加"附加预览入口"。详见 [output-renderers.md §0](../specs/ui/output-renderers.md#0-核心原则对话内容永不替代卡片是附加预览入口)。

> **作废理由**:本 ADR 路线 A(CSS `[data-suppress-raw]` suppress)在内网/外网验证中出现两类问题:
> 1. HTML / mindmap 命中时整段对话被藏(连同 LLM 的思考过程 / 解释文字),用户体验断裂
> 2. 外网偶发性 suppress 失效 → "既有代码段又有原始"重复显示
>
> **新方案**(替代本 ADR):对话区由上游 `<Markdown>` 原样渲染(含 shiki / 复制按钮),卡片改为对话气泡下方紧凑入口条(~40px 高),作为附加预览能力。`[data-suppress-raw]` CSS 规则已删除,`suppressRawOutput` memo 已删除。
>
> 本 ADR 文件保留作为历史决策记录,**不再指导新实现**。

---

## 背景

OutputCard 渲染器（mindmap / html / json）生成后，assistant 原始文字区（JSON 字符串 / HTML 源码）对用户毫无可读价值，应隐藏。

Claude.ai 的做法是从流式生成开始就不暴露原始内容：模型输出 `<parameter name="antArtifact" type="..." title="...">` 开头 tag，UI 解析到 tag 就立即切换到 artifact loading 状态，后续增量写入 artifact 面板而非对话气泡。

我们需要决定是模仿这种行为，还是走其他路线。

---

## 方案对比

### 路线 A：流中 tag / 前缀检测（类 Artifacts）

在 `message.part.delta` 事件里实时扫描增量文字，一旦检测到 `[[{`（mindmap）或 ` ```html ` fence 开头，立刻显示 loading 占位并停止把增量写进对话气泡。

**优点**：对话区完全不出现原始文字，体验与 Claude.ai 一致。  
**缺点**：需要改 SSE 处理链；增量正则匹配有大量边界（不完整 token、分段 fence、多行开头等）；对直接提示词场景有效，对工具调用场景是绕路。

### 路线 B：tool name 检测（MCP 联调后天然获得）✅ 已选

`analyze_interview(analysis_type="mindmap")` 的 tool_call part 在文字 part 之前到达。UI 看到 tool_call 开始时就知道即将产出的类型，立即显示 loading 占位；文字 part 流入 ResultViewer 而非对话气泡。

**优点**：对 UXR MCP 场景零额外代价；逻辑清晰，不需要启发式扫描；tool_call part 天然携带 `analysis_type` 字段。  
**缺点**：对"直接提示词"测试场景无效（无 MCP 时无 tool_call）；需要 MCP 联调完成后才能实现。

### 当前过渡方案

`InsightTurn` 在 OutputCard ready 后挂 `data-suppress-raw` 属性，CSS 规则 `[data-suppress-raw] [data-slot="session-turn-assistant-content"] { display: none }` 隐藏文字区。

过渡方案的已知局限：原始内容在 session idle 前仍短暂可见（流完才隐藏），不及路线 B 的"从不暴露"体验。联调前手动验证阶段可接受。

---

## 决策

采用**路线 B**。理由：

1. UXR 生产路径全部走 MCP，tool_call 是天然信号，无需额外逻辑
2. 路线 A 的增量扫描复杂度高，且只对无 MCP 的测试场景有效，性价比低
3. 当前 CSS 过渡方案可支撑联调前验证，不阻塞主线进度

---

## 实现要点（MCP 联调时补充）

1. SSE handler 中，检测到 `tool_call` part 且 tool name 为 `analyze_interview` / `search_reports` 等已知返回结构化内容的工具时，向 InsightTurn 传递 `pendingCardType`
2. InsightTurn 收到 `pendingCardType` 后立即渲染 loading 占位（替代对话气泡的文字流）
3. tool_call 结束、text part 开始时，增量写入 ResultViewer 而非对话气泡
4. 具体 tool name 列表等 UXR MCP 接口确认后补充到 [mcp-contract.md](../specs/agents/mcp-contract.md)

---

## 参考

- [output-renderers.md §1](../specs/ui/output-renderers.md) — 原始文字显示策略
- [ADR-005](005-prompt-template-vs-subagent.md) — 提示词模板 vs subagent
