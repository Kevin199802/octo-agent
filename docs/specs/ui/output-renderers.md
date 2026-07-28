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

## 0.1 卡片来源 — 职责边界(原 §0)

OutputCard 入口卡有三条**完全独立**的生成路径,机制 / 可靠性 / 收敛策略都不同。改 detect / 渲染逻辑前必须先认清属于哪条路径:

| 路径 | 来源 | 触发机制 | 可靠性 | 收敛方向 |
|---|---|---|---|---|
| **A. MCP 强契约** | MCP tool 返回的 `resource_link` part | 严格按 [mcp-contract.md §completed](../agents/mcp-contract.md) 解析 `content[].type === "resource_link"`，**零嗅探** | 高（契约强约束）| 持续扩展业务工具白名单 |
| **B. 自由文本嗅探** | assistant text part 里的 LLM 自由输出 | 启发式（html fence / mindmap shape）兜底 | 中（业界 IDE 类工具标配，永远漏） | **窄而准**：仅 html fence / mindmap shape 确定性场景；不再 length 兜底，**也不再嗅探 md 表格**(2026-06) |
| **C. write 工具产物(收窄为 md/html 白名单,2026-07)** | Agent 调 `write` 写到本地的 **`.md` / `.html`** 文件 | `findWriteCards` + 扩展名白名单(`type ∈ {markdown, html}`)，**零嗅探** | 高（扩展名确定性判定）| 白名单只收「有应用内专用预览」的类型;其余 write 产物不出卡、只走文件管理 |

> **路径 C 演进:全量出卡(2026-06)→ 退役(#384)→ 收窄为 md/html 白名单(2026-07,SPEC-INS-014 v6)。**
>
> **#384 为什么退役全量路径 C**:2026-06 的默认「凡 write 产物都出卡」在「写脚本再执行」工作流下崩坏——模型为生成 docx 先 `write` 写 `gen_word.ps1`、再 `powershell` 执行产出 docx，**脚本(手段)被出卡、真交付物 docx 抓不到反而不出卡**(§2.6.1 已知边界 1+2)。根因是「交付物 vs 过程产物/scratch」**没有可靠确定性信号可分辨**。
>
> **v6 为什么能重开(且不违反确定性)**:白名单**不去判「交付物 vs scratch」那个无解问题**——它判的是另一件确定性的事:**「这个扩展名有没有应用内专用预览价值」**。`.md`→markdown 编辑器、`.html`→iframe 渲染,是纯粹的扩展名属性,不猜意图。`.ps1`/`.docx`/`.py` 不出卡不是因为我们判定它「是 scratch」,而是因为它们**不在预览白名单里**——#384 那个无法确定性区分的点被绕开了,而不是重新踩进去。所以脚本仍不出卡(#384 的收益保住),md/html 交付物恢复就地预览。
>
> **与 #368 落点重定向的合成**:md/html write 经 [octo-outputs-redirect](../../../packages/opencode/src/agent/octo-outputs-redirect.ts) 落会话 `outputs/`,于是**既出预览卡(路径 C)、又必然在文件管理(outputs 磁盘扫描)出现**——与路径 A 的「出卡 + eager 落 outputs + 文件管理」行为一致,不是冗余。
>
> **「write 完成 → 文件管理刷新」覆盖全部 write 产物**(不止 md/html):任何 write 都落 outputs、都要刷新文件管理,故该 effect 仍扫全量 `findWriteCards`、不按白名单过滤——与出卡白名单是两条正交的线。
>
> **业界对照**:文件树=所有文件(Cursor/Copilot Workspace);artifact/canvas=有预览价值的产物(Claude Artifacts/ChatGPT Canvas)——本质就是「文件管理列全部 + 白名单类型额外给预览卡」这个组合。
>
> **保留路径 A / B。** 后文 §2.6.x 详细机制(path 源卡 / 本地读盘 / `source:"path"`)对 **md/html 仍是现行实现**;`.json`/`.csv`/`code`/`file` 等路径 C 分支已随 #384 剔除、不再出卡(仅历史追溯)。脚本产物(bash/powershell 产出的 docx/xlsx)出卡的根治仍属契约层,见 ROADMAP。

**路径 A 内部还分两类**(by [insight-references.md](insight-references.md)):
- **A1. 产物型(artifact)** — `_octoDisplay` 缺省或 `"artifact"` → 本 spec 的 OutputCard 大卡
- **A2. 引用型(reference)** — `_octoDisplay: "reference"` → **不进 OutputCard 体系**,走 ReferenceList chip 段末清单(见 [insight-references.md §3.2](insight-references.md))

本 spec 后文 §1~§9 只描述**路径 B + 路径 A1**(OutputCard 体系)。路径 A2 完全独立,与本 spec 正交。

**核心原则**：

1. **业务长产物必须走路径 A** — 分析报告 / 思维导图 / HTML 可视化等正式产出，由 UXR MCP tool 返回 `resource_link`，前端按 `mimeType` 稳定路由开卡。这是 [ADR-011](../../adr/011-tool-result-resource-uri.md) 的根本决策。
2. **路径 B 仅对 LLM 直答兜底** — 无 MCP 工具触发时，LLM 直接在对话里输出 mindmap JSON / HTML 可视化，由前端嗅探升级为卡片。**md 表格不在此列**(2026-06 移除)：对话里 LLM 直出的 md 表格由上游 `<Markdown>` 原样渲染(带复制)即足够，再升级成卡属冗余入口；业务表格走路径 A(`text/csv` resource_link)。
3. **同 turn A 命中 → B 不执行** — 已在 [insight-turn.tsx:130](../../../packages/app/octoapp/pages/insight/components/insight-turn.tsx#L130) 实现（`taskCards.length > 0` 或 `findResourceLinks().length > 0` 抢占）。
4. **改路径 B 不要影响路径 A** — §2.3 嗅探规则收紧只针对路径 B；路径 A 的解析逻辑（§2.5、`findResourceLinks`、`readTaskInfo`）独立稳定，bug 走 [task-card.md §12.0 console 节点表](task-card.md#120-联调速查--console-节点表粘-console-定位) 联调排查。

**为什么不走"LLM 工具触发"（如 Claude Artifacts / ChatGPT Canvas 的 `canmore` 伪工具）**：

| 维度 | LLM 触发 | 我们的选择 |
|---|---|---|
| 实现 | system prompt 注入伪工具，模型按 tool_call 协议返回特定 tag | 路径 A（真 MCP tool）+ 路径 B（嗅探）|
| 依赖 | 强依赖模型指令遵循（Claude/GPT 95%+，其他模型不可靠） | 不依赖模型能力 |
| 适用 | 单一模型平台（Anthropic / OpenAI 自家产品）| 多模型场景（DeepSeek R1 / flash / GPT / Claude 都要支持）|

我们走的是"**真 MCP tool（强）+ fence/shape 嗅探（兜底）**"，与 IDE 系工具（Cursor / VS Code Chat / Continue）一致。未来若嗅探被证明太不稳定，再考虑在 [insight agent.md](../../../packages/opencode/src/agent/prompt/octo_insight.md) 里加 fence 约定（强约束 LLM 输出格式）+ 前端识别。

---

## 1. 输出类型 taxonomy

当前支持 7 种 OutputCard 类型（前 6 种与 6 个提示词模板的对应见 [insight-analysis-mode.md §2](insight-analysis-mode.md)；`code` 原为路径 C 新增）：

> **注(2026-07):** 路径 C **收窄为 md/html 白名单**(见 §0.1 / §2.6 顶部横幅)。下表中「来源」列标「路径 C」者:**`markdown`/`html` 仍出卡**;`code`/`json`/`file`/`table` 等**非白名单路径 C 分支不再触发出卡**——这些 write 产物只由「文件管理」面板呈现。`code` 类型现仅剩历史意义(路径 A/B 不产 code 卡、路径 C 也不再出 code 卡);渲染器代码保留不影响。

| 类型 | 触发模板 / 来源 | 服务端返回形态 | 入口卡文案 | 渲染器（ResultViewer 内） | 状态 |
|---|---|---|---|---|---|
| `table` | 路径 A `text/csv` resource_link（业务工具产出的表格文件） | CSV → Markdown 表格 | 分析表格 | TableRenderer | ✅ 已实现 |
| `mindmap` | 思维导图 | JSON 结构（UXR 现有接口） | 思维导图 | MindmapRenderer（markmap-view）+ 预览/代码切换 | ✅ 已实现 |
| `html` | 未来富展示类 MCP tool（如独立的用户画像/可视化 tool）| HTML 字符串（建议 ```html``` fence 包裹） | 可视化页面 | HtmlRenderer（iframe sandbox）| ✅ 已实现 |
| `markdown` | 用研知识问答 + 走 MCP `text/markdown` resource_link | Markdown 纯文本 | Markdown 文档 | MarkdownRenderer（**2026-06 起复用 Vditor 渲染引擎 `MarkdownPreview`**，与全屏编辑器同源、效果一致；~~旧:上游 `<Markdown>`~~，见 [insight-markdown-editor §6.3.1](insight-markdown-editor.md)）| ✅ 已实现 |
| `json` | 路径 A `application/json` resource_link（无 `business_type:"mindmap"`）/ **路径 C `.json` write 产物** / 路径 B 嗅探到独立 JSON | JSON 字符串 | JSON 数据 | JsonRenderer（**上游 `<Markdown>` ```json fence 获 shiki 高亮**） | ✅ 已实现 |
| `file` | 路径 A Office / PDF / 图片 / 二进制 resource_link | 二进制 URI | 文件名 | FileFallback（"用本地应用打开"+"下载"双按钮）| ✅ 已实现 |
| `code` | **路径 C** write 工具写的代码/纯文本(.py/.ts/.txt/.sql/无扩展名…;csv/office/二进制走 `file`) | 本地文本文件 | 文件名 | SourceCodeView(上游 `<Markdown>` ```lang fence 获 shiki 高亮,lang 按扩展名 `langFromPath`)单视图 | ✅ 已实现 |

**视图切换(预览/代码) — 单卡内切换,取代旧"双卡"(2026-05-30 调整)**：

> **旧设计**：mindmap 出**两张入口卡**(json + mindmap),各开一个 tab。
> **新设计**：mindmap 收敛为**单卡**(`type: "mindmap"`),打开后在 ResultViewer 顶部用「预览 / 代码」分段切换——预览=markmap 渲染,代码=原始 JSON(shiki 高亮)。同理 html(渲染↔源码)、table(表格↔markdown 源)、markdown(渲染↔md 源)。

| 类型 | 预览态(默认) | 代码态 | 切换 |
|---|---|---|---|
| `mindmap` | markmap 思维导图 | 原始 JSON(shiki) | ✅ |
| `html` | iframe 渲染 | HTML 源(shiki) | ✅ |
| `table` | 样式化表格(抽 table token) | **表格本体的 Markdown 源**(`extractTableMarkdown`,shiki) | ✅ |
| `markdown` | 渲染后文档 | Markdown 源(shiki) | ✅ |
| `json` | **思维导图 shape(树)→ markmap;否则无预览态** | shiki 高亮 JSON | **条件切换(2026-06-24)**:内容是导图 shape(顶层带 `children`)→ 默认 markmap 预览 + 出「预览/代码」切换;普通配置 JSON 单显源、无切换 |
| `file` | —(不在应用内预览) | —(二进制无源) | ❌ 单视图,且 ActionBar 隐藏复制/下载(交给 FileFallback) |

实现:`ResultTab.viewMode: "preview" \| "source"`(缺省 preview),`tab-store.setViewMode` 更新;切换控件可见性 = `isToggleType(type)`(mindmap/html/table/markdown 恒显)**或** `type==="json" && isMindmapJSON(content)`(json 卡按内容判定,见 `action-bar.showToggle`);代码态统一走 `SourceCodeView`(把内容包 ```lang fence 喂上游 `<Markdown>` 获 shiki 高亮)。切换控件在 ActionBar 行左侧,与复制/下载同排。

> **`json` 卡的条件切换(2026-06-24,选项 C)**:`json` 与 `mindmap` 在 `ResultViewer` 内**共用同一条渲染分支**——预览态且 `isMindmapJSON(content)` 真 → `MindmapRenderer`(markmap),否则 → `SourceCodeView`(json shiki)。差异只在「切换控件是否出」:`mindmap` 卡(路径 A `business_type:"mindmap"`)恒出切换、默认预览;`json` 卡(路径 C `.json` / 路径 A 泛型 `application/json` / 路径 B 嗅探)**按内容**——树形 JSON(如 `{name,type,children}` 组织架构)默认 markmap 预览且可切「代码」,普通配置 JSON 单显源。这样既不在入口卡误标(图标仍是 JSON),又让"能渲染成导图的树"默认就看到可视化,与业界"JSON 为主、可视化是可选 view"(JSON Crack)一致。**注**:markmap 仅取节点 `name`/`children`,`type`/`title` 等额外字段不进图(渲染器现状)。

> ⚠️ **`SourceCodeView` 的 `stripCodeFence` 只对 json/html 生效**(2026-06 修):这两类内容可能被 LLM 整段 ```lang 包裹,需剥壳;但 **markdown / code 源不可 strip** —— md 源里合法含代码围栏,`stripCodeFence` 会把整篇抠成第一个围栏的内容(曾致 markdown「代码」视图只剩一行)。markdown 卡「预览」态自 2026-06 改用 Vditor `MarkdownPreview`(与编辑器同源,见 [insight-markdown-editor §6.3.1](insight-markdown-editor.md))。

> **table 卡四视图一致性**:`table` 卡现在**只来自路径 A `text/csv` resource_link**(2026-06 起路径 B 不再嗅探 md 表格,见 §2.1)。其 `content` 是 csv 转换后的 md 表格,本就是纯表格;但 `TableRenderer` / 导出 / 代码态仍统一走 `extractTableMarkdown` 抽表格本体作防御(若上游 csv 前后混入说明行也只呈现表格),四个动作一致:
> - 预览 `TableRenderer` 抽 `marked` 的 table token;
> - 复制 / 下载(md/CSV/Excel)走 `extractTableMarkdown` / `parseMarkdownTable`;
> - **代码态** `SourceCodeView` 同样喂 `extractTableMarkdown(content)`,与其余三者一致。
>
> 若需要「右栏呈现整份文档」而非仅摘要表,应让其走 `markdown` 卡(全文渲染/复制/下载),而非 `table` 卡。

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
1. scanFencedHtml(parts)             → html  (每个 ```html fence 块 1 张卡，支持多卡)
2. isMindmapJSON(text)               → mindmap
                                     × md 表格嗅探 — 删除(2026-06)：对话里 md 表格由上游 <Markdown> 原渲染即够，业务表格走路径 A csv
                                     × markdown 长文本兜底 — 删除
                                     × 通用 JSON 升级 — 删除：普通 JSON 有 shiki 高亮 + 复制即够，无追加预览价值
                                     × 其他语言 fence 升级 — 删除（复用上游 Markdown 高亮）
```

> **路径 B 当前仅剩两条规则**：`html` fence（可 iframe 预览）+ `mindmap` shape（可 markmap 可视化）——只升级「能在右栏给出对话区给不了的可视化」的内容。md 表格 / 普通 JSON / 代码段在对话区已有足够呈现(渲染 / shiki + 复制)，不再出卡。

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

> md 表格检测 `isMarkdownTable` 已于 2026-06 移除(路径 B 不再把对话里的 md 表格嗅探成 table 卡)。表格解析/导出函数 `parseMarkdownTable` / `tableToCSV` / `extractTableMarkdown` 保留在 `markdown-table.ts`,供路径 A 的 `text/csv → table` 复用。

```ts
// 1. Mindmap JSON：检测 = 渲染。直接复用渲染适配函数,「能渲染成 markmap 才算命中」。
//    实现在 mindmap-adapter.ts(detect 的上层,避免循环依赖),不再单独写一套 shape 嗅探。
function isMindmapJSON(text: string): boolean {
  return uxrJsonToMarkdown(text) != null   // 实现见 mindmap-adapter.ts
}
// 为什么不再单独写 hasMindmapShape:旧实现的 shape 嗅探比渲染规则更松
// (对 { nodes: [] } / 空 mindmaps 判 true,但 collectRoots 收不到根 → 渲染为空),
// 导致"判定命中但渲染失败兜底"的漂移。检测与渲染共用同一条规则后,从根上消除该不一致。
//
// collectRoots 顶层裸对象判定(2026-06-24 收紧):
//   - 旧:typeof obj.name === "string" || Array.isArray(obj.children)  ← 过松,{name,version,...} 误判为单根导图
//   - 新:仅 Array.isArray(obj.children)(必须有树边);name 字段单独不再成立
//   - 显式容器 mindmaps/nodes 数组内的元素是"已声明导图节点"(declared 标记),沿用旧宽松规则 →
//     内网 MCP 的 { mindmaps:[{name,children}] } 确定格式渲染零变化。
// 业界一致:导图由 父→children 树关系定义,而非单个标签字段(jsMind: format:"node_tree"+topic/children;
// mind-elixir: nodeData.children)。任意 JSON 自动渲染只见于"JSON 浏览器"(JSON Crack)那类通用结构图,非语义导图。

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
```

> 通用 JSON 检测 `isPlainJSON` 已不在路径 B 实现中（普通 JSON 在对话区已有 shiki 高亮 + 复制，无追加预览价值，故不出 json 卡）。路径 A 的 `application/json` resource_link 仍可出 json 卡（服务端显式声明，零嗅探，见 §2.5.2）。

**优先级理由**：路径 B 现仅剩 `scanFencedHtml`（html）与 `isMindmapJSON`（mindmap）两条规则，互不冲突——html fence 与 mindmap shape JSON 形态判然，同段同时命中也是各出各卡（多卡并列，见 §6.B）。

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

如果未来路径 B 在多模型场景下漏检率太高，再考虑在 [insight agent.md](../../../packages/opencode/src/agent/prompt/octo_insight.md) 加 fence 约定（强约束 LLM 输出格式），前端按约定 tag 识别，等价于 ChatGPT Canvas 的"伪工具触发"但通过 prompt 实现。短期不做。

### 2.4 console 调试埋点（路径 B）

所有 detect 决策必须打 console，便于内网（DeepSeek flash）和外网（DeepSeek R1）输出差异问题快速定位：

| tag | 触发点 | 字段 |
|---|---|---|
| `[octo:detect] start` | `detectCards` 入口 | msgID / partsCount / 前 80 字摘要 |
| `[octo:detect] match` | 规则命中 | rule（mindmap/html）/ part 索引 / 摘要 |
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
| `text/markdown` | `markdown` | fetch URI → 走 MarkdownRenderer。**含上游原 docx 文档产物**——2026-06 起 UXR 把原以 docx 返回的文档类产物改为 `text/markdown` 返回(详见 [mcp-contract.md](../agents/mcp-contract.md))，故走 markdown 卡(可应用内预览)而非 file fallback。后续将在此卡支持编辑(见 [insight-markdown-editor.md](insight-markdown-editor.md))|
| `application/json` | `json` | fetch URI → json 卡。**2026-06-24 起改走 json 卡**(此前误统一走 mindmap):泛型 `application/json` mimeType **不携带"这是导图"语义**,把它当 mindmap 会令普通 JSON 误渲成单根 markmap。思维导图由 `business_type:"mindmap"` 显式声明(在 `linkToOutputType` 中先于 mimeType 拦截),不靠泛型 mimeType 嗅探。json 卡内容若为树形 → 默认 markmap 预览 + 预览/代码切换(选项 C,见 §1);普通 JSON 单显源。与路径 C `.json` 同一套原则(见 §2.6.1)|
| `text/csv` | `table` | fetch URI → 转 Markdown 表格 → 走 TableRenderer |
| Office（xlsx / pptx）/ PDF / 图片 / 二进制 | `file` | 不在 ResultViewer 内渲染，FileFallback 提供**双按钮**：①「用本地应用打开」`download-resource` IPC → 落地临时文件 → `window.api.openPath` 唤起 OS 关联应用（Excel/WPS/Numbers）②「下载到本地」`window.api.saveFilePicker` 用户选目录 → 落地。详见 §5 + [ADR-009](../../adr/009-no-office-preview.md)。**注**：docx 文档产物 2026-06 起改以 `text/markdown` 返回(见上一行)，不再走 file fallback |
| 其他未识别 | `file` fallback | 同上双按钮 |

**为什么删除"`application/json` 内容二次判断 retype"**:

旧实现:对话流出 1 张 json 卡 → 用户点开 → fetch + `isMindmapJSON` 判断 → 命中则 retype 为 mindmap。问题:
- 卡片标题始终是 "JSON 数据"(误标——内容是思维导图),用户体验断层
- 客户端做 shape 嗅探,跟"业务类型由服务端声明"的设计哲学冲突

新设计:服务端 `business_type: "mindmap"` 显式声明,客户端直接出**单卡**(`type: "mindmap"`,预览/代码切换),**零嗅探**。

**路径 A 内容违约的兜底(2026-06 修订)**:服务端声明 `business_type: "mindmap"` 但实际文件内容不是 mindmap shape 时(服务端违反契约),客户端无法在出卡阶段预校验——内容是打开卡片时才 fetch 的(`UriTabBody`),出卡时只有 `uri`。因此降级发生在**卡内渲染时**:`ResultViewer` 的 mindmap 分支用 `isMindmapJSON(content)` 校验,不符就**直接显示代码视图(原始 JSON)**而非空的错误占位,也**不另起新卡**(原始 JSON 本就在这张卡的「代码」切换里)。与路径 B 共用同一条 `isMindmapJSON` 规则。

> **`isMindmapJSON` shape 嗅探收紧(2026-06-24)**:旧 `collectRoots` 的顶层裸对象判定为「`name` 字符串 **或** `children` 数组任一即算导图根」,过松——`{ name, version, ... }` 这类普通配置 JSON 光凭 `name` 字段就被判成单根思维导图(渲出一个孤零零的标题)。收紧为:**顶层裸对象必须带 `children` 数组(树边)才算根**;`name` 字段单独不再成立。业界一致——思维导图由 父→children 树关系定义,而非单个标签字段(jsMind 用 `format:"node_tree"` + `topic`/`children` 判别;mind-elixir 用 `nodeData.children` 包裹)。**显式 mindmap 容器(`mindmaps`/`nodes` 数组)内的节点不受影响**(`declared` 标记沿用旧宽松规则),保证内网 MCP 返回的 `{ mindmaps:[{name,children}] }` 确定格式渲染零变化。详见 §2.2。

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

[insight-turn.tsx:107](../../../packages/app/octoapp/pages/insight/components/insight-turn.tsx#L107) 现有的 `outputCard` memo（单卡）需改造为 `outputCards`（返回 `OutputCard[]`），相应地 `InsightTurn` 组件用 `For` 渲染 0~N 张卡片堆叠：

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

## 2.6 write 工具产物来源（路径 C —— 本地文件出卡）〔收窄为 md/html 白名单 2026-07〕

> **⚠️ 本节机制部分现行、部分历史,按扩展名区分(2026-07,SPEC-INS-014 v6):**
> - **现行**:`.md` / `.html` write 产物**出卡**(`type ∈ {markdown, html}` 白名单),走以下 §2.6.x 的 path 源卡机制(本地读盘 / `source:"path"` / PathTabBody)。
> - **已剔除(#384)**:`.json` / `.csv` / `code` / `file` 等**非白名单** write 产物**不出卡**,只走「文件管理」面板;§2.6.x 里这些分支仅作历史追溯。
> - 收窄理由(白名单判「预览价值」而非「交付物 vs scratch」,绕开 #384 无解点)、与 #368 落点重定向的合成,见 §0.1 顶部横幅。`findWriteCards` 同时供①白名单出卡②「write 完成→文件管理刷新」(后者扫全量,不过滤)。

> 2026-06 新增。与 §2.5（MCP resource_link）平行的第三条出卡路径。两者都是"强信号、零嗅探",区别仅在**内容位置**:resource_link 指向内网 S3 URI(http fetch),write 产物在**本地磁盘**(SDK `file.read` 读盘)。

### 2.6.1 规则总览(权威分类,SOT)

Agent 用写文件工具(opencode `write` 新建 / `edit` 修改)把分析结论、可视化页面、脚本、数据表写到本地时,用户应能在应用内查看或拉本地应用打开。

**核心原则:write 产物全部出卡。** 与路径 B(对话里 LLM 直出的代码段,内容已在对话区有 shiki 高亮,故不升级)不同——write 产物的文件内容**根本不在对话流里**(对话区只有"写入 xxx"摘要),出卡是查看该文件的**唯一入口**。`extToOutputType` 不返回 `null`,按"**哪种查看方式对用户最好**"分三类:

| 类 | OutputCardType | 查看方式 | 判据 |
|---|---|---|---|
| **应用内渲染** | `markdown` / `html` / `mindmap` | 专用 renderer(预览/代码切换) | 我们渲染得好的格式 |
| **应用内代码预览** | `code` | `SourceCodeView` shiki 高亮 | 能读到文本内容的代码/配置/纯文本(编辑器不一定人人装,内预览兜底) |
| **拉本地应用** | `file` | FileFallback 本地打开 / 文件夹打开 | office/表格/图片/媒体等,应用内渲染无价值或无法渲染(用户多半装了 Excel/Numbers 等) |

**扩展名清单(代码实现 SOT 在 [write-output.ts](../../../packages/app/octoapp/pages/insight/utils/write-output.ts),改这里务必同步):**

| OutputCardType | 扩展名 |
|---|---|
| `markdown` | `md` `markdown` `mdown` `mkd` |
| `html` | `html` `htm` `xhtml` |
| `json` | `json`(JsonRenderer:shiki 高亮 + 复制,单视图) |
| `file`(拉本地应用) | **表格** `csv` `tsv` `xls` `xlsx` `xlsm` `xlsb` `ods` · **文档** `doc` `docx` `ppt` `pptx` `odt` `odp` `rtf` `pdf` `pages` `numbers` `key` `epub` · **图片** `png` `jpg` `jpeg` `gif` `webp` `bmp` `tiff` `tif` `ico` `svg` `heic` `heif` `avif` `psd` `ai` `sketch` `fig` · **音视频** `mp4` `mov` `avi` `mkv` `webm` `flv` `wmv` `m4v` `mp3` `wav` `flac` `m4a` `aac` `ogg` `opus` · **压缩/镜像/包** `zip` `tar` `gz` `tgz` `bz2` `xz` `zst` `rar` `7z` `iso` `dmg` `pkg` `deb` `rpm` `msi` `apk` · **字体** `woff` `woff2` `ttf` `otf` `eot` · **可执行/库** `exe` `dll` `so` `dylib` `bin` `o` `a` `lib` `obj` `class` `wasm` `app` |
| `code`(兜底) | **以上之外的一切**:`py` `ts` `tsx` `js` `jsx` `go` `rs` `c` `h` `cpp` `cc` `cxx` `hpp` `cs` `java` `kt` `swift` `rb` `php` `lua` `r` `sql` `sh` `bash` `yaml` `toml` `xml` `css` `scss` `vue` … + 无扩展名(Makefile/Dockerfile)+ 未知扩展名 |

> **设计要点:`code` 是兜底,不靠穷举。** 只需把 `file`(office/二进制)和 `markdown`/`html`/`json` 列全,**其余一律 `code`**——新语言、冷门扩展名零维护自动走代码预览。这样"任何能读到文本的代码/配置文件都能内预览",不用一个个补。
>
> **`canOpenLocally`**:`file` 卡里可执行/库类(`exe` `dll` `so` `dylib` `bin` `o` `a` `lib` `obj` `class` `wasm`)隐藏"本地打开",只留"文件夹打开"(唤起无意义/不安全)。
>
> **为什么 `.json` 走 json 卡而非 mindmap(2026-06-24 修订)**:扩展名 `.json` **不携带语义**——普通配置 JSON 与思维导图 JSON 同扩展名,出卡阶段又只有 path、拿不到内容,无法靠扩展名区分。此前(2026-06)曾让 `.json` 统一走 mindmap 卡 + 渲染时 `isMindmapJSON` 兜底,但因 shape 嗅探过松(光有 `name` 字段即判中),普通配置 JSON(如 `{name,version,...}`)既被误标"思维导图"、又渲成单根 markmap。现一律出 `json` 卡(入口图标=JSON,不误标"思维导图")。**但 json 卡按内容条件可视化(2026-06-24 选项 C)**:打开后若 `isMindmapJSON(content)` 真(顶层带 `children` 的树),默认 markmap 预览 + 出「预览/代码」切换;普通配置 JSON 单显源。即"默认 JSON、能渲染成导图的树按需(且默认)给可视化",与业界"JSON 为主、图是可选 view"一致(见 §1 视图切换)。**强声明的思维导图产物仍走路径 A**(MCP `resource_link` + `business_type:"mindmap"`)→ 恒出 mindmap 卡。
>
> **为什么 `.csv` 走 file 而路径 A 的 `text/csv` 走 table**:A/C **唯一的来源差异**(见 §2.6.8)。路径 A 的 csv 是服务端业务分析表格(应用内 TableRenderer + Excel 导出,成熟);路径 C 的 csv 是 Agent 写的原始逗号数据,TableRenderer 渲染不了,用 Excel/Numbers 打开更好。

#### 已知边界

1. **真二进制 write 出来是损坏的**:`write` 工具 content 是**字符串**,写不出有效的 `.xlsx`/`.docx`/图片等二进制——出 file 卡能点"本地打开"但 Excel 会报损坏。**这是 write 工具的固有限制**:要真正生成 xlsx,Agent 得用脚本(python `openpyxl` 等),那属下一条。
2. **脚本(bash/python)产生的文件抓不到**:`findWriteCards` 只认 `write`/`edit` tool part;Agent 用 `bash`(`cat > x.cpp` / 跑 python 生成 xlsx)产生的文件不是写文件 tool part,**无法可靠识别**(bash 输出里扒路径太脆弱),目前不出卡。如需覆盖再议(见 ROADMAP)。

### 2.6.2 触发与解析

```
对于每条 assistant 消息的 parts:
  收集所有满足以下条件的 tool part:
    p.type === "tool"
    && bareTool(p.tool) ∈ {write, edit}        // 防御前缀: 结尾 _write / _edit、mcp:write 等
    && p.state.status === "completed"
  对每个命中:
    filePath = p.state.input.filePath          // 防御读: filePath ?? path ?? file_path
    type = extToOutputType(filePath)           // 扩展名 → OutputCardType(不返回 null,全部出卡)
    建一张 OutputCard { source: "path", filePath, type }
  同一 filePath 多次写(覆盖) → 去重保留最后一次(内容读盘总取最新,只需避免重复卡)
```

`extToOutputType` 实现见 §2.6.1 清单。与 §2.5.2 `mimeToOutputType` 的差异:mimeType 未识别兜底到 `file`,路径 C 未识别(文本)兜底到 `code`(应用内预览)。

### 2.6.3 内容来源:本地读盘(不是 fetch)

路径 A 渲染时 `fetch(uri)` 拉内网 S3。路径 C 文件在本地,改用 opencode SDK:

```ts
// sdk.client.file.read({ path }) → FileContent { type: "text"|"binary", content, mimeType }
const res = await sdk.client.file.read({ path: filePath })
const data = res.data as unknown
const text = typeof data === "string" ? data : ((data as { content?: string })?.content ?? "")
```

- 已有先例:[review-tab.tsx](../../../packages/app/octoapp/pages/session/review-tab.tsx) 的 `readFile` 即走 `sdk.client.file.read`(传 `{ path }` 而非 `{ query: { path } }`,客户端封装已处理)。
- **零新增 IPC / preload**——这是选「读本地文件路径」而非「快照 part.content」的关键收益:**tab 挂载时读盘 = 拿当前磁盘内容**,文件被后续 write 覆盖后、关掉 tab 重开(组件重挂)即反映最新。
- **`createResource` 的 source 必须返回稳定的 path 字符串(不能返回新对象字面量)**:否则 `onCacheContent` 回写 content → `props.tab` 换新对象引用 → source 重跑返回新对象 → createResource 按引用判不等 → 重新 fetch → 又回写 → **死循环**(path 分支用 `Match source==="path"` 常挂载,不像 uri 分支缓存后被父层 `Show !content` 卸载而自然断开)。返回 `props.tab.filePath` 这个 string、id 在 fetcher 里用闭包 `props.tab.id` 取,即可让值相等检查阻止重 fetch。
- 缓存:读到后 `onCacheContent(tab.id, text)` 回写 store,供 ActionBar 复制/下载取内容。同一 `(filePath, type)` 再次点入口卡走 openTab 去重激活已有 tab(不重挂、不重读,与 uri 行为一致);要看覆盖后的新内容关掉 tab 重开即可。

### 2.6.4 OutputCard / ResultTab 的 `source: "path"` 扩展

§2.5.3 的 `OutputCard` 增加第三种 source:

```ts
export type OutputCard = {
  // ...现有字段...
  source: "inline" | "uri" | "path"   // 新增 "path"
  filePath?: string                    // source === "path" 时必填(write 的目标路径)
  // uri / mimeType 仅 source === "uri" 用;content 仅 source === "inline" 用
}
```

`tab-store.ts` 的 `ResultTab` 同步加 `filePath` 与 `"path"` source;ResultViewer 加 `PathTabBody`(对照现有 `UriTabBody`),区别只是把 `fetchResourceText(uri)` 换成 `sdk.client.file.read({ path })`(返回 `FileContent` 取 `.content`,兼容直返 string),拿到 text 后走与 uri 模式**完全相同**的按 type 分发(markdown/html/json/code renderer)。

> **path 源的 `file` 类型卡不读盘**:csv/xlsx/二进制走 file 卡,内容是二进制 / 无应用内渲染价值,`TabBody` 的 path 分支条件加 `&& type !== "file"`,file 类型直接 fallback 到 `TabContent` → `FileFallback`(见 §2.6.8)。

卡片标题取 `basename(filePath)`(如 `分析结论.md`),`fileName` 也设为 basename(供入口卡按扩展名命中图标 + file 卡下载默认名)。

### 2.6.4.1 path 源的本地打开能力(file 卡 + 预览卡)

write 产物在**本地磁盘**,有 `filePath`——所以"用本地应用打开 / 文件夹中打开"对 path 源**比路径 A 还简单**(不用 `downloadResourceToTemp` 先下载,直接传本地路径):

| 能力 | path 源(write 产物) | uri 源(MCP 产物) |
|---|---|---|
| 用本地应用打开 | `openPath(filePath)` 直接 | `downloadResourceToTemp(uri,…)` → `openPath(tempPath)` |
| 文件夹中打开 | `showItemInFolder(filePath)` 直接 | 先 download-to-temp 再 reveal |
| 另存为 | **不支持**(无本地文件复制 IPC;文件已在磁盘,用"文件夹中打开"代替) | `saveFilePicker` → `downloadResource(uri,dest)` |

- **file 卡**(csv/office/二进制):`FileFallback` 按 `tab.source === "path"` 走本地分支——「本地打开」`openPath(filePath)`(`canOpenLocally(filePath)` 为 false 的可执行/库类隐藏此按钮)、「文件夹打开」`showItemInFolder(filePath)`、**无另存为**。
- **预览卡**(md/html/mindmap/code):内容已在应用内预览,`ActionBar` 对 path 源**额外**给「本地打开 / 文件夹打开」两个小按钮(方便用 Typora / VSCode 等原生应用编辑)。零成本(同样直接传 filePath)。

### 2.6.5 与路径 A/B 的优先级

`outputCards` memo 的合并次序(在 [insight-turn.tsx](../../../packages/app/octoapp/pages/insight/components/insight-turn.tsx) 实现):

```
1. taskCards.length > 0  → return [](长任务卡接管,见 task-card.md §3.4)
2. links = findResourceLinks(parts)   (路径 A)
   writes = findWriteCards(parts)     (路径 C)
   若 links.length || writes.length → return [...links, ...writes]   // A 与 C 并列追加,不互斥
3. 否则走路径 B 嗅探(html fence / mindmap)
```

- **A 与 C 并列**:resource_link 来自 MCP、write 来自 tool part,来源不重叠,同 turn 都有就都出(各自的卡)。
- **C 抢占 B**:write 是强信号,命中后不再跑路径 B 嗅探(同 A 抢占 B 的逻辑)。
- 改路径 C 不影响 A/B,反之亦然(三条解析逻辑独立)。

### 2.6.6 console 调试埋点(路径 C)

| tag | 触发点 | 字段 |
|---|---|---|
| `[octo:write-card] scan` | findWriteCards 每条消息(只要有 tool part 就打) | cardCount / cards / **toolParts**(每个工具 part 的 tool/status/filePath/判定 type/skip 原因)——"写了文件却不出卡"时看这条定位是哪一环断的(注:scan 出的是全量 write 产物,是否出卡还要过组件层 md/html 白名单) |
| `[octo:card] resource_links + write(md/html)` | outputCards memo(路径 A links + 路径 C 白名单 write) | linkCount / **writeCount** / links / writes——writeCount=0 而磁盘有 md/html 写入,即白名单/落点脱钩的排查抓手 |
| `[octo:path] read start/ok/error` | PathTabBody 读盘(预览卡) | path / bytes / err |
| `[octo:path] open-local` / `open-failed` | file 卡 / ActionBar 本地打开 | filePath / reason |
| `[octo:path] reveal-local` / `reveal-failed` | 文件夹中打开 | filePath |

### 2.6.7 人工验证步骤〔v6 白名单，2026-07〕

> **前置**:改动跨 server(#368 落点重定向插件)+ renderer(出卡白名单)两层,**必须彻底重启 `dev:desktop`** 让 sidecar 重建(见 [development.md §3.5](../../development.md#35-改动生效模型renderer--main--opencode-server-三层),否则只有前端生效、落点仍旧);insight 页能正常对话。

| # | 操作 | 预期 |
|---|---|---|
| 1 | 让 Agent「用 write 写 `测试报告.md`,含三级标题」,`filePath` **只给文件名** | ①出入口卡(md 图标)→ 右栏 markdown 渲染、预览/代码可切、ActionBar 有 复制/下载/本地打开/文件夹打开;②文件落在 **`insight/<sessionId>/outputs/`**(不在项目根);③**文件管理「生成文件」自动出现**该文件(无需手点刷新);④server 日志 `[octo:outputs-redirect] write 落点重定向`、renderer 日志 `[octo:card] resource_links + write(md/html)`(writeCount≥1) |
| 2 | 让它写 `.html` | 出卡 → iframe 预览可切源;同样落 outputs + 文件管理可见 |
| 3 | 让它写 `.py` / `.txt` / `.json` / `.csv` / `.docx` | **不出卡**(白名单外);但文件仍落 outputs、**文件管理里能看到**(非白名单只走文件管理);renderer 日志 writeCount 不含它们 |
| 4 | 让它写 `.md` 但**明确指定绝对路径**(如 `D:\tmp\x.md`) | 落点**尊重绝对路径**(不重定向 outputs);仍出 md 卡,卡 filePath = 你给的绝对路径 |
| 5 | 覆盖写同名 `.md` → **关 tab** 再点入口卡重开 | 显示**最新内容**(组件重挂重读);同一 tab 反复点是去重激活 |
| 6 | 直接让它「**输出 md 内容但不写文件**」 | **不出卡**——inline md 由对话区 `<Markdown>` 原样渲染,路径 B 不嗅探 md(印证:出卡来自 write 白名单,不是 inline md) |
| 7 | 让它写脚本 `gen.ps1` 再执行产 `docx`(#384 原始场景) | `.ps1` **不出卡**(白名单外)、docx 是脚本产物抓不到也不出卡——两者都去文件管理找;**#384 的假阳被白名单挡住,收益保住** |
| 8 | (若有 MCP 业务工具)同轮既 resource_link 又 write `.md` | 两类卡**并列**(路径 A + 路径 C),互不顶替(§2.6.5) |
| 9 | path 源 md/html 卡的 ActionBar | 有 复制/下载/本地打开/文件夹打开;file 卡类(本次白名单已无 file 类型)不涉及 |

> **`.docx`/`.xlsx` 真二进制**:`write` 写不出有效二进制、且它们本就不在白名单——不涉及本次。用 python 生成的是 bash 产物,当前抓不到(契约层根治,见 ROADMAP)。
>
> **纯逻辑单测**:`extToOutputType`/`findWriteCards`/`basename` 等见 `write-output.test.ts`(util 层返回全量 write 产物,**白名单过滤在 `insight-turn.tsx` 组件层**——`type ∈ {markdown, html}`),已过。

### 2.6.8 路径 A(MCP 产物)vs 路径 C(write 产物)规则对照

> 两条路径**共用同一套渲染体系**(同一组 OutputCardType + 同一组 renderer + 同一 tab-store),差异只在"内容从哪来"和由此派生的少数按钮。

**共用规则(完全一致):**

| 维度 | 规则 |
|---|---|
| 卡类型体系 | 同一组 `OutputCardType`(table/mindmap/markdown/html/json/file/code) |
| html / markdown | text/html ↔ `.html` → html 卡;text/markdown ↔ `.md` → markdown 卡 |
| json | application/json ↔ `.json` → **json 卡**(shiki + 复制);泛型 json 不当导图(2026-06-24 修)。但内容若为树形(顶层带 `children`)→ 默认 markmap 预览 + 预览/代码切换(选项 C,见 §1) |
| 思维导图 | **强声明**走 `business_type:"mindmap"`(路径 A 强契约)→ 恒出 mindmap 卡(markmap;内容违约降级 json 源)。**不靠** application/json mimeType / `.json` 扩展名嗅探出"mindmap 卡";但泛型 json 内容是树形时,json 卡仍按内容默认 markmap 预览(同一渲染分支,差别只在切换是否恒显)|
| 二进制(office/pdf/图片/媒体) | → `file` 卡,FileFallback 本地应用打开 + 文件夹打开 |
| 视图切换 / 渲染器 | mindmap/html/table/markdown 的「预览/代码」切换、各 renderer 完全共用 |
| 出卡并列 | 同 turn A、C 卡并列追加,互不顶替;长任务卡(taskCards)优先接管 |

**差异规则(来源决定,刻意保留):**

| 维度 | 路径 A(`source:"uri"` MCP 产物) | 路径 C(`source:"path"` write 产物) |
|---|---|---|
| 内容位置 | 内网 S3 URI | 本地磁盘 filePath |
| 取内容 | `fetch(uri)`(http) | `sdk.client.file.read({ path })`(读盘) |
| **csv** | `text/csv` → **table 卡**(业务分析表格,应用内渲染 + Excel 导出) | `.csv` → **file 卡**(原始数据,拉本地 Excel/Numbers) |
| **code 类型** | 无(MCP 不返回代码文件) | 有(任意代码/文本 → code 卡 shiki 预览,兜底) |
| 触发工具 | MCP tool 返回 resource_link | `write`(新建)/ `edit`(修改)tool part;bash/python 产物抓不到 |
| 用本地应用打开 | 先 `downloadResourceToTemp` 下载再 `openPath` | `openPath(filePath)` 直接 |
| **另存为** | ✅ `saveFilePicker` → `downloadResource` | ❌ 不支持(无本地复制 IPC),用「文件夹中打开」代替 |
| 预览卡本地打开 | ❌(无本地文件,要先下载) | ✅ ActionBar 额外给「本地打开/文件夹打开」 |
| 缓存 | session 内 URI 懒缓存(§2.5.5) | tab 挂载时读盘;关 tab 重开则重读 |

---

## 3. TableRenderer

### 3.1 现状

`packages/app/octoapp/pages/insight/components/result-viewer/table-renderer.tsx`：
- 输入：Markdown 表格字符串
- 渲染为 HTML `<table>`
- 支持横向滚动、空单元格占位

### 3.2 ActionBar 导出（现状 + 新增 Excel）

`packages/app/octoapp/pages/insight/components/result-viewer/action-bar.tsx`：

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

下载菜单（现状）：

| 选项 | 实现 |
|---|---|
| 原始格式 | blob 下载原始 JSON（`stripCodeFence(content)` → `<base>.json`） |
| Octo 白板格式 | 转成 Octo 内网白板导入 JSON 后下载 `<base>_octo.json`（见 §4.7） |

> **下载项统一命名「原始格式」**（2026-07）：各单格式类型（mindmap/html/json/code/markdown、uri 原件的旧「另存为」）的原生下载项标签统一成「原始格式」，不再按扩展名各叫各的（旧标签如「JSON (.json)」「HTML (.html)」）。**唯一例外 `table` 卡**保留 Markdown/CSV/Excel 三项（三种是真有用的不同导出，见 §3.2），不收敛。
>
> 复制沿用（复制原始 JSON 字符串）。SVG/PNG 导出仍为 P2，未实现。

### 4.6 边界处理

| 场景 | 行为 |
|---|---|
| 外层不是数组 | 解析失败 → §8 错误处理 fallback |
| 外层数组但 flat 后为空 | 显示"思维导图为空"占位 |
| 节点没有 name 字段 | 渲染为 "(空)" |
| children 不是数组 | 视作叶子节点 |

### 4.7 导出到 Octo 内网白板（2026-07）

打通「能渲染成思维导图的 JSON」→「Octo 内网白板可导入的 JSON」。仅是**下载时的格式转换**，不改渲染/嗅探链路。

**触发范围**：`mindmap` 卡恒给「Octo 白板格式」；`json` 卡内容嗅探为导图（`isMindmapJSON` 真，与渲染成 markmap 同一口径）时也给。两者覆盖思维导图的全部来源（路径 A `business_type:"mindmap"` / 路径 B 模型直出嗅探 / 路径 A `application/json` 或路径 C `.json` 文件恰为树形）。

**目标格式（Octo 白板导入 JSON）**：节点用 `text` 字段（思维导图用 `name`），`children` 结构一致；叶子节点不带 `children` 键。示例：

```json
{
  "text": "中心主题",
  "children": [
    { "text": "分支主题", "children": [{ "text": "子主题" }, { "text": "子主题" }] },
    { "text": "分支主题", "children": [{ "text": "子主题" }] },
    { "text": "分支主题" }
  ]
}
```

**转换规则**（`mindmap-adapter.uxrJsonToOctoWhiteboard`，与渲染/判定共用 `collectRoots` 同一条规则，杜绝「判中但转空」漂移）：
- `name → text` 递归改写；`children` 递归；叶子（无子）不写 `children` 键。
- 节点 `name` 缺失 / 空白 → `"(空)"`（与 §4.4 `renderNode` 空节点兜底对齐）。
- **多根**（`mindmaps` / 双层数组可能多棵树）时 Octo 白板根须是单对象 → 用卡片标题合成一个中心主题包住所有根；**单根**直接输出该根，不加多余中心层。
- 非导图 shape / 解析失败 → 返回 `null`，下载入口 toast「当前内容不是有效的思维导图结构，无法转换为 Octo 白板格式」（此项仅挂在已判定为导图的卡上，常态不触达）。

**文件名**：`<base>_octo.json`（原文件名 + `_octo` 后缀），与「原始格式」的 `<base>.json` 不撞名（同目录连续下载不覆盖）。

**验证（外网可复现）**：
1. 让 Agent 直出一段思维导图 JSON（或走 mindmap MCP 工具），右栏出思维导图卡、markmap 正常渲染。
2. 点「下载 ▾」→ 菜单含「原始格式」+「Octo 白板格式」两项。
3. 点「Octo 白板格式」→ 落地 `<name>_octo.json`；打开确认根为单对象、节点字段为 `text`、叶子无 `children` 键。
4. 单测 `mindmap-octo.test.ts` 覆盖单根 / 多根合成 / fence / 空名 / 非导图兜底。

**内网验证**：把导出的 `-Octo白板.json` 导入 Octo 白板，确认层级/文案还原、无导入报错。

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

样式由 [octo-tokens.css](../../../packages/app/octoapp/pages/insight/octo-tokens.css) `.octo-preview-entry` 系列 class 定义。

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

依赖桌面壳暴露的 `window.api` IPC（契约见 [intranet-handoff §4](../../intranet-handoff.md)）：

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

> **现状(2026-06)**：业务分析(观点解析 / 按提纲聚类 / 可用性分析 / 思维导图)已改为**异步 MCP 工具**(调用即返回 task_id，结果经 `get_task_result` 拿到 resource_link)，产物**走路径 A** 按 `business_type` / `mimeType` 路由，**不依赖 systemHint + 路径 B 嗅探**。下表是路径 B 时代的历史期望映射，仅保留作背景。

| 模板 | 旧 systemHint 约束 | 路径 B 时代期望命中 | 现状 |
|---|---|---|---|
| 观点解析 / 按提纲聚类 / AI用户画像 / 评估问题整理 | "输出 Markdown 表格" | ~~`table`~~ | 走路径 A 产物(csv→table 或 markdown 卡)；**路径 B 不再嗅探 md 表格** |
| 思维导图 | "返回 JSON 直接原样输出" | `mindmap` | 路径 A `business_type: "mindmap"`；LLM 直答 JSON 时路径 B `isMindmapJSON` 仍可兜底命中 |
| 用研知识问答 | "基于检索结果回答" | `markdown` | 走 `search_reports` 路径 A resource_link |

路径 B 现仅剩 `html` fence 与 `mindmap` shape 两条规则(见 §2.1)；其余 LLM 直答内容(含 md 表格)由对话区上游 `<Markdown>` 原样渲染，不出卡。

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

> **目的**：单测覆盖 detect 逻辑 / adapter 转换 / CSV 转义等纯逻辑（见 `packages/app/octoapp/pages/insight/utils/detect.test.ts`）。本节流程覆盖**眼睛才能看见的东西**：markmap SVG 是否真画出、iframe 沙箱是否真隔离、.xlsx 在 Numbers/Excel 里是否真打开、xlsx 在 mac/win 唤起本地应用是否成功。
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

> **2026-06 变更**：路径 B 不再嗅探 md 表格出卡。本 case 改为验证**路径 A `text/csv` resource_link** 出的 table 卡（业务工具产出 csv 文件场景）；联调期无真 MCP 时，可临时 hardcode 一个 `text/csv` resource_link 注入验证渲染与导出。

**反例先验（路径 B 不出表格卡）**：粘下方 prompt，确认对话区出表格但**不开 OutputCard**：

```
输出一个 markdown 表格，3 列，第一列"观点"，第二列"频次"，第三列"代表用户"，至少 5 行真实示例内容（用研场景）。
```
- [ ] 对话区由上游 `<Markdown>` 原样渲染该表格（带复制按钮）
- [ ] **不开 OutputCard**（路径 B 表格嗅探已移除）
- [ ] Console 看到 `[octo:detect] reject`

**正例（路径 A csv → table 卡 + 导出）**：触发/注入一个 `text/csv` resource_link 后：
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
| `[octo:draft] 草稿超出落盘上限` / `草稿落盘失败` (warn，见 [SPEC-INS-024](composer-draft.md)) | 输入区草稿**没能存到 localStorage**,该桶降级为纯内存 —— 切会话 / 切顶层 tab 照常保留,但**刷新后会丢**。前者=单桶超 64KB(正文太长,附件那侧有界);后者=配额耗尽或隐私模式。字段:key(桶)/ bytes / limit / err。同一个桶只警告一次,成功落盘后复位 | 用户反馈「刷新后草稿没了」时第一个要搜的 —— 没有这条则说明落盘本身没问题,该往 hydrate 侧查 |
| `[octo:upload] draft attachment(s) no longer on disk, dropped` | 落盘恢复出来的附件,其本地文件在两次启动之间被删了,已静默剔除 | 进入某个会话后异步核查时(每桶只核一次) |

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

- 路径 B 现仅两条规则：`scanFencedHtml`（html）+ `isMindmapJSON`（mindmap）；~~`isMarkdownTable` / `isPlainJSON` 已移除~~
- `isMindmapJSON` 对带 fence / 不带 fence / 单根 / 双层数组 shape 的识别;**收紧后**:顶层裸对象需带 `children` 树边(光有 `name` 字段的普通配置 JSON 不命中,见 §2.2);显式 `mindmaps`/`nodes` 容器内节点仍宽松(MCP 确定格式零变化)
- `isHTML` 对 fence / doctype / 富片段（≥3 标签）的识别（保留供单测复用）
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
| **FileFallback 双按钮（用本地应用打开 / 下载到本地）** | 本轮（2026-05） | preload + main `download-resource` IPC（[intranet-handoff §4](../../intranet-handoff.md)）|
| **全链路 console 埋点（detect/tab/office/resource）** | 本轮（2026-05） | — |
| **预览/代码 视图切换（mindmap 双卡→单卡 + html/table/markdown 加切换）+ file 隐藏复制/下载** | 2026-05-30 | tab-store `viewMode` / `linkToOutputType` / `SourceCodeView` |
| **§9 验证步骤扩充（V0-D 反例 / V0-E office / V0-F dedupe / 模型差异栏）** | 本轮（2026-05） | mac + win 双平台手动跑 V0-E |
| **路径 B 移除 md 表格嗅探（删 `isMarkdownTable`）+ docx 产物改 `text/markdown` 走 markdown 卡** | 2026-06（`feat/md-card-adjustments`） | insight-turn.tsx / detect.ts / mcp-contract.md |
| **markdown 卡支持全文编辑（CodeMirror 6 源码模式，落盘本地 projectdir 文件）** | 规划中 | 单独 spec [insight-markdown-editor.md](insight-markdown-editor.md) |

**联调期可能的小调整**：
- resource_link：opencode 转发 MCP `resource_link` content 为 part 的实际字段名 / 形态，待联调时确认（spec 假设 `type === "resource_link"` 直接平铺，若被嵌在其他结构里需要调整 §2.5.1 的探测逻辑）。本轮在 `findResourceLinks` / `readTaskInfo` 加 console 埋点辅助联调
- mimeType 路由表（§2.5.2）按 UXR 实际产出的 MIME 类型补充
- html：如 UXR 输出 HTML 不带 fence 也不带 doctype，可能需要在 `isHTML` (§2.3) 加更宽松的检测规则
