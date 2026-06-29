# SPEC — insight 图片附件处理（S3 URL FilePart）

> 状态：草案 · 优先级 P2 · 规模 [S~M] · 领域 ui/insight
>
> 上游已实现：✓ 粘贴/拖拽图片 → base64 `FilePart`（[prompt-input/attachments.ts](../../../packages/app/octoapp/components/prompt-input/attachments.ts)，dev 分支 PR#235 引入到 insight）；✗ 图片走 S3 URL 而非 base64。依赖 [ADR-015](../adr/015-file-passing-architecture.md)。

---

## 0. 解决什么

图片附件（粘贴 / 选取 / 拖拽）传给**多模态模型**时,用 **S3 URL** 而非 base64,避免请求体暴涨、每轮重发。与 MCP 文件共用同一 S3 上传服务。

> 背景:opencode/上游把本地图片 `FilePart` 在组 prompt 时转成 `data:image/...;base64,...`（[prompt.ts:1257](../../../packages/opencode/src/session/prompt.ts#L1257)）。这是无存储后端工具的默认;我们有 S3,应走 URL（[ADR-015 决策 2](../adr/015-file-passing-architecture.md)）。

---

## 1. 现状（PR#235 合入 dev 后）

- 粘贴/拖拽图片 → `dataUrl(file)` 转 `data:<mime>;base64,...` → `ImageAttachmentPart{dataUrl}` → 发送时 `FilePart{url: dataUrl}`（[build-request-parts.ts:185](../../../packages/app/octoapp/components/prompt-input/build-request-parts.ts#L185)）。
- 非多模态模型 → `stripMedia` 换 `[Attached image/png: file]` 占位（[message-v2.ts:809](../../../packages/opencode/src/session/message-v2.ts#L809)）。

---

## 2. 目标

```
粘贴/选图 → (本地)可选拷进 insight/sources → 发送时上传 S3 拿 url
  → FilePart{ type:"file", mime:image/*, url: S3 url, filename }
  → 多模态模型:厂商服务器拉 url 看图
  → 非多模态模型:仍被 stripMedia 占位(不影响)
```

| 点 | 方案 |
|---|---|
| 上传时点 | **发送时**（图片是模型上下文,回合内必须就位;不同于 MCP 文件的「工具调用时」） |
| 载体 | 原生 `FilePart{url}`（复用上游;只把 url 从 base64 换成 https） |
| 复用 | 缓存 `文件→url`,多轮引用不重复传 |
| sources 拷贝 | 可选(图片一般非「研究源文件」;按需决定是否落 sources) |

---

## 3. 关键前提 / 待澄清

1. **provider↔S3 可达性**:多模态模型的 provider 服务器要能 GET 到该 S3 url。内网模型↔内网 S3 通则可行;接公网云模型够不到内网 S3 时,该 case 退回 base64 / Files API（[ADR-015 决策 2](../adr/015-file-passing-architecture.md) 的 reachability 分支）。
2. **模型多模态能力探测**:非多模态模型上传图片纯属浪费(最终被 strip)。可按 model 能力 gate「是否上传图片」,避免无谓上传——待定是否本期做。
3. **图片格式 / 大小**:沿用上传服务的校验(见 [file-upload.md](../infra/file-upload.md));注意 ALLOWED_EXT 当前不含图片,需扩。

---

## 4. 不做

- 与 SPEC-INS-014 sources/outputs、MCP 按需上传([insight-mcp-lazy-upload.md](../infra/insight-mcp-lazy-upload.md))解耦,各自独立。
- 剪贴板内存 blob 的本地落盘(无真实路径;sources 拷贝跳过,base64/上传仍可走)。
