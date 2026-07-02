# SPEC-INS-014 — Insight 本地工作目录布局（worktree 文档本地化）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 infra/insight
>
> 上游已实现：✓ projectDir 目录绑定（[SPEC-INS-012](../ui/insight-directory-scoping.md)）、✓ MCP 产物 materialize（`downloadResourceToTemp` → `.octo/downloads/<id>`）；✗ 显性 `insight/sources` `insight/outputs` 布局、✗ 源文件本地落地
>
> **本 spec 是"本地新能力线"的地基**，是 extract / @引用 / 二次生成 / 本地解析的共同前置。独立分支、独立上线，不阻塞也不被阻塞于下游能力。

---

## 0. 这份 spec 解决什么

把 insight 在所选项目目录（projectDir）下的本地文件，从"隐藏的工具缓存（`.octo/downloads`）+ 只在 S3 的源文件"，规整成一套**显性、可管理、按 agent 命名空间隔离的工作目录**：

```
<projectDir>/
└── insight/                 ← 第二层 = agent 命名空间（未来 make/ 等并列）；不存在则自动创建
    ├── sources/             ← 拷贝进来的原始研究文件（本地副本）
    └── outputs/             ← 产物：MCP materialize 落地 + 本地能力 write 输出
```

做完之后：
- **源文件在本地** → 下游 extract / @引用 / 二次生成有了读取对象（[output-renderers §2.6 路径 C](../ui/output-renderers.md) 的本地读盘即可用）
- **产物显性可见** → 兑现"显性存储、管理上下文中的文件"诉求；[SPEC-INS-004 Workspace 面板](../ui/insight-workspace.md) 可直接列这两个目录
- **跨会话共享天然成立** → 目录按 **projectDir 键控、而非 session**（[SPEC-INS-012](../ui/insight-directory-scoping.md)），同目录下多 session 看到同一份文件，无需任何同步逻辑

**与 MCP 的边界（团队解耦）**：本 spec **不改 MCP 工具契约 / 服务**，模型侧 handle/url 契约与 `octo-upload-inject` 插件也**不变**。我们这侧有两处动作、都不碰他们：① 把结果 `resource_link` 下载到本地（消费他们的输出）；② 源文件上传 S3（我们自己的上传服务）——**上传时机的改造已移出本 spec**，见 [SPEC-INS-015 按需上传](insight-file-passing.md)；本 spec 地基期保持今天的 eager。详见 [§5](#5-与-mcp-的边界纯消费不改其流程)。

---

## 1. 现状

| 能力 | 状态 | 位置 |
|---|---|---|
| projectDir 目录绑定（会话 / 事件 / SDK 同源） | ✓ | `useProjectDir()` / `sdk.directory`，[index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx)，[SPEC-INS-012](../ui/insight-directory-scoping.md) |
| MCP 产物 materialize（幂等下载） | ✓ | `downloadResourceToTemp(uri,id,filename,baseDir)` → `<projectDir>/.octo/downloads/<id>/<file>`，[local-resource.ts](../../../packages/app/octoapp/pages/insight/utils/local-resource.ts)、[result-viewer/index.tsx](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx) |
| write 工具产物（路径 C，本地磁盘） | ✓ | [write-output.ts](../../../packages/app/octoapp/pages/insight/utils/write-output.ts)、[output-renderers §2.6](../ui/output-renderers.md) |
| 源文件上传 | ✓（仅 S3） | [lib/upload.ts](../../../packages/app/octoapp/pages/insight/lib/upload.ts) → S3；**本地无副本**，[file-upload.md](file-upload.md) |
| 显性 `insight/sources` `insight/outputs` 布局 | ✗ | 本 spec |

**两个待规整点**：

1. **产物落点是隐藏的 `.octo/downloads/<id>`**——是给 markdown 编辑器用的"工作副本缓存"，用户不可见、不可管理。
2. **源文件只在 S3**——当前对话拿不到内容（要 web fetch 内网，常失败），更别说跨会话；本地能力线（extract / @ / 二次生成）完全无米下锅。

---

## 2. 目录布局（SOT）

```
<projectDir>/insight/
├── sources/
│   └── <sanitized-filename>            （扁平；同名按 §3.3 去重 / 加后缀）
└── outputs/
    └── <sanitized-filename>            （扁平；撞名按 §3.3 加后缀，与 sources 同规则）
```

| 层 | 作用 | 备注 |
|---|---|---|
| `insight/` | agent 命名空间 | 未来 `make/` 等并列；不存在则**自动创建**（首次写入时 `mkdir -p`） |
| `sources/` | 原始研究文件本地副本 | 选文件时拷贝落地（[§4.1](#41-源文件导入-worktree本质是拷贝)） |
| `outputs/` | 产物落地 | MCP materialize（§4.2）+ 本地能力 write 输出（路径 C，写时即落此处）；扁平、撞名加后缀 |

**为什么显性（不藏 `.octo/`）**：源文件与产物是**用户的工作资产**，要能在 Workspace 面板列出、能用本地应用打开、能跨会话复用——属于"显性存储"。`.octo/` 保留给**纯工具缓存**（如不希望用户直接管理的中间态）。本 spec 把产物从 `.octo/downloads` **迁到** `insight/outputs`（[§4.2](#42-产物落点迁移-octodownloads--insightoutputs)）。

**为什么不按 id 分桶**：现有 `downloadResourceToTemp` 按不透明 `<id>`（卡/Tab id）分桶——藏在 `.octo/` 里无妨，但放进用户可见的 `insight/outputs` 会变成 `outputs/a8f3c2d1/report.html`，违背"显性"。故改**扁平 + 撞名加后缀**（`report (2).html`，与 sources 同规则）。代价：同一张卡每次要解析到同一文件名（markdown 编辑器幂等依赖）——卡首次 materialize 后把本地路径记在 tab 上，本会话内稳定；跨重启同名多产物是少见边界，可接受。**未来若用户觉得乱**，再按会话 id 分桶（`outputs/<sessionId>/…`）。

---

## 3. 文件命名与冲突

### 3.1 sanitize
沿用 [file-upload.md §filename sanitize](file-upload.md) 的服务端规则在客户端对齐：保留字母/数字/`-`/`_`/`.`/中文；空格 → `_`；其他 → `_`；主名截 100 字符；空名兜底 `unnamed`。

### 3.2 outputs 命名
文件名取 `resource_link.name`（uri 源）或 `basename(filePath)`（path 源），sanitize 后落 `insight/outputs/`，撞名加后缀（§3.3）。不再有 `<id>` 分桶。

### 3.3 撞名处理（sources 与 outputs 统一）
两个目录同一套规则：撞名（目标已存在）就**加后缀** `name (2).docx`（操作系统下载器习惯），不覆盖。

> 不做内容 hash 去重：handle（`upload_<hex>`）是 **URL 派生**（每次上传的 S3 路径 uuid 不同 → handle 也不同），不是内容 hash，拿它判重对不上；另算内容 hash 不值当。重复导入同一文件最多多一份副本，可接受。

---

## 4. 落地机制

### 4.1 源文件导入 worktree（本质是拷贝）

对本地路径而言这不是"上传"，是**把用户的文件拷贝进 worktree**。S3 上传是另一件只为 MCP 服务的事（地基期保持今天 eager；时机改造见 [SPEC-INS-015](insight-file-passing.md)）。

```
用户选文件 / 拖拽
  → （本地）fs.copyFile(原始路径, <projectDir>/insight/sources/<sanitized>)   ← 总是做
  → （MCP 用）POST S3 → 拿 url + handle → 注入 session                       ← 见 §4.1.1
```

- **拷贝实现**：文件选择器 / 拖拽能拿到**真实本地路径**（Electron `File.path`），主进程 `fs.copyFile(srcPath, dest)` 即可——**磁盘上流式拷贝、不占渲染进程内存**（100MB 也无压力），新增 `copyFileToWorktree(srcPath, dest)` IPC。
- **格式不变**：原样拷贝，**docx 还是 docx**，绝不转格式（office→文本是 Spec B 的事，且只另存派生文本、不动原件）。
- **不在本期处理**：粘贴的内存 blob（无真实路径，如剪贴板二进制）——少见，留作后续独立 spec（届时再加"写字节"API）。
- **无 projectDir / 非桌面端**：跳过本地拷贝，本地能力线在该会话不可用——降级而非报错。
- **失败处理**：拷贝失败**不阻断** MCP 主流程；记 `[octo:worktree] source-copy-failed`，本地能力线对该文件不可用。

#### 4.1.1 S3 上传时机 —— 移出本 spec，见 SPEC-INS-015（按需上传）

> **范围收敛（2026-06-29，已与用户对齐）**:S3 上传时机的改造**不在本 spec**。
>
> 探讨过两版且都**作废**:① 原草案「绑预置发送」(隐含 MCP 只经预置触达,行为回退);② 中途「绑任意发送」(自由消息发本地模型也上传——无意义、且上传服务不可用时阻断发送)。
>
> 想清楚后(见 [ADR-015](../../adr/015-file-passing-architecture.md)):S3 上传只为 MCP/UXR 工具服务,正确时机是「**模型真正调 MCP 工具时**」由插件按需上传,与「发送」无关。这是独立改造,拆到 **[SPEC-INS-015 MCP 文件按需上传](insight-file-passing.md)**(动 [ADR-014](../../adr/014-url-injection-via-plugin.md))。
>
> **本 spec(INS-014)地基期不改上传时机**:保持今天的 eager(选文件即传 + `[已上传文件]` 块),MCP 照常工作;本 spec 只新增 sources 拷贝(§4.1)+ outputs 迁移(§4.2)。
>
> 另:图片附件改走 S3 URL(而非 base64)也独立,见 [图片附件 spec](../ui/insight-image-attachment.md)。

### 4.2 产物落点迁移（`.octo/downloads` → `insight/outputs`）

把 MCP materialize 的落点从隐藏缓存迁到显性目录：

- `downloadResourceToTemp` 的落点由 `<baseDir>/.octo/downloads/<id>/<file>` 改为 `<baseDir>/insight/outputs/<file>`（扁平，撞名加后缀）。
- **同步更新调用点**（否则预览读 A、编辑写 B 会漂移）：
  - [local-resource.ts `ensureLocalMarkdownFile`](../../../packages/app/octoapp/pages/insight/utils/local-resource.ts)
  - [result-viewer/index.tsx `UriMarkdownTabBody`](../../../packages/app/octoapp/pages/insight/components/result-viewer/index.tsx)（注释里的落点说明一并改）
  - 桌面 IPC 内 `reuse-existing` 幂等逻辑：幂等键从 `<id>` 改为"卡首次落地后记在 tab 上的本地路径"（见 §2 不分桶说明）
- **幂等性保持**：迁移只换前缀，"已落地复用用户改过的那份"行为不变（仍是 markdown 编辑器持久化的依赖）。
- **路径 C（write 产物）**：write 工具写哪就在哪，本不经 `.octo/downloads`；若希望 agent 产物也统一进 `insight/outputs`，由 agent 提示词约定写入路径（属能力线 / agent 配置，不在本 spec 强制）。

> 旧 `.octo/downloads` 目录：迁移后不再写入；存量文件不主动清理（lifecycle 自然淘汰），新会话一律走 `insight/outputs`。

---

## 5. 与 MCP 的边界（纯消费，不改其流程）

| 动作 | 归属 | 是否动 MCP |
|---|---|---|
| handle 注入格式 + `octo-upload-inject` 插件替换 | 现有胶水（我们侧）+ MCP 工具（他们侧） | **一行不改**（block 仍 `handle:真实url`）|
| S3 上传**时机**改造（→ 模型调 MCP 时按需上传）| 我们侧（自有上传服务）| 否——移至 [SPEC-INS-015](insight-file-passing.md)；本 spec 不动上传时机 |
| 提交 MCP 任务 / 查询 / resource_link 形态 | MCP 团队 | **一行不改** |
| 把 resource_link 结果**下载到 `insight/outputs`** | 我们侧新增 | 否——通过现有 `resource_link` 接口**读他们的输出**，不改他们的行为 |
| 源文件拷贝进 `insight/sources` | 我们侧新增 | 否，与 MCP 无关 |

**责任交接点 = resource_link / 那份产物文件**：之前（原始分析质量）= MCP；之后（本地怎么存、怎么读、怎么二次改）= 我们。materialize 是纯消费动作，UXR 那份 S3 原件不动，随时可重新拉取对比"原版 vs 本地改过的"。

---

## 6. console 埋点（接入 [insight-debugging.md](../../insight-debugging.md) 日志字典）

| tag | 触发点 | 字段 |
|---|---|---|
| `[octo:worktree] ensure-dir` | 首次创建 `insight/sources` 或 `insight/outputs` | dir / created(bool) |
| `[octo:worktree] source-copy ok/failed` | 源文件拷贝进 worktree | srcPath / dest / reason |
| `[octo:worktree] result-materialize` | 产物落地（迁移后） | filename / path / reused(bool) |

> 新增前缀需同步登记 [insight-debugging.md](../../insight-debugging.md)。

---

## 7. 不做（scope out）

| 项 | 去向 |
|---|---|
| `extract_document`（office→文本） | Spec B（独立分支）|
| `@` 引用所有文档类型的前端联想交互 | Spec C |
| 二次生成（读源 + 上轮产物 → edit） | 独立 spec |
| 本地解析能力 + 测量/护栏策略 | 能力线，逐个 spec（最后） |
| S3 上传时机改造（按需上传）| [SPEC-INS-015](insight-file-passing.md) —— 模型调 MCP 工具时由插件按需上传；本 spec 地基期保持今天 eager |
| 图片附件改走 S3 URL（而非 base64）| [图片附件 spec](../ui/insight-image-attachment.md) |
| Workspace 面板 UI（列出 sources/outputs） | [SPEC-INS-004](../ui/insight-workspace.md)，设计师并行 |
| 跨设备 / 云端同步 | 不做（单机本地盘跨 session 已够；同步成本大收益弱）|

---

## 8. 验证步骤

| # | 操作 | 期望 |
|---|---|---|
| 1 | 选项目目录，选一个 .docx 源文件 | 立刻 `<projectDir>/insight/sources/<name>.docx`（原样拷贝、格式不变）；`[octo:worktree] source-copy ok`。S3 上传时机不在本 spec 验证（保持今天 eager；时机改造见 [SPEC-INS-015](insight-file-passing.md)）|
| 2 | 走预置 → 触发 MCP | 与今天一致（eager 上传 + `[octo:inject] args rewritten`）；本 spec 未改此链路 |
| 4 | 同名不同内容再导入 | 加后缀 `<name> (2).docx`，不覆盖 |
| 5 | 触发 MCP 任务 → 完成 → 点开产物卡 | 产物落 `<projectDir>/insight/outputs/<file>`（扁平，**不再**在 `.octo/downloads`、无 id 子目录）；`[octo:worktree] result-materialize` |
| 6 | markdown 卡编辑 → 保存 → 关卡重开 | 回显改动（幂等工作副本仍生效，落点变 `insight/outputs`）|
| 7 | 关 app 重开同一目录、新建会话 | `insight/sources` `insight/outputs` 里上一会话的文件仍在（跨会话共享）|
| 8 | 不选目录 / 浏览器 __dev | 跳过本地拷贝；MCP 主流程不受影响（降级不报错）|

---

## 9. 与下游 spec 的依赖

```
SPEC-INS-014（本 spec，地基）
  ├─→ Spec B  extract_document（office→文本，顺带返回字数）   依赖 sources 在本地
  │     └─→ Spec C  @ 引用所有文档类型
  ├─→ 二次生成（读 sources + outputs → edit）                  依赖两目录在本地
  └─→ 能力线（本地解析 + 护栏，逐个）                          依赖 sources + extract
```

每份 spec **独立分支、独立上线**，互不阻塞——本 spec 单独合入即兑现"源文件本地化 + 产物显性化 + 跨会话共享"，下游能力未就绪也有独立价值。
