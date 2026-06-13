# SPEC — chat 内网知识库检索工具(knowledge_search)

> **上游已实现 ✗** —— opencode 无此能力,octo 自加的原生 in-process 工具。
>
> 背景与选型推导见 learning:[rag-chat-integration.md](../../learning/rag-chat-integration.md)(尤其 §8 v1 方案 + 扩展阶梯)。
> 本文是该工具的**接口与实现契约**,聚焦"怎么做",决策理由不在此重复。
>
> 与 [mcp-contract.md](mcp-contract.md) 的区别:那是 uxr-tool 的 **MCP** 契约(用研报告,挂 octo_insight);本工具是**独立后端 + 原生工具**(内网网站知识库,挂 chat 的 octo_ai),两者并存不替换。

---

## 0. 实施进度(交接锚点 · 2026-06-13)

> 代码在分支 **`feat/chat-knowledge-search`**(已 merge `dev`,含 session 列表崩溃修复)。开新对话从这里看当前状态。

**已完成(已提交、未上内网验证通过):**
- ✅ `knowledge_search` 工具([UXAI packages/opencode/src/tool/knowledge_search.ts](../../../UXAI/packages/opencode/src/tool/knowledge_search.ts)):POST getKnowledgeVector,按文档(unique_id)去重整形 top-k、`projectModuleName` 标题、保留内嵌 `[文件名](链接)`,`metadata.sources` 供引用 UI。
- ✅ registry 注册 + **仅网关 `octo_ai`**(`input.agent.name==="octo_ai"`)。
- ✅ octo_ai prompt:工具说明 + 引用 `[[n]](链接)` 可点 + 紧跟句末 + 保持分段。
- ✅ 行内文件链接(markdown 原生渲染,零 UI)。
- ✅ 可点引用角标 `[n]`(模型输出 `[[n]](url)`,上游 Markdown 渲染)。
- ✅ 底部「引用 N 篇资料」折叠列表([UXAI .../session/knowledge-references.tsx](../../../UXAI/packages/app/octoapp/pages/session/knowledge-references.tsx) + message-timeline 注入;兼容 DeepSeek R1 把 reasoning+tool 与正文拆多条 assistant 消息)。
- ✅ host 配置:**独立 env `OCTO_KB_BASE_URL`**(`.env.<channel>` → electron.vite define → sidecar);其余(top_k/account/path/timeout)为代码常量。
- ✅ `[octo:kb]` 诊断日志(见 insight-debugging.md)+ 本地 mock(kb-mock-server.ts)。

**待办:**
- ⏳ **内网 host 验证**:在 `.env.<channel>` 设 `OCTO_KB_BASE_URL` 为对的 host(beta/prod 当前都可先指 beta),打包后看 `[octo:kb] config` 的 `url` 与 Insomnia 对齐。**当前唯一卡点**。
- ⏳ **真实工号/account**:现为常量 `""`(非必传不影响检索)。要按真实登录用户记账 → session 注入(§6,**已设计未实现**)。
- ⏳ **引用角标真·上标定位**:现状是模型输出 `[[n]](url)`,可点但**位置由模型决定**(正文上游渲染,不可非侵入控制)。如需固定为右上标,只能对「含 sources 的轮次」做局部 DOM 后处理(评估为侵入/脆,**未做**;见 §12 已知限制)。
- ⏳ 来源卡片富化(分类/作者/高亮/页码)、检索触发路由、多 KB `source` 筛选 —— 见 §8 扩展阶梯,均 additive。

---

## 1. 目标与范围

- **目标**:chat(通用助手)能顺带回答"内网网站知识库"问题。用户提问 → 工具检索内网 KB → LLM 基于检索片段合成答案。
- **定位**:通用 chat 顺带能力,非知识库专用模式。**先简化做**,但接口/数据保留完整结构,不堵死后续迭代(卡片/路由/多 KB,见 §8)。
- **v1 不含**:来源卡片渲染、引用角标、检索触发路由、多网站筛选、真实登录态身份。这些是后续叠加项。

---

## 2. 接入方式

| 项目 | 值 |
|---|---|
| 形态 | **原生 in-process 工具**(`Tool.define`),非 MCP、非插件 |
| 先例 | [`packages/opencode/src/tool/internel_image_generate.ts`](../../../UXAI/packages/opencode/src/tool/internel_image_generate.ts)(同款"工具直连内网 HTTP") |
| 注册 | `packages/opencode/src/tool/registry.ts`,**仅网关给 chat 的 `octo_ai` agent** |
| 触发 | agentic(LLM 看工具描述自行决定调用),靠**强工具描述**提升弱模型命中率 |
| 鉴权 | 无(内网,网络隔离) |

---

## 3. 内网接口契约(getKnowledgeVector)

### 3.1 请求

| 项目 | 值 |
|---|---|
| Method | `POST` |
| URL | `{BASE_URL}/main/rest.root/ucdAgent/ucdAgent/getKnowledgeVector` |
| Content-Type | `application/json` |
| Body | `{ "account": "<姓名 工号>", "context": "<用户问题>" }` |

- **`context`** = 检索 query(工具入参 `query` 映射到这里)。
- **`account`** = 调用者身份,格式 `"李白 l00123456"`(姓名+空格+工号)。来源见 §6(⚠️ 跨进程边界,是本 spec 最大的实现点)。
- **`BASE_URL`** 解析见 §6。
- **URL Params**:无(已确认),只发 body JSON。
- **请求 Headers**:仅 `Content-Type: application/json`,**无任何必填项**(已确认;截图里的 `aaa:1111` 等是响应头/测试头,忽略)。
- **鉴权**:无。`account` 不做权限过滤,**仅用于服务端记录,且服务端可能按单账号限流**。

### 3.2 响应(真实样例字段语义,已脱敏校对)

顶层:

```jsonc
{
  "contextual_rewrite_query": [],   // 上下文改写;v1 不用
  "data": [                         // 数组(可能因多 query 改写有多元素;v1 全部遍历)
    {
      "answer": "",                 // ⚠️ 实测为空 → 生成由我方 LLM 做,不要指望它给答案
      "corr_info": { "search_text": "如何申请访谈酬金" },
      "cost_time": 0.247859,
      "data": [ /* 命中文档列表,见下 */ ]
    }
  ]
}
```

`data[].data[]`(一篇文档):

```jsonc
{
  "ClassificationL1": "用户研究",   // 多级分类;v1 不用,但保留(卡片用)
  "ClassificationL2": "方法与工具",
  "ClassificationL3": "", "ClassificationL4": "", "ClassificationL5": "",
  "_score": "17.14",               // ⚠️ doc 级是【字符串】
  "author": "<姓名 工号>",          // 格式同 account
  "markdown_content": "...",        // ⚠️ doc 级整篇,很大;v1【不喂模型】
  "url": "...", "unique_id": "...", "projectModuleName": "...",
  "highlight": { "markdown_content": [...] },  // 卡片用,v1 不用
  "chunk_list": [ /* 同一文档可【多个】chunk */ ]
}
```

`chunk_list[]`(实际要用的检索单元):

```jsonc
{
  "DOC_ID": "ucdResearch_xlsx_8",
  "TOPIC_CONTENT": "# 普通用户酬金申请流程详解。## 1. 用户分类。...",  // ★ 喂模型的正文(markdown 中文,几百字)
  "TOPIC_TITLE": "...",            // ⚠️ 实测≈整段正文,【不是干净标题】,v1 别拿来当 title
  "_id": "d50ece0015fe3afdfaa490d8129cb2ac",
  "_score": 11.797726,            // ★ chunk 级是【数字】→ 用它排序
  "TOPIC_FEATURE": {
    "IMAGE_URL_LIST": [], "PAGE_START_END": [1,1],
    "TOPIC_CONTENT_START": 0, "TOPIC_CONTENT_END": 38, "...": "..."
  }
}
```

**关键事实(影响实现,务必遵守):**
1. `_score` doc 级是**字符串**、chunk 级是**数字** → 排序用 **chunk 级 `_score`(number)**。
2. 评分是 ES 原始分(实测 ~10–20,**无上界**)→ **可排序,不可设绝对阈值**;过滤用"相对 top-k"或"相对 top1 的比例",别写死 `score > X`。
3. 一篇文档返回**多个 chunk** → 检索单元是 chunk,不是 doc。
4. `TOPIC_CONTENT` 是中文 markdown,适合直接喂模型;`markdown_content`(doc 整篇)很大,响应实测 **3100+ 行**,**v1 不能整体回传给模型**。
5. `answer` 为空、`TOPIC_TITLE` 不可信当标题 —— 两个反直觉点。

---

## 4. 工具定义(knowledge_search)

```
name: knowledge_search
description(给弱模型看,要强而具体):
  "检索公司内网知识库,回答与内网网站/产品/流程/规范/制度/用户研究等相关的问题。
   当用户的问题可能在内网文档里有答案时调用;返回相关文档片段供你据实回答。"
input:
  query: string   // 必填,用户问题 → 映射到 body.context
  // ⚠️ 预留(v1 可不实现/不传,但 schema 留位,见 §8 多 KB 扩展):
  // source?: string  // 按网站/知识源筛选
output:
  检索到的 top-k 片段(纯文本,编号列出),供 LLM 合成答案
```

> `account` **不进工具入参**(用户/模型不该填身份),由实现侧按 §6 处理(v1 缺省不发)。

---

## 5. 检索整形(retrieval shaping)— 实现逻辑(已按真实数据升级为「按文档」)

真实数据关键事实(2026-06-13 三张截图确认):
- **同一文档有多个 chunk、TOPIC_CONTENT 高度重复** → 必须按文档去重,否则噪音/token 爆。
- **文档级有干净标题 `projectModuleName`**(如「普通用户申请酬金」)+ `url` + `unique_id` —— 即图二底部参考列表的标题与链接来源。`TOPIC_TITLE` 仍≈正文不可用。
- **正文(TOPIC_CONTENT/markdown_content)内嵌 `[文件名](链接)` 形式的 markdown 链接** —— 图二的「行内文件蓝链」就是模型把这些复述出来;chat 原生渲染 markdown 链接,故**行内链接零新 UI**。

逻辑:
1. POST 接口拿响应。
2. **按文档解析**:遍历 `data[] → .data[](= 文档)`,每篇取**最佳 chunk**(chunk 数字 `_score` 最大)的 `TOPIC_CONTENT`;文档级取 `projectModuleName`(标题,缺则正文首个 `#` 标题兜底)/ `url` / `unique_id` / `ClassificationL*`。
3. **按 `unique_id` 去重**(跨 block 同 id 取高分),消除重复 chunk。
4. 按文档最佳分**降序**取 **top-k**(默认 6,env `OCTO_KB_TOP_K` 可调)。
5. 每篇正文截断到 `MAX_CHUNK_CHARS`(默认 800;注意:过短会截掉内嵌链接,影响行内链接效果,可按需调大)。
6. 组装为**按文档编号**的文本喂模型:`[n] <标题>(分类)\n<正文>`,并在引导语里允许保留 `[文件名](链接)`、标注 `[n]`、禁止大段照抄。
7. **空结果** → 返回明确"未检索到",不返回空串。

> `metadata.sources` 每篇 = `{ n, id, title(projectModuleName), url, classification, score }` —— `[n]→文档` 的映射,供后续「行内上标 + 底部折叠参考列表」UI 直接用,无需改检索层。

---

## 6. 配置:BASE_URL 与 account 来源

**背景:跨进程边界 + 先例。** 工具跑在 **sidecar(server)进程**(纯 Node,无 DOM),读不到 renderer 的 `localStorage`,也读不到 `import.meta.env.VITE_*`。已落地先例对比:
- [tracker.ts](../../../UXAI/packages/app/octoapp/utils/tracker.ts):**整段跑 renderer**,直接取 localStorage + VITE,无边界问题(但它不是 LLM 工具)。
- jimeng/internel 图片工具(**与本工具同类:既是 LLM 工具又注册在 registry**):
  - base_url:工具内**硬编码全 URL + `env()` 覆盖**(`DEFAULT_CREATE_TASK_URL`),不依赖 VITE/透传。
  - userIdx(身份):走 LLM 工具这条路时**直接用硬编码默认** `l00423136`;**真实身份只在 renderer 发起的 `/studio/generations` 路径**上有(renderer 把 `extra.userIdx = uiplusUserAccount()` 放进请求 body,见 [studio-page.tsx](../../../UXAI/packages/app/octoapp/pages/studio-page.tsx))。
  - **结论**:Studio 并未在"LLM 工具"这条路上解决真实身份 —— 那条路就是默认值。

### BASE_URL(**独立变量 `OCTO_KB_BASE_URL`**,不复用 VITE_OCTO_BASE_URL)

> **2026-06-13 修正**:初版复用 `VITE_OCTO_BASE_URL` 桥接,踩坑——`VITE_OCTO_BASE_URL` 是**渠道默认 base**(prod 包里=prod 域名),而内网只能用 prod 包验证、KB 却要打 beta 端点,导致 base 读成 prod。登录不受影响是因为它另走 channel 逻辑拼路径,不直接用这个 var。
> **改为独立变量**,与 VITE/渠道完全解耦。

- 新增**非 VITE_ 变量 `OCTO_KB_BASE_URL`**,写在 `.env[.beta/.prod]`(由使用方按渠道/验证需要填,**与 VITE_OCTO_BASE_URL 互不影响**)。
- **为何仍需"注入"**:工具在 **opencode dist(sidecar 进程)** 跑,读不到 `.env`/`VITE_`/编译期常量,只能在运行时读 `process.env`。故链路:`.env` 的 `OCTO_KB_BASE_URL` → `electron.vite` main `define` 成 `import.meta.env.OCTO_KB_BASE_URL`([electron.vite.config.ts](../../../UXAI/packages/desktop/electron.vite.config.ts))→ `createSidecarEnv` 写进 sidecar `process.env.OCTO_KB_BASE_URL`([server.ts](../../../UXAI/packages/desktop/src/main/server.ts))→ 工具 `process.env.OCTO_KB_BASE_URL` 读到。
- 这一步是**单一用途的直注**(不再耦合 VITE/渠道默认),且 shell/cross-env 已显式设 `OCTO_KB_BASE_URL` 时不覆盖(留 override)。
- path:**固定** `/main/rest.root/ucdAgent/ucdAgent/getKnowledgeVector`(beta/prod 仅 host 不同、路径相同,无需做成可配置)。
- 留空 → 工具回落本地 mock(`http://localhost:8787`)。外网/内网均只切这一个 env。

### account(已简化:非必传 → V1 写死工号兜底,免桥)

> **2026-06-10 解套**:内网后台已把 `account` 改为**非必传**。V1 **不再需要** renderer→server 的 session 注入桥 —— 直接写死/env 给工号即可。下方"session 注入"整段**降级为后续可选**(仅当要"按真实登录用户记账/限流"时才做)。

- 语义:**仅记录 + 可能按账号限流,非必传、无权限过滤** → 缺/错都不影响检索正确性。
- **V1 取值**:**代码常量** `ACCOUNT = ""`(空串;account 与环境无关,**不放 env**)。如需按账号记账,改这个常量填工号,或走下方 session 注入。
- **后续(可选)真实账号**:若要按真实登录用户记账,再走 **session 注入**——代码确认这是 LLM 工具路径下唯一可行通道(submit.ts 不传 extra、`ctx.extra` 是内部袋子;Studio 的 extra 走的是 `/studio/generations` 自定义端点不经 LLM;内网 background 登录服务仅 server 侧、外网无)。机制:renderer 发送时注入一个 part(`synthetic`+`metadata` 携带 account、正文留空),工具读 `ctx.messages`,同 [octo-upload-inject](../../../UXAI/packages/opencode/src/agent/octo-upload-inject.ts)。弊端:改共享 `submit.ts`、身份混进会话、隐藏 part 可见性需验证。**V1 不做。**

### 其他(均为代码常量,与环境无关,不放 env)

| 项 | 值 |
|---|---|
| top_k | 代码常量 `TOP_K = 6` |
| timeout | 代码常量 `DEFAULT_TIMEOUT_MS = 30s` |
| path | 代码常量 `KB_PATH`(固定,见 §6) |

> **env 旋钮只有一个:`OCTO_KB_BASE_URL`(host,随环境变)。** 其余全是代码常量。

---

## 7. 答案合成(prompt 约束)

工具返回片段后,LLM 据此回答。在 octo_ai 的 prompt(或工具结果引导语)里约束:

- **基于检索片段回答**,片段没有就如实说"内网知识库未找到",**不要编造**。
- 正文写**自然语言摘要**,**禁止整段复读** `TOPIC_CONTENT` 的 markdown / 表格 / 原始结构(参考 octo_insight 的防污染规则)。
- v1 暂无来源卡片,可在答案末尾附简短来源提示(如 DOC_ID / 分类),但不堆链接。

---

## 8. v1 范围 vs 扩展阶梯

| 维度 | v1 | 后续叠加(additive,不重写) |
|---|---|---|
| 触发 | agentic + 强工具描述 | 轻量路由 / 专门 KB 模式强制检索(工具不变,前置层) |
| 字段 | 只回传 `TOPIC_CONTENT` | 检索层已透传 classification/url/author/highlight → 直接做卡片 |
| 呈现 | 内联摘要答案 | 结构化 parts + 来源卡片(复用 insight 卡片渲染) |
| 多 KB | 单端点 | 工具 schema 已预留 `source` 参数 |
| 身份 | env/默认占位 account | 接真实登录态(姓名+工号) |
| 生成 | 我方 LLM 合成(`answer` 空) | 若内网日后填 `answer`,可切"转述"模式 |

**禁止的堵死做法**:HTTP 调用焊进 UI / v1 就 always-on 前置检索 / HTTP 边界丢字段 / 单 KB 假设焊进签名 / 答案整段复读 markdown。

---

## 9. 决策项

已确认/已定(2026-06-10):
- 接口:Params 无;Headers 仅 Content-Type 无必填;account 仅记录/限流无权限;无其他 body 参数(top_k 先调通后议)。
- 传输:**LLM agentic 工具**(否决 renderer 发起式——那会变成 API 触发器、丢 agent 味且"发你好也检索")。
- base_url:单一 env 接缝 `OCTO_KB_BASE_URL`(§6),兼作内外网 / mock 开关。
- account:**非必传**(后台已改)→ V1 **写死工号/env 兜底,免 session 注入桥**(§6);session 注入降级为后续"按真实用户记账"才做。

**剩余待确认(实现期)**:
1. mock server 形态(独立小服务 vs 扩 mock.ts,取决于后者是否监听 sidecar 可达端口)——见 §11。
2. (后续才需)真实账号取 `localStorage.userInfo.account`、隐藏 part 可见性。

---

## 12. 影响面与风险(对其他模块)— 改这块前必读

核心原则:**所有改动要么按 `octo_ai` 网关、要么数据自闭环,确保 make / design / studio / insight 不受影响。**

| 改动点 | 文件 | 是否共享 | 对其他模块影响 | 缓解 |
|---|---|---|---|---|
| knowledge_search 工具 | `tool/knowledge_search.ts` + `registry.ts` | 工具注册全局,但 `tools()` 过滤里 **`input.agent.name === "octo_ai"` 网关** | 其他 agent 拿不到该工具 → 无 | 网关是硬隔离 |
| octo_ai prompt(工具说明 / 引用格式) | `agent/prompt/octo_ai.txt` | 否,**仅 octo_ai 一份 prompt** | 无 | 天然隔离 |
| 底部「引用 N 篇资料」组件 | `pages/session/knowledge-references.tsx` | 否,新增独立组件 | 无 | — |
| 参考列表注入 | `pages/session/message-timeline.tsx`(**chat 全 agent 共享渲染器**) | **是** | 代码对所有 chat 对话执行,但 `<Show when={kbSources().length>0}>` 仅在存在 knowledge_search sources 时渲染(=仅 octo_ai)→ 其他 agent **不渲染任何东西** | 数据网关(sources 只来自 octo_ai)+ 防御式取值(`?? []`、类型守卫);⚠️ 残余:共享文件,逻辑抛错理论上波及所有 chat,改动须保持纯函数 + 兜底 |
| base_url 桥 | `electron.vite.config.ts` / `main/env.d.ts` / `main/server.ts` | 是(启动链路) | 仅**新增** `OCTO_KB_BASE_URL` 注入,不改动既有变量 | 低风险 |

**注**:insight / studio **用各自渲染器**(insight-turn / studio-page),**不经过 message-timeline** → 与本功能完全无关。

**已知限制(非 bug)**:行内 `[n]` 角标的**位置由模型决定**(正文由上游 `SessionTurn`/Markdown 渲染,不可非侵入控制)。只能用 prompt 引导其"紧跟句末、不换行",best-effort,不保证 100%。要硬控位置须侵入式改全局渲染(违反不动上游 + 影响所有 agent),不做。

---

## 10. 验收标准

- [ ] chat(octo_ai)下提"内网相关问题",模型能调用 `knowledge_search` 并基于片段作答。
- [ ] 工具正确 POST `getKnowledgeVector`,body 为 `{account, context}`,context=用户问题。
- [ ] 按 chunk 数字 `_score` 降序取 top-k,只回传 `TOPIC_CONTENT`,不回传整篇 markdown_content。
- [ ] 空结果时返回明确"未找到",模型不编造。
- [ ] BASE_URL / account / top_k 走 `env() ?? 默认`,无硬编码到不可改。
- [ ] 检索层透传保留了 classification/url/author(为后续卡片留口)。
- [ ] 答案不整段复读检索 markdown。
- [ ] 外网指向 mock(`OCTO_KB_BASE_URL`)能跑通整条链;切内网域名代码零改动。

---

## 11. 内外网隔离调试(mock)

**原则**:所有内网依赖收敛到一个 env 接缝(`OCTO_KB_BASE_URL`),**代码内外网完全一致,只切 env**。这是 `.env.example` 对 `VITE_*` 已立规矩(外网走 mock)在 server 侧工具的延伸。

- **path 留代码、base 进 env**:工具拼 `${OCTO_KB_BASE_URL}/main/rest.root/ucdAgent/ucdAgent/getKnowledgeVector`;mock 按同 path 响应。
- ⚠️ **mock 必须 sidecar 可达**:工具跑在 sidecar(server),**不是** renderer。现有 [mock.ts](../../../UXAI/packages/desktop/src/main/mock.ts) 若只拦 renderer fetch,拦不到 sidecar 出站。两条路:
  1. **独立小 mock server**(bun serve 几行)返回 fixture,`OCTO_KB_BASE_URL=http://localhost:<port>` —— 最解耦(推荐先用这个调通);
  2. 若 mock.ts 监听了 sidecar 可达的本地端口,则扩它。
- **fixture 用真实样例造**:以"如何申请访谈酬金"的真实返回为模板,保留 `data[].data[].chunk_list[]`(带 `TOPIC_CONTENT`/`_score`),让外网能验证 chat→工具→合成答案→(将来卡片)整条链。
- **account 外网留空**:mock 不校验 account。
