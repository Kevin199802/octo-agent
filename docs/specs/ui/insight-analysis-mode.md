# InsightPage 提示词模板选择器 — Spec

> **前置阅读**：[docs/learning/agent-mental-model.md §9](../../learning/agent-mental-model.md) — 理解"提示词模板不是 subagent"这个前提。
>
> **核心原则**：提示词模板是同一个 `insight` primary agent 下的 prompt template，不新建 agent，不新建 subagent。选择后由前端将对应的提示词前缀拼入用户输入，insight agent 的工具集和权限规则不变。

---

## 1. 概念澄清：提示词模板 ≠ 子 agent

提示词模板改变的只是 LLM 收到的任务描述，不改变 agent 身份。

用户选了"观点解析"，发送"帮我分析这份访谈"，实际发出去的消息是：

```
[提示词模板：观点解析] 请从附件访谈中提取关键用户发现，以 Markdown 表格输出（三列：访谈问题 | 用户观点 | 场景主体）。

帮我分析这份访谈
```

insight agent 收到后，自然倾向于调用 `analyze_interview(analysis_type: "key_findings")`，输出表格。

没有新 agent 注册，没有 task 工具调用，只是多了一段 prompt 前缀。

---

## 2. 提示词模板清单（6 个）

### 分组结构

```
访谈观点洞察
  ├─ 观点解析
  ├─ 按提纲聚类
  ├─ AI用户画像
  └─ 思维导图
评估问题整理
用研知识问答
```

### 每个模式的规格

| 模式 | MCP analysis_type | prompt 前缀 | 期望输出 | MCP 工具状态 |
|---|---|---|---|---|
| 观点解析 | `key_findings` | 见下 | Markdown 表格 | ✅ Phase 1 |
| 按提纲聚类 | `cluster_by_outline` | 见下 | Markdown 表格 | ⚠️ Phase 2 |
| AI用户画像 | `generate_persona` | 见下 | Markdown 表格 | ⚠️ Phase 2 |
| 思维导图 | `mindmap` | 见下 | JSON（客户端渲染） | ⚠️ Phase 2 |
| 评估问题整理 | `evaluation_summary` | 见下 | Markdown 表格 | ⚠️ Phase 2 |
| 用研知识问答 | —（调 `search_reports`） | 见下 | 纯文本 + 引用 | ✅ Phase 1 |

### Prompt 前缀文本

**观点解析**
```
[提示词模板：观点解析]
请从附件访谈逐字稿中提取结构化用户观点，以 Markdown 表格输出，包含三列：访谈问题 | 用户观点 | 场景主体。
先调用 upload_document 上传文件，再调用 analyze_interview(analysis_type: "key_findings")。
---
```

**按提纲聚类**
```
[提示词模板：按提纲聚类]
请根据用户提供的提纲（或访谈大纲文件）对访谈内容分类聚合，以 Markdown 表格输出。
先上传所有文件（upload_document），再调用 analyze_interview(analysis_type: "cluster_by_outline")。
如果用户没有提供提纲，先询问。
---
```

**AI用户画像**
```
[提示词模板：AI用户画像]
请基于访谈内容构建用户画像，包含：目标与动机 | 典型行为 | 核心痛点 | 常用工具与环境。
先上传文件（upload_document），再调用 analyze_interview(analysis_type: "generate_persona")。
---
```

**思维导图**
```
[提示词模板：思维导图]
请将访谈内容生成思维导图。
调用 analyze_interview(doc_urls=[context中的URL], analysis_type: "mindmap", context="...")，
返回的 JSON 由客户端直接渲染，无需转换格式，直接输出原始 JSON 即可。
Phase 1 临时方案（mindmap 类型尚未上线时）：读取文件内容，以文字描述核心结构。
---
```

**评估问题整理**
```
[提示词模板：评估问题整理]
请整理访谈中涉及的评估性问题及被访者的回答摘要，以 Markdown 表格输出（访谈问题 | 回答摘要 | 情感倾向）。
先上传文件（upload_document），再调用 analyze_interview(analysis_type: "evaluation_summary")。
---
```

**用研知识问答**
```
[提示词模板：用研知识问答]
用户正在提问。如有必要，先调用 search_reports 检索已有报告作为参考，再回答。
无需上传文件，除非用户明确附上了新材料。
---
```

---

## 3. 数据模型

```ts
// insight/store/prompt_template.ts

export type PromptTemplateId =
  | "key_findings"
  | "cluster_by_outline"
  | "generate_persona"
  | "mind_map"
  | "evaluation_summary"
  | "knowledge_qa"

export type PromptTemplate = {
  id: PromptTemplateId
  label: string
  group: string
  promptPrefix: string
  expectedOutput: "table" | "mermaid" | "text"
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "key_findings",
    label: "观点解析",
    group: "访谈观点洞察",
    promptPrefix: `[提示词模板：观点解析]\n请从附件访谈逐字稿中提取结构化用户观点，以 Markdown 表格输出，包含三列：访谈问题 | 用户观点 | 场景主体。\n先调用 upload_document 上传文件，再调用 analyze_interview(analysis_type: "key_findings")。\n---\n`,
    expectedOutput: "table",
  },
  {
    id: "cluster_by_outline",
    label: "按提纲聚类",
    group: "访谈观点洞察",
    promptPrefix: `[提示词模板：按提纲聚类]\n请根据用户提供的提纲对访谈内容分类聚合，以 Markdown 表格输出。\n先上传所有文件（upload_document），再调用 analyze_interview(analysis_type: "cluster_by_outline")。\n如果用户没有提供提纲，先询问。\n---\n`,
    expectedOutput: "table",
  },
  {
    id: "generate_persona",
    label: "AI用户画像",
    group: "访谈观点洞察",
    promptPrefix: `[提示词模板：AI用户画像]\n请基于访谈内容构建用户画像，包含：目标与动机 | 典型行为 | 核心痛点 | 常用工具与环境。\n先上传文件（upload_document），再调用 analyze_interview(analysis_type: "generate_persona")。\n---\n`,
    expectedOutput: "table",
  },
  {
    id: "mind_map",
    label: "思维导图",
    group: "访谈观点洞察",
    promptPrefix: `[提示词模板：思维导图]\n请调用 analyze_interview(analysis_type: "mindmap")，将 doc_urls 从 context 中提取后传入。返回 JSON 由客户端渲染，直接输出原始 JSON 即可。\nPhase 1 临时方案（mindmap 类型尚未上线时）：读取文件内容，以文字描述核心结构。\n---\n`,
    expectedOutput: "mindmap-json",
  },
  {
    id: "evaluation_summary",
    label: "评估问题整理",
    group: "评估问题整理",
    promptPrefix: `[提示词模板：评估问题整理]\n请整理访谈中涉及的评估性问题及被访者的回答摘要，以 Markdown 表格输出（访谈问题 | 回答摘要 | 情感倾向）。\n先上传文件（upload_document），再调用 analyze_interview(analysis_type: "evaluation_summary")。\n---\n`,
    expectedOutput: "table",
  },
  {
    id: "knowledge_qa",
    label: "用研知识问答",
    group: "用研知识问答",
    promptPrefix: `[提示词模板：用研知识问答]\n用户正在提问，如有必要先调用 search_reports 检索已有报告作为参考，再回答。\n无需上传文件，除非用户明确附上了新材料。\n---\n`,
    expectedOutput: "text",
  },
]

export const DEFAULT_MODE_ID: PromptTemplateId = "key_findings"
```

---

## 4. UI 组件规格

### 4.1 位置与外观

```
┌──────────────────────────────────────────────────────┐
│  [＋ 附件]  [访谈观点洞察/观点解析 ▾]      [发送]    │  ← 工具栏
└──────────────────────────────────────────────────────┘
```

- 下拉按钮显示"当前分组/当前模式"（如"访谈观点洞察 / 观点解析"）
- 宽度自适应文字，最大 200px
- 样式：与 `+ 附件` 按钮同级，文字色 `--octo-text-secondary`，hover 时高亮

### 4.2 下拉菜单结构

```
┌─────────────────────────────────────────┐
│  访谈观点洞察                            │  ← group label（灰色，不可点）
│    ✓ 观点解析                           │  ← 选中态（checkmark）
│      按提纲聚类                         │
│      AI用户画像                         │
│      思维导图                           │
│  ────────────────────────────────────  │
│  评估问题整理                            │  ← group label
│      评估问题整理                       │
│  ────────────────────────────────────  │
│  用研知识问答                            │
│      用研知识问答                       │
└─────────────────────────────────────────┘
```

### 4.3 组件实现草图

```tsx
// insight/components/prompt_template-selector.tsx
import { createSignal, For, Show } from "solid-js"
import { PROMPT_TEMPLATES, type PromptTemplateId } from "../store/prompt_template"

type Props = {
  value: PromptTemplateId
  onChange: (id: PromptTemplateId) => void
}

export function PromptTemplateSelector(props: Props) {
  const [open, setOpen] = createSignal(false)

  const current = () => PROMPT_TEMPLATES.find(m => m.id === props.value)!

  // 按 group 分组
  const groups = () => {
    const map = new Map<string, typeof PROMPT_TEMPLATES>()
    for (const m of PROMPT_TEMPLATES) {
      if (!map.has(m.group)) map.set(m.group, [])
      map.get(m.group)!.push(m)
    }
    return [...map.entries()]
  }

  return (
    <div class="prompt_template-selector" classList={{ open: open() }}>
      <button
        class="mode-trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <span class="mode-label">
          {current().group} / {current().label}
        </span>
        <span class="mode-chevron">▾</span>
      </button>

      <Show when={open()}>
        <div class="mode-dropdown" role="listbox">
          <For each={groups()}>
            {([group, modes], i) => (
              <>
                <Show when={i() > 0}>
                  <div class="mode-divider" />
                </Show>
                <div class="mode-group-label">{group}</div>
                <For each={modes}>
                  {mode => (
                    <button
                      class="mode-option"
                      classList={{ selected: mode.id === props.value }}
                      role="option"
                      aria-selected={mode.id === props.value}
                      onClick={() => {
                        props.onChange(mode.id)
                        setOpen(false)
                      }}
                    >
                      <Show when={mode.id === props.value}>
                        <span class="mode-check">✓</span>
                      </Show>
                      {mode.label}
                    </button>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
```

---

## 5. 与 PromptInput 的集成

提示词模板的状态持有在 `InsightPage` 或 `PromptInput` 的父层（与 attachment 同级）：

```tsx
// insight/index.tsx — 相关片段
const [analysisMode, setPromptTemplate] = createSignal<PromptTemplateId>("key_findings")

function handleSend(text: string, attachments: Attachment[]) {
  const mode = PROMPT_TEMPLATES.find(m => m.id === analysisMode())!

  // 拼接 prompt 前缀
  const fullText = mode.promptPrefix + text

  session.prompt({
    parts: [
      { type: "text", text: fullText },
      ...attachments.map(a => ({
        type: "file" as const,
        mime: a.mime,
        url: a.dataUrl,
        filename: a.filename,
      })),
    ],
  })
}
```

**注意**：前缀只在发送时拼接，不显示在输入框里。用户看到的输入框内容保持原样。

---

## 6. 与 OutputCard 检测的关系

`expectedOutput` 字段可作为 `detectCard` 的提示：

```ts
// insight/components/result-viewer/output-card.ts
function detectCard(text: string, hintType?: "table" | "mermaid" | "text") {
  if (hintType === "mermaid") {
    // 优先检测 mermaid（思维导图模式下 LLM 大概率输出 mermaid）
    if (/```mermaid/.test(text)) return { type: "mindmap", ... }
  }
  // 其余走现有检测逻辑
  ...
}
```

实际实现可以在 session 里存 `lastPromptTemplate` 供 `detectCard` 读取。

---

## 7. 需要 MCP server 配合新增的 analysis_type

以下 3 个模式需要内网 UXR 服务团队在 MCP server 里新增对应的 `analysis_type` 值：

| analysis_type | 什么时候调 | 期望返回 |
|---|---|---|
| `cluster_by_outline` | 按提纲聚类模式 | Markdown 表格（提纲条目 × 用户观点） |
| `generate_persona` | AI用户画像模式 | Markdown 表格（画像维度 × 内容） |
| `evaluation_summary` | 评估问题整理模式 | Markdown 表格（问题 × 摘要 × 情感） |

`knowledge_qa` 无需新增 MCP tool（使用已有的 `search_reports`）。`mindmap` 需 UXR 服务端新增 `analysis_type: "mindmap"` 支持，返回 JSON 由客户端直接渲染。

---

## 8. 验证清单

### V-01 下拉 UI

| 操作 | 预期 |
|---|---|
| 打开 InsightPage | 工具栏显示"访谈观点洞察 / 观点解析"（默认） |
| 点击下拉按钮 | 菜单弹出，3 个分组，6 个选项 |
| 点击"思维导图" | 按钮文字变为"访谈观点洞察 / 思维导图"，菜单关闭 |
| 切换 session | 提示词模板**重置**为默认（不跨 session 保留） |

### V-02 Prompt 拼接

| 操作 | 预期 |
|---|---|
| 选"观点解析"，发送"帮我分析" | Console 里实际发出的 text 以 `[提示词模板：观点解析]` 开头 |
| 用户输入框只显示"帮我分析" | 前缀不出现在输入框 |

### V-03 端到端（需 MCP 联通）

| 提示词模板 | 发送带附件的指令 | 预期 LLM 行为 |
|---|---|---|
| 观点解析 | "帮我分析" + 附件（已上传） | 从 context 取 doc_urls → 调 analyze_interview(key_findings) → 表格 OutputCard |
| 思维导图（Phase 2） | "帮我分析" + 附件（已上传） | 从 context 取 doc_urls → 调 analyze_interview(mindmap) → JSON → OutputCard |
| 用研知识问答 | "有没有算子工具的相关报告" | 调 search_reports → 回复文本 |

---

## 9. Phase 说明

- **Phase 1（当前）**：实现下拉 UI + prompt 拼接（不依赖 MCP，观点解析 + 思维导图 + 知识问答可本地验证）
- **Phase 2（MCP 联调后）**：补全 cluster_by_outline / generate_persona / evaluation_summary 三个模式
