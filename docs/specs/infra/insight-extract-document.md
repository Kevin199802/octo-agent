# SPEC-INS-016 — `extract_document` 工具(office → 文本,本地解析能力线 Spec B)

> 状态:已实现(UXAI `feat/extract-document`,待提 PR / 内网验证)· 优先级 P1 · 规模 [S~M] · 领域 infra/insight/tool
>
> 上游已实现:✗(opencode 无 office 抽取工具;Read 对二进制文件只报"binary file")
>
> 总纲:[ADR-015 文件传参架构](../../adr/015-file-passing-architecture.md)(office「模型读」= 本地路径引用 + 本工具,**不能走原生 FilePart**——opencode 组 prompt 时会把二进制 FilePart 急切 base64,模型摸不到路径)。
> 依赖:[SPEC-INS-014](insight-worktree-layout.md)(源文件已拷 `insight/sources/`)、[SPEC-INS-015](insight-file-passing.md)(路由 ② + 接线已就位)。
> 本 spec 只负责**工具本体**(抽取实现 + 测量 + 错误语义);注册 / agent 白名单 / 提示词路由 / `[附件]` 清单均已由 INS-015 完成,这里只记录其决策依据,不重复定义。

---

## 0. 形态(已收敛)

- **模型按需调的 tool,不自动内联**:遇 office 文件,模型按系统提示词调 `extract_document(path)` 拿纯文本;不在上传 / 发送时 eager 解析(大文档内联撑爆上下文)。
- **入参 = 本地路径**(`insight/sources/` 下,取自 `[附件]` 清单冒号后那串):短、干净、人类可读,与 Read/Grep 收路径同构,弱模型不易改坏——**不需要** ADR-014 那种 handle 间接层(那是为长编码 S3 URL 防的)。
- **lazy 解析**:进 tool 才读盘解析;解析结果**不缓存**(同文件重复调用重复解析,留作后续优化——真实场景一轮会话对同一文档多次全文抽取的频率低,先不为它上状态)。
- **顺带返回字数 / token 估算**:E 护栏(超阈值提醒)的「测量机制」寄生在本工具免费产出,不单开 spec。

## 1. 注册方式(设计点 ①)

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. opencode 内置 tool(现状)** | `packages/opencode/src/tool/extract_document.ts` + registry 注册,INS-015 已以此接线(stub) | **✓ 维持** |
| B. 插件提供 tool(octo-upload-inject 模式) | plugin `tool` 定义,经 `fromPlugin` Zod 包装 | ✗ stub 已在 builtin,迁移是无谓 churn;且 builtin 才能用 registry 的 agent gate |
| C. 本地小 MCP server(builtin-mcp 模式) | 起独立进程 + MCP 协议 | ✗ 为一个本地纯函数引入进程管理 / 协议序列化 / 生命周期,重且无收益;MCP 适合跨团队契约,不适合自有内置能力 |

「不动上游核心」在本仓的既定实践是**不动上游会同步的核心逻辑**;`tool/` 下加自有工具已有先例(`knowledge_search` / `jimeng` / `internel`),registry 改动是两行注册 + 一处 agent gate(均 INS-015 已提交),上游合并冲突面可忽略。

**Gate**:registry 里 `extract_document` 仅对 `agent.name === "octo_insight"` 暴露(不泄漏到 make/chat);octo_insight.md frontmatter `tools` 白名单 + 提示词「office 调它读」均已就位(INS-015),Spec B 零改动。

## 2. 路径引用(设计点 ②)

与 INS-015 §2 的 `[附件]` 清单**同一套**,不新增机制:清单给 `文件名: 本地路径`,`extract_document` 收路径(冒号后那串)、MCP 工具收文件名(冒号前那串)。`octo-upload-inject` 插件对 `extract_document` 直接放行(INS-015 §3-1),本地路径绝不被换成 URL。

工具不限制 path 必须在 `sources/` 下——Read/Grep 本就可读全盘,限制它不构成任何安全边界,徒增"路径对但被拒"的失败面。

## 3. 支持格式与库选型

### 3.1 支持格式(SOT)

**格式取舍只看两件事:本工具解析上能做到什么程度 × 用研需求值不值得。** 上传环节(客户端入口白名单、协作团队维护的服务端白名单)是跟随项、随时可改,不构成能力约束,扩格式时按文末对齐清单同步即可。

| 扩展名 | 解析 | 说明 |
|---|---|---|
| `.docx` | ✓ | mammoth `extractRawText` |
| `.xlsx` | ✓ | exceljs 逐表逐行取显示文本 |
| `.pdf` | ✓ | unpdf 合并各页文本;**扫描件(无文本层)返回「未抽取到文本」**(OCR 见 §8) |
| `.pptx` | ✓ | jszip + slide XML 直抽,含演讲者备注(方案与局限见 §3.3) |
| `.doc` / `.xls` / `.ppt`(97-2003 旧二进制 OLE2) | ✗ | 解析质量硬短板:mammoth / exceljs / 本 pptx 方案只认 OOXML;JS 生态解析旧二进制只有冷门库(word-extractor,.doc 尚可)或已被排除的 SheetJS(.xls 唯一选项),.ppt 无可用库。占比低 + 一步「另存为」即解决 → 回灌引导转存 docx / xlsx / pdf |
| `.pages` / `.numbers` / `.key`(iWork) | ✗ | 解析能力硬短板:专有 IWA(protobuf-in-zip)格式,JS 无可靠解析库;引导从 iWork 导出 docx / xlsx / pdf |
| `.txt` / `.md` | —(不经本工具) | 路由 ① FilePart 自动内联 |
| 图片 | —(不经本工具) | 路由 ③ vision |

**对齐清单(扩格式时逐项过)**:本表 → 客户端 `ALLOWED_EXT`(insight/lib/upload.ts,选择器 accept / 校验 / 提示文案的单一事实源)→ 插件 `DOC_EXT_RE` 预筛 → MCP 上传服务端白名单(协作团队维护,随时可配合改)→ octo_insight 提示词 office 列表。落地时已同步:**pdf**(INS-015 重构时入口遗漏,本次补回)与 **pptx** 全链对齐;pptx 的服务端白名单待协作团队跟进,跟进前 pptx 走 ②(本工具读)正常、走 ④(MCP 分析)会 415 回灌。

### 3.2 库选型(设计点:先评估再定)

| 格式 | 选用 | 排除项与理由 |
|---|---|---|
| docx | **mammoth** 1.12(`extractRawText`) | 事实标准、纯 JS;officeparser(小众)、docx4js(停更) |
| pdf | **unpdf** 1.6(unjs,内嵌 serverless 版 pdf.js) | pdf-parse v1 停更有 debug 陷阱、v2 直接依赖 pdfjs-dist(worker / canvas 可选依赖对单文件 bundle 不友好);pdfjs-dist 裸用同理。unpdf 就是为「打包进 serverless / 单文件」设计的,适配 sidecar 的 Bun.build 单文件产物 |
| xlsx | **exceljs** 4.4 | SheetJS(xlsx)npm 版停在 0.18.5 且有已知 CVE(原型污染 / ReDoS),新版只发自家 CDN——URL 依赖对内网 npm 镜像不友好、装机链路多一个外部单点;@e965/xlsx 是第三方转发布,供应链信任更差。exceljs 官方 npm 有维护,读 xlsx 取显示文本(`cell.text` 统一公式结果 / 日期 / 富文本)够用 |
| pptx | **jszip** 3.10 + 自写 slide XML 直抽(~50 行) | officeparser(多格式一把抓,但会把 docx/pdf 也换成它、各格式质量都不如专门库,只为 pptx 引全家桶不值);LibreOffice 无头转换(唯一能还原视觉阅读序的路线,但要求用户机器装 LibreOffice,桌面端不可控、重)。见 §3.3 |

四库均为 **lazy dynamic import**(进 execute 才加载,Bun.build 打进 bundle 但不占 sidecar 启动路径)。

**运行时约束**:桌面端 sidecar 是 Electron `utilityProcess.fork` 的 **Node 进程(非 Bun)**——文件 IO 用 `node:fs`,不用 `Bun.*`(INS-015 已踩过坑);四库已验证「Bun.build target=node 打包 → Node 22 运行」全通。

### 3.3 pptx 方案与已知局限

**方案 = 业界标准做法**:pptx 是 zip 容器,幻灯片文字全在 `ppt/slides/slideN.xml` 的 `<a:t>` 文本节点里(叶子节点、不嵌套,正则提取即可,不需引 XML 解析器)。officeparser / python-pptx / unstructured.io 的 pptx 抽取本质都是这一套——纯解析层面没有更高级的方案,要更好只能走 LibreOffice 转换 / 商业文档智能 API(重,见 §3.2 排除项)。实现细则:按 `<a:p>` 段落聚合成行、XML 实体解码、每页输出 `# 第 N 页` 分节;**演讲者备注**经该页 rels 定位 `notesSlideM.xml`(编号与 slide 不保证一致,不能按同编号猜),以 `[备注] ` 行附于该页。

**已知局限(如实告知,不装能)**:

| 局限 | 说明 |
|---|---|
| **文本框顺序 ≠ 视觉阅读序** | XML 里 shape 按插入序存储。规矩的模板页(标题 + 正文占位符)顺序基本正确;设计感强、文本框自由摆放的页面会乱序。对「给模型读内容提观点」影响有限(LLM 对段落袋容忍度高),对「按页复原报告结构」类任务不可靠 |
| SmartArt 文字不收 | 存在单独的 diagram XML(`ppt/diagrams/`),需 rels 级联解析,v1 不做 |
| 内嵌图表数据不收 | 图表数据在内嵌 xlsx 部件里,v1 不做 |
| 表格文字**能收** | 表格(`<a:tbl>`)单元格文字同样是 `<a:t>`,随段落自然带出,但丢行列结构(一格一行) |
| 图片上的文字无 | OCR 范畴,见 §8 |

## 4. 输出契约

成功(`chars > 0`):

```
《访谈稿-张三.docx》抽取完成:共 12,345 字(非空白字符),估算约 9,800 tokens。
---
<正文纯文本>
```

- **首行 = 测量结果**:Truncate 兜底是 head 方向截断,首行永远可见 → 无论多大的文档,模型 / E 护栏都拿得到字数。
- token 估算为业界粗算(CJK 每字 ≈1 token、其余 ≈4 字符/token),只求量级正确,不追求逐 tokenizer 精确。
- `metadata`:`{ path, format, chars, tokenEstimate, pages?(pdf), sheets?(xlsx), slides?(pptx) }`,E 护栏后续直接消费。
- 各格式正文形态:docx = 段落文本(**表格降为按单元格分段、样式图片丢弃**);pdf = 合并各页文本(**扫描件无文本层则空**);xlsx = 每工作表 `# 工作表:<名>` + TSV 行;pptx = 每页 `# 第 N 页` + 段落行 + `[备注] ` 行(局限见 §3.3)。

**大文件(设计点 ③)**:v1 **整篇返回**,不自研分页 / 按节——超 opencode `tool_output` 限额(默认 2000 行 / 50KB ≈ 2.5 万汉字)由 `Tool.define` 自带的 Truncate 兜底:截断 + **全文落盘** + 回灌提示引导模型用 Read(offset/limit)/ Grep 读全文。上层判断(要不要提醒用户 / 换策略)属 E 护栏;按节 / 范围抽取待真实需求再立。

## 5. 失败语义(全部以正常输出回灌,不抛错)

| 情形 | 回灌文案要点 | metadata.error |
|---|---|---|
| 文件不存在 | 指引「路径取自 `[附件]` 清单冒号后那串」 | `not-found` |
| 不支持格式(.doc/.xls/.ppt/iWork/…) | 列支持格式 + 引导「转存为 docx / xlsx / pdf 后重新上传」(转存一步即解决,比任何兜底都直接) | `unsupported` |
| 解析失败(损坏 / 加密) | 带解析器原始错误信息 + 建议改走 MCP | `parse-error` |
| 解析成功但无文本(扫描件) | 说明可能是扫描件 / 纯图片文档 + 建议改走 MCP | —(`chars: 0`) |

选「输出文本」而非「抛错」:两者都会回灌模型,但文本可控措辞、不在 UI 里渲染成红色工具失败;与 stub 时期语义一致。解析失败 / 无文本给 **MCP 兜底指引**(MCP 侧有自己的解析管线,可能读得动);不支持格式给**转存指引**。

## 6. console 埋点(接入 [insight-debugging.md](../../insight-debugging.md))

| tag | 触发 | 字段 |
|---|---|---|
| `[octo:extract] ok` | 抽取成功(server sidecar 落盘日志) | path / format / chars / tokenEstimate / ms / pages·sheets·slides |
| `[octo:extract] failed` | 失败 | path / reason(`not-found`·`unsupported`·`parse-error`) / format / err |

## 7. 验证

单测(`packages/opencode/test/tool/extract_document.test.ts`,fixtures 为手搓最小 docx/xlsx/pdf/pptx,独立于被测库):docx 中英正文 + 首行测量、pdf 文本 + 页数、xlsx 工作表 TSV、pptx 分页 + 备注 + 实体解码、不存在 / 不支持 / 损坏三失败路径,7/7 通过;`tsgo --noEmit` 干净;四库 Bun.build→Node 22 冒烟通过。

内网端到端(替代 INS-015 §8-2 的 stub 预期):选 docx 让模型读 → 无 S3 上传、模型调 `extract_document(path)` 拿到正文并能作答;超大 pdf → 首行字数可见、正文被 Truncate 截断且模型可按提示 Read 全文。

## 8. 不做 / 后续

- 解析结果缓存(路径 + mtime 键)——留观察:真实会话重复全文抽取频率低再说。
- 按节 / 页码范围抽取、目录感知——E 护栏或二次生成有真实需求再立。
- legacy 旧二进制(.doc/.xls/.ppt)、iWork——引导转存(§3.1);.doc 若真实需求高可评估 word-extractor 单独加。
- OCR(扫描件 pdf / 图片上文字)——tesseract.js 可行但要带语言包(中文 10MB+)、慢、准确率一般,独立决策、不捆在本 spec。
- pptx 视觉阅读序还原、SmartArt / 内嵌图表数据——见 §3.3 局限;要做只有 LibreOffice 转换路线,重,待真实需求。
- 提示词 / 白名单 / 清单格式改动——本次仅追加格式项(office 列表加 pptx、入口白名单加 pdf/pptx),机制零改动(INS-015 已就位)。
