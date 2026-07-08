# SPEC-INS-014 — Insight 本地工作目录布局（worktree 文档本地化）

> 状态：草案（v2，会话隔离修订） · 优先级 P1 · 规模 [M] · 领域 infra/insight
>
> 上游已实现：✓ projectDir 目录绑定（[SPEC-INS-012](../ui/insight-directory-scoping.md)）、✓ v1 已上线 `dev`（PR #238，`insight/sources`+`insight/outputs` 扁平布局）；✗ 按会话隔离、✗ `sources`→`uploads` 改名、✗ 文件管理 UI
>
> **本 spec 是"本地新能力线"的地基**，是 extract / @引用 / 二次生成 / 本地解析的共同前置。独立分支、独立上线，不阻塞也不被阻塞于下游能力。

---

> ## 修订记录
>
> **2026-07-08：v1（projectDir 扁平共享）→ v2（按会话隔离）**——v1 已上线 `dev`，把 `insight/sources`+`insight/outputs` 做成**按 projectDir 键控、跨 session 共享**（v1 §2 原文："为什么不按 id 分桶"：故意不分桶，为了免费拿到跨会话共享，把"按会话分桶"列为"以后如果觉得乱再做"的备选项）。
>
> 这次把这条决定反过来，**改为按会话隔离**，不再是备选项而是本次直接落地：
> - 对齐 Claude / 站内 **Make 模块**（`pages/make`，`design-files-panel.tsx` + `.octo/artifacts/make/<sessionId>/`）已经上线的会话隔离约定——两个同类产品内部已经不一致，没必要再犹豫
> - `sources` 改名 `uploads`（对齐 Claude / Make 用词）
> - **不跟 Make 的一点**：Make 把 artifacts 藏进 `.octo/`；本 spec **继续坚持 v1 "用户工作资产必须显性、可在 Finder 打开"的原则**，新布局仍在可见的 `insight/` 下
> - 新增"预会话落地区"机制（v1 没有这个问题，因为 v1 不分会话）：非图片附件在"选中"时还没有真实 session id，本 spec 采用 `insight/uploads/`（扁平、不属于任何会话）承接，发送时 `rename` 进 `insight/<sessionId>/uploads/`——原则参考 OpenAI/Anthropic Files API 的公开设计（upload 早于、独立于 conversation，发送时才关联），而非新发明
> - 旧 v1 数据（`insight/sources`、`insight/outputs` 扁平文件）**不做迁移**，新 write-file 白名单也不再放行旧路径；orphan 数据不主动清理（与"移除附件不删磁盘文件"的既有行为一致）
> - 配套新增"文件管理"UI（本 spec §10），实现上采用 Make 模块已验证的 `viewMode: "tabs"|"files"` 切换模式，**不是** [SPEC-INS-004](../ui/insight-workspace.md) 原草案设想的 260px 常驻侧栏——SPEC-INS-004 需要同步标记为被本 spec §10 取代，见该文档顶部的交叉引用

---

## 0. 这份 spec 解决什么

把 insight 在所选项目目录（projectDir）下的本地文件，从"隐藏的工具缓存（`.octo/downloads`）+ 只在 S3 的源文件"，规整成一套**显性、可管理、按会话隔离的工作目录**：

```
<projectDir>/insight/
├── uploads/                  ← 预会话落地区(§4.1.2):会话不存在时,非图片附件先落这里;扁平,不属于任何会话
└── <sessionId>/              ← 会话命名空间(v2 新增,替代 v1 的 projectDir 级扁平共享)
    ├── uploads/               ← 发送时把这次要发的附件从 insight/uploads/ rename 进来
    └── outputs/                ← 产物:MCP materialize 落地 + 本地能力 write 输出(从一开始就要求 sessionId)
```

做完之后：
- **源文件在本地** → 下游 extract / @引用 / 二次生成有了读取对象（[output-renderers §2.6 路径 C](../ui/output-renderers.md) 的本地读盘即可用）
- **产物显性可见** → 兑现"显性存储、管理上下文中的文件"诉求；本 spec §10 的文件管理 UI 直接列这两个目录
- **按会话隔离** → 匹配 Claude / Make 的用户心智模型："这是我这次对话上传/生成的文件"，不会看到别的会话混进来

**与 MCP 的边界（团队解耦）**：本 spec **不改 MCP 工具契约 / 服务**，模型侧 handle/url 契约与 `octo-upload-inject` 插件也**不变**。我们这侧有两处动作、都不碰他们：① 把结果 `resource_link` 下载到本地（消费他们的输出）；② 源文件上传 S3（我们自己的上传服务）——**上传时机的改造已移出本 spec**，见 [SPEC-INS-015 按需上传](insight-file-passing.md)；本 spec 保持今天的 eager。详见 [§5](#5-与-mcp-的边界纯消费不改其流程)。

---

## 1. 现状

| 能力 | 状态 | 位置 |
|---|---|---|
| projectDir 目录绑定（会话 / 事件 / SDK 同源） | ✓ | `useProjectDir()` / `sdk.directory`，[index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx)，[SPEC-INS-012](../ui/insight-directory-scoping.md) |
| v1：显性 `insight/sources` `insight/outputs`（projectDir 扁平共享） | ✓（已上线 dev，PR #238） | 本 spec v1 |
| v2：按会话隔离 `insight/<sessionId>/{uploads,outputs}` | ✗ | 本 spec（本次） |
| v2：`sources` → `uploads` 改名 | ✗ | 本 spec（本次） |
| v2：预会话落地区（`insight/uploads/` + 发送时 rename） | ✗ | 本 spec（本次） |
| 文件管理 UI（列出 uploads/outputs） | ✗ | 本 spec §10（本次，取代 [SPEC-INS-004](../ui/insight-workspace.md) 原草案） |

---

## 2. 目录布局（SOT，v2）

```
<projectDir>/insight/
├── uploads/
│   └── <sanitized-filename>            （预会话落地区；扁平；同名按 §3.3 去重 / 加后缀）
└── <sessionId>/
    ├── uploads/
    │   └── <sanitized-filename>        （该会话的附件；扁平；撞名按 §3.3 加后缀）
    └── outputs/
        └── <sanitized-filename>        （该会话的产物；扁平；撞名按 §3.3 加后缀）
```

| 层 | 作用 | 备注 |
|---|---|---|
| `insight/` | agent 命名空间 | 未来 `make/` 等并列；不存在则**自动创建**（首次写入时 `mkdir -p`） |
| `insight/uploads/` | 预会话落地区 | 非图片附件在没有真实 sessionId 时的临时落点，见 [§4.1.2](#412-预会话落地区与发送时归属) |
| `insight/<sessionId>/uploads/` | 该会话的附件 | 发送时从 `insight/uploads/` rename 进来 |
| `insight/<sessionId>/outputs/` | 该会话的产物 | MCP materialize（§4.2）+ 本地能力 write 输出（路径 C）；扁平、撞名加后缀 |

**为什么显性（不藏 `.octo/`，v1 决定 v2 continue 沿用）**：源文件与产物是**用户的工作资产**，要能在文件管理 UI 列出、能用本地应用打开、能被用户在 Finder 里直接找到——属于"显性存储"。`.octo/` 保留给**纯工具缓存**。站内 Make 模块把同类产物存进 `.octo/artifacts/make/<sessionId>/`（隐藏），本 spec **不跟这一点**——两个模块对"是否显性"的判断不同，是各自模块的独立选择，不视为不一致需要修的问题。

**为什么改成按会话隔离（v1→v2 的核心决定，见顶部修订记录）**：v1 的"projectDir 键控、不分桶"是为了免费拿到跨会话共享，且把分桶列为"以后再说"的选项。这次直接改成分桶，放弃跨会话共享，换来跟 Claude / Make 一致的用户心智模型（"这是这次对话的文件"）。**不做跨会话聚合视图**（本 spec 明确排除，见 §9）；未来若要看"整个项目下所有会话的文件"，需要新增聚合能力，属独立 spec，本次的目录结构（`sessionId` 作为已知的必填维度）不阻碍那件事。

**为什么 outputs 不需要预会话处理**：MCP 产物只可能发生在模型已经在真实会话里运行时——不存在"会话还没创建就有产物"的场景，因此 `outputs` 从一开始就要求真实 `sessionId`，没有 `uploads` 那样的预会话落地区问题。

---

## 3. 文件命名与冲突

### 3.1 sanitize
沿用 [file-upload.md §filename sanitize](file-upload.md) 的服务端规则在客户端对齐：保留字母/数字/`-`/`_`/`.`/中文；空格 → `_`；其他 → `_`；主名截 100 字符；空名兜底 `unnamed`。

会话目录名（`sessionId` 作为路径分段）额外做纯 allow-list 清洗（`[A-Za-z0-9_-]`，非法字符替换为 `_`）——渲染进程不是安全边界，防御性拒绝路径穿越。

### 3.2 outputs 命名
文件名取 `resource_link.name`（uri 源）或 `basename(filePath)`（path 源），sanitize 后落 `insight/<sessionId>/outputs/`，撞名加后缀（§3.3）。不做 `<id>` 分桶（只按 `sessionId` 分桶，桶内扁平）。

### 3.3 撞名处理（uploads 与 outputs 统一）
两个目录同一套规则：撞名（目标已存在）就**加后缀** `name (2).docx`（操作系统下载器习惯），不覆盖。`insight/uploads/` → `insight/<sessionId>/uploads/` 的 rename 步骤同样应用这条规则（目标目录里撞名就加后缀，不覆盖）。

> 2026-07-03 曾把落地文件名改为 `name_2.docx`（防空格/括号随 basename 进 S3 URL 致 MCP 下载失败），同日随上传合同 v2 提案（[file-upload.md](file-upload.md) 顶部：文件名退出 URL）回退，统一 ` (n)`。v2 落地前撞名文件走 MCP 会因 URL 特殊字符失败，与其他特殊字符文件名同属已知窗口，服务端改造收口。

> 不做内容 hash 去重：handle（`upload_<hex>`）是 **URL 派生**（每次上传的 S3 路径 uuid 不同 → handle 也不同），不是内容 hash，拿它判重对不上；另算内容 hash 不值当。重复导入同一文件最多多一份副本，可接受。

---

## 4. 落地机制

### 4.1 源文件导入 worktree（本质是拷贝）

对本地路径而言这不是"上传"，是**把用户的文件拷贝进 worktree**。S3 上传是另一件只为 MCP 服务的事（保持今天 eager；时机改造见 [SPEC-INS-015](insight-file-passing.md)）。

```
用户选文件 / 拖拽
  → （本地）fs.copyFile(原始路径, <projectDir>/insight/uploads/<sanitized>)   ← 总是做,落预会话区
  → （MCP 用）POST S3 → 拿 url + handle → 注入 session                       ← 见 §4.1.1
```

- **拷贝实现**：文件选择器 / 拖拽能拿到**真实本地路径**（Electron `File.path`），主进程 `fs.copyFile(srcPath, dest)` 即可——**磁盘上流式拷贝、不占渲染进程内存**（100MB 也无压力），`copyFileToWorktree(srcPath, baseDir, filename)` IPC（v1 已有，v2 目的地从 `insight/sources` 改 `insight/uploads`，签名不变）。
- **格式不变**：原样拷贝，**docx 还是 docx**，绝不转格式（office→文本是 Spec B 的事，且只另存派生文本、不动原件）。
- **不在本期处理**：粘贴的内存 blob（无真实路径，如剪贴板二进制）——少见，留作后续独立 spec（届时再加"写字节"API）。
- **无 projectDir / 非桌面端**：跳过本地拷贝，本地能力线在该会话不可用——降级而非报错。
- **失败处理**：拷贝失败**不阻断** MCP 主流程；记 `[octo:worktree] upload-copy failed`，本地能力线对该文件不可用。

#### 4.1.1 S3 上传时机 —— 移出本 spec，见 SPEC-INS-015（按需上传）

> **范围收敛（2026-06-29，已与用户对齐）**:S3 上传时机的改造**不在本 spec**。
>
> 探讨过两版且都**作废**:① 原草案「绑预置发送」(隐含 MCP 只经预置触达,行为回退);② 中途「绑任意发送」(自由消息发本地模型也上传——无意义、且上传服务不可用时阻断发送)。
>
> 想清楚后(见 [ADR-015](../../adr/015-file-passing-architecture.md)):S3 上传只为 MCP/UXR 工具服务,正确时机是「**模型真正调 MCP 工具时**」由插件按需上传,与「发送」无关。这是独立改造,拆到 **[SPEC-INS-015 MCP 文件按需上传](insight-file-passing.md)**(动 [ADR-014](../../adr/014-url-injection-via-plugin.md))。
>
> **本 spec(INS-014)不改上传时机**:保持今天的 eager(选文件即传 + `[已上传文件]` 块),MCP 照常工作。
>
> 另:图片附件改走 S3 URL(而非 base64)也独立,见 [图片附件 spec](../ui/insight-image-attachment.md)。

#### 4.1.2 预会话落地区与发送时归属（v2 新增）

**问题**：非图片附件"选中即拷贝"（§4.1）发生在用户点发送之前——欢迎页/还没发第一条消息时 `sessionId` 不存在（`session.create` 的服务端 API 不接受客户端指定 id，无法提前拿到真实 id）。v1 没有这个问题（不分桶，拷进哪都一样）；v2 按会话分桶后，必须回答"没 session 时拷去哪"。

**为什么继续"选中即拷贝"而不是"发送时才拷贝"**（讨论过、有意识选的，不是路径依赖）：
1. **Fail-fast**——本地磁盘拷贝的失败模式（权限、磁盘满、源文件在拷贝间隙被移动/U 盘拔出）比远程上传更容易发生在"选中"到"发送"之间；选中即拷贝能在发送前就暴露，不把这类失败塞进发送这条关键路径。
2. **和可验证的行业行为同构**：ChatGPT / Claude.ai 网页版选中附件后立刻显示上传中/失败重试，不等发送；这正是 OpenAI / Anthropic 公开的 Files API 设计模式——upload 早于、独立于 conversation，发送时才关联（`file_id` 引用）。"预会话落地区 + 发送时关联进真会话"是这个模式在本地磁盘拷贝场景下的对应实现，不是自造概念。

**机制**：
```
选中/拖拽非图片文件（无论有无 sessionId）
  → fs.copyFile → <projectDir>/insight/uploads/<sanitized>          ← §4.1，不变
  → 用户点发送，createAndNavigate() resolve 出真实 sessionId
  → fs.rename(insight/uploads/<file>, insight/<sessionId>/uploads/<file>)   ← 新增，本 spec
  → 更新附件状态里的本地 path，供 [附件] 清单 / MCP 按需上传使用
```
- `rename` 是同一文件系统内的原子操作，单文件通常 < 5ms，多附件可并行，不显著拖慢发送。
- **失败处理**：`rename` 失败（极少见）不阻断发送，该附件的 `[附件]` 清单路径退化为指向预会话区，仍可读；记 `[octo:worktree] upload-move failed`。
- **未发送的附件怎么办**：用户撤销附件（`removeAttachment`）不删除磁盘副本——这是 v1 就有的既有行为（附件被撤销后，v1 的 `insight/sources/` 里也会留孤儿文件），v2 沿用同一行为：留在 `insight/uploads/` 里不清理。**不做**发送失败/用户中途关闭 App 时的自动清理（跟 v1 一致的"孤儿数据不主动清理"立场）。

### 4.2 产物落点（`insight/<sessionId>/outputs`）

- `downloadResourceToTemp` 的落点为 `<baseDir>/insight/<sessionId>/outputs/<file>`（扁平，撞名加后缀），新增必填 `sessionId` 参数；`baseDir` 或 `sessionId` 缺一 → 走 OS 临时目录降级（不持久，无本地能力线）。
- **同步更新调用点**（否则预览读 A、编辑写 B 会漂移）：
  - [local-resource.ts `ensureLocalMarkdownFile`](../../../packages/app/octoapp/pages/insight/utils/local-resource.ts) — 新增 `sessionId` 参数
  - [result-viewer/index.tsx `UriMarkdownTabBody`/`FileFallback`](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx)、[action-bar.tsx](../../../packages/app/octoapp/pages/insight/components/result-viewer/action-bar.tsx)、[markdown-editor/index.tsx](../../../packages/app/octoapp/pages/insight/components/markdown-editor/index.tsx) — 各自本地 `useParams()` 取 `sessionId`（路由 `/insight/:id?`，Solid context 不受 `Portal` 影响，不需要逐层 prop 传递）
  - 桌面 IPC 内 `reuse-existing` 幂等逻辑：幂等键仍是"卡首次落地后记在 tab 上的本地路径"（不变，v1 已确立）
- **幂等性保持**：路径多了一层 sessionId，"已落地复用用户改过的那份"行为不变。
- **路径 C（write 产物）**：write 工具写哪就在哪，本不经此机制；若希望 agent 产物也统一进 `insight/<sessionId>/outputs`，由 agent 提示词约定写入路径（属能力线 / agent 配置，不在本 spec 强制）。

> 旧 v1 扁平数据（`insight/sources`、`insight/outputs`）：**不做迁移**。桌面 IPC 的 write-file 白名单改为只放行新的会话分桶路径，旧路径不再放行——Insight 的 tab 是纯内存 signal、不跨重启持久化，不存在"存活的 tab 引用旧路径"的场景，因此不会有半迁移状态。

---

## 5. 与 MCP 的边界（纯消费，不改其流程）

| 动作 | 归属 | 是否动 MCP |
|---|---|---|
| handle 注入格式 + `octo-upload-inject` 插件替换 | 现有胶水（我们侧）+ MCP 工具（他们侧） | **一行不改**（block 仍 `handle:真实url`）|
| S3 上传**时机**改造（→ 模型调 MCP 时按需上传）| 我们侧（自有上传服务）| 否——移至 [SPEC-INS-015](insight-file-passing.md)；本 spec 不动上传时机 |
| 提交 MCP 任务 / 查询 / resource_link 形态 | MCP 团队 | **一行不改** |
| 把 resource_link 结果**下载到 `insight/<sessionId>/outputs`** | 我们侧新增 | 否——通过现有 `resource_link` 接口**读他们的输出**，不改他们的行为 |
| 源文件拷贝进 `insight/uploads` → `insight/<sessionId>/uploads` | 我们侧新增 | 否，与 MCP 无关 |

**责任交接点 = resource_link / 那份产物文件**：之前（原始分析质量）= MCP；之后（本地怎么存、怎么读、怎么二次改）= 我们。materialize 是纯消费动作，UXR 那份 S3 原件不动，随时可重新拉取对比"原版 vs 本地改过的"。

---

## 6. console 埋点（接入 [insight-debugging.md](../../insight-debugging.md) 日志字典）

| tag | 触发点 | 字段 |
|---|---|---|
| `[octo:worktree] ensure-dir` | 首次创建 `insight/uploads`、`insight/<sessionId>/uploads` 或 `.../outputs` | dir / created(bool) |
| `[octo:worktree] upload-copy ok/failed` | 源文件拷贝进 `insight/uploads`（预会话区） | srcPath / dest / reason |
| `[octo:worktree] upload-move ok/failed`（v2 新增） | 发送时把附件从 `insight/uploads` rename 进 `insight/<sessionId>/uploads` | srcPath / dest / sessionId / reason |
| `[octo:worktree] result-materialize` | 产物落地 | filename / path / sessionId / reused(bool) |
| `[octo:insight-files] list-ok/list-failed`（v2 新增，客户端） | 文件管理 UI 拉取当前会话文件列表 | sessionId / category / count |

> 新增前缀需同步登记 [insight-debugging.md](../../insight-debugging.md)。

---

## 7. 不做（scope out）

| 项 | 去向 |
|---|---|
| `extract_document`（office→文本） | Spec B（独立分支）|
| `@` 引用所有文档类型的前端联想交互 | Spec C |
| 二次生成（读 uploads + outputs → edit） | 独立 spec |
| 本地解析能力 + 测量/护栏策略 | 能力线，逐个 spec（最后） |
| S3 上传时机改造（按需上传）| [SPEC-INS-015](insight-file-passing.md) —— 模型调 MCP 工具时由插件按需上传；本 spec 保持今天 eager |
| 图片附件改走 S3 URL（而非 base64）| [图片附件 spec](../ui/insight-image-attachment.md) |
| **跨会话聚合视图**（"整个项目下所有会话的文件"）（v2 新增排除项） | 未来独立 spec；本次目录结构不阻碍，`sessionId` 已是必填维度 |
| **会话删除后清理磁盘目录**（v2 新增排除项） | 不做，磁盘文件是用户资产，删会话不等于用户想删文件 |
| 文件管理面板的删除/重命名/归档/批量操作/拖拽上传（v2 新增排除项） | 本次只做只读列表 + 打开为 tab + 本地打开/显示文件夹；后续按需扩 |
| 跨设备 / 云端同步 | 不做（单机本地盘已够；同步成本大收益弱）|

---

## 8. 验证步骤

> **验证前提**：本 spec 新增了服务端接口 `/insight/files`（§10，类型化 HttpApi，不是普通 Hono 路由）和主进程 IPC handler（`move-pending-upload-to-session`、改过签名的 `copy-file-to-worktree`/`download-resource-to-temp`）——这类改动需要重启本地 opencode server 进程（桌面端连带 Electron 主进程）才会生效，验证前先确认已重启。**若重启后仍 404，不要默认归因于"没重启"**——本 spec 开发过程中就真实踩过：新接口错写成普通 Hono 路由，怎么重启都没用，因为本仓开发/预览渠道默认的后端根本不跑那份代码（见 §10 踩坑记录 + learning 笔记 [hono-vs-effect-httpapi-routing.md](../../learning/hono-vs-effect-httpapi-routing.md)）。排查顺序：① 确认改的是类型化 HttpApi（`httpapi/groups/*.ts` + `httpapi/handlers/*.ts`）而不是普通 Hono 路由；② 用 `bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>` 直接跑源码 + `curl` 验证接口本身通不通，绕开 Electron 打包/进程重启这些变量；③ 都排除了再看是不是真的没重启。
>
> 下表「环境」列：**外网** = 桌面端本地随便一个项目目录就能复现，不依赖内网服务；**内网** = 依赖 MCP / UXR 工具等只在内网可用的服务。

| # | 操作 | 期望 | 环境 |
|---|---|---|---|
| 1 | 选项目目录，欢迎页（无 session）拖一个 .docx | 立刻 `<projectDir>/insight/uploads/<name>.docx`（原样拷贝、格式不变）；`[octo:worktree] upload-copy ok` | 外网 |
| 2 | 发送第一条消息（带上一步的附件） | 文件被 rename 进 `<projectDir>/insight/<新sessionId>/uploads/<name>.docx`；`insight/uploads/` 下不再有它；`[octo:worktree] upload-move ok`；`[附件]` 清单路径是新路径 | 外网 |
| 3 | 走预置 → 触发 MCP | 与今天一致（eager 上传 + `[octo:inject] args rewritten`）；本 spec 未改此链路 | 内网（依赖 MCP） |
| 4 | 同名不同内容再导入（同一会话内） | 加后缀 `<name> (2).docx`，不覆盖；输入框 chip 与 `[附件]` 清单显示**带后缀的落地名** | 外网 |
| 5 | 触发 MCP 任务 → 完成 → 点开产物卡 | 产物落 `<projectDir>/insight/<sessionId>/outputs/<file>`；`[octo:worktree] result-materialize` 带 `sessionId` | 内网（依赖 MCP 产出真实产物；本地也可用 write 工具产物代替验证落点） |
| 6 | markdown 卡编辑 → 保存 → 关卡重开 | 回显改动（幂等工作副本仍生效，落点在 `insight/<sessionId>/outputs`）| 外网 |
| 7 | 关 app 重开同一目录、同一会话 | `insight/<sessionId>/uploads` `outputs` 里该会话的文件仍在 | 外网 |
| 8 | 新建第二个会话 | 文件管理 UI 只看到这个新会话自己的文件，看不到第一个会话的（**不再**跨会话共享，v1→v2 的核心行为变化）| 外网 |
| 9 | 不选目录 / 浏览器 __dev | 跳过本地拷贝；MCP 主流程不受影响（降级不报错）| 外网 |
| 10 | 文件管理面板拉取失败（如 `/insight/files` 404 或其他网络错误）| 只在文件管理面板内显示"加载文件列表失败 + 重试"，**不整页崩溃**（`InsightFileManager` 对 uploads/outputs 两个 resource 分别挡 `.error`，不直接调用可能已 error 的 resource accessor）| 外网 |

---

## 9. 与下游 spec 的依赖

```
SPEC-INS-014（本 spec，地基）
  ├─→ Spec B  extract_document（office→文本，顺带返回字数）   依赖 uploads 在本地
  │     └─→ Spec C  @ 引用所有文档类型
  ├─→ 二次生成（读 uploads + outputs → edit）                  依赖两目录在本地（现按 sessionId 分桶）
  └─→ 能力线（本地解析 + 护栏，逐个）                          依赖 uploads + extract
```

每份 spec **独立分支、独立上线**，互不阻塞——本 spec 单独合入即兑现"源文件本地化 + 产物显性化 + 按会话隔离"，下游能力未就绪也有独立价值。

---

## 10. 文件管理 UI（v2 新增，取代 SPEC-INS-004 原草案）

[SPEC-INS-004](../ui/insight-workspace.md) 原草案设想的是一个 260px 常驻侧栏、四个 section（工作文件/上下文/记忆/上传文件）。本次实际选择了**站内 Make 模块已验证的模式**：`viewMode: "tabs" | "files"` 页面级切换（不是常驻侧栏，也不是 `tabStore` 里的一个不可关闭假 tab）——`ResultViewer` 顶部 TabBar 里一个"文件管理"pill，点击整块替换 tab 内容区；`viewMode` 默认 `"files"`，配合"面板常驻可见"（不再要求 `tabs.length > 0` 才显示）实现"进入会话就能看到文件"。

与 Make 的关键差异：Insight 的 worktree 是**扁平**的（无子文件夹），文件管理面板不需要 Make 那套文件夹导航（breadcrumb/navigateToFolder），直接是"已上传 / 已生成"两段平铺列表。

**服务端接口（重要：不是普通 Hono 路由）**：`GET /insight/files?sessionId&category=uploads|outputs`，列 `insight/<sessionId>/<category>/`；不做 `/content`（复用现有 `source:"path"` tab 机制读文件）、不做 kind/mime 分类（复用客户端已有的 `extToOutputType()`/`fileTypeIconUrl()`）。

> **实现踩坑记录**：本仓开发/预览渠道默认启用 `OPENCODE_EXPERIMENTAL_HTTPAPI`（`packages/opencode/src/core/flag/flag.ts`），启用后请求走的是**另一套基于 Effect 的类型化 HttpApi 系统**（`server/routes/instance/httpapi/groups/*.ts` 定义 endpoint schema + `handlers/*.ts` 实现），普通 Hono 路由文件（`server/routes/instance/*.ts`，如 `artifact.ts`）在这个后端模式下**完全不会被调用**——首版实现照抄 `artifact.ts` 的写法新写了一个 Hono 文件，排查了很久才发现整条代码路径是死的。正确做法：接口应加进已有的类型化 `insight` 分组（`httpapi/groups/insight.ts` 定义 `InsightFileListQuery`/`InsightFileListResult`/`listFiles` endpoint + `httpapi/handlers/insight.ts` 实现 `listFiles` handler，用 `InstanceState.context` 拿 `instance.directory`，不是普通 Hono 里的 `Instance.directory` 静态导入）。这个机制的详细说明见 learning 笔记 [hono-vs-effect-httpapi-routing.md](../../learning/hono-vs-effect-httpapi-routing.md)。

本期范围：只读列表 + 点击以 tab 打开 + 本地打开/显示文件夹；不做删除/重命名/归档/批量操作/拖拽上传（见 §7）。

> SPEC-INS-004 需要在文档顶部加交叉引用，标记"文件管理 UI 部分被本 spec §10 取代，实现细节以此为准"。

### §10.1 下一轮：UI 打磨对齐 Design 模块（v3，待实施）

当前实现（`pages/insight/components/file-manager/index.tsx`）只有"已上传/已生成"两段平铺列表，样式明显简陋于站内 **Design 模块**已上线的"文件管理"（`pages/make/components/design-files/`，用户内网实测"还原度高"）。下一轮对齐，参照 Design 模块结构、复用 Insight 已有能力，**不抄它的存储层**（Design 存 `.octo/artifacts/make/`，Insight 按 §2 走显性 `insight/<sessionId>/`，这条本 spec 已定，不重新讨论）：

| 缺口 | Design 模块参照实现 | Insight 落地建议 |
|---|---|---|
| 顶部工具栏：刷新 / 分组切换(类型⇄修改时间) / 类型筛选 / 上传 | `make/components/design-files/design-files-toolbar.tsx` | 照结构重写一份，图标用 `@opencode-ai/ui/icon` 或 Insight 自己的 `icons/`（不导入 make 的 `design-files-icons.tsx`，保 insight 自包含） |
| 分组：按修改时间分桶（今天/昨天/最近7天/最近30天/更早，各带 count，可折叠）+ 按类型分组两种模式 | `make/utils/artifact-file-store.ts` 的 `groupMode`/`modifiedGroups`/`kindGroups`/`createFileListComputed` | 结构可直接照抄（这套计算逻辑与后端存储形态无关），换成读 Insight 自己的 `InsightFileEntry[]` |
| 排序：点表头（名称/类型/修改时间）切换升降序 | `artifact-file-store.ts` 的 `sortKey`/`sortDir` + 表头点击 | 同上抄结构 |
| 类型筛选：popover + 各类型 count | `artifact-file-store.ts` 的 `kindFilter`/`availableKinds`/`kindCounts` | 需要先给 `InsightFileEntry` 加 `kind` 字段（服务端 `listFiles` handler 里按扩展名分类，可复用现有 `extToOutputType()`/新写一份简化版，不需要 Design 那套完整 `KIND_BY_EXT`——insight worktree 里文件类型更少） |
| 多选：checkbox 列 + 全选 | `artifact-file-store.ts` 的 `selected`/`allPageSelected`/`somePageSelected` | 照抄；本轮**只做选中态**，批量操作（下载/删除）是否要做另议，先不承诺 |
| 真上传：点"上传"接文件选择器 + 拖拽 | `design-files-toolbar.tsx` 的上传入口 + Design 自己的 `/artifact/upload` | Insight 这边应该复用**已有的** `copySourceToWorktree`/`copyFileToWorktree`（index.tsx 里给输入框附件用的那条链路），不要新造一条上传通道——文件管理面板的"上传"本质是让用户脱离对话框也能往 `insight/<sessionId>/uploads/` 塞文件，落地机制该是同一套 |
| 视图空态 / loading 态细节 | `design-files-panel.tsx` 的 loading/error/empty 三态 | Insight 已有 error 态（本 spec §10 已做，防崩溃），loading/empty 态可以再打磨得更接近 |

**明确不建议做的**：Design 的文件夹导航（`navigateToFolder`/breadcrumb）——insight worktree 扁平，没有子文件夹，不需要；`upload-files/` 前缀剥离逻辑同理不需要。

**给下一轮实施者的提示**：先读本 spec 全文（尤其 §2 存储布局、§10 服务端接口形态、§10 的"实现踩坑记录"——新加/改服务端接口要确认走的是类型化 HttpApi 而不是死掉的 Hono 路由），再读 [hono-vs-effect-httpapi-routing.md](../../learning/hono-vs-effect-httpapi-routing.md)，再对照 Design 模块的三个参照文件；有 UI 截图（Design 模块实现 + 当前 Insight 实现）可以直接对照着改样式。
