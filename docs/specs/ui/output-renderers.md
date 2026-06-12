# Spec: OutputCard 渲染器与分发

> 服务端返回的内容类型（Markdown 表格 / 思维导图 JSON / 其他）由客户端检测后路由到对应渲染器。  
> 本 spec 是渲染器实现的唯一真相来源。

---

## 0. 核心原则:对话内容永不替代,卡片是"附加预览入口"

> 2026-05-26 重大调整(撤销 ADR-010 路线 A)
>
> 旧设计:机器可读类型(mindmap/html/json)出大卡时,CSS `[data-suppress-raw]` 把对话区 assistant 文字**整段隐藏**。
>
> 新设计:对话区始终由 opencode 上游 `<Markdown>` **原样渲染**(含 shiki 代码高亮 / markdown 表格 / 复制按钮);卡片改为**对话气泡下方的紧凑预览入口条**(~40px 高),作为"附加预览能力",绝不替代对话内容。

**业界对照(全行业共识:不抹对话)**:

| 产品 | 形态 |
|---|---|
| Claude.ai Artifacts | 对话保留 LLM 完整解释 + 独立 Artifact 入口卡 |
| ChatGPT Canvas | 对话保留 + 顶部小 banner「在 Canvas 中打开」 |
| Cursor | 对话保留 + 代码块右上「Apply」按钮 |
| Octo Insight(本期起) | 对话保留 + 气泡下方紧凑入口条「[icon] 标题 / 描述 [预览 →]」|

旧的 `[data-suppress-raw]` CSS 规则已删除;`octo-tokens.css` 新增 `.octo-preview-entry` 紧凑条样式(§6.B)。

---

## 0.1 两类卡片来源 — 职责边界(原 §0)

OutputCard 入口卡有两条**完全独立**的生成路径,机制 / 可靠性 / 收敛策略都不同。改 detect / 渲染逻辑前必须先认清属于哪条路径:

| 路径 | 来源 | 触发机制 | 可靠性 | 收敛方向 |
|---|---|---|---|---|
| **A. MCP 强契约** | MCP tool 返回的 `resource_link` part | 严格按 [mcp-contract.md §completed](../agents/mcp-contract.md) 解析 `content[].type === "resource_link"`，**零嗅探** | 高（契约强约束）| 持续扩展业务工具白名单 |
| **B. 自由文本嗅探** | assistant text part 里的 LLM 自由输出 | 启发式（fence / table / mindmap shape）兜底 | 中（业界 IDE 类工具标配，永远漏） | **窄而准**：仅 fence/shape 确定性场景，不再 length 兜底 |

**路径 A 内部还分两类**(by [insight-references.md](insight-references.md)):
- **A1. 产物型(artifact)** — `_octoDisplay` 缺省或 `"artifact"` → 本 spec 的 OutputCard 大卡
- **A2. 引用型(reference)** — `_octoDisplay: "reference"` → **不进 OutputCard 体系**,走 ReferenceList chip 段末清单(见 [insight-references.md §3.2](insight-references.md))

本 spec 后文 §1~§9 只描述**路径 B + 路径 A1**(OutputCard 体系)。路径 A2 完全独立,与本 spec 正交。

**核心原则**：

1. **业务长产物必须走路径 A** — 分析报告 / 思维导图 / HTML 可视化等正式产出，由 UXR MCP tool 返回 `resource_link`，前端按 `mimeType` 稳定路由开卡。这是 [ADR-011](../../adr/011-tool-result-resource-uri.md) 的根本决策。
2. **路径 B 仅对 LLM 直答兜底** — 无 MCP 工具触发时，LLM 直接在对话里输出 markdown 表格 / mindmap JSON / HTML 可视化，由前端嗅探升级为卡片。
3. **同 turn A 命中 → B 不执行** — 已在 [insight-turn.tsx:130](../../../packages/app/src/pages/insight/components/insight-turn.tsx#L130) 实现（`taskCards.length > 0` 或 `findResourceLinks().length > 0` 抢占）。
4. **改路径 B 不要影响路径 A** — §2.3 嗅探规则收紧只针对路径 B；路径 A 的解析逻辑（§2.5、`findResourceLinks`、`readTaskInfo`）独立稳定，bug 走 [task-card.md §12.0 console 节点表](task-card.md#120-联调速查--console-节点表粘-console-定位) 联调排查。

**为什么不走"LLM 工具触发"（如 Claude Artifacts / ChatGPT Canvas 的 `canmore` 伪工具）**：

| 维度 | LLM 触发 | 我们的选择 |
|---|---|---|
| 实现 | system prompt 注入伪工具，模型按 tool_call 协议返回特定 tag | 路径 A（真 MCP tool）+ 路径 B（嗅探）|
| 依赖 | 强依赖模型指令遵循（Claude/GPT 95%+，其他模型不可靠） | 不依赖模型能力 |
| 适用 | 单一模型平台（Anthropic / OpenAI 自家产品）| 多模型场景（DeepSeek R1 / flash / GPT / Claude 都要支持）|

我们走的是"**真 MCP tool（强）+ fence/shape 嗅探（兜底）**"，与 IDE 系工具（Cursor / VS Code Chat / Continue）一致。未来若嗅探被证明太不稳定，再考虑在 [insight agent.md](../../../packages/agent/octo_insight/agents/octo_insight.md) 里加 fence 约定（强约束 LLM 输出格式）+ 前端识别。

---

## 1. 输出类型 taxonomy

当前支持 6 种 OutputCard 类型（与 6 个提示词模板的对应见 [insight-analysis-mode.md §2](insight-analysis-mode.md)）：

| 类型 | 触发模板 / 来源 | 服务端返回形态 | 入口卡文案 | 渲染器（ResultViewer 内） | 状态 |
|---|---|---|---|---|---|
| `table` | 观点解析 / 按提纲聚类 / AI用户画像 / 评估问题整理 | Markdown 表格字符串 | 分析表格 | TableRenderer | ✅ 已实现 |
| `mindmap` | 思维导图 | JSON 结构（UXR 现有接口） | 思维导图 | MindmapRenderer（markmap-view）+ 预览/代码切换 | ✅ 已实现 |
| `html` | 未来富展示类 MCP tool（如独立的用户画像/可视化 tool）| HTML 字符串（建议 ```html``` fence 包裹） | 可视化页面 | HtmlRenderer（iframe sandbox）| ✅ 已实现 |
| `markdown` | 用研知识问答 + 走 MCP `text/markdown` resource_link | Markdown 纯文本 | Markdown 文档 | MarkdownRenderer（复用上游 `<Markdown>`）| ✅ 已实现 |
| `json` | 路径 A `application/json` resource_link（非 mindmap shape）/ 路径 B 嗅探到独立 JSON | JSON 字符串 | JSON 数据 | JsonRenderer（**上游 `<Markdown>` ```json fence 获 shiki 高亮**） | ✅ 已实现 |
| `file` | 路径 A Office / PDF / 图片 / 二进制 resource_link | 二进制 URI | 文件名 | FileFallback（"用本地应用打开"+"下载"双按钮）| ✅ 已实现 |

**视图切换(预览/代码) — 单卡内切换,取代旧"双卡"(2026-05-30 调整)**：

> **旧设计**：mindmap 出**两张入口卡**(json + mindmap),各开一个 tab。
> **新设计**：mindmap 收敛为**单卡**(`type: "mindmap"`),打开后在 ResultViewer 顶部用「预览 / 代码」分段切换——预览=markmap 渲染,代码=原始 JSON(shiki 高亮)。同理 html(渲染↔源码)、table(表格↔markdown 源)、markdown(渲染↔md 源)。

| 类型 | 预览态(默认) | 代码态 | 切换 |
|---|---|---|---|
| `mindmap` | markmap 思维导图 | 原始 JSON(shiki) | ✅ |
| `html` | iframe 渲染 | HTML 源(shiki) | ✅ |
| `table` | 样式化表格(抽 table token) | **表格本体的 Markdown 源**(`extractTableMarkdown`,shiki) | ✅ |
| `markdown` | 渲染后文档 | Markdown 源(shiki) | ✅ |
| `json` | —(JSON 本身即"代码") | shiki 高亮 JSON | ❌ 单视图 |
| `file` | —(不在应用内预览) | —(二进制无源) | ❌ 单视图,且 ActionBar 隐藏复制/下载(交给 FileFallback) |

实现:`ResultTab.viewMode: "preview" \| "source"`(缺省 preview),`tab-store.setViewMode` 更新;`isToggleType()` 判定是否出切换控件;代码态统一走 `SourceCodeView`(把内容包 ```lang fence 喂上游 `<Markdown>` 获 shiki 高亮)。切换控件在 ActionBar 行左侧,与复制/下载同排。

> **table 卡四视图一致性(2026-06-10)**:路径 B 嗅探出的 `table` 卡,其 `content` 是命中表格的那个 text part **全文**——可能含表格上方的对话/说明正文(典型:访谈逐字稿 + 末尾「对话要点提炼」表)。table 卡的定位是「摘要表的预览 + 导出」,故四个动作**统一只呈现表格本体**,不带出正文:
> - 预览 `TableRenderer` 抽 `marked` 的 table token;
> - 复制 / 下载(md/CSV/Excel)走 `extractTableMarkdown` / `parseMarkdownTable`;
> - **代码态** `SourceCodeView` 同样喂 `extractTableMarkdown(content)`(而非原始全文),否则会单独露出正文、与其余三者不一致。
>
> 完整正文不丢:对话区始终全文渲染(§0),磁盘产物文件亦为全文。若需要「右栏呈现整份文档」而非仅摘要表,应让其走 `markdown` 卡(全文渲染/复制/下载),而非 `table` 卡。

为什么改单卡:双卡占两个 tab、入口冗余,且"同一份产物的两种视图"本就该是一个对象的两个面(业界 Claude Artifacts / ChatGPT Canvas 都是单 artifact 内 预览/代码 切换)。

**两种内容来源（[ADR-011](../../adr/011-tool-result-resource-uri.md)）**：

- `source: "inline"`——内容嵌在 assistant text part 里（路径 B 嗅探的来源）
- `source: "uri"`——MCP 工具返回 `resource_link`（路径 A），URI 指向内网 S3 上的完整内容，渲染器按 mimeType 路由后 fetch URI

检测分发与各 renderer 改造见 §2.5。

**不规划 Office 文件应用内预览**（docx/pptx/xlsx）—— [ADR-009](../../adr/009-no-office-preview.md)。但**唤起本地应用是默认行为**：FileFallback 提供"用本地应用打开"按钮，`shell.openPath` 由 OS 关联应用打开（Excel/WPS/Numbers），详见 §5。

实际 type 集合最终以 UXR MCP 服务端返回的内容为准——客户端按内容形态路由，不绑定具体 MCP 工具名。MCP 工具清单见 [mcp-contract.md](../agents/mcp-contract.md)。

**原始文字显示策略**：OutputCard 出现时，对机器可读类型（`mindmap` / `html` / `json`）隐藏 assistant 的原始文字区；对 `markdown` / `table` 保留显示（内容本身对用户有可读价值）。当前实现：`InsightTurn` 在卡片 ready 后挂 `data-suppress-raw` 属性，CSS 规则隐藏文字区（过渡方案，流完才生效）。MCP 联调后将升级为路线 B（tool_call part 到达时即切换 loading 占位，原始内容从不暴露），详见 [ADR-010](../../adr/010-suppress-raw-output.md)。

---

## 2. detectCard 分发规则（路径 B —— 自由文本嗅探）

> **作用范围**：本节所有规则**仅适用于路径 B**（assistant text part 的 LLM 自由输出嗅探）。路径 A 走 §2.5 的 MCP `resource_link` 强解析，零嗅探。

### 2.1 收紧后的优先级（2026-05 修订）

```ts
// 优先级从上到下（针对 assistant text part 内容）
1. isMarkdownTable(text)             → table
2. isMindmapJSON(text)               → mindmap
3. scanFencedHtml(parts)             → html  (每个 ```html fence 块 1 张卡，支持多卡)
4. isPlainJSON(text)                 → json  (收紧：≥80 字符 + (fence 或 ≥3 keys))
                                     × markdown 长文本兜底 — 删除
                                     × 其他语言 fence 升级 — 删除（复用上游 Markdown 高亮）
```

**为什么删 `length > 200 → markdown` 兜底**：
- 业界对照：Claude.ai Artifacts 要求 ≥1500 字 + 自包含可编辑；ChatGPT Canvas 由 LLM 显式工具触发；Cursor / VS Code Chat 只对 fence 升级。**没有一家**把"长一点的对话回复"自动升级成卡片。
- 我们之前的 200 字阈值导致图 1 那种 240 字解释性回复被误判成"分析报告"。
- 长产物应走路径 A（MCP `resource_link`），路径 B 不背负长文本展示责任。

**为什么 `plainJSON` 加严**：
- 旧规则 `tryParseJSON(text) !== null` 会把 `{"foo":"bar"}` / `[1,2,3]` 这种琐碎片段也升级成卡。
- 新规则要求 **≥80 字符** + **（带 fence 或 ≥3 个 key）**，过滤短碎片。

**为什么只 `html` fence 升级，其他语言 fence 不升级**：
- 只有 HTML 可以预览（iframe sandbox）；其他语言（python / sql / bash / ts 等）的代码块在卡片里就是 pre 高亮，对用户**等价于直接在对话流里读**——升级成卡反而割裂。
- 对话流的代码块由 opencode 上游 `<Markdown>` 组件用 shiki 渲染（图 2 的橙紫高亮就是它），已经足够好。

### 2.2 检测实现

```ts
// 1. Markdown 表格（保留，识别准确率高）
function isMarkdownTable(text: string): boolean {
  if (/\|[\s]*[-:]+[-:\s|]*\|/.test(text)) return true
  const tableLines = text.split("\n")
    .filter((l) => l.trim().startsWith("|") && (l.match(/\|/g) ?? []).length >= 3)
  return tableLines.length >= 2
}

// 2. Mindmap JSON：检测 = 渲染。直接复用渲染适配函数,「能渲染成 markmap 才算命中」。
//    实现在 mindmap-adapter.ts(detect 的上层,避免循环依赖),不再单独写一套 shape 嗅探。
function isMindmapJSON(text: string): boolean {
  return uxrJsonToMarkdown(text) != null   // 实现见 mindmap-adapter.ts
}
// 为什么不再单独写 hasMindmapShape:旧实现的 shape 嗅探比渲染规则更松
// (对 { nodes: [] } / 空 mindmaps 判 true,但 collectRoots 收不到根 → 渲染为空),
// 导致"判定命中但渲染失败兜底"的漂移。检测与渲染共用同一条规则后,从根上消除该不一致。

// 3. HTML：扫所有 text part 找 ```html fence（多 fence → 多卡）
//    单 part 内既支持闭合 fence,也接受流式中途未闭合的 fence(取到字符串末尾)
function scanFencedHtml(parts: { text?: string }[]): string[] {
  const blocks: string[] = []
  for (const p of parts) {
    if (typeof p.text !== "string") continue
    // 已闭合
    const closedRe = /```html\b\s*\n([\s\S]+?)\n?```/gi
    let m: RegExpExecArray | null
    let lastIdx = 0
    while ((m = closedRe.exec(p.text)) !== null) {
      if (m[1].trim().length >= 50) blocks.push(m[1])
      lastIdx = closedRe.lastIndex
    }
    // 流式中途未闭合(最后一个 ```html 之后无配对 ```):取到末尾
    const tailRe = /```html\b\s*\n([\s\S]+)$/i
    const tail = tailRe.exec(p.text.slice(lastIdx))
    if (tail && !tail[1].includes("```") && tail[1].trim().length >= 50) blocks.push(tail[1])
  }
  return blocks
}

// 4. 通用 JSON（收紧）：必须 ≥80 字符 且 (带 fence 或 ≥3 个 key)
function isPlainJSON(text: string): boolean {
  const stripped = stripCodeFence(text)
  if (stripped.length < 80) return false
  const json = tryParseJSON(stripped)
  if (!json) return false
  const hasFence = /```(?:json)?\s*\n/i.test(text)
  const keyCount =
    typeof json === "object" && !Array.isArray(json) && json !== null
      ? Object.keys(json).length
      : Array.isArray(json) ? json.length : 0
  return hasFence || keyCount >= 3
}
```

**优先级理由**：mindmap JSON 在 HTML 之前，避免 HTML 内嵌 JSON-like 字符串误判；HTML 在 plainJSON 之前，因为 HTML 可能含 `<script>{...}</script>` 让 JSON 检测失败但应走 HTML 路径。

### 2.3 业界对照

| 工具 | 触发机制 | 我们是否借鉴 |
|---|---|---|
| **Claude.ai Artifacts** | LLM 触发：system prompt 教模型生成 `<antArtifact>` 标签 + 启发式（≥1500 字自包含 / >20 行可复用代码 / HTML / SVG / React） | ❌ 不借鉴 LLM 触发（依赖单一模型遵循率）；✅ 借鉴"窄而准"的启发式阈值 |
| **ChatGPT Canvas** | LLM 触发：注入 `canmore.create_textdoc` 伪工具，模型按 tool_call 返回 | 同上 |
| **Cursor / Continue / VS Code Chat** | 纯 fence 嗅探，无 LLM 触发 | ✅ 我们的路径 B 走这条 |
| **GitHub Markdown** | 严格按 fence 语言 | ✅ 我们的 html fence 借鉴 |

我们当前的取舍：
- **路径 A 严格契约** = MCP tool 返回 `resource_link`（强信号，零嗅探，类似 "ChatGPT Canvas 走 canmore tool" 但是真 MCP 工具）
- **路径 B 窄而准的嗅探** = fence / table / mindmap shape（类 Cursor 路线）

如果未来路径 B 在多模型场景下漏检率太高，再考虑在 [insight agent.md](../../../packages/agent/octo_insight/agents/octo_insight.md) 加 fence 约定（强约束 LLM 输出格式），前端按约定 tag 识别，等价于 ChatGPT Canvas 的"伪工具触发"但通过 prompt 实现。短期不做。

### 2.4 console 调试埋点（路径 B）

所有 detect 决策必须打 console，便于内网（DeepSeek flash）和外网（DeepSeek R1）输出差异问题快速定位：

| tag | 触发点 | 字段 |
|---|---|---|
| `[octo:detect] start` | `detectCards` 入口 | msgID / partsCount / 前 80 字摘要 |
| `[octo:detect] match` | 规则命中 | rule（table/mindmap/html/json）/ part 索引 / 摘要 |
| `[octo:detect] reject` | 全部规则未命中 | 拒绝理由 / 完整文本前 200 字 |
| `[octo:detect] html-fence-found` | scanFencedHtml 命中 | fence 数量 / 每块字符数 / 是否闭合 |

发外网时：内网 DevTools Console 全选复制 → 粘消息里，按 tag grep 定位。

---

## 2.5 resource_link 来源的检测与分发

> 上游决策：[ADR-011](../../adr/011-tool-result-resource-uri.md)。MCP 工具按内容大小分级返回——短内容走 text part（沿用 §2.3），长内容 / 二进制内容走 text 摘要 + `resource_link` 双 part。

### 2.5.1 检测优先级（覆盖 §2.3）

一条 assistant 消息可能包含 **0 至 N 个** `resource_link` part（多文件场景下 N > 1，见 [mcp-contract.md §completed](../agents/mcp-contract.md)），加上至多一个文本摘要 part。

```
对于每条 assistant 消息的 parts:
1. 收集所有 type === "resource_link" 的 part(0~N 个)
   ├─ N >= 1 → 为每个 resource_link 各建一张 OutputCard
   │            按各自 mimeType 路由(§2.5.2),source: "uri"
   │            (摘要 text part 用作 InsightTurn 的对话区文字,不再单独建卡)
   └─ N == 0 → 走原有 §2.3 启发式,source: "inline"(单卡)
```

`resource_link` part 形态（来自 MCP 协议）：

```ts
type ResourceLinkPart = {
  type: "resource_link"
  uri: string
  name: string
  mimeType: string
  description?: string
}
```

opencode 将 MCP `CallToolResult.content[]` 中的 `resource_link` 项作为独立 part 转发到 SSE，前端读 `data.store.part[messageID]` 即可拿到。多个 resource_link 在 `parts` 数组里按声明顺序出现。

### 2.5.2 路由规则:business_type 优先,mimeType 兜底

路径 A resource_link 的路由按**两级规则**(`business_type` 字段定义见 [mcp-contract.md](../agents/mcp-contract.md))。

**第一级 — `business_type` 字段**:

| business_type 取值 | 行为 |
|---|---|
| `"mindmap"` | **单卡** `type: "mindmap"`(`linkToOutputType` 统一路由)。打开后用「预览 / 代码」切换看 markmap 渲染或原始 JSON(见 §1 视图切换)。~~旧:双卡(json + mindmap)~~ |
| 其他取值(如 `"key_findings"` / `"search_reports"` 等)/ 缺失 | 走第二级 mimeType 路由 |

> 路由统一走 `linkToOutputType(link)`(`business_type` 优先,mimeType 兜底),两条出卡路径(insight-turn 路径 A / index `buildOutputCardsFromTask` 任务卡)共用,避免漂移。
> 第一版只有 `"mindmap"` 触发特殊类型;其他 tool 名取值都按通用产物走 mimeType 路由。
> 未来如需为某个 tool 加专属渲染(如 search_reports 走 ReferenceList chip,见 [insight-references.md](insight-references.md)),在本表追加一行 + 客户端加分支。

**第二级 — mimeType 路由(其他 business_type / 缺失时)**:

| mimeType | OutputCardType | 渲染策略 |
|---|---|---|
| `text/html` | `html` | fetch URI → 拿到 HTML → 走 HtmlRenderer 的 iframe sandbox（§5）|
| `text/markdown` | `markdown` | fetch URI → 走 MarkdownRenderer |
| `application/json` | `json` | fetch URI → 走 JsonRenderer(shiki 高亮)。**不做二次判断 retype**——是不是 mindmap 由服务端 `business_type` 显式声明,客户端不再嗅探 |
| `text/csv` | `table` | fetch URI → 转 Markdown 表格 → 走 TableRenderer |
| Office（xlsx / docx / pptx）/ PDF / 图片 / 二进制 | `file` | 不在 ResultViewer 内渲染，FileFallback 提供**双按钮**：①「用本地应用打开」`download-resource` IPC → 落地临时文件 → `window.api.openPath` 唤起 OS 关联应用（Excel/WPS/Numbers）②「下载到本地」`window.api.saveFilePicker` 用户选目录 → 落地。详见 §5 + [ADR-009](../../adr/009-no-office-preview.md) |
| 其他未识别 | `file` fallback | 同上双按钮 |

**为什么删除"`application/json` 内容二次判断 retype"**:

旧实现:对话流出 1 张 json 卡 → 用户点开 → fetch + `isMindmapJSON` 判断 → 命中则 retype 为 mindmap。问题:
- 卡片标题始终是 "JSON 数据"(误标——内容是思维导图),用户体验断层
- 客户端做 shape 嗅探,跟"业务类型由服务端声明"的设计哲学冲突

新设计:服务端 `business_type: "mindmap"` 显式声明,客户端直接出**单卡**(`type: "mindmap"`,预览/代码切换),**零嗅探**。

**路径 A 内容违约的兜底(2026-06 修订)**:服务端声明 `business_type: "mindmap"` 但实际文件内容不是 mindmap shape 时(服务端违反契约),客户端无法在出卡阶段预校验——内容是打开卡片时才 fetch 的(`UriTabBody`),出卡时只有 `uri`。因此降级发生在**卡内渲染时**:`ResultViewer` 的 mindmap 分支用 `isMindmapJSON(content)` 校验,不符就**直接显示代码视图(原始 JSON)**而非空的错误占位,也**不另起新卡**(原始 JSON 本就在这张卡的「代码」切换里)。与路径 B 共用同一条 `isMindmapJSON` 规则。

### 2.5.3 OutputCard / ResultTab 类型扩展

```ts
// insight-turn.tsx
export type OutputCard = {
  id: string
  title: string                     // 多文件场景下用 resource_link.name 派生
  type: OutputCardType
  source: "inline" | "uri"          // 新增
  content?: string                  // source === "inline" 时必填(沿用现状)
  uri?: string                      // source === "uri" 时必填
  mimeType?: string                 // source === "uri" 时必填,影响渲染分支
  fileName?: string                 // source === "uri" 时,来自 resource_link.name
  description?: string              // source === "uri" 时,来自 resource_link.description,展示在卡片副标题
  createdAt: Date
}
```

`tab-store.ts` 的 `ResultTab` 同步扩展。

[insight-turn.tsx:107](../../../packages/app/src/pages/insight/components/insight-turn.tsx#L107) 现有的 `outputCard` memo（单卡）需改造为 `outputCards`（返回 `OutputCard[]`），相应地 `InsightTurn` 组件用 `For` 渲染 0~N 张卡片堆叠：

```
┌─ assistant 摘要文字（来自 text part）
├─ [📊 interview-analysis-report.html        →]
├─ [{} key-findings.json                      →]
└─ [📋 user-quotes.xlsx                       →]
```

每张卡点击 → 各自 `openTab(card)` 打开独立 Tab；TabBar 横向滚动支持多 Tab 已具备，无需改 store。

### 2.5.4 各 renderer 改造点（fetch 路径）

```tsx
// 通用辅助
async function loadResourceText(uri: string): Promise<string> {
  const res = await fetch(uri)
  if (!res.ok) throw new Error(`fetch ${uri}: ${res.status}`)
  return res.text()
}
```

| Renderer | 改造 |
|---|---|
| TableRenderer | 入参从 `content: string` 改为 `content?: string \| uri?: string`；URI 模式下 createResource + Suspense fallback "加载中..." |
| MindmapRenderer | 同上；fetch 后走 `uxrJsonToMarkdown` 适配 |
| HtmlRenderer | 同上；`srcdoc={inlineHtml}` 或 `src={uri}`（URI 模式直接走 iframe src，省一次 fetch，但需确认 sandbox 跨域规则——见 §5.4 决策） |
| MarkdownRenderer | 同上 |

加载状态由 SolidJS `createResource` 处理，错误走 §8 错误处理 fallback。

### 2.5.5 缓存策略

- **session 内缓存**：同一 URI 在同一 session 内只 fetch 一次，存入 `tab-store` 的 `content` 字段（懒填充）
- **跨 session 不持久化**：用户重开 session 点旧卡片仍重新 fetch（依赖 ADR-011 约定的"URI 长期可用"）
- 关闭 session 时不主动清缓存，由内存回收

### 2.5.6 错误处理

| 场景 | 行为 |
|---|---|
| URI 网络不可达（404 / 超时） | OutputCard 显示"加载失败，点击重试"占位，ActionBar 提供"复制链接"按钮供手动排查 |
| mimeType 未识别 | 走 `file` fallback，仅提供下载链接 |
| `resource_link` 缺 `mimeType` 字段 | 视作 `application/octet-stream` → `file` fallback；日志输出 `[mcp:invalid-resource]` 警告 |

---

## 3. TableRenderer

### 3.1 现状

`packages/app/src/pages/insight/components/result-viewer/table-renderer.tsx`：
- 输入：Markdown 表格字符串
- 渲染为 HTML `<table>`
- 支持横向滚动、空单元格占位

### 3.2 ActionBar 导出（现状 + 新增 Excel）

`packages/app/src/pages/insight/components/result-viewer/action-bar.tsx`：

**现状：**
- 复制：复制 Markdown 原文
- 下载：表格类型 → CSV（hand-rolled `markdownTableToCSV`）；其他类型 → .md

**改造：**

1. **提取共享 helper**：

```ts
// utils/markdown-table.ts
export function parseMarkdownTable(md: string): string[][] {
  const lines = md.split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith("|"))
    .filter(l => !/^\|[\s\-:|]+\|$/.test(l)) // 去掉分隔行
  return lines.map(l => 
    l.slice(1, -1).split("|").map(c => c.trim())
  )
}
```

2. **CSV 导出**（用 helper）：

```ts
function tableToCSV(md: string): string {
  return parseMarkdownTable(md)
    .map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n")
}
```

3. **Excel 导出**（新增）：

依赖：`write-excel-file`（~30KB，简单 2D 数组→xlsx）

```ts
import writeXlsxFile from "write-excel-file"

async function tableToXlsx(md: string, filename: string) {
  const rows = parseMarkdownTable(md)
  if (rows.length === 0) return
  const data = rows.map(row => row.map(c => ({ value: c, type: String })))
  await writeXlsxFile(data, { fileName: filename })
}
```

4. **ActionBar 按钮**：

```
[复制]  [下载 ▾]
        ├─ Markdown (.md)
        ├─ CSV (.csv)
        └─ Excel (.xlsx)    ← 新增
```

下载按钮改为下拉菜单，避免占用太多空间。或者保留单按钮 + 默认 CSV，加单独的 "导出 Excel" 二级菜单——UI 形态由实现时再定。

### 3.3 Excel 库选择理由

| 库 | 大小 | 评价 |
|---|---|---|
| `write-excel-file` | ~30KB | ✅ 推荐——API 简单，覆盖我们用例 |
| `xlsx` (SheetJS) | ~400KB | 全功能，对我们 overkill |
| `exceljs` | ~600KB | 同上 |

`write-excel-file` 是 ESM、支持 Tree Shaking，对 bundle size 影响最小。

### 3.4 跨平台兼容

Excel 文件在浏览器/Electron 渲染进程**生成 .xlsx 二进制**后下载，不依赖系统 Office。
- Mac：用户拿到 .xlsx，可用 Numbers / Excel for Mac / WPS 打开
- Windows：可用 Excel / WPS / LibreOffice 打开
- 无平台差异

---

## 4. MindmapRenderer（新）

### 4.1 输入

UXR `mindmap` 工具返回的 JSON（工具契约见 [mcp-contract.md](../agents/mcp-contract.md)）。实际 shape（UXR 测试环境确认）：

```json
[
  [
    {
      "name": "用研主题",
      "children": [
        {
          "name": "痛点",
          "children": [
            { "name": "调试流程复杂", "children": [] }
          ]
        },
        {
          "name": "机会点",
          "children": []
        }
      ]
    }
  ]
]
```

特征：
- 外层数组包裹数组（双层 `[]`）—— 外层视作 group 列表，内层是该 group 的 root 节点列表
- 每个节点只有两个字段：`name`（string）和 `children`（递归数组）
- 叶子节点 `children` 是空数组 `[]`

### 4.2 渲染库选择

视觉效果是核心需求。对比：

| 库 | 视觉评估 | 工作量 | 维护活跃度 |
|---|---|---|---|
| **markmap-view** | ✅ 手绘曲线连接、节点动画、平滑 pan/zoom，业界 mindmap 视觉标杆（Obsidian Mind Map 用它） | JSON→markdown 适配函数（递归 ~15 行） | 高 |
| AntV G6 mindmap layout | ⚠️ 默认偏"节点图"风格，要做出 mindmap 质感需深度 customize edge/style | 节点+边格式转换 + 大量样式配置 | 极高 |
| jsmind | ⚠️ 默认样式偏旧 | 直接吃 JSON | 中等（更新放缓）|
| mermaid mindmap | ⚠️ 静态 SVG，无交互 | JSON→mermaid 文本 | 高（但已决定不走） |
| ECharts tree | ⚠️ 工业图表风，非 mindmap 风 | 大 | 极高 |

**采用 `markmap-view`**。理由：单论视觉效果优势明显，bundle ~300KB 桌面 app 可接受，适配工作量低。

### 4.3 实现要点

```tsx
// components/result-viewer/mindmap-renderer.tsx
import { Transformer } from "markmap-lib"
import { Markmap } from "markmap-view"
import { onMount, onCleanup } from "solid-js"

const transformer = new Transformer()

export function MindmapRenderer(props: { content: string }) {
  let svgRef: SVGSVGElement | undefined
  let mm: Markmap | undefined

  onMount(() => {
    if (!svgRef) return
    const markdown = uxrJsonToMarkdown(props.content)
    if (!markdown) return
    const { root } = transformer.transform(markdown)
    mm = Markmap.create(svgRef, undefined, root)
  })

  onCleanup(() => mm?.destroy())

  return (
    <svg
      ref={svgRef}
      class="mindmap-canvas"
      style={{ width: "100%", height: "100%" }}
    />
  )
}
```

> 上为示意版。实际组件还含:容器尺寸兜底(ResizeObserver,面板按需弹出时 width:0 不会算出 NaN transform)、以及 `uxrJsonToMarkdown` 返回 null 时的精简占位「无法渲染为思维导图」(仅一行说明,不贴原始内容/不引导去别处)。正常流程下 `ResultViewer` 已用 `isMindmapJSON` 预校验、内容违约时直接降级为代码视图(见 §2.5.2 路径 A 内容违约兜底),故该占位是组件自身的防御兜底,常态不触达。

### 4.4 适配层：UXR JSON → Markdown

```ts
// utils/mindmap-adapter.ts
import { stripCodeFence, tryParseJSON } from "./detect"

export function uxrJsonToMarkdown(text: string): string | null {
  const json = tryParseJSON(stripCodeFence(text))
  if (!Array.isArray(json)) return null

  const roots = json.flat()  // 拆掉外层数组包裹（[[...]] → [...]）
  if (roots.length === 0) return null

  return roots.map(node => renderNode(node, 0)).join("\n")
}

function renderNode(node: { name: string; children?: any[] }, depth: number): string {
  const prefix = depth === 0 ? "# " : "  ".repeat(depth - 1) + "- "
  const line = prefix + (node.name ?? "(空)")
  const childLines = (node.children ?? []).map(c => renderNode(c, depth + 1))
  return [line, ...childLines].join("\n")
}
```

转换示例：
```
[[{name: "主题", children: [{name: "痛点", children: [{name: "A", children: []}]}]}]]
        ↓
# 主题
- 痛点
  - A
        ↓ markmap-lib transformer
INode 树 → markmap-view 渲染为 SVG
```

### 4.5 导出（ActionBar）

| 选项 | 实现 |
|---|---|
| 复制 JSON | 复制原始 JSON 字符串 |
| 下载 .json | blob 下载原始 JSON |
| 导出 SVG | 直接 `svgRef.outerHTML` 序列化下载 |
| 导出 PNG | SVG → canvas → toBlob，P2 视需求实现 |

### 4.6 边界处理

| 场景 | 行为 |
|---|---|
| 外层不是数组 | 解析失败 → §8 错误处理 fallback |
| 外层数组但 flat 后为空 | 显示"思维导图为空"占位 |
| 节点没有 name 字段 | 渲染为 "(空)" |
| children 不是数组 | 视作叶子节点 |

---

## 5. HtmlRenderer（新）

### 5.1 输入

UXR 未来会通过新增 MCP tool（如独立的用户画像可视化 tool）返回 HTML 字符串，可能形态：
- ```html\n<!DOCTYPE html>...\n``` （fence 包裹完整文档，推荐）
- 不带 fence 的完整 `<!DOCTYPE html>...` 文档
- HTML 片段（`<div>...</div>`，无 doctype）

`detectCard` 三种都能识别（见 §2.3）。渲染时统一交给 iframe srcDoc。

### 5.2 渲染：iframe sandbox

HTML 内容来自 LLM/MCP 服务端，**不能信任为完全无害**（即便内网）。用 iframe sandbox 隔离：

```tsx
// components/result-viewer/html-renderer.tsx
export function HtmlRenderer(props: { content: string }) {
  const html = stripCodeFence(props.content)  // 复用 §2.3 的 helper
  
  return (
    <iframe
      sandbox="allow-scripts"
      srcdoc={html}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        background: "white",
      }}
    />
  )
}
```

### 5.3 sandbox 策略

| 属性 | 启用 | 理由 |
|---|---|---|
| `allow-scripts` | ✅ | 可视化（D3/echarts 等内联 JS）需要 |
| `allow-same-origin` | ❌ | **绝不启用**，与 allow-scripts 同时启用相当于无 sandbox |
| `allow-forms` | ❌ | 没有表单提交场景 |
| `allow-top-navigation` | ❌ | 防止 HTML 跳转主窗口 |
| `allow-popups` | ❌ | 防止弹窗骚扰 |
| `allow-modals` | ❌ | 防止 alert/confirm 阻塞 |

只开 `allow-scripts`，其他全关。这样 HTML 里的 JS 能跑（可视化 OK），但拿不到 cookie、没法跳转、没法访问父页面。

### 5.4 srcDoc vs src

用 `srcdoc`（内联 HTML 字符串）而不是 `src=blob:URL`：
- ✅ 简单：不需要管理 blob URL 生命周期
- ✅ 沙箱效果一致
- ⚠️ 注意：`srcdoc` 内容超大（>1MB）时部分浏览器有性能问题，UXR 输出预期 < 100KB，无影响

### 5.5 高度处理

iframe 默认高度 0，需要显式给。三种方案：

| 方案 | 优劣 |
|---|---|
| 固定铺满父容器 + 内部滚动 | ✅ 简单，与 ResultViewer panel 一致 |
| postMessage 通信传 contentHeight | 复杂，需要约定协议 |
| ResizeObserver | 跨 iframe 不可用 |

推荐**方案 1**（固定铺满 + 内部滚动），与 TableRenderer / MindmapRenderer 一致。

### 5.6 ActionBar 导出

| 选项 | 实现 |
|---|---|
| 复制 HTML 源码 | 复制原始字符串（去除 fence） |
| 下载 .html | blob 下载 `text/html;charset=utf-8` |
| 在浏览器打开 | `window.api.openPath(tempFilePath)` 唤起系统默认浏览器（需主进程协助写临时文件） |

前两个 P1 实现，"在浏览器打开" P2 视需求。

### 5.7 安全清单

- [ ] `sandbox` 属性只含 `allow-scripts`，不含 `allow-same-origin`
- [ ] 不在 srcDoc 之外把 HTML 内容插到主文档（避免 XSS）
- [ ] 不允许 HTML 内 JS 通过 postMessage 与父页面通信（默认就不允许）
- [ ] 下载文件时 filename 做基础 sanitize（去掉路径分隔符）

---

## 6. MarkdownRenderer（现状）

长文本 / 知识问答回复走通用 Markdown 渲染（已实现）。无规划变动。

---

## 6.B 紧凑预览入口条（OutputCard 视觉,本期新设计）

### 6.B.1 设计目标

按 §0 核心原则:
- 对话区不被替代,LLM 输出的代码段 / markdown 表格 / 思考文字**完整保留**
- 卡片**降级为入口条**(~40px 高),作为"附加预览"能力
- 多类型并列时(json + mindmap 同一段命中)出多张并排入口条

### 6.B.2 布局

```
┌─ assistant 对话气泡(opencode <Markdown> 完整渲染) ────┐
│ 我帮你画一个柱状图:                                    │
│ ```html                                                │
│ <!DOCTYPE html>...                                     │  ← shiki 高亮 + 复制按钮
│ ```                                                    │
└────────────────────────────────────────────────────────┘
┌─ 紧凑入口条(~40px,样式 .octo-preview-entry) ─────────┐
│ [icon] 可视化页面                          [预览 →]   │
└────────────────────────────────────────────────────────┘
┌─ 多类型并列时第二张 ──────────────────────────────────┐
│ [icon] JSON 数据                            [预览 →]   │
└────────────────────────────────────────────────────────┘
```

样式由 [octo-tokens.css](../../../packages/app/src/pages/insight/octo-tokens.css) `.octo-preview-entry` 系列 class 定义。

### 6.B.3 点击行为

点击入口条 → `onOpenResult(card)` → `tabStore.openTab(card)`:
- `(uri, type)` 复合命中已有 tab → 激活已有 tab
- 否则新建 tab,激活
- 同 URI 不同 type(典型:json + mindmap)各开一个 tab,互不冲突

### 6.B.4 与旧设计的对比

| 维度 | 旧(本期前) | 新(本期起) |
|---|---|---|
| 卡片高度 | ~60-80px,含描述 + 时间 | ~40px,仅图标 + 标题 + 描述 + "预览 →" |
| 对话区文字 | mindmap/html/json 类型出卡时**整段隐藏**(CSS suppress) | **完整保留** |
| 多类型命中 | 按优先级取一个 | **并列多张** |
| 视觉权重 | 抢主对话区焦点 | 辅助入口,不抢焦点 |

### 6.B.5 不做的事

- ❌ **不**给 fence 代码块旁加预览按钮(选项 A — DOM 注入,有上游 streaming patch 干扰风险,本期不做)
- ❌ **不**给 fence 代码块加下载按钮(上游 `<Markdown>` 已有复制按钮,下载是低频需求,Markdown 表格的 CSV/Excel 下载继续在入口卡的 ActionBar 里)
- ❌ **不**修改 opencode 上游 `<Markdown>` 组件(保持纯上游复用,future-proof)

---

## 6.A FileFallback（Office / PDF / 二进制）

### 6.A.1 设计目标

按 [ADR-009](../../adr/009-no-office-preview.md)，Office 文件**不在 app 内预览**，但**唤起本地应用是默认行为**。FileFallback 提供两个明确按钮：

```
┌───────────────────────────────────────────────┐
│ 📄 user-quotes.xlsx                           │
│ application/vnd.openxmlformats... · 该格式不在应用内预览 │
│                                               │
│ [ 用本地应用打开 ]    [ 下载到本地 ]           │
└───────────────────────────────────────────────┘
```

| 按钮 | 行为 |
|---|---|
| **用本地应用打开** | `window.api.downloadResource(uri, tempPath)` → `window.api.openPath(tempPath)`。OS 用关联应用打开（macOS LaunchServices / win ShellExecute），通常是 Excel / WPS / Numbers / Keynote / Preview |
| **下载到本地** | `window.api.saveFilePicker({ defaultPath: filename })` 用户选目录 → `downloadResource(uri, chosenPath)` |

> **ActionBar 对 `file` 类型隐藏复制/下载**(2026-05-30):file 的 `content` 从不 fetch(二进制),ActionBar 的「复制/下载」复制不出内容、也无意义,整组隐藏;打开/下载完全交给 FileFallback 自己的双按钮。`ActionBar` 内 `showActions = tab.type !== "file"`。

### 6.A.2 为什么不用 `<a target="_blank" href={uri}>`

旧实现的 bug（详见图：点击 xlsx 弹两个窗口）：
- Electron 渲染进程的 `<a target="_blank">` 触发默认 window.open 行为，新开 BrowserWindow 显示空白 Octo 页（about:blank 在 chromium 内被 webview 接管）
- 然后 chromium 内置下载弹"另存为"对话框 → 第二个窗口
- 用户既没"打开"也没真"下载到指定位置"

新方案：**完全走 IPC，不依赖浏览器默认行为**。

### 6.A.3 唤起的优先级 / 兼容性

`shell.openPath` 走 **OS 默认关联应用**，不由我们指定 app。所以"优先 Office 次选 WPS"由用户机器的文件关联决定，不在客户端控制。

| 平台 | 常见关联 | 备注 |
|---|---|---|
| **macOS** | xlsx → Excel for Mac / Numbers / WPS；pptx → Keynote / PowerPoint；docx → Word / Pages | 内置 Numbers/Keynote/Preview 兜底，几乎不会"无关联应用" |
| **Windows** | xlsx → Excel / WPS（内网常见）；某些机器 OneDrive 抢关联（→ 浏览器版 Office Online） | 内网无 OneDrive，不担心；只装 WPS 也能正常打开 |

**失败处理**：`shell.openPath` 返回非空错误字符串 / `downloadResource` 抛错 → toast「未找到关联应用，请安装 Excel / WPS 或在系统设置中关联打开方式」+ console error。

### 6.A.4 接线层依赖

新增 main 进程 IPC（详见 [architecture.md §5.4](../../architecture.md#54-上游接线壳改动清单)）：

```ts
// preload: window.api.downloadResource
downloadResource(url: string, destPath: string): Promise<void>
// main 实现：node fetch(url) → fs.writeFile(destPath, buffer)
```

temp 路径策略：`app.getPath("temp") + "/octo/" + sessionId + "/" + sanitizedFilename`，sessionId 维度隔离避免冲突，OS 定期清 temp 自动 GC。

### 6.A.5 P2 — 用其他应用打开（不做）

旧规划过的「[用 ▾]」二级菜单（显式 Excel / WPS / LibreOffice 列表）**暂不做**。理由：内网无 OneDrive 抢关联场景，OS 默认行为已足够。如未来内网用户反馈关联混乱，再加 `checkAppExists`（已存在 IPC）+ 二级菜单。

---

## 7. 与 systemHint 的协作

提示词模板的 `systemHint` 已经隐式约束了 LLM 输出格式：

| 模板 | systemHint 约束 | 期望 detectCard 命中 |
|---|---|---|
| 观点解析 | "输出三列 Markdown 表格" | `table` |
| 按提纲聚类 | "Markdown 表格" | `table` |
| AI用户画像 | "画像维度..." | `table` |
| 评估问题整理 | "输出三列..." | `table` |
| 思维导图 | "返回 JSON 直接原样输出" | `mindmap` |
| 用研知识问答 | "基于检索结果回答" | `markdown` |

如果 LLM 输出与预期不符（比如表格模板输出了纯文本），fallback 到 `markdown` 渲染器，不会渲染失败。

---

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| Markdown 表格解析失败（行不齐等） | 渲染前 2 列，剩余忽略；不中断 |
| Mindmap JSON 解析失败 | OutputCard 显示"思维导图数据格式异常"，下方显示原始内容 |
| Excel 库加载失败 | Toast 提示"导出失败，请重试"，CSV 按钮保留可用 |
| HTML 内 JS 执行报错 | iframe 沙箱内静默失败，不影响主窗口；用户可下载 .html 自行排查 |
| HTML 内容为空字符串 | OutputCard 显示"HTML 内容为空"占位，避免空白 iframe |

---

## 9. 验证清单

### 9.0 联调前手动自验（无需 UXR MCP）

> **目的**：单测覆盖 detect 逻辑 / adapter 转换 / CSV 转义等纯逻辑（见 `packages/app/src/pages/insight/utils/detect.test.ts`）。本节流程覆盖**眼睛才能看见的东西**：markmap SVG 是否真画出、iframe 沙箱是否真隔离、.xlsx 在 Numbers/Excel 里是否真打开、xlsx 在 mac/win 唤起本地应用是否成功。
>
> **前置**：InsightPage 配好任意 LLM provider，能正常对话。下列 prompt 直接粘进输入框即可。
>
> **模型差异警告**：路径 B 嗅探依赖 LLM 输出格式，不同模型差异大。每条 case 标注**已验证过的模型**，新模型上线前必须重新跑一遍：
>
> | 环境 | 模型 | 上次验证 |
> |---|---|---|
> | 外网 | DeepSeek R1（思维链） | 2026-05-25（本次嗅探收紧前） |
> | 内网 | DeepSeek flash | 待重新验证 |
>
> R1 爱写解释性前缀（"好的，我帮你..."），flash 更结构化直出。嗅探收紧后这两个的卡片命中行为可能变化，必须双模型回归。

#### V0-A 思维导图渲染 + 导出 + 双卡并列

**粘这条 prompt**：

```
直接输出 JSON，不要任何解释文字。
shape: [[{"name": "...", "children": [{"name": "...", "children": [...]}]}]]
主题"调试工具用户研究"，至少 3 层、8 个节点。
```

**验收**（2026-05-30 改单卡 + 视图切换）：
- [ ] **对话区**显示 JSON 原文(opencode shiki 高亮),不再被隐藏
- [ ] 对话气泡下方出现**一张入口条**「思维导图 [预览]」(不再是双卡)
- [ ] 点开 → ResultViewer 新 tab,**默认预览态**显示 markmap SVG(**手绘曲线连接节点**),点节点可折叠/展开子树
- [ ] ActionBar 左侧出现「预览 / 代码」分段控件;点「代码」→ 同一 tab 内切到原始 JSON(shiki 高亮),点「预览」切回 markmap
- [ ] ActionBar [下载 ▾] → JSON (.json) 文件能用任意文本编辑器打开

#### V0-A2 内网真实 shape — `[{file, mindmaps:[...]}]`

**模拟数据**(粘 prompt):
```
直接输出 JSON,无 fence:
[{"file": "downloads/访谈.docx", "mindmaps": [{"name": "用户访谈提纲", "children": [{"name": "基本信息", "children": [{"name": "部门"}]}]}]}]
```

**验收**:
- [ ] 单张「思维导图」入口条出现(不再双卡)
- [ ] 预览态:思维导图根节点是 file basename(此例为"访谈"),子节点为 mindmaps[0] 的内容
- [ ] 切「代码」态:JSON 内容跟原文一致

#### V0-B HTML 可视化 + 沙箱

**粘这条 prompt**：

```
输出一段完整 HTML，用 ```html fence 包裹，含 <!DOCTYPE>、<style>、内联 <script>。
内容：用 div + CSS 画一个 4 柱柱状图（柱高分别 30% / 60% / 80% / 45%，柱子颜色不同）。
<script> 里加 console.log("html-renderer ok")。
```

**验收**：
- [ ] **对话区显示完整 HTML 代码段**(opencode shiki 高亮),不再被隐藏
- [ ] 对话气泡下方出现紧凑入口条「可视化页面 [预览 →]」(~40px 高,不是大卡)
- [ ] 点开入口条 → ResultViewer 渲染出 4 柱柱状图（**真的有不同高度和颜色**，不是源码 pre 块）
- [ ] 打开 DevTools Console → 能看到 `html-renderer ok`（说明 `allow-scripts` 生效）
- [ ] DevTools Elements 检查 iframe → `sandbox="allow-scripts"`，**不含** `allow-same-origin`
- [ ] ActionBar [下载 ▾] → HTML (.html) → 双击下载文件能在浏览器打开

#### V0-C 表格 + Excel 导出

**触发方式**：用现有"观点解析"提示词模板触发一次正常分析（systemHint 已约束 markdown 表格输出）。或粘这条 prompt：

```
输出一个 markdown 表格，3 列，第一列"观点"，第二列"频次"，第三列"代表用户"，至少 5 行真实示例内容（用研场景）。
```

**验收**：
- [ ] OutputCard 类型图标为表格（`IconCardTable`）
- [ ] 点开卡片 → ResultViewer 显示 HTML 表格（表头浅灰、行斑马纹）
- [ ] ActionBar [下载 ▾] 下拉显示 **3 个选项**：Markdown / CSV / Excel
- [ ] 下载 .md → 用文本编辑器打开，是原始 markdown 表格语法
- [ ] 下载 .csv → 双击用 Excel/Numbers 打开，**中文不乱码**，列结构正确
- [ ] 下载 .xlsx → 双击用 Excel/Numbers 打开，**中文不乱码**，列结构正确

#### V0-D-NEW 对话区不抹(本期核心红线)

**粘这条 prompt**:

```
我要画一个柱状图。先解释思路:用 div + CSS 控制每个柱子的 height。然后给完整 HTML 代码。
```

**验收**:
- [ ] 对话区**保留全部 LLM 文字**:解释思路段落 + HTML 代码段(shiki 高亮)
- [ ] 下方紧凑入口条「可视化页面 [预览]」
- [ ] 对话区**没有任何文字被隐藏**(对比旧设计:HTML fence 命中后整段对话会被 CSS 藏掉)

> ⚠️ **本条是核心回归红线**。删除 `[data-suppress-raw]` 后,任何"输出大卡但藏对话"的回潮都属于功能倒退。

#### V0-D fallback 行为 + 反例（嗅探收紧后必跑）

**D-1 短文本 — 不开卡**：

```
就回我一个字"好"，不要别的内容。
```
- [ ] 对话区直接显示助手文字"好"，**不开 OutputCard**

**D-2 长 markdown 解释性回复 — 收紧后不开卡（反例）**：

```
写一段约 300 字的用研访谈纪要，包含 # 一级标题、若干 ## 二级标题、若干 - 项目。不要表格，不要 JSON，不要 HTML。
```
- [ ] **不开 OutputCard**（length > 200 兜底已删除）
- [ ] 对话区里 markdown 由上游 `<Markdown>` 组件原位渲染（标题、列表样式正常）
- [ ] Console 看到 `[octo:detect] reject` 含 `reason: "no rule matched"` 或类似

> ⚠️ **本条是回归红线**：嗅探收紧前这种长文本会被升级成"分析报告"卡片（误判，见图 1 bug）。

**D-3 其他语言代码块 — 不升级（反例）**：

```
帮我写一段 Python 函数，输入一个 list 输出去重后的 list，给出完整可运行代码，用 ```python fence 包裹。
```
- [ ] **不开 OutputCard**
- [ ] 对话区代码块由上游 Markdown shiki 高亮正常显示
- [ ] Console 看到 `[octo:detect] reject`

**D-4 短 JSON 片段 — 不升级（反例）**：

```
就告诉我 `{"foo":"bar"}` 这个 JSON 是合法的吗,不要别的内容。
```
- [ ] **不开 OutputCard**（plainJSON 收紧后短碎片不升级）
- [ ] Console 看到 `[octo:detect] reject` 含 `reason: "json too short / few keys"`

#### V0-E Office 文件本地应用唤起（路径 A，需 mac + win 双平台跑）

> **前置**：内网 UXR MCP 已能返回带 `resource_link` 的 xlsx / pptx 完成态任务。本节验证 FileFallback 双按钮 + 跨平台 OS 关联。

**触发**：跑一次会产出 xlsx 的业务工具（如多文件版的"观点解析"），等任务 completed，点任务卡片 [查看完整结果] → 切到 xlsx tab。

**通用验收（不分平台）**：
- [ ] FileFallback 显示 **3 个按钮**：「本地打开」「文件夹打开」「下载」
- [ ] **不再出现** target="_blank" 的空白 Octo 弹窗（旧 bug）
- [ ] Console 看到 `[octo:office] download-start` + `[octo:office] open-path`

**E-1 macOS · Office for Mac**：
- [ ] 「用本地应用打开」→ 唤起 **Excel for Mac**，xlsx 正常打开、中文不乱码

**E-2 macOS · 仅 Numbers（无 Office）**：
- [ ] 「用本地应用打开」→ 唤起 **Numbers**（系统兜底），xlsx 正常打开

**E-3 Windows · Office**（内网用户机器装 Office 的）：
- [ ] 「用本地应用打开」→ 唤起 **Excel**

**E-4 Windows · WPS**（内网用户机器装 WPS 的，常见）：
- [ ] 「用本地应用打开」→ 唤起 **WPS 表格**

**E-5 「下载到本地」按钮**（任意平台）：
- [ ] 点击 → 弹**原生 Save 对话框**（不是 chromium 内置下载条）
- [ ] 选目录确认 → 文件落地，双击能打开

**E-6 失败 toast**（手工触发：mock `downloadResource` 拒绝 或断网）：
- [ ] 显示 toast「未找到关联应用，请安装 Excel / WPS 或在系统设置中关联打开方式」
- [ ] Console 看到 `[octo:office] open-failed` 含具体错误

> ⚠️ 内网无 OneDrive，不验证 OneDrive 抢关联场景。

#### V0-F Tab 去重（同一 URI 多入口不重复开 tab）

**触发**：在已有任务卡（completed）的 session 里，**先点任务卡的 [查看完整结果]**（开 N 个 tab），**再点对话流末尾同 turn 的 SSE 文件卡片**（同一份产物的另一入口）。

**验收**：
- [ ] **tab 总数不变**（不是翻倍）
- [ ] 后点的入口**激活已有 tab**，不新建
- [ ] Console 看到 `[octo:tab] dedupe-by-uri` 含 `existingTabId` + `incomingCardId`
- [ ] 关掉一个 tab，再点任一入口 → 重新打开
- [ ] 多文件场景（N > 1）：每个 URI 独立去重，N tabs ≤ 数 ≤ 入口次数

#### V0-G 跨 turn 任务卡 vs 刷新 turn SSE 卡（入口冗余但 tab 唯一）

**触发**：长任务 turn 1 提交 → turn 2 用户点 ↻ 刷新 → turn 3 LLM 返回 completed（带 resource_link）。

**验收**：
- [ ] turn 1 任务卡显示「查看完整结果」按钮（指向 N 个 URI）
- [ ] turn 3 同时也出现 SSE 流的 inline 卡片（同一 URI 的另一入口）— [task-card.md §3.5](task-card.md#35-故意保留的冗余刷新-turn-的-outputcard) 故意保留的入口冗余
- [ ] **点任一入口都激活同一 tab**（按 URI 去重）

---

### 9.1 console 调试日志速查表

发外网定位问题时，请把内网完整 console 粘到对话框。我按 tag 过滤定位。

| tag | 含义 | 出现时机 |
|---|---|---|
| `[octo:sync] session.sync` | 切 session 触发原生 sync | 切 session 时 |
| `[octo:sync] status` | session busy↔idle | 状态变化 |
| `[octo:sync] dir-switched` | 切项目目录后 url 仍停旧目录会话,守卫 replace 回新建空态(防旧会话跨目录串台;含 from/to 目录 + staleSessionID) | 切关联文件夹(或在其他页切目录后返回 insight)且 url 带旧会话 id 时 |
| `[octo:title] set` / `kept` | insight 会话标题护栏:`set`=收到真标题写入;`kept`=拦下默认标题倒灌(已是真标题时不让 `New/Child session - <iso>` 覆盖回去)。用于区分「标题已生成被倒灌(A)」与「标题根本没生成(B)」——只见 `set`/`kept`=A;一直不见 `set`=B | 每条 `session.updated`/`session.created` SSE 命中已存在会话时 |
| `[octo:prompt] send` / **`send-full`** / `optimistic added` / `sent (async)` / `failed` | 发送消息全链路（`send-full` 含**未截断的完整输入文本**）| 发送/失败 |
| **`[octo:assistant] turn-complete`** | 一条 assistant 消息流完 | busy → idle 切换那一刻 |
| **`[octo:assistant] text-part-detail`** | 该消息每个 text part 的**完整原文**（不截断） | 同上 |
| **`[octo:assistant] tool-part-detail`** | 每个 tool part 的 toolName / status / metadata / **完整 output 原文 + 解析后 JSON** | 同上 |
| `[octo:detect] start` / `match` / `reject` / `html-fence-found` | 路径 B 嗅探决策 | 每条 assistant 消息流完 |
| `[octo:task-detect] readTaskInfo` | 路径 A 任务 part 解析 | 每个 task 类型 part |
| `[octo:resource-link] found` / `none-found-but-candidates-present` | 路径 A resource_link 解析（含命中 branch 计数）| 每条 assistant 消息流完 |
| `[octo:resource] fetch start` / `ok` / `failed` | 路径 A URI fetch | 打开 uri 模式卡 |
| `[octo:task] aggregate diff` | 任务卡聚合变化 | tasks 状态变化 |
| `[octo:task] refresh click` / `markRefreshed` / `stop click` / `followup seed` | 任务卡操作 | 用户点按钮 |
| `[octo:task] openResult` / `auto-openResult` | 任务卡打开结果 | 点查看结果 / 自动开 |
| `[octo:tab] openTab` / `dedupe-by-uri-and-type` / `dedupe-by-id` | tab 创建 / (uri,type) 复合去重 / id 去重 | openTab 调用 |
| `[octo:office] download-start` / `download-ok` / `open-path` / `open-failed` | Office 唤起 | 点 FileFallback 按钮 |
| `[octo:office] reuse-locked` (主进程 warn) | 覆盖写临时副本时 **EBUSY/EPERM**=文件正被本地应用占用,已回退复用已下载副本(不报错) | 文件已在 Word/Excel/WPS 打开后,再点「本地打开」/「在文件夹中打开」 |
| `[octo:queue] enqueued` / `flushing` / `canceled` | busy 排队 | busy 时发送 / idle 后 flush |

**定位"LLM 究竟返回了什么"的最快路径**:
1. 复现一次怪问题 → 等 assistant 回完(idle)
2. DevTools Console 搜 `[octo:assistant]` → 看到 turn-complete 摘要 + 每个 part 的完整 dump
3. 把这 4~5 条 log 复制粘到外网对话框 → 我按 tag 定位

---

### 9.2 跨平台 / 跨模型 验证矩阵

每次合入前必跑（标注上次通过日期 + 模型/平台）：

| Case | 外网 R1 | 内网 flash | macOS | Win | 上次通过 |
|---|---|---|---|---|---|
| V0-A 思维导图 | ✓必须 | ✓必须 | — | — | — |
| V0-B HTML 沙箱 | ✓必须 | ✓必须 | — | — | — |
| V0-C 表格 + Excel 导出 | ✓必须 | ✓必须 | — | — | — |
| V0-D 反例不开卡（D-1~D-4） | ✓必须 | ✓必须 | — | — | — |
| V0-E Office 唤起 | — | — | E-1 / E-2 必须 | E-3 / E-4 至少 1 个 + E-5 | — |
| V0-F Tab 去重 | ✓必须 | — | — | — | — |
| V0-G 跨 turn 入口冗余 | 内网联调（依赖真任务） | 内网联调 | — | — | — |

### 9.3 已被单测覆盖的部分（无需手动）

下列项已在 `detect.test.ts` 验证，改代码会自动回归，不必每次手动跑：

- detectCard 优先级（table > mindmap JSON > HTML > plain JSON > markdown）
- `isMindmapJSON` 对带 fence / 不带 fence / 单根 / 双层数组 shape 的识别
- `isHTML` 对 fence / doctype / 富片段（≥3 标签）的识别
- `isPlainJSON` 收紧后的最短长度 + key 数量阈值（新增）
- `scanFencedHtml` 多 fence / 未闭合 fence 行为（新增）
- `parseMarkdownTable` 切分 + `tableToCSV` 引号转义
- `uxrJsonToMarkdown` 双层数组 → markmap markdown 转换、空节点占位、空数组返回 null

---

## 10. Phase 与依赖

| 工作项 | Phase | 依赖 |
|---|---|---|
| detectCard 改造（mermaid → mindmap JSON + HTML 检测） | 已完成 | — |
| TableRenderer Excel 导出 + parseMarkdownTable helper | 已完成 | — |
| MindmapRenderer + 适配层 | 已完成 | — |
| HtmlRenderer + sandbox iframe + 下载 | 已完成 | — |
| **resource_link 检测分发 + OutputCard `source: "uri"` 改造**（§2.5） | 已完成 | — |
| **各 renderer URI fetch 路径**（§2.5.4） | 已完成 | — |
| **resource_link 错误占位 + 缓存策略**（§2.5.5 / §2.5.6） | 已完成 | — |
| **§0 职责边界 + §2.3 嗅探收紧（删 length>200、json 加严、仅 html fence 升级）** | 本轮（2026-05） | — |
| **HTML 嗅探鲁棒化（扫所有 part / 多 fence 多卡 / 未闭合 fence）** | 本轮（2026-05） | — |
| **tab uri 去重（同一 URI 多入口不重复开 tab）** | 本轮（2026-05） | tab-store.ts |
| **FileFallback 双按钮（用本地应用打开 / 下载到本地）** | 本轮（2026-05） | preload + main `download-resource` IPC（[architecture.md §5.4](../../architecture.md#54-上游接线壳改动清单)）|
| **全链路 console 埋点（detect/tab/office/resource）** | 本轮（2026-05） | — |
| **预览/代码 视图切换（mindmap 双卡→单卡 + html/table/markdown 加切换）+ file 隐藏复制/下载** | 2026-05-30 | tab-store `viewMode` / `linkToOutputType` / `SourceCodeView` |
| **§9 验证步骤扩充（V0-D 反例 / V0-E office / V0-F dedupe / 模型差异栏）** | 本轮（2026-05） | mac + win 双平台手动跑 V0-E |

**联调期可能的小调整**：
- resource_link：opencode 转发 MCP `resource_link` content 为 part 的实际字段名 / 形态，待联调时确认（spec 假设 `type === "resource_link"` 直接平铺，若被嵌在其他结构里需要调整 §2.5.1 的探测逻辑）。本轮在 `findResourceLinks` / `readTaskInfo` 加 console 埋点辅助联调
- mimeType 路由表（§2.5.2）按 UXR 实际产出的 MIME 类型补充
- html：如 UXR 输出 HTML 不带 fence 也不带 doctype，可能需要在 `isHTML` (§2.3) 加更宽松的检测规则
