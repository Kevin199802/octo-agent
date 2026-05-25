# Spec — 引用型 MCP 工具的设计(SPEC-INS-008)

> 状态:草案 · P1 · 规模 [M] · 领域 ui + agent contract
>
> 起因:[2026-05-25 内网验证] `search_reports` 知识库问答 tool 跑出 5 张大文件卡,因为它的返回值结构跟"长任务产物"完全一样(text 摘要 + N 个 resource_link),客户端 `findResourceLinks` 把所有 resource_link 一视同仁渲染为大卡。
>
> 上游已实现:✗(MCP 协议层只提供 `annotations.priority/audience` 通用字段,无"产物 vs 引用"专属语义;Anthropic Citations API 的 inline citation 形态在 MCP 协议中没有对应字段)

---

## 1. 背景

### 1.1 问题描述

[`search_reports` MCP 实现](../agents/mcp-contract.md)(知识库 RAG)的返回值:

```python
content = [{"type": "text", "text": result["content"]}]  # 完整回答正文
for source in result["sources"]:
    content.append({
        "type": "resource_link",
        "uri": source["url"],
        "name": source["title"],
        "mimeType": "text/html",
        "description": "参考文档"
    })
```

结构跟 `analyze_interview` 等任务型工具一模一样,客户端没法区分:

- **任务型**(`analyze_interview` / `key_findings`):结果是**自包含产物**(分析报告 HTML / 结构化 JSON / Excel),每个 resource_link 都该开大卡
- **引用型**(`search_reports` / 未来 RAG):结果是**回答正文 + 引用链接**,大卡是干扰,引用应该轻量呈现

### 1.2 业界对照

| 产品 | 引用型(RAG / web search)展现 | 产物型(artifact / canvas)展现 |
|---|---|---|
| ChatGPT web search | 正文末尾 `[1][2]` 角标 + Sources 折叠区 | Canvas 大面板 |
| Perplexity | 正文 inline `[n]` 角标 + 顶部 Sources chip 横向条 | (无产物概念,纯 RAG) |
| Claude.ai web search | 正文末尾 Sources 文本链接列表 | Artifact 大面板(独立通道) |
| Bing Chat | inline 角标 + 下方 Learn more 链接 | (无独立产物) |
| Anthropic Citations API | text 块内 `citations: [...]` 元数据,客户端自行渲染为角标 + 末尾清单 | 独立 API(documents + citations.enabled) |

**全行业共识**:
1. 引用型展现是**双层**:inline 角标(快速可信)+ 末尾清单(详查溯源)
2. 引用渲染**绝不**占用产物级的卡片空间
3. **artifact vs citation 是两个独立的展现通道**,客户端必须按业务区分

### 1.3 设计目标

- 引用型 tool 的 resource_link **不出大卡**,改为轻量"参考资料"chip 列表 + 可选 inline 角标
- 产物型 tool 不受影响(继续大卡)
- 服务端用**明确的 enum 字段**声明展现意图,不依赖客户端猜
- inline 角标本期可选,服务端给到则渲染、不给到也能正常工作

---

## 2. 协议层设计

### 2.1 自定义扩展字段 `_octoDisplay`

复用 MCP `resource_link` 结构,加 octo 私有扩展字段:

```jsonc
{
  "type": "resource_link",
  "uri": "https://kb.intranet/docs/xxx",
  "name": "调试工具用户研究报告 2024",
  "mimeType": "text/html",
  "description": "参考文档",
  "_octoDisplay": "reference",   // ← 新增:"artifact" | "reference",缺省 = "artifact"
  "annotations": {                // MCP 标准字段,保留(audience 用于过滤"是否给用户看")
    "audience": ["user"]
  }
}
```

**字段 enum**:
| 值 | 语义 | 服务端选哪个 | 客户端渲染 |
|---|---|---|---|
| `"artifact"`(缺省)| 自包含产物 | 任务型 tool 的 resource_link(分析报告、可视化、表格)| 现有 OutputCard 大卡(§output-renderers §1) |
| `"reference"` | 引用链接 | 引用型 tool 的 resource_link(知识库链接、外部参考)| 对话流末尾的 ReferenceList chip 清单(§4) |

**为什么不用 MCP `annotations.priority` 数字**:
- MCP 协议的 `priority` 是 0~1 通用排序值,没有"产物 vs 引用"专属语义
- 服务端开发者无法直观判断"我这个工具应该填 0.3 还是 0.5";enum 字符串自描述
- 我们的 MCP 是 octo + UXR 私有契约,**只有一个客户端**,自定义扩展零兼容性负担
- `_octo` 前缀表明私有扩展,未来若 MCP 协议出标准语义字段(如 `displayMode`),迁移成本低

**为什么不删 resource_link 改 markdown 链接**:
- 失去结构化信息(title / mimeType / description)
- 服务端难以保证 LLM 100% 在 text 里写规范的 markdown 链接
- chip 列表对用户的"可扫读"价值高于纯文本链接

### 2.2 引用型 tool 的完整契约(以 search_reports 为例)

```jsonc
{
  "content": [
    {
      "type": "text",
      "text": "根据知识库中的多份报告,调试工具的主要痛点包括[1][2]:\n\n1. 调用栈分析复杂...\n2. 多线程场景下断点失效..."
      // ↑ LLM 在文本中用 [n] 角标引用 resource_link 数组的第 n 个(1-indexed)
      // ↑ 本期 angle 角标可选(见 §3.3);若 LLM 没打,客户端不出错只是没 inline 角标
    },
    {
      "type": "resource_link",
      "uri": "https://kb/docs/report-a",
      "name": "调试工具用户研究报告 2024",
      "mimeType": "text/html",
      "description": "参考文档",
      "_octoDisplay": "reference"
    },
    {
      "type": "resource_link",
      "uri": "https://kb/docs/report-b",
      "name": "多线程调试痛点分析",
      "mimeType": "text/html",
      "description": "参考文档",
      "_octoDisplay": "reference"
    }
    // ... 可有 N 个 reference
  ],
  "structuredContent": {
    "query": "调试工具的主要痛点",
    "status": "completed",
    "source_count": 5
  }
}
```

**对 LLM 角标约束的位置**:写在 [insight agent.md](../../../packages/agent/insight/agents/insight.md) 的 systemHint 里,例:

> 调用 `search_reports` 后,如果工具返回了 N 个 `resource_link` 文档,在你的回答正文中用 `[1][2][3]` 角标引用对应文档,编号对应 resource_link 数组顺序(1-indexed)。若不引用某个文档,角标可省略。

### 2.3 与产物型 tool 的对比

| 项 | 产物型(analyze_interview)| 引用型(search_reports)|
|---|---|---|
| text part 内容 | 简短摘要(< 500 字 / < 200 tokens,见 [mcp-contract §completed](../agents/mcp-contract.md))| 完整回答正文(可长) |
| resource_link `_octoDisplay` | `"artifact"` 或缺省 | `"reference"` |
| resource_link 文件性质 | 实际产物(html 报告 / json 数据 / xlsx 表格 / pdf) | 知识库引用源(网页 / 文档链接) |
| 客户端渲染 | OutputCard 大卡(每个 resource_link 1 张)| ReferenceList chip(N 个 resource_link 一组紧凑显示)|
| 任务态 | 通常配 `task_id` 走异步任务卡片([task-card.md](task-card.md))| 同步返回,不走任务卡片 |

---

## 3. 客户端渲染设计

### 3.1 路由分流

`findResourceLinks` 返回 `links[]` 后,按 `_octoDisplay` 分组:

```ts
function partitionLinks(links: ResourceLink[]): { artifacts: ResourceLink[]; references: ResourceLink[] } {
  const artifacts: ResourceLink[] = []
  const references: ResourceLink[] = []
  for (const link of links) {
    if (link._octoDisplay === "reference") references.push(link)
    else artifacts.push(link)  // 缺省 / "artifact" 都走大卡(向后兼容)
  }
  return { artifacts, references }
}
```

**插入位置**:`insight-turn.tsx` 的 `outputCards` memo 在拿到 `findResourceLinks(parts)` 后调用 `partitionLinks`,artifacts 走现有大卡逻辑,references 喂给新组件 `ReferenceList`(§3.2)。

### 3.2 ReferenceList 组件(段末紧凑清单)

```
┌─ assistant 文字气泡(含 [1][2] 角标)
│
├─ ┌────────────────────────────────────────┐
│  │ 📚 参考资料                              │
│  │ [1] 调试工具用户研究报告 2024  ↗         │
│  │ [2] 多线程调试痛点分析  ↗                │
│  │ [3] ...                                  │
│  └────────────────────────────────────────┘
```

布局规则:
- 紧贴在 assistant text 气泡下方,**不占用 ResultViewer 的 tab 空间**
- 每行 1 条 chip,显示 `[n] 文件名 ↗`,点击 `window.api.openLink(uri)` 系统浏览器打开
- 文件名超长 truncate + tooltip 显示完整 + description
- 视觉权重低于 OutputCard 大卡(灰底 + 小字 + 小图标)

**为什么不横向 chip 条(Perplexity 风格)**:
- Perplexity 横向条是因为引用源平均 5~10 个,且每个有 favicon 可视觉区分
- 我们用研知识库的引用源平均 1~3 个、无 favicon、文件名长,纵向列表可读性更好
- 横向条在窄左栏(对话区宽度 360px~50%)下塞不开

### 3.3 inline 角标兼容(本期可选)

LLM 文本里若包含 `[n]` 标记且 1 ≤ n ≤ references.length,渲染为可点击角标:
- hover → tooltip 显示 references[n-1].name + description
- 点击 → `openLink(uri)` 系统浏览器打开

**兼容策略**:
- ✅ LLM 写了角标 → 解析渲染
- ✅ LLM 没写角标 → 段末 ReferenceList 仍然显示,功能不缺失
- ✅ 角标号 > references.length → 静默忽略(LLM 笔误,不报错)
- ✅ references 数为 0 → 角标按纯文本显示(不开链)

**实现位置**:对话区 markdown 渲染层。opencode 上游 `<Markdown>` 组件用 micromark 解析,我们需要自定义一个 micromark 扩展识别 `\[\d+\]` 模式 → 替换为 `<InlineCitation>` 组件。**本期不实现**,留 P2 placeholder。

### 3.4 多 resource_link 类型混排(异常处理)

理论上一条 assistant 消息内可同时含 artifact 和 reference 类型的 resource_link(虽然实际不会发生):

```
content: [
  { type: "text", ... },
  { type: "resource_link", _octoDisplay: "artifact", ... },   // 产物
  { type: "resource_link", _octoDisplay: "reference", ... },  // 引用
]
```

客户端 `partitionLinks` 自然分流,artifacts 走大卡,references 走 chip,**不冲突**。

---

## 4. 数据结构变更

### 4.1 `ResourceLink` 类型扩展

[resource-link.ts](../../../packages/app/src/pages/insight/utils/resource-link.ts):

```ts
export type ResourceLink = {
  uri: string
  name: string
  mimeType: string
  description?: string
  _octoDisplay?: "artifact" | "reference"   // 新增,缺省 "artifact"
}
```

`findResourceLinks` 解析时读取 `p._octoDisplay`(若存在);各 defensive 分支(A/B/C)统一携带该字段。

### 4.2 `OutputCard` / `ResultTab` 不变

产物型走原有 `OutputCard`(`source: "uri"` + mimeType 路由),引用型**不进 OutputCard 体系**(走独立 `ReferenceList` 组件)。

---

## 5. 实施 phase

按 user 拍板"本期先做框架,L3 渲染等服务端先改":

### Phase 1(本轮 spec 落地)
- ✅ 本 spec 写完
- ✅ [mcp-contract.md](../agents/mcp-contract.md) 加引用型 tool 章节 + `_octoDisplay` 约束
- ✅ [output-renderers.md](output-renderers.md) cross-ref 本 spec
- ⏳ insight agent.md systemHint 加角标约束(L2,等内网 agent 文件可改时同步)

### Phase 2(UXR 服务端改完 `_octoDisplay` 后)
- 客户端 `ResourceLink` 类型加字段 + `findResourceLinks` 解析 + `partitionLinks` 路由
- 新组件 `ReferenceList`(`packages/app/src/pages/insight/components/reference-list/`)
- `insight-turn.tsx` 在 OutputCard 大卡渲染之后插入 ReferenceList(只渲染 reference 链接)
- 单测:`partitionLinks` 分流 / 缺省 → artifact / 异常字段 → artifact 兜底

### Phase 3(LLM 稳定输出 inline 角标后)
- micromark 扩展识别 `[n]` 模式
- `<InlineCitation>` 组件:hover tooltip + 点击 openLink
- 与 §3.3 兼容策略对齐

每个 Phase 独立可上线,后续 phase 缺失时 UX 仍可工作。

---

## 6. 验证

### 6.1 Phase 1 验证(本轮 spec 完成后)
- [ ] UXR 团队和 octo 团队对照本 spec 对齐 `_octoDisplay` 字段语义
- [ ] mcp-contract.md 引用型 tool 章节读完无歧义
- [ ] 内网 `search_reports` 改完 `_octoDisplay: "reference"` 后,客户端继续按"产物大卡"渲染 5 张(向后兼容,不报错;只是没有引用 chip 体验)

### 6.2 Phase 2 验证(客户端 ReferenceList 落地后)
- [ ] `search_reports` 跑通,5 张大卡消失,改为段末 1 条 ReferenceList(5 条 chip)
- [ ] 点 chip → 系统浏览器打开对应 url
- [ ] 单测:partitionLinks(混合 artifact/reference)/(全 reference)/(空 array)/(缺省字段)
- [ ] 产物型 tool(analyze_interview)行为不变(回归)

### 6.3 Phase 3 验证(inline 角标)
- [ ] LLM 输出 `[1][2]` → 解析为可点击角标
- [ ] hover 角标显示 tooltip(文件名 + description)
- [ ] LLM 没输出角标 → ReferenceList 仍正常,无报错

---

## 7. 边界 / 决策记录

### 7.1 为什么不延用 OutputCard 类型增加 `"reference"` enum 值

考虑过 `OutputCardType` 加 `"reference"` 走现有 ResultViewer tab 系统。**否决理由**:
- OutputCard 是右侧 tab 化的"可打开内容",引用链接没有"打开 tab 看内容"的需求(就是个外链)
- ResultTab 数据模型 `content / mimeType / fetch` 跟引用语义不匹配
- 强行复用会让 OutputCard 类型职责膨胀;独立组件清晰

### 7.2 为什么不用 MCP 协议 `annotations.priority`

考虑过用 `priority < 0.5 → reference, priority >= 0.5 → artifact`。**否决理由**:
- 0~1 数字对服务端开发者不直观("我这个工具该填 0.3 还是 0.5?")
- MCP `priority` 语义本是"排序权重",硬塞业务语义会混淆未来真实排序需求
- octo + UXR 私有契约,enum 字符串更清晰

### 7.3 为什么不让服务端不返 resource_link、只返 text 内嵌 markdown 链接

考虑过 ChatGPT 早期做法:LLM 直接在 text 写 `[标题](url)`,不用 resource_link。**否决理由**:
- 失去结构化(title / description / mimeType)
- 服务端难保 LLM 100% 写规范 markdown 链接
- 客户端无法做 chip 列表的"可扫读"视觉优化
- resource_link + `_octoDisplay` 兼顾结构化和语义,业界(Perplexity / Bing)同款思路

### 7.4 关于 task_id 字段

引用型 tool **不应该返 `task_id`**(它是同步返回,不是长任务)。若不慎返了 task_id,客户端 [task-detect.ts](../../../packages/app/src/pages/insight/utils/task-detect.ts) 会把它当任务卡处理,引用链接会被 §3.5 入口冗余规则同时呈现在任务卡的"查看完整结果"和段末 ReferenceList 里。**spec 钉死:引用型 tool 的 structuredContent MUST NOT 含 task_id**。

---

## 8. 文件组织(Phase 2 落地时)

按 CLAUDE.md "页面自包含":

```
pages/insight/
├── components/
│   ├── reference-list/
│   │   ├── index.tsx                 # ReferenceList 容器
│   │   └── reference-chip.tsx        # 单个 chip
│   ├── insight-turn.tsx              # 改:在大卡之后插入 ReferenceList
│   └── ...
├── utils/
│   └── resource-link.ts              # 改:ResourceLink 加 _octoDisplay 字段 + partitionLinks helper
└── ...
```

Phase 3 的 InlineCitation 在 `components/reference-list/inline-citation.tsx`。

---

## 9. 与其他 spec 的关系

| 引用方 | 引用项 | 说明 |
|---|---|---|
| 本 spec → [mcp-contract.md](../agents/mcp-contract.md) | 引用型 tool 契约 + `_octoDisplay` 字段定义 | 业务工具分类约束 |
| 本 spec → [output-renderers.md §0](output-renderers.md#0-两类卡片来源--职责边界重要) | 路径 A 强契约边界 | 引用型不走 OutputCard 大卡 |
| 本 spec → [task-card.md §3.5](task-card.md#35-故意保留的冗余刷新-turn-的-outputcard入口冗余非-tab-重复) | 入口冗余规则 | 引用型不参与冗余(无 task_id) |
| 本 spec → [insight agent.md](../../../packages/agent/insight/agents/insight.md) | LLM 角标约束(Phase 3) | systemHint 引导 LLM 写 `[n]` |
