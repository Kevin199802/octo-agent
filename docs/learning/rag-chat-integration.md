# 把内网知识库 RAG 接进 chat — 架构选型与权衡

> 规划阶段笔记(2026-06-10)。回答的问题:chat 栏目目前纯沿用上游 opencode,现在要接**内网几个网站的知识库问答**(全新独立后端,不是现有 uxr-tool),应该怎么接?
>
> 前置阅读:
> - [skill-and-mcp.md](skill-and-mcp.md) — MCP 三种传输、Skill vs MCP
> - [mcp-api-integration.md](mcp-api-integration.md) — 内网 API 包成 /mcp 路由(路径 C)的对接方法
> - [plugin-hooks-url-injection.md](plugin-hooks-url-injection.md) — 用 server 插件在消息/工具前注入内容的机制
> - [context-and-memory.md](context-and-memory.md) — 上下文窗口、为什么塞进去的东西都要花 token
>
> 本文不讲"怎么写 MCP server"(那是 mcp-api-integration.md),只讲**架构选型、触发策略、呈现方式的权衡**——尤其是"内网模型较弱"这个硬约束怎么影响选择。

---

## 0. 先认识 RAG 本身

RAG(Retrieval-Augmented Generation,检索增强生成)= **先检索、再生成**。LLM 自己的参数里没有你们内网文档的知识,直接问它只会瞎编。RAG 的做法:

```
用户问题
  │
  ▼
① 检索(Retrieval):拿问题去知识库找最相关的几段文档片段(chunk)
  │
  ▼
② 增强(Augmentation):把这些片段拼进给 LLM 的 prompt 里 ——「请基于以下资料回答…」
  │
  ▼
③ 生成(Generation):LLM 基于片段 + 问题合成答案,并标注引用来源
```

内网那个接口干的就是 ①——给它 query,返回一堆带评分的文档片段。我们要决定的是:**②③ 在哪做、谁来触发 ①、结果怎么呈现**。

内网接口返回结构的关键字段(脱敏示例见对接资料):

```
data[].data[]              一条命中文档
  ├─ markdown_content       完整 markdown 正文
  ├─ ClassificationL1..L5   多级分类
  ├─ projectModuleName      项目模块名
  ├─ author / url           作者 / 原文链接
  ├─ es_score / _score      ES 相关性评分
  ├─ highlight.markdown_content[]   高亮片段(适合做摘要展示)
  └─ chunk_list[]           文档切块
        ├─ TOPIC_TITLE / TOPIC_CONTENT   片段标题 / 内容
        └─ TOPIC_FEATURE.IMAGE_URL_LIST / PAGE_START_END  图 / 页码
```

注意:这个接口返回的是**检索结果(chunk + 评分),不是生成好的答案**(`answer` 字段在脱敏样例里是空的)。也就是说生成那步(②③)很可能要我们这边的 LLM 来做。这点要跟内网确认:它到底只做检索,还是也能直接给答案?这会决定我们是"纯检索器"还是"检索+生成"都接管。

> **2026-06-10 同步**:同事反馈这个接口此前已被内网一个 web 小助手对接,实际**只用到 `TOPIC_CONTENT`、`_score`、`markdown_content` 三个字段**,其余几乎没用。即生成确实在消费方做。v1 只需吃这三个字段(`_score` 排序/过滤、`TOPIC_CONTENT` 片段、`markdown_content` 兜底全文)。**但整合层解析时要保留完整结构**(见 §8 扩展阶梯),别在 HTTP 边界就把其他字段丢掉,否则后续做来源卡片要重新铺管线。

---

## 1. chat 栏目现在长什么样

- [packages/app/octoapp/pages/chat.tsx](../../UXAI/packages/app/octoapp/pages/chat.tsx) 把默认 agent 设成 `octo_ai`,渲染的是**上游 `SessionPage`**。即:chat = 上游会话 + 通用默认 agent,本身没挂任何 MCP / 知识库。
- agent → MCP 的挂载在 `packages/opencode/src/agent/agent.ts`:每个 agent 用 `mcp: [...]` 引用 `config/builtin-mcp.ts` 里的服务器。
- 你们已经有一套同类的东西在跑:`uxr-tool`(remote MCP)暴露 `search_reports`(用研知识问答),但**只挂在 `octo_insight`,没挂到 chat 的 `octo_ai`**。

所以"接 RAG 进 chat"在工程上有**三种**落点:
- **原生 in-process 工具**(最轻):用 `Tool.define` 写一个 `knowledge_search` 工具,内部直接 POST 内网 HTTP,注册进 `tool/registry.ts`,按 agent 网关。**octo 已有成熟先例**:`tool/internel_image_generate.ts` / `jimeng_image_generate.ts` 就是这么干的(直连 `octoai-api.ucd.huawei.com`)。不需要单独 server、不需要 shim。
- **MCP**(配置式):把知识库包成 MCP(内网出 `/mcp` 远程,或我们写本地 shim 包它的 HTTP),挂到某个 agent。复用上游 MCP 链路 + resource_link 卡片契约。
- **server 插件**(代码式):在消息进模型前自己调 HTTP 检索、注入上下文(复用 octo-upload-inject 那套机制)。适合"前置/路由式"确定性触发。

前两者天生 agentic(LLM 决定调);第三者天生确定性(我们的代码决定调)。选哪种跟下面的"触发方式"绑死。

---

## 2. 核心约束:内网模型较弱

这是本次最重要的设计约束,它直接否掉一条看似最省事的路。

**纯 agentic RAG**(把 `knowledge_search` 暴露成 MCP 工具,让 LLM 自己决定何时调)——在强模型(Claude/GPT-4 级)上是业界主流、体验最好;但它依赖模型**可靠地判断"这个问题该查库"并正确构造检索 query**。弱模型在这两步上都不稳:

- 该查的时候不调(用户得不到答案,以为系统没知识);
- 不该查的时候乱调,或 query 构造得很差,检索质量崩。

**结论:别在通用 chat 里走"纯靠 LLM 自觉调工具"这条路。** 要么把决策权从弱模型手里拿走(我们的代码决定何时检索),要么把场景收窄到一个"强制检索"的专门模式。

---

## 3. 三种触发策略(谁决定"这轮要不要检索")

| 策略 | 谁决定 | 稳定性 | 成本 | 代价 |
|---|---|---|---|---|
| **A. Agentic** — LLM 看到工具自己调 | 弱 LLM | ✗ 低 | 省(不相关就不调) | 弱模型识别不准 → 本次否掉 |
| **B. 前置检索(always-on)** — 每条消息都先检索注入 | 我们的代码 | ✓ 最高 | 贵 + 有噪音 | 见下「噪音」 |
| **C. 轻量路由** — 先判"要不要查库",要才检索 | 规则 / 一次极简分类调用 | 中高 | 中 | 要维护判定逻辑 |
| **D. 显式入口** — 用户点按钮 / 切"知识库模式" | 用户 | ✓ 最高 | 省 | 需要用户动作 |

### 什么是「噪音」(策略 B 的代价)

always-on 每条消息都强制检索、把 top-k 片段塞进 prompt。当用户那句话**跟知识库无关**时("你好" / "刚才那个再说细点" / "帮我改下这段"),照样塞一堆片段进去:

1. 白白烧 token / 上下文窗口(见 [context-and-memory.md](context-and-memory.md));
2. **弱模型更容易被无关片段带偏**,硬把不相关内容塞进答案;
3. 片段质量参差时,反而污染本来能答好的问题。

**但噪音大小取决于 chat 的产品定位**:
- 若 chat **以知识库问答为主** → 绝大多数消息本就是库问题 → always-on 噪音很小,B 是最简单又最稳的选择。
- 若 chat 是**通用助手顺带查库** → 噪音明显 → 应走 C(路由)或 D(显式入口),把检索限制在真正需要时。

> 这就是为什么"chat 定位"是必须先拍的前置问题——它直接决定触发策略。

---

## 4. 传输:MCP vs 自己 HTTP 集成

这两者**和触发策略是耦合的**,不是独立选择:

| | MCP(像 uxr-tool 那样) | 自己用 HTTP 集成(server 插件) |
|---|---|---|
| 接入成本 | **配置即接入**:builtin-mcp 加一项 + agent `mcp:[]`,框架管 schema/校验/调用/回传 | 自己写调用层、错误处理、上下文注入 |
| 触发模型 | **天生 agentic**(策略 A)——暴露给 LLM 由它决定 | **天生可控**(策略 B/C)——我们的代码决定何时调 |
| 卡片渲染 | 结果是协议规定的 text/resource_link parts,客户端已有解析 | 卡片数据要自己组装 |
| 前提 | 内网得把接口包成 MCP server(SSE/streamable HTTP) | 内网给 REST 即可 |
| 一致性 | 和现有 uxr-tool 同一条链路 | 偏离"配置即接入" |

**关键洞察**:MCP 默认把"何时检索"的决策权交给 LLM;HTTP-in-plugin 把决策权留在我们代码里。

- 既然弱模型否掉了纯 agentic(策略 A),**纯 MCP 的最大优势(配置即接入 + agentic)恰好用不上**。
- 想要确定性触发(B/C),用 MCP 反而别扭——你得在 MCP 之外再加一层"强制调用"逻辑;用 HTTP-in-plugin 则天然契合。

> 不过 MCP 也能配合确定性触发:在一个**专门的知识问答 agent** 里,prompt 把"必须先调 knowledge_search"写成铁律,甚至用 `tool_choice` 强制工具调用。这是"MCP + 强制"的折中(对应策略 D + 独立 agent)。

---

## 5. 三套可落地的组合方案

把"触发 + 传输 + 落点"组合起来,实际就三套:

### 方案一:独立知识问答 agent + MCP + 强制检索(对应 D)
仿 `octo_insight`:新建 `octo_kb` agent,挂知识库 MCP,prompt 铁律"先检索再答",UI 给独立入口/模式。通用 `octo_ai` chat 保持纯上游。
- ✅ chat 干净;产品面清晰;复用上游 MCP 链路 + insight 卡片基建;弱模型在"强制 + 收窄场景"下表现可控。
- ❌ 用户要切模式;需要内网把接口包成 MCP。

### 方案二:前置检索插件 + HTTP(对应 B)
写一个 server 插件,在消息进模型前调内网 HTTP、把 top-k chunk 作为 synthetic part 注入(机制同 [plugin-hooks-url-injection.md](plugin-hooks-url-injection.md) 的注入,只是数据源是检索结果)。直接作用在现有 chat。
- ✅ 不依赖弱模型决策,最稳;chat 无需切模式;内网给 REST 即可。
- ❌ 有噪音(若 chat 是通用场景);生成质量依赖我们这边的 LLM;要自己写注入 + 卡片数据组装。

### 方案三:轻量路由 + HTTP(对应 C)
在方案二基础上,加一个便宜的"要不要查库"判定(关键词规则,或一次极简分类调用),要才检索。
- ✅ 兼顾稳定与省钱;通用 chat 也能用。
- ❌ 路由判定要调,误判时要么漏查要么乱查(但比纯 agentic 可控,且规则可迭代)。

**选型逻辑**:先定 chat 定位 →
- 知识库问答为主 → 方案一(要独立入口)或方案二(不切模式、始终查);
- 通用助手顺带查 → 方案三。

---

## 6. 呈现:业界标准

主流 RAG 产品(Perplexity / Glean / 企业知识库)的标准呈现 = **正文内联答案 + 行内引用 + 下方来源卡片**:

- **正文**:LLM 基于检索片段合成的自然语言答案;
- **引用**:答案里关键论断带角标 [1][2],对应来源;
- **来源卡片**:每条命中文档一张卡,展示 `TOPIC_TITLE` / `ClassificationL*` 分类 / `highlight` 高亮片段 / `author` / 跳 `url` 原文 / `PAGE_START_END` 页码 / 可选 `IMAGE_URL_LIST` 缩略图。

落地可复用 insight 已有的卡片基建([resource-link.ts](../../UXAI/packages/app/octoapp/pages/insight/utils/resource-link.ts) / insight-turn.tsx 的卡片路由),把内网返回的 `data[].data[]` 映射成卡片数据即可。

> 防"答案污染":参考 octo_insight 的 prompt 铁律——正文只写自然语言摘要 + 引用,**别把检索到的 markdown / JSON 原样 inline 到对话**,详细内容放卡片。否则弱模型容易把整段检索结果复读出来。

---

## 7. 已确认的产品前提(2026-06-10)

1. **chat 定位**:**通用助手顺带做网站知识库问答**(不是知识库为主)。→ 噪音敏感,排除 always-on 前置检索。
2. **内网接口职责**:只做检索,实际只用 `TOPIC_CONTENT` / `_score` / `markdown_content` 三字段;生成由消费方(我方 LLM)做。
3. **与 uxr-tool 关系**:全新独立后端(几个内网网站的 KB),和 search_reports 并行,不替换。
4. **现阶段策略**:上线前"顺带塞一点内容",**先简化做**;但方向不能错,后续大概率持续迭代——**不能为了简单把后续方案堵死**。

仍待确认:内网能否出 `/mcp`(影响传输选择,但不影响 v1——见 §8);呈现细节(引用角标 / 卡片字段映射)留到迭代阶段。

---

## 8. v1 简化方案 + 扩展阶梯(本次结论)

### 选型推导

- 通用 chat → 噪音敏感 → **排除 always-on(方案二)**。
- 弱模型 → **排除"指望 LLM 完美自觉调工具"作为可靠性保证**,但 v1 是"顺带"功能,agentic + 强工具描述可接受(触发可靠性留作下一阶梯升级,且升级是**叠加**不是重写)。
- 简化 + 自己掌握节奏 + 不依赖内网改造 → 传输选**原生 in-process 工具**(最轻、有 internel_image_generate 先例),优于 MCP(需 /mcp 或 shim)和插件。

### v1(先做)

一个原生工具 `knowledge_search(query)`:
- 内部 POST 内网 KB HTTP,取 `data[].data[]`,按 `_score` 排序取 top-k,返回 `TOPIC_CONTENT`(+ top-1 的 `markdown_content` 兜底);
- 注册进 `tool/registry.ts`,**只网关给 chat 的 `octo_ai` agent**;
- 触发 = agentic:靠**强工具描述**提高弱模型命中率(如"当用户询问内网网站/产品/文档/规范相关问题时调用此工具检索内网知识库");
- 呈现 = 内联:LLM 读工具返回的片段,合成自然语言答案(prompt 约束:基于检索资料回答、别整段复读 markdown)。

就这些。一个工具文件 + registry 注册 + agent 网关 + 一句 prompt。

### 扩展阶梯(后续迭代,v1 不做但必须不堵死)

| 维度 | v1 | 后续叠加(additive,不重写) |
|---|---|---|
| **触发** | agentic + 强描述 | 加轻量路由(关键词/意图判定)或专门 KB 模式强制检索。工具不变,路由是前置层 |
| **检索字段** | 只渲染 3 字段 | 整合层**解析完整响应**,后续直接取 `ClassificationL*`/`url`/`author`/`highlight`/图/页码做卡片,无需重铺管线 |
| **呈现** | 内联答案 | 工具输出做成**结构化 parts**(resource_link 风格),叠加来源卡片(复用 insight 卡片渲染) |
| **多 KB** | 单一聚合端点 | 工具 schema **预留 `source`/`site` 过滤参数**(v1 可不传),后续按网站筛选是加参数 |
| **生成归属** | 我方 LLM 生成 | 若内网日后返回 `answer`,可切"直接转述"模式,两条路都保留 |

### 明确要避免的"堵死"做法

- ❌ 把 HTTP 调用**硬写进 UI 组件 / chat 渲染层** —— 必须是个工具,触发与呈现才能各自替换。
- ❌ v1 就做 always-on 前置检索 —— 通用 chat 噪音大,且方向与"顺带"定位相悖,回退成本高。
- ❌ 在 HTTP 边界**丢掉未用字段** —— 整合层吃完整结构,只渲染子集。
- ❌ 把"单一 KB"假设**焊进工具签名** —— 预留 source 维度。
- ❌ 让答案**整段复读检索到的 markdown/JSON** —— 参考 octo_insight 的防污染 prompt,正文只写摘要,详情留给(未来的)卡片。

---

## 附:与现有机制的复用关系

| 要做的事 | 可复用的现有实现 |
|---|---|
| 把内网接口包成 MCP | [mcp-api-integration.md](mcp-api-integration.md)(路径 C)+ `config/builtin-mcp.ts` 加一项 |
| agent 挂知识库 | `agent.ts` 的 `mcp: [...]` 声明(参考 octo_insight) |
| 消息前注入检索结果 | [plugin-hooks-url-injection.md](plugin-hooks-url-injection.md) 的 server 插件 + synthetic part 注入 |
| 来源卡片渲染 | insight 的 resource-link.ts / insight-turn.tsx |
| 防答案污染的 prompt 写法 | octo_insight.md 的"异步任务结果回复规则"同理 |
