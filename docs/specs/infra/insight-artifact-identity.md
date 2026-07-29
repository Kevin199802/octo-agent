# SPEC-INS-026：Insight 产物身份模型（Artifact Identity）

> **状态**：草案（待实现）
> **上游已实现**：✗（opencode `packages/ui` / `packages/app` 无对应机制；本 spec 为 insight 专属）
> **领域**：infra/insight（跨 UI 与落盘，是下列 spec 的上游真相源）
> **取代/收敛**：[insight-worktree-layout.md](insight-worktree-layout.md) §3.1–3.3 命名规则、[output-renderers.md](../ui/output-renderers.md) 类型路由与 `table` 卡、[mcp-contract.md](../agents/mcp-contract.md) `business_type` 的客户端语义、[insight-result-viewer.md](../ui/insight-result-viewer.md) tab 去重

## 修订记录

- **2026-07-29 v1（本版）**：确立「产物身份 = 磁盘路径」。起因是 UXAI PR #445（同一份 json 产物在对话卡与文件管理各开一个 tab）——排查发现双开只是症状，根因是产物在系统里同时存在**五套互不一致的表述**（见 §1）。PR #445 已关闭，其中「磁盘只有一份、两个入口 type 判定不一致」的排查结论收进本 spec §1.2。入口卡三态（§3）已先行落地：UXAI PR #467。

---

## 1. 问题：一份产物，五套表述

### 1.1 前提被打破

直觉上「MCP 产物下载到本地后，对话卡片 / 文件管理 / 磁盘文件是同一份，天然不需要去重」。实现里这个前提**只在最后一步才成立**：

`outputCards()` 是同步 memo，卡片**立刻渲染**；`createEffect` 观察到卡片后才异步触发 eager 落盘。所以卡片出现那一刻磁盘上还没有文件，卡片只能以 `uri` 为身份；磁盘文件是事后产生的**缓存**，通过一张异步填充的 join 表（`materializedPaths: Map<cardId, localPath>`）与卡片关联。

UI 的每一个决定——开哪个 tab、叫什么名、怎么渲染、从哪读内容——都在这个前提成立**之前**就做完了。

### 1.2 五个分叉轴

| 轴 | 分叉 |
|---|---|
| **身份** | 对话卡用 `uri`；文件管理 / write 产物用 `filePath`；tab-store 内另有 `card.id`。渲染侧 `materializedPaths` 与主进程 `.materialized.json` 是**两张** join 表，且填充是异步的 |
| **类型** | uri 卡走 `mimeToOutputType(mimeType)` + `business_type` 覆盖；文件管理 / write 走 `extToOutputType(filename)`；文件管理另有第三套 `InsightFileKind`（12 值，筛选/图标用）。同一文件结论可以不同：`.csv` → `table` vs `file`；`text/plain` → `file` vs `code`；`.json`+`business_type:"mindmap"` → `mindmap` vs `json` |
| **文件名** | 卡片展示 `resource_link.name` 原文；uri 产物磁盘名过 `sanitizeWorktreeName`（空格/括号→`_`、主名截 100）+ `collisionFreePath`；write 产物磁盘名**完全不清洗**。磁盘上同时存在两种命名风格 |
| **内容源** | `fetch(uri)` 读远端原件；`readFileBuffer(path)` 读原字节；`sdk.file.read(path)` 读盘但**会 `.trim()`**、二进制返回空串 |
| **落盘时机** | eager 落盘异步且尽力而为，失败只 `console.warn`。「本地文件存在」在 UI 层是随时间变化的布尔值 |

**双开 tab 的直接成因只有类型轴**：去重键里带了 `type`，而 `type` 在两个入口不是同一个函数算出来的。其余四轴各自会以别的形态冒出问题（内容不同步、名字对不上、产物静默丢失）。本 spec 一次性收敛五轴。

---

## 2. 业界对照与选型

| 做法 | 代表 | 身份 | 代价 |
|---|---|---|---|
| **A. 逻辑 URI + scheme provider** | VS Code（`TextDocumentContentProvider` / `FileSystemProvider`；一 URI 一 `ITextModel`，引用计数共享；`EditorInput.matches()` 比 `(resource, viewType)`；`ILanguageService` 单一类型解析；`ILabelService` 单一显示名） | 逻辑 URI，内容在哪是 provider 内部实现 | 需要先有 provider 抽象层；纯本地 write 产物也得造一个 URI |
| **B. 落地路径为身份，来源 URL 降为元数据** | 浏览器下载管理器（下载项身份是磁盘路径，`referrer`/`url` 只是属性） | 磁盘绝对路径 | 落盘完成前没有身份，必须显式建模"下载中" |
| **C. 内容寻址** | git / docker | 内容 hash | 产物可编辑，一改 hash 就变，不适用 |

**选 B。** 理由：

1. **产物是可编辑的**（markdown 编辑器 + 用户直接改磁盘文件）。一旦可编辑，远端原件就不再是真相源，磁盘那份才是；身份必须跟着真相源走。A 也能表达可编辑（FileSystemProvider 支持写），但需要先建整套 provider 抽象，收益不抵成本。
2. **文件管理是产品一等公民**（[insight-worktree-layout.md](insight-worktree-layout.md) §10），用户心智就是「文件」。
3. B 一次消掉四个轴：一个 path、一个类型函数、一个名字、一个读法。

B 的唯一代价（落盘前无身份）由 §3 的状态机承接。

> **A 的四条配套规则仍然采纳**，只是把「URI」换成「磁盘路径」：一个身份一份内容（§5）、tab 键是身份而非推断类型（§6）、类型判定单一入口（§4）、显示名单一来源（§4.3）。

---

## 3. 产物生命周期

```
出卡 ──► pending ──下载成功──► ready（绑定磁盘路径）
              └───下载失败──► failed ──重试──► pending
```

- **身份**：`ready` 后为 `<projectDir>/.octo/<sessionId>/outputs/<filename>` 绝对路径。
- **`uri` 的角色**：**下载凭据 + 落盘幂等键**，不是身份。幂等键沿用 [insight-worktree-layout.md](insight-worktree-layout.md) §3.3 的「URI → `.materialized.json`」不变——幂等键与身份是两个概念（npm cacache 同款：逻辑键是 URL，身份是落地条目）。
- **inline / path 源卡**：无落盘过程，直接 `ready`。
- **pending 卡可以点开**，不禁用：tab 以 `card.id` 临时开，落盘完成后绑定磁盘路径、身份转正（§6.2）。
- **failed 必须可见可重试**：入口卡呈现失败态，整卡点击即重试。旧实现失败只 `console.warn`，产物静默消失。

**已落地**：入口卡三态 + 重试链路（UXAI PR #467）。`_dev` 预览见 [development.md](../../development.md) §7.1 的 `/insight/__dev/insight-cards`。

---

## 4. 单一来源规则

### 4.1 命名：只做必要清洗

**必要 = 不清洗就落不了盘、或不安全。** 其余一律保持 MCP 文件名与磁盘名逐字一致。

| 处理 | 范围 | 为什么必要 |
|---|---|---|
| 拒绝 `/`、`\`、`NUL` | 全平台 | 含分隔符的字符串不是文件名；`join(dir, "a/b.json")` 会写进子目录，`../` 会写出会话目录——路径穿越，OS 不会拦 |
| 拒绝名字为 `.` 或 `..` | 全平台 | 同上 |
| 替换 `<>:"\|?*`、保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`）、尾部 `.` 与空格 | **仅 Windows** | 不处理 `fs.writeFile` 直接抛 `EINVAL`，产物丢失。macOS/Linux 这些字符合法，**不处理** |
| 按字节截断到文件系统上限、保住扩展名 | 全平台 | 超限 OS 抛 `ENAMETOOLONG` |

**明确废除**（[insight-worktree-layout.md](insight-worktree-layout.md) §3.1 现行规则）：空格 → `_`、括号等 → `_`、主名截 100 字符。这条源自「文件名随 basename 进 S3 URL、特殊字符致 MCP 下载失败」，而**文件名已退出 URL**（上传合同 v2 已落地），约束消失。它正是 `林(2).json` 在文件管理里显示成 `林_2_.json` 的原因。

- 上传方向（`copy-file-to-worktree`）同步废除，理由同上。
- 撞名仍走 `collisionFreePath` 加 ` (n)` 后缀，不变。
- 拒绝类失败**响亮报错**：toast + `[octo:worktree] materialize-rejected` 日志 + 保留原链接可手动下载；不静默改名。

### 4.2 类型判定：单一函数

```
resolveOutputType(filename, mimeType?) -> OutputCardType
```

解析顺序（对齐 `ILanguageService` 的单一解析链）：**扩展名 → mimeType 兜底 → `code`**。扩展名优先是因为身份就是磁盘路径，文件名是身份的一部分。

`OutputCardType` 收敛为 **6 个**：`markdown` | `html` | `json` | `code` | `file` | `image`。

- 废除 `table`（§7）。
- 废除 `mindmap` **作为类型**：思维导图是「json 的一种内容形态」，不是独立类型。判定下沉到渲染层已有的 `isMindmapJSON`（结构判定：`{mindmaps:[…]}` / `{nodes:[…]}` / 顶层带 `children` 的裸树），内容为导图 shape 就渲 markmap，否则渲 JSON 源——**实事求是，不管这份 json 从哪来**。
- 文件管理的 `InsightFileKind`（筛选/分组用）保留，但**必须由 `resolveOutputType` 派生**，不再独立按扩展名判，杜绝第三套判定。

### 4.3 显示名：单一来源

展示名一律为**磁盘 basename**（含撞名后缀），对话入口卡、tab 标签、文件管理三处同源。落盘前（`pending`）显示 `resource_link.name` 原文——因为按 §4.1 它与磁盘名逐字一致，不存在需要"预测"的转换。

> 曾出现的反模式：在渲染进程复刻主进程清洗规则来"预测落盘名"。它假设所有产物都走同一条落盘路径，而 write 产物不走，反而制造了新的名字分叉。§4.1 消灭了转换，这类预测函数不再需要，**不得引入**。

### 4.4 图标与文案可以不同源

**名字必须一致（那是身份），图标和文案不必。** 对话入口卡是「这次产出了什么」的语义视图，`ready` 后可按内容升级（导图 shape → 思维导图图标 + 「思维导图」文案）；文件管理是「磁盘上有什么」的文件视图，按扩展名给图标即可（Finder 也不会因为 json 内容是导图就换图标）。两者不构成分叉。

---

## 5. 内容读取：一个身份一份内容

已 `ready` 的产物**一律读磁盘**，不读远端原件。要原件走 ActionBar 的「下载原件」。

- 读法统一为 IPC `readFileBuffer(path)` + UTF-8 解码（原字节）。
- **不用 `sdk.client.file.read`**：服务端会对内容 `.trim()`（`packages/opencode/src/file/index.ts`），二进制返回空串。markdown 编辑器以 `tab.content` 为初始值并写回磁盘，trim 会静默吃掉首尾空白。
- `file` / `image` 类型不读文本，走各自 FileFallback / ImageRenderer，不变。
- 非桌面端（浏览器 `_dev` / 测试）无落盘能力：退回 `fetch(uri)` 只读预览，不进入本模型。

---

## 6. tab 身份与去重

### 6.1 规则

**一个磁盘文件 = 一个 tab，去重不看 type。**

多视图（预览 / 代码）由 tab 内的 `viewMode` 切换承担，不靠多开 tab。此前保留的「同一 URI 不同 type 各留一个 tab」规则**予以废除**：一个 `resource_link` 只产一张卡（`linkToOutputType` 返回单值），同一 uri 出两张卡的场景现网不存在，该规则在保护一个不存在的场景。

> `mcp-contract.md` 现写「`business_type: "mindmap"` 触发**双卡**（原始 JSON + 思维导图可视化）」，与实现（单卡 + 预览/代码切换）不符，随本 spec 修正。

### 6.2 pending 期间的 tab 身份

pending 卡开出的 tab 以 `card.id` 为临时身份；落盘完成后绑定磁盘路径。绑定时若已存在同路径 tab，合并到已有 tab（激活它、关掉临时 tab），保证「一个文件一个 tab」在时序上也成立。

---

## 7. `table` 类型退役

`table` 的唯一生产者是 `mimeType === "text/csv"`。而：

- spec 描述的链路是「fetch URI → **转 Markdown 表格** → 走 TableRenderer」，但 **csv → markdown 的转换函数从未实现**（`markdown-table.ts` 只有 `extractTableMarkdown` / `parseMarkdownTable` / `tableToCSV`，最后一个是 md→csv 的导出方向）；
- `TableRenderer` 用 `marked.lexer` 只认 markdown 表格 token，喂原始 CSV 会渲染成「未检测到表格内容」；
- `mcp-contract.md` 的 resource_link 示例中没有 `text/csv`（表格类产物用 xlsx），现网未触发过，所以这条死链一直没被发现。

**决定**：`text/csv` 归 `file`（与路径 C 的 `.csv` 一致，也与「原始逗号数据用 Excel/Numbers 打开体验更好」的既有判断一致），**不做任何格式转换**。删除 `TableRenderer`、`extractTableMarkdown`、`parseMarkdownTable`、`tableToCSV` 及 `table` 相关分支。

**导出入口一并去掉**（原 table 卡独有的「导出 Markdown / 导出 CSV」双格式菜单），**不迁移到 markdown 卡**：一篇 markdown 可含 N 张表，导出到单个 csv 没有合理语义（xlsx 可多 sheet、csv 不能；拆成多文件是另一个产品决策）。没有站得住的做法就不做，需要时另立需求。

---

## 8. `business_type` 降级为元数据

服务端继续按 [mcp-contract.md](../agents/mcp-contract.md) 必填（未来区分业务类型仍可能用到，且不要求后端改造），**客户端不再依赖它做类型路由**。

语义错配点：`business_type` 的定义是「产生该资源的 MCP tool 名」，被当成了「用哪个渲染器」。客户端实际只对 `"mindmap"` 一个值特殊处理，改为内容判定（§4.2）后，`business_type` 与扩展名不再打架。

---

## 9. 迁移与兼容

**存量不迁移**，延续 [insight-worktree-layout.md](insight-worktree-layout.md) v7 的 orphan 立场：

- 老会话已落成 `林_2_.json` 的文件保持原样；`.materialized.json` 仍指向它，命中即复用，**不会因为改了命名规则而重复下载**。
- 新产物按 §4.1 落 `林(2).json`。
- 同一 outputs 目录会新旧命名混杂，可接受——每份文件在卡片与文件管理里显示的都是它自己的真实磁盘名，不存在"两个名字"。

---

## 10. 影响的 spec

| 文档 | 改动 |
|---|---|
| [insight-worktree-layout.md](insight-worktree-layout.md) | §3.1 清洗规则改为 §4.1；§3.2 引本 spec；§3.3 撞名不变、补一条历史注记说明废除动因 |
| [output-renderers.md](../ui/output-renderers.md) | 删 `table` 全部条目（§86/§114/§301/§421/§561 等）；类型路由改为 §4.2 单一函数；mindmap 改内容判定；§6.B 补入口卡三态 |
| [mcp-contract.md](../agents/mcp-contract.md) | §58 「双卡」改单卡；§173-221 `business_type` 客户端语义降级为元数据 |
| [insight-result-viewer.md](../ui/insight-result-viewer.md) | tab 身份 = 磁盘路径；去重不看 type |
| [task-card.md](../ui/task-card.md) | §3.5「入口冗余 ≠ tab 重复」的去重判据同步 |

---

## 11. 验证

全部可在**外网本地**复现，无需内网数据。

### 11.1 单测（`bun test`，`packages/app/octoapp/pages/insight`）

| # | 断言 |
|---|---|
| V1 | `landingName("林(2).json") === "林(2).json"`；`landingName("我的 报告 v2.md") === "我的 报告 v2.md"`——非 Windows 下逐字保留 |
| V2 | `landingName("a/b.json")` 抛错；`landingName("..")` 抛错；`landingName("")` 抛错 |
| V3 | Windows 分支：`landingName('a:b.json') === "a_b.json"`；`landingName("CON.txt") !== "CON.txt"` |
| V4 | `resolveOutputType` 表驱动：`.csv`→`file`、`.md`→`markdown`、`.json`→`json`、`.txt`→`code`、无扩展名+`text/html`→`html`、无扩展名无 mime→`code` |
| V5 | `resolveOutputType` 对 `business_type` 不敏感：带与不带 `"mindmap"` 结果相同 |
| V6 | `openTab` 同一磁盘路径、不同 type → 只有 1 个 tab；**且交换两次调用顺序结果相同**（顺序无关） |
| V7 | pending 卡以 `card.id` 开 tab，绑定路径后与已有同路径 tab 合并为 1 个 |
| V8 | 全仓 `grep -r '"table"' pages/insight` 无类型残留（`TableRenderer` 等文件已删） |

### 11.2 手工（`bun run dev:desktop`，打开步骤见 [development.md](../../development.md) §7.1）

| # | 步骤 | 期望 |
|---|---|---|
| V9 | `/insight/__dev/insight-cards` | 三态样例：pending 呼吸且可点、ready 正常、failed 警示色 + 重试 |
| V10 | 断网后触发一次产物落盘 | 卡片进 failed；恢复网络点重试 → 回 pending → ready |
| V11 | 任意本地会话：`write` 一个名字带空格括号的 md，对话卡与文件管理对照 | 两处显示**同一个名字**，且与 Finder 里看到的一致 |
| V12 | 同一文件先从文件管理打开、再点对话卡（及反序） | 只有一个 tab，两次顺序表现一致 |
| V13 | 在磁盘上改这份文件，关掉 tab 重开 | 内容为改后的；文件尾部空行不被吃掉 |
