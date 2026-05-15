# InsightPage v2 — Spec 总览

> 基于 2026-05-08 设计稿，聚焦"文件上传 → 对话 → 查看结果"核心流程的精细化实现。

---

## Spec 索引

| Spec | 文件 | 优先级 | 规模 | 状态 |
|---|---|---|---|---|
| 文件附件上传交互（AttachmentBar） | [insight-attachment.md](insight-attachment.md) | P1 | M | 草案 |
| 对话流与输出卡片（OutputCard） | [insight-conversation.md](insight-conversation.md) | P1 | M | 草案 |
| 中间面板结果查看器（ResultViewer） | [insight-result-viewer.md](insight-result-viewer.md) | P1 | L | 草案 |
| 右侧 Workspace 工作区面板 | [insight-workspace.md](insight-workspace.md) | P2 | M | 草案 |

---

## 页面布局（3栏，可拖拽调宽）

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  OctoShell Sidebar (215px)  │  对话/任务面板 (280px)  │  ResultViewer (flex-1) │  Workspace (260px) │
│                             │             ↕拖拽        │                        │                    │
│  Octo Insight               │  [附件 chips]           │  [Tab] 观点解析.insight │  ▼ 工作文件 (2)    │
│  ├ 访谈观点洞察分析          │  [用户指令文本]         │  ─────────────────────  │    本地文件        │
│  ├ 关键用户痛点…             │  ▶ 思考完毕             │  [表格/Mermaid/MD]      │    云端文件        │
│  Octo Make                  │  [输出卡片 →]           │                        │  ▼ 上下文 (3)      │
│  技能库 / 资产库 / 设置      │  [输入框 + 附件按钮]    │                        │  ▼ 记忆            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 列宽约束

| 列 | 默认宽度 | 最小 | 最大 | 可拖拽 |
|---|---|---|---|---|
| 对话/任务面板 | 280px | 200px | 520px | ✓ |
| ResultViewer | flex-1（剩余） | — | — | 被动伸缩 |
| Workspace | 260px（P2） | 200px | 400px | ✓（P2） |

**实现**：在对话面板右边缘放置 `<ResizeHandle direction="horizontal">` 组件（来自 `@opencode-ai/ui/resize-handle`），宽度用 `createSignal(280)` 持有，拖拽时更新。

### 输入区布局

```
┌──────────────────────────────────────────┐
│  [📝 file.docx ×]  [📄 doc.pdf ×]        │  ← AttachmentBar（仅有附件时显示，在输入框外部上方）
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│  输入指令，按 Enter 发送…                  │  ← textarea
│                                          │
│  [＋ 附件]                      [发送]   │  ← 工具栏（+ 按钮常驻，点击唤起 input[type=file]）
└──────────────────────────────────────────┘
```

注意：**chips 在输入框外部，+ 按钮在输入框内工具栏**，两者不再混排。

---

## 上游组件对照表（完整）

| 功能 | 上游已有 | insight/ 自写 |
|---|---|---|
| 文件 Attachment 数据类型 | ✓ `FilePart`（message-v2.ts） | AttachmentBar UI |
| session.prompt() 发文件 | ✓ `{type:"file", mime, url}` | prompt 组装逻辑 |
| reasoning 折叠渲染 | ✓ SessionTurn + PART_MAPPING | — |
| 工具调用卡片渲染 | ✓ basic-tool.tsx | — |
| Markdown 渲染 | ✓ `<Markdown>`（marked+shiki+KaTeX） | — |
| HTML 表格 | ✓ marked 内置 | styled-table 覆盖样式 |
| **Mermaid 流程图** | ✗ | MermaidRenderer（引入 mermaid.js） |
| **输出卡片（OutputCard）** | ✗ | InsightTurn 拦截 + OutputCard 组件 |
| **Tab 管理** | ✗ | ResultViewer TabBar + TabStore |
| **Workspace 工作区** | ✗（SessionSidePanel 不可复用） | WorkspacePanel |

---

## 核心数据流

```
用户上传文件 → AttachmentBar（chips）
    │
    ▼
用户输入指令 → session.prompt({ parts: [text, ...files] })
    │
    ▼ SSE 事件流
Agent 执行中：
  message.part.updated(reasoning) → InsightTurn 折叠显示
  message.part.updated(tool)      → InsightTurn 工具卡片
  message.part.updated(file)      → WorkspacePanel 工作文件 section 更新
    │
    ▼ session.idle
解析最终 text Part → 检测表格/Mermaid/JSON
    │
    ▼
生成 OutputCard（标题 + 类型 + 时间戳）
    │
用户点击 OutputCard
    ▼
ResultViewer 新建 Tab → 对应渲染器（TableRenderer / MermaidRenderer / …）
```

---

## 实施顺序建议

1. **Phase 1**（可演示核心流程）
   - `AttachmentBar` — 文件上传 chips
   - `InsightTurn` + `OutputCard` — 对话输出卡片
   - `ResultViewer` 框架 + `TableRenderer`（最常用输出形式）

2. **Phase 2**（补全结果形态，详见 [output-renderers.md](output-renderers.md)）
   - `MindmapRenderer`（markmap-view 渲染 JSON 思维导图）
   - `HtmlRenderer`（iframe sandbox）
   - ActionBar 导出扩展（Excel / SVG）

3. **Phase 3**（工作区面板）
   - `WorkspacePanel` — 上传文件 + 工作文件两个真实 section
   - 其余 section（上下文/记忆）待 API 确认后补充

---

## Phase 1 验证（端到端集成）

> 本节验证整体流程是否跑通，覆盖"上传 → 对话 → 查看结果"核心路径。  
> 各组件的单项验证见各自 spec（attachment §6、conversation §7、result-viewer §10）。

---

### V-01 布局验证（无需 Agent）

启动应用进入 InsightPage，目视检查：

| 区域 | 预期 |
|---|---|
| 左栏 | 宽约 280px，白色毛玻璃卡片，底部有输入框 |
| 中栏 | 占剩余全部宽度，浅色背景，显示空态（📄 图标） |
| 右栏 | 空占位 div，不可见（P2 Workspace 未实现） |
| 输入框工具栏 | 左侧"＋ 附件"按钮，右侧"发送"按钮 |
| 附件 chip 行 | 无附件时不渲染（不占空间）；添加附件后出现在输入框**上方** |

**拖拽调宽验证：**
1. 将鼠标移到对话面板右边缘，光标变为 `col-resize`
2. 向右拖拽约 100px
3. ✅ 预期：对话面板展宽，ResultViewer 相应收窄，两侧内容均不溢出
4. 向左拖拽到极限（约 200px）
5. ✅ 预期：宽度不低于 200px，超出极限后停止收缩
6. 向右拖拽到极限（约 520px）
7. ✅ 预期：宽度不超过 520px

**新建对话 Bug 验证（已修复）：**
1. 点击"新建对话"按钮创建一个空 session（URL 变为 `/insight/<id>`）
2. 此时对话面板显示"在下方输入指令开始分析"（**不再出现"新建对话"按钮**）
3. 再次点击任何地方，不会额外触发 session 创建
4. ✅ 预期：Session 只创建 1 次

**切换 session 后 ResultViewer 重置验证（已修复）：**
1. 在 session A 中触发一个 OutputCard 并打开 Tab
2. 在侧边栏点击切换到 session B
3. ✅ 预期：ResultViewer Tabs 清空，显示空态

---

### V-02 核心流程（需要 Agent 在线）

按以下顺序操作，每步检查预期：

**Step 1 — 上传附件**
1. 点击 ＋ 附件，选 1 个 `.txt` 文件（任意内容）
2. ✅ 输入框上方出现蓝色文件 chip

**Step 2 — 发送带附件的指令**

在输入框输入以下提示词，按 Enter 发送：
```
请根据附件内容，用 Markdown 表格整理出关键信息，至少 3 行，包含"要点"和"说明"两列。
```
3. ✅ chip 在发送后清空
4. ✅ 对话区出现 SessionTurn（思考过程/工具调用）
5. ✅ Agent 执行期间出现"⏳ 正在生成…"虚线占位

**Step 3 — 确认 OutputCard 生成**

Agent 回复完成后：
6. ✅ 虚线占位消失，出现 **OutputCard**（`⊞` 图标 + 标题 + 时间戳）
7. ✅ SessionTurn 内的正常文本/工具调用依然显示（OutputCard 是附加的）

**Step 4 — 在 ResultViewer 打开结果**

点击 OutputCard：
8. ✅ 中栏 ResultViewer 顶部出现 TabBar（显示卡片标题）
9. ✅ Tab 下方显示 ActionBar（复制/下载按钮）
10. ✅ 内容区显示**样式化表格**（灰色表头、交替行色）
11. ✅ 表格内容与 Agent 输出一致

**Step 5 — 多轮对话不破坏已有结果**

不关闭 Tab，继续在输入框发送：
```
好的，谢谢。
```
12. ✅ 已有 OutputCard 保持显示（不因新一轮 session.busy 消失）
13. ✅ 新一轮短回复不生成额外 OutputCard（< 200 字纯文本）
14. ✅ ResultViewer 中的 Tab 内容不受影响

---

### V-03 降级路径（Agent 不在线 / 无文件）

| 场景 | 预期 |
|---|---|
| 未创建 session，直接进入 `/insight` | 左栏显示空态（"Octo Insight" + "新建对话"按钮） |
| 发送空字符串 | 发送按钮 disabled，不触发请求 |
| 不上传附件直接发纯文本 | 正常发送，Agent 仅处理文本，流程同 V-02 Step 2 起 |

---

## 已废弃/不再适用的旧 Spec

- `task-panel.md` §6/§8/§10 — Vue 3 实现方案（SolidJS 重写后失效）；布局思路仍可参考 §5
