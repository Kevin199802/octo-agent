# InsightPage 提示词模板选择器 — Spec

> **架构决策**：[ADR-007](../../adr/007-prompt-template-via-system-field.md) — 模板指令通过 `session.prompt({ system })` 传递。  
> **机制原理**：[per-call-system-prompt.md](../../learning/per-call-system-prompt.md) — opencode 的 system 字段拼接行为。  
> **MCP 接口**：[mcp-contract.md](../agents/mcp-contract.md) — analyze_interview / search_reports 参数。

---

## 1. 核心原则

- 模板指令通过 `session.prompt()` 的 `system` 字段传给 LLM，**不污染用户消息**
- 同一个 `insight` primary agent，模板只是单次系统指令注入
- agent.prompt（insight.md）描述全局工作流和工具规则，模板只补充"本轮用哪个 analysis_type"

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

### 每个模板的规格

| 模板 | analysis_type | systemHint（精简后） | UXR 服务端支持 |
|---|---|---|---|
| 观点解析 | `key_findings` | 见下 | 已有 |
| 按提纲聚类 | `cluster_by_outline` | 见下 | 待 UXR 实现 |
| AI用户画像 | `generate_persona` | 见下 | 待 UXR 实现 |
| 思维导图 | `mindmap` | 见下 | 待 UXR 实现 |
| 评估问题整理 | `evaluation_summary` | 见下 | 待 UXR 实现 |
| 用研知识问答 | —（`search_reports`） | 见下 | 已有 |

> **服务端支持状态不在客户端 UI 中体现**——所有模板均可选，调用失败时由错误提示告知用户（见 §7）。

### systemHint 文本

精简原则：只声明**本轮意图**和**输出约束**，工具调用细节由 insight.md 系统提示承担。

**观点解析**
```
本轮使用 analyze_interview(analysis_type="key_findings")。
输出三列 Markdown 表格：访谈问题 | 用户观点 | 场景主体。
```

**按提纲聚类**
```
本轮使用 analyze_interview(analysis_type="cluster_by_outline")。
若用户未提供提纲，先询问后再调用。
```

**AI用户画像**
```
本轮使用 analyze_interview(analysis_type="generate_persona")。
画像维度：目标与动机 | 典型行为 | 核心痛点 | 常用工具与环境。
```

**思维导图**
```
本轮使用 analyze_interview(analysis_type="mindmap")，返回 JSON 直接原样输出，客户端会渲染。
```

**评估问题整理**
```
本轮使用 analyze_interview(analysis_type="evaluation_summary")。
输出三列：访谈问题 | 回答摘要 | 情感倾向。
```

**用研知识问答**
```
本轮使用 search_reports(query=用户问题)，无需文件。
基于检索结果回答，标注引用来源。
```

---

## 3. 数据模型

```ts
// insight/store/prompt-template.ts

export type PromptTemplateId =
  | "key_findings"
  | "cluster_by_outline"
  | "generate_persona"
  | "mindmap"
  | "evaluation_summary"
  | "knowledge_qa"

export type PromptTemplate = {
  id: PromptTemplateId
  label: string
  group: string
  systemHint: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "key_findings",
    label: "观点解析",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="key_findings")。\n输出三列 Markdown 表格：访谈问题 | 用户观点 | 场景主体。`,
  },
  {
    id: "cluster_by_outline",
    label: "按提纲聚类",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="cluster_by_outline")。\n若用户未提供提纲，先询问后再调用。`,
  },
  {
    id: "generate_persona",
    label: "AI用户画像",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="generate_persona")。\n画像维度：目标与动机 | 典型行为 | 核心痛点 | 常用工具与环境。`,
  },
  {
    id: "mindmap",
    label: "思维导图",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="mindmap")，返回 JSON 直接原样输出，客户端会渲染。`,
  },
  {
    id: "evaluation_summary",
    label: "评估问题整理",
    group: "评估问题整理",
    systemHint: `本轮使用 analyze_interview(analysis_type="evaluation_summary")。\n输出三列：访谈问题 | 回答摘要 | 情感倾向。`,
  },
  {
    id: "knowledge_qa",
    label: "用研知识问答",
    group: "用研知识问答",
    systemHint: `本轮使用 search_reports(query=用户问题)，无需文件。\n基于检索结果回答，标注引用来源。`,
  },
]

export const DEFAULT_TEMPLATE_ID: PromptTemplateId = "key_findings"
```

---

## 4. UI 组件规格

### 4.1 位置与外观

```
┌──────────────────────────────────────────────────────┐
│  [＋ 附件]  [访谈观点洞察/观点解析 ▾]      [发送]    │  ← 工具栏
└──────────────────────────────────────────────────────┘
```

- 下拉按钮显示"当前分组/当前模板"
- 宽度自适应文字，最大 200px
- 样式：与 `+ 附件` 按钮同级，文字色 `--octo-text-secondary`，hover 高亮

### 4.2 下拉菜单结构

```
┌─────────────────────────────────────────┐
│  访谈观点洞察                            │  ← group label（灰色，不可点）
│    ✓ 观点解析                           │  ← 选中态
│      按提纲聚类                         │
│      AI用户画像                         │
│      思维导图                           │
│  ─────────────────────────────────────  │
│  评估问题整理                            │
│      评估问题整理                       │
│  ─────────────────────────────────────  │
│  用研知识问答                            │
│      用研知识问答                       │
└─────────────────────────────────────────┘
```

所有模板均可选，UI 不基于服务端支持状态做 disable。服务端尚未实现的 analysis_type 由 MCP 错误响应触发友好提示（见 §7）。

### 4.3 组件实现草图

```tsx
// insight/components/prompt-template-selector.tsx
import { createSignal, For, Show } from "solid-js"
import { PROMPT_TEMPLATES, type PromptTemplateId } from "../store/prompt-template"

type Props = {
  value: PromptTemplateId
  onChange: (id: PromptTemplateId) => void
}

export function PromptTemplateSelector(props: Props) {
  const [open, setOpen] = createSignal(false)
  const current = () => PROMPT_TEMPLATES.find(t => t.id === props.value)!

  const groups = () => {
    const map = new Map<string, typeof PROMPT_TEMPLATES>()
    for (const t of PROMPT_TEMPLATES) {
      if (!map.has(t.group)) map.set(t.group, [])
      map.get(t.group)!.push(t)
    }
    return [...map.entries()]
  }

  return (
    <div class="prompt-template-selector" classList={{ open: open() }}>
      <button class="template-trigger" onClick={() => setOpen(v => !v)}>
        <span class="template-label">{current().group} / {current().label}</span>
        <span class="template-chevron">▾</span>
      </button>

      <Show when={open()}>
        <div class="template-dropdown" role="listbox">
          <For each={groups()}>
            {([group, templates], i) => (
              <>
                <Show when={i() > 0}><div class="template-divider" /></Show>
                <div class="template-group-label">{group}</div>
                <For each={templates}>
                  {t => (
                    <button
                      class="template-option"
                      classList={{ selected: t.id === props.value }}
                      onClick={() => {
                        props.onChange(t.id)
                        setOpen(false)
                      }}
                    >
                      <Show when={t.id === props.value}>
                        <span class="template-check">✓</span>
                      </Show>
                      {t.label}
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

### 5.1 状态持有

提示词模板状态持有在 **`InsightPage` 顶层**（不放 PromptInput 内，因为 InsightPage 还需要把模板传给 ResultViewer 做 hint）。状态不跨 session 保留，切换 session 时重置默认值。

### 5.2 发送逻辑

```tsx
// insight/index.tsx — 相关片段
import { PROMPT_TEMPLATES, DEFAULT_TEMPLATE_ID, type PromptTemplateId } from "./store/prompt-template"

const [templateId, setTemplateId] = createSignal<PromptTemplateId>(DEFAULT_TEMPLATE_ID)

async function handleSend(text: string, attachments: Attachment[]) {
  const template = PROMPT_TEMPLATES.find(t => t.id === templateId())!

  await globalSDK.client.session.prompt({
    sessionID,
    agent: "insight",
    system: template.systemHint,                  // ← 模板指令走 system 字段
    parts: [
      { type: "text", text },                     // ← 用户消息保持原样
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

**关键**：用户输入的 `text` 不做任何拼接，模板指令完全走 `system` 字段。用户消息历史保持干净。

---

## 6. 与 OutputCard 检测的关系

`detectCard` 自动识别 Markdown 表格 / JSON / 纯文本，无需提示词模板传 hint：

```ts
// insight/components/result-viewer/output-card.ts
function detectCard(text: string) {
  if (isMarkdownTable(text)) return { type: "table", ... }
  if (isJsonObject(text))    return { type: "json", ... }
  return { type: "text", ... }
}
```

模板的 `systemHint` 已约束 LLM 输出格式（Markdown 表格 / JSON / 纯文本），客户端按内容自动识别即可。

---

## 7. 错误场景指引

| 场景 | 行为 |
|---|---|
| MCP 返回 unknown analysis_type（服务端尚未实现该模板） | 对话区显示"该分析类型 UXR 服务端尚未支持"的友好提示卡片，不影响其他模板使用 |
| 用户没上传文件就选 key_findings 发送 | LLM 收到 system hint 但无 doc_urls，会按 insight.md 工作流询问用户 |
| 用户选了 knowledge_qa 但又上传了文件 | LLM 优先按 knowledge_qa 处理（search_reports），文件作为补充材料 |

---

## 8. 需要 MCP server 配合新增的 analysis_type

| analysis_type | 期望返回 | 状态 |
|---|---|---|
| `key_findings` | Markdown 表格 | ✅ Phase 1 已支持 |
| `cluster_by_outline` | Markdown 表格 | ⚠️ Phase 2 待 UXR 实现 |
| `generate_persona` | Markdown 表格 | ⚠️ Phase 2 待 UXR 实现 |
| `evaluation_summary` | Markdown 表格 | ⚠️ Phase 2 待 UXR 实现 |
| `mindmap` | JSON（思维导图结构） | ⚠️ Phase 2 待 UXR 复用现有接口 |

`knowledge_qa` 模板使用已有的 `search_reports`，无需新增。

---

## 9. 验证清单

### V-01 下拉 UI（不依赖 MCP）

| 操作 | 预期 |
|---|---|
| 打开 InsightPage | 工具栏显示"访谈观点洞察 / 观点解析"（默认） |
| 点击下拉按钮 | 菜单弹出，3 个分组，6 个选项，全部可选 |
| 点击"用研知识问答" | 按钮文字更新为对应分组/标签，菜单关闭 |
| 切换 session | 模板**重置**为 default（key_findings） |

### V-02 发送行为（不依赖 MCP）

| 操作 | 预期 |
|---|---|
| 选"观点解析"，发送"帮我分析" | DevTools Network 里 `session.prompt` body 含 `system: "本轮使用 analyze_interview..."`，`parts[0].text` 仅含 "帮我分析" |
| 用户消息历史显示 | 仅 "帮我分析"，不含 systemHint 内容 |

### V-03 端到端（需 MCP 联通）

| 模板 | 操作 | 预期 LLM 行为 |
|---|---|---|
| 观点解析 | 发"帮我分析" + hardcoded doc_urls | 调 analyze_interview(analysis_type="key_findings", doc_urls=[...]) → 表格 OutputCard |
| 用研知识问答 | 发"有没有算子工具的相关报告" | 调 search_reports(query="...") → 文本回复 |

---

## 10. Phase 说明

| 阶段 | 范围 |
|---|---|
| **Phase 1（当前）** | UI（下拉 + 状态管理 + system 字段传递）；端到端依赖 MCP，需联调 |
| **Phase 2（MCP 联调后）** | UXR 实现 4 个新 analysis_type（cluster_by_outline / generate_persona / evaluation_summary / mindmap）；客户端无需改动，错误提示自动消失 |

Phase 1 完成判定：V-01 + V-02 通过即可（不依赖 MCP），V-03 在 MCP 联调阶段验证。
