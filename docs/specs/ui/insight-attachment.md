# SPEC-INS-001 — 文件附件上传交互（AttachmentBar）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 ui/insight
>
> 上游已实现：✓ FilePart 数据结构；✓ session.prompt() parts 接受 file 类型；✗ insight/ 内无附件 UI

---

## 1. 目标

让用户在对话输入框上方以 **chips** 形式管理待上传文件，提交时随 prompt 一起发给 opencode server，实现"上传访谈逐字稿 → 一键分析"的核心流程。

---

## 2. 上游现状

| 能力 | 状态 | 关键位置 |
|---|---|---|
| `FilePart` 类型 | ✓ | `packages/opencode/src/session/message-v2.ts` |
| `session.prompt({ parts: [{type:"file", path:"..."}] })` | ✓ | `packages/opencode/src/session/prompt.ts:1713` |
| 图片/PDF 直接透传模型 | ✓ | `isMedia()` 函数识别 `image/*` / `application/pdf` |
| txt/md 展开为文本内容 | ✓ | 服务端自动处理 |
| **docx/xlsx 处理** | ⚠️ | 透传 base64；服务端不转换，能否理解取决于 provider |
| insight/ 内附件 UI | ✗ | 需自写 |

**docx 策略**：在 UI 层提示用户"模型将直接读取文件内容，建议使用 txt/md 格式获得最佳效果"，但不阻止上传。

---

## 3. 设计细节（对照设计稿）

```
┌─────────────────────────────────────────────┐
│  [docx图标] 算子开发工具访谈大纲.docx    [×]  │
│  [docx图标] 算子开发发访谈逐字稿.docx    [×]  │
└─────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  业务背景：算子开发工具规划进行核心功能改版，这是…          │
│                                              [发送▶]   │
│  [+附件]  [访谈观点洞察/观点解析 ▾]                    │
└────────────────────────────────────────────────────────┘
```

- **Chips**：文件图标（按 MIME 类型选图标）+ 截断文件名 + ×按钮；多行自动换行
- **添加文件**：点击 `+` 或拖拽到对话区，调用系统文件选择器
- **删除**：点击 × 移除 chip，不影响已发送的历史消息
- **上传状态**：chip 右侧显示进度环（读取 base64 时），完成后消失
- **文件数量限制**：单次最多 5 个，超出后 + 按钮置灰并 tooltip 提示

---

## 4. 交互流程

```
用户点击 [+附件] / 拖拽
  → 系统文件选择器（多选）
  → 读取文件为 base64 DataURL（File API）
  → 逐个 append chip（含 mime、filename、dataUrl）
  → [可选] docx/xlsx → 弹出 Toast 提示兼容性

用户点击 [发送]
  → parts = [
      { type: "text", text: promptText },
      ...attachments.map(a => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.dataUrl,        // data:application/vnd.openxmlformats... base64
      }))
    ]
  → globalSDK.client.session.prompt({ sessionID, parts })
  → chips 清空，等待 SSE 事件
```

---

## 5. 组件设计

```
insight/components/attachment-bar.tsx
  export type Attachment = { id: string; filename: string; mime: string; dataUrl: string }
  export function AttachmentBar(props: {
    attachments: Attachment[]
    onAdd: (files: File[]) => void
    onRemove: (id: string) => void
  })
```

- 状态由父组件（InsightPage）用 `createSignal<Attachment[]>` 持有
- 文件读取用 `FileReader.readAsDataURL`，异步 append 到列表
- 接受拖拽：在对话区容器上监听 `dragover` / `drop`

---

## 6. 验证步骤

> 不依赖 Agent 回复，纯 UI 交互验证。

### 6.1 基本上传

1. 打开 InsightPage（任意会话或空状态）
2. 点击输入框内的 **＋ 附件** 按钮
3. 在系统文件选择器中选 1 个 `.txt` 文件
4. ✅ 预期：输入框上方出现蓝色 chip，显示文件名 + `×`

### 6.2 上限保护

1. 继续点击 ＋ 附件，分 4 次各选 1 个文件，共 5 个
2. ✅ 预期：第 5 个选完后，＋ 附件按钮变灰（`opacity: 0.4`，`cursor: not-allowed`）
3. 尝试点击灰色按钮
4. ✅ 预期：文件选择器不弹出

### 6.3 删除 chip

1. 保持 5 个 chip 状态
2. 点击任意一个 chip 的 **×**
3. ✅ 预期：对应 chip 消失；＋ 附件按钮重新可点击

### 6.4 拖拽上传

1. 清空所有 chip
2. 从 Finder / 资源管理器拖拽 2 个文件到**对话面板**任意区域
3. ✅ 预期：拖拽悬停时面板出现蓝色 outline；松手后 2 个 chip 出现

### 6.5 发送后 chip 清空

1. 至少保留 1 个 chip，输入任意文字
2. 点击发送
3. ✅ 预期：发送后 chip 区域清空（attachments 状态归零）

---

## 7. 不做

- ✗ 云端存储/OSS 上传（本期全走 base64 DataURL，文件大小建议 < 5MB）
- ✗ 文件内容在客户端解析（docx → text 转换留 P2）
- ✗ 上传进度条（base64 转换几乎瞬时，不需要）
