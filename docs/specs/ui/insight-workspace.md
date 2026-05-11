# SPEC-INS-004 — 右侧 Workspace 工作区面板

> 状态：草案 · 优先级 P2 · 规模 [M] · 领域 ui/insight
>
> 上游已实现：✓ SessionSidePanel（文件树+上下文 Tab，但限 session 页面）；✗ insight/ 独立工作区面板

---

## 1. 目标

在 InsightPage 右侧提供**持久化工作区**，展示当前项目的工作文件、上下文材料和记忆，支持点击文件直接在 ResultViewer 中打开。

---

## 2. 上游现状

| 能力 | 状态 | 位置 |
|---|---|---|
| `SessionSidePanel` 文件树 + Context Tab | ✓ | `packages/app/src/pages/session/session-side-panel.tsx` |
| `FileTree` 组件 | ✓ | `packages/app/src/components/file-tree.tsx` |
| Session 上下文/记忆 | ✓ | `SessionContextTab`（来自 `@/components/session`） |
| **insight/ 独立工作区** | ✗ | 需自写（不直接 import session 专属组件） |

**策略**：参考上游 SessionSidePanel 的分区思路，在 `insight/components/` 内写自己的 WorkspacePanel。不 fork 上游组件（避免升级冲突），用更简单的列表实现即可。

---

## 3. 布局（对照设计稿，宽度约 260px）

```
┌──────────────────────────────┐
│  Workspace               [⊞] │  ← 标题 + 展开全部按钮
├──────────────────────────────┤
│  ▼ 工作文件 (2)              │  ← 可折叠 section
│    本地文件                  │
│      [📄] 发现3个核心痛点.insight │
│      [📄] 用户旅程断点识别.make   │
│    云端文件                  │
│      [📄] 差异化会合点.docx   │
│      [📄] 竞品对比矩阵.docx   │
├──────────────────────────────┤
│  ▼ 上下文 (3)                │
│    技能                      │
│      [📄] 关键用户旅程...docx │
│      [📄] 发现3个核心...docx  │
├──────────────────────────────┤
│  ▼ 记忆                      │
│      [📊] 差异化会合点.pptx   │
│      [📄] 竞品对比矩阵.docx   │
├──────────────────────────────┤
│  ▼ 上传文件                  │  ← 用户本次 session 上传的附件
│      [📄] 关键用户旅程...md   │
└──────────────────────────────┘
```

---

## 4. 数据模型

### 4.1 WorkspaceFile

```ts
type WorkspaceFile = {
  id: string
  filename: string
  path: string             // 绝对路径（本地）或 URL（云端）
  source: "local" | "cloud" | "upload" | "memory"
  mime: string
  size?: number
  updatedAt?: Date
}
```

### 4.2 数据来源（P1 实现范围）

| Section | 数据来源 | P1 实现 |
|---|---|---|
| 工作文件 / 本地 | agent write 工具产出的文件 | 监听 `message.part.updated`（type=file/patch），收集 |
| 工作文件 / 云端 | 用户手动上传到工作区 | 本期暂时为空，UI 展示空态 |
| 上下文 | 从 `globalSDK.client` 读取 session context | 待确认 API；P1 可先展示静态占位 |
| 记忆 | session memory 文件 | 同上；P1 静态占位 |
| 上传文件 | 当前 session 的 Attachment[] | 从 AttachmentBar 状态同步 |

> **P1 务实方案**：先实现"上传文件"和"工作文件/本地"两个 section 的真实数据，其余 section 展示友好空态。

---

## 5. 文件点击行为

| 文件类型 | 点击行为 |
|---|---|
| `.insight` / `.make` / `.md` | ResultViewer 新建 Tab，类型 `markdown` |
| 包含表格的 `.md` | ResultViewer 新建 Tab，类型 `table` |
| `.docx` / `.xlsx` / `.pptx` | `window.api.openPath(path)` 唤起本地应用 |
| `.pdf` | ResultViewer 新建 Tab，类型 `file`（显示"本地打开"按钮） |
| `.json` | ResultViewer 新建 Tab，类型 `json` |

---

## 6. 组件设计

```
insight/components/workspace-panel/
├── index.tsx              # WorkspacePanel 主容器（接收 onOpenFile 回调）
├── workspace-section.tsx  # 可折叠 Section（header + 子列表）
└── workspace-file-item.tsx # 文件行（图标 + 文件名 + hover 操作）
```

```ts
// WorkspacePanel props
interface WorkspacePanelProps {
  attachments: Attachment[]          // 来自 AttachmentBar（上传文件 section）
  generatedFiles: WorkspaceFile[]    // 来自 SSE 监听（工作文件 section）
  onOpenFile: (file: WorkspaceFile) => void
}
```

---

## 7. 空态

每个 section 无文件时：
- 文字灰色："暂无文件"

整个面板无任何文件时：
- 显示引导文字："在对话中上传文件或让 Agent 生成文件后，这里会显示"

---

## 8. 宽度与折叠

- 默认宽度 260px，固定不可拖拽（P2 再做拖拽调整）
- 整个 Workspace 面板可通过 topbar 或 keyboard shortcut 隐藏（P2）

---

## 9. 不做

- ✗ 云端文件上传/同步（P2，需要 OSS 接入）
- ✗ 文件重命名/删除（P2）
- ✗ 跨 session 持久化（每次刷新重新从 server 获取）
